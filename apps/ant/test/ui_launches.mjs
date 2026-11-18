// Varios /swarm de una misma conversación = enjambres individuales en la interfaz.
// Uso: python3 test/ui_env.py <dir> --multi  → arrancar server.py con esas variables (puerto 4590) →  node test/ui_launches.mjs http://localhost:4590 <dir_capturas>
import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const BASE = process.argv[2] || "http://localhost:4590", OUT = process.argv[3] || tmpdir(), PORT = 9371, sleep = (ms) => new Promise((r) => setTimeout(r, ms)); mkdirSync(OUT, { recursive: true });
const chrome = spawn("google-chrome", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "c-"))}`, "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
let ws, id = 0; const pend = new Map(), errors = [];
for (let i = 0; i < 40; i++) { try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl); break; } catch (e) { await sleep(250); } }
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === "Runtime.exceptionThrown") errors.push("EXC " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("CONSOLE " + d.params.args.map((a) => a.value ?? a.description).join(" ")); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
const waitFor = async (e, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(e)) return true; } catch (x) { /* aún no */ } await sleep(150); } throw new Error("timeout: " + e); };
const clickTextSel = (sel, text) => ev(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error('no hay '+${JSON.stringify(text)});e.click();return true})()`);
const nav = async (h) => { await ev(`location.hash=${JSON.stringify(h)}`); await sleep(300); };
const shot = async (n) => writeFileSync(join(OUT, n + ".png"), Buffer.from((await send("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
for (const m of ["Page.enable", "Runtime.enable"]) await send(m);
const fails = []; let n = 0; const check = (name, cond, extra = "") => { n++; console.log((cond ? "  ok  " : "FALLA ") + name + (!cond && extra ? `  [${extra}]` : "")); if (!cond) fails.push(name); };
try {
  const CONV = "ffffffff-0000-0000-0000-00000000000a";
  await send("Page.navigate", { url: BASE + "/#/swarms" }); await sleep(800); await waitFor("document.querySelectorAll('#main a.card').length>=2");
  const cards = await ev("[...document.querySelectorAll('#main a.card')].map(a=>({t:a.querySelector('b').textContent,href:a.getAttribute('href'),txt:a.textContent}))");
  const A = cards.find((c) => c.t === "Titulo A"), B = cards.find((c) => c.t === "Titulo B");
  check("Enjambres muestra CADA /swarm de la conversación como una tarjeta propia, con su título", !!A && !!B, JSON.stringify(cards.map((c) => c.t)));
  check("cada tarjeta enlaza a su lanzamiento (conv~1, conv~2)", A.href === `#/swarms/${CONV}~1` && B.href === `#/swarms/${CONV}~2`, `${A.href} ${B.href}`);
  check("se indica «lanzamiento 1/2» y «2/2» y la tarea de cada uno", /lanzamiento 1\/2/.test(A.txt) && /lanzamiento 2\/2/.test(B.txt) && /Tarea A/.test(A.txt) && /Tarea B/.test(B.txt));
  check("A tiene 2 agentes (a1, a2) y B 3 (b1 + coordinador + monitor); no se suman", /2 agentes/.test(A.txt) && /3 agentes/.test(B.txt), `${A.txt.slice(0, 90)} | ${B.txt.slice(0, 90)}`);
  await shot("l1-lista");
  await nav(`#/swarms/${CONV}~1`); await waitFor("document.querySelector('#main h1')?.textContent==='Titulo A'");
  const dA = await ev("({h1:document.querySelector('#main h1').textContent,members:[...document.querySelectorAll('#main .members .card, #main .members > *')].map(e=>e.textContent).join('|'),feed:document.querySelectorAll('#main .feed .msg').length,txt:document.querySelector('#main').textContent})");
  check("el detalle del 1.º muestra su tarea y su nombre; sin agentes del otro lanzamiento", /Tarea A/.test(dA.txt) && /a1/.test(dA.members) && /a2/.test(dA.members) && !/b1/.test(dA.members), dA.members.slice(0, 120));
  check("y SOLO sus mensajes (5)", dA.feed === 5, String(dA.feed));
  check("avisa de que la conversación tuvo 2 /swarm y enlaza al otro", /tuvo 2 \/swarm/.test(dA.txt) && (await ev("[...document.querySelectorAll('#main a')].some(a=>a.getAttribute('href')==='#/swarms/" + CONV + "~2')")));
  await shot("l2-detalle-a");
  await ev(`[...document.querySelectorAll('#main a')].find(a=>a.getAttribute('href')==='#/swarms/${CONV}~2').click()`); await waitFor("document.querySelector('#main h1')?.textContent==='Titulo B'");
  const dB = await ev("({members:[...document.querySelectorAll('#main .members > *')].map(e=>e.textContent).join('|'),feed:document.querySelectorAll('#main .feed .msg').length})");
  check("el enlace lleva al 2.º: sus agentes (b1, coordinator, monitor) y sus 5 mensajes", /b1/.test(dB.members) && /coordinator/.test(dB.members) && /monitor/.test(dB.members) && !/a1/.test(dB.members) && dB.feed === 5, JSON.stringify(dB).slice(0, 200));
  await nav(`#/swarms/${CONV}`); await waitFor("document.querySelector('#main h1')?.textContent==='Titulo B'");
  check("el enlace antiguo (solo la conversación) abre el último lanzamiento", true);
  console.log("== Detalle del enjambre mejorado");
  await nav(`#/swarms/${CONV}~1`); await waitFor("document.querySelector('#main h1')?.textContent==='Titulo A'"); await sleep(400);
  const H = await ev("({chips:[...document.querySelectorAll('#main .chips-row .chip')].map(c=>c.textContent),status:document.querySelector('#main h1').nextElementSibling.textContent,steps:[...document.querySelectorAll('#main .steps a')].map(a=>({t:a.textContent,cur:a.getAttribute('aria-current')})),task:document.querySelector('#main details.task').textContent,prog:document.querySelector('#main .prog').textContent,res:document.querySelector('#main .result')&&document.querySelector('#main .result').textContent})");
  check("la cabecera dice el ESTADO (terminado ✓), cuántos agentes y mensajes, cuánto duró y la actividad", /terminado/.test(H.status) && H.chips.some((c) => /2 agentes/.test(c)) && H.chips.some((c) => /5 mensajes/.test(c)) && H.chips.some((c) => /⏱ 12 min/.test(c)) && H.chips.some((c) => /actividad/.test(c)), JSON.stringify(H.chips) + H.status);
  check("el selector de lanzamientos lista los 2 con su estado y marca el actual (aria-current)", H.steps.length === 2 && H.steps[0].cur === "page" && H.steps[1].cur === null && /Titulo B/.test(H.steps[1].t), JSON.stringify(H.steps));
  check("muestra la tarea completa y el progreso «2 de 2 agentes entregaron»", /Tarea A: analizar/.test(H.task) && /2 de 2 agentes entregaron/.test(H.prog));
  check("al terminar muestra el RESULTADO FINAL (el [done] del coordinador)", /Resultado final/.test(H.res) && /Tarea A terminada/.test(H.res));
  const T = await ev("[...document.querySelectorAll('#main .members .member')].map(m=>({name:m.querySelector('.mname').textContent,txt:m.textContent,pressed:m.getAttribute('aria-pressed')}))");
  check("cada agente es una tarjeta con su estado, su entrega y sus cifras (mensajes enviados)", T.length === 2 && T.every((m) => /terminado/.test(m.txt) && /entregó #\d/.test(m.txt) && /1 mensaje/.test(m.txt)) && /Entrega: .*A1/.test(T.find((m) => m.name === "a1").txt), JSON.stringify(T.map((m) => m.txt.slice(0, 90))));
  const M0 = await ev("(()=>{const m=document.querySelector('#m-3');return {who:m.querySelector('.who').textContent,time:m.querySelector('time').textContent,to:[...m.querySelectorAll('.to .mention')].map(x=>x.textContent),chip:m.querySelector('.chip.ok')&&m.querySelector('.chip.ok').textContent,body:m.querySelector('.mbody').textContent}})()");
  check("cada mensaje muestra quién, a quién (@destinatarios), la hora y su tipo (entrega), sin repetir «[done]» en el cuerpo", M0.who === "a1" && /^\d\d:\d\d/.test(M0.time) && M0.to.join() === "@coordinator" && M0.chip === "entrega" && !/\[done\]/.test(M0.body), JSON.stringify(M0));
  await ev("document.querySelector('#main .member .linkchip').click()"); await sleep(300);
  check("«entregó #n» lleva a ese mensaje del tablero y lo resalta", await ev("document.querySelector('#main .member .linkchip') && !!document.querySelector('.feed .msg.flash')"));
  await sleep(2000);
  await ev("document.querySelector('#main .members .member').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))"); await sleep(250);
  const f1 = await ev("({pressed:document.querySelector('#main .members .member').getAttribute('aria-pressed'),n:document.querySelectorAll('.feed .msg').length,picker:[...document.querySelectorAll('.pickers button[aria-pressed=true]')].map(b=>b.textContent)})");
  check("pulsar (o Enter en) la tarjeta de un agente filtra el tablero por él", f1.pressed === "true" && f1.n >= 2 && f1.n < 5 && f1.picker.length === 1, JSON.stringify(f1));
  await ev("document.querySelector('#main .members .member').click()"); await sleep(250);
  check("y volver a pulsarla quita el filtro", (await ev("document.querySelectorAll('.feed .msg').length")) === 5);
  await clickTextSel("button", "Entregas"); await sleep(200);
  check("el filtro «Entregas» deja solo las entregas (3, 4 y 5)", (await ev("[...document.querySelectorAll('.feed .msg')].map(m=>m.dataset.seq).join()")) === "3,4,5");
  await clickTextSel("button", "Todo"); await ev("(()=>{const i=document.querySelector('#main input[type=search]');i.value='A2';i.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(250);
  check("la búsqueda de texto filtra el tablero", (await ev("document.querySelectorAll('.feed .msg').length")) >= 1 && (await ev("document.querySelectorAll('.feed .msg').length")) < 5 && /de 5 mensajes/.test(await ev("document.querySelector('#main').textContent")));
  await ev("(()=>{const i=document.querySelector('#main input[type=search]');i.value='';i.dispatchEvent(new Event('input',{bubbles:true}))})()"); await sleep(200);
  const g = await ev("({heading:[...document.querySelectorAll('#main h2')].map(h=>h.textContent),full:!!document.querySelector('#main .flow svg.graph'),nodes:[...document.querySelectorAll('svg.graph .node')].map(n=>({name:n.querySelector('.lbl').textContent,cy:+n.querySelector('circle').getAttribute('cy')})),deleg:document.querySelectorAll('svg.graph .edge.deleg').length,dep:document.querySelectorAll('svg.graph .edge.dep').length,fb:document.querySelectorAll('svg.graph .edge.fb').length,ok:document.querySelectorAll('svg.graph .okb').length,caps:[...document.querySelectorAll('svg.graph .cap')].map(c=>c.textContent),legend:[...document.querySelectorAll('.flow .legend .lg')].map(l=>l.textContent),sum:document.querySelector('.flow').textContent})");
  const cy = (n) => g.nodes.find((x) => x.name === n).cy;
  check("el grafo se llama «Quién delega a quién» y ocupa el ancho de la página (no la columna lateral)", g.heading.includes("Quién delega a quién") && g.full);
  check("el coordinador está arriba (reparte) y sus agentes debajo, en una ronda", g.nodes.length === 3 && cy("coordinator") < cy("a1") && cy("a1") === cy("a2") && g.caps.join() === "Reparte,Ejecutan", JSON.stringify(g.nodes) + g.caps);
  check("una flecha de reparto por agente y NINGUNA flecha de vuelta al coordinador: la entrega es una marca ✓ en cada agente", g.deleg === 2 && g.ok === 2 && g.dep === 0 && g.fb === 0, JSON.stringify([g.deleg, g.ok, g.dep, g.fb]));
  check("lleva leyenda y un resumen en palabras del reparto", g.legend.length >= 4 && /reparte 2 tareas en 1 ronda/.test(g.sum), g.sum.slice(-140));
  console.log("== Modelo del grafo de delegación (reparto realista en 3 rondas)");
  const FM = await ev(`(()=>{const msg=(seq,agent,text)=>({seq,agent,text,t:1000+seq*60});
    const d={members:['ux-researcher','ui-designer','a11y-auditor','reviewer'].map(n=>({name:n,state:'killed'})).concat([{name:'coordinator',state:'waiting'},{name:'monitor',state:'waiting'}]),board:[
      msg(1,'coordinator','@ux-researcher Analiza la UX. Publica tu [done] al terminar.'),
      msg(2,'coordinator','@ui-designer Diseña. Al terminar publica [done].'),
      msg(3,'coordinator','@a11y-auditor Eres el auditor. Espera a que \`@ui-designer\` y \`@ux-researcher\` publiquen sus [done] con sus rutas.'),
      msg(4,'coordinator','@reviewer Revisa. Espera a que @ux-researcher, @ui-designer y @a11y-auditor publiquen sus [done].'),
      msg(5,'coordinator','@monitor resume'),
      msg(6,'ux-researcher','@a11y-auditor @reviewer @coordinator [done] UX lista'),
      msg(7,'ui-designer','@a11y-auditor @coordinator [done] UI lista'),
      msg(8,'a11y-auditor','@ui-designer Hallazgos WCAG: contraste'),
      msg(9,'ui-designer','@a11y-auditor Corregidos los hallazgos'),
      msg(10,'a11y-auditor','@coordinator @reviewer [done] aprobado'),
      msg(11,'reviewer','@coordinator Bloqueo/decisión: ¿qué hago?'),
      msg(12,'monitor','@coordinator [stall] nadie avanza'),
      msg(13,'coordinator','[done] todo listo')]};
    const F=flowModel(d), el=delegationGraph(d,()=>{},''), pos=(n)=>+[...el.querySelectorAll('.node')].find(x=>x.querySelector('.lbl').textContent===n).querySelector('circle').getAttribute('cy');
    return {layers:Object.fromEntries(F.layer),deps:[...F.deps].map(([y,xs])=>y+'<-'+[...xs].sort().join('+')).sort(),fb:[...F.fb.values()].map(e=>e.a+'|'+e.b+':'+e.n),delivered:[...F.delivered.keys()].sort(),asks:Object.fromEntries(F.asks),alerts:F.alerts.n,deleg:[...F.deleg.keys()].sort(),rounds:F.rounds,
      kinds:[1,6,8,11,12,13].map(s=>kindOf(d.board[s-1].text)),
      dom:{nodes:el.querySelectorAll('.node').length,dep:el.querySelectorAll('.edge.dep').length,deleg:el.querySelectorAll('.edge.deleg').length,fb:el.querySelectorAll('.edge.fb').length,ok:el.querySelectorAll('.okb').length,ask:el.querySelectorAll('.askb').length,alert:/1 alerta/.test(el.textContent),caps:[...el.querySelectorAll('.cap')].map(c=>c.textContent),ordered:pos('coordinator')<pos('ui-designer')&&pos('ui-designer')<pos('a11y-auditor')&&pos('a11y-auditor')<pos('reviewer')}};})()`);
  check("las RONDAS salen de los «espera a que @x…» de cada brief: investigador y diseñador en paralelo, luego el auditor, luego el revisor", JSON.stringify(FM.layers) === JSON.stringify({ "ux-researcher": 1, "ui-designer": 1, "a11y-auditor": 2, reviewer: 3 }) && FM.rounds === 3, JSON.stringify(FM.layers));
  check("las dependencias son exactamente las del brief (no todas las menciones de cada «[done]»)", JSON.stringify(FM.deps) === JSON.stringify(["a11y-auditor<-ui-designer+ux-researcher", "reviewer<-a11y-auditor+ui-designer+ux-researcher"]), JSON.stringify(FM.deps));
  check("el reparto son 4 tareas (el monitor no cuenta) y las correcciones entre auditor y diseñador son un solo cruce de 2 mensajes", FM.deleg.length === 4 && !FM.deleg.includes("monitor") && JSON.stringify(FM.fb) === JSON.stringify(["a11y-auditor|ui-designer:2"]), JSON.stringify([FM.deleg, FM.fb]));
  check("entregaron los 3 que publicaron [done]; el revisor tiene 1 duda para el coordinador y el monitor 1 alerta", JSON.stringify(FM.delivered) === JSON.stringify(["a11y-auditor", "ui-designer", "ux-researcher"]) && FM.asks.reviewer === 1 && FM.alerts === 1, JSON.stringify([FM.delivered, FM.asks, FM.alerts]));
  check("un brief que pide un [done] NO es una entrega; sí lo es el que EMPIEZA por [done] (también el final del coordinador); «Bloqueo…» y «Hallazgos…» son alertas", JSON.stringify(FM.kinds) === JSON.stringify(["msg", "done", "finding", "finding", "stall", "done"]), JSON.stringify(FM.kinds));
  check("el dibujo cuadra con el modelo: 6 nodos, 5 flechas de dependencia, 4 de reparto, 1 cruce, 3 ✓, 1 insignia de duda, alerta del monitor y 3 rondas de arriba abajo", JSON.stringify([FM.dom.nodes, FM.dom.dep, FM.dom.deleg, FM.dom.fb, FM.dom.ok, FM.dom.ask]) === JSON.stringify([6, 5, 4, 1, 3, 1]) && FM.dom.alert && FM.dom.ordered && FM.dom.caps.length === 4, JSON.stringify(FM.dom));
  await ev("document.querySelector('svg.graph .node:nth-child(2)').dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await sleep(250);
  check("pulsar un nodo del grafo filtra el tablero por ese agente", (await ev("document.querySelectorAll('.pickers button[aria-pressed=true]').length")) === 1 && (await ev("document.querySelectorAll('.feed .msg').length")) < 5);
  await ev("document.querySelector('.pickers button').click()"); await sleep(200);
  const tl = await ev("({dots:document.querySelectorAll('svg.timeline .tdot').length,rows:document.querySelectorAll('svg.timeline .lbl').length,ticks:document.querySelectorAll('svg.timeline .ax').length})");
  check("la línea de tiempo dibuja una fila por agente (+coordinador), un punto por mensaje y 3 horas en el eje", tl.dots === 5 && tl.rows === 3 && tl.ticks === 3, JSON.stringify(tl));
  await ev("document.querySelector('svg.timeline .tdot').dispatchEvent(new MouseEvent('click',{bubbles:true}))"); await sleep(300);
  check("pulsar un punto de la línea de tiempo lleva a ese mensaje", !!(await ev("document.querySelector('.feed .msg.flash')")));
  await shot("l3-detalle-a");
  await nav(`#/swarms/${CONV}~2`); await waitFor("document.querySelector('#main h1')?.textContent==='Titulo B'"); await sleep(400);
  const HB = await ev("({status:document.querySelector('#main h1').nextElementSibling.textContent,chips:[...document.querySelectorAll('#main .chips-row .chip')].map(c=>c.textContent),res:!!document.querySelector('#main .result'),prog:document.querySelector('#main .prog').textContent,mem:[...document.querySelectorAll('#main .members .member')].map(m=>m.querySelector('.mname').textContent),shared:[...document.querySelectorAll('#main .members .member')].filter(m=>/todos los lanzamientos|compartido/.test(m.textContent)).length})");
  check("un enjambre en marcha dice «en ejecución», lleva el cronómetro vivo y aún no tiene resultado", /en ejecución/.test(HB.status) && !HB.res && HB.chips.some((c) => /⏱/.test(c)), JSON.stringify(HB));
  check("sus agentes: el que trabaja primero y después los compartidos (coordinador, monitor)", HB.mem[0] === "b1" && HB.mem.slice(1).sort().join() === "coordinator,monitor", JSON.stringify(HB.mem));
  await clickTextSel("button", "Alertas"); await sleep(200);
  check("«Alertas» muestra el bloqueo ([stall]) del monitor y nada más", (await ev("[...document.querySelectorAll('.feed .msg')].map(m=>m.dataset.seq+':'+m.classList.contains('stall')).join()")) === "10:true");
  await clickTextSel("button", "Todo");
  const gaps = await ev("[...document.querySelectorAll('.feed .gap')].map(g=>g.textContent)");
  check("entre mensajes muy separados en el tiempo aparece «⏱ … después»", gaps.length >= 1 && gaps.every((g) => /después/.test(g)), JSON.stringify(gaps));
  await shot("l4-detalle-b");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 900, deviceScaleFactor: 1, mobile: true }); await sleep(500);
  check("en móvil no hay scroll horizontal", await ev("document.documentElement.scrollWidth<=document.documentElement.clientWidth+1"), String(await ev("document.documentElement.scrollWidth")));
  await shot("l5-movil");
  await send("Emulation.clearDeviceMetricsOverride");
  await nav("#/"); await waitFor("document.querySelectorAll('#main a.card').length>0"); await sleep(600);
  check("Inicio también los muestra por separado", (await ev("[...document.querySelectorAll('#main a.card b')].map(b=>b.textContent)")).filter((t) => /Titulo/.test(t)).length === 2);
  check("sin errores de consola", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) { check("excepción: " + e.message, false); }
chrome.kill();
console.log(`\nRESULTADO: ${fails.length ? fails.length + " fallos: " + fails.join("; ") : "TODO OK (" + n + " comprobaciones)"}`);
process.exit(fails.length ? 1 : 0);
