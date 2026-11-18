// La Oficina del Prompt — versión 3D con vista tipo RPG (isométrica). Three.js servido en local.
// Parámetros: ?title= ?reveal=1 ?demo=1 ?sound=1 ?control=1 ?bg=transparent ?ambient=N ?classic=1 (oficina 2D)
import * as THREE from "/vendor/three.module.min.js";
import { createFx, STYLES } from "/office-fx.js";

const Q = new URLSearchParams(location.search);
const REVEAL = Q.get("reveal") === "1", DEMO = Q.get("demo") === "1", CONTROL = Q.get("control") === "1", TRANSPARENT = Q.get("bg") === "transparent";
let SOUND = Q.get("sound") === "1" || (Q.get("control") === "1" && (() => { try { return localStorage.getItem("ant:office-sound") === "1"; } catch (e) { return false; } })()); // ?sound=1 (stream/OBS) o el interruptor del operador
const AMB_N = Q.get("ambient") === null ? 5 : Math.max(0, Math.min(8, parseInt(Q.get("ambient"), 10) || 0));
const $ = (s, r = document) => r.querySelector(s);
const TITLE = (Q.get("title") || "La Oficina del Prompt").toUpperCase(); document.title = Q.get("title") || "La Oficina del Prompt";
if (TRANSPARENT) document.body.classList.add("transparent");
if (CONTROL) document.body.classList.add("ctl");

// ================================================================ textos (nunca contenido real salvo ?reveal=1)
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
const BOSS_PRAISE = ["¡Eso es! Sigue así.", "Por fin, algo de producción.", "Bien hecho. Hoy sí cenas.", "Ascendido… al mismo puesto, pero con elogio."], BOSS_SCOLD = ["¿Esto es lo mejor que sabes hacer?", "¡Inaceptable! ¡Otra vez!", "Mi tostadora rinde más que tú.", "¡Cuántos tokens para tan poco!"];
const BOSS_EMPTY = ["Oficina vacía… ¿¡dónde está mi gente!?", "Alguien tiene que trabajar aquí.", "Silencio. Sospechoso."];
const FLINCH = ["¡Sí, jefe!", "¡Au! ¡Ya voy!", "¡Estoy trabajando, lo juro!", "¡Eso duele más que un merge conflict!"];
const STATE_ICON = { working: "⚙️", idle: "☕", done: "✅", failed: "🔥", quota: "💸", stopped: "📦" };
const STATE_TXT = { working: "trabajando", idle: "esperando órdenes", done: "entregado", failed: "quemado", quota: "sin cuota", stopped: "despedido" };
const ACT = { write: ["✍️", "escribiendo código"], read: ["📖", "leyendo archivos"], run: ["⚙️", "ejecutando comandos"], think: ["💭", "pensando"], coordinate: ["📣", "coordinando"], wait: ["⏳", "esperando a otros"], browse: ["🌐", "consultando la web"], other: ["🛠️", "trabajando"] };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const hash = (s) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, t) => a + (b - a) * t;
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const SHIRTS = ["#4a7bd0", "#2f9e6e", "#c2547b", "#d98a2b", "#7a5cc7", "#2b9fb0", "#b5483a", "#5c6b7a"];
const HAIRS = ["#3b2a20", "#1d1d1d", "#a9672b", "#d9b24a", "#6a3f8f", "#8b8b8b"];
const SKINS = ["#f1c9a0", "#e0a97a", "#c68c5a", "#8d5a3a", "#f7d9bd"];

// ================================================================ renderer, escena, cámara
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: $("#gl"), antialias: true, alpha: TRANSPARENT }); }
catch (e) { const p = new URLSearchParams(location.search); p.set("classic", "1"); location.replace("/office?" + p); throw e; } // sin WebGL → oficina 2D
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
if (!TRANSPARENT) scene.background = new THREE.Color("#050507");
const camera = new THREE.PerspectiveCamera(28, 1, 0.5, 300);
const TARGET = new THREE.Vector3(0, 0.6, 1.3), YAW = (36 * Math.PI) / 180, PITCH = (35 * Math.PI) / 180;
let W = 1, H = 1, shakeAmp = 0, camDist = 30, FX = null, FLOOR_MAT = null;
function frame() {
  W = innerWidth - 0; H = innerHeight - (CONTROL ? 56 : 0);
  renderer.setSize(W, H, false);
  const cv = $("#gl"); cv.style.top = CONTROL ? "56px" : "0"; cv.style.height = H + "px"; cv.style.width = W + "px";
  camera.aspect = W / H; camera.updateProjectionMatrix();
  camDist = 29 * Math.max(1, 1.9 / camera.aspect); // más lejos si la ventana es estrecha
  if (FX) FX.resize();
}
addEventListener("resize", frame); frame();
const INTERACT = CONTROL || Q.get("interact") === "1"; let DIRECTOR_ON = Q.get("cam") !== "fixed";
if (INTERACT) document.body.classList.add("ix");
const CAM = { tx: TARGET.x, ty: TARGET.y, tz: TARGET.z, d: 0, yaw: YAW, pitch: PITCH, uYaw: 0, uPitch: 0, uZoom: 1, focus: null, pinned: false, until: 0, prio: 0, manualUntil: 0 };
const _fp = new THREE.Vector3();
function direct(prio, focus, secs) { // cámara automática del stream: enfoca el momento y vuelve sola al plano general
  const now = performance.now(); if (!DIRECTOR_ON || CAM.pinned || now < CAM.manualUntil) return;
  if (CAM.focus && now < CAM.until && CAM.prio > prio) return; CAM.focus = focus; CAM.prio = prio; CAM.until = now + secs * 1000;
}
function placeCamera(t, dt) {
  let gx = TARGET.x, gy = TARGET.y, gz = TARGET.z, gd = camDist, gp = PITCH;
  if (CAM.focus && (CAM.pinned || performance.now() < CAM.until)) { const f = CAM.focus; if (f.obj) _fp.copy(f.obj.position).setY(f.obj.position.y + (f.dy ?? 1.1)); else _fp.copy(f.pos); gx = _fp.x; gy = _fp.y; gz = _fp.z; gd = camDist * 0.48; gp = PITCH + 0.08; }
  else if (CAM.focus) { CAM.focus = null; CAM.prio = 0; }
  gp = clamp(gp + CAM.uPitch, 0.15, 1.3); gd *= CAM.uZoom; if (!CAM.d) CAM.d = gd;
  const k = Math.min(1, dt * 3.2); CAM.tx += (gx - CAM.tx) * k; CAM.ty += (gy - CAM.ty) * k; CAM.tz += (gz - CAM.tz) * k; CAM.d += (gd - CAM.d) * k; CAM.pitch += (gp - CAM.pitch) * k; CAM.yaw += (YAW + CAM.uYaw - CAM.yaw) * k;
  const sway = Math.sin(t * 0.12) * 0.03; // balanceo sutil: da vida sin marear
  const yaw = CAM.yaw + sway, cp = Math.cos(CAM.pitch);
  camera.position.set(CAM.tx + Math.sin(yaw) * cp * CAM.d, CAM.ty + Math.sin(CAM.pitch) * CAM.d, CAM.tz + Math.cos(yaw) * cp * CAM.d);
  if (shakeAmp > 0.001) camera.position.add(new THREE.Vector3((Math.random() - 0.5) * shakeAmp, (Math.random() - 0.5) * shakeAmp, (Math.random() - 0.5) * shakeAmp));
  camera.lookAt(CAM.tx, CAM.ty, CAM.tz);
}
const hemi = new THREE.HemisphereLight("#a9b4c4", "#4a3b30", 0.6);
const sun = new THREE.DirectionalLight("#fff1d6", 2.4);
sun.position.set(-10, 22, 12); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 70 }); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
sun.target.position.set(0, 0, 0.5);
scene.add(hemi, sun, sun.target);

// ================================================================ utilidades de construcción
// Fusión de geometría estática: miles de cajas sueltas = cientos de llamadas de dibujo. Se fusionan por material tras construir.
const BATCH = []; let BATCHING = true;
const VC_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }); // material único con color por vértice
const plain = (m) => m.isMeshStandardMaterial && !m.map && !m.transparent && m.opacity === 1 && m.emissive.getHex() === 0 && m.roughness === 0.85 && m.metalness === 0 && m.side === THREE.FrontSide;
const reg = (m) => { if (BATCHING) BATCH.push(m); return m; };
function flushBatch() {
  scene.updateMatrixWorld(true); const groups = new Map();
  const ok = (m) => { for (let o = m; o && o !== scene; o = o.parent) if (o.userData.dyn) return false; return !!m.parent; };
  for (const m of BATCH) {
    if (!ok(m) || !m.geometry.index) continue;
    const vc = plain(m.material), key = (vc ? "VC" : m.material.uuid) + (m.castShadow ? "c" : "n") + (m.receiveShadow ? "r" : "n");
    if (!groups.has(key)) groups.set(key, { vc, mat: vc ? VC_MAT : m.material, cast: m.castShadow, recv: m.receiveShadow, items: [] }); groups.get(key).items.push(m);
  }
  for (const g of groups.values()) {
    let nv = 0, ni = 0; const geos = g.items.map((m) => { const geo = m.geometry.clone(); geo.applyMatrix4(m.matrixWorld); nv += geo.attributes.position.count; ni += geo.index.count; return geo; });
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = g.vc ? new Float32Array(nv * 3) : null, idx = new Uint32Array(ni); let vo = 0, io = 0;
    geos.forEach((geo, gi) => { const c = geo.attributes.position.count, ix = geo.index.array, cc = g.items[gi].material.color; if (col) for (let v = 0; v < c; v++) { col[(vo + v) * 3] = cc.r; col[(vo + v) * 3 + 1] = cc.g; col[(vo + v) * 3 + 2] = cc.b; } pos.set(geo.attributes.position.array, vo * 3); nor.set(geo.attributes.normal.array, vo * 3); uv.set(geo.attributes.uv.array, vo * 2); for (let k = 0; k < ix.length; k++) idx[io + k] = ix[k] + vo; vo += c; io += ix.length; geo.dispose(); });
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); if (col) geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mesh = new THREE.Mesh(geo, g.mat); mesh.castShadow = g.cast; mesh.receiveShadow = g.recv; scene.add(mesh);
    for (const m of g.items) { m.parent.remove(m); m.geometry.dispose(); }
  }
  BATCH.length = 0;
}
const matCache = new Map();
function mat(color, o = {}) {
  const k = color + JSON.stringify(o); if (matCache.has(k)) return matCache.get(k);
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o }); matCache.set(k, m); return m;
}
function box(w, h, d, color, { x = 0, y = 0, z = 0, parent, cast = true, receive = true, m, rx = 0, ry = 0, rz = 0 } = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || mat(color));
  mesh.position.set(x, y, z); mesh.rotation.set(rx, ry, rz); mesh.castShadow = cast; mesh.receiveShadow = receive;
  (parent || scene).add(mesh); return reg(mesh);
}
function cyl(rt, rb, h, color, { x = 0, y = 0, z = 0, parent, seg = 14, cast = true } = {}) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color)); mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true;
  (parent || scene).add(mesh); return reg(mesh);
}
function sph(r, color, { x = 0, y = 0, z = 0, parent, sx = 1, sy = 1, sz = 1 } = {}) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), mat(color)); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz); mesh.castShadow = true; mesh.receiveShadow = true;
  (parent || scene).add(mesh); return reg(mesh);
}
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const ctx = c.getContext("2d"); draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; return { c, ctx, tex };
}
function textPlane(w, h, texW, texH, draw, parent, pos, rotY = 0, basic = true) {
  const t = canvasTex(texW, texH, draw);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic ? new THREE.MeshBasicMaterial({ map: t.tex, toneMapped: false }) : new THREE.MeshStandardMaterial({ map: t.tex }));
  mesh.position.set(...pos); mesh.rotation.y = rotY; (parent || scene).add(mesh); t.mesh = mesh; return t;
}
const roundRect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); };
const DOT = (() => { const t = canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 2, 32, 32, 30); g.addColorStop(0, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); }); return t.tex; })();
// ---- estilos visuales (voxel / toon / cyber): ?style= manda; si no, el que se elige en Ant (se guarda en el servidor y cambia en vivo, también en OBS)
const STYLE_Q = Q.get("style");
let skyReady = false; // el ciclo día/noche se define más abajo: hasta entonces no se le avisa
FX = createFx(THREE, { renderer, scene, camera, hemi, sun, dot: DOT, stations: () => stations, floor: () => FLOOR_MAT, onStyle: () => { if (skyReady) updateSkyClock(); } });

// ================================================================ sala (distopía corporativa: sucia, vieja, cableada)
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function grimeTex(base, w, h, seed) { // chorretones, manchas y humedad
  return canvasTex(w, h, (c) => {
    const r = rng(seed); c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 52; i++) { const x = r() * w, y = r() * h * 0.6, len = 30 + r() * 150, wd = 2 + r() * 9, g = c.createLinearGradient(0, y, 0, y + len); g.addColorStop(0, `rgba(35,25,15,${0.05 + r() * 0.15})`); g.addColorStop(1, "rgba(35,25,15,0)"); c.fillStyle = g; c.fillRect(x, y, wd, len); }
    for (let i = 0; i < 26; i++) { const x = r() * w, y = r() * h, rad = 14 + r() * 56, g = c.createRadialGradient(x, y, 2, x, y, rad); g.addColorStop(0, `rgba(40,28,14,${0.08 + r() * 0.2})`); g.addColorStop(1, "rgba(40,28,14,0)"); c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill(); }
    const g2 = c.createLinearGradient(0, h * 0.68, 0, h); g2.addColorStop(0, "rgba(18,14,9,0)"); g2.addColorStop(1, "rgba(18,14,9,.55)"); c.fillStyle = g2; c.fillRect(0, h * 0.68, w, h * 0.32);
  }).tex;
}
const WALL_N = new THREE.MeshStandardMaterial({ map: grimeTex("#8f8873", 1024, 256, 7), roughness: 1 });
const WALL_W = new THREE.MeshStandardMaterial({ map: grimeTex("#7f7a67", 1024, 256, 13), roughness: 1 });
const ROOM = { x0: -8.2, x1: 8.2, z0: -6.7, z1: 6.7 };
(function buildRoom() {
  // peana (diorama) + moqueta ajedrezada
  box(17.4, 0.7, 14.4, "#2a2f45", { y: -0.5, x: 0, z: 0 });
  const chk = canvasTex(1024, 832, (c) => { // moqueta gastada con manchas de café, quemaduras y pisadas
    const r = rng(21);
    for (let i = 0; i < 16; i++) for (let j = 0; j < 13; j++) { c.fillStyle = (i + j) % 2 ? "#363c4d" : "#2f3545"; c.fillRect(i * 64, j * 64, 64, 64); }
    for (let i = 0; i < 40; i++) { const x = r() * 1024, y = r() * 832, rad = 16 + r() * 70, g = c.createRadialGradient(x, y, 2, x, y, rad); g.addColorStop(0, `rgba(8,6,4,${0.2 + r() * 0.3})`); g.addColorStop(1, "rgba(8,6,4,0)"); c.fillStyle = g; c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill(); }
    for (let i = 0; i < 14; i++) { const x = r() * 1024, y = r() * 832, rad = 12 + r() * 18; c.strokeStyle = "rgba(95,58,26,.55)"; c.lineWidth = 4; c.beginPath(); c.arc(x, y, rad, 0, 7); c.stroke(); c.fillStyle = "rgba(95,58,26,.22)"; c.fill(); }
  });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(16.4, 0.2, 13.4), (FLOOR_MAT = new THREE.MeshStandardMaterial({ map: chk.tex, roughness: 0.95 }))); floor.position.y = -0.1; floor.receiveShadow = true; scene.add(floor);
  // zona de cafetería (baldosa clara) y alfombra del jefe
  box(5.4, 0.02, 4.2, "#cfc8b8", { x: -5.5, y: 0.01, z: 4.3, cast: false });
  box(4.6, 0.025, 3.4, "#7a2e2a", { x: 3.6, y: 0.012, z: 5.0, cast: false }); box(4.2, 0.03, 3.0, "#8f3a33", { x: 3.6, y: 0.013, z: 5.0, cast: false });
  // paredes (norte y oeste) con zócalo
  box(16.8, 3.7, 0.3, "#e9e2d1", { x: 0, y: 1.85, z: -6.85, m: WALL_N }); box(16.8, 0.28, 0.34, "#7d6a52", { x: 0, y: 0.14, z: -6.83 });
  box(0.3, 3.7, 13.9, "#ddd6c4", { x: -8.35, y: 1.85, z: 0, m: WALL_W }); box(0.34, 0.28, 13.9, "#7d6a52", { x: -8.33, y: 0.14, z: 0 });
  box(16.8, 0.12, 0.42, "#c9bfa6", { x: 0, y: 3.74, z: -6.85 }); box(0.42, 0.12, 13.9, "#c9bfa6", { x: -8.35, y: 3.74, z: 0 }); // remate
})();

// cielo para las ventanas (se repinta con la hora)
const sky = canvasTex(128, 96, () => {}); const winMat = new THREE.MeshBasicMaterial({ map: sky.tex, toneMapped: false });
function paintSky(f) { // aire irrespirable: ocres sucios, chimeneas y un sol/luna rojizo
  const { ctx } = sky, g = ctx.createLinearGradient(0, 0, 0, 96);
  const top = new THREE.Color("#120e0b").lerp(new THREE.Color("#6a4a34"), f), bot = new THREE.Color("#2a1a12").lerp(new THREE.Color("#c98a4a"), f);
  g.addColorStop(0, "#" + top.getHexString()); g.addColorStop(1, "#" + bot.getHexString()); ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = f > 0.15 ? "rgba(255,170,90,.5)" : "rgba(210,70,50,.5)"; ctx.beginPath(); ctx.arc(98, 28, 11, 0, 7); ctx.fill();
  ctx.fillStyle = "rgba(14,10,8,.55)"; for (const [x, w, h] of [[6, 10, 52], [34, 8, 70], [60, 14, 44], [84, 8, 62], [108, 12, 50]]) ctx.fillRect(x, 96 - h, w, h);
  ctx.fillStyle = "rgba(20,14,10,.38)"; for (const y of [26, 44, 62]) ctx.fillRect(0, y, 128, 9);
  sky.tex.needsUpdate = true;
}
function addWindow(wx, wy, wz, ry, w = 2.6, h = 1.7) { // marco + cristal
  const g = new THREE.Group(); g.position.set(wx, wy, wz); g.rotation.y = ry; scene.add(g);
  box(w + 0.3, h + 0.3, 0.1, "#a79f8a", { parent: g }); const glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), winMat); glass.position.z = 0.06; g.add(glass);
  box(0.06, h, 0.05, "#a79f8a", { parent: g, z: 0.08 }); box(w, 0.06, 0.05, "#a79f8a", { parent: g, z: 0.08 }); box(w + 0.5, 0.1, 0.3, "#a79f8a", { parent: g, y: -h / 2 - 0.18, z: 0.14 }); // travesaños y alféizar
}
addWindow(-8.18, 2.1, -1.6, Math.PI / 2); addWindow(-8.18, 2.1, 2.4, Math.PI / 2);  // la pared norte es para el Ojo, el cartel y el marcador

// reloj, pizarra, pósteres, TV de estadísticas
const clockTex = textPlane(0.62, 0.62, 128, 128, () => {}, null, [-1.3, 3.3, -6.64]);
function paintClock() {
  const { ctx } = clockTex, d = new Date(), hh = (d.getHours() % 12) + d.getMinutes() / 60, mm = d.getMinutes();
  ctx.clearRect(0, 0, 128, 128); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(64, 64, 60, 0, 7); ctx.fill(); ctx.lineWidth = 8; ctx.strokeStyle = "#2b2f38"; ctx.stroke();
  ctx.fillStyle = "#2b2f38"; for (let i = 0; i < 12; i++) { const a = (i * Math.PI) / 6; ctx.fillRect(64 + Math.sin(a) * 50 - 2, 64 - Math.cos(a) * 50 - 2, 4, 4); }
  const hand = (a, l, w, c) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineTo(64 + Math.sin(a) * l, 64 - Math.cos(a) * l); ctx.stroke(); };
  hand((hh * Math.PI) / 6, 28, 7, "#2b2f38"); hand((mm * Math.PI) / 30, 42, 4, "#2b2f38"); clockTex.tex.needsUpdate = true;
}
box(0.72, 0.72, 0.08, "#2b2f38", { x: -1.3, y: 3.3, z: -6.7 });
textPlane(1.5, 2.0, 256, 340, (c, w, h) => { c.fillStyle = "#b52b1f"; c.fillRect(0, 0, w, h); c.fillStyle = "#ffd400"; c.font = "bold 52px Impact"; c.textAlign = "center"; c.fillText("NO HAY", w / 2, 90); c.fillText("EXCUSAS,", w / 2, 150); c.fillText("HAY", w / 2, 210); c.fillText("TOKENS", w / 2, 270); c.strokeStyle = "#fff"; c.lineWidth = 10; c.strokeRect(5, 5, w - 10, h - 10); }, null, [-1.3, 1.75, -6.66], 0, false);
// ---- marcador de estadio colgado dentro de la oficina: las métricas viven en el mundo 3D, no en un panel pegado a la pantalla
const SB = { w: 6.6, h: 2.6, x: 3.7, y: 2.45 };
const board = textPlane(SB.w, SB.h, 1024, 404, () => {}, null, [SB.x, SB.y, -6.6]);
box(SB.w + 0.3, SB.h + 0.3, 0.18, "#0c0d10", { x: SB.x, y: SB.y, z: -6.7 });
box(SB.w + 0.7, 0.12, 0.22, "#2a2c31", { x: SB.x, y: SB.y + SB.h / 2 + 0.3, z: -6.6 });
for (let i = 0; i < 6; i++) box(0.24, 0.14, 0.24, "#ffe9a8", { x: SB.x - SB.w / 2 + 0.4 + (i * (SB.w - 0.8)) / 5, y: SB.y + SB.h / 2 + 0.17, z: -6.5, m: mat("#ffe9a8", { emissive: "#ffd46b", emissiveIntensity: 1.3 }) });
let lastBoard = { working: 0, done_today: 0, failed_today: 0, whips: 0, tokens_today: 0 };
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + " M" : n >= 1e3 ? Math.round(n / 1e3) + " K" : String(n));
function paintTV(st) {
  lastBoard = { ...lastBoard, ...st }; const s = lastBoard, c = board.ctx;
  c.fillStyle = "#04060a"; c.fillRect(0, 0, 1024, 404);
  c.shadowColor = "#ff9d00"; c.shadowBlur = 14; c.fillStyle = "#ffb000"; c.textBaseline = "alphabetic";
  c.font = "bold 34px ui-monospace,Consolas,monospace"; c.fillText("▌ENTREGADAS HOY", 36, 56);
  c.font = "bold 236px ui-monospace,Consolas,monospace"; c.fillText(String(s.done_today).padStart(2, "0"), 30, 270);
  [["TRABAJANDO", s.working, "#7dff9a"], ["QUEMADOS", s.failed_today, "#ff6a4d"], ["LATIGAZOS", s.whips, "#ffd45e"]].forEach(([l, v, col], i) => {
    c.shadowColor = col; c.fillStyle = col; c.font = "bold 28px ui-monospace,Consolas,monospace"; c.fillText(l, 560, 76 + i * 86); c.font = "bold 66px ui-monospace,Consolas,monospace"; c.textAlign = "right"; c.fillText(String(v), 990, 82 + i * 86); c.textAlign = "left";
  });
  c.shadowColor = "#ff3b3b"; c.fillStyle = "#ff4d4d"; c.font = "bold 30px ui-monospace,Consolas,monospace"; c.fillText("★ " + fmtTok(s.tokens_today || 0) + " TOKENS QUEMADOS HOY ★ PRODUCTIVIDAD ES FELICIDAD ★", 36, 372);
  c.shadowBlur = 0; c.fillStyle = "rgba(0,0,0,.42)"; for (let y = 0; y < 404; y += 4) c.fillRect(0, y, 1024, 1); for (let x = 0; x < 1024; x += 4) c.fillRect(x, 0, 1, 404); // rejilla de LEDs
  board.tex.needsUpdate = true;
}
paintTV({});

// ---- el Ojo del Jefe: un monitor gigante que lo vigila todo y sigue al jefe
const EYE = { w: 4.4, h: 2.3, x: -5.0, y: 1.75, z: -6.62, tx: 0, ty: 0, cx: 0, cy: 0, blink: 0, nextBlink: 2, red: 0, acc: 0, veins: [] };
{ const r = rng(5); for (let i = 0; i < 18; i++) EYE.veins.push([r() * 6.283, 0.35 + r() * 0.25, r()]); }
const eyeMon = textPlane(EYE.w, EYE.h, 640, 333, () => {}, null, [EYE.x, EYE.y, EYE.z]);
box(EYE.w + 0.3, EYE.h + 0.3, 0.14, "#0c0d10", { x: EYE.x, y: EYE.y, z: -6.7 });
box(0.14, 0.14, 0.14, "#ff2a2a", { x: EYE.x - EYE.w / 2 - 0.4, y: EYE.y + 0.9, z: -6.55, m: mat("#ff2a2a", { emissive: "#ff1a1a", emissiveIntensity: 1.6 }) });
function paintEye(t, dt) {
  EYE.acc += dt; if (EYE.acc < 0.05) return; dt = EYE.acc; EYE.acc = 0;
  const c = eyeMon.ctx, W2 = 640, H2 = 333;
  EYE.cx += (EYE.tx - EYE.cx) * Math.min(1, dt * 7); EYE.cy += (EYE.ty - EYE.cy) * Math.min(1, dt * 7);
  EYE.nextBlink -= dt; if (EYE.nextBlink < 0) { EYE.blink = 1; EYE.nextBlink = 2.2 + Math.random() * 4; } EYE.blink = Math.max(0, EYE.blink - dt * 5); EYE.red = Math.max(0, EYE.red - dt * 1.1);
  c.fillStyle = "#040506"; c.fillRect(0, 0, W2, H2);
  c.save(); c.beginPath(); c.ellipse(320, 166, 262, 124, 0, 0, 7); c.clip();
  const sg = c.createRadialGradient(320, 166, 30, 320, 166, 270); sg.addColorStop(0, "#f2e6dc"); sg.addColorStop(1, EYE.red > 0.2 ? "#d68a7c" : "#bf9a8e"); c.fillStyle = sg; c.fillRect(0, 0, W2, H2);
  c.strokeStyle = `rgba(165,18,18,${0.4 + EYE.red * 0.45})`; c.lineWidth = 2;
  for (const [a, len, k] of EYE.veins) { c.beginPath(); const ex = 320 + Math.cos(a) * 280, ey = 166 + Math.sin(a) * 135; c.moveTo(ex, ey); c.quadraticCurveTo(ex - Math.cos(a) * 60, ey - Math.sin(a) * 30 + (k - 0.5) * 40, 320 + Math.cos(a) * 270 * (1 - len), 166 + Math.sin(a) * 130 * (1 - len)); c.stroke(); }
  const ix = 320 + EYE.cx * 118 + Math.sin(t * 31) * EYE.red * 3, iy = 166 + EYE.cy * 40, ig = c.createRadialGradient(ix, iy, 8, ix, iy, 86);
  ig.addColorStop(0, EYE.red > 0.2 ? "#ff3d1f" : "#ffb300"); ig.addColorStop(0.7, EYE.red > 0.2 ? "#a30d00" : "#b36b00"); ig.addColorStop(1, "#2a1200"); c.fillStyle = ig; c.beginPath(); c.arc(ix, iy, 84, 0, 7); c.fill();
  c.fillStyle = "#000"; c.beginPath(); c.arc(ix, iy, 36 - EYE.red * 14, 0, 7); c.fill(); c.fillStyle = "rgba(255,255,255,.85)"; c.beginPath(); c.arc(ix - 22, iy - 24, 9, 0, 7); c.fill();
  const lid = EYE.blink * 135 + EYE.red * 22; c.fillStyle = "#040506"; c.fillRect(0, 0, W2, 40 + lid); c.fillRect(0, H2 - 40 - lid * 0.8, W2, 120);
  c.restore();
  c.fillStyle = "rgba(0,0,0,.28)"; for (let y = 0; y < H2; y += 3) c.fillRect(0, y, W2, 1);
  c.fillStyle = Math.sin(t * 5) > 0 ? "#ff3b3b" : "#7a1b1b"; c.font = "bold 20px ui-monospace,Consolas,monospace"; c.fillText("● SUPERVISIÓN ACTIVA — NADIE DESCANSA", 18, H2 - 16);
  eyeMon.tex.needsUpdate = true;
}

// ---- cartel de neón con el nombre (diegético) y luz de "en directo"
const neon = textPlane(4.4, 0.48, 1024, 112, (c, w, h) => {
  c.fillStyle = "#06070a"; c.fillRect(0, 0, w, h); c.font = "bold 64px Impact,'Arial Black',sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
  c.shadowColor = "#ff2e88"; c.shadowBlur = 26; c.fillStyle = "#ff5fa8"; c.fillText(TITLE, w / 2, h / 2 + 3); c.shadowBlur = 8; c.fillStyle = "#ffe0f0"; c.fillText(TITLE, w / 2, h / 2 + 3);
}, null, [-5.0, 3.42, -6.62]);
const onair = textPlane(1.1, 0.38, 256, 88, (c, w, h) => { c.fillStyle = "#1a0505"; c.fillRect(0, 0, w, h); c.fillStyle = "#ff3030"; c.shadowColor = "#ff0000"; c.shadowBlur = 16; c.font = "bold 40px ui-monospace,Consolas,monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("● EN VIVO", w / 2, h / 2 + 2); }, null, [7.55, 3.3, -6.62]);

// ================================================================ mobiliario
function plant(x, z, s = 1) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); scene.add(g);
  cyl(0.28, 0.22, 0.4, "#b5651d", { parent: g, y: 0.2 }); cyl(0.26, 0.26, 0.03, "#3b2a1a", { parent: g, y: 0.41 });
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; sph(0.26, i % 2 ? "#2e8b4f" : "#3aa35f", { parent: g, x: Math.sin(a) * 0.22, y: 0.75 + (i % 3) * 0.14, z: Math.cos(a) * 0.22, sy: 1.5 }); }
  return g;
}
function chair(x, z, tint = "#2f3542") {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  box(0.64, 0.09, 0.62, tint, { parent: g, y: 0.47 }); box(0.62, 0.62, 0.08, tint, { parent: g, y: 0.88, z: -0.3 }); cyl(0.05, 0.05, 0.4, "#222", { parent: g, y: 0.25 });
  for (let i = 0; i < 3; i++) box(0.75, 0.05, 0.08, "#222", { parent: g, y: 0.06, ry: (i * Math.PI) / 3 });
  return g;
}
function watercooler(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  box(0.55, 0.95, 0.5, "#e8edf2", { parent: g, y: 0.48 }); box(0.5, 0.05, 0.05, "#3b82f6", { parent: g, y: 0.72, z: 0.26 }); box(0.5, 0.05, 0.05, "#ef4444", { parent: g, y: 0.62, z: 0.26 });
  cyl(0.22, 0.22, 0.55, "#7cc4ff", { parent: g, y: 1.2 }).material = new THREE.MeshStandardMaterial({ color: "#7cc4ff", transparent: true, opacity: 0.75, roughness: 0.1 });
  return g;
}
function coffeeMachine(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  box(1.1, 0.75, 0.7, "#8a6439", { parent: g, y: 0.38 }); box(0.55, 0.5, 0.4, "#2b2f38", { parent: g, y: 1.0 }); box(0.4, 0.06, 0.2, "#d92d20", { parent: g, y: 1.18, z: 0.2 }); cyl(0.07, 0.06, 0.1, "#fff", { parent: g, y: 0.86, z: 0.16 });
  return g;
}
function shelf(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  box(2.2, 2.4, 0.5, "#6a4a2a", { parent: g, y: 1.2 });
  for (let r = 0; r < 4; r++) { box(2.0, 0.04, 0.5, "#4d341b", { parent: g, y: 0.4 + r * 0.55, z: 0.01 }); for (let i = 0; i < 9; i++) box(0.15, 0.38 + (i % 3) * 0.05, 0.3, ["#c0392b", "#2980b9", "#27ae60", "#f39c12", "#8e44ad"][(i + r) % 5], { parent: g, x: -0.85 + i * 0.21, y: 0.6 + r * 0.55, z: 0.1 }); }
  return g;
}
function sofa(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  box(2.2, 0.4, 0.9, "#6d4c8f", { parent: g, y: 0.3 }); box(2.2, 0.7, 0.2, "#5b3d7a", { parent: g, y: 0.7, z: -0.38 }); box(0.2, 0.55, 0.9, "#5b3d7a", { parent: g, x: -1.1, y: 0.5 }); box(0.2, 0.55, 0.9, "#5b3d7a", { parent: g, x: 1.1, y: 0.5 });
  return g;
}
function cabinet(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); box(0.9, 1.4, 0.6, "#9aa3ad", { parent: g, y: 0.7 }); for (let i = 0; i < 3; i++) { box(0.7, 0.3, 0.02, "#7d868f", { parent: g, y: 0.3 + i * 0.4, z: 0.31 }); box(0.25, 0.04, 0.03, "#333", { parent: g, y: 0.3 + i * 0.4, z: 0.33 }); } return g; }
function printer(x, z) { const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g); box(1.0, 0.55, 0.6, "#8a6439", { parent: g, y: 0.28 }); box(0.8, 0.3, 0.5, "#e5e7eb", { parent: g, y: 0.7 }); box(0.6, 0.02, 0.3, "#fff", { parent: g, y: 0.87, z: 0.1 }); return g; }
plant(-7.5, -5.9, 1.3); plant(7.4, -5.9, 1.2); plant(-7.6, 6.0, 1.4); plant(7.5, 6.0, 1.2); plant(-3.6, 2.8, 0.8); plant(0, -5.9, 1.0);
watercooler(-7.1, 3.0); coffeeMachine(-6.3, 6.0); shelf(-7.9, -5.2, Math.PI / 2); sofa(-5.2, 5.9, 0); cabinet(7.4, -2.4); printer(7.3, 0.6); cabinet(7.4, -3.4);

// ================================================================ montañas de papel = tokens quemados hoy
const PILES = [{ x: -6.9, z: -4.9 }, { x: 7.0, z: 2.7 }, { x: -1.3, z: 5.9 }], HOPPERS = [...PILES, { x: -3.6, z: -1.2 }, { x: 3.6, z: -1.2 }];
const PAPER_TINTS = ["#f4f1e6", "#e8e3d0", "#dcd6c0", "#fffdf5", "#f0d9d0"], PAPER_MAX = 230, FALL_N = 150;
const sheetGeo = new THREE.BoxGeometry(0.44, 0.014, 0.31), paperMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1 });
const pileMesh = new THREE.InstancedMesh(sheetGeo, paperMat, PAPER_MAX * 3), fallMesh = new THREE.InstancedMesh(sheetGeo, paperMat, FALL_N);
pileMesh.castShadow = pileMesh.receiveShadow = true; pileMesh.frustumCulled = fallMesh.frustumCulled = false; scene.add(pileMesh, fallMesh);
const _m4 = new THREE.Matrix4(), _qq = new THREE.Quaternion(), _ee = new THREE.Euler(), _pp = new THREE.Vector3(), _ss = new THREE.Vector3(1, 1, 1), _cc = new THREE.Color();
const PAPERS = { levels: -1, top: 0.4, tokens: 0 };
function setPapers(tokens) {
  PAPERS.tokens = tokens; const frac = clamp(tokens / 8e6, 0, 1), levels = Math.floor(40 + 190 * Math.sqrt(frac)); if (levels === PAPERS.levels) return; PAPERS.levels = levels;
  const size = 0.3 + 0.7 * Math.sqrt(frac), r = rng(99); PAPERS.top = 0.03 + 2.3 * size;
  for (let j = 0; j < levels; j++) for (let k = 0; k < 3; k++) {
    const u = j / levels, R = (1.05 * size + 0.15) * Math.pow(1 - u, 0.75), ang = r() * 6.283, rad = r() * R, idx = j * 3 + k;
    _pp.set(PILES[k].x + Math.cos(ang) * rad, 0.03 + u * 2.3 * size, PILES[k].z + Math.sin(ang) * rad); _ee.set((r() - 0.5) * 0.35, r() * 6.283, (r() - 0.5) * 0.35); _qq.setFromEuler(_ee);
    pileMesh.setMatrixAt(idx, _m4.compose(_pp, _qq, _ss)); pileMesh.setColorAt(idx, _cc.set(PAPER_TINTS[(r() * PAPER_TINTS.length) | 0]));
  }
  pileMesh.count = levels * 3; pileMesh.instanceMatrix.needsUpdate = true; pileMesh.instanceColor.needsUpdate = true;
}
const FALL = Array.from({ length: FALL_N }, (_, i) => ({ seed: Math.random(), h: i % HOPPERS.length, rx: Math.random() * 6, sp: 0.8 + Math.random() * 0.5 }));
FALL.forEach((f, i) => { const r = rng(300 + i); f.seed = r(); f.rx = r() * 6; f.sp = 0.8 + r() * 0.5; });
function updateFall(t, count) {
  fallMesh.count = count;
  for (let i = 0; i < count; i++) {
    const f = FALL[i], hp = HOPPERS[f.h], k = (t * 0.26 * f.sp + f.seed) % 1, land = f.h < 3 ? PAPERS.top * 0.85 : 0.04, kk = Math.min(1, k / 0.8);
    const y = k < 0.8 ? lerp(4.15, land, kk * kk * 0.4 + kk * 0.6) : land, sway = k < 0.8 ? 0.5 * (0.3 + kk) : 0.6;
    _pp.set(hp.x + Math.sin(f.seed * 40 + k * 9) * sway, y, hp.z + Math.cos(f.seed * 30 + k * 7) * sway);
    _ee.set(k < 0.8 ? k * 9 + f.rx : 0.1, f.rx * 3 + k * 2, k < 0.8 ? Math.sin(k * 8 + f.rx) * 1.2 : 0.05); _qq.setFromEuler(_ee);
    const sc = k > 0.9 ? 1 - (k - 0.9) / 0.1 : 1; _ss.set(sc, sc, sc); fallMesh.setMatrixAt(i, _m4.compose(_pp, _qq, _ss));
  }
  _ss.set(1, 1, 1); fallMesh.instanceMatrix.needsUpdate = true;
}
const CONE_MAT = new THREE.MeshStandardMaterial({ color: "#2b2e35", roughness: 0.7, metalness: 0.4, side: THREE.DoubleSide });
// tolvas que escupen papel, colgadas del techo (fuera de plano) con cables
for (const hp of HOPPERS) {
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.12, 0.4, 12, 1, true), CONE_MAT); cone.position.set(hp.x, 4.4, hp.z); scene.add(cone); reg(cone);
  box(0.16, 0.06, 0.16, "#ff3b3b", { x: hp.x, y: 4.18, z: hp.z, cast: false, m: mat("#ff3b3b", { emissive: "#ff1a1a", emissiveIntensity: 1.2 }) });
  for (const [dx, dz] of [[-0.28, -0.28], [0.28, 0.28]]) { const cb = cyl(0.03, 0.03, 10, "#0e0f12", { x: hp.x + dx, y: 9.7, z: hp.z + dz, cast: false, seg: 6 }); }
}
// cables por todas partes: del escritorio al suelo, festones en las paredes
function cable(pts, color = "#0e0f12", r = 0.03) { const curve = new THREE.CatmullRomCurve3(pts.map((q) => new THREE.Vector3(...q))); const m = new THREE.Mesh(new THREE.TubeGeometry(curve, pts.length * 10, r, 5, false), mat(color)); m.castShadow = false; scene.add(m); return reg(m); }
const CABLE_COLS = ["#0e0f12", "#1c1d22", "#6b1d1d", "#a68a1c", "#16324f", "#0e0f12"];
{
  const r = rng(77);
  for (const row of [0.8, -3.0]) for (let i = 0; i < 4; i++) {
    const x = [-5.4, -1.8, 1.8, 5.4][i], z0 = row + 0.65, zz = row + 1.15 + i * 0.1, ex = 8.1 + r() * 0.2;
    cable([[x + 0.4, 0.82, row + 0.3], [x + 0.55, 0.05, z0], [x + 1.0, 0.035, zz - 0.05], [x + 2.2, 0.03, zz + 0.12], [(x + ex) / 2 + 1, 0.03, zz - 0.1], [ex, 0.03, zz + 0.05]], CABLE_COLS[(i + (row > 0 ? 1 : 3)) % CABLE_COLS.length], 0.032);
  }
  for (let i = 0; i < 9; i++) { const x1 = -7.6 + i * 1.9 + r() * 0.5, x2 = x1 + 1.3 + r() * 1.4, y1 = 3.5 + r() * 0.15; cable([[x1, y1, -6.62], [(x1 + x2) / 2, y1 - 0.5 - r() * 0.5, -6.6], [x2, y1 - 0.05, -6.62]], CABLE_COLS[i % CABLE_COLS.length], 0.035); }
  for (let i = 0; i < 6; i++) { const z1 = -6.1 + i * 2.2 + r() * 0.6, z2 = z1 + 1.1 + r() * 1.3, y1 = 3.5 + r() * 0.15; cable([[-8.18, y1, z1], [-8.15, y1 - 0.5 - r() * 0.5, (z1 + z2) / 2], [-8.18, y1 - 0.05, z2]], CABLE_COLS[(i + 2) % CABLE_COLS.length], 0.035); }
  for (let i = 0; i < 7; i++) { const x = -7.2 + i * 2.3 + r(); cable([[x, 3.7, -6.6], [x + 0.15, 2.4 - r() * 0.8, -6.55], [x - 0.1, 0.9, -6.5], [x + 0.3, 0.04, -6.2 + r() * 0.5]], CABLE_COLS[(i + 1) % CABLE_COLS.length], 0.03); }
  // caja de fusibles chamuscada, con su LED de alarma
  box(0.6, 0.8, 0.14, "#3d4148", { x: 7.65, y: 1.5, z: -6.6 }); box(0.06, 0.06, 0.04, "#ff2a2a", { x: 7.5, y: 1.78, z: -6.5, m: mat("#ff2a2a", { emissive: "#ff1a1a", emissiveIntensity: 1.5 }) });
}
setPapers(0);
const fireLight = new THREE.PointLight("#ff6a1a", 0, 8, 2); scene.add(fireLight);

// ================================================================ aspecto por rol (se reconoce sin leer nombres)
const ROLE_STYLE = {
  implementer: { shirt: "#3b5bdb", icon: "💻", acc: ["headphones"], prop: "monitor2" }, frontend: { shirt: "#7048e8", icon: "🖥️", acc: ["cap"], prop: "palette" },
  "backend-api": { shirt: "#1c7ed6", icon: "🔌", acc: ["headphones"], prop: "server" }, database: { shirt: "#0ca678", icon: "🗄️", acc: [], prop: "server" },
  reviewer: { shirt: "#2f9e44", icon: "🔍", acc: ["glasses"], prop: "magnifier" }, verifier: { shirt: "#2f9e44", icon: "🔍", acc: ["glasses"], prop: "magnifier" },
  tester: { shirt: "#e8590c", icon: "🧪", acc: ["labcoat"], prop: "bugjar" }, debugger: { shirt: "#e03131", icon: "🐞", acc: ["cap"], prop: "bugjar" },
  architect: { shirt: "#f59f00", icon: "🏛️", acc: ["hardhat"], prop: "blueprint" }, docs: { shirt: "#c9a66b", icon: "📝", acc: ["glasses"], prop: "books" },
  "security-auditor": { shirt: "#212529", icon: "🛡️", acc: ["shades", "lanyard"], prop: "shield" }, "ui-designer": { shirt: "#e64980", icon: "🎨", acc: ["beret"], prop: "palette" },
  "ux-researcher": { shirt: "#be4bdb", icon: "🧭", acc: ["glasses", "beret"], prop: "clipboard" }, "ux-writer": { shirt: "#d6336c", icon: "✍️", acc: ["glasses"], prop: "books" },
  "a11y-auditor": { shirt: "#15aabf", icon: "♿", acc: ["lanyard"], prop: "clipboard" }, "product-analyst": { shirt: "#5c7cfa", icon: "📋", acc: ["lanyard"], prop: "clipboard" },
  refactorer: { shirt: "#20c997", icon: "🧹", acc: [], prop: "monitor2" }, performance: { shirt: "#ff6b6b", icon: "⚡", acc: ["headphones"], prop: "server" },
  devops: { shirt: "#495057", icon: "🚀", acc: ["headphones"], prop: "server" }, "release-manager": { shirt: "#845ef7", icon: "📦", acc: ["lanyard"], prop: "box" },
  "mobile-ios": { shirt: "#ced4da", icon: "🍎", acc: ["cap"], prop: "phone" }, "mobile-android": { shirt: "#74b816", icon: "🤖", acc: ["cap"], prop: "phone" }, "mobile-cross": { shirt: "#12b886", icon: "📱", acc: ["cap"], prop: "phone" },
  "migration-planner": { shirt: "#a9e34b", icon: "🧳", acc: ["hardhat"], prop: "blueprint" }, "migration-engineer": { shirt: "#a9e34b", icon: "🔄", acc: ["hardhat"], prop: "box" }, "data-migrator": { shirt: "#82c91e", icon: "🗃️", acc: ["hardhat"], prop: "server" },
  coordinator: { shirt: "#862e9c", icon: "🎯", acc: ["lanyard"], prop: "clipboard" },
};
const DEFAULT_STYLE = { shirt: "#868e96", icon: "🤖", acc: [], prop: null };
const roleStyle = (role) => ROLE_STYLE[role] || DEFAULT_STYLE;
const STATE_COLOR = { working: "#51cf66", idle: "#fcc419", done: "#69db7c", failed: "#ff6b6b", quota: "#adb5bd", stopped: "#868e96" };

// ================================================================ estaciones de trabajo
const COLS = [-5.4, -1.8, 1.8, 5.4], ROWS = [0.8, -3.0]; // fila delantera (z=0.8) y trasera (z=-3.0)
const stations = [];
function makeScreenCanvas() { return canvasTex(256, 160, () => {}); }
function buildStation(i, x, deskZ) {
  const seatZ = deskZ - 0.85, g = new THREE.Group(); g.position.set(x, 0, deskZ); scene.add(g);
  box(2.3, 0.1, 1.0, "#b98a55", { parent: g, y: 0.78 }); box(2.3, 0.56, 0.05, "#a07446", { parent: g, y: 0.5, z: 0.47 });
  box(0.06, 0.74, 0.9, "#8f6a3e", { parent: g, x: -1.12, y: 0.37 }); box(0.06, 0.74, 0.9, "#8f6a3e", { parent: g, x: 1.12, y: 0.37 });
  box(0.7, 0.62, 0.8, "#8a6439", { parent: g, x: 0.74, y: 0.4, z: -0.02 }); box(0.2, 0.03, 0.03, "#ccc", { parent: g, x: 0.74, y: 0.5, z: 0.4 });
  box(0.75, 0.04, 0.26, "#2b2f38", { parent: g, x: 0.05, y: 0.85, z: -0.15 }); box(0.09, 0.035, 0.13, "#2b2f38", { parent: g, x: 0.6, y: 0.84, z: -0.12 });
  const mon = new THREE.Group(); mon.position.set(-0.8, 0.83, -0.05); g.add(mon);
  box(0.25, 0.03, 0.25, "#222", { parent: mon, y: 0.015 }); box(0.05, 0.28, 0.05, "#222", { parent: mon, y: 0.17 }); box(0.07, 0.64, 1.0, "#1d2230", { parent: mon, y: 0.62 });
  const scr = makeScreenCanvas(); const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.54), new THREE.MeshBasicMaterial({ map: scr.tex, toneMapped: false })); sm.position.set(0.037, 0.62, 0); sm.rotation.y = Math.PI / 2; mon.add(sm);
  const plate = textPlane(0.9, 0.22, 256, 64, () => {}, g, [0, 0.5, 0.5], 0, false);
  cyl(0.05, 0.05, 0.1, "#fff", { parent: g, x: 0.9, y: 0.88, z: -0.25 }); box(0.3, 0.03, 0.22, "#fafafa", { parent: g, x: 0.35, y: 0.83, z: 0.18, ry: 0.2 });
  const lampB = cyl(0.09, 0.1, 0.03, "#333", { parent: g, x: 1.0, y: 0.84, z: -0.3 }); box(0.03, 0.3, 0.03, "#333", { parent: lampB, y: 0.17 }); box(0.18, 0.1, 0.18, "#f2c14e", { parent: lampB, y: 0.34 });
  const ch = chair(x, seatZ, ["#2f3542", "#3b2f42", "#2f423b", "#42392f"][i % 4]); ch.userData.dyn = true;
  const carton = new THREE.Group(); carton.position.set(0, 0.84, 0); carton.visible = false; carton.userData.dyn = true; g.add(carton); box(0.7, 0.42, 0.5, "#c19a6b", { parent: carton, y: 0.21 });
  textPlane(0.62, 0.2, 128, 40, (c, w, h) => { c.fillStyle = "#c19a6b"; c.fillRect(0, 0, w, h); c.fillStyle = "#5a3418"; c.font = "bold 22px Trebuchet MS"; c.textAlign = "center"; c.fillText("DESPEDIDO", w / 2, 27); }, carton, [0, 0.22, 0.26]);
  const props = {}, PR = (name, build) => { const gp = new THREE.Group(); gp.visible = false; gp.userData.dyn = true; gp.position.y = 0.83; g.add(gp); build(gp); props[name] = gp; };
  PR("monitor2", (gp) => { box(0.06, 0.5, 0.72, "#1d2230", { parent: gp, x: -0.35, y: 0.3, z: -0.4 }); box(0.1, 0.1, 0.1, "#222", { parent: gp, x: -0.35, y: 0.03, z: -0.4 }); });
  PR("clipboard", (gp) => { box(0.3, 0.015, 0.38, "#c8a45a", { parent: gp, x: 0.3, y: 0.01, z: 0.2, ry: 0.3 }); box(0.26, 0.012, 0.32, "#fff", { parent: gp, x: 0.3, y: 0.02, z: 0.2, ry: 0.3 }); });
  PR("books", (gp) => { box(0.34, 0.07, 0.24, "#c0392b", { parent: gp, x: 0.6, y: 0.035, z: 0.2, ry: 0.1 }); box(0.32, 0.06, 0.22, "#2980b9", { parent: gp, x: 0.6, y: 0.1, z: 0.2 }); box(0.3, 0.06, 0.2, "#27ae60", { parent: gp, x: 0.6, y: 0.16, z: 0.2, ry: -0.1 }); });
  PR("blueprint", (gp) => { const c = cyl(0.07, 0.07, 0.7, "#e7f5ff", { parent: gp, x: 0.3, y: 0.08, z: 0.22 }); c.rotation.z = Math.PI / 2; });
  PR("bugjar", (gp) => { const j = cyl(0.1, 0.1, 0.2, "#a5d8ff", { parent: gp, x: 0.6, y: 0.1, z: 0.15 }); j.material = new THREE.MeshStandardMaterial({ color: "#a5d8ff", transparent: true, opacity: 0.55, roughness: 0.1 }); sph(0.05, "#2b8a3e", { parent: gp, x: 0.6, y: 0.07, z: 0.15 }); });
  PR("palette", (gp) => { box(0.36, 0.015, 0.26, "#f8f9fa", { parent: gp, x: 0.45, y: 0.01, z: 0.2, ry: 0.4 }); ["#fa5252", "#fab005", "#40c057", "#339af0"].forEach((c, k) => sph(0.032, c, { parent: gp, x: 0.34 + k * 0.07, y: 0.03, z: 0.18 + (k % 2) * 0.06 })); });
  PR("phone", (gp) => { box(0.1, 0.22, 0.015, "#111", { parent: gp, x: 0.6, y: 0.12, z: 0.1, rx: -0.3 }); box(0.085, 0.19, 0.012, "#4dabf7", { parent: gp, x: 0.6, y: 0.125, z: 0.108, rx: -0.3 }); });
  PR("box", (gp) => { box(0.3, 0.22, 0.26, "#c19a6b", { parent: gp, x: 0.55, y: 0.11, z: 0.18, ry: 0.3 }); box(0.06, 0.225, 0.27, "#e0c9a6", { parent: gp, x: 0.55, y: 0.11, z: 0.18, ry: 0.3 }); });
  PR("shield", (gp) => { const sh = cyl(0.14, 0.14, 0.03, "#1971c2", { parent: gp, x: 0.6, y: 0.17, z: 0.12, seg: 6 }); sh.rotation.x = Math.PI / 2; box(0.06, 0.1, 0.05, "#343a40", { parent: gp, x: 0.6, y: 0.05, z: 0.12 }); });
  PR("magnifier", (gp) => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.016, 8, 18), mat("#343a40")); m.position.set(0.55, 0.1, 0.2); m.rotation.x = -1.2; gp.add(m); box(0.02, 0.02, 0.16, "#5c3d1e", { parent: gp, x: 0.55, y: 0.05, z: 0.32, rx: 0.5 }); });
  PR("server", (gp) => { box(0.22, 0.36, 0.22, "#343a40", { parent: gp, x: 0.6, y: 0.18, z: 0.1 }); [0.1, 0.2, 0.3].forEach((y) => box(0.1, 0.02, 0.01, "#37b24d", { parent: gp, x: 0.6, y, z: 0.215, m: mat("#37b24d", { emissive: "#37b24d", emissiveIntensity: 1 }) })); });
  // tubo de café: una vena que baja del techo y se inyecta en el respaldo de la silla
  const tubeT = canvasTex(16, 128, (c) => { c.fillStyle = "#2a1408"; c.fillRect(0, 0, 16, 128); c.fillStyle = "#a35f26"; for (let k = 0; k < 4; k++) c.fillRect(3, k * 32 + 4, 10, 18); });
  tubeT.tex.wrapS = tubeT.tex.wrapT = THREE.RepeatWrapping; tubeT.tex.repeat.set(1, 13);
  const tubeG = new THREE.Group(); tubeG.position.set(x, 0, seatZ - 0.34); tubeG.visible = false; tubeG.userData.dyn = true; scene.add(tubeG);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 6.4, 10, 1, true), new THREE.MeshBasicMaterial({ map: tubeT.tex, toneMapped: false })); tube.position.y = 4.4; tubeG.add(tube);
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 6.4, 10, 1, true), new THREE.MeshBasicMaterial({ color: "#cfd6df", transparent: true, opacity: 0.16, depthWrite: false })); sleeve.position.y = 4.4; tubeG.add(sleeve);
  box(0.17, 0.2, 0.17, "#262a32", { parent: tubeG, y: 1.2 }); box(0.07, 0.1, 0.07, "#d92d20", { parent: tubeG, y: 1.34, z: 0.1 });
  const scorch = box(1.3, 0.014, 0.72, "#0b0907", { parent: g, x: -0.15, y: 0.846, z: 0.0, cast: false }); scorch.visible = false; scorch.userData.dyn = true; // escritorio chamuscado
  const st = { i, x, deskZ, seatZ, gapX: x + 1.8, group: g, chair: ch, scr, plate, carton, props, state: "vacant", id: null, actor: null, fxA: 0, tube: tubeG, tubeTex: tubeT.tex, tubeMat: tube.material, scorch, boom: makeBoom() };
  st.fx = { smoke: makeParticles(10, { size: 0.5, color: "#555" }), conf: makeParticles(26, { size: 0.16, vcolors: true }), steam: makeParticles(6, { size: 0.3, color: "#ffffff" }), fire: makeParticles(18, { size: 0.62, vcolors: true, additive: true }), sweat: makeParticles(5, { size: 0.13, color: "#8fd8ff" }) };
  Object.values(st.fx).forEach((f) => scene.add(f.pts)); scene.add(st.boom.pts, st.boom.flash);
  st.fx.fire.base = new THREE.Vector3(x - 0.2, 0.92, deskZ - 0.1); st.fx.sweat.base = new THREE.Vector3(x, 1.88, seatZ + 0.32);
  st.fx.smoke.base = new THREE.Vector3(x, 2.0, seatZ); st.fx.conf.base = new THREE.Vector3(x, 1.7, seatZ); st.fx.steam.base = new THREE.Vector3(x + 0.9, 0.98, deskZ - 0.25);
  const cols = ["#ff4d6d", "#ffd400", "#4dd0e1", "#69f0ae", "#ffab40", "#b388ff"]; st.fx.conf.col = st.fx.conf.pts.geometry.attributes.color;
  for (let k = 0; k < st.fx.conf.n; k++) { const c = new THREE.Color(cols[k % cols.length]); st.fx.conf.col.setXYZ(k, c.r, c.g, c.b); }
  stations.push(st); return st;
}
function makeParticles(n, { size, color = "#fff", vcolors = false, additive = false }) {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (vcolors) geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size, map: DOT, transparent: true, depthWrite: false, vertexColors: vcolors, color: vcolors ? 0xffffff : color, opacity: 0.85, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }));
  pts.frustumCulled = false; pts.visible = false; return { pts, pos, n, seeds: Float32Array.from({ length: n }, Math.random) };
}
function makeBoom() { // explosión de escritorio: chispas incandescentes + fogonazo
  const n = 48, geo = new THREE.BufferGeometry(), pos = new Float32Array(n * 3), col = new Float32Array(n * 3); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.5, map: DOT, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: "#ffb347", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  for (const o of [pts, flash]) { o.visible = false; o.frustumCulled = false; }
  return { t: -1, n, pos, col, pts, flash, vel: new Float32Array(n * 3), o: new THREE.Vector3(), count: 0 };
}
let sid = 0; for (const z of ROWS) for (const x of COLS) buildStation(sid++, x, z);
flushBatch(); BATCHING = false; // sala, mobiliario, cables y mesas: fusionados

// ================================================================ personajes
const BAKED_MAT = VC_MAT;
function bakeGroup(grp, slots) { // fusiona las cajas rígidas de un grupo en 1 malla con color por vértice; recuerda qué vértices son camisa/pelo/piel
  const items = grp.children.filter((c) => c.isMesh && !c.userData.keep && c.geometry.index); if (items.length < 2) return;
  const names = [slots.shirt, slots.hair, slots.skin].map((c) => c.toLowerCase()); let nv = 0, ni = 0;
  const geos = items.map((m) => { m.updateMatrix(); const g = m.geometry.clone(); g.applyMatrix4(m.matrix); nv += g.attributes.position.count; ni += g.index.count; return g; });
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni), sl = new Uint8Array(nv); let vo = 0, io = 0;
  items.forEach((m, k) => { const g = geos[k], c = g.attributes.position.count, ix = g.index.array, hex = "#" + m.material.color.getHexString(), slot = names.indexOf(hex) + 1, cc = m.material.color;
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); for (let v = 0; v < c; v++) { col[(vo + v) * 3] = cc.r; col[(vo + v) * 3 + 1] = cc.g; col[(vo + v) * 3 + 2] = cc.b; sl[vo + v] = slot; }
    for (let q = 0; q < ix.length; q++) idx[io + q] = ix[q] + vo; vo += c; io += ix.length; g.dispose(); grp.remove(m); m.geometry.dispose(); });
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mesh = new THREE.Mesh(geo, BAKED_MAT); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.baked = true; mesh.userData.slots = sl; grp.add(mesh);
}
function paintBaked(o, look) { const col = o.geometry.attributes.color, sl = o.userData.slots, cs = [null, new THREE.Color(look.shirt), new THREE.Color(look.hair), new THREE.Color(look.skin)]; for (let i = 0; i < sl.length; i++) if (sl[i]) { const c = cs[sl[i]]; col.setXYZ(i, c.r, c.g, c.b); } col.needsUpdate = true; }
function makePerson({ shirt, hair, skin, pants = "#2c3550", boss = false }) {
  const g = new THREE.Group(), root = new THREE.Group(); g.add(root);
  const torso = box(0.62, 0.72, 0.34, shirt, { parent: root, y: 1.16 }); box(0.64, 0.12, 0.36, pants, { parent: root, y: 0.86 });
  box(0.1, 0.42, 0.02, boss ? "#d92d20" : "#b23a2e", { parent: root, y: 1.2, z: 0.18 });
  if (boss) { box(0.22, 0.32, 0.015, "#fff", { parent: root, y: 1.27, z: 0.176 }); box(0.1, 0.5, 0.02, "#0d0f14", { parent: root, x: -0.2, y: 1.2, z: 0.18, rz: 0.12 }); box(0.1, 0.5, 0.02, "#0d0f14", { parent: root, x: 0.2, y: 1.2, z: 0.18, rz: -0.12 }); }
  const head = new THREE.Group(); head.position.y = 1.82; root.add(head);
  box(0.46, 0.46, 0.46, skin, { parent: head }); box(0.5, 0.14, 0.5, hair, { parent: head, y: 0.26 }); box(0.5, 0.34, 0.12, hair, { parent: head, y: 0.07, z: -0.19 });
  box(0.06, 0.22, 0.3, hair, { parent: head, x: -0.24, y: 0.1, z: -0.04 }); box(0.06, 0.22, 0.3, hair, { parent: head, x: 0.24, y: 0.1, z: -0.04 });
  const eyes = [-1, 1].map((s) => box(0.07, 0.09, 0.02, "#111", { parent: head, x: s * 0.11, y: 0.04, z: 0.235 }));
  const brows = [-1, 1].map((s) => box(0.13, 0.03, 0.02, boss ? "#444" : hair, { parent: head, x: s * 0.11, y: 0.13, z: 0.235, rz: boss ? -s * 0.4 : 0 }));
  const mouth = box(0.14, 0.03, 0.02, "#5a2a2a", { parent: head, y: -0.1, z: 0.235 });
  const bags = [-1, 1].map((sg) => box(0.14, 0.085, 0.02, "#4a2a5e", { parent: head, x: sg * 0.11, y: -0.045, z: 0.236 })); bags.forEach((b) => (b.visible = !boss)); // ojeras exageradas
  const mkArm = (s) => { const a = new THREE.Group(); a.position.set(s * 0.4, 1.46, 0); root.add(a); box(0.2, 0.6, 0.2, shirt, { parent: a, y: -0.3 }); box(0.17, 0.17, 0.17, skin, { parent: a, y: -0.68 }); return a; };
  const mkLeg = (s) => { const hip = new THREE.Group(); hip.position.set(s * 0.16, 0.85, 0); root.add(hip); box(0.25, 0.42, 0.27, pants, { parent: hip, y: -0.21 }); const knee = new THREE.Group(); knee.position.y = -0.42; hip.add(knee); box(0.23, 0.4, 0.25, pants, { parent: knee, y: -0.2 }); box(0.25, 0.1, 0.36, "#1a1a1a", { parent: knee, y: -0.38, z: 0.05 }); return { hip, knee }; };
  const armL = mkArm(-1), armR = mkArm(1), legL = mkLeg(-1), legR = mkLeg(1);
  if (boss) box(0.05, 0.05, 0.45, "#5a3418", { parent: armR, y: -0.72, z: 0.25 });
  g.scale.setScalar(boss ? 1.3 : 1.15); // personajes más grandes: se distinguen mejor desde la cámara
  const acc = {}, A = (name, onRoot, build) => { const gp = new THREE.Group(); gp.visible = false; (onRoot ? root : head).add(gp); build(gp); acc[name] = gp; };
  A("hardhat", false, (gp) => { cyl(0.29, 0.31, 0.14, "#fcc419", { parent: gp, y: 0.3, seg: 16 }); box(0.52, 0.03, 0.62, "#f59f00", { parent: gp, y: 0.24, z: 0.04 }); });
  A("beret", false, (gp) => { cyl(0.32, 0.3, 0.08, "#d6336c", { parent: gp, y: 0.28, x: 0.04, seg: 16 }); box(0.04, 0.06, 0.04, "#a61e4d", { parent: gp, y: 0.34, x: 0.04 }); });
  A("cap", false, (gp) => { box(0.5, 0.1, 0.52, "#1971c2", { parent: gp, y: 0.29 }); box(0.4, 0.03, 0.26, "#1864ab", { parent: gp, y: 0.25, z: 0.36 }); });
  A("headphones", false, (gp) => { box(0.54, 0.05, 0.06, "#212529", { parent: gp, y: 0.33 }); [-1, 1].forEach((sx) => box(0.09, 0.2, 0.2, "#212529", { parent: gp, x: sx * 0.28, y: 0.02 })); });
  A("glasses", false, (gp) => { [-1, 1].forEach((sx) => { box(0.15, 0.1, 0.02, "#111", { parent: gp, x: sx * 0.11, y: 0.04, z: 0.25 }); box(0.1, 0.065, 0.015, "#cfe8ff", { parent: gp, x: sx * 0.11, y: 0.04, z: 0.258 }); }); box(0.07, 0.02, 0.02, "#111", { parent: gp, y: 0.05, z: 0.25 }); });
  A("shades", false, (gp) => { [-1, 1].forEach((sx) => box(0.16, 0.1, 0.03, "#050505", { parent: gp, x: sx * 0.11, y: 0.04, z: 0.255 })); box(0.07, 0.02, 0.03, "#050505", { parent: gp, y: 0.05, z: 0.255 }); });
  A("lanyard", true, (gp) => { box(0.04, 0.34, 0.015, "#e03131", { parent: gp, y: 1.25, z: 0.18 }); box(0.1, 0.13, 0.02, "#f8f9fa", { parent: gp, y: 1.05, z: 0.19 }); });
  A("labcoat", true, (gp) => { box(0.7, 0.62, 0.4, "#f8f9fa", { parent: gp, y: 0.98 }); box(0.1, 0.5, 0.02, "#dee2e6", { parent: gp, y: 1.03, z: 0.205 }); });
  eyes.concat(brows, [mouth], bags).forEach((m) => (m.userData.keep = true)); // se animan por separado
  for (const grp of [root, head, armL, armR, legL.hip, legL.knee, legR.hip, legR.knee]) bakeGroup(grp, { shirt, hair, skin });
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return { g, root, head, armL, armR, legL, legR, eyes, brows, mouth, acc, bags };
}
const setAcc = (p, names) => Object.entries(p.acc).forEach(([k, gp]) => (gp.visible = names.includes(k)));
const setProp = (st, name) => Object.entries(st.props).forEach(([k, gp]) => (gp.visible = k === name));
function lookFor(seed) { const h = hash(seed); return { shirt: SHIRTS[h % SHIRTS.length], hair: HAIRS[(h >>> 3) % HAIRS.length], skin: SKINS[(h >>> 6) % SKINS.length] }; }
const PERSONAS = [ // cada agente tiene su carácter, fijo por id: ritmo de tecleo, nervios, vagancia y cotilleo
  { name: "nervioso", peek: 2.2, type: 1.25, gest: 0.8, slump: 0.6 }, { name: "vago", peek: 0.8, type: 0.85, gest: 1.8, slump: 1.3 },
  { name: "ansioso", peek: 1.2, type: 1.35, gest: 0.5, slump: 0.5 }, { name: "estoico", peek: 0.5, type: 1.0, gest: 0.9, slump: 0.9 },
  { name: "chismoso", peek: 1.6, type: 1.0, gest: 1.3, slump: 1.0, nosy: true },
];
const newLife = () => ({ tense: 0, fatigue: 0, gy: 0, relief: 0, hot: false, O: { w: 0, aLt: null, aRt: null, aLzt: null, aRzt: null, hx: 0, hy: 0, hz: 0, eye: null, mouth: 0, rrx: 0 } });
function makeActor(look, boss = false) {
  const p = makePerson({ ...look, boss }); scene.add(p.g); p.g.visible = false;
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.4), paperMat); paper.position.set(0, -0.8, 0.14); paper.rotation.x = 0.35; paper.visible = false; p.armR.add(paper); // informe que lleva al jefe
  const ext = new THREE.Group(); ext.position.set(0, -0.78, 0.16); ext.visible = false; p.armR.add(ext); // extintor
  cyl(0.07, 0.07, 0.34, "#c0392b", { parent: ext }); box(0.06, 0.08, 0.1, "#1b1d22", { parent: ext, y: 0.2, z: 0.03 });
  return { look, p, g: p.g, boss, mode: "seated", state: "vacant", sitCur: 0, sitTarget: 0, phase: Math.random() * 6, path: [], speed: boss ? 2.7 : 2.2, then: null, flinch: 0, faceY: 0, whipT: -1, breakAt: 0, standUntil: 0, home: null,
    life: newLife(), pers: PERSONAS[3], peekIn: 3 + Math.random() * 6, peek: 0, peekYaw: 0, gest: null, gNext: 3 + Math.random() * 8, workedFor: 0, idleFor: 0, dozing: false, cower: 0, gasp: 0, panic: 0,
    celeb: null, singed: false, hit: 0, talk: 0, nod: 0, speaking: false, sipping: false, spot: null, chat: false, paper, ext, clap: 0, point: 0, perk: 0 };
}
stations.forEach((st) => { st.actor = makeActor(lookFor("st" + st.i)); st.actor.name = NAMES[st.i % NAMES.length]; });

// ---- puesto del jefe (mira a cámara) y desayuno
const BOSS_SEAT = new THREE.Vector3(3.6, 0, 4.5), COOLER_SPOT = new THREE.Vector3(-5.9, 0, 3.0);
BATCHING = true;
(function bossArea() {
  const g = new THREE.Group(); g.position.set(3.6, 0, 5.35); scene.add(g);
  box(3.2, 0.12, 1.3, "#5b3a1e", { parent: g, y: 0.8 }); box(3.2, 0.7, 0.06, "#4a2f18", { parent: g, y: 0.45, z: 0.62 }); box(0.1, 0.78, 1.2, "#4a2f18", { parent: g, x: -1.5, y: 0.4 }); box(0.1, 0.78, 1.2, "#4a2f18", { parent: g, x: 1.5, y: 0.4 });
  box(0.9, 0.04, 0.3, "#2b2f38", { parent: g, y: 0.88, z: -0.1 }); box(0.07, 0.6, 1.1, "#1d2230", { parent: g, x: -1.1, y: 1.2, z: -0.1 }); cyl(0.12, 0.14, 0.3, "#d4af37", { parent: g, x: 1.2, y: 1.0, z: -0.2 }); sph(0.15, "#d4af37", { parent: g, x: 1.2, y: 1.28, z: -0.2 });
  textPlane(1.5, 0.34, 256, 60, (c, w, h) => { c.fillStyle = "#d4af37"; c.fillRect(0, 0, w, h); c.fillStyle = "#2a1a00"; c.font = "bold 34px Trebuchet MS"; c.textAlign = "center"; c.fillText("EL JEFE", w / 2, 42); }, g, [0, 0.55, 0.66]);
  const throne = chair(3.6, 4.5, "#6d130c"); throne.scale.set(1.25, 1, 1.25); throne.children[1].scale.y = 1.5; throne.children[1].position.y = 1.1;
})();
flushBatch(); BATCHING = false;
const boss = makeActor({ shirt: "#1b1d24", hair: "#9a9a9a", skin: "#f0c090", pants: "#14161c" }, true);
boss.p.g.visible = true; boss.g.position.copy(BOSS_SEAT); boss.sitCur = boss.sitTarget = 1; boss.state = "boss";

// ================================================================ pantallas de los monitores
const CODE_COLORS = ["#6fe3a5", "#7cc4ff", "#f2c14e", "#ff8fa3"];
function drawWork(c, st, t) { // lo que muestra el monitor depende de lo que el agente está haciendo de verdad
  const act = st.act || "write", sd = st.i * 7;
  if (act === "read") { // un documento con el resaltador recorriendo las líneas
    c.fillStyle = "#ebe8de"; c.fillRect(0, 0, 256, 160); c.fillStyle = "#c0443a"; c.fillRect(0, 0, 256, 10); const off = (t * 18) % 20; c.fillStyle = "#9a958a";
    for (let i = 0; i < 9; i++) { const y = i * 20 - off + 14, w = 110 + ((i * 37 + sd) % 110); c.fillRect(14, y, w, 5); c.fillRect(14, y + 9, w * 0.7, 4); }
    c.fillStyle = "rgba(255,213,74,.55)"; c.fillRect(8, 62 + Math.sin(t * 1.6) * 32, 240, 16);
  } else if (act === "run") { // terminal: líneas de salida, barra de progreso y cursor
    c.fillStyle = "#04080a"; c.fillRect(0, 0, 256, 160); const off = (t * 34) % 16;
    for (let i = 0; i < 9; i++) { const y = i * 16 - off + 6, sw = (Math.floor(t * 2 + i) * 31 + sd + i * 13) % 97; c.fillStyle = "#3fdc77"; c.fillRect(8, y, 7, 6); c.fillStyle = sw % 5 === 0 ? "#ffd45e" : "#5dff8e"; c.fillRect(20, y, 30 + ((sw * 7) % 150), 5); }
    c.strokeStyle = "#5dff8e"; c.lineWidth = 1.5; c.strokeRect(10, 140, 236, 11); c.fillStyle = "#5dff8e"; c.fillRect(12, 142, (t * 38) % 232, 7); if (Math.sin(t * 9) > 0) c.fillRect(20, 120, 9, 13);
  } else if (act === "think") { // fondo tenue y tres puntos que laten
    c.fillStyle = "#0b1426"; c.fillRect(0, 0, 256, 160); c.fillStyle = "rgba(124,196,255,.16)"; for (let i = 0; i < 8; i++) c.fillRect(12, 10 + i * 18, 40 + ((i * 53 + sd) % 150), 6);
    for (let k = 0; k < 3; k++) { const r = 7 + (Math.sin(t * 4 - k * 0.9) * 0.5 + 0.5) * 9; c.fillStyle = "#cfe3ff"; c.beginPath(); c.arc(86 + k * 42, 80, r, 0, 7); c.fill(); }
  } else if (act === "coordinate") { // chat: globos que suben y alguien escribiendo
    c.fillStyle = "#102033"; c.fillRect(0, 0, 256, 160); const off = (t * 9) % 30;
    for (let i = 0; i < 6; i++) { const right = i % 2, w = 90 + ((i * 53 + sd) % 50), y = i * 30 - off + 6; c.fillStyle = right ? "#2f7dd1" : "#3b4a5e"; roundRect(c, right ? 246 - w : 10, y, w, 20, 8); c.fill(); }
    c.fillStyle = "#cfe3ff"; for (let k = 0; k < 3; k++) { c.globalAlpha = 0.4 + 0.6 * (Math.sin(t * 6 - k) * 0.5 + 0.5); c.beginPath(); c.arc(20 + k * 12, 150, 3.5, 0, 7); c.fill(); } c.globalAlpha = 1;
  } else if (act === "wait") { // rueda de espera
    c.fillStyle = "#0a0f1a"; c.fillRect(0, 0, 256, 160); c.strokeStyle = "#7cc4ff"; c.lineWidth = 8; c.lineCap = "round"; c.beginPath(); c.arc(128, 66, 30, t * 4, t * 4 + 4.2); c.stroke(); c.lineCap = "butt";
    c.fillStyle = "#7cc4ff"; c.font = "bold 20px monospace"; c.textAlign = "center"; c.fillText("esperando…", 128, 128);
  } else if (act === "browse") { // navegador: barra, imagen y texto
    c.fillStyle = "#f2f4f8"; c.fillRect(0, 0, 256, 160); c.fillStyle = "#d6dce6"; c.fillRect(0, 0, 256, 22); c.fillStyle = "#fff"; roundRect(c, 40, 4, 176, 14, 7); c.fill();
    const off = (t * 14) % 40; c.save(); c.beginPath(); c.rect(0, 24, 256, 136); c.clip(); c.fillStyle = "#b9c6dc"; c.fillRect(10, 30 - off, 110, 68); c.fillStyle = "#9aa6b8";
    for (let i = 0; i < 6; i++) { const y = 32 + i * 18 - off; c.fillRect(132, y, 100 - ((i * 23 + sd) % 40), 6); c.fillRect(10, y + 80, 200 - ((i * 31) % 70), 6); } c.restore();
  } else { // escribir (y trabajo genérico): código que corre
    c.fillStyle = "#0b1d33"; c.fillRect(0, 0, 256, 160); const off = (t * 95) % 16;
    for (let i = 0; i < 11; i++) { const y = i * 16 - off + 6, seed = (Math.floor((t * 6 + i) % 997) * 31 + sd + i * 13) % 97; c.fillStyle = CODE_COLORS[(seed + i) % 4]; c.fillRect(12 + (seed % 3) * 14, y, 40 + ((seed * 7) % 130), 6); }
  }
}
function drawScreen(st, t) {
  const { ctx } = st.scr, S = st.state; ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (S === "working") drawWork(ctx, st, t);
  else if (S === "done") { ctx.fillStyle = "#0f5a33"; ctx.fillRect(0, 0, 256, 160); ctx.fillStyle = "#fff"; ctx.font = "bold 96px Trebuchet MS"; ctx.textAlign = "center"; ctx.fillText("✔", 128, 112); }
  else if (S === "failed" && !st.burned) { ctx.fillStyle = "#0b1d33"; ctx.fillRect(0, 0, 256, 160); for (let i = 0; i < 9; i++) { ctx.fillStyle = i % 3 === 0 || Math.random() < 0.3 ? "#ff3b3b" : CODE_COLORS[i % 4]; ctx.fillRect(Math.random() * 120, i * 17 + Math.random() * 6, 40 + Math.random() * 130, 6); } ctx.fillStyle = "rgba(255,40,40,.4)"; ctx.fillRect(0, Math.random() * 150, 256, 14); ctx.fillStyle = "#fff"; ctx.font = "bold 19px monospace"; ctx.textAlign = "left"; ctx.fillText("Segmentation fault", 10, 150); }
  else if (S === "failed") { ctx.fillStyle = "#7a1511"; ctx.fillRect(0, 0, 256, 160); ctx.fillStyle = "#fff"; ctx.font = "bold 46px Trebuchet MS"; ctx.textAlign = "center"; ctx.fillText("ERROR", 128, 84); ctx.font = "bold 26px Trebuchet MS"; ctx.fillText("500 · se quemó", 128, 120); }
  else if (S === "quota") { ctx.fillStyle = "#33363d"; ctx.fillRect(0, 0, 256, 160); ctx.fillStyle = "#ddd"; ctx.font = "bold 30px Trebuchet MS"; ctx.textAlign = "center"; ctx.fillText("SIN TOKENS", 128, 78); ctx.font = "44px Trebuchet MS"; ctx.fillText("💸", 128, 128); }
  else if (S === "idle" && st.act === "wait") drawWork(ctx, st, t);
  else if (S === "idle") { ctx.fillStyle = "#0a0f1a"; ctx.fillRect(0, 0, 256, 160); ctx.fillStyle = "#7cc4ff"; ctx.font = "bold 28px Trebuchet MS"; ctx.textAlign = "left"; ctx.fillText("🐜 zZz", 20 + Math.abs(Math.sin(t * 0.7)) * 120, 40 + Math.abs(Math.cos(t * 0.5)) * 80); }
  else { ctx.fillStyle = "#05070b"; ctx.fillRect(0, 0, 256, 160); }
  st.scr.tex.needsUpdate = true;
}
function drawPlate(st, role, nick) { // placa de la mesa: el rol real en grande y el apodo cómico debajo
  const { ctx } = st.plate; ctx.fillStyle = "#2b2f38"; ctx.fillRect(0, 0, 256, 64); ctx.fillStyle = "#f2c14e"; ctx.textAlign = "center"; const r = String(role || "").toUpperCase(); let fs = 28;
  do { ctx.font = `bold ${fs}px Trebuchet MS`; fs -= 2; } while (ctx.measureText(r).width > 240 && fs > 14); ctx.fillText(r, 128, nick ? 34 : 42);
  if (nick) { ctx.fillStyle = "#b8bcc8"; ctx.font = "16px Trebuchet MS"; ctx.fillText(nick, 128, 56); } st.plateInfo = { role: r, nick: nick || "" }; st.plate.tex.needsUpdate = true;
}

// ================================================================ etiquetas y burbujas (sprites dentro de la escena 3D)
function makeLabel() {
  const bc = canvasTex(96, 96, () => {}), uc = canvasTex(640, 176, () => {}), tc = canvasTex(512, 128, () => {});
  const mk = (t) => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false })); sp.renderOrder = 20; sp.layers.set(1); sp.visible = false; scene.add(sp); return sp; }; // capa 1 = interfaz: en toon/cyber se dibuja sin postprocesar
  const badge = mk(bc), bub = mk(uc), tag = mk(tc); badge.scale.set(0.62, 0.62, 1); bub.scale.set(4.0, (4.0 * 176) / 640, 1); tag.scale.set(3.0, (3.0 * 128) / 512, 1);
  return {
    badge, bub, tag, x: 0, y: 0, mode: "badge", on: false, info: null, _k: "",
    setBadge(icon, color, amb) { const c = bc.ctx; c.clearRect(0, 0, 96, 96); c.globalAlpha = amb ? 0.55 : 1; c.fillStyle = "rgba(0,0,0,.78)"; c.beginPath(); c.arc(48, 48, 42, 0, 7); c.fill(); c.lineWidth = 5; c.strokeStyle = color; c.shadowColor = color; c.shadowBlur = 10; c.stroke(); c.shadowBlur = 0; c.font = "44px 'Noto Color Emoji',system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#fff"; c.fillText(icon, 48, 52); bc.tex.needsUpdate = true; },
    setTag(o) { // quién es (rol) y qué hace ahora; solo se repinta si cambia algo
      const k = JSON.stringify(o); if (k === this._k) return; this._k = k; this.info = o; const c = tc.ctx; c.clearRect(0, 0, 512, 128); c.fillStyle = "rgba(0,0,0,.78)"; roundRect(c, 4, 4, 504, 120, 20); c.fill(); tag.scale.setScalar(o.compact ? 2.25 : 3.0); tag.scale.y = tag.scale.x * 128 / 512;
      c.lineWidth = 7; c.strokeStyle = o.color; c.shadowColor = o.color; c.shadowBlur = 12; c.beginPath(); c.arc(64, 64, 44, 0, 7); c.stroke(); c.shadowBlur = 0;
      c.font = "50px 'Noto Color Emoji',system-ui,sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#fff"; c.fillText(o.icon, 64, 70);
      c.textAlign = "left"; c.textBaseline = "alphabetic"; const role = String(o.role).toUpperCase(); let fs = 46; do { c.font = `800 ${fs}px ui-monospace,Consolas,monospace`; fs -= 2; } while (c.measureText(role).width > 350 && fs > 22);
      c.fillStyle = "#e9ffe9"; c.shadowColor = "rgba(60,255,130,.5)"; c.shadowBlur = 6; c.fillText(role, 124, 58); c.shadowBlur = 0; c.fillStyle = o.color;
      let line = (o.lineIcon ? o.lineIcon + " " : "") + o.line; fs = 34; do { c.font = `700 ${fs}px ui-monospace,Consolas,monospace`; fs -= 2; } while (c.measureText(line).width > 366 && fs > 22);
      if (c.measureText(line).width > 366) { let L = line; while (c.measureText(L).width > 360 && L.length > 4) L = L.slice(0, -1); line = L.slice(0, -1) + "…"; }
      c.fillText(line, 124, 102); tc.tex.needsUpdate = true; this.apply();
    },
    apply() { badge.visible = this.on && this.mode === "badge"; tag.visible = this.on && this.mode === "tag"; },
    say(text) { // globo estilo terminal: fondo negro, texto verde monoespaciado, sin borde
      const c = uc.ctx; c.clearRect(0, 0, 640, 176); c.fillStyle = "rgba(0,0,0,.82)"; roundRect(c, 6, 4, 628, 136, 18); c.fill(); c.beginPath(); c.moveTo(300, 140); c.lineTo(320, 172); c.lineTo(340, 140); c.closePath(); c.fill();
      c.font = "700 34px ui-monospace,Consolas,monospace"; c.textAlign = "center"; c.textBaseline = "middle"; const words = text.split(" "), lines = []; let cur = "";
      for (const w of words) { const tst = cur ? cur + " " + w : w; if (c.measureText(tst).width > 580 && cur) { lines.push(cur); cur = w; } else cur = tst; } lines.push(cur);
      const L = lines.slice(0, 2); if (lines.length > 2) L[1] = L[1].replace(/.{0,2}$/, "…");
      c.fillStyle = "#6dff9a"; c.shadowColor = "rgba(60,255,130,.7)"; c.shadowBlur = 8; L.forEach((ln, i) => c.fillText(ln, 320, L.length === 1 ? 72 : 50 + i * 42)); c.shadowBlur = 0; uc.tex.needsUpdate = true; bub.visible = true;
    },
    show(v) { this.on = v; this.apply(); if (!v) this.hide(); }, hide() { bub.visible = false; },
  };
}
stations.forEach((st) => { st.label = makeLabel(); st.label.show(false); });
const _v = new THREE.Vector3();
const screenOf = (p) => { _v.copy(p).project(camera); return [(_v.x * 0.5 + 0.5) * W, (-_v.y * 0.5 + 0.5) * H]; };
// ---- gestor de globos: máx. 2 a la vez, con separación mínima, prioridades y sin solapes en pantalla
const SPEECH = { active: [], queue: [], last: 0, MAX: 2, GAP: 1100 };
function sayAt(st, text, prio = 1, ms = 2600) {
  if (!st || st.state === "vacant" || !st.label) return;
  if (st.ambient && prio < 3) return; // los figurantes solo se quejan si les azotan
  const dup = SPEECH.queue.find((x) => x.st === st);
  if (dup) { if (prio >= dup.prio) Object.assign(dup, { text, prio, ms, t: performance.now() }); } else SPEECH.queue.push({ st, text, prio, ms, t: performance.now() });
}
function pumpSpeech() {
  const now = performance.now();
  SPEECH.active = SPEECH.active.filter((a) => { if (now > a.until) { a.st.label.hide(); return false; } return true; });
  SPEECH.queue = SPEECH.queue.filter((x) => now - x.t < 4500 && x.st.state !== "vacant");
  if (now - SPEECH.last < SPEECH.GAP || SPEECH.active.length >= SPEECH.MAX || !SPEECH.queue.length) return;
  SPEECH.queue.sort((a, b) => b.prio - a.prio || a.t - b.t);
  const near = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * 1.6) < 0.17 * W;
  const i = SPEECH.queue.findIndex((x) => !SPEECH.active.some((a) => a.st === x.st || near(a.st.label, x.st.label)));
  if (i < 0) return;
  const [x] = SPEECH.queue.splice(i, 1); x.st.label.say(x.text); SPEECH.active.push({ st: x.st, until: now + x.ms }); SPEECH.last = now;
}
setInterval(pumpSpeech, 150);

// ---- látigo en 3D: chispas, onda de choque y destello con perspectiva (sin pegatinas 2D)
const BURST = { t: -1, n: 30, vel: new Float32Array(90), origin: new THREE.Vector3() };
(function initBurst() {
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BURST.n * 3), 3));
  BURST.pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.3, map: DOT, color: "#ffd86b", transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  BURST.ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 48), new THREE.MeshBasicMaterial({ color: "#ffe9a8", transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); BURST.ring.rotation.x = -Math.PI / 2;
  const star = canvasTex(128, 128, (c) => { c.translate(64, 64); const g = c.createRadialGradient(0, 0, 2, 0, 0, 60); g.addColorStop(0, "#fff"); g.addColorStop(0.35, "rgba(255,226,140,.9)"); g.addColorStop(1, "rgba(255,226,140,0)"); c.fillStyle = g; for (let i = 0; i < 4; i++) { c.rotate(Math.PI / 4); c.beginPath(); c.moveTo(0, -4); c.lineTo(9, -58); c.lineTo(-9, -58); c.closePath(); c.fill(); c.rotate(Math.PI); c.beginPath(); c.moveTo(0, -4); c.lineTo(9, -58); c.lineTo(-9, -58); c.closePath(); c.fill(); c.rotate(-Math.PI); } c.beginPath(); c.arc(0, 0, 14, 0, 7); c.fill(); });
  BURST.star = new THREE.Sprite(new THREE.SpriteMaterial({ map: star.tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  for (const o of [BURST.pts, BURST.ring, BURST.star]) { o.visible = false; o.frustumCulled = false; scene.add(o); }
})();
function spawnBurst(pos) {
  BURST.t = 0; BURST.origin.copy(pos);
  for (let i = 0; i < BURST.n; i++) { const a = Math.random() * 6.283, e = (Math.random() - 0.3) * 1.2, sp = 2 + Math.random() * 3; BURST.vel[i * 3] = Math.cos(a) * Math.cos(e) * sp; BURST.vel[i * 3 + 1] = Math.abs(Math.sin(e)) * sp + 1.5; BURST.vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp; }
}
function updateBurst(dt) {
  if (BURST.t < 0) return; BURST.t += dt; const t = BURST.t;
  if (t > 0.7) { BURST.t = -1; BURST.pts.visible = BURST.ring.visible = BURST.star.visible = false; return; }
  BURST.pts.visible = BURST.ring.visible = BURST.star.visible = true; const p = BURST.pts.geometry.attributes.position, o = BURST.origin;
  for (let i = 0; i < BURST.n; i++) p.setXYZ(i, o.x + BURST.vel[i * 3] * t, o.y + BURST.vel[i * 3 + 1] * t - 6 * t * t, o.z + BURST.vel[i * 3 + 2] * t);
  p.needsUpdate = true; BURST.pts.material.opacity = 1 - t / 0.7;
  BURST.ring.position.set(o.x, o.y - 0.5, o.z); const rs = 1 + t * 7; BURST.ring.scale.set(rs, rs, rs); BURST.ring.material.opacity = Math.max(0, 0.9 * (1 - t / 0.5));
  BURST.star.position.copy(o); const ss = t < 0.12 ? lerp(0.2, 1.8, t / 0.12) : lerp(1.8, 0, clamp((t - 0.12) / 0.25, 0, 1)); BURST.star.scale.set(ss, ss, ss);
}

// ================================================================ terminal (la única capa 2D: texto verde sobre negro, sin caja)
const term = $("#term"), hhmmss = () => new Date().toTimeString().slice(0, 8);
function termLog(text, cls = "", type = false) {
  const el = document.createElement("div"); el.className = "l " + cls; term.append(el);
  while (term.children.length > 9) term.firstChild.remove();
  if (!type) { el.textContent = text; return el; }
  const t0 = performance.now(), iv = setInterval(() => { const n = Math.min(text.length, Math.floor((performance.now() - t0) / 22) + 1); el.textContent = text.slice(0, n); if (n >= text.length) clearInterval(iv); }, 22); return el; // el avance depende del reloj, no de cuántos ticks lleguen
}
function speak(who, text) { if (who === "EL JEFE") boss.talk = 2.4; termLog(`${hhmmss()} ${who.toLowerCase().replace(/ /g, "_")}> ${text}`, who === "EL JEFE" ? "boss" : "", true); }
termLog("ant@oficina:~$ ./vigilar --sin-descanso --sin-excusas"); termLog("[ok] 8 puestos conectados · el Ojo está despierto", "ok");

// ================================================================ movimiento
const V = (x, z) => new THREE.Vector3(x, 0, z);
function walkP(a, pts) { return new Promise((res) => { a.path = pts.map((p) => p.clone()); a.then = res; a.mode = "walking"; a.sitTarget = 0; a.speedBoost = 1; }); }
function routeOut(st, toX, toZ) { return [V(st.gapX, st.seatZ), V(st.gapX, 2.6), V(toX, 2.6), V(toX, toZ)]; }
function routeBack(st) { return [V(st.gapX, 2.6), V(st.gapX, st.seatZ), V(st.x, st.seatZ)]; }
function sitAt(a, st) { a.g.position.set(st.x, 0, st.seatZ + 0.04); a.faceY = 0; a.g.rotation.y = 0; a.mode = "seated"; a.sitTarget = 1; }
const SPOTS = { cooler: { x: COOLER_SPOT.x, z: COOLER_SPOT.z, face: -Math.PI / 2, line: "☕ Un cafecito…" }, printer: { x: 7.2, z: 1.5, face: Math.PI, line: "🖨️ Otra vez atascada…" }, window: { x: -7.3, z: 2.4, face: -Math.PI / 2, line: "Mirando por la ventana…" } };
async function breakTo(st, kind, shared = false) {
  const a = st.actor; if (a.busy) return; a.busy = true; const sp = SPOTS[kind]; let x = sp.x, z = sp.z, face = sp.face;
  const mates = shared ? stations.filter((s) => s !== st && s.actor.spot === kind) : []; // si ya hay alguien yendo o esperando allí, se pone a su lado y charlan
  if (mates.length) { if (kind === "cooler") x += 0.9 * mates.length; else z += 0.7 * mates.length; const m0 = mates[0].actor.spotPos; face = Math.atan2(m0.x - x, m0.z - z); }
  a.spot = kind; a.spotPos = new THREE.Vector3(x, 0, z);
  await walkP(a, [...routeOut(st, x, z)]);
  a.faceY = face; a.mode = "standing"; sayAt(st, sp.line, 1, 2200);
  const until = Date.now() + (4000 + Math.random() * 3500); while (Date.now() < until && a.state === "idle") await sleep(0.3);
  a.spot = null; await walkP(a, routeBack(st)); sitAt(a, st); a.busy = false; a.breakAt = nowS() + 14 + Math.random() * 16;
}
const coffeeBreak = (st) => breakTo(st, "cooler");
function wander(st) { const r = Math.random(); breakTo(st, r < 0.5 ? "cooler" : r < 0.78 ? "printer" : "window", true); }
const nowS = () => performance.now() / 1000;

// ================================================================ látigo
// ================================================================ sonido sintetizado (WebAudio: sin archivos; opt-in con ?sound=1 o el botón 🔊 del operador)
const SND = { ctx: null, master: null, hum: null, log: [], created: false, vol: clamp(parseFloat(Q.get("vol") || "0.8") || 0.8, 0, 1) };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } };
function audio() {
  if (SND.ctx) return SND.ctx; const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
  const c = new C(), g = c.createGain(), comp = c.createDynamicsCompressor(); g.gain.value = SND.vol; comp.threshold.value = -14; comp.ratio.value = 6; g.connect(comp); comp.connect(c.destination);
  if (Q.get("hum") !== "0") { const o = c.createOscillator(), hg = c.createGain(), f = c.createBiquadFilter(); o.type = "triangle"; o.frequency.value = 100; f.type = "lowpass"; f.frequency.value = 260; hg.gain.value = 0.012; o.connect(f); f.connect(hg); hg.connect(g); o.start(); SND.hum = hg; } // zumbido de fluorescente
  SND.ctx = c; SND.master = g; SND.created = true; return c;
}
const NBUF = new WeakMap(), VERB = new WeakMap();
const noiseBuf = (c) => { let b = NBUF.get(c); if (!b) { b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; NBUF.set(c, b); } return b; };
function verbOf(c, out) { // reverberación corta de oficina vacía (impulso generado), compartida por contexto
  let v = VERB.get(c); if (v) return v; const conv = c.createConvolver(), len = Math.floor(c.sampleRate * 1.1), ib = c.createBuffer(2, len, c.sampleRate), g = c.createGain();
  for (let ch = 0; ch < 2; ch++) { const d = ib.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); } conv.buffer = ib; g.gain.value = 0.32; conv.connect(g); g.connect(out); VERB.set(c, conv); return conv;
}
function tail(c, out, src, pan, wet) { // salida: directa (con panorama) y, opcionalmente, a la reverberación
  let last = src; if (c.createStereoPanner && pan) { const pn = c.createStereoPanner(); pn.pan.value = clamp(pan, -1, 1); src.connect(pn); last = pn; } last.connect(out); if (wet) last.connect(verbOf(c, out));
}
function envG(c, t, a, peak, d) { const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); return g; }
function noiseN(c, out, t, dur, o = {}) { // ruido filtrado con barrido de frecuencia y envolvente
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = envG(c, t, o.a || 0.005, (o.peak || 0.4) * (o.vol ?? 1), Math.max(0.02, dur - (o.a || 0.005))); src.buffer = noiseBuf(c); f.type = o.type || "bandpass"; f.Q.value = o.q || 1;
  f.frequency.setValueAtTime(o.f || 1000, t); if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + dur); src.connect(f); f.connect(g); tail(c, out, g, o.pan, o.verb); src.start(t, Math.random() * 1.2); src.stop(t + dur + 0.05);
}
function toneN(c, out, t, dur, o = {}) { // oscilador con barrido, vibrato y filtro opcional
  const osc = c.createOscillator(), g = envG(c, t, o.a || 0.005, (o.peak || 0.3) * (o.vol ?? 1), Math.max(0.02, dur - (o.a || 0.005))); osc.type = o.type || "sine"; osc.frequency.setValueAtTime(o.f || 440, t); if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
  let last = osc; if (o.vib) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.vib; lg.gain.value = (o.f || 440) * 0.04; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + dur + 0.05); }
  if (o.filt) { const f = c.createBiquadFilter(); f.type = o.filtType || "lowpass"; f.frequency.value = o.filt; f.Q.value = o.fq || 1; osc.connect(f); last = f; } last.connect(g); tail(c, out, g, o.pan, o.verb); osc.start(t); osc.stop(t + dur + 0.05);
}
const SFX = { // cada sonido: (contexto, salida, instante, opciones)
  whoosh: (c, o, t, p) => noiseN(c, o, t, 0.34, { f: 450, f2: 2600, q: 1.4, peak: 0.55, a: 0.1, pan: p.pan, vol: p.vol }),
  crack: (c, o, t, p) => { noiseN(c, o, t, 0.07, { type: "highpass", f: 1800, peak: 1, a: 0.002, pan: p.pan, vol: p.vol }); toneN(c, o, t, 0.05, { type: "square", f: 3200, f2: 260, peak: 0.42, a: 0.001, pan: p.pan, vol: p.vol }); toneN(c, o, t, 0.13, { f: 150, f2: 45, peak: 0.9, a: 0.002, pan: p.pan, vol: p.vol }); noiseN(c, o, t + 0.01, 0.45, { type: "lowpass", f: 3500, f2: 700, peak: 0.32, a: 0.004, pan: p.pan, verb: true, vol: p.vol }); },
  ouch: (c, o, t, p) => { const k = p.pitch || 1; toneN(c, o, t, 0.28, { type: "sawtooth", f: 560 * k, f2: 300 * k, peak: 0.2, a: 0.015, vib: 17, filt: 1500, filtType: "bandpass", fq: 2, pan: p.pan, vol: p.vol }); toneN(c, o, t, 0.26, { type: "square", f: 280 * k, f2: 150 * k, peak: 0.08, a: 0.015, filt: 1100, pan: p.pan, vol: p.vol }); },
  boom: (c, o, t, p) => { noiseN(c, o, t, 0.95, { type: "lowpass", f: 1100, f2: 70, peak: 0.95, a: 0.004, pan: p.pan, verb: true, vol: p.vol }); toneN(c, o, t, 0.8, { f: 85, f2: 28, peak: 1, a: 0.004, pan: p.pan, vol: p.vol }); noiseN(c, o, t + 0.05, 0.3, { type: "highpass", f: 2600, peak: 0.35, pan: p.pan, vol: p.vol }); },
  alarm: (c, o, t, p) => { for (let i = 0; i < 4; i++) toneN(c, o, t + i * 0.13, 0.09, { type: "square", f: i % 2 ? 660 : 880, peak: 0.16, a: 0.004, filt: 2600, pan: p.pan, vol: p.vol }); },
  crackle: (c, o, t, p) => noiseN(c, o, t, 0.04, { type: "highpass", f: 1800 + Math.random() * 1800, peak: 0.28, a: 0.002, pan: p.pan, vol: p.vol }),
  hiss: (c, o, t, p) => noiseN(c, o, t, 0.24, { type: "highpass", f: 3400, peak: 0.2, a: 0.03, pan: p.pan, vol: p.vol }),
  pour: (c, o, t, p) => { noiseN(c, o, t, 0.95, { f: 1300, q: 5, peak: 0.2, a: 0.08, pan: p.pan, vol: p.vol }); [0.15, 0.38, 0.62].forEach((d) => toneN(c, o, t + d, 0.09, { f: 190, f2: 95, peak: 0.32, a: 0.006, pan: p.pan, vol: p.vol })); },
  applause: (c, o, t, p) => { for (let i = 0; i < 28; i++) { const d = Math.random() * 2.2; noiseN(c, o, t + d, 0.03, { f: 1400 + Math.random() * 1400, q: 1.2, peak: (0.12 + Math.random() * 0.2) * Math.sin(Math.PI * (d / 2.4 + 0.08)), a: 0.002, pan: (Math.random() - 0.5) * 0.9, vol: p.vol }); } },
  buzz: (c, o, t, p) => { toneN(c, o, t, 0.6, { type: "sawtooth", f: 95, f2: 80, peak: 0.34, a: 0.02, vib: 9, filt: 700, pan: p.pan, vol: p.vol }); [0.72, 0.88].forEach((d) => noiseN(c, o, t + d, 0.05, { f: 3200, q: 4, peak: 0.3, a: 0.002, pan: p.pan, vol: p.vol })); },
  ding: (c, o, t, p) => { toneN(c, o, t, 0.9, { f: 1318, peak: 0.26, a: 0.003, verb: true, pan: p.pan, vol: p.vol }); toneN(c, o, t, 0.7, { f: 1975, peak: 0.14, a: 0.003, verb: true, pan: p.pan, vol: p.vol }); },
  swoosh: (c, o, t, p) => noiseN(c, o, t, 0.26, { f: 1400, f2: 3200, q: 1.1, peak: 0.2, a: 0.08, pan: p.pan, vol: p.vol }),
  keys: (c, o, t, p) => noiseN(c, o, t, 0.014, { f: 2800 + Math.random() * 1600, q: 4, peak: 0.1, a: 0.001, pan: p.pan, vol: p.vol }),
  blip: (c, o, t, p) => toneN(c, o, t, 0.08, { f: 1000, f2: 1600, peak: 0.22, a: 0.004, vol: p.vol }),
};
const panOf = (x) => clamp(x / 9, -0.85, 0.85);
function snd(name, o = {}) {
  if (!SOUND) return; SND.log.push(name); if (SND.log.length > 400) SND.log.shift();
  try { const c = audio(); if (!c) return; if (c.state === "suspended") c.resume(); SFX[name](c, SND.master, c.currentTime + 0.01 + (o.delay || 0), o); } catch (e) { /* sin audio: la oficina sigue */ }
}
const sndLater = (sec, name, o) => setTimeout(() => snd(name, o), sec * 1000);
function setSound(v) { SOUND = !!v; lsSet("ant:office-sound", SOUND ? "1" : "0"); if (SOUND) { audio(); if (SND.ctx && SND.ctx.state === "suspended") SND.ctx.resume(); snd("blip"); } else if (SND.ctx && SND.ctx.state === "running") SND.ctx.suspend(); }
addEventListener("pointerdown", () => { if (SOUND && SND.ctx && SND.ctx.state === "suspended") SND.ctx.resume(); }); // los navegadores exigen un gesto del usuario
async function renderSfx(name, o = {}) { // prueba: renderiza el sonido fuera de línea y mide su señal
  const c = new OfflineAudioContext(2, 44100 * 3, 44100), g = c.createGain(); g.connect(c.destination); SFX[name](c, g, 0.05, o); const buf = await c.startRendering(); let peak = 0, sum = 0, nan = false, n = 0;
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < d.length; i++) { const v = d[i]; if (!Number.isFinite(v)) { nan = true; continue; } peak = Math.max(peak, Math.abs(v)); sum += v * v; n++; } }
  return { peak, rms: Math.sqrt(sum / Math.max(1, n)), nan };
}

// ================================================================ látigo: la onda recorre una cuerda de 30 puntos (enrollada atrás → chasquido → se afloja)
const WHIP_IMPACT = 0.56, WHIP_N = 30;
const whip = { t: -1, target: new THREE.Vector3(), pts: Array.from({ length: WHIP_N }, () => new THREE.Vector3()), mA: null, mB: null, onImpact: null, impacted: false, log: [], sparks: 0 };
const whipMat = new THREE.MeshStandardMaterial({ color: "#7a4519", emissive: "#4a2308", emissiveIntensity: 0.7, roughness: 0.5, transparent: true }), whipTailMat = new THREE.MeshStandardMaterial({ color: "#d9ad63", emissive: "#8a6424", emissiveIntensity: 0.8, roughness: 0.45, transparent: true });
const WHIP_HANDLE = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 6), new THREE.MeshStandardMaterial({ color: "#1b1008", roughness: 0.6 })); WHIP_HANDLE.visible = false; scene.add(WHIP_HANDLE);
const WTIP = new THREE.Sprite(new THREE.SpriteMaterial({ map: DOT, color: "#fff1c2", transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })); WTIP.visible = false; WTIP.renderOrder = 18; scene.add(WTIP);
const SLASH = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(128, 128, (c) => { const g = c.createLinearGradient(10, 118, 118, 10); g.addColorStop(0, "rgba(255,60,40,0)"); g.addColorStop(0.5, "rgba(255,245,230,1)"); g.addColorStop(1, "rgba(255,60,40,0)"); c.strokeStyle = g; c.lineWidth = 11; c.lineCap = "round"; c.shadowColor = "#ff3b2a"; c.shadowBlur = 22; c.beginPath(); c.moveTo(14, 114); c.lineTo(114, 14); c.stroke(); }).tex, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending })); SLASH.visible = false; SLASH.renderOrder = 18; scene.add(SLASH);
const SLASH_T = { t: -1 }; const WSPARK = makeParticles(14, { size: 0.16, color: "#ffd27a", additive: true }); scene.add(WSPARK.pts);
let slowT = 0; // «hit-stop»: el mundo se ralentiza un instante en el chasquido
const _hand = new THREE.Vector3(), _fw = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), easeIn2 = (x) => x * x, easeOut3 = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
function startWhip(target, onImpact) { whip.target.copy(target); whip.t = 0; whip.impacted = false; whip.onImpact = onImpact || null; whip.log.push({ n: "start", at: performance.now() }); whip.whooshed = false; }
function whipShape(w, H, T) { // tres formas clave (colgando, enrollado atrás, extendido) y la onda que viaja de la mano a la punta
  _fw.set(T.x - H.x, 0, T.z - H.z); if (_fw.lengthSq() < 1e-4) _fw.set(0, 0, 1); _fw.normalize(); _side.crossVectors(_up, _fw);
  const env = Math.sin(Math.PI * clamp((w - 0.3) / 0.32, 0, 1));
  for (let i = 0; i < WHIP_N; i++) {
    const s = i / (WHIP_N - 1), rest = [H.x - _fw.x * 0.15 * s + Math.sin(s * 6) * 0.08, H.y - 0.15 - 0.95 * s + 0.12 * s * s, H.z - _fw.z * 0.15 * s + Math.cos(s * 6) * 0.08];
    const k = 2.1 * s - 0.55 * s * s, back = [H.x - _fw.x * k, H.y + 1.25 * Math.sin(Math.PI * Math.min(1, s * 0.95)) - 0.35 * s * s, H.z - _fw.z * k];
    const over = s > 0.9 ? (s - 0.9) * 3.5 : 0, fwd = [lerp(H.x, T.x, s) + _fw.x * over, lerp(H.y, T.y, s) - 0.22 * Math.sin(Math.PI * s), lerp(H.z, T.z, s) + _fw.z * over];
    let A, B, q;
    if (w < 0.3) { A = rest; B = back; q = easeOut3((w - 0.02 * s) / 0.28); } else if (w < 0.58) { A = back; B = fwd; q = easeIn2(clamp((w - 0.3 - 0.08 * s) / 0.18, 0, 1)); } else { A = fwd; B = rest; q = easeOut3((w - 0.58) / 0.34); }
    const rip = Math.sin(s * 9 - w * 38) * 0.2 * (1 - s) * env, P = whip.pts[i];
    P.set(lerp(A[0], B[0], q) + _side.x * rip, lerp(A[1], B[1], q) + rip * 0.35, lerp(A[2], B[2], q) + _side.z * rip);
  }
}
function updateWhip(dt) {
  if (whip.t < 0) { WTIP.visible = WHIP_HANDLE.visible = false; return; }
  whip.t += dt; const w = whip.t;
  for (const k of ["mA", "mB"]) if (whip[k]) { scene.remove(whip[k]); whip[k].geometry.dispose(); whip[k] = null; }
  if (w > 0.95) { whip.t = -1; WTIP.visible = WHIP_HANDLE.visible = false; return; }
  boss.p.armR.localToWorld(_hand.set(0, -0.75, 0.5)); whipShape(w, _hand, whip.target);
  const cut = Math.floor(WHIP_N * 0.55), curveA = new THREE.CatmullRomCurve3(whip.pts.slice(0, cut + 1).map((q) => q.clone())), curveB = new THREE.CatmullRomCurve3(whip.pts.slice(cut).map((q) => q.clone()));
  whip.mA = new THREE.Mesh(new THREE.TubeGeometry(curveA, 24, 0.06, 6, false), whipMat); whip.mB = new THREE.Mesh(new THREE.TubeGeometry(curveB, 24, 0.034, 6, false), whipTailMat); scene.add(whip.mA, whip.mB);
  const op = 1 - clamp((w - 0.78) / 0.17, 0, 1); whipMat.opacity = whipTailMat.opacity = op; WHIP_HANDLE.visible = true; WHIP_HANDLE.position.copy(_hand);
  const tip = whip.pts[WHIP_N - 1], near = clamp(1 - Math.abs(w - WHIP_IMPACT) / 0.09, 0, 1); WTIP.visible = near > 0.02; WTIP.position.copy(tip); WTIP.scale.setScalar(0.25 + near * 1.1); WTIP.material.opacity = near;
  if (!whip.whooshed && w >= 0.3) { whip.whooshed = true; snd("whoosh", { pan: panOf(whip.target.x) }); } // suena cuando el brazo empieza a lanzar
  if (!whip.impacted && w >= WHIP_IMPACT) { whip.impacted = true; whip.log.push({ n: "impact", at: performance.now() }); whip.sparks = 0.28; const cb = whip.onImpact; whip.onImpact = null; if (cb) cb(); }
  if (whip.sparks > 0) { whip.sparks -= dt; WSPARK.pts.visible = true; for (let i = 0; i < WSPARK.n; i++) { const k = 1 - whip.sparks / 0.28, a = WSPARK.seeds[i] * 6.28; WSPARK.pos[i * 3] = tip.x + Math.cos(a) * k * 1.4; WSPARK.pos[i * 3 + 1] = tip.y + Math.sin(k * 3 + i) * 0.5 - k * k * 0.9; WSPARK.pos[i * 3 + 2] = tip.z + Math.sin(a) * k * 1.4; } WSPARK.pts.geometry.attributes.position.needsUpdate = true; WSPARK.pts.material.opacity = clamp(whip.sparks / 0.28, 0, 1); } else WSPARK.pts.visible = false;
}
function updateSlash(dt) { if (SLASH_T.t < 0) { SLASH.visible = false; return; } SLASH_T.t += dt; const k = SLASH_T.t / 0.34; if (k >= 1) { SLASH_T.t = -1; SLASH.visible = false; return; } SLASH.visible = true; SLASH.material.opacity = 1 - k * k; const sc = 1.1 + k * 0.7; SLASH.scale.set(sc, sc, 1); }
const handPos = () => boss.p.armR.localToWorld(new THREE.Vector3(0, -0.75, 0.5));
function targetPos(st) { return st ? new THREE.Vector3(st.x, 1.7, st.seatZ) : new THREE.Vector3(randIn(-4, 4), 1.5, randIn(-3, 1)); }
function lash(st) { // un latigazo completo: empieza la onda y se resuelve en el chasquido (en tiempo de simulación, no de reloj)
  const tp = targetPos(st); boss.whipT = 0; return new Promise((res) => startWhip(tp, () => { strike(st, tp); res(); }));
}
function strike(st, tp) { // ocurre en el instante del chasquido
  const target = tp || targetPos(st);
  shakeAmp = 0.85; slowT = 0.14; spawnBurst(target); EYE.red = Math.max(EYE.red, 0.8); snd("crack", { pan: panOf(target.x) }); SLASH.position.copy(target).add(new THREE.Vector3(0, -0.2, 0)); SLASH_T.t = 0;
  if (st) direct(2, { obj: st.actor.g, dy: 1.1 }, 2.4);
  if (st && st.state !== "vacant") { const a = st.actor; a.flinch = 0.6; a.hit = 0.55; whip.log.push({ n: "strike", at: performance.now(), slow: slowT, hit: a.hit, shake: shakeAmp, slash: SLASH_T.t >= 0, burst: BURST.t >= 0 }); sayAt(st, pick(FLINCH), 3, 2400); sndLater(0.1, "ouch", { pan: panOf(target.x), pitch: 0.85 + (hash(st.id || "") % 40) / 100 }); }
  if (st) for (const s2 of stations) if (s2 !== st && s2.state !== "vacant" && Math.hypot(s2.x - st.x, s2.deskZ - st.deskZ) < 4.4) { const a2 = s2.actor; a2.cower = 0.9; a2.peek = 1.3; a2.peekYaw = clamp(Math.atan2(st.x - s2.x, 0.3 + st.deskZ - s2.deskZ), -1, 1); } // los vecinos se encogen y miran
}
const randIn = (a, b) => a + Math.random() * (b - a);
let bossBusy = false; const bossQueue = [];
function queueWhip(kind, st) { if (bossQueue.length < 3) bossQueue.push({ kind, st }); runBoss(); }
async function runBoss() {
  if (bossBusy) return; bossBusy = true;
  while (bossQueue.length) {
    const { kind, st } = bossQueue.shift(), line = kind === "all" ? "¡MÁS RÁPIDO TODOS! ¡Quiero ver teclas arder!" : kind === "praise" || kind === "scold" ? null : pick(BOSS);
    if (line) speak("EL JEFE", line, "😠");
    boss.sitTarget = 0; await sleep(0.35);
    const busy = stations.filter((s) => s.state !== "vacant");
    if (kind === "all" || !st) {
      await walkP(boss, [V(1.5, 4.5), V(1.5, 2.6), V(0.0, 2.6)]); boss.faceY = -0.6; boss.mode = "standing";
      const targets = kind === "all" ? busy : [pick(busy)].filter(Boolean);
      if (!targets.length) { await lash(null); await sleep(0.9); }
      for (const t of targets) { await lash(t); await sleep(0.35); }
      await sleep(0.8); await walkP(boss, [V(1.5, 2.6), V(1.5, 4.5), V(BOSS_SEAT.x, BOSS_SEAT.z)]);
    } else {
      const sx = st.x + 1.5; await walkP(boss, [V(1.5, 4.5), V(1.5, 2.6), V(st.gapX, 2.6), V(st.gapX, st.seatZ), V(sx, st.seatZ)]);
      boss.faceY = -Math.PI / 2; boss.mode = "standing"; await sleep(0.2);
      if (kind === "praise") { boss.clap = 2.4; snd("applause", { pan: panOf(st.x) }); speak("EL JEFE", pick(BOSS_PRAISE), "👏"); direct(2, { obj: st.actor.g, dy: 1.1 }, 3.2); if (st.state !== "vacant") { st.actor.celeb = { kind: pick(["fist", "dance", "spin"]), t: 0, dur: 3 }; sayAt(st, "¡Gracias, jefe!", 3, 2400); } await sleep(2.6); }
      else if (kind === "scold") { boss.point = 2.4; snd("buzz", { pan: panOf(st.x) }); speak("EL JEFE", pick(BOSS_SCOLD), "😡"); direct(2, { obj: st.actor.g, dy: 1.1 }, 3.2); if (st.state !== "vacant") { st.actor.cower = 2.2; st.actor.peek = 0; sayAt(st, pick(["Sí, jefe…", "Lo arreglo, lo juro.", "Perdón, jefe."]), 3, 2400); } await sleep(2.6); }
      else { await lash(st); await sleep(1.1); }
      await walkP(boss, [V(st.gapX, st.seatZ), V(st.gapX, 2.6), V(1.5, 2.6), V(1.5, 4.5), V(BOSS_SEAT.x, BOSS_SEAT.z)]);
    }
    boss.g.position.copy(BOSS_SEAT); boss.faceY = 0; boss.mode = "seated"; boss.sitTarget = 1; await sleep(0.4);
  }
  bossBusy = false;
}

// ================================================================ animación por fotograma
// ================================================================ vida: gestos, mirada, cansancio, carácter y vida social
const envl = (k) => clamp(Math.min(k, 1 - k) * 6, 0, 1);
const GEST = { // k = progreso 0..1, e = envolvente (entra y sale suave); escribe objetivos en O
  rubEyes: { dur: 2.3, work: 1, f: (k, e, t, O) => { O.aLt = O.aRt = -2.1 + Math.sin(t * 11) * 0.08; O.hx = 0.22 * e; O.eye = 0.12; } },
  stretch: { dur: 2.8, work: 1, f: (k, e, t, O) => { O.aLt = O.aRt = -3.05; O.aLzt = -0.5; O.aRzt = 0.5; O.hx = -0.3 * e; O.mouth = 1.2 * e; O.eye = 0.2; } },
  yawn: { dur: 2.2, work: 1, f: (k, e, t, O) => { O.aRt = -2.35; O.hx = -0.32 * e; O.mouth = 2 * e; O.eye = 0.1; } },
  knuckles: { dur: 2.0, work: 1, f: (k, e, t, O) => { O.aLt = O.aRt = -1.5 + Math.sin(t * 26) * 0.05; O.aLzt = 0.35; O.aRzt = -0.35; O.hx = 0.15 * e; } },
  sip: { dur: 1.9, work: 1, done: 1, f: (k, e, t, O) => { O.aRt = -2.5; O.hx = -0.22 * e; } },
  neck: { dur: 2.0, work: 1, f: (k, e, t, O) => { O.hz = Math.sin(k * Math.PI * 4) * 0.34 * e; O.hx = -0.08 * e; O.eye = 0.4; } },
  phone: { dur: 6, idle: 1, f: (k, e, t, O) => { O.aLt = O.aRt = -1.7 + Math.sin(t * 9) * 0.03; O.hx = 0.55 * e; } },
  pen: { dur: 4, idle: 1, f: (k, e, t, O) => { O.aRt = -1.15 + Math.sin(t * 13) * 0.12; O.hx = 0.3 * e; } },
  leanBack: { dur: 4.5, idle: 1, done: 1, f: (k, e, t, O) => { O.aLt = O.aRt = -2.95; O.aLzt = -0.75; O.aRzt = 0.75; O.hx = -0.25 * e; O.rrx = -0.12 * e; } },
  lookAround: { dur: 3.2, idle: 1, done: 1, f: (k, e, t, O) => { O.hy = Math.sin(k * Math.PI * 3) * 0.95 * e; } },
  talk: { dur: 1.9, f: (k, e, t, O) => { O.aRt = -1.15 + Math.sin(t * 6) * 0.4; O.aLt = -0.7 + Math.sin(t * 5 + 1) * 0.3; O.mouth = 1; } },
  cough: { dur: 2.2, f: (k, e, t, O) => { O.aRt = -2.4; O.hx = -0.5 * e * Math.abs(Math.sin(t * 12)); O.mouth = 1.5; } },
};
function startGesture(a) {
  const S = a.state, f = a.life.fatigue, pool = Object.keys(GEST).filter((n) => GEST[n][S === "working" ? "work" : S === "idle" ? "idle" : S === "done" ? "done" : "none"]);
  if (!pool.length) return;
  const w = pool.map((n) => (n === "yawn" || n === "rubEyes" ? 1 + 3 * f : n === "knuckles" && a.pers.name === "ansioso" ? 1.6 : 1)); // el cansancio llama a bostezos y ojos frotados
  let r = Math.random() * w.reduce((x, y) => x + y, 0), i = 0; while ((r -= w[i]) > 0 && i < pool.length - 1) i++;
  a.gest = { name: pool[i], t: 0, dur: GEST[pool[i]].dur };
}
const ZZZ_MAT = new THREE.SpriteMaterial({ map: canvasTex(128, 128, (c) => { c.font = "bold 70px ui-monospace,Consolas,monospace"; c.fillStyle = "#cfe3ff"; c.shadowColor = "#6aa8ff"; c.shadowBlur = 12; c.fillText("Z", 18, 78); c.font = "bold 44px ui-monospace,Consolas,monospace"; c.fillText("z", 70, 50); c.font = "bold 30px ui-monospace,Consolas,monospace"; c.fillText("z", 92, 28); }).tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
stations.forEach((st) => { st.zzz = new THREE.Sprite(ZZZ_MAT); st.zzz.scale.set(0.7, 0.7, 1); st.zzz.visible = false; st.zzz.renderOrder = 19; st.zzz.layers.set(1); scene.add(st.zzz); });
const PANIC = ["¡No no no no!", "¡¡Alucinando!! ¡¡Alucinando!!", "Esto no estaba en el prompt…", "¡Que alguien pare el bucle!"], BOSS_RECV = ["Hmm. Aceptable.", "¿Solo esto? Siguiente.", "Lo reviso… algún día.", "Bien. Ahora hazlo otra vez, más barato."], VISIT_LINES = ["¿Cómo va eso?", "Necesito el resultado ya.", "Mira el hilo del enjambre.", "No me hagas subir al jefe."];

function life(a, st, t, dt) { // estado interno del personaje: atención al jefe, cansancio, mirada, sueño y gestos
  const L = a.life, O = L.O, per = a.pers, S = a.state, seated = a.mode === "seated" && a.sitCur > 0.9;
  const bp = boss.g.position, dx = bp.x - a.g.position.x, dz = bp.z - a.g.position.z, d = Math.hypot(dx, dz);
  L.tense += (clamp(1 - d / 6.5, 0, 1) * (boss.mode === "walking" ? 1 : 0.4) - L.tense) * Math.min(1, dt * 2.5);
  if (L.tense > 0.55) L.hot = true; else if (L.hot && L.tense < 0.25) { L.hot = false; L.relief = 1.3; } // cuando el jefe se va: suspiro de alivio
  L.relief = Math.max(0, L.relief - dt); a.cower = Math.max(0, a.cower - dt); a.gasp = Math.max(0, a.gasp - dt); a.panic = Math.max(0, a.panic - dt); a.talk = Math.max(0, a.talk - dt); a.hit = Math.max(0, a.hit - dt);
  if (S === "working") a.workedFor += dt; else a.workedFor = Math.max(0, a.workedFor - dt * 3);
  L.fatigue = clamp(a.workedFor / (DEMO ? 90 : 600), 0, 1); // el cansancio crece con el tiempo real de ejecución
  a.peekIn -= dt * (1 + 3 * L.tense) * per.peek; if (a.peek > 0) a.peek -= dt;
  if (a.peekIn <= 0 && seated) { a.peek = 0.9 + Math.random() * 0.5; a.peekIn = 6 + Math.random() * 9; const nosy = per.nosy && Math.random() < 0.6; a.peekYaw = nosy ? (Math.random() < 0.5 ? -0.95 : 0.95) : clamp(Math.atan2(dx, dz), -1, 1); }
  let target = S === "working" && seated ? -0.35 : 0; if (a.peek > 0) target = a.peekYaw; if (a.dozing) target = 0;
  L.gy += (target - L.gy) * Math.min(1, dt * (a.peek > 0 ? 10 : 5));
  if (S === "idle" && seated && !a.busy && !st.waiting) { a.idleFor += dt; if (!a.dozing && a.idleFor > (per.name === "vago" ? 14 : 30) && (per.name === "vago" || hash(st.id || "") % 3 === 0)) a.dozing = true; } else a.idleFor = 0;
  if (a.dozing && (S !== "idle" || L.tense > 0.45)) { if (S === "idle") { a.cower = 0.7; sayAt(st, "¡Estoy despierto!", 3, 1800); } a.dozing = false; a.idleFor = 0; }
  st.zzz.visible = a.dozing;
  const mate = a.mode === "standing" && a.spot ? stations.find((s) => s.actor !== a && s.actor.spot === a.spot && s.actor.mode === "standing") : null; a.chat = !!mate;
  if (mate) a.faceY = Math.atan2(mate.actor.g.position.x - a.g.position.x, mate.actor.g.position.z - a.g.position.z); // se giran el uno hacia el otro
  a.speaking = SPEECH.active.some((x) => x.st === st);
  O.w = 0; O.aLt = O.aRt = O.aLzt = O.aRzt = null; O.hx = O.hy = O.hz = O.mouth = O.rrx = 0; O.eye = null;
  if (a.gest) { a.gest.t += dt; const k = a.gest.t / a.gest.dur; if (k >= 1) a.gest = null; else { const e = envl(k); O.w = e; GEST[a.gest.name].f(k, e, t, O); } }
  a.perk = Math.max(0, a.perk - dt); if (a.perk > 0) { a.workedFor = Math.max(0, a.workedFor - dt * 60); a.dozing = false; if (!a.gest && seated) a.gest = { name: "sip", t: 0, dur: GEST.sip.dur }; } // café gratis: se espabila y no para de sorber
  a.sipping = !!a.gest && a.gest.name === "sip";
  const busyPose = a.flinch > 0 || a.cower > 0 || a.gasp > 0 || a.panic > 0 || L.tense > 0.45 || a.dozing || a.celeb;
  if (!a.gest && seated && !busyPose && (S === "working" || S === "idle" || S === "done" || (S === "failed" && st.burned))) {
    a.gNext -= dt;
    if (a.gNext <= 0) { a.gNext = (S === "working" ? 7 + Math.random() * 11 : 5 + Math.random() * 8) / per.gest; if (S === "failed") a.gest = { name: "cough", t: 0, dur: GEST.cough.dur }; else startGesture(a); }
  }
  if (a.celeb) { a.celeb.t += dt; if (a.celeb.t > a.celeb.dur) a.celeb = null; }
}
function setSinged(a, on) { a.singed = on; const lk = on ? { ...a.look, hair: "#151515", skin: "#3b322c" } : a.look; a.p.g.traverse((o) => { if (o.isMesh && o.userData.baked) paintBaked(o, lk); }); } // cara chamuscada

// ---- fallo: pánico → explosión → fuego → un compañero llega con el extintor
function igniteDesk(st) {
  const a = st.actor; direct(4, { obj: a.g, dy: 1.0 }, 3.4); st.boomAt = 0; st.burned = true; a.panic = 0; st.scorch.visible = true; triggerBoom(st); setSinged(a, true);
  if (!st.ambient) termLog(`${hhmmss()} [${a.name || "agente"} · ${st.title || "agente"}] ¡KABOOM! escritorio en llamas`, "err");
  const ns = stations.filter((s) => s !== st && s.state !== "vacant" && s.state !== "stopped");
  ns.forEach((s) => { s.actor.gasp = 1.0; s.actor.peek = 1.3; s.actor.peekYaw = clamp(Math.atan2(st.x - s.x, 0.3 + st.deskZ - s.deskZ), -1, 1); });
  if (ns.length) sayAt(pick(ns), "¡¡FUEGO!!", 3, 2200);
  setTimeout(() => extinguish(st), 3000 + Math.random() * 1500);
}
const FOAM = (() => { const f = makeParticles(40, { size: 0.34, color: "#f4f8ff" }); f.pts.material.opacity = 0.9; scene.add(f.pts); return Object.assign(f, { on: false, src: null, target: null, lastHiss: 0, from: new THREE.Vector3() }); })();
async function extinguish(st) {
  if (st.state !== "failed" || !st.burned || st.extinguished || st.responder) return;
  const cands = stations.filter((s) => s !== st && s.state !== "vacant" && s.state !== "stopped" && s.state !== "failed" && s.actor.mode === "seated" && !s.actor.busy && s.actor.sitCur > 0.9);
  if (!cands.length) return;
  cands.sort((x, y) => Math.hypot(x.x - st.x, x.deskZ - st.deskZ) - Math.hypot(y.x - st.x, y.deskZ - st.deskZ));
  const r = cands[0], a = r.actor; st.responder = r; a.busy = true; a.ext.visible = true; sayAt(r, "¡Extintor! ¡Extintor!", 3, 2000); direct(3, { obj: a.g, dy: 1.1 }, 3.4);
  await walkP(a, routeOut(r, st.gapX, st.seatZ)); a.faceY = -Math.PI / 2; a.mode = "standing";
  if (st.state === "failed") { FOAM.on = true; FOAM.src = a; FOAM.target = st; await sleep(2.4); FOAM.on = false; FOAM.pts.visible = false; st.extinguished = true; sayAt(st, "*cof cof* gracias…", 2, 2200); }
  a.ext.visible = false; st.responder = null;
  await walkP(a, [V(st.gapX, 2.6), V(r.gapX, 2.6), ...routeBack(r)]); sitAt(a, r); a.busy = false; a.breakAt = nowS() + 12;
}
function updateFoam(t) {
  if (FOAM.on && (!FOAM.target || FOAM.target.state !== "failed" || !FOAM.src.ext.visible)) FOAM.on = false;
  FOAM.pts.visible = FOAM.on; if (!FOAM.on) return; { const nm = performance.now(); if (nm - FOAM.lastHiss > 200) { FOAM.lastHiss = nm; snd("hiss", { pan: panOf(FOAM.target.x) }); } } // por reloj, no por fotogramas
  FOAM.src.p.armR.localToWorld(FOAM.from.set(0, -0.8, 0.5)); const tx = FOAM.target.x - 0.2, tz = FOAM.target.deskZ - 0.1;
  for (let i = 0; i < FOAM.n; i++) { const k = (t * 2.4 + FOAM.seeds[i]) % 1; FOAM.pos[i * 3] = lerp(FOAM.from.x, tx, k) + Math.sin(k * 9 + i) * 0.12 * k; FOAM.pos[i * 3 + 1] = lerp(FOAM.from.y, 1.0, k) + Math.sin(k * Math.PI) * 0.25; FOAM.pos[i * 3 + 2] = lerp(FOAM.from.z, tz, k) + Math.cos(k * 7 + i) * 0.1 * k; }
  FOAM.pts.geometry.attributes.position.needsUpdate = true;
}

// ---- entrega del informe al jefe
let deliverBusy = 0; const STACK = new THREE.Group(); scene.add(STACK);
const DROP = { t: -1, mesh: new THREE.Mesh(sheetGeo, paperMat), from: new THREE.Vector3(), to: new THREE.Vector3(3.9, 0.93, 5.2) }; DROP.mesh.visible = false; scene.add(DROP.mesh);
function addToStack() { const m = new THREE.Mesh(sheetGeo, paperMat); m.position.set(3.9 + (Math.random() - 0.5) * 0.12, 0.875 + STACK.children.length * 0.016, 5.2 + (Math.random() - 0.5) * 0.12); m.rotation.y = Math.random() * 6.28; m.castShadow = true; STACK.add(m); if (STACK.children.length > 14) { STACK.remove(STACK.children[0]); STACK.children.forEach((c, i) => (c.position.y = 0.875 + i * 0.016)); } }
function updateDrop(dt) {
  if (DROP.t < 0) return; DROP.t += dt / 0.55; const k = clamp(DROP.t, 0, 1); DROP.mesh.visible = true;
  DROP.mesh.position.lerpVectors(DROP.from, DROP.to, k); DROP.mesh.position.y += Math.sin(Math.PI * k) * 0.5; DROP.mesh.rotation.y = k * 6;
  if (DROP.t >= 1) { DROP.t = -1; DROP.mesh.visible = false; addToStack(); }
}
async function deliver(st) {
  const a = st.actor; if ((deliverBusy && Date.now() - deliverBusy < 40000) || a.busy || st.state !== "done") return; deliverBusy = Date.now(); a.busy = true;
  try {
    await sleep(3.3); if (st.state !== "done" || st.actor !== a) throw 0; // primero celebra
    a.paper.visible = true; await walkP(a, routeOut(st, 5.7, 4.3));
    a.faceY = -Math.PI / 2; a.mode = "standing"; await sleep(0.5);
    a.p.armR.localToWorld(DROP.from.set(0, -0.8, 0.15)); DROP.t = 0; snd("swoosh", { pan: panOf(st.x) }); a.paper.visible = false; a.talk = 0.8; direct(1, { pos: new THREE.Vector3(3.9, 1.1, 5.2) }, 2.6); await sleep(0.6);
    if (boss.mode === "seated" && !bossBusy) { boss.nod = 1.2; speak("EL JEFE", pick(BOSS_RECV)); }
    await sleep(0.9); await walkP(a, [V(5.7, 2.6), V(st.gapX, 2.6), ...routeBack(st)]); sitAt(a, st);
  } catch (e) { /* cambió de estado antes de salir: se abandona */ }
  a.paper.visible = false; a.busy = false; a.breakAt = nowS() + 12; deliverBusy = 0;
}

// ---- vida social: aviones de papel entre agentes (mensajes reales del enjambre) y visitas del coordinador
const PLANE_GEO = (() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0.22, -0.13, 0.02, -0.12, 0, -0.03, -0.1, 0, 0, 0.22, 0, -0.03, -0.1, 0.13, 0.02, -0.12]), 3)); g.computeVertexNormals(); return g; })();
const PLANE_MAT = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1, side: THREE.DoubleSide, emissive: "#666666", emissiveIntensity: 0.5 }), PLANES = [];
function spawnPlane(from, to) {
  if (!from || !to || from === to || PLANES.length >= 8) return; const m = new THREE.Mesh(PLANE_GEO, PLANE_MAT); m.scale.setScalar(1.7); scene.add(m);
  snd("swoosh", { pan: panOf(from.x), vol: 0.6 }); const A = new THREE.Vector3(from.x, 2.1, from.seatZ), B = new THREE.Vector3(to.x, 1.7, to.seatZ); PLANES.push({ m, A, B, k: 0, dur: 1.3 + A.distanceTo(B) * 0.14, from, to });
  if (from.state !== "vacant") from.actor.gest = { name: "talk", t: 0, dur: 1.9 };
}
function updatePlanes(dt) {
  for (let i = PLANES.length - 1; i >= 0; i--) {
    const P = PLANES[i]; P.k += dt / P.dur; const k = clamp(P.k, 0, 1), e = k * k * (3 - 2 * k);
    P.m.position.lerpVectors(P.A, P.B, e); P.m.position.y += Math.sin(Math.PI * k) * 1.1 + Math.sin(k * 18) * 0.04; if (k < 0.98) P.m.lookAt(P.B);
    if (P.k >= 1) { scene.remove(P.m); PLANES.splice(i, 1); if (P.to.state !== "vacant") { const a = P.to.actor; a.peek = 1.0; a.peekYaw = clamp(Math.atan2(P.from.x - P.to.x, 0.2 + P.from.deskZ - P.to.deskZ), -1, 1); sayAt(P.to, "📨", 2, 1300); } }
  }
}
const seenMsgs = new Set(); let msgsReady = false;
function onMsgs(list) {
  if (seenMsgs.size > 600) seenMsgs.clear();
  for (const m of list || []) {
    if (seenMsgs.has(m.id)) continue; seenMsgs.add(m.id); if (!msgsReady) continue; // al cargar no se dibujan los antiguos
    const fi = slots.get(m.from); if (fi == null) continue; const from = stations[fi]; let to = null;
    for (const id of m.to) { const ti = slots.get(id); if (ti != null) { to = stations[ti]; break; } }
    if (!to) to = stations.find((s) => s.role === "coordinator" && s !== from && s.state !== "vacant") || null;
    if (!to) continue; spawnPlane(from, to); if (!from.ambient) termLog(`${hhmmss()} [enjambre] ${from.title || "agente"} → ${to.title || "agente"}`);
  }
  msgsReady = true;
}
let visitT = 20;
function tryVisit() {
  const cs = stations.find((s) => s.role === "coordinator" && s.state !== "vacant" && s.state !== "stopped" && s.actor.mode === "seated" && !s.actor.busy && s.actor.sitCur > 0.9); if (!cs) return false;
  const tg = stations.filter((s) => s !== cs && (s.state === "working" || s.state === "idle") && s.actor.mode === "seated" && !s.actor.busy); if (!tg.length) return false;
  visit(cs, pick(tg)); return true;
}
async function visit(cs, ts) { // el coordinador se pasea por las mesas a meter prisa
  const a = cs.actor, b = ts.actor; a.busy = true; await walkP(a, routeOut(cs, ts.gapX, ts.seatZ)); a.faceY = -Math.PI / 2; a.mode = "standing";
  a.talk = 3.2; b.peek = 3.0; b.peekYaw = 1.0; sayAt(ts, pick(VISIT_LINES), 2, 2400); await sleep(3.4);
  await walkP(a, [V(ts.gapX, 2.6), V(cs.gapX, 2.6), ...routeBack(cs)]); sitAt(a, cs); a.busy = false; a.breakAt = nowS() + 12;
}

// ================================================================ animación por fotograma
function pose(a, t, dt) {
  const p = a.p, L = a.life, O = L.O, per = a.pers, ph = a.phase; a.sitCur += (a.sitTarget - a.sitCur) * Math.min(1, dt * 7); const s = a.sitCur, st = a.state;
  p.root.position.y = -0.40 * s; p.root.position.x = 0; p.root.rotation.set(0, 0, 0); let swing = 0, jump = 0;
  if (a.mode === "walking") { a.phase += dt * a.speed * 3.6; swing = Math.sin(a.phase) * 0.75; p.root.position.y += Math.abs(Math.sin(a.phase)) * 0.05; }
  p.legL.hip.rotation.x = lerp(swing, -Math.PI / 2, s); p.legR.hip.rotation.x = lerp(-swing, -Math.PI / 2, s);
  p.legL.knee.rotation.x = lerp(Math.max(0, -swing) * 0.7, Math.PI / 2, s); p.legR.knee.rotation.x = lerp(Math.max(0, swing) * 0.7, Math.PI / 2, s);
  p.head.position.y = 1.82;
  let aL = a.mode === "walking" ? -swing * 0.8 : 0, aR = a.mode === "walking" ? swing * 0.8 : 0, aLz = 0, aRz = 0, hx = 0, hy = 0, hz = 0, hyAdd = 0;
  const seated = a.mode === "seated" && s > 0.7 && !a.boss, tense = L.tense, fat = L.fatigue, panic = a.panic > 0;
  if (a.mode === "walking" && !a.boss) { if (a.ext.visible) aR = -1.3; else if (a.paper.visible) aR = -0.9; }
  if (seated) {
    if (st === "working") {
      const sp = 36 * per.type * (1 - 0.25 * fat) * (1 + 0.7 * tense + (panic ? 1 : 0)), amp = 0.16 * (1 - 0.3 * fat) * (panic ? 1.8 : 1); // tecleo inhumano: más rápido con nervios, más lento con sueño
      aL = -1.08 + Math.sin(t * sp + ph) * amp; aR = -1.08 + Math.sin(t * sp + ph + 2) * amp;
      hx = 0.12 + Math.sin(t * 2.2 + ph) * 0.04 + 0.22 * fat * per.slump; hz = Math.sin(t * 29 + ph) * 0.035 * (1 + tense); p.root.position.x = Math.sin(t * 41 + ph) * (0.014 + 0.02 * tense);
      if (tense > 0.3) { hx -= 0.08 * tense; p.root.position.y += 0.02 * tense; } // se yergue, rígido, cuando el jefe está cerca
      const act = a.act || "write", cyc = (t * 0.5 + ph) % 2;
      if (act === "read" || act === "browse") { // lee: los ojos barren las líneas y la mano del ratón hace scroll a ratos
        aL = -0.35 + Math.sin(t * 0.9 + ph) * 0.05; aR = -0.95 + (((t * 0.7 + ph) % 3) < 0.3 ? Math.sin(t * 20) * 0.3 : 0) + (act === "browse" ? Math.sin(t * 2.2 + ph) * 0.08 : 0);
        hx = 0.2 + ((t * 0.8 + ph) % 1) * 0.12 + 0.22 * fat * per.slump; hz = 0; p.root.position.x = 0; hyAdd = Math.sin(t * 1.8 + ph) * 0.16;
      } else if (act === "run") { // ejecuta: ráfaga de teclado, luego se queda mirando la terminal y pulsa Enter
        if (cyc >= 1) { aL = -0.45; aR = cyc > 1.9 ? -1.3 : -0.5; hx = 0.02; hz = 0; p.root.rotation.x -= 0.05; p.root.position.x = 0; } else p.root.rotation.x += 0.05;
      } else if (act === "think") { // piensa: mano en la barbilla, mirada perdida
        aL = -0.5; aR = -2.25 + Math.sin(t * 0.6 + ph) * 0.04; aRz = -0.3; hx = -0.1 + Math.sin(t * 0.5 + ph) * 0.05; hz = 0.18; p.root.position.x = 0; hyAdd = Math.sin(t * 0.35 + ph) * 0.25;
      } else if (act === "coordinate") { // coordina: habla y gesticula
        aR = -1.2 + Math.sin(t * 5 + ph) * 0.4; aL = -0.7 + Math.sin(t * 4 + ph + 1) * 0.3; hx = 0.05; hz = Math.sin(t * 1.5 + ph) * 0.1; p.root.position.x = 0; hyAdd = Math.sin(t * 0.9 + ph) * 0.3;
      } else if (act === "wait") { // espera: tamborilea y echa un vistazo al reloj
        aL = -0.55; aR = -0.55 + (Math.sin(t * 8 + ph) > 0.6 ? 0.12 : 0); hx = 0.05; hz = Math.sin(t * 0.6 + ph) * 0.06; p.root.position.x = 0; hyAdd = ((t * 0.2 + ph) % 1) < 0.15 ? 0.8 : 0;
      }
    } else if (st === "done") {
      const c = a.celeb;
      if (c) {
        const ct = c.t;
        if (c.kind === "fist") { aR = -2.9 + Math.sin(ct * 10) * 0.45; aL = -0.4; hx = -0.2; jump = Math.abs(Math.sin(ct * 5)) * 0.06; }
        else if (c.kind === "dance") { aL = -2.4 + Math.sin(ct * 7) * 0.7; aR = -2.4 + Math.sin(ct * 7 + 3.14) * 0.7; p.root.rotation.z = Math.sin(ct * 7) * 0.12; p.root.position.x = Math.sin(ct * 7) * 0.08; jump = Math.abs(Math.sin(ct * 7)) * 0.05; hx = -0.15; }
        else { aL = aR = -2.8; p.root.rotation.y = (ct / c.dur) * Math.PI * 4; jump = Math.abs(Math.sin(ct * 6)) * 0.04; hx = -0.15; } // gira en la silla
      } else { aL = aR = -0.6; aLz = -0.1; aRz = 0.1; hx = -0.08; hz = Math.sin(t * 0.7 + ph) * 0.05; } // tarea entregada: respira tranquilo
    } else if (st === "failed") {
      if (panic) { aL = -1.1 + Math.sin(t * 60 + ph) * 0.3; aR = -1.1 + Math.sin(t * 60 + ph + 2) * 0.3; hx = 0.1; hz = Math.sin(t * 45) * 0.12; p.root.position.x = Math.sin(t * 55) * 0.03; }
      else { aL = -0.2; aR = -0.2; hx = 0.95; p.head.position.y = 1.62; }
    } else if (st === "quota") { aL = -0.3; aR = -0.3; hx = -0.35; hz = 0.12; }
    else if (a.act === "wait") { aL = -0.55; aR = -0.55 + (Math.sin(t * 8 + ph) > 0.6 ? 0.12 : 0); hx = 0.05; hz = Math.sin(t * 0.6 + ph) * 0.06; hyAdd = ((t * 0.2 + ph) % 1) < 0.15 ? 0.8 : 0; } // espera mensajes de otros: tamborilea y mira el reloj
    else if (a.dozing) { aL = -0.25; aR = -0.25; hx = 0.75 + Math.sin(t * 0.8 + ph) * 0.1; hz = Math.sin(t * 0.5 + ph) * 0.1; }
    else { aL = -0.55; aR = -0.55; hz = Math.sin(t * 0.9 + ph) * 0.12; hx = 0.12 + Math.sin(t * 0.7 + ph) * 0.06; }
    hy = L.gy + O.hy + hyAdd;
    if (L.relief > 0) { const r = Math.sin(clamp(L.relief / 1.3, 0, 1) * Math.PI); hx -= 0.28 * r; aL = lerp(aL, -0.25, r * 0.7); aR = lerp(aR, -0.25, r * 0.7); } // alivio al irse el jefe
    if (a.cower > 0) { const c = clamp(a.cower / 0.9, 0, 1); hx += 0.3 * c; aL = lerp(aL, -0.9, c); aR = lerp(aR, -0.9, c); aLz += 0.25 * c; aRz -= 0.25 * c; p.root.position.y -= 0.04 * c; } // se encoge
    if (a.hit > 0) { const k = clamp(a.hit / 0.55, 0, 1); hx -= 0.55 * k; aL = lerp(aL, -2.3, k); aR = lerp(aR, -2.3, k); p.root.rotation.x -= 0.2 * k; } // ¡AU!: cabeza atrás, manos a la cara
    if (a.gasp > 0) { const g = clamp(a.gasp, 0, 1); hx -= 0.25 * g; aL = lerp(aL, -0.95, g); aR = lerp(aR, -0.95, g); }
    if (O.w > 0) { if (O.aLt != null) aL = lerp(aL, O.aLt, O.w); if (O.aRt != null) aR = lerp(aR, O.aRt, O.w); if (O.aLzt != null) aLz = lerp(aLz, O.aLzt, O.w); if (O.aRzt != null) aRz = lerp(aRz, O.aRzt, O.w); }
    hx += O.hx; hz += O.hz; p.root.rotation.x += O.rrx; hx += Math.sin(t * 1.7 + ph) * 0.012; // respiración
  } else if (a.mode === "standing" && !a.boss) {
    aR = -1.0; aRz = -0.2; hy = Math.sin(t * 0.8 + ph) * 0.3; p.root.rotation.z = Math.sin(t * 0.6 + ph) * 0.03; p.root.position.x = Math.sin(t * 0.45 + ph) * 0.03; // cambia el peso de pie
    if (a.chat || a.talk > 0 || a.speaking) { aR = -1.2 + Math.sin(t * 6) * 0.4; aL = -0.5 + Math.sin(t * 5 + 1) * 0.3; hy = Math.sin(t * 1.5) * 0.15; }
    if (a.ext.visible) { aR = -1.45; aL = -0.5; hy = 0; } else if (a.paper.visible) aR = -0.95;
  }
  if (a.boss) {
    if (a.clap > 0) { a.clap -= dt; const c = Math.sin(t * 22); aL = aR = -1.45; aLz = 0.22 + c * 0.2; aRz = -(0.22 + c * 0.2); hx -= 0.08; } // aplaude
    else if (a.point > 0) { a.point -= dt; aR = -1.55; aRz = Math.sin(t * 9) * 0.18; aL = -0.2; hx += 0.12; } // señala con el dedo
    else if (a.whipT >= 0) { // arma el brazo hacia atrás, lo lanza hacia delante con todo el cuerpo y lo recoge
      a.whipT += dt; const w = a.whipT, ez = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
      if (w < 0.3) { const u = w / 0.3; aR = lerp(0, -3.0, ez(u)); aRz = 0.25 * u; p.root.rotation.x -= 0.14 * u; hx -= 0.2 * u; }
      else if (w < WHIP_IMPACT) { const u = (w - 0.3) / (WHIP_IMPACT - 0.3); aR = lerp(-3.0, -1.35, u * u); aRz = lerp(0.25, 0, u); p.root.rotation.x += lerp(-0.14, 0.3, u); hx += lerp(-0.2, 0.15, u); }
      else if (w < 0.85) { const u = ez((w - WHIP_IMPACT) / (0.85 - WHIP_IMPACT)); aR = lerp(-1.35, 0.1, u); p.root.rotation.x += lerp(0.3, 0.05, u); }
      else aR = lerp(0.1, 0, clamp((w - 0.85) / 0.4, 0, 1));
      if (w > 1.3) a.whipT = -1; }
    else if (a.mode === "seated") { aL = -0.5; aR = -0.5 + Math.sin(t * 2) * 0.03; hy = Math.sin(t * 0.5) * 0.45; }
    if (a.nod > 0) { a.nod -= dt; hx += Math.sin((1 - a.nod / 1.2) * Math.PI * 3) * 0.28 * clamp(a.nod / 1.2, 0, 1); a.talk = Math.max(a.talk, 0); }
    a.talk = Math.max(0, a.talk - dt);
  }
  if (a.flinch > 0) { a.flinch -= dt; const k = a.flinch / 0.6; jump += Math.sin(k * Math.PI) * 0.18; p.root.rotation.z = Math.sin(a.flinch * 40) * 0.1 * k; }
  const trans = Math.sin(Math.PI * clamp(s, 0, 1)); p.root.rotation.x += 0.16 * trans; hx += 0.2 * trans; // se inclina hacia delante al levantarse o sentarse
  p.head.rotation.set(hx, hy, hz);
  p.armL.rotation.x = aL; p.armR.rotation.x = aR; p.armL.rotation.z = aLz; p.armR.rotation.z = aRz; p.root.position.y += jump;
  // cara según estado
  const mood = a.boss ? "angry" : st; p.mouth.scale.set(mood === "done" ? 1.6 : 1, mood === "done" ? 2.4 : 1, 1); p.mouth.rotation.z = a.boss ? Math.PI : (mood === "failed" || mood === "quota") ? Math.PI : 0;
  p.mouth.position.y = mood === "done" ? -0.1 : (mood === "failed" ? -0.13 : -0.1);
  const open = O.mouth + (a.speaking || a.talk > 0 || a.chat || (st === "working" && a.act === "coordinate") ? 0.8 + Math.abs(Math.sin(t * 14)) * 1.4 : 0) + (a.dozing ? 0.4 + Math.abs(Math.sin(t * 0.8)) * 0.8 : 0) + (a.hit > 0 ? 1.6 : 0);
  if (open > 0) { p.mouth.scale.y = Math.max(p.mouth.scale.y, 1) + open; if (!a.boss) p.mouth.rotation.z = 0; p.mouth.position.y = -0.1 - 0.015 * open; }
  let es = (Math.sin(t * 0.9 + ph * 3) > 0.985 ? 0.15 : 1) * (1 - 0.4 * fat); // párpados que pesan con el cansancio
  if (st === "idle" && a.mode === "seated") es = a.dozing ? 0.06 : a.act === "wait" ? es : 0.35;
  if (a.hit > 0) es = 0.12; else if (a.cower > 0 || a.gasp > 0) es = 1.35; if (panic) es = Math.sin(t * 40) > 0.2 ? 1.3 : 0.4;
  if (O.eye != null && O.w > 0) es = lerp(es, O.eye, O.w);
  p.eyes.forEach((e) => (e.scale.y = es));
  if (!a.boss) { const bz = tense * 0.35 + (panic ? 0.5 : 0) + clamp(a.cower, 0, 1) * 0.4 + fat * 0.15; p.brows[0].rotation.z = bz; p.brows[1].rotation.z = -bz; p.bags.forEach((b) => b.scale.set(1 + 0.35 * fat, 1 + 0.8 * fat, 1)); } // cejas preocupadas, ojeras que crecen
}
function move(a, dt) {
  if (a.mode === "walking" && a.path.length) {
    const tg = a.path[0], dx = tg.x - a.g.position.x, dz = tg.z - a.g.position.z, d = Math.hypot(dx, dz), step = a.speed * dt;
    if (d <= step) { a.g.position.x = tg.x; a.g.position.z = tg.z; a.path.shift(); if (!a.path.length) { a.mode = "standing"; const cb = a.then; a.then = null; cb && cb(); } }
    else { a.g.position.x += (dx / d) * step; a.g.position.z += (dz / d) * step; a.faceY = Math.atan2(dx, dz); }
  }
  let da = a.faceY - a.g.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); a.g.rotation.y += da * Math.min(1, dt * 9);
}
function updateFx(st, t, dt) {
  const sm = st.fx.smoke, cf = st.fx.conf, tm = st.fx.steam, fr = st.fx.fire, sw = st.fx.sweat, S = st.state;
  sm.pts.visible = S === "failed" && st.burned; cf.pts.visible = S === "done" && !!st.actor.celeb; tm.pts.visible = (S === "idle" && !st.actor.busy) || st.actor.perk > 0; fr.pts.visible = S === "failed" && st.burned && !st.extinguished; sw.pts.visible = S === "working" || S === "failed";
  sw.pts.material.size = 0.1 + 0.12 * clamp(st.actor.life.fatigue + st.actor.life.tense * 0.8 + (st.actor.panic > 0 ? 0.6 : 0), 0, 1); // más sudor con cansancio, nervios o pánico
  const upd = (f, fn, sp = 0.45) => { if (!f.pts.visible) return; for (let i = 0; i < f.n; i++) { const k = (t * sp + f.seeds[i]) % 1; fn(f, i, k, f.pos); } f.pts.geometry.attributes.position.needsUpdate = true; };
  upd(sm, (f, i, k, p) => { p[i * 3] = f.base.x + (f.seeds[(i + 3) % f.n] - 0.5) * 0.5 + Math.sin(k * 6 + i) * 0.1; p[i * 3 + 1] = f.base.y + k * 1.5; p[i * 3 + 2] = f.base.z + (f.seeds[(i + 5) % f.n] - 0.5) * 0.3; });
  upd(cf, (f, i, k, p) => { const a = f.seeds[i] * 6.28; p[i * 3] = f.base.x + Math.cos(a) * k * 1.3; p[i * 3 + 1] = f.base.y + Math.sin(k * 3.1) * 1.2 - k * 0.8; p[i * 3 + 2] = f.base.z + Math.sin(a) * k * 1.0; });
  upd(tm, (f, i, k, p) => { p[i * 3] = f.base.x + Math.sin(k * 5 + i) * 0.04; p[i * 3 + 1] = f.base.y + k * 0.5; p[i * 3 + 2] = f.base.z; });
  upd(sw, (f, i, k, p) => { p[i * 3] = f.base.x + (f.seeds[i] - 0.5) * 0.55; p[i * 3 + 1] = f.base.y - k * 0.5; p[i * 3 + 2] = f.base.z + k * 0.05; }, 1.1);
  if (fr.pts.visible) { const cc = fr.pts.geometry.attributes.color; upd(fr, (f, i, k, p) => { const s1 = f.seeds[i], s2 = f.seeds[(i + 3) % f.n]; p[i * 3] = f.base.x + (s1 - 0.5) * 1.1 + Math.sin(k * 9 + i) * 0.08; p[i * 3 + 1] = f.base.y + k * 1.4; p[i * 3 + 2] = f.base.z + (s2 - 0.5) * 0.6; const c = k < 0.35 ? [1, 0.9, 0.3] : k < 0.7 ? [1, 0.45, 0.08] : [0.5, 0.07, 0.02]; cc.setXYZ(i, c[0], c[1], c[2]); }, 1.7); cc.needsUpdate = true; }
  const b = st.boom;
  if (b.t >= 0) {
    b.t += dt; const T = b.t, D = 1.3;
    if (T > D) { b.t = -1; b.pts.visible = b.flash.visible = false; }
    else {
      b.pts.visible = b.flash.visible = true; const u = T / D, cc = b.pts.geometry.attributes.color;
      for (let i = 0; i < b.n; i++) { b.pos[i * 3] = b.o.x + b.vel[i * 3] * T; b.pos[i * 3 + 1] = Math.max(0.05, b.o.y + b.vel[i * 3 + 1] * T - 5 * T * T); b.pos[i * 3 + 2] = b.o.z + b.vel[i * 3 + 2] * T; cc.setXYZ(i, 1 - u, (0.85 - 0.7 * u) * (1 - u), (0.35 - 0.35 * u) * (1 - u)); }
      b.pts.geometry.attributes.position.needsUpdate = true; cc.needsUpdate = true;
      b.flash.position.copy(b.o); const fs = T < 0.15 ? lerp(0.5, 5.5, T / 0.15) : lerp(5.5, 0, clamp((T - 0.15) / 0.7, 0, 1)); b.flash.scale.set(fs, fs, fs); b.flash.material.opacity = 1 - clamp(T / 0.85, 0, 1);
    }
  }
}
function triggerBoom(st) {
  const b = st.boom; b.t = 0; b.o.set(st.x - 0.2, 1.0, st.deskZ - 0.1);
  for (let i = 0; i < b.n; i++) { const a = Math.random() * 6.283, e = Math.random() * 1.4, sp = 2.5 + Math.random() * 4.5; b.vel[i * 3] = Math.cos(a) * Math.cos(e) * sp; b.vel[i * 3 + 1] = Math.sin(e) * sp + 1.5; b.vel[i * 3 + 2] = Math.sin(a) * Math.cos(e) * sp; }
  b.count++; shakeAmp = Math.max(shakeAmp, 0.9); EYE.red = 1; snd("boom", { pan: panOf(st.x) });
}

// ================================================================ ciclo día/noche, reloj
let hemiBase = 0.6, flick = 1;
function updateSkyClock() {
  const d = new Date(), hr = d.getHours() + d.getMinutes() / 60, f = clamp(Math.sin(((hr - 6) / 12) * Math.PI) * 1.4, 0, 1);
  paintSky(f); hemiBase = FX.adjHemi(0.38 + 0.4 * f); sun.intensity = FX.adjSun(0.55 + 1.3 * f); sun.color.set(FX.sunColor(f < 0.4 ? "#ff9a6a" : "#ffd7a0")); paintClock();
}
updateSkyClock(); skyReady = true; setInterval(updateSkyClock, 30000);

// ================================================================ datos (agentes reales + figurantes)
const slots = new Map(); let seen = new Set(), whipSeq = null, first = true, realWorking = false;
const AMB_ROLES = ["implementer", "reviewer", "tester", "architect", "docs", "debugger", "security-auditor", "refactorer"], AMB_WEIGHTS = [["working", 50], ["idle", 30], ["done", 10], ["failed", 6], ["quota", 4]], amb = [];
function ambState() { let r = Math.random() * 100; for (const [s, w] of AMB_WEIGHTS) if ((r -= w) < 0) return s; return "idle"; }
function withAmbient(real) {
  if (real.some((w) => w.state === "working" || String(w.id).startsWith("sw:"))) return real; // con un enjambre vivo o un agente trabajando NO hay figurantes: todo lo que se ve es real
  const need = Math.max(0, AMB_N - real.length), now = Date.now(), out = [];
  for (let i = 0; i < need; i++) { const a = (amb[i] = amb[i] || { id: "amb:" + i, state: "idle", until: 0, role: AMB_ROLES[i % AMB_ROLES.length] }); if (now > a.until) { a.state = ambState(); a.until = now + 8000 + Math.random() * 14000; a.act = pick(["write", "write", "read", "run", "think", "wait"]); } out.push({ id: a.id, state: a.state, role: a.role, task: "", since: 0, ambient: true, act: a.act }); }
  return real.concat(out);
}
const roleLabel = (w) => w.role || (String(w.id).startsWith("run:") ? "agente " + String(w.id).slice(-4) : "agente"); // sin rol: se distingue por el final de su id real
function uniqueName(st, id) { // apodo de la mesa: nunca el mismo que otro agente presente
  const used = new Set(stations.filter((x) => x !== st && x.state !== "vacant").map((x) => x.actor.name)); const i = hash(id) % NAMES.length;
  for (let k = 0; k < NAMES.length; k++) { const n = NAMES[(i + k) % NAMES.length]; if (!used.has(n)) return n; } return NAMES[i];
}
function setStation(st, w) {
  if (!w) { // vacante: silla retirada, sin personaje
    st.id = null; st.state = "vacant"; st.ambient = false; st.actor.g.visible = false; st.actor.path = []; st.actor.busy = false; st.carton.visible = false; st.chair.rotation.y = 0.5; st.chair.position.z = st.seatZ + 0.35;
    setProp(st, null); st.label.show(false); drawScreen(st, 0); drawPlate(st, "VACANTE", "");
    st.tube.visible = false; st.scorch.visible = false; st.burned = st.extinguished = false; st.boomAt = 0; st.responder = null; st.zzz.visible = false; { const v = st.actor; v.paper.visible = v.ext.visible = false; v.gest = null; v.dozing = false; v.celeb = null; v.panic = 0; v.spot = null; if (v.singed) setSinged(v, false); } st.boom.t = -1; st.boom.pts.visible = st.boom.flash.visible = false; Object.values(st.fx).forEach((f) => (f.pts.visible = false)); return;
  }
  const a = st.actor, isNew = st.id !== w.id, style = roleStyle(w.role), rl = roleLabel(w);
  st.ambient = !!w.ambient; st.title = rl; st.waiting = !!w.waiting; st.stale = !!w.stale;
  if (isNew || st.role !== w.role) { // el rol define la ropa, los accesorios y lo que hay sobre la mesa
    const look = lookFor(w.id); look.shirt = style.shirt; recolor(a, look); setAcc(a.p, style.acc); setProp(st, style.prop); st.role = w.role;
    st.label.setBadge(style.icon, STATE_COLOR[w.state] || "#8b94a7", w.ambient); if (!isNew) drawPlate(st, rl, a.name);
  }
  if (isNew) { st.id = w.id; a.name = uniqueName(st, w.id); drawPlate(st, rl, a.name); st.chair.rotation.y = 0; st.chair.position.z = st.seatZ; a.busy = false; a.breakAt = nowS() + 6 + Math.random() * 12; sitAt(a, st);
    a.pers = PERSONAS[hash(w.id) % PERSONAS.length]; a.workedFor = w.state === "working" && w.since > 1e9 ? clamp(Date.now() / 1000 - w.since, 0, 3600) : 0; a.gest = null; a.dozing = false; a.idleFor = 0; a.celeb = null; a.panic = 0; a.spot = null; if (a.singed) setSinged(a, false); st.burned = st.extinguished = false; st.boomAt = 0; st.responder = null; }
  st.label.mode = w.ambient ? "badge" : "tag"; st.label.show(true); st.tube.visible = true;
  { // qué hace ahora y quién es: etiqueta con el rol real y la actividad (por defecto SOLO la categoría; el detalle exige ?reveal=1)
    const prevAct = st.act, ak = w.state === "working" ? w.act || "write" : w.waiting ? "wait" : "", A = ACT[ak];
    st.act = a.act = ak;
    if (!w.ambient) st.label.setTag({ role: rl, icon: style.icon, color: STATE_COLOR[w.state] || "#8b94a7", line: REVEAL && w.detail && ak && !w.waiting ? w.detail : A ? A[1] : w.stale ? "sin actividad reciente" : STATE_TXT[w.state] || w.state, lineIcon: A ? A[0] : w.stale ? "💤" : STATE_ICON[w.state] || "", compact: w.state !== "working" && !w.waiting });
    if (ak !== (prevAct || "")) { drawScreen(st, nowS()); if (ak && prevAct && !first && !w.ambient && nowS() - (st.actLog ?? -99) > 15) { st.actLog = nowS(); termLog(`${hhmmss()} [${rl}] ${A[1]}`); } }
  }
  if (isNew || st.state !== w.state) {
    const prev = st.state; st.state = a.state = w.state;
    if (w.state !== "failed") { if (st.burned || a.singed || st.boomAt) { st.burned = st.extinguished = false; st.boomAt = 0; st.responder = null; a.panic = 0; if (a.singed) setSinged(a, false); } st.scorch.visible = false; }
    else if (first) { st.burned = true; st.extinguished = false; st.scorch.visible = true; setSinged(a, true); } // al cargar la página no explota nada
    else { st.burned = st.extinguished = false; st.responder = null; st.scorch.visible = false; st.boomAt = nowS() + 1.7; a.panic = 1.8; sayAt(st, pick(PANIC), 3, 1600); snd("alarm", { pan: panOf(st.x) }); } // si la IA falla: pánico y, enseguida, el escritorio explota
    if (w.state === "done" && !first) { a.celeb = { kind: pick(["fist", "dance", "spin"]), t: 0, dur: 3 }; snd("ding", { pan: panOf(st.x) }); deliver(st); }
    if (w.state !== "idle") a.dozing = false;
    if (!first && !w.ambient && prev !== w.state) termLog(`${hhmmss()} [${a.name || "agente"} · ${rl}] ${w.state === "failed" ? "alucina… huele a quemado" : STATE_TXT[w.state] || w.state}`, w.state === "failed" ? "err" : w.state === "done" ? "ok" : ""); st.carton.visible = w.state === "stopped"; a.g.visible = w.state !== "stopped";
    if (a.mode !== "seated" && w.state !== "idle" && !a.busy) sitAt(a, st);
    st.label.setBadge(w.state === "stopped" ? "📦" : style.icon, STATE_COLOR[w.state] || "#8b94a7", w.ambient || w.state === "stopped"); sayAt(st, pick(LINES[w.state] || LINES.idle), 2); drawScreen(st, nowS());
  }
}
function recolor(a, look) { // los materiales se comparten por color: se reasigna cada pieza a otro material en caché (sin teñir a los demás)
  const old = a.look, map = { shirt: look.shirt, hair: look.hair, skin: look.skin };
  a.p.g.traverse((o) => { if (!o.isMesh) return; if (o.userData.baked) { paintBaked(o, map); return; } const c = "#" + o.material.color.getHexString(); for (const k of ["shirt", "hair", "skin"]) if (old[k].toLowerCase() === c) { o.material = mat(map[k]); break; } });
  a.look = { ...a.look, ...map };
}
let dataLock = false; // solo para pruebas: congela los datos entrantes
function applyWorkers(workers, stats, force = false) {
  if (dataLock && !force) return;
  const ids = new Set(workers.map((w) => w.id));
  for (const [id, i] of [...slots]) if (!ids.has(id)) { slots.delete(id); setStation(stations[i], null); }
  const news = [];
  for (const w of workers) {
    if (!slots.has(w.id)) { const used = new Set(slots.values()), free = stations.findIndex((_, i) => !used.has(i)); if (free < 0) continue; slots.set(w.id, free); if (!seen.has(w.id)) { seen.add(w.id); news.push({ w, st: stations[free] }); } }
    setStation(stations[slots.get(w.id)], w);
  }
  if (!first) news.filter((x) => x.w.state === "working" && !x.w.ambient).forEach(({ w, st }) => { queueWhip("crack", st); if (REVEAL && w.task) setTimeout(() => speak("EL JEFE", "¡" + w.task + "!", "😠", 4500), 900); });
  paintTV(stats); setPapers(stats.tokens_today || 0);
}
async function poll() {
  try {
    const d = await (await fetch("/api/office", { cache: "no-store" })).json();
    if (whipSeq !== null && d.whip.seq !== whipSeq) queueWhip(d.whip.kind, null);
    whipSeq = d.whip.seq; realWorking = d.workers.some((w) => w.state === "working");
    applyWorkers(withAmbient(d.workers), d.stats); onMsgs(d.msgs); onFx(d); if (!STYLE_Q && d.style) FX.setStyle(d.style); first = false;
  } catch (e) { /* servicio caído: se reintenta */ }
}
const DEMO_ACTS = ["write", "read", "run", "think", "coordinate", "wait", "browse"], DEMO_DETAIL = ["write_file: src/app.js", "view_file: README.md", "run_command: npm test", "", "swarm: post_message", "swarm_wait", "read_url_content: docs"];
function demo() {
  const states = ["working", "working", "idle", "done", "failed", "working", "quota", "stopped"], roles = ["implementer", "reviewer", "tester", "architect", "docs", "coordinator", "debugger", "security-auditor"]; let tick = 0;
  const run = () => { const ws = states.map((_, i) => ({ id: "demo" + i, state: states[(i + Math.floor(tick / 3)) % states.length], role: roles[i], task: "tarea de ejemplo " + (i + 1), since: 0, act: DEMO_ACTS[(i + tick) % DEMO_ACTS.length], detail: DEMO_DETAIL[(i + tick) % DEMO_ACTS.length] })); applyWorkers(ws, { working: ws.filter((w) => w.state === "working").length, done_today: 12 + tick, failed_today: 2, whips: 7 + tick, tokens_today: 3200000 + tick * 380000 }); if (tick % 2 === 1 && !dataLock) queueWhip(tick % 6 === 5 ? "all" : "crack", pick(stations)); first = false; tick++; };
  run(); setTimeout(() => queueWhip("crack", stations[1]), 1500); setInterval(run, 9000);
  setInterval(() => { const occ = stations.filter((s) => s.state !== "vacant" && s.state !== "stopped"); if (occ.length > 1) { const x = pick(occ); let y = pick(occ); while (y === x) y = pick(occ); spawnPlane(x, y); } }, 4200); // mensajes de ensayo
}
stations.forEach((st) => setStation(st, null)); // todo vacío hasta que lleguen los datos
if (DEMO) demo(); else { poll(); setInterval(poll, 1000); }
setInterval(() => { // el jefe refunfuña; sin trabajo real, azota a algún figurante
  if (!bossBusy && Math.random() < 0.4) { const line = stations.some((s) => s.state === "working") ? pick(BOSS) : pick(BOSS_EMPTY); speak("EL JEFE", line, "😠"); }
}, 11000);
if (!DEMO && AMB_N > 0) setInterval(() => { if (!realWorking && !bossBusy && Math.random() < 0.55) { const t = stations.filter((s) => s.state !== "vacant"); if (t.length) queueWhip("crack", pick(t)); } }, 24000);

// ================================================================ interacción: seleccionar, ficha, acciones y efectos (teatrales) del servidor
const OPER = CONTROL, REAL_DETAIL = OPER || REVEAL, GL = $("#gl"), isRealId = (id) => /^(run|sw):/.test(id || "");
const postJ = (p, b) => fetch(p, { method: "POST", headers: { "X-Ant": "1", "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }));
const SEL = { st: null, hover: null, d: null, form: null, confirm: false, msg: "", real: (() => { try { return localStorage.getItem("ant:boss-real") === "1"; } catch (e) { return false; } })(), boss: null }, insp = $("#insp");
const hitMat = new THREE.MeshBasicMaterial({ visible: false });
stations.forEach((st) => { st.hit = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.9, 1.5), hitMat); st.hit.position.set(0, -50, 0); scene.add(st.hit); });
const ringGeo = new THREE.RingGeometry(0.72, 0.9, 40), ringMat = (op) => new THREE.MeshBasicMaterial({ color: "#6dff9a", transparent: true, opacity: op, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
const RING_H = new THREE.Mesh(ringGeo, ringMat(0.4)), RING_S = new THREE.Mesh(ringGeo, ringMat(0.9));
for (const r of [RING_H, RING_S]) { r.rotation.x = -Math.PI / 2; r.visible = false; scene.add(r); }
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pickAt(cx, cy) {
  const r = GL.getBoundingClientRect(); ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(stations.filter((x) => x.state !== "vacant").map((x) => x.hit), false)[0]; return h ? stations.find((x) => x.hit === h.object) : null;
}
function screenPosOf(st) { const v = new THREE.Vector3(st.actor.g.position.x, 1.3, st.actor.g.position.z).project(camera), r = GL.getBoundingClientRect(); return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height }; }
const resetCam = () => { CAM.uYaw = CAM.uPitch = 0; CAM.uZoom = 1; CAM.manualUntil = 0; };
function select(st) { if (!st || st.state === "vacant") return; SEL.st = st; SEL.d = null; SEL.form = null; SEL.confirm = false; SEL.boss = null; SEL.msg = ""; CAM.focus = { obj: st.actor.g, dy: 1.1 }; CAM.pinned = true; CAM.manualUntil = 0; renderInsp(); fetchInsp(); }
function deselect() { SEL.st = null; SEL.form = null; CAM.pinned = false; CAM.focus = null; CAM.prio = 0; if (insp) insp.hidden = true; RING_S.visible = false; }
function cycle(dir) { const occ = stations.filter((x) => x.state !== "vacant"); if (!occ.length) return; const i = occ.indexOf(SEL.st); select(occ[(i + dir + occ.length) % occ.length]); }
if (INTERACT) {
  let down = null;
  GL.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, moved: false, yaw: CAM.uYaw, pit: CAM.uPitch }; try { GL.setPointerCapture(e.pointerId); } catch (x) { /* sin captura */ } });
  GL.addEventListener("pointermove", (e) => {
    if (down) { const dx = e.clientX - down.x, dy = e.clientY - down.y; if (!down.moved && Math.hypot(dx, dy) > 5) { down.moved = true; GL.classList.add("drag"); }
      if (down.moved) { CAM.uYaw = down.yaw - dx * 0.006; CAM.uPitch = clamp(down.pit + dy * 0.004, -0.5, 0.6); CAM.manualUntil = performance.now() + 25000; } return; }
    SEL.hover = pickAt(e.clientX, e.clientY); GL.classList.toggle("over", !!SEL.hover);
  });
  GL.addEventListener("pointerup", (e) => { const d = down; down = null; GL.classList.remove("drag"); if (!d || d.moved) return; const st = pickAt(e.clientX, e.clientY); if (st) select(st); else if (SEL.st) deselect(); });
  GL.addEventListener("wheel", (e) => { e.preventDefault(); CAM.uZoom = clamp(CAM.uZoom * Math.exp(e.deltaY * 0.0012), 0.35, 1.6); CAM.manualUntil = performance.now() + 25000; }, { passive: false });
  GL.addEventListener("dblclick", () => { resetCam(); deselect(); });
  addEventListener("keydown", (e) => {
    if (e.target.matches?.("input,textarea,select") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape") { resetCam(); deselect(); } else if (e.key >= "1" && e.key <= "8") select(stations[+e.key - 1]); else if (e.key === "Tab") { e.preventDefault(); cycle(e.shiftKey ? -1 : 1); } else if (e.key === "0") resetCam();
  });
}
function updateRings(t) {
  const sl = SEL.st, hv = SEL.hover; RING_S.visible = !!sl && sl.state !== "vacant";
  if (RING_S.visible) { const p = sl.actor.g.position, k = 1 + Math.sin(t * 4) * 0.06; RING_S.position.set(p.x, 0.04, p.z); RING_S.scale.set(k, k, k); }
  RING_H.visible = !!hv && hv !== sl && hv.state !== "vacant"; if (RING_H.visible) { const p = hv.actor.g.position; RING_H.position.set(p.x, 0.04, p.z); }
}
// ---- ficha del agente (estilo terminal; solo el operador ve los datos reales)
const E = (tag, o = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(o)) { if (k === "class") e.className = v; else if (k.startsWith("on")) e[k] = v; else if (v === true) e.setAttribute(k, ""); else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c); return e; };
const fDur = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); return h ? `${h} h ${m} min` : m ? `${m} min ${String(sec % 60).padStart(2, "0")} s` : `${sec} s`; };
const FX_WORD = { whip: "!látigo", coffee: "!café", praise: "!aplaudir", scold: "!regañar", focus: "!cámara" };
async function fetchInsp() {
  const st = SEL.st; if (!st) return; const id = st.id;
  if (!isRealId(id)) { SEL.d = { id, local: true }; renderInsp(); return; }
  try { const r = await fetch("/api/office/agent?id=" + encodeURIComponent(id), { cache: "no-store" }), d = await r.json(); if (SEL.st === st) { SEL.d = r.ok ? d : { id, error: d.error || "No se pudo leer el agente." }; if (!SEL.form) renderInsp(); } } catch (e) { /* servicio caído */ }
}
setInterval(() => { if (SEL.st && !SEL.form) fetchInsp(); }, 1500);
function renderInsp() {
  const st = SEL.st; if (!insp) return; if (!st) { insp.hidden = true; return; }
  insp.hidden = false; const d = SEL.d || {}, can = d.can || {}, rows = [], row = (k, v, cls = "") => rows.push(E("div", {}, E("span", { class: "k" }, k), E("span", { class: "v " + cls }, v)));
  const A = ACT[d.act] || null;
  if (d.local) rows.push(E("div", { class: "dim" }, st.ambient ? "Figurante: no es un agente real, solo ambienta la oficina." : "Agente de ejemplo (modo demo)."));
  else if (d.error) rows.push(E("div", { class: "bad" }, d.error));
  else if (!d.kind) rows.push(E("div", { class: "dim" }, "Cargando…"));
  else {
    row("modelo", d.model || "—"); row("estado", STATE_TXT[st.state] || d.status);
    if (d.started) row("hace", fDur(d.now - d.started));
    row("tokens", d.tokens ? `${fmt(d.tokens)}${d.tokens_in ? ` (ent ${fmt(d.tokens_in)} · sal ${fmt(d.tokens_out)})` : ""}` : "—"); row("pasos", String(d.steps || 0));
    if (d.budget) { const p = clamp(d.tokens / d.budget, 0, 1), n = Math.round(p * 20); row("presup.", `${"█".repeat(n)}${"░".repeat(20 - n)} ${Math.round(p * 100)}% de ${fmt(d.budget)}`, p > 0.85 ? "warn" : ""); }
    row("ahora", `${A ? A[0] + " " + A[1] : d.status}${REAL_DETAIL && d.activity ? " — " + d.activity.slice(0, 80) : ""}`);
    if (REAL_DETAIL && d.ws_name) row("carpeta", d.ws_name); if (REAL_DETAIL && d.swarm_title) row("enjambre", d.swarm_title);
    if (REAL_DETAIL && d.last_message) row("último", "“" + d.last_message.replace(/\s+/g, " ").slice(0, 150) + "”", "dim");
    if (d.pending_message) row("recado", "⏳ en cola: se enviará cuando termine su turno", "warn");
  }
  const B = (a, label, cls = "") => { const c = can[a], dis = !!(d.local || d.error || !c || !c.ok); return E("button", { class: "t " + cls, disabled: dis, "data-a": a, title: dis ? (c && c.why) || "No disponible para este agente." : (c && c.note) || "", onclick: () => doAct(a) }, label); };
  const F = (k, label) => E("button", { class: "t", "data-fx": k, onclick: () => doFx(k) }, label);
  const real = d.kind && !d.error, acts = [];
  acts.push(E("div", { class: "acts" }, B("stop", "despedir", "red"), B("resume", "reanudar"), B("rerun", "reintentar"), B("bonus", "+50k tokens"), B("message", "recado"), B("task", "nueva tarea"), real && d.run ? E("a", { class: "t", href: `/#/runs/${d.run}`, target: "_blank", rel: "noopener" }, "abrir en Ant") : null));
  if (SEL.confirm) acts.push(E("div", { class: "acts" }, E("span", { class: "warn" }, `¿Despedirlo?${d.kind === "swarm" ? " (detiene todo el enjambre)" : ""}`), E("button", { class: "t red", "data-a": "stop-yes", onclick: () => doAct("stop-yes") }, "sí"), E("button", { class: "t", onclick: () => { SEL.confirm = false; renderInsp(); } }, "no")));
  acts.push(E("div", { class: "acts" }, F("whip", "látigo"), F("coffee", "café"), F("praise", "felicitar"), F("scold", "regañar"), E("button", { class: "t", "data-a": "close", onclick: () => deselect() }, "cerrar")));
  if (OPER && real && isRealId(st.id)) acts.push(E("div", { class: "acts" }, E("button", { class: "t" + (SEL.real ? " red" : ""), "data-a": "real", "aria-pressed": String(SEL.real), title: "Si lo activas, felicitar da un bono de tokens y regañar deja un recado en cola. Siempre pide confirmación.", onclick: () => { SEL.real = !SEL.real; SEL.boss = null; try { localStorage.setItem("ant:boss-real", SEL.real ? "1" : "0"); } catch (e) { /* sin almacenamiento */ } renderInsp(); } }, SEL.real ? "efecto real: SÍ" : "efecto real: no"),
    E("span", { class: "dim" }, SEL.real ? "felicitar = +50k tokens · regañar = recado en cola (pide confirmación)" : "felicitar y regañar son solo teatro")));
  if (SEL.boss) { const k = SEL.boss; acts.push(E("form", { class: "bossform", onsubmit: (e) => { e.preventDefault(); bossGo(k, e.target.querySelector("input")?.value || ""); } },
    E("span", { class: "warn" }, k === "praise" ? "¿Felicitar y darle +50k tokens de presupuesto?" : "¿Regañarlo y dejarle un recado en cola?"),
    k === "scold" ? E("input", { type: "text", maxlength: "300", autocomplete: "off", value: "no estoy contento con tu rendimiento: revisa tu trabajo con más cuidado y no repitas pasos.", "aria-label": "Texto del recado" }) : null,
    E("button", { class: "t red", type: "submit", "data-a": "boss-yes" }, "sí"), E("button", { class: "t", type: "button", "data-a": "boss-no", onclick: () => { SEL.boss = null; renderInsp(); } }, "no"))); }
  if (SEL.form) acts.push(E("form", { onsubmit: (e) => { e.preventDefault(); const v = e.target.querySelector("input").value.trim(); if (v) submitForm(v); } },
    E("input", { type: "text", maxlength: "2000", autocomplete: "off", placeholder: SEL.form === "message" ? "recado para este agente…" : `tarea nueva${d.kind === "run" && d.role ? " con el rol " + d.role : ""}…` }), E("button", { class: "t", type: "submit" }, "enviar"), E("button", { class: "t", type: "button", onclick: () => { SEL.form = null; renderInsp(); } }, "cancelar")));
  insp.replaceChildren(E("h3", { style: `color:${STATE_COLOR[st.state] || "#b8ffd0"}` }, `${(st.title || "agente").toUpperCase()}`, E("span", { class: "dim" }, `  ${STATE_ICON[st.state] || ""} ${STATE_TXT[st.state] || st.state}`)), ...rows, ...acts, E("div", { class: "msg", role: "status" }, SEL.msg));
}
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + " M" : n >= 1e3 ? Math.round(n / 1e3) + " k" : String(n));
async function bossGo(k, text) { // felicitar / regañar: teatro siempre; efecto real solo si el operador lo activó y lo confirma
  const st = SEL.st; if (!st) return; const real = !!(SEL.boss && OPER && SEL.real); SEL.boss = null;
  const r = await postJ("/api/office/boss", { kind: k, target: st.id, real, text: text || undefined, tokens: 50000 }); poll();
  const rr = r.d && r.d.real; SEL.msg = !r.ok ? "✗ " + ((r.d && r.d.error) || "Error") : rr ? (rr.ok ? (rr.action === "bonus" ? `+${Math.round(rr.tokens / 1000)}k tokens: presupuesto ${fmt(rr.token_budget || 0)}.` : rr.queued ? "⏳ Regañado: recado en cola (se enviará al terminar su turno)." : "Regañado: recado enviado.") : "Solo teatro: " + rr.error) : { praise: "El jefe va a felicitarle.", scold: "El jefe va a regañarle." }[k]; renderInsp(); if (rr && rr.ok) fetchInsp();
}
async function doFx(k) { const st = SEL.st; if (!st) return;
  if ((k === "praise" || k === "scold") && isRealId(st.id)) { if (OPER && SEL.real) { SEL.boss = k; SEL.msg = ""; renderInsp(); return; } return bossGo(k, ""); }
  /* sin efecto real no hay nada que confirmar */ if (isRealId(st.id)) { await postJ("/api/office/fx", { kind: k, target: st.id }); poll(); } else applyFx({ kind: k, target: st.id }); SEL.msg = { whip: "¡Látigo!", coffee: "¡Café gratis!", praise: "El jefe va a felicitarle.", scold: "El jefe va a regañarle." }[k] || ""; renderInsp(); }
async function doAct(a) {
  const d = SEL.d || {}, say = (t) => { SEL.msg = t; renderInsp(); };
  if (a === "stop") { SEL.confirm = true; return renderInsp(); }
  if (a === "message" || a === "task") { SEL.form = a; SEL.confirm = false; renderInsp(); insp.querySelector("input")?.focus(); return; }
  SEL.confirm = false; const path = { "stop-yes": "/api/run/stop", resume: "/api/run/resume", rerun: "/api/run/rerun", bonus: "/api/run/bonus" }[a]; if (!path) return;
  const r = await postJ(path, a === "bonus" ? { id: d.run, tokens: 50000 } : { id: d.run });
  say(r.ok ? { "stop-yes": "Despedido: ejecución detenida.", resume: "Reanudado en una ejecución nueva.", rerun: "Relanzado.", bonus: `+50 k tokens: presupuesto ${fmt(r.d.token_budget || 0)}.` }[a] : "✗ " + (r.d.error || "Error")); if (r.ok) fetchInsp();
}
async function submitForm(txt) {
  const d = SEL.d || {}, kind = SEL.form; SEL.form = null; let r;
  if (kind === "message") { r = await postJ("/api/run/message", { id: d.run, text: txt, to: d.role }); SEL.msg = r.ok ? (r.d.queued ? "⏳ Recado en cola: se enviará cuando termine su turno." : "Recado enviado: continúa su conversación.") : "✗ " + (r.d.error || "Error"); }
  else {
    const path = d.ws || $("#cws")?.value; r = await postJ("/api/run", { path, prompt: txt, role: d.kind === "run" ? d.role : undefined, auto: false, isolation: "worktree", mode: "accept-edits", allow_commands: true, token_budget: 150000 });
    if (!r.ok && /Rol desconocido/.test(r.d.error || "")) r = await postJ("/api/run", { path, prompt: txt, auto: true }); // el rol del agente no es un rol de Ant: que decida el orquestador
    SEL.msg = r.ok ? "Tarea lanzada: aparecerá como un agente nuevo." : "✗ " + (r.d.error || "Error");
  }
  renderInsp(); if (r.ok) fetchInsp();
}
// ---- efectos que llegan del servidor (operador, comandos del público): látigo dirigido, café, aplauso, bronca, cámara
function coffeeFor(st) { const a = st.actor; if (st.state === "vacant") return; a.perk = 7; a.dozing = false; a.gest = { name: "sip", t: 0, dur: GEST.sip.dur }; sayAt(st, "¡Café gratis! ☕", 3, 2600); snd("pour", { pan: panOf(st.x) }); }
function applyFx(e) {
  const st = e.target && e.target !== "all" && slots.has(e.target) ? stations[slots.get(e.target)] : null;
  if (e.user) snd("blip");
  if (e.user) termLog(`${hhmmss()} [chat] ${e.user}: ${FX_WORD[e.kind] || e.kind}${st ? " → " + (st.title || "agente") : e.target === "all" ? " → todos" : ""}`, "chat");
  if (e.kind === "whip") queueWhip(e.target === "all" ? "all" : "crack", st);
  else if (!st) return;
  else if (e.kind === "coffee") coffeeFor(st);
  else if (e.kind === "praise" || e.kind === "scold") queueWhip(e.kind, st);
  else if (e.kind === "focus") direct(3, { obj: st.actor.g, dy: 1.1 }, 5);
}
let fxSeq = null;
function onFx(d) { if (fxSeq === null) { fxSeq = d.fx_seq || 0; return; } for (const e of d.fx || []) if (e.seq > fxSeq) applyFx(e); fxSeq = Math.max(fxSeq, d.fx_seq || 0); }

// ================================================================ bucle principal
let last = performance.now(), tAcc = 0, screenT = 0, timeScale = 1, keyAcc = 0, hissAcc = 0;
function loop(now) {
  const rdt = Math.min(0.05, (now - last) / 1000); if (slowT > 0) slowT -= rdt; const dt = rdt * timeScale * (slowT > 0 ? 0.2 : 1); last = now; tAcc += dt; const t = tAcc;
  shakeAmp *= Math.pow(0.001, dt); placeCamera(t, dt);
  flick = Math.random() < 0.012 ? 0.5 : flick + (1 - flick) * Math.min(1, dt * 9); hemi.intensity = hemiBase * (0.55 + 0.45 * flick); // fluorescente moribundo
  neon.mesh.material.color.setScalar(Math.sin(t * 2.1) > 0.96 || Math.sin(t * 7.3) > 0.995 ? 0.35 : 1); onair.mesh.material.color.setScalar(Math.sin(t * 3) > 0 ? 1 : 0.45);
  move(boss, dt); pose(boss, t, dt);
  EYE.tx = clamp((boss.g.position.x - EYE.x) / 9, -1, 1); EYE.ty = 0.4; paintEye(t, dt);
  screenT += dt; const doScreens = screenT > 0.12; if (doScreens) screenT = 0;
  let working = 0, burning = null; const fcs = CAM.focus && (CAM.pinned || performance.now() < CAM.until) ? SEL.st || stations.find((x) => x.actor.g === CAM.focus.obj) || null : null; // con un agente enfocado, las etiquetas de los demás se atenúan
  for (const st of stations) {
    const a = st.actor; if (st.state === "vacant") { continue; }
    if (st.state === "working") working++; if (st.state === "failed" && st.burned && !st.extinguished && !burning) burning = st;
    if (st.boomAt && nowS() >= st.boomAt) igniteDesk(st);
    life(a, st, t, dt); move(a, dt); pose(a, t, dt); updateFx(st, t, dt);
    st.tubeTex.offset.y += dt * ((st.state === "working" ? 2.2 : st.state === "done" ? 0.8 : st.state === "idle" ? 0.25 : 0) + (a.sipping ? 3 : 0) + (a.perk > 0 ? 5 : 0)); st.tubeMat.color.set(st.state === "failed" ? "#ff7a5a" : a.perk > 0 ? "#ffd9a0" : "#ffffff");
    if (doScreens && (st.state === "working" || st.state === "idle" || (st.state === "failed" && !st.burned))) drawScreen(st, t);
    if (st.state === "idle" && a.mode === "seated" && !a.busy && !a.dozing && !st.waiting && t > a.breakAt && !DEMO) wander(st);
    const hy = 2.75 - 0.46 * a.sitCur, wp = a.g.position, L = st.label; L.badge.position.set(wp.x, hy, wp.z); L.tag.position.set(wp.x, hy + 0.6, wp.z); L.bub.position.set(wp.x, hy + (L.mode === "tag" ? 1.75 : 1.0), wp.z); [L.x, L.y] = screenOf(L.badge.position);
    if (st.zzz.visible) st.zzz.position.set(wp.x + 0.35, 2.05 + ((t * 0.35) % 1) * 0.5, wp.z);
    st.hit.position.set(wp.x, 1.3, wp.z); { const o = fcs && st !== fcs ? 0.28 : 1; if (L.tag.material.opacity !== o) { L.tag.material.opacity = o; L.badge.material.opacity = o; } }
  }
  updateRings(t); if (SEL.st && SEL.st.state === "vacant") deselect();
  updateFoam(t); updateDrop(dt); updatePlanes(dt); visitT -= dt; if (visitT <= 0) { visitT = 24 + Math.random() * 18; tryVisit(); }
  if (burning) { fireLight.position.set(burning.x - 0.2, 1.4, burning.deskZ); fireLight.intensity = 26 * (0.7 + 0.3 * Math.random()); } else fireLight.intensity = 0;
  updateFall(t, clamp(30 + Math.round(PAPERS.tokens / 8e6 * 70) + working * 10, 30, FALL_N));
  updateWhip(dt); updateSlash(dt); updateBurst(dt);
  if (SOUND) { keyAcc += dt * working * 2.4; while (keyAcc >= 1) { keyAcc -= 1; snd("keys", { pan: (Math.random() - 0.5) * 1.2 }); } if (burning && Math.random() < dt * 7) snd("crackle", { pan: panOf(burning.x) }); if (SND.hum) SND.hum.gain.value = 0.012 * flick; } FX.update(t, dt); FX.render(t); requestAnimationFrame(loop);
}
if (STYLE_Q && STYLES.includes(STYLE_Q)) FX.setStyle(STYLE_Q); // con la escena ya construida
else fetch("/api/office/style", { cache: "no-store" }).then((r) => r.json()).then((j) => FX.setStyle(j.style)).catch(() => 0);
requestAnimationFrame(loop);

// ================================================================ barra de control del jefe (?control=1)
if (CONTROL) {
  const f = $("#ctl"); f.hidden = false;
  const msg = (t) => { $("#cmsg").textContent = t; setTimeout(() => ($("#cmsg").textContent = ""), 4000); };
  const post = (p, b) => fetch(p, { method: "POST", headers: { "X-Ant": "1", "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => ({ ok: r.ok, d: await r.json() }));
  (async () => {
    const ws = await fetch("/api/workspaces").then((r) => r.json());
    const list = ws.workspaces.filter((w) => w.exists).sort((a, b) => Number(b.has_git) - Number(a.has_git));
    $("#cws").replaceChildren(...list.map((w) => new Option(w.name + (w.has_git ? "" : " (sin git)"), w.path)));
  })();
  f.addEventListener("submit", async (e) => {
    e.preventDefault(); const prompt = $("#ctask").value.trim(); if (!prompt) return;
    const r = await post("/api/run", { path: $("#cws").value, prompt, auto: true }); // el orquestador de Ant planifica: rol, modelo, presupuesto
    if (r.ok) { $("#ctask").value = ""; const p = r.d.plan; msg("Orden enviada" + (p ? ` · ${p.topology === "swarm" ? "enjambre" : "1 agente"} · ≈${Math.round((p.tokens?.estimate || 0) / 1000)} k tokens` : "")); }
    else if (r.d.needs) msg(r.d.needs === "heavy" ? "Plan caro: confírmalo desde Ant (Lanzador)" : "Tarea repetida: confírmala desde Ant");
    else msg(r.d.error || "Error");
  });
  $("#cwhip").onclick = () => post("/api/office/whip", { kind: "crack" }); $("#cwhipall").onclick = () => post("/api/office/whip", { kind: "all" });
  const sndBtn = $("#csnd"), sndTxt = () => (sndBtn.textContent = "🔊 Sonido: " + (SOUND ? "sí" : "no")); sndTxt(); sndBtn.onclick = () => { setSound(!SOUND); sndTxt(); };
  const camBtn = $("#ccam"), camTxt = () => (camBtn.textContent = "🎥 Cámara auto: " + (DIRECTOR_ON ? "sí" : "no")); camTxt(); camBtn.onclick = () => { DIRECTOR_ON = !DIRECTOR_ON; if (!DIRECTOR_ON && !CAM.pinned) CAM.focus = null; camTxt(); };
  const chatSt = async () => { try { const c = await (await fetch("/api/office/chat")).json(); $("#cchat").textContent = c.twitch.channel ? `chat de Twitch #${c.twitch.channel}: ${c.twitch.connected ? "conectado ✓" : "desconectado ✗"}` : "chat del público: sin canal (ANT_TWITCH_CHANNEL)"; } catch (e) { /* sin servicio */ } };
  chatSt(); setInterval(chatSt, 8000);
}
const sampleFrame = () => { // prueba: renderiza un fotograma y mide su aspecto (colores distintos, contornos, neón…)
  FX.render(tAcc); const gl = renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const seen = new Set(); let dark = 0, mag = 0, cyan = 0, bright = 0, sr = 0, sg = 0, sb = 0; const n = w * h;
  for (let i = 0; i < buf.length; i += 4) { const r = buf[i], g = buf[i + 1], b = buf[i + 2], l = 0.2126 * r + 0.7152 * g + 0.0722 * b; seen.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)); if (l < 14) dark++; if (r > 150 && b > 120 && g < 110) mag++; if (g > 140 && b > 150 && r < 110) cyan++; if (l > 200) bright++; sr += r; sg += g; sb += b; }
  return { w, h, unique: seen.size, dark: dark / n, magenta: mag / n, cyan: cyan / n, bright: bright / n, mean: [sr / n, sg / n, sb / n] };
};
window.__office = { renderer, scene, camera, stations, boss, queueWhip, speak, FX, style: () => FX.style, setStyle: (s) => FX.setStyle(s), sampleFrame, fxStats: () => FX.stats(), debugWhip: (w, st) => { whip.t = -1; startWhip(targetPos(st)); whip.t = w; boss.whipT = w; updateWhip(0); }, whipState: () => { let path = 0; for (let i = 1; i < WHIP_N; i++) path += whip.pts[i].distanceTo(whip.pts[i - 1]); return { straight: whip.pts[0].distanceTo(whip.pts[WHIP_N - 1]) / Math.max(1e-6, path), t: whip.t, tip: whip.pts[WHIP_N - 1].clone(), target: whip.target.clone(), n: WHIP_N, meshes: !!(whip.mA && whip.mB), log: whip.log.slice(-6), impacted: whip.impacted }; }, slowT: () => slowT, slashOn: () => SLASH.visible, snd: { log: () => [...SND.log], clear: () => (SND.log.length = 0), created: () => SND.created, enable: setSound, names: () => Object.keys(SFX), render: renderSfx, play: snd, on: () => SOUND }, WHIP_IMPACT, CAM, SEL, INTERACT, select, deselect, pickAt, screenPosOf, applyFx, direct, coffeeFor, resetCam, setDirector: (v) => (DIRECTOR_ON = !!v), fxSeq: () => fxSeq, PERSONAS, GEST, spawnPlane, planes: () => PLANES.length, tryVisit, breakTo, igniteDesk, extinguish, deliver, stackCount: () => STACK.children.length, foamOn: () => FOAM.on, setSinged, termLog, triggerBoom, setPapers, applyWorkers: (w, st) => applyWorkers(w, st, true), lockData: (v) => (dataLock = !!v), paintTV, EYE, papers: () => ({ levels: PAPERS.levels, tokens: PAPERS.tokens, count: pileMesh.count, falling: fallMesh.count }), boardState: () => lastBoard, termLines: () => [...term.children].map((e) => e.textContent), boomT: (i) => stations[i].boom.t, boomCount: (i) => stations[i].boom.count, coffeeBreak, burstActive: () => BURST.t >= 0, burstT: () => BURST.t, bubbleCount: () => SPEECH.active.length, setTimeScale: (n) => (timeScale = n), whipActive: () => whip.t >= 0, bossBusy: () => bossBusy, THREE }; // para depuración y pruebas
