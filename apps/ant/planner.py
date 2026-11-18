"""Planificador de Ant: decide QUÉ agentes, con QUÉ modelo y QUÉ presupuesto, antes de gastar tokens.

Local y determinista: planificar cuesta 0 tokens, es explicable (cada decisión trae su motivo) y no
reparte trabajo al azar. Las estimaciones empiezan como heurísticas y se calibran con el consumo
REAL medido en ejecuciones anteriores (usage.py).
"""
import hashlib
import re
import statistics
import unicodedata

EFFORTS = ["XS", "S", "M", "L", "XL"]
EFFORT_TXT = {"XS": "mínimo", "S": "pequeño", "M": "medio", "L": "grande", "XL": "muy grande"}
# tokens (entrada+salida) de UN agente por esfuerzo; punto de partida hasta tener historial propio
BASE_TOKENS = {"XS": 20_000, "S": 45_000, "M": 110_000, "L": 260_000, "XL": 550_000}
AGENT_OVERHEAD = 18_000      # cada agente paga su contexto base (medido: ~16 k por worker en el swarm de prueba)
COORD_BASE, COORD_PER_WORKER = 60_000, 12_000
TIMEOUT_MIN = {"XS": 10, "S": 15, "M": 30, "L": 45, "XL": 90}
LEVELS = ["low", "medium", "high", "xhigh"]
FAMILY_PREF = ["gemini-4-hydrogen", "gemini-4-argon", "gemini-3.8-flash", "claude-sonnet-5-5", "claude-opus-5-5", "gpt-oss-120b"]  # Flash solo se prefiere en XS (ver make_plan)
ORCH_ID = "gemini-pro-orchestrator-g1-pro"
HEAVY_TOKENS = 300_000

_LEAN_SINGLE_SIN_EFECTO = """## Reglas de ahorro de tokens (medidas sin efecto en tareas pequeñas; no se usan)
- Lee solo los archivos necesarios; prefiere búsquedas dirigidas a listar o leer carpetas enteras. No ejecutes comandos de shell salvo que la tarea lo exija.
- No releas lo ya leído ni repitas contexto en tus respuestas; resume los resultados.
- Haz el cambio mínimo que cumpla el objetivo; nada de mejoras no pedidas.
- Detente en cuanto se cumpla el criterio de terminado y responde en pocas líneas."""
LEAN_SWARM = """## Reglas del enjambre (ahorro de tokens)
- Crea SOLO los workers indicados (máx. {max_workers}); NO añadas narrator ni monitor ni helpers.
- Un worker en espera no consume nada: no le escribas si no hay trabajo para él ni uses @all para avisos.
- Cuando un worker termine, no lo reactives; cierra el enjambre apenas esté el resultado verificado."""


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def _rx(kw):  # "ios$" = palabra exacta; el resto = raíz (límite solo a la izquierda)
    exact = kw.endswith("$")
    k = re.escape(kw.rstrip("$"))
    return re.compile(r"(?<![a-z0-9])" + k + (r"(?![a-z0-9])" if exact else ""))


TYPE_KW = {
    "bugfix": ["bug$", "error", "falla", "fallo", "crash", "excepcion", "no funciona", "arregla", "corrige", "reproduc", "se rompe", "regresion", "traceback", "stack trace"],
    "migration": ["migra", "actualiza a", "actualizar a", "upgrade", "portar", "convertir a", "pasar a", "pasa a", "version mayor", "deprecad", "de vue 2", "a typescript"],
    "ux": ["ux$", "ui$", "interfaz", "diseno", "pantalla", "wireframe", "maquet", "accesib", "usabilidad", "landing", "figma", "tema oscuro", "modo oscuro", "onboarding", "microcopy", "design system", "sistema de diseno"],
    "mobile": ["ios$", "android", "swift", "kotlin", "expo$", "react native", "flutter", "movil", "mobile$", "app nativa", "iphone", "testflight", "play store"],
    "database": ["base de datos", "esquema", "sql$", "indice", "consulta lenta", "postgres", "mysql", "mongo", "orm$", "prisma"],
    "security": ["seguridad", "vulnerab", "owasp", "xss$", "csrf$", "inyeccion", "secretos", "token expuesto", "pentest", "cifrad", "autenticacion"],
    "performance": ["rendimiento", "lento", "optimiza", "memoria", "latencia", "bundle", "lighthouse", "cuello de botella", "performance"],
    "docs": ["document", "readme", "changelog", "comenta", "guia", "manual", "tutorial"],
    "tests": ["prueba", "test$", "tests$", "testing", "cobertura", "e2e$", "unitari"],
    "review": ["revisa", "revision", "review", "analiza", "analisis", "audita", "evalua", "explica", "investiga", "diagnostic", "que hace", "entender", "resume"],
    "refactor": ["refactor", "limpia", "reestructura", "simplifica", "duplicacion", "deuda tecnica", "reorganiza"],
    "devops": ["docker", "ci/cd", "pipeline", "despliegue", "deploy", "github actions", "kubernetes", "terraform", "nginx"],
    "release": ["release", "publicar version", "nueva version", "tienda de apps", "play console", "semver"],
    "feature": ["anade", "agrega", "implementa", "crea ", "nueva funcion", "feature", "soporte para", "integra", "construye", "desarrolla", "api$", "endpoint"],
}
TYPE_WEIGHT = {"migration": 3, "security": 2, "performance": 1, "database": 1, "mobile": 1}  # temas intrínsecamente pesados
DEEP_TYPES = {"security", "migration", "database"}
SECONDARY = {"review", "docs", "tests"}
WRITE_KW = ["implementa", "crea ", "anade", "agrega", "migra", "refactor", "arregla", "corrige", "escribe", "genera", "actualiza", "cambia", "modifica", "elimina", "borra", "renombr", "instala", "configura", "construye", "desarrolla", "mejora", "reemplaza", "convierte", "optimiza", "documenta", "redacta", "aplica", "integra", "redisena", "disena", "haz ", "pon "]
READ_KW = ["revisa", "analiza", "audita", "explica", "investiga", "lista", "resume", "evalua", "diagnostic", "busca", "compara", "propon", "planifica", "dime", "cual es", "que hace"]
SCOPE_KW = ["toda la", "todo el", "completo", "completa", "entera", "entero", "end-to-end", "de punta a punta", "todos los", "todas las", "por completo", "desde cero", "sistema", "arquitectura", "plataforma", "modulos", "en todo"]
SMALL_KW = ["color", "boton", "margen", "padding", "typo", "errata", "texto", "etiqueta", "renombr", "una linea", "un archivo", "este archivo", "una funcion", "un comentario", "pequeno", "pequena", "rapido"]
ROLE_FOR = {
    "bugfix": ["debugger"], "migration": ["migration-planner", "migration-engineer"], "ux": ["ui-designer", "frontend"], "mobile": ["mobile-cross"],
    "database": ["database"], "security": ["security-auditor"], "performance": ["performance"], "docs": ["docs"], "tests": ["tester"],
    "review": ["reviewer"], "refactor": ["refactorer"], "devops": ["devops"], "release": ["release-manager"], "feature": ["implementer"],
}
TYPE_NAME = {"bugfix": "corrección de errores", "migration": "migración", "ux": "diseño UX/UI", "mobile": "app móvil", "database": "base de datos", "security": "seguridad",
             "performance": "rendimiento", "docs": "documentación", "tests": "pruebas", "review": "análisis/revisión", "refactor": "refactorización", "devops": "DevOps", "release": "publicación", "feature": "funcionalidad nueva"}
FILE_RX = re.compile(r"[\w./-]+\.(?:js|ts|tsx|jsx|py|swift|kt|java|go|rs|rb|php|css|scss|html|json|ya?ml|md|sql|vue|dart|cs|cpp|h)\b")
BULLET_RX = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s+", re.M)
KW_CACHE = {}
IMPL_RX = re.compile(r"(?<![a-z])(implementa|anade|agrega|aplica|cambia|soporte|crea|construye|desarrolla|integra)")
IOS_RX = re.compile(r"(?<![a-z0-9])ios(?![a-z0-9])|swift|iphone|ipad")
AND_RX = re.compile(r"android|kotlin|compose")


def _hits(text, kws):
    out = 0
    for k in kws:
        rx = KW_CACHE.get(k) or KW_CACHE.setdefault(k, _rx(k))
        if rx.search(text):
            out += 1
    return out


def analyze(prompt):
    """Clasifica la tarea y estima su esfuerzo. Devuelve el análisis con las señales usadas."""
    raw = prompt or ""
    t = norm(raw) + " "
    types = {k: _hits(t, v) for k, v in TYPE_KW.items()}
    types = {k: v for k, v in types.items() if v}
    ordered = sorted(types, key=lambda k: (-(types[k] + TYPE_WEIGHT.get(k, 0)), list(TYPE_KW).index(k)))
    core = [k for k in ordered if k not in SECONDARY] or ordered[:1]
    words = len(re.findall(r"\w+", raw))
    bullets = len(BULLET_RX.findall(raw))
    files = set(FILE_RX.findall(raw))
    scope, small = _hits(t, SCOPE_KW), _hits(t, SMALL_KW)
    write, read = _hits(t, WRITE_KW), _hits(t, READ_KW)
    score = (0 if words < 15 else 1 if words < 40 else 2 if words < 100 else 3)
    score += min(2 * scope, 4) + min(bullets // 2, 3)
    score += 2 if len(core) >= 3 else 1 if len(core) == 2 else 0
    score += sum(TYPE_WEIGHT.get(k, 0) for k in core[:2])
    score += 1 if len(files) >= 4 else 0
    score -= min(2 * small, 3)
    if len(files) == 1 and words < 40:
        score -= 1
    both_platforms = bool(IOS_RX.search(t)) and bool(AND_RX.search(t))
    btypes = []
    for line in raw.splitlines():
        if BULLET_RX.match(line):
            tt = norm(line) + " "
            ty = {k: _hits(tt, v) for k, v in TYPE_KW.items()}
            ty = {k: v for k, v in ty.items() if v}
            if ty:
                btypes.append((sorted(ty, key=lambda k: (-(ty[k] + TYPE_WEIGHT.get(k, 0)), list(TYPE_KW).index(k)))[0], tt))
    return {"bullet_types": btypes, "types": ordered, "core": core, "words": words, "bullets": bullets, "files": sorted(files), "scope": scope, "small": small,
            "writes": write > 0, "read_only": read > 0 and write == 0, "score": score, "both_platforms": both_platforms,
            "concerns": max(len(core), len({b[0] for b in btypes}) if len(btypes) >= 3 else 0) + (1 if both_platforms else 0), "fingerprint": hashlib.sha1(norm(raw).encode()).hexdigest()[:12]}


def effort_of(score, ws_files=None, scope=0):
    if ws_files is not None:
        score += 1 if (ws_files > 1500 and scope) else (-1 if ws_files < 60 else 0)
    return "XS" if score <= 0 else "S" if score <= 2 else "M" if score <= 4 else "L" if score <= 7 else "XL"


# ------------------------------------------------------------------ modelos
def _parse_models(models, blocked):
    fam = {}
    for m in models:
        mid = m["id"]
        if any(mid.startswith(b) for b in blocked) or "orchestrator" in mid:
            continue
        mm = re.match(r"^(.*)-(low|medium|high|xhigh)$", mid)
        if mm:
            fam.setdefault(mm.group(1), {})[mm.group(2)] = mid
    return fam


def pick_model(models, level, blocked=(), prefer=None):
    """Modelo más barato adecuado para el nivel pedido (low/medium/high/xhigh)."""
    fam = _parse_models(models, blocked)
    order = ([prefer] if prefer else []) + [f for f in FAMILY_PREF if f != prefer]
    for f in order:
        if f in fam:
            lv = fam[f]
            want = LEVELS.index(level)
            for d in sorted(range(len(LEVELS)), key=lambda i: (abs(i - want), i)):  # nivel más cercano disponible
                if LEVELS[d] in lv:
                    return lv[LEVELS[d]]
    return ""


def _level(i):
    return LEVELS[max(0, min(len(LEVELS) - 1, i))]


# ------------------------------------------------------------------ plan
def pick_roles(a, effort, roles_by_name, text):
    impl = bool(IMPL_RX.search(text))
    def role_for(k, t):
        if k == "mobile":
            ios, andr = bool(IOS_RX.search(t)), bool(AND_RX.search(t))
            if ios and not andr:
                return ["mobile-ios"]
            if andr and not ios:
                return ["mobile-android"]
            if ios and andr and not re.search(r"expo|react native|flutter|multiplataforma", t):
                return ["mobile-ios", "mobile-android"]
            return ["mobile-cross"]
        if k == "feature":
            if re.search(r"endpoint|(?<![a-z])api(?![a-z])|servidor|backend|servicio", t):
                return ["backend-api"]
            if re.search(r"pantalla|componente|boton|css|interfaz|formulario|pagina|vista", t):
                return ["frontend"]
            return ["implementer"]
        if k == "ux":
            return ["frontend", "ui-designer"] if impl else ["ui-designer", "frontend"]
        if k == "migration" and effort in ("XS", "S", "M"):
            return ["migration-engineer"]  # planificar aparte solo compensa en migraciones grandes
        if k == "database" and re.search(r"migracion de datos|mover datos|importar|exportar", t):
            return ["database", "data-migrator"]
        return list(ROLE_FOR.get(k, []))
    chosen, dropped = [], []
    bl = a.get("bullet_types") or []
    if len(bl) >= 3:  # lista de puntos: cada punto aporta su propio rol (el primero de su tipo)
        for k, tt in sorted(bl, key=lambda b: (-(TYPE_WEIGHT.get(b[0], 0) > 0), b[0] in SECONDARY)):
            rs = [("migration-engineer" if r == "migration-planner" else r) for r in role_for(k, tt if k != "ux" else text)]
            rs = [r for r in rs if r in roles_by_name]
            if rs and rs[0] not in chosen:
                chosen.append(rs[0])
        return chosen
    for k in sorted(a["core"] or a["types"][:1], key=lambda k: k == "feature"):  # lo genérico, el último
        for r in role_for(k, text):
            if r in roles_by_name and r not in chosen:
                chosen.append(r)
    return chosen


def estimate(effort, n_workers, history, kind):
    base, basis = BASE_TOKENS[effort], "heurística inicial"
    same = [h["total"] for h in history if h.get("effort") == effort and h.get("kind") == kind and h.get("total")]
    if len(same) >= 3:
        base, basis = int(statistics.median(same)), f"historial propio (mediana de {len(same)} ejecuciones)"
    if kind == "single":
        est = base
    else:
        est = COORD_BASE + COORD_PER_WORKER * n_workers + int(n_workers * (base / max(1, n_workers)) * 1.1) + n_workers * AGENT_OVERHEAD
    return {"estimate": est, "low": int(est * 0.6), "high": int(est * 1.8), "basis": basis}


def make_plan(prompt, ws=None, roles=None, models=None, history=None, blocked=(), ws_files=None, recent=None, overrides=None, project_cmds=None):
    """Plan completo y explicable. `roles`: lista de dicts del catálogo; `history`: ejecuciones medidas."""
    overrides = overrides or {}
    a = analyze(prompt)
    t = norm(prompt) + " "
    by_name = {r["name"]: r for r in (roles or [])}
    history, recent, models = history or [], recent or [], models or []
    effort = overrides.get("effort") or effort_of(a["score"], ws_files, a["scope"])
    reasons, warnings = [], []
    tn = [TYPE_NAME[k] for k in a["core"]] or ["tarea general"]
    reasons.append("Permisos: comandos habituales de solo lectura/git local concedidos de antemano; si el agente pidiera uno no concedido, la ejecución se abortaría y los tokens ya gastados se perderían.")
    project_cmds = project_cmds or []
    if project_cmds:
        reasons.append(f"El proyecto define scripts de verificación ({', '.join(project_cmds[:4])}): se permiten también npm/pnpm/yarn run, tests, tsc y eslint para que el agente pueda comprobar su trabajo sin que un permiso denegado aborte la ejecución. "
                       "Ojo: la copia aislada no trae node_modules ni .env, así que algunas verificaciones pueden fallar dentro de ella.")
    reasons.append(f"Tipo: {', '.join(tn)}. Esfuerzo {EFFORT_TXT[effort]} ({effort}) según el alcance, el nº de frentes y las palabras clave.")
    if a["words"] < 6:
        warnings.append("La tarea es muy corta: sin objetivo ni criterio de «hecho», el agente explorará de más y gastará tokens. Añade qué archivos y cómo comprobarlo.")

    # --- topología
    swarm = effort in ("L", "XL") and (a["concerns"] >= 2 or a["bullets"] >= 4)
    if swarm:
        reasons.append(f"Hay {a['concerns']} frentes independientes y el esfuerzo es {effort}: un enjambre pequeño reparte el trabajo en paralelo.")
    elif effort in ("L", "XL"):
        reasons.append("Tarea grande pero de un solo hilo: un enjambre no la acelera ni la abarata (cada agente repite el contexto base). Va un solo agente con un modelo más potente.")
    else:
        reasons.append("Tarea acotada: un solo agente es lo más barato (un enjambre costaría varias veces más por el contexto que repite cada agente).")
    role_names = pick_roles(a, effort, by_name, t)
    max_workers = 2 if effort == "L" else 3 if a["concerns"] < 4 else 4
    if swarm:
        writers = [r for r in role_names if by_name.get(r, {}).get("writes")] + [r for r in role_names if not by_name.get(r, {}).get("writes")]
        role_names = list(dict.fromkeys(writers))[:max_workers]
        if len(role_names) < 2:
            swarm = False
            reasons.append("Solo se identificó un rol relevante: no hay nada que repartir, se usa un único agente.")
        elif a["writes"] and effort in ("L", "XL") and len(role_names) >= 3 and "reviewer" in by_name and "reviewer" not in role_names:
            role_names.append("reviewer")
            reasons.append("Un revisor cada 2–4 workers que escriben: comprueba el resultado sin editar.")
    single_role = role_names[0] if role_names else ""
    if not swarm and not single_role:
        reasons.append("No se detectó una especialidad clara: agente general (forzar un rol no aporta y alarga el prompt).")

    # --- modelos
    base_i = {"XS": 0, "S": 0, "M": 1, "L": 2, "XL": 2}[effort]
    bump = 1 if (effort in ("L", "XL") and set(a["core"]) & DEEP_TYPES) else 0
    drop = 1 if a["read_only"] and base_i > 0 else 0
    lvl = _level(base_i + bump - drop)
    prefer = "gemini-3.8-flash" if effort == "XS" else None
    model = pick_model(models, lvl, blocked, prefer)
    workers_model = ""
    if swarm:
        workers_model = pick_model(models, _level(max(0, base_i - 1 + bump)), blocked)
        coord = ORCH_ID if any(m["id"] == ORCH_ID for m in models) else pick_model(models, "high", blocked)
        model = coord
        reasons.append(f"Coordinador: {coord or 'modelo por defecto'} (solo planifica y reparte); workers en un nivel más barato ({workers_model or 'por defecto'}).")
    else:
        reasons.append(f"Modelo {model or 'por defecto'} (nivel «{lvl}»{', bajado un nivel por ser solo lectura' if drop else ''}{', subido por ser un tema delicado' if bump else ''}).")
    if blocked and any(m["id"].startswith(b) for b in blocked for m in models):
        warnings.append("Tu cuota de Claude/GPT está agotada: el plan usa solo modelos Gemini.")

    # --- estimación y alternativas
    kind = "swarm" if swarm else "single"
    nw = len(role_names) if swarm else 1
    est = estimate(effort, nw, history, kind)
    alts = []
    if swarm:
        one = estimate(effort, 1, history, "single")
        alts.append({"name": "Un solo agente", "estimate": one["estimate"], "why_not": f"Más barato (~{one['estimate'] // 1000} k) pero serializa {a['concerns']} frentes; si prefieres ahorrar, elígelo manualmente."})
    else:
        sw = estimate(effort, max(2, min(3, a["concerns"])), history, "swarm")
        alts.append({"name": "Enjambre", "estimate": sw["estimate"], "why_not": f"Costaría ~{sw['estimate'] // 1000} k (≈{max(1, round(sw['estimate'] / max(1, est['estimate'])))}×) sin aportar paralelismo real."})
    if est["estimate"] > HEAVY_TOKENS:
        warnings.append(f"Plan caro (~{est['estimate'] // 1000} k tokens): se pedirá confirmación antes de lanzar.")
    budget = int(round(est["high"] / 10_000.0)) * 10_000 or 10_000
    dup = next((r for r in recent if r.get("fingerprint") == a["fingerprint"] and r.get("ws") == (ws or {}).get("path") and r.get("status") == "done"), None)
    if dup:
        warnings.append(f"Ya ejecutaste esta misma tarea en este workspace ({dup['id']}). Revisa ese resultado antes de gastar tokens otra vez.")
    git = bool(ws and ws.get("has_git"))
    writes = a["writes"] or (not a["read_only"] and bool(set(a["core"]) & {"feature", "bugfix", "refactor", "migration", "docs", "tests", "ux", "devops"}))
    mode = "accept-edits" if (writes or swarm) else "plan"
    plan = {
        "effort": effort, "effort_label": EFFORT_TXT[effort], "types": a["core"], "writes": bool(writes), "topology": kind,
        "roles": role_names if swarm else ([single_role] if single_role else []), "role": single_role if not swarm else "",
        "model": model, "workers_model": workers_model, "mode": mode, "perms": "dev" if project_cmds else "safe",  # una sola denegación aborta el run en headless y esos tokens se pierden; "dev" añade los scripts del proyecto
        "isolation": "worktree" if git else "inherit", "timeout_min": TIMEOUT_MIN[effort], "max_workers": max_workers if swarm else 1,
        "tokens": est, "budget": budget, "alternatives": alts, "reasons": reasons, "warnings": warnings,
        "heavy": est["estimate"] > HEAVY_TOKENS, "project_cmds": project_cmds[:6], "fingerprint": a["fingerprint"], "signals": {k: a[k] for k in ("words", "bullets", "scope", "small", "concerns", "score", "read_only")},
    }
    for k, v in overrides.items():
        if k in ("model", "workers_model", "mode", "isolation", "timeout_min", "budget") and v not in (None, ""):
            plan[k] = v
    return plan


def lean_text(swarm, max_workers=3):
    """Solo hay reglas para enjambres: en tareas individuales se midió que las reglas genéricas no ahorran (±1 %)."""
    return LEAN_SWARM.format(max_workers=max_workers) if swarm else ""
