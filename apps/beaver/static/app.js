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
const put = (el, ...kids) => { el.replaceChildren(...kids.flat().filter(x => x != null && x !== false)); return el; };
const HDR = { "Content-Type": "application/json", "X-Beaver": "1" };
const NAV = [["overview", "Resumen", "📊"], ["apps", "Aplicaciones", "🧩"], ["procs", "Procesos", "🧮"], ["services", "Servicios", "⚙️"], ["settings", "Swap y ajustes", "🔧"]];
const st = { view: "overview", ov: null, open: new Set(), q: "", mine: true, scope: "user", timer: null, busy: false };
const NS = "http://www.w3.org/2000/svg";

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
const fmtWhen = iso => { const d = new Date(iso); return isNaN(d) ? iso.slice(0, 16) : d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
const kb = v => v >= 1048576 ? (v / 1048576).toFixed(v >= 10485760 ? 1 : 2) + " GB" : v >= 1024 ? Math.round(v / 1024) + " MB" : Math.round(v) + " KB";
const mbToKb = mb => mb * 1024;
function toast(m, k = "") { const t = h("div", { class: "toast " + k }, m); $("#toasts").append(t); setTimeout(() => t.remove(), k === "bad" ? 9000 : 5000); }
function ask(title, body, ok = "Aceptar", typed = null) {
  $("#dtitle").textContent = title; put($("#dbody"), ...[].concat(body).map(x => typeof x === "string" ? document.createTextNode(x) : x)); $("#dok").textContent = ok;
  const box = $("#typed"), inp = $("#typedin"); box.hidden = !typed; inp.value = ""; $("#dok").disabled = !!typed;
  if (typed) { $("#typedname").textContent = typed; inp.oninput = () => { $("#dok").disabled = inp.value.trim() !== typed; }; setTimeout(() => inp.focus(), 50); }
  const d = $("#dlg"); d.returnValue = ""; d.showModal();
  return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true }));
}

/* ---------- gráfica mínima (línea de 2 px, marcador final y cruceta con tooltip) ---------- */
function sparkline(color) {
  const W = 240, H = 62, wrap = h("div", { class: "spark" }), svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("preserveAspectRatio", "none");
  const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
  const grid = mk("path", { class: "sgrid", d: `M0 ${H - 1}H${W}M0 ${H / 2}H${W}` }), line = mk("polyline", { fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" });
  const cross = mk("line", { class: "scross", y1: 0, y2: H }); cross.style.display = "none"; svg.append(grid, line, cross);
  const dot = h("i", { class: "sdot", style: `background:${color}` }), tip = h("div", { class: "stip" }); tip.hidden = true; wrap.append(svg, dot, tip);
  let pts = [], vals = [], f = String;
  wrap.onmousemove = e => { if (!pts.length) return; const r = wrap.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, i = Math.max(0, Math.min(pts.length - 1, Math.round(x * (pts.length - 1)))); cross.setAttribute("x1", pts[i][0]); cross.setAttribute("x2", pts[i][0]); cross.style.display = ""; tip.hidden = false; tip.textContent = `${f(vals[i])} · hace ${(pts.length - 1 - i) * 3} s`; tip.style.left = Math.min(Math.max(x * 100, 18), 82) + "%"; };
  wrap.onmouseleave = () => { cross.style.display = "none"; tip.hidden = true; };
  return { el: wrap, set(values, fmtFn, max) { vals = values; f = fmtFn; const m = max || Math.max(1, ...values) * 1.15; pts = values.map((v, i) => [values.length > 1 ? i / (values.length - 1) * W : W, H - 2 - Math.min(v / m, 1) * (H - 4)]); line.setAttribute("points", pts.map(p => p.join(",")).join(" ")); const l = pts[pts.length - 1]; if (l) { dot.style.left = l[0] / W * 100 + "%"; dot.style.top = l[1] / H * 100 + "%"; dot.hidden = false; } else dot.hidden = true; } };
}

/* ---------- navegación ---------- */
function drawNav() {
  put($("#nav"), NAV.map(([id, l, ic]) => h("button", { class: st.view === id ? "on" : "", onclick: () => go(id) }, h("span", { class: "ic" }, ic), h("span", { class: "l" }, l))));
  const o = st.ov; if (!o) return; const m = o.mem, usedPct = 100 * (m.total - m.available) / m.total, swU = m.swap_total - m.swap_free;
  put($("#mini"), h("b", {}, kb(m.available) + " disponibles"), h("div", { class: "mut" }, `${usedPct.toFixed(0)} % en uso de ${kb(m.total)}`), h("div", { class: "mb" }, h("i", { class: usedPct >= 90 ? "hot" : "", style: `width:${usedPct}%` })),
    h("div", { class: "mut row2" }, m.swap_total ? `Swap ${kb(swU)} / ${kb(m.swap_total)}` : "Sin swap"));
}
function go(v) { clearTimeout(st.timer); st.view = v; const pb = $("#pbulk"); if (pb) pb.hidden = true; try { location.hash = v; } catch {} drawNav(); $("#main").scrollTop = 0; ({ overview: viewOverview, apps: viewApps, procs: viewProcs, services: viewServices, settings: viewSettings })[v](); }
async function pollOverview() { try { st.ov = await api("/api/overview"); drawNav(); } catch {} }

/* ---------- resumen ---------- */
const SEG = [["anon", "Aplicaciones", "var(--m-apps)"], ["shmem", "Compartida", "var(--m-shmem)"], ["cache", "Caché de archivos", "var(--m-cache)"], ["kernel", "Kernel", "var(--m-kernel)"], ["other", "Otros", "var(--m-other)"]];
function viewOverview() {
  const v = $("#view"), R = { sp: { ram: sparkline("var(--m-apps)"), swap: sparkline("var(--m-kernel)"), io: sparkline("var(--m-shmem)") } };
  const cardH = (t, ...c) => h("section", { class: "card" }, h("h3", {}, t), ...c);
  R.memBig = h("div", { class: "big" }); R.memSub = h("div", { class: "mut" }); R.sbar = h("div", { class: "sbar" }); R.legend = h("div", { class: "legend" });
  R.swBig = h("div", { class: "big" }); R.swMeter = h("div", { class: "meter" }); R.swKv = h("div", { class: "kv" });
  R.psiPill = h("span", { class: "pill ok" }, "Normal"); R.psiKv = h("div", { class: "kv" });
  R.cRam = h("div", { class: "mut" }); R.cSwap = h("div", { class: "mut" }); R.cIo = h("div", { class: "mut" }); R.tips = h("div");
  put(v, h("h2", { class: "vt" }, "Resumen"), h("div", { class: "vs" }, "Cómo está tu memoria ahora mismo y qué la está usando."),
    h("div", { class: "grid" }, cardH("Memoria", R.memBig, R.memSub, R.sbar, R.legend), cardH("Swap", R.swBig, R.swMeter, R.swKv), cardH("Presión de memoria", h("div", { class: "big" }, R.psiPill), R.psiKv)),
    h("div", { class: "charts" }, cardH("RAM en uso (últimos minutos)", R.cRam, R.sp.ram.el), cardH("Swap usado", R.cSwap, R.sp.swap.el), cardH("Actividad de swap (páginas/s)", R.cIo, R.sp.io.el)),
    h("div", { class: "sec" }, "Consejos"), R.tips);
  const tick = async () => {
    if (st.view !== "overview") return; await pollOverview(); const o = st.ov; if (!o) return; const m = o.mem, H = o.history;
    R.memBig.replaceChildren(kb(m.available), " ", h("small", {}, "disponibles")); R.memSub.textContent = `de ${kb(m.total)} · ${(100 * (m.total - m.available) / m.total).toFixed(0)} % en uso real (la caché de archivos se libera si hace falta)`;
    put(R.sbar, SEG.map(([k, , c]) => h("i", { title: kb(m[k]), style: `width:${100 * m[k] / m.total}%;background:${c}` })));
    put(R.legend, SEG.map(([k, l, c]) => h("span", {}, h("i", { style: `background:${c}` }), l, " ", h("b", {}, kb(m[k])))), h("span", {}, h("i", { style: "background:var(--m-free);border:1px solid var(--line)" }), "Libre ", h("b", {}, kb(m.free))));
    const su = m.swap_total - m.swap_free, sp = m.swap_total ? 100 * su / m.swap_total : 0, last = H[H.length - 1] || { swin: 0, swout: 0 };
    R.swBig.replaceChildren(kb(su), " ", h("small", {}, "usados de " + kb(m.swap_total))); put(R.swMeter, h("i", { class: sp > 70 ? "hot" : sp > 40 ? "warm" : "", style: `width:${sp}%` }));
    put(R.swKv, h("span", {}, "Dispositivos"), h("span", {}, o.swaps.length ? o.swaps.map(s => `${s.name.split("/").pop()} (${s.type})`).join(", ") : "ninguno"),
      h("span", {}, "zram"), h("span", {}, o.swaps.some(s => s.name.startsWith("/dev/zram")) ? "activo" : "inactivo"), h("span", {}, "Entra / sale ahora"), h("span", {}, `${last.swin.toFixed(0)} / ${last.swout.toFixed(0)} pág/s`), h("span", {}, "swappiness"), h("span", {}, o.sysctl.swappiness));
    const p = (o.psi.some || {}), lvl = p.avg10 > 20 ? ["bad", "Alta"] : p.avg10 > 5 ? ["warn", "Moderada"] : ["ok", "Normal"]; R.psiPill.className = "pill " + lvl[0]; R.psiPill.textContent = lvl[1];
    put(R.psiKv, h("span", {}, "Esperas por memoria (10 s / 1 min / 5 min)"), h("span", {}, `${(p.avg10 || 0).toFixed(1)} / ${(p.avg60 || 0).toFixed(1)} / ${(p.avg300 || 0).toFixed(1)} %`), h("span", {}, "Procesos matados por falta de memoria"), h("span", {}, o.oom_kills), h("span", {}, "systemd-oomd"), h("span", {}, o.oomd), h("span", {}, "Apps cerradas por oomd (24 h)"), h("span", { style: o.oomd_kills_24h ? "color:var(--warn);font-weight:700" : "" }, o.oomd_kills_24h));
    R.sp.ram.set(H.map(x => x.used_pct), x => x.toFixed(0) + " % en uso", 100); R.cRam.textContent = H.length ? `${H[H.length - 1].used_pct.toFixed(0)} % ahora` : "recogiendo datos…";
    R.sp.swap.set(H.map(x => x.swap_used), x => kb(x), Math.max(m.swap_total * 0.02, 1)); R.cSwap.textContent = `${kb(su)} ahora`;
    R.sp.io.set(H.map(x => x.swin + x.swout), x => x.toFixed(0) + " pág/s", 50); R.cIo.textContent = `${(last.swin + last.swout).toFixed(0)} pág/s ahora`;
    put(R.tips, o.tips.map(t => h("div", { class: "tip " + t.level }, h("span", {}, t.text), t.action ? h("button", { class: "btn sm p", onclick: () => go("settings") }, t.action === "oomd" ? "Configurar oomd" : "Configurar zram") : null)));
    st.timer = setTimeout(tick, 3000);
  };
  tick();
}

/* ---------- aplicaciones ---------- */
const gkey = g => g.app + "|" + g.uid;
async function killItems(items, signal, label, after = () => setTimeout(viewApps, 700)) {
  let force = false; const elevate = items.some(i => i.mine === false);
  for (;;) {
    try {
      const r = await post("/api/kill", { items: items.map(i => ({ pid: i.pid, start: i.start })), signal, force, elevate }); const ok = r.results.filter(x => x.ok).length, bad = r.results.filter(x => !x.ok);
      toast(`${label}: ${ok} de ${r.results.length} proceso${r.results.length > 1 ? "s" : ""} ${signal === "KILL" ? "forzado" : "cerrado"}${ok > 1 ? "s" : ""}` + (bad.length ? `\n${bad[0].error}` : ""), ok ? "ok" : "bad"); break;
    } catch (e) {
      if (e.status === 409 && e.data.protected && !force) {
        if (!(await ask("⚠ Proceso crítico del sistema o de la sesión", [h("b", {}, e.data.protected.join(", ")), "\n\nCerrarlo puede dejar el equipo sin red, sin sesión gráfica, sin sonido o inutilizable."], "Entiendo el riesgo, continuar", "CONFIRMAR"))) return;
        force = true; continue;
      }
      toast(e.message, "bad"); break;
    }
  }
  after();
}
const lockNote = items => items.some(i => i.mine === false) ? "\n\n🔒 Incluye procesos de otros usuarios (root): te pedirá tu contraseña." : "";
async function viewApps(poll) {
  clearTimeout(st.timer); const v = $("#view"); if (poll !== true) {
    const q = h("input", { type: "search", placeholder: "Filtrar aplicaciones…", value: st.q, oninput: e => { st.q = e.target.value; paint(); } });
    put(v, h("h2", { class: "vt" }, "Aplicaciones"), h("div", { class: "vs" }, "Qué usa tu memoria, agrupado por aplicación. «Huella» = memoria propia + la que está en swap (sin contar la caché de archivos)."),
      h("div", { class: "toolbar" }, q, h("label", { class: "lbl" }, h("input", { type: "checkbox", checked: st.mine, onchange: e => { st.mine = e.target.checked; paint(); } }), "Solo mis procesos"), h("span", { class: "grow" }), h("span", { class: "mut", id: "atot" })), h("div", { id: "applist" }, h("div", { class: "skel" }), h("div", { class: "skel" })));
  }
  let data; try { data = await api("/api/apps"); } catch (e) { return put($("#applist"), h("div", { class: "empty" }, e.message)); }
  st.apps = data; if (st.view !== "apps") return; paint(); st.timer = setTimeout(() => viewApps(true), 4000);
  function paint() {
    const d = st.apps; if (!d) return; const qq = st.q.toLowerCase(), list = d.apps.filter(g => (!st.mine || g.mine) && (!qq || g.app.toLowerCase().includes(qq))), max = Math.max(1, ...list.map(g => g.footprint));
    $("#atot") && ($("#atot").textContent = `${list.length} aplicaciones · ${kb(list.reduce((t, g) => t + g.footprint, 0))} de huella`);
    put($("#applist"), list.length ? list.slice(0, 60).map(g => {
      const open = st.open.has(gkey(g)), items = g.procs.map(p => ({ pid: p.pid, start: p.start, mine: g.mine }));
      return h("div", { class: "arow" },
        h("div", { class: "ahead", onclick: () => { open ? st.open.delete(gkey(g)) : st.open.add(gkey(g)); paint(); } }, h("div", { class: "bar", style: `width:${100 * g.footprint / max}%` }), h("span", { class: "mut" }, open ? "▾" : "▸"),
          h("div", { class: "aname" }, h("b", {}, g.app, h("span", { class: "tag" }, g.count + " proceso" + (g.count > 1 ? "s" : "")), g.protected ? h("span", { class: "tag", title: "Parte de la sesión de escritorio" }, "🔒 sesión") : null, !g.mine ? h("span", { class: "tag" }, "otro usuario") : null),
            h("span", { class: "d" }, `${(100 * g.footprint / d.total).toFixed(1)} % de la RAM`)),
          h("div", { class: "num" }, kb(g.anon + g.shmem), h("small", {}, "memoria")), h("div", { class: "num" }, kb(g.swap), h("small", {}, "en swap")), h("div", { class: "num" }, h("b", {}, kb(g.footprint)), h("small", {}, "huella")),
          h("div", { class: "aact", onclick: e => e.stopPropagation() }, h("button", { class: "btn sm", onclick: async () => { if (await ask("Cerrar " + g.app, `Se enviará la señal de cierre a ${g.count} proceso${g.count > 1 ? "s" : ""}. La aplicación podrá guardar su estado.` + lockNote(items), "Cerrar")) killItems(items, "TERM", g.app); } }, g.mine ? "Cerrar" : "🔒 Cerrar"),
            h("button", { class: "btn sm d", onclick: async () => { if (await ask("Forzar cierre de " + g.app, [`Se matarán ${g.count} proceso${g.count > 1 ? "s" : ""} sin darles opción a guardar.\n`, h("b", {}, "Puedes perder trabajo sin guardar."), lockNote(items)], "Forzar")) killItems(items, "KILL", g.app); } }, "Forzar"))),
        open ? h("div", { class: "procs" }, ...g.procs.map(p => h("div", { class: "prow" }, h("span", { class: "pid" }, p.pid), h("b", {}, p.name), h("span", { class: "c", title: p.cmd }, p.cmd), h("span", { class: "num", style: "min-width:70px" }, kb(p.anon + p.shmem)), h("span", { class: "num", style: "min-width:70px;color:var(--mut)" }, p.swap ? kb(p.swap) + " swap" : ""),
          h("button", { class: "btn sm", onclick: async () => { const it = [{ pid: p.pid, start: p.start, mine: g.mine }]; if (await ask(`Cerrar ${p.name} (pid ${p.pid})`, p.cmd.slice(0, 140) + lockNote(it), "Cerrar")) killItems(it, "TERM", p.name); } }, g.mine ? "Cerrar" : "🔒")))) : null);
    }) : h("div", { class: "empty" }, h("div", { class: "big2" }, "🦫"), "Nada que mostrar con ese filtro."));
  }
}

/* ---------- todos los procesos ---------- */
const P = { sort: "mem", q: "", page: 0, per: 50, mine: false, sel: new Map() };
const pkey = r => r.pid + ":" + r.start;
async function viewProcs(poll) {
  clearTimeout(st.timer); const v = $("#view");
  if (poll !== true) {
    const q = h("input", { type: "search", placeholder: "Filtrar por nombre, comando o PID…", value: P.q, oninput: e => { P.q = e.target.value; P.page = 0; viewProcs(true); } });
    put(v, h("h2", { class: "vt" }, "Procesos"), h("div", { class: "vs" }, "Todos los procesos del equipo, de todos los usuarios. Los de otros usuarios (root) se pueden cerrar con tu contraseña."),
      h("div", { class: "toolbar" }, q, h("label", { class: "lbl" }, h("input", { type: "checkbox", checked: P.mine, onchange: e => { P.mine = e.target.checked; P.page = 0; viewProcs(true); } }), "Solo míos"),
        h("label", { class: "lbl" }, "Por página ", h("select", { onchange: e => { P.per = +e.target.value; P.page = 0; viewProcs(true); } }, ...[25, 50, 100, 200].map(n => h("option", { value: n, selected: n === P.per }, n)))), h("span", { class: "grow" }), h("span", { class: "mut", id: "ptot" })),
      h("div", { id: "ptable" }, h("div", { class: "skel" }), h("div", { class: "skel" })), h("div", { id: "ppager", class: "toolbar" }));
  }
  let d; try { d = await api(`/api/procs?sort=${P.sort}&q=${encodeURIComponent(P.q)}&page=${P.page}&per=${P.per}&mine=${P.mine ? 1 : 0}`); } catch (e) { return put($("#ptable"), h("div", { class: "empty" }, e.message)); }
  if (st.view !== "procs") return; P.last = d; paintProcs(); st.timer = setTimeout(() => viewProcs(true), 4000);
}
function paintProcs() {
  const d = P.last; if (!d) return; const pages = Math.max(1, Math.ceil(d.total / d.per));
  const all = h("input", { type: "checkbox", checked: d.rows.length > 0 && d.rows.every(r => P.sel.has(pkey(r))), title: "Seleccionar esta página", onchange: e => { d.rows.forEach(r => e.target.checked ? P.sel.set(pkey(r), { pid: r.pid, start: r.start, name: r.name, mine: r.mine }) : P.sel.delete(pkey(r))); paintProcs(); } });
  const th = (k, l, cls = "") => h("th", { class: cls, style: "cursor:pointer;white-space:nowrap", onclick: () => { P.sort = k; P.page = 0; viewProcs(true); } }, l + (P.sort === k ? " ▾" : ""));
  put($("#ptable"), h("div", { class: "card", style: "padding:6px 8px" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, h("th", { style: "width:26px" }, all), th("pid", "PID"), h("th", {}, "Usuario"), th("name", "Proceso"), th("mem", "Memoria"), th("swap", "Swap"), th("rss", "RSS"), th("threads", "Hilos"), h("th", {}, ""))),
    h("tbody", {}, ...d.rows.map(r => h("tr", {}, h("td", {}, h("input", { type: "checkbox", checked: P.sel.has(pkey(r)), onchange: e => { e.target.checked ? P.sel.set(pkey(r), { pid: r.pid, start: r.start, name: r.name, mine: r.mine }) : P.sel.delete(pkey(r)); paintProcs(); } })),
      h("td", { class: "mut" }, r.pid), h("td", {}, r.mine ? r.user : h("span", { class: "tag", title: "Otro usuario: pedirá contraseña" }, "🔒 " + r.user)),
      h("td", { title: r.cmd }, h("b", {}, r.name), r.protected ? h("span", { class: "tag", style: "margin-left:6px", title: "Crítico: pedirá confirmación escrita" }, "crítico") : null, r.app !== r.name ? h("div", { class: "mut", style: "font-size:11.5px" }, r.app) : null),
      h("td", {}, kb(r.mem)), h("td", { class: "mut" }, r.swap ? kb(r.swap) : "—"), h("td", { class: "mut" }, kb(r.rss)), h("td", { class: "mut" }, r.threads),
      h("td", {}, h("button", { class: "btn sm", onclick: async () => { const it = [{ pid: r.pid, start: r.start, mine: r.mine }]; if (await ask(`Cerrar ${r.name} (pid ${r.pid})`, r.cmd.slice(0, 160) + lockNote(it), "Cerrar")) killItems(it, "TERM", r.name, () => setTimeout(() => viewProcs(true), 700)); } }, "Cerrar"))))))));
  $("#ptot").textContent = `${d.total} proceso${d.total === 1 ? "" : "s"}`;
  put($("#ppager"), h("button", { class: "btn sm", disabled: d.page === 0, onclick: () => { P.page--; viewProcs(true); } }, "◀ Anterior"), h("span", { class: "mut" }, `Página ${d.page + 1} de ${pages}`), h("button", { class: "btn sm", disabled: d.page + 1 >= pages, onclick: () => { P.page++; viewProcs(true); } }, "Siguiente ▶"));
  let bar = $("#pbulk"); if (!bar) { bar = h("div", { id: "pbulk", class: "bulk" }); document.body.append(bar); }
  const sel = [...P.sel.values()], others = sel.filter(x => !x.mine).length; bar.hidden = !sel.length || st.view !== "procs";
  put(bar, h("b", {}, `${sel.length} seleccionado${sel.length > 1 ? "s" : ""}`), others ? h("span", { class: "mut2" }, `(${others} de otros usuarios 🔒)`) : null,
    h("button", { class: "btn sm", onclick: async () => { if (await ask(`Cerrar ${sel.length} procesos`, sel.slice(0, 8).map(x => x.name).join(", ") + (sel.length > 8 ? "…" : "") + lockNote(sel), "Cerrar")) killItems(sel, "TERM", sel.length + " procesos", () => { P.sel.clear(); setTimeout(() => viewProcs(true), 700); }); } }, "Cerrar"),
    h("button", { class: "btn sm d", onclick: async () => { if (await ask(`Forzar cierre de ${sel.length} procesos`, [h("b", {}, "Se matan sin darles opción a guardar.\n"), sel.slice(0, 8).map(x => x.name).join(", ") + lockNote(sel)], "Forzar")) killItems(sel, "KILL", sel.length + " procesos", () => { P.sel.clear(); setTimeout(() => viewProcs(true), 700); }); } }, "Forzar"),
    h("button", { class: "btn sm", onclick: () => { P.sel.clear(); paintProcs(); } }, "✕"));
}

/* ---------- servicios ---------- */
async function viewServices() {
  const v = $("#view"); put(v, h("h2", { class: "vt" }, "Servicios"), h("div", { class: "vs" }, "Memoria por servicio de systemd (cgroups). Los de usuario se pueden limitar para que no se coman la RAM."),
    h("div", { class: "toolbar" }, h("div", { class: "seg" }, ...[["user", "Usuario"], ["system", "Sistema"]].map(([k, l]) => h("button", { class: st.scope === k ? "on" : "", onclick: () => { st.scope = k; viewServices(); } }, l)))), h("div", { id: "svc" }, h("div", { class: "skel" })));
  let s; try { s = await api("/api/services?scope=" + st.scope); } catch (e) { return put($("#svc"), h("div", { class: "empty" }, e.message)); }
  if (st.view !== "services") return;
  put($("#svc"), h("div", { class: "card", style: "padding:6px 8px" }, h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...["Servicio", "Memoria", "Swap", "Límite", ""].map(x => h("th", {}, x)))),
    h("tbody", {}, ...s.slice(0, 80).map(x => h("tr", {}, h("td", {}, h("b", {}, x.name.replace(/\.service$/, "").replace(/\\x([0-9a-f]{2})/gi, (_, c) => String.fromCharCode(parseInt(c, 16)))), h("div", { class: "mut", style: "font-size:12px" }, x.desc)), h("td", {}, kb(x.mem)), h("td", { class: "mut" }, x.swap ? kb(x.swap) : "—"),
      h("td", {}, x.high ? h("span", { class: "tag" }, "suave " + kb(x.high)) : null, x.max ? h("span", { class: "tag" }, " duro " + kb(x.max)) : null, !x.high && !x.max ? h("span", { class: "mut" }, "sin límite") : null),
      h("td", {}, st.scope === "user" ? h("button", { class: "btn sm", onclick: () => limitDialog(x) }, "Limitar…") : null)))))));
}
async function limitDialog(x) {
  const kind = h("select", {}, h("option", { value: "high" }, "Suave (MemoryHigh): frena y recupera memoria, no mata"), h("option", { value: "max" }, "Duro (MemoryMax): si lo supera, el sistema mata el servicio")), mb = h("input", { type: "number", min: 64, max: 131072, step: 64, value: Math.max(256, Math.round(x.mem / 1024 / 64) * 64 + 256), style: "width:110px" });
  const body = [h("div", { style: "color:var(--fg);margin-bottom:8px" }, x.name), "Dura hasta que reinicies el servicio o el equipo (no se guarda en disco).\n\n", h("label", { class: "lbl" }, "Tipo: ", kind), h("div", { style: "height:8px" }), h("label", { class: "lbl" }, "Límite (MB): ", mb)];
  if (!(await ask("Limitar memoria", body, "Aplicar"))) return;
  try { const r = await post("/api/limit", { name: x.name, kind: kind.value, mb: +mb.value }); toast("Aplicado: " + r.applied, "ok"); } catch (e) { toast(e.message, "bad"); } viewServices();
}

/* ---------- swap y ajustes ---------- */
async function rootAct(body, title, text, okLabel = "Aplicar") {
  if (st.busy) return toast("Ya hay una acción en curso", "bad");
  if (!(await ask(title, [text, "\n\n🔒 Te pedirá tu contraseña (polkit)."], okLabel))) return;
  st.busy = true; toast("Esperando tu autorización…"); const before = st.ov && st.ov.mem;
  try { const r = await post("/api/root", body); toast(r.output || "Hecho", "ok"); } catch (e) { toast(e.message + (e.data && e.data.output ? "\n" + e.data.output : ""), "bad"); }
  st.busy = false; await pollOverview(); if (body.action === "dropcaches" && before && st.ov) toast(`Caché de archivos: de ${kb(before.cache)} a ${kb(st.ov.mem.cache)}`, "ok"); viewSettings();
}
async function viewSettings() {
  const v = $("#view"); put(v, h("h2", { class: "vt" }, "Swap y ajustes"), h("div", { class: "skel" }), h("div", { class: "skel" }));
  await pollOverview(); let oom = [], oomdEv = [], od = null; try { const oj = await api("/api/oom"); oom = oj.events; oomdEv = oj.oomd || []; } catch {} try { od = await api("/api/oomd"); } catch {}
  const o = st.ov; if (!o || st.view !== "settings") return; const m = o.mem, sc = o.sysctl, z = o.zram[0], zActive = o.swaps.some(s => s.name.startsWith("/dev/zram"));
  const card = (t, ...c) => h("section", { class: "card" }, h("h3", {}, t), ...c);
  const oLim = h("select", {}, ...[40, 50, 60, 70, 80].map(n => h("option", { value: n, selected: n === 60 }, n + " %"))), oSwp = h("input", { type: "checkbox" });
  // dispositivos
  const swCard = card("Dispositivos de swap", o.swaps.length ? h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...["Dispositivo", "Tipo", "Tamaño", "Usado", "Prioridad"].map(x => h("th", {}, x)))), h("tbody", {}, ...o.swaps.map(s => h("tr", {}, h("td", {}, s.name), h("td", {}, s.type), h("td", {}, kb(s.size)), h("td", {}, kb(s.used), h("div", { class: "meter" }, h("i", { class: s.size && s.used / s.size > .7 ? "hot" : "", style: `width:${s.size ? 100 * s.used / s.size : 0}%` }))), h("td", { class: "mut" }, s.prio))))) : h("div", { class: "mut" }, "No hay swap activo."), h("div", { class: "help" }, "Con varios dispositivos, el kernel usa primero el de mayor prioridad. zram (100) va antes que el archivo en disco (−1)."));
  // zram
  const maxGb = Math.max(1, Math.floor(m.total * 0.75 / 1048576)), opts = [1, 2, 4, 6, 8, 12, 16].filter(g => g <= maxGb), defGb = [...opts].reverse().find(g => g * 1048576 <= m.total * 0.5) || opts[0];
  const sz = h("select", {}, ...opts.map(g => h("option", { value: g, selected: g === defGb }, g + " GB"))), algos = z ? z.algos : ["zstd", "lz4"], alg = h("select", {}, ...algos.map(a => h("option", { value: a, selected: a === "zstd" }, a))), per = h("input", { type: "checkbox", checked: true });
  const ratio = z && z.compr ? (z.orig / Math.max(z.compr, 1)).toFixed(1) : null;
  const zCard = card("zram · swap comprimido en RAM", h("div", {}, zActive ? [h("span", { class: "pill ok" }, "activo"), z ? h("div", { class: "kv" }, h("span", {}, "Tamaño"), h("span", {}, kb(z.disksize / 1024)), h("span", {}, "Algoritmo"), h("span", {}, z.algo), h("span", {}, "Datos guardados"), h("span", {}, kb((z.orig || 0) / 1024)), h("span", {}, "Ocupan en RAM"), h("span", {}, kb((z.mem_used || 0) / 1024)), h("span", {}, "Compresión"), h("span", {}, ratio ? ratio + "×" : "—"), h("span", {}, "Al arrancar"), h("span", {}, sc.persist_zram ? "sí" : "no (solo hasta reiniciar)")) : null] : h("span", { class: "pill info" }, "inactivo")),
    h("div", { class: "help" }, "Comprime las páginas poco usadas dentro de la propia RAM (normalmente 2–3×) antes de escribir al disco. Es mucho más rápido que el swap en archivo y rinde como tener más RAM."),
    zActive ? h("div", { class: "form" }, h("button", { class: "btn d", onclick: () => rootAct({ action: "zram-off" }, "Desactivar zram", "Se mueve lo que haya en zram de vuelta a la RAM/swap y se elimina la configuración al arrancar.", "Desactivar") }, "Desactivar zram")) : null,
    h("div", { class: "form" }, h("label", { class: "lbl" }, "Tamaño ", sz), h("label", { class: "lbl" }, "Algoritmo ", alg), h("label", { class: "lbl" }, per, "Activar al arrancar"),
      h("button", { class: "btn p", onclick: () => rootAct({ action: "zram-on", size_gb: +sz.value, algo: alg.value, persist: per.checked }, zActive ? "Reconfigurar zram" : "Activar zram", `Se crea un swap comprimido de ${sz.value} GB (${alg.value}) con prioridad 100.${per.checked ? "\nSe creará la unidad beaver-zram.service para activarlo en cada arranque." : ""}\nEs reversible desde aquí.`, zActive ? "Reconfigurar" : "Activar") }, zActive ? "Reconfigurar" : "Activar zram")));
  // swappiness
  const mkSlider = (key, label, lo, hi, cur, hint, presets, action) => {
    const val = h("b", {}, cur), rng = h("input", { type: "range", class: "slider", min: lo, max: hi, value: cur, oninput: e => { val.textContent = e.target.value; } }), pers = h("input", { type: "checkbox" });
    return card(label, h("div", { class: "big" }, val, " ", h("small", {}, `(ahora ${cur})`)), rng, h("div", { class: "ticks" }, h("span", {}, lo), h("span", {}, Math.round((lo + hi) / 2)), h("span", {}, hi)), h("div", { class: "help" }, hint),
      h("div", { class: "form" }, ...presets.map(([n, t]) => h("button", { class: "btn sm", title: t, onclick: () => { rng.value = n; val.textContent = n; } }, n + " · " + t)), h("span", { class: "grow" })),
      h("div", { class: "form" }, h("label", { class: "lbl" }, pers, "Mantener tras reiniciar"), h("button", { class: "btn p", onclick: () => rootAct({ action, value: +rng.value, persist: pers.checked }, "Aplicar " + key, `${key} pasará de ${cur} a ${rng.value}${pers.checked ? " y se guardará en /etc/sysctl.d/99-beaver.conf" : " (hasta reiniciar)"}.`) }, "Aplicar")));
  };
  const swapp = mkSlider("vm.swappiness", "swappiness · cuánto usa el swap", 0, 200, sc.swappiness, "Bajo (10–30): el kernel prefiere vaciar caché antes que usar swap. Alto (100–180): usa el swap antes; recomendable con zram porque comprimir es barato.", [[10, "poco"], [60, "por defecto"], [100, "equilibrado"], [150, "con zram"]], "swappiness");
  const vfs = mkSlider("vm.vfs_cache_pressure", "vfs_cache_pressure · caché de directorios", 10, 500, sc.vfs_cache_pressure, "100 es lo normal. Más alto recupera antes la caché de nombres de archivo; más bajo la conserva más tiempo (mejora el acceso a muchos archivos).", [[50, "conservar"], [100, "por defecto"], [200, "liberar antes"]], "cachepressure");
  // acciones puntuales
  const used = o.swaps.reduce((t, s) => t + s.used, 0), need = used * 1.15 + 800 * 1024, can = m.available >= need && used > 0;
  const act = card("Acciones puntuales", h("div", { class: "form", style: "margin-top:0" }, h("button", { class: "btn", onclick: () => rootAct({ action: "dropcaches", level: 1 }, "Liberar caché de archivos", `Descarta la caché de páginas (${kb(m.cache)} ahora). Es seguro: solo hace que los archivos se vuelvan a leer del disco la próxima vez, así que el equipo irá un poco más lento un rato.`, "Liberar") }, "Liberar caché de archivos"), h("button", { class: "btn", onclick: () => rootAct({ action: "dropcaches", level: 3 }, "Liberar caché y directorios", "Descarta también la caché de nombres de archivo (dentries/inodos).", "Liberar") }, "…y la de directorios")),
    h("div", { class: "help" }, "El kernel ya gestiona esta caché solo; liberarla a mano rara vez hace falta."),
    h("div", { class: "form" }, h("button", { class: "btn", disabled: !can, onclick: () => rootAct({ action: "swapcycle", devices: o.swaps.map(s => s.name) }, "Vaciar swap hacia la RAM", `Mueve ${kb(used)} del swap de vuelta a la RAM (apaga y vuelve a encender cada dispositivo). Puede tardar y ralentizar el equipo un momento.`, "Vaciar") }, "Vaciar swap hacia la RAM")),
    h("div", { class: "help" }, used === 0 ? "El swap ya está vacío." : can ? `Hay RAM de sobra: necesitas unos ${kb(need)} libres y tienes ${kb(m.available)}.` : `No hay RAM suficiente para hacerlo con seguridad: harían falta ${kb(need)} disponibles y hay ${kb(m.available)}. Cierra aplicaciones antes.`));
  const pers = card("Ajustes persistentes y eventos", h("div", { class: "kv" }, h("span", {}, "sysctl (/etc/sysctl.d/99-beaver.conf)"), h("span", {}, sc.persist_sysctl ? "sí" : "no"), h("span", {}, "zram al arrancar"), h("span", {}, sc.persist_zram ? "sí" : "no")),
    sc.persist_sysctl ? h("div", { class: "form" }, h("button", { class: "btn sm d", onclick: () => rootAct({ action: "persist-clear" }, "Quitar ajustes persistentes", "Elimina 99-beaver.conf; los valores actuales siguen hasta reiniciar.", "Quitar") }, "Quitar ajustes persistentes")) : null,
    h("div", { class: "sec", style: "margin:14px 0 6px" }, "Cierres automáticos de systemd-oomd (30 días)"),
    oomdEv.length ? h("table", { class: "t" }, h("thead", {}, h("tr", {}, ...["Cuándo", "Aplicación", "Motivo"].map(x => h("th", {}, x)))), h("tbody", {}, ...oomdEv.slice(0, 12).map(e => h("tr", {}, h("td", { style: "white-space:nowrap" }, fmtWhen(e.t)), h("td", {}, h("b", {}, e.name), h("div", { class: "mut", style: "font-size:11px", title: e.cgroup }, e.cgroup.split("/").slice(-2).join("/"))), h("td", {}, h("span", { class: "pill " + (e.kind === "otro" ? "info" : "warn") }, e.kind), h("div", { class: "mut", style: "font-size:12px;margin-top:2px" }, e.detail))))))
      : h("div", { class: "mut" }, od && od.active === "active" ? "Ninguno. systemd-oomd no ha tenido que cerrar ninguna aplicación." : "systemd-oomd no está activo, así que no hay cierres que mostrar."),
    h("div", { class: "sec", style: "margin:14px 0 6px" }, "Muertes por el OOM killer del kernel (30 días)"), oom.length ? h("pre", { style: "margin:0;font:11.5px/1.5 ui-monospace,monospace;white-space:pre-wrap;word-break:break-word;color:var(--mut)" }, oom.join("\n")) : h("div", { class: "mut" }, "Ninguna. El kernel no ha tenido que matar procesos por falta de memoria."),
    null);
  const oomCard = od && card("systemd-oomd · el guardián contra la falta de memoria",
    h("div", { class: "help", style: "margin-top:0;color:var(--fg)" }, "Es un servicio de systemd que vigila la presión de memoria de tu sesión. Si se mantiene alta unos segundos, cierra la aplicación que más memoria usa antes de que el equipo se congele. Sin él, solo actúa el OOM killer del kernel: reacciona tarde, cuando el equipo ya está casi colgado, y mata a ciegas."),
    h("div", { class: "kv" }, h("span", {}, "Instalado"), h("span", {}, od.installed ? "sí" : "no"), h("span", {}, "Servicio"), h("span", {}, od.active === "active" ? "activo" : "inactivo"),
      h("span", {}, "Protección de tu sesión"), h("span", {}, od.pressure === "kill" ? `activa: cierra apps si la presión pasa del ${od.limit || "?"}` + (od.swap === "kill" ? " o el swap se llena" : "") : "sin configurar")),
    od.installed && od.active === "active" && od.pressure !== "kill" ? h("div", { class: "tip warn", style: "margin-top:10px" }, h("span", {}, "El servicio está activo pero no tiene ninguna regla para tu sesión, así que no protege nada. Activa la protección de abajo.")) : null,
    h("div", { class: "form" }, !od.installed ? h("button", { class: "btn p", onclick: () => rootAct({ action: "oomd-install" }, "Instalar systemd-oomd", `Se instala el paquete systemd-oomd (${od.candidate.split("~")[0]}) y se activa el servicio.\nApt actualizará de paso 5 paquetes menores de seguridad de los que depende. No toca tu versión de systemd.`, "Instalar") }, "Instalar y activar")
      : od.active === "active" ? h("button", { class: "btn d", onclick: () => rootAct({ action: "oomd-disable" }, "Desactivar systemd-oomd", "El servicio dejará de vigilar la memoria.", "Desactivar") }, "Desactivar servicio")
      : h("button", { class: "btn p", onclick: () => rootAct({ action: "oomd-enable" }, "Activar systemd-oomd", "Se activa y se arranca el servicio.", "Activar") }, "Activar servicio")),
    od.installed ? h("div", { class: "form" }, h("label", { class: "lbl" }, "Cerrar apps si la presión pasa de ", oLim), h("label", { class: "lbl" }, oSwp, "y también si el swap se llena"),
      h("button", { class: "btn p", onclick: () => rootAct({ action: "oomd-protect", limit: +oLim.value, swap: oSwp.checked }, "Proteger mi sesión", `Se crea un ajuste para tu sesión: si la presión de memoria pasa del ${oLim.value} %${oSwp.checked ? " o el swap se llena" : ""} durante unos 20 s, systemd-oomd cerrará la aplicación o servicio que más memoria use.\nPuede requerir cerrar sesión y volver a entrar. Se puede quitar desde aquí.`, "Proteger") }, od.dropin ? "Reconfigurar protección" : "Proteger mi sesión"),
      od.dropin ? h("button", { class: "btn sm d", onclick: () => rootAct({ action: "oomd-unprotect" }, "Quitar protección", "Elimina la regla de tu sesión (el servicio seguirá instalado).", "Quitar") }, "Quitar protección") : null) : null,
    h("div", { class: "help" }, "Con este guardián, un navegador descontrolado o una fuga de memoria acaba con esa aplicación en vez de congelar todo el equipo."));
  put(v, h("h2", { class: "vt" }, "Swap y ajustes"), h("div", { class: "vs" }, "Configuración del swap y del comportamiento de la memoria. Los cambios del sistema piden tu contraseña y se pueden revertir."),
    h("div", { class: "set" }, zCard, swCard), h("div", { class: "sec" }, "Comportamiento del kernel"), h("div", { class: "set" }, swapp, vfs), h("div", { class: "sec" }, "Protección contra falta de memoria"), oomCard ? h("div", { class: "set" }, h("div", { style: "grid-column:1/-1" }, oomCard)) : null, h("div", { class: "sec" }, "Mantenimiento"), h("div", { class: "set" }, act, pers));
}

/* ---------- arranque ---------- */
document.addEventListener("keydown", e => { if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) { const i = document.querySelector("#view input[type=search]"); if (i) { e.preventDefault(); i.focus(); } } if (e.key === "Escape" && document.activeElement.tagName === "INPUT") document.activeElement.blur(); });
const hv = location.hash.slice(1); if (NAV.some(n => n[0] === hv)) st.view = hv;
pollOverview().then(() => go(st.view));
