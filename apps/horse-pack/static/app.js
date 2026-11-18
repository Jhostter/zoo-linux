if (window.top !== window) document.documentElement.classList.add("embedded");
const $ = s => document.querySelector(s);
const h = (t, a = {}, ...c) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...c.flat().filter(x => x != null && x !== false));
  return e;
};
const P = {
  installed: '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  upgrade: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  files: '<path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z"/><path d="M14 3v5h5"/>',
  refresh: '<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
  up: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  proc: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9zM9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/>',
};
const icon = n => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("class", "i"); s.innerHTML = P[n]; return s; };

const VIEWS = [
  ["installed", "Instalados", "installed"],
  ["search", "Buscar", "search"],
  ["upgradable", "Actualizaciones", "upgrade"],
  ["files", "Archivos", "files"],
  ["metrics", "Rendimiento", "pulse"],
  ["procs", "Procesos", "proc"],
];
const st = { src: "all", sources: null, runtimes: false, keyMap: new Map(), lastOk: false, group: "type", collapsed: new Set(["deps"]), gshown: {}, auto: true, sig: null, blockers: [], view: "installed", cache: {}, selected: new Set(), shown: 150, current: null, busy: false, scope: "user", file: null, token: 0 };
const LIMIT = 150;

/* pkexec sin agente de contraseñas: diálogo con el comando para pegar en una terminal */
function terminalDialog(cmd, msg) {
  return new Promise(res => {
    const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
    const d = el("dialog", "width:min(760px,92vw);border:1px solid var(--line,#999);border-radius:16px;background:var(--panel,#fff);color:var(--fg,#111);padding:20px 22px");
    const pre = el("pre", "background:var(--bg,#f4f4f4);border:1px solid var(--line,#ccc);border-radius:10px;padding:10px 12px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow:auto;user-select:all;margin:10px 0", cmd);
    const copy = el("button", "", "Copiar comando"); copy.className = "btn sm"; copy.type = "button";
    copy.onclick = async () => { try { await navigator.clipboard.writeText(cmd); copy.textContent = "Copiado ✓"; } catch { const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r); copy.textContent = "Selecciónalo y copia con Ctrl+C"; } };
    const term = el("button", "", "Abrir en terminal"); term.className = "btn p sm"; term.type = "button";
    term.onclick = async () => { try { const r = await fetch("/api/terminal", { method: "POST", headers: { "Content-Type": "application/json", "X-Gestor": "1" }, body: JSON.stringify({ cmd }) }); const j = await r.json().catch(() => ({})); term.textContent = r.ok ? "Terminal abierta ✓ (confirma allí)" : (j.error || "No se pudo abrir"); } catch { term.textContent = "No se pudo abrir"; } };
    const no = el("button", "", "Cancelar"); no.className = "btn ghost"; no.type = "button"; no.onclick = () => d.close("no");
    const ok = el("button", "", "Ya lo ejecuté"); ok.className = "btn p"; ok.type = "button"; ok.onclick = () => d.close("yes");
    const row = el("div", "display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:12px"); row.append(term, copy, no, ok);
    d.append(el("h3", "margin:0 0 8px", "Hace falta una terminal"), el("div", "color:var(--mut,#666)", msg), pre, el("div", "color:var(--mut,#666);font-size:12.5px", "Revisa el comando antes de ejecutarlo. Cuando termine, pulsa «Ya lo ejecuté»."), row);
    d.addEventListener("close", () => { const v = d.returnValue === "yes"; d.remove(); res(v); });
    document.body.append(d); d.showModal();
  });
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok && j.terminal_cmd) { const ok = await terminalDialog(j.terminal_cmd, j.error); if (ok) setTimeout(() => location.reload(), 500); const e = new Error(ok ? "Listo: actualizando…" : "Cancelado."); e.terminal = true; throw e; }
  if (!r.ok) { const e = new Error(j.error || "Error " + r.status); e.blocked = !!j.blocked; e.pid = j.pid; throw e; }
  return j;
}
const fmtKb = kb => kb >= 1048576 ? (kb / 1048576).toFixed(1) + " GB" : kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : kb + " KB";
const hue = s => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const avatar = n => h("div", { class: "av", style: `background:hsl(${hue(n)} 55% 46%)` }, n[0].toUpperCase());

function toast(msg, kind = "") {
  const t = h("div", { class: "toast " + kind }, msg);
  $("#toasts").append(t); setTimeout(() => t.remove(), 4500);
}
function confirmBox(title, text, ok = "Aceptar", extra = "") {
  $("#dtitle").textContent = title; $("#dtext").textContent = text; $("#dok").textContent = ok;
  $("#dextra").hidden = !extra; $("#dextra").textContent = extra;
  const d = $("#dlg"); d.returnValue = ""; d.showModal();
  return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "yes" ? true : d.returnValue === "extra" ? "extra" : false), { once: true }));
}

/* ---------- navegación ---------- */
function drawNav() {
  const nav = $("#nav"); nav.replaceChildren();
  for (const [id, label, ic] of VIEWS) {
    const b = h("button", { class: id === st.view ? "on" : "", onclick: () => setView(id) }, icon(ic), h("span", { class: "l" }, label));
    if (id === "upgradable" && st.cache.up != null && st.cache.up > 0) b.append(h("span", { class: "badge" }, st.cache.up));
    else if (id === "procs" && st.blockers.length) b.append(h("span", { class: "badge", style: "background:var(--bad);color:#fff" }, st.blockers.length));
    else if (id === "installed" && st.cache.installed) b.append(h("span", { class: "cnt" }, st.cache.installed.length));
    nav.append(b);
  }
}
function drawTools() {
  const t = $("#tools"); t.replaceChildren();
  const add = (ic, label, fn) => t.append(h("button", { onclick: fn }, icon(ic), h("span", {}, label)));
  add("refresh", "Actualizar índices", () => run("/api/run", { action: "update" }, "apt update"));
  add("upgrade", "Actualizar todo (apt)", async () => (await confirmBox("Actualizar todo", "Se actualizarán todos los paquetes apt con novedades.", "Actualizar")) && run("/api/run", { action: "upgrade-all" }, "Actualizar todo"));
  add("trash", "Limpiar huérfanos", async () => (await confirmBox("Limpiar huérfanos", "Se eliminarán los paquetes que ya nadie necesita (autoremove).", "Limpiar")) && run("/api/run", { action: "autoremove" }, "Autoremove"));
  if (fpOk()) {
    add("upgrade", "Actualizar Flatpak", updateAllFlatpak);
    add("trash", "Quitar runtimes sin uso", async () => { if (await confirmBox("Quitar runtimes sin uso", "Se eliminarán los runtimes de Flatpak que ninguna aplicación necesita ya. Para los del sistema te pedirá tu contraseña.", "Quitar")) runChain(["system", "user"].map(scope => ["/api/src/run", { source: "flatpak", action: "unused", scope }, `Runtimes sin uso (${scope === "system" ? "sistema" : "usuario"})`])); });
  }
}

function setView(v) {
  st.view = v; st.selected.clear(); st.shown = LIMIT; closeDrawer();
  try { location.hash = v; } catch {}
  $("#sort").hidden = v !== "installed"; $("#group").hidden = v !== "installed";
  $("#q").placeholder = v === "search" ? "Buscar en apt, Flatpak y Snap…" : v === "installed" ? "Filtrar instalados…" : "Filtrar…";
  $("#srcseg").hidden = !["installed", "search", "upgradable"].includes(v); drawSrc();
  clearInterval(st.mTimer); st.mTimer = null;
  $("#inst").hidden = v !== "files"; document.querySelector(".search").style.visibility = ["files", "procs", "metrics"].includes(v) ? "hidden" : "";
  drawNav(); load();
}

/* ---------- datos ---------- */
async function getItems() {
  const q = $("#q").value.trim().toLowerCase(), enc = encodeURIComponent(q);
  const tag = (arr, src) => arr.map(x => ({ ...x, src }));
  const rt = i => st.runtimes || i.kind !== "runtime";
  const hit = i => !q || i.name.toLowerCase().includes(q) || (i.title || "").toLowerCase().includes(q) || (i.desc || "").toLowerCase().includes(q) || (i.app && i.app.name.toLowerCase().includes(q));
  const parts = []; let items;
  if (st.view === "installed") {
    if (wants("apt")) parts.push(st.cache.installed ||= tag(await api("/api/installed"), "apt"));
    if (wants("flatpak") && fpOk()) parts.push(st.cache.fpInstalled ||= await api("/api/fp/installed"));
    if (wants("snap") && snapOk()) parts.push(st.cache.snapInstalled ||= await api("/api/snap/installed"));
    items = parts.flat().filter(i => rt(i) && hit(i));
    items.sort($("#sort").value === "size" ? (a, b) => (b.size_kb || 0) - (a.size_kb || 0) : (a, b) => title(a).localeCompare(title(b)));
  } else if (st.view === "upgradable") {
    if (wants("apt")) parts.push(st.cache.upgradable ||= tag(await api("/api/upgradable"), "apt"));
    if (wants("flatpak") && fpOk()) parts.push(st.cache.fpUpdates ||= await api("/api/fp/updates"));
    if (wants("snap") && snapOk()) parts.push(st.cache.snapUpdates ||= await api("/api/snap/updates"));
    st.cache.up = badgeCount();
    items = parts.flat().filter(i => rt(i) && hit(i));
  } else if (st.view === "search") {
    if (!q) return null;
    if (wants("flatpak") && fpOk()) parts.push(api("/api/fp/search?q=" + enc).catch(() => []));
    if (wants("snap") && snapOk()) parts.push(api("/api/snap/search?q=" + enc).catch(() => []));
    if (wants("apt")) parts.push(api("/api/search?q=" + enc).then(a => tag(a, "apt")));
    items = (await Promise.all(parts)).flat();
  }
  return items;
}

async function load() {
  const my = ++st.token, list = $("#list");
  if (st.view === "files") return loadFiles(my);
  if (st.view === "procs") return loadProcs(my);
  if (st.view === "metrics") return loadMetrics();
  $("#msg").textContent = "";
  if (st.src === "snap" && st.sources && !snapOk() && ["installed", "search", "upgradable"].includes(st.view)) return snapMissing();
  if (!(st.view === "search" && !$("#q").value.trim())) { list.replaceChildren(...Array.from({ length: 8 }, () => h("div", { class: "sk" }))); }
  try {
    const items = await getItems();
    if (my !== st.token) return;
    drawNav();
    if (items === null) return empty("🔎", "Busca un paquete", "Escribe el nombre o una palabra de su descripción.");
    const nHeld = st.view === "upgradable" ? items.filter(i => i.held).length : 0;
    $("#msg").textContent = `${items.length} paquete${items.length === 1 ? "" : "s"}` + (nHeld ? ` · ${nHeld} retenidos por apt (no se pueden actualizar sin cambios mayores)` : "") + (st.view === "search" && items.length >= 300 ? " (primeros 300)" : "");
    if (!items.length) return empty("🐴", st.view === "upgradable" ? "Todo al día" : "Sin resultados", st.view === "upgradable" ? "No hay actualizaciones pendientes." : "Prueba con otro término.");
    renderList(items); if (st.view === "upgradable") updateButtons(items);
  } catch (e) { if (my === st.token) empty("⚠️", "No se pudo cargar", e.message); }
}
function empty(big, title, sub) {
  $("#msg").textContent = "";
  $("#list").replaceChildren(h("div", { class: "empty" }, h("div", { class: "big" }, big), h("b", {}, title), h("div", {}, sub)));
}

const GROUP_LIMIT = 80;
const TYPE_GROUPS = [["apps", "🖥️ Aplicaciones"], ["manual", "🛠️ Instalados por ti"], ["deps", "📚 Bibliotecas y dependencias"]];
const title = p => (p.app && p.app.name) || p.title || p.name;
const keyOf = p => (p.src && p.src !== "apt") ? p.src + ":" + p.name : p.name;

function mkRow(p) {
  const k = keyOf(p), sel = st.selected.has(k); st.keyMap.set(k, p);
  const av = p.app && p.app.icon && /^[\w.+-]+$/.test(p.app.icon)
    ? h("img", { class: "av", src: "/api/icon?name=" + encodeURIComponent(p.app.icon), alt: "", loading: "lazy", onerror: e => e.target.replaceWith(avatar(title(p))) })
    : avatar(title(p));
  const srcTag = p.src && p.src !== "apt" ? h("span", { class: "tag src-" + p.src }, SRC_LABEL[p.src]) : null;
  const row = h("div", { class: "row" + (sel ? " sel" : "") + (st.current === k ? " active" : ""), onclick: () => openDrawer(p) },
    h("input", { type: "checkbox", checked: sel, onclick: e => e.stopPropagation(), onchange: e => { e.target.checked ? st.selected.add(k) : st.selected.delete(k); row.classList.toggle("sel", e.target.checked); drawBulk(); } }),
    av,
    h("div", { class: "t" },
      h("div", { class: "n" }, title(p), p.app && h("span", { class: "pkg" }, p.name), srcTag, p.src === "flatpak" && p.scope ? h("span", { class: "tag" }, p.scope === "system" ? "sistema" : "usuario") : null, p.kind === "runtime" ? h("span", { class: "tag" }, "runtime") : null,
        st.view === "search" && p.installed && h("span", { class: "tag" }, "instalado"), st.view === "upgradable" && (p.held ? h("span", { class: "tag", style: "background:var(--hover);color:var(--mut)", title: "apt la retiene: necesita instalar o quitar otros paquetes" }, "retenido") : h("span", { class: "tag up" }, "nueva versión"))),
      h("div", { class: "d" }, p.desc)),
    h("div", { class: "meta" }, st.view === "installed" ? [h("div", {}, (p.version || "").slice(0, 22)), h("div", {}, p.size_kb ? fmtKb(p.size_kb) : "")] : ""));
  return row;
}

function groupsOf(items) {
  if (st.view !== "installed") {
    if (st.src !== "all") return null;
    const srcs = new Set(items.map(i => i.src || "apt")); if (srcs.size < 2) return null;
    const names = { flatpak: "📦 Flatpak", snap: "🧩 Snap", apt: "🖥️ apt · paquetes del sistema" };
    return ["flatpak", "snap", "apt"].filter(s => srcs.has(s)).map(s => ({ key: "src-" + s, label: names[s], items: items.filter(i => (i.src || "apt") === s) }));
  }
  if (st.group === "none") return null;
  const m = new Map();
  const add = (k, label, p) => { if (!m.has(k)) m.set(k, { key: k, label, items: [] }); m.get(k).items.push(p); };
  if (st.group === "type") {
    for (const [k, l] of TYPE_GROUPS) m.set(k, { key: k, label: l, items: [] });
    for (const p of items) m.get(p.app ? "apps" : p.manual ? "manual" : "deps").items.push(p);
    return [...m.values()].filter(g => g.items.length);
  }
  for (const p of items) add(p.section, p.section.charAt(0).toUpperCase() + p.section.slice(1), p);
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function renderList(items) {
  const list = $("#list"); list.replaceChildren();
  const all = h("label", { class: "msg", style: "display:flex;gap:8px;align-items:center;cursor:pointer" },
    h("input", { type: "checkbox", onchange: e => { items.filter(i => !i.held).forEach(i => e.target.checked ? st.selected.add(keyOf(i)) : st.selected.delete(keyOf(i))); renderList(items); } }),
    "Seleccionar todos");
  all.firstChild.checked = items.some(i => !i.held) && items.filter(i => !i.held).every(i => st.selected.has(keyOf(i)));
  list.append(all);
  const groups = groupsOf(items);
  if (!groups) {
    for (const p of items.slice(0, st.shown)) list.append(mkRow(p));
    if (items.length > st.shown) list.append(h("button", { class: "btn more", onclick: () => { st.shown += LIMIT; renderList(items); } }, `Mostrar más (${items.length - st.shown} restantes)`));
  } else {
    const filtering = !!$("#q").value.trim();
    for (const g of groups) {
      const open = filtering || !st.collapsed.has(g.key);
      const kb = g.items.reduce((a, p) => a + (p.size_kb || 0), 0);
      list.append(h("div", { class: "ghead" + (open ? " open" : ""), onclick: () => { st.collapsed.has(g.key) ? st.collapsed.delete(g.key) : st.collapsed.add(g.key); renderList(items); } },
        h("span", { class: "chev" }, "▸"), h("b", {}, g.label), h("span", { class: "mut" }, kb ? `${g.items.length} · ${fmtKb(kb)}` : `${g.items.length}`)));
      if (!open) continue;
      const lim = st.gshown[g.key] || GROUP_LIMIT;
      for (const p of g.items.slice(0, lim)) list.append(mkRow(p));
      if (g.items.length > lim) list.append(h("button", { class: "btn more", onclick: () => { st.gshown[g.key] = lim + GROUP_LIMIT; renderList(items); } }, `Mostrar más de ${g.label} (${g.items.length - lim} restantes)`));
    }
  }
  drawBulk();
}

/* ---------- acciones en bloque ---------- */
function drawBulk() {
  const bar = $("#bulk"), n = st.selected.size;
  bar.hidden = !n || st.view === "files"; if (bar.hidden) return;
  const sel = [...st.selected].map(k => st.keyMap.get(k)).filter(Boolean);
  const ext = sel.filter(i => i.src && i.src !== "apt").length;
  bar.replaceChildren(h("b", {}, `${n} seleccionado${n > 1 ? "s" : ""}`));
  const go = async (action, label, danger) => {
    const steps = stepsFor(action, sel); if (!steps.length) return toast("Nada que hacer con esta selección", "bad");
    if (danger && !(await confirmBox(`${label} ${n} elemento${n > 1 ? "s" : ""}`, sel.slice(0, 8).map(i => title(i)).join(", ") + (n > 8 ? "…" : "") + (ext ? "\n(Flatpak y Snap del sistema piden tu contraseña)" : ""), label))) return;
    runChain(steps);
  };
  if (st.view === "search") bar.append(h("button", { class: "btn p", onclick: () => go("install", "Instalar") }, "Instalar"));
  if (st.view === "upgradable") bar.append(h("button", { class: "btn p", onclick: () => go("upgrade", "Actualizar") }, "Actualizar"));
  if (st.view === "installed") bar.append(h("button", { class: "btn d", onclick: () => go("remove", "Desinstalar", true) }, "Desinstalar"));
  bar.append(h("button", { class: "btn ghost", onclick: () => { st.selected.clear(); load(); } }, "Limpiar"));
}
// Convierte una acción sobre una selección mezclada en pasos por origen (y por ámbito/remoto en Flatpak)
function stepsFor(action, items) {
  const steps = [], isSrc = (i, s) => (i.src || "apt") === s;
  const apt = items.filter(i => isSrc(i, "apt")).map(i => i.name);
  if (apt.length) {
    if (action === "install") steps.push(["/api/run", { action: "install", packages: apt }, `Instalar ${apt.length} (apt)`]);
    if (action === "remove") steps.push(["/api/run", { action: "remove", packages: apt }, `Desinstalar ${apt.length} (apt)`]);
    if (action === "upgrade") {
      const ups = st.cache.upgradable || [], held = new Set(ups.filter(i => i.held).map(i => i.name)), ok = apt.filter(x => !held.has(x)), skipped = apt.length - ok.length;
      if (skipped) toast(`${skipped} retenido${skipped > 1 ? "s" : ""} omitido${skipped > 1 ? "s" : ""}`);
      if (ok.length) steps.push(ok.length === ups.filter(i => !i.held).length ? ["/api/run", { action: "upgrade-all" }, "Actualizar todo (apt)"] : ["/api/run", { action: "upgrade", packages: ok }, `Actualizar ${ok.length} (apt)`]);
    }
  }
  const fp = items.filter(i => isSrc(i, "flatpak")), groups = new Map();
  for (const i of fp) {
    if (action === "remove" && i.kind === "runtime") continue;
    const d = action === "install" ? fpDefault(i) : { scope: i.scope || "system", remote: "" }, key = d.scope + "|" + d.remote;
    if (!groups.has(key)) groups.set(key, { ...d, ids: [] }); groups.get(key).ids.push(i.name);
  }
  for (const g of groups.values()) steps.push(["/api/src/run", { source: "flatpak", action: action === "remove" ? "uninstall" : action === "upgrade" ? "update" : "install", ids: g.ids, scope: g.scope, remote: g.remote || undefined }, `${action === "install" ? "Instalar" : action === "remove" ? "Desinstalar" : "Actualizar"} ${g.ids.length} (Flatpak${g.scope === "system" ? ", sistema" : ""})`]);
  const sn = items.filter(i => isSrc(i, "snap")).map(i => i.name);
  if (sn.length) steps.push(["/api/src/run", { source: "snap", action: action === "remove" ? "remove" : action === "upgrade" ? "refresh" : "install", ids: sn, classic: action === "install" && items.some(i => isSrc(i, "snap") && /classic/.test(i.notes || "")) }, `${action === "install" ? "Instalar" : action === "remove" ? "Desinstalar" : "Actualizar"} ${sn.length} (Snap)`]);
  return steps;
}
async function runChain(steps) {
  for (const [path, payload, title] of steps) { st.lastOk = false; await run(path, payload, title); if (st.lastOk !== true) break; }
}

/* ---------- detalle ---------- */
function parseInfo(text) {
  const first = text.split(/\n\n/)[0], o = {}; let k = null;
  for (const l of first.split("\n")) {
    if (/^\s/.test(l) && k) o[k] += "\n" + l.trim();
    else { const m = l.match(/^([\w-]+):\s?(.*)$/); if (m) { k = m[1]; o[k] = m[2]; } }
  }
  return o;
}
function closeDrawer() { $("#drawer").hidden = true; st.current = null; document.querySelectorAll(".row.active").forEach(r => r.classList.remove("active")); }
async function openDrawer(p) {
  if (p.src && p.src !== "apt") return openSrcDrawer(p);
  st.current = p.name;
  document.querySelectorAll(".row.active").forEach(r => r.classList.remove("active"));
  const d = $("#drawer"); d.hidden = false;
  d.replaceChildren(h("button", { class: "btn ghost x", onclick: closeDrawer }, icon("x")), avatar(p.name), h("h2", {}, p.name), h("div", { class: "sk" }), h("div", { class: "sk" }));
  const acts = h("div", { class: "acts" });
  const inst = p.installed || st.view === "installed" || st.view === "upgradable";
  if (!inst) acts.append(h("button", { class: "btn p", onclick: () => run("/api/run", { action: "install", packages: [p.name] }, "Instalar " + p.name) }, "Instalar"));
  else {
    if (st.view === "upgradable" && !p.held) acts.append(h("button", { class: "btn p", onclick: () => run("/api/run", { action: "upgrade", packages: [p.name] }, "Actualizar " + p.name) }, "Actualizar"));
    acts.append(h("button", { class: "btn d", onclick: async () => (await confirmBox("Desinstalar " + p.name, "Se conservará su configuración.", "Desinstalar")) && run("/api/run", { action: "remove", packages: [p.name] }, "Desinstalar " + p.name) }, "Desinstalar"),
      h("button", { class: "btn d", onclick: async () => (await confirmBox("Purgar " + p.name, "Se eliminará también su configuración.", "Purgar")) && run("/api/run", { action: "purge", packages: [p.name] }, "Purgar " + p.name) }, "Purgar"));
  }
  const heldBox = p.held ? h("div", { class: "banner2" }, h("b", {}, "Retenido por apt"), h("div", {}, "Actualizarlo exige instalar o quitar otros paquetes (por ejemplo, el cambio de NVIDIA 580→595 o kernels nuevos), y los repositorios aún no lo permiten. Se actualizará solo cuando sus dependencias estén disponibles."),
    h("button", { class: "btn sm", style: "margin-top:8px", onclick: async e => { e.target.disabled = true; const out = h("pre", { class: "desc", style: "background:var(--bg);padding:8px;border-radius:8px;max-height:240px;overflow:auto" }, "Simulando…"); heldBox.append(out); try { out.textContent = (await api("/api/why?name=" + encodeURIComponent(p.name))).text || "(sin salida)"; } catch (er) { out.textContent = er.message; } } }, "Ver por qué")) : null;
  try {
    const { text } = await api("/api/info?name=" + encodeURIComponent(p.name));
    if (st.current !== p.name) return;
    const o = parseInfo(text), [sum, ...rest] = (o.Description || "").split("\n");
    const kv = h("dl", { class: "kv" });
    const add = (k, v) => v && kv.append(h("dt", {}, k), h("dd", {}, v));
    add("Versión", o.Version); add("Sección", o.Section); add("Instalado", o["Installed-Size"] && fmtKb(+o["Installed-Size"]));
    add("Descarga", o.Size && fmtKb(Math.round(+o.Size / 1024))); add("Mantenedor", o.Maintainer);
    if (/^https?:\/\//.test(o.Homepage || "")) add("Web", h("a", { href: o.Homepage, target: "_blank", rel: "noopener noreferrer", style: "color:var(--acc)" }, o.Homepage));
    if (o.Depends) { const chips = h("div", { class: "chips" }); o.Depends.split(",").slice(0, 24).forEach(x => { const n = x.trim().split(/[\s|(]/)[0]; if (n) chips.append(h("span", { class: "chip", onclick: () => { $("#q").value = n; setView("search"); } }, n)); }); kv.append(h("dt", {}, "Depende de"), h("dd", {}, chips)); }
    d.replaceChildren(h("button", { class: "btn ghost x", onclick: closeDrawer }, icon("x")), avatar(p.name), h("h2", {}, p.name), h("div", { class: "sum" }, sum || ""), acts, heldBox,
      rest.length ? h("div", { class: "desc" }, rest.map(l => l === "." ? "" : l).join("\n")) : null, kv);
  } catch (e) { d.replaceChildren(h("button", { class: "btn ghost x", onclick: closeDrawer }, icon("x")), h("h2", {}, p.name), acts, h("div", { class: "empty" }, e.message)); }
}

/* ---------- Flatpak y Snap ---------- */
const SRC_LABEL = { apt: "apt", flatpak: "Flatpak", snap: "Snap" };
const fpOk = () => !!(st.sources && st.sources.flatpak && st.sources.flatpak.available);
const snapOk = () => !!(st.sources && st.sources.snap && st.sources.snap.available);
const wants = s => st.src === "all" || st.src === s;
async function loadSources() { try { st.sources = await api("/api/sources"); } catch { st.sources = null; } }
function drawSrc() {
  const seg = $("#srcseg"); if (!seg) return;
  seg.replaceChildren(...[["all", "Todo"], ["apt", "apt"], ["flatpak", "Flatpak"], ["snap", "Snap"]].filter(([k]) => k !== "flatpak" || fpOk())
    .map(([k, l]) => h("button", { class: st.src === k ? "on" : "", title: k === "snap" && !snapOk() ? "Snap no está instalado" : "", onclick: () => { st.src = k; st.selected.clear(); st.shown = LIMIT; closeDrawer(); drawSrc(); load(); } }, l + (k === "snap" && !snapOk() ? " ·" : ""))));
  const rl = $("#rtlbl"); if (rl) rl.hidden = !(["installed", "upgradable"].includes(st.view) && fpOk() && wants("flatpak"));
}
function snapMissing() {
  empty("🧩", "Snap no está instalado", "snapd no viene con Pop!_OS. Si lo instalas, podrás buscar y gestionar snaps desde aquí (se instala con apt, paquete snapd).");
  const cand = st.sources && st.sources.snap && st.sources.snap.candidate;
  $("#list").querySelector(".empty").append(h("button", { class: "btn p", style: "margin-top:14px", onclick: async () => {
    if (!(await confirmBox("Instalar snapd", `Se instalará el paquete snapd${cand ? " " + cand : ""} con apt (necesita tu contraseña). Crea el servicio de Snap en tu equipo; puedes desinstalarlo después.`, "Instalar"))) return;
    await run("/api/src/run", { source: "snap", action: "install-snapd" }, "Instalar snapd"); await loadSources(); drawSrc(); drawTools(); load();
  } }, "Instalar snapd"));
}
function fpDefault(i) {
  const rs = (st.sources && st.sources.flatpak.remotes) || [], names = i.remotes && i.remotes.length ? i.remotes : [i.origin || "flathub"];
  for (const sc of ["system", "user"]) for (const n of names) if (rs.some(r => r.name === n && r.scope === sc)) return { scope: sc, remote: n };
  return { scope: "system", remote: names[0] };
}
async function updateAllFlatpak() {
  const ups = st.cache.fpUpdates || [], scopes = ["system", "user"].filter(s => ups.some(u => u.scope === s));
  if (!scopes.length) return toast("Flatpak está al día", "ok");
  const apps = ups.filter(u => u.kind !== "runtime").length;
  if (!(await confirmBox("Actualizar Flatpak", `${apps} aplicaciones y ${ups.length - apps} runtimes con novedades.` + (scopes.includes("system") ? "\nLas del sistema piden tu contraseña." : ""), "Actualizar"))) return;
  runChain(scopes.map(scope => ["/api/src/run", { source: "flatpak", action: "update", ids: [], scope }, `Actualizar Flatpak (${scope === "system" ? "sistema" : "usuario"})`]));
}
function updateButtons(items) {
  const msg = $("#msg"), fp = items.filter(i => i.src === "flatpak"), sn = items.filter(i => i.src === "snap");
  if (fp.length) msg.append(h("button", { class: "btn sm", onclick: updateAllFlatpak }, `Actualizar todo Flatpak (${fp.filter(i => i.kind !== "runtime").length} apps${fp.some(i => i.kind === "runtime") ? " + " + fp.filter(i => i.kind === "runtime").length + " runtimes" : ""})`));
  if (sn.length) msg.append(h("button", { class: "btn sm", onclick: async () => (await confirmBox("Actualizar Snap", `${sn.length} snaps con novedades. Pide tu contraseña.`, "Actualizar")) && run("/api/src/run", { source: "snap", action: "refresh", ids: [] }, "Actualizar Snap") }, `Actualizar todo Snap (${sn.length})`));
}
function parseFpInfo(text) {
  const kv = {}; for (const l of text.split("\n")) { const m = l.match(/^\s*([A-Za-z][A-Za-z ]*):\s*(.*)$/); if (m) kv[m[1].trim()] = m[2]; }
  return { head: text.split("\n").find(l => l.trim()) || "", kv };
}
async function openSrcDrawer(p) {
  const k = keyOf(p); st.current = k; document.querySelectorAll(".row.active").forEach(r => r.classList.remove("active"));
  const d = $("#drawer"); d.hidden = false;
  const av = p.app && p.app.icon ? h("img", { class: "av", style: "width:52px;height:52px", src: "/api/icon?name=" + encodeURIComponent(p.app.icon), alt: "", onerror: e => e.target.replaceWith(avatar(title(p))) }) : avatar(title(p));
  const top = [h("button", { class: "btn ghost x", onclick: closeDrawer }, icon("x")), av, h("h2", {}, title(p)), h("div", { class: "sum" }, p.name)];
  d.replaceChildren(...top, h("div", { class: "sk" }), h("div", { class: "sk" }));
  const isFp = p.src === "flatpak", def = isFp ? fpDefault(p) : null, scope = isFp ? (p.installed && p.scope ? p.scope : def.scope) : null;
  let info; try { info = isFp ? await api(`/api/fp/info?q=${encodeURIComponent(p.name)}&scope=${scope}&remote=${encodeURIComponent(p.origin || def.remote)}`) : await api("/api/snap/info?q=" + encodeURIComponent(p.name)); } catch (e) { info = { error: e.message, text: "" }; }
  if (st.current !== k) return;
  let extra = null; const acts = h("div", { class: "acts" }), inst = !!(p.installed || st.view === "installed" || st.view === "upgradable");
  const isUpd = st.view === "upgradable" || (isFp ? (st.cache.fpUpdates || []).some(u => u.name === p.name && u.scope === p.scope) : (st.cache.snapUpdates || []).some(u => u.name === p.name));
  const lockTxt = (isFp ? scope === "system" : true) ? "\n\n🔒 Te pedirá tu contraseña." : "";
  const doRun = (payload, label) => run("/api/src/run", { source: p.src, ...payload }, label);
  if (!inst) {
    if (isFp) {
      const rs = (st.sources.flatpak.remotes || []), sc = h("select", { onchange: refill }, h("option", { value: "system" }, "Sistema (pide contraseña)"), h("option", { value: "user" }, "Solo para mi usuario")), rem = h("select", {}), hint = h("div", { class: "mut", style: "font-size:12px;margin-top:6px" });
      sc.value = def.scope;
      function refill() { const list = rs.filter(r => r.scope === sc.value && (!p.remotes || !p.remotes.length || p.remotes.includes(r.name))); rem.replaceChildren(...(list.length ? list : [{ name: "" }]).map(r => h("option", { value: r.name }, r.name || "(sin remoto)"))); go.disabled = !list.length; hint.textContent = list.length ? "" : "No hay un remoto válido en ese ámbito. Añade el remoto (p. ej. flathub) con «flatpak remote-add»."; }
      const go = h("button", { class: "btn p", onclick: async () => { if (await confirmBox("Instalar " + title(p), `Se instalará desde ${rem.value} (${sc.value === "system" ? "sistema" : "usuario"}). Puede descargar runtimes si hacen falta.` + (sc.value === "system" ? "\n\n🔒 Te pedirá tu contraseña." : ""), "Instalar")) doRun({ action: "install", ids: [p.name], scope: sc.value, remote: rem.value }, "Instalar " + title(p)); } }, "Instalar");
      refill(); acts.append(go, sc, rem); extra = hint;
    } else {
      const classic = h("input", { type: "checkbox", checked: /classic/.test(p.notes || "") }), chan = h("select", {}, ...["latest/stable", "latest/candidate", "latest/beta", "latest/edge"].map(c => h("option", { value: c }, c)));
      acts.append(h("button", { class: "btn p", onclick: async () => { if (await confirmBox("Instalar " + p.name, "Se instalará el snap desde la tienda de Snap." + lockTxt, "Instalar")) doRun({ action: "install", ids: [p.name], classic: classic.checked, channel: chan.value }, "Instalar " + p.name); } }, "Instalar"), chan, h("label", { class: "lbl", title: "Algunos snaps necesitan modo clásico (acceso total al sistema)" }, classic, "modo clásico"));
    }
  } else {
    if (isUpd) acts.append(h("button", { class: "btn p", onclick: () => doRun(isFp ? { action: "update", ids: [p.name], scope: p.scope } : { action: "refresh", ids: [p.name] }, "Actualizar " + title(p)) }, "Actualizar"));
    if (!(isFp && p.kind === "runtime")) acts.append(
      h("button", { class: "btn d", onclick: async () => { if (await confirmBox("Desinstalar " + title(p), "Se conservarán los datos de la aplicación." + lockTxt, "Desinstalar")) doRun(isFp ? { action: "uninstall", ids: [p.name], scope: p.scope } : { action: "remove", ids: [p.name] }, "Desinstalar " + title(p)); } }, "Desinstalar"),
      h("button", { class: "btn d", onclick: async () => { if (await confirmBox("Desinstalar y borrar datos", `Se elimina ${title(p)} junto con TODOS sus datos y ajustes. No se puede deshacer.` + lockTxt, "Borrar todo")) doRun(isFp ? { action: "uninstall", ids: [p.name], scope: p.scope, delete_data: true } : { action: "remove", ids: [p.name], purge: true }, "Borrar " + title(p)); } }, "Desinstalar y borrar datos"));
    else acts.append(h("span", { class: "mut", style: "font-size:12.5px" }, "Es un runtime: usa «Quitar runtimes sin uso» para eliminar los que no se necesiten."));
  }
  const body = [];
  if (info.error) body.push(h("div", { class: "empty" }, info.error));
  else if (isFp) {
    const { head, kv } = parseFpInfo(info.text), dl = h("dl", { class: "kv" }), add = (a, v) => v && dl.append(h("dt", {}, a), h("dd", {}, v));
    add("Versión", kv.Version || p.version); add("Rama", kv.Branch); add("Licencia", kv.License); add("Origen", kv.Origin || (p.remotes || []).join(", ")); add("Instalación", kv.Installation); add("Tamaño instalado", kv["Installed Size"]); add("Runtime", kv.Runtime); add("Sdk", kv.Sdk);
    body.push(h("div", { class: "desc" }, head), dl);
    if (info.perms) body.push(h("details", { style: "margin-top:14px" }, h("summary", { style: "cursor:pointer;color:var(--acc)" }, "Permisos de la aplicación"), h("pre", { class: "desc", style: "background:var(--bg);padding:8px;border-radius:8px;overflow:auto;max-height:260px" }, info.perms)));
  } else body.push(h("pre", { class: "desc", style: "background:var(--bg);padding:8px;border-radius:8px;overflow:auto;max-height:380px" }, info.text));
  d.replaceChildren(...[...top, h("div", { class: "tags", style: "display:flex;gap:6px;margin:6px 0" }, h("span", { class: "tag src-" + p.src }, SRC_LABEL[p.src]), isFp && (p.scope || def.scope) ? h("span", { class: "tag" }, (p.scope || def.scope) === "system" ? "sistema" : "usuario") : null), acts, extra, ...body].filter(x => x != null));
}

/* ---------- consola / trabajos ---------- */
async function run(path, payload, title, wait = false) {
  if (st.busy) return toast("Ya hay una operación en curso", "bad");
  st.busy = true;
  const c = $("#console"), log = $("#log"), dot = $("#cdot");
  c.hidden = false; c.classList.remove("min"); document.body.classList.add("hasc");
  $("#ctitle").textContent = title; dot.className = "dot run"; log.textContent = "Esperando autorización (polkit)…\n";
  try {
    const { id } = await api(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Gestor": "1" }, body: JSON.stringify({ ...payload, title, wait }) });
    await follow(id, title);
  } catch (e) {
    st.busy = false;
    if (e.blocked) { c.hidden = true; document.body.classList.remove("hasc"); return blockedDialog(e, path, payload, title); }
    dot.className = "dot bad"; log.textContent = "Error: " + e.message; toast(e.message, "bad");
  }
}
// Sigue un trabajo del servidor (también sirve para retomar uno que ya estaba en curso)
async function follow(id, title) {
  st.busy = true;
  const c = $("#console"), log = $("#log"), dot = $("#cdot");
  c.hidden = false; document.body.classList.toggle("hasc", !c.classList.contains("min"));
  $("#ctitle").textContent = title; dot.className = "dot run";
  let from = 0, first = true;
  try {
    for (;;) {
      const r = await api(`/api/job?id=${id}&from=${from}`);
      if (r.text) { if (first) { log.textContent = ""; first = false; } log.textContent += r.text; log.scrollTop = log.scrollHeight; }
      from = r.next;
      if (r.done) {
        const ok = r.code === 0; st.lastOk = ok; dot.className = "dot " + (ok ? "ok" : "bad");
        if (first) log.textContent = ok ? "" : "Cancelado o sin salida.\n";
        log.textContent += ok ? "\n✔ Completado\n" : `\n✘ Terminó con código ${r.code}\n`;
        toast(ok ? `${title}: completado` : `${title}: falló`, ok ? "ok" : "bad");
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (e) { dot.className = "dot bad"; log.textContent += "\nError: " + e.message; toast(e.message, "bad"); }
  st.busy = false; st.cache = {}; st.selected.clear(); closeDrawer(); load(); refreshBadge(); watch();
}
// Vigila el servidor: retoma operaciones en curso y detecta procesos bloqueantes ajenos
async function watch() {
  try {
    const s = await api("/api/status");
    const changed = s.blockers.length !== st.blockers.length;
    st.blockers = s.blockers;
    if (st.sig !== null && s.sig !== st.sig && !st.busy) {
      if (st.auto) { st.cache = {}; toast("Los paquetes cambiaron: lista actualizada"); if (st.view !== "procs" && st.view !== "files") load(); refreshBadge(); }
    }
    st.sig = s.sig;
    if (changed) { drawNav(); if (st.view === "procs" && !st.busy) loadProcs(st.token); }
    if (s.job && !st.busy) follow(s.job.id, s.job.title);
  } catch {}
}
function blockedDialog(e, path, payload, title) {
  confirmBox("Hay un proceso usando apt", e.message + " Puedes ver qué está haciendo, o esperar a que termine y ejecutar después.", "Esperar y ejecutar", "Ver proceso").then(r => {
    if (r === true) run(path, payload, title, true);
    else if (r === "extra") { setView("procs"); followProc(e.pid); }
  });
}
// Muestra en la consola lo que hace un proceso ajeno (fase, subprocesos y logs de apt/dpkg)
let pfTimer = null;
async function followProc(pid) {
  clearTimeout(pfTimer);
  const c = $("#console"), log = $("#log"), dot = $("#cdot");
  c.hidden = false; c.classList.remove("min"); document.body.classList.add("hasc");
  $("#ctitle").textContent = `Proceso ${pid}`; dot.className = "dot run"; log.textContent = "Leyendo…";
  const tick = async () => {
    let r;
    try { r = await api("/api/proclog?pid=" + pid); } catch (e) { log.textContent = "Error: " + e.message; return; }
    const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 24;
    if (!r.alive) {
      dot.className = "dot ok"; log.textContent += "\n✔ El proceso terminó.\n"; log.scrollTop = log.scrollHeight;
      toast(`Proceso ${pid} terminado`, "ok"); st.cache = {}; watch(); load(); refreshBadge(); return;
    }
    $("#ctitle").textContent = `${r.cmd.split(/\s/)[0].split("/").pop()} (pid ${pid}) · ${r.phase} · ${fmtT(r.elapsed)}`;
    let t = `$ ${r.cmd}\nusuario: ${r.user}\n`;
    if (r.children.length) t += "\nSubprocesos:\n" + r.children.map(k => `  ${k.pid} (${fmtT(k.elapsed)}) ${k.cmd}`).join("\n") + "\n";
    t += "\n── /var/log/apt/term.log ──\n" + (r.term === null ? "(sin permiso para leerlo; tu usuario debería estar en el grupo adm)" : r.term || "(vacío)");
    t += "\n\n── /var/log/dpkg.log (últimas líneas) ──\n" + (r.dpkg === null ? "(sin permiso)" : r.dpkg);
    log.textContent = t; if (atEnd) log.scrollTop = log.scrollHeight;
    pfTimer = setTimeout(tick, 2000);
  };
  tick();
}
function badgeCount() {
  const apt = (st.cache.upgradable || []).filter(i => !i.held).length, fp = (st.cache.fpUpdates || []).filter(i => i.kind !== "runtime").length;
  return apt + fp + (st.cache.snapUpdates || []).length;
}
async function refreshBadge() {
  try {
    const [a, f, s] = await Promise.all([api("/api/upgradable").then(x => x.map(i => ({ ...i, src: "apt" }))), fpOk() ? api("/api/fp/updates").catch(() => []) : [], snapOk() ? api("/api/snap/updates").catch(() => []) : []]);
    st.cache.upgradable = a; st.cache.fpUpdates = f; st.cache.snapUpdates = s; st.cache.up = badgeCount(); drawNav();
  } catch {}
}

/* ---------- rendimiento ---------- */
const fmtB = b => b >= 1e12 ? (b / 1e12).toFixed(1) + " TB" : b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(0) + " MB" : (b / 1e3).toFixed(0) + " KB";
const fmtDur = s => s >= 86400 ? Math.floor(s / 86400) + " d " + Math.floor(s % 86400 / 3600) + " h" : s >= 3600 ? Math.floor(s / 3600) + " h " + Math.floor(s % 3600 / 60) + " min" : Math.floor(s / 60) + " min";
const NS = "http://www.w3.org/2000/svg";

// Gráfica mínima de una serie: línea de 2 px, marcador final y tooltip con cruceta al pasar el ratón
function sparkline(color) {
  const W = 220, H = 56;
  const wrap = h("div", { class: "spark" });
  const svg = document.createElementNS(NS, "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none");
  const grid = document.createElementNS(NS, "path"); grid.setAttribute("class", "sgrid"); grid.setAttribute("d", `M0 ${H - 1}H${W}M0 ${H / 2}H${W}`);
  const line = document.createElementNS(NS, "polyline"); line.setAttribute("fill", "none"); line.setAttribute("stroke", color); line.setAttribute("stroke-width", "2"); line.setAttribute("stroke-linejoin", "round"); line.setAttribute("vector-effect", "non-scaling-stroke");
  const cross = document.createElementNS(NS, "line"); cross.setAttribute("class", "scross"); cross.setAttribute("y1", 0); cross.setAttribute("y2", H); cross.style.display = "none";
  svg.append(grid, line, cross);
  const dot = h("i", { class: "sdot", style: `background:${color}` }), tip = h("div", { class: "stip" });
  tip.hidden = true; wrap.append(svg, dot, tip);
  let pts = [];
  const api = {
    el: wrap,
    set(values, fmt, max) {
      const m = max || Math.max(1, ...values) * 1.15;
      pts = values.map((v, i) => [values.length > 1 ? i / (values.length - 1) * W : W, H - 2 - Math.min(v / m, 1) * (H - 4)]);
      line.setAttribute("points", pts.map(p => p.join(",")).join(" "));
      const last = pts[pts.length - 1];
      if (last) { dot.style.left = (last[0] / W * 100) + "%"; dot.style.top = (last[1] / H * 100) + "%"; dot.hidden = false; } else dot.hidden = true;
      api.vals = values; api.fmt = fmt;
    },
  };
  wrap.onmousemove = e => {
    if (!pts.length) return;
    const r = wrap.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(x * (pts.length - 1))));
    cross.setAttribute("x1", pts[i][0]); cross.setAttribute("x2", pts[i][0]); cross.style.display = "";
    tip.hidden = false; tip.textContent = `${api.fmt(api.vals[i])} · hace ${(pts.length - 1 - i) * 2} s`;
    tip.style.left = Math.min(Math.max(x * 100, 18), 82) + "%";
  };
  wrap.onmouseleave = () => { cross.style.display = "none"; tip.hidden = true; };
  return api;
}
const meter = (pct, color) => h("div", { class: "meter" }, h("i", { style: `width:${Math.min(100, Math.max(0, pct))}%;background:${color}` }));

async function loadMetrics() {
  $("#msg").textContent = ""; const list = $("#list"); list.replaceChildren();
  const C = { cpu: "var(--s1)", mem: "var(--s3)", disk: "var(--s7)", me: "var(--s2)" };
  const sp = { cpu: sparkline(C.cpu), mem: sparkline(C.mem), me: sparkline(C.me) };
  const el = {};
  const card = (key, title, color) => { const c = h("div", { class: "mcard" }, h("div", { class: "mt" }, h("i", { style: `background:${color}` }), title)); el[key] = { big: h("div", { class: "big2" }), sub: h("div", { class: "msub" }), extra: h("div", {}) }; c.append(el[key].big, el[key].sub); if (sp[key]) c.append(sp[key].el); c.append(el[key].extra); return c; };
  const grid = h("div", { class: "mgrid" }, card("cpu", "CPU", C.cpu), card("mem", "Memoria", C.mem), card("disk", "Disco", C.disk), card("me", "Horse Pack (este servicio)", C.me));
  const tabs = h("div", { class: "seg", style: "margin-left:auto" }), body = h("div", { class: "ptable" });
  const hd = h("div", { class: "msg", style: "display:flex;align-items:center;gap:10px;margin-top:18px" }, h("b", {}, "Procesos con más consumo"), tabs);
  list.append(grid, hd, body);
  st.msort ||= "cpu";
  for (const [k, l] of [["cpu", "CPU"], ["mem", "Memoria"]]) tabs.append(h("button", { class: st.msort === k ? "on" : "", onclick: () => { st.msort = k; [...tabs.children].forEach(b => b.classList.toggle("on", b === tabs.children[k === "cpu" ? 0 : 1])); tick(); } }, l));
  let busy = false;
  async function tick() {
    if (busy || st.view !== "metrics" || document.hidden) return; busy = true;
    try {
      const m = await api("/api/metrics?sort=" + st.msort);
      if (st.view !== "metrics") return;
      const H = m.history;
      el.cpu.big.textContent = m.cpu.toFixed(0) + "%"; el.cpu.sub.textContent = `${m.ncpu} núcleos · carga ${m.load.map(x => x.toFixed(1)).join(" / ")}`;
      sp.cpu.set(H.map(x => x.cpu), v => v.toFixed(0) + "%", 100);
      el.mem.big.textContent = m.mem.pct.toFixed(0) + "%"; el.mem.sub.textContent = `${fmtKb(m.mem.used_kb)} de ${fmtKb(m.mem.total_kb)}`;
      sp.mem.set(H.map(x => x.mem), v => v.toFixed(0) + "%", 100);
      const sw = m.mem.swap_total_kb ? 100 * m.mem.swap_used_kb / m.mem.swap_total_kb : 0;
      el.mem.extra.replaceChildren(h("div", { class: "msub" }, `Swap ${fmtKb(m.mem.swap_used_kb)} de ${fmtKb(m.mem.swap_total_kb)}`), meter(sw, C.mem));
      const d0 = m.disks[0];
      if (d0) { const used = d0.total - d0.free; el.disk.big.textContent = (100 * used / d0.total).toFixed(0) + "%"; el.disk.sub.textContent = `${fmtB(d0.free)} libres de ${fmtB(d0.total)} en ${d0.mount}`;
        el.disk.extra.replaceChildren(meter(100 * used / d0.total, C.disk), ...m.disks.slice(1).map(d => h("div", { class: "msub" }, `${d.mount}: ${fmtB(d.free)} libres de ${fmtB(d.total)}`)), h("div", { class: "msub" }, "Encendido hace " + fmtDur(m.uptime))); }
      if (m.self) { el.me.big.textContent = m.self.cpu.toFixed(1) + "% CPU"; el.me.sub.textContent = `${fmtKb(m.self.mem_kb)} de RAM (+${fmtKb(m.self.cache_kb)} de caché) · ${m.self.pids} procesos` + (m.self.mem_max_kb ? ` · límite ${fmtKb(m.self.mem_max_kb)}${m.self.cpu_limit ? " / " + m.self.cpu_limit + "% CPU" : ""}` : "");
        sp.me.set(H.map(x => x.self_cpu), v => v.toFixed(1) + "% CPU", Math.max(5, ...H.map(x => x.self_cpu)));
        el.me.extra.replaceChildren(m.self.mem_max_kb ? meter(100 * m.self.mem_kb / m.self.mem_max_kb, C.me) : "", h("div", { class: "msub" }, "Incluye las operaciones de apt lanzadas desde el panel.")); }
      const maxCpu = Math.max(100, ...m.procs.map(p => p.cpu)), maxMem = Math.max(...m.procs.map(p => p.mem_kb));
      body.replaceChildren(h("div", { class: "prow phead" }, h("span", {}, "Proceso"), h("span", { class: "c" }, "CPU"), h("span", { class: "c" }, "Memoria"), h("span", {})),
        ...m.procs.map(p => h("div", { class: "prow" },
          h("div", { class: "t" }, h("div", { class: "n" }, p.name, p.own && h("span", { class: "tag" }, "Horse Pack"), p.apt && h("span", { class: "tag up" }, "apt")), h("div", { class: "d" }, `pid ${p.pid} · ${p.user} · ${p.threads} hilos · ${p.cmd}`)),
          h("div", { class: "c" }, h("span", {}, p.cpu.toFixed(1) + "%"), meter(100 * p.cpu / maxCpu, C.cpu)),
          h("div", { class: "c" }, h("span", {}, fmtKb(p.mem_kb)), meter(100 * p.mem_kb / maxMem, C.mem)),
          p.apt ? h("button", { class: "btn sm", onclick: () => followProc(p.pid) }, "Ver log") : h("span", {}))));
    } catch (e) { body.replaceChildren(h("div", { class: "msg" }, "Error: " + e.message)); }
    busy = false;
  }
  await tick();
  clearInterval(st.mTimer); st.mTimer = setInterval(tick, 2000);
}

/* ---------- procesos bloqueantes ---------- */
const fmtT = s => s < 60 ? s + " s" : s < 3600 ? Math.floor(s / 60) + " min" : Math.floor(s / 3600) + " h " + Math.floor(s % 3600 / 60) + " min";
async function stopProc(p, sig) {
  const hard = sig === "KILL";
  const ok = await confirmBox(hard ? "Forzar cierre" : "Detener proceso",
    `${p.cmd.slice(0, 80)} (pid ${p.pid}). ` + (/dpkg/.test(p.cmd) ? "⚠ Detener dpkg en mitad de una instalación puede dejar paquetes a medias; después usa «Reparar dpkg». " : "") + (hard ? "Se cierra sin darle opción a terminar limpiamente." : "Se le pide que termine limpiamente."), hard ? "Forzar" : "Detener");
  if (!ok) return;
  try { await api("/api/stop", { method: "POST", headers: { "Content-Type": "application/json", "X-Gestor": "1" }, body: JSON.stringify({ pid: p.pid, signal: sig }) }); toast("Señal enviada a " + p.pid, "ok"); }
  catch (e) { toast(e.message, "bad"); }
  setTimeout(() => { watch(); loadProcs(st.token); }, 1200);
}
async function loadProcs(my) {
  $("#msg").textContent = "";
  try {
    const r = await api("/api/blockers"); if (my !== st.token && st.view !== "procs") return;
    st.blockers = r.procs.filter(p => !p.own); drawNav();
    const list = $("#list"); list.replaceChildren();
    list.append(h("div", { class: "acts" },
      h("button", { class: "btn", onclick: async () => (await confirmBox("Reparar dpkg", "Ejecuta «dpkg --configure -a» para terminar instalaciones interrumpidas.", "Reparar")) && run("/api/run", { action: "configure-a" }, "Reparar dpkg") }, "Reparar dpkg"),
      h("button", { class: "btn ghost", onclick: () => loadProcs(st.token) }, icon("refresh"), "Refrescar")));
    list.append(h("h3", { class: "sec" }, "Procesos que pueden bloquear apt/dpkg"));
    if (!r.procs.length) list.append(h("div", { class: "empty" }, h("div", { class: "big" }, "🐴"), h("b", {}, "Nada bloquea apt"), h("div", {}, "No hay procesos de apt/dpkg en ejecución.")));
    for (const p of r.procs) list.append(h("div", { class: "row", style: "cursor:default" },
      avatar(p.cmd.split(/\s/)[0].split("/").pop() || "?"),
      h("div", { class: "t" }, h("div", { class: "n" }, p.cmd.split(/\s/)[0].split("/").pop(), h("span", { class: "tag" + (p.own ? "" : " up") }, p.own ? "esta app" : "externo")),
        h("div", { class: "d" }, `pid ${p.pid} · ${p.user} · ${fmtT(p.elapsed)} · ${p.cmd}`)),
      h("button", { class: "btn sm", onclick: () => followProc(p.pid) }, "Ver log"),
      h("button", { class: "btn d sm", onclick: () => stopProc(p, "TERM") }, "Detener"),
      h("button", { class: "btn d sm", onclick: () => stopProc(p, "KILL") }, "Forzar")));
    list.append(h("h3", { class: "sec" }, "Estado de dpkg"));
    list.append(r.audit ? h("pre", { class: "desc", style: "background:var(--panel);padding:10px;border-radius:8px" }, r.audit) : h("div", { class: "msg" }, "✔ Sin paquetes a medias ni rotos."));
  } catch (e) { empty("⚠️", "No se pudo cargar", e.message); }
}

/* ---------- archivos ---------- */
async function loadFiles(my) {
  $("#msg").textContent = "";
  try {
    const fl = await api("/api/files"); if (my !== st.token) return;
    const list = $("#list"); list.replaceChildren();
    if (!fl.length) return list.append(h("div", { class: "msg" }, "Aún no hay nada instalado desde archivo."));
    for (const f of fl) list.append(h("div", { class: "row", style: "cursor:default" }, avatar(f.name),
      h("div", { class: "t" }, h("div", { class: "n" }, f.name, h("span", { class: "tag" }, f.scope === "system" ? "sistema" : "usuario")), h("div", { class: "d" }, `${f.dir} · ${f.source}`)),
      h("button", { class: "btn d sm", onclick: async () => (await confirmBox("Desinstalar " + f.name, "Se borrarán su carpeta y sus enlaces.", "Desinstalar")) && run("/api/uninstall-file", { name: f.name }, "Desinstalar " + f.name) }, icon("trash"), "Desinstalar")));
  } catch (e) { empty("⚠️", "No se pudo cargar", e.message); }
}
function pickFile(f) {
  if (!f) return; st.file = f;
  $("#opts").hidden = false; $("#fname").textContent = f.name + " · " + fmtKb(Math.round(f.size / 1024));
  $("#appname").hidden = /\.deb$/i.test(f.name); $("#scope").hidden = /\.deb$/i.test(f.name);
}
function upload(f) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest(), bar = $("#upbar"), fill = $("#upfill");
    x.open("POST", "/api/upload?name=" + encodeURIComponent(f.name)); x.setRequestHeader("X-Gestor", "1");
    bar.hidden = false; fill.style.width = "0";
    x.upload.onprogress = e => { if (e.lengthComputable) fill.style.width = (e.loaded / e.total * 100) + "%"; };
    x.onload = () => { bar.hidden = true; let j = {}; try { j = JSON.parse(x.responseText); } catch {} x.status === 200 ? res(j) : rej(new Error(j.error || "Error " + x.status)); };
    x.onerror = () => { bar.hidden = true; rej(new Error("Fallo de red")); };
    x.send(f);
  });
}

/* ---------- arranque ---------- */
$("#dropi").append(icon("up"));
$("#sicon").append(icon("search")); $("#reload").append(icon("refresh"));
const drop = $("#drop"), fi = $("#file");
drop.onclick = () => fi.click(); drop.onkeydown = e => (e.key === "Enter" || e.key === " ") && fi.click();
fi.onchange = () => pickFile(fi.files[0]);
["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => pickFile(e.dataTransfer.files[0]));
document.querySelectorAll("#scope button").forEach(b => b.onclick = () => { st.scope = b.dataset.v; document.querySelectorAll("#scope button").forEach(x => x.classList.toggle("on", x === b)); });
$("#instfile").onclick = async () => {
  if (!st.file) return;
  try {
    const up = await upload(st.file);
    $("#opts").hidden = true; fi.value = ""; st.file = null;
    await run("/api/install-file", { id: up.id, scope: st.scope, name: $("#appname").value.trim() }, "Instalar " + up.name);
    $("#appname").value = "";
  } catch (e) { toast(e.message, "bad"); }
};
$("#reload").onclick = () => { st.cache = {}; loadSources().then(() => { drawSrc(); drawTools(); load(); refreshBadge(); }); };
$("#rt").onchange = e => { st.runtimes = e.target.checked; load(); };
$("#sort").onchange = load;
try { st.group = localStorage.getItem("hp-group") || "type"; } catch {}
$("#group").value = st.group;
$("#group").onchange = () => { st.group = $("#group").value; try { localStorage.setItem("hp-group", st.group); } catch {} st.gshown = {}; load(); };
$("#cmin").onclick = () => { const m = $("#console").classList.toggle("min"); $("#cmin").textContent = m ? "Expandir" : "Minimizar"; document.body.classList.toggle("hasc", !m); };
$("#cclose").onclick = () => { clearTimeout(pfTimer); if (!st.busy) { $("#console").hidden = true; document.body.classList.remove("hasc"); } };
let deb; $("#q").oninput = () => { clearTimeout(deb); deb = setTimeout(load, st.view === "search" ? 350 : 120); };
$("#q").onkeydown = e => { if (e.key === "Enter" && st.view !== "search" && st.view !== "files") return; if (e.key === "Enter") { clearTimeout(deb); load(); } };
document.addEventListener("keydown", e => {
  if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); }
  if (e.key === "Escape") { if (document.activeElement === $("#q")) $("#q").blur(); else closeDrawer(); }
});
try { st.auto = localStorage.getItem("hp-auto") !== "0"; } catch {}
const sw = $("#auto"); sw.setAttribute("aria-checked", st.auto);
sw.onclick = () => {
  st.auto = !st.auto; sw.setAttribute("aria-checked", st.auto);
  try { localStorage.setItem("hp-auto", st.auto ? "1" : "0"); } catch {}
  toast(st.auto ? "Auto-refresco activado" : "Auto-refresco desactivado");
};
loadSources().finally(() => {
  drawTools();
  const [v0, qs] = location.hash.slice(1).split("?"), pr = new URLSearchParams(qs || "");
  if (["all", "apt", "flatpak", "snap"].includes(pr.get("src"))) st.src = pr.get("src");
  if (pr.get("q")) $("#q").value = pr.get("q");
  if (pr.get("runtimes") === "1") { st.runtimes = true; $("#rt").checked = true; }
  setView(VIEWS.some(v => v[0] === v0) ? v0 : "installed");
  if (pr.get("open")) { const want = pr.get("open"); const t = setInterval(() => { const it = [...st.keyMap.values()].find(x => keyOf(x) === want || x.name === want); if (it) { clearInterval(t); openDrawer(it); } }, 300); setTimeout(() => clearInterval(t), 20000); }
  refreshBadge();
  watch(); setInterval(() => { if (!st.busy) watch(); }, 4000);
});
