"""p1.py — vindt de HomeWizard P1-entities in de HA-states van een gebruiker."""
from __future__ import annotations

P1_SUFFIXES = {
    "active_power": "_active_power",
    "active_tariff": "_active_tariff",
    "import_t1": "_total_power_import_t1",
    "import_t2": "_total_power_import_t2",
    "export_t1": "_total_power_export_t1",
    "export_t2": "_total_power_export_t2",
}
P1_KEYS = tuple(P1_SUFFIXES)


class GeenP1Gevonden(Exception):
    pass


def find_p1_entities(states: list[dict]) -> dict[str, str]:
    """Kiest één meter (apparaat-prefix) waarvan alle zes entities bestaan."""
    ids = {s.get("entity_id", "") for s in states}
    power_suffix = P1_SUFFIXES["active_power"]
    prefixes = sorted(
        i[: -len(power_suffix)] for i in ids
        if i.startswith("sensor.p1_meter") and i.endswith(power_suffix)
    )
    for prefix in prefixes:
        found = {key: prefix + suffix for key, suffix in P1_SUFFIXES.items()}
        if all(entity in ids for entity in found.values()):
            return found
    raise GeenP1Gevonden("Geen HomeWizard P1-meter gevonden in deze Home Assistant")
