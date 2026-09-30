import asyncio
import json

import httpx
import pytest

from apenkaas import Apenkaas, ApenkaasFout, NietIngelogd, kies_instellingen


def maak(handler):
    return Apenkaas("http://ak", "t1", "geheim", "kop", transport=httpx.MockTransport(handler))


def test_user_id_en_cache():
    calls = []

    def handler(req):
        calls.append(req)
        assert req.url.path == "/api/t1/me"
        assert req.headers["authorization"] == "Bearer tok"
        return httpx.Response(200, json={"user_id": "u1", "tenant_id": "t1"})

    ak = maak(handler)
    assert asyncio.run(ak.user_id("tok")) == "u1"
    assert asyncio.run(ak.user_id("tok")) == "u1"
    assert len(calls) == 1


def test_user_id_ongeldig():
    ak = maak(lambda req: httpx.Response(401, json={"error": "invalid_token"}))
    with pytest.raises(NietIngelogd):
        asyncio.run(ak.user_id("slecht"))


def test_apenkaas_onbereikbaar():
    def handler(req):
        raise httpx.ConnectError("weg")
    with pytest.raises(ApenkaasFout):
        asyncio.run(maak(handler).user_id("tok"))


def test_get_koppeling_bestaat_niet():
    ak = maak(lambda req: httpx.Response(404, json={"error": "not_found"}))
    assert asyncio.run(ak.get_koppeling("u1")) is None


def test_get_koppeling_gebruikt_server_key():
    def handler(req):
        assert req.headers["authorization"] == "ApiKey geheim"
        assert req.url.path == "/api/t1/collections/kop/documents/u1"
        return httpx.Response(200, json={"id": "u1", "data": {"ha_url": "https://x"}})
    assert asyncio.run(maak(handler).get_koppeling("u1")) == {"ha_url": "https://x"}


def test_put_koppeling_maakt_aan_als_niet_bestaat():
    seen = []

    def handler(req):
        seen.append((req.method, req.url.path))
        if req.method == "PATCH":
            return httpx.Response(404, json={})
        body = __import__("json").loads(req.content)
        assert body == {"id": "u1", "data": {"a": 1}, "readPermissions": ["app"], "writePermissions": ["app"]}
        return httpx.Response(200, json={"id": "u1"})

    asyncio.run(maak(handler).put_koppeling("u1", {"a": 1}))
    assert seen == [("PATCH", "/api/t1/collections/kop/documents/u1"), ("POST", "/api/t1/collections/kop/documents")]


def test_delete_koppeling_404_is_ok():
    asyncio.run(maak(lambda req: httpx.Response(404, json={})).delete_koppeling("u1"))


def test_documenten_pagineert_en_filtert():
    gezien = []

    def handler(req):
        gezien.append(str(req.url))
        assert req.headers["authorization"] == "ApiKey geheim"
        offset = int(req.url.params["offset"])
        docs = [{"id": f"d{i}"} for i in range(offset, min(offset + 1000, 1500))]
        return httpx.Response(200, json={"documents": docs, "count": 1500})

    docs = asyncio.run(maak(handler).documenten("col", {"user_id": "eq.u1"}))
    assert len(docs) == 1500
    assert "user_id=eq.u1" in gezien[0] and "limit=1000" in gezien[0]
    assert len(gezien) == 2


def test_document_404_is_none_en_verwijderen_404_ok():
    ak = maak(lambda req: httpx.Response(404, json={"error": "not_found"}))
    assert asyncio.run(ak.document("col", "x")) is None
    asyncio.run(ak.verwijder_document("col", "x"))


def test_maak_document_stuurt_id_en_rechten():
    body = {}

    def handler(req):
        body.update(json.loads(req.content))
        assert req.url.path == "/api/t1/collections/col/documents"
        return httpx.Response(200, json={"id": "abc"})

    asyncio.run(maak(handler).maak_document("col", "abc", {"user_id": "u1"}, ["app"], ["app"]))
    assert body == {"id": "abc", "data": {"user_id": "u1"}, "readPermissions": ["app"], "writePermissions": ["app"]}


def test_kies_instellingen_alleen_eigen_document():
    docs = [
        {"id": "vreemd", "write_permissions": ["user:u2"], "bijgewerkt_op": "2026-09-30T10:00:00Z", "data": {}},
        {"id": "oud", "write_permissions": ["user:u1"], "bijgewerkt_op": "2026-09-01T10:00:00Z", "data": {}},
        {"id": "nieuw", "write_permissions": ["user:u1"], "bijgewerkt_op": "2026-09-29T10:00:00Z", "data": {}},
    ]
    assert kies_instellingen(docs, "u1")["id"] == "nieuw"
    assert kies_instellingen(docs, "u3") is None
