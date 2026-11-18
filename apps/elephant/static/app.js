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
const HDR = { "Content-Type": "application/json", "X-Elephant": "1" };
const NAV = [["clean", "Limpieza", "🧹"], ["large", "Archivos grandes", "📦"], ["explore", "Explorador", "🗂️"], ["history", "Historial", "🕘"]];
const OFF = new Set(["huggingface", "ms-playwright", "ms-playwright-go", "arduino", "tauri", "vscode-cpptools", "torch", "whisper"]); // caras de volver a descargar: no se preseleccionan
const LEVEL = { safe: "Seguro", review: "Revisa antes", info: "Info" };
const st = { fl: {}, view: "clean", ov: null, sel: {}, incl: new Set(), init: new Set(), open: new Set(["cache"]), opt: { journal: "200M" }, busy: false, pollT: null, minMb: 100, ex: { path: null, sort: "size", q: "" } };

async function api(path, opts) {
  const r = await fetch(path, opts), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Error " + r.status);
  return j;
}
const post = (p, b) => api(p, { method: "POST", headers: HDR, body: JSON.stringify(b) });
const fmt = b => b >= 1e12 ? (b / 1e12).toFixed(2) + " TB" : b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(0) + " MB" : b >= 1e3 ? (b / 1e3).toFixed(0) + " KB" : b + " B";
const ago = ts => { if (!ts) return "—"; const s = Date.now() / 1000 - ts; return s < 90 ? "ahora" : s < 5400 ? "hace " + Math.round(s / 60) + " min" : s < 172800 ? "hace " + Math.round(s / 3600) + " h" : s < 5184000 ? "hace " + Math.round(s / 86400) + " d" : "hace " + Math.round(s / 2592000) + " meses"; };
function toast(m, k = "") { const t = h("div", { class: "toast " + k }, m); $("#toasts").append(t); setTimeout(() => t.remove(), 4500); }
function ask(title, body, ok = "Aceptar") {
  $("#dtitle").textContent = title; $("#dbody").replaceChildren(...[].concat(body).filter(x => x != null && x !== false && x !== "").map(x => typeof x === "string" ? document.createTextNode(x) : x)); $("#dok").textContent = ok;
  const d = $("#dlg"); d.returnValue = ""; d.showModal();
  return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true }));
}
const cvar = id => `var(--c-${id}, var(--mut))`;
const icoFor = n => { const e = (n.split(".").pop() || "").toLowerCase(); return /^(mp4|mkv|avi|mov|webm)$/.test(e) ? "🎞️" : /^(png|jpg|jpeg|gif|webp|raw|psd)$/.test(e) ? "🖼️" : /^(zip|tar|gz|xz|7z|rar|bz2|zst)$/.test(e) ? "📦" : /^(iso|img|vdi|vmdk|qcow2)$/.test(e) ? "💿" : /^(db|sqlite|sql|mdb)$/.test(e) ? "🗄️" : /^(cache|log|tmp)$/.test(e) ? "🧺" : "📄"; };

/* ---------- navegación ---------- */
function drawNav() {
  $("#nav").replaceChildren(...NAV.map(([id, l, ic]) => h("button", { class: st.view === id ? "on" : "", onclick: () => go(id) }, h("span", { class: "ic" }, ic), h("span", { class: "l" }, l))));
  const d = st.ov && st.ov.disks[0]; if (!d) return;
  const used = d.total - d.free, pct = 100 * used / d.total;
  $("#mini").replaceChildren(h("b", {}, fmt(d.free) + " libres"), h("div", { class: "mut" }, `${pct.toFixed(0)} % de ${fmt(d.total)}`), h("div", { class: "mb" }, h("i", { class: pct >= 90 ? "hot" : "", style: `width:${pct}%` })));
}
function go(v, arg) {
  clearTimeout(st.pollT); st.view = v; try { location.hash = v + (arg ? (arg.startsWith("/") ? arg : "/" + arg) : ""); } catch {}
  drawNav(); $("#main").scrollTop = 0;
  ({ clean: drawClean, large: () => loadLarge(), explore: () => navExplore(arg), history: loadHistory }[v])();
}

/* ---------- limpieza ---------- */
const hasItems = c => !!c.items;
const selSet = c => st.sel[c.id] ||= new Set();
const included = c => hasItems(c) ? selSet(c).size > 0 : st.incl.has(c.id);
const catPick = c => hasItems(c) ? c.items.filter(i => selSet(c).has(i.name)).reduce((t, i) => t + i.size, 0) : (included(c) ? c.size : 0);
function initSel(cats) {
  for (const c of cats) {
    if (st.init.has(c.id) || !c.action) continue; st.init.add(c.id);
    if (c.level !== "safe") continue;
    if (hasItems(c)) c.items.filter(i => !OFF.has(i.name)).forEach(i => selSet(c).add(i.name)); else if (c.size > 0) st.incl.add(c.id);
  }
}
async function loadOverview(force = false) {
  try { st.ov = await api("/api/overview" + (force ? "?force=1" : "")); } catch (e) { return $("#view").replaceChildren(h("div", { class: "empty" }, "Error: " + e.message)); }
  drawNav(); if (st.view === "clean") drawClean();
  if (st.ov.scanning) { clearTimeout(st.ovT); st.ovT = setTimeout(() => loadOverview(), 1200); }
}
function gauge(ov, cats) {
  const d = ov.disks[0], used = d.total - d.free, pct = 100 * used / d.total;
  const segs = cats.filter(c => c.level !== "info" && c.size > 0 && c.action).sort((a, b) => b.size - a.size), rec = segs.reduce((t, c) => t + c.size, 0), recC = Math.min(rec, used);
  const bar = h("div", { class: "gbar" }, h("i", { class: "used", style: `width:${100 * (used - recC) / d.total}%` }, ""),
    ...segs.map(c => h("i", { style: `width:${100 * Math.min(c.size, used) / d.total}%;background:${cvar(c.id)}`, title: `${c.name}: ${fmt(c.size)}`, onclick: () => { const el = $("#cat-" + c.id); if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); } } })));
  return h("section", { class: "gauge" },
    h("div", { class: "row1" }, h("span", { class: "big" }, fmt(d.free) + " libres"), h("span", { class: "mut" }, `de ${fmt(d.total)} en ${d.mount} · ${pct.toFixed(0)} % usado`)), bar,
    h("div", { class: "legend" }, h("span", {}, h("i", { style: "background:var(--used)" }), " En uso ", h("b", {}, fmt(used - recC))), ...segs.map(c => h("button", { onclick: () => bar.querySelector(`[title^="${c.name}"]`)?.click() }, h("i", { style: `background:${cvar(c.id)}` }), c.name.replace(/ \(.*\)/, ""), " ", h("b", {}, fmt(c.size)))), h("span", {}, h("i", { style: "background:var(--hover);border:1px solid var(--line)" }), " Libre ", h("b", {}, fmt(d.free)))),
    !ov.scanning && rec > 0 ? h("div", { class: "promise" }, "Limpiándolo todo pasarías de ", h("b", {}, fmt(d.free)), " a ", h("b", {}, fmt(d.free + rec)), " libres.") : null);
}
function catCard(c, max) {
  const open = st.open.has(c.id), size = hasItems(c) ? catPick(c) : c.size, nItems = hasItems(c) ? c.items.length : 0;
  const act = h("div", { class: "cact" });
  if (c.id === "journal") act.append(h("select", { onchange: e => st.opt.journal = e.target.value }, ...c.options.map(o => h("option", { value: o, selected: o === st.opt.journal }, "dejar " + o))));
  const can = c.action && !(hasItems(c) && !nItems) && (hasItems(c) ? selSet(c).size > 0 : c.size > 0);
  if (c.action && !(hasItems(c) && !nItems)) act.append(h("button", { class: "btn p", disabled: st.busy || !can, onclick: () => cleanOne(c) }, c.action));
  const cb = c.action && !(hasItems(c) && !nItems) ? h("input", { type: "checkbox", checked: included(c), title: "Incluir en «Limpiar selección»", onchange: e => { if (hasItems(c)) { e.target.checked ? c.items.filter(i => !OFF.has(i.name)).forEach(i => selSet(c).add(i.name)) : selSet(c).clear(); } else e.target.checked ? st.incl.add(c.id) : st.incl.delete(c.id); drawClean(); } }) : h("span", { style: "width:16px" });
  const card = h("article", { class: "cat", id: "cat-" + c.id },
    h("div", { class: "chead" }, cb, h("div", { class: "cico" }, c.icon),
      h("div", {}, h("div", { class: "cname" }, c.level !== "info" ? h("i", { class: "swatch", style: `background:${cvar(c.id)}` }) : null, c.name, h("span", { class: "badge " + c.level }, LEVEL[c.level]), c.root && h("span", { class: "badge root", title: "Pide tu contraseña (polkit)" }, "🔒 admin")), h("div", { class: "cdesc" }, c.info ? c.desc + " " + c.info : c.desc)),
      h("div", { class: "csize" }, c.level === "info" ? "" : [h("b", {}, fmt(size)), hasItems(c) && nItems ? h("div", { class: "cdesc" }, `de ${fmt(c.size)} · ${selSet(c).size}/${nItems} elegidas`) : null, h("div", { class: "cbar" }, h("i", { style: `width:${max ? 100 * c.size / max : 0}%;background:${cvar(c.id)}` }))]),
      act, nItems ? h("button", { class: "toggle", onclick: () => { open ? st.open.delete(c.id) : st.open.add(c.id); drawClean(); } }, open ? "▲" : "▼") : null));
  if (open && nItems) {
    const sel = selSet(c), rows = c.items.map(i => h("label", { class: "item", "data-n": i.name.toLowerCase() }, h("input", { type: "checkbox", checked: sel.has(i.name), onchange: e => { e.target.checked ? sel.add(i.name) : sel.delete(i.name); drawClean(true); } }), h("span", { class: "n", title: i.pkgs ? i.pkgs.join(", ") : i.name }, i.name), h("span", { class: "s" }, fmt(i.size))));
    const applyF = v => rows.forEach(r => r.style.display = r.dataset.n.includes(v.toLowerCase()) ? "" : "none");
    const q = h("input", { type: "search", placeholder: "Filtrar…", value: st.fl[c.id] || "", oninput: e => { st.fl[c.id] = e.target.value; applyF(e.target.value); } }); applyF(st.fl[c.id] || "");
    const pick = fn => () => { sel.clear(); c.items.filter(fn).forEach(i => sel.add(i.name)); drawClean(); };
    card.append(h("div", { class: "items" }, h("div", { class: "ihead" }, q, h("button", { class: "btn sm", onclick: pick(() => true) }, "Todo"), h("button", { class: "btn sm", onclick: pick(() => false) }, "Ninguno"), h("button", { class: "btn sm", onclick: pick(i => i.size > 1e8) }, "Solo > 100 MB"), h("button", { class: "btn sm", onclick: pick(i => !OFF.has(i.name)) }, "Recomendado")), ...rows));
  }
  return card;
}
function drawClean(keepFocus) {
  const v = $("#view"), ov = st.ov;
  if (!ov) return v.replaceChildren(h("div", { class: "skel", style: "height:150px" }), h("div", { class: "skel" }), h("div", { class: "skel" }));
  const cats = [...ov.cats]; initSel(cats);
  const sorted = [...cats].sort((a, b) => (b.level !== "info") - (a.level !== "info") || b.size - a.size), max = Math.max(1, ...cats.map(c => c.size));
  const picked = cats.filter(c => c.action && included(c) && catPick(c) > 0), total = picked.reduce((t, c) => t + catPick(c), 0), d = ov.disks[0], hot = d && (d.total - d.free) / d.total >= 0.9;
  const top = h("div", {}, h("h2", { class: "vt" }, "Limpieza"), h("div", { class: "vs" }, "Qué se puede borrar con seguridad para recuperar espacio. Nada se borra sin tu confirmación."),
    hot ? h("div", { class: "banner" }, h("span", {}, "⚠"), h("div", {}, h("b", {}, `Tu disco está al ${(100 * (d.total - d.free) / d.total).toFixed(0)} %`), " — quedan ", fmt(d.free), " libres. Conviene liberar espacio pronto.")) : null,
    gauge(ov, cats));
  const scanbar = ov.scanning ? h("div", { class: "scanning" }, "Escaneando…", h("div", { class: "pbar" }, h("i", { style: `width:${100 * ov.progress[0] / ov.progress[1]}%` })), `${ov.progress[0]}/${ov.progress[1]}`) : null;
  const tools = h("div", { class: "bar2" }, h("div", { class: "sel" }, picked.length ? ["Seleccionado: ", h("b", {}, fmt(total)), h("span", { class: "mut" }, ` en ${picked.length} categoría${picked.length > 1 ? "s" : ""}`)] : h("span", { class: "mut" }, "Nada seleccionado")), h("span", { class: "grow" }),
    h("button", { class: "btn sm", onclick: () => { st.sel = {}; st.incl.clear(); st.init.clear(); drawClean(); } }, "Restablecer recomendado"), h("button", { class: "btn sm", onclick: () => { st.sel = {}; st.incl.clear(); st.init = new Set(cats.map(c => c.id)); drawClean(); } }, "Ninguno"),
    h("button", { class: "btn p", disabled: !picked.length || st.busy, onclick: () => cleanMany(picked) }, `Limpiar selección${picked.length ? " · " + fmt(total) : ""}`));
  v.replaceChildren(...[top, scanbar, tools, ...(ov.cats.length ? sorted.map(c => catCard(c, max)) : [h("div", { class: "skel" }), h("div", { class: "skel" })])].filter(Boolean));
}

/* ---------- ejecución de tareas (una o varias en secuencia) ---------- */
async function pollJob(id, log) {
  let from = 0;
  for (;;) {
    await new Promise(r => setTimeout(r, 600));
    const r = await api(`/api/job?id=${id}&from=${from}`);
    if (r.lines.length) { log(r.lines.join("")); } from = r.next;
    if (r.done) return r;
  }
}
async function runSteps(title, steps) {
  if (st.busy) return toast("Ya hay una operación en curso", "bad");
  st.busy = true; const log = $("#log"), dot = $("#cdot"), res = $("#result");
  $("#console").hidden = false; $("#console").classList.remove("min"); $("#ctitle").textContent = title; dot.className = "dot run"; res.hidden = true; log.textContent = "";
  let total = 0, ok = true;
  try {
    for (const [i, s] of steps.entries()) {
      log.textContent += `${steps.length > 1 ? `\n▶ [${i + 1}/${steps.length}] ` : "▶ "}${s.label}\n${s.root ? "  (esperando tu contraseña…)\n" : ""}`; log.scrollTop = log.scrollHeight;
      const { id } = await post(s.path, s.body);
      const r = await pollJob(id, t => { log.textContent += t; log.scrollTop = log.scrollHeight; });
      total += r.freed;
      if (r.code !== 0) { ok = false; log.textContent += `✘ Falló (código ${r.code}). Se detiene aquí.\n`; break; }
      log.textContent += `  ✔ ${s.label}: ${fmt(r.freed)}\n`;
    }
  } catch (e) { ok = false; log.textContent += "Error: " + e.message + "\n"; }
  dot.className = "dot " + (ok ? "ok" : "bad");
  if (ok) { res.hidden = false; res.replaceChildren("✔ Listo. Espacio liberado: ", h("b", {}, fmt(total))); }
  toast(ok ? `Liberados ${fmt(total)}` : "La limpieza no terminó", ok ? "ok" : "bad");
  st.busy = false; st.sel = {}; st.incl.clear(); st.init.clear(); st.exCache = null;
  await loadOverview(true);
  if (st.view === "explore") navExplore(st.ex.path, true); else if (st.view === "large") loadLarge(true); else if (st.view === "history") loadHistory();
}
const stepOf = c => ({ path: "/api/clean", body: { category: c.id, items: hasItems(c) ? [...selSet(c)] : [], option: c.id === "journal" ? st.opt.journal : undefined }, label: c.name, root: !!c.root });
async function cleanOne(c) {
  const size = hasItems(c) ? catPick(c) : c.size, extra = c.id === "kernels" ? "Se conservan el kernel en uso y el de reserva." : c.root ? "Te pedirá tu contraseña." : c.id === "cache" ? "Las apps volverán a generarlas cuando las necesiten." : "";
  if (await ask(c.action, [`Se liberarán unos ${fmt(size)}.`, extra ? "\n" + extra : ""], "Limpiar")) runSteps(c.name, [stepOf(c)]);
}
async function cleanMany(list) {
  const total = list.reduce((t, c) => t + catPick(c), 0), roots = list.filter(c => c.root).length;
  const body = [h("div", {}, `Se liberarán unos ${fmt(total)}:`), h("ul", {}, ...list.map(c => h("li", {}, c.name, h("span", {}, fmt(catPick(c)))))), roots ? h("div", { style: "margin-top:10px" }, `🔒 ${roots} de ellas piden tu contraseña (una vez por categoría).`) : null];
  if (await ask("Limpiar selección", body, "Limpiar")) runSteps("Limpieza", list.map(stepOf));
}

/* ---------- borrado de archivos concretos ---------- */
async function rmPath(path, size, hard) {
  const body = [h("div", { style: "color:var(--fg);word-break:break-all" }, path), h("div", {}, fmt(size)), hard ? h("div", { style: "color:var(--bad);margin-top:8px" }, "No se puede deshacer.") : "\nSeguirá ocupando espacio hasta que vacíes la papelera."];
  if (await ask(hard ? "Borrar definitivamente" : "Mover a la papelera", body, hard ? "Borrar" : "Mover")) runSteps(hard ? "Borrar" : "Papelera", [{ path: hard ? "/api/delete" : "/api/trash", body: { path }, label: path.split("/").pop() }]);
}
const copyPath = p => { navigator.clipboard.writeText(p).then(() => toast("Ruta copiada", "ok")).catch(() => toast(p)); };

/* ---------- archivos grandes ---------- */
async function loadLarge(force) {
  const v = $("#view");
  if (!$("#lgbox") || force) v.replaceChildren(h("h2", { class: "vt" }, "Archivos grandes"), h("div", { class: "vs" }, "Los ficheros que más espacio ocupan en tu carpeta personal. Revisa antes de borrar."),
    h("div", { class: "toolbar" }, h("div", { class: "seg" }, ...[[50, "50 MB"], [100, "100 MB"], [500, "500 MB"], [1024, "1 GB"]].map(([m, l]) => h("button", { class: st.minMb === m ? "on" : "", onclick: () => { st.minMb = m; loadLarge(); } }, "> " + l))), h("button", { class: "btn sm", onclick: () => loadLarge(true) }, "↻ Reescanear")), h("div", { id: "lgbox" }));
  document.querySelectorAll(".seg button").forEach(b => b.classList.toggle("on", b.textContent === "> " + ({ 50: "50 MB", 100: "100 MB", 500: "500 MB", 1024: "1 GB" })[st.minMb]));
  const box = $("#lgbox"); if (!box.children.length) box.replaceChildren(h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel" }));
  let d; try { d = await api(`/api/large?min=${st.minMb}${force ? "&force=1" : ""}`); } catch (e) { return box.replaceChildren(h("div", { class: "empty" }, e.message)); }
  if (st.view !== "large") return;
  if (d.status === "running") { st.pollT = setTimeout(() => loadLarge(), 2500); return box.replaceChildren(h("div", { class: "scanning" }, "Buscando archivos grandes… (la primera vez tarda un poco)"), h("div", { class: "skel" }), h("div", { class: "skel" })); }
  if (d.status === "error") return box.replaceChildren(h("div", { class: "empty" }, "Error: " + d.error));
  if (!d.files.length) return box.replaceChildren(h("div", { class: "empty" }, h("div", { class: "big2" }, "🐘"), h("b", {}, "No hay archivos tan grandes"), h("div", {}, "Prueba con un umbral más bajo.")));
  const max = d.files[0].size;
  box.replaceChildren(h("div", { class: "vs", style: "margin:0 0 8px" }, `${d.count} archivo${d.count > 1 ? "s" : ""} · ${fmt(d.total)} en total` + (d.count > d.files.length ? ` (mostrando los ${d.files.length} mayores)` : "")),
    ...d.files.map(f => { const dir = f.path.slice(0, f.path.lastIndexOf("/")), name = f.path.split("/").pop();
      return h("div", { class: "frow" }, h("div", { class: "bar", style: `width:${100 * f.size / max}%` }), h("span", { class: "fic" }, icoFor(name)), h("div", { class: "fname" }, h("b", { title: name }, name), h("span", { title: f.path }, "‎" + dir)),
        h("span", { class: "fm" }, ago(f.mtime)), h("span", { class: "fs" }, fmt(f.size)),
        h("span", { class: "fa" }, f.deletable ? [h("button", { class: "btn sm", onclick: () => rmPath(f.path, f.size, false) }, "Papelera"), h("button", { class: "btn sm d", onclick: () => rmPath(f.path, f.size, true) }, "Borrar")] : null, h("button", { class: "btn sm", title: "Ver su carpeta", onclick: () => go("explore", dir) }, "📂"), h("button", { class: "btn sm", title: "Copiar ruta", onclick: () => copyPath(f.path) }, "⧉"))); }));
}

/* ---------- explorador ---------- */
function crumbs(path) {
  const parts = path.split("/").filter(Boolean), nav = h("div", { class: "crumbs" }, h("button", { onclick: () => navExplore("/") }, "/")); let acc = "";
  parts.forEach(p => { acc += "/" + p; const a = acc; nav.append(h("span", {}, "›"), h("button", { onclick: () => navExplore(a) }, p)); }); return nav;
}
function navExplore(path, force) {
  clearTimeout(st.pollT); path ||= st.ex.path || (st.ov ? st.ov.home : ""); st.ex.path = path;
  const v = $("#view"), crumbBox = h("div", {}), list = h("div", { id: "exlist" }), prog = h("div", {});
  const srt = h("div", { class: "seg" }, ...[["size", "Tamaño"], ["name", "Nombre"], ["mtime", "Fecha"]].map(([k, l]) => h("button", { class: st.ex.sort === k ? "on" : "", onclick: e => { st.ex.sort = k; srt.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.target)); paint(); } }, l)));
  const q = h("input", { type: "search", placeholder: "Filtrar…", value: st.ex.q, oninput: e => { st.ex.q = e.target.value; paint(); } });
  const quick = h("div", { class: "toolbar" }, ...[["🏠 Casa", st.ov && st.ov.home], ["/var", "/var"], ["/opt", "/opt"], ["/usr", "/usr"], ["/", "/"]].filter(x => x[1]).map(([l, p]) => h("button", { class: "btn sm", onclick: () => navExplore(p) }, l)), h("span", { class: "grow" }), q, srt, h("button", { class: "btn sm", onclick: () => navExplore(st.ex.path, true) }, "↻"));
  v.replaceChildren(h("h2", { class: "vt" }, "Explorador"), h("div", { class: "vs" }, "Dónde se va el espacio, carpeta por carpeta. Dentro de tu carpeta personal puedes borrar; fuera es solo lectura."), crumbBox, quick, prog, list);
  let data = null;
  function paint() {
    if (!data) return; const qq = st.ex.q.toLowerCase(), by = st.ex.sort;
    const es = data.entries.filter(e => !qq || e.name.toLowerCase().includes(qq)).sort(by === "name" ? (a, b) => a.name.localeCompare(b.name) : by === "mtime" ? (a, b) => (b.mtime || 0) - (a.mtime || 0) : (a, b) => b.size - a.size);
    const tot = Math.max(data.total, 1), up = data.path !== "/" ? h("div", { class: "frow", style: "cursor:pointer", onclick: () => navExplore(data.path.replace(/\/[^/]*$/, "") || "/") }, h("span", { class: "fic" }, "↰"), h("div", { class: "fname" }, h("b", {}, "Subir"))) : null;
    list.replaceChildren(...[up, ...es.map(e => { const p = data.path.replace(/\/$/, "") + "/" + e.name;
      return h("div", { class: "frow" }, h("div", { class: "bar", style: `width:${100 * e.size / tot}%` }), h("span", { class: "fic" }, e.dir ? "📁" : icoFor(e.name)),
        h("div", { class: "fname" }, h("b", { class: e.dir ? "ename" : "", title: e.name, onclick: e.dir ? () => navExplore(p) : null }, e.name)), h("span", { class: "fm" }, ago(e.mtime)), h("span", { class: "fm", style: "min-width:44px" }, (100 * e.size / tot).toFixed(0) + "%"), h("span", { class: "fs" }, fmt(e.size)),
        h("span", { class: "fa" }, e.deletable ? [h("button", { class: "btn sm", onclick: () => rmPath(p, e.size, false) }, "Papelera"), h("button", { class: "btn sm d", onclick: () => rmPath(p, e.size, true) }, "Borrar")] : h("span", { class: "mut", style: "font-size:11px" }, "solo lectura"), h("button", { class: "btn sm", title: "Copiar ruta", onclick: () => copyPath(p) }, "⧉"))); })].filter(Boolean));
  }
  const tick = async () => {
    let d; try { d = await api("/api/explore?" + (st.ex.path ? "path=" + encodeURIComponent(st.ex.path) + "&" : "") + (force ? "force=1" : "")); force = false; } catch (e) { return list.replaceChildren(h("div", { class: "empty" }, "Error: " + e.message)); }
    if (st.view !== "explore") return; data = d; st.ex.path = d.path; crumbBox.replaceChildren(crumbs(d.path));
    prog.replaceChildren(d.status === "running" ? h("div", { class: "scanning" }, `Calculando tamaños… ${d.done || 0}/${d.count || "?"}`, h("div", { class: "pbar" }, h("i", { style: `width:${d.count ? 100 * d.done / d.count : 5}%` })), h("span", {}, fmt(d.total || 0) + " hasta ahora")) : h("div", { class: "vs", style: "margin:0 0 8px" }, `${fmt(d.total)} en total · ${d.entries.length} elementos`));
    if (d.status === "error") return list.replaceChildren(h("div", { class: "empty" }, "Error: " + d.error));
    paint(); if (d.status === "running") st.pollT = setTimeout(tick, 1500);
  };
  tick();
}

/* ---------- historial ---------- */
async function loadHistory() {
  const v = $("#view"); v.replaceChildren(h("h2", { class: "vt" }, "Historial"), h("div", { class: "skel" }));
  let d; try { d = await api("/api/history"); } catch (e) { return v.replaceChildren(h("div", { class: "empty" }, e.message)); }
  if (st.view !== "history") return;
  v.replaceChildren(h("h2", { class: "vt" }, "Historial"), h("div", { class: "vs" }, "Lo que Elephant ha liberado."),
    h("div", { class: "hero" }, h("div", { class: "mut" }, "Total liberado"), h("div", { class: "num" }, fmt(d.total)), h("div", { class: "mut" }, `en ${d.count} limpieza${d.count === 1 ? "" : "s"}`)),
    d.items.length ? h("div", { class: "cat" }, ...d.items.map(i => h("div", { class: "hist" }, h("span", { class: "w" }, ago(i.t)), h("span", { class: "t" }, i.title), h("b", {}, i.freed ? "+" + fmt(i.freed) : "—")))) : h("div", { class: "empty" }, h("div", { class: "big2" }, "🐘"), h("b", {}, "Aún no has limpiado nada"), h("div", {}, "Cuando lo hagas, aparecerá aquí.")));
}

/* ---------- arranque ---------- */
$("#rescan").onclick = () => { st.exCache = null; loadOverview(true); if (st.view === "explore") navExplore(st.ex.path, true); else if (st.view === "large") loadLarge(true); };
$("#cclose").onclick = () => { if (!st.busy) $("#console").hidden = true; };
$("#cmin").onclick = () => { const m = $("#console").classList.toggle("min"); $("#cmin").textContent = m ? "Expandir" : "Minimizar"; };
document.addEventListener("keydown", e => {
  if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { const i = document.querySelector("#view input[type=search]"); if (i) { e.preventDefault(); i.focus(); } }
  if (e.key === "Escape") { if (document.activeElement && document.activeElement.tagName === "INPUT") document.activeElement.blur(); else if (!st.busy) $("#console").hidden = true; }
});
const [hv, ...hr] = location.hash.slice(1).split("/"), harg = hr.length ? "/" + hr.join("/").replace(/^\/+/, "") : undefined;
drawClean(); loadOverview().then(() => { const v = NAV.some(n => n[0] === hv) ? hv : "clean"; if (v !== "clean") go(v, harg && decodeURIComponent(harg)); else drawNav(); });
