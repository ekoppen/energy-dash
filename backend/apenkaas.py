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

    async def documenten(self, collection_id: str, filters: dict[str, str] | None = None) -> list[dict]:
        """Alle documenten die de server-sleutel mag lezen, over alle pagina's."""
        alles: list[dict] = []
        while True:
            params = {**(filters or {}), "limit": "1000", "offset": str(len(alles))}
            r = await self._request("GET", f"/collections/{collection_id}/documents",
                                    headers=self._server, params=params)
            if r.status_code != 200:
                raise ApenkaasFout(f"documenten lezen gaf {r.status_code}")
            pagina = r.json()["documents"]
            alles += pagina
            if len(pagina) < 1000:
                return alles

    async def document(self, collection_id: str, doc_id: str) -> dict | None:
        r = await self._request("GET", f"/collections/{collection_id}/documents/{doc_id}", headers=self._server)
        if r.status_code == 404:
            return None
        if r.status_code != 200:
            raise ApenkaasFout(f"document lezen gaf {r.status_code}")
        return r.json()

    async def maak_document(self, collection_id: str, doc_id: str, data: dict,
                            lees: list[str], schrijf: list[str]) -> None:
        r = await self._request("POST", f"/collections/{collection_id}/documents", headers=self._server, json={
            "id": doc_id, "data": data, "readPermissions": lees, "writePermissions": schrijf,
        })
        if r.status_code != 200:
            raise ApenkaasFout(f"document aanmaken gaf {r.status_code}")

    async def verwijder_document(self, collection_id: str, doc_id: str) -> None:
        r = await self._request("DELETE", f"/collections/{collection_id}/documents/{doc_id}", headers=self._server)
        if r.status_code not in (200, 404):
            raise ApenkaasFout(f"document verwijderen gaf {r.status_code}")

    async def aclose(self) -> None:
        """Close the async HTTP client."""
        await self._client.aclose()


def kies_instellingen(docs: list[dict], user_id: str) -> dict | None:
    """
    Het instellingen-document van deze gebruiker: alleen documenten waarin user:<id>
    mag schrijven. Gebruikers kunnen geen rechten voor een ander toekennen (apenkaas),
    dus niemand kan een document namens een ander neerzetten.
    """
    eigen = [d for d in docs if f"user:{user_id}" in d.get("write_permissions", [])]
    return max(eigen, key=lambda d: d.get("bijgewerkt_op", ""), default=None)
