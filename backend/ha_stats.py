"""
ha_stats.py — haalt uur-statistieken uit de Home Assistant recorder.

Gebruikt de WebSocket-API (recorder/statistics_during_period), die kant-en-klare
uur-aggregaties levert. Per uur nemen we het verschil van de meterstand ("change")
= kWh dat uur. We combineren import (t1+t2) en export (t1+t2) tot één reeks
{ imp, exp } per uur, precies wat de accu- en saldering-features verwachten.

Waarom WebSocket en niet REST /api/history: history geeft ruwe state-changes die
je zelf zou moeten aggregeren; de recorder-statistieken geven nette uurbuckets
met een 'change'-veld, veel lichter en preciezer.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone


class HAStatsError(Exception):
    pass


def _ws_url(base_url: str) -> str:
    # http(s)://host:8123  ->  ws(s)://host:8123/api/websocket
    if base_url.startswith("https://"):
        return "wss://" + base_url[len("https://"):].rstrip("/") + "/api/websocket"
    return "ws://" + base_url[len("http://"):].rstrip("/") + "/api/websocket"


async def fetch_hourly_statistics(
    base_url: str,
    token: str,
    entity_ids: list[str],
    days: int,
) -> dict[str, list[dict]]:
    """
    Haalt uur-statistieken op voor de gegeven entiteiten over `days` dagen.
    Retourneert per entity_id een lijst van buckets: {start, change}.
    """
    ws_url = _ws_url(base_url)
    start = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    import websockets  # lazy import; staat in requirements

    async with websockets.connect(ws_url, max_size=None) as ws:
        # 1) auth handshake
        hello = json.loads(await ws.recv())  # {"type": "auth_required", ...}
        if hello.get("type") != "auth_required":
            raise HAStatsError(f"Onverwacht bericht: {hello.get('type')}")
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        auth_res = json.loads(await ws.recv())
        if auth_res.get("type") != "auth_ok":
            raise HAStatsError("Auth mislukt — controleer HA_TOKEN.")

        # 2) statistics_during_period opvragen (period=hour)
        msg_id = 1
        await ws.send(json.dumps({
            "id": msg_id,
            "type": "recorder/statistics_during_period",
            "start_time": start,
            "statistic_ids": entity_ids,
            "period": "hour",
            "types": ["change"],
        }))

        # antwoord kan meerdere frames zijn; wacht op het frame met ons id
        while True:
            res = json.loads(await ws.recv())
            if res.get("id") == msg_id and res.get("type") == "result":
                if not res.get("success", False):
                    raise HAStatsError(f"Statistiek-fout: {res.get('error')}")
                return res.get("result", {})


def combine_import_export(
    stats: dict[str, list[dict]],
    import_ids: list[str],
    export_ids: list[str],
) -> list[dict]:
    """
    Combineert de per-entiteit buckets tot één reeks {imp, exp} per uur,
    uitgelijnd op starttijd. Ontbrekende waarden tellen als 0.
    """
    def index_by_start(ids: list[str]) -> dict[str, float]:
        acc: dict[str, float] = {}
        for eid in ids:
            for bucket in stats.get(eid, []):
                start = bucket.get("start")
                change = bucket.get("change")
                if start is None or change is None:
                    continue
                key = str(start)
                acc[key] = acc.get(key, 0.0) + float(change)
        return acc

    imp_by_start = index_by_start(import_ids)
    exp_by_start = index_by_start(export_ids)

    all_starts = sorted(set(imp_by_start) | set(exp_by_start))
    return [
        {"imp": max(0.0, imp_by_start.get(s, 0.0)), "exp": max(0.0, exp_by_start.get(s, 0.0))}
        for s in all_starts
    ]
