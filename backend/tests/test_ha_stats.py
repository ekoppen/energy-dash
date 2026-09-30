import asyncio

import pytest

import ha_stats
import main
from tests.test_main import AUTH, KOPPELING, NepApenkaas, client  # noqa: F401


def test_redirect_wordt_niet_gevolgd():
    """Echte socket-test: de redirect-doelserver mag nooit bereikt worden."""
    async def run():
        doel_geraakt = False

        async def doel(reader, writer):
            nonlocal doel_geraakt
            doel_geraakt = True
            writer.close()

        async def bron(reader, writer):
            await reader.readuntil(b"\r\n\r\n")
            writer.write(
                b"HTTP/1.1 301 Moved Permanently\r\nLocation: ws://127.0.0.1:%d/x\r\n"
                b"Content-Length: 0\r\nConnection: close\r\n\r\n" % doel_poort
            )
            await writer.drain()
            writer.close()

        d = await asyncio.start_server(doel, "127.0.0.1", 0)
        doel_poort = d.sockets[0].getsockname()[1]
        b = await asyncio.start_server(bron, "127.0.0.1", 0)
        bron_poort = b.sockets[0].getsockname()[1]
        with pytest.raises(Exception):
            await ha_stats.fetch_hourly_statistics(f"http://127.0.0.1:{bron_poort}", "t", ["sensor.a"], 1)
        await asyncio.sleep(0.1)
        d.close(); b.close()
        return doel_geraakt

    assert asyncio.run(run()) is False


def test_hours_niet_hastatserror_wordt_502(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(KOPPELING))

    async def weg(*a, **k):
        raise OSError("geheime-interne-tekst")

    monkeypatch.setattr(main, "fetch_hourly_statistics", weg)
    r = client.get("/hours", headers=AUTH)
    assert r.status_code == 502
    assert "geheime" not in r.text
    assert r.json()["detail"]["code"] == "ha_onbereikbaar"


@pytest.mark.parametrize("days", [0, 731, 10**9])
def test_hours_days_buiten_bereik_422(client, monkeypatch, days):  # noqa: F811
    monkeypatch.setattr(main, "apenkaas", NepApenkaas(KOPPELING))
    assert client.get(f"/hours?days={days}", headers=AUTH).status_code == 422


def test_combine_splits_dal_import_per_hour():
    from ha_stats import combine_import_export
    stats = {
        "imp_t1": [{"start": 1_700_000_000_000, "change": 0.4}, {"start": 1_700_003_600_000, "change": 0.0}],
        "imp_t2": [{"start": 1_700_003_600_000, "change": 0.7}],
        "exp_t1": [{"start": 1_700_000_000_000, "change": 0.1}],
    }
    records = combine_import_export(stats, ["imp_t1", "imp_t2"], ["exp_t1"], dal_import_ids=["imp_t1"])
    assert records == [
        {"start_ms": 1_700_000_000_000, "imp": 0.4, "exp": 0.1, "imp_dal": 0.4},
        {"start_ms": 1_700_003_600_000, "imp": 0.7, "exp": 0.0, "imp_dal": 0.0},
    ]


def test_start_ms_accepteert_ms_seconden_en_iso():
    from ha_stats import start_ms
    assert start_ms(1_700_000_000_000) == 1_700_000_000_000
    assert start_ms(1_700_000_000.0) == 1_700_000_000_000
    assert start_ms("2023-11-14T22:13:20+00:00") == 1_700_000_000_000
    assert start_ms("2023-11-14T22:13:20Z") == 1_700_000_000_000


def test_combine_sorteert_numeriek_niet_als_tekst():
    from ha_stats import combine_import_export
    stats = {"i": [{"start": 9_999_999_999_000, "change": 1}, {"start": 10_000_000_000_000, "change": 2}]}
    records = combine_import_export(stats, ["i"], [])
    assert [r["start_ms"] for r in records] == [9_999_999_999_000, 10_000_000_000_000]
