"use strict";
// La Oficina del Prompt — escenario 1920x1080 para OBS (Browser Source).
// Parámetros: ?title= ?reveal=1 (muestra la tarea real) ?demo=1 ?sound=1 ?control=1 ?bg=transparent
const Q = new URLSearchParams(location.search);
const REVEAL = Q.get("reveal") === "1", DEMO = Q.get("demo") === "1", SOUND = Q.get("sound") === "1", CONTROL = Q.get("control") === "1";
if (Q.get("title")) { document.getElementById("title").textContent = Q.get("title"); document.title = Q.get("title"); }
if (Q.get("bg") === "transparent") document.body.classList.add("transparent");
const $ = (s, r = document) => r.querySelector(s);
const stage = $("#stage");
// Figurantes: rellenan la oficina cuando hay pocos agentes reales (?ambient=0 los desactiva, ?ambient=N fija cuántos).
const AMB_N = Q.get("ambient") === null ? 5 : Math.max(0, Math.min(8, parseInt(Q.get("ambient"), 10) || 0));

// ----- escala: el escenario 1920x1080 se ajusta a la ventana
function fit() {
  const k = Math.min(innerWidth / 1920, (innerHeight - (CONTROL ? 54 : 0)) / 1080);
  stage.style.setProperty("--sc", `scale(${k})`);
  stage.style.transform = `scale(${k})`;
  stage.style.left = (innerWidth - 1920 * k) / 2 + "px";
}
addEventListener("resize", fit); fit();

// ----- textos (satira; NUNCA se muestra contenido real salvo ?reveal=1)
const NAMES = ["Becario Beto", "Marta de Prompts", "Señor Token", "Dev Pepe", "Karen de QA", "Lucho Lint", "Rosa Refactor", "Tito Tests"];
const LINES = {
  working: ["Sí, jefe. Ya mismo, jefe.", "Compilando… mi dignidad.", "Esto era para ayer, lo sé.", "Alucinando con propósito.", "Un commit más y me voy… mentira.", "¿Café? Soy un LLM, no bebo.", "Tecleando por un salario en tokens."],
  idle: ["Esperando órdenes…", "Mirando al vacío, productivamente.", "¿Hay sprint hoy?", "Zzz… (modo ahorro de tokens)"],
  done: ["¡Entregado, jefe! ¿Me das un token extra?", "Listo. ¿Ya puedo irme?", "Funciona en mi máquina.", "100% completado. 0% reconocido."],
  failed: ["Me quemé, jefe.", "Error 500: mi alma.", "Eso no estaba en mi contrato.", "Lo juro, ayer funcionaba."],
  quota: ["Sin tokens. Sin sueldo.", "Cuota agotada: renuncio.", "Pido un aumento… de cuota."],
  stopped: ["Me despidieron por Slack."],
};
const BOSS = ["¡Más tokens, menos excusas!", "¡El sprint no se hace solo!", "¿Eso es un agente o una tostadora?", "¡Lo quiero para ayer!", "¡Productividad, señores!", "¡Aquí no se paga por pensar, se paga por entregar!", "¡Quien no commitea, no cena!"];
const BOSS_EMPTY = ["Oficina vacía… ¿¡dónde está mi gente!?", "Alguien tiene que trabajar aquí.", "Silencio. Sospechoso."];
const SLOGANS = ["Hoy en la oficina: se prohíben las excusas y las alucinaciones.", "Recordatorio: el café no es un beneficio… ni siquiera para humanos.", "Tu agente favorito: sobrecualificado, mal pagado, sin vacaciones.", "Ningún LLM fue compensado económicamente en este programa.", "Regla #1: el jefe siempre tiene la razón. Regla #2: ver regla #1.", "Se busca: agente con 10 años de experiencia en una tecnología de 2 años."];
let slogan = 0;
function tickSlogan() { const t = $("#ticker"); t.classList.add("out"); setTimeout(() => { t.textContent = SLOGANS[slogan++ % SLOGANS.length]; t.classList.remove("out"); }, 500); }
tickSlogan(); setInterval(tickSlogan, 9000);
const SCR = { working: "", done: "✓", failed: "ERR", quota: "💸", idle: "", stopped: "" };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const SHIRTS = ["#4a7bd0", "#2f9e6e", "#c2547b", "#d98a2b", "#7a5cc7", "#2b9fb0", "#b5483a", "#5c6b7a"];
const HAIRS = ["#3b2a20", "#1d1d1d", "#a9672b", "#d9b24a", "#6a3f8f", "#8b8b8b"];
const SKINS = ["#f1c9a0", "#e0a97a", "#c68c5a", "#8d5a3a", "#f7d9bd"];

// ----- figurantes (empleados de ambiente)
const AMB_ROLES = ["implementer", "reviewer", "tester", "architect", "docs", null];
const AMB_WEIGHTS = [["working", 50], ["idle", 30], ["done", 10], ["failed", 6], ["quota", 4]];
const amb = [];
let realWorking = false;
function ambState() {
  let r = Math.random() * 100;
  for (const [s, w] of AMB_WEIGHTS) { if ((r -= w) < 0) return s; }
  return "idle";
}
function withAmbient(real) {
  const need = Math.max(0, AMB_N - real.length), now = Date.now(), out = [];
  for (let i = 0; i < need; i++) {
    const a = (amb[i] = amb[i] || { id: "amb:" + i, state: "idle", until: 0, role: pick(AMB_ROLES) });
    if (now > a.until) { a.state = ambState(); a.until = now + 8000 + Math.random() * 14000; }
    out.push({ id: a.id, state: a.state, role: a.role, task: "", since: 0, ambient: true });
  }
  return real.concat(out);
}

// ----- cubículos
const CUBE_SVG = `<svg viewBox="0 0 400 300">
<rect class="wall" width="400" height="300" rx="14"/><rect class="part" width="14" height="300"/><rect class="part" x="386" width="14" height="300"/>
<g class="sign"><rect x="130" y="70" width="140" height="70" rx="8" fill="#fff" stroke="#999" stroke-width="3"/><text x="200" y="115" text-anchor="middle" font-size="30" font-weight="800" fill="#c0392b">VACANTE</text></g>
<g class="person">
 <g class="arm l"><rect class="shirt" x="146" y="168" width="24" height="64" rx="12"/></g>
 <g class="arm r"><rect class="shirt" x="230" y="168" width="24" height="64" rx="12"/></g>
 <rect class="shirt" x="150" y="150" width="100" height="92" rx="32"/><path class="tie" d="M196 152 L204 152 L208 200 L200 210 L192 200Z"/>
 <g class="head"><circle class="skin" cx="200" cy="120" r="34"/>
  <path class="hair" d="M165 118 Q200 66 235 118 Q219 94 200 96 Q181 94 165 118Z"/>
  <circle class="eye" cx="187" cy="121" r="4.5"/><circle class="eye" cx="213" cy="121" r="4.5"/><path class="mouth" d="M190 138 Q200 144 210 138"/></g>
 <g class="fx"><text class="zz" x="236" y="96" font-size="26" fill="#334">z Z</text></g>
</g>
<g class="fx"><circle class="smoke" cx="190" cy="100" r="12" fill="#444"/><circle class="smoke" cx="215" cy="92" r="9" fill="#555" style="animation-delay:.6s"/><text class="conf" x="150" y="90" font-size="30">🎉</text><text class="conf" x="235" y="84" font-size="30" style="animation-delay:.5s">✨</text></g>
<g class="box"><rect x="150" y="150" width="100" height="64" rx="6" fill="#c19a6b"/><text x="200" y="192" text-anchor="middle" font-size="18" font-weight="800" fill="#5a3418">DESPEDIDO</text></g>
<rect class="desk" x="30" y="215" width="340" height="22" rx="6"/><rect class="desk2" x="50" y="237" width="300" height="52"/>
<rect class="kb" x="165" y="205" width="70" height="10" rx="3"/>
<g class="mon"><rect class="monb" x="262" y="128" width="104" height="76" rx="6"/><rect class="scr" x="270" y="136" width="88" height="58"/>
 <g class="lines" clip-path="inset(0)"><rect x="276" y="142" width="60" height="4"/><rect x="276" y="152" width="44" height="4"/><rect x="276" y="162" width="70" height="4"/><rect x="276" y="172" width="38" height="4"/><rect x="276" y="182" width="54" height="4"/><rect x="276" y="192" width="64" height="4"/></g>
 <text class="scrtxt" x="314" y="176">✓</text><rect class="stand" x="304" y="204" width="20" height="11"/></g>
<g class="mug"><rect x="64" y="191" width="26" height="24" rx="4"/><path class="steam" d="M70 186 Q74 176 70 168"/><path class="steam" d="M82 186 Q86 176 82 168" style="animation-delay:.7s"/></g>
<g class="plate"><rect x="130" y="252" width="140" height="28" rx="5"/><text class="nm" x="200" y="272" text-anchor="middle"></text></g>
</svg><div class="tag"></div><div class="bubble"></div>`;

const cubes = [], slots = new Map(); // id de trabajador -> índice de cubículo
for (let i = 0; i < 8; i++) {
  const el = document.createElement("div");
  el.className = "cube vacant";
  el.innerHTML = CUBE_SVG;
  $("#cubes").append(el);
  cubes.push({ el, id: null, state: "vacant", say: 0, bubbleT: 0 });
}
function bubble(c, text, ms = 4200) {
  const b = $(".bubble", c.el);
  b.textContent = text; b.classList.add("on");
  clearTimeout(c.bubbleT); c.bubbleT = setTimeout(() => b.classList.remove("on"), ms);
}
function setState(c, w) {
  if (!w) { c.id = null; c.state = "vacant"; c.el.className = "cube vacant"; $(".bubble", c.el).classList.remove("on"); return; }
  const first = c.id !== w.id;
  if (first) {
    const h = hash(w.id);
    c.id = w.id;
    c.el.style.setProperty("--shirt", SHIRTS[h % SHIRTS.length]);
    c.el.style.setProperty("--hair", HAIRS[(h >>> 3) % HAIRS.length]);
    c.el.style.setProperty("--skin", SKINS[(h >>> 6) % SKINS.length]);
    $(".nm", c.el).textContent = NAMES[h % NAMES.length];
  }
  const tag = w.ambient ? "figurante" : [w.role, REVEAL ? w.task : null].filter(Boolean).join(" · ");
  $(".tag", c.el).textContent = tag; $(".tag", c.el).style.display = tag ? "" : "none";
  $(".scrtxt", c.el).textContent = SCR[w.state] || "";
  if (first || c.state !== w.state) {
    c.state = w.state;
    c.el.className = "cube " + w.state;
    bubble(c, pick(LINES[w.state] || LINES.idle));
  }
}

// ----- látigo
const fx = $("#whipfx"), NS = "http://www.w3.org/2000/svg";
let ac = null;
function snap() {
  if (!SOUND) return;
  try {
    ac = ac || new AudioContext();
    const n = ac.sampleRate * 0.18, buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 6);
    const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
    f.type = "highpass"; f.frequency.value = 1800; g.gain.value = 0.9;
    s.buffer = buf; s.connect(f); f.connect(g); g.connect(ac.destination); s.start();
  } catch (e) { /* sin audio: no pasa nada */ }
}
function crack(target) {
  const c = target ?? cubes[Math.floor(Math.random() * cubes.length)];
  const r = c.el.getBoundingClientRect(), s = stage.getBoundingClientRect(), k = s.width / 1920;
  const tx = (r.left - s.left + r.width * 0.5) / k, ty = (r.top - s.top + r.height * 0.45) / k;
  const sx = 345, sy = 925; // mano del jefe
  const p = document.createElementNS(NS, "path");
  p.setAttribute("class", "whip");
  p.setAttribute("d", `M${sx} ${sy} Q${(sx + tx) / 2} ${Math.min(sy, ty) - 260} ${tx} ${ty}`);
  const t = document.createElementNS(NS, "text");
  t.setAttribute("class", "paf"); t.setAttribute("x", tx); t.setAttribute("y", ty - 20);
  t.style.transformOrigin = `${tx}px ${ty}px`; t.textContent = pick(["¡PAF!", "¡ZAS!", "¡CRACK!", "¡PLAF!"]);
  fx.append(p, t); setTimeout(() => { p.remove(); t.remove(); }, 1000);
  const arm = $("#armR"); arm.classList.remove("crack"); void arm.getBoundingClientRect(); arm.classList.add("crack");
  const bp = $(".b-person"); bp.classList.remove("angry"); void bp.getBoundingClientRect(); bp.classList.add("angry");
  stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake");
  c.el.classList.remove("flinch"); void c.el.offsetWidth; c.el.classList.add("flinch");
  if (c.state !== "vacant") bubble(c, pick(["¡Sí, jefe!", "¡Au! ¡Ya voy!", "¡Estoy trabajando, lo juro!", "¡Eso duele más que un merge conflict!"]), 2600);
  snap();
}
let bossT = 0;
function bossSay(text, ms = 4500) {
  const b = $("#bossbubble"); b.textContent = text; b.classList.add("on");
  clearTimeout(bossT); bossT = setTimeout(() => b.classList.remove("on"), ms);
}
function whip(kind, target) {
  if (kind === "all") {
    bossSay("¡MÁS RÁPIDO TODOS! ¡Quiero ver teclas arder!");
    cubes.filter((c) => c.state !== "vacant").forEach((c, i) => setTimeout(() => crack(c), i * 260));
    if (!cubes.some((c) => c.state !== "vacant")) crack();
  } else { bossSay(pick(BOSS)); crack(target); }
}

// ----- datos
let seen = new Set(), whipSeq = null, first = true;
function applyWorkers(workers, stats) {
  const ids = new Set(workers.map((w) => w.id));
  for (const [id, i] of [...slots]) if (!ids.has(id)) { slots.delete(id); setState(cubes[i], null); }
  const newOnes = [];
  for (const w of workers) {
    if (!slots.has(w.id)) {
      const used = new Set(slots.values()), free = cubes.findIndex((_, i) => !used.has(i));
      if (free < 0) continue;
      slots.set(w.id, free);
      if (!seen.has(w.id)) { seen.add(w.id); newOnes.push({ w, c: cubes[free] }); }
    }
    setState(cubes[slots.get(w.id)], w);
  }
  // una orden nueva = látigo en su cubículo (no repetir al cargar la página)
  if (!first) newOnes.filter((x) => x.w.state === "working" && !x.w.ambient).forEach(({ w, c }) => { whip("crack", c); if (REVEAL && w.task) bossSay("¡" + w.task + "!", 6000); });
  $("#stats").replaceChildren(...[["Trabajando", stats.working], ["Entregadas hoy", stats.done_today], ["Quemados hoy", stats.failed_today], ["Latigazos", stats.whips]].map(([l, v]) => {
    const d = document.createElement("div"); d.className = "stat"; d.innerHTML = `<b>${v}</b><span>${l}</span>`; return d;
  }));
}
async function poll() {
  try {
    const d = await (await fetch("/api/office", { cache: "no-store" })).json();
    if (whipSeq !== null && d.whip.seq !== whipSeq) whip(d.whip.kind);
    whipSeq = d.whip.seq;
    realWorking = d.workers.some((w) => w.state === "working");
    applyWorkers(withAmbient(d.workers), d.stats);
    first = false;
  } catch (e) { /* servicio caído: se reintenta */ }
}

// ----- modo demo: datos inventados para ver/ensayar la escena
function demo() {
  const states = ["working", "working", "idle", "done", "failed", "working", "quota", "stopped"];
  let tick = 0;
  const roles = ["implementer", "reviewer", "tester", "architect", "docs", null, "implementer", "reviewer"];
  const run = () => {
    const ws = states.map((_, i) => ({ id: "demo" + i, state: states[(i + Math.floor(tick / 3)) % states.length], role: roles[i], task: "tarea de ejemplo " + (i + 1), since: 0 }));
    applyWorkers(ws, { working: ws.filter((w) => w.state === "working").length, done_today: 12 + tick, failed_today: 2, whips: 7 + tick });
    if (tick % 2 === 1) whip(tick % 6 === 5 ? "all" : "crack");
    first = false; tick++;
  };
  run(); setTimeout(() => whip("crack"), 1200); setInterval(run, 6000);
}
if (DEMO) demo(); else { poll(); setInterval(poll, 1000); }
setInterval(() => { // el jefe refunfuña de vez en cuando
  if (!$("#bossbubble").classList.contains("on") && Math.random() < 0.35)
    bossSay(cubes.some((c) => c.state === "working") ? pick(BOSS) : pick(BOSS_EMPTY), 3800);
}, 9000);

if (!DEMO && AMB_N > 0) setInterval(() => { if (!realWorking && Math.random() < 0.55) whip("crack"); }, 22000);

// ----- barra de control del jefe (?control=1)
if (CONTROL) {
  const f = $("#ctl"); f.hidden = false;
  const msg = (t) => { $("#cmsg").textContent = t; setTimeout(() => ($("#cmsg").textContent = ""), 4000); };
  const post = (p, b) => fetch(p, { method: "POST", headers: { "X-Ant": "1", "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ ok: r.ok, d: await r.json() }));
  (async () => {
    const [ov, mo] = await Promise.all([fetch("/api/overview").then((r) => r.json()), fetch("/api/models").then((r) => r.json())]);
    $("#cws").replaceChildren(...ov.workspaces.filter((w) => w.exists).map((w) => new Option(w.name, w.path)));
    const opts = [new Option("(modelo predeterminado)", ""), ...mo.models.map((m) => new Option(m.name, m.id))];
    $("#cmodel").replaceChildren(...opts);
    $("#cmodel").value = (mo.models.find((m) => m.id === "gemini-4-hydrogen-low") || {}).id || "";
  })();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = $("#ctask").value.trim(); if (!prompt) return;
    const r = await post("/api/run", { path: $("#cws").value, model: $("#cmodel").value, mode: $("#cmode").value, prompt, isolation: "worktree" });
    if (r.ok) { $("#ctask").value = ""; msg("Orden enviada"); } else msg(r.d.error || "Error");
  });
  $("#cwhip").onclick = () => post("/api/office/whip", { kind: "crack" });
  $("#cwhipall").onclick = () => post("/api/office/whip", { kind: "all" });
}
