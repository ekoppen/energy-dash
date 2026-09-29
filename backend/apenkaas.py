"""
apenkaas.py — praat met Apenkaas: wie is ingelogd (/me) en de HA-koppeling
per gebruiker (collection ha_koppeling, leesbaar alleen met de server-key).
"""
from __future__ import annotations

import time

import httpx

ME_CACHE_SECONDS = 60


class NietIngelogd(Exception):
    pass


class ApenkaasFout(Exception):
    pass


class Apenkaas:
    def __init__(self, base_url: str, tenant_id: str, server_key: str,
                 koppeling_collection_id: str, transport: httpx.AsyncBaseTransport | None = None):
        self._client = httpx.AsyncClient(
            base_url=f"{base_url.rstrip('/')}/api/{tenant_id}", timeout=10, transport=transport
        )
        self._server = {"Authorization": f"ApiKey {server_key}"}
        self._docs = f"/collections/{koppeling_collection_id}/documents"
        self._me_cache: dict[str, tuple[float, str]] = {}

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            return await self._client.request(method, path, **kwargs)
        except httpx.HTTPError as e:
            raise ApenkaasFout(f"Apenkaas onbereikbaar: {e}") from e

    async def user_id(self, token: str) -> str:
        now = time.monotonic()
        hit = self._me_cache.get(token)
        if hit and hit[0] > now:
            return hit[1]
        r = await self._request("GET", "/me", headers={"Authorization": f"Bearer {token}"})
        if r.status_code == 401:
            raise NietIngelogd()
        if r.status_code != 200:
            raise ApenkaasFout(f"/me gaf {r.status_code}")
        uid = r.json()["user_id"]
        self._me_cache = {t: v for t, v in self._me_cache.items() if v[0] > now}
        self._me_cache[token] = (now + ME_CACHE_SECONDS, uid)
        return uid

    async def get_koppeling(self, user_id: str) -> dict | None:
        r = await self._request("GET", f"{self._docs}/{user_id}", headers=self._server)
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise ApenkaasFout(f"koppeling lezen gaf {r.status_code}")
        return r.json()["data"]

    async def put_koppeling(self, user_id: str, data: dict) -> None:
        r = await self._request("PATCH", f"{self._docs}/{user_id}", headers=self._server, json={"data": data})
        if r.status_code == 404:
            r = await self._request("POST", self._docs, headers=self._server, json={
                "id": user_id, "data": data, "readPermissions": ["app"], "writePermissions": ["app"],
            })
        if r.status_code != 200:
            raise ApenkaasFout(f"koppeling opslaan gaf {r.status_code}")

    async def delete_koppeling(self, user_id: str) -> None:
        r = await self._request("DELETE", f"{self._docs}/{user_id}", headers=self._server)
        if r.status_code not in (200, 404):
            raise ApenkaasFout(f"koppeling verwijderen gaf {r.status_code}")
