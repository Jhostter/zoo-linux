// Humo de solo lectura: visita cada pantalla y comprueba que carga sin errores. Uso: node test/ui_smoke.mjs <url_base>
import { spawn } from "node:child_process"; import { mkdtempSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path";
const BASE = process.argv[2] || "http://localhost:4511", PORT = 9335, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("google-chrome", ["--headless=new", "--disable-gpu", `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "c-"))}`, "about:blank"], { stdio: "ignore" });
let ws, id = 0; const pend = new Map(), errors = [];
for (let i = 0; i < 40; i++) { try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); ws = new WebSocket(t.find((x) => x.type === "page").webSocketDebuggerUrl); break; } catch (e) { await sleep(250); } }
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); return; }
  if (d.method === "Runtime.exceptionThrown") errors.push("EXC " + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("CONSOLE " + d.params.args.map((a) => a.value ?? a.description).join(" "));
  if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errors.push("LOG " + d.params.entry.text + " " + (d.params.entry.url || "")); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.result.value;
for (const m of ["Page.enable", "Runtime.enable", "Log.enable"]) await send(m);
await send("Page.navigate", { url: BASE + "/" }); await sleep(1500);
let bad = 0;
for (const [hash, name] of [["#/", "Inicio"], ["#/swarms", "Enjambres"], ["#/launch", "Lanzador"], ["#/runs", "Lanzamientos"], ["#/workspaces", "Workspaces"], ["#/roles", "Roles"], ["#/roles?tab=teams", "Equipos"]]) {
  await ev(`location.hash=${JSON.stringify(hash)}`); await sleep(1800);
  const len = await ev("document.querySelector('#main').textContent.length"), skel = await ev("document.querySelectorAll('#main .skel').length");
  const ok = len > 80 && skel === 0; if (!ok) bad++;
  console.log((ok ? "  ok  " : "FALLA ") + name + `  (${len} caracteres)`);
}
console.log(errors.length ? "ERRORES: " + errors.slice(0, 5).join(" | ") : "  ok  sin errores de consola"); if (errors.length) bad++;
chrome.kill(); process.exit(bad ? 1 : 0);
