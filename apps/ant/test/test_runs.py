#!/usr/bin/env python3
"""Prueba E2E del lanzador con agy falso y git real. Uso: python3 test/test_runs.py"""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
T = Path(tempfile.mkdtemp(prefix="ant-test-"))
PORT = 4597
ws = T / "ws"; ws.mkdir(); (T / "toolbin").mkdir()
def sh(*a, cwd=ws): return subprocess.run(a, cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()
sh("git", "init", "-q"); (ws / "a.txt").write_text("x\n"); sh("git", "add", "."); sh("git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
(T / "gemini/config/projects").mkdir(parents=True)
(T / "gemini/config/projects/p.json").write_text(json.dumps({"id": "p", "name": "demo", "projectResources": {"resources": [{"gitFolder": {"folderUri": f"file://{ws}"}}]}}))
nogit = T / "nogit"; nogit.mkdir()
(T / "gemini/config/projects/q.json").write_text(json.dumps({"id": "q", "name": "nogit", "projectResources": {"resources": [{"gitFolder": {"folderUri": f"file://{nogit}"}}]}}))

env = {**os.environ, "ANT_PORT": str(PORT), "ANT_GEMINI_DIR": str(T / "gemini"), "ANT_DATA": str(T / "data"),
       "ANT_AGY": str(HERE / "fake_agy.sh"), "ANT_MAX_RUNS": "2", "ANT_EXTRA_PATH": str(T / "toolbin"), "ANT_USER_ROLES": str(T / "ur"),
       "ANT_IDE_STORAGE": str(T / "ide.json"), "ANT_IDE_STATE_DB": str(T / "state.vscdb"), "ANT_WORKSPACES_FILE": str(T / "manual.json"), "ANT_OFFICE_FILE": str(T / "office.json"), "ANT_ALLOWED_ROOTS": str(T)}
srv = subprocess.Popen([sys.executable, str(ROOT / "server.py")], env=env, stdout=subprocess.DEVNULL)
fails = []
def check(name, cond, extra=""):
    print(("  ok  " if cond else "FALLA ") + name + (f"  [{extra}]" if (extra and not cond) else ""))
    if not cond: fails.append(name)
def call(path, body=None, hdr=True):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", data=json.dumps(body).encode() if body is not None else None,
                                 headers={"X-Ant": "1"} if hdr else {})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())
def wait(rid, want, secs=10):
    for _ in range(secs * 10):
        _, d = call(f"/api/run/{rid}")
        if d.get("status") in want: return d
        time.sleep(0.1)
    return d
WS = str(ws)
try:
    for _ in range(50):
        try: call("/api/status"); break
        except Exception: time.sleep(0.1)

    print("== validaciones")
    check("sin cabecera -> 403", call("/api/run", {"path": WS, "prompt": "x"}, hdr=False)[0] == 403)
    c, d = call("/api/run", {"path": "/etc", "prompt": "x"}); check("workspace ajeno -> 404", c == 404, d)
    c, d = call("/api/run", {"path": WS, "prompt": ""}); check("tarea vacía -> 400", c == 400, d)
    c, d = call("/api/run", {"path": WS, "prompt": "x", "model": "inventado"}); check("modelo desconocido -> 400", c == 400, d)
    c, d = call("/api/run", {"path": WS, "prompt": "x", "model": "Claude Sonnet 5.5 (Low)"}); check("nombre visible (no id) -> 400", c == 400, d)
    ms = call("/api/models")[1]["models"]; check("/api/models devuelve {id,name} sin cabecera", ms and ms[0] == {"id": "claude-opus-5-5-low", "name": "Claude Opus 5.5 (Low)"}, ms[:1])
    c, d = call("/api/run", {"path": WS, "prompt": "x", "mode": "rm -rf"}); check("modo inválido -> 400", c == 400, d)
    c, d = call("/api/run", {"path": WS, "prompt": "x", "role": "nope"}); check("rol desconocido -> 400", c == 400, d)
    c, d = call("/api/run", {"path": str(nogit), "prompt": "x", "isolation": "worktree"}); check("no-git + worktree -> 400", c == 400, d)
    check("no queda basura tras los rechazos", call("/api/runs")[1]["runs"] == [] and (not (T / "data/worktrees").exists() or not list((T / "data/worktrees").iterdir())))
    c, d = call("/api/run/..%2f..%2fetc", None); check("id con traversal -> 400", c == 400, d)

    print("== ejecución con worktree y commit")
    c, r = call("/api/run", {"path": WS, "prompt": "haz EDIT", "role": "reviewer", "model": "claude-sonnet-5-5-low", "mode": "accept-edits"})
    check("lanza 200", c == 200, r); rid = r.get("id")
    d = wait(rid, ("done", "failed"))
    check("termina done rc=0", d["status"] == "done" and d["rc"] == 0, d.get("status"))
    check("cwd es el worktree, no el workspace", f"cwd: {d['cwd']}" in d["log"] and d["cwd"] != WS and "worktrees" in d["cwd"])
    check("args correctos (--print/--model/--mode/--print-timeout)", all(x in d["log"] for x in ("--print", "--model claude-sonnet-5-5-low", "--mode accept-edits", "--print-timeout 30m")))
    check("brief del rol en el prompt", "Eres el revisor" in d["log"] and "## Rol" in d["log"] and "## Tarea" in d["log"])
    check("detecta commit de la rama", any("feat: hecho" in x for x in d.get("commits", [])), d.get("commits"))
    check("diffstat menciona hecho.txt", "hecho.txt" in d.get("diffstat", ""), d.get("diffstat"))
    check("el workspace NO se tocó", not (ws / "hecho.txt").exists() and sh("git", "status", "--porcelain") == "")
    check("merge_cmd presente", d["merge_cmd"] and d["branch"] in d["merge_cmd"])
    c, e = call("/api/run/discard", {"id": rid}); check("descartar con trabajo sin integrar -> 409", c == 409, e)
    c, e = call("/api/run/discard", {"id": rid, "force": True}); check("descartar con force -> 200", c == 200, e)
    check("worktree y rama eliminados", not Path(d["cwd"]).exists() and d["branch"] not in sh("git", "branch"))
    check("registro eliminado", call(f"/api/run/{rid}")[0] == 404)

    print("== cuota agotada")
    c, r = call("/api/run", {"path": WS, "prompt": "QUOTA", "isolation": "worktree"}); d = wait(r["id"], ("quota", "failed", "done"))
    check("estado quota + reinicio 1h15m23s", d["status"] == "quota" and d.get("quota_reset") == "1h15m23s", (d.get("status"), d.get("quota_reset")))
    c, e = call("/api/run/discard", {"id": r["id"]}); check("sin cambios: descarta sin force", c == 200, e)

    print("== parar, límite y sin aislar")
    c, a = call("/api/run", {"path": WS, "prompt": "SLOW"}); c2, b = call("/api/run", {"path": WS, "prompt": "SLOW"})
    check("dos lanzadas", c == 200 and c2 == 200, (a, b))
    c, e = call("/api/run", {"path": WS, "prompt": "SLOW"}); check("tercera -> 429 (límite 2)", c == 429, e)
    pid = a["pid"]
    c, e = call("/api/run/stop", {"id": a["id"]}); check("stop 200", c == 200, e)
    d = wait(a["id"], ("stopped", "failed", "done")); check("estado stopped", d["status"] == "stopped", d.get("status"))
    check("proceso muerto", not Path(f"/proc/{pid}").exists() or "Z" in Path(f"/proc/{pid}/stat").read_text().split(")")[1][:3])
    c, e = call("/api/run/stop", {"id": a["id"]}); check("stop repetido -> 409", c == 409, e)
    call("/api/run/stop", {"id": b["id"]}); wait(b["id"], ("stopped",))
    c, r = call("/api/run", {"path": WS, "prompt": "DIRTY", "isolation": "inherit"}); d = wait(r["id"], ("done",))
    check("inherit: cwd = workspace", d["cwd"] == WS and f"cwd: {WS}" in d["log"])
    c, e = call("/api/run/discard", {"id": r["id"]}); check("inherit descarta registro sin tocar el workspace", c == 200 and ws.is_dir())



    print("== observador: varios brains")
    cli = T / "gemini/antigravity-cli/brain/dddddddd-0000-0000-0000-000000000004/.system_generated"
    (cli / "swarm").mkdir(parents=True); (cli / "logs").mkdir()
    (cli / "swarm/members.json").write_text(json.dumps({"title": "swarm del CLI", "members": {}}))
    (cli / "swarm/board.jsonl").write_text(json.dumps({"seq": 1, "agent": "coordinator", "text": "hola", "time": "x"}) + "\n")
    (cli / "swarm/members.json").write_text(json.dumps({"title": "swarm del CLI", "members": {"coordinator": {"conversation_id": "dddddddd-0000-0000-0000-000000000004", "role": "coordinator", "model": "gemini-flash-worker-agy", "wait_since": None, "killed": False}}}))
    steps = [{"step_index": 0, "type": "USER_INPUT", "content": "<USER_REQUEST>\nuna tarea del CLI\n</USER_REQUEST>"},
             {"step_index": 1, "type": "PLANNER_RESPONSE", "model": "gemini-pro-orchestrator-g1-pro", "tool_calls": [{"name": "read_file", "args": {}}]},
             {"step_index": 2, "type": "PLANNER_RESPONSE", "model": "gemini-flash-worker-agy", "tool_calls": [{"name": "swarm", "args": {"action": "\"add\""}}]},
             {"step_index": 3, "type": "GENERIC", "content": "Created At: 2026-11-17T10:00:02-04:00 Completed At: x"}]
    (cli / "logs/transcript.jsonl").write_text("\n".join(json.dumps(x) for x in steps) + "\n")
    ov = call("/api/overview")[1]
    check("swarm del brain 'antigravity-cli' visible", [x["title"] for x in ov["swarms"]] == ["swarm del CLI"], ov["swarms"])
    check("conversación del CLI en recientes", any(c["first"] == "una tarea del CLI" for c in ov["recent"]), ov["recent"])
    c, d = call("/api/swarm/dddddddd-0000-0000-0000-000000000004"); check("detalle del swarm del CLI", c == 200 and d["head"] == 1, d)
    m0 = d["members"][0]
    check("actividad = herramienta en uso, no el resultado 'Created At'", m0["activity"] == "swarm: add", m0["activity"])
    check("modelos realmente usados (orchestrator -> flash)", m0["models_used"] == ["gemini-pro-orchestrator-g1-pro", "gemini-flash-worker-agy"], m0["models_used"])


    print("== enjambre con Orchestrator + permisos + estados nuevos")
    c, r = call("/api/run", {"path": WS, "prompt": "haz EDIT en dos archivos", "swarm": True, "workers_model": "gemini-4-hydrogen-low", "allow_commands": True, "mode": "plan"})
    check("lanza enjambre 200", c == 200, r); d = wait(r["id"], ("done", "failed", "blocked"))
    log = d["log"]
    check("modelo por defecto = Orchestrator (Argon)", "--model gemini-pro-orchestrator-g1-pro" in log, log[:300])
    check("el prompt empieza por /swarm", "args: --print /swarm haz EDIT" in log, log[:300])
    check("workers en Hydrogen indicado en el prompt", "deben correr en el modelo gemini-4-hydrogen-low" in log)
    check("modo plan se sube a accept-edits en enjambre", "--mode accept-edits" in log and d["mode"] == "accept-edits")
    check("--settings con permisos JSON válido y sin skip-permissions", "--dangerously-skip-permissions" not in log and '"command(git status)"' in log)
    call("/api/run/discard", {"id": r["id"], "force": True})
    c, r = call("/api/run", {"path": WS, "prompt": "swarm", "swarm": True, "model": "inventado"}); check("modelo de coordinador desconocido -> 400", c == 400, r)
    c, r = call("/api/run", {"path": WS, "prompt": "BLOCKED"}); d = wait(r["id"], ("blocked", "done", "failed"))
    check("rc=0 sin salida por permisos -> 'blocked' (no 'done')", d["status"] == "blocked", d["status"]); call("/api/run/discard", {"id": r["id"], "force": True})
    c, r = call("/api/run", {"path": WS, "prompt": "TIMEOUT"}); d = wait(r["id"], ("timeout", "done", "failed"))
    check("print timeout -> 'timeout'", d["status"] == "timeout", d["status"]); call("/api/run/discard", {"id": r["id"], "force": True})


    print("== workspaces: todas las fuentes + alta manual")
    folder_only = T / "plain"; folder_only.mkdir()
    (T / "gemini/config/projects/r.json").write_text(json.dumps({"id": "r", "name": "sin-git", "projectResources": {"resources": [{"folderUri": f"file://{folder_only}"}]}}))
    cliws = T / "cliws"; cliws.mkdir()
    (T / "gemini/projects.json").write_text(json.dumps({"projects": {str(cliws): "cliws"}}))
    idews = T / "idews"; idews.mkdir()
    (T / "ide.json").write_text(json.dumps({"profileAssociations": {"workspaces": {f"file://{idews}": "x", "file:///no/existe/jamas": "y"}}}))
    perdido = T / "builtin" / "apps_perdido.code-workspace"   # el IDE lo recuerda pero el archivo no existe
    guardado = T / "apps_ok.code-workspace"; carpeta_a = T / "fa"; carpeta_a.mkdir()
    guardado.write_text(json.dumps({"folders": [{"path": "fa"}, {"path": "no_existe_b"}]}))
    ide = json.loads((T / "ide.json").read_text())
    ide["backupWorkspaces"] = {"workspaces": [{"id": "x", "configURIPath": f"file://{perdido}"}]}
    ide["windowsState"] = {"lastActiveWindow": {"workspaceIdentifier": {"id": "x", "configURIPath": f"file://{perdido}"}}}
    (T / "ide.json").write_text(json.dumps(ide))
    import sqlite3
    db = sqlite3.connect(T / "state.vscdb"); db.execute("create table ItemTable (key text unique, value blob)")
    db.execute("insert into ItemTable values ('history.recentlyOpenedPathsList', ?)", (json.dumps({"entries": [
        {"workspace": {"id": "g", "configPath": f"file://{guardado}"}}, {"folderUri": f"file://{T / 'reciente_sqlite'}"}]}),))
    db.commit(); db.close(); (T / "reciente_sqlite").mkdir()
    wl = {w["path"]: w for w in call("/api/overview")[1]["workspaces"]}
    check(".code-workspace inexistente se muestra con aviso (missing_file)", str(perdido) in wl and wl[str(perdido)]["missing_file"] and not wl[str(perdido)]["exists"], wl.get(str(perdido)))
    check("los perdidos van los primeros", call("/api/overview")[1]["workspaces"][0]["path"] == str(perdido))
    check("carpeta recordada por el SQLite de recientes", str(T / "reciente_sqlite") in wl and wl[str(T / "reciente_sqlite")]["sources"] == ["IDE"], list(wl))
    check(".code-workspace existente se expande a sus carpetas", str(carpeta_a) in wl and wl[str(carpeta_a)]["exists"] and not any(w["missing_file"] for w in [wl[str(carpeta_a)]]), list(wl))
    c, e = call("/api/workspace/add", {"path": str(guardado)}); check("añadir un .code-workspace existente -> 200", c == 200, e)
    c, e = call("/api/workspace/remove", {"path": str(guardado)}); check("y se puede sacar", c == 200, e)
    wl = {w["path"]: w for w in call("/api/overview")[1]["workspaces"]}
    check("proyecto con folderUri (sin git) visible", str(folder_only) in wl and wl[str(folder_only)]["sources"] == ["Antigravity"], list(wl))
    check("registro del CLI visible", str(cliws) in wl and wl[str(cliws)]["sources"] == ["CLI"])
    check("workspace del IDE visible", str(idews) in wl and wl[str(idews)]["sources"] == ["IDE"])
    check("existentes antes que los que no existen", (lambda L: L == sorted(L, reverse=True))([w["exists"] for w in call("/api/overview")[1]["workspaces"] if not w["missing_file"]]))
    c, e = call("/api/workspace/add", {"path": "relativa/x"}); check("ruta relativa -> 400", c == 400, e)
    c, e = call("/api/workspace/add", {"path": "/etc"}); check("fuera de las raíces permitidas -> 400", c == 400, e)
    c, e = call("/api/workspace/add", {"path": str(T / "../../etc")}); check("traversal -> 400", c == 400, e)
    nuevo = T / "proj" / "nuevo"
    c, e = call("/api/workspace/add", {"path": str(nuevo)}); check("no existe sin create -> 404", c == 404 and not nuevo.exists(), e)
    c, e = call("/api/workspace/add", {"path": str(nuevo), "create": True}); check("crea carpeta + git + commit inicial", c == 200 and (nuevo / ".git").is_dir(), e)
    wl = {w["path"]: w for w in call("/api/overview")[1]["workspaces"]}
    check("el creado aparece con fuente Ant, git y manual", str(nuevo) in wl and wl[str(nuevo)]["sources"] == ["Ant"] and wl[str(nuevo)]["has_git"] and wl[str(nuevo)]["manual"], wl.get(str(nuevo)))
    c, e = call("/api/run", {"path": str(nuevo), "prompt": "EDIT en el nuevo", "isolation": "worktree"}); d = wait(e["id"], ("done", "failed")) if c == 200 else e
    check("se puede lanzar un agente en worktree sobre el creado", c == 200 and d["status"] == "done", d)
    if c == 200: call("/api/run/discard", {"id": e["id"], "force": True})
    c, e = call("/api/workspace/remove", {"path": str(folder_only)}); check("no se puede sacar uno que no es de Ant -> 409", c == 409, e)
    c, e = call("/api/workspace/remove", {"path": str(nuevo)}); check("sacar de Ant 200", c == 200, e)
    check("sacar NO borra la carpeta", nuevo.is_dir() and str(nuevo) not in {w["path"] for w in call("/api/overview")[1]["workspaces"]})


    print("== roles, equipos, relanzar, inicio")
    ro = call("/api/roles")[1]; rl = {r["name"]: r for r in ro["roles"]}
    check("catálogo con >= 25 roles y todos con categoría válida", len(rl) >= 25 and all(r["category"] in ro["categories"] for r in rl.values()), len(rl))
    check("roles nuevos presentes (UX, móvil, migración)", all(n in rl for n in ("ux-researcher", "ui-designer", "mobile-ios", "mobile-android", "mobile-cross", "migration-planner", "migration-engineer", "data-migrator")))
    check("ningún rol incluido es editable; todos tienen icono y brief", all(not r["editable"] and r["icon"] and len(r["brief"]) > 80 for r in rl.values()))
    check("mobile-ios advierte que sin Xcode no se puede compilar", "Xcode" in rl["mobile-ios"]["brief"])
    check("data-migrator exige dry-run y nunca producción", "--dry-run" in rl["data-migrator"]["brief"] and "NUNCA contra producción" in rl["data-migrator"]["brief"])
    c, e = call("/api/roles/save", {"name": "Mal Nombre!", "title": "x", "brief": "y"}); check("guardar rol con id inválido -> 400", c == 400, e)
    c, e = call("/api/roles/save", {"name": "mi-rol", "title": "Mi rol", "brief": "Haz X --- y Z", "category": "Migraciones", "icon": "🧪", "writes": True, "workspace": "share"}); check("guardar rol propio 200", c == 200, e)
    r2 = {r["name"]: r for r in call("/api/roles")[1]["roles"]}["mi-rol"]
    check("rol propio editable, en su categoría, brief intacto", r2["editable"] and r2["category"] == "Migraciones" and r2["writes"] and "---" in r2["brief"], r2)
    c, e = call("/api/roles/delete", {"name": "architect"}); check("no se puede borrar un rol incluido -> 404", c == 404, e)
    c, e = call("/api/roles/delete", {"name": "mi-rol"}); check("borrar rol propio 200", c == 200, e)
    teams = call("/api/teams")[1]["teams"]
    check("8 equipos y todos sus roles existen", len(teams) == 8 and all(t["roles"] and all(x in rl for x in t["roles"]) for t in teams), [t["id"] for t in teams])
    c, e = call("/api/run", {"path": WS, "prompt": "x", "team": "feature"}); check("equipo sin enjambre -> 400", c == 400, e)
    c, e = call("/api/run", {"path": WS, "prompt": "x", "swarm": True, "team": "no-existe"}); check("equipo desconocido -> 400", c == 400, e)
    c, r = call("/api/run", {"path": WS, "prompt": "Rediseña la pantalla de login", "swarm": True, "team": "mobile-native", "allow_commands": True}); d = wait(r["id"], ("done", "failed", "blocked")) if c == 200 else r
    check("enjambre con equipo: /swarm + roles + orden de trabajo en el prompt", c == 200 and all(x in d["log"] for x in ("/swarm Rediseña", "## Equipo: App móvil nativa", "mobile-ios — Desarrollador iOS", "mobile-android", "Orden de trabajo sugerido")), (d.get("log") or d)[:200])
    check("el run guarda el equipo", d.get("team") == "mobile-native")
    c, r2_ = call("/api/run/rerun", {"id": r["id"]}); d2 = wait(r2_["id"], ("done", "failed")) if c == 200 else r2_
    check("relanzar copia la configuración (equipo, enjambre, modelo)", c == 200 and d2["id"] != r["id"] and d2["team"] == "mobile-native" and d2["swarm"] and d2["model"] == d["model"] and d2["prompt"] == d["prompt"], d2)
    c, e = call("/api/run/rerun", {"id": "20200101-000000-aaaa"}); check("relanzar id inexistente -> 404", c == 404, e)
    h = call("/api/home")[1]
    check("inicio: contadores y claves", all(k in h for k in ("running", "runs", "swarms", "done_today", "failed_today", "quota", "workspaces", "roles")) and h["roles"] >= 25 and h["done_today"] >= 2, {k: h[k] for k in ("done_today", "roles")})
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})


    print("== planificador: /api/plan, lanzamiento automático, ahorro y presupuesto")
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})
    SIMPLE = "Cambia el color del botón de login a azul"
    c, p = call("/api/plan", {"path": WS, "prompt": SIMPLE}); check("/api/plan devuelve un plan completo y explicado", c == 200 and p["effort"] == "XS" and p["topology"] == "single" and p["tokens"]["estimate"] > 0 and len(p["reasons"]) >= 3 and p["budget"] >= p["tokens"]["high"] * 0.9, p)
    check("el plan de una tarea simple no usa enjambre y elige el modelo más ligero disponible", p["model"] in ("gemini-3.8-flash-low", "gemini-4-hydrogen-low") and not p["roles"], (p["model"], p["roles"]))
    c, e = call("/api/plan", {"path": "/etc", "prompt": "x"}); check("plan en workspace ajeno -> 404", c == 404, e)
    c, r = call("/api/run", {"path": WS, "prompt": SIMPLE, "auto": True}); d = wait(r["id"], ("done", "failed")) if c == 200 else r
    check("auto: lanza con el plan (un agente, worktree, presupuesto fijado)", c == 200 and d["status"] == "done" and not d["swarm"] and d["isolation"] == "worktree" and d["token_budget"] > 0 and d["plan"]["effort"] == "XS", d)
    check("auto: el prompt lleva la marca de la ejecución y NO reglas genéricas (medidas sin efecto)", f"[ant-run:{r['id']}]" in d["log"] and "Reglas de ahorro" not in d["log"])
    check("auto: tarea simple => una sola invocación, sin narrator/monitor/swarm", "/swarm" not in d["log"] and "narrator" not in d["log"].lower())
    check("uso REAL medido al terminar (entrada+salida = 12 800; caché aparte)", d.get("usage", {}).get("total") == 12800 and d["usage"]["cache"] == 3000 and d["usage"]["steps"] == 1, d.get("usage"))
    c, e = call("/api/run", {"path": WS, "prompt": SIMPLE, "auto": True}); check("repetir la misma tarea ya hecha -> 409 'duplicate' antes de gastar", c == 409 and e["needs"] == "duplicate", e)
    c, r2 = call("/api/run", {"path": WS, "prompt": SIMPLE, "auto": True, "confirm_duplicate": True}); check("confirmando la repetición se lanza", c == 200, r2)
    BIG = "Implementa el módulo de facturación completo:\n- API de facturas y pagos\n- Pantallas de listado y detalle\n- Pruebas unitarias y e2e\n- Documentación del endpoint\n- Migración de la tabla de clientes"
    c, e = call("/api/run", {"path": WS, "prompt": BIG, "auto": True}); check("plan caro (enjambre grande) -> 409 'heavy' con el plan", c == 409 and e["needs"] == "heavy" and e["plan"]["topology"] == "swarm", e)
    c, r3 = call("/api/run", {"path": WS, "prompt": BIG, "auto": True, "confirm_heavy": True}); d3 = wait(r3["id"], ("done", "failed")) if c == 200 else r3
    check("confirmado: enjambre mínimo con roles a medida, sin narrator ni monitor, con tope de workers", c == 200 and d3["swarm"] and d3["log"].count("### ") <= 5 and "NO añadas narrator ni monitor" in d3["log"] and "máx. " in d3["log"], d3.get("log", "")[:300] if c == 200 else r3)
    check("el enjambre lleva solo los briefs de los roles elegidos (no el equipo entero)", "## Equipo: Equipo a medida" in d3["log"] and "mobile-ios" not in d3["log"])
    c, m = call("/api/run", {"path": WS, "prompt": "Revisa src/a.js", "role": "reviewer", "token_budget": 123456}); dm = wait(m["id"], ("done", "failed")) if c == 200 else m
    check("lanzamiento manual: guarda presupuesto y un plan mínimo (esfuerzo + huella)", c == 200 and dm["token_budget"] == 123456 and dm["plan"]["effort"] in ("XS", "S") and dm["plan"]["fingerprint"], dm.get("plan"))
    c, b = call("/api/run", {"path": WS, "prompt": "BURN tokens sin parar", "token_budget": 50000, "isolation": "inherit"})
    db = wait(b["id"], ("budget", "done", "failed"), 40) if c == 200 else b
    check("PRESUPUESTO: el vigilante detiene la ejecución que supera su límite (estado 'budget')", db["status"] == "budget" and db["usage"]["total"] > 50000, (db["status"], db.get("usage", {}).get("total")))
    check("la ejecución detenida por presupuesto ya no está viva", not Path(f"/proc/{b['pid']}").exists() or "Z" in Path(f"/proc/{b['pid']}/stat").read_text().split(")")[1][:3])
    h = call("/api/home")[1]; check("inicio: tokens de hoy y paradas por presupuesto", h["tokens_today"] > 50000 and h["budget_stops_today"] == 1, {k: h[k] for k in ("tokens_today", "budget_stops_today")})
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})


    print("== enjambres cortados: reanudar el trabajo parcial")
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})
    c, b = call("/api/run", {"path": WS, "prompt": "BURN construir el módulo", "token_budget": 50000, "isolation": "worktree", "swarm": True, "team": "feature"})
    db = wait(b["id"], ("budget", "done", "failed"), 60) if c == 200 else b
    check("el corte por presupuesto deja la ejecución en 'budget' con su trabajo parcial", db["status"] == "budget" and any("trabajo parcial" in x for x in db.get("commits", [])), (db.get("status"), db.get("commits"), os.listdir(db["cwd"]), subprocess.run(["git", "-C", db["cwd"], "log", "--oneline", "-3"], capture_output=True, text=True).stdout, subprocess.run(["git", "-C", db["cwd"], "status", "--short"], capture_output=True, text=True).stdout))
    check("es reanudable (copia aislada intacta, interrumpida, no adoptada)", db["resumable"] is True)
    c, e = call("/api/run/resume", {"id": b["id"] + "x"}); check("reanudar un id inválido -> 400", c == 400, e)
    c, r = call("/api/run/resume", {"id": b["id"], "token_budget": 33000}); d = wait(r["id"], ("done", "failed")) if c == 200 else r
    check("reanudar crea UNA ejecución individual (no enjambre) con presupuesto propio", c == 200 and d["swarm"] is False and d["token_budget"] == 33000 and d["resumed_from"] == b["id"], d)
    check("la reanudación usa la MISMA copia aislada y rama que la original", d["cwd"] == db["cwd"] and d["branch"] == db["branch"] and d["base"] == db["base"])
    check("el traspaso incluye la tarea original, el motivo, los commits y la orden de no rehacer", all(x in d["log"] for x in ("Trabajo ya hecho", "se agotó el presupuesto de tokens", "feat: trabajo parcial", "BURN construir el módulo", "no rehagas ni reviertas", "No crees enjambre")), d["log"][:400])
    check("el modelo de la reanudación NO es el Orchestrator (más barato)", "orchestrator" not in d["log"].split("\n")[0] if False else "--model gemini-pro-orchestrator" not in d["log"])
    check("el agente reanudado continúa sobre lo hecho: commit nuevo encima del parcial", any("continuación" in x for x in d["commits"]) and any("trabajo parcial" in x for x in d["commits"]), d["commits"])
    old = call(f"/api/run/{b['id']}")[1]
    check("la ejecución original cede la copia (adopted_by) y deja de ser reanudable", old.get("adopted_by") == r["id"] and old["resumable"] is False)
    c, e = call("/api/run/resume", {"id": b["id"]}); check("no se puede reanudar dos veces la misma -> 409", c == 409, e)
    c, e = call("/api/run/resume", {"id": d["id"]}); check("una ejecución terminada bien no es reanudable -> 409", c == 409, e)
    c, e = call("/api/run/discard", {"id": b["id"]}); check("descartar la original NO borra la copia que ahora usa la reanudación", c == 200 and Path(d["cwd"]).is_dir() and call(f"/api/run/{b['id']}")[0] == 404, e)
    c, e = call("/api/run/discard", {"id": r["id"], "force": True}); check("descartar la reanudada sí limpia la copia y la rama", c == 200 and not Path(d["cwd"]).exists() and d["branch"] not in sh("git", "branch"), e)
    c, h = call("/api/home"); n_hist = [x for x in []]


    print("== permisos: bloqueo con comando identificado, scripts del proyecto y reintento")
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})
    npmws = T / "proj" / "npmws"; c, e = call("/api/workspace/add", {"path": str(npmws), "create": True}); check("workspace de prueba con git creado", c == 200, e)
    (npmws / "package.json").write_text(json.dumps({"name": "x", "scripts": {"type-check": "tsc --noEmit", "test": "jest", "start": "node ."}}))
    c, p = call("/api/plan", {"path": str(npmws), "prompt": "Revisa la app y comprueba que el tipado es correcto"})
    check("el proyecto define scripts de verificación -> el plan añade el perfil 'dev' y lo explica", c == 200 and p["perms"] == "dev" and "npm run type-check" in p["project_cmds"] and any("scripts de verificación" in r for r in p["reasons"]), p.get("perms"))
    c, p2 = call("/api/plan", {"path": WS, "prompt": "Revisa la app y comprueba que el tipado es correcto"}); check("un proyecto sin scripts sigue con permisos 'safe'", p2["perms"] == "safe", p2["perms"])
    c, r = call("/api/run", {"path": str(npmws), "prompt": "Revisa la app y comprueba que el tipado es correcto", "auto": True}); d = wait(r["id"], ("done", "failed", "blocked")) if c == 200 else r
    check("lanzamiento automático con perfil dev: la sesión de agy incluye npm run/tsc/eslint pero NO git push", d.get("allow_dev") is True and 'command(npm run)' in d["log"] and 'command(tsc)' in d["log"] and "git push" not in d["log"], d.get("log", "")[:200])
    c, pr = call("/api/run", {"path": WS, "prompt": "Revisa src/a.js", "isolation": "inherit"}); dp = wait(pr["id"], ("done", "failed")) if c == 200 else pr
    check("los agentes reciben el PATH ampliado con las herramientas del usuario (antes: solo el mínimo de systemd)", str(T / "toolbin") in dp["log"].split("path: ")[1].split("\n")[0].split(":")[0:2] or str(T / "toolbin") in dp["log"], dp.get("log", "")[:200])
    c, b = call("/api/run", {"path": WS, "prompt": "NPMBLOCK revisa el tipado", "allow_commands": True, "isolation": "worktree"}); db = wait(b["id"], ("blocked", "done", "failed")) if c == 200 else b
    check("un permiso denegado deja la ejecución 'blocked' y se identifica el comando exacto", db["status"] == "blocked" and db.get("blocked_cmd") == "npm run type-check && npm test", (db.get("status"), db.get("blocked_cmd")))
    check("el tokens perdidos quedan medidos (para avisar al usuario)", (db.get("usage") or {}).get("total", 0) >= 9000, db.get("usage"))
    c, r1 = call("/api/run/rerun", {"id": b["id"], "allow_dev": True}); d1 = wait(r1["id"], ("done", "failed", "blocked")) if c == 200 else r1
    check("«relanzar permitiendo scripts del proyecto» amplía los permisos (sin aprobar todo)", c == 200 and d1["allow_dev"] is True and 'command(npm run)' in d1["log"] and "--dangerously-skip-permissions" not in d1["log"], d1.get("log", "")[:120])
    c, r2 = call("/api/run/rerun", {"id": b["id"], "auto_approve": True}); d2 = wait(r2["id"], ("done", "failed", "blocked")) if c == 200 else r2
    check("«relanzar con todos los permisos» usa --dangerously-skip-permissions", c == 200 and "--dangerously-skip-permissions" in d2["log"])
    BIG2 = "Implementa el módulo de facturación completo:\n- API de facturas y pagos\n- Pantallas de listado y detalle\n- Pruebas unitarias y e2e\n- Documentación del endpoint\n- Migración de la tabla de clientes"
    c, s1 = call("/api/run", {"path": WS, "prompt": BIG2, "auto": True, "confirm_heavy": True}); ds = wait(s1["id"], ("done", "failed", "blocked")) if c == 200 else s1
    c, s2 = call("/api/run/rerun", {"id": s1["id"]}); check("relanzar un enjambre con equipo a medida funciona (antes fallaba: 'equipo desconocido') y conserva presupuesto", c == 200 and s2["swarm"] and s2["token_budget"] == ds["token_budget"], s2)
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})


    print("== dependencias enlazadas (node_modules): salvaguardas")
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})
    (ws / "node_modules/pkg/node_modules/deep").mkdir(parents=True); (ws / "node_modules/pkg/index.js").write_text("main")
    (ws / "apps/web/node_modules/lib").mkdir(parents=True); (ws / "apps/web/node_modules/lib/i.js").write_text("lib"); (ws / "apps/web/package.json").write_text("{}")
    (ws / ".gitignore").write_text("node_modules/\n"); sh("git", "add", ".gitignore", "apps"); sh("git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "deps")
    c, r = call("/api/run", {"path": WS, "prompt": "Revisa src/a.js", "isolation": "worktree", "link_deps": True, "allow_dev": True}); d = wait(r["id"], ("done", "failed", "blocked")) if c == 200 else r
    cwd = Path(d["cwd"])
    check("se enlazan los node_modules de la raíz y de apps/web, y NO los anidados dentro de node_modules", d["linked_deps"] == ["node_modules", "apps/web/node_modules"] and (cwd / "node_modules").is_symlink() and not (cwd / "node_modules/pkg/node_modules").is_symlink(), d.get("linked_deps"))
    check("el enlace da acceso al contenido real (el agente puede leer/ejecutar con ellas)", (cwd / "node_modules/pkg/index.js").read_text() == "main" and (cwd / "apps/web/node_modules/lib/i.js").read_text() == "lib")
    check("RIESGO 1: git NO ve el enlace (aunque .gitignore tenga 'node_modules/', que no ignora enlaces)", "node_modules" not in sh("git", "status", "--porcelain", cwd=cwd), sh("git", "status", "--porcelain", cwd=cwd))
    sh("git", "add", "-A", cwd=cwd); check("RIESGO 1: un 'git add -A' del agente tampoco mete el enlace en el commit", "node_modules" not in sh("git", "diff", "--cached", "--name-only", cwd=cwd))
    check("la exclusión queda marcada UNA sola vez en .git/info/exclude (idempotente)", (ws / ".git/info/exclude").read_text().count("# ant: enlaces de dependencias") == 1)
    check("RIESGO 3: el agente recibe la orden de NO instalar ni modificar dependencias", "## Dependencias" in d["log"] and "NO ejecutes install/add/remove" in d["log"])
    check("sin modificaciones: no se avisa", d["deps_modified"] is False)
    c, r0 = call("/api/run", {"path": WS, "prompt": "Revisa src/a.js sin enlace", "isolation": "worktree"}); d0 = wait(r0["id"], ("done", "failed")) if c == 200 else r0
    check("por defecto NO se enlaza nada (opt-in) y el prompt no menciona dependencias", d0["linked_deps"] == [] and not (Path(d0["cwd"]) / "node_modules").exists() and "## Dependencias" not in d0["log"])
    c, rm = call("/api/run", {"path": WS, "prompt": "DEPSMOD instala algo", "isolation": "worktree", "link_deps": True, "allow_dev": True}); dm = wait(rm["id"], ("done", "failed")) if c == 200 else rm
    check("RIESGO 3: si el agente modifica los node_modules compartidos, Ant lo detecta y lo marca", dm["deps_modified"] is True, dm.get("deps_modified"))
    shutil.rmtree(ws / "node_modules/paquete-nuevo", ignore_errors=True)
    c, e = call("/api/run/discard", {"id": rm["id"], "force": True}); check("descartar la copia enlazada funciona", c == 200 and not Path(dm["cwd"]).exists(), e)
    check("RIESGO 2: descartar NO sigue el enlace: las dependencias REALES siguen intactas", (ws / "node_modules/pkg/index.js").read_text() == "main" and (ws / "node_modules/pkg/node_modules/deep").is_dir() and (ws / "apps/web/node_modules/lib/i.js").read_text() == "lib")
    c, rb = call("/api/run", {"path": WS, "prompt": "BURN con dependencias", "token_budget": 50000, "isolation": "worktree", "link_deps": True, "allow_dev": True}); db2 = wait(rb["id"], ("budget", "done", "failed"), 60) if c == 200 else rb
    c, rr = call("/api/run/resume", {"id": rb["id"]}); dr = wait(rr["id"], ("done", "failed")) if c == 200 else rr
    check("al reanudar, la copia conserva sus enlaces y la nota de dependencias", c == 200 and dr["linked_deps"] == ["node_modules", "apps/web/node_modules"] and (Path(dr["cwd"]) / "node_modules").is_symlink() and "## Dependencias" in dr["log"], dr.get("linked_deps"))
    call("/api/run/discard", {"id": rb["id"]}); c, e = call("/api/run/discard", {"id": rr["id"], "force": True})
    check("RIESGO 2 (tras reanudar): descartar la reanudada desenlaza y deja las dependencias reales intactas", c == 200 and not Path(dr["cwd"]).exists() and (ws / "node_modules/pkg/index.js").read_text() == "main")
    (npmws / "node_modules/x").mkdir(parents=True); (npmws / "node_modules/x/i.js").write_text("x")
    c, pa = call("/api/plan", {"path": str(npmws), "prompt": "Revisa la app y comprueba que el tipado es correcto"})
    check("el plan automático enlaza dependencias cuando hay scripts del proyecto y node_modules, y lo explica", c == 200 and pa["link_deps"] is True and pa["node_modules"] == ["node_modules"] and any("enlazan los node_modules" in x for x in pa["reasons"]), pa.get("reasons"))
    c, p0 = call("/api/plan", {"path": WS, "prompt": "Cambia el color del botón"}); check("sin perfil dev no se enlaza (el plan solo lo hace si hay scripts que ejecutar)", p0["link_deps"] is False)
    c, ra = call("/api/run", {"path": str(npmws), "prompt": "Revisa la app y comprueba que el tipado es correcto", "auto": True}); da = wait(ra["id"], ("done", "failed", "blocked")) if c == 200 else ra
    check("lanzamiento automático: la copia queda con node_modules enlazado", da["linked_deps"] == ["node_modules"] and (Path(da["cwd"]) / "node_modules").is_symlink() and da["plan"]["link_deps"] is True, da.get("linked_deps"))
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})
    check("al final todas las dependencias reales de los dos proyectos siguen en su sitio", (ws / "node_modules/pkg/index.js").exists() and (npmws / "node_modules/x/i.js").read_text() == "x")

    print("== oficina (stream)")
    shutil.rmtree(T / "gemini/antigravity-cli")  # el swarm falso del bloque anterior ya cumplió
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})
    o = call("/api/office")[1]; check("sin agentes: oficina vacía", o["workers"] == [] and o["whip"]["seq"] == 0, o)
    c, r = call("/api/run", {"path": WS, "prompt": "SLOW secreto-no-mostrar", "role": "tester"}); rid = r["id"]
    o = call("/api/office")[1]
    check("run en marcha aparece como worker 'working'", [w["state"] for w in o["workers"]] == ["working"] and o["stats"]["working"] == 1, o["workers"])
    check("worker expone rol y no la ruta del workspace", o["workers"][0]["role"] == "tester" and WS not in json.dumps(o))
    c, w = call("/api/office/whip", {"kind": "all"}); o = call("/api/office")[1]
    check("látigo: seq=1, tipo all, contador=1", w["seq"] == 1 and o["whip"]["kind"] == "all" and o["stats"]["whips"] == 1, o["whip"])
    check("látigo sin cabecera -> 403", call("/api/office/whip", {}, hdr=False)[0] == 403)
    call("/api/run/stop", {"id": rid}); wait(rid, ("stopped",))
    o = call("/api/office")[1]; check("detenido -> worker 'stopped' (caja de despedido)", [w["state"] for w in o["workers"]] == ["stopped"], o["workers"])
    call("/api/run/discard", {"id": rid, "force": True})

    print("== sobrevive al reinicio del servicio")
    c, r = call("/api/run", {"path": WS, "prompt": "SLOW"}); rid = r["id"]
    srv.terminate(); srv.wait()
    srv = subprocess.Popen([sys.executable, str(ROOT / "server.py")], env=env, stdout=subprocess.DEVNULL)
    for _ in range(50):
        try: call("/api/status"); break
        except Exception: time.sleep(0.1)
    d = call(f"/api/run/{rid}")[1]; check("sigue 'running' tras reiniciar Ant", d["status"] == "running", d.get("status"))
    call("/api/run/stop", {"id": rid}); wait(rid, ("stopped",))
    for x in call("/api/runs")[1]["runs"]: call("/api/run/discard", {"id": x["id"], "force": True})
finally:
    srv.terminate()
    subprocess.run(["git", "worktree", "prune"], cwd=ws)
    shutil.rmtree(T, ignore_errors=True)
print("\nRESULTADO:", "TODO OK" if not fails else f"{len(fails)} fallos: {fails}")
sys.exit(1 if fails else 0)
