"use strict";
/* Ant — detalle de un enjambre: cabecera con estado y resultado, equipo, conversación del equipo, grafo de comunicación y línea de tiempo. */

const SW_STATUS = { running: ["en ejecución", "ok"], waiting: ["esperando", "warn"], done: ["terminado ✓", "ok"], idle: ["terminado", ""] };
const MEMBER_STATE = { working: ["trabajando", "ok"], waiting: ["esperando", "warn"], killed: ["terminado", ""] };
const ACT_RULES = [["wait", ["wait"]], ["coordinate", ["swarm", "post_message", "read_board", "message"]], ["run", ["run_command", "command", "exec", "terminal", "bash", "shell"]],
  ["browse", ["browser", "url", "web", "fetch", "http"]], ["write", ["write", "replace", "edit", "create", "patch", "delete", "rename", "move"]], ["read", ["read", "view", "list", "grep", "find", "search", "glob", "outline"]]];
const ACT_ES = { write: ["✍️", "escribiendo código"], read: ["📖", "leyendo archivos"], run: ["⚙️", "ejecutando comandos"], think: ["💭", "pensando"], coordinate: ["📣", "coordinando"], wait: ["⏳", "esperando a otros"], browse: ["🌐", "consultando la web"], other: ["🛠️", "trabajando"] };
function actKind(a) { // mismo criterio que el servidor: la herramienta en uso → categoría legible
  a = String(a || "").trim(); if (!a) return "";
  const name = a.split(":")[0].trim().toLowerCase(); if (/\s/.test(name) || name.length > 40) return "think";
  for (const [k, keys] of ACT_RULES) if (keys.some((x) => name.includes(x))) return k; return "other";
}
const agentHue = (s) => { let x = 7; for (const c of String(s)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
const agentColor = (n) => (n === "coordinator" ? "hsl(268 38% 40%)" : n === "monitor" ? "hsl(210 10% 40%)" : `hsl(${agentHue(n)} 52% 36%)`); // oscuros: el texto blanco cumple AA
const ava = (n, size = 26) => h("span", { class: "ava", "aria-hidden": "true", style: { background: agentColor(n), width: size + "px", height: size + "px", fontSize: Math.round(size * 0.46) + "px" } }, String(n).charAt(0).toUpperCase());
const hhmm = (t) => (t ? new Date(t * 1000).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" }) : "");
const longTime = (t) => (t ? new Date(t * 1000).toLocaleString("es", { dateStyle: "medium", timeStyle: "medium" }) : "");
const modelShort = (m) => String(m || "").replace(/^gemini-/, "").replace(/-agy$/, "");
const LEAD = /^\s*(?:@[a-z][\w-]*[\s,]*)*/i;
const kindOf = (t) => { // el tipo lo da el INICIO del mensaje (tras las menciones): un brief que pide un [done] no es una entrega
  const b = String(t).replace(LEAD, "");
  return /^\[done\]/i.test(b) ? "done" : /^\[stall\]/i.test(b) ? "stall" : /^(\*\*)?(hallazgos|bloqueo|blocker)/i.test(b) ? "finding" : "msg";
};
function splitTo(text) { const m = String(text).match(/^\s*((?:@[a-z][\w-]*[\s,]*)+)/i); return m ? { to: m[1].match(/@[\w-]+/g).map((x) => x.slice(1)), body: String(text).slice(m[0].length).trim() } : { to: [], body: String(text) }; }
const isInfra = (m) => m.shared || m.name === "coordinator" || m.name === "monitor";

// ---------- mensaje del tablero
function boardMsg(m, jump) {
  const t = String(m.text), kind = kindOf(t), { to, body } = splitTo(t), text = (kind === "done" ? body.replace(/^\[done\]\s*/i, "") : body) || t;
  const long = text.length > 420 || text.split("\n").length > 9, bodyEl = h("div", { class: "mbody" + (long ? " clamp" : "") }, md(text));
  const more = long ? h("button", { class: "more", type: "button", "aria-expanded": "false", onclick: () => { const open = !bodyEl.classList.toggle("clamp"); more.setAttribute("aria-expanded", String(open)); put(more, open ? "Ver menos" : "Ver más"); } }, "Ver más") : null;
  return h("div", { class: "msg" + (kind === "done" ? " done" : kind === "stall" ? " stall" : kind === "finding" ? " finding" : ""), id: "m-" + m.seq, dataset: { seq: m.seq } },
    h("div", { class: "mhead" }, ava(m.agent, 24), h("span", { class: "who" }, m.agent),
      to.length ? h("span", { class: "to", "aria-label": "para " + to.join(", ") }, "→ ", to.slice(0, 5).map((x) => h("span", { class: "mention" }, "@" + x))) : null,
      kind === "done" ? h("span", { class: "chip ok" }, "entrega") : kind === "stall" ? h("span", { class: "chip bad" }, "bloqueo") : kind === "finding" ? h("span", { class: "chip warn" }, "hallazgos") : null,
      h("span", { class: "sp" }), m.t ? h("time", { class: "mtime", title: longTime(m.t) }, hhmm(m.t)) : null, h("span", { class: "seq" }, "#" + m.seq),
      h("button", { class: "ibtn", type: "button", title: "Copiar el mensaje", "aria-label": "Copiar el mensaje #" + m.seq, onclick: () => copy(t, "Mensaje copiado") }, "⧉")),
    bodyEl, more);
}

// ---------- tarjeta de agente (pulsar = filtrar el tablero por él)
function memberCard(m, sel, pick, jump) {
  const A = m.state === "waiting" ? ACT_ES.wait : ACT_ES[actKind(m.activity)], [stTxt, stCls] = MEMBER_STATE[m.state] || [m.state, ""], tok = m.tokens && m.tokens.total;
  const meta = [modelShort(m.model), m.steps ? `${m.steps} paso${m.steps > 1 ? "s" : ""}` : null, tok ? fmt.tok(tok) + " tokens" + (m.shared ? " (todos los lanzamientos)" : "") : null, m.sent ? `${m.sent} mensaje${m.sent > 1 ? "s" : ""}` : null].filter(Boolean).join(" · ");
  const dn = m.done ? splitTo(m.done.text).body.replace(/^\[done\]\s*/i, "") : "";
  return h("div", { class: "card member" + (sel ? " sel" : ""), role: "button", tabindex: "0", "aria-pressed": String(sel), title: "Pulsa para ver solo sus mensajes", onclick: () => pick(m.name), onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(m.name); } } },
    h("div", { class: "row" }, ava(m.name, 30), h("b", { class: "mname" }, m.name), h("span", { class: "sp" }), h("span", { class: "chip " + stCls }, h("span", { class: "dot " + m.state }), stTxt)),
    h("div", { class: "row wrap", style: { marginTop: "6px", gap: "6px" } },
      m.done ? h("button", { class: "chip ok linkchip", type: "button", title: "Ir a su entrega en el tablero", onclick: (e) => { e.stopPropagation(); jump(m.done.seq); } }, "entregó #" + m.done.seq) : null,
      h("span", { class: "xs mut" }, meta || " ")),
    m.unread ? h("div", { style: { marginTop: "6px" } }, h("span", { class: "chip warn", title: "Mensajes del tablero que aún no ha leído" }, m.unread + " sin leer")) : null,
    m.failed ? h("div", { class: "small", style: { color: "var(--bad)", marginTop: "4px" } }, "Su último paso falló") : null,
    m.state !== "killed" && A ? h("div", { class: "small", style: { marginTop: "6px" } }, A[0] + " " + A[1]) : null,
    m.activity ? h("div", { class: "act" }, m.activity) : null,
    m.state === "killed" && dn ? h("div", { class: "small mut", style: { marginTop: "6px" } }, "Entrega: " + fmt.short(dn, 130)) : null);
}

// ---------- quién delega a quién: reparto, dependencias entre agentes y correcciones, en rondas
function flowModel(d) {
  const names = new Set(["coordinator", ...d.members.map((m) => m.name)]), deleg = new Map(), deps = new Map(), fb = new Map(), delivered = new Map(), asks = new Map(), alerts = { n: 0 };
  const WAIT = /(?:espera(?:r)?\s+a\s+que|espera(?:r)?\s+(?:por|a)|wait(?:s)?\s+for|hasta\s+que)\s+([^.\n]{0,240})/gi;
  for (const m of d.board) {
    const A = m.agent, t = String(m.text), kind = kindOf(t), { to, body } = splitTo(t), lead = to.filter((x) => names.has(x) && x !== A);
    if (A === "coordinator") {
      if (kind === "done" || !lead.length) continue;
      for (const r of lead) {
        if (r === "monitor" || deleg.has(r)) continue; deleg.set(r, { seq: m.seq, t: m.t }); // la primera orden a cada agente es el reparto; su brief dice a quién espera
        const dep = new Set(); let w; WAIT.lastIndex = 0;
        while ((w = WAIT.exec(body))) for (const x of (w[1].match(/@[a-z][\w-]*/gi) || []).map((q) => q.slice(1).toLowerCase())) if (names.has(x) && x !== r && x !== "coordinator" && x !== "monitor") dep.add(x);
        if (dep.size) deps.set(r, dep);
      }
    } else if (A === "monitor") { alerts.n++; }
    else if (kind === "done") { if (!delivered.has(A)) delivered.set(A, { seq: m.seq, t: m.t }); }
    else for (const r of lead) {
      if (r === "coordinator") asks.set(A, (asks.get(A) || 0) + 1);
      else if (r !== "monitor") { const k = [A, r].sort().join("|"), e = fb.get(k) || { a: [A, r].sort()[0], b: [A, r].sort()[1], n: 0 }; e.n++; fb.set(k, e); }
    }
  }
  const workers = d.members.map((m) => m.name).filter((n) => n !== "coordinator" && n !== "monitor"), layer = new Map(workers.map((n) => [n, 1]));
  for (let i = 0; i < workers.length; i++) { let ch = false; for (const [y, xs] of deps) for (const x of xs) if (layer.has(x) && layer.has(y) && layer.get(y) <= layer.get(x) && layer.get(x) < 6) { layer.set(y, layer.get(x) + 1); ch = true; } if (!ch) break; }
  return { names, deleg, deps, fb, delivered, asks, alerts, workers, layer, rounds: Math.max(1, ...layer.values()) };
}
function delegationGraph(d, pick, selected) {
  const F = flowModel(d), NS = "http://www.w3.org/2000/svg", mk = (t, a, kids) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); (kids || []).forEach((c) => e.append(c)); return e; }, tx = (x) => document.createTextNode(x);
  const st = Object.fromEntries(d.members.map((m) => [m.name, m.state])), W = 780, R = 18, LG = 96, TOP = 44, H = TOP + F.rounds * LG + 50, X0 = 168, XW = W - X0 - 24, pos = {};
  const rows = []; for (let k = 1; k <= F.rounds; k++) rows.push(F.workers.filter((n) => F.layer.get(n) === k).sort((a, b) => ((F.deleg.get(a) || {}).seq || 1e9) - ((F.deleg.get(b) || {}).seq || 1e9) || a.localeCompare(b)));
  pos.coordinator = { x: X0 + XW / 2, y: TOP }; if (F.alerts.n) pos.monitor = { x: X0 + XW / 2 + 170, y: TOP };
  rows.forEach((r, i) => r.forEach((n, j) => (pos[n] = { x: X0 + (XW * (j + 1)) / (r.length + 1), y: TOP + (i + 1) * LG })));
  const svg = mk("svg", { class: "graph", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Quién delega a quién: el coordinador reparte ${F.deleg.size} tareas en ${F.rounds} ronda${F.rounds > 1 ? "s" : ""}; ${[...F.deps].reduce((n, [, xs]) => n + xs.size, 0)} dependencias entre agentes y ${F.fb.size} cruces de correcciones` });
  const gBand = mk("g", {}), gFb = mk("g", {}), gE = mk("g", {}), gN = mk("g", {}); svg.append(gBand, gFb, gE, gN);
  for (let k = 0; k <= F.rounds; k++) { const y = TOP + k * LG; gBand.append(mk("text", { x: 8, y: y + 4, class: "cap" }, [tx(k === 0 ? "Reparte" : F.rounds === 1 ? "Ejecutan" : k === 1 ? "Ronda 1 · en paralelo" : `Ronda ${k} · tras las entregas`)])); if (k) gBand.append(mk("line", { x1: 4, x2: W - 4, y1: y - LG / 2 - 6, y2: y - LG / 2 - 6, class: "band" })); }
  const els = [], arrow = (x, y, ang, col, op) => mk("polygon", { points: "0,0 -10,-5 -10,5", transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(1)})`, fill: col, opacity: op });
  const edge = (cls, from, to, path, col, w, op, dash, title, ends) => { const g = mk("g", { class: "edge " + cls, "data-from": from, "data-to": to }, [mk("title", {}, [tx(title)]), mk("path", { d: path, fill: "none", stroke: col, "stroke-width": w, opacity: op, "stroke-linecap": "round", "stroke-dasharray": dash || "none" }), ...ends]); els.push(g); return g; };
  const vcurve = (a, b) => { /* las flechas arrancan bajo el nombre del agente: no lo cruzan */ const y1 = a.y + R + 21, y2 = b.y - R - 3, m = (y1 + y2) / 2; return { d: `M${a.x.toFixed(1)} ${y1} C${a.x.toFixed(1)} ${m} ${b.x.toFixed(1)} ${m} ${b.x.toFixed(1)} ${y2}`, x: b.x, y: y2 }; };
  // 1) correcciones y dudas entre agentes (cruces de ida y vuelta): arcos ámbar
  for (const e of F.fb.values()) { const a = pos[e.a], b = pos[e.b]; if (!a || !b) continue; const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, off = Math.min(70, 26 + len * 0.18) * (dx >= 0 ? 1 : -1), mx = (a.x + b.x) / 2 + (dy === 0 ? 0 : off), my = (a.y + b.y) / 2 - (dy === 0 ? Math.min(60, 22 + len * 0.16) : 0);
    const sx = a.x + (dx >= 0 ? R : -R) * (dy === 0 ? 1 : 0.9), ex = b.x + (dx >= 0 ? -R : R) * (dy === 0 ? 1 : 0.9), col = "var(--warn)";
    const g = edge("fb", e.a, e.b, `M${sx.toFixed(1)} ${a.y - (dy === 0 ? 4 : 0)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${b.y - (dy === 0 ? 4 : 0)}`, col, 1.4 + Math.min(e.n, 8) * 0.5, 0.7, "5 4", `${e.a} ↔ ${e.b}: ${e.n} mensaje${e.n > 1 ? "s" : ""} de correcciones o dudas`, []);
    gFb.append(g); g.append(mk("text", { x: mx, y: my + (dy === 0 ? -4 : 4), "text-anchor": "middle", class: "elab" }, [tx("↔ " + e.n)])); }
  // 2) reparto del coordinador (continuo a los de la ronda 1, tenue a los que esperan) y 3) entregas que alguien espera (verde)
  for (const n of F.workers) { const b = pos[n], a = pos.coordinator; if (!b || !F.deleg.has(n)) continue; const first = F.layer.get(n) === 1, c = vcurve(a, b), col = agentColor("coordinator");
    gE.append(edge("deleg", "coordinator", n, c.d, col, first ? 2.2 : 1.2, first ? 0.6 : 0.28, first ? "" : "3 5", `El coordinador reparte la tarea a ${n} (#${F.deleg.get(n).seq})`, [arrow(c.x, c.y + 2, 90, col, first ? 0.85 : 0.4)])); }
  for (const [y, xs] of F.deps) for (const x of xs) { const a = pos[x], b = pos[y]; if (!a || !b) continue; const c = vcurve(a, b), col = "var(--ok)";
    gE.append(edge("dep", x, y, c.d, col, 2.2, 0.75, "", `${y} espera la entrega de ${x}`, [arrow(c.x, c.y + 2, 90, col, 0.9)])); }
  // nodos
  const light = (n) => els.forEach((g) => g.classList.toggle("dim", !!n && g.dataset.from !== n && g.dataset.to !== n));
  for (const n of ["coordinator", ...(F.alerts.n ? ["monitor"] : []), ...F.workers]) {
    const p = pos[n]; if (!p) continue; const dead = st[n] === "killed", dl = F.delivered.get(n), ask = F.asks.get(n);
    const g = mk("g", { class: "node" + (selected === n ? " sel" : ""), tabindex: "0", role: "button", "aria-label": `${n}: filtrar el tablero`, "aria-pressed": String(selected === n) }, [
      mk("title", {}, [tx(`${n}${dl ? " · entregó al coordinador #" + dl.seq + (dl.t ? " (" + hhmm(dl.t) + ")" : "") : ""}${ask ? " · " + ask + " mensaje(s) al coordinador" : ""}`)]),
      mk("circle", { cx: p.x, cy: p.y, r: R, fill: dead ? "var(--surface)" : agentColor(n), stroke: agentColor(n), "stroke-width": 3.5 }),
      mk("text", { x: p.x, y: p.y + 4.8, "text-anchor": "middle", class: "ini", fill: dead ? agentColor(n) : "#fff" }, [tx(n.charAt(0).toUpperCase())]),
      mk("text", { x: p.x, y: p.y + R + 15, "text-anchor": "middle", class: "lbl" }, [tx(fmt.short(n, 15))])]);
    if (dl) g.append(mk("circle", { cx: p.x + 13, cy: p.y - 13, r: 7.5, class: "okb" }), mk("text", { x: p.x + 13, y: p.y - 9.6, "text-anchor": "middle", class: "okt" }, [tx("✓")]));
    if (ask) g.append(mk("circle", { cx: p.x - 13, cy: p.y - 13, r: 7.5, class: "askb" }), mk("text", { x: p.x - 13, y: p.y - 9.6, "text-anchor": "middle", class: "okt" }, [tx(String(ask))]));
    if (n === "monitor") { gE.append(mk("path", { d: `M${p.x - R - 2} ${p.y} L${pos.coordinator.x + R + 3} ${p.y}`, stroke: "var(--bad)", "stroke-width": 1.6, "stroke-dasharray": "4 4", opacity: 0.7, fill: "none" })); g.append(mk("text", { x: p.x, y: p.y - R - 6, "text-anchor": "middle", class: "elab" }, [tx(F.alerts.n + " alerta" + (F.alerts.n > 1 ? "s" : ""))])); }
    g.addEventListener("mouseenter", () => light(n)); g.addEventListener("mouseleave", () => light("")); g.addEventListener("focus", () => light(n)); g.addEventListener("blur", () => light(""));
    g.addEventListener("click", () => pick(n)); g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(n); } }); gN.append(g);
  }
  const sw = (cls, txt) => h("span", { class: "lg" }, h("i", { class: "sw " + cls }), txt), nDeps = [...F.deps].reduce((n, [, xs]) => n + xs.size, 0);
  return h("div", {}, svg,
    h("div", { class: "legend xs" }, sw("deleg", "reparte la tarea"), sw("dep", "entrega a quien la espera"), sw("fb", "correcciones y dudas (nº de mensajes)"), h("span", { class: "lg" }, h("i", { class: "okdot" }, "✓"), "entregó al coordinador"), F.asks.size ? h("span", { class: "lg" }, h("i", { class: "askdot" }, "n"), "mensajes al coordinador") : null),
    h("div", { class: "xs mut", style: { marginTop: "4px" } }, `El coordinador reparte ${F.deleg.size} tarea${F.deleg.size === 1 ? "" : "s"} en ${F.rounds} ronda${F.rounds > 1 ? "s" : ""}` + (nDeps ? ` · ${nDeps} dependencia${nDeps > 1 ? "s" : ""} entre agentes` : "") + (F.fb.size ? ` · ${F.fb.size} cruce${F.fb.size > 1 ? "s" : ""} de correcciones` : "") + " · pulsa un agente para filtrar el tablero"));
}

// ---------- línea de tiempo: cuándo entró cada agente, cuándo habló y cuándo entregó
function timeline(d, jump) {
  const msgs = d.board.filter((m) => m.t); if (msgs.length < 2) return h("div", { class: "card empty small" }, "La línea de tiempo aparece cuando hay mensajes con hora.");
  const now = Date.now() / 1000, running = d.status === "running" || d.status === "waiting";
  let t0 = Math.min(d.started || Infinity, ...msgs.map((m) => m.t)), t1 = Math.max(...msgs.map((m) => m.t), d.ended || 0, running ? now : 0); if (t1 - t0 < 60) t1 = t0 + 60;
  const names = ["coordinator", ...d.members.filter((m) => !isInfra(m)).map((m) => m.name)], LW = 96, CW = 340, RH = 30, W = LW + CW + 14, H = names.length * RH + 36, x = (t) => LW + ((t - t0) / (t1 - t0)) * CW;
  const NS = "http://www.w3.org/2000/svg", mk = (t, a, kids) => { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, a[k]); (kids || []).forEach((c) => e.append(c)); return e; }, tx = (s) => document.createTextNode(s);
  const svg = mk("svg", { class: "timeline", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Línea de tiempo de la actividad de cada agente" });
  [0, 0.5, 1].forEach((f) => { const xx = LW + f * CW; svg.append(mk("line", { x1: xx, x2: xx, y1: 4, y2: H - 22, class: "grid" }), mk("text", { x: xx, y: H - 6, "text-anchor": f === 0 ? "start" : f === 1 ? "end" : "middle", class: "ax" }, [tx(hhmm(t0 + f * (t1 - t0)))])); });
  names.forEach((n, i) => {
    const y = 8 + i * RH, mine = msgs.filter((m) => m.agent === n), mem = d.members.find((m) => m.name === n), first = (mem && mem.first_seen) || (mine[0] && mine[0].t) || t0;
    const end = (mem && mem.done && mem.done.t) || (n === "coordinator" ? (d.ended || (running ? now : t1)) : mine.length ? mine[mine.length - 1].t : first), col = agentColor(n);
    svg.append(mk("text", { x: LW - 8, y: y + 15, "text-anchor": "end", class: "lbl" }, [tx(fmt.short(n, 13))]),
      mk("rect", { x: x(first), y: y + 7, width: Math.max(3, x(end) - x(first)), height: 9, rx: 4.5, fill: col, opacity: 0.32 }));
    mine.forEach((m) => { const isDone = mem && mem.done && mem.done.seq === m.seq, c = mk("g", { class: "tdot", tabindex: "0", role: "button", "aria-label": `${n} #${m.seq} ${hhmm(m.t)}` }, [mk("title", {}, [tx(`${n} · #${m.seq} · ${hhmm(m.t)}${isDone ? " · entrega" : ""}`)]),
      isDone ? mk("text", { x: x(m.t), y: y + 18, "text-anchor": "middle", class: "chk", fill: col }, [tx("✓")]) : mk("circle", { cx: x(m.t), cy: y + 11.5, r: 4.5, fill: col })]); c.addEventListener("click", () => jump(m.seq)); c.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(m.seq); } }); svg.append(c); });
  });
  return svg;
}

// ---------- cabecera: estado, cifras, lanzamientos hermanos, tarea y resultado
function swarmHead(d) {
  const [stTxt, stCls] = SW_STATUS[d.status] || ["", ""], live = d.status === "running" || d.status === "waiting", dur = d.started ? (live ? null : (d.ended || d.last_t || d.started) - d.started) : null;
  const pct = d.workers_total ? Math.round((d.workers_done / d.workers_total) * 100) : 0, last = d.result;
  const longTask = (d.prompt || "").length > 260;
  return h("div", {},
    h("div", { class: "page-head mt-s", style: { marginBottom: "10px" } }, h("div", { style: { minWidth: 0 } },
      h("div", { class: "row wrap", style: { gap: "10px" } }, h("h1", {}, d.title), h("span", { class: "chip " + stCls }, live ? h("span", { class: "dot working" }) : null, stTxt)),
      h("div", { class: "row wrap chips-row", style: { marginTop: "8px", gap: "8px" } },
        h("span", { class: "chip" }, `${d.members.length} agentes`), h("span", { class: "chip" }, `${d.total ?? d.board.length} mensajes`),
        d.started ? h("span", { class: "chip", title: "Desde la orden /swarm hasta " + (live ? "ahora" : "el último mensaje") }, "⏱ ", live ? since(d.started) : fmt.dur(dur)) : null,
        d.tokens ? h("span", { class: "chip", title: "Entrada + salida de los agentes de este lanzamiento (sin el coordinador, que sirve a todos los de la conversación)" }, "◈ " + fmt.tok(d.tokens) + " tokens de los agentes") : null,
        h("span", { class: "chip" }, "actividad ", agoEl(d.updated))))),
    d.of > 1 ? h("nav", { class: "steps", "aria-label": "Lanzamientos de esta conversación de Antigravity" }, h("span", { class: "xs mut steps-l" }, "Esta conversación tuvo " + d.of + " /swarm:"),
      d.siblings.map((s) => h("a", { class: "step", href: "#/swarms/" + s.id, "aria-current": s.n === d.n ? "page" : null, title: s.title }, h("span", { class: "dot " + (s.status === "running" ? "working" : s.status === "waiting" ? "waiting" : "done") }), `${s.n}. ${fmt.short(s.title, 30)}`))) : null,
    d.prompt ? h("details", { class: "card task mt-s", open: !longTask }, h("summary", { class: "b" }, "Tarea"), h("div", { class: "mt-s small", style: { whiteSpace: "pre-wrap" } }, d.prompt)) : null,
    d.workers_total ? h("div", { class: "prog mt-s" }, h("div", { class: "bar", role: "progressbar", "aria-valuenow": pct, "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "Agentes que ya entregaron" }, h("i", { class: "w", style: { width: pct + "%" } })),
      h("div", { class: "xs mut" }, `${d.workers_done} de ${d.workers_total} agentes entregaron su trabajo`)) : null,
    last ? resultCard(last) : null);
}
function resultCard(r) {
  const text = splitTo(r.text).body.replace(/^\[done\]\s*/i, "") || r.text, long = text.length > 500 || text.split("\n").length > 10, body = h("div", { class: "mbody" + (long ? " clamp" : "") }, md(text));
  const more = long ? h("button", { class: "more", type: "button", onclick: () => { const open = !body.classList.toggle("clamp"); put(more, open ? "Ver menos" : "Ver más"); } }, "Ver más") : null;
  return h("section", { class: "card result mt-s", "aria-label": "Resultado final" }, h("div", { class: "row wrap" }, h("h2", {}, "Resultado final"), h("span", { class: "chip ok" }, "[done] del coordinador"), h("span", { class: "sp" }), r.t ? h("span", { class: "xs mut" }, hhmm(r.t)) : null), body, more);
}

async function SwarmDetail(ctx, id) {
  document.title = "Enjambre · Ant";
  const S = { filter: "", kind: "all", q: "", paused: false, data: null, sig: "", fsig: "" };
  const hd = h("div"), team = h("div", { class: "members" }), feed = h("div", { class: "feed", tabindex: "0", "aria-label": "Conversación del equipo", role: "log" }), gbox = h("div"), tbox = h("div"), filt = h("div", { class: "pickers" }), count = h("span", { class: "xs mut", "aria-live": "polite" });
  const search = h("input", { type: "search", placeholder: "Buscar en el tablero…", "aria-label": "Buscar en el tablero", style: { maxWidth: "230px" }, oninput: (e) => { S.q = e.target.value.trim().toLowerCase(); S.fsig = ""; paintFeed(); } });
  const pauseBtn = h("button", { class: "btn sm", "aria-pressed": "false", onclick: () => { S.paused = !S.paused; pauseBtn.setAttribute("aria-pressed", String(S.paused)); put(pauseBtn, S.paused ? "Reanudar" : "Pausar"); } }, "Pausar");
  const endBtn = h("button", { class: "btn sm ghost", type: "button", onclick: () => (feed.scrollTop = feed.scrollHeight) }, "Ir al final");
  const kinds = [["all", "Todo"], ["done", "Entregas"], ["alert", "Alertas"]], kindBar = h("div", { class: "seg", role: "group", "aria-label": "Tipo de mensaje" });
  const pick = (n) => { S.filter = S.filter === n ? "" : n; S.fsig = ""; paint(); paintFeed(); };
  const jump = (seq) => { // lleva al mensaje (quitando antes los filtros que lo oculten) y lo resalta
    if (S.filter || S.kind !== "all" || S.q) { S.filter = ""; S.kind = "all"; S.q = ""; search.value = ""; S.fsig = ""; paint(); paintFeed(); }
    const e = document.getElementById("m-" + seq); if (!e) { toast("Ese mensaje no está entre los últimos 300 del tablero", "bad"); return; }
    e.scrollIntoView({ block: "center" }); e.classList.add("flash"); setTimeout(() => e.classList.remove("flash"), 1800);
  };
  put(ctx.root, h("a", { href: "#/swarms", class: "small" }, "← Enjambres"), hd,
    h("h2", { class: "mt mb" }, "Equipo"), team,
    h("h2", { class: "mt mb" }, "Quién delega a quién"), h("div", { class: "card flow" }, gbox),
    h("div", { class: "split mt" },
      h("section", {}, h("div", { class: "row wrap mb", style: { gap: "8px" } }, h("h2", {}, "Conversación del equipo"), h("span", { class: "sp" }), search, kindBar, endBtn, pauseBtn), filt, h("div", { class: "mt-s" }, count), h("div", { class: "mt-s" }, feed)),
      h("aside", { class: "side" }, h("h2", { class: "mb" }, "Línea de tiempo"), tbox)));
  const paintKinds = () => put(kindBar, kinds.map(([k, l]) => h("button", { type: "button", "aria-pressed": String(S.kind === k), onclick: () => { S.kind = k; S.fsig = ""; paintKinds(); paintFeed(); } }, l)));
  const paintFilter = () => put(filt, h("button", { "aria-pressed": String(!S.filter), onclick: () => { S.filter = ""; S.fsig = ""; paint(); paintFeed(); } }, "Todos"),
    S.data.members.map((m) => h("button", { "aria-pressed": String(S.filter === m.name), onclick: () => pick(m.name) }, m.name)));
  const matches = (m) => {
    if (S.filter && !(m.agent === S.filter || new RegExp("@" + S.filter + "(?![\\w-])", "i").test(m.text))) return false;
    const k = kindOf(String(m.text)); if (S.kind === "done" && k !== "done") return false; if (S.kind === "alert" && k !== "stall" && k !== "finding") return false;
    return !S.q || (String(m.text) + " " + m.agent).toLowerCase().includes(S.q);
  };
  const paintFeed = () => {
    if (!S.data) return;
    const rows = S.data.board.filter(matches), s = [S.data.total, S.filter, S.kind, S.q, rows.length].join("|"); if (s === S.fsig) return; S.fsig = s;
    const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40, out = []; let prev = null;
    for (const m of rows) { if (prev && m.t && prev.t && m.t - prev.t > 600) out.push(h("div", { class: "gap" }, "⏱ " + fmt.dur(m.t - prev.t) + " después")); out.push(boardMsg(m, jump)); prev = m; }
    put(feed, rows.length ? out : h("div", { class: "empty small" }, S.data.board.length ? "Ningún mensaje coincide con los filtros." : "Sin mensajes todavía."));
    put(count, `${rows.length} de ${S.data.board.length} mensajes` + (S.data.total > S.data.board.length ? ` (los últimos; hay ${S.data.total} en total)` : ""));
    if (atBottom) feed.scrollTop = feed.scrollHeight;
  };
  const paint = () => {
    const d = S.data;
    put(hd, swarmHead(d));
    const order = [...d.members].sort((a, b) => Number(isInfra(a)) - Number(isInfra(b)) || ["working", "waiting", "killed"].indexOf(a.state) - ["working", "waiting", "killed"].indexOf(b.state) || a.name.localeCompare(b.name));
    put(team, order.map((m) => memberCard(m, S.filter === m.name, pick, jump)));
    put(gbox, d.board.length ? delegationGraph(d, pick, S.filter) : h("div", { class: "card empty small" }, "Aún no hay mensajes: el reparto aparecerá aquí."));
    put(tbox, timeline(d, jump)); paintFilter(); paintKinds();
  };
  paintKinds();
  ctx.every(async () => {
    if (S.paused) return;
    const r = await api("/api/swarm/" + id); if (!ctx.alive()) return;
    if (!r.ok) { put(hd, h("div", { class: "banner bad mt" }, "Este enjambre ya no existe.")); return; }
    S.data = r.data; const d = S.data;
    const s = JSON.stringify([d.status, d.title, d.total, d.tokens, d.ended, d.members.map((m) => [m.name, m.state, m.unread, m.steps, m.activity, m.sent, m.done && m.done.seq, m.tokens && m.tokens.total]), d.edges, d.siblings.map((x) => x.status)]);
    if (s !== S.sig) { S.sig = s; paint(); }
    paintFeed();
  }, 2500);
}
