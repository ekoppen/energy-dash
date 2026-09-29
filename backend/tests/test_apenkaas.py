import asyncio

import httpx
import pytest

from apenkaas import Apenkaas, ApenkaasFout, NietIngelogd


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
