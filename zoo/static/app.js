const $ = s => document.querySelector(s);
const h = (t, a = {}, ...c) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  e.append(...c.flat(Infinity).filter(x => x != null && x !== false));
  return e;
};
const HDR = { "Content-Type": "application/json", "X-Zoo": "1" };
const st = { apps: [], busy: new Set(), logId: null, logTimer: null, cfg: "", view: "panel", unread: 0, vt: null, od: { enabled: false, idle_minutes: 20, always: [], saved_kb: 0 }, appId: null, fpath: "" };
const put = (el, ...k) => { el.replaceChildren(...k.flat(Infinity).filter(x => x != null && x !== false)); return el; };
const STATE = { running: "En marcha", starting: "Iniciando…", standby: "En espera", stopped: "Detenida", failed: "Con error", missing: "No instalada" };
const hue = s => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return x; };
const fmtKb = kb => kb == null ? "—" : kb >= 1048576 ? (kb / 1048576).toFixed(1) + " GB" : kb >= 1024 ? (kb / 1024).toFixed(0) + " MB" : kb + " KB";
const fmtUp = s => s == null ? "—" : s >= 86400 ? Math.floor(s / 86400) + " d " + Math.floor(s % 86400 / 3600) + " h" : s >= 3600 ? Math.floor(s / 3600) + " h " + Math.floor(s % 3600 / 60) + " m" : s >= 60 ? Math.floor(s / 60) + " min" : s + " s";

async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.output || "Error " + r.status);
  return j;
}
function toast(msg, kind = "") { const t = h("div", { class: "toast " + kind }, msg); $("#toasts").append(t); setTimeout(() => t.remove(), 4000); }

async function act(app, action, label) {
  st.busy.add(app.id); render();
  try { await api("/api/action", { method: "POST", headers: HDR, body: JSON.stringify({ id: app.id, action }) }); toast(`${app.name}: ${label}`, "ok"); }
  catch (e) { toast(`${app.name}: ${e.message}`, "bad"); }
  st.busy.delete(app.id); await refresh(); setTimeout(refresh, 1500);
}

function card(a) {
  const busy = st.busy.has(a.id), up = a.state === "running" || a.state === "starting", sb = a.state === "standby", usable = up || sb;
  const acts = h("div", { class: "acts" }, h("button", { class: "btn p", disabled: !usable, onclick: () => go("app/" + a.id) }, sb ? "Abrir (despierta)" : "Abrir"),
    h("a", { class: "btn ghost sm", href: a.url, target: "_blank", rel: "noopener", title: "Abrir en una pestaña nueva", "aria-disabled": !usable }, "↗"));
  if (a.state !== "missing") {
    acts.append(up
      ? h("button", { class: "btn", disabled: busy, onclick: () => act(a, "stop", "detenida") }, "Detener")
      : h("button", { class: "btn", disabled: busy, onclick: () => act(a, "start", "iniciada") }, sb ? "Iniciar ya" : "Iniciar"));
    if (up) acts.append(h("button", { class: "btn", disabled: busy, onclick: () => act(a, "restart", "reiniciada") }, "Reiniciar"));
    acts.append(h("button", { class: "btn ghost", onclick: () => showLogs(a) }, "Logs"));
    acts.append(h("button", { class: "sw", role: "switch", "aria-checked": String(a.autostart), title: "Arrancar con tu sesión", disabled: busy, onclick: () => act(a, a.autostart ? "autostart-off" : "autostart-on", a.autostart ? "no arrancará con la sesión" : "arrancará con la sesión") }, h("i"), "Con la sesión"));
  }
  if (a.source === "custom") acts.append(h("button", { class: "btn ghost sm d", title: "Quitar de la suite (no desinstala la app)", onclick: async () => { if (!confirm(`¿Quitar ${a.name} de la suite? No se desinstala.`)) return; try { await api("/api/unregister", { method: "POST", headers: HDR, body: JSON.stringify({ id: a.id }) }); toast(`${a.name} quitada`, "ok"); refresh(); } catch (e) { toast(e.message, "bad"); } } }, "Quitar"));
  const hint = a.state === "missing" ? h("div", { class: "hint" }, `El servicio «${a.service}» no está instalado.` + (a.dir ? " Instálalo con ./install.sh --apps " + a.id + " (en la carpeta de la suite)." : " Se instala aparte: consulta su repositorio.")) : null;
  const od = a.mode === "ondemand";
  return h("article", { class: "card " + a.state },
    h("div", { class: "head" },
      h("div", { class: "ico", style: `background:hsl(${hue(a.id)} 45% 30% / .55)` }, a.emoji),
      h("div", {}, h("div", { class: "nm" }, a.name), h("div", { class: "cat" }, a.category)),
      h("span", { class: "pill " + a.state }, h("i", { class: "dot" }), STATE[a.state])),
    h("div", { class: "tag" }, a.tagline),
    a.state === "missing" ? hint : h("div", { class: "stats" },
      h("div", { class: "stat" }, h("span", {}, "Puerto"), h("b", {}, a.port)),
      h("div", { class: "stat" }, h("span", {}, "Activa"), h("b", {}, fmtUp(a.uptime))),
      h("div", { class: "stat" }, h("span", {}, "RAM"), h("b", {}, sb ? "0 (en espera)" : fmtKb(a.mem_kb))),
      h("div", { class: "stat" }, h("span", {}, "CPU"), h("b", {}, a.cpu == null ? "—" : a.cpu.toFixed(1) + "%"))),
    acts,
    a.state === "missing" || !st.od.enabled ? null : h("div", { class: "mrow" }, h("label", { class: "tg" }, h("input", { type: "checkbox", checked: !od, disabled: st.busy.has("od"), onchange: e => setAlways(a.id, e.target.checked) }), h("span", {}, "Siempre encendida")),
      h("span", { class: "hint" }, od ? `Bajo demanda: se apaga a los ${st.od.idle_minutes} min sin uso y se despierta al abrirla.` : a.note ? "⚠ " + a.note : "")));
}

async function setAlways(id, always) {
  st.busy.add("od");
  try { const cur = new Set(st.od.always || []); always ? cur.add(id) : cur.delete(id); st.od = await api("/api/ondemand", { method: "POST", headers: HDR, body: JSON.stringify({ always: [...cur] }) }); toast(always ? "Quedará siempre encendida" : "Quedará bajo demanda", "ok"); }
  catch (e) { toast(e.message, "bad"); }
  st.busy.delete("od"); refresh();
}
async function saveOd(patch) {
  try { st.od = await api("/api/ondemand", { method: "POST", headers: HDR, body: JSON.stringify(patch) }); toast("Guardado", "ok"); refresh(); } catch (e) { toast(e.message, "bad"); refresh(); }
}

function render() {
  const od = st.od, sbn = st.apps.filter(a => a.state === "standby").length;
  put($("#appsbox"), h("div", { class: "od" }, h("b", {}, "💤 Apps bajo demanda"),
    h("label", { class: "tg" }, h("input", { type: "checkbox", checked: !!od.enabled, onchange: e => saveOd({ enabled: e.target.checked }) }), h("span", {}, "Activado")),
    h("span", { class: "hint" }, "Se apagan tras"), h("input", { class: "num", type: "number", min: 2, max: 240, value: od.idle_minutes || 20, disabled: !od.enabled, onchange: e => { const n = parseInt(e.target.value, 10); if (!(n >= 2 && n <= 240)) { toast("Entre 2 y 240 minutos", "bad"); e.target.value = od.idle_minutes; return; } saveOd({ idle_minutes: n }); } }), h("span", { class: "hint" }, "min sin uso y se despiertan solas al abrirlas."),
    h("span", { class: "grow" }), od.enabled ? h("span", { class: "hint" }, sbn ? `${sbn} en espera · ahorras ~${fmtKb(od.saved_kb)}` : "Ninguna en espera ahora") : null));
  const g = $("#grid"); g.replaceChildren(...st.apps.map(card),
    h("button", { class: "card add", onclick: openAdd }, h("div", { class: "plus" }, "+"), h("b", {}, "Añadir una app"), h("span", { class: "hint" }, "Registra otra herramienta de la suite")));
  drawRail();
}

async function refresh() {
  if (document.hidden && st.apps.length) return;
  try {
    const r = await api("/api/apps"); st.apps = r.apps; st.cfg = r.config_dir; st.unread = r.unread || 0; try { st.od = await api("/api/ondemand"); } catch {}
    const b = $("#banner"); b.hidden = !r.errors.length; if (r.errors.length) b.textContent = "Hay descriptores con problemas: " + r.errors.join(" · ");
    render();
  } catch (e) { $("#grid").replaceChildren(h("div", { class: "hint" }, "No se pudo leer el estado: " + e.message)); }
}

/* logs */
async function loadLogs() {
  if (!st.logId) return;
  try {
    const { text } = await api("/api/logs?id=" + encodeURIComponent(st.logId)), p = $("#dlog");
    const end = p.scrollTop + p.clientHeight >= p.scrollHeight - 30;
    p.textContent = text.trim() || "(sin registros)"; if (end) p.scrollTop = p.scrollHeight;
  } catch (e) { $("#dlog").textContent = "Error: " + e.message; }
}
function showLogs(a) {
  st.logId = a.id; $("#dtitle").textContent = `Logs de ${a.name} (${a.service})`; $("#dlog").textContent = "Cargando…"; $("#drawer").hidden = false;
  loadLogs().then(() => { $("#dlog").scrollTop = $("#dlog").scrollHeight; });
  clearInterval(st.logTimer); st.logTimer = setInterval(loadLogs, 2500);
}
$("#dclose").onclick = () => { $("#drawer").hidden = true; st.logId = null; clearInterval(st.logTimer); };
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#drawer").hidden) $("#dclose").click(); });

/* añadir app */
function openAdd() { $("#cfgdir").textContent = st.cfg; $("#adderr").textContent = ""; $("#addform").reset(); $("#add").showModal(); }
$("#addform").addEventListener("submit", async e => {
  if (e.submitter && e.submitter.value !== "ok") return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData($("#addform")));
  const slug = f.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  try {
    await api("/api/register", { method: "POST", headers: HDR, body: JSON.stringify({ ...f, id: slug, port: Number(f.port) }) });
    $("#add").close(); toast(`${f.name} añadida a la suite`, "ok"); refresh();
  } catch (err) { $("#adderr").textContent = err.message; }
});


/* ---------- marco: barra lateral + vistas + apps dentro ---------- */
const TABS = [["panel", "Panel", "🩺"], ["maint", "Mantenimiento", "🧰"], ["feed", "Avisos", "🔔"], ["modes", "Modos", "🎛️"], ["apps", "Gestionar apps", "⚙️"]];
const VIEWS = ["panel", "maint", "apps", "feed", "modes"];
function drawRail() {
  put($("#rnav"), TABS.map(([id, l, ic]) => h("button", { class: "rb" + (st.view === id ? " on" : ""), title: l, onclick: () => go(id) }, h("span", { class: "ic" }, ic), h("span", { class: "l" }, l), id === "feed" && st.unread ? h("span", { class: "badge" }, st.unread > 99 ? "99+" : st.unread) : null)));
  put($("#rapps"), st.apps.filter(a => a.state !== "missing").map(a => h("button", { class: "rb" + (st.view === "app" && st.appId === a.id ? " on" : ""), title: `${a.name} · ${STATE[a.state]}`, onclick: () => go("app/" + a.id) }, h("span", { class: "ic" }, a.emoji), h("span", { class: "l" }, a.name), h("i", { class: "st " + a.state }))));
  const run = st.apps.filter(a => a.state === "running").length, sb = st.apps.filter(a => a.state === "standby").length, mem = st.apps.reduce((t, a) => t + (a.mem_kb || 0), 0);
  put($("#chips"), h("div", {}, h("b", {}, `${run} de ${st.apps.length}`), " en marcha" + (sb ? ` · ${sb} 💤` : "")), h("div", {}, "RAM ", h("b", {}, fmtKb(mem))));
  document.title = (st.unread ? `(${st.unread}) ` : "") + "ZOO Linux";
}
const drawTabs = drawRail;
function showFrame(on) { $("#frame").hidden = !on; $("#bar").hidden = !on; $("#main").hidden = on; }
function go(v, fpath) {
  clearTimeout(st.vt);
  const m = /^app\/([a-z0-9-]+)$/.exec(v);
  if (m) { st.view = "app"; st.appId = m[1]; st.fpath = fpath || ""; try { location.hash = v; } catch {} drawRail(); return loadFrame(); }
  st.view = v; try { location.hash = v; } catch {}
  unloadFrame(); showFrame(false);
  for (const id of VIEWS) $("#v-" + id).hidden = id !== v;
  drawRail(); ({ panel: viewPanel, maint: viewMaint, apps: render, feed: viewFeed, modes: viewModes })[v]();
}
function unloadFrame() { const f = $("#appframe"); if (f.getAttribute("src") && f.getAttribute("src") !== "about:blank") f.src = "about:blank"; }  // al salir se descarga: una pestaña oculta que sondea mantendría despierta a la app
function loadFrame() {
  const a = st.apps.find(x => x.id === st.appId), ph = $("#ph"), f = $("#appframe");
  showFrame(true);
  if (!a) { f.src = "about:blank"; ph.hidden = false; put(ph, h("div", {}, h("div", { class: "e" }, "🐾"), h("h3", {}, "App desconocida"), h("button", { class: "btn", onclick: () => go("apps") }, "Volver"))); put($("#bar"), h("b", {}, "—")); return; }
  put($("#bar"), h("div", { class: "ico", style: `background:hsl(${hue(a.id)} 45% 30% / .55)` }, a.emoji), h("b", { class: "nm" }, a.name), h("span", { class: "pill " + a.state }, h("i", { class: "dot" }), STATE[a.state]), h("span", { class: "grow" }),
    h("button", { class: "btn sm", title: "Recargar", onclick: () => { f.src = a.url + st.fpath; } }, "↻ Recargar"), h("a", { class: "btn sm", href: a.url + st.fpath, target: "_blank", rel: "noopener" }, "↗ Pestaña nueva"));
  if (a.state === "stopped" || a.state === "failed") {
    f.src = "about:blank"; ph.hidden = false;
    put(ph, h("div", {}, h("div", { class: "e" }, a.emoji), h("h3", {}, `${a.name} está ${a.state === "failed" ? "con error" : "detenida"}`), h("p", { class: "hint" }, a.tagline), h("button", { class: "btn p", onclick: async () => { await act(a, "start", "iniciada"); loadFrame(); } }, "Iniciar y abrir"), a.state === "failed" ? h("button", { class: "btn", onclick: () => showLogs(a) }, "Ver logs") : null));
    return;
  }
  ph.hidden = true;
  const url = a.url + st.fpath;
  if (f.getAttribute("src") !== url) f.src = url;   // si está en espera, el marco muestra la pantalla «Despertando…» y recarga sola
}
$("#collapse").onclick = () => { const on = $("#shell").classList.toggle("min"); try { localStorage.setItem("zoo-rail-min", on ? "1" : ""); } catch {} };
try { if (localStorage.getItem("zoo-rail-min")) $("#shell").classList.add("min"); } catch {}
const ago = t => { const s = Date.now() / 1000 - t; return s < 90 ? "ahora" : s < 3600 ? `hace ${Math.round(s / 60)} min` : s < 86400 ? `hace ${Math.round(s / 3600)} h` : new Date(t * 1000).toLocaleDateString("es", { day: "numeric", month: "short" }) + " " + new Date(t * 1000).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }); };
const LVL = { ok: "ok", info: "info", warn: "warn", bad: "bad", mut: "mut" };
async function openTerminal(cmd, title) {
  try { const r = await api("/api/terminal", { method: "POST", headers: HDR, body: JSON.stringify({ cmd, title }) }); toast(`Terminal abierta (${r.terminal}). Revisa el comando y confirma allí.`, "ok"); }
  catch (e) { toast(e.message, "bad"); }
}
const cmdBox = (cmd, title) => [h("pre", { class: "cmd" }, cmd), h("div", { class: "acts" },
  h("button", { class: "btn p sm", type: "button", onclick: () => openTerminal(cmd, title) }, "Abrir en terminal"),
  h("button", { class: "btn sm", type: "button", onclick: async e => { try { await navigator.clipboard.writeText(cmd); e.target.textContent = "Copiado ✓"; } catch { toast("Selecciona el comando y copia con Ctrl+C"); } } }, "Copiar"))];

/* ---------- panel de salud ---------- */
async function viewPanel() {
  const box = $("#v-panel");
  try {
    const [d, m, f] = await Promise.all([api("/api/health"), api("/api/modes"), api("/api/feed?limit=4")]);
    if (st.view !== "panel") return;
    st.unread = d.unread || 0; drawTabs();
    const need = d.cards.filter(c => c.level === "warn" || c.level === "bad");
    const openApp = id => { const a = st.apps.find(x => x.id === id); if (a && a.state !== "missing") go("app/" + id); else if (a) toast(`${a.name} no está instalada`, "bad"); };
    const act = m.active && m.modes.find(x => x.id === m.active.id);
    put(box, h("h2", { class: "vt" }, "Panel"), h("div", { class: "vs" }, "El estado de tu equipo de un vistazo. Pulsa una tarjeta para abrir su herramienta."),
      h("div", { class: "alertbar" }, need.length ? h("div", { class: "tip " + (need.some(c => c.level === "bad") ? "bad" : "warn") }, `${need.some(c => c.level === "bad") ? "⛔" : "⚠"} ${need.length === 1 ? "Una cosa necesita" : need.length + " cosas necesitan"} atención: `, h("b", {}, need.map(c => c.title).join(", "))) : h("div", { class: "tip ok" }, "✔ Todo en orden")),
      h("div", { class: "hgrid" }, d.cards.map(c => h(c.app ? "button" : "div", { class: "hc " + (LVL[c.level] || "mut"), onclick: c.app ? () => openApp(c.app) : null },
        h("div", { class: "t" }, c.emoji, c.title), h("div", { class: "v" }, c.value), h("div", { class: "s" }, c.sub)))),
      h("div", { class: "sec" }, "Modos rápidos"), h("div", { class: "qm" }, m.modes.map(x => h("button", { class: "btn" + (m.active && m.active.id === x.id ? " p" : ""), onclick: () => applyMode(x.id) }, `${x.emoji} ${x.name}`)),
        act ? h("span", { class: "hint" }, `Activo: ${act.name}` + (m.active.matches === false ? " (cambiado a mano)" : "")) : h("span", { class: "hint" }, "Ninguno activo"), h("button", { class: "btn ghost sm", onclick: () => go("modes") }, "Ver modos")),
      h("div", { class: "sec" }, "Últimos avisos"), h("div", { class: "panelbox" }, f.events.length ? f.events.map(feedRow(f.read_to)) : h("div", { class: "hint", style: "padding:14px" }, "Sin avisos. Cuando algo importante pase, aparecerá aquí.")),
      f.events.length ? h("div", { style: "margin-top:8px" }, h("button", { class: "btn ghost sm", onclick: () => go("feed") }, "Ver todos los avisos →")) : null);
  } catch (e) { put(box, h("div", { class: "hint" }, "No se pudo cargar el panel: " + e.message)); }
  if (st.view === "panel") st.vt = setTimeout(viewPanel, 6000);
}

/* ---------- avisos ---------- */
const feedRow = readTo => e => h("div", { class: `feedrow ${e.level}` + (e.t > readTo && e.level !== "info" ? " new" : "") }, h("i", { class: "lv" }),
  h("div", {}, h("div", { class: "tt" }, h("span", { class: "src" }, e.source), e.title), e.body ? h("div", { class: "bd" }, e.body) : null,
    e.dnd ? h("div", { class: "bd" }, "🔕 No salió en pantalla: «No molestar» estaba activado.") : (e.desktop && !e.notified ? h("div", { class: "bd" }, "No se pudo mostrar en el escritorio.") : null)),
  h("div", { class: "tm" }, ago(e.t)));
async function viewFeed() {
  const box = $("#v-feed");
  try {
    const f = await api("/api/feed"); if (st.view !== "feed") return;
    const srcs = [...new Set(f.events.map(e => e.source))], sel = st.src && srcs.includes(st.src) ? st.src : null, list = f.events.filter(e => !sel || e.source === sel);
    put(box, h("h2", { class: "vt" }, "Avisos"), h("div", { class: "vs" }, "Todo lo importante de la suite en un solo sitio: temperaturas y batería (Chameleon), disco, memoria, servicios caídos y apps que fallan."),
      f.dnd ? h("div", { class: "alertbar" }, h("div", { class: "tip warn" }, "🔕 «No molestar» está activado en COSMIC: los avisos no salen en pantalla (aquí sí quedan guardados). Desactívalo desde el icono de notificaciones del panel para verlos.")) : null,
      h("div", { class: "chips", style: "margin:0 0 12px;justify-content:flex-start" }, [h("button", { class: "chip" + (!sel ? " on" : ""), onclick: () => { st.src = null; viewFeed(); } }, "Todos"), ...srcs.map(x => h("button", { class: "chip" + (sel === x ? " on" : ""), onclick: () => { st.src = x; viewFeed(); } }, x))],
        h("span", { class: "grow" }), h("button", { class: "btn sm", onclick: async () => { await api("/api/feed/read", { method: "POST", headers: HDR, body: "{}" }); st.unread = 0; drawTabs(); viewFeed(); } }, "Marcar como leídos"),
        h("button", { class: "btn ghost sm d", onclick: async () => { if (!confirm("¿Vaciar todo el registro de avisos?")) return; await api("/api/feed/clear", { method: "POST", headers: HDR, body: "{}" }); viewFeed(); } }, "Vaciar")),
      h("div", { class: "panelbox" }, list.length ? list.map(feedRow(f.read_to)) : h("div", { class: "hint", style: "padding:18px" }, "Todavía no hay avisos. Todo tranquilo 🙂")));
    if (f.unread && !st.markT) st.markT = setTimeout(async () => { st.markT = null; if (st.view === "feed") { try { await api("/api/feed/read", { method: "POST", headers: HDR, body: "{}" }); st.unread = 0; drawTabs(); } catch {} } }, 3000);
  } catch (e) { put(box, h("div", { class: "hint" }, "No se pudo cargar: " + e.message)); }
  if (st.view === "feed") st.vt = setTimeout(viewFeed, 15000);
}

/* ---------- modos ---------- */
const PN = { battery: "Batería", balanced: "Equilibrado", performance: "Rendimiento" };
function showResult(res) {
  $("#mrt").textContent = res.mode === "revert" ? "Vuelta al estado anterior" : `Modo ${res.name}`;
  put($("#mrs"), res.steps.map(s => h("li", {}, h("span", { class: s.ok ? "y" : "n" }, s.ok ? "✔ " : "✘ "), h("b", {}, s.step), ` · ${s.detail}`)));
  put($("#mrc"), res.terminal_cmd ? [h("div", { class: "hint", style: "margin-top:12px" }, "Para terminar hacen falta permisos de administrador. Tu escritorio no deja pedirlos desde aquí: abre una terminal (te muestro el comando y solo se ejecuta si tú confirmas allí)."), cmdBox(res.terminal_cmd, "ZOO Linux (modos)")] : null);
  $("#mres").showModal();
}
async function applyMode(id) {
  try { const r = await api("/api/modes/apply", { method: "POST", headers: HDR, body: JSON.stringify({ id }) }); showResult(r); refresh(); if (st.view === "modes") viewModes(); if (st.view === "panel") viewPanel(); }
  catch (e) { toast(e.message, "bad"); }
}
async function revertMode() {
  try { const r = await api("/api/modes/revert", { method: "POST", headers: HDR, body: "{}" }); showResult(r); refresh(); viewModes(); }
  catch (e) { toast(e.message, "bad"); }
}
async function viewModes() {
  const box = $("#v-modes");
  try {
    const m = await api("/api/modes"); if (st.view !== "modes") return;
    const name = id => (st.apps.find(a => a.id === id) || { name: id }).name;
    put(box, h("h2", { class: "vt" }, "Modos"), h("div", { class: "vs" }, "Cambian varias cosas de una vez. Guardo cómo estaba todo ANTES del primer modo, y «Volver a como estaba» siempre te lleva ahí. Si cambias de un modo a otro, devuelvo a su valor original lo que el anterior tocó y el nuevo no (por ejemplo «No molestar»), sin pisar lo que hayas cambiado tú."),
      m.errors.length ? h("div", { class: "alertbar" }, m.errors.map(e => h("div", { class: "tip warn" }, e))) : null,
      m.hint ? h("div", { class: "alertbar" }, h("div", { class: "tip info" }, "🎮 " + m.hint)) : null,
      h("div", { class: "mgrid" }, m.modes.map(x => {
        const on = m.active && m.active.id === x.id;
        return h("article", { class: "mc" + (on ? " on" : "") }, h("div", { class: "head" }, h("div", { class: "big" }, x.emoji), h("div", {}, h("div", { class: "nm" }, x.name), on ? h("span", { class: "pill running" }, h("i", { class: "dot" }), m.active.matches === false ? "Activo (cambiado a mano)" : "Activo") : null)),
          h("div", { class: "tag", style: "min-height:0" }, x.desc),
          on && m.hold && m.hold.by === "zoo:" + x.id ? h("div", { class: "hint" }, "⏸ Chameleon no cambia el perfil por su cuenta (al enchufar/desenchufar) mientras este modo esté activo. Si lo cambias tú a mano, se reanuda.") : null,
          h("ul", {}, x.profile ? h("li", {}, "Perfil de energía: " + PN[x.profile]) : null, x.brightness != null ? h("li", {}, `Brillo: ${x.brightness} %`) : null, x.dnd != null ? h("li", {}, "No molestar: " + (x.dnd ? "activado (los avisos no saldrán en pantalla)" : "desactivado")) : null, x.start_apps.length ? h("li", {}, "Inicia: " + x.start_apps.map(name).join(", ")) : null,
            x.stop_apps.length ? h("li", {}, "Detiene: " + x.stop_apps.map(name).join(", ")) : null, x.sudo.length ? h("li", {}, "Con administrador (en terminal): " + x.sudo.map(c => c.replace(/^systemctl /, "")).join("; ")) : null),
          h("div", { class: "acts" }, h("button", { class: "btn p", onclick: () => applyMode(x.id) }, on ? "Volver a aplicar" : "Activar")));
      })),
      h("div", { style: "margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap" }, m.can_revert ? h("button", { class: "btn", onclick: revertMode }, "↩ Volver a como estaba") : null,
        h("span", { class: "hint" }, "Puedes cambiar o añadir modos editando ", h("code", {}, "~/.config/zoo-linux/modes.json"), ".")));
  } catch (e) { put(box, h("div", { class: "hint" }, "No se pudo cargar: " + e.message)); }
}

/* ---------- mantenimiento guiado ---------- */
const MI = { ok: "✔", info: "ℹ️", warn: "⚠️", bad: "⛔", pending: "·", running: "⏳" };
async function viewMaint() {
  const box = $("#v-maint");
  try {
    const m = await api("/api/maintenance"); if (st.view !== "maint") return;
    const sm = m.summary, lvl = sm.worst === "bad" ? "bad" : sm.attention ? "warn" : "ok";
    const msg = m.running ? `Revisando… ${sm.done} de ${m.checks.length}` : !m.finished ? "Aún no has hecho ninguna revisión." : sm.attention ? `${sm.attention} cosa${sm.attention > 1 ? "s" : ""} por atender` + (sm.info ? ` · ${sm.info} de interés` : "") : sm.info ? `Todo en orden · ${sm.info} detalle${sm.info > 1 ? "s" : ""} de interés` : "Todo en orden";
    put(box, h("h2", { class: "vt" }, "Mantenimiento"), h("div", { class: "vs" }, "Una revisión rápida del equipo. Solo mira: no cambia nada. Cada punto te lleva a la herramienta que lo arregla."),
      h("div", { class: "sum" }, h("button", { class: "btn p", disabled: m.running, onclick: async () => { await api("/api/maintenance/run", { method: "POST", headers: HDR, body: "{}" }); viewMaint(); } }, m.running ? "⏳ Revisando…" : "Revisar todo"),
        h("div", { class: "tip " + (m.running ? "info" : m.finished ? lvl : "info"), style: "margin:0" }, msg), m.finished ? h("span", { class: "hint" }, "Última revisión: " + ago(m.finished)) : null),
      h("div", { class: "panelbox" }, m.checks.map(c => h("div", { class: `ck ${c.status}` }, h("div", { class: "ci" }, c.status === "running" ? h("span", { class: "spin" }, "⏳") : MI[c.status] || "·"),
        h("div", {}, h("div", { class: "ct" }, c.emoji + " " + c.title), c.headline ? h("div", { class: "ch" }, c.headline) : h("div", { class: "cd" }, c.status === "pending" ? "Pendiente" : "Comprobando…"), c.detail ? h("div", { class: "cd" }, c.detail) : null),
        c.action ? h("button", { class: "btn sm", onclick: () => go("app/" + c.action.app, c.action.path) }, c.action.label + " →") : null))));
    if (m.running) st.vt = setTimeout(viewMaint, 1000);
  } catch (e) { put(box, h("div", { class: "hint" }, "No se pudo cargar: " + e.message)); }
}

const v0 = location.hash.slice(1);
refresh().then(() => { st.view = VIEWS.includes(v0) ? v0 : /^app\/[a-z0-9-]+$/.test(v0) ? "app" : "panel"; go(/^app\//.test(v0) || VIEWS.includes(v0) ? v0 : "panel"); });
setInterval(refresh, 3000);
