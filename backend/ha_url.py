"""
ha_url.py — controleert een door de gebruiker opgegeven Home Assistant-URL.

De backend draait in het homelab; zonder deze controle kan een gebruiker de
backend interne adressen laten aanroepen (SSRF). Privé/loopback/link-local/
gereserveerde adressen worden geweigerd, behalve expliciet toegestane hosts.

Tegen DNS-rebinding: de controle geeft het goedgekeurde IP terug, en de
aanroepers verbinden daarna met precies dat IP (zie gepind_adres) in plaats
van de hostnaam opnieuw op te zoeken.
"""
from __future__ import annotations

import ipaddress
import socket
from typing import NamedTuple
from urllib.parse import urlsplit


class UrlNietToegestaan(Exception):
    pass


class VeiligDoel(NamedTuple):
    url: str        # genormaliseerde URL, met hostnaam (voor Host-header/TLS)
    ip: str | None  # goedgekeurd IP om mee te verbinden; None = host in allowlist


def _resolve(host: str) -> list[str]:
    return [info[4][0] for info in socket.getaddrinfo(host, None)]


def check_ha_url(url: str, allow_private: set[str], resolve=_resolve) -> VeiligDoel:
    url = url.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UrlNietToegestaan("Gebruik een http(s)-adres, bv. https://jouw-ha.example.nl")
    host = parts.hostname.lower()
    if host in allow_private:
        return VeiligDoel(url.rstrip("/"), None)
    try:
        addresses = resolve(host)
    except OSError:
        raise UrlNietToegestaan("Deze hostnaam bestaat niet")
    for address in addresses:
        ip = ipaddress.ip_address(address.split("%")[0])
        if ip.version == 6 and ip.ipv4_mapped:
            ip = ip.ipv4_mapped
        if not ip.is_global:
            raise UrlNietToegestaan("Dit adres is niet toegestaan")
    if not addresses:
        raise UrlNietToegestaan("Deze hostnaam bestaat niet")
    return VeiligDoel(url.rstrip("/"), addresses[0].split("%")[0])


def gepind_adres(doel: VeiligDoel) -> tuple[str, str, str]:
    """
    (basis-URL met het IP als host, Host-header, TLS-servernaam). De Host-header
    en TLS-servernaam blijven de hostnaam, zodat HA en het certificaat kloppen.
    """
    parts = urlsplit(doel.url)
    naam = parts.hostname or ""
    naam_in_url = f"[{naam}]" if ":" in naam else naam
    poort = f":{parts.port}" if parts.port else ""
    host_header = naam_in_url + poort
    if doel.ip is None:
        return f"{parts.scheme}://{host_header}{parts.path}", host_header, naam
    ip = f"[{doel.ip}]" if ":" in doel.ip else doel.ip
    return f"{parts.scheme}://{ip}{poort}{parts.path}", host_header, naam
