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
const HDR = { "Content-Type": "application/json", "X-Bee": "1" };
const TYPES = [["service", "Servicios", "⚙️"], ["socket", "Sockets", "🔌"], ["timer", "Temporizadores", "⏱️"], ["path", "Rutas", "📂"], ["mount", "Montajes", "💾"], ["target", "Objetivos", "🎯"], ["slice", "Slices", "🍰"], ["boot", "Arranque", "🚀"], ["login", "Inicio de sesión", "🚪"], ["cron", "Cron", "⏰"]];
const SPECIAL = new Set(["boot", "login", "cron"]);
const put = (el, ...k) => { el.replaceChildren(...k.flat().filter(x => x != null && x !== false)); return el; };
const st = { scope: "user", type: "service", filter: "all", sort: "name", units: {}, sum: null, sel: new Set(), show: 150, cur: null, dtab: "estado", d: null, dTimer: null, lTimer: null, logO: { n: 200, grep: "", prio: false, follow: true }, token: 0 };
const ACT_LBL = { active: "activo", inactive: "inactivo", failed: "con error", activating: "iniciando", deactivating: "parando", reloading: "recargando" };
const DONE = { start: "iniciado", stop: "detenido", restart: "reiniciado", reload: "recargado", enable: "habilitado", disable: "deshabilitado", "enable-now": "habilitado e iniciado", "disable-now": "deshabilitado y detenido", "reset-failed": "error limpiado", mask: "enmascarado", unmask: "desenmascarado" };

/* pkexec sin agente de contraseñas: diálogo con el comando para pegar en una terminal */
function terminalDialog(cmd, msg) {
  return new Promise(res => {
    const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
    const d = el("dialog", "width:min(760px,92vw);border:1px solid var(--line,#999);border-radius:16px;background:var(--panel,#fff);color:var(--fg,#111);padding:20px 22px");
    const pre = el("pre", "background:var(--bg,#f4f4f4);border:1px solid var(--line,#ccc);border-radius:10px;padding:10px 12px;font:12px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-all;max-height:240px;overflow:auto;user-select:all;margin:10px 0", cmd);
    const copy = el("button", "", "Copiar comando"); copy.className = "btn sm"; copy.type = "button";
    copy.onclick = async () => { try { await navigator.clipboard.writeText(cmd); copy.textContent = "Copiado ✓"; } catch { const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r); copy.textContent = "Selecciónalo y copia con Ctrl+C"; } };
    const term = el("button", "", "Abrir en terminal"); term.className = "btn p sm"; term.type = "button";
    term.onclick = async () => { try { const r = await fetch("/api/terminal", { method: "POST", headers: HDR, body: JSON.stringify({ cmd }) }); const j = await r.json().catch(() => ({})); term.textContent = r.ok ? "Terminal abierta ✓ (confirma allí)" : (j.error || "No se pudo abrir"); } catch { term.textContent = "No se pudo abrir"; } };
    const no = el("button", "", "Cancelar"); no.className = "btn ghost"; no.type = "button"; no.onclick = () => d.close("no");
    const ok = el("button", "", "Ya lo ejecuté"); ok.className = "btn p"; ok.type = "button"; ok.onclick = () => d.close("yes");
    const row = el("div", "display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:12px"); row.append(term, copy, no, ok);
    d.append(el("h3", "margin:0 0 8px", "Hace falta una terminal"), el("div", "color:var(--mut,#666)", msg), pre, el("div", "color:var(--mut,#666);font-size:12.5px", "Revisa el comando antes de ejecutarlo. Cuando termine, pulsa «Ya lo ejecuté»."), row);
    d.addEventListener("close", () => { const v = d.returnValue === "yes"; d.remove(); res(v); });
    document.body.append(d); d.showModal();
  });
}
async function api(path, opts) {
  const r = await fetch(path, opts), j = await r.json().catch(() => ({}));
  if (!r.ok && j.terminal_cmd) { const ok = await terminalDialog(j.terminal_cmd, j.error); if (ok) setTimeout(() => location.reload(), 500); const e = new Error(ok ? "Listo: actualizando…" : "Cancelado."); e.data = j; e.status = r.status; e.terminal = true; throw e; }
  if (!r.ok) { const e = new Error(j.error || j.output || "Error " + r.status); e.data = j; e.status = r.status; throw e; }
  return j;
}
const post = (p, b) => api(p, { method: "POST", headers: HDR, body: JSON.stringify(b) });
function toast(m, k = "") { const t = h("div", { class: "toast " + k }, m); $("#toasts").append(t); setTimeout(() => t.remove(), 4500); }
const short = n => n.replace(/\.(service|socket|timer|path|mount|target|slice)$/, "").replace(/\\x([0-9a-f]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16)));
const fmtB = b => b == null ? "—" : b >= 1073741824 ? (b / 1073741824).toFixed(2) + " GB" : b >= 1048576 ? (b / 1048576).toFixed(b >= 10485760 ? 0 : 1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
const rel = us => { if (!us) return "—"; const d = (us / 1000 - Date.now()) / 1000, a = Math.abs(d); const t = a < 90 ? Math.round(a) + " s" : a < 5400 ? Math.round(a / 60) + " min" : a < 172800 ? Math.round(a / 3600) + " h" : Math.round(a / 86400) + " d"; return d >= 0 ? "en " + t : "hace " + t; };

/* ---------- diálogo de confirmación (con confirmación escrita opcional) ---------- */
function ask(title, text, ok = "Aceptar", typed = null) {
  $("#dtitle").textContent = title; $("#dtext").textContent = text; $("#dok").textContent = ok;
  const box = $("#typed"), inp = $("#typedin"); box.hidden = !typed; inp.value = "";
  $("#dok").disabled = !!typed; if (typed) { $("#typedname").textContent = typed; inp.oninput = () => { $("#dok").disabled = inp.value.trim() !== typed; }; setTimeout(() => inp.focus(), 50); }
  const d = $("#dlg"); d.returnValue = ""; d.showModal();
  return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true }));
}

/* ---------- barra lateral ---------- */
function drawNav() {
  const nav = $("#nav"); nav.replaceChildren();
  const s = st.sum && st.sum[st.scope];
  for (const [id, label, ic] of TYPES) {
    const x = id === "login" || id === "cron" ? (st.sum && st.sum[id]) : (s && s[id]), b = h("button", { class: st.type === id ? "on" : "", onclick: () => go(st.scope, id) }, h("span", { class: "ic" }, ic), h("span", { class: "l" }, label));
    if (x && x.failed) b.append(h("span", { class: "bad" }, x.failed)); else if (x) b.append(h("span", { class: "cnt" }, x.total));
    nav.append(b);
  }
  document.querySelectorAll("#scope button").forEach(b => b.classList.toggle("on", b.dataset.v === st.scope));
}
const FILTERS = [["all", "Todos"], ["active", "Activos"], ["failed", "Con error"], ["inactive", "Inactivos"], ["enabled", "Habilitados"], ["disabled", "Deshabilitados"], ["masked", "Enmascarados"]];
function drawChips() {
  const c = $("#chips"); c.replaceChildren(); if (SPECIAL.has(st.type)) return;
  const all = st.units[key()] || [];
  for (const [id, l] of FILTERS) {
    const n = all.filter(u => match(u, id)).length;
    c.append(h("button", { class: "chip" + (id === "failed" ? " bad" : "") + (st.filter === id ? " on" : ""), onclick: () => { st.filter = id; st.show = 150; drawChips(); renderList(); } }, l, all.length ? ` ${n}` : ""));
  }
}
const key = () => st.scope + "/" + st.type;
function go(scope, type, unit) {
  const changed = scope !== st.scope || type !== st.type;
  st.scope = scope; st.type = type; if (changed) { st.sel.clear(); st.filter = "all"; st.show = 150; $("#q").value = ""; }
  closeDrawer(); try { location.hash = `${scope}/${type}`; } catch {}
  const CB = { "user/service": "+ Crear servicio", "user/timer": "+ Crear temporizador", "user/login": "+ Añadir app de inicio", "user/cron": "+ Añadir tarea", "system/login": "+ Añadir app de inicio", "system/cron": "+ Añadir tarea" }[`${scope}/${type}`];
  $("#create").hidden = !CB; if (CB) $("#create").textContent = CB;
  $("#scope").hidden = type === "login" || type === "cron";
  $("#sort").hidden = SPECIAL.has(type); $(".search").style.visibility = type === "boot" ? "hidden" : "";
  drawNav(); drawChips(); drawBulk(); load(true).then(() => unit && unit !== "_new" && openDrawer(unit)); if (unit === "_new") $("#create").click();
}

/* ---------- datos ---------- */
async function load(first) {
  if (st.type === "boot") return loadBoot();
  if (st.type === "login") return loadLogin();
  if (st.type === "cron") return loadCron();
  const my = ++st.token, k = key();
  if (first && !st.units[k]) $("#list").replaceChildren(...Array.from({ length: 9 }, () => h("div", { class: "skel" })));
  try { const u = await api(`/api/units?scope=${st.scope}&type=${st.type}`); if (my !== st.token) return; st.units[k] = u; }
  catch (e) { return $("#list").replaceChildren(h("div", { class: "empty" }, "Error: " + e.message)); }
  drawChips(); renderList();
}
async function refreshSummary() { try { st.sum = await api("/api/summary"); drawNav(); } catch {} }
function match(u, f) {
  if (f === "active") return u.active === "active"; if (f === "failed") return u.active === "failed"; if (f === "inactive") return u.active === "inactive";
  if (f === "enabled") return u.file === "enabled" || u.file === "enabled-runtime"; if (f === "disabled") return u.file === "disabled"; if (f === "masked") return u.file === "masked" || u.file === "masked-runtime";
  return true;
}
function filtered() {
  const q = $("#q").value.trim().toLowerCase(), all = st.units[key()] || [];
  const rank = { failed: 0, activating: 1, deactivating: 1, reloading: 1, active: 2, inactive: 3 };
  return all.filter(u => (!q || u.name.toLowerCase().includes(q) || u.desc.toLowerCase().includes(q)) && match(u, st.filter))
    .sort(st.sort === "mem" ? (a, b) => (b.mem || -1) - (a.mem || -1) : st.sort === "state" ? (a, b) => (rank[a.active] ?? 4) - (rank[b.active] ?? 4) || a.name.localeCompare(b.name) : (a, b) => a.name.localeCompare(b.name));
}
function stateLabel(u) { return u.active === "active" ? u.sub : (ACT_LBL[u.active] || u.active); }
function row(u) {
  const sel = st.sel.has(u.name), qa = h("div", { class: "qa" });
  if (!u.protected && u.file !== "masked") {
    if (u.active === "active") qa.append(h("button", { class: "btn sm", title: "Reiniciar", onclick: e => { e.stopPropagation(); act([u.name], "restart"); } }, "⟳"), h("button", { class: "btn sm d", title: "Detener", onclick: e => { e.stopPropagation(); act([u.name], "stop"); } }, "■"));
    else qa.append(h("button", { class: "btn sm", title: "Iniciar", onclick: e => { e.stopPropagation(); act([u.name], "start"); } }, "▶"));
  }
  const desc = st.type === "timer" && u.next ? `próximo ${rel(u.next)} · último ${rel(u.last)} · activa ${u.activates || "—"}` : (u.desc || "—");
  const r = h("div", { class: "row" + (sel ? " sel" : "") + (st.cur && st.cur.name === u.name && st.cur.scope === st.scope ? " active" : ""), onclick: () => openDrawer(u.name) },
    h("input", { type: "checkbox", checked: sel, onclick: e => e.stopPropagation(), onchange: e => { e.target.checked ? st.sel.add(u.name) : st.sel.delete(u.name); r.classList.toggle("sel", e.target.checked); drawBulk(); } }),
    h("div", { class: "nm" }, h("div", { class: "n" }, h("span", { class: "t" }, short(u.name)), h("span", { class: "tag " + u.file }, u.file), u.protected && h("span", { class: "tag", title: "Unidad protegida: pedirá confirmación escrita" }, "🔒")), h("div", { class: "d", title: desc }, desc)),
    h("div", { class: "mem" }, st.type === "service" ? (u.mem != null ? fmtB(u.mem) : "") : ""),
    h("div", { class: "st " + u.active }, h("i", { class: "dot " + u.active }), stateLabel(u)), qa);
  return r;
}
function renderList() {
  const list = $("#list"), items = filtered(), all = st.units[key()] || [], msg = $("#msg");
  const failed = all.filter(u => u.active === "failed");
  msg.replaceChildren(`${items.length} de ${all.length}`);
  if (failed.length && st.type !== "target") msg.append(h("button", { class: "btn sm", onclick: () => act(failed.map(u => u.name), "reset-failed", { confirm: false }) }, `Limpiar ${failed.length} error${failed.length > 1 ? "es" : ""}`));
  if (!items.length) return list.replaceChildren(h("div", { class: "empty" }, h("div", { class: "big" }, "🐝"), h("b", {}, all.length ? "Sin resultados" : "No hay unidades de este tipo"), h("div", {}, all.length ? "Prueba con otro filtro o búsqueda." : "")));
  const allSel = items.every(u => st.sel.has(u.name));
  const head = h("div", { class: "lhead" }, h("input", { type: "checkbox", checked: allSel, title: "Seleccionar todo lo visible", onchange: e => { items.forEach(u => e.target.checked ? st.sel.add(u.name) : st.sel.delete(u.name)); renderList(); drawBulk(); } }), h("span", {}, "Nombre"), h("span", { style: "text-align:right" }, st.type === "service" ? "Memoria" : ""), h("span", {}, "Estado"), h("span", {}));
  put(list, head, items.slice(0, st.show).map(row), items.length > st.show ? h("button", { class: "btn more", onclick: () => { st.show += 150; renderList(); } }, `Mostrar más (${items.length - st.show})`) : null);
}

/* ---------- acciones ---------- */
const VERB = { stop: "Detener", restart: "Reiniciar", disable: "Deshabilitar", "disable-now": "Deshabilitar y detener", mask: "Enmascarar", reload: "Recargar" };
async function act(names, action, o = {}) {
  const scope = o.scope || st.scope, risky = Object.keys(VERB).includes(action), many = names.length > 1;
  if (risky && o.confirm !== false) {
    const what = many ? `${names.length} unidades` : short(names[0]);
    const extra = action === "mask" ? "\nUna unidad enmascarada no se puede iniciar ni siquiera a mano hasta que la desenmascares." : "";
    if (!(await ask(`${VERB[action]} ${what}`, (scope === "system" ? "Son unidades de sistema: te pedirá tu contraseña.\n" : "Se aplicará ahora mismo.") + extra, "Continuar"))) return false;
  }
  let force = false;
  for (;;) {
    try { await post("/api/action", { scope, names, action, force }); toast(`${many ? names.length + " unidades" : short(names[0])}: ${DONE[action]}`, "ok"); break; }
    catch (e) {
      if (e.status === 409 && e.data && e.data.protected && !force) {
        const p = e.data.protected, tp = p.length === 1 ? short(p[0]) : "CONFIRMAR";
        if (!(await ask("⚠ Unidad protegida", `${p.map(short).join(", ")}\n\nDetenerla, reiniciarla o deshabilitarla puede dejar el equipo sin red, sin sesión gráfica o inutilizable. Solo continúa si sabes lo que haces.`, "Entiendo el riesgo, continuar", tp))) return false;
        force = true; continue;
      }
      toast(`${many ? "Acción" : short(names[0])}: ${e.message}`, "bad"); break;
    }
  }
  st.sel.clear(); drawBulk(); await Promise.all([load(), refreshSummary()]); if (st.cur) loadDetail(); return true;
}
function drawBulk() {
  const b = $("#bulk"), n = st.sel.size; b.hidden = !n; if (!n) return;
  const names = [...st.sel], btn = (l, a, cls = "") => h("button", { class: "btn sm " + cls, onclick: () => act(names, a) }, l);
  b.replaceChildren(h("b", {}, `${n} seleccionada${n > 1 ? "s" : ""}`), btn("▶ Iniciar", "start"), btn("⟳ Reiniciar", "restart"), btn("■ Detener", "stop", "d"), btn("Habilitar", "enable"), btn("Deshabilitar", "disable"), btn("Limpiar error", "reset-failed"),
    h("button", { class: "btn sm", onclick: () => { st.sel.clear(); drawBulk(); renderList(); } }, "✕"));
}

/* ---------- panel de detalle ---------- */
function closeDrawer() { $("#drawer").hidden = true; st.cur = null; clearInterval(st.dTimer); clearInterval(st.lTimer); document.querySelectorAll(".row.active").forEach(r => r.classList.remove("active")); }
async function openDrawer(name) {
  st.cur = { name, scope: st.scope }; st.dtab = "estado"; document.querySelectorAll(".row.active").forEach(r => r.classList.remove("active"));
  $("#drawer").hidden = false; $("#drawer").replaceChildren(h("div", { class: "dh" }, h("h2", {}, short(name))), h("div", { class: "dbody" }, h("div", { class: "skel" })));
  await loadDetail(); clearInterval(st.dTimer); st.dTimer = setInterval(() => { if (st.dtab === "estado" && !document.hidden) loadDetail(); }, 3000);
}
async function loadDetail() {
  if (!st.cur) return; const { name, scope } = st.cur;
  try { st.d = await api(`/api/unit?scope=${scope}&name=${encodeURIComponent(name)}`); }
  catch (e) { $("#drawer").replaceChildren(h("div", { class: "dh" }, h("button", { class: "btn ghost x", onclick: closeDrawer }, "✕"), h("h2", {}, short(name))), h("div", { class: "dbody" }, h("div", { class: "empty" }, e.message))); return; }
  if (st.dtab === "estado" || !$("#drawer").querySelector(".dtabs")) drawDetail();
}
const XL = { Listen: "Escucha en", Where: "Montado en", What: "Origen", TimersCalendar: "Calendario", TimersMonotonic: "Temporizador", NextElapseUSecRealtime: "Próxima ejecución", LastTriggerUSec: "Última ejecución", Unit: "Activa", PathChanged: "Vigila cambios en", PathExists: "Vigila existencia de", PathModified: "Vigila modificaciones de", MemoryMax: "Límite de memoria", CPUQuotaPerSecUSec: "Cuota de CPU" };
function drawDetail() {
  const d = st.d, scope = st.cur.scope, n = d.name, A = (l, a, cls = "") => h("button", { class: "btn sm " + cls, onclick: () => act([n], a, { scope }) }, l);
  const act1 = [], masked = d.file === "masked" || d.file === "masked-runtime";
  if (!masked) {
    act1.push(d.active === "active" ? A("■ Detener", "stop", "d") : A("▶ Iniciar", "start"));
    if (d.active === "active" && d.type !== "target" && d.type !== "slice") act1.push(A("⟳ Reiniciar", "restart"));
    if (d.file === "enabled") act1.push(A("Deshabilitar", "disable")); else if (!["static", "generated", "transient", "alias", "indirect"].includes(d.file)) act1.push(A("Habilitar", "enable"));
  }
  if (d.active === "failed") act1.push(A("Limpiar error", "reset-failed"));
  const more = h("details", { class: "menu" }, h("summary", { class: "btn sm" }, "Más ▾"), h("div", { class: "pop" },
    h("button", { onclick: () => act([n], "enable-now", { scope }) }, "Habilitar e iniciar"), h("button", { onclick: () => act([n], "disable-now", { scope }) }, "Deshabilitar y detener"),
    masked ? h("button", { onclick: () => act([n], "unmask", { scope }) }, "Desenmascarar") : (/\/\.config\/systemd\/user\/|^\/etc\/systemd\/system\//.test(d.path || "") ? null : h("button", { class: "d2", onclick: () => act([n], "mask", { scope }) }, "Enmascarar (impedir arranque)")),
    d.type === "service" && d.active === "active" ? h("button", { onclick: () => act([n], "reload", { scope }) }, "Recargar configuración") : null));
  act1.push(more);
  if (d.type === "timer" && scope === "user" && d.timer_last) act1.unshift(h("button", { class: "btn sm p", title: "Ejecuta ahora el servicio que activa este temporizador", onclick: () => act([d.timer_last.service], "start", { scope, confirm: false }) }, "▶ Ejecutar ahora"));
  if (d.deletable) {
    if (d.fields) act1.push(h("button", { class: "btn sm", onclick: () => openCreate(d) }, "✎ Editar"));
    act1.push(h("button", { class: "btn sm d", onclick: async () => { if (await ask("Eliminar " + short(n), (d.type === "timer" ? "Se detendrá y se borrarán el temporizador y el servicio que ejecuta." : "Se detendrá, se deshabilitará y se borrará su archivo de unidad.") + "\nSolo se pueden eliminar unidades creadas con Bee.", "Eliminar")) { try { await post("/api/delete", { name: n }); toast("Servicio eliminado", "ok"); closeDrawer(); load(); refreshSummary(); } catch (e) { toast(e.message, "bad"); } } } }, "Eliminar"));
  }
  const kv = h("dl", { class: "kv" }), add = (k, v) => v != null && v !== "" && v !== "0" && v !== "[not set]" && kv.append(h("dt", {}, k), h("dd", {}, v));
  add("Estado", `${ACT_LBL[d.active] || d.active} (${d.sub})`); add("Habilitado", d.file); add("Activo desde", d.since); add("PID principal", d.pid);
  add("Memoria", d.mem != null ? fmtB(d.mem) : null); add("CPU", d.cpu != null ? d.cpu + " %" : null); add("Tareas", d.tasks);
  add("Reinicios", d.restarts); if (d.timer_last) add("Último resultado", `${d.timer_last.result === "success" ? "correcta" : (d.timer_last.result || "—")} (código ${d.timer_last.status})` + (d.timer_last.when && d.timer_last.when !== "n/a" ? " · " + d.timer_last.when : "")); add("Resultado", d.result); add("Reiniciar si", d.restart_policy); add("Tipo", d.type === "service" ? null : d.type); add("Usuario", d.user); add("Carpeta", d.workdir);
  for (const [k, v] of Object.entries(d.extra || {})) add(XL[k] || k, k === "MemoryMax" && /^\d+$/.test(v) ? fmtB(+v) : v);
  add("Comando", d.exec); add("Archivo", d.path); add("Ajustes (drop-in)", d.dropins); add("Lanzado por", d.triggered_by); add("Lanza", d.triggers);
  const tabs = h("div", { class: "dtabs" }, ...[["estado", "Estado"], ["logs", "Logs"], ["unit", "Unidad"], ["deps", "Dependencias"]].map(([id, l]) => h("button", { class: st.dtab === id ? "on" : "", onclick: () => { st.dtab = id; drawDetail(); } }, l)));
  clearInterval(st.lTimer); let body;
  if (st.dtab === "estado") body = h("div", {}, d.protected ? h("div", { class: "warn" }, "🔒 Unidad protegida: detenerla o reiniciarla puede dejar el equipo inutilizable. Bee te pedirá una confirmación escrita.") : null,
    masked ? h("div", { class: "warn" }, "Esta unidad está enmascarada: no se puede iniciar hasta que la desenmascares.") : null,
    scope === "system" ? h("div", { class: "mut", style: "font-size:12px;margin-bottom:8px" }, "Las acciones sobre unidades de sistema piden tu contraseña.") : null, kv,
    d.status ? h("pre", { class: "log", style: "margin-top:14px;max-height:280px" }, d.status) : null);
  else if (st.dtab === "logs") body = logsView(d);
  else if (st.dtab === "deps") body = depsView(d);
  else body = h("div", {}, h("pre", { class: "log" }, d.unit_text || "(no se puede leer el archivo de unidad)"));
  $("#drawer").replaceChildren(h("div", { class: "dh" }, h("button", { class: "btn ghost x", onclick: closeDrawer }, "✕"), h("h2", {}, h("i", { class: "dot " + d.active }), short(n)), h("div", { class: "d mut" }, d.desc || ""), h("div", { class: "acts" }, act1)), tabs, h("div", { class: "dbody" }, body));
}
function logsView(d) {
  const o = st.logO, pre = h("pre", { class: "log" }, "Cargando…");
  const tick = async () => { try { const q = `/api/logs?scope=${st.cur.scope}&name=${encodeURIComponent(d.name)}&n=${o.n}&prio=${o.prio ? "err" : ""}&grep=${encodeURIComponent(o.grep)}`; const { text } = await api(q); const end = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30; pre.textContent = text.trim() || "(sin registros)"; if (end || !pre.dataset.f) { pre.scrollTop = pre.scrollHeight; pre.dataset.f = "1"; } } catch (e) { pre.textContent = e.message; } };
  let deb; const sel = h("select", { onchange: e => { o.n = +e.target.value; tick(); } }, ...[100, 200, 500, 1000].map(v => h("option", { value: v, selected: v === o.n }, v + " líneas")));
  const tool = h("div", { class: "ltool" }, sel, h("input", { placeholder: "Filtrar texto…", value: o.grep, oninput: e => { o.grep = e.target.value; clearTimeout(deb); deb = setTimeout(tick, 350); } }),
    h("label", { class: "chk", style: "display:flex;gap:6px;align-items:center;font-size:12.5px" }, h("input", { type: "checkbox", checked: o.prio, onchange: e => { o.prio = e.target.checked; tick(); } }), "Solo errores"),
    h("label", { class: "chk", style: "display:flex;gap:6px;align-items:center;font-size:12.5px" }, h("input", { type: "checkbox", checked: o.follow, onchange: e => { o.follow = e.target.checked; } }), "Seguir"));
  tick(); st.lTimer = setInterval(() => { if (o.follow && !document.hidden) tick(); }, 2500);
  return h("div", {}, tool, pre);
}
function depsView(d) {
  const pre = h("pre", { class: "log" }, "Cargando…"), box = h("div", {}); let rev = false;
  const load2 = async () => { pre.textContent = "Cargando…"; try { pre.textContent = (await api(`/api/deps?scope=${st.cur.scope}&name=${encodeURIComponent(d.name)}&reverse=${rev ? 1 : 0}`)).text || "(ninguna)"; } catch (e) { pre.textContent = e.message; } };
  box.append(h("div", { class: "ltool" }, h("button", { class: "btn sm", onclick: e => { rev = false; load2(); } }, "De qué depende"), h("button", { class: "btn sm", onclick: () => { rev = true; load2(); } }, "Qué depende de ella")), pre); load2(); return box;
}

/* ---------- crear / editar servicio ---------- */
function openCreate(d) {
  const f = $("#newform"), edit = !!(d && d.fields); f.reset(); $("#newerr").textContent = ""; f.dataset.edit = edit ? d.name : "";
  $("#newtitle").textContent = edit ? "Editar " + short(d.name) : "Crear servicio de usuario"; $("#newok").textContent = edit ? "Guardar" : "Crear";
  $("#startlbl").textContent = edit ? "Reiniciar ahora para aplicar los cambios" : "Habilitar y arrancar ahora";
  f.name.readOnly = edit; if (edit) { f.name.value = d.name.replace(/\.service$/, ""); f.description.value = d.fields.description; f.exec.value = d.fields.exec; f.workdir.value = d.fields.workdir; f.restart.value = d.fields.restart; }
  $("#newdlg").showModal();
}
$("#create").onclick = () => ({ service: () => openCreate(), timer: openTimerDlg, login: openLoginDlg, cron: () => openCronDlg() })[st.type]();
$("#newform").addEventListener("submit", async e => {
  if (e.submitter && e.submitter.value !== "ok") return;
  e.preventDefault(); const f = Object.fromEntries(new FormData($("#newform"))), edit = $("#newform").dataset.edit; const on = !!f.start; delete f.start;
  try {
    if (edit) { await post("/api/update", { ...f, name: edit, restart_now: on }); toast("Servicio actualizado", "ok"); $("#newdlg").close(); load(); if (st.cur) loadDetail(); }
    else { const r = await post("/api/create", { ...f, start: on }); $("#newdlg").close(); toast(`Servicio ${short(r.name)} creado`, "ok"); go("user", "service"); refreshSummary(); }
  } catch (er) { $("#newerr").textContent = er.message; }
});

/* ---------- análisis de arranque ---------- */
async function loadBoot() {
  const my = ++st.token; $("#chips").replaceChildren(); $("#msg").textContent = ""; const list = $("#list"); list.replaceChildren(h("div", { class: "skel" }), h("div", { class: "skel" }));
  try {
    const b = await api("/api/boot?scope=" + st.scope); if (my !== st.token) return;
    const line = (b.summary[0] || ""), cards = h("div", { class: "cards" });
    for (const m of line.matchAll(/([\d.]+(?:min [\d.]+)?m?s?)\s*\((\w+)\)/g)) cards.append(h("div", { class: "card" }, h("span", {}, m[2]), h("b", {}, m[1])));
    const tot = line.match(/=\s*(.+)$/); if (tot) cards.append(h("div", { class: "card", style: "border-color:var(--acc)" }, h("span", {}, "Total"), h("b", {}, tot[1])));
    if (!cards.children.length) cards.append(h("div", { class: "card" }, h("span", {}, "Arranque"), h("b", { style: "font-size:14px" }, line || "sin datos")));
    const max = Math.max(1, ...b.blame.map(x => x.ms)), fmt = ms => ms >= 60000 ? (ms / 60000).toFixed(1) + " min" : ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms) + " ms";
    list.replaceChildren(h("div", { class: "msg" }, st.scope === "system" ? "Cuánto tardó cada servicio de sistema en arrancar (los que más tardan, arriba)" : "Servicios de usuario más lentos al iniciar sesión"), cards,
      ...b.blame.map(x => h("div", { class: "brow", style: /\.(service|socket|timer|path|mount|target|slice)$/.test(x.unit) ? "" : "cursor:default", onclick: () => { const t = x.unit.split(".").pop(); if (TYPES.some(y => y[0] === t && t !== "boot")) go(st.scope, t, x.unit); }, title: x.unit }, h("div", { class: "bar", style: `width:${100 * x.ms / max}%` }), h("span", {}, short(x.unit)), h("span", { class: "tm" }, fmt(x.ms)))));
  } catch (e) { list.replaceChildren(h("div", { class: "empty" }, "Error: " + e.message)); }
}

/* ---------- ventana modal genérica ---------- */
function modal(title, body, okLabel, onOk, intro) {
  $("#gtitle").textContent = title; put($("#gbody"), intro ? h("p", { class: "mut", style: "margin:0 0 12px;font-size:13px" }, intro) : null, body); $("#gerr").textContent = ""; $("#gok").textContent = okLabel;
  $("#gok").hidden = !onOk; const dlg = $("#gdlg");
  $("#gform").onsubmit = async e => { if (e.submitter && e.submitter.value !== "ok") return; e.preventDefault(); try { if (onOk) await onOk(); dlg.close(); } catch (er) { $("#gerr").textContent = er.message; } };
  dlg.showModal();
}
const field = (label, input, help) => h("label", {}, label, input, help ? h("div", { class: "help" }, help) : null);
const when = ts => new Date(ts * 1000).toLocaleString("es", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const relS = ts => { const d = ts - Date.now() / 1000, a = Math.abs(d), t = a < 90 ? Math.round(a) + " s" : a < 5400 ? Math.round(a / 60) + " min" : a < 172800 ? Math.round(a / 3600) + " h" : Math.round(a / 86400) + " d"; return d >= 0 ? "en " + t : "hace " + t; };
const DOW_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"], DOW_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const slug = s => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/* ---------- selector de horario (cron y temporizadores) ---------- */
function schedPicker(kind, initial) {
  const cron = kind === "cron";
  const PRE = [["every-min", "Cada N minutos"], ["hourly", "Cada hora"], ["daily", "Todos los días"], ["weekdays", "De lunes a viernes"], ["weekly", "Una vez por semana"], ["monthly", "Una vez al mes"],
    ...(cron ? [["boot", "Al iniciar el equipo"]] : [["interval", "Cada N horas (desde ahora)"], ["boot", "Al iniciar sesión (tras N minutos)"]]), ["custom", cron ? "Personalizada (5 campos)…" : "Personalizada (OnCalendar)…"]];
  const pre = h("select", {}, ...PRE.map(([v, l]) => h("option", { value: v }, l))), n = h("input", { type: "number", min: 1, max: 59, value: 15, style: "width:80px" }), tm = h("input", { type: "time", value: "08:30" }),
    dow = h("select", {}, ...DOW_ES.map((d, i) => h("option", { value: i, selected: i === 1 }, d))), dom = h("input", { type: "number", min: 1, max: 31, value: 1, style: "width:80px" }),
    custom = h("input", { placeholder: cron ? "*/5 * * * *   o   @daily" : "Mon..Fri 09:00   o   *:0/15", style: "width:100%" }), prev = h("div", { class: "prev" });
  const row = (label, el, key) => h("label", { "data-k": key }, label, el);
  const rows = [row("Cada (minutos)", n, "n"), row("A las", tm, "tm"), row("Día de la semana", dow, "dow"), row("Día del mes", dom, "dom"), row(cron ? "Programación" : "Horario (OnCalendar)", custom, "custom")];
  const SHOW = { "every-min": ["n"], hourly: ["n"], daily: ["tm"], weekdays: ["tm"], weekly: ["tm", "dow"], monthly: ["tm", "dom"], interval: ["n"], boot: ["n"], custom: ["custom"] };
  const hm = () => { const [H, M] = (tm.value || "08:30").split(":").map(Number); return [H, M]; };
  function value() {
    const p = pre.value, N = Math.max(1, +n.value || 1), [H, M] = hm(), D = +dow.value, DM = Math.min(31, Math.max(1, +dom.value || 1)), pad = x => String(x).padStart(2, "0");
    if (cron) return { schedule: { "every-min": `*/${N} * * * *`, hourly: `${Math.min(59, Math.max(0, +n.value || 0))} * * * *`, daily: `${M} ${H} * * *`, weekdays: `${M} ${H} * * 1-5`, weekly: `${M} ${H} * * ${D}`, monthly: `${M} ${H} ${DM} * *`, boot: "@reboot", custom: custom.value.trim() }[p] };
    const cal = { "every-min": `*:0/${N}`, hourly: `*:${pad(Math.min(59, Math.max(0, +n.value || 0)))}`, daily: `*-*-* ${pad(H)}:${pad(M)}`, weekdays: `Mon..Fri *-*-* ${pad(H)}:${pad(M)}`, weekly: `${DOW_EN[D]} *-*-* ${pad(H)}:${pad(M)}`, monthly: `*-*-${DM} ${pad(H)}:${pad(M)}`, custom: custom.value.trim() }[p];
    if (p === "interval") return { mode: "interval", seconds: N * 3600 };
    if (p === "boot") return { mode: "boot", seconds: N * 60 };
    return { mode: "calendar", calendar: cal };
  }
  let deb, seq = 0;
  async function refresh() {
    rows.forEach(r => r.hidden = !SHOW[pre.value].includes(r.dataset.k));
    n.max = pre.value === "hourly" ? 59 : pre.value === "every-min" ? 59 : 999; const labelN = rows[0].firstChild; labelN.textContent = { "every-min": "Cada (minutos)", hourly: "En el minuto", interval: "Cada (horas)", boot: "Esperar (minutos)" }[pre.value] || "Cada";
    const v = value(), expr = cron ? v.schedule : v.mode === "calendar" ? v.calendar : null, my = ++seq; clearTimeout(deb);
    if (!cron && v.mode !== "calendar") return put(prev, h("div", {}, v.mode === "interval" ? `Se ejecutará cada ${v.seconds / 3600} h, empezando ya.` : `Se ejecutará una vez, ${v.seconds / 60} min después de iniciar sesión (ahora mismo si ya pasó ese tiempo).`));
    if (!expr) return put(prev, h("div", { class: "mut" }, "Escribe un horario…"));
    deb = setTimeout(async () => {
      try {
        if (cron) { const r = await api("/api/cron-preview?expr=" + encodeURIComponent(expr)); if (my !== seq) return; put(prev, h("b", {}, r.human[0].toUpperCase() + r.human.slice(1)), r.next.length ? h("div", { class: "mut" }, "Próximas: " + r.next.map(when).join(" · ")) : null); }
        else { const r = await api("/api/calendar?expr=" + encodeURIComponent(expr)); if (my !== seq) return; put(prev, h("b", {}, r.normalized), h("div", { class: "mut" }, "Próximas: " + r.next.slice(0, 3).join(" · "))); }
      } catch (e) { if (my === seq) put(prev, h("div", { style: "color:var(--bad)" }, e.message)); }
    }, 250);
  }
  const DEF = { "every-min": 15, hourly: 0, interval: 6, boot: 5 };
  [pre, n, tm, dow, dom, custom].forEach(x => x.addEventListener("input", refresh));
  pre.addEventListener("change", () => { if (pre.value in DEF) n.value = DEF[pre.value]; n.min = pre.value === "hourly" ? 0 : 1; refresh(); });
  if (initial) { pre.value = "custom"; custom.value = initial; }
  const el = h("div", { class: "sched" }, field("Cuándo", pre), ...rows, prev); refresh();
  return { el, value };
}

/* ---------- inicio de sesión (autostart) ---------- */
const LG = { rows: [], f: "all" };
async function loadLogin(quiet) {
  const my = ++st.token; $("#chips").replaceChildren();
  if (!quiet) put($("#list"), ...Array.from({ length: 6 }, () => h("div", { class: "skel" })));
  try { const r = await api("/api/login"); if (my !== st.token || st.type !== "login") return; LG.rows = r; } catch (e) { return put($("#list"), h("div", { class: "empty" }, "Error: " + e.message)); }
  paintLogin();
}
function paintLogin() {
  const list = $("#list"), q = $("#q").value.trim().toLowerCase(), all = LG.rows;
  const F = [["all", "Todas"], ["on", "Activadas"], ["off", "Desactivadas"], ["user", "Mías"], ["system", "Del sistema"], ["na", "No aplican a mi escritorio"]];
  const test = e => ({ all: true, on: e.enabled, off: !e.enabled, user: e.source === "user", system: e.source === "system", na: !e.applies }[LG.f]);
  const rows = all.filter(e => test(e) && (!q || (e.name + e.exec + e.comment + e.file).toLowerCase().includes(q)));
  $("#msg").textContent = `${rows.length} de ${all.length} apps de inicio`;
  const chips = h("div", { class: "chips", style: "padding:0 0 10px" }, ...F.map(([k, l]) => h("button", { class: "chip" + (LG.f === k ? " on" : ""), onclick: () => { LG.f = k; paintLogin(); } }, l, ` ${all.filter(e => ({ all: true, on: e.enabled, off: !e.enabled, user: e.source === "user", system: e.source === "system", na: !e.applies }[k])).length}`)));
  const note = h("div", { class: "mut", style: "font-size:12.5px;margin:2px 0 10px" }, "Los cambios se aplican en el próximo inicio de sesión. Para actuar ahora usa ▶ / ■ (cuando la entrada ya tiene su unidad de systemd).");
  put(list, chips, note, rows.length ? rows.map(lrow) : h("div", { class: "empty" }, h("div", { class: "big" }, "🐝"), "Sin resultados"));
}
function lrow(e) {
  const sw = h("button", { class: "sw", role: "switch", "aria-checked": String(e.enabled), title: e.enabled ? "Desactivar" : "Activar", onclick: async ev => { ev.stopPropagation(); try { await post("/api/login/toggle", { file: e.file, enable: !e.enabled }); toast(`${e.name}: ${e.enabled ? "desactivada" : "activada"} (próximo inicio de sesión)`, "ok"); } catch (er) { toast(er.message, "bad"); } loadLogin(true); refreshSummary(); } }, h("i"));
  const state = e.running ? "en marcha" : e.has_unit ? (e.state === "failed" ? "con error" : "detenida") : "sin unidad aún";
  const qa = h("div", { class: "qa", style: "opacity:1" });
  if (e.has_unit) qa.append(e.running ? h("button", { class: "btn sm d", title: "Detener ahora", onclick: ev => { ev.stopPropagation(); act([e.unit], "stop", { scope: "user" }); } }, "■") : h("button", { class: "btn sm", title: "Iniciar ahora", onclick: ev => { ev.stopPropagation(); act([e.unit], "start", { scope: "user", confirm: false }); } }, "▶"));
  if (e.bee) qa.append(h("button", { class: "btn sm d", title: "Eliminar", onclick: async ev => { ev.stopPropagation(); if (await ask("Eliminar " + e.name, "Se borra el archivo de ~/.config/autostart. Solo se pueden eliminar apps creadas con Bee.", "Eliminar")) { try { await post("/api/login/delete", { file: e.file }); toast("Eliminada", "ok"); } catch (er) { toast(er.message, "bad"); } loadLogin(true); refreshSummary(); } } }, "🗑"));
  return h("div", { class: "lrow", onclick: () => openLoginDrawer(e) }, sw,
    h("div", { class: "nm" }, h("div", { class: "n" }, h("span", { class: "t" }, e.name), h("span", { class: "tag" }, e.source === "user" ? "usuario" : "sistema"), e.override && !e.bee_override ? h("span", { class: "tag", title: "Tu archivo reemplaza al del sistema" }, "personalizada") : null, e.bee ? h("span", { class: "tag enabled" }, "Bee") : null, !e.applies ? h("span", { class: "tag masked", title: e.why }, "no aplica a tu escritorio") : null), h("div", { class: "d mono", title: e.exec }, e.exec || "—")),
    h("div", { class: "st " + (e.running ? "active" : e.state === "failed" ? "failed" : "") }, h("i", { class: "dot " + (e.running ? "active" : e.state === "failed" ? "failed" : "") }), state), qa);
}
function openLoginDrawer(e) {
  const kv = h("dl", { class: "kv" }), add = (k, v) => v && kv.append(h("dt", {}, k), h("dd", { class: k === "Comando" || k === "Archivo" ? "mono" : "" }, v));
  add("Estado", e.enabled ? "activada" : "desactivada"); add("Origen", e.source === "user" ? "tu carpeta ~/.config/autostart" : "sistema (/etc/xdg/autostart)"); add("Comando", e.exec); add("Comentario", e.comment); add("Retraso", e.delay ? e.delay + " s" : ""); add("Archivo", e.path);
  add("Unidad de systemd", e.has_unit ? `${e.unit} (${e.state})` : "se genera al iniciar sesión si está activada"); if (!e.applies) add("Por qué no aplica", e.why + " (tu escritorio no es ese, así que no se ejecuta)");
  const d = $("#drawer"); d.hidden = false;
  put(d, h("div", { class: "dh" }, h("button", { class: "btn ghost x", onclick: closeDrawer }, "✕"), h("h2", {}, e.name), h("div", { class: "d mut" }, e.file), e.has_unit ? h("div", { class: "acts" }, h("button", { class: "btn sm", onclick: () => go("user", "service", e.unit) }, "Ver unidad y logs →")) : null), h("div", { class: "dbody" }, kv));
}
function openLoginDlg() {
  const title = h("input", { required: true, placeholder: "Mi aplicación" }), id = h("input", { pattern: "[a-z0-9][a-z0-9\\-]*", maxlength: 41, placeholder: "mi-aplicacion", required: true }), cmd = h("input", { required: true, placeholder: "/usr/bin/python3 /home/usuario/mi-app/server.py" }), com = h("input", { placeholder: "Qué hace (opcional)" }), delay = h("input", { type: "number", min: 0, max: 600, value: 0, style: "width:90px" });
  let edited = false; id.oninput = () => { edited = true; }; title.oninput = () => { if (!edited) id.value = slug(title.value); };
  modal("Añadir app de inicio", h("div", {}, field("Nombre", title), field("Identificador", id), field("Comando", cmd), field("Descripción", com), field("Esperar al iniciar sesión (segundos)", delay, "Útil para apps pesadas: así no frenan el arranque del escritorio.")), "Añadir", async () => { await post("/api/login/create", { name: id.value, title: title.value, exec: cmd.value, comment: com.value, delay: +delay.value }); toast("App de inicio añadida", "ok"); loadLogin(true); refreshSummary(); }, "Se ejecutará cada vez que inicies sesión. Se guarda en ~/.config/autostart y no necesita permisos de administrador.");
}

/* ---------- cron ---------- */
const CR = { data: null };
async function loadCron(quiet) {
  const my = ++st.token; $("#chips").replaceChildren();
  if (!quiet) put($("#list"), h("div", { class: "skel" }), h("div", { class: "skel" }));
  try { const r = await api("/api/cron"); if (my !== st.token || st.type !== "cron") return; CR.data = r; } catch (e) { return put($("#list"), h("div", { class: "empty" }, "Error: " + e.message)); }
  paintCron();
}
function paintCron() {
  const d = CR.data, list = $("#list"); if (!d) return;
  if (!d.available) return put(list, h("div", { class: "empty" }, h("div", { class: "big" }, "⏰"), h("b", {}, "cron no está instalado"), h("div", {}, "Puedes programar tareas con los temporizadores de systemd (pestaña Temporizadores)."))), $("#msg").replaceChildren();
  const q = $("#q").value.trim().toLowerCase(), jobs = d.entries.filter(e => e.kind === "job" && (!q || (e.command + e.schedule + e.human).toLowerCase().includes(q))), nEnv = d.entries.filter(e => e.kind === "env").length;
  $("#msg").textContent = `${jobs.length} tarea${jobs.length === 1 ? "" : "s"} tuyas · servicio cron ${d.service === "active" ? "activo" : "INACTIVO"}`;
  const mine = jobs.length ? h("div", {}, ...jobs.map(crow)) : h("div", { class: "empty" }, h("div", { class: "big" }, "⏰"), h("b", {}, "No tienes tareas de cron"), h("div", {}, "Pulsa «+ Añadir tarea» para programar un comando."));
  const sys = d.system, dirs = Object.entries(sys.dirs).filter(([, v]) => v.length);
  const sysBox = h("details", { class: "sysbox" }, h("summary", {}, `Tareas del sistema (solo lectura) · ${sys.jobs.length} programadas + ${dirs.reduce((t, [, v]) => t + v.length, 0)} scripts periódicos`),
    h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...["Archivo", "Usuario", "Cuándo", "Comando"].map(x => h("th", {}, x)))), h("tbody", {}, ...sys.jobs.map(j => h("tr", {}, h("td", { class: "mono" }, j.file.replace("/etc/", "")), h("td", {}, j.user), h("td", {}, j.human), h("td", { class: "mono", style: "word-break:break-all" }, j.command.slice(0, 120)))))),
    ...dirs.map(([per, v]) => h("div", { class: "help", style: "margin-top:8px" }, h("b", {}, { hourly: "Cada hora", daily: "Diarias", weekly: "Semanales", monthly: "Mensuales" }[per] + ": "), v.join(", "))));
  put(list, h("div", { class: "sect" }, "Mis tareas (crontab)"), mine, nEnv ? h("div", { class: "help" }, `${nEnv} variable${nEnv > 1 ? "s" : ""} de entorno en tu crontab (se conservan y se aplican a las tareas siguientes).`) : null,
    h("div", { class: "sect" }, "Sistema"), sysBox, h("div", { class: "help", style: "margin-top:12px" }, `Bee guarda una copia de tu crontab antes de cada cambio (${d.backups} copia${d.backups === 1 ? "" : "s"} en ~/.local/share/bee/crontab).`));
}
function crow(e) {
  const sw = h("button", { class: "sw", role: "switch", "aria-checked": String(e.enabled), title: e.enabled ? "Desactivar" : "Activar", onclick: () => cronOp({ op: "toggle", i: e.i, expect: e.raw.trim() }, e.enabled ? "Tarea desactivada" : "Tarea activada") }, h("i"));
  const nx = e.enabled && e.next.length ? `${when(e.next[0])} · ${relS(e.next[0])}` : e.schedule === "@reboot" && e.enabled ? "al iniciar" : "—";
  return h("div", { class: "crow" + (e.enabled ? "" : " off") }, sw, h("div", {}, h("div", { class: "n" }, e.human[0].toUpperCase() + e.human.slice(1)), h("div", { class: "d mono" }, e.schedule)), h("div", { class: "mut", style: "font-size:12.5px" }, nx), h("div", { class: "mono", style: "word-break:break-all;font-size:12px", title: e.command }, e.command),
    h("div", { class: "qa", style: "opacity:1" }, h("button", { class: "btn sm", title: "Ejecutar ahora", onclick: () => cronRun(e) }, "▶"), h("button", { class: "btn sm", title: "Editar", onclick: () => openCronDlg(e) }, "✎"), h("button", { class: "btn sm d", title: "Eliminar", onclick: async () => { if (await ask("Eliminar tarea", `${e.human}\n${e.command}`, "Eliminar")) cronOp({ op: "delete", i: e.i, expect: e.raw.trim() }, "Tarea eliminada"); } }, "🗑")));
}
async function cronOp(b, msg) { try { await post("/api/cron/op", b); toast(msg, "ok"); } catch (e) { toast(e.message, "bad"); } loadCron(true); refreshSummary(); }
async function cronRun(e) {
  if (!(await ask("Ejecutar ahora", `Se ejecutará una vez, ahora, con tu usuario:\n${e.command}`, "Ejecutar"))) return;
  toast("Ejecutando…");
  try { const r = await post("/api/cron/run", { i: e.i, expect: e.raw.trim() }); modal(r.code === 0 ? "✔ Terminó correctamente" : r.code === null ? "⏱ Sigue en ejecución" : `✘ Terminó con código ${r.code}`, h("pre", { class: "log", style: "max-height:300px" }, r.output.trim() || "(sin salida)"), "", null, `Tardó ${r.seconds} s.`); } catch (er) { toast(er.message, "bad"); }
}
function openCronDlg(e) {
  const sp = schedPicker("cron", e && e.schedule), cmd = h("input", { required: true, value: e ? e.command : "", placeholder: "/home/usuario/scripts/copia.sh" });
  modal(e ? "Editar tarea" : "Añadir tarea de cron", h("div", {}, sp.el, field("Comando", cmd, "Se ejecuta con tu usuario y tu entorno de cron (PATH reducido: usa rutas completas).")), e ? "Guardar" : "Añadir", async () => {
    const schedule = sp.value().schedule; if (!schedule) throw new Error("Falta el horario");
    await post("/api/cron/op", e ? { op: "edit", i: e.i, expect: e.raw.trim(), schedule, command: cmd.value } : { op: "add", schedule, command: cmd.value }); toast(e ? "Tarea actualizada" : "Tarea añadida", "ok"); loadCron(true); refreshSummary();
  }, "Se guarda en tu crontab. Bee hace una copia de seguridad antes de cada cambio.");
}

/* ---------- crear temporizador ---------- */
function openTimerDlg() {
  const name = h("input", { required: true, pattern: "[a-z0-9][a-z0-9\\-]*", maxlength: 41, placeholder: "copia-diaria" }), desc = h("input", { placeholder: "Qué hace" }), cmd = h("input", { required: true, placeholder: "/home/usuario/scripts/copia.sh" }), wd = h("input", { placeholder: "~/proyecto (opcional)" }),
    persist = h("input", { type: "checkbox", checked: true }), rnd = h("select", {}, ...[[0, "ninguno"], [60, "hasta 1 min"], [300, "hasta 5 min"], [900, "hasta 15 min"], [3600, "hasta 1 hora"]].map(([v, l]) => h("option", { value: v }, l))), sp = schedPicker("timer");
  modal("Crear temporizador de systemd", h("div", {}, field("Nombre", name), field("Descripción", desc), field("Comando", cmd, "Se ejecuta como un servicio de systemd (una vez cada vez que salta el temporizador)."), field("Carpeta de trabajo", wd), sp.el,
    h("label", { class: "chk" }, persist, "Si el equipo estaba apagado a la hora, ejecutar al encender (Persistent)"), field("Retraso aleatorio", rnd, "Reparte la carga si varias tareas coinciden.")), "Crear y activar", async () => {
    const r = await post("/api/timer/create", { name: name.value, description: desc.value, command: cmd.value, workdir: wd.value, persistent: persist.checked, random_delay: +rnd.value, ...sp.value() }); toast(`Temporizador ${short(r.name)} creado`, "ok"); go("user", "timer"); refreshSummary();
  }, "Crea un servicio y su temporizador en ~/.config/systemd/user. No necesita permisos de administrador.");
}

/* ---------- arranque de la app ---------- */
document.querySelectorAll("#scope button").forEach(b => b.onclick = () => go(b.dataset.v, st.type));
let deb; $("#q").oninput = () => { clearTimeout(deb); deb = setTimeout(() => { st.show = 150; st.type === "login" ? paintLogin() : st.type === "cron" ? paintCron() : renderList(); }, 120); };
$("#sort").onchange = e => { st.sort = e.target.value; renderList(); };
$("#reload").onclick = () => { st.units = {}; load(true); refreshSummary(); };
$("#reloadd").onclick = async () => { if (!(await ask("Recargar systemd", st.scope === "system" ? "Ejecuta «systemctl daemon-reload» del sistema (pide tu contraseña)." : "Ejecuta «systemctl --user daemon-reload»: relee los archivos de unidad.", "Recargar"))) return; try { await post("/api/reload", { scope: st.scope }); toast("systemd recargado", "ok"); load(); } catch (e) { toast(e.message, "bad"); } };
document.addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); $("#q").focus(); } if (e.key === "Escape") { if (document.activeElement === $("#q")) $("#q").blur(); else closeDrawer(); } });
setInterval(() => { if (!document.hidden && !document.querySelector("dialog[open]") && (st.type === "login" || st.type === "cron")) { st.type === "login" ? loadLogin(true) : loadCron(true); refreshSummary(); }
  if (!document.hidden && !SPECIAL.has(st.type) && !document.querySelector("dialog[open]")) { api(`/api/units?scope=${st.scope}&type=${st.type}`).then(u => { st.units[key()] = u; drawChips(); renderList(); }).catch(() => {}); refreshSummary(); } }, 4000);
const [hs, ht, hu] = location.hash.slice(1).split("/").map(decodeURIComponent);
if (["user", "system"].includes(hs)) st.scope = hs; if (TYPES.some(t => t[0] === ht)) st.type = ht;
refreshSummary(); go(st.scope, st.type, hu);
