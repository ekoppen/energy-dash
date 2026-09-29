"""Echte socket-tests: verbindingen gaan naar het goedgekeurde IP, niet naar een nieuwe DNS-opzoeking.

De URL gebruikt de niet-bestaande hostnaam ha.invalid: zonder pinning faalt de
verbinding al bij DNS en bereikt het verzoek de testserver nooit.
"""
import asyncio

import pytest

import ha_stats
import main
from ha_url import VeiligDoel


async def _server(antwoord: bytes):
    gezien: list[bytes] = []

    async def handler(reader, writer):
        gezien.append(await reader.readuntil(b"\r\n\r\n"))
        writer.write(antwoord)
        await writer.drain()
        writer.close()

    srv = await asyncio.start_server(handler, "127.0.0.1", 0)
    return srv, srv.sockets[0].getsockname()[1], gezien


def test_ha_get_verbindt_met_gepind_ip_en_houdt_hostnaam():
    async def run():
        srv, poort, gezien = await _server(
            b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n"
            b"Connection: close\r\n\r\n[]"
        )
        doel = VeiligDoel(f"http://ha.invalid:{poort}", "127.0.0.1")
        resultaat = await main._ha_get(doel, "t", "/api/states")
        srv.close()
        return resultaat, gezien[0].decode().lower()

    resultaat, verzoek = asyncio.run(run())
    assert resultaat == []
    assert verzoek.startswith("get /api/states ")
    assert f"host: ha.invalid:" in verzoek


def test_websocket_verbindt_met_gepind_ip_en_houdt_hostnaam():
    async def run():
        srv, poort, gezien = await _server(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
        with pytest.raises(Exception):
            await ha_stats.fetch_hourly_statistics(
                f"http://ha.invalid:{poort}", "t", ["sensor.a"], 1, pin_ip="127.0.0.1"
            )
        srv.close()
        return gezien

    gezien = asyncio.run(run())
    assert len(gezien) == 1
    verzoek = gezien[0].decode().lower()
    assert verzoek.startswith("get /api/websocket ")
    assert "host: ha.invalid:" in verzoek
