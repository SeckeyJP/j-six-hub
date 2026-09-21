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

SCHEMA = ROOT / "data" / "events.schema.json"
MANIFEST = json.loads((ROOT / "data" / "projects.json").read_text(encoding="utf-8"))
PROJECTS = [p["id"] for p in MANIFEST["projects"]]
FICTIONAL = {p["id"] for p in MANIFEST["projects"] if p.get("fictional")}


def _load(project: str) -> list[dict]:
    with open(ROOT / "data" / "projects" / project / "events.jsonl", encoding="utf-8") as f:
        return [json.loads(line) for line in f]


@pytest.fixture(scope="module", params=PROJECTS)
def events(request) -> list[dict]:
    return _load(request.param)


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


@pytest.mark.parametrize("project", sorted(set(PROJECTS) - FICTIONAL))
def test_real_projects_have_both_provenances(project):
    kinds = {ev["provenance"] for ev in _load(project)}
    assert kinds == {"measured", "reconstructed"}


@pytest.mark.parametrize("project", sorted(FICTIONAL))
def test_fictional_projects_are_all_reconstructed_and_say_so(project):
    for ev in _load(project):
        assert ev["provenance"] == "reconstructed", ev["id"]
        assert "架空" in ev["basis"], ev["id"]
