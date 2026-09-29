"""
ha_url.py — controleert een door de gebruiker opgegeven Home Assistant-URL.

De backend draait in het homelab; zonder deze controle kan een gebruiker de
backend interne adressen laten aanroepen (SSRF). Privé/loopback/link-local/
gereserveerde adressen worden geweigerd, behalve expliciet toegestane hosts.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit


class UrlNietToegestaan(Exception):
    pass


def _resolve(host: str) -> list[str]:
    return [info[4][0] for info in socket.getaddrinfo(host, None)]


# ponytail: resolve-dan-verbinden laat een DNS-rebinding-venster open; dicht
# te zetten door op het geresolvede IP te verbinden als dat ooit nodig is.
def check_ha_url(url: str, allow_private: set[str], resolve=_resolve) -> str:
    url = url.strip()
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise UrlNietToegestaan("Gebruik een http(s)-adres, bv. https://jouw-ha.example.nl")
    host = parts.hostname.lower()
    if host in allow_private:
        return url.rstrip("/")
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
    return url.rstrip("/")
