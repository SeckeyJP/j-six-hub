"""コミットされた data/events.jsonl そのものの検査。

抽出にはセッション記録（著者の手元にしか無い）が要るため CI では再生成できない。
代わりに、生成済みのデータが形式と公開の条件を満たしているかを検査する。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import extract_events as ee  # noqa: E402

EVENTS = ROOT / "data" / "events.jsonl"
SCHEMA = ROOT / "data" / "events.schema.json"


@pytest.fixture(scope="module")
def events() -> list[dict]:
    with open(EVENTS, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def test_every_event_matches_schema(events):
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    validator = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
    errors = [f"{ev.get('id')}: {e.message}" for ev in events for e in validator.iter_errors(ev)]
    assert errors == []


def test_seq_and_id_are_contiguous(events):
    assert [ev["seq"] for ev in events] == list(range(1, len(events) + 1))
    assert [ev["id"] for ev in events] == [f"ev-{n:04d}" for n in range(1, len(events) + 1)]


def test_events_are_in_time_order(events):
    stamps = [ev["timestamp"] for ev in events]
    assert stamps == sorted(stamps)


def test_reconstructed_events_state_their_basis(events):
    for ev in events:
        if ev["provenance"] == "reconstructed":
            assert ev.get("basis"), ev["id"]
            assert ev["source"] == {"kind": "reconstruction"}, ev["id"]


def test_no_local_paths_or_emails(events):
    assert ee.privacy_problems(events) == []


def test_both_provenances_are_present(events):
    kinds = {ev["provenance"] for ev in events}
    assert kinds == {"measured", "reconstructed"}
