const csrf = document.querySelector('meta[name="csrf-token"]').content;
const byId = (id) => document.getElementById(id);
let listing;
let selectedId;
let detail;

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function append(parent, ...children) { children.forEach((child) => parent.append(child)); return parent; }
function showStatus(message, failed = false) { byId("status").textContent = message; byId("status").className = failed ? "blocked" : ""; }

async function api(path, body) {
  const response = await fetch(path, body ? { method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf }, body: JSON.stringify(body) } :
    { credentials: "same-origin" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function field(form, labelText, name, value = "", type = "text") {
  const label = element("label", labelText);
  const input = element("input");
  input.name = name; input.type = type; input.required = true; input.value = value;
  label.append(input); form.append(label);
  return input;
}

function select(form, labelText, name, options) {
  const label = element("label", labelText);
  const input = element("select"); input.name = name;
  for (const [value, text] of options) { const option = element("option", text); option.value = value; input.append(option); }
  label.append(input); form.append(label);
  return input;
}

function form(title, buttonText, submit) {
  const node = element("form");
  append(node, element("h3", title));
  const button = element("button", buttonText); button.type = "submit";
  node.addEventListener("submit", async (event) => {
    event.preventDefault(); button.disabled = true;
    try { await submit(new FormData(node)); await refresh(); showStatus("Git台帳に操作を記録しました"); }
    catch (error) { showStatus(error.message, true); }
    finally { button.disabled = false; }
  });
  return { node, button };
}

function common(project) {
  return { expectedHead: detail.head, generation: project.generation,
    targetCommit: project.targetCommit, policySha256: project.policySha256 };
}

async function command(suffix, payload) {
  const result = await api(`/api/projects/${selectedId}/${suffix}`, payload);
  detail = result;
}

function renderProjects() {
  const fixture = byId("fixture"); fixture.replaceChildren();
  for (const item of listing.fixtures) {
    const option = element("option", `${item.fixtureId} (${item.repoId})`);
    option.value = item.fixtureId; fixture.append(option);
  }
  const list = byId("projects"); list.replaceChildren();
  for (const project of listing.projects) {
    const button = element("button", `${project.fixtureId ?? "不明"} — ${project.phase ?? "保留"} ${project.phaseName}${project.completed ? " · 完了" : ""}`);
    button.type = "button";
    button.addEventListener("click", async () => {
      selectedId = project.projectId; await refresh();
    });
    append(list, append(element("li"), button));
  }
}

const activityState = { current: "現在有効", rejected: "却下", expired: "期限切れ",
  superseded: "再提出・再審査で失効", invalidated: "差戻しで失効",
  evidence_changed: "対象・方針変更で再確認待ち", historical: "過去の通過記録" };

function renderActivity(project) {
  const section = element("section");
  append(section, element("h3", "審査・判断・差戻し履歴"));
  if (!project.activity?.length) { append(section, element("p", "記録はありません。")); return section; }
  const list = element("ol");
  for (const item of project.activity) {
    const row = element("li");
    if (item.kind === "review") {
      append(row, element("strong", `${item.phase} 審査要求 · ${activityState[item.state] ?? item.state}`),
        element("p", `世代 ${item.generation} · 提出record ${item.artifactRecordIds.join(", ")}`, "code"),
        element("p", `対象commit ${item.targetCommits.join(", ") || "不明"} · 方針hash ${item.policySha256}`, "code"));
    } else if (item.kind === "decision") {
      append(row, element("strong", `${item.phase} ローカル模擬判断 · ${item.outcome === "approved" ? "承認" : "却下"} · ${activityState[item.state] ?? item.state}`),
        element("p", `役割 ${item.role} · 理由 ${item.reason}`),
        element("p", `審査record ${item.reviewRecordId} · 対象commit ${item.targetCommits.join(", ") || "不明"}`, "code"),
        element("p", `期限 ${item.expiresAt} · 世代 ${item.generation}`));
    } else if (item.kind === "reopen") {
      append(row, element("strong", `${item.from} → ${item.to} 差戻し`),
        element("p", `理由 ${item.reason} · 新世代 ${item.generation}`),
        element("p", `失効範囲 ${item.invalidatedPhases.join("、")}`));
    } else if (item.kind === "transition") {
      append(row, element("strong", `${item.from} → ${item.to} 遷移${item.state === "invalidated" ? " · 差戻しで失効" : ""}`),
        element("p", `対象commit ${item.targetCommit} · 世代 ${item.generation}`, "code"));
    } else if (item.kind === "run") {
      append(row, element("strong", `${item.phase} 合成 ${item.mode} run · G1/G2 ${item.passed}/${item.total} 通過`),
        element("p", `run ${item.runId} · 候補 ${item.candidateCommit}`, "code"));
    } else if (item.kind === "candidate") {
      append(row, element("strong", "P4 検査済み候補を受入れ"),
        element("p", `run ${item.runId} · 証跡commit ${item.targetCommit}`, "code"));
    } else if (item.kind === "check") {
      append(row, element("strong", `${item.phase} ${item.layerId}/${item.checkId}: ${item.result}`),
        element("p", `対象commit ${item.targetCommit}`, "code"));
    } else if (item.kind === "delivery") {
      append(row, element("strong", "P6 逆生成納品物"),
        element("p", `${item.path} · 対象commit ${item.targetCommit}`, "code"));
    } else if (item.kind === "complete") {
      append(row, element("strong", "ローカル合成 PoC 完了"),
        element("p", `対象commit ${item.targetCommit}`, "code"));
    }
    if (item.statusReasons?.length) append(row, element("p",
      `再確認理由: ${item.statusReasons.map((reason) => explainMissing(reason, project)).join("、")}`, "blocked"));
    append(row, element("small", `${item.recordedAt} · record ${item.recordId}`));
    append(list, row);
  }
  append(section, list);
  return section;
}

function renderMonitor() {
  const root = byId("monitor-list"); root.replaceChildren();
  if (!listing.projects.length) root.append(element("p", "案件はありません。"));
  for (const project of listing.projects) {
    const card = element("article");
    append(card, element("h3", `${project.fixtureId ?? "不明"} · ${project.phase ?? "保留"} ${project.phaseName}`),
      element("p", `案件ID: ${project.projectId}`, "code"),
      element("p", `世代 ${project.generation ?? "不明"} · ${project.completed ? "ローカルPoC完了" :
        project.canTransition || project.canComplete ? "進行可能" : "保留中"}`),
      element("p", "判断はローカル模擬。実顧客承認ではありません。"));
    if (!project.verified) append(card, element("p", project.holdReason, "warning"));
    const list = element("ul");
    for (const reason of project.missing) append(list, element("li", explainMissing(reason, project), "blocked"));
    append(card, list);
    if (project.activity?.length) {
      const history = element("details");
      append(history, element("summary", "判断・差戻し履歴を表示"), renderActivity(project));
      append(card, history);
    }
    append(root, card);
  }
}

function explainMissing(reason, project) {
  if (reason.startsWith("artifact:")) {
    const id = reason.split(":")[1];
    const name = project.requiredArtifacts.find((item) => item.id === id)?.name ?? id;
    return `提出が必要: ${name} (${id})`;
  }
  if (reason.startsWith("review:")) return `審査要求が必要 (${reason.slice(7)})`;
  if (reason.startsWith("decision:")) return `有効なローカル模擬判断が必要 (${reason.slice(9)})`;
  if (reason.startsWith("check:") && reason.endsWith(":unimplemented")) {
    return `検査が未実装: ${reason.slice(6, -14)}`;
  }
  if (reason.startsWith("passed-artifact:")) return `過去Phaseの成果物が現在版で変わりました (${reason.slice(16)})`;
  if (reason.startsWith("passed-check:")) return `通過済み検査の証跡が現在版で変わりました (${reason.slice(13)})`;
  if (reason === "task:candidate-not-accepted") return "検査済み候補の受入れが必要です";
  if (reason === "task:accepted-artifacts-mismatch") return "提出物が受入れ済み候補のmanifestと一致しません";
  if (reason === "target:verification-unknown") return "対象Git・工程照合が不明です。操作を保留しています。";
  if (reason === "target:commit-changed") return "対象Git commitが提出時から変わりました";
  if (reason === "target:baseline-unverified") return "基準commitの系列を照合できません";
  if (reason === "policy:changed") return "PoC方針版が変わりました";
  if (reason === "completion:target-changed-reopen-required") return "完了後に対象commitが変わりました。Phaseを差し戻して再確認してください";
  return reason;
}

function renderDetail() {
  const root = byId("detail"); root.replaceChildren();
  if (!detail) { root.append(element("p", "案件を選んでください。")); return; }
  const project = detail.project;
  if (!project.verified) {
    append(root, element("h3", "照合不能のため保留"), element("p", project.holdReason, "warning"));
    return;
  }
  append(root, element("h3", `${project.phase} ${project.phaseName}`),
    element("p", `次: ${project.nextPhase || "最終Phase"} · 世代 ${project.generation}`),
    element("p", `対象commit: ${project.targetCommit}`, "code"),
    element("p", `台帳ref: ${detail.head || "初期"}`, "code"),
    element("p", `方針hash: ${project.policySha256}`, "code"));
  const missingTitle = element("h3", project.completed ? "完了状態" : "ゲートの不足・保留理由");
  const missing = element("ul");
  if (project.missing.length) project.missing.forEach((reason) => append(missing, element("li", explainMissing(reason, project), "blocked")));
  else append(missing, element("li", project.completed ? "対象版は完了記録と一致しています。" : "現在の遷移条件が揃っています。"));
  append(root, missingTitle, missing);
  if (project.completed) append(root, element("p", "合成案件の一巡が完了しました。正式な顧客検収ではありません。"));
  if (!project.completed) {
  if (project.phase === "P4") {
    append(root, element("h3", "合成タスクの TDD 実行"),
      element("p", "固定された模擬作業者が候補を作り、Hub が G1/G2 を実行します。AI CLI はこの段階では起動しません。"));
    if (project.run?.runId) {
      const mode = project.run.mode === "fake-revalidation" ? "差し戻し再検証" : "初回 TDD";
      append(root, element("p", `run ${project.run.runId} · ${mode} · 候補 ${project.run.candidateCommit} · ${project.run.accepted ? "受入れ済み" : "受入れ待ち"}`, "code"));
      const checks = element("ul");
      for (const check of project.run.checks) append(checks, element("li", `${check.layer}/${check.id}: ${check.result}`));
      append(root, checks);
      if (project.run.preview) {
        const preview = element("details");
        append(preview, element("summary", "候補差分・TDD commit・検査証跡を確認"));
        append(preview, element("h4", "差分要約"), element("pre", project.run.preview.stat || "差分要約なし"),
          element("h4", "対象差分"), element("pre", project.run.preview.diff || "対象差分なし"),
          element("h4", "TDD commit"));
        const steps = element("ol");
        for (const step of project.run.preview.steps) append(steps,
          element("li", `${step.id}: ${step.commit}${step.test ? ` · ${step.test.status}` : ""}`, "code"));
        append(preview, steps, element("h4", "検査出力"));
        for (const check of project.run.preview.checks) {
          const evidence = element("details");
          append(evidence, element("summary", `${check.layer}/${check.id}: ${check.result}`),
            element("p", `${check.evidence?.tool ?? "不明"} ${check.evidence?.toolVersion ?? ""} · ${check.evidence?.command ?? ""}`, "code"),
            element("pre", check.evidence?.output || "出力なし"),
            element("p", `証跡SHA-256 ${check.evidenceSha256}`, "code"));
          append(preview, evidence);
        }
        append(root, preview);
      }
      const passed = project.run.checks.length === 15 && project.run.checks.every((check) => check.result === "passed");
      if (!project.run.accepted && passed) {
        const accept = form("検査済み候補を Git に受け入れる", "候補を受け入れる", async () =>
          command("accept-candidates", { ...common(project), runId: project.run.runId }));
        append(accept.node, accept.button); append(root, accept.node);
      } else if (!project.run.accepted && !passed) {
        append(root, element("p", "検査に失敗または未実行があります。候補は受け入れられません。P3以前へ差し戻し、定義を直して再実行してください。", "warning"));
      }
    } else {
      const run = form("固定合成タスクを開始", "TDD を実行", async () => command("fake-runs", common(project)));
      append(run.node, run.button); append(root, run.node);
    }
  }
  if (project.phase === "P5") {
    append(root, element("p", "結合シナリオを実行し、品質記録を対象 Git に保存します。"));
    const integration = form("合成結合・E2E 検査", "結合検査を実行", async () => command("integration", common(project)));
    append(integration.node, integration.button); append(root, integration.node);
  }
  if (project.phase === "P6") {
    append(root, element("p", "実装・証跡の対象版から逆生成文書と納品一覧を作ります。"));
    const delivery = form("合成納品物を準備", "納品物を生成", async () => command("deliverables", common(project)));
    append(delivery.node, delivery.button); append(root, delivery.node);
  }
  append(root, element("h3", "必要な成果物"));
  const artifacts = element("ul");
  for (const item of project.artifacts) {
    const name = project.requiredArtifacts.find((entry) => entry.id === item.artifactId)?.name ?? item.artifactId;
    append(artifacts, element("li", `${name} (${item.artifactId}): ${item.path || "未提出"}${item.verified ? " · Git照合済" : ""}`));
  }
  append(root, artifacts);
  const submit = form("Git成果物を提出", "提出", async (data) => command("artifacts", { ...common(project),
    artifactId: data.get("artifactId"), path: data.get("path"), sha256: data.get("sha256") }));
  const artifactChoice = select(submit.node, "成果物", "artifactId", project.requiredArtifacts.map((item) => [item.id, item.name]));
  const pathInput = field(submit.node, "対象commit内の相対path", "path");
  const hashInput = field(submit.node, "ファイル内容のSHA-256", "sha256");
  const updateSuggestion = () => {
    const suggestion = project.requiredArtifacts.find((item) => item.id === artifactChoice.value)?.suggested;
    pathInput.value = suggestion?.path ?? ""; hashInput.value = suggestion?.sha256 ?? "";
  };
  artifactChoice.addEventListener("change", updateSuggestion); updateSuggestion();
  append(submit.node, submit.button); append(root, submit.node);
  if (project.gate) {
    const review = form("提出版の審査要求", "審査を要求", async () => command("review-requests", common(project)));
    append(review.node, review.button); append(root, review.node);
    if (project.approverRoles.length) {
    const decision = form("ローカル模擬判断", "模擬判断を記録", async (data) => command("decisions", {
      ...common(project), role: data.get("role"), outcome: data.get("outcome"),
      reason: data.get("reason"), expiresAt: new Date(data.get("expiresAt")).toISOString(),
    }));
    select(decision.node, "模擬する役割", "role", project.approverRoles.map((role) => [role, role]));
    select(decision.node, "判断", "outcome", [["approved", "承認を模擬"], ["rejected", "差戻しを模擬"]]);
    field(decision.node, "理由", "reason");
    const expiry = field(decision.node, "有効期限", "expiresAt", "", "datetime-local");
    const tomorrow = new Date(Date.now() + 24 * 3600_000);
    expiry.value = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    append(decision.node, decision.button); append(root, decision.node);
    }
  }
  if (project.phase === "P6") {
    const complete = form("ローカル PoC 完了", "完了を記録", async () => command("complete", common(project)));
    complete.button.disabled = !project.canComplete;
    append(complete.node, complete.button); append(root, complete.node);
  } else {
    const transition = form("次のPhaseへ", "遷移", async () => command("transitions", common(project)));
    transition.button.disabled = !project.canTransition;
    append(transition.node, transition.button); append(root, transition.node);
  }
  }
  if (project.priorPhases.length) {
    const reopen = form("Phaseを差し戻す", "差戻しを記録", async (data) => {
      await command("reopen", { ...common(project), phase: data.get("phase"), reason: data.get("reason") });
    });
    select(reopen.node, "戻すPhase", "phase", project.priorPhases.map((item) => [item.id, `${item.id} ${item.name}`]));
    field(reopen.node, "差戻し理由", "reason");
    const confirmLabel = element("label", "後続Phaseの判断が失効することを確認しました");
    const confirmBox = element("input");
    confirmBox.type = "checkbox"; confirmBox.required = true;
    confirmLabel.prepend(confirmBox);
    append(reopen.node, confirmLabel);
    reopen.button.className = "danger";
    append(reopen.node, reopen.button); append(root, reopen.node);
  }
  if (project.activity?.length) {
    const history = element("details");
    append(history, element("summary", "審査・検査・判断の履歴を表示"), renderActivity(project));
    append(root, history);
  }
}

async function refresh() {
  try {
    listing = await api("/api/projects");
    const selected = listing.projects.find((project) => project.projectId === selectedId);
    detail = !selectedId ? null : selected?.verified ? await api(`/api/projects/${selectedId}`) :
      selected ? { head: listing.head, project: selected } : null;
    renderProjects(); renderMonitor(); renderDetail();
    showStatus("Git台帳と対象commitを再読込しました");
  } catch (error) { showStatus(error.message, true); }
}

byId("create").addEventListener("click", async () => {
  const fixtureId = byId("fixture").value;
  const fixture = listing.fixtures.find((item) => item.fixtureId === fixtureId);
  try {
    if (!fixture?.verified) throw new Error("fixtureのGit HEADを照合できません。案件作成を保留します");
    const result = await api("/api/projects", { fixtureId, expectedHead: listing.head,
      targetCommit: fixture.targetCommit, policySha256: listing.policySha256 });
    selectedId = result.project.projectId; await refresh();
  } catch (error) { showStatus(error.message, true); }
});
byId("refresh").addEventListener("click", refresh);
byId("show-workbench").addEventListener("click", () => {
  byId("workbench").hidden = false; byId("monitor").hidden = true;
});
byId("show-monitor").addEventListener("click", () => {
  byId("workbench").hidden = true; byId("monitor").hidden = false;
});
refresh();
