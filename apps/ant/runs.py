"""Lanzador de agentes headless para Ant: ejecuta `agy --print` en un git
worktree aislado (o en el workspace) y sigue el proceso desde disco.

Estado en ~/.local/share/ant/{runs,worktrees}. Cada ejecución sobrevive a un
reinicio del servicio (sesión propia + archivo rc escrito por el envoltorio).
"""
import json
import os
import threading as _th
import re
import shutil
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path

HOME = Path.home()
DATA = Path(os.environ.get("ANT_DATA", HOME / ".local" / "share" / "ant"))
RUNS = DATA / "runs"
TREES = DATA / "worktrees"
AGY = os.environ.get("ANT_AGY") or shutil.which("agy") or str(HOME / ".local" / "bin" / "agy")
MAX_RUNNING = int(os.environ.get("ANT_MAX_RUNS", "3"))
USAGE_FN = None  # lo fija el servidor: run -> uso real de tokens (usage.run_usage)
_save_lock = _th.Lock()
ID_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-f]{4}$")
MODES = ("", "plan", "accept-edits")
ORCH_ID = "gemini-pro-orchestrator-g1-pro"  # «Orchestrator (Argon)»: planifica con Argon, ejecuta con Hydrogen
# Comandos habituales de trabajo (lectura + git local). Una sola denegación aborta el run en modo headless.
SAFE_CMDS = ["git status", "git log", "git diff", "git show", "git branch", "git rev-parse", "git config", "git add",
             "git commit", "git checkout", "git switch", "git worktree", "git ls-files", "ls", "cat", "echo", "pwd",
             "grep", "find", "head", "tail", "wc", "sort", "mkdir", "touch", "test", "tree", "stat", "file", "date", "whoami"]
# Scripts de verificación del proyecto (opt-in): sin ellos, un agente que quiera comprobar su trabajo aborta la ejecución.
DEV_CMDS = ["node --version", "npm --version", "pnpm --version", "yarn --version", "npm run", "npm test", "npm ls", "pnpm run", "pnpm test", "pnpm ls", "yarn run", "yarn test", "npx tsc", "npx eslint", "npx prettier", "npx jest",
            "npx vitest", "tsc", "eslint", "jest", "vitest", "pytest", "python3 -m pytest", "go test", "cargo test", "cargo check", "make test", "make check"]
GIT_ENV = {**os.environ, "LC_ALL": "C", "GIT_TERMINAL_PROMPT": "0"}


class RunError(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.msg, self.code = msg, code


# ------------------------------------------------------------------ git
def git(cwd, *args, timeout=30):
    r = subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True,
                       timeout=timeout, env=GIT_ENV)
    return r.returncode, r.stdout.strip(), r.stderr.strip()


def is_git_with_commit(path):
    return git(path, "rev-parse", "--verify", "-q", "HEAD")[0] == 0


# --------------------------------------------------------------- modelos
_models = {"t": 0, "v": []}


def models():
    if time.time() - _models["t"] < 300 and _models["v"]:
        return _models["v"]
    try:
        r = subprocess.run([AGY, "models"], capture_output=True, text=True, timeout=20)
        out = []
        for line in r.stdout.splitlines():  # formato real: "<id>\t<Nombre visible>"
            if not line.strip():
                continue
            mid, _, name = line.partition("\t")
            out.append({"id": mid.strip(), "name": (name or mid).strip()})
        _models["v"] = out
        _models["t"] = time.time()
    except (OSError, subprocess.SubprocessError):
        pass
    return _models["v"]


# --------------------------------------------------------------- procesos
def proc_start(pid):
    """Tiempo de arranque del proceso (campo 22 de /proc/pid/stat) o None."""
    try:
        s = Path(f"/proc/{pid}/stat").read_text()
        return int(s[s.rindex(")") + 2:].split()[19])
    except (OSError, ValueError, IndexError):
        return None


def allow_settings(dev=False):
    """JSON para `--settings`: solo esta sesión, nunca se guarda."""
    allow = []
    for c in SAFE_CMDS + (DEV_CMDS if dev else []):
        allow += [f"command({c})", f"command({c} *)"]
    return json.dumps({"permissions": {"allow": allow}})


def usage_mark(rid):
    return "[ant-run:%s]" % rid


def _latest(paths):
    def key(p):
        return [int(x) if x.isdigit() else 0 for x in re.split(r"[^0-9]+", p.parent.name if p.name == "bin" else p.name)]
    return sorted(paths, key=key)[-1:] if paths else []


def tool_path(home=None, base_path=None):
    """PATH para los agentes. Un servicio de systemd arranca con el PATH mínimo del sistema: sin node/npm/cargo del usuario,
    un agente que quiera verificar su trabajo no encuentra nada y acaba buscándolo por todo el disco (y abortando por permisos)."""
    home = Path(home or HOME)
    extra = [Path(x) for x in os.environ.get("ANT_EXTRA_PATH", "").split(os.pathsep) if x]
    extra += [home / ".local" / "bin", home / ".volta" / "bin", home / ".bun" / "bin", home / ".cargo" / "bin", home / "go" / "bin", home / ".local" / "share" / "pnpm"]
    extra += _latest(list((home / ".nvm" / "versions" / "node").glob("*/bin")))
    extra += _latest(list((home / ".local" / "share" / "fnm" / "node-versions").glob("*/installation/bin")))
    extra += _latest(list((home / ".fnm" / "node-versions").glob("*/installation/bin")))
    parts = (base_path if base_path is not None else os.environ.get("PATH", "")).split(os.pathsep)
    seen, out = set(), []
    for x in [str(e) for e in extra if Path(e).is_dir()] + parts:  # las del usuario primero: son las que el proyecto espera
        if x and x not in seen:
            seen.add(x)
            out.append(x)
    return os.pathsep.join(out)


# ---------------------------------------------------------------- dependencias enlazadas (node_modules)
EXCLUDE_MARK = "# ant: enlaces de dependencias en copias aisladas"
DEPS_NOTE = ("## Dependencias\nLos node_modules están ENLAZADOS a los de la carpeta principal del proyecto: son compartidos. "
             "NO ejecutes install/add/remove/update ni modifiques dependencias (si falta algo, indícalo en tu informe). "
             "Los paquetes internos que apunten a la carpeta principal se resuelven contra ella, no contra esta copia.")


def find_node_modules(ws_path, limit=12):
    """node_modules REALES (no enlaces) en la raíz y a uno o dos niveles (apps/*, packages/*...). Nunca entra en node_modules ni .git."""
    root, out = Path(ws_path), []
    def real(nm):
        return nm.is_dir() and not nm.is_symlink()
    if real(root / "node_modules"):
        out.append(Path("node_modules"))
    try:
        tops = sorted(t for t in root.iterdir() if t.is_dir() and not t.is_symlink() and not t.name.startswith(".") and t.name != "node_modules")
    except OSError:
        return out
    for t in tops:
        if real(t / "node_modules"):
            out.append(Path(t.name) / "node_modules")
        try:
            subs = sorted(s for s in t.iterdir() if s.is_dir() and not s.is_symlink() and not s.name.startswith(".") and s.name != "node_modules")[:60]
        except OSError:
            continue
        out += [Path(t.name) / s.name / "node_modules" for s in subs if real(s / "node_modules")]
    return out[:limit]


def ensure_excluded(ws_path):
    """Un `node_modules/` en .gitignore NO ignora un enlace (solo carpetas): sin esto, `git add -A` lo commitearía.
    Se añade a .git/info/exclude (idempotente y marcado)."""
    rc, out, _ = git(ws_path, "rev-parse", "--git-path", "info/exclude")
    if rc != 0 or not out:
        return False
    f = Path(out) if os.path.isabs(out) else Path(ws_path) / out
    try:
        text = f.read_text() if f.exists() else ""
        if EXCLUDE_MARK not in text:
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(text + ("\n" if text and not text.endswith("\n") else "") + EXCLUDE_MARK + "\nnode_modules\n")
        return True
    except OSError:
        return False


def link_deps(ws_path, cwd):
    """Enlaza los node_modules de la carpeta principal dentro de la copia aislada. Devuelve las rutas relativas enlazadas."""
    rels = find_node_modules(ws_path)
    if not rels or not ensure_excluded(ws_path):
        return []
    done = []
    for rel in rels:
        dst = Path(cwd) / rel
        if dst.exists() or dst.is_symlink() or not dst.parent.is_dir():
            continue
        try:
            os.symlink(Path(ws_path) / rel, dst, target_is_directory=True)
            done.append(str(rel))
        except OSError:
            pass
    return done


def unlink_deps(cwd, rels):
    """Quita SOLO los enlaces (nunca borra su contenido) antes de eliminar la copia."""
    for rel in rels or []:
        p = Path(cwd) / rel
        if p.is_symlink():
            p.unlink()


def deps_sig(ws_path, rels):
    """Huella barata de los node_modules compartidos para avisar si el agente los modificó."""
    sig = {}
    for rel in rels or []:
        d = Path(ws_path) / rel
        try:
            sig[str(rel)] = [d.stat().st_mtime_ns] + [(d / m).stat().st_mtime_ns for m in (".package-lock.json", ".yarn-integrity", ".modules.yaml") if (d / m).exists()]
        except OSError:
            sig[str(rel)] = None
    return sig


def alive(run):
    return bool(run.get("pid")) and proc_start(run["pid"]) == run.get("pstart")


# ------------------------------------------------------------------ runs
def rdir(rid):
    if not ID_RE.match(rid or ""):
        raise RunError("Identificador de ejecución inválido.")
    return RUNS / rid


def load(rid):
    d = rdir(rid)
    try:
        run = json.loads((d / "run.json").read_text())
    except (OSError, ValueError):
        raise RunError("La ejecución no existe.", 404)
    return refresh(run, d)


def save(run):
    d = RUNS / run["id"]
    with _save_lock:
        tmp = d / "run.json.tmp"
        tmp.write_text(json.dumps(run, ensure_ascii=False, indent=1))
        tmp.replace(d / "run.json")


def slim_usage(u):
    return {k: u[k] for k in ("in", "cache", "out", "total", "steps", "conv")} | {"by_agent": {n: {k: v[k] for k in ("in", "cache", "out", "steps")} for n, v in u["by_agent"].items()}, "at": time.time()}


_mod_lock = threading.RLock()


def mutate(rid, fn):
    """Lee-modifica-guarda run.json de forma atómica respecto a otros hilos (vigilante, bonos, recados)."""
    d = RUNS / rid
    with _mod_lock:
        try:
            run = json.loads((d / "run.json").read_text())
        except (OSError, ValueError):
            return None
        fn(run)
        save(run)
        return run


def update_usage(rid, u):
    """Persiste el consumo medido (lo llama el vigilante del servidor)."""
    def f(run):
        run["usage"] = slim_usage(u)
        run["conv"] = u["conv"]
    mutate(rid, f)


def log_text(d, limit=24000):
    try:
        with open(d / "out.log", "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - limit))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""


def _final_deps(run):
    if run.get("linked_deps"):
        run["deps_modified"] = deps_sig(run["ws"], run["linked_deps"]) != (run.get("deps_sig") or {})


def _final_usage(run):
    _final_deps(run)
    if USAGE_FN:
        try:
            u = USAGE_FN(run)
            if u:
                run["usage"] = slim_usage(u)
                run["conv"] = u["conv"]
        except Exception:
            pass


def refresh(run, d):
    """Calcula el estado real y lo fija en disco cuando termina."""
    if run["status"] != "running":
        return run
    rc_file = d / "rc"
    if rc_file.exists():
        try:
            rc = int(rc_file.read_text().strip() or "-1")
        except ValueError:
            rc = -1
        text = log_text(d, 6000)
        run["rc"], run["ended"] = rc, rc_file.stat().st_mtime
        if (d / "budget").exists():
            run["status"] = "budget"
        elif (d / "stopped").exists():
            run["status"] = "stopped"
        elif "headless mode cannot prompt" in text:
            run["status"] = "blocked"  # rc=0 y sin salida: una herramienta pidió un permiso que no se puede pedir
        elif "print timeout after" in text:
            run["status"] = "timeout"
        elif "RESOURCE_EXHAUSTED" in text or "quota reached" in text.lower():
            run["status"] = "quota"
            m = re.search(r"Resets in ([0-9hms ]+)", text)
            run["quota_reset"] = m.group(1).strip() if m else ""
        else:
            run["status"] = "done" if rc == 0 else "failed"
        _final_usage(run)
        save(run)
    elif not alive(run):
        # Si la paramos nosotros, el envoltorio muere con el grupo y no escribe rc.
        run["status"] = "budget" if (d / "budget").exists() else "stopped" if (d / "stopped").exists() else "lost"
        run["ended"] = time.time()
        _final_usage(run)
        save(run)
    return run


def public(run):
    return {k: v for k, v in run.items() if k not in ("pstart",)}


def list_runs():
    out = []
    if RUNS.is_dir():
        for d in RUNS.iterdir():
            try:
                out.append(public(load(d.name)))
            except RunError:
                continue
    out.sort(key=lambda r: r["started"], reverse=True)
    return out


def detail(rid):
    run = load(rid)
    d = RUNS / rid
    info = public(run)
    info["log"] = log_text(d)
    info["merge_cmd"] = None
    info["resumable"] = resumable(run)
    if run["isolation"] == "worktree" and Path(run["cwd"]).is_dir():
        cwd = run["cwd"]
        info["commits"] = git(cwd, "log", "--oneline", f'{run["base"]}..HEAD')[1].splitlines()
        info["diffstat"] = git(cwd, "diff", "--stat", run["base"])[1]
        info["untracked"] = [l[3:] for l in git(cwd, "status", "--porcelain")[1].splitlines() if l.startswith("??")]
        info["merge_cmd"] = f'git -C "{run["ws"]}" merge --no-ff {run["branch"]}'
        info["resumable"] = info["resumable"] and bool(info["commits"] or info["diffstat"] or info["untracked"])  # sin trabajo parcial no hay nada que reanudar
    return info


def start(ws, prompt, role_brief="", role_name="", model="", mode="plan", isolation="worktree",
          auto_approve=False, timeout_min=30, swarm=False, workers_model="", allow_commands=False, team=None,
          token_budget=0, plan=None, lean=True, reuse=None, resumed_from=None, allow_dev=False, link_deps_opt=False):
    """ws = dict de workspace ya validado por el servidor."""
    prompt = (prompt or "").strip()
    if not prompt or len(prompt) > 20000:
        raise RunError("La tarea debe tener entre 1 y 20 000 caracteres.")
    if mode not in MODES:
        raise RunError("Modo inválido.")
    if isolation not in ("worktree", "inherit"):
        raise RunError("Aislamiento inválido.")
    ids = [m["id"] for m in models()]
    if swarm and not model:
        model = ORCH_ID  # el coordinador por defecto es Orchestrator (Argon)
    if model and model not in ids:
        raise RunError("Modelo desconocido o no disponible en tu cuenta (`agy models`).")
    if workers_model and workers_model not in ids:
        raise RunError("Modelo de los workers desconocido (`agy models`).")
    if swarm and mode == "plan":
        mode = "accept-edits"  # un enjambre en modo plan no podría escribir nada
    timeout_min = max(1, min(int(timeout_min or 30), 120))
    if sum(1 for r in list_runs() if r["status"] == "running") >= MAX_RUNNING:
        raise RunError(f"Ya hay {MAX_RUNNING} ejecuciones en marcha (límite para cuidar la cuota).", 429)
    if not Path(AGY).exists() and not shutil.which(AGY):
        raise RunError("No se encuentra el ejecutable agy.", 500)

    rid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    d = RUNS / rid
    d.mkdir(parents=True)
    cwd, branch, base, dirty = ws["path"], None, None, False
    try:
        dirty = bool(git(ws["path"], "status", "--porcelain")[1]) if (Path(ws["path"]) / ".git").exists() else False
        linked, sig0 = [], {}
        if reuse:  # reanudación: se retoma la copia aislada de otra ejecución, sin crear una nueva
            cwd, branch, base = reuse["cwd"], reuse["branch"], reuse["base"]
            linked, sig0 = reuse.get("linked_deps", []), reuse.get("deps_sig", {})
        elif isolation == "worktree":
            if not is_git_with_commit(ws["path"]):
                raise RunError("El workspace no es un repositorio git con al menos un commit; usa «sin aislar».")
            base = git(ws["path"], "rev-parse", "HEAD")[1]
            branch = f"ant/{rid}"
            cwd = str(TREES / f'{re.sub(r"[^A-Za-z0-9._-]", "_", ws["name"])}-{rid}')
            TREES.mkdir(parents=True, exist_ok=True)
            rc, _, err = git(ws["path"], "worktree", "add", "-b", branch, cwd, "HEAD", timeout=120)
            if rc != 0:
                raise RunError("No se pudo crear el worktree: " + err[:300], 500)
            if link_deps_opt:
                linked = link_deps(ws["path"], cwd)
                sig0 = deps_sig(ws["path"], linked)

        team_txt = ""
        if team and team.get("roles"):
            parts = [f"\n\n## Equipo: {team['name']}\nForma el enjambre con UN worker por rol (varios del mismo rol si el trabajo se puede "
                     "dividir sin tocar los mismos archivos). Adapta cada plantilla de brief al repo real y rellena los marcadores <…>."]
            for rl in team["roles"]:
                parts.append(f"\n### {rl['name']} — {rl['title']} (escribe código: {'sí' if rl['writes'] else 'no'}; workspace: {rl['workspace']})\n{rl['brief']}")
            if team.get("flow"):
                parts.append(f"\n## Orden de trabajo sugerido\n{team['flow']}")
            team_txt = "".join(parts)
        import planner
        mw = (plan or {}).get("max_workers") or (len(team["roles"]) if team and team.get("roles") else 3)
        lean_txt = ("\n\n" + planner.lean_text(swarm, mw)) if (lean and planner.lean_text(swarm, mw)) else ""
        mk = usage_mark(rid)  # permite localizar la conversación y medir sus tokens reales. Va ANTES de lo largo:
        # Antigravity trunca a ~4 KB el primer mensaje en su transcript compacto.
        deps_txt = ("\n\n" + DEPS_NOTE) if linked else ""
        if swarm:  # el /swarm debe ir al principio para que Antigravity lo expanda
            full = "/swarm " + prompt + "\n\n" + mk + team_txt + lean_txt + deps_txt + (
                f"\n\nTodos los workers, el verifier y cualquier helper deben correr en el modelo {workers_model}." if workers_model else "")
        else:
            sections = [mk]
            if role_brief.strip():
                sections.append("## Rol\n" + role_brief.strip() + "\n(Los textos entre <…> son marcadores: deduce su valor de la tarea.)")
            if lean_txt:
                sections.append(lean_txt.strip())
            if linked:
                sections.append(DEPS_NOTE)
            sections.append("## Tarea\n" + prompt)
            full = "\n\n".join(sections)
        cmd = [AGY, "--print", full, "--print-timeout", f"{timeout_min}m"]
        if model:
            cmd += ["--model", model]
        if mode:
            cmd += ["--mode", mode]
        if auto_approve:
            cmd += ["--dangerously-skip-permissions"]
        elif allow_commands:
            cmd += ["--settings", allow_settings(allow_dev)]
        env = {**os.environ, "PATH": tool_path(), "ANT_OUT": str(d / "out.log"), "ANT_RC": str(d / "rc")}
        p = subprocess.Popen(
            ["sh", "-c", '"$@" >>"$ANT_OUT" 2>&1 </dev/null; echo $? >"$ANT_RC"', "ant-run", *cmd],
            cwd=cwd, env=env, start_new_session=True, stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        threading.Thread(target=p.wait, daemon=True).start()  # evita zombis
    except Exception:
        # No dejar restos si algo falla antes de lanzar.
        if branch and not reuse and Path(cwd).is_dir():
            unlink_deps(cwd, linked)
            git(ws["path"], "worktree", "remove", "--force", cwd)
            git(ws["path"], "branch", "-D", branch)
        shutil.rmtree(d, ignore_errors=True)
        raise
    run = {
        "id": rid, "ws": ws["path"], "ws_name": ws["name"], "prompt": prompt,
        "role": role_name or None, "model": model, "mode": mode,
        "isolation": isolation, "auto_approve": bool(auto_approve), "swarm": bool(swarm),
        "workers_model": workers_model or None, "team": (team or {}).get("id"), "token_budget": int(token_budget or 0), "plan": plan, "lean": bool(lean), "resumed_from": resumed_from, "linked_deps": linked, "deps_sig": sig0, "allow_dev": bool(allow_dev) and not auto_approve, "allow_commands": bool(allow_commands) and not auto_approve,
        "cwd": cwd, "branch": branch, "base": base, "ws_dirty": dirty,
        "pid": p.pid, "pstart": proc_start(p.pid), "started": time.time(),
        "timeout_min": timeout_min, "status": "running",
    }
    save(run)
    if resumed_from:  # la ejecución original cede su copia a la nueva
        try:
            old = json.loads((RUNS / resumed_from / "run.json").read_text())
            old["adopted_by"] = rid
            save(old)
        except (OSError, ValueError):
            pass
    return public(run)


RESUMABLE = ("budget", "timeout", "stopped", "failed", "quota", "blocked", "lost")


def resumable(run):
    return (run["status"] in RESUMABLE and run.get("isolation") == "worktree" and not run.get("adopted_by")
            and bool(run.get("cwd")) and Path(run["cwd"]).is_dir())


def stop(rid, reason=None):
    run = load(rid)
    if run["status"] != "running":
        raise RunError("La ejecución ya no está en marcha.", 409)
    if not alive(run):
        raise RunError("El proceso ya no existe.", 409)
    (RUNS / rid / ("budget" if reason == "budget" else "stopped")).write_text("1")
    try:
        os.killpg(run["pid"], signal.SIGTERM)  # sesión propia: pgid == pid
    except ProcessLookupError:
        pass

    def hard():
        time.sleep(8)
        if proc_start(run["pid"]) == run["pstart"]:
            try:
                os.killpg(run["pid"], signal.SIGKILL)
            except ProcessLookupError:
                pass
    threading.Thread(target=hard, daemon=True).start()
    return {"ok": True}


def discard(rid, force=False):
    """Quita worktree + rama + registro. Sin force se niega si hay trabajo sin integrar."""
    run = load(rid)
    if run["status"] == "running":
        raise RunError("Detén la ejecución antes de descartarla.", 409)
    if run.get("adopted_by"):  # su copia aislada pertenece ahora a la ejecución que la reanudó
        shutil.rmtree(RUNS / rid, ignore_errors=True)
        return {"ok": True}
    if run["isolation"] == "worktree":
        cwd = Path(run["cwd"])
        if not str(cwd.resolve()).startswith(str(TREES.resolve()) + os.sep):
            raise RunError("Ruta de worktree fuera de la zona de Ant; no se toca.", 500)
        if cwd.is_dir():
            unmerged = git(cwd, "log", "--oneline", f'{run["base"]}..HEAD')[1]
            changes = git(cwd, "status", "--porcelain")[1]
            if (unmerged or changes) and not force:
                raise RunError("El worktree tiene trabajo sin integrar. Revisa el diff o confirma el descarte.", 409)
            unlink_deps(cwd, run.get("linked_deps"))  # nunca dejar que git siga un enlace hacia las dependencias reales
            rc, _, err = git(run["ws"], "worktree", "remove", "--force", str(cwd), timeout=120)
            if rc != 0:
                raise RunError("git no pudo quitar el worktree: " + err[:300], 500)
        git(run["ws"], "worktree", "prune")
        if run.get("branch"):
            git(run["ws"], "branch", "-D", run["branch"])
    shutil.rmtree(RUNS / rid, ignore_errors=True)
    return {"ok": True}


# ------------------------------------------------------------------ interacción con un agente (bono, recados)
def add_budget(rid, tokens, by="operador"):
    """Amplía el presupuesto de tokens de una ejecución EN MARCHA (el vigilante lo lee en cada ciclo)."""
    run = load(rid)
    if run["status"] != "running":
        raise RunError("La ejecución ya no está en marcha: reanúdala en lugar de ampliar su presupuesto.", 409)
    if not int(run.get("token_budget") or 0):
        raise RunError("Esta ejecución no tiene presupuesto de tokens: no hay nada que ampliar.", 409)
    try:
        tokens = int(tokens)
    except (TypeError, ValueError):
        raise RunError("Cantidad de tokens inválida.")
    if not 1000 <= tokens <= 5_000_000:
        raise RunError("El bono debe estar entre 1 000 y 5 000 000 de tokens.")
    out = {}

    def f(r):
        r["token_budget"] = int(r.get("token_budget") or 0) + tokens
        r.setdefault("bonuses", []).append({"at": time.time(), "tokens": tokens, "by": by})
        out["budget"] = r["token_budget"]
    mutate(rid, f)
    return {"ok": True, "token_budget": out.get("budget")}


def conv_of(run):
    return run.get("conv") or (run.get("usage") or {}).get("conv")


def follow_up(run, text):
    """Continúa la conversación de Antigravity de esta ejecución con un mensaje nuevo (`agy --conversation <id> --print`).
    Crea una ejecución nueva que hereda carpeta, modelo y permisos; no toca la original."""
    conv = conv_of(run)
    if not conv:
        raise RunError("Todavía no se ha localizado la conversación de Antigravity de este agente.", 409)
    cwd = run.get("cwd") if run.get("cwd") and Path(run["cwd"]).is_dir() else run["ws"]
    if not Path(cwd).is_dir():
        raise RunError("La carpeta de trabajo de esta ejecución ya no existe.", 409)
    if sum(1 for r in list_runs() if r["status"] == "running") >= MAX_RUNNING:
        raise RunError(f"Ya hay {MAX_RUNNING} ejecuciones en marcha (límite para cuidar la cuota).", 429)
    if not Path(AGY).exists() and not shutil.which(AGY):
        raise RunError("No se encuentra el ejecutable agy.", 500)
    rid = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    d = RUNS / rid
    d.mkdir(parents=True)
    timeout_min = max(1, min(int(run.get("timeout_min") or 30), 120))
    cmd = [AGY, "--conversation", conv, "--print", text, "--print-timeout", f"{timeout_min}m"]
    if run.get("model"):
        cmd += ["--model", run["model"]]
    if run.get("mode"):
        cmd += ["--mode", run["mode"]]
    if run.get("auto_approve"):
        cmd += ["--dangerously-skip-permissions"]
    elif run.get("allow_commands"):
        cmd += ["--settings", allow_settings(bool(run.get("allow_dev")))]
    env = {**os.environ, "PATH": tool_path(), "ANT_OUT": str(d / "out.log"), "ANT_RC": str(d / "rc")}
    try:
        p = subprocess.Popen(["sh", "-c", '"$@" >>"$ANT_OUT" 2>&1 </dev/null; echo $? >"$ANT_RC"', "ant-run", *cmd], cwd=cwd, env=env,
                             start_new_session=True, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except Exception:
        shutil.rmtree(d, ignore_errors=True)
        raise
    threading.Thread(target=p.wait, daemon=True).start()
    new = {"id": rid, "ws": run["ws"], "ws_name": run["ws_name"], "prompt": text, "role": run.get("role"), "model": run.get("model") or "", "mode": run.get("mode") or "",
           "isolation": "inherit", "auto_approve": bool(run.get("auto_approve")), "swarm": bool(run.get("swarm")), "workers_model": run.get("workers_model"), "team": run.get("team"),
           "token_budget": 0, "plan": None, "lean": False, "resumed_from": None, "followup_of": run["id"], "linked_deps": [], "allow_commands": bool(run.get("allow_commands")),
           "allow_dev": bool(run.get("allow_dev")), "conv": conv, "cwd": cwd, "branch": None, "base": None, "ws_dirty": False, "pid": p.pid, "pstart": proc_start(p.pid),
           "started": time.time(), "timeout_min": timeout_min, "status": "running"}
    save(new)
    return public(new)


def send_message(rid, text, to=None):
    """Recado al agente. En pleno turno `agy --print` no admite mensajes: queda EN COLA y se envía al terminar (si terminó bien)."""
    run = load(rid)
    text = (text or "").strip()
    if not 1 <= len(text) <= 4000:
        raise RunError("El recado debe tener entre 1 y 4000 caracteres.")
    if not conv_of(run):
        raise RunError("Todavía no se ha localizado la conversación de Antigravity de este agente; inténtalo en unos segundos.", 409)
    msg = f"[Recado del jefe{' para ' + to if to else ''}] {text}"
    if run["status"] == "running":
        mutate(rid, lambda r: r.__setitem__("pending_message", msg))
        return {"queued": True}
    if run["status"] != "done":
        raise RunError(f"La ejecución terminó como «{run['status']}»: no se puede continuar su conversación con un recado. Reanúdala o lánzala de nuevo.", 409)
    return {"sent": True, "run": follow_up(run, msg)["id"]}


def deliver_pending():
    """Lo llama el vigilante cada 2 s: envía los recados en cola cuando el turno terminó bien; si no, los descarta con motivo."""
    if not RUNS.is_dir():
        return
    for d in list(RUNS.iterdir()):
        try:
            run = load(d.name)
        except RunError:
            continue
        msg = run.get("pending_message")
        if not msg or run["status"] == "running":
            continue
        mutate(d.name, lambda r: (r.pop("pending_message", None), r.__setitem__("pending_result", run["status"])))
        if run["status"] == "done":
            try:
                follow_up(run, msg)
            except RunError as e:
                mutate(d.name, lambda r: r.__setitem__("pending_result", "error: " + str(e)))
