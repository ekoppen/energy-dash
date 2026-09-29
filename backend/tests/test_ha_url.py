import pytest

from ha_url import UrlNietToegestaan, VeiligDoel, check_ha_url, gepind_adres


def resolver(mapping):
    return lambda host: mapping[host]


def test_publiek_adres_ok():
    r = resolver({"ha.example.nl": ["93.184.216.34"]})
    assert check_ha_url("https://ha.example.nl/", set(), r) == VeiligDoel("https://ha.example.nl", "93.184.216.34")


def test_prive_ip_geweigerd():
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("http://192.168.178.1:8123", set(), resolver({"192.168.178.1": ["192.168.178.1"]}))


def test_localhost_geweigerd():
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("http://localhost:8123", set(), resolver({"localhost": ["127.0.0.1"]}))


def test_hostnaam_naar_prive_geweigerd():
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("https://evil.example", set(), resolver({"evil.example": ["93.184.216.34", "10.0.0.5"]}))


def test_ipv4_mapped_loopback_geweigerd():
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("http://[::ffff:127.0.0.1]:8123", set(), resolver({"::ffff:127.0.0.1": ["::ffff:127.0.0.1"]}))


def test_allowlist_mag_prive():
    def nooit(host):
        raise AssertionError("allowlist hoort niet te resolven")
    assert check_ha_url("http://192.168.178.50:8123", {"192.168.178.50"}, nooit) == VeiligDoel("http://192.168.178.50:8123", None)


@pytest.mark.parametrize("url", ["ftp://ha.example.nl", "ha.example.nl", "http://", "file:///etc/passwd"])
def test_ongeldige_url(url):
    with pytest.raises(UrlNietToegestaan):
        check_ha_url(url, set(), resolver({}))


def test_onbekende_host():
    def faal(host):
        raise OSError("nx")
    with pytest.raises(UrlNietToegestaan):
        check_ha_url("https://bestaat-niet.example", set(), faal)


def test_gepind_adres_http_met_poort():
    assert gepind_adres(VeiligDoel("http://ha.example.nl:8123", "93.184.216.34")) == (
        "http://93.184.216.34:8123", "ha.example.nl:8123", "ha.example.nl")


def test_gepind_adres_https_ipv6_en_userinfo_weg():
    assert gepind_adres(VeiligDoel("https://u:p@ha.example.nl", "2606:4700::1")) == (
        "https://[2606:4700::1]", "ha.example.nl", "ha.example.nl")


def test_gepind_adres_zonder_pin_ongewijzigd():
    assert gepind_adres(VeiligDoel("http://192.168.178.50:8123", None)) == (
        "http://192.168.178.50:8123", "192.168.178.50:8123", "192.168.178.50")
