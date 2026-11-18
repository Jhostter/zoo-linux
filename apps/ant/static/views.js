"use strict";
/* Ant — vistas: tarjetas compartidas, Enjambres, Ejecuciones, Workspaces, Roles y Equipos. */

// ---------- tarjetas compartidas ----------
function runRow(r) {
  return h("a", { class: "item", href: "#/runs/" + r.id },
    h("span", { class: "dot " + r.status }), h("span", { style: { flex: 1, minWidth: 0 } }, h("div", { class: "b" }, r.ws_name, r.swarm ? "  🐜" : ""), h("div", { class: "small mut" }, fmt.short(r.prompt, 110))),
    h("span", { class: "chips" }, statusChip(r.status)), h("span", { class: "small mut nowrap" }, agoEl(r.started)));
}
function runCard(r) {
  return h("a", { class: "card click", href: "#/runs/" + r.id },
    h("div", { class: "row" }, h("b", {}, r.ws_name, r.swarm ? " · 🐜 enjambre" : ""), h("span", { class: "sp" }), statusChip(r.status)),
    h("div", { class: "small", style: { margin: "6px 0" } }, fmt.short(r.prompt, 130)),
    h("div", { class: "small mut" }, [r.role, r.model, r.status === "running" ? ["lleva ", since(r.started)] : agoEl(r.started)].filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))));
}
function stateBar(members) {
  const n = members.length || 1, c = { working: 0, waiting: 0, killed: 0 };
  members.forEach((m) => c[m.state]++);
  return h("div", {}, h("div", { class: "bar", role: "img", "aria-label": `${c.working} trabajando, ${c.waiting} esperando, ${c.killed} terminados` },
    h("i", { class: "w", style: { width: (c.working / n) * 100 + "%" } }), h("i", { class: "q", style: { width: (c.waiting / n) * 100 + "%" } }), h("i", { class: "k", style: { width: (c.killed / n) * 100 + "%" } })),
  h("div", { class: "xs mut", style: { marginTop: "4px" } }, `${c.working} trabajando · ${c.waiting} esperando · ${c.killed} terminados`));
}
function swarmCard(s) {
  const last = s.last || (s.board && s.board[s.board.length - 1]);
  return h("a", { class: "card click", href: "#/swarms/" + s.id },
    h("div", { class: "row" }, h("b", {}, s.title), h("span", { class: "sp" }), s.of > 1 ? h("span", { class: "chip", title: "Cada /swarm de la misma conversación de Antigravity es un enjambre aparte" }, `lanzamiento ${s.n}/${s.of}`) : null, h("span", { class: "chip" }, s.members.length + " agentes")),
    s.prompt ? h("div", { class: "small", style: { margin: "6px 0 0" } }, fmt.short(s.prompt, 120)) : null,
    h("div", { style: { margin: "10px 0" } }, stateBar(s.members)),
    last ? h("div", { class: "small mut" }, h("b", {}, last.agent + ": "), fmt.short(last.text, 100)) : null,
    h("div", { class: "xs mut", style: { marginTop: "6px" } }, "Actividad ", agoEl(s.updated)));
}

// ============================================================ ENJAMBRES
async function Swarms(ctx) {
  document.title = "Enjambres · Ant";
  const list = h("div"), pending = h("div"), search = h("input", { type: "search", placeholder: "Buscar enjambre…", "aria-label": "Buscar enjambre", style: { maxWidth: "280px" } });
  put(ctx.root, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Enjambres"), h("p", { class: "sub" }, "Equipos de agentes coordinados. Se actualiza en vivo.")), h("span", { class: "sp" }), search,
    h("a", { class: "btn pri", href: "#/launch", onclick: () => store.set("launch", { ...store.get("launch", {}), kind: "swarm" }) }, "+ Lanzar un enjambre")), pending, list);
  let all = [], sig = "";
  const paint = () => {
    const q = search.value.trim().toLowerCase(), sw = all.filter((s) => !q || s.title.toLowerCase().includes(q));
    put(list, sw.length ? h("div", { class: "grid g2" }, sw.map(swarmCard)) : all.length ? h("div", { class: "empty" }, "Ningún enjambre coincide con la búsqueda.") :
      h("div", { class: "card empty" }, h("div", { class: "big" }, "🐜"), h("b", {}, "Todavía no hay enjambres"),
        h("p", {}, "Un enjambre es un equipo de agentes: un coordinador reparte la tarea entre workers que colaboran en un tablero."),
        h("div", { class: "row", style: { justifyContent: "center", marginTop: "14px" } }, h("a", { class: "btn pri", href: "#/launch", onclick: () => store.set("launch", { ...store.get("launch", {}), kind: "swarm" }) }, "Lanzar un enjambre"), h("a", { class: "btn", href: "#/roles?tab=teams" }, "Ver equipos disponibles")),
        h("p", { class: "small", style: { marginTop: "14px" } }, "También puedes escribir ", h("code", {}, "/swarm <tarea>"), " dentro de Antigravity: aparecerá aquí.")));
  };
  search.addEventListener("input", paint);
  ctx.every(async () => { // enjambres lanzados desde Ant que todavía no existen en Antigravity (planificando) o que fallaron antes de crear workers
    const [o, rs] = await Promise.all([getc("/api/overview", 1500), getc("/api/runs", 1500)]); if (!rs.ok || !o.ok || !ctx.alive()) return;
    const known = new Set((o.data.swarms || []).map((s) => s.conv || s.id));
    const orphans = (rs.data.runs || []).filter((r) => r.swarm && !(r.conv && known.has(r.conv)) && Date.now() / 1000 - r.started < 6 * 3600);
    put(pending, orphans.length ? h("div", { class: "mb" }, h("h2", { class: "mb" }, "Lanzados desde Ant que aún no tienen enjambre"),
      h("p", { class: "small mut", style: { marginBottom: "10px" } }, "Un enjambre tarda en aparecer: primero el coordinador explora el proyecto y planifica. Si falló antes de crear workers (p. ej. por un permiso denegado), se queda aquí con su motivo."),
      h("div", { class: "grid g2" }, orphans.map((r) => h("a", { class: "card click", href: "#/runs/" + r.id, style: r.status === "running" ? null : { borderColor: "var(--warn)" } },
        h("div", { class: "row" }, h("b", {}, r.ws_name), h("span", { class: "sp" }), statusChip(r.status)),
        h("div", { class: "small", style: { margin: "6px 0" } }, fmt.short(r.prompt, 110)),
        h("div", { class: "small mut" }, r.status === "running" ? ["El coordinador está planificando… lleva ", since(r.started)] : r.status === "blocked" ? "Se abortó por un permiso denegado antes de crear workers." : r.status === "done" ? "Terminó sin crear un enjambre visible." : "No llegó a crear workers."))))) : null);
    const r = o;
    const s = JSON.stringify(r.data.swarms.map((x) => [x.id, x.updated, x.members.map((m) => m.state)]));
    if (s === sig) return; sig = s; all = r.data.swarms; paint();
  }, 2500);
}

function usagePanel(d) {
  const u = d.usage, est = d.plan?.tokens, budget = d.token_budget || 0;
  if (!u && !budget && !est) return null;
  const total = u?.total || 0, pct = budget ? Math.min(100, (total / budget) * 100) : 0, over = budget && total > budget;
  const agents = Object.entries(u?.by_agent || {});
  return h("div", { class: "card mt" },
    h("div", { class: "row wrap" }, h("h2", {}, "Consumo de tokens"), h("span", { class: "sp" }), d.plan?.effort ? h("span", { class: "chip acc" }, "Esfuerzo " + d.plan.effort + (d.plan.manual ? " (estimado)" : "")) : null),
    h("div", { class: "row wrap", style: { alignItems: "baseline", margin: "8px 0" } }, h("b", { style: { fontSize: "30px", letterSpacing: "-.02em" } }, u ? fmt.tok(total) : "midiendo…"),
      h("span", { class: "mut" }, budget ? ` de ${fmt.tok(budget)} de presupuesto` : " (sin presupuesto)"), est && u ? h("span", { class: "chip " + (total > est.high ? "bad" : total > est.estimate * 1.2 ? "warn" : "ok"), title: est.basis }, `estimado ≈ ${fmt.tok(est.estimate)} · real ${(total / Math.max(1, est.estimate)).toFixed(1).replace(".", ",")}×`) : null),
    d.status === "running" && budget && pct >= 80 ? h("div", { class: "banner warn", style: { marginTop: "8px" } }, "Cerca del límite de presupuesto: si se corta, el trabajo hecho se conserva y podrás reanudarlo con un solo agente.") : null,
    budget ? h("div", { class: "bar", role: "progressbar", "aria-valuenow": Math.round(pct), "aria-valuemin": 0, "aria-valuemax": 100, "aria-label": "Presupuesto de tokens consumido" }, h("i", { class: over || pct > 80 ? "q" : "w", style: { width: pct + "%" } })) : null,
    u ? h("div", { class: "small mut", style: { marginTop: "8px" } }, `Entrada ${fmt.tok(u.in)} · salida ${fmt.tok(u.out)} · ${u.steps} pasos de modelo · caché ${fmt.tok(u.cache)} (aparte: se factura distinto)`) : null,
    agents.length > 1 ? h("table", { class: "mt-s" }, h("thead", {}, h("tr", {}, h("th", {}, "Agente"), h("th", {}, "Entrada"), h("th", {}, "Salida"), h("th", {}, "Pasos"))),
      h("tbody", {}, agents.sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out)).map(([n, x]) => h("tr", {}, h("td", {}, n), h("td", {}, fmt.tok(x.in)), h("td", {}, fmt.tok(x.out)), h("td", {}, x.steps))))) : null);
}

// ============================================================ EJECUCIONES
async function RunDetail(ctx, id) {
  document.title = "Ejecución · Ant";
  const top = h("div"), banners = h("div"), result = h("div"), logbox = h("pre", { class: "log", tabindex: "0", "aria-label": "Salida del agente" }, "Cargando…"), taskBox = h("div");
  let wrap = true, sigs = {};
  const wrapBtn = h("button", { class: "btn ghost sm", "aria-pressed": "true", onclick: () => { wrap = !wrap; logbox.classList.toggle("nowrapl", !wrap); wrapBtn.setAttribute("aria-pressed", String(wrap)); } }, "Ajustar líneas");
  let logText = "";
  const usageBox = h("div"), resumeBox = h("div");
  put(ctx.root, h("a", { href: "#/runs", class: "small" }, "← Lanzamientos"), top, banners, resumeBox, usageBox, result,
    h("div", { class: "row mt mb" }, h("h2", {}, "Salida"), h("span", { class: "sp" }), wrapBtn, h("button", { class: "btn ghost sm", onclick: () => copy(logText, "Salida copiada") }, "Copiar"), h("button", { class: "btn ghost sm", onclick: () => (logbox.scrollTop = logbox.scrollHeight) }, "Ir al final")),
    logbox, h("details", { class: "mt" }, h("summary", { class: "b", style: { cursor: "pointer" } }, "Tarea enviada"), taskBox));
  const changed = (k, v) => { const s = JSON.stringify(v); if (sigs[k] === s) return false; sigs[k] = s; return true; };
  async function rerunWith(extra) {
    const r = await api("/api/run/rerun", { id, ...extra });
    if (!r.ok) return toast(r.data.error, "bad");
    toast("Relanzada con los permisos ampliados", "ok"); cache.clear(); go("#/runs/" + r.data.id);
  }
  async function doResume(budget) {
    const r = await api("/api/run/resume", { id, token_budget: budget || undefined });
    if (!r.ok) return toast(r.data.error, "bad");
    toast("Reanudada con un solo agente sobre el trabajo ya hecho", "ok"); cache.clear(); go("#/runs/" + r.data.id);
  }
  function resumeCard(d) {
    const n = (d.commits || []).length, files = (d.diffstat || "").split("\n").filter((l) => l.includes("|")).length;
    const sug = Math.max(40000, Math.round(((d.token_budget || 80000) * 0.6) / 10000) * 10000);
    const bud = h("input", { type: "number", min: 10000, step: 10000, value: sug, style: { maxWidth: "140px" }, "aria-label": "Presupuesto de tokens de la reanudación" });
    return h("div", { class: "card mb", style: { borderColor: "var(--acc)" } },
      h("h2", {}, "🧩 Trabajo parcial conservado"),
      h("p", { class: "small", style: { margin: "6px 0 10px" } }, `La ejecución se interrumpió, pero su copia aislada conserva ${n} commit${n === 1 ? "" : "s"}${files ? ` y ${files} archivo${files === 1 ? "" : "s"} cambiado${files === 1 ? "" : "s"}` : ""}. ` +
        "Reanudar lanza UN solo agente (más barato que el enjambre) en esa misma copia, con un resumen automático de lo ya hecho —commits, archivos y los últimos mensajes del tablero— para que continúe sin repetir nada."),
      h("div", { class: "row wrap" }, h("div", { class: "field" }, h("label", {}, "Presupuesto de tokens"), bud), h("span", { class: "sp" }),
        h("button", { class: "btn pri", onclick: (e) => { e.currentTarget.disabled = true; doResume(+bud.value); } }, "▶ Reanudar con un agente")));
  }
  async function act(kind) {
    if (kind === "stop") { if (!(await confirmDialog({ title: "Detener la ejecución", body: "El agente se interrumpirá. Lo que ya haya hecho en su copia se conserva.", ok: "Detener", danger: true }))) return; const r = await api("/api/run/stop", { id }); toast(r.ok ? "Deteniendo…" : r.data.error, r.ok ? "" : "bad"); }
    if (kind === "rerun") { const r = await api("/api/run/rerun", { id }); if (!r.ok) return toast(r.data.error, "bad"); toast("Relanzada con la misma configuración", "ok"); cache.clear(); go("#/runs/" + r.data.id); }
    if (kind === "discard") {
      let r = await api("/api/run/discard", { id });
      if (!r.ok && /sin integrar/.test(r.data.error || "")) {
        if (!(await confirmDialog({ title: "Descartar trabajo sin integrar", body: "La copia aislada tiene commits o cambios que no has integrado. Si la descartas, se pierden.", ok: "Descartar de todas formas", danger: true }))) return;
        r = await api("/api/run/discard", { id, force: true });
      }
      if (!r.ok) return toast(r.data.error, "bad");
      toast("Descartada"); cache.clear(); go("#/launch");
    }
  }
  ctx.every(async () => {
    const r = await api("/api/run/" + id); if (!ctx.alive()) return;
    if (!r.ok) { put(top, h("div", { class: "banner bad mt" }, "Esta ejecución ya no existe (¿la descartaste?). ", h("a", { href: "#/launch" }, "Volver al lanzador"))); return; }
    const d = r.data, running = d.status === "running";
    if (changed("top", [d.status, d.ended, d.id])) {
      put(top, h("div", { class: "page-head mt-s" },
        h("div", {}, h("div", { class: "row wrap" }, statusChip(d.status), h("h1", {}, d.ws_name)),
          h("p", { class: "sub" }, running ? ["Lleva ", since(d.started)] : d.ended ? "Duró " + fmt.dur(d.ended - d.started) : "", " · iniciada ", agoEl(d.started))),
        h("span", { class: "sp" }),
        running ? h("button", { class: "btn danger", onclick: () => act("stop") }, "■ Detener") : null,
        h("button", { class: "btn", onclick: () => act("rerun") }, "↻ Relanzar"),
        !running ? h("button", { class: "btn", onclick: () => act("discard") }, "Descartar") : null),
        h("div", { class: "chips mb" }, [d.linked_deps && d.linked_deps.length ? "🔗 node_modules enlazado" : null, d.resumed_from ? "↻ reanudada" : null, d.adopted_by ? "cedió su copia a otra ejecución" : null, d.swarm ? "🐜 enjambre" : null, d.team ? "equipo: " + d.team : null, d.role ? "rol: " + d.role : null, d.model || "modelo por defecto", d.swarm && d.workers_model ? "workers: " + d.workers_model : null, d.mode || "modo predeterminado",
          d.isolation === "worktree" ? "rama " + d.branch : "sin aislar", d.auto_approve ? "⚠ todos los permisos" : d.allow_commands ? "comandos habituales" : null].filter(Boolean).map((t) => h("span", { class: "chip" }, t))));
    }
    if (changed("usage", [d.usage, d.token_budget, d.plan, d.status])) put(usageBox, usagePanel(d));
    if (changed("resume", [d.resumable, d.status, d.commits, d.diffstat])) put(resumeBox, d.resumable ? resumeCard(d) : null);
    if (changed("ban", d.status)) put(banners,
      d.status === "budget" ? h("div", { class: "banner warn mb" }, `Se detuvo al superar el presupuesto de ${fmt.tok(d.token_budget)} tokens (consumió ${fmt.tok(d.usage?.total || 0)}: el corte llega con el margen de un paso de agente). Lo hecho en su copia se conserva.`) : null,
      d.status === "blocked" ? h("div", { class: "banner warn mb", style: { flexDirection: "column", alignItems: "stretch" } },
        h("div", {}, h("b", {}, "El agente intentó ejecutar un comando que no tenía permitido y la ejecución se abortó. "), "En modo headless no se puede preguntar, y los tokens ya gastados (", fmt.tok(d.usage?.total || 0), ") se pierden. Nunca llegó a crear workers."),
        d.blocked_cmd ? h("div", { class: "small", style: { margin: "6px 0" } }, "Comando denegado: ", h("code", {}, d.blocked_cmd)) : null,
        h("div", { class: "row wrap", style: { marginTop: "4px" } },
          h("button", { class: "btn pri sm", onclick: () => rerunWith({ allow_dev: true }) }, "↻ Relanzar permitiendo scripts del proyecto"),
          h("button", { class: "btn danger sm", onclick: async () => { if (await confirmDialog({ title: "Aprobar todos los permisos", body: "El agente podrá ejecutar CUALQUIER comando sin pedirte permiso (en su copia aislada, pero con acceso a tu usuario). ¿Relanzar así?", ok: "Relanzar con todos los permisos", danger: true })) rerunWith({ auto_approve: true }); } }, "↻ Relanzar con todos los permisos ⚠"),
          d.isolation === "worktree" ? h("span", { class: "xs mut" }, "La copia aislada quedó sin cambios: puedes descartarla.") : null)) : null,
      d.status === "timeout" ? h("div", { class: "banner warn mb" }, "Se agotó el tiempo máximo y la respuesta quedó incompleta. Sube el tiempo y relanza.") : null,
      d.status === "quota" ? h("div", { class: "banner warn mb" }, "Cuota de Antigravity agotada" + (d.quota_reset ? `: se reinicia en ${d.quota_reset}` : "") + ". Relanza más tarde o con un modelo Gemini.") : null,
      d.deps_modified ? h("div", { class: "banner bad mb" }, h("div", {}, h("b", {}, "⚠ El agente modificó las dependencias compartidas. "), "Su copia tiene node_modules ENLAZADOS a los de tu carpeta principal, y algo cambió en ellos (¿un install/add/remove?). Revisa tu carpeta principal: `git status` y el lockfile, y reinstala si hace falta.")) : null,
      d.status === "lost" ? h("div", { class: "banner bad mb" }, "El proceso desapareció sin dejar resultado (¿se reinició el equipo?).") : null,
      d.swarm ? h("div", { class: "banner info mb" }, "Es un enjambre: sigue a cada agente y el tablero en ", h("a", { href: "#/swarms" }, "Enjambres"), ".") : null,
      d.ws_dirty && d.isolation === "worktree" ? h("div", { class: "banner mb" }, "El workspace tenía cambios sin commit. La copia aislada parte del último commit y no los incluye.") : null);
    if (d.log !== logText) {
      const atBottom = logbox.scrollHeight - logbox.scrollTop - logbox.clientHeight < 40;
      logText = d.log; put(logbox, d.log || "(sin salida todavía)");
      if (atBottom) logbox.scrollTop = logbox.scrollHeight;
    }
    if (changed("task", d.prompt)) put(taskBox, h("pre", { style: { marginTop: "8px" } }, d.prompt));
    if (changed("res", [d.status, d.commits, d.diffstat, d.untracked]) && d.isolation === "worktree" && !running) {
      put(result, h("h2", { class: "mt mb" }, "Resultado en la rama"),
        h("div", { class: "card" },
          (d.commits || []).length ? h("div", {}, h("div", { class: "lbl" }, `${d.commits.length} commit${d.commits.length > 1 ? "s" : ""}`), h("div", { class: "small", style: { marginTop: "4px" } }, d.commits.map((c) => h("div", {}, h("code", {}, c.slice(0, 7)), " " + c.slice(8))))) : h("div", { class: "small mut" }, "El agente no hizo commits."),
          d.diffstat ? h("pre", { style: { marginTop: "10px" } }, d.diffstat) : null,
          (d.untracked || []).length ? h("div", { class: "small mut mt-s" }, "Sin añadir a git: " + d.untracked.join(", ")) : null,
          d.merge_cmd ? h("div", { class: "mt" }, h("div", { class: "lbl", style: { marginBottom: "4px" } }, "Cuando lo hayas revisado, para integrarlo en tu rama:"), h("div", { class: "row" }, h("code", { style: { flex: 1, overflow: "auto", padding: "8px 10px" } }, d.merge_cmd), h("button", { class: "btn sm", onclick: () => copy(d.merge_cmd, "Comando copiado") }, "Copiar"))) : null,
          h("div", { class: "xs mut mt-s" }, "Carpeta de trabajo: ", h("code", {}, d.cwd))));
    } else if (running && changed("resclear", 1)) put(result);
  }, 2000);
}

// ============================================================ WORKSPACES
async function Workspaces(ctx) {
  document.title = "Workspaces · Ant";
  const body = h("div"), search = h("input", { type: "search", placeholder: "Buscar proyecto…", "aria-label": "Buscar proyecto", style: { maxWidth: "260px" } });
  put(ctx.root, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Workspaces"), h("p", { class: "sub" }, "Proyectos de Antigravity (con o sin git), del IDE, del CLI y los que añadas aquí.")), h("span", { class: "sp" }), search,
    h("button", { class: "btn pri", onclick: () => addDialog(() => paint(true)) }, "+ Añadir o crear carpeta")), body);
  let all = [], sig = "";
  async function paint(force) {
    if (force) { cache.clear(); all = await loadWs(); }
    const q = search.value.trim().toLowerCase(), f = (w) => !q || (w.name + " " + w.path).toLowerCase().includes(q);
    const lost = all.filter((w) => w.missing_file), ws = all.filter((w) => !w.missing_file && f(w)), here = ws.filter((w) => w.exists), gone = ws.filter((w) => !w.exists);
    const row = (w) => h("tr", {},
      h("td", {}, h("div", { class: "b" }, w.name), h("div", { class: "chips", style: { marginTop: "3px" } }, w.sources.map((s) => h("span", { class: "chip" }, s)), w.exists ? h("span", { class: "chip " + (w.has_git ? "ok" : "warn") }, w.has_git ? "git" : "sin git") : null)),
      h("td", { class: "mut xs", style: { wordBreak: "break-all" } }, w.path),
      h("td", {}, w.installed ? h("span", { class: "chip ok" }, "roles instalados") : h("span", { class: "chip" }, "sin roles")),
      h("td", { style: { textAlign: "right" } }, h("div", { class: "row", style: { justifyContent: "flex-end", flexWrap: "wrap", gap: "6px" } },
        w.exists ? h("button", { class: "btn pri sm", onclick: () => { store.set("launch", { ...store.get("launch", {}), ws: w.path }); go("#/launch"); } }, "🚀 Lanzar aquí") : null,
        w.exists ? h("button", { class: "btn sm", onclick: () => installDialog(w, () => paint(true)) }, w.installed ? "Actualizar roles" : "Instalar roles") : null,
        w.installed ? h("button", { class: "btn ghost sm", onclick: () => uninstall(w, () => paint(true)) }, "Quitar roles") : null,
        w.manual ? h("button", { class: "btn ghost sm", title: "Quita la carpeta de la lista de Ant (no la borra del disco)", onclick: async () => { const r = await api("/api/workspace/remove", { path: w.path }); toast(r.ok ? "Sacada de Ant (la carpeta sigue en disco)" : r.data.error, r.ok ? "" : "bad"); paint(true); } }, "Sacar de Ant") : null)));
    const head = h("tr", {}, h("th", {}, "Proyecto"), h("th", {}, "Carpeta"), h("th", {}, "Roles"), h("th", {}));
    put(body,
      lost.length ? h("div", { class: "banner warn mb" }, h("span", {}, "⚠"), h("div", {}, h("b", {}, "Workspaces del IDE cuyo archivo .code-workspace ya no existe"),
        h("div", { class: "small", style: { margin: "4px 0" } }, "El IDE los recuerda, pero sin el archivo Ant no sabe qué carpetas contienen. Guárdalos de nuevo en una carpeta tuya (Archivo → Guardar espacio de trabajo como…), nunca dentro de ~/.gemini."),
        lost.map((w) => h("div", { class: "xs" }, h("b", {}, w.name), " · ", h("code", {}, w.path))))) : null,
      here.length ? h("div", { class: "card", style: { padding: "6px 14px" } }, h("table", { class: "rtable" }, h("thead", {}, head), h("tbody", {}, here.map(row)))) :
        h("div", { class: "card empty" }, h("div", { class: "big" }, "📁"), h("b", {}, q ? "Ningún proyecto coincide" : "No hay workspaces existentes"), q ? null : h("p", {}, "Añade una carpeta de proyecto para empezar.")),
      gone.length ? h("details", { class: "mt" }, h("summary", { class: "mut small", style: { cursor: "pointer" } }, `${gone.length} registrados cuya carpeta ya no existe (movidos, borrados o en un USB desconectado)`),
        h("div", { class: "card mt-s", style: { padding: "6px 14px" } }, h("table", { class: "rtable" }, h("thead", {}, head), h("tbody", {}, gone.map(row))))) : null);
  }
  search.addEventListener("input", () => paint());
  all = await loadWs(); if (!ctx.alive()) return; paint();
  ctx.every(async () => { const w = await loadWs(); if (!ctx.alive()) return; const s = JSON.stringify(w.map((x) => [x.path, x.installed, x.exists])); if (s !== sig) { sig = s; all = w; paint(); } }, 4000);
}
async function installDialog(w, done) {
  const [{ roles, categories }, teams] = await Promise.all([loadRoles(), loadTeams()]);
  const chosen = new Set(roles.map((r) => r.name));
  const info = h("span", { class: "small mut" }), list = h("div"), presets = h("div", { class: "pickers" });
  const paint = () => {
    put(info, `${chosen.size} de ${roles.length} roles seleccionados`);
    put(list, categories.map((c) => { const rs = roles.filter((r) => r.category === c); return rs.length ? h("div", { style: { marginBottom: "12px" } }, h("div", { class: "lbl", style: { marginBottom: "4px" } }, c),
      h("div", { class: "grid", style: { gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: "4px 14px" } }, rs.map((r) => h("label", { class: "check small" }, h("input", { type: "checkbox", checked: chosen.has(r.name), onchange: (e) => { e.target.checked ? chosen.add(r.name) : chosen.delete(r.name); put(info, `${chosen.size} de ${roles.length} roles seleccionados`); } }), h("span", {}, r.icon + " " + r.title))))) : null; }));
    put(presets, h("button", { onclick: () => { roles.forEach((r) => chosen.add(r.name)); paint(); } }, "Todos"), h("button", { onclick: () => { chosen.clear(); paint(); } }, "Ninguno"), teams.map((t) => h("button", { onclick: () => { chosen.clear(); t.roles.forEach((n) => chosen.add(n)); paint(); } }, `${t.icon} ${t.name}`)));
  };
  paint();
  const m = modal({ title: "Instalar roles en " + w.name, wide: true,
    body: h("div", {}, h("p", { class: "small mut", style: { marginBottom: "10px" } }, "Se crea la skill ", h("code", {}, ".agents/skills/team-roles/SKILL.md"), " en el proyecto. El coordinador de un swarm iniciado desde Antigravity la usará para formar su equipo. Elige todos los roles, un equipo, o los que quieras."), h("div", { class: "lbl", style: { marginBottom: "6px" } }, "Atajos"), presets, h("div", { class: "mt" }, list)),
    actions: [info, h("span", { class: "sp" }), h("button", { class: "btn", onclick: () => m.close() }, "Cancelar"),
      h("button", { class: "btn pri", onclick: async () => { if (!chosen.size) return toast("Elige al menos un rol", "bad"); const r = await api("/api/install", { path: w.path, roles: [...chosen] }); m.close(); toast(r.ok ? `Roles instalados en ${w.name}` : r.data.error, r.ok ? "ok" : "bad"); done && done(); } }, "Instalar")] });
}
async function uninstall(w, done) {
  if (!(await confirmDialog({ title: "Quitar los roles de Ant", body: `Se borrará la skill team-roles de ${w.name}. El resto de tu proyecto no se toca.`, ok: "Quitar", danger: true }))) return;
  const r = await api("/api/uninstall", { path: w.path }); toast(r.ok ? "Roles quitados" : r.data.error, r.ok ? "" : "bad"); done && done();
}
function addDialog(done) {
  const pathIn = h("input", { type: "text", placeholder: "/home/…/mi-proyecto", "aria-label": "Ruta de la carpeta" }), create = h("input", { type: "checkbox" });
  const m = modal({ title: "Añadir o crear carpeta", body: h("div", { class: "col" },
    h("p", { class: "small mut" }, "Ruta absoluta de un proyecto que no aparece en la lista, o de una carpeta nueva. Debe estar dentro de tu home, /media o /mnt. También sirve un archivo ", h("code", {}, ".code-workspace"), "."), pathIn,
    h("label", { class: "check" }, create, h("span", {}, "Crear la carpeta si no existe e inicializar git ", h("span", { class: "hint" }, "(necesario para lanzar agentes en copias aisladas)")))),
  actions: [h("button", { class: "btn", onclick: () => m.close() }, "Cancelar"), h("button", { class: "btn pri", onclick: async () => { const r = await api("/api/workspace/add", { path: pathIn.value.trim(), create: create.checked }); if (!r.ok) return toast(r.data.error, "bad"); m.close(); toast(r.data.note || "Carpeta añadida", "ok"); done && done(); } }, "Añadir")] });
  pathIn.focus();
}

// ============================================================ ROLES Y EQUIPOS
function showRole(r) {
  const m = modal({ title: `${r.icon} ${r.title}`, wide: true,
    body: h("div", {}, h("div", { class: "chips mb" }, h("span", { class: "chip acc" }, r.category), h("span", { class: "chip" }, r.writes ? "✍️ escribe código" : "👀 solo lee"), h("span", { class: "chip" }, "workspace: " + r.workspace), h("span", { class: "chip" }, r.source === "propio" ? "propio" : "incluido"), h("code", {}, r.name)),
      h("p", { style: { marginBottom: "12px" } }, h("b", {}, "Cuándo usarlo: "), r.summary || "—"),
      h("div", { class: "lbl", style: { marginBottom: "4px" } }, "Plantilla de brief"), h("pre", {}, r.brief),
      h("p", { class: "hint mt-s" }, "Los textos entre <…> son marcadores: el coordinador (o tú) los rellena con datos reales del proyecto.")),
    actions: [
      r.editable ? h("button", { class: "btn danger", onclick: async () => { if (!(await confirmDialog({ title: "Borrar rol", body: `Se borrará «${r.title}». Esto no se puede deshacer.`, ok: "Borrar", danger: true }))) return; const x = await api("/api/roles/delete", { name: r.name }); m.close(); cache.clear(); toast(x.ok ? "Rol borrado" : x.data.error, x.ok ? "" : "bad"); route(); } }, "Borrar") : null,
      h("span", { class: "sp" }),
      h("button", { class: "btn", onclick: () => copy(r.brief, "Brief copiado") }, "Copiar brief"),
      h("button", { class: "btn", onclick: () => { m.close(); roleEditor(r.editable ? r : { ...r, name: r.name + "-copia", title: r.title + " (copia)" }, !r.editable); } }, r.editable ? "Editar" : "Duplicar para editar"),
      h("button", { class: "btn pri", onclick: () => { m.close(); store.set("launch", { ...store.get("launch", {}), kind: "single", role: r.name, modeTouched: false, permsTouched: false, modelTouched: false }); go("#/launch"); } }, "🚀 Probar este rol")] });
}
const ICONS = ["🤖", "🎨", "🧭", "✍️", "🖥️", "🔌", "🗄️", "🧹", "📱", "🍎", "🧳", "🔄", "🛡️", "⚡", "🐞", "🚀", "📦", "🧪", "🔍", "📋", "🏛️", "📝", "🧠", "🎯"];
function roleEditor(r, isNew) {
  const { categories } = S.rolesMeta || { categories: ["Otros"] };
  const v = { name: r?.name || "", title: r?.title || "", icon: r?.icon || "🤖", category: r?.category || "Otros", summary: r?.summary || "", writes: !!r?.writes, workspace: r?.workspace || "inherit", brief: r?.brief || "" };
  const f = {};
  const err = h("div", { class: "banner bad", hidden: true });
  const field = (label, el, hint) => h("div", { class: "field" }, h("label", {}, label), el, hint ? h("div", { class: "hint" }, hint) : null);
  const m = modal({ title: isNew || !r?.editable ? "Nuevo rol" : "Editar rol", wide: true,
    body: h("div", { class: "col" }, err,
      h("div", { class: "grid g3" },
        field("Identificador", f.name = h("input", { type: "text", value: v.name, readOnly: !!(r?.editable), placeholder: "mi-rol", "aria-label": "Identificador" }), "minúsculas, números y guiones"),
        field("Nombre visible", f.title = h("input", { type: "text", value: v.title, placeholder: "Mi rol especializado" })),
        field("Icono", f.icon = h("input", { type: "text", value: v.icon, list: "icons", maxlength: 4 }))),
      h("datalist", { id: "icons" }, ICONS.map((i) => h("option", { value: i }))),
      h("div", { class: "grid g3" },
        field("Categoría", f.category = h("select", {}, categories.map((c) => h("option", { value: c, selected: c === v.category }, c)))),
        field("Workspace recomendado", f.workspace = h("select", {}, [["inherit", "inherit · solo lee"], ["share", "share · copia propia"], ["branch", "branch · clon aislado"]].map(([x, t]) => h("option", { value: x, selected: x === v.workspace }, t)))),
        h("label", { class: "check", style: { alignSelf: "end", paddingBottom: "8px" } }, f.writes = h("input", { type: "checkbox", checked: v.writes }), h("span", {}, "Este rol escribe código"))),
      field("Cuándo usarlo", f.summary = h("input", { type: "text", value: v.summary, placeholder: "p. ej.: hay que migrar una librería y comprobar equivalencia" })),
      field("Brief (la plantilla que recibe el agente)", f.brief = h("textarea", { style: { minHeight: "260px", fontFamily: "var(--mono)", fontSize: "13px" } }, v.brief), "Indica qué posee, qué NO debe tocar, cómo se comprueba que está hecho y qué publica al terminar. Usa <MARCADORES> para lo que varía.")),
    actions: [h("button", { class: "btn", onclick: () => m.close() }, "Cancelar"), h("button", { class: "btn pri", onclick: async () => {
      const r2 = await api("/api/roles/save", { name: f.name.value.trim(), title: f.title.value, icon: f.icon.value, category: f.category.value, summary: f.summary.value, writes: f.writes.checked, workspace: f.workspace.value, brief: f.brief.value });
      if (!r2.ok) { put(err, r2.data.error); err.hidden = false; return; }
      m.close(); cache.clear(); toast("Rol guardado", "ok"); route();
    } }, "Guardar")] });
  f.title.focus();
}
async function Roles(ctx, tabId) {
  document.title = "Roles y equipos · Ant";
  put(ctx.root, h("div", { class: "skel", style: { height: "200px" } }));
  const [rd, teams] = await Promise.all([loadRoles(), loadTeams()]); if (!ctx.alive()) return;
  S.rolesMeta = rd; const { roles, categories } = rd;
  let cat = "", tab = tabId;
  const search = h("input", { type: "search", placeholder: "Buscar rol…", "aria-label": "Buscar rol", style: { maxWidth: "260px" } });
  const body = h("div"), tabs = h("div", { class: "tabs", role: "tablist" });
  const paintTabs = () => put(tabs, [["roles", `Roles (${roles.length})`], ["teams", `Equipos (${teams.length})`]].map(([id, t]) => h("button", { role: "tab", "aria-selected": String(tab === id), onclick: () => { tab = id; history.replaceState(null, "", id === "teams" ? "#/roles?tab=teams" : "#/roles"); paintTabs(); paint(); } }, t)));
  function paint() {
    search.hidden = tab !== "roles";
    if (tab === "teams") return put(body, h("div", { class: "grid g2" }, teams.map((t) => h("div", { class: "card rolecard" },
      h("div", { class: "row" }, h("span", { class: "ic", style: { fontSize: "28px" } }, t.icon), h("div", {}, h("h3", {}, t.name), h("div", { class: "small mut" }, t.summary))),
      h("div", { class: "chips" }, t.roles.map((n) => { const r = roles.find((x) => x.name === n); return h("button", { class: "chip", style: { cursor: "pointer" }, title: r?.summary, onclick: () => r && showRole(r) }, `${r?.icon || "🤖"} ${r?.title || n}`); })),
      h("div", { class: "small" }, h("b", {}, "Orden de trabajo: "), t.flow),
      h("div", { class: "row", style: { marginTop: "auto" } }, h("span", { class: "sp" }), h("button", { class: "btn pri", onclick: () => { store.set("launch", { ...store.get("launch", {}), kind: "swarm", team: t.id, modeTouched: false, permsTouched: false, modelTouched: false }); go("#/launch"); } }, "🚀 Lanzar este equipo"))))));
    const q = search.value.trim().toLowerCase();
    const rs = roles.filter((r) => (!cat || r.category === cat) && (!q || (r.title + " " + r.summary + " " + r.name + " " + r.category).toLowerCase().includes(q)));
    put(body,
      h("div", { class: "pickers mb" }, h("button", { "aria-pressed": String(!cat), onclick: () => { cat = ""; paint(); } }, `Todos (${roles.length})`),
        categories.map((c) => { const n = roles.filter((r) => r.category === c).length; return n ? h("button", { "aria-pressed": String(cat === c), onclick: () => { cat = cat === c ? "" : c; paint(); } }, `${c} (${n})`) : null; })),
      rs.length ? h("div", { class: "grid g3" }, rs.map((r) => h("button", { class: "card click rolecard", style: { textAlign: "left", font: "inherit", color: "inherit" }, onclick: () => showRole(r) },
        h("div", { class: "row" }, h("span", { class: "ic" }, r.icon), h("span", { class: "sp" }), r.source === "propio" ? h("span", { class: "chip acc" }, "propio") : null, h("span", { class: "chip" }, r.writes ? "✍️ escribe" : "👀 lee")),
        h("b", {}, r.title), h("div", { class: "small mut" }, r.summary || "—")))) : h("div", { class: "card empty" }, h("div", { class: "big" }, "🔍"), h("b", {}, "Ningún rol coincide"), h("p", {}, "Prueba con otra búsqueda o crea uno propio.")));
  }
  search.addEventListener("input", paint);
  put(ctx.root, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Roles y equipos"), h("p", { class: "sub" }, "Agentes especializados reutilizables y combinaciones listas para lanzar un enjambre.")), h("span", { class: "sp" }), search,
    h("button", { class: "btn pri", onclick: () => roleEditor(null, true) }, "+ Nuevo rol")), tabs, body);
  paintTabs(); paint();
}


// ============================================================ LANZAMIENTOS (historial completo)
function runRowFull(r) {
  const tok = r.usage?.total, dur = r.ended ? fmt.dur(r.ended - r.started) : null;
  return h("a", { class: "item", href: "#/runs/" + r.id, dataset: { run: r.id } },
    h("span", { class: "dot " + r.status }),
    h("span", { style: { flex: 1, minWidth: 0 } },
      h("div", { class: "b" }, r.ws_name, r.swarm ? "  🐜 enjambre" : "", r.role ? h("span", { class: "chip", style: { marginLeft: "8px" } }, r.role) : null),
      h("div", { class: "small", style: { margin: "2px 0" } }, fmt.short(r.prompt, 150)),
      h("div", { class: "xs mut" }, [r.model, tok ? fmt.tok(tok) + " tokens" : null, r.status === "running" ? ["lleva ", since(r.started)] : dur ? "duró " + dur : null, r.id].filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x])))),
    h("span", { class: "chips" }, statusChip(r.status)), h("span", { class: "small mut nowrap" }, agoEl(r.started)));
}
async function Runs(ctx) {
  document.title = "Lanzamientos · Ant";
  const FILT = [["all", "Todos"], ["running", "En marcha"], ["done", "Terminadas"], ["issues", "Con problemas"], ["stopped", "Detenidas"]];
  const group = (r) => (r.status === "running" ? "running" : r.status === "done" ? "done" : r.status === "stopped" ? "stopped" : "issues");
  let f = store.get("runsFilter", "all"), shown = 40, all = [], sig = "";
  if (!FILT.some(([k]) => k === f)) f = "all";
  const search = h("input", { type: "search", placeholder: "Buscar por tarea, workspace, rol o modelo…", "aria-label": "Buscar lanzamiento", style: { maxWidth: "340px" } });
  const wsSel = h("select", { "aria-label": "Workspace", style: { maxWidth: "220px" }, onchange: () => { shown = 40; paint(); } }, h("option", { value: "" }, "Todos los workspaces"));
  const seg = h("div", { class: "seg", role: "group", "aria-label": "Filtrar por estado" }), list = h("div"), summary = h("div", { class: "small mut", "aria-live": "polite", style: { margin: "10px 0" } });
  put(ctx.root, h("div", { class: "page-head" }, h("div", {}, h("h1", {}, "Lanzamientos"), h("p", { class: "sub" }, "Todo lo que has lanzado desde Ant, del más reciente al más antiguo. Pulsa uno para ver su salida y su consumo.")), h("span", { class: "sp" }),
    h("a", { class: "btn pri", href: "#/launch" }, "+ Nuevo lanzamiento")),
    h("div", { class: "row mb", style: { gap: "10px", flexWrap: "wrap" } }, search, wsSel, seg), summary, list);
  const updWs = () => {
    const cur = wsSel.value, names = [...new Set(all.map((r) => r.ws_name))].sort((a, b) => a.localeCompare(b));
    wsSel.replaceChildren(h("option", { value: "" }, "Todos los workspaces"), ...names.map((n) => h("option", { value: n }, n))); wsSel.value = names.includes(cur) ? cur : "";
  };
  const paint = () => {
    const q = search.value.trim().toLowerCase(), w = wsSel.value;
    const base = all.filter((r) => (!w || r.ws_name === w) && (!q || [r.prompt, r.ws_name, r.role, r.model, r.id].some((x) => String(x || "").toLowerCase().includes(q))));
    const count = (k) => (k === "all" ? base.length : base.filter((r) => group(r) === k).length);
    put(seg, FILT.map(([k, lbl]) => h("button", { type: "button", "aria-pressed": String(f === k), dataset: { f: k }, onclick: () => { f = k; store.set("runsFilter", k); shown = 40; paint(); } }, lbl + " · " + count(k))));
    const rows = base.filter((r) => f === "all" || group(r) === f), vis = rows.slice(0, shown);
    summary.textContent = all.length ? `${rows.length} de ${all.length} lanzamientos` + (rows.reduce((n, r) => n + (r.usage?.total || 0), 0) ? " · " + fmt.tok(rows.reduce((n, r) => n + (r.usage?.total || 0), 0)) + " tokens medidos" : "") : "";
    if (!all.length) return put(list, h("div", { class: "card empty" }, h("div", { class: "big" }, "🚀"), h("b", {}, "Todavía no has lanzado nada"), h("p", {}, "Cuando lances un agente o un enjambre desde Ant, aparecerá aquí con su estado, su consumo y su salida."), h("a", { class: "btn pri", href: "#/launch" }, "Hacer el primer lanzamiento")));
    put(list, rows.length ? [h("div", { class: "card list", style: { padding: "6px 14px" } }, vis.map(runRowFull)),
      rows.length > vis.length ? h("div", { class: "row", style: { justifyContent: "center", marginTop: "12px" } }, h("button", { class: "btn", type: "button", id: "runs-more", onclick: () => { shown += 40; paint(); } }, `Mostrar más (${rows.length - vis.length} restantes)`)) : null]
      : h("div", { class: "empty" }, "Ningún lanzamiento coincide con los filtros."));
  };
  search.addEventListener("input", () => { shown = 40; paint(); });
  ctx.every(async () => {
    const r = await getc("/api/runs", 1500); if (!r.ok || !ctx.alive()) return;
    const s = JSON.stringify((r.data.runs || []).map((x) => [x.id, x.status, x.usage?.total, x.ended])); if (s === sig) return; sig = s; all = r.data.runs || []; updWs(); paint();
  }, 2500);
}


/* ---- estilo visual de la oficina del stream: el elegido se guarda en el servidor y la oficina (y OBS) cambian solas ---- */
const OFFICE_STYLES = [
  { id: "voxel", name: "Voxel", desc: "Bloques tipo Minecraft con luz cálida: el aspecto original." },
  { id: "toon", name: "Toon", desc: "Dibujo animado: contornos oscuros, colores planos y sombras por escalones." },
  { id: "cyber", name: "Cyberpunk", desc: "Neones magenta y cian, niebla violeta, brillo (bloom) y grano de película." },
];
async function officeStyleDialog() {
  const cur = await api("/api/office/style");
  let sel = cur.data.style || "voxel";
  const cards = OFFICE_STYLES.map((o) => h("label", { class: "stylecard", dataset: { style: o.id } },
    h("input", { type: "radio", name: "office-style", value: o.id, checked: o.id === sel }),
    h("img", { src: `/styles/${o.id}.jpg`, alt: "Vista previa del estilo " + o.name, loading: "lazy", width: 640, height: 360 }),
    h("span", { class: "sc-t" }, o.name), h("span", { class: "sc-d" }, o.desc)));
  const grid = h("div", { class: "stylegrid", role: "radiogroup", "aria-label": "Estilo visual de la oficina" }, cards);
  const mark = () => cards.forEach((c) => c.classList.toggle("on", $("input", c).checked));
  mark();
  grid.addEventListener("change", async (e) => {
    const v = e.target.value; mark();
    const r = await api("/api/office/style", { style: v });
    if (!r.ok) { toast(r.data.error || "No se pudo cambiar el estilo.", "bad"); const o = $(`input[value="${sel}"]`, grid); if (o) { o.checked = true; mark(); } return; }
    sel = v; toast("Estilo de la oficina: " + OFFICE_STYLES.find((x) => x.id === v).name + ". El stream (OBS) se actualiza solo.", "ok");
  });
  modal({ title: "🎨 Estilo de la oficina", wide: true, body: h("div", { class: "col" },
    h("p", { style: { color: "var(--mut)", fontSize: "14px" } }, "Se aplica al instante en la oficina abierta y en la fuente de navegador de OBS. Con ", h("code", {}, "?style=toon"), " en la URL se fuerza uno concreto solo en esa ventana."), grid) });
}
