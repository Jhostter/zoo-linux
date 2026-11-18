"use strict";
/* Utilidades de Ant: DOM sin innerHTML, API, toasts, diálogos, formato y Markdown mínimo. */

// ---------- DOM ----------
const PROPS = new Set(["value", "checked", "disabled", "selected", "hidden", "open", "readOnly", "required"]);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  let deferred;
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "value" && tag === "select") { deferred = v; continue; } // las opciones aún no existen
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, kids);
  if (deferred !== undefined) el.value = deferred;
  return el;
}
function append(el, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}
const put = (el, ...kids) => { el.replaceChildren(); append(el, kids); return el; };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- almacenamiento (puede fallar: modo privado, etc.) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem("ant:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("ant:" + k, JSON.stringify(v)); } catch (e) { /* sin persistencia */ } },
};

// ---------- API ----------
let failures = 0;
function setOnline(ok) {
  failures = ok ? 0 : failures + 1;
  const off = failures >= 2;
  $("#offline")?.classList.toggle("on", off);
  $$(".conn").forEach((c) => c.classList.toggle("off", off));
}
async function api(path, body) {
  try {
    const r = await fetch(path, body !== undefined
      ? { method: "POST", headers: { "X-Ant": "1", "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : { cache: "no-store" });
    let data = {};
    try { data = await r.json(); } catch (e) { /* cuerpo vacío */ }
    setOnline(true);
    return { ok: r.ok, status: r.status, data };
  } catch (e) {
    setOnline(false);
    return { ok: false, status: 0, data: { error: "Sin conexión con el servicio de Ant." } };
  }
}
const cache = new Map();
function getc(path, ttl = 1500) { // GET con caché corta y deduplicación de peticiones simultáneas
  const c = cache.get(path);
  if (c && Date.now() - c.t < ttl) return c.p;
  const p = api(path);
  cache.set(path, { t: Date.now(), p });
  return p;
}

// ---------- avisos y diálogos ----------
function toast(msg, kind = "") {
  const t = h("div", { class: "toast " + kind, role: kind === "bad" ? "alert" : "status" }, msg);
  const box = $("#toasts"); box.append(t);
  while (box.children.length > 3) box.firstChild.remove(); // no apilar avisos sin límite
  setTimeout(() => t.remove(), kind === "bad" ? 7000 : 3800);
}
function modal({ title, body, actions = [], wide = false }) {
  const d = h("dialog", { "aria-label": title, style: wide ? { width: "min(860px,94vw)" } : null });
  const close = (v) => d.close(v);
  put(d,
    h("div", { class: "dlg-h" }, h("h2", {}, title), h("span", { class: "sp" }), h("button", { class: "btn ghost sm", "aria-label": "Cerrar", onclick: () => close("") }, "✕")),
    h("div", { class: "dlg-b" }, body),
    actions.length ? h("div", { class: "dlg-f" }, actions) : null);
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => { if (e.target === d) close(""); });
  document.body.append(d);
  d.showModal();
  return { el: d, close };
}
function confirmDialog({ title, body, ok = "Aceptar", danger = false }) {
  return new Promise((res) => {
    let answered = false;
    const m = modal({
      title, body: h("div", {}, body),
      actions: [h("button", { class: "btn", onclick: () => m.close("") }, "Cancelar"),
        h("button", { class: "btn " + (danger ? "danger fill" : "pri"), onclick: () => { answered = true; m.close("ok"); } }, ok)],
    });
    m.el.addEventListener("close", () => res(answered));
    $("button.btn:last-child", m.el)?.focus();
  });
}
async function copy(text, okMsg = "Copiado") {
  try { await navigator.clipboard.writeText(text); toast(okMsg, "ok"); } catch (e) { toast("No se pudo copiar. Selecciónalo a mano.", "bad"); }
}

// ---------- formato ----------
const fmt = {
  ago(ts) {
    if (!ts) return "—";
    const s = Math.max(0, Date.now() / 1000 - ts);
    if (s < 5) return "ahora";
    if (s < 60) return "hace " + Math.round(s) + " s";
    if (s < 3600) return "hace " + Math.round(s / 60) + " min";
    if (s < 86400) return "hace " + Math.round(s / 3600) + " h";
    return "hace " + Math.round(s / 86400) + " d";
  },
  dur(s) {
    s = Math.max(0, Math.round(s));
    const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh ? `${hh} h ${m} min` : m ? `${m} min ${String(ss).padStart(2, "0")} s` : `${ss} s`;
  },
  tok(n) { n = +n || 0; return n >= 1e6 ? (n / 1e6).toFixed(1).replace(".", ",") + " M" : n >= 1000 ? (n / 1000 >= 100 ? Math.round(n / 1000) : (n / 1000).toFixed(1).replace(".", ",")) + " k" : String(n); },
  short(t, n = 90) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; },
};
// elementos que se actualizan solos cada segundo
const since = (ts) => h("span", { dataset: { since: ts } }, fmt.dur(Date.now() / 1000 - ts));
const agoEl = (ts) => h("span", { dataset: { ago: ts } }, fmt.ago(ts));
setInterval(() => {
  const now = Date.now() / 1000;
  $$("[data-since]").forEach((e) => (e.textContent = fmt.dur(now - +e.dataset.since)));
  $$("[data-ago]").forEach((e) => (e.textContent = fmt.ago(+e.dataset.ago)));
}, 1000);

const RUN = { // estados de ejecución → etiqueta y color
  running: ["en marcha", "ok"], done: ["terminada", "ok"], failed: ["falló", "bad"], lost: ["perdida", "bad"], quota: ["sin cuota", "warn"],
  stopped: ["detenida", ""], budget: ["presupuesto agotado", "warn"], blocked: ["bloqueada por permisos", "warn"], timeout: ["tiempo agotado", "warn"],
};
const MEMBER = { working: "trabajando", waiting: "esperando", killed: "terminado" };
const statusChip = (st) => h("span", { class: "chip " + (RUN[st]?.[1] || "") }, h("span", { class: "dot " + st }), RUN[st]?.[0] || st);

// ---------- Markdown mínimo y seguro (solo nodos de texto) ----------
const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(@[a-z][a-z0-9-]*)|(\[(?:done|stall|quota)\])/gi;
function inline(text) {
  const out = []; let last = 0, m;
  INLINE.lastIndex = 0;
  while ((m = INLINE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(h("code", {}, t.slice(1, -1)));
    else if (m[2]) out.push(h("strong", {}, t.slice(2, -2)));
    else if (m[3]) out.push(h("span", { class: "mention" }, t));
    else out.push(h("span", { class: "tagx " + (/stall/i.test(t) ? "stall" : "") }, t.slice(1, -1)));
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
function md(text) {
  const frag = document.createDocumentFragment();
  String(text || "").split(/```(?:\w+)?\n?([\s\S]*?)```/).forEach((part, i) => {
    if (i % 2) frag.append(h("pre", { style: { margin: "6px 0" } }, part.replace(/\n$/, "")));
    else if (part.trim()) frag.append(h("div", { style: { whiteSpace: "pre-wrap" } }, inline(part.replace(/^\n+|\n+$/g, ""))));
  });
  return frag;
}
