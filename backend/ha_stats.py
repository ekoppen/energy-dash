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

import asyncio
import json
from urllib.parse import urlsplit
from datetime import datetime, timedelta, timezone


class HAStatsError(Exception):
    pass


class HAAuthError(HAStatsError):
    """HA weigerde het token."""


# 730 dagen x 4 reeksen x ~120 B per uurbucket is ~8,4 MB; 16 MiB geeft ruimte.
MAX_BERICHT_BYTES = 16 * 1024 * 1024
TIMEOUT_S = 20  # connect en elke recv


def _client_zonder_redirects():
    # websockets.connect is in 13.1 de legacy Connect: die volgt tot
    # MAX_REDIRECTS_ALLOWED (10) redirects. Met 1 poging wordt een redirect
    # nooit gevolgd (er volgt geen tweede verbinding, wel SecurityError).
    from websockets.legacy.client import Connect

    class GeenRedirects(Connect):
        MAX_REDIRECTS_ALLOWED = 1

    return GeenRedirects


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
    pin_ip: str | None = None,
) -> dict[str, list[dict]]:
    """
    Haalt uur-statistieken op voor de gegeven entiteiten over `days` dagen.
    Retourneert per entity_id een lijst van buckets: {start, change}.
    `pin_ip`: verbind met dit (vooraf goedgekeurde) IP in plaats van de hostnaam
    opnieuw op te zoeken; handshake-Host en TLS-servernaam blijven de hostnaam.
    """
    ws_url = _ws_url(base_url)
    pin: dict = {}
    if pin_ip:
        parts = urlsplit(ws_url)
        pin = {"host": pin_ip, "port": parts.port or (443 if parts.scheme == "wss" else 80)}
        if parts.scheme == "wss":
            pin["server_hostname"] = parts.hostname
    start = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    async def recv():
        async with asyncio.timeout(TIMEOUT_S):
            return json.loads(await ws.recv())

    async with _client_zonder_redirects()(
        ws_url, max_size=MAX_BERICHT_BYTES, open_timeout=TIMEOUT_S, close_timeout=TIMEOUT_S, **pin
    ) as ws:
        # 1) auth handshake
        hello = await recv()  # {"type": "auth_required", ...}
        if hello.get("type") != "auth_required":
            raise HAStatsError("Onverwacht bericht bij verbinden")
        await ws.send(json.dumps({"type": "auth", "access_token": token}))
        auth_res = await recv()
        if auth_res.get("type") != "auth_ok":
            raise HAAuthError("Auth mislukt — controleer HA_TOKEN.")

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
            res = await recv()
            if res.get("id") == msg_id and res.get("type") == "result":
                if not res.get("success", False):
                    raise HAStatsError("Statistiek-verzoek geweigerd")
                return res.get("result", {})


def combine_import_export(
    stats: dict[str, list[dict]],
    import_ids: list[str],
    export_ids: list[str],
    dal_import_ids: list[str] = (),
) -> list[dict]:
    """
    Combineert de per-entiteit buckets tot één reeks {imp, exp, imp_dal} per uur,
    uitgelijnd op starttijd. Ontbrekende waarden tellen als 0. imp_dal is het
    deel van imp dat op het daltarief (P1-teller T1) binnenkwam.
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
    dal_by_start = index_by_start(list(dal_import_ids))

    records = []
    for s in sorted(set(imp_by_start) | set(exp_by_start)):
        imp = max(0.0, imp_by_start.get(s, 0.0))
        records.append({
            "imp": imp,
            "exp": max(0.0, exp_by_start.get(s, 0.0)),
            "imp_dal": min(imp, max(0.0, dal_by_start.get(s, 0.0))),
        })
    return records
