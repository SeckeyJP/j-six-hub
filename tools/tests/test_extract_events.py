"""tools/extract_events.py のテスト。

本物のセッション記録は著者の手元にしか無いため、テストでは合成したデータを使う。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))

import extract_events as ee  # noqa: E402


# --- 持ち出す情報の除去 -------------------------------------------------------

@pytest.mark.parametrize("raw, expected", [
    ('python3 "/Users/alice/dev/j-six/plugin/x.py"', 'python3 "<local>"'),
    ("see /home/bob/work/a.txt now", "see <local> now"),
    ("C:\\Users\\carol\\x.py", "<local>"),
    ("mail me: someone@example.com", "mail me: <email>"),
    ("相対パス reports/sast.sarif は残す", "相対パス reports/sast.sarif は残す"),
])
def test_scrub_removes_local_paths_and_emails(raw, expected):
    assert ee.scrub(raw) == expected


def test_privacy_check_flags_leaks():
    events = [{"summary": "ok", "payload": {"x": "/Users/alice/secret"}}]
    assert ee.privacy_problems(events) != []


def test_privacy_check_passes_clean_events():
    events = [{"summary": "ok", "payload": {"x": "reports/sast.sarif"}}]
    assert ee.privacy_problems(events) == []


# --- ゲート判定の行 -----------------------------------------------------------

GATE_OUTPUT = """Stop hook feedback:
[python3 "/Users/alice/j-six/plugin/scripts/jsix_run_checks.py"]:   ⏭ [G1] build: レポート駆動モードのため未実行
  ✅ [G1] scope: 変更 5ファイルはすべて許可範囲内
  ✅ [G2] tests: 全 45件 通過
  ❌ [G2] traceability: 未トレース 2件 / 全22件 → REQ-011, REQ-012
       - REQ-011
       - REQ-012
⏭ G3: G2 が未通過のため未実行
J-SIX 品質ゲート未達。修正してください。
"""


def test_parse_gate_lines_reads_each_check():
    results = ee.parse_gate_lines(GATE_OUTPUT)
    assert results == [
        {"layer": "G1", "check": "build", "status": "skipped", "summary": "レポート駆動モードのため未実行"},
        {"layer": "G1", "check": "scope", "status": "passed", "summary": "変更 5ファイルはすべて許可範囲内"},
        {"layer": "G2", "check": "tests", "status": "passed", "summary": "全 45件 通過"},
        {"layer": "G2", "check": "traceability", "status": "failed", "summary": "未トレース 2件 / 全22件 → REQ-011, REQ-012"},
        {"layer": "G3", "check": None, "status": "skipped", "summary": "G2 が未通過のため未実行"},
    ]


def test_parse_gate_lines_returns_empty_for_prompt_hook_text():
    assert ee.parse_gate_lines("Stop hook feedback: [ADR が必要なら提案してください]") == []


# --- 成果物と Phase の推定 ----------------------------------------------------

@pytest.mark.parametrize("path, artifact", [
    ("CLAUDE.md", "constitution"),
    ("docs/requirement-spec.md", "requirement_spec"),
    ("docs/design-spec.md", "design_spec"),
    ("docs/adr/0003-error-classification.md", "adr"),
    ("docs/tasks/TASK-AW-002.md", "task_definition"),
    ("tests/acceptance/test_uc.py", "holdout_tests"),
    ("tests/test_workflow.py", "tests"),
    ("app/workflow.py", "code"),
    ("reports/evidence/TASK-AW-002/00_summary.md", "evidence_pack"),
    ("docs/quality-metrics-2026-09-19.md", "quality_metrics"),
    ("docs/deliverables/behavior/01.md", "reverse_generated_docs"),
    ("docs/design-docs/kihon-sekkei.md", "reverse_generated_docs"),
    ("Makefile", None),
])
def test_artifact_for_path(path, artifact):
    assert ee.artifact_for_path(path) == artifact


def test_phase_for_artifacts_uses_latest_phase():
    assert ee.phase_for_artifacts(["requirement_spec", "design_spec", "adr"]) == "P2"
    assert ee.phase_for_artifacts(["tests", "code"]) == "P4"
    assert ee.phase_for_artifacts([]) is None


@pytest.mark.parametrize("subject, task, step", [
    ("test(acceptance): [TASK-AW-002] hold-out 受入テスト", "TASK-AW-002", "holdout"),
    ("test: [TASK-AW-002] Red - 対象不在", "TASK-AW-002", "red"),
    ("feat: [TASK-AW-002] Green - 新設", "TASK-AW-002", "green"),
    ("refactor: [TASK-AW-002] import を集約", "TASK-AW-002", "refactor"),
    ("docs(example): 設計レビュー", None, None),
    ("TASK-MB-007: Red — 単体テストと性質テストを追加", "TASK-MB-007", "red"),
    ("TASK-MB-007: Green — 振込先口座の登録", "TASK-MB-007", "green"),
    ("TASK-MB-007: G3 の指摘を受けて更新", "TASK-MB-007", None),
])
def test_task_and_step_from_subject(subject, task, step):
    assert ee.task_and_step(subject) == (task, step)


# --- Git ----------------------------------------------------------------------

def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    r = tmp_path / "repo"
    r.mkdir()
    _git(r, "init", "-q")
    proj = r / "examples" / "demo"
    (proj / "tests").mkdir(parents=True)
    (proj / "tests" / "test_a.py").write_text("x\n")
    (r / "unrelated.txt").write_text("y\n")
    _git(r, "add", "-A")
    env = ["-c", "user.name=T", "-c", "user.email=t@example.com"]
    subprocess.run(["git", "-C", str(r), *env, "commit", "-q", "-m",
                    "test: [TASK-X-001] Red - failing test",
                    "--date", "2026-09-19T13:18:16+09:00"], check=True,
                   env={**os.environ, "GIT_COMMITTER_DATE": "2026-09-19T13:18:16+09:00"})
    return r


def test_commit_event_from_git(repo):
    sha = _git(repo, "rev-parse", "HEAD")
    events = ee.commit_events(repo, "examples/demo", [{"sha": sha, "iteration": "it"}])
    assert len(events) == 1
    ev = events[0]
    assert ev["type"] == "commit.created"
    assert ev["timestamp"] == "2026-09-19T04:18:16Z"
    assert ev["task"] == "TASK-X-001"
    assert ev["phase"] == "P4"
    assert ev["actor"] == {"kind": "ai", "role": "ai_agent"}
    assert ev["provenance"] == "measured"
    assert ev["source"] == {"kind": "git", "ref": sha[:7]}
    assert ev["payload"]["artifacts"] == ["tests"]
    assert ev["payload"]["step"] == "red"
    assert ev["payload"]["files"] == 1  # プロジェクト外のファイルは数えない
    assert "t@example.com" not in json.dumps(ev)


def test_squash_commit_split_by_phase(repo):
    # squash された初版は1コミットに全 Phase の成果物を含む。Phase ごとに分けて並べる
    proj = repo / "examples" / "demo"
    (proj / "docs").mkdir()
    (proj / "docs" / "requirement-spec.md").write_text("r\n")
    (proj / "app").mkdir()
    (proj / "app" / "main.py").write_text("m\n")
    (proj / "CLAUDE.md").write_text("c\n")
    _git(repo, "add", "-A")
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=T", "-c", "user.email=t@example.com",
                    "commit", "-q", "-m", "初版"], check=True)
    sha = _git(repo, "rev-parse", "HEAD")
    events = ee.commit_events(repo, "examples/demo", [{"sha": sha, "iteration": "it", "split_by_phase": True}])
    assert [(e["phase"], e["payload"]["artifacts"]) for e in events] == [
        ("P0", ["constitution"]), ("P1", ["requirement_spec"]), ("P4", ["code"]),
    ]
    assert all(e["payload"]["split_of"] == sha[:7] for e in events)
    # 工程（step）は P4 に分けたものだけに付ける
    assert [("step" in e["payload"]) for e in events] == [False, False, False]
    assert len({e["timestamp"] for e in events}) == 1


APPROVAL_DOC = """# 要求 Spec

## 承認

| 役割 | 氏名 | 日付 | 承認 |
|---|---|---|---|
| 顧客責任者 | （サンプル） | 2026-09-19 | ✅ |
| PM | H.Sekita | 2026-09-19 | ✅ |

**合意成熟度の確認**
"""


def test_parse_approval_table():
    assert ee.parse_approval_table(APPROVAL_DOC) == [
        {"role": "顧客責任者", "name": "（サンプル）", "date": "2026-09-19", "approved": True},
        {"role": "PM", "name": "H.Sekita", "date": "2026-09-19", "approved": True},
    ]


def test_parse_approval_table_without_section():
    assert ee.parse_approval_table("# 文書\n\n本文のみ\n") == []


def test_approval_event_from_document_at_commit(repo):
    proj = repo / "examples" / "demo"
    (proj / "docs").mkdir(exist_ok=True)
    (proj / "docs" / "requirement-spec.md").write_text(APPROVAL_DOC, encoding="utf-8")
    _git(repo, "add", "-A")
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=T", "-c", "user.email=t@example.com",
                    "commit", "-q", "-m", "spec"], check=True)
    sha = _git(repo, "rev-parse", "HEAD")
    [ev] = ee.approval_events(repo, "examples/demo", [{
        "sha": sha, "file": "docs/requirement-spec.md", "gate": "customer_approval", "phase": "P1",
        "iteration": "it", "recorded_by": "ai",
    }])
    assert ev["type"] == "gate.approved"
    assert ev["provenance"] == "measured"
    assert ev["actor"] == {"kind": "ai", "role": "ai_agent"}
    assert ev["payload"]["gate"] == "customer_approval"
    assert ev["payload"]["recorded_by"] == "ai"
    assert ev["payload"]["approvals"][1]["name"] == "H.Sekita"
    assert ev["source"] == {"kind": "git", "ref": f"{sha[:7]}:docs/requirement-spec.md"}


def test_commit_phase_override(repo):
    sha = _git(repo, "rev-parse", "HEAD")
    [ev] = ee.commit_events(repo, "examples/demo", [{"sha": sha, "phase": "P5", "iteration": "it"}])
    assert ev["phase"] == "P5"


# --- セッション記録 -----------------------------------------------------------

def _line(**kw) -> str:
    return json.dumps(kw, ensure_ascii=False)


@pytest.fixture
def session(tmp_path: Path) -> Path:
    d = tmp_path / "proj"
    d.mkdir()
    sid = "aaaaaaaa-1111-2222-3333-444444444444"
    lines = [
        _line(type="user", timestamp="2026-09-19T04:09:25.000Z",
              message={"role": "user", "content": "<command-message>j-six:tdd-cycle</command-message> <command-name>/j-six:tdd-cycle</command-name> 秘密のプロンプト本文"}),
        _line(type="assistant", timestamp="2026-09-19T04:09:40.000Z",
              message={"role": "assistant", "content": [{"type": "tool_use", "name": "Bash", "input": {"command": "cat /Users/alice/x"}}]}),
        _line(type="assistant", timestamp="2026-09-19T04:09:41.000Z",
              message={"role": "assistant", "content": [{"type": "tool_use", "name": "Agent", "input": {}}]}),
        _line(type="user", timestamp="2026-09-19T04:10:00.000Z",
              message={"role": "user", "content": GATE_OUTPUT}),
        _line(type="user", timestamp="2026-09-19T04:10:30.000Z",
              message={"role": "user", "content": GATE_OUTPUT}),
        _line(type="user", timestamp="2026-09-19T04:11:00.000Z",
              message={"role": "user", "content": "Stop hook feedback: [prompt 型 Hook の指示文]"}),
        _line(type="attachment", timestamp="2026-09-19T04:26:43.000Z",
              attachment={"type": "hook_success", "hookEvent": "Stop",
                          "stdout": "  ✅ [G1] scope: 変更 3ファイルはすべて許可範囲内\n  ✅ [G2] tests: 全 81件 通過\n"}),
        _line(type="system", timestamp="2026-09-19T04:26:47.000Z"),
    ]
    (d / f"{sid}.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
    sub = d / sid / "subagents"
    sub.mkdir(parents=True)
    (sub / "agent-a1.meta.json").write_text(json.dumps({"agentType": "j-six:red-agent", "description": "Red phase for TASK-AW-002"}))
    (sub / "agent-a1.jsonl").write_text("\n".join([
        _line(type="user", timestamp="2026-09-19T04:13:34.000Z", message={"role": "user", "content": "本文"}),
        _line(type="assistant", timestamp="2026-09-19T04:18:05.000Z", message={"role": "assistant", "content": "本文"}),
    ]) + "\n", encoding="utf-8")
    return d / f"{sid}.jsonl"


def test_session_events(session):
    events = ee.session_events(session, {"phase": "P4", "task": "TASK-AW-002", "iteration": "it"})
    types = [e["type"] for e in events]
    assert types[0] == "ai.session.started"
    assert types[-1] == "ai.session.finished"
    start = events[0]
    assert start["payload"]["skill"] == "tdd-cycle"
    assert start["source"] == {"kind": "session", "ref": "aaaaaaaa"}
    finish = events[-1]
    assert finish["payload"]["tool_calls"] == {"Bash": 1, "Agent": 1}

    agents = [e for e in events if e["type"].startswith("ai.agent.")]
    assert [(e["type"], e["payload"]["agent"], e["payload"]["step"]) for e in agents] == [
        ("ai.agent.started", "red-agent", "red"),
        ("ai.agent.finished", "red-agent", "red"),
    ]
    assert agents[0]["timestamp"] == "2026-09-19T04:13:34Z"


def test_session_blocks_are_aggregated_when_identical(session):
    events = ee.session_events(session, {"phase": "P4", "task": None, "iteration": "it"})
    gates = [e for e in events if e["type"] == "gate.evaluated"]
    blocked = [e for e in gates if e["payload"]["outcome"] == "blocked"]
    assert len(blocked) == 1
    assert blocked[0]["payload"]["count"] == 2
    assert blocked[0]["payload"]["trigger"] == "stop_hook"
    assert blocked[0]["actor"] == {"kind": "system", "role": "automation"}
    passed = [e for e in gates if e["payload"]["outcome"] == "passed"]
    assert len(passed) == 1 and passed[0]["timestamp"] == "2026-09-19T04:26:43Z"
    prompt_blocks = [e for e in events if e["type"] == "hook.blocked"]
    assert len(prompt_blocks) == 1 and prompt_blocks[0]["payload"] == {"hook": "Stop", "kind": "prompt", "count": 1}


def test_aggregate_merges_interleaved_repeats():
    # prompt 型 Hook のブロックとゲート通過が交互に繰り返される場合（design-review の実行）
    def gate(ts, outcome):
        return {"timestamp": ts, "type": "gate.evaluated", "summary": "s",
                "payload": {"outcome": outcome, "results": [{"layer": "G1", "check": "scope", "status": "passed"}], "count": 1}}

    def block(ts):
        return {"timestamp": ts, "type": "hook.blocked", "summary": "b", "payload": {"kind": "prompt", "count": 1}}

    evs = [gate("t1", "passed"), block("t2"), gate("t3", "passed"), block("t4"), gate("t5", "passed")]
    out = ee._aggregate(evs)
    assert [(e["type"], e["payload"]["count"]) for e in out] == [("gate.evaluated", 3), ("hook.blocked", 2)]
    assert out[0]["payload"]["last_at"] == "t5"


def test_aggregate_keeps_different_results_apart():
    a = {"timestamp": "t1", "type": "gate.evaluated", "summary": "s",
         "payload": {"outcome": "blocked", "results": [{"layer": "G2", "check": "tests", "status": "failed"}], "count": 1}}
    b = {"timestamp": "t2", "type": "gate.evaluated", "summary": "s",
         "payload": {"outcome": "passed", "results": [{"layer": "G2", "check": "tests", "status": "passed"}], "count": 1}}
    c = {**a, "timestamp": "t3", "payload": {**a["payload"], "count": 1}}
    out = ee._aggregate([a, b, c])
    assert [e["timestamp"] for e in out] == ["t1", "t2", "t3"]


def test_session_events_carry_no_prompt_text_or_paths(session):
    events = ee.session_events(session, {"phase": "P4", "task": None, "iteration": "it"})
    dumped = json.dumps(events, ensure_ascii=False)
    assert "秘密のプロンプト本文" not in dumped
    assert "本文" not in dumped
    assert "/Users/" not in dumped
    assert ee.privacy_problems(events) == []


# --- レポート -----------------------------------------------------------------

def test_evidence_event(tmp_path):
    ev_dir = tmp_path / "reports" / "evidence" / "TASK-AW-002"
    ev_dir.mkdir(parents=True)
    (ev_dir / "evidence.json").write_text(json.dumps({
        "task_id": "TASK-AW-002", "ok": True,
        "env": {"generated_at": "2026-09-19T05:06:47.615265+00:00", "commit_sha": "b3f8b2bd6b82"},
        "gates": {
            "g1": {"status": "passed", "checks": {"build": {"ok": True, "skipped": False, "summary": "build: 成功"}}},
            "g2": {"status": "passed", "checks": {"mutation": {"ok": True, "skipped": False, "summary": "mutation: 92.4%"}}},
            "g3": {"status": "passed", "checks": {}},
        },
    }), encoding="utf-8")
    [ev] = ee.evidence_events(tmp_path, "TASK-AW-002", {"phase": "P4", "iteration": "it"})
    assert ev["type"] == "gate.evaluated"
    assert ev["timestamp"] == "2026-09-19T05:06:47Z"
    assert ev["payload"]["trigger"] == "evidence_pack"
    assert ev["payload"]["outcome"] == "passed"
    # 証跡の summary は先頭にチェック名が付いている。セッション由来の判定と形式をそろえて外す
    assert {"layer": "G2", "check": "mutation", "status": "passed", "summary": "92.4%"} in ev["payload"]["results"]
    assert ev["source"] == {"kind": "report", "ref": "reports/evidence/TASK-AW-002/evidence.json"}


# --- 合流 ---------------------------------------------------------------------

def test_assemble_orders_and_numbers_events():
    evs = [
        {"timestamp": "2026-09-19T05:00:00Z", "phase": "P4", "type": "commit.created", "provenance": "measured"},
        {"timestamp": "2026-06-15T13:03:59Z", "phase": "P2", "type": "gate.approved", "provenance": "reconstructed"},
        {"timestamp": "2026-06-15T13:03:59Z", "phase": "P2", "type": "commit.created", "provenance": "measured"},
        {"timestamp": "2026-06-15T13:03:59Z", "phase": "P1", "type": "gate.approved", "provenance": "reconstructed"},
    ]
    out = ee.assemble(evs)
    assert [(e["phase"], e["type"]) for e in out] == [
        ("P1", "gate.approved"), ("P2", "commit.created"), ("P2", "gate.approved"), ("P4", "commit.created"),
    ]
    assert [e["seq"] for e in out] == [1, 2, 3, 4]
    assert [e["id"] for e in out] == ["ev-0001", "ev-0002", "ev-0003", "ev-0004"]


def test_reconstructed_events_require_basis(tmp_path):
    p = tmp_path / "r.json"
    p.write_text(json.dumps([{"timestamp": "2026-06-15T13:03:59Z", "type": "gate.approved",
                              "actor": {"kind": "human"}, "summary": "承認"}]), encoding="utf-8")
    with pytest.raises(ValueError, match="basis"):
        ee.load_reconstructed(p)


def test_reconstructed_events_get_labels(tmp_path):
    p = tmp_path / "r.json"
    p.write_text(json.dumps([{"timestamp": "2026-06-15T13:03:59Z", "type": "gate.approved",
                              "actor": {"kind": "human"}, "summary": "承認", "basis": "承認欄が空欄"}]), encoding="utf-8")
    [ev] = ee.load_reconstructed(p)
    assert ev["provenance"] == "reconstructed"
    assert ev["source"] == {"kind": "reconstruction"}


# --- ゲート失敗の履歴（gate-history.jsonl） -----------------------------------

def test_gate_history_events(tmp_path):
    rep = tmp_path / "reports"
    rep.mkdir()
    lines = [
        {"at": "2026-09-19T10:00:00+00:00", "ok": False, "mode": "ci", "failed": ["g2.tests"], "summaries": {"tests": "x"}},
        {"at": "2026-09-21T00:58:40+00:00", "ok": False, "mode": "manual", "failed": ["g1.scope"],
         "summaries": {"scope": "scope: 許可範囲外の変更 1件 → tests/acceptance/test_x.py"}, "details": {"scope": ["/Users/a/b"]}},
        {"at": "2026-09-21T01:25:03+00:00", "ok": True, "mode": "manual", "failed": [], "summaries": {}},
    ]
    (rep / "gate-history.jsonl").write_text("\n".join(json.dumps(x, ensure_ascii=False) for x in lines) + "\n", encoding="utf-8")
    evs = ee.gate_history_events(tmp_path, {"since": "2026-09-21T00:00:00Z", "task": "TASK-MB-007",
                                            "phase": "P4", "iteration": "it"})
    assert [e["payload"]["outcome"] for e in evs] == ["failed", "passed"]
    first = evs[0]
    assert first["type"] == "gate.evaluated"
    assert first["timestamp"] == "2026-09-21T00:58:40Z"
    assert first["task"] == "TASK-MB-007"
    assert first["payload"]["trigger"] == "gate_run"
    assert first["payload"]["results"] == [
        {"layer": "G1", "check": "scope", "status": "failed", "summary": "許可範囲外の変更 1件 → tests/acceptance/test_x.py"}]
    assert first["source"] == {"kind": "report", "ref": "reports/gate-history.jsonl"}
    assert "/Users/" not in json.dumps(evs)  # details は持ち出さない


# --- 案件の一覧 ---------------------------------------------------------------

def test_projects_manifest_lists_existing_directories():
    manifest = ee.load_projects()
    ids = [p["id"] for p in manifest["projects"]]
    assert ids == ["approval-workflow", "monthly-billing", "order-integration"]
    for p in manifest["projects"]:
        assert (ee.DATA / "projects" / p["id"] / "reconstructed.json").exists()
    fictional = [p["id"] for p in manifest["projects"] if p.get("fictional")]
    assert fictional == ["order-integration"]
    assert manifest["program"]["fictional"] is True
