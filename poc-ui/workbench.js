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
    try { await submit(new FormData(node)); await refresh(); showStatus(`${buttonText}を記録しました`); }
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
    const button = element("button", `${project.fixtureId} — ${project.phase} ${project.phaseName}`);
    button.type = "button";
    button.addEventListener("click", async () => {
      selectedId = project.projectId; await refresh();
    });
    append(list, append(element("li"), button));
  }
}

function renderMonitor() {
  const root = byId("monitor-list"); root.replaceChildren();
  if (!listing.projects.length) root.append(element("p", "案件はありません。"));
  for (const project of listing.projects) {
    const card = element("article");
    append(card, element("h3", `${project.fixtureId} · ${project.phase} ${project.phaseName}`),
      element("p", `案件ID: ${project.projectId}`, "code"),
      element("p", `世代 ${project.generation} · ${project.canTransition ? "次へ進行可能" : "保留中"}`),
      element("p", "判断はローカル模擬。実顧客承認ではありません。"));
    const list = element("ul");
    for (const reason of project.missing) append(list, element("li", reason, "blocked"));
    append(card, list); append(root, card);
  }
}

function renderDetail() {
  const root = byId("detail"); root.replaceChildren();
  if (!detail) { root.append(element("p", "案件を選んでください。")); return; }
  const project = detail.project;
  append(root, element("h3", `${project.phase} ${project.phaseName}`),
    element("p", `次: ${project.nextPhase || "最終Phase"} · 世代 ${project.generation}`),
    element("p", `対象commit: ${project.targetCommit}`, "code"),
    element("p", `台帳ref: ${detail.head || "初期"}`, "code"),
    element("p", `方針hash: ${project.policySha256}`, "code"));
  const missingTitle = element("h3", "ゲートの不足・保留理由");
  const missing = element("ul");
  if (project.missing.length) project.missing.forEach((reason) => append(missing, element("li", reason, "blocked")));
  else append(missing, element("li", "現在の遷移条件が揃っています。"));
  append(root, missingTitle, missing);
  const unavailable = ["P4", "P5", "P6"].includes(project.phase);
  if (unavailable) {
    append(root, element("p", "このPhaseのCLI・実検査・納品判定は後続段階で実装します。現在は操作できません。", "warning"));
  }
  if (!unavailable) {
  append(root, element("h3", "必要な成果物"));
  const artifacts = element("ul");
  for (const item of project.artifacts) {
    const name = project.requiredArtifacts.find((entry) => entry.id === item.artifactId)?.name ?? item.artifactId;
    append(artifacts, element("li", `${name} (${item.artifactId}): ${item.path || "未提出"}${item.verified ? " · Git照合済" : ""}`));
  }
  append(root, artifacts);
  const submit = form("Git成果物を提出", "提出", async (data) => command("artifacts", { ...common(project),
    artifactId: data.get("artifactId"), path: data.get("path"), sha256: data.get("sha256") }));
  select(submit.node, "成果物", "artifactId", project.requiredArtifacts.map((item) => [item.id, item.name]));
  field(submit.node, "対象commit内の相対path", "path");
  field(submit.node, "ファイル内容のSHA-256（shasum -a 256）", "sha256");
  append(submit.node, submit.button); append(root, submit.node);
  if (project.gate) {
    const review = form("提出版の審査要求", "審査を要求", async () => command("review-requests", common(project)));
    append(review.node, review.button); append(root, review.node);
    const decision = form("ローカル模擬判断", "模擬判断を記録", async (data) => command("decisions", {
      ...common(project), role: data.get("role"), outcome: data.get("outcome"),
      reason: data.get("reason"), expiresAt: new Date(data.get("expiresAt")).toISOString(),
    }));
    select(decision.node, "模擬する役割", "role", project.approverRoles.map((role) => [role, role]));
    select(decision.node, "判断", "outcome", [["approved", "承認を模擬"], ["rejected", "差戻しを模擬"]]);
    field(decision.node, "理由", "reason");
    const expiry = field(decision.node, "有効期限", "expiresAt", "", "datetime-local");
    expiry.value = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 16);
    append(decision.node, decision.button); append(root, decision.node);
  }
  const transition = form("次のPhaseへ", "遷移", async () => command("transitions", common(project)));
  transition.button.disabled = !project.canTransition;
  append(transition.node, transition.button); append(root, transition.node);
  }
  if (project.priorPhases.length) {
    const reopen = form("Phaseを差し戻す", "差戻しを記録", async (data) => {
      const phase = data.get("phase");
      if (!window.confirm(`${phase}へ戻し、後続の判断を失効させます。続けますか？`)) return;
      await command("reopen", { ...common(project), phase, reason: data.get("reason") });
    });
    select(reopen.node, "戻すPhase", "phase", project.priorPhases.map((item) => [item.id, `${item.id} ${item.name}`]));
    field(reopen.node, "差戻し理由", "reason");
    reopen.button.className = "danger";
    append(reopen.node, reopen.button); append(root, reopen.node);
  }
}

async function refresh() {
  try {
    listing = await api("/api/projects");
    detail = selectedId ? await api(`/api/projects/${selectedId}`) : null;
    renderProjects(); renderMonitor(); renderDetail();
    showStatus("Git台帳と対象commitを再読込しました");
  } catch (error) { showStatus(error.message, true); }
}

byId("create").addEventListener("click", async () => {
  const fixtureId = byId("fixture").value;
  const fixture = listing.fixtures.find((item) => item.fixtureId === fixtureId);
  try {
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
