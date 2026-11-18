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
const put = (el, ...k) => { el.replaceChildren(...k.flat().filter(x => x != null && x !== false)); return el; };
const HDR = { "Content-Type": "application/json", "X-Chameleon": "1" };
const NAV = [["overview", "Resumen", "📊"], ["sensors", "Sensores", "🌡️"], ["power", "Energía", "🔋"], ["usage", "Consumo", "📈"], ["hardware", "Hardware", "🧩"], ["alerts", "Avisos", "🔔"]];
const st = { view: "overview", ov: null, timer: null, sgroup: "all" };
const NS = "http://www.w3.org/2000/svg";
const LV = { ok: "Normal", warm: "Templada", hot: "Caliente", crit: "Crítica" };
const BATT = { Charging: "Cargando", Discharging: "Descargando", "Not charging": "Conectada (sin cargar)", Full: "Completa", Unknown: "Desconocido" };

async function api(path, opts) {
  const r = await fetch(path, opts), j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || "Error " + r.status); e.data = j; throw e; }
  return j;
}
const post = (p, b) => api(p, { method: "POST", headers: HDR, body: JSON.stringify(b) });
function toast(m, k = "") { const t = h("div", { class: "toast " + k }, m); $("#toasts").append(t); setTimeout(() => t.remove(), k === "bad" ? 9000 : 5000); }
function ask(title, body, ok = "Aceptar", typed = null) {
  $("#dtitle").textContent = title; put($("#dbody"), [].concat(body).map(x => typeof x === "string" ? document.createTextNode(x) : x)); $("#dok").textContent = ok;
  const box = $("#typed"), inp = $("#typedin"); box.hidden = !typed; inp.value = ""; $("#dok").disabled = !!typed;
  if (typed) { $("#typedname").textContent = typed; inp.oninput = () => { $("#dok").disabled = inp.value.trim() !== typed; }; setTimeout(() => inp.focus(), 50); }
  const d = $("#dlg"); d.returnValue = ""; d.showModal();
  return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "yes"), { once: true }));
}
const mk = (t, a) => { const e = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
const deg = v => v == null ? "—" : v.toFixed(v >= 100 ? 0 : 1) + " °C";
const pill = lv => h("span", { class: "pill " + lv }, LV[lv] || lv);
const lvOf = (v, hi, cr, soft) => !v && v !== 0 ? "ok" : cr && v >= cr ? "crit" : hi && v >= hi ? "hot" : (hi || 80) && v >= (hi ? hi - 8 : 80) ? "warm" : "ok";
const hours = x => x == null ? "—" : `${Math.floor(x)} h ${Math.round((x % 1) * 60)} min`;

/* ---------- gráficas ---------- */
function sparkline(color) {
  const W = 240, H = 50, wrap = h("div", { class: "spark" }), svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
  const grid = mk("path", { class: "sgrid", d: `M0 ${H - 1}H${W}M0 ${H / 2}H${W}` }), line = mk("polyline", { fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "vector-effect": "non-scaling-stroke" });
  const cross = mk("line", { class: "scross", y1: 0, y2: H }); cross.style.display = "none"; svg.append(grid, line, cross);
  const dot = h("i", { class: "sdot", style: `background:${color}` }), tip = h("div", { class: "stip" }); tip.hidden = true; wrap.append(svg, dot, tip);
  let pts = [], vals = [], f = String;
  wrap.onmousemove = e => { if (!pts.length) return; const r = wrap.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, i = Math.max(0, Math.min(pts.length - 1, Math.round(x * (pts.length - 1)))); cross.setAttribute("x1", pts[i][0]); cross.setAttribute("x2", pts[i][0]); cross.style.display = ""; tip.hidden = false; tip.textContent = `${f(vals[i])} · hace ${(pts.length - 1 - i) * 3} s`; tip.style.left = Math.min(Math.max(x * 100, 18), 82) + "%"; };
  wrap.onmouseleave = () => { cross.style.display = "none"; tip.hidden = true; };
  return { el: wrap, set(values, fmtFn, lo, hi) { vals = values; f = fmtFn; const mn = lo ?? Math.min(...values), mx = hi ?? Math.max(...values), span = Math.max(mx - mn, 1e-6) * 1.2, base = (lo ?? mn) - span * 0.1; pts = values.map((v, i) => [values.length > 1 ? i / (values.length - 1) * W : W, H - 3 - Math.min(Math.max((v - base) / span, 0), 1) * (H - 6)]); line.setAttribute("points", pts.map(p => p.join(",")).join(" ")); const l = pts[pts.length - 1]; if (l) { dot.style.left = l[0] / W * 100 + "%"; dot.style.top = l[1] / H * 100 + "%"; dot.hidden = false; } else dot.hidden = true; } };
}
function lineChart() {
  const wrap = h("div", { class: "chart" }), svg = mk("svg", {}), tip = h("div", { class: "ctip" }); tip.hidden = true; wrap.append(svg, tip);
  let S = [], geo = null;
  function draw(series) {
    S = series; const W = wrap.clientWidth || 640, H = 200, PL = 38, PR = 10, PT = 8, PB = 20, n = Math.max(0, ...series.map(s => s.values.length));
    svg.replaceChildren(); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const all = series.flatMap(s => s.values); if (!all.length) return;
    let lo = Math.floor((Math.min(...all) - 4) / 5) * 5, hi = Math.ceil((Math.max(...all) + 4) / 5) * 5; if (hi - lo < 15) hi = lo + 15;
    const X = i => PL + (n > 1 ? i / (n - 1) : 1) * (W - PL - PR), Y = v => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
    for (let k = 0; k <= 3; k++) { const v = lo + (hi - lo) * k / 3, y = Y(v); svg.append(mk("line", { x1: PL, x2: W - PR, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 }), Object.assign(mk("text", { x: PL - 6, y: y + 3, "text-anchor": "end", style: "fill:var(--mut);font-size:10px" }), { textContent: Math.round(v) + "°" })); }
    svg.append(Object.assign(mk("text", { x: PL, y: H - 4, style: "fill:var(--mut);font-size:10px" }), { textContent: `hace ${Math.round(n * 3 / 60 * 10) / 10} min` }), Object.assign(mk("text", { x: W - PR, y: H - 4, "text-anchor": "end", style: "fill:var(--mut);font-size:10px" }), { textContent: "ahora" }));
    for (const s of series) { const off = n - s.values.length; svg.append(mk("polyline", { fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", points: s.values.map((v, i) => `${X(i + off)},${Y(v)}`).join(" ") })); const l = s.values.length - 1; if (l >= 0) svg.append(mk("circle", { cx: X(l + off), cy: Y(s.values[l]), r: 3.5, fill: s.color, stroke: "var(--panel)", "stroke-width": 2 })); }
    const cross = mk("line", { y1: PT, y2: H - PB, stroke: "var(--mut)", "stroke-width": 1 }); cross.style.display = "none"; svg.append(cross); geo = { W, PL, PR, n, X, cross };
  }
  wrap.onmousemove = e => {
    if (!geo || !geo.n) return; const r = wrap.getBoundingClientRect(), px = (e.clientX - r.left) * geo.W / r.width, i = Math.max(0, Math.min(geo.n - 1, Math.round((px - geo.PL) / (geo.W - geo.PL - geo.PR) * (geo.n - 1))));
    geo.cross.setAttribute("x1", geo.X(i)); geo.cross.setAttribute("x2", geo.X(i)); geo.cross.style.display = "";
    put(tip, h("div", { style: "opacity:.7" }, `hace ${(geo.n - 1 - i) * 3} s`), ...S.map(s => { const v = s.values[i - (geo.n - s.values.length)]; return v == null ? null : h("div", {}, h("i", { style: `background:${s.color}` }), `${s.name} ${v.toFixed(1)} °C`); }));
    tip.hidden = false; const left = (e.clientX - r.left) + 14; tip.style.left = (left + tip.offsetWidth > r.width ? left - tip.offsetWidth - 28 : left) + "px";
  };
  wrap.onmouseleave = () => { tip.hidden = true; if (geo) geo.cross.style.display = "none"; };
  return { el: wrap, set: draw };
}

/* ---------- navegación ---------- */
function drawNav() {
  const o = st.ov, dc = o ? { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)" }[o.status] : "var(--mut)";
  put($("#nav"), NAV.map(([id, l, ic]) => h("button", { class: st.view === id ? "on" : "", onclick: () => go(id) }, h("span", { class: "ic" }, ic), h("span", { class: "l" }, l), id === "overview" && o ? h("i", { class: "dotn", style: `background:${dc}` }) : null)));
  if (!o) return;
  put($("#mini"), h("b", {}, deg(o.cpu.temp)), h("div", { class: "mut" }, "CPU"), o.gpu.available ? h("div", { class: "r" }, h("span", { class: "mut" }, "GPU"), h("span", {}, deg(o.gpu.temp))) : null, o.battery.present ? h("div", { class: "r" }, h("span", { class: "mut" }, "Batería"), h("span", {}, o.battery.capacity + " %")) : null);
}
function go(v) { clearTimeout(st.timer); st.view = v; try { location.hash = v; } catch {} drawNav(); $("#main").scrollTop = 0; clearInterval(st.lt); ({ overview: viewOverview, sensors: viewSensors, power: viewPower, usage: viewUsage, hardware: viewHardware, alerts: viewAlerts })[v](); }
async function pollOverview() { try { st.ov = await api("/api/overview"); drawNav(); } catch {} return st.ov; }

/* ---------- resumen ---------- */
function viewOverview() {
  const v = $("#view"), R = { sp: { cpu: sparkline("var(--s1)"), gpu: sparkline("var(--s2)"), batt: sparkline("var(--s3)") } }, chart = lineChart();
  const card = (t, ...c) => h("section", { class: "card" }, h("h3", {}, t), ...c);
  R.banner = h("div", { class: "banner" });
  for (const k of ["cpuBig", "gpuBig", "batBig"]) R[k] = h("div", { class: "big" });
  for (const k of ["cpuKv", "gpuKv", "batKv", "stoKv"]) R[k] = h("div", { class: "kv" });
  R.batBar = h("div", { class: "bar" }); R.legend = h("div", { class: "legend" });
  put(v, h("h2", { class: "vt" }, "Resumen"), h("div", { class: "vs" }, "Temperaturas, GPU, batería y energía de tu equipo, en vivo."), R.banner,
    h("div", { class: "grid" }, card("Procesador", R.cpuBig, R.cpuKv, R.sp.cpu.el), card("GPU NVIDIA", R.gpuBig, R.gpuKv, R.sp.gpu.el), card("Batería", R.batBig, R.batBar, R.batKv, R.sp.batt.el), card("SSD · RAM · WiFi", R.stoKv)),
    card("Temperaturas (últimos minutos)", R.legend, chart.el));
  const tick = async () => {
    if (st.view !== "overview") return; const o = await pollOverview(); if (!o) { st.timer = setTimeout(tick, 3000); return; }
    const c = o.cpu, g = o.gpu, b = o.battery, H = o.history, cl = lvOf(c.temp, c.high, c.high);
    put(R.banner, o.warnings.length ? o.warnings.map(w => h("div", { class: "tip " + w.level }, h("span", {}, w.text))) : h("div", { class: "tip ok" }, "Todo en orden: temperaturas normales y sin avisos."));
    R.cpuBig.replaceChildren(deg(c.temp), " ", pill(cl)); put(R.cpuKv, h("span", {}, "Modelo"), h("span", { style: "text-align:right;font-size:12px" }, c.model.replace(/\(R\)|\(TM\)/g, "").replace("12th Gen Intel Core", "Intel")), h("span", {}, "Frecuencia"), h("span", {}, c.freq_avg ? `${c.freq_avg} MHz (máx ${c.freq_max_now})` : "—"), h("span", {}, "Gobernador"), h("span", {}, `${c.governor} · ${c.epp || "—"}`), h("span", {}, "Turbo"), h("span", {}, c.turbo == null ? "—" : c.turbo ? "activado" : "desactivado"), h("span", {}, "Carga (1 min)"), h("span", {}, c.load[0]));
    if (H.cpu.length) R.sp.cpu.set(H.cpu, x => x.toFixed(1) + " °C", 20, 100);
    if (g.available) {
      R.gpuBig.replaceChildren(deg(g.temp), " ", pill(lvOf(g.temp, 85, 95))); put(R.gpuKv, h("span", {}, "Uso"), h("span", {}, g.util + " %"), h("span", {}, "Memoria"), h("span", {}, `${Math.round(g.mem_used)} / ${Math.round(g.mem_total)} MB`), h("span", {}, "Consumo"), h("span", {}, g.power == null ? "—" : g.power.toFixed(1) + " W"), h("span", {}, "Estado"), h("span", {}, g.pstate + (g.pstate === "P8" ? " (reposo)" : "")), h("span", {}, "Modo gráfico"), h("span", {}, g.graphics_mode || "—"));
      if (H.gpu.length) R.sp.gpu.set(H.gpu, x => x.toFixed(1) + " °C", 20, 100);
    } else { R.gpuBig.textContent = "No disponible"; put(R.gpuKv, h("span", {}, "Estado"), h("span", {}, "sin GPU NVIDIA o sin nvidia-smi")); }
    if (b.present) {
      R.batBig.replaceChildren(b.capacity + " %", " ", h("small", {}, BATT[b.status] || b.status)); put(R.batBar, h("i", { style: `width:${b.capacity}%;background:${b.capacity < 20 ? "var(--bad)" : "var(--s3)"}` }));
      put(R.batKv, h("span", {}, "Salud"), h("span", { style: b.health < 80 ? "color:var(--warn)" : "" }, b.health ? b.health + " %" : "—"), h("span", {}, "Ciclos de carga"), h("span", {}, b.cycles ?? "—"), h("span", {}, "Consumo ahora"), h("span", {}, b.power_w ? b.power_w + " W" : "0 W"), h("span", {}, b.status === "Charging" ? "Hasta cargar" : "Autonomía estimada"), h("span", {}, b.hours ? hours(b.hours) : "—"));
      if (H.power.length) R.sp.batt.set(H.power, x => x.toFixed(1) + " W", 0, Math.max(30, ...H.power));
    } else { R.batBig.textContent = "Sin batería"; }
    const row = (n, s) => s ? [h("span", {}, n), h("span", { style: "display:flex;gap:8px;justify-content:flex-end;align-items:center" }, deg(s.value), pill(s.level))] : [];
    put(R.stoKv, row("SSD NVMe", o.nvme), row("Módulo de RAM", o.dimm), row("Tarjeta WiFi", o.wifi), h("span", {}, "Núcleos medidos"), h("span", {}, o.ncores));
    put(R.legend, [["CPU", H.cpu, "var(--s1)"], ["GPU", H.gpu, "var(--s2)"], ["SSD", H.nvme, "var(--s3)"], ["RAM", H.dimm, "var(--s4)"]].map(([n, vals, col]) => h("span", {}, h("i", { style: `background:${col}` }), n, " ", h("b", {}, vals.length ? vals[vals.length - 1].toFixed(1) + " °C" : "—"))));
    chart.set([["CPU", H.cpu, "var(--s1)"], ["GPU", H.gpu, "var(--s2)"], ["SSD", H.nvme, "var(--s3)"], ["RAM", H.dimm, "var(--s4)"]].filter(x => x[1].length).map(([name, values, color]) => ({ name, values, color })));
    st.timer = setTimeout(tick, 3000);
  };
  tick();
}

/* ---------- sensores ---------- */
function viewSensors() {
  const v = $("#view"), box = h("div", {}), chips = h("div", { class: "chips" });
  put(v, h("h2", { class: "vt" }, "Sensores"), h("div", { class: "vs" }, "Todos los sensores que expone tu equipo (hwmon y zonas térmicas), con sus límites."), chips, box);
  const tick = async () => {
    if (st.view !== "sensors") return; let ss; try { ss = await api("/api/sensors"); } catch (e) { return put(box, h("div", { class: "empty" }, e.message)); }
    const groups = [...new Set(ss.map(s => s.group))], temps = ss.filter(s => s.kind === "temp"), others = ss.filter(s => s.kind !== "temp");
    put(chips, ["all", ...groups].map(g => h("button", { class: "chip" + (st.sgroup === g ? " on" : ""), onclick: () => { st.sgroup = g; tick(); } }, g === "all" ? "Todos" : g, ` ${g === "all" ? ss.length : ss.filter(s => s.group === g).length}`)));
    const show = ss.filter(s => st.sgroup === "all" || s.group === st.sgroup), byG = new Map(); const ord = s => /^Paquete/.test(s.label) ? [0, 0] : /^Núcleo (\d+)/.test(s.label) ? [1, +s.label.match(/\d+/)[0]] : [2, 0];
    show.sort((a, b) => a.group.localeCompare(b.group) || ord(a)[0] - ord(b)[0] || ord(a)[1] - ord(b)[1] || a.label.localeCompare(b.label));
    for (const s of show) { if (!byG.has(s.group)) byG.set(s.group, []); byG.get(s.group).push(s); }
    put(box, [...byG.entries()].map(([g, list]) => h("section", { class: "card sgroup" }, h("h3", {}, g), ...list.map(srow))),
      !ss.some(s => s.kind === "fan") ? h("div", { class: "tip info", style: "margin-top:8px" }, h("span", {}, "Ventiladores: tu equipo no expone su velocidad al sistema (es habitual en portátiles Lenovo), así que no aparecen ni se pueden controlar desde aquí.")) : null);
    st.timer = setTimeout(tick, 3000);
  };
  tick();
}
function srow(s) {
  if (s.kind !== "temp") return h("div", { class: "srow" }, h("span", {}, s.label), h("span", { class: "v" }, s.value + " " + s.unit), h("span", { class: "mut", style: "grid-column:3/-1" }, s.kind === "volt" ? "tensión" : s.kind === "power" ? "potencia" : s.kind === "fan" ? "ventilador" : ""));
  const max = Math.max(s.crit || s.high || 100, s.value + 10), col = { ok: "var(--ok)", warm: "var(--warn)", hot: "var(--hot)", crit: "var(--bad)" }[s.level];
  const W = 100, H = 22, hs = s.history || [], mn = Math.min(...hs, s.value) - 1, mx = Math.max(...hs, s.value) + 1;
  const svg = mk("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none", style: "width:100%;height:22px" }); if (hs.length > 1) svg.append(mk("polyline", { fill: "none", stroke: "var(--s1)", "stroke-width": 1.6, "vector-effect": "non-scaling-stroke", points: hs.map((x, i) => `${i / (hs.length - 1) * W},${H - 2 - (x - mn) / (mx - mn) * (H - 4)}`).join(" ") }));
  return h("div", { class: "srow", title: [s.high ? `alto ${s.high} °C` : "", s.crit ? `crítico ${s.crit} °C` : ""].filter(Boolean).join(" · ") },
    h("span", {}, s.label), h("span", { class: "v" }, deg(s.value)), h("div", { class: "tbar" }, h("i", { style: `width:${Math.min(100, s.value / max * 100)}%;background:${col}` }), s.high ? h("u", { style: `left:${Math.min(100, s.high / max * 100)}%` }) : null, s.crit && s.crit !== s.high ? h("u", { style: `left:${Math.min(100, s.crit / max * 100)}%;background:var(--bad)` }) : null), svg, pill(s.level));
}

/* ---------- energía ---------- */
const GFX = {
  integrated: ["💡", "Integrada", "Solo la gráfica Intel; la NVIDIA queda apagada. Máxima autonomía.", "⚠ Si tu salida HDMI está conectada a la NVIDIA (como en este portátil), NO funcionará. CUDA, ollama y los juegos no podrán usar la GPU."],
  hybrid: ["⚖️", "Híbrido", "El escritorio va con la Intel y la NVIDIA se enciende solo cuando una app la pide. El mejor equilibrio.", "Los juegos y apps pesadas hay que lanzarlos pidiendo la gráfica dedicada (p. ej. con __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia delante del comando). La salida HDMI sigue funcionando."],
  nvidia: ["🚀", "NVIDIA", "La NVIDIA siempre activa: máximo rendimiento sin configurar nada, pero más consumo y calor.", "Gasta bastante más batería."],
  compute: ["🧮", "Cálculo", "La NVIDIA solo para cálculo (CUDA); no pinta la pantalla.", "⚠ Si tu salida HDMI cuelga de la NVIDIA, NO funcionará, y la NVIDIA no se usará para gráficos."] };
const PROF = { battery: ["🔋", "Batería", "Prioriza la autonomía: limita la frecuencia y desactiva el Turbo."], balanced: ["⚖️", "Equilibrado", "El punto medio: rinde bien y gasta lo justo."], performance: ["🚀", "Rendimiento", "Máxima velocidad: Turbo activado. Más calor y más consumo."] };
function viewPower() {
  const v = $("#view"), box = h("div", {});
  const extra = h("div", {});
  put(v, h("h2", { class: "vt" }, "Energía"), h("div", { class: "vs" }, "Perfil de energía, procesador, batería y modo gráfico."), box, extra); powerExtras(extra);
  const tick = async () => {
    if (st.view !== "power") return; let d; try { d = await api("/api/power"); } catch (e) { return put(box, h("div", { class: "empty" }, e.message)); }
    const pr = d.profile, c = d.cpu, b = d.battery, g = d.gpu, card = (t, ...x) => h("section", { class: "card" }, h("h3", {}, t), ...x);
    const profiles = pr.available ? h("div", { class: "profiles" }, ...Object.entries(PROF).map(([k, [e, n, desc]]) => h("button", { class: "prof" + (pr.current === k ? " on" : ""), onclick: () => setProfile(k) }, h("div", { class: "e" }, e), h("b", {}, n), pr.current === k && pr.cpu ? h("div", { class: "pill ok", style: "margin:6px 0 2px" }, "activo · CPU " + pr.cpu) : null, h("div", { class: "d" }, desc)))) : h("div", { class: "mut" }, "Este equipo no tiene system76-power: no se puede cambiar el perfil desde aquí.");
    const maxF = c.freq_max || 1, fbars = h("div", { class: "fbars" }, ...c.freqs.map((f, i) => h("div", { class: "fb" }, h("div", { class: "col" }, h("i", { style: `height:${Math.min(100, f / maxF * 100)}%` })), `${i + 1}`, h("div", {}, f))));
    const bat = b.present ? card("Batería", h("div", { class: "kv two" }, h("span", {}, "Carga"), h("span", {}, `${b.capacity} % · ${BATT[b.status] || b.status}`), h("span", {}, "Capacidad actual"), h("span", {}, `${b.energy_full_wh} Wh de ${b.energy_design_wh} Wh de fábrica`), h("span", {}, "Salud"), h("span", {}, b.health ? b.health + " %" : "—"), h("span", {}, "Ciclos"), h("span", {}, b.cycles ?? "—"), h("span", {}, "Tensión"), h("span", {}, b.voltage_v ? b.voltage_v + " V" : "—"), h("span", {}, "Consumo ahora"), h("span", {}, (b.power_w ?? 0) + " W"), h("span", {}, "Tecnología"), h("span", {}, `${b.technology || "—"} · ${b.manufacturer || ""} ${b.model || ""}`), h("span", {}, "Conectada a corriente"), h("span", {}, b.ac ? "sí" : "no")),
      h("div", { class: "bar", title: "Salud" }, h("i", { style: `width:${b.health || 0}%;background:${b.health < 80 ? "var(--warn)" : "var(--s3)"}` })),
      h("div", { class: "mut", style: "font-size:12.5px;margin-top:8px" }, b.limit_supported ? "Tu equipo permite limitar la carga." : "Límite de carga: tu portátil no lo expone al sistema, así que no se puede limitar (por ejemplo al 80 %) desde aquí.")) : null;
    const gm = g.graphics_mode, pend = d.graphics_pending;
    const gfx = card("Modo gráfico", h("div", { class: "mut", style: "font-size:13px" }, "Qué gráfica dibuja el escritorio. Cambiarlo exige reiniciar."),
      pend ? h("div", { class: "tip warn", style: "margin-top:10px" }, h("span", {}, `Pendiente de reinicio: «${pend.previous}» → «${pend.mode}». Para deshacerlo antes de reiniciar, elige de nuevo «${pend.previous}».`)) : null,
      h("div", { class: "gfx" }, ...Object.entries(GFX).map(([k, [e, n, desc]]) => h("button", { class: "prof" + (gm === k ? " on" : ""), disabled: !g.available && !gm, onclick: () => gm === k ? null : changeGraphics(k, gm) }, h("div", { class: "e" }, e), h("b", {}, n), gm === k ? h("div", { class: "pill ok", style: "margin:4px 0" }, pend ? "configurado" : "activo") : null, pend && pend.previous === k && gm !== k ? h("div", { class: "pill info", style: "margin:4px 0" }, "activo ahora") : null, h("div", { class: "d" }, desc)))));
    put(box, h("div", { class: "sec", style: "margin-top:0" }, "Perfil de energía"), profiles,
      h("div", { class: "sec" }, "Procesador"), card(c.model, h("div", { class: "kv two" }, h("span", {}, "Gobernador"), h("span", {}, c.governor), h("span", {}, "Preferencia de energía"), h("span", {}, c.epp || "—"), h("span", {}, "Turbo"), h("span", {}, c.turbo == null ? "—" : c.turbo ? "activado" : "desactivado"), h("span", {}, "Controlador"), h("span", {}, "intel_pstate · " + (c.pstate || "—")), h("span", {}, "Frecuencia máxima"), h("span", {}, c.freq_max ? c.freq_max + " MHz" : "—")), h("div", { class: "mut", style: "font-size:12px;margin-top:10px" }, `Frecuencia actual de cada uno de los ${c.threads} hilos (MHz):`), fbars),
      h("div", { class: "sec" }, "Batería y gráficos"), h("div", { class: "set" }, bat, gfx));
    st.timer = setTimeout(tick, 3000);
  };
  tick();
}
async function changeGraphics(mode, cur) {
  const [, n, desc, warn] = GFX[mode];
  const ok = await ask(`Cambiar a modo ${n}`, [h("div", {}, desc), h("div", { style: "margin-top:8px;color:var(--fg)" }, warn), h("div", { style: "margin-top:10px;color:var(--fg)" }, "El cambio solo se nota al reiniciar. Reconstruye el arranque (initramfs) y puede tardar 1–2 minutos: no apagues ni desenchufes el equipo mientras tanto."), h("div", { style: "margin-top:10px" }, `Para volver atrás: «system76-power graphics ${cur}» y reiniciar (o elegir «${cur}» aquí).`)], "Cambiar", mode);
  if (!ok) return;
  document.querySelectorAll(".gfx .prof").forEach(b => b.disabled = true); toast("Aplicando… no apagues ni cierres el equipo (1–2 min)");
  try { const r = await post("/api/graphics", { mode }); toast(`Modo «${mode}» configurado. Reinicia para aplicarlo.` + (r.warning ? `\nAviso: ${r.warning}` : ""), "ok"); } catch (e) { toast(e.message, "bad"); }
  clearTimeout(st.timer); viewPower();
}
async function setProfile(p) {
  try { const r = await post("/api/profile", { profile: p }); toast(`Perfil «${PROF[p][1]}» activado · CPU ${r.cpu || ""}` + (r.warning ? `\nAviso (sin importancia): ${r.warning}` : ""), "ok"); } catch (e) { toast(e.message, "bad"); }
  clearTimeout(st.timer); viewPower();
}

/* ---------- hardware ---------- */
async function viewHardware() {
  const v = $("#view"); put(v, h("h2", { class: "vt" }, "Hardware"), h("div", { class: "vs" }, "Inventario de tu equipo."), h("div", { class: "skel" }), h("div", { class: "skel" }));
  let d; try { d = await api("/api/hardware"); } catch (e) { return put(v, h("div", { class: "empty" }, e.message)); } if (st.view !== "hardware") return;
  const card = (t, ...x) => h("section", { class: "card" }, h("h3", {}, t), ...x), kv = (rows, cls = "kv two") => h("div", { class: cls }, ...rows.filter(r => r[1]).flatMap(([a, b]) => [h("span", {}, a), h("span", {}, b)]));
  const sys = d.system, cpu = d.cpu, mem = (d.memory_total_kb / 1048576).toFixed(1) + " GB";
  const ramBox = h("div", {}), ramBtn = h("button", { class: "btn sm", onclick: async () => { ramBtn.disabled = true; put(ramBox, h("div", { class: "mut" }, "Esperando tu contraseña…")); try { const r = await privileged(() => post("/api/ram-modules", {}), () => post("/api/ram-modules", { from_file: true })); if (!r) { put(ramBox, null); ramBtn.disabled = false; return; } put(ramBox, r.modules.length ? h("ul", { class: "pl" }, r.modules.map(m => h("li", {}, h("b", {}, m.size), ` ${m.type || ""} ${m.speed || ""} · ${m.maker || ""} ${m.part || ""} · ${m.form || ""} (${m.locator})`))) : h("div", { class: "mut" }, "dmidecode no devolvió módulos.")); } catch (e) { put(ramBox, h("div", { style: "color:var(--bad)" }, e.message)); } ramBtn.disabled = false; } }, "Leer módulos de RAM (pide contraseña)");
  put(v, h("h2", { class: "vt" }, "Hardware"), h("div", { class: "vs" }, `${sys.vendor || ""} ${sys.product || sys.model || ""} · kernel ${d.kernel} `, h("a", { class: "btn sm", href: "/api/report", download: "" }, "⬇ Descargar informe")),
    h("div", { class: "set" },
      card("Equipo", kv([["Fabricante", sys.vendor], ["Modelo", sys.product], ["Referencia", sys.model], ["BIOS", [sys.bios_vendor, sys.bios, sys.bios_date].filter(Boolean).join(" · ")]])),
      card("Procesador", kv([["Modelo", cpu.model], ["Núcleos / hilos", `${cpu.cores} / ${cpu.threads}`], ["Frecuencia", cpu.max_mhz ? `${Math.round(cpu.min_mhz)}–${Math.round(cpu.max_mhz)} MHz` : null], ["Caché L2 / L3", [cpu.l2, cpu.l3].filter(Boolean).join(" · ").replace(/ \(\d+ instances?\)/g, "")], ["Arquitectura", cpu.arch]])),
      card("Memoria", kv([["Total", mem]]), h("div", { style: "margin-top:10px" }, ramBtn), ramBox),
      card("Gráficos", h("ul", { class: "pl" }, d.gpus.map(g => h("li", {}, g.line.replace(/^\S+ /, "").replace(/ \[[0-9a-f:]+\]/g, "").replace("VGA compatible controller: ", ""), h("div", { class: "mut", style: "font-size:12px" }, "controlador: " + (g.driver || "—")))))),
      card("Pantallas", h("ul", { class: "pl" }, d.displays.outputs.map(o => h("li", {}, h("b", {}, o.name), ` (${o.gpu}) · `, o.status === "connected" ? `conectada ${o.mode || ""}` : "sin conectar"))), d.displays.backlight.map(b => h("div", { class: "mut", style: "margin-top:8px" }, `Brillo ${b.name}: ${b.percent} %`))),
      card("Almacenamiento", h("ul", { class: "pl" }, d.storage.map(s => h("li", {}, h("b", {}, s.model || s.name), ` · ${s.size} · ${s.tran || ""}${s.rotational ? " · disco mecánico" : ""}`))), !d.smart_tools && d.storage.some(x => x.tran !== "nvme") ? h("div", { class: "mut", style: "font-size:12.5px;margin-top:8px" }, "Para ver la salud SMART de los discos hace falta el paquete smartmontools (instálalo con Horse Pack).") : null),
      nvmeCard(),
      card("Red y Bluetooth", h("ul", { class: "pl" }, d.network.map(n => h("li", {}, h("b", {}, n.device), ` · ${n.type} · ${n.state}${n.connection ? " · " + n.connection : ""}`)), d.bluetooth ? h("li", {}, h("b", {}, "Bluetooth"), ` · ${d.bluetooth.name} · ${d.bluetooth.powered === "yes" ? "encendido" : "apagado"}`) : null)),
      card("Audio", h("div", { class: "mut", style: "font-size:12px" }, "Salidas"), h("ul", { class: "pl" }, d.audio.sinks.map(s => h("li", {}, s.name, s.default ? h("span", { class: "pill ok", style: "margin-left:8px" }, "predeterminada") : null))), h("div", { class: "mut", style: "font-size:12px;margin-top:8px" }, "Entradas"), h("ul", { class: "pl" }, d.audio.sources.map(s => h("li", {}, s.name, s.default ? h("span", { class: "pill ok", style: "margin-left:8px" }, "predeterminada") : null)))),
      card("USB conectados", h("ul", { class: "pl" }, d.usb.map(u => h("li", { class: "mono" }, u))))),
    h("details", { class: "det" }, h("summary", {}, `Dispositivos PCI (${d.pci.length})`), h("pre", {}, d.pci.join("\n"))));
}

/* ---------- acciones con permisos: diálogo de contraseña o, si el escritorio no lo ofrece, comando para la terminal ---------- */
async function privileged(call, afterTerminal) {
  try { return await call(); } catch (e) {
    if (!e.data || !e.data.terminal_cmd) throw e;
    const cmd = e.data.terminal_cmd, pre = h("pre", { class: "cmd" }, cmd);
    const copy = h("button", { class: "btn sm", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(cmd); copy.textContent = "Copiado ✓"; } catch { const r = document.createRange(); r.selectNodeContents(pre); getSelection().removeAllRanges(); getSelection().addRange(r); copy.textContent = "Selecciónalo y copia con Ctrl+C"; } } }, "Copiar comando");
    const term = h("button", { class: "btn sm p", type: "button", onclick: async () => { try { await post("/api/terminal", { cmd }); term.textContent = "Terminal abierta ✓ (confirma allí)"; } catch (x) { term.textContent = x.message; } } }, "Abrir en terminal");
    const ok = await ask("Hace falta una terminal", [e.data.error, pre, h("div", { style: "margin-top:8px;display:flex;gap:8px;flex-wrap:wrap" }, term, copy), h("div", { class: "mut", style: "margin-top:8px;font-size:12.5px" }, "Revisa el comando antes de ejecutarlo: es exactamente lo que haría Chameleon. Cuando termine, pulsa «Ya lo ejecuté».")], "Ya lo ejecuté");
    return ok ? await afterTerminal() : undefined;
  }
}

/* ---------- gráfica con eje de tiempo (historial) ---------- */
const fmtT = (t, long) => { const d = new Date(t * 1000); return long ? d.toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : d.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }); };
function timeChart(unit, dec = 1, fixed = null) {
  const wrap = h("div", { class: "chart" }), svg = mk("svg", {}), tip = h("div", { class: "ctip" }); tip.hidden = true; wrap.append(svg, tip);
  let S = [], geo = null;
  function draw(series, t0, t1, gap) {
    S = series; const W = wrap.clientWidth || 640, H = 200, PL = 42, PR = 10, PT = 8, PB = 20; svg.replaceChildren(); svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const all = series.flatMap(s => s.pts.map(p => p[1])); if (!all.length) { geo = null; return; }
    let lo = fixed ? fixed[0] : Math.max(0, Math.floor(Math.min(...all) * 0.9)), hi = fixed ? fixed[1] : Math.ceil(Math.max(...all) * 1.1 + 0.5); if (hi - lo < 2) hi = lo + 2;
    const X = t => PL + (t - t0) / Math.max(t1 - t0, 1) * (W - PL - PR), Y = v => PT + (1 - (v - lo) / (hi - lo)) * (H - PT - PB);
    for (let k = 0; k <= 3; k++) { const v = lo + (hi - lo) * k / 3, y = Y(v); svg.append(mk("line", { x1: PL, x2: W - PR, y1: y, y2: y, stroke: "var(--line)", "stroke-width": 1 }), Object.assign(mk("text", { x: PL - 6, y: y + 3, "text-anchor": "end", style: "fill:var(--mut);font-size:10px" }), { textContent: Math.round(v) + unit })); }
    const long = t1 - t0 > 86400; for (let k = 0; k <= 4; k++) { const t = t0 + (t1 - t0) * k / 4; svg.append(Object.assign(mk("text", { x: Math.min(Math.max(X(t), PL + 14), W - PR - 14), y: H - 4, "text-anchor": "middle", style: "fill:var(--mut);font-size:10px" }), { textContent: fmtT(t, long) })); }
    for (const s of series) { let seg = []; const flush = () => { if (seg.length > 1) svg.append(mk("polyline", { fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", points: seg.join(" ") })); else if (seg.length === 1) { const [x, y] = seg[0].split(",");  svg.append(mk("circle", { cx: x, cy: y, r: 2.5, fill: s.color })); } seg = []; };
      let prev = null; for (const [t, v] of s.pts) { if (prev != null && t - prev > gap) flush(); seg.push(`${X(t).toFixed(1)},${Y(v).toFixed(1)}`); prev = t; } flush(); }
    const cross = mk("line", { y1: PT, y2: H - PB, stroke: "var(--mut)", "stroke-width": 1 }); cross.style.display = "none"; svg.append(cross); geo = { W, PL, PR, t0, t1, X, cross };
  }
  wrap.onmousemove = e => {
    if (!geo) return; const r = wrap.getBoundingClientRect(), px = (e.clientX - r.left) * geo.W / r.width, t = geo.t0 + (px - geo.PL) / (geo.W - geo.PL - geo.PR) * (geo.t1 - geo.t0);
    const near = S.map(s => { let b = null; for (const p of s.pts) if (b == null || Math.abs(p[0] - t) < Math.abs(b[0] - t)) b = p; return b && Math.abs(b[0] - t) < (geo.t1 - geo.t0) / 40 ? { s, p: b } : null; }).filter(Boolean);
    if (!near.length) { tip.hidden = true; geo.cross.style.display = "none"; return; }
    geo.cross.setAttribute("x1", geo.X(near[0].p[0])); geo.cross.setAttribute("x2", geo.X(near[0].p[0])); geo.cross.style.display = "";
    put(tip, h("div", { style: "opacity:.7" }, fmtT(near[0].p[0], true)), near.map(n => h("div", {}, h("i", { style: `background:${n.s.color}` }), `${n.s.name} ${n.p[1].toFixed(dec)} ${unit}`)));
    tip.hidden = false; const left = (e.clientX - r.left) + 14; tip.style.left = (left + tip.offsetWidth > r.width ? left - tip.offsetWidth - 28 : left) + "px";
  };
  wrap.onmouseleave = () => { tip.hidden = true; if (geo) geo.cross.style.display = "none"; };
  return { el: wrap, set: draw };
}

/* ---------- consumo (historial + quién gasta) ---------- */
const RANGES = [["1h", "1 hora"], ["6h", "6 horas"], ["24h", "24 horas"], ["7d", "7 días"], ["14d", "14 días"]], RSEC = { "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800, "14d": 1209600 };
function viewUsage() {
  const v = $("#view"), card = (t, ...x) => h("section", { class: "card" }, h("h3", {}, t), ...x);
  const cW = timeChart(" W", 1), cP = timeChart(" %", 0, [0, 100]), cT = timeChart(" °C", 1), sumBox = h("div", { class: "set" }), note = h("div", { class: "empty" }), grid = h("div", {}), chips = h("div", { class: "chips" }), procBox = h("div", {});
  st.range = st.range || "6h";
  const drawChips = () => put(chips, RANGES.map(([k, l]) => h("button", { class: "chip" + (st.range === k ? " on" : ""), onclick: () => { st.range = k; drawChips(); load(); } }, l)));
  const leg = a => h("div", { class: "legend" }, a.map(([c, n]) => h("span", {}, h("i", { style: `background:${c}` }), n)));
  put(grid, h("div", { class: "set", style: "margin-bottom:14px" }, card("Consumo de la batería", leg([["var(--s2)", "vatios"]]), cW.el), card("Nivel de batería", leg([["var(--s3)", "carga"]]), cP.el)), card("Temperaturas", leg([["var(--s1)", "CPU"], ["var(--s4)", "SSD"], ["var(--s2)", "GPU"]]), cT.el));
  put(v, h("h2", { class: "vt" }, "Consumo"), h("div", { class: "vs" }, "Cómo se comporta tu equipo con el tiempo y qué lo gasta ahora mismo."), chips, sumBox, note, grid, h("div", { class: "sec" }, "Quién gasta ahora"), procBox);
  drawChips();
  async function load() {
    let d; try { d = await api("/api/history?range=" + st.range); } catch (e) { return put(note, e.message); } if (st.view !== "usage") return;
    const now = Date.now() / 1000, t1 = now, t0 = now - RSEC[st.range], gap = Math.max(d.step * 3, 900), ser = (k, name, color) => ({ name, color, pts: d.points.filter(p => p[k] != null).map(p => [p.t, p[k]]) });
    const has = d.points.length >= 2; note.hidden = has; grid.hidden = !has; sumBox.hidden = !has;
    if (!has) { put(note, "Chameleon guarda una muestra por minuto en segundo plano. Aún hay pocos datos: vuelve en unos minutos."); return; }
    cW.set([ser("w", "Consumo", "var(--s2)")], t0, t1, gap); cP.set([ser("p", "Carga", "var(--s3)")], t0, t1, gap);
    cT.set([ser("c", "CPU", "var(--s1)"), ser("n", "SSD", "var(--s4)"), ser("g", "GPU", "var(--s2)")].filter(s => s.pts.length), t0, t1, gap);
    const s = d.summary, kvc = (t, rows) => card(t, h("div", { class: "kv two" }, ...rows.filter(r => r[1] != null).flatMap(([a, b]) => [h("span", {}, a), h("span", {}, b)])));
    put(sumBox, kvc("Con batería", [["Consumo medio", s.avg_w_discharging != null ? s.avg_w_discharging + " W" : null], ["Pico", s.peak_w != null ? s.peak_w + " W" : null], ["Tiempo descargando", s.minutes_discharging ? hours(s.minutes_discharging / 60) : null],
      ["Autonomía a ese ritmo", s.est_full_hours != null ? `≈ ${s.est_full_hours} h con carga llena` : null], ["Autonomía ahora", s.now_hours != null ? hours(s.now_hours) : null]]),
      kvc("Temperaturas máximas", [["CPU", s.max_cpu != null ? deg(s.max_cpu) : null], ["SSD", s.max_nvme != null ? deg(s.max_nvme) : null], ["GPU", s.max_gpu != null ? deg(s.max_gpu) : "no se mide mientras duerme"]]));
  }
  load(); st.lt = setInterval(() => { if (st.view !== "usage") return clearInterval(st.lt); load(); }, 60000);
  const procs = async () => {
    if (st.view !== "usage") return; let d; try { d = await api("/api/procs"); } catch (e) { return put(procBox, h("div", { class: "empty" }, e.message)); } if (st.view !== "usage") return;
    const max = Math.max(...d.apps.map(a => a.share), 1);
    put(procBox, h("section", { class: "card" }, h("div", { class: "mut", style: "font-size:12.5px;margin-bottom:8px" }, d.dyn_w != null ? `Tu equipo gasta ahora ${d.dyn_w} W por encima de su consumo en reposo; el reparto es una estimación según el uso de procesador de cada programa.` : d.discharging ? "Aún no hay datos suficientes para estimar vatios por programa (hacen falta unos 10 minutos de historial con batería)." : "Conectado a la corriente: se muestra el uso de procesador de cada programa (los vatios solo se estiman con batería)."),
      d.apps.length ? h("div", { class: "rank" }, d.apps.map(a => h("div", { class: "rk" }, h("div", { class: "nm", title: a.name }, a.name, a.procs > 1 ? h("span", { class: "mut" }, ` ×${a.procs}`) : null), h("div", { class: "tbar" }, h("i", { style: `width:${a.share / max * 100}%;background:var(--s1)` })), h("div", { class: "vv" }, `${a.cpu_core_pct} %`), h("div", { class: "vv mut" }, a.est_w != null ? `≈ ${a.est_w} W` : "—")))) : h("div", { class: "mut" }, "Equipo en reposo."),
      h("div", { class: "mut", style: "font-size:12px;margin-top:10px" }, "«%» es la parte de un núcleo que usa (puede pasar de 100 con varios hilos)."),
      h("div", { class: "sec", style: "margin-top:14px" }, "Gráfica NVIDIA"), d.gpu.awake ? (d.gpu.procs.length ? h("ul", { class: "pl" }, d.gpu.procs.map(p => h("li", {}, h("b", {}, p.name), ` · ${p.type || ""} · ${p.sm ?? "—"} % GPU · ${p.mem ?? "—"} % memoria`))) : h("div", { class: "mut" }, "Despierta, pero ningún programa la usa ahora.")) : h("div", { class: "mut" }, "Dormida (ahorrando batería). No la despierto solo para mirar.")));
    st.timer = setTimeout(procs, 4000);
  };
  procs();
}

/* ---------- avisos y automatización ---------- */
const PNAME = { battery: "Batería", balanced: "Equilibrado", performance: "Rendimiento" };
async function viewAlerts() {
  const v = $("#view"); put(v, h("h2", { class: "vt" }, "Avisos"), h("div", { class: "vs" }, "Notificaciones de escritorio y perfil automático. Chameleon vigila en segundo plano con muy poco consumo (lee unos archivos cada 30 s)."), h("div", { class: "skel" }));
  let cfg, ev; try { [cfg, ev] = await Promise.all([api("/api/settings"), api("/api/events")]); } catch (e) { return put(v, h("div", { class: "empty" }, e.message)); } if (st.view !== "alerts") return;
  const card = (t, ...x) => h("section", { class: "card" }, h("h3", {}, t), ...x);
  const save = async (sec, k, val, el) => { try { const r = await post("/api/settings", { [sec]: { [k]: val } }); cfg = r; toast("Guardado", "ok"); } catch (e) { toast(e.message, "bad"); viewAlerts(); } };
  const sw = (sec, k, label) => h("label", { class: "row sw" }, h("input", { type: "checkbox", checked: cfg[sec][k], onchange: e => save(sec, k, e.target.checked) }), h("span", {}, label));
  const num = (label, sec, k, unit, lo, hi) => h("label", { class: "row" }, h("span", {}, label), h("input", { type: "number", class: "num", min: lo, max: hi, value: cfg[sec][k], onchange: e => { const n = parseInt(e.target.value, 10); if (!(n >= lo && n <= hi)) { toast(`Debe estar entre ${lo} y ${hi}`, "bad"); e.target.value = cfg[sec][k]; return; } save(sec, k, n); } }), h("span", { class: "mut" }, unit));
  const sel = (label, k) => h("label", { class: "row" }, h("span", {}, label), h("select", { onchange: e => save("auto_profile", k, e.target.value) }, Object.entries(PNAME).map(([p, n]) => h("option", { value: p, selected: cfg.auto_profile[k] === p }, n))));
  const test = h("button", { class: "btn sm", onclick: async () => { try { const r = await post("/api/test-alert", {}); toast(!r.delivered ? "No se pudo enviar la notificación (¿hay servicio de notificaciones?)." : r.dnd ? "Enviado, pero «No molestar» está activado en COSMIC: no saldrá en pantalla (queda en el centro de notificaciones del panel)." : "Enviado: míralo en la esquina de la pantalla (no en esta página).", r.delivered && !r.dnd ? "ok" : "bad"); } catch (e) { toast(e.message, "bad"); } } }, "Probar un aviso");
  const dndTip = cfg._dnd ? h("div", { class: "tip warn", style: "margin-bottom:14px" }, h("span", {}, "«No molestar» está activado en COSMIC: ningún aviso de escritorio (de Chameleon ni de otras apps) aparece en pantalla; solo quedan en el centro de notificaciones del panel. Desactívalo desde el icono de notificaciones del panel para verlos. Mientras tanto, aquí abajo sigue el registro de avisos.")) : null;
  const holdTip = cfg._hold ? h("div", { class: "tip info", style: "margin-bottom:14px" }, h("span", {}, `⏸ El perfil automático está en pausa mientras dure el modo «${cfg._hold.label || cfg._hold.by}» de ZOO Linux. Se reanuda al salir del modo o si cambias el perfil a mano.`)) : null;
  const KIND = { alert: ["warm", "aviso"], profile: ["info", "perfil"], info: ["info", "info"] };
  put(v, h("h2", { class: "vt" }, "Avisos"), h("div", { class: "vs" }, "Notificaciones de escritorio y perfil automático. Chameleon vigila en segundo plano con muy poco consumo (lee unos archivos cada 30 s)."), dndTip, holdTip,
    h("div", { class: "set" },
      card("Avisos de escritorio", sw("alerts", "enabled", "Avisarme cuando algo pase de estos límites"), h("div", { class: "fields" }, num("Procesador", "alerts", "cpu_temp", "°C", 60, 110), num("Gráfica NVIDIA", "alerts", "gpu_temp", "°C", 60, 100), num("Disco NVMe", "alerts", "nvme_temp", "°C", 40, 85), num("Batería baja", "alerts", "batt_low", "%", 5, 50), num("Batería crítica", "alerts", "batt_crit", "%", 3, 30)),
        h("div", { class: "mut", style: "font-size:12.5px;margin:6px 0 10px" }, "Solo avisa tras dos lecturas seguidas por encima del límite y no repite el mismo aviso antes de 20 minutos. La gráfica NVIDIA solo se mide cuando ya está despierta."), test),
      card("Perfil automático", sw("auto_profile", "enabled", "Cambiar de perfil al enchufar o desenchufar el cargador"), h("div", { class: "fields" }, sel("Con cargador", "ac"), sel("Con batería", "battery")),
        h("div", { class: "mut", style: "font-size:12.5px;margin-top:6px" }, "Solo actúa en el momento de enchufar o desenchufar; si luego eliges otro perfil a mano, se respeta.")),
      card("Historial", sw("history", "enabled", "Guardar una muestra por minuto (14 días, ~2 MB)"), h("div", { class: "mut", style: "font-size:12.5px;margin-top:6px" }, "Alimenta las gráficas de Consumo y el informe. Se guarda solo en este equipo.")),
      card("Últimos avisos", ev.length ? h("ul", { class: "pl" }, ev.slice(0, 15).map(e => h("li", {}, h("span", { class: "pill " + (KIND[e.kind] || KIND.info)[0] }, (KIND[e.kind] || KIND.info)[1]), " ", h("b", {}, e.title), h("div", { class: "mut", style: "font-size:12px" }, fmtT(e.t, true) + (e.body ? " · " + e.body : "") + (e.kind === "alert" && !e.notified ? " · no se pudo mostrar en el escritorio" : ""))))) : h("div", { class: "mut" }, "Todavía no ha saltado ningún aviso."))));
}

/* ---------- extras de Energía: brillo y límite de GPU (fuera del refresco automático) ---------- */
async function powerExtras(box) {
  const card = (t, ...x) => h("section", { class: "card" }, h("h3", {}, t), ...x);
  let br, gl; try { [br, gl] = await Promise.all([api("/api/brightness"), api("/api/gpu-limits")]); } catch { return; } if (st.view !== "power") return;
  const slider = (label, cur, which, lo, step) => { const out = h("b", {}, cur.pct + " %"), inp = h("input", { type: "range", class: "rng", min: lo, max: 100, step, value: cur.pct, oninput: () => { out.textContent = inp.value + " %"; }, onchange: async () => { try { const r = await post("/api/brightness", { which, pct: +inp.value }); out.textContent = r.pct + " %"; inp.value = r.pct; } catch (e) { toast(e.message, "bad"); } } }); return h("label", { class: "row slide" }, h("span", {}, label), inp, out); };
  const bright = card("Brillo", br.screen ? slider("Pantalla", br.screen, "screen", 5, 1) : h("div", { class: "mut" }, "Tu pantalla no expone el control de brillo."),
    br.keyboard ? slider("Teclado", br.keyboard, "keyboard", 0, Math.max(1, Math.round(100 / br.keyboard.max))) : h("div", { class: "mut", style: "margin-top:8px;font-size:12.5px" }, "Retroiluminación del teclado: este equipo no la expone al sistema (se controla con las teclas Fn)."));
  let gcard, pst = gl.persist || { enabled: false };
  const pnote = () => pst.enabled ? h("div", { class: "tip ok", style: "margin-top:10px" }, h("span", {}, `Se aplica en cada arranque: ${pst.watts} W (servicio del sistema «chameleon-gpu-limit»).`)) : null;
  const removePersist = async () => {
    const ok = await ask("Quitar el arranque automático", ["Se borra el servicio que fija el límite en cada arranque (pide tu contraseña). El límite actual sigue hasta que reinicies; después la GPU vuelve a su valor normal."], "Quitar"); if (!ok) return;
    try { const r = await privileged(() => post("/api/gpu-limit", { persist: false }), () => api("/api/gpu-limits")); if (r) toast(r.persist && r.persist.enabled === false ? "Arranque automático quitado" : "Todavía figura instalado: revisa que el comando terminara sin errores", r.persist && r.persist.enabled === false ? "ok" : "bad"); powerExtras(box); } catch (e) { toast(e.message, "bad"); }
  };
  if (gl.supported) {
    const out = h("b", {}, gl.current + " W"), inp = h("input", { type: "range", class: "rng", min: gl.min, max: gl.max, step: 1, value: gl.current, oninput: () => { out.textContent = inp.value + " W"; } });
    const keep = h("input", { type: "checkbox", checked: pst.enabled, onchange: () => { if (!keep.checked && pst.enabled) { keep.checked = true; removePersist(); } } });
    const apply = async w => {
      const persist = keep.checked;
      const ok = await ask("Cambiar el límite de la GPU", [`Se limitará la gráfica NVIDIA a ${w} W (de fábrica ${gl.default} W). Pide tu contraseña de administrador. Un límite muy bajo reduce el rendimiento en juegos.`,
        persist ? h("div", { style: "margin-top:8px;color:var(--fg)" }, `Además se creará un servicio del sistema que lo vuelve a aplicar en cada arranque. Puedes quitarlo cuando quieras desde aquí.`) : h("div", { style: "margin-top:8px;color:var(--fg)" }, "Se pierde al reiniciar.")], "Aplicar"); if (!ok) return;
      try { const r = await privileged(() => post("/api/gpu-limit", persist ? { watts: w, persist: true } : { watts: w }), () => api("/api/gpu-limits")); if (r) toast(r.current != null && Math.abs(r.current - w) <= 1 ? `Límite de GPU: ${r.current} W · ${persist ? "se mantiene en cada arranque" : "se pierde al reiniciar"}` : `La GPU sigue en ${r.current} W: revisa que el comando terminara sin errores (o el firmware lo reajustó).`, r.current != null && Math.abs(r.current - w) <= 1 ? "ok" : "bad"); powerExtras(box); } catch (e) { toast(e.message, "bad"); powerExtras(box); }
    };
    const factory = () => pst.enabled ? removePersist() : apply(Math.round(gl.default));
    gcard = card("Límite de potencia de la GPU", h("label", { class: "row slide" }, h("span", {}, "Límite"), inp, out), h("label", { class: "row sw", style: "margin-top:6px" }, keep, h("span", {}, "Mantener tras reiniciar")),
      h("div", { style: "margin-top:8px;display:flex;gap:8px;flex-wrap:wrap" }, h("button", { class: "btn sm p", onclick: () => apply(+inp.value) }, "Aplicar"), h("button", { class: "btn sm", onclick: factory }, pst.enabled ? "Volver al valor de fábrica" : `Valor de fábrica (${Math.round(gl.default)} W)`)), pnote(),
      h("div", { class: "mut", style: "font-size:12px;margin-top:8px" }, "Sin «Mantener tras reiniciar», el límite se pierde al reiniciar. El firmware del portátil puede reajustarlo por su cuenta."));
  } else gcard = card("Límite de potencia de la GPU", h("div", { class: "mut" }, gl.why || "No disponible."), pnote(), pst.enabled ? h("div", { style: "margin-top:10px" }, h("button", { class: "btn sm", onclick: removePersist }, "Quitar arranque automático")) : null);
  put(box, h("div", { class: "set", style: "margin-top:14px" }, bright, gcard));
}

/* ---------- salud del disco NVMe (tarjeta de Hardware) ---------- */
function nvmeCard() {
  const box = h("div", {}), card = h("section", { class: "card" }, h("h3", {}, "Salud del disco NVMe"), box);
  const VD = { ok: ["ok", "Buena"], warn: ["warm", "Revisar"], bad: ["bad", "Mala"] };
  const draw = d => {
    const s = d.smart, dv = d.devices[0];
    const btn = h("button", { class: "btn sm", onclick: async () => { btn.disabled = true; btn.textContent = "Esperando tu contraseña…"; try { const r = await privileged(() => post("/api/nvme-smart", {}), () => post("/api/nvme-smart", { from_file: true })); if (!r) { btn.disabled = false; btn.textContent = s ? "Actualizar lectura" : "Leer salud completa"; return; } d.smart = r; draw(d); } catch (e) { toast(e.message, "bad"); btn.disabled = false; btn.textContent = s ? "Actualizar lectura" : "Leer salud completa"; } } }, s ? "Actualizar lectura" : "Leer salud completa");
    put(box, dv ? h("div", { class: "kv two" }, h("span", {}, "Disco"), h("span", {}, `${dv.model || dv.name} · firmware ${dv.firmware || "—"}`), h("span", {}, "Estado"), h("span", {}, dv.state === "live" ? "operativo" : dv.state || "—"), h("span", {}, "Escrito desde el arranque"), h("span", {}, dv.written_since_boot_gb != null ? dv.written_since_boot_gb + " GB" : "—")) : h("div", { class: "mut" }, "No se detecta ningún disco NVMe."),
      s ? h("div", { style: "margin-top:12px" }, h("span", { class: "pill " + VD[s.verdict][0] }, VD[s.verdict][1]), s.issues.length ? h("span", { class: "mut", style: "margin-left:8px;font-size:12.5px" }, s.issues.join(" · ")) : null,
        h("div", { class: "kv two" }, h("span", {}, "Desgaste"), h("span", {}, `${s.used_pct} % usado`), h("span", {}, "Reserva"), h("span", {}, `${s.spare_pct} % (mínimo ${s.spare_threshold_pct} %)`), h("span", {}, "Datos escritos"), h("span", {}, `${s.tb_written} TB`), h("span", {}, "Datos leídos"), h("span", {}, `${s.tb_read} TB`),
          h("span", {}, "Horas encendido"), h("span", {}, `${s.power_on_hours} h (${(s.power_on_hours / 24).toFixed(0)} días)`), h("span", {}, "Encendidos"), h("span", {}, s.power_cycles), h("span", {}, "Apagados bruscos"), h("span", {}, s.unsafe_shutdowns), h("span", {}, "Errores de medio"), h("span", {}, s.media_errors)),
        h("div", { class: "mut", style: "font-size:12px;margin-top:6px" }, "Leído el " + fmtT(s.at, true))) : h("div", { class: "mut", style: "font-size:12.5px;margin:10px 0" }, "La salud completa (desgaste, horas, errores) necesita permisos de administrador: se pide la contraseña solo cuando pulsas el botón."),
      dv ? h("div", { style: "margin-top:10px" }, btn) : null);
  };
  api("/api/nvme").then(draw).catch(e => put(box, h("div", { class: "mut" }, e.message)));
  return card;
}

document.addEventListener("keydown", e => { if (e.key === "Escape") $("#dlg").open && $("#dlg").close(); });
const hv = location.hash.slice(1); if (NAV.some(n => n[0] === hv)) st.view = hv;
pollOverview().then(() => go(st.view));
