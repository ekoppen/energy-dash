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
        "imp_t1": [{"start": 1, "change": 0.4}, {"start": 2, "change": 0.0}],
        "imp_t2": [{"start": 2, "change": 0.7}],
        "exp_t1": [{"start": 1, "change": 0.1}],
    }
    records = combine_import_export(stats, ["imp_t1", "imp_t2"], ["exp_t1"], dal_import_ids=["imp_t1"])
    assert records == [
        {"imp": 0.4, "exp": 0.1, "imp_dal": 0.4},
        {"imp": 0.7, "exp": 0.0, "imp_dal": 0.0},
    ]
