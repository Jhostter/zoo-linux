// Captura de la oficina 3D en Chrome real. Uso: node test/office_shot.mjs <url> <salida.png> [espera_ms] [ancho] [alto]
import { spawn } from "node:child_process"; import { mkdtempSync, writeFileSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const [url, out, wait = "4000", W = "1600", H = "900"] = process.argv.slice(2), PORT = 9336, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("google-chrome", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "c-"))}`, `--window-size=${W},${H}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let ws, id = 0; const pend = new Map(), errors = [];
for (let i = 0; i < 40; i++) { try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl); break; } catch (e) { await sleep(250); } }
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === "Runtime.exceptionThrown") errors.push("EXC " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(d.params.type)) errors.push(d.params.type.toUpperCase() + " " + d.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push("LOG " + d.params.entry.text + " " + (d.params.entry.url || "")); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
for (const m of ["Page.enable", "Runtime.enable", "Log.enable"]) await send(m);
await send("Emulation.setDeviceMetricsOverride", { width: +W, height: +H, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url }); await sleep(+wait);
if (process.env.PRE_EXPR) await send("Runtime.evaluate", { expression: process.env.PRE_EXPR, awaitPromise: false });
if (process.env.WAIT_EXPR) { const t0 = Date.now(); while (Date.now() - t0 < 90000) { const r = await send("Runtime.evaluate", { expression: process.env.WAIT_EXPR, returnByValue: true }); if (r.result?.result?.value) break; await sleep(60); } }
const clip = process.env.CLIP ? (([x, y, w, h, scale]) => ({ x, y, width: w, height: h, scale }))(process.env.CLIP.split(",").map(Number)) : undefined;
const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip } : {}) }); writeFileSync(out, Buffer.from(r.result.data, "base64"));
const fps = await send("Runtime.evaluate", { expression: "new Promise(res=>{let n=0;const t0=performance.now();const f=()=>{n++;if(performance.now()-t0>1500)res(Math.round(n/((performance.now()-t0)/1000)));else requestAnimationFrame(f)};requestAnimationFrame(f)})", awaitPromise: true, returnByValue: true });
const info = await send("Runtime.evaluate", { expression: "(()=>{const i=__office.renderer.info;return JSON.stringify({llamadas:i.render.calls,triangulos:i.render.triangles,geometrias:i.memory.geometries,texturas:i.memory.textures})})()", returnByValue: true });
console.log("render:", info.result?.result?.value);
console.log("fps aprox (render por software):", fps.result?.result?.value); console.log(errors.length ? "ERRORES:\n " + [...new Set(errors)].slice(0, 8).join("\n ") : "sin errores de consola");
chrome.kill(); process.exit(0);
