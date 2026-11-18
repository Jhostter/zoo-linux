// Prueba E2E de la interfaz de Ant con Chrome real (protocolo DevTools, sin dependencias).
// Uso: node test/ui_test.mjs <url_base> <dir_capturas>
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://localhost:4590", OUT = process.argv[3] || tmpdir(), PORT = 9333;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("google-chrome", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "ant-chrome-"))}`, "--window-size=1280,900", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let pageWs, id = 0; const pending = new Map(), errors = [];
async function connect() {
  for (let i = 0; i < 60; i++) { try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { pageWs = new WebSocket(p.webSocketDebuggerUrl); break; } } catch (e) { /* aún no */ } await sleep(250); }
  await new Promise((r) => (pageWs.onopen = r));
  pageWs.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); return; }
    if (d.method === "Runtime.exceptionThrown") errors.push("EXC " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("CONSOLE " + d.params.args.map((a) => a.value ?? a.description).join(" "));
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error" && !/status of 409/.test(d.params.entry.text)) errors.push("LOG " + d.params.entry.text + " " + (d.params.entry.url || ""));
  };
  for (const m of ["Page.enable", "Runtime.enable", "Log.enable"]) await send(m);
}
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); pageWs.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) throw new Error("eval: " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result?.result?.value; };
const waitFor = async (expr, ms = 9000, what = expr) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch (e) { /* aún no */ } await sleep(120); } throw new Error("timeout esperando: " + what); };
const nav = async (hash) => { await ev(`location.hash=${JSON.stringify(hash)}`); await sleep(250); };
const load = async (path = "/") => { await send("Page.navigate", { url: BASE + path }); await sleep(600); await waitFor("document.readyState==='complete'"); };
const click = (sel) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('no existe '+${JSON.stringify(sel)});e.click();return true})()`);
const clickText = (sel, text) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.includes(${JSON.stringify(text)}));if(!e)throw new Error('no hay '+${JSON.stringify(sel + " con " + text)});e.click();return true})()`);
const setVal = (sel, v) => ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw new Error('no existe '+${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const txt = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})||{}).textContent||''`);
const closeDlg = async () => { await ev("document.querySelector('dialog[open]')?.close()"); await waitFor("document.querySelectorAll('dialog').length===0", 3000, "cerrar diálogo"); };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(OUT, name + ".png"), Buffer.from(r.result.data, "base64")); };
const viewport = (w, h, mobile = false) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
const api0 = (p, body) => ev(`fetch(${JSON.stringify(p)}, ${body ? JSON.stringify({ method: "POST", headers: { "X-Ant": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) }) : "{}"}).then(r=>r.json())`);

const api = (p, body) => api0(p, body);
const fails = []; let n = 0;
const check = (name, cond, extra = "") => { n++; console.log((cond ? "  ok  " : "FALLA ") + name + (!cond && extra ? `  [${extra}]` : "")); if (!cond) fails.push(name); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name + " (excepción)", false, e.message); } };

try {
  await connect();
  console.log("== Inicio");
  await step("inicio", async () => {
    await load("/");
    await waitFor("document.querySelectorAll('#nav a[data-id]').length===6", 6000, "nav");
    check("navegación lateral con 6 secciones (incluye Lanzamientos)", true);
    await waitFor("document.querySelector('#kpis .kpi')", 6000, "kpis");
    check("5 indicadores en Inicio (incluye tokens medidos hoy)", (await ev("document.querySelectorAll('#kpis .kpi').length")) === 5);
    check("Inicio marcado como página actual (aria-current)", (await ev("document.querySelector('#nav a[aria-current=page]').dataset.id")) === "home");
    check("caja de lanzamiento rápido con opciones de equipos y roles", (await ev("document.querySelectorAll('#main select')[0].options.length")) > 30);
    check("sin tareas escritas el botón Lanzar está desactivado", await ev("document.querySelector('.hero .btn.pri').disabled"));
    await shot("01-inicio");
  });

  console.log("== Orquestador automático (plan, ahorro y consumo)");
  await step("auto-home", async () => {
    await ev("localStorage.clear()"); await load("/"); await waitFor("document.querySelector('#kpis .kpi')", 8000, "inicio");
    check("Inicio propone 'Automático' como opción por defecto", /Automático/.test(await ev("document.querySelector('.hero select').selectedOptions[0].textContent")));
    await setVal("#q-task", "Cambia el color del botón de login a azul");
    await waitFor("/Esfuerzo/.test(document.querySelector('.hero').textContent)", 6000, "plan en Inicio");
    const hero = await txt(".hero");
    check("al escribir la tarea aparece el plan (esfuerzo, agente, modelo y estimación de tokens)", /Esfuerzo mínimo \(XS\)/.test(hero) && /Un agente/.test(hero) && /tokens/.test(hero), hero.slice(0, 260));
    check("tarea simple: NO propone enjambre y explica por qué", !/Enjambre ·/.test(hero) && /Alternativa descartada — Enjambre/.test(hero));
    await shot("00-plan-inicio");
    await click(".hero .btn.pri");
    await waitFor("location.hash.startsWith('#/runs/')", 8000, "ir a la ejecución");
    await waitFor("/terminada/.test(document.querySelector('#main .chip')?.textContent||'')", 12000, "terminada");
    await waitFor("/Consumo de tokens/.test(document.querySelector('#main').textContent)", 8000, "panel de consumo");
    const det = await txt("#main");
    check("el detalle muestra el consumo REAL medido (12,8 k) y el presupuesto", /12,8 k/.test(det) && /de .* de presupuesto/.test(det), det.slice(0, 120));
    check("compara lo real con lo estimado", /estimado ≈/.test(det));
    await shot("00b-consumo");
  });
  await step("auto-launcher", async () => {
    await nav("#/launch"); await waitFor("document.querySelector('#l-task')", 6000, "lanzador");
    check("el Lanzador arranca en modo automático", /Lanzador · automático/.test(await txt("#main h1")));
    await setVal("#l-task", "Implementa el módulo de facturación completo:\n- API de facturas y pagos\n- Pantallas de listado y detalle\n- Pruebas unitarias y e2e\n- Documentación del endpoint\n- Migración de la tabla de clientes");
    await waitFor("/Enjambre/.test(document.querySelector('.step:nth-of-type(3)')?.textContent||'')", 8000, "plan de enjambre");
    check("tarea grande de varios frentes: propone un enjambre acotado, sin monitor/narrator", /sin monitor ni narrator/.test(await txt("#main")));
    check("el plan explica sus motivos ('¿Por qué este plan?')", await ev("[...document.querySelectorAll('summary')].some(s=>s.textContent.includes('¿Por qué este plan?'))"));
    check("el botón avisa de que hay que revisar (plan caro)", /Revisar y lanzar/.test(await txt(".sticky")));
    const before = (await api("/api/runs")).runs.length;
    await click(".sticky .btn.pri");
    await waitFor("document.querySelector('dialog[open]')", 5000, "confirmación");
    check("un plan caro pide confirmación antes de gastar", /Plan costoso/.test(await txt("dialog[open]")));
    await clickText("dialog[open] button", "Cancelar"); await closeDlg().catch(() => {});
    check("cancelar NO lanza nada", (await api("/api/runs")).runs.length === before);
    await shot("00c-plan-caro");
    await clickText(".sticky button", "Ajustar a mano");
    await waitFor("/Lanzador · manual/.test(document.querySelector('#main h1')?.textContent||'')", 5000, "manual");
    check("'Ajustar a mano' lleva el plan al modo manual (equipo a medida)", /Equipo a medida/.test(await txt("#main")));
    await clickText("a.btn", "automático"); await waitFor("/automático/.test(document.querySelector('#main h1')?.textContent||'')", 4000, "volver");
    check("se puede volver al modo automático", true);
  });

  console.log("== Lanzamiento rápido → detalle de ejecución");
  let runId;
  await step("rápido", async () => {
    await nav("#/"); await waitFor("document.querySelector('#q-task')", 6000, "inicio");
    await setVal("#q-task", "Revisa el módulo de pagos");
    await setVal(".hero select:nth-of-type(1)", "role:reviewer");
    check("al escribir la tarea se activa Lanzar", !(await ev("document.querySelector('.hero .btn.pri').disabled")));
    await click(".hero .btn.pri");
    await waitFor("location.hash.startsWith('#/runs/')", 6000, "navegar a la ejecución");
    runId = (await ev("location.hash")).split("/").pop();
    check("navega al detalle de la ejecución", /^\d{8}-\d{6}-[0-9a-f]{4}$/.test(runId), runId);
    await waitFor("/terminada/.test(document.querySelector('#main .chip')?.textContent||'')", 9000, "estado terminada");
    check("estado final 'terminada'", true);
    await waitFor("document.querySelector('pre.log').textContent.includes('cwd:')", 6000, "log");
    check("la salida del agente se muestra", (await txt("pre.log")).includes("--print"));
    check("el brief del rol viaja en la tarea (Revisor)", (await txt("pre.log")).includes("Eres el revisor"));
    check("muestra el resultado en la rama (git)", /Resultado en la rama/.test(await txt("#main")));
    await shot("02-ejecucion");
    const old = runId;
    await clickText("button", "Relanzar");
    await waitFor(`location.hash.startsWith('#/runs/') && !location.hash.endsWith('${old}')`, 6000, "relanzar");
    check("Relanzar crea otra ejecución", true);
  });

  console.log("== Lanzador completo (enjambre con equipo)");
  await step("lanzador", async () => {
    await ev("localStorage.setItem('ant:launch', JSON.stringify({pilot:'manual'}))");
    await nav("#/launch");
    await waitFor("document.querySelector('#l-task')", 6000, "lanzador");
    check("el lanzador tiene 3 pasos numerados + resumen", (await ev("document.querySelectorAll('.step .n').length")) >= 3 && /Resumen/.test(await txt("#main")));
    check("sin tarea no se puede lanzar (con explicación)", await ev("document.querySelector('.sticky .btn.pri').disabled") && /Escribe la tarea/.test(await txt(".sticky")));
    await setVal("#l-task", "Migrar pagos al nuevo cliente");
    await clickText(".seg button", "enjambre");
    await waitFor("document.querySelectorAll('button.team').length===8", 4000, "equipos");
    check("modo enjambre muestra los 8 equipos", true);
    await clickText("button.team", "Migración de código");
    await waitFor("/Orden de trabajo/.test(document.querySelector('#main').textContent)", 3000, "orden de trabajo");
    const sum = await txt(".sticky");
    check("el resumen refleja equipo y Orchestrator como coordinador", /Migración de código/.test(sum) && /Orchestrator/.test(sum), sum.slice(0, 200));
    check("el resumen avisa del consumo de cuota", /cuota/i.test(sum));
    check("se aplican permisos 'comandos habituales' automáticamente", /comandos habituales/.test(sum));
    await shot("03-lanzador-enjambre");
    await click(".sticky .btn.pri");
    await waitFor("location.hash.startsWith('#/runs/')", 6000, "ir a la ejecución del enjambre");
    const rid = (await ev("location.hash")).split("/").pop();
    const run = await api("/api/run/" + rid);
    check("la ejecución guarda swarm + equipo + modelos", run.swarm && run.team === "migration-code" && run.model === "gemini-pro-orchestrator-g1-pro" && run.workers_model === "gemini-4-hydrogen-low", JSON.stringify([run.swarm, run.team, run.model]));
    await waitFor("/enjambre/.test(document.querySelector('#main .chips')?.textContent||'')", 5000, "chip enjambre");
    check("el detalle muestra que es un enjambre", true);
    await waitFor("/Migración de código|## Equipo/.test(document.querySelector('pre.log').textContent) || document.querySelector('pre.log').textContent.includes('/swarm')", 6000, "log swarm");
    check("el prompt enviado lleva /swarm y el equipo", (await txt("pre.log")).includes("/swarm Migrar pagos") && (await txt("pre.log")).includes("## Equipo: Migración de código"));
    await shot("04-ejecucion-enjambre");
  });

  console.log("== Enjambres");
  await step("enjambres", async () => {
    await nav("#/swarms");
    await waitFor("document.querySelector('a.card[href^=\"#/swarms/\"]')", 6000, "tarjeta de enjambre");
    check("lista el enjambre de ejemplo", /Migrar el módulo de pagos/.test(await txt("#main")));
    await setVal("input[type=search]", "zzz");
    check("la búsqueda sin coincidencias lo indica", await waitFor("/Ningún enjambre coincide/.test(document.querySelector('#main').textContent)", 2000).then(() => true));
    await setVal("input[type=search]", "pagos");
    await waitFor("document.querySelector('a.card[href^=\"#/swarms/\"]')", 2000, "filtrado");
    await click("a.card[href^=\"#/swarms/\"]");
    await waitFor("document.querySelectorAll('.member').length===3", 6000, "miembros");
    check("detalle: 3 agentes con estado", true);
    check("el tablero renderiza Markdown (código, negrita, menciones)", await ev("!!document.querySelector('.feed code') && !!document.querySelector('.feed strong') && !!document.querySelector('.feed .mention')"));
    check("marca los mensajes [done] y [stall]", await ev("!!document.querySelector('.feed .msg.done') && !!document.querySelector('.feed .msg.stall')"));
    check("los mensajes largos se pliegan con 'Ver más'", await ev("[...document.querySelectorAll('.feed .more')].some(b=>b.textContent==='Ver más')"));
    check("la actividad del agente muestra la herramienta en uso", /write_file|run_command|swarm/.test(await txt(".members")));
    await clickText(".pickers button", "parser");
    check("el filtro por agente reduce el tablero", (await ev("document.querySelectorAll('.feed .msg').length")) < 5 && (await ev("document.querySelectorAll('.feed .msg').length")) >= 2);
    check("el grafo SVG se dibuja", await ev("!!document.querySelector('svg.graph circle')"));
    await shot("05-enjambre-detalle");
    await clickText("button", "Pausar"); check("se puede pausar la actualización", (await ev("[...document.querySelectorAll('button[aria-pressed=true]')].some(b=>b.textContent.includes('Reanudar'))")));
  });

  console.log("== Bloqueos por permisos, enjambres que no arrancan y reanudación");
  await step("bloqueo-reanudar", async () => {
    const wsl = (await api("/api/workspaces")).workspaces, demo = wsl.find((w) => w.name === "demo-app").path;
    // 1) permiso denegado: se explica y se puede relanzar con permisos ampliados
    const b = await api("/api/run", { path: demo, prompt: "NPMBLOCK revisa el tipado", allow_commands: true, isolation: "worktree" });
    await waitFor(`/blocked|bloqueada/.test(JSON.stringify(location.hash)) || true`, 100);
    await nav("#/runs/" + b.id); await waitFor("/bloqueada por permisos/.test(document.querySelector('#main .chip')?.textContent||'')", 15000, "estado bloqueada");
    const txtB = await txt("#main");
    check("bloqueo: explica qué pasó, cuánto se perdió y NUNCA llegó a crear workers", /no tenía permitido/.test(txtB) && /se pierden/.test(txtB) && /Nunca llegó a crear workers/.test(txtB), txtB.slice(0, 200));
    check("bloqueo: muestra el comando exacto que se denegó", /npm run type-check && npm test/.test(txtB));
    check("bloqueo: ofrece relanzar permitiendo scripts del proyecto o con todos los permisos", /Relanzar permitiendo scripts del proyecto/.test(txtB) && /todos los permisos/.test(txtB));
    await shot("00d-bloqueo");
    const idB = b.id; await clickText("button", "Relanzar permitiendo scripts"); await waitFor(`location.hash.startsWith('#/runs/') && !location.hash.endsWith('${idB}')`, 8000, "relanzada");
    check("«Relanzar permitiendo scripts» crea una ejecución nueva con permisos ampliados", (await api("/api/run/" + (await ev("location.hash")).split("/").pop())).allow_dev === true);
    // 2) enjambre lanzado desde Ant que nunca llegó a existir en Antigravity
    await api("/api/run", { path: demo, prompt: "NPMBLOCK enjambre de prueba", swarm: true, roles: ["implementer", "reviewer"], allow_commands: true, isolation: "worktree" });
    await nav("#/swarms"); await waitFor("/Lanzados desde Ant que aún no tienen enjambre/.test(document.querySelector('#main').textContent)", 10000, "sección de huérfanos");
    check("Enjambres muestra los lanzados desde Ant que no arrancaron, con su motivo", /Lanzados desde Ant que aún no tienen enjambre/.test(await txt("#main")) && /permiso denegado antes de crear workers|planificando|No llegó a crear workers/.test(await txt("#main")));
    await shot("00e-enjambres-huerfanos");
    // 3) corte por presupuesto -> trabajo parcial reanudable
    const c = await api("/api/run", { path: demo, prompt: "BURN modulo grande", token_budget: 50000, isolation: "worktree" });
    await nav("#/runs/" + c.id); await waitFor("/Trabajo parcial conservado/.test(document.querySelector('#main').textContent)", 40000, "tarjeta de reanudación");
    const txtC = await txt("#main");
    check("corte por presupuesto: banner claro + tarjeta «Trabajo parcial conservado» con sus commits", /presupuesto/.test(txtC) && /1 commit/.test(txtC) && /Reanudar con un agente/.test(txtC), txtC.slice(0, 160));
    await shot("00f-reanudar");
    const idC = c.id; await clickText("button", "Reanudar con un agente"); await waitFor(`location.hash.startsWith('#/runs/') && !location.hash.endsWith('${idC}')`, 8000, "reanudada");
    await waitFor("/reanudada/.test(document.querySelector('#main').textContent)", 6000, "chip reanudada");
    check("reanudar abre una ejecución individual marcada «reanudada»", true);
  });

  console.log("== Lanzamientos (historial completo)");
  await step("lanzamientos", async () => {
    const API = (await api("/api/runs")).runs, setSearch = (v) => ev(`(()=>{const i=document.querySelector('#main input[type=search]');i.value=${JSON.stringify(v)};i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await nav("#/"); await waitFor("[...document.querySelectorAll('#main a')].some(a=>/Ver todos los lanzamientos/.test(a.textContent))", 8000, "enlace en Inicio");
    await clickText("#main a", "Ver todos los lanzamientos"); await waitFor("location.hash==='#/runs' && document.querySelectorAll('#main a.item[data-run]').length>0", 8000, "lista");
    check("Inicio enlaza a la lista completa de lanzamientos", true);
    check("el menú marca «Lanzamientos» como página actual", (await ev("document.querySelector('#nav a[aria-current=page]').dataset.id")) === "runs");
    check("la lista muestra TODOS los lanzamientos de la API, cada uno enlazando a su detalle", (await ev("document.querySelectorAll('#main a.item[data-run]').length")) === Math.min(API.length, 40) && (await ev("[...document.querySelectorAll('#main a.item[data-run]')].every(a=>a.getAttribute('href')==='#/runs/'+a.dataset.run)")));
    check("el resumen cuenta «N de N lanzamientos»", new RegExp(`${API.length} de ${API.length} lanzamientos`).test(await txt("#main")), (await txt("#main")).slice(0, 200));
    check("cada fila muestra workspace, tarea, estado, tiempo y modelo/tokens", await ev("[...document.querySelectorAll('#main a.item[data-run]')].every(a=>a.querySelector('.b')&&a.querySelector('.chip')&&a.querySelector('[data-ago]')&&a.textContent.length>40)"));
    const grp = (r) => (r.status === "running" ? "running" : r.status === "done" ? "done" : r.status === "stopped" ? "stopped" : "issues");
    const counts = await ev("[...document.querySelectorAll('#main .seg button')].map(b=>b.dataset.f+':'+b.textContent.split('·')[1].trim()).join(',')");
    const want = ["running", "done", "issues", "stopped"].map((k) => k + ":" + API.filter((r) => grp(r) === k).length);
    check("los filtros por estado cuentan bien (en marcha, terminadas, con problemas, detenidas)", want.every((w) => counts.includes(w)), counts);
    await click("#main .seg button[data-f=issues]"); await sleep(250);
    const shownIssues = await ev("[...document.querySelectorAll('#main a.item[data-run]')].map(a=>a.dataset.run)");
    check("«Con problemas» muestra solo bloqueadas, sin cuota, con presupuesto agotado, fallidas…", shownIssues.length === API.filter((r) => grp(r) === "issues").length && shownIssues.every((id) => grp(API.find((r) => r.id === id)) === "issues"), JSON.stringify(shownIssues));
    check("el filtro elegido se recuerda al volver", await (async () => { await load("/#/runs"); await waitFor("document.querySelectorAll('#main .seg button').length>0", 8000); return (await ev("document.querySelector('#main .seg button[aria-pressed=true]').dataset.f")) === "issues"; })());
    await click("#main .seg button[data-f=all]"); await sleep(200);
    await setSearch("NPMBLOCK"); await sleep(250);
    const hit = await ev("[...document.querySelectorAll('#main a.item[data-run]')].map(a=>a.dataset.run)");
    check("la búsqueda filtra por texto de la tarea", hit.length > 0 && hit.length < API.length && hit.every((id) => /NPMBLOCK/.test(API.find((r) => r.id === id).prompt)), String(hit.length));
    await setSearch("zzz-nada-que-ver"); await sleep(250);
    check("sin coincidencias se avisa", /Ningún lanzamiento coincide/.test(await txt("#main")));
    await setSearch(""); await sleep(200);
    const names = await ev("[...document.querySelectorAll('#main select option')].map(o=>o.value).filter(Boolean)");
    const one = names[0]; await ev(`(()=>{const s=document.querySelector('#main select');s.value=${JSON.stringify(one)};s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(250);
    check("el selector de workspace filtra la lista", (await ev("[...document.querySelectorAll('#main a.item[data-run]')].length")) === API.filter((r) => r.ws_name === one).length, one);
    await ev("(()=>{const s=document.querySelector('#main select');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}))})()"); await sleep(200);
    const first = await ev("document.querySelector('#main a.item[data-run]').dataset.run"); await click("#main a.item[data-run]"); await waitFor(`location.hash==='#/runs/${first}'`, 5000, "detalle");
    check("al pulsar un lanzamiento se abre su detalle", true);
    check("en el detalle, «← Lanzamientos» vuelve a la lista", await (async () => { await clickText("#main a", "← Lanzamientos"); await waitFor("location.hash==='#/runs'", 4000, "vuelta"); return true; })());
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "4", text: "4" }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "4" }); await sleep(200);
    check("atajo de teclado '4' abre Lanzamientos", (await ev("location.hash")) === "#/runs");
    await shot("00g-lanzamientos");
  });
  console.log("== Workspaces");
  await step("workspaces", async () => {
    await nav("#/workspaces");
    await waitFor("document.querySelector('table tbody tr')", 6000, "tabla");
    check("lista los 3 workspaces del entorno", (await ev("document.querySelectorAll('table tbody tr').length")) === 3);
    check("indica git / sin git", /sin git/.test(await txt("table")) && /git/.test(await txt("table")));
    await setVal("input[type=search]", "tienda");
    await waitFor("document.querySelectorAll('table tbody tr').length===1", 2000, "filtro");
    check("el buscador filtra", true);
    await clickText("button", "Añadir o crear carpeta");
    await waitFor("document.querySelector('dialog[open] input[type=text]')", 3000, "diálogo añadir");
    check("diálogo para añadir/crear carpeta", true);
    await closeDlg();
    await clickText("button", "Instalar roles");
    await waitFor("document.querySelector('dialog[open] .pickers')", 3000, "diálogo instalar");
    check("el diálogo de instalación ofrece atajos por equipo", (await ev("document.querySelectorAll('dialog .pickers button').length")) >= 8);
    await clickText("dialog .pickers button", "Rediseño UX/UI");
    check("elegir un equipo marca sólo sus roles", /6 de 2\d roles seleccionados/.test(await txt("dialog[open] .dlg-f")), await txt("dialog[open] .dlg-f"));
    await shot("06-instalar-roles");
    await closeDlg();
    await clickText("button", "Lanzar aquí");
    await waitFor("location.hash==='#/launch'", 3000, "lanzar aquí");
    await waitFor("document.querySelector('#l-ws')", 4000, "lanzador");
    check("'Lanzar aquí' abre el lanzador con ese workspace", /tienda-movil/.test(await ev("document.querySelector('#l-ws').selectedOptions[0].textContent")));
  });

  console.log("== Roles y equipos");
  await step("roles", async () => {
    await nav("#/roles");
    await waitFor("document.querySelectorAll('button.rolecard').length>20", 6000, "roles");
    check("catálogo con 25 roles", (await ev("document.querySelectorAll('button.rolecard').length")) === 25);
    check("6 categorías para filtrar", (await ev("document.querySelectorAll('.pickers button').length")) >= 7);
    await clickText(".pickers button", "Plataformas móviles");
    check("filtrar por 'Plataformas móviles' deja 3 roles", (await ev("document.querySelectorAll('button.rolecard').length")) === 3);
    await clickText(".pickers button", "Todos");
    await setVal("input[type=search]", "migraci");
    check("la búsqueda encuentra los roles de migración", (await ev("document.querySelectorAll('button.rolecard').length")) >= 3);
    await setVal("input[type=search]", "");
    await clickText("button.rolecard", "Diseñador UI");
    await waitFor("document.querySelector('dialog[open] pre')", 3000, "detalle de rol");
    check("el detalle del rol muestra su brief", (await txt("dialog pre")).includes("tokens"));
    check("ofrece Probar / Copiar / Duplicar", await ev("['Probar este rol','Copiar brief','Duplicar para editar'].every(t=>[...document.querySelectorAll('dialog button')].some(b=>b.textContent.includes(t)))"));
    await shot("07-rol-detalle");
    await clickText("dialog button", "Duplicar para editar");
    await waitFor("document.querySelector('dialog[open] textarea')", 3000, "editor");
    await setVal("dialog input[placeholder='mi-rol']", "mi-rol-prueba");
    await setVal("dialog textarea", "Eres un rol de prueba. Dueño SOLO de <ARCHIVOS>.");
    await clickText("dialog button", "Guardar");
    await waitFor("[...document.querySelectorAll('button.rolecard')].some(b=>b.textContent.includes('copia'))", 4000, "rol guardado");
    check("se puede crear un rol propio y aparece marcado 'propio'", await ev("[...document.querySelectorAll('button.rolecard')].some(b=>b.textContent.includes('propio'))"));
    await clickText("button.rolecard", "propio");
    await waitFor("document.querySelector('dialog[open]')", 3000, "abrir propio");
    await clickText("dialog button", "Borrar");
    await waitFor("document.querySelectorAll('dialog[open]').length===1 && /Borrar rol/.test(document.querySelector('dialog[open]').textContent)", 3000, "confirmación").catch(() => {});
    await ev("[...document.querySelectorAll('dialog[open] button')].filter(b=>b.textContent.trim()==='Borrar').pop().click()");
    await waitFor("![...document.querySelectorAll('button.rolecard')].some(b=>b.textContent.includes('propio'))", 4000, "rol borrado");
    check("borrar un rol propio pide confirmación y lo elimina", true);
    await clickText(".tabs button", "Equipos");
    await waitFor("document.querySelectorAll('.card.rolecard').length===8", 3000, "equipos");
    check("pestaña Equipos: 8 equipos con su orden de trabajo", /Orden de trabajo/.test(await txt("#main")));
    await shot("08-equipos");
    await clickText("button", "Lanzar este equipo");
    await waitFor("location.hash==='#/launch'", 3000, "lanzar equipo");
    await waitFor("document.querySelectorAll('button.team').length===8", 4000, "equipos en el lanzador");
    check("'Lanzar este equipo' abre el lanzador en modo enjambre", true);
  });

  console.log("== Tema, teclado, enlaces, errores");
  await step("global", async () => {
    await nav("#/");
    await waitFor("document.querySelector('#kpis .kpi')", 4000, "inicio");
    await click("#theme"); const t1 = await ev("document.documentElement.dataset.theme");
    await click("#theme"); const t2 = await ev("document.documentElement.dataset.theme");
    check("el botón de tema alterna claro → oscuro", t1 === "light" && t2 === "dark", t1 + "," + t2);
    await shot("09-oscuro");
    await click("#theme");
    await ev("document.body.focus()");
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "3", text: "3" }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "3" });
    await waitFor("location.hash==='#/launch'", 2000, "atajo 3");
    check("atajo de teclado '3' abre el Lanzador", true);
    await ev("history.back()"); await sleep(300);
    check("el botón Atrás del navegador funciona (rutas reales)", (await ev("location.hash")) !== "#/launch");
    await load("/#swarm=aaaaaaaa-0000-0000-0000-000000000001");
    await waitFor("location.hash.startsWith('#/swarms/')", 3000, "enlace antiguo");
    check("enlaces de versiones anteriores (#swarm=…) siguen funcionando", true);
    await nav("#/no-existe"); check("ruta desconocida muestra 'Página no encontrada'", /Página no encontrada/.test(await txt("#main")));
  });

  console.log("== Móvil");
  await step("móvil", async () => {
    await viewport(390, 800, true); await load("/#/");
    await waitFor("document.querySelector('#kpis .kpi')", 5000, "inicio móvil");
    const over = await ev("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    check("Inicio sin desbordamiento horizontal en 390 px", over <= 1, "sobran " + over + " px");
    await shot("10-movil-inicio");
    for (const [h, name] of [["#/launch", "lanzador"], ["#/roles", "roles"], ["#/workspaces", "workspaces"], ["#/swarms", "enjambres"]]) {
      await nav(h); await sleep(900);
      const o = await ev("document.documentElement.scrollWidth - document.documentElement.clientWidth");
      check(`${name} sin desbordamiento horizontal en móvil`, o <= 1, "sobran " + o + " px");
    }
    await nav("#/launch"); await sleep(600); await shot("11-movil-lanzador");
    await viewport(1280, 900, false);
  });
  console.log("== Estilo de la oficina");
  await step("estilo", async () => {
    await viewport(1280, 900, false); await load("/");
    await waitFor("document.querySelector('#office-style')", 6000, "enlace de estilo");
    await click("#office-style"); await waitFor("document.querySelectorAll('dialog[open] .stylecard').length===3", 6000, "3 tarjetas");
    check("el selector de estilo abre un diálogo con las 3 tarjetas (voxel, toon, cyberpunk)", true);
    check("cada tarjeta tiene miniatura cargada", await ev("[...document.querySelectorAll('dialog[open] .stylecard img')].every(i=>i.complete&&i.naturalWidth>0)"));
    check("las tarjetas son un grupo de radios accesible", await ev("!!document.querySelector('dialog[open] [role=radiogroup]') && document.querySelectorAll('dialog[open] input[type=radio]').length===3"));
    await api("/api/office/style", { style: "voxel" });
    check("empieza marcado el estilo guardado (voxel)", await ev("document.querySelector('dialog[open] .stylecard.on')?.dataset.style") === "voxel");
    await ev("document.querySelector('dialog[open] input[value=cyber]').click()");
    await waitFor("document.querySelector('.toast')?.textContent.includes('Cyberpunk')", 5000, "aviso");
    check("elegir Cyberpunk lo guarda en el servidor y marca la tarjeta", (await api("/api/office/style")).style === "cyber" && await ev("document.querySelector('dialog[open] .stylecard.on')?.dataset.style") === "cyber");
    await shot("12-estilo-oficina");
    await ev("document.querySelector('dialog[open]').close()");
    await click("#office-style"); await waitFor("document.querySelector('dialog[open] .stylecard.on')", 4000, "reabrir");
    check("al reabrir se recuerda el estilo elegido", await ev("document.querySelector('dialog[open] .stylecard.on')?.dataset.style") === "cyber");
    await ev("document.querySelector('dialog[open]').close()");
    await viewport(390, 800, true); await click("#office-style").catch(() => {}); await sleep(500);
    check("el diálogo cabe en móvil sin desbordar", await ev("document.documentElement.scrollWidth-document.documentElement.clientWidth") <= 1);
    await ev("document.querySelector('dialog[open]')?.close()"); await viewport(1280, 900, false);
    await api("/api/office/style", { style: "voxel" });
  });
} catch (e) { check("prueba abortada", false, e.message); }

check("ningún error de consola/JS durante toda la prueba", errors.length === 0, errors.slice(0, 4).join(" | "));
console.log(`\nRESULTADO: ${fails.length ? fails.length + " fallos: " + fails.join("; ") : "TODO OK (" + n + " comprobaciones)"}`);
chrome.kill(); process.exit(fails.length ? 1 : 0);
