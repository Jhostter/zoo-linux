"use strict";
/* Ant — shell, rutas, datos compartidos, Inicio y Lanzador. Las demás vistas están en views.js. */

const HYDROGEN = "gemini-4-hydrogen-low", ORCH = "gemini-pro-orchestrator-g1-pro";
const S = { home: null };

// ---------- datos compartidos ----------
const loadModels = async () => { const m = (await getc("/api/models", 60000)).data.models || []; S.models = m; return m; };
const modelLabel = (id) => (S.models || []).find((m) => m.id === id)?.name || id || "predeterminado";
async function loadRoles() { const d = (await getc("/api/roles", 3000)).data; S.rolesMeta = d; return d; }
const loadTeams = async () => (await getc("/api/teams", 3000)).data.teams || [];
const loadWs = async () => (await getc("/api/workspaces", 2500)).data.workspaces || [];
async function loadHome() { const r = await getc("/api/home", 1200); if (r.ok) S.home = r.data; return r.data; }
const hasModel = (models, id) => models.some((m) => m.id === id);
// workspaces utilizables: primero los que tienen git (se pueden aislar), conservando el orden de recientes
const usableWs = (wss) => wss.filter((w) => w.exists).sort((a, b) => Number(b.has_git) - Number(a.has_git));

function modelGroup(id) {
  if (id.includes("orchestrator")) return "Orchestrator (planifica y delega)";
  if (id.startsWith("gemini-4-hydrogen")) return "Gemini 4 Hydrogen";
  if (id.startsWith("gemini-4-argon")) return "Gemini 4 Argon";
  if (id.startsWith("gemini")) return "Gemini (otros)";
  if (id.startsWith("claude")) return "Claude";
  if (id.startsWith("gpt")) return "GPT-OSS";
  return "Otros";
}
function modelSelect(models, value, { first = "(el predeterminado)", exclude = [], fk } = {}, onchange) {
  const groups = {};
  models.filter((m) => !exclude.includes(m.id)).forEach((m) => (groups[modelGroup(m.id)] ||= []).push(m));
  const sel = h("select", { "data-fk": fk, onchange: (e) => onchange && onchange(e.target.value) },
    h("option", { value: "" }, first),
    Object.entries(groups).map(([g, ms]) => h("optgroup", { label: g }, ms.map((m) => h("option", { value: m.id }, m.name)))));
  sel.value = value || "";
  return sel;
}
const roleOptions = (roles, categories, { none = null } = {}) => [
  none ? h("option", { value: "" }, none) : null,
  categories.map((c) => { const rs = roles.filter((r) => r.category === c); return rs.length ? h("optgroup", { label: c }, rs.map((r) => h("option", { value: r.name }, `${r.icon} ${r.title}`))) : null; }),
];

// ---------- rutas ----------
const NAV = [
  { id: "home", href: "#/", icon: "🏠", label: "Inicio" },
  { id: "swarms", href: "#/swarms", icon: "🐜", label: "Enjambres", badge: "swarms" },
  { id: "launch", href: "#/launch", icon: "🚀", label: "Lanzador", badge: "running" },
  { id: "runs", href: "#/runs", icon: "📜", label: "Lanzamientos" },
  { id: "workspaces", href: "#/workspaces", icon: "📁", label: "Workspaces" },
  { id: "roles", href: "#/roles", icon: "🎭", label: "Roles y equipos" },
];
const ROUTES = [
  [/^\/?$/, "home", (c) => Home(c)],
  [/^\/swarms$/, "swarms", (c) => Swarms(c)],
  [/^\/swarms\/([\w~-]+)$/, "swarms", (c, m) => SwarmDetail(c, m[1])],
  [/^\/launch$/, "launch", (c) => Launch(c)],
  [/^\/runs$/, "runs", (c) => Runs(c)],
  [/^\/runs\/([\w-]+)$/, "runs", (c, m) => RunDetail(c, m[1])],
  [/^\/workspaces$/, "workspaces", (c) => Workspaces(c)],
  [/^\/roles$/, "roles", (c, m, q) => Roles(c, q.get("tab") === "teams" ? "teams" : "roles")],
];
let routeId = 0, cleanups = [];
function makeCtx() {
  cleanups.forEach((f) => f()); cleanups = [];
  const id = ++routeId;
  const ctx = {
    id, root: $("#main"), alive: () => ctx.id === routeId,
    every(fn, ms) { // ejecuta ya y cada ms; evita solapes y pausa con la pestaña oculta
      let busy = false;
      const run = async () => { if (busy || document.hidden || !ctx.alive()) return; busy = true; try { await fn(); } finally { busy = false; } };
      run(); const t = setInterval(run, ms); cleanups.push(() => clearInterval(t));
    },
  };
  return ctx;
}
function legacyHash(hash) { // enlaces de versiones anteriores
  let m;
  if ((m = hash.match(/^#swarm=([\w~-]+)$/))) return `#/swarms/${m[1]}`;
  if ((m = hash.match(/^#run=([\w-]+)$/))) return `#/runs/${m[1]}`;
  if ((m = hash.match(/^#tab=(\w+)$/))) return { swarms: "#/swarms", runs: "#/launch", workspaces: "#/workspaces", roles: "#/roles" }[m[1]] || "#/";
  return null;
}
let firstRoute = true;
async function route() {
  const lg = legacyHash(location.hash);
  if (lg) { location.replace(lg); return; }
  const [path, qs] = (location.hash.replace(/^#/, "") || "/").split("?");
  const q = new URLSearchParams(qs || "");
  let hit = null;
  for (const [re, nav, fn] of ROUTES) { const m = path.match(re); if (m) { hit = { nav, fn, m }; break; } }
  const ctx = makeCtx();
  $$("#nav a").forEach((a) => { if (a.dataset.id === (hit?.nav || "")) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (!hit) { put(ctx.root, h("div", { class: "empty" }, h("div", { class: "big" }, "🧭"), h("b", {}, "Página no encontrada"), h("a", { href: "#/" }, "Volver al inicio"))); return; }
  try { await hit.fn(ctx, hit.m, q); } catch (e) { console.error(e); put(ctx.root, h("div", { class: "banner bad" }, "Algo falló al mostrar esta pantalla: " + e.message)); }
  if (!firstRoute) { ctx.root.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
  firstRoute = false;
}
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

function buildShell() {
  put($("#nav"),
    NAV.map((n) => h("a", { href: n.href, dataset: { id: n.id } }, h("span", { class: "ic", "aria-hidden": "true" }, n.icon), h("span", { class: "lbl-t" }, n.label),
      n.badge ? h("span", { class: "count", id: "badge-" + n.badge, hidden: true }) : null)),
    h("hr"),
    h("a", { href: "/office", target: "_blank", rel: "noopener" }, h("span", { class: "ic", "aria-hidden": "true" }, "📺"), h("span", { class: "lbl-t" }, "Oficina (stream)")),
    h("a", { href: "/office?control=1", target: "_blank", rel: "noopener" }, h("span", { class: "ic", "aria-hidden": "true" }, "🎙️"), h("span", { class: "lbl-t" }, "Modo jefe")),
    h("a", { href: "#", role: "button", id: "office-style", onclick: (e) => { e.preventDefault(); officeStyleDialog(); } }, h("span", { class: "ic", "aria-hidden": "true" }, "🎨"), h("span", { class: "lbl-t" }, "Estilo de la oficina")));
  $("#theme").addEventListener("click", () => {
    const cur = store.get("theme", "auto"), next = { auto: "light", light: "dark", dark: "auto" }[cur];
    store.set("theme", next);
    if (next === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
    toast("Tema: " + { auto: "automático (según tu sistema)", light: "claro", dark: "oscuro" }[next]);
  });
  $("#help").addEventListener("click", shortcutsHelp);
}
function setBadge(id, n) { const b = $("#badge-" + id); if (!b) return; b.hidden = !n; b.textContent = n || ""; }
async function pollBadges() {
  if (document.hidden) return;
  const d = await loadHome();
  if (!d || d.error) return;
  setBadge("running", d.running.length); setBadge("swarms", d.active_swarms);
}
function shortcutsHelp() {
  const row = (k, t) => h("tr", {}, h("td", { style: { width: "90px" } }, h("kbd", {}, k)), h("td", {}, t));
  modal({ title: "Atajos de teclado", body: h("table", {},
    row("1 – 6", "Ir a Inicio, Enjambres, Lanzador, Lanzamientos, Workspaces, Roles"), row("/", "Buscar (donde haya buscador)"), row("Ctrl + Enter", "Lanzar desde el cuadro de tarea"),
    row("?", "Mostrar esta ayuda"), row("Esc", "Cerrar un diálogo")) });
}
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target, typing = t.matches?.("input,textarea,select,[contenteditable]");
  if (typing || document.querySelector("dialog[open]")) return;
  if (e.key >= "1" && e.key <= String(NAV.length)) location.hash = NAV[+e.key - 1].href;
  else if (e.key === "/") { const s = $("input[type=search]"); if (s) { e.preventDefault(); s.focus(); } }
  else if (e.key === "?") shortcutsHelp();
});

// ============================================================ PLAN AUTOMÁTICO (compartido)
const PLAN_STATUS_NOTE = "Estimación heurística hasta que Ant tenga historial propio: se calibra con el consumo real medido.";
function planView(p) {
  const chips = h("div", { class: "chips" },
    h("span", { class: "chip acc" }, `Esfuerzo ${p.effort_label} (${p.effort})`),
    h("span", { class: "chip" }, p.topology === "swarm" ? `🐜 Enjambre · ${p.roles.length} workers` : "👤 Un agente" + (p.role ? " · " + p.role : "")),
    h("span", { class: "chip" }, "Modelo: " + modelLabel(p.model) + (p.workers_model ? " · workers: " + modelLabel(p.workers_model) : "")),
    h("span", { class: "chip " + (p.heavy ? "warn" : "ok"), title: p.tokens.basis }, `≈ ${fmt.tok(p.tokens.estimate)} tokens`));
  return h("div", { class: "col", style: { gap: "10px" } }, chips,
    p.link_deps ? h("div", { class: "small" }, h("b", {}, "🔗 Dependencias: "), "se enlazan los node_modules de tu carpeta principal en la copia aislada (", (p.node_modules || []).slice(0, 3).join(", "), "). Son compartidos: el agente no debe instalar paquetes.") : null,
    p.perms === "dev" ? h("div", { class: "small" }, h("b", {}, "Permisos: "), "habituales + scripts del proyecto (", (p.project_cmds || []).slice(0, 3).join(", "), "). Sin ellos, un agente que quiera verificar abortaría la ejecución.") : null,
    p.roles.length && p.topology === "swarm" ? h("div", { class: "small" }, h("b", {}, "Equipo: "), p.roles.join(", "), " (máx. ", p.max_workers, " workers; sin monitor ni narrator)") : null,
    h("div", { class: "small mut" }, `Rango probable ${fmt.tok(p.tokens.low)}–${fmt.tok(p.tokens.high)} · se detendrá si supera ${fmt.tok(p.budget)} de presupuesto. `, p.tokens.basis),
    p.warnings.map((w) => h("div", { class: "banner warn" }, w)),
    p.alternatives.map((a) => h("div", { class: "small mut" }, h("b", {}, "Alternativa descartada — " + a.name + " (≈ " + fmt.tok(a.estimate) + "): "), a.why_not)),
    h("details", {}, h("summary", { class: "small b", style: { cursor: "pointer" } }, "¿Por qué este plan?"), h("ul", { class: "small", style: { margin: "6px 0 0", paddingLeft: "18px", display: "grid", gap: "4px" } }, p.reasons.map((r) => h("li", {}, r)))));
}
// vista previa con espera (debounce) y descarte de respuestas antiguas
function planPreview(box, getBody, onPlan) {
  let t = 0, seq = 0, last = "";
  const run = async () => {
    const body = getBody(); if (!body || !body.prompt || body.prompt.trim().length < 6) { last = ""; put(box, h("div", { class: "hint" }, "Escribe la tarea y Ant propondrá el plan (rol, modelo y presupuesto) sin gastar tokens.")); onPlan && onPlan(null); return; }
    const key = JSON.stringify(body); if (key === last) return; last = key; const my = ++seq;
    put(box, h("div", { class: "skel", style: { minHeight: "56px" } }));
    const r = await api("/api/plan", body); if (my !== seq) return;
    if (!r.ok) { put(box, h("div", { class: "banner bad" }, r.data.error || "No se pudo planificar")); onPlan && onPlan(null); return; }
    put(box, planView(r.data)); onPlan && onPlan(r.data);
  };
  return { update() { clearTimeout(t); t = setTimeout(run, 550); }, now: run };
}
async function confirmPlan(resp) {
  const p = resp.plan, dup = resp.needs === "duplicate";
  return confirmDialog({ title: dup ? "Tarea repetida" : "Plan costoso", ok: "Lanzar de todas formas",
    body: h("div", { class: "col" }, h("p", {}, dup ? "Ya ejecutaste esta misma tarea en este workspace hace poco. Revisa ese resultado antes de gastar tokens otra vez." : `Este plan consumirá unos ${fmt.tok(p.tokens.estimate)} tokens (hasta ${fmt.tok(p.tokens.high)}). Confirma que merece la pena.`), planView(p)) });
}
// lanzamiento automático con las confirmaciones que pida el servidor
async function launchAuto(body) {
  let r = await api("/api/run", { ...body, auto: true });
  while (!r.ok && r.status === 409 && r.data.needs) {
    if (!(await confirmPlan(r.data))) return null;
    r = await api("/api/run", { ...body, auto: true, [r.data.needs === "heavy" ? "confirm_heavy" : "confirm_duplicate"]: true });
  }
  return r;
}

// ============================================================ INICIO
function quickOptions(roles, categories, teams) {
  return [
    h("option", { value: "auto" }, "🧠 Automático — Ant elige rol, modelo y presupuesto"),
    h("option", { value: "" }, "Un agente general (sin rol)"),
    teams.length ? h("optgroup", { label: "Equipos — lanzan un enjambre" }, teams.map((t) => h("option", { value: "team:" + t.id }, `${t.icon} ${t.name}`))) : null,
    categories.map((c) => { const rs = roles.filter((r) => r.category === c); return rs.length ? h("optgroup", { label: "Rol — " + c }, rs.map((r) => h("option", { value: "role:" + r.name }, `${r.icon} ${r.title}`))) : null; }),
  ];
}
function payloadFromWho(who, ws, prompt, models, roles) {
  const base = { path: ws.path, prompt, isolation: ws.has_git ? "worktree" : "inherit", timeout_min: 30 };
  const hy = hasModel(models, HYDROGEN) ? HYDROGEN : "";
  if (who.startsWith("team:")) {
    return { ...base, swarm: true, team: who.slice(5), model: hasModel(models, ORCH) ? ORCH : "", workers_model: hy, mode: "accept-edits", allow_commands: true };
  }
  const role = who.startsWith("role:") ? roles.find((r) => r.name === who.slice(5)) : null;
  return { ...base, role: role?.name || "", model: hy, mode: role?.writes ? "accept-edits" : "plan", allow_commands: true };
}

async function Home(ctx) {
  document.title = "Inicio · Ant";
  put(ctx.root, h("div", { class: "grid g2" }, h("div", { class: "skel", style: { height: "200px" } }), h("div", { class: "skel", style: { height: "200px" } })));
  const [{ roles, categories }, teams, wss, models] = await Promise.all([loadRoles(), loadTeams(), loadWs(), loadModels()]);
  if (!ctx.alive()) return;
  const wsOk = usableWs(wss);
  const saved = store.get("quick2", { who: "auto", ws: "" });
  const task = h("textarea", { id: "q-task", placeholder: "Describe lo que quieres que hagan los agentes. Por ejemplo: «Revisa la seguridad del login y propón arreglos».", "aria-label": "Tarea", value: store.get("draft", "") });
  const who = h("select", { "aria-label": "Quién lo hace" }, quickOptions(roles, categories, teams));
  const wsel = h("select", { "aria-label": "Workspace" }, wsOk.map((w) => h("option", { value: w.path }, w.name + (w.has_git ? "" : " (sin git)"))));
  who.value = saved.who; if (wsOk.some((w) => w.path === saved.ws)) wsel.value = saved.ws;
  const hint = h("div", { class: "hint" }), planBox = h("div");
  const btn = h("button", { class: "btn pri lg", onclick: launch }, "🚀 Lanzar");
  const planner = planPreview(planBox, () => (who.value === "auto" && wsel.value ? { path: wsel.value, prompt: task.value } : null));
  const upd = () => {
    store.set("quick2", { who: who.value, ws: wsel.value }); store.set("draft", task.value); planner.update();
    const ws = wsOk.find((w) => w.path === wsel.value);
    const kind = who.value === "auto" ? "" : who.value.startsWith("team:") ? "Enjambre: un coordinador reparte el trabajo (consume más cuota). " : "";
    if (who.value !== "auto") put(planBox);
    put(hint, who.value === "auto" ? "Ant analiza la tarea y decide si basta un agente barato o hace falta un enjambre. " : "", kind, ws && !ws.has_git ? "Esta carpeta no es un repositorio git: el agente trabajará directamente en ella." : "Trabajará en una copia aislada (worktree): tu carpeta no se toca hasta que integres el resultado.");
    btn.disabled = !task.value.trim() || !ws;
  };
  async function launch() {
    const ws = wsOk.find((w) => w.path === wsel.value); if (!ws) return;
    btn.disabled = true; put(btn, "Lanzando…");
    const r = who.value === "auto" ? await launchAuto({ path: ws.path, prompt: task.value.trim() }) : await api("/api/run", payloadFromWho(who.value, ws, task.value.trim(), models, roles));
    if (r === null) { put(btn, "🚀 Lanzar"); upd(); return; } // el usuario canceló la confirmación
    if (!r.ok) { toast(r.data.error || "No se pudo lanzar", "bad"); put(btn, "🚀 Lanzar"); upd(); return; }
    store.set("draft", ""); toast("Lanzado", "ok"); go("#/runs/" + r.data.id);
  }
  [task, who, wsel].forEach((e) => e.addEventListener("input", upd));
  task.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !btn.disabled) launch(); });
  const moreOpts = h("a", { href: "#/launch", onclick: () => store.set("launch", { ...store.get("launch", {}), pilot: who.value === "auto" || who.value === "" ? "auto" : "manual", ws: wsel.value, kind: who.value.startsWith("team:") ? "swarm" : "single", team: who.value.startsWith("team:") ? who.value.slice(5) : "", role: who.value.startsWith("role:") ? who.value.slice(5) : "" }) }, "Más opciones →");

  const head = h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Inicio"), h("p", { class: "sub", id: "home-sub" }, " ")));
  const quota = h("div", { id: "quota-slot" });
  const kpis = h("div", { class: "grid", style: { gridTemplateColumns: "1fr 1fr" }, id: "kpis" });
  const live = h("div", { id: "live" }), recent = h("div", { id: "recent" }), swarms = h("div", { id: "hswarms" });
  put(ctx.root, head, quota,
    h("div", { class: "hero" },
      h("section", { class: "card", "aria-labelledby": "ql" }, h("h2", { id: "ql", style: { marginBottom: "12px" } }, "Lanzar un agente"),
        h("div", { class: "col" }, task,
          h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" } }, h("div", { class: "field" }, h("label", {}, "Quién"), who), h("div", { class: "field" }, h("label", {}, "Workspace"), wsel)),
          hint, planBox, h("div", { class: "row wrap" }, h("span", { class: "mut xs" }, h("kbd", {}, "Ctrl"), " + ", h("kbd", {}, "Enter"), " para lanzar"), h("span", { class: "sp" }), moreOpts, btn))),
      kpis),
    h("div", { class: "mt" }, live), h("div", { class: "mt" }, swarms), h("div", { class: "mt" }, recent));
  upd();

  let sig = "";
  const paint = (d) => {
    if (!ctx.alive() || !d || d.error) return;
    const s = JSON.stringify([d.running.map((r) => r.id), d.runs.map((r) => r.id + r.status), d.swarms.map((x) => x.id + x.updated), d.quota, d.done_today, d.failed_today, d.active_swarms, d.tokens_today]);
    if (s === sig) return; sig = s;
    put($("#home-sub"), d.running.length ? `${d.running.length} agente${d.running.length > 1 ? "s" : ""} trabajando ahora` : "Todo tranquilo. Lanza una tarea cuando quieras.");
    put(quota, d.quota ? h("div", { class: "banner warn mb" }, h("span", {}, "⚠"), h("div", {}, h("b", {}, "Cuota de Antigravity agotada"), h("div", { class: "small" }, "Los modelos Claude y GPT-OSS no responderán", d.quota.reset ? ` (se reinicia en ${d.quota.reset})` : "", ". Los modelos Gemini tienen cuota aparte: elige uno, por ejemplo Gemini 4 Hydrogen."))) : null);
    put(kpis,
      h("div", { class: "card kpi" + (d.running.length ? " hot" : "") }, h("b", {}, d.running.length), h("span", {}, "En marcha")),
      h("div", { class: "card kpi" + (d.active_swarms ? " hot" : "") }, h("b", {}, d.active_swarms), h("span", {}, "Enjambres activos")),
      h("div", { class: "card kpi" }, h("b", {}, d.done_today), h("span", {}, "Terminadas hoy")),
      h("div", { class: "card kpi" + (d.failed_today ? " bad" : "") }, h("b", {}, d.failed_today), h("span", {}, "Con problemas hoy")),
      h("div", { class: "card kpi", style: { gridColumn: "1 / -1" }, title: "Entrada + salida medidas de los transcripts de Antigravity (la caché se cuenta aparte)" }, h("b", {}, fmt.tok(d.tokens_today || 0)), h("span", {}, "tokens medidos hoy" + (d.budget_stops_today ? ` · ${d.budget_stops_today} corte${d.budget_stops_today > 1 ? "s" : ""} por presupuesto` : ""))));
    put(live, d.running.length ? [h("h2", { class: "mb" }, "En marcha ahora"), h("div", { class: "grid g2" }, d.running.map(runCard))] : null);
    put(swarms, d.swarms.length ? [h("div", { class: "row mb" }, h("h2", {}, "Enjambres"), h("span", { class: "sp" }), h("a", { href: "#/swarms", class: "small" }, "Ver todos →")), h("div", { class: "grid g2" }, d.swarms.slice(0, 4).map(swarmCard))] : null);
    put(recent, [h("div", { class: "row mb" }, h("h2", {}, "Ejecuciones recientes"), h("span", { class: "sp" }), h("a", { href: "#/runs", class: "small" }, "Ver todos los lanzamientos →")),
      d.runs.length ? h("div", { class: "card list", style: { padding: "6px 14px" } }, d.runs.map(runRow)) : firstRun(wsOk.length, roles.length)]);
  };
  ctx.every(async () => paint(await loadHome()), 2500);
}
const firstRun = (nws, nroles) => h("div", { class: "card" },
  h("h3", { style: { marginBottom: "10px" } }, "Empieza en tres pasos"),
  h("ol", { style: { margin: 0, paddingLeft: "20px", display: "grid", gap: "8px" } },
    h("li", {}, "Elige un ", h("a", { href: "#/workspaces" }, "workspace"), ` (hay ${nws} disponibles) e instala los roles si quieres que el coordinador los use.`),
    h("li", {}, "Escribe una tarea arriba y elige un rol o un equipo. Empieza por algo pequeño y de solo lectura."),
    h("li", {}, "Sigue la ejecución aquí y revisa el resultado antes de integrarlo en tu rama.")),
  h("p", { class: "small mut mt-s" }, `Hay ${nroles} roles y 8 equipos listos en `, h("a", { href: "#/roles" }, "Roles y equipos"), "."));

// ============================================================ LANZADOR
const DEF = { ws: "", kind: "single", role: "", team: "", model: "", wmodel: "", iso: "worktree", mode: "plan", tmo: 30, perms: "none", modeTouched: false, permsTouched: false, modelTouched: false, pilot: "auto", roles: [], budget: 0, effortOv: "", modelOv: "", budgetOv: 0 };
async function Launch(ctx) {
  document.title = "Lanzador · Ant";
  put(ctx.root, h("div", { class: "skel", style: { height: "260px" } }));
  const [{ roles, categories }, teams, wss, models, home] = await Promise.all([loadRoles(), loadTeams(), loadWs(), loadModels(), loadHome()]);
  if (!ctx.alive()) return;
  const wsOk = usableWs(wss);
  const F = { ...DEF, ...store.get("launch", {}) };
  if (!wsOk.some((w) => w.path === F.ws)) F.ws = wsOk[0]?.path || "";
  if (F.pilot !== "manual") return LaunchAuto(ctx, { wsOk, models });
  if (F.kind === "swarm" && !F.team && !(F.roles || []).length && teams[0]) F.team = teams[0].id;
  const save = () => store.set("launch", F);
  const wsOf = () => wsOk.find((w) => w.path === F.ws);
  const roleOf = () => roles.find((r) => r.name === F.role);
  const teamOf = () => teams.find((t) => t.id === F.team);
  const prompt = h("textarea", { id: "l-task", style: { minHeight: "130px" }, placeholder: "¿Qué quieres que hagan? Sé concreto: qué archivos, qué resultado esperas y cómo comprobarlo.", "aria-label": "Tarea", value: store.get("draft", "") });
  const secWho = h("div"), secWhere = h("div"), secAdv = h("div"), sumBox = h("div");
  const counter = h("span", { class: "hint" });

  // aplica los valores recomendados mientras el usuario no los haya tocado
  function smart() {
    if (F.kind === "swarm") {
      if (!F.modelTouched) F.model = hasModel(models, ORCH) ? ORCH : "";
      if (!F.wmodel && hasModel(models, HYDROGEN)) F.wmodel = HYDROGEN;
      if (!F.modeTouched) F.mode = "accept-edits";
      if (!F.permsTouched) F.perms = "safe";
    } else {
      if (!F.modelTouched) F.model = hasModel(models, HYDROGEN) ? HYDROGEN : "";
      if (!F.modeTouched) F.mode = roleOf()?.writes ? "accept-edits" : "plan";
      if (!F.permsTouched) F.perms = "safe"; // un permiso denegado aborta la ejecución y los tokens gastados se pierden
    }
    if (wsOf() && !wsOf().has_git) F.iso = "inherit";
  }
  // re-renderiza un contenedor conservando el foco por data-fk
  function re(box, fn) {
    const fk = document.activeElement?.dataset?.fk;
    put(box, fn());
    if (fk) box.querySelector(`[data-fk="${fk}"]`)?.focus();
  }
  const set = (k, v, touched) => { F[k] = v; if (touched) F[touched] = true; smart(); save(); renderAll(); };
  const seg = (items, cur, key, extra) => h("div", { class: "seg", role: "group" }, items.map(([v, label]) => h("button", { type: "button", "aria-pressed": String(cur === v), "data-fk": key + v, onclick: () => set(key, v, extra) }, label)));

  const renderWho = () => [
    h("div", { class: "step" }, h("span", { class: "n" }, "2"), h("div", { class: "body" }, h("h3", {}, "¿Quién lo hace?"),
      seg([["single", "Un agente"], ["swarm", "Un enjambre (equipo)"]], F.kind, "kind"),
      h("div", { class: "mt-s" }, F.kind === "single" ? [
        h("div", { class: "field" }, h("label", { for: "l-role" }, "Rol (opcional)"),
          h("select", { id: "l-role", "data-fk": "role", value: F.role, onchange: (e) => set("role", e.target.value) }, roleOptions(roles, categories, { none: "Sin rol: agente general" }))),
        roleOf() ? h("div", { class: "hint mt-s" }, roleOf().icon + " ", roleOf().summary, " ", h("a", { href: "#", onclick: (e) => { e.preventDefault(); showRole(roleOf()); } }, "Ver el brief")) : null,
      ] : [
        h("p", { class: "hint", style: { marginBottom: "12px" } }, "Un coordinador (Orchestrator) reparte el trabajo entre workers con los roles del equipo. Cada worker es un agente aparte: consume más cuota."),
        h("div", { class: "grid g3" }, (F.roles || []).length ? h("button", { type: "button", class: "team", "aria-pressed": String(!F.team), "data-fk": "team-custom", onclick: () => set("team", "") },
          h("span", { class: "ic", "aria-hidden": "true" }, "🧠"), h("span", {}, h("b", { style: { display: "block" } }, "Equipo a medida (plan de Ant)"), h("span", { class: "small mut" }, F.roles.join(", ")))) : null,
        teams.map((t) => h("button", { type: "button", class: "team", "aria-pressed": String(F.team === t.id), "data-fk": "team-" + t.id, onclick: () => { F.roles = []; set("team", t.id); } },
          h("span", { class: "ic", "aria-hidden": "true" }, t.icon), h("span", {}, h("b", { style: { display: "block" } }, t.name), h("span", { class: "small mut" }, t.summary))))),
        teamOf() ? h("div", { class: "card flat mt-s pad-s" },
          h("div", { class: "chips", style: { marginBottom: "8px" } }, teamOf().roles.map((n) => { const r = roles.find((x) => x.name === n); return h("span", { class: "chip", title: r?.summary }, `${r?.icon || "🤖"} ${r?.title || n}`); })),
          h("div", { class: "small" }, h("b", {}, "Orden de trabajo: "), teamOf().flow)) : null,
      ]))),
  ];
  const renderWhere = () => {
    const ws = wsOf(), nogit = ws && !ws.has_git;
    return h("div", { class: "step" }, h("span", { class: "n" }, "3"), h("div", { class: "body" }, h("h3", {}, "¿Dónde trabaja?"),
      h("div", { class: "field" }, h("label", { for: "l-ws" }, "Workspace"),
        h("select", { id: "l-ws", "data-fk": "ws", onchange: (e) => set("ws", e.target.value) }, wsOk.map((w) => h("option", { value: w.path, selected: w.path === F.ws }, w.name + (w.has_git ? "" : " (sin git)"))))),
      h("div", { class: "mt-s" }, h("div", { class: "lbl", style: { marginBottom: "5px" } }, "Aislamiento"),
        seg([["worktree", "Copia aislada (worktree) · recomendado"], ["inherit", "Directamente en la carpeta"]], F.iso, "iso"),
        h("div", { class: "hint mt-s" }, nogit ? "Esta carpeta no es un repositorio git, así que no se puede aislar: el agente editará los archivos directamente."
          : F.iso === "worktree" ? "Crea una rama propia (ant/…) en una carpeta aparte. Tu carpeta no se toca; el resultado lo integras tú con git merge."
            : "⚠ El agente modificará tus archivos directamente. Asegúrate de tener los cambios guardados en git."),
        ws?.has_git && !ws?.installed && F.kind === "single" ? h("div", { class: "hint mt-s" }, "💡 El rol viaja dentro de la tarea; no hace falta instalarlo en el proyecto.") : null)));
  };
  const renderAdv = () => h("details", { class: "step", style: { display: "block" }, open: store.get("advopen", false), ontoggle: (e) => store.set("advopen", e.target.open) },
    h("summary", { style: { cursor: "pointer", fontWeight: "700", marginBottom: "10px" } }, "⚙️ Opciones avanzadas ", h("span", { class: "mut small", style: { fontWeight: "400" } }, "(modelo, modo, permisos, tiempo)")),
    h("div", { class: "grid g3" },
      h("div", { class: "field" }, h("label", {}, F.kind === "swarm" ? "Modelo del coordinador" : "Modelo"), modelSelect(models, F.model, { fk: "model" }, (v) => set("model", v, "modelTouched"))),
      F.kind === "swarm" ? h("div", { class: "field" }, h("label", {}, "Modelo de los workers"), modelSelect(models, F.wmodel, { first: "(el del coordinador)", exclude: [ORCH], fk: "wmodel" }, (v) => set("wmodel", v))) : null,
      h("div", { class: "field" }, h("label", {}, "Modo del agente"),
        h("select", { "data-fk": "mode", value: F.mode, onchange: (e) => set("mode", e.target.value, "modeTouched") },
          [["plan", "plan · solo analiza y propone"], ["accept-edits", "accept-edits · puede editar archivos"], ["", "predeterminado de agy"]].map(([v, t]) => h("option", { value: v }, t)))),
      h("div", { class: "field" }, h("label", { for: "l-bud" }, "Presupuesto de tokens (0 = sin límite)"), h("input", { id: "l-bud", type: "number", min: 0, step: 10000, value: F.budget || 0, oninput: (e) => { F.budget = +e.target.value || 0; save(); } }),
        h("div", { class: "hint" }, "Ant detiene la ejecución si lo supera (con margen de un paso de agente).")),
      h("div", { class: "field" }, h("label", { for: "l-tmo" }, "Tiempo máximo (min)"), h("input", { id: "l-tmo", type: "number", min: 1, max: 120, value: F.tmo, oninput: (e) => { F.tmo = +e.target.value || 30; save(); renderSum(); } }))),
    h("div", { class: "mt" }, h("div", { class: "lbl", style: { marginBottom: "6px" } }, "Permisos de comandos"),
      h("div", { class: "col gap-s" },
        [["none", "Los habituales de Antigravity", "Si el agente pide algo más, la ejecución se aborta y los tokens gastados se pierden."],
          ["safe", "Comandos habituales permitidos", "git local, ls, cat, grep… (sin git push). Recomendado para enjambres."],
          ["dev", "Habituales + scripts del proyecto", "Añade npm/pnpm/yarn run, tests, tsc y eslint. Úsalo si el agente quiere verificar su trabajo (si no, un permiso denegado aborta la ejecución). Ojo: la copia aislada no trae node_modules ni .env."],
          ["all", "Aprobar todo sin preguntar ⚠", "--dangerously-skip-permissions: el agente puede ejecutar cualquier comando. Solo bajo tu responsabilidad."]]
          .map(([v, t, d]) => h("label", { class: "check" }, h("input", { type: "radio", name: "perms", "data-fk": "perms" + v, checked: F.perms === v, onchange: () => set("perms", v, "permsTouched") }), h("span", {}, h("b", {}, t), h("span", { class: "hint", style: { display: "block" } }, d)))),
        F.perms === "dev" ? h("label", { class: "check", style: { marginLeft: "26px" } }, h("input", { type: "checkbox", checked: F.linkDeps !== false, onchange: (e) => { F.linkDeps = e.target.checked; save(); } }),
          h("span", {}, h("b", {}, "Enlazar los node_modules de la carpeta principal"), h("span", { class: "hint", style: { display: "block" } }, "La copia aislada no trae dependencias; el enlace evita copiar gigas. Son compartidas: el agente tiene prohibido instalar paquetes y Ant avisa si se modifican."))) : null)));
  const renderSum = () => {
    const ws = wsOf(), m = (id) => models.find((x) => x.id === id)?.name || (id ? id : "predeterminado de agy");
    const warns = [];
    if (F.kind === "swarm") warns.push(["warn", "Un enjambre consume bastante cuota: cada worker es un agente independiente."]);
    if (F.perms === "all") warns.push(["bad", "Permisos sin límite: el agente podrá ejecutar comandos sin pedirte permiso."]);
    if (F.iso === "inherit" && ws?.has_git) warns.push(["warn", "Sin aislamiento: edita tu carpeta directamente."]);
    if (home?.quota && /^(claude|gpt)/.test(F.kind === "swarm" ? (F.wmodel || F.model) : F.model)) warns.push(["bad", "Tu cuota de Claude/GPT está agotada: elige un modelo Gemini."]);
    if (F.mode === "plan" && (F.kind === "swarm" || roleOf()?.writes)) warns.push(["warn", "El modo «plan» no permite editar archivos. Elige accept-edits si debe escribir."]);
    const bad = !prompt.value.trim() || !ws || (F.kind === "swarm" && !F.team && !(F.roles || []).length);
    put(sumBox, h("div", { class: "card sticky" },
      h("h2", {}, "Resumen"),
      h("dl", { class: "sum", style: { margin: "0 0 12px" } },
        h("dt", {}, "Qué se ejecuta"), h("dd", {}, F.kind === "swarm" ? `Enjambre · ${teamOf()?.name || ((F.roles || []).length ? "equipo a medida" : "(elige equipo)")}` : roleOf() ? `Un agente · ${roleOf().icon} ${roleOf().title}` : "Un agente general"),
        h("dt", {}, F.kind === "swarm" ? "Coordinador" : "Modelo"), h("dd", {}, m(F.model)),
        F.kind === "swarm" ? [h("dt", {}, "Workers"), h("dd", {}, F.wmodel ? m(F.wmodel) : "el mismo que el coordinador")] : null,
        h("dt", {}, "Dónde"), h("dd", {}, ws ? `${ws.name} · ${F.iso === "worktree" ? "copia aislada" : "directamente"}` : "—"),
        h("dt", {}, "Modo y permisos"), h("dd", {}, `${F.mode || "predeterminado"} · ${{ none: "permisos habituales", safe: "comandos habituales", dev: "habituales + scripts del proyecto", all: "TODOS los permisos" }[F.perms]}`),
        h("dt", {}, "Límite de tiempo"), h("dd", {}, F.tmo + " min")),
      warns.map(([k, t]) => h("div", { class: "banner " + k, style: { marginBottom: "8px" } }, t)),
      h("button", { class: "btn pri lg", style: { width: "100%" }, disabled: bad, onclick: submit }, "🚀 Lanzar"),
      bad ? h("div", { class: "hint mt-s" }, !prompt.value.trim() ? "Escribe la tarea para poder lanzar." : "Completa los pasos anteriores.") : null));
  };
  function renderAll() { re(secWho, renderWho); re(secWhere, renderWhere); re(secAdv, () => renderAdv()); renderSum(); }
  async function submit(e) {
    const b = e?.currentTarget; if (b) { b.disabled = true; put(b, "Lanzando…"); }
    const r = await api("/api/run", { path: F.ws, prompt: prompt.value.trim(), role: F.kind === "single" ? F.role : "", team: F.kind === "swarm" ? F.team : "", swarm: F.kind === "swarm",
      roles: F.kind === "swarm" && !F.team ? F.roles : undefined, token_budget: F.budget || undefined,
      model: F.model, workers_model: F.kind === "swarm" ? F.wmodel : "", mode: F.mode, isolation: F.iso, timeout_min: F.tmo, auto_approve: F.perms === "all", allow_commands: F.perms === "safe" || F.perms === "dev", allow_dev: F.perms === "dev", link_deps: F.perms === "dev" && F.linkDeps !== false });
    if (!r.ok) { toast(r.data.error || "No se pudo lanzar", "bad"); renderSum(); return; }
    store.set("draft", ""); toast(F.kind === "swarm" ? "Enjambre lanzado" : "Agente lanzado", "ok"); go("#/runs/" + r.data.id);
  }
  prompt.addEventListener("input", () => { store.set("draft", prompt.value); put(counter, prompt.value.length + " caracteres"); renderSum(); });
  prompt.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { const b = $(".sticky .btn.pri", sumBox); if (b && !b.disabled) b.click(); } });
  smart();
  put(counter, prompt.value.length + " caracteres");
  put(ctx.root,
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Lanzador · manual"), h("p", { class: "sub" }, "Eliges tú el rol, el equipo y el modelo.")), h("span", { class: "sp" }), h("a", { class: "btn", href: "#/launch", onclick: (e) => { e.preventDefault(); F.pilot = "auto"; save(); route(); } }, "🧠 Volver al modo automático")),
    h("div", { class: "launch-grid" },
      h("div", {},
        h("div", { class: "step" }, h("span", { class: "n" }, "1"), h("div", { class: "body" }, h("h3", {}, "¿Qué hay que hacer?"), prompt, h("div", { class: "row mt-s" }, counter, h("span", { class: "sp" }), h("span", { class: "mut xs" }, h("kbd", {}, "Ctrl"), " + ", h("kbd", {}, "Enter"), " lanza")))),
        secWho, secWhere, secAdv),
      sumBox));
  renderAll();
}

// ---------- Lanzador automático: Ant planifica antes de gastar ----------
async function LaunchAuto(ctx, { wsOk, models }) {
  const F = { ...DEF, ...store.get("launch", {}) };
  if (!wsOk.some((w) => w.path === F.ws)) F.ws = wsOk[0]?.path || "";
  const save = () => store.set("launch", F);
  let plan = null;
  const prompt = h("textarea", { id: "l-task", style: { minHeight: "130px" }, placeholder: "¿Qué quieres conseguir? Cuanto más concreto (archivos, resultado esperado, cómo comprobarlo), menos tokens gastará el agente explorando.", "aria-label": "Tarea", value: store.get("draft", "") });
  const planBox = h("div"), sumBox = h("div"), counter = h("span", { class: "hint" });
  const wsSel = h("select", { id: "l-ws", onchange: (e) => { F.ws = e.target.value; save(); pv.update(); } }, wsOk.map((w) => h("option", { value: w.path }, w.name + (w.has_git ? "" : " (sin git)"))));
  wsSel.value = F.ws;
  const body = () => (F.ws && prompt.value.trim() ? { path: F.ws, prompt: prompt.value, effort: F.effortOv || undefined, model: F.modelOv || undefined, budget: F.budgetOv || undefined } : null);
  const pv = planPreview(planBox, body, (p) => { plan = p; renderSum(); });
  const adv = h("details", { class: "step", style: { display: "block" }, open: store.get("advopen2", false), ontoggle: (e) => store.set("advopen2", e.target.open) },
    h("summary", { style: { cursor: "pointer", fontWeight: "700", marginBottom: "10px" } }, "⚙️ Corregir el plan ", h("span", { class: "mut small", style: { fontWeight: "400" } }, "(solo si Ant se equivoca)")),
    h("div", { class: "grid g3" },
      h("div", { class: "field" }, h("label", {}, "Esfuerzo"), h("select", { onchange: (e) => { F.effortOv = e.target.value; save(); pv.now(); } }, [["", "(lo decide Ant)"], ["XS", "XS · mínimo"], ["S", "S · pequeño"], ["M", "M · medio"], ["L", "L · grande"], ["XL", "XL · muy grande"]].map(([v, t]) => h("option", { value: v, selected: F.effortOv === v }, t)))),
      h("div", { class: "field" }, h("label", {}, "Modelo"), modelSelect(models, F.modelOv, { first: "(el que elija Ant)" }, (v) => { F.modelOv = v; save(); pv.now(); })),
      h("div", { class: "field" }, h("label", { for: "l-bud2" }, "Presupuesto de tokens"), h("input", { id: "l-bud2", type: "number", min: 0, step: 10000, placeholder: "automático", value: F.budgetOv || "", oninput: (e) => { F.budgetOv = +e.target.value || 0; save(); pv.update(); } }))),
    h("p", { class: "hint mt-s" }, "Corregir el esfuerzo cambia la topología, el modelo y la estimación. Todo lo que fijes aquí se respeta."));
  function renderSum() {
    const ws = wsOk.find((w) => w.path === F.ws), bad = !plan || !ws;
    put(sumBox, h("div", { class: "card sticky" }, h("h2", {}, "Resumen"),
      plan ? h("dl", { class: "sum", style: { margin: "0 0 12px" } },
        h("dt", {}, "Qué se ejecuta"), h("dd", {}, plan.topology === "swarm" ? `Enjambre de ${plan.roles.length} workers` : plan.role ? `Un agente · ${plan.role}` : "Un agente general"),
        h("dt", {}, "Modelo"), h("dd", {}, modelLabel(plan.model)),
        h("dt", {}, "Consumo estimado"), h("dd", {}, `≈ ${fmt.tok(plan.tokens.estimate)} tokens`),
        h("dt", {}, "Corte automático"), h("dd", {}, fmt.tok(plan.budget) + " tokens"),
        h("dt", {}, "Dónde"), h("dd", {}, ws ? `${ws.name} · ${plan.isolation === "worktree" ? "copia aislada" : "directamente"}` : "—"))
        : h("p", { class: "hint", style: { marginBottom: "12px" } }, "Escribe la tarea para ver el plan."),
      h("button", { class: "btn pri lg", style: { width: "100%" }, disabled: bad, onclick: submit }, plan?.heavy ? "🚀 Revisar y lanzar" : "🚀 Lanzar con este plan"),
      h("button", { class: "btn", style: { width: "100%", marginTop: "8px" }, disabled: !plan, onclick: toManual }, "Ajustar a mano con este plan")));
  }
  function toManual() {
    Object.assign(F, { pilot: "manual", kind: plan.topology, role: plan.role || "", roles: plan.topology === "swarm" ? plan.roles : [], team: "", model: plan.model, wmodel: plan.workers_model || "",
      mode: plan.mode, iso: plan.isolation, tmo: plan.timeout_min, perms: "safe", budget: plan.budget, modeTouched: true, permsTouched: true, modelTouched: true });
    store.set("draft", prompt.value); save(); route();
  }
  async function submit(e) {
    const b = e?.currentTarget; b.disabled = true; put(b, "Lanzando…");
    const r = await launchAuto({ path: F.ws, prompt: prompt.value.trim(), effort: F.effortOv || undefined, model: F.modelOv || undefined, budget: F.budgetOv || undefined });
    if (r === null) { renderSum(); return; }
    if (!r.ok) { toast(r.data.error || "No se pudo lanzar", "bad"); renderSum(); return; }
    store.set("draft", ""); toast(r.data.swarm ? "Enjambre lanzado" : "Agente lanzado", "ok"); go("#/runs/" + r.data.id);
  }
  prompt.addEventListener("input", () => { store.set("draft", prompt.value); put(counter, prompt.value.length + " caracteres"); pv.update(); });
  prompt.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { const b = $(".sticky .btn.pri", sumBox); if (b && !b.disabled) b.click(); } });
  put(counter, prompt.value.length + " caracteres");
  put(ctx.root,
    h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Lanzador · automático"), h("p", { class: "sub" }, "Ant analiza el esfuerzo y el objetivo, y elige el agente, el modelo y el presupuesto más baratos que cumplen. Ves el plan antes de gastar nada.")),
      h("span", { class: "sp" }), h("a", { class: "btn", href: "#/launch", onclick: (e) => { e.preventDefault(); F.pilot = "manual"; save(); route(); } }, "Modo manual")),
    h("div", { class: "launch-grid" },
      h("div", {},
        h("div", { class: "step" }, h("span", { class: "n" }, "1"), h("div", { class: "body" }, h("h3", {}, "¿Qué hay que conseguir?"), prompt, h("div", { class: "row mt-s" }, counter, h("span", { class: "sp" }), h("span", { class: "mut xs" }, h("kbd", {}, "Ctrl"), " + ", h("kbd", {}, "Enter"), " lanza")))),
        h("div", { class: "step" }, h("span", { class: "n" }, "2"), h("div", { class: "body" }, h("h3", {}, "¿Dónde?"), h("div", { class: "field" }, h("label", { for: "l-ws" }, "Workspace"), wsSel), h("div", { class: "hint mt-s" }, "El aislamiento (copia propia en git) lo decide el plan según el proyecto."))),
        h("div", { class: "step" }, h("span", { class: "n" }, "3"), h("div", { class: "body" }, h("h3", {}, "Plan de Ant"), planBox)),
        adv),
      sumBox));
  renderSum(); pv.now();
}

// ---------- arranque ----------
buildShell();
addEventListener("hashchange", route);
route();
pollBadges(); setInterval(pollBadges, 4000);
