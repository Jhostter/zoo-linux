#!/usr/bin/env python3
"""🐜 Ant — panel local para ver y organizar agentes de Antigravity.

Solo stdlib. Escucha en 127.0.0.1. Lee (solo lectura) el estado de los
enjambres nativos de Antigravity y gestiona una biblioteca de roles que se
instala como skill en cualquier workspace.
"""
import json
import mimetypes
import os
import re
import sqlite3
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import chat
import planner
import runs
import usage

HOME = Path.home()
HERE = Path(__file__).resolve().parent
PORT = int(os.environ.get("ANT_PORT", "4511"))
GEMINI = Path(os.environ.get("ANT_GEMINI_DIR", HOME / ".gemini"))
APPDATA = GEMINI / "antigravity"
# IDE, CLI (agy) y la carpeta común guardan sus conversaciones en brains distintos.
BRAINS = [GEMINI / d / "brain" for d in ("antigravity", "antigravity-cli", "antigravity-ide")]
BRAIN = BRAINS[0]


def conv_dir(conv):
    for b in BRAINS:
        if (b / conv).is_dir():
            return b / conv
    return BRAINS[0] / conv


def all_convs():
    for b in BRAINS:
        if b.is_dir():
            yield from b.iterdir()
PROJECTS_DIR = GEMINI / "config" / "projects"
USER_ROLES = Path(os.environ.get("ANT_USER_ROLES", HOME / ".config" / "ant" / "roles"))
BUILTIN_ROLES = HERE / "roles"
SKILL_NAME = "team-roles"
NAME_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
MARK = "<!-- Creado por Ant -->"
runs.USAGE_FN = lambda run: usage.run_usage(BRAINS, run)  # el uso real se mide al terminar cada ejecución


# ---------------------------------------------------------------- utilidades
def read_json(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def tail_lines(p, n=40, block=65536):
    """Últimas n líneas de un archivo sin leerlo entero."""
    try:
        with open(p, "rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - block))
            data = f.read().decode("utf-8", "replace").splitlines()
        return data[-n:], size
    except OSError:
        return [], 0


def count_lines(p):
    try:
        with open(p, "rb") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def uri_to_path(uri):
    return unquote(uri[7:]) if uri.startswith("file://") else uri


def parse_frontmatter(text):
    meta, body = {}, text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            for line in text[3:end].strip().splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip()] = v.strip().strip('"')
            body = text[end + 4:].lstrip("\n")
    return meta, body


# ------------------------------------------------------------- workspaces
GEMINI_PROJECTS = GEMINI / "projects.json"  # registro del CLI (agy)
IDE_STORAGES = [Path(x) for x in os.environ.get("ANT_IDE_STORAGE", "").split(os.pathsep) if x] or [
    HOME / ".config" / "Antigravity IDE" / "User" / "globalStorage" / "storage.json",
    HOME / ".config" / "Antigravity" / "User" / "globalStorage" / "storage.json"]
IDE_STATE_DBS = [Path(x) for x in os.environ.get("ANT_IDE_STATE_DB", "").split(os.pathsep) if x] or [
    HOME / ".config" / "Antigravity IDE" / "User" / "globalStorage" / "state.vscdb",
    HOME / ".config" / "Antigravity" / "User" / "globalStorage" / "state.vscdb"]
MANUAL_FILE = Path(os.environ.get("ANT_WORKSPACES_FILE", HOME / ".config" / "ant" / "workspaces.json"))
OFFICE_FILE = Path(os.environ.get("ANT_OFFICE_FILE", HOME / ".config" / "ant" / "office.json"))  # ajustes de la oficina del stream (estilo visual)
ALLOWED_ROOTS = [Path(x) for x in os.environ.get("ANT_ALLOWED_ROOTS", "").split(os.pathsep) if x] or [
    HOME, Path("/media") / HOME.name, Path("/mnt")]


def ide_recent_uris(db):
    """«Abiertos recientemente» del IDE (SQLite, solo lectura): carpetas y archivos .code-workspace."""
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro&immutable=1", uri=True, timeout=2)
        try:
            row = con.execute("select value from ItemTable where key='history.recentlyOpenedPathsList'").fetchone()
        finally:
            con.close()
        entries = json.loads(row[0]).get("entries", []) if row else []
    except (sqlite3.Error, ValueError, OSError, TypeError):
        return []
    return [u for u in ((e.get("folderUri") or (e.get("workspace") or {}).get("configPath")) for e in entries) if u]


def manual_paths():
    return [p for p in (read_json(MANUAL_FILE, {}) or {}).get("paths", []) if isinstance(p, str)]


def _add_ws(out, path, name, source, wid=None):
    """Suma un workspace; si ya estaba (misma ruta), solo apunta la fuente."""
    if not path:
        return
    if path.endswith(".code-workspace"):
        if not Path(path).is_file():
            # El IDE lo recuerda pero el archivo ya no existe: no hay carpetas que listar, pero se avisa.
            path = os.path.normpath(path)
            if path in out:
                if source not in out[path]["sources"]:
                    out[path]["sources"].append(source)
            else:
                out[path] = {"id": None, "name": Path(path).stem, "named": True, "path": path,
                             "sources": [source], "missing_file": True}
            return
        cw = read_json(path) or {}
        for f in cw.get("folders", []):
            fp = f.get("path") or ""
            if fp:
                _add_ws(out, os.path.normpath(os.path.join(os.path.dirname(path), fp)), None, source)
        return
    path = os.path.normpath(path)
    if path in out:
        if source not in out[path]["sources"]:
            out[path]["sources"].append(source)
        if name and not out[path].get("named"):
            out[path].update(name=name, named=True)
        return
    out[path] = {"id": wid, "name": name or Path(path).name, "named": bool(name), "path": path, "sources": [source]}


def workspaces():
    """Workspaces de TODAS las fuentes: proyectos de Antigravity (con o sin git), registro del
    CLI, workspaces recientes del IDE y carpetas añadidas a mano en Ant."""
    out = {}
    for f in sorted(PROJECTS_DIR.glob("*.json")) if PROJECTS_DIR.is_dir() else []:
        d = read_json(f, {})
        for r in (d.get("projectResources") or {}).get("resources", []):
            uri = (r.get("gitFolder") or {}).get("folderUri") or r.get("folderUri")
            if uri:
                _add_ws(out, uri_to_path(uri), d.get("name"), "Antigravity", d.get("id"))
    for pth in ((read_json(GEMINI_PROJECTS, {}) or {}).get("projects") or {}):
        _add_ws(out, pth, None, "CLI")
    for st in IDE_STORAGES:
        d = read_json(st, {}) or {}
        for uri in ((d.get("profileAssociations") or {}).get("workspaces") or {}):
            _add_ws(out, uri_to_path(uri), None, "IDE")
        for b in (d.get("backupWorkspaces") or {}).get("workspaces", []):
            if isinstance(b, dict) and b.get("configURIPath", "").endswith(".code-workspace"):
                _add_ws(out, uri_to_path(b["configURIPath"]), None, "IDE")
        last = ((d.get("windowsState") or {}).get("lastActiveWindow") or {}).get("workspaceIdentifier") or {}
        if str(last.get("configURIPath", "")).endswith(".code-workspace"):
            _add_ws(out, uri_to_path(last["configURIPath"]), None, "IDE")
    for db in IDE_STATE_DBS:
        for uri in ide_recent_uris(db):
            _add_ws(out, uri_to_path(uri), None, "IDE")
    for pth in manual_paths():
        _add_ws(out, pth, None, "Ant")
    res = list(out.values())
    for w in res:
        p = Path(w["path"])
        w.pop("named", None)
        w["exists"] = p.is_dir()
        w["mtime"] = p.stat().st_mtime if w["exists"] else 0
        sk = p / ".agents" / "skills" / SKILL_NAME / "SKILL.md"
        w["installed"] = sk.is_file() and MARK in sk.read_text(errors="replace")
        w["has_agents_dir"] = (p / ".agents").is_dir()
        w["has_git"] = (p / ".git").exists()
        w["manual"] = "Ant" in w["sources"]
        w["missing_file"] = bool(w.get("missing_file"))
        if w["missing_file"]:
            w["exists"] = False
    # existentes primero, y entre ellos los tocados más recientemente
    res.sort(key=lambda w: (not w["missing_file"], not w["exists"], -w["mtime"], w["name"].lower()))
    return res


def add_workspace(path, create=False):
    if not isinstance(path, str) or not path.startswith("/") or "\0" in path:
        return 400, {"error": "Indica una ruta absoluta (empieza por /)."}
    p = Path(os.path.normpath(path))
    roots = [r.resolve() for r in ALLOWED_ROOTS]
    real = p.resolve()
    if not any(real == r or r in real.parents for r in roots):
        return 400, {"error": "La carpeta debe estar dentro de tu home, /media o /mnt."}
    note = ""
    if not p.exists():
        if not create:
            return 404, {"error": "La carpeta no existe. Marca «Crear si no existe» para crearla."}
        try:
            p.mkdir(parents=True)
            subprocess.run(["git", "-C", str(p), "init", "-q"], check=True, capture_output=True, timeout=30)
            r = subprocess.run(["git", "-C", str(p), "commit", "-q", "--allow-empty", "-m", "Inicio del proyecto"],
                               capture_output=True, text=True, timeout=30)
            if r.returncode != 0:
                note = "Carpeta creada con git, pero el commit inicial falló (¿falta git config user.name/email?): " + r.stderr.strip()[:200]
        except (OSError, subprocess.SubprocessError) as e:
            return 500, {"error": f"No se pudo crear la carpeta: {e}"}
    elif not p.is_dir() and not (p.is_file() and p.name.endswith(".code-workspace")):
        return 400, {"error": "La ruta existe pero no es una carpeta ni un archivo .code-workspace."}
    paths = manual_paths()
    if str(p) not in paths:
        paths.append(str(p))
        MANUAL_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = MANUAL_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"paths": paths}, indent=1))
        tmp.replace(MANUAL_FILE)
    return 200, {"ok": True, "path": str(p), "note": note}


def remove_workspace(path):
    paths = manual_paths()
    if path not in paths:
        return 409, {"error": "Solo se pueden quitar las carpetas añadidas desde Ant."}
    paths.remove(path)
    MANUAL_FILE.write_text(json.dumps({"paths": paths}, indent=1))
    return 200, {"ok": True}


def workspace_by_path(path):
    for w in workspaces():
        if w["path"] == path:
            return w
    return None


# ------------------------------------------------------------------ roles
CATEGORIES = ["Producto y diseño", "Arquitectura y construcción", "Plataformas móviles", "Migraciones",
              "Calidad y seguridad", "Operaciones y entrega", "Otros"]
TEAMS_FILES = [HERE / "teams.json", USER_ROLES.parent / "teams.json"]


def load_roles():
    roles = {}
    for src, base in (("incluido", BUILTIN_ROLES), ("propio", USER_ROLES)):
        if not base.is_dir():
            continue
        for f in sorted(base.glob("*.md")):
            name = f.stem
            if not NAME_RE.match(name):
                continue
            meta, body = parse_frontmatter(f.read_text(errors="replace"))
            cat = meta.get("category", "Otros")
            roles[name] = {
                "name": name,
                "title": meta.get("title", name),
                "category": cat if cat in CATEGORIES else "Otros",
                "icon": meta.get("icon", "🤖"),
                "summary": meta.get("summary", ""),
                "writes": meta.get("writes", "no") == "yes",
                "workspace": meta.get("workspace", "inherit"),
                "brief": body.strip(),
                "source": src,
                "editable": src == "propio",
            }
    return sorted(roles.values(), key=lambda r: (CATEGORIES.index(r["category"]), r["source"] != "propio", r["title"].lower()))


def load_teams():
    teams, names = {}, {r["name"] for r in load_roles()}
    for f in TEAMS_FILES:
        for t in (read_json(f, []) or []):
            if isinstance(t, dict) and re.fullmatch(r"[a-z][a-z0-9-]{0,39}", str(t.get("id", ""))):
                t["roles"] = [r for r in t.get("roles", []) if r in names]
                teams[t["id"]] = t
    return list(teams.values())


def save_role(d):
    name = str(d.get("name", "")).strip()
    if not NAME_RE.match(name):
        return 400, {"error": "El identificador solo admite minúsculas, números y guiones (empieza por letra, máx. 40)."}
    title = " ".join(str(d.get("title", "")).split())[:80]
    brief = str(d.get("brief", "")).strip()
    if not title or not brief or len(brief) > 8000:
        return 400, {"error": "Indica un nombre visible y un brief (máx. 8000 caracteres)."}
    cat = d.get("category") if d.get("category") in CATEGORIES else "Otros"
    icon = (str(d.get("icon", "🤖")).strip() or "🤖")[:4]
    summary = " ".join(str(d.get("summary", "")).split())[:240]
    ws = d.get("workspace") if d.get("workspace") in ("inherit", "share", "branch") else "inherit"
    clean = lambda v: v.replace("\n", " ").replace("---", "—")
    text = (f"---\ntitle: {clean(title)}\ncategory: {cat}\nicon: {clean(icon)}\nsummary: {clean(summary)}\n"
            f"writes: {'yes' if d.get('writes') else 'no'}\nworkspace: {ws}\n---\n{brief}\n")
    USER_ROLES.mkdir(parents=True, exist_ok=True)
    f = USER_ROLES / f"{name}.md"
    tmp = f.with_suffix(".tmp")
    tmp.write_text(text)
    tmp.replace(f)
    return 200, {"ok": True, "name": name}


def delete_role(name):
    f = USER_ROLES / f"{name}.md"
    if not NAME_RE.match(str(name)) or not f.is_file():
        return 404, {"error": "Solo se pueden borrar roles propios existentes."}
    f.unlink()
    return 200, {"ok": True}


def render_skill(roles):
    lines = [
        "---",
        f"name: {SKILL_NAME}",
        "description: >-",
        "  Catálogo de roles y plantillas de brief para formar un equipo de agentes.",
        "  Úsalo al coordinar un swarm, al repartir trabajo entre agentes o cuando el",
        "  usuario pida un equipo con arquitecto, diseñador, desarrollador móvil, migración o revisor.",
        "---",
        MARK,
        "",
        "# Roles del equipo",
        "",
        "Al crear workers con `swarm{action:\"add\"}`, usa estos roles como punto de",
        "partida. Cada plantilla es el `brief`: adáptala a la tarea concreta, indica",
        "qué archivos son suyos y qué debe publicar al terminar (`[done] …`).",
        "Los roles que escriben código deben ir con `workspace:\"share\"` o `\"branch\"`;",
        "los que solo leen, con `inherit`. Rellena los marcadores <…> con datos reales del repo.",
        "",
    ]
    last = None
    for r in sorted(roles, key=lambda r: (CATEGORIES.index(r.get("category", "Otros")), r["name"])):
        if r.get("category") != last:
            last = r.get("category")
            lines += [f"## {last}", ""]
        lines += [
            f"### {r['name']} — {r['title']}",
            "",
            f"- Escribe código: {'sí' if r['writes'] else 'no'} · workspace recomendado: `{r['workspace']}`",
            f"- Cuándo usarlo: {r['summary']}",
            "",
            "Plantilla de brief:",
            "",
            "```",
            r["brief"],
            "```",
            "",
        ]
    return "\n".join(lines)


def install_roles(ws_path, names):
    ws = workspace_by_path(ws_path)
    if not ws or not ws["exists"]:
        return 404, {"error": "Workspace desconocido o inexistente."}
    allroles = {r["name"]: r for r in load_roles()}
    chosen = [allroles[n] for n in names if n in allroles]
    if not chosen:
        return 400, {"error": "No hay roles válidos que instalar."}
    target = Path(ws_path) / ".agents" / "skills" / SKILL_NAME / "SKILL.md"
    if target.exists() and MARK not in target.read_text(errors="replace"):
        return 409, {"error": f"{target} existe y no lo creó Ant; no se sobrescribe."}
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(render_skill(chosen))
    return 200, {"ok": True, "path": str(target), "roles": [r["name"] for r in chosen]}


def uninstall_roles(ws_path):
    ws = workspace_by_path(ws_path)
    if not ws:
        return 404, {"error": "Workspace desconocido."}
    target = Path(ws_path) / ".agents" / "skills" / SKILL_NAME / "SKILL.md"
    if not target.is_file() or MARK not in target.read_text(errors="replace"):
        return 409, {"error": "No hay una instalación de Ant que quitar."}
    target.unlink()
    try:
        target.parent.rmdir()
    except OSError:
        pass
    return 200, {"ok": True}


# ---------------------------------------------------------------- enjambres
def swarm_dir(conv):
    return conv_dir(conv) / ".system_generated" / "swarm"


# Qué está haciendo un agente, en categorías genéricas (seguras para mostrar en un stream público).
ACT_RULES = [("wait", ("wait",)), ("coordinate", ("swarm", "post_message", "read_board", "message")),
             ("run", ("run_command", "command", "exec", "terminal", "bash", "shell")), ("browse", ("browser", "url", "web", "fetch", "http")),
             ("write", ("write", "replace", "edit", "create", "patch", "delete", "rename", "move")),
             ("read", ("read", "view", "list", "grep", "find", "search", "glob", "outline"))]


def activity_kind(activity):
    """'write_file: x' -> 'write'; texto libre del planificador (sin herramienta) -> 'think'; vacío -> ''."""
    a = (activity or "").strip()
    if not a:
        return ""
    name = a.split(":", 1)[0].strip().lower()
    if " " in name or len(name) > 40:
        return "think"
    for kind, keys in ACT_RULES:
        if any(k in name for k in keys):
            return kind
    return "other"


_TI_CACHE = {}


def transcript_info(conv):
    """Pasos, última actividad y modelos realmente usados de un miembro (transcript compacto)."""
    logs = conv_dir(conv) / ".system_generated" / "logs"
    p = logs / "transcript.jsonl"
    if not p.is_file():
        p = logs / "overview.txt"
    if not p.is_file():
        return {"steps": 0, "activity": "", "mtime": None, "failed": False, "models": []}
    stt = p.stat()
    key = (stt.st_mtime_ns, stt.st_size)
    hit = _TI_CACHE.get(str(p))
    if hit and hit[0] == key:  # el transcript solo crece: sin cambios no se vuelve a leer ni a contar líneas
        return hit[1]
    lines, _ = tail_lines(p, 40)
    activity, fallback, failed, models, first = "", "", False, [], True
    for line in reversed(lines):
        try:
            st = json.loads(line)
        except ValueError:
            continue
        if first:
            failed = str(st.get("status", "")).upper() in ("ERROR", "FAILED")
            first = False
        if st.get("model") and st["model"] not in models:
            models.append(st["model"])
        c = st.get("content")
        if not activity:
            tc = st.get("tool_calls")
            if tc and isinstance(tc, list) and isinstance(tc[0], dict):
                a = tc[0].get("args") or {}
                summ = str(a.get("toolSummary") or a.get("action") or "").strip('"')
                activity = (str(tc[0].get("name", "")) + (": " + summ if summ else ""))[:160]
            elif st.get("type") == "PLANNER_RESPONSE" and isinstance(c, str) and c.strip():
                activity = " ".join(c.split())[:160]
            elif not fallback and st.get("type") not in ("GENERIC", "USER_INPUT") and isinstance(c, str) and c.strip():
                fallback = " ".join(c.split())[:160]
    info = {"steps": count_lines(p), "activity": activity or fallback, "mtime": stt.st_mtime,
            "failed": failed, "models": list(reversed(models))}
    _TI_CACHE[str(p)] = (key, info)
    return info


def member_state(m):
    # Aproximación: el estado exacto lo calcula Antigravity con el transcript.
    if m.get("killed"):
        return "killed"
    return "waiting" if m.get("wait_since") else "working"


def read_board(conv, since=0, limit=300):
    p = swarm_dir(conv) / "board.jsonl"
    msgs = []
    try:
        with open(p, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    m = json.loads(line)
                except ValueError:
                    continue
                if m.get("seq", 0) > since:
                    msgs.append(m)
    except OSError:
        pass
    return msgs[-limit:]


# «[done]» al principio del mensaje (tras las menciones) = entrega. Un brief que PIDE un [done] en su texto no es una entrega.
DONE_RE = re.compile(r"^\s*(?:@[\w-]+[\s,]*)*\[done\]", re.I)
MENTION = re.compile(r"(?<![\w-])@([a-z][a-z0-9-]*)", re.I)


# ---- Un mismo enjambre de Antigravity puede recibir VARIOS `/swarm …` en la misma conversación: el título se sustituye y los
# agentes se añaden al mismo members.json. Ant los separa en lanzamientos individuales leyendo el transcript del coordinador.
_LAUNCH_CACHE = {}
_launch_lock = __import__("threading").Lock()
SWARM_CMD = re.compile(r"<USER_REQUEST>\s*/swarm\b\s*(.*?)\s*</USER_REQUEST>", re.S)


def _jarg(v):
    """Los argumentos de las herramientas vienen como texto JSON ('"title"')."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except ValueError:
            return v
    return v


def _iso_epoch(s):
    try:
        from datetime import datetime
        return datetime.fromisoformat(s.rstrip(".")).timestamp()
    except (ValueError, TypeError):
        return None


def _feed_launch(launches, d):
    t, content = d.get("type"), d.get("content")
    if t == "USER_INPUT" and isinstance(content, str):
        m = SWARM_CMD.search(content)
        if m:
            tm = re.search(r"current local time is:\s*([0-9T:+\-]+)", content)
            launches.append({"n": len(launches) + 1, "prompt": " ".join(m.group(1).split())[:600], "start": _iso_epoch(tm.group(1)) if tm else None,
                             "title": "", "members": [], "infra": [], "killed": []})
        return
    if not launches:
        return
    L = launches[-1]
    for tc in d.get("tool_calls") or []:
        if not isinstance(tc, dict) or tc.get("name") != "swarm":
            continue
        a = tc.get("args") or {}
        act, name = _jarg(a.get("action")), _jarg(a.get("name"))
        if act == "title" and _jarg(a.get("title")):
            L["title"] = str(_jarg(a.get("title")))[:120]
        elif act == "add" and name:
            infra = "stall monitor" in str(_jarg(a.get("brief")) or "")[:200]  # el monitor de bloqueos acompaña a todo el enjambre
            (L["infra"] if infra else L["members"]).append(name)
        elif act == "kill" and name:
            L["killed"].append(name)


def swarm_launches(conv):
    """Lanzamientos `/swarm` de la conversación, en orden. Lectura incremental: el transcript solo crece y puede pesar varios MB."""
    p = conv_dir(conv) / ".system_generated" / "logs" / "transcript.jsonl"
    try:
        size = p.stat().st_size
    except OSError:
        return []
    with _launch_lock:
        c = _LAUNCH_CACHE.get(str(p))
        if c is None or size < c["off"]:
            c = _LAUNCH_CACHE[str(p)] = {"off": 0, "launches": []}
        if size > c["off"]:
            try:
                with open(p, "rb") as f:
                    f.seek(c["off"])
                    data = f.read()
            except OSError:
                return c["launches"]
            end = data.rfind(b"\n") + 1  # ignora una última línea a medio escribir
            for line in data[:end].splitlines():
                try:
                    _feed_launch(c["launches"], json.loads(line))
                except ValueError:
                    continue
            c["off"] += end
        return [dict(x) for x in c["launches"]]


def _board_epoch(msg):
    try:
        return time.mktime(time.strptime(str(msg.get("time")), "%Y-%m-%d %H:%M:%S"))
    except (ValueError, TypeError):
        return None


def _assign_messages(board, owner):
    """Índice de lanzamiento de cada mensaje: por su autor o, si es del coordinador, por a quién se dirige; si no, hereda el anterior."""
    cur, out = 0, []
    for m in board:
        cand = owner.get(m.get("agent"))
        if cand is None:
            for tgt in MENTION.findall(m.get("text", "")):
                if tgt.lower() in owner:
                    cand = owner[tgt.lower()]
                    break
        if cand is not None:
            cur = cand
        out.append(cur)
    return out


def swarm_details(conv):
    """Lista de enjambres individuales de una conversación (uno por cada `/swarm`; uno solo si solo hubo uno). Más antiguo primero."""
    d = swarm_dir(conv)
    members_doc = read_json(d / "members.json")
    if members_doc is None:
        return []
    board_all = read_board(conv, 0, 100000)
    head = len(board_all)
    launches = swarm_launches(conv)
    raw = members_doc.get("members") or {}
    split = len(launches) >= 2
    owner = {}
    if split:
        for i, l in enumerate(launches):
            for nm in l["members"]:
                owner[nm] = i
    last = len(launches) - 1
    infra = set(raw) - set(owner) if split else set()  # coordinador, monitor y cualquier agente no atribuible: acompañan al último lanzamiento
    idxs = _assign_messages(board_all, owner) if split else [0] * len(board_all)
    try:
        mtime = (d / "board.jsonl").stat().st_mtime
    except OSError:
        mtime = None
    out = []
    for i in range(len(launches) if split else 1):
        names = [n for n in raw if (owner.get(n) == i or (i == last and n in infra))] if split else list(raw)
        board = [dict(m, t=_board_epoch(m)) for m, ix in zip(board_all, idxs) if ix == i] if split else [dict(m, t=_board_epoch(m)) for m in board_all]
        sent, dones, first_seen = {}, {}, {}
        for m in board:
            ag = m.get("agent")
            sent[ag] = sent.get(ag, 0) + 1
            for who in [ag] + [x.lower() for x in MENTION.findall(m.get("text", ""))]:
                if m.get("t") and who not in first_seen:
                    first_seen[who] = m["t"]
            if ag != "coordinator" and ag not in dones and DONE_RE.match(str(m.get("text", ""))):
                dones[ag] = m
        members = []
        for name in names:
            m = raw[name]
            cid = m.get("conversation_id", "")
            t = transcript_info(cid) if cid else {}
            tp = usage.transcript_path(BRAINS, cid) if cid else None
            u = usage.file_usage(tp) if tp else None
            dn = dones.get(name)
            members.append({
                "name": name, "role": m.get("role", ""), "model": m.get("model", ""), "state": member_state(m),
                "unread": 0 if m.get("killed") else max(0, head - (m.get("last_read_seq") or 0)),
                "steps": t.get("steps", 0), "activity": t.get("activity", ""), "models_used": t.get("models", []),
                "failed": t.get("failed", False), "active_at": t.get("mtime"),
                "tokens": {"in": u["in"], "out": u["out"], "total": u["in"] + u["out"]} if u else None,
                "shared": bool(split and name in infra),  # el coordinador y el monitor sirven a todos los lanzamientos: sus tokens no son de este
                "sent": sent.get(name, 0), "first_seen": first_seen.get(name), "workspace": m.get("workspace") or "",
                "done": {"seq": dn["seq"], "t": dn.get("t"), "text": str(dn.get("text", ""))[:600]} if dn else None,
            })
        known = {m["name"] for m in members} | {"coordinator"}
        edges = {}
        for msg in board[-2000:]:
            src = msg.get("agent")
            for tgt in set(x.lower() for x in MENTION.findall(msg.get("text", ""))):
                if tgt in known and tgt != src:
                    edges[(src, tgt)] = edges.get((src, tgt), 0) + 1
        l = launches[i] if launches and (split or len(launches) == 1) else None
        if split:  # members.json solo guarda el ÚLTIMO título: un lanzamiento sin título propio usa su tarea, no el del anterior
            title = (l["title"] or l["prompt"][:60]) if l else ""
        else:
            title = (l["title"] if l else "") or members_doc.get("title") or (l["prompt"][:60] if l else "")
        title = title or "(sin título)"
        if split and i < last:  # un lanzamiento antiguo termina con su último mensaje; el último sigue «vivo» mientras haya actividad en el tablero
            ts = [t for t in (_board_epoch(m) for m in board) if t]
            updated = max(ts) if ts else (l["start"] if l else mtime)
        else:
            updated = mtime
        workers = [x for x in members if x["name"] not in ("coordinator", "monitor") and x["role"] != "coordinator"]
        alive = [x for x in workers if x["state"] != "killed"]
        final = next((m for m in reversed(board) if m.get("agent") == "coordinator" and DONE_RE.match(str(m.get("text", "")))), None)
        status = ("running" if any(x["state"] == "working" for x in alive) else "waiting") if alive else "done" if final else "idle"
        ts = [m["t"] for m in board if m.get("t")]
        started = (l["start"] if l else None) or (min(ts) if ts else None)
        out.append({
            "status": status, "workers_total": len(workers), "workers_done": sum(1 for x in workers if x["done"]),
            "tokens": sum((x["tokens"] or {}).get("total", 0) for x in workers), "first_t": min(ts) if ts else None, "last_t": max(ts) if ts else None,
            "ended": (max(ts) if ts else None) if status in ("done", "idle") else None,
            "result": {"seq": final["seq"], "t": final.get("t"), "text": str(final.get("text", ""))[:6000]} if final and status == "done" else None,
            "id": f"{conv}~{i + 1}" if split else conv, "conv": conv, "n": i + 1, "of": len(launches) if split else 1, "latest": (i == last) if split else True,
            "title": title, "prompt": l["prompt"] if l else "", "started": started,
            "members": sorted(members, key=lambda x: x["name"]), "board": board, "head": head,
            "edges": [{"from": a, "to": b, "n": n} for (a, b), n in edges.items()], "updated": updated,
        })
    sib = [{"n": x["n"], "id": x["id"], "title": x["title"], "status": x["status"]} for x in out]
    for x in out:
        x["siblings"] = sib
    return out


def swarm_detail(sid, since=0):
    """Un enjambre por id: `conv` (el último lanzamiento) o `conv~n` (el lanzamiento n)."""
    conv, _, n = str(sid).partition("~")
    allsw = swarm_details(conv)
    if not allsw:
        return None
    sel = next((x for x in allsw if str(x["n"]) == n), None) if n else allsw[-1]
    if not sel:
        return None
    sel = dict(sel)
    sel["total"] = len(sel["board"])
    sel["board"] = [m for m in sel["board"] if m.get("seq", 0) > since][-300:]
    return sel


def list_swarms():
    out = []
    for c in all_convs():
        if (c / ".system_generated" / "swarm" / "members.json").is_file():
            for sw in swarm_details(c.name):
                sw = dict(sw)
                sw["board"] = sw["board"][-1:]  # en la lista solo el último mensaje
                out.append(sw)
    out.sort(key=lambda x: x.get("updated") or 0, reverse=True)
    return out


def recent_conversations(limit=12):
    """Conversaciones con actividad reciente (cualquier workspace), no solo swarms."""
    items = []
    for c in all_convs():
        for name in ("transcript.jsonl", "overview.txt"):
            p = c / ".system_generated" / "logs" / name
            if p.is_file():
                items.append((p.stat().st_mtime, c.name, p))
                break
    items.sort(reverse=True)
    res = []
    for mt, cid, p in items[:limit]:
        first = ""
        try:
            with open(p, encoding="utf-8", errors="replace") as f:
                s = json.loads(f.readline())
            txt = s.get("content", "") if isinstance(s.get("content"), str) else ""
            m = re.search(r"<USER_REQUEST>\s*(.*?)\s*</USER_REQUEST>", txt, re.S)
            first = " ".join((m.group(1) if m else txt).split())[:140]
        except (OSError, ValueError):
            pass
        if first.startswith("The following is a <SYSTEM_MESSAGE>"):
            continue  # conversaciones automáticas, no del usuario
        res.append({"id": cid, "mtime": mt, "first": first, "live": time.time() - mt < 120,
                    "is_swarm": (swarm_dir(cid) / "members.json").is_file()})
    return res


# ------------------------------------------------------------------ planificación
_wsf = {}


def ws_file_count(path):
    c = _wsf.get(path)
    if c and time.time() - c[0] < 120:
        return c[1]
    try:
        r = subprocess.run(["git", "-C", path, "ls-files"], capture_output=True, text=True, timeout=8)
        n = len(r.stdout.splitlines()) if r.returncode == 0 else None
    except (OSError, subprocess.SubprocessError):
        n = None
    _wsf[path] = (time.time(), n)
    return n


def plan_history():
    """Ejecuciones terminadas con consumo REAL medido: calibran las estimaciones."""
    out = []
    for r in runs.list_runs():
        u, pl = r.get("usage"), r.get("plan") or {}
        if r["status"] == "done" and u and pl.get("effort") and not pl.get("resume"):
            out.append({"effort": pl["effort"], "kind": pl.get("topology", "single"), "total": u["total"]})
    return out


def recent_runs():
    now = time.time()
    return [{"id": r["id"], "fingerprint": (r.get("plan") or {}).get("fingerprint"), "ws": r["ws"], "status": r["status"]}
            for r in runs.list_runs()[:40] if now - r["started"] < 7200]


def blocked_providers():
    now = time.time()
    return ("claude", "gpt") if any(r["status"] == "quota" and now - (r.get("ended") or 0) < 6 * 3600 for r in runs.list_runs()[:20]) else ()


_psc = {}


def project_scripts(path):
    """Scripts de verificación que define el proyecto (package.json en la raíz y en apps/*, packages/*): los agentes querrán ejecutarlos."""
    c = _psc.get(path)
    if c and time.time() - c[0] < 120:
        return c[1]
    found, p = [], Path(path)
    cands = [p / "package.json"] + sorted(p.glob("apps/*/package.json"))[:4] + sorted(p.glob("packages/*/package.json"))[:4]
    for f in cands:
        d = read_json(f, {}) or {}
        for name in (d.get("scripts") or {}):
            if re.search(r"type-?check|lint|test|verify|check|build", name) and f"npm run {name}" not in found:
                found.append(f"npm run {name}")
    if (p / "pyproject.toml").is_file() or (p / "pytest.ini").is_file():
        found.append("pytest")
    _psc[path] = (time.time(), found[:8])
    return found[:8]


def last_command(conv):
    """Último comando de shell que intentó ejecutar un agente (para explicar un bloqueo por permisos)."""
    tp = usage.transcript_path(BRAINS, conv) if conv else None
    if not tp:
        return None
    lines, _ = tail_lines(tp, 60, block=400_000)
    for line in reversed(lines):
        try:
            d = json.loads(line)
        except ValueError:
            continue
        for tcall in reversed(d.get("tool_calls") or []):
            if tcall.get("name") == "run_command":
                cmd = str((tcall.get("args") or {}).get("CommandLine", "")).strip().strip('"')
                return cmd.replace('\\"', '"')[:300] or None
    return None


def make_plan_for(data, ws):
    ov = {k: data[k] for k in ("model", "workers_model", "mode", "isolation", "timeout_min", "budget", "effort") if data.get(k) not in (None, "")}
    plan = planner.make_plan(data.get("prompt", ""), ws=ws, roles=load_roles(), models=runs.models(), history=plan_history(), blocked=blocked_providers(),
                             ws_files=ws_file_count(ws["path"]) if ws.get("has_git") else None, recent=recent_runs(), overrides=ov, project_cmds=project_scripts(ws["path"]))
    nm = runs.find_node_modules(ws["path"]) if (ws.get("has_git") and plan["isolation"] == "worktree") else []
    plan["link_deps"] = bool(nm) and plan["perms"] == "dev"
    plan["node_modules"] = [str(x) for x in nm]
    if plan["link_deps"]:
        plan["reasons"].append(f"La copia aislada no trae dependencias: se enlazan los node_modules de tu carpeta principal ({', '.join(str(x) for x in nm[:3])}{'…' if len(nm) > 3 else ''}) sin copiar gigas. "
                               "Son compartidos: el agente tiene prohibido instalar paquetes, y Ant avisa si aun así se modifican.")
    return plan


def minimal_plan(data):
    """Los lanzamientos manuales también registran esfuerzo y huella: alimentan la calibración y detectan repeticiones."""
    a = planner.analyze(data.get("prompt", ""))
    return {"effort": planner.effort_of(a["score"], None, a["scope"]), "topology": "swarm" if data.get("swarm") else "single", "fingerprint": a["fingerprint"], "types": a["core"], "manual": True, "roles": list(data.get("roles") or [])}


def slim_plan(p):
    return {k: p[k] for k in ("effort", "topology", "roles", "model", "workers_model", "budget", "fingerprint", "types", "max_workers")} | {"tokens": p["tokens"], "link_deps": p.get("link_deps", False)}


def team_for_plan(plan, roles):
    chosen = [roles[r] for r in plan["roles"] if r in roles]
    flow = ("Reparte el trabajo por rol sin que dos workers toquen los mismos archivos; si un rol depende de otro, espera su [done]. "
            "Cierra el enjambre en cuanto el resultado esté verificado.")
    return {"id": "auto", "name": "Equipo a medida (planificado por Ant)", "flow": flow, "roles": chosen}


STATUS_WHY = {"budget": "se agotó el presupuesto de tokens", "timeout": "se agotó el tiempo máximo", "stopped": "se detuvo a mano", "failed": "terminó con error",
              "quota": "se agotó la cuota de Antigravity", "blocked": "un permiso denegado la abortó", "lost": "el proceso desapareció"}


def handoff_for(run):
    """Resumen de lo ya hecho para que un agente nuevo continúe sin repetir trabajo."""
    d = runs.detail(run["id"])
    out = [f"## Trabajo ya hecho (la ejecución anterior se interrumpió: {STATUS_WHY.get(run['status'], run['status'])})"]
    commits = d.get("commits") or []
    out.append("Commits en esta copia: " + ("; ".join(c[:90] for c in commits[:12]) if commits else "ninguno"))
    if d.get("diffstat"):
        out.append("Archivos cambiados respecto al origen:\n" + d["diffstat"][:1500])
    if d.get("untracked"):
        out.append("Archivos sin añadir a git: " + ", ".join(d["untracked"][:12]))
    sw = swarm_detail(run["conv"]) if run.get("conv") else None
    if sw and sw["board"]:
        out.append("Últimos mensajes del tablero del enjambre:\n" + "\n".join(f"- {m['agent']}: {str(m['text'])[:240]}" for m in sw["board"][-10:]))
    out.append("Continúa SOLO lo que falte para cumplir la tarea. Revisa antes el estado real (git log / git diff): no rehagas ni reviertas lo hecho. "
               "No crees enjambre ni helpers: trabaja tú. Al terminar, resume en pocas líneas qué completaste.")
    return "\n\n".join(out)


def resume_run(data):
    old = runs.load(data.get("id", ""))
    full = runs.detail(old["id"])
    if not full["resumable"]:
        raise runs.RunError("Esta ejecución no se puede reanudar (debe haberse interrumpido, tener su copia aislada y no estar ya reanudada).", 409)
    ws = workspace_by_path(old["ws"])
    if not ws or not ws["exists"]:
        raise runs.RunError("El workspace de esa ejecución ya no existe.", 404)
    models = [m["id"] for m in runs.models()]
    model = old.get("workers_model") or old.get("model") or ""
    if model == planner.ORCH_ID or model not in models:
        model = next((m for m in ("gemini-4-hydrogen-low", "gemini-4-hydrogen-medium") if m in models), "")
    budget = int(data.get("token_budget") or max(40_000, int((old.get("token_budget") or 80_000) * 0.6)))
    prompt = "Continúa y termina esta tarea, que quedó a medias.\n\n## Tarea original\n" + old["prompt"] + "\n\n" + handoff_for(old)
    return runs.start(ws, prompt, "", "", model, "accept-edits", "worktree", False, old.get("timeout_min", 30), False, "", True, None, budget,
                      {"effort": (old.get("plan") or {}).get("effort", "S"), "topology": "single", "fingerprint": None, "resume": True},
                      True, {"cwd": old["cwd"], "branch": old["branch"], "base": old["base"], "linked_deps": old.get("linked_deps", []), "deps_sig": old.get("deps_sig", {})}, old["id"], bool(old.get("allow_dev")))


def usage_monitor():
    """Cada 2 s mide el consumo real de las ejecuciones en marcha y las detiene si superan su presupuesto."""
    while True:
        time.sleep(2)
        try:
            for r in runs.list_runs():
                if r["status"] != "running":
                    continue
                u = usage.run_usage(BRAINS, r)
                if not u:
                    continue
                runs.update_usage(r["id"], u)
                b = int(r.get("token_budget") or 0)
                if b and u["total"] > b:
                    try:
                        runs.stop(r["id"], reason="budget")
                    except runs.RunError:
                        pass
            runs.deliver_pending()  # recados en cola: se envían cuando el turno del agente terminó bien
        except Exception:  # el vigilante nunca debe caerse
            pass


# ------------------------------------------------------------------ oficina
SWARM_LIVE_SECS = int(os.environ.get("ANT_SWARM_LIVE_SECS", "1200"))  # sin actividad en 20 min = el enjambre ya no está en ejecución
WHIP = {"seq": 0, "at": 0.0, "kind": "crack", "total": 0}
OFFICE_STYLES = ("voxel", "toon", "cyber")


def office_style():
    try:
        st = json.loads(OFFICE_FILE.read_text()).get("style")
    except (OSError, ValueError, AttributeError):
        st = None
    return st if st in OFFICE_STYLES else "voxel"


def set_office_style(st):
    if st not in OFFICE_STYLES:
        raise runs.RunError("Estilo desconocido.", 400)
    OFFICE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = OFFICE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"style": st}))
    tmp.replace(OFFICE_FILE)
    return st


FX = {"seq": 0, "events": []}  # efectos teatrales (látigo dirigido, café, aplauso, bronca, cámara) que la oficina del stream reproduce
_fx_lock = __import__("threading").Lock()
FX_KINDS = ("whip", "coffee", "praise", "scold", "focus")


def push_fx(kind, target=None, user=None):
    with _fx_lock:
        FX["seq"] += 1
        ev = {"seq": FX["seq"], "kind": kind, "target": target, "user": user, "at": time.time()}
        FX["events"] = (FX["events"] + [ev])[-30:]
        if kind == "whip":
            WHIP["total"] += 1
    return ev


CHAT = chat.Chat(push_fx, lambda: [{"id": w["id"], "role": w.get("role"), "state": w["state"]} for w in office_state(light=True)["workers"]])
RUN_TO_STATE = {"running": "working", "done": "done", "failed": "failed", "lost": "failed", "timeout": "failed",
                "blocked": "failed", "budget": "failed", "quota": "quota", "stopped": "stopped"}


def office_state(light=False):
    """Estado para la página de stream. Nunca hay que mostrar `task` sin permiso."""
    now = time.time()
    workers = []
    for r in runs.list_runs()[:20]:
        # Los terminados se quedan 3 min en su cubículo para que se vea el resultado.
        if r["status"] != "running" and now - (r.get("ended") or r["started"]) > 180:
            continue
        act = detail = ""
        if r["status"] == "running":
            conv = r.get("conv") or (r.get("usage") or {}).get("conv")
            if conv:
                detail = transcript_info(conv).get("activity", "")[:80]
                act = activity_kind(detail)
        workers.append({"id": "run:" + r["id"], "state": RUN_TO_STATE.get(r["status"], "idle"),
                        "role": r.get("role"), "model": r.get("model"), "task": r["prompt"].splitlines()[0][:120],
                        "since": r["started"], "act": act, "detail": detail, "run": r["id"]})
    # Solo cuentan los enjambres VIVOS: un enjambre abandonado (horas sin actividad) deja a sus miembros «esperando» para siempre
    # y no debe llenar la oficina ni impedir los figurantes.
    swarms = [sw for sw in list_swarms() if sw.get("latest") and now - max([sw.get("updated") or 0] + [m.get("active_at") or 0 for m in sw["members"]]) < SWARM_LIVE_SECS]
    for sw in swarms:
        for m in sw["members"]:
            if m["state"] != "killed":
                waiting = m["state"] == "waiting"  # espera mensajes de otros (swarm_wait): no «espera órdenes»
                stale = not waiting and bool(m.get("active_at")) and now - m["active_at"] > 300  # sin actividad en el transcript desde hace >5 min
                workers.append({"id": f"sw:{sw['conv'][:8]}:{m['name']}", "state": "idle" if (waiting or stale) else "working",
                                "role": m["name"], "model": m["model"], "task": "", "since": m.get("active_at") or 0,
                                "act": "wait" if waiting else "" if stale else activity_kind(m.get("activity")),
                                "detail": (m.get("activity") or "")[:80], "sw": sw["conv"], "waiting": waiting, "stale": stale})
    if light:  # solo lista de agentes (lo usa el chat para resolver «!latigo parser»)
        workers.sort(key=lambda w: ({"working": 0, "idle": 1, "done": 2, "failed": 3, "quota": 3, "stopped": 4}.get(w["state"], 5), -w["since"]))
        return {"workers": workers[:8]}
    # Mensajes recientes entre agentes (SOLO quién escribe a quién; nunca el contenido): la oficina los dibuja como aviones de papel.
    msgs = []
    for sw in swarms[:3]:
        sid, names = sw["conv"][:8], {m["name"] for m in sw["members"]} | {"coordinator"}
        for msg in read_board(sw["conv"], 0, 6):
            src = msg.get("agent")
            tg = [x for x in dict.fromkeys(t.lower() for t in MENTION.findall(msg.get("text", ""))) if x in names and x != src]
            msgs.append({"id": f"{sid}:{msg.get('seq')}", "from": f"sw:{sid}:{src}", "to": [f"sw:{sid}:{x}" for x in tg[:2]]})
    order = {"working": 0, "idle": 1, "done": 2, "failed": 3, "quota": 3, "stopped": 4}
    workers.sort(key=lambda w: (order.get(w["state"], 5), -w["since"]))
    allruns = runs.list_runs()
    today = time.strftime("%Y%m%d")
    return {
        "workers": workers[:8],
        "stats": {"working": sum(1 for w in workers if w["state"] == "working"),
                  "done_today": sum(1 for r in allruns if r["status"] == "done" and r["id"].startswith(today)),
                  "failed_today": sum(1 for r in allruns if r["status"] in ("failed", "lost") and r["id"].startswith(today)),
                  "tokens_today": sum((r.get("usage") or {}).get("total", 0) for r in allruns if r["id"].startswith(today)),
                  "whips": WHIP["total"]},
        "whip": {"seq": WHIP["seq"], "at": WHIP["at"], "kind": WHIP["kind"]},
        "msgs": msgs,
        "fx": FX["events"][-12:], "fx_seq": FX["seq"],
        "style": office_style(),
        "now": now,
    }


BOSS_BONUS_TOKENS, BOSS_BONUS_MAX = 50_000, 3  # «felicitar» con efecto real: bono de tokens, como mucho 3 por ejecución (evita gastar cuota por un clic de broma)
BOSS_SCOLD = "no estoy contento con tu rendimiento: revisa tu trabajo con más cuidado, no repitas pasos ya hechos y entrega algo útil sin gastar tokens de más."


def boss_action(data):
    """Felicitar / regañar al agente. El efecto TEATRAL siempre ocurre; el REAL (bono de tokens / recado en cola) solo si el operador lo pide."""
    kind, target, real = data.get("kind"), str(data.get("target") or ""), bool(data.get("real"))
    if kind not in ("praise", "scold"):
        raise runs.RunError("Acción del jefe desconocida.")
    out = {"ok": True, "seq": push_fx(kind, target or None)["seq"], "real": None}
    if not real:
        return out
    if not target.startswith(("run:", "sw:")):
        out["real"] = {"ok": False, "error": "Solo los agentes reales tienen efecto real (este es de ejemplo o un figurante)."}
        return out
    try:
        d = agent_detail(target)
        if not d.get("run"):
            raise runs.RunError("No lo lanzaste desde Ant: solo puedo observarlo, no darle bonos ni recados.", 409)
        if kind == "praise":
            run = runs.load(d["run"])
            if sum(1 for b in run.get("bonuses", []) if b.get("by") == "boss") >= BOSS_BONUS_MAX:
                raise runs.RunError(f"El jefe ya dio {BOSS_BONUS_MAX} bonos a esta ejecución (límite para no gastar cuota por error).", 409)
            try:
                tokens = max(10_000, min(int(data.get("tokens") or BOSS_BONUS_TOKENS), 200_000))
            except (TypeError, ValueError):
                tokens = BOSS_BONUS_TOKENS
            r = runs.add_budget(d["run"], tokens, by="boss")
            out["real"] = {"ok": True, "action": "bonus", "tokens": tokens, "token_budget": r["token_budget"]}
        else:
            r = runs.send_message(d["run"], "El jefe te regaña: " + (str(data.get("text") or "").strip()[:600] or BOSS_SCOLD), to=d.get("role"))
            out["real"] = {"ok": True, "action": "message", **r}
    except runs.RunError as e:
        out["real"] = {"ok": False, "error": e.msg, "code": e.code}
    return out


def _owner_run(sw_id):
    """Ejecución de Ant que lanzó este enjambre (si se lanzó desde Ant)."""
    for r in runs.list_runs():
        if r.get("swarm") and runs.conv_of(r) == sw_id:
            return r
    return None


def agent_detail(wid):
    """Ficha de un agente para el operador (datos reales; la oficina del stream NO la usa). Incluye qué acciones son posibles y por qué no."""
    out = {"id": wid, "now": time.time()}
    run = None
    if wid.startswith("run:"):
        run = runs.load(wid[4:])
        pub = runs.public(run)
        u = pub.get("usage") or {}
        conv = runs.conv_of(run)
        info = transcript_info(conv) if conv else {}
        out.update(kind="run", role=pub.get("role"), model=pub.get("model"), swarm=bool(pub.get("swarm")), status=pub["status"], activity=info.get("activity", ""),
                   steps=u.get("steps", info.get("steps", 0)), tokens=u.get("total", 0), tokens_in=u.get("in", 0), tokens_out=u.get("out", 0), tokens_cache=u.get("cache", 0))
    elif wid.startswith("sw:"):
        try:
            _, sid8, name = wid.split(":", 2)
        except ValueError:
            raise runs.RunError("Identificador de agente inválido.")
        sw = next((x for x in list_swarms() if x["conv"].startswith(sid8) and x.get("latest")), None)
        m = next((x for x in (sw or {}).get("members", []) if x["name"] == name), None)
        if not sw or not m:
            raise runs.RunError("El agente ya no está en el enjambre.", 404)
        run = _owner_run(sw["conv"])
        last = [x for x in read_board(sw["conv"], 0, 60) if x.get("agent") == name]
        out.update(kind="swarm", role=name, model=m.get("model"), swarm=True, status=m["state"], activity=m.get("activity", ""), steps=m.get("steps", 0),
                   tokens=((run or {}).get("usage") or {}).get("total", 0), tokens_in=0, tokens_out=0, tokens_cache=0, unread=m.get("unread", 0), swarm_title=sw.get("title"),
                   last_message=(last[-1].get("text", "")[:240] if last else ""))
    else:
        raise runs.RunError("Identificador de agente inválido.")
    out["act"] = activity_kind(out["activity"])
    out["run"] = run["id"] if run else None
    out["ws_name"] = run["ws_name"] if run else None
    out["ws"] = run["ws"] if run else None
    out["started"] = run["started"] if run else None
    out["ended"] = run.get("ended") if run else None
    out["budget"] = int(run.get("token_budget") or 0) if run else 0
    out["pending_message"] = bool(run and run.get("pending_message"))
    st = run["status"] if run else None
    sw_note = " (detiene todo el enjambre)" if out["kind"] == "swarm" else ""
    no_run = "No lo lanzaste desde Ant: solo puedo observarlo."
    out["can"] = {
        "stop": {"ok": st == "running", "why": "" if st == "running" else (no_run if not run else "Ya terminó."), "note": sw_note.strip()},
        "resume": {"ok": bool(run and runs.resumable(run)), "why": "" if run and runs.resumable(run) else (no_run if not run else "No hay trabajo parcial que reanudar.")},
        "rerun": {"ok": bool(run), "why": "" if run else no_run},
        "bonus": {"ok": st == "running" and out["budget"] > 0, "why": "" if st == "running" and out["budget"] > 0 else (no_run if not run else "No está en marcha o no tiene presupuesto de tokens.")},
        "message": {"ok": bool(run and st in ("running", "done") and runs.conv_of(run)), "why": "" if run and st in ("running", "done") and runs.conv_of(run) else (no_run if not run else "Solo se puede mandar un recado mientras trabaja (queda en cola) o si terminó bien.")},
        "task": {"ok": bool(run), "why": "" if run else no_run + " Usa la barra del jefe."},
    }
    return out


def home_state():
    """Resumen para la pantalla de inicio."""
    now = time.time()
    allruns = runs.list_runs()
    today = time.strftime("%Y%m%d")
    swarms = list_swarms()
    quota = next((r for r in allruns if r["status"] == "quota" and now - (r.get("ended") or 0) < 6 * 3600), None)
    return {
        "running": [r for r in allruns if r["status"] == "running"],
        "runs": allruns[:6],
        "swarms": [{k: v for k, v in sw.items() if k != "board"} | {"last": (sw["board"] or [None])[-1]} for sw in swarms[:4]],
        "active_swarms": sum(1 for sw in swarms if any(m["state"] == "working" for m in sw["members"])),
        "done_today": sum(1 for r in allruns if r["status"] == "done" and r["id"].startswith(today)),
        "failed_today": sum(1 for r in allruns if r["status"] in ("failed", "lost", "timeout", "blocked", "budget") and r["id"].startswith(today)),
        "quota": {"reset": quota.get("quota_reset"), "at": quota.get("ended")} if quota else None,
        "tokens_today": sum((r.get("usage") or {}).get("total", 0) for r in allruns if r["id"].startswith(today)),
        "budget_stops_today": sum(1 for r in allruns if r["status"] == "budget" and r["id"].startswith(today)),
        "workspaces": sum(1 for w in workspaces() if w["exists"]),
        "roles": len(load_roles()),
        "now": now,
    }


# -------------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "Ant/0.1"

    def log_message(self, *a):
        pass

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/office" and q.get("classic"):
            return self.static("/office2d.html")  # oficina 2D (alternativa y respaldo sin WebGL)
        if u.path == "/api/status":
            return self.send_json(200, {"ok": True, "app": "ant", "brain": any(b.is_dir() for b in BRAINS)})
        if u.path == "/api/overview":
            sw = list_swarms()
            return self.send_json(200, {
                "swarms": sw,
                "recent": recent_conversations(),
                "workspaces": workspaces(),
                "brain_found": any(b.is_dir() for b in BRAINS),
            })
        if u.path.startswith("/api/swarm/"):
            conv = u.path.rsplit("/", 1)[1]
            if not re.fullmatch(r"[0-9a-f-]{8,64}(~\d{1,3})?", conv):
                return self.send_json(400, {"error": "id inválido"})
            s = swarm_detail(conv, int((q.get("since") or ["0"])[0] or 0))
            return self.send_json(200 if s else 404, s or {"error": "No es un enjambre."})
        if u.path == "/api/office":
            return self.send_json(200, office_state())
        if u.path == "/api/office/agent":
            try:
                return self.send_json(200, agent_detail((q.get("id") or [""])[0]))
            except runs.RunError as e:
                return self.send_json(e.code, {"error": e.msg})
        if u.path == "/api/office/chat":
            return self.send_json(200, CHAT.status())
        if u.path == "/api/office/style":
            return self.send_json(200, {"style": office_style(), "styles": list(OFFICE_STYLES)})
        if u.path == "/api/models":
            return self.send_json(200, {"models": runs.models(), "max_running": runs.MAX_RUNNING})
        if u.path == "/api/runs":
            return self.send_json(200, {"runs": runs.list_runs()})
        if u.path.startswith("/api/run/"):
            try:
                info = runs.detail(u.path.rsplit("/", 1)[1])
                if info["status"] == "blocked":
                    info["blocked_cmd"] = last_command(info.get("conv"))
                if info["status"] == "running":
                    live = usage.run_usage(BRAINS, info)
                    if live:
                        info["usage"] = runs.slim_usage(live)
                return self.send_json(200, info)
            except runs.RunError as e:
                return self.send_json(e.code, {"error": e.msg})
        if u.path == "/api/roles":
            return self.send_json(200, {"roles": load_roles(), "skill": SKILL_NAME, "categories": CATEGORIES})
        if u.path == "/api/workspaces":
            return self.send_json(200, {"workspaces": workspaces()})
        if u.path == "/api/teams":
            return self.send_json(200, {"teams": load_teams()})
        if u.path == "/api/home":
            return self.send_json(200, home_state())
        if u.path == "/api/preview":
            names = (q.get("roles") or [""])[0].split(",")
            allr = {r["name"]: r for r in load_roles()}
            return self.send_json(200, {"text": render_skill([allr[n] for n in names if n in allr])})
        return self.static(u.path)

    def do_POST(self):
        if self.headers.get("X-Ant") != "1":
            return self.send_json(403, {"error": "Falta cabecera X-Ant."})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            data = json.loads(self.rfile.read(min(n, 1 << 20)) or b"{}")
        except ValueError:
            return self.send_json(400, {"error": "JSON inválido."})
        path = urlparse(self.path).path
        if path == "/api/install":
            return self.send_json(*install_roles(data.get("path", ""), data.get("roles") or []))
        if path == "/api/office/whip":
            WHIP["seq"] += 1
            WHIP["total"] += 1
            WHIP["at"] = time.time()
            WHIP["kind"] = "all" if data.get("kind") == "all" else "crack"
            return self.send_json(200, {"ok": True, "seq": WHIP["seq"]})
        if path == "/api/office/boss":
            try:
                return self.send_json(200, boss_action(data))
            except runs.RunError as e:
                return self.send_json(e.code, {"error": e.msg})
        if path == "/api/office/style":
            try:
                return self.send_json(200, {"ok": True, "style": set_office_style(data.get("style"))})
            except runs.RunError as e:
                return self.send_json(e.code, {"error": e.msg})
            except OSError as e:
                return self.send_json(500, {"error": f"No se pudo guardar: {e}"})
        if path == "/api/office/fx":
            kind = data.get("kind")
            if kind not in FX_KINDS:
                return self.send_json(400, {"error": "Efecto desconocido."})
            return self.send_json(200, {"ok": True, "seq": push_fx(kind, data.get("target") or None)["seq"]})
        if path == "/api/office/command":  # comandos del público (cualquier bot): solo efectos teatrales
            return self.send_json(200, CHAT.handle(data.get("text", ""), data.get("user", "")))
        if path in ("/api/run", "/api/run/stop", "/api/run/discard", "/api/run/rerun", "/api/run/resume", "/api/run/bonus", "/api/run/message"):
            return self.run_post(path, data)
        if path == "/api/plan":
            ws = workspace_by_path(data.get("path", ""))
            if not ws or not ws["exists"]:
                return self.send_json(404, {"error": "Workspace desconocido o inexistente."})
            return self.send_json(200, make_plan_for(data, ws))
        if path == "/api/roles/save":
            return self.send_json(*save_role(data))
        if path == "/api/roles/delete":
            return self.send_json(*delete_role(data.get("name", "")))
        if path == "/api/workspace/add":
            return self.send_json(*add_workspace(data.get("path", ""), bool(data.get("create"))))
        if path == "/api/workspace/remove":
            return self.send_json(*remove_workspace(data.get("path", "")))
        if path == "/api/uninstall":
            return self.send_json(*uninstall_roles(data.get("path", "")))
        return self.send_json(404, {"error": "No existe."})

    def run_post(self, path, data):
        try:
            if path == "/api/run/stop":
                return self.send_json(200, runs.stop(data.get("id", "")))
            if path == "/api/run/bonus":
                return self.send_json(200, runs.add_budget(data.get("id", ""), data.get("tokens")))
            if path == "/api/run/message":
                return self.send_json(200, runs.send_message(data.get("id", ""), data.get("text", ""), data.get("to")))
            if path == "/api/run/discard":
                return self.send_json(200, runs.discard(data.get("id", ""), bool(data.get("force"))))
            if path == "/api/run/resume":
                return self.send_json(200, resume_run(data))
            if path == "/api/run/rerun":
                data_in = data
                old = runs.load(data.get("id", ""))
                data = {"path": old["ws"], "prompt": old["prompt"], "role": old.get("role"), "model": old.get("model", ""),
                        "mode": old.get("mode", ""), "isolation": old["isolation"], "auto_approve": old.get("auto_approve"),
                        "timeout_min": old.get("timeout_min", 30), "swarm": old.get("swarm"), "workers_model": old.get("workers_model") or "",
                        "allow_commands": old.get("allow_commands") or bool(data.get("allow_dev")), "team": old.get("team"),
                        "allow_dev": data["allow_dev"] if "allow_dev" in data else old.get("allow_dev"), "link_deps": bool(old.get("linked_deps"))}
                if data_in.get("auto_approve"):
                    data["auto_approve"] = True
                if old.get("token_budget"):
                    data["token_budget"] = old["token_budget"]
                if old.get("team") in ("auto", "custom"):  # equipo a medida: se rehace desde la lista de roles guardada
                    data["team"], data["roles"] = None, (old.get("plan") or {}).get("roles") or []
            ws = workspace_by_path(data.get("path", ""))
            if not ws or not ws["exists"]:
                raise runs.RunError("Workspace desconocido o inexistente.", 404)
            roles = {r["name"]: r for r in load_roles()}
            if data.get("auto"):  # Ant decide: tipo, esfuerzo, topología, roles, modelo y presupuesto
                plan = make_plan_for(data, ws)
                if plan["heavy"] and not data.get("confirm_heavy"):
                    return self.send_json(409, {"error": "Plan caro: confirma antes de lanzar.", "needs": "heavy", "plan": plan})
                if any("misma tarea" in w for w in plan["warnings"]) and not data.get("confirm_duplicate"):
                    return self.send_json(409, {"error": "Tarea repetida: confirma antes de gastar tokens otra vez.", "needs": "duplicate", "plan": plan})
                swarm = plan["topology"] == "swarm"
                role = roles.get(plan["role"]) if not swarm else None
                return self.send_json(200, runs.start(
                    ws, data.get("prompt", ""), role["brief"] if role else "", role["name"] if role else "", plan["model"], plan["mode"], plan["isolation"],
                    False, plan["timeout_min"], swarm, plan["workers_model"], plan["perms"] in ("safe", "dev"), team_for_plan(plan, roles) if swarm else None,
                    int(data.get("token_budget") or plan["budget"]), slim_plan(plan), True, None, None, plan["perms"] == "dev", bool(plan["link_deps"])))
            role = roles.get(data.get("role") or "")
            if data.get("role") and not role:
                raise runs.RunError("Rol desconocido.")
            team = None
            if data.get("team"):
                if not data.get("swarm"):
                    raise runs.RunError("Un equipo solo se puede usar en modo enjambre.")
                t = next((t for t in load_teams() if t["id"] == data["team"]), None)
                if not t:
                    raise runs.RunError("Equipo desconocido.")
                team = {"id": t["id"], "name": t["name"], "flow": t.get("flow", ""), "roles": [roles[r] for r in t["roles"] if r in roles]}
            if data.get("roles") and not team:
                if not data.get("swarm"):
                    raise runs.RunError("Una lista de roles solo se usa en modo enjambre.")
                chosen = [roles[r] for r in data["roles"] if r in roles][:6]
                if not chosen:
                    raise runs.RunError("Ningún rol válido en la lista.")
                team = team_for_plan({"roles": [c["name"] for c in chosen]}, roles)
            return self.send_json(200, runs.start(
                ws, data.get("prompt", ""), role["brief"] if role else "", role["name"] if role else "",
                data.get("model", ""), data.get("mode", "plan"), data.get("isolation", "worktree"),
                bool(data.get("auto_approve")), data.get("timeout_min", 30),
                bool(data.get("swarm")), data.get("workers_model", ""), bool(data.get("allow_commands")), team,
                int(data.get("token_budget") or 0), minimal_plan(data), True, None, None, bool(data.get("allow_dev")),
                data["link_deps"] if "link_deps" in data else bool(data.get("allow_dev"))))
        except runs.RunError as e:
            return self.send_json(e.code, {"error": e.msg})
        except (OSError, ValueError, TypeError) as e:
            return self.send_json(500, {"error": f"Error interno: {e}"})

    def static(self, path):
        rel = {"": "index.html", "/": "index.html", "/office": "office.html"}.get(path, path.lstrip("/"))
        f = (HERE / "static" / rel).resolve()
        if not str(f).startswith(str(HERE / "static")) or not f.is_file():
            self.send_response(404)
            self.end_headers()
            return
        body = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(f.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    import threading
    threading.Thread(target=usage_monitor, daemon=True).start()
    CHAT.start_twitch()  # solo si hay canal configurado (ANT_TWITCH_CHANNEL o ~/.config/ant/chat.json)
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Ant en http://localhost:{PORT}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    sys.exit(main())
