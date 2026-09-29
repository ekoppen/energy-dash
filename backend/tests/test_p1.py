import pytest

from p1 import GeenP1Gevonden, find_p1_entities

SUFFIXES = ["active_power", "active_tariff", "total_power_import_t1", "total_power_import_t2",
            "total_power_export_t1", "total_power_export_t2"]


def states(prefix, skip=()):
    return [{"entity_id": f"{prefix}_{s}"} for s in SUFFIXES if s not in skip]


def test_vindt_meter_met_serienummer():
    found = find_p1_entities(states("sensor.p1_meter_3c39e72e8b26") + [{"entity_id": "light.keuken"}])
    assert found["active_power"] == "sensor.p1_meter_3c39e72e8b26_active_power"
    assert found["export_t2"] == "sensor.p1_meter_3c39e72e8b26_total_power_export_t2"
    assert len(found) == 6


def test_vindt_meter_zonder_serienummer():
    assert find_p1_entities(states("sensor.p1_meter"))["import_t1"] == "sensor.p1_meter_total_power_import_t1"


def test_p1_kiest_complete_meter():
    incompleet = states("sensor.p1_meter_aaa", skip=("total_power_export_t2",))
    found = find_p1_entities(incompleet + states("sensor.p1_meter_bbb"))
    assert set(found.values()) == {f"sensor.p1_meter_bbb_{s}" for s in SUFFIXES}


def test_geen_p1():
    with pytest.raises(GeenP1Gevonden):
        find_p1_entities(states("sensor.p1_meter_aaa", skip=("active_tariff",)))


def test_negeert_power_l1():
    extra = [{"entity_id": "sensor.p1_meter_aaa_active_power_l1"}]
    assert find_p1_entities(extra + states("sensor.p1_meter_aaa"))["active_power"] == "sensor.p1_meter_aaa_active_power"
