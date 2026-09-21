"""J-SIX の実行記録からリプレイ用イベント（data/events.jsonl）を作る。

方針は docs/adr/0001-replay-event-data.md を参照。要点:
- 記録から取れる出来事は provenance=measured、記録が無く組み立てたものは reconstructed（data/reconstructed.json）
- セッション記録から持ち出すのは、時刻・Skill 名・サブエージェントの種類・ツール呼び出しの件数・
  ゲート判定の行だけ。プロンプトや出力の本文は持ち出さない。ローカルのパスとメールアドレスは除去する
- 状態（Phase・タスクの状態）はイベントに持たせない。画面がプロセス定義から計算する

使い方（セッション記録は著者の手元にしか無いため、抽出は手元で実行する）:
    python3 tools/extract_events.py --jsix-repo ../j-six --sessions ~/.claude/projects/<作業ディレクトリ>
    python3 tools/extract_events.py ... --check   # 生成結果が data/events.jsonl と一致するか

PR のコミットは main に squash されているため、事前に取得しておく:
    git -C ../j-six fetch origin pull/5/head:refs/replay/pr-5

Python 3.9 以上の標準ライブラリだけで動く。
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# --- 持ち出す情報の除去 -------------------------------------------------------

_LOCAL_PATH = re.compile(
    r"(?:/Users/|/home/|/private/|[A-Za-z]:\\Users\\)[^\s\"'\]\)]*"
)
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def scrub(text: str) -> str:
    """ローカルの絶対パスとメールアドレスを伏せる。"""
    return _EMAIL.sub("<email>", _LOCAL_PATH.sub("<local>", text))


def privacy_problems(events: list[dict]) -> list[str]:
    """公開してはいけない文字列が残っていないか。残っていればその説明を返す。"""
    problems = []
    for i, ev in enumerate(events):
        dumped = json.dumps(ev, ensure_ascii=False)
        if _LOCAL_PATH.search(dumped):
            problems.append(f"{i}: ローカルのパスが残っている")
        if _EMAIL.search(dumped):
            problems.append(f"{i}: メールアドレスが残っている")
    return problems


# --- ゲート判定の行 -----------------------------------------------------------

_STATUS = {"✅": "passed", "❌": "failed", "⏭": "skipped"}
_CHECK_LINE = re.compile(r"(✅|❌|⏭)\s*\[(G\d)\]\s*([A-Za-z_]+):\s*(.*)$")
_LAYER_LINE = re.compile(r"^\s*(✅|❌|⏭)\s*(G\d):\s*(.*)$")


def parse_gate_lines(text: str) -> list[dict]:
    """J-SIX 品質ゲートのランナーの出力から、チェックごとの結果を取り出す。"""
    results = []
    for line in text.splitlines():
        m = _CHECK_LINE.search(line)
        if m:
            mark, layer, check, summary = m.groups()
            results.append({"layer": layer, "check": check, "status": _STATUS[mark],
                            "summary": scrub(summary.strip())})
            continue
        m = _LAYER_LINE.search(line)
        if m:
            mark, layer, summary = m.groups()
            results.append({"layer": layer, "check": None, "status": _STATUS[mark],
                            "summary": scrub(summary.strip())})
    return results


# --- 成果物と Phase の推定 ----------------------------------------------------

#: (パスの正規表現, 成果物 ID)。上から順に最初に一致したものを使う
_ARTIFACT_RULES = [
    (r"^CLAUDE\.md$", "constitution"),
    (r"^docs/requirement-spec\.md$", "requirement_spec"),
    (r"^docs/design-spec\.md$", "design_spec"),
    (r"^docs/adr/", "adr"),
    (r"^docs/tasks/", "task_definition"),
    (r"^tests/acceptance/", "holdout_tests"),
    (r"^tests/", "tests"),
    (r"^app/", "code"),
    (r"^reports/evidence/", "evidence_pack"),
    (r"^docs/quality-metrics", "quality_metrics"),
    (r"^docs/(deliverables|design-docs)/", "reverse_generated_docs"),
]

#: 成果物を作る Phase（J-SIX プロセス定義 process-v0.1.0 の phases.outputs）
_ARTIFACT_PHASE = {
    "constitution": 0, "requirement_spec": 1, "design_spec": 2, "adr": 2,
    "task_definition": 3, "holdout_tests": 4, "tests": 4, "code": 4, "evidence_pack": 4,
    "quality_metrics": 5, "reverse_generated_docs": 6,
}


def artifact_for_path(path: str) -> str | None:
    for pattern, artifact in _ARTIFACT_RULES:
        if re.search(pattern, path):
            return artifact
    return None


def phase_for_artifacts(artifacts: list[str]) -> str | None:
    """成果物のうち最も後の Phase。コミットは後工程の作業で前工程の成果物を直すことがあるため。"""
    phases = [_ARTIFACT_PHASE[a] for a in artifacts if a in _ARTIFACT_PHASE]
    return f"P{max(phases)}" if phases else None


_TASK = re.compile(r"\[(TASK-[A-Z]+-\d+)\]")
_STEPS = [(r"hold-out", "holdout"), (r"\bRed\b", "red"), (r"\bGreen\b", "green"), (r"^refactor", "refactor")]


def task_and_step(subject: str) -> tuple[str | None, str | None]:
    m = _TASK.search(subject)
    if not m:
        return None, None
    for pattern, step in _STEPS:
        if re.search(pattern, subject):
            return m.group(1), step
    return m.group(1), None


def _utc(ts: str) -> str:
    """ISO 8601 の時刻を秒単位の UTC（末尾 Z）にそろえる。"""
    dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- Git ----------------------------------------------------------------------

def _git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout


def commit_events(repo: Path, project_dir: str, commits: list[dict]) -> list[dict]:
    """指定したコミットを commit.created にする。作者のメールアドレスは持ち出さない。"""
    events = []
    prefix = project_dir.rstrip("/") + "/"
    for c in commits:
        sha = c["sha"]
        date, subject = _git(repo, "show", "-s", "--format=%aI%n%s", sha).splitlines()[:2]
        files = [f[len(prefix):] for f in _git(repo, "show", "--name-only", "--format=", sha).splitlines()
                 if f.startswith(prefix)]
        if c.get("split_by_phase"):
            groups: dict[str, list[str]] = {}
            for f in files:
                a = artifact_for_path(f)
                if a:
                    groups.setdefault(f"P{_ARTIFACT_PHASE[a]}", []).append(f)
            for phase in sorted(groups):
                events.append(_commit_event(sha, date, subject, groups[phase], c,
                                            phase=phase, split_of=sha[:7]))
        else:
            events.append(_commit_event(sha, date, subject, files, c, phase=c.get("phase")))
    return events


def _commit_event(sha: str, date: str, subject: str, files: list[str], c: dict,
                  phase: str | None, split_of: str | None = None) -> dict:
    artifacts = sorted({a for a in map(artifact_for_path, files) if a},
                       key=lambda a: (_ARTIFACT_PHASE[a], a))
    task, step = task_and_step(subject)
    # tdd-cycle だけにコミットを許可していた（J-SIX docs/plugin-field-test-01.md §1）。
    # タスク ID 付きのコミットは AI、それ以外は人間とする
    actor = {"kind": "ai", "role": "ai_agent"} if task else {"kind": "human"}
    payload = {"sha": sha[:7], "subject": scrub(subject), "files": len(files), "artifacts": artifacts}
    if step:
        payload["step"] = step
    if split_of:
        payload["split_of"] = split_of
    if c.get("note"):
        payload["note"] = c["note"]
    return {
        "timestamp": _utc(date),
        "iteration": c["iteration"],
        "phase": phase or phase_for_artifacts(artifacts),
        "task": task,
        "type": "commit.created",
        "actor": actor,
        "summary": scrub(c.get("summary") or subject),
        "payload": payload,
        "provenance": "measured",
        "source": {"kind": "git", "ref": sha[:7]},
    }


_APPROVAL_HEADING = re.compile(r"^#{2,3}\s*承認\s*$")


def parse_approval_table(text: str) -> list[dict]:
    """文書の「承認」節の表（役割 | 氏名 | 日付 | 承認）を読む。"""
    rows: list[dict] = []
    in_section = False
    for line in text.splitlines():
        if _APPROVAL_HEADING.match(line):
            in_section = True
            continue
        if not in_section:
            continue
        if line.startswith("#") or (rows and not line.startswith("|")):
            break
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) < 4 or cells[0] in ("役割", "") or set(cells[0]) <= {"-"}:
            continue
        rows.append({"role": cells[0], "name": cells[1], "date": cells[2], "approved": "✅" in cells[3]})
    return rows


def approval_events(repo: Path, project_dir: str, items: list[dict]) -> list[dict]:
    """コミット時点の文書の承認欄を gate.approved にする。誰が書き込んだかは recorded_by に残す。"""
    events = []
    for it in items:
        sha, rel = it["sha"], it["file"]
        text = _git(repo, "show", f"{sha}:{project_dir.rstrip('/')}/{rel}")
        date = _git(repo, "show", "-s", "--format=%aI", sha).strip()
        approvals = [a for a in parse_approval_table(text) if a["approved"]]
        if not approvals:
            continue
        by_ai = it["recorded_by"] == "ai"
        events.append({
            "timestamp": _utc(date),
            "iteration": it["iteration"],
            "phase": it["phase"],
            "task": None,
            "type": "gate.approved",
            "actor": {"kind": "ai", "role": "ai_agent"} if by_ai else {"kind": "human"},
            "summary": scrub(it.get("summary") or "承認欄に承認が記入された"),
            "payload": {"gate": it["gate"], "recorded_by": it["recorded_by"], "document": rel,
                        "approvals": approvals},
            "provenance": "measured",
            "source": {"kind": "git", "ref": f"{sha[:7]}:{rel}"},
        })
    return events


# --- セッション記録 -----------------------------------------------------------

_COMMAND = re.compile(r"<command-name>/(?:[\w-]+:)?([\w-]+)</command-name>")

#: サブエージェントの種類 → TDD の工程（ゲートの層）
_AGENT_STEP = {
    "holdout-test-writer": "holdout", "red-agent": "red", "green-agent": "green",
    "refactor-agent": "refactor", "scope-judge": "G3",
}


def _read_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def _text_of(entry: dict) -> str:
    msg = entry.get("message")
    if not isinstance(msg, dict):
        return ""
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(x.get("text", "") for x in content if isinstance(x, dict))
    return ""


def _base(ts: str, meta: dict, **kw) -> dict:
    ev = {
        "timestamp": _utc(ts),
        "iteration": meta["iteration"],
        "phase": meta.get("phase"),
        "task": meta.get("task"),
        "provenance": "measured",
    }
    ev.update(kw)
    return ev


def session_events(path: Path, meta: dict) -> list[dict]:
    """1本のセッション記録から、開始・終了・サブエージェント・ゲート判定のイベントを作る。"""
    entries = [e for e in _read_jsonl(path) if e.get("timestamp")]
    sid = path.stem[:8]
    source = {"kind": "session", "ref": sid}
    skill = meta.get("skill")
    for e in entries:
        m = _COMMAND.search(_text_of(e))
        if m:
            skill = m.group(1)
            break

    tools: Counter = Counter()
    gate_events: list[dict] = []
    for e in entries:
        msg = e.get("message")
        if isinstance(msg, dict) and isinstance(msg.get("content"), list):
            for x in msg["content"]:
                if isinstance(x, dict) and x.get("type") == "tool_use":
                    tools[x.get("name")] += 1
        text = _text_of(e)
        if e.get("type") == "user" and text.startswith("Stop hook feedback"):
            results = parse_gate_lines(text)
            if results:
                gate_events.append(_gate_event(e["timestamp"], meta, source, "blocked", results))
            else:
                # prompt 型 Hook のブロック。指示文の本文は持ち出さず、件数だけを残す
                gate_events.append(_base(e["timestamp"], meta, type="hook.blocked",
                                         actor={"kind": "system", "role": "automation"},
                                         summary="Stop hook（prompt 型）がターンの終了をブロックした",
                                         payload={"hook": "Stop", "kind": "prompt", "count": 1},
                                         source=source))
        att = e.get("attachment") or {}
        if att.get("type") == "hook_success" and att.get("hookEvent") == "Stop":
            results = parse_gate_lines(att.get("stdout") or "")
            if results:
                gate_events.append(_gate_event(e["timestamp"], meta, source, "passed", results))

    start = _base(entries[0]["timestamp"], meta, type="ai.session.started",
                  actor={"kind": "ai", "role": "ai_agent"},
                  summary=f"AI が {skill} を開始した",
                  payload={"skill": skill}, source=source)
    finish = _base(entries[-1]["timestamp"], meta, type="ai.session.finished",
                   actor={"kind": "ai", "role": "ai_agent"},
                   summary=f"AI が {skill} を終了した",
                   payload={"skill": skill, "tool_calls": dict(tools)}, source=source)
    agents = _subagent_events(path.parent / path.stem / "subagents", meta, source)
    middle = sorted(_aggregate(gate_events) + agents, key=lambda ev: ev["timestamp"])
    return [start] + middle + [finish]


def _gate_event(ts: str, meta: dict, source: dict, outcome: str, results: list[dict]) -> dict:
    failed = [r["check"] or r["layer"] for r in results if r["status"] == "failed"]
    summary = ("品質ゲートがターンの終了をブロックした（未達: " + ", ".join(failed) + "）"
               if outcome == "blocked" else "品質ゲートを通過した")
    return _base(ts, meta, type="gate.evaluated",
                 actor={"kind": "system", "role": "automation"}, summary=summary,
                 payload={"gate": "task_quality_gate", "trigger": "stop_hook", "outcome": outcome,
                          "results": results, "count": 1},
                 source=source)


def _aggregate(events: list[dict]) -> list[dict]:
    """同じ内容の繰り返しを1件にまとめ、回数と最後の時刻を残す。

    種類（ゲート判定 / prompt 型 Hook のブロック）ごとに見て、直前の同じ種類の出来事と内容が同じなら
    まとめる。別の種類が間に挟まっていてもまとめる（ブロックと通過が交互に繰り返される場合があるため）。
    同じ種類で内容の違う出来事が挟まったら、そこで区切る。
    """
    out: list[dict] = []
    last_of_type: dict[str, dict] = {}
    for ev in events:
        prev = last_of_type.get(ev["type"])
        key = _repeat_key(ev)
        if prev is not None and key is not None and _repeat_key(prev) == key:
            prev["payload"]["count"] += 1
            prev["payload"]["last_at"] = ev["timestamp"]
            continue
        out.append(ev)
        last_of_type[ev["type"]] = ev
    for ev in out:
        if ev["payload"].get("count", 1) > 1 and ev["type"] == "gate.evaluated":
            ev["summary"] += f"（同じ内容で {ev['payload']['count']} 回）"
        elif ev["payload"].get("count", 1) > 1:
            ev["summary"] += f"（{ev['payload']['count']} 回）"
    return out


def _repeat_key(ev: dict):
    p = ev["payload"]
    if ev["type"] == "hook.blocked":
        return ("prompt",)
    if ev["type"] == "gate.evaluated":
        return (p["outcome"],) + tuple((r["layer"], r["check"], r["status"]) for r in p["results"])
    return None


def _subagent_events(directory: Path, meta: dict, source: dict) -> list[dict]:
    events = []
    if not directory.is_dir():
        return events
    for meta_path in sorted(directory.glob("*.meta.json")):
        info = json.loads(meta_path.read_text(encoding="utf-8"))
        agent = str(info.get("agentType", "")).split(":")[-1]
        stamps = [e["timestamp"] for e in _read_jsonl(meta_path.with_name(meta_path.name.replace(".meta.json", ".jsonl")))
                  if e.get("timestamp")]
        if not stamps:
            continue
        step = _AGENT_STEP.get(agent)
        payload = {"agent": agent, "step": step}
        for kind, ts, verb in (("started", min(stamps), "開始"), ("finished", max(stamps), "終了")):
            events.append(_base(ts, meta, type=f"ai.agent.{kind}",
                                actor={"kind": "ai", "role": "ai_agent", "name": agent},
                                summary=f"サブエージェント {agent} が{verb}した",
                                payload=dict(payload), source=source))
    return events


# --- レポート -----------------------------------------------------------------

def evidence_events(project: Path, task: str, meta: dict) -> list[dict]:
    """証跡パッケージ（evidence.json）の生成を gate.evaluated にする。"""
    rel = f"reports/evidence/{task}/evidence.json"
    data = json.loads((project / rel).read_text(encoding="utf-8"))
    results = []
    for layer, g in sorted(data["gates"].items()):
        for check, r in (g.get("checks") or {}).items():
            status = "skipped" if r.get("skipped") else ("passed" if r.get("ok") else "failed")
            summary = r.get("summary", "")
            if summary.startswith(f"{check}: "):
                summary = summary[len(check) + 2:]
            results.append({"layer": layer.upper(), "check": check, "status": status,
                            "summary": scrub(summary)})
    outcome = "passed" if data.get("ok") else "failed"
    return [_base(data["env"]["generated_at"], {**meta, "task": task}, type="gate.evaluated",
                  actor={"kind": "system", "role": "automation"},
                  summary=f"証跡パッケージを生成した（G1〜G3 {'通過' if outcome == 'passed' else '未達'}）",
                  payload={"gate": "task_quality_gate", "trigger": "evidence_pack", "outcome": outcome,
                           "commit": data["env"].get("commit_sha", "")[:7], "results": results},
                  source={"kind": "report", "ref": rel})]


# --- 再構成イベント -----------------------------------------------------------

def load_reconstructed(path: Path) -> list[dict]:
    items = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for i, it in enumerate(items):
        if not it.get("basis"):
            raise ValueError(f"{path}: {i} 件目の再構成イベントに basis（根拠）がない")
        ev = dict(it)
        ev["provenance"] = "reconstructed"
        ev["source"] = {"kind": "reconstruction"}
        out.append(ev)
    return out


# --- 合流 ---------------------------------------------------------------------

#: 同じ時刻に並んだときの順序。登録・固定 → 作業 → 判定 → 承認
_TYPE_RANK = {
    "project.registered": 0, "process.pinned": 1, "constitution.pinned": 2,
    "deviation.opened": 3, "task.dispatched": 4,
    "ai.session.started": 5, "ai.agent.started": 5, "commit.created": 6,
    "ai.agent.finished": 7, "hook.blocked": 7, "gate.evaluated": 8, "ai.session.finished": 9,
    "gate.approved": 10, "deviation.closed": 11,
}

_KEY_ORDER = ["seq", "id", "timestamp", "iteration", "phase", "task", "type", "actor",
              "summary", "payload", "provenance", "source", "basis"]


def assemble(events: list[dict]) -> list[dict]:
    """時刻 → Phase → 種類の順に並べ、seq と id を振る。"""
    def key(pair):
        i, ev = pair
        phase = ev.get("phase")
        return (ev["timestamp"], int(phase[1:]) if phase else -1, _TYPE_RANK.get(ev["type"], 6), i)

    ordered = [ev for _, ev in sorted(enumerate(events), key=key)]
    out = []
    for n, ev in enumerate(ordered, start=1):
        ev = {**ev, "seq": n, "id": f"ev-{n:04d}"}
        out.append({k: ev[k] for k in _KEY_ORDER if k in ev})
    return out


# --- 実行 ---------------------------------------------------------------------

def build(jsix_repo: Path, sessions_dir: Path, sources: dict) -> list[dict]:
    project_dir = sources["project_dir"]
    events: list[dict] = []
    for group in sources["commits"]:
        events += commit_events(jsix_repo, project_dir, [{**c, "iteration": group["iteration"]}
                                                         for c in group["items"]])
    events += approval_events(jsix_repo, project_dir, sources.get("approvals", []))
    for s in sources["sessions"]:
        path = sessions_dir / f"{s['id']}.jsonl"
        events += session_events(path, s)
    for r in sources["evidence"]:
        events += evidence_events(jsix_repo / project_dir, r["task"], r)
    events += load_reconstructed(DATA / "reconstructed.json")
    return assemble(events)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--jsix-repo", type=Path, required=True)
    ap.add_argument("--sessions", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=DATA / "events.jsonl")
    ap.add_argument("--check", action="store_true", help="生成結果が --out と一致しなければ 1 で終了")
    args = ap.parse_args(argv)

    sources = json.loads((DATA / "sources.json").read_text(encoding="utf-8"))
    events = build(args.jsix_repo, args.sessions.expanduser(), sources)
    problems = privacy_problems(events)
    if problems:
        for p in problems:
            print(p, file=sys.stderr)
        return 1
    text = "".join(json.dumps(ev, ensure_ascii=False) + "\n" for ev in events)
    if args.check:
        same = args.out.exists() and args.out.read_text(encoding="utf-8") == text
        print("一致" if same else f"{args.out} と一致しない", file=sys.stderr)
        return 0 if same else 1
    args.out.write_text(text, encoding="utf-8")
    measured = sum(ev["provenance"] == "measured" for ev in events)
    print(f"{len(events)} 件（実測 {measured} / 再構成 {len(events) - measured}）→ {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
