#!/usr/bin/env python3
"""Pruebas del planificador: decisiones por tarea, ahorro de tokens, calibración y garantías."""
import os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("ANT_GEMINI_DIR", "/nonexistent")
import planner, server  # noqa: E402

ROLES = server.load_roles()
RB = {r["name"] for r in ROLES}
MODELS = [{"id": i, "name": i} for i in """gemini-4-argon-medium gemini-4-argon-high gemini-4-argon-low gemini-4-hydrogen-high gemini-4-hydrogen-xhigh
gemini-4-hydrogen-medium gemini-4-hydrogen-low gemini-pro-orchestrator-g1-pro gemini-3.8-flash-high gemini-3.8-flash-medium gemini-3.8-flash-low
claude-opus-5-5-low claude-opus-5-5-medium claude-opus-5-5-high claude-sonnet-5-5-low claude-sonnet-5-5-medium claude-sonnet-5-5-high gpt-oss-120b-medium""".split()]
WS = {"path": "/w", "has_git": True}
fails = []
def check(name, cond, extra=""):
    print(("  ok  " if cond else "FALLA ") + name + (f"  [{extra}]" if (extra and not cond) else ""))
    if not cond: fails.append(name)
def P(prompt, **kw): return planner.make_plan(prompt, ws=kw.pop("ws", WS), roles=ROLES, models=MODELS, **kw)

# (tarea, esfuerzo esperado (conjunto), topología, roles que DEBEN estar, modo)
CASES = [
 ("Cambia el color del botón de login a azul", {"XS"}, "single", [], "accept-edits"),
 ("Corrige el error 500 al guardar el perfil; reproduce primero y añade la prueba que lo habría detectado", {"S", "M"}, "single", ["debugger"], "accept-edits"),
 ("Revisa la seguridad del login y propón arreglos", {"S", "M"}, "single", ["security-auditor"], "plan"),
 ("Migra el módulo de pagos (src/pagos.js) al nuevo cliente de API", {"S", "M"}, "single", ["migration-engineer"], "accept-edits"),
 ("Explica qué hace src/utils/date.ts", {"XS", "S"}, "single", ["reviewer"], "plan"),
 ("Añade soporte para modo oscuro en toda la aplicación web", {"M", "L"}, "single", [], "accept-edits"),
 ("Crea un pipeline de CI con GitHub Actions que corra lint, pruebas y build", {"S", "M"}, "single", ["devops"], "accept-edits"),
 ("La pantalla de inicio tarda 8 segundos en cargar; encuentra el cuello de botella y optimízala", {"S", "M", "L"}, "single", ["performance"], "accept-edits"),
 ("Rediseña toda la app móvil (iOS y Android) con un nuevo sistema de diseño, accesibilidad y pruebas", {"L", "XL"}, "swarm", ["mobile-ios", "mobile-android"], "accept-edits"),
 ("Diseña el esquema de pedidos y migra los datos existentes de MongoDB a PostgreSQL de punta a punta", {"L", "XL"}, "swarm", ["database"], "accept-edits"),
 ("Implementa el módulo de facturación completo:\n- API de facturas y pagos\n- Pantallas de listado y detalle\n- Pruebas unitarias y e2e\n- Documentación del endpoint\n- Migración de la tabla de clientes", {"L", "XL"}, "swarm", [], "accept-edits"),
]
print("== Decisiones por tarea")
for prompt, efforts, topo, must, mode in CASES:
    p = P(prompt); label = prompt.splitlines()[0][:62]
    ok = p["effort"] in efforts and p["topology"] == topo and all(r in p["roles"] for r in must) and p["mode"] == mode
    check(f"{label}…  → {p['effort']}/{p['topology']}/{','.join(p['roles']) or 'general'}/{p['mode']}", ok, f"esp {efforts} {topo} {must} {mode}")

print("== Ahorro de tokens: no se usan enjambres donde no aportan")
simple = [c[0] for c in CASES if c[2] == "single"]
check("las tareas simples NUNCA generan un enjambre", all(P(t)["topology"] == "single" for t in simple))
p = P("Cambia el color del botón de login a azul")
check("XS usa el modelo más ligero (Flash Low)", p["model"] == "gemini-3.8-flash-low", p["model"])
check("el enjambre simple habría costado varias veces más (alternativa documentada)", p["alternatives"][0]["estimate"] >= 3 * p["tokens"]["estimate"], p["alternatives"])
big = P(CASES[10][0])
check("enjambre: máx. 4 workers + revisor opcional, sin narrator ni monitor", len([r for r in big["roles"] if r != "reviewer"]) <= 4 and not {"narrator", "monitor"} & set(big["roles"]), big["roles"])
check("enjambre: coordinador Orchestrator y workers en nivel más barato", big["model"] == planner.ORCH_ID and big["workers_model"] and "xhigh" not in big["workers_model"], (big["model"], big["workers_model"]))
check("las tareas de solo lectura bajan un nivel de modelo", planner.LEVELS.index(P("Revisa el módulo de pagos y dime qué riesgos ves en src/pagos.js, src/cobros.js y src/refunds.js")["model"].rsplit("-", 1)[1]) <= 1)
check("un enjambre grande avisa y pide confirmación (plan caro)", big["heavy"] and any("caro" in w for w in big["warnings"]))
check("tarea profunda de un solo hilo: modelo potente pero SIN enjambre", (lambda q: q["topology"] == "single" and q["effort"] in ("L", "XL", "M"))(P("Optimiza el algoritmo de ordenación del archivo core/sort.ts y demuestra con mediciones que mejora el rendimiento de toda la librería de punta a punta")))

check("S/M de código o seguridad usan Hydrogen (Flash solo para tareas mínimas)", all(P(x)["model"].startswith("gemini-4-hydrogen") for x in ["Revisa la seguridad del login y propón arreglos", "Migra el módulo de pagos (src/pagos.js) al nuevo cliente de API", "Corrige el error 500 al guardar el perfil; reproduce primero y añade la prueba"]), [P(x)["model"] for x in ["Revisa la seguridad del login y propón arreglos"]])
print("== Garantías")
check("determinista: la misma tarea da siempre el mismo plan", P(CASES[3][0]) == P(CASES[3][0]))
check("el presupuesto cubre la estimación alta", all(P(c[0])["budget"] >= P(c[0])["tokens"]["high"] * 0.95 for c in CASES))
check("tarea muy corta: avisa de que falta objetivo", any("muy corta" in w for w in P("hola")["warnings"]))
q = P("Revisa la seguridad del login", blocked=("claude", "gpt"))
check("cuota de Claude/GPT agotada: solo modelos Gemini", q["model"].startswith("gemini") and not any("claude" in str(q.get(k)) or "gpt" in str(q.get(k)) for k in ("model", "workers_model")))
hist = [{"effort": "S", "kind": "single", "total": 30_000}] * 3
check("calibración: con historial propio la estimación usa la mediana medida", P("Corrige el error 500 al guardar el perfil; reproduce primero y añade la prueba", history=hist)["tokens"]["estimate"] == 30_000 and "historial" in P("Corrige el error 500 al guardar el perfil; reproduce primero y añade la prueba", history=hist)["tokens"]["basis"])
first = P(CASES[3][0]); dup = P(CASES[3][0], recent=[{"id": "20260101-000000-abcd", "fingerprint": first["fingerprint"], "ws": "/w", "status": "done"}])
check("tarea repetida en el mismo workspace: avisa antes de gastar de nuevo", any("misma tarea" in w for w in dup["warnings"]))
check("sin git: aislamiento 'inherit'", P("Cambia el color del botón", ws={"path": "/x", "has_git": False})["isolation"] == "inherit")
check("override del usuario respetado (modelo y modo)", (lambda o: o["model"] == "claude-opus-5-5-high" and o["mode"] == "plan")(P("Cambia el color del botón de login", overrides={"model": "claude-opus-5-5-high", "mode": "plan"})))
check("cada decisión trae su motivo (explicable)", all(len(P(c[0])["reasons"]) >= 3 for c in CASES))
check("palabras con 'ios' dentro (funcionarios) no se confunden con iOS", "mobile" not in planner.analyze("Lista los funcionarios del sistema de nómina")["types"])
import tempfile, runs as _runs
print("== PATH de los agentes (node/npm del usuario)")
H = Path(tempfile.mkdtemp())
for v in ("v18.19.0", "v22.22.1", "v9.1.0"): (H / ".nvm/versions/node" / v / "bin").mkdir(parents=True)
(H / ".local/bin").mkdir(parents=True); (H / ".cargo/bin").mkdir(parents=True); (H / ".local/share/fnm/node-versions/v20.5.0/installation/bin").mkdir(parents=True)
tp = _runs.tool_path(home=H, base_path="/usr/bin:/bin").split(":")
check("añade las herramientas del usuario (nvm, cargo, ~/.local/bin, fnm) al PATH mínimo de systemd", all(str(x) in tp for x in (H / ".local/bin", H / ".cargo/bin", H / ".nvm/versions/node/v22.22.1/bin", H / ".local/share/fnm/node-versions/v20.5.0/installation/bin")), tp)
check("de nvm elige la versión MÁS RECIENTE (v22 > v18; compara número, no texto: v9 < v22)", str(H / ".nvm/versions/node/v22.22.1/bin") in tp and str(H / ".nvm/versions/node/v18.19.0/bin") not in tp and str(H / ".nvm/versions/node/v9.1.0/bin") not in tp)
check("las del usuario van antes que las del sistema y sin duplicados", tp.index(str(H / ".local/bin")) < tp.index("/usr/bin") and len(tp) == len(set(tp)))
check("solo añade carpetas que existen", not any("volta" in x or ".bun" in x for x in tp))
print(f"\nRESULTADO: {'TODO OK' if not fails else str(len(fails)) + ' fallos: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
