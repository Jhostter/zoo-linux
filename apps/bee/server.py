#!/usr/bin/env python3
"""Bee: gestor de systemd de ZOO Linux. Servicios, sockets, temporizadores, rutas, montajes, objetivos y
slices, de usuario (sin permisos) y de sistema (con polkit); logs, dependencias, análisis de arranque y
asistente para crear/editar servicios de usuario. Solo biblioteca estándar."""
import datetime, glob, json, os, re, shlex, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error, urllib.request
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = int(os.environ.get("BEE_PORT", "4488"))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
HOME = os.path.expanduser("~")
USER_UNITS = os.path.join(HOME, ".config", "systemd", "user")
ENV = {**os.environ, "LC_ALL": "C.UTF-8", "SYSTEMD_COLORS": "0", "SYSTEMD_PAGER": ""}
TYPES = ("service", "socket", "timer", "path", "mount", "target", "slice")
NAME_RE = re.compile(r"^[A-Za-z0-9_:@][A-Za-z0-9:_.@\\\-]{0,199}\.(" + "|".join(TYPES) + r")$")
NEW_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
ACTIONS = {"start": ["start"], "stop": ["stop"], "restart": ["restart"], "reload": ["reload"],
           "enable": ["enable"], "disable": ["disable"], "enable-now": ["enable", "--now"],
           "disable-now": ["disable", "--now"], "reset-failed": ["reset-failed"], "mask": ["mask"], "unmask": ["unmask"]}
RISKY = {"stop", "restart", "disable", "disable-now", "reload", "mask"}
# Unidades de sistema cuyo cierre puede dejar la máquina inutilizable. Se pueden gestionar, pero
# solo con confirmación explícita (force) desde la interfaz.
PROTECTED = {"dbus.service", "dbus-broker.service", "dbus.socket", "systemd-journald.service", "systemd-logind.service",
             "systemd-udevd.service", "polkit.service", "NetworkManager.service", "cosmic-greeter.service",
             "gdm.service", "gdm3.service", "sddm.service", "lightdm.service", "accounts-daemon.service",
             "systemd-resolved.service", "wpa_supplicant.service", "user@1000.service", "systemd-timesyncd.service",
             "systemd-journald.socket", "systemd-udevd-control.socket", "systemd-udevd-kernel.socket", "init.scope"}
PROTECTED_RX = re.compile(r"^(getty@|user@|user-runtime-dir@|systemd-journald|systemd-logind|dbus)")
NEVER = {"bee.service"}  # la propia app: no se puede parar desde su interfaz

# ---------- pkexec sin agente de contraseñas ----------
# En este escritorio (COSMIC) los servicios de usuario no tienen agente de polkit: pkexec falla con 127 («textual authentication agent»).
# En ese caso se le da al usuario el comando exacto para ejecutarlo en una terminal con sudo.
def no_agent(rc, text):
    return rc == 127 and "authentication agent" in (text or "").lower()


def sudo_line(cmd):
    return "sudo " + " ".join(shlex.quote(str(x)) for x in (cmd[1:] if cmd[:1] == ["pkexec"] else cmd))


class NeedTerminal(ValueError):
    def __init__(self, cmd):
        super().__init__("No puedo abrir el diálogo de contraseña desde aquí (tu escritorio no ofrece un agente de polkit a los servicios). Ejecuta este comando en una terminal; te pedirá tu contraseña allí.")
        self.cmd = cmd


def fail(e):
    return (409, {"error": str(e), "terminal_cmd": e.cmd}) if isinstance(e, NeedTerminal) else (400, {"error": str(e)})


def open_terminal(cmd, title):
    """Pide a ZOO Linux que abra una terminal con el comando (ZOO lo muestra y solo lo ejecuta si el usuario confirma allí)."""
    if not isinstance(cmd, str) or not cmd.startswith("sudo ") or len(cmd) > 20000:
        raise ValueError("comando inválido")
    req = urllib.request.Request("http://127.0.0.1:" + os.environ.get("ZOO_PORT", "4400") + "/api/terminal", data=json.dumps({"cmd": cmd, "title": title}).encode(),
                                 headers={"X-Zoo": "1", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise ValueError(json.load(e).get("error", "ZOO no pudo abrir la terminal"))
    except OSError:
        raise ValueError("No se pudo contactar con ZOO Linux (¿está en marcha?)")





def run(cmd, timeout=30):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=ENV)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "tiempo agotado"
    except OSError:  # el programa no existe en este sistema
        return 127, "", "no existe " + str(cmd[0])


def sc(scope, *args):
    return ["systemctl"] + (["--user"] if scope == "user" else []) + list(args)


def valid_scope(s):
    if s not in ("user", "system"):
        raise ValueError("ámbito inválido")
    return s


def valid_unit(n):
    if not isinstance(n, str) or not NAME_RE.match(n) or n.endswith("@." + n.rsplit(".", 1)[-1]):
        raise ValueError("nombre de unidad inválido")
    return n


def utype(name):
    return name.rsplit(".", 1)[-1]


def is_protected(scope, name):
    t = utype(name)
    if name in NEVER:
        return True
    if t in ("target", "slice"):
        return True
    if scope == "system" and (name in PROTECTED or PROTECTED_RX.match(name) or t == "mount"):
        return True
    return False


def exists(scope, name):
    _, out, _ = run(sc(scope, "show", name, "-p", "LoadState", "--value", "--no-pager"))
    return out.strip() not in ("", "not-found")


# ---------- listado ----------
_CACHE, _REFRESH = {}, set()


def read_int(path, key):
    try:
        with open(path) as f:
            for l in f:
                if l.startswith(key + " "):
                    return int(l.split()[1])
    except (OSError, ValueError):
        pass
    return None


def mem_of(scope, names):
    """Memoria anónima (bytes) por unidad activa, con una sola llamada a systemctl."""
    out = {}
    if not names:
        return out
    _, txt, _ = run(sc(scope, "show", *names, "-p", "Id,ControlGroup", "--no-pager"), timeout=40)
    for block in txt.strip().split("\n\n"):
        kv = dict(l.split("=", 1) for l in block.splitlines() if "=" in l)
        cg = kv.get("ControlGroup")
        if cg and kv.get("Id"):
            a = read_int("/sys/fs/cgroup" + cg + "/memory.stat", "anon")
            if a is not None:
                out[kv["Id"]] = a
    return out


def timers_info(scope):
    _, out, _ = run(sc(scope, "list-timers", "--all", "--no-legend", "--no-pager", "--output=json"))
    try:
        return {t.get("unit"): t for t in json.loads(out)}
    except ValueError:
        return {}


def list_units(scope, t):
    key = (scope, t)
    c = _CACHE.get(key)
    if c:
        if time.time() - c[0] > 3 and key not in _REFRESH:
            _REFRESH.add(key)
            threading.Thread(target=lambda: (_compute(scope, t), _REFRESH.discard(key)), daemon=True).start()
        return c[1]
    return _compute(scope, t)


def _compute(scope, t):
    units = {}
    _, out, _ = run(sc(scope, "list-units", f"--type={t}", "--all", "--no-legend", "--plain", "--no-pager"))
    for l in out.splitlines():
        p = l.split(None, 4)
        if len(p) >= 4 and not p[0].startswith("-") and not re.search(r"@\.[a-z]+$", p[0]):
            units[p[0]] = {"name": p[0], "load": p[1], "active": p[2], "sub": p[3], "desc": p[4] if len(p) > 4 else ""}
    _, out, _ = run(sc(scope, "list-unit-files", f"--type={t}", "--no-legend", "--plain", "--no-pager"))
    for l in out.splitlines():
        p = l.split()
        if len(p) >= 2 and not p[0].startswith("-") and not re.search(r"@\.[a-z]+$", p[0]):
            u = units.setdefault(p[0], {"name": p[0], "load": "loaded", "active": "inactive", "sub": "dead", "desc": ""})
            u["file"] = p[1]
    res = [u for u in units.values() if u["load"] != "not-found" and u.get("file") != "alias"]
    for u in res:
        u.setdefault("file", "transient")
        u["protected"] = is_protected(scope, u["name"])
    if t == "service":
        mem = mem_of(scope, [u["name"] for u in res if u["active"] == "active"])
        for u in res:
            u["mem"] = mem.get(u["name"])
    if t == "timer":
        ti = timers_info(scope)
        for u in res:
            x = ti.get(u["name"], {})
            u["next"], u["last"], u["activates"] = x.get("next"), x.get("last"), x.get("activates")
    res.sort(key=lambda u: u["name"].lower())
    _CACHE[(scope, t)] = (time.time(), res)
    return res


_SUM = {"t": 0, "v": None}


def summary():
    """Recuento por tipo y ámbito con una sola llamada por ámbito."""
    if _SUM["v"] and time.time() - _SUM["t"] < 3:
        return _SUM["v"]
    out = {}
    for s in ("user", "system"):
        _, txt, _ = run(sc(s, "list-units", "--all", "--no-legend", "--plain", "--no-pager"))
        d = {t: {"total": 0, "active": 0, "failed": 0} for t in TYPES}
        seen = set()
        for l in txt.splitlines():
            p = l.split(None, 4)
            if len(p) >= 4 and not p[0].startswith("-") and not re.search(r"@\.[a-z]+$", p[0]) and p[1] != "not-found":
                t = utype(p[0])
                if t in d:
                    seen.add(p[0])
                    d[t]["total"] += 1
                    d[t]["active"] += p[2] == "active"
                    d[t]["failed"] += p[2] == "failed"
        # unidades instaladas pero no cargadas (mismo recuento que muestra la lista)
        _, files, _ = run(sc(s, "list-unit-files", "--no-legend", "--plain", "--no-pager"))
        for l in files.splitlines():
            p = l.split()
            if len(p) >= 2 and p[0] not in seen and not p[0].startswith("-") and not re.search(r"@\.[a-z]+$", p[0]) and p[1] != "alias":
                t = utype(p[0])
                if t in d:
                    d[t]["total"] += 1
        out[s] = d
    try:
        lg = login_list()
        out["login"] = {"total": len(lg), "off": sum(1 for e in lg if not e["enabled"])}
        out["cron"] = {"total": sum(1 for e in cron_entries()[1] if e["kind"] == "job") if cron_bin() else 0}
    except (ValueError, OSError):
        pass
    _SUM.update(t=time.time(), v=out)
    return out


# ---------- detalle ----------
_PREV = {}
PROPS = ["Id", "Description", "LoadState", "ActiveState", "SubState", "UnitFileState", "FragmentPath", "DropInPaths", "MainPID",
         "ControlGroup", "NRestarts", "Result", "Restart", "ExecStart", "ActiveEnterTimestamp", "TasksCurrent", "WorkingDirectory",
         "User", "Type", "TriggeredBy", "Triggers", "Listen", "Where", "What", "TimersCalendar", "TimersMonotonic",
         "NextElapseUSecRealtime", "LastTriggerUSec", "Unit", "PathChanged", "PathExists", "PathModified", "MemoryMax", "CPUQuotaPerSecUSec"]


def made_by_bee(path):
    MARK = "# Creado por Bee (ZOO Linux)"
    try:
        with open(path, errors="replace") as f:
            return f.readline().strip() == MARK
    except OSError:
        return False


MARK = "# Creado por Bee (ZOO Linux)"


def parse_unit_fields(path):
    f = {"description": "", "exec": "", "workdir": "", "restart": "on-failure"}
    try:
        for l in open(path, errors="replace"):
            for key, field in (("Description=", "description"), ("ExecStart=", "exec"), ("WorkingDirectory=", "workdir"), ("Restart=", "restart")):
                if l.startswith(key):
                    f[field] = l[len(key):].strip()
    except OSError:
        pass
    return f


def detail(scope, name):
    _, out, _ = run(sc(scope, "show", name, "--no-pager", "-p", ",".join(PROPS)))
    kv = {}
    for l in out.splitlines():
        if "=" in l:
            k, v = l.split("=", 1)
            kv[k] = v
    if kv.get("LoadState") in (None, "not-found"):
        raise ValueError("la unidad no existe")
    cg, mem, cpu = kv.get("ControlGroup"), None, None
    if kv.get("ActiveState") == "active" and cg:
        base = "/sys/fs/cgroup" + cg
        mem = read_int(base + "/memory.stat", "anon")
        usec = read_int(base + "/cpu.stat", "usage_usec")
        k2, now = (scope, name), time.monotonic()
        if usec is not None:
            prev = _PREV.get(k2)
            if prev and now - prev[0] > 0.5:
                cpu = round(max(0.0, (usec - prev[1]) / 1e6 / (now - prev[0]) * 100), 1)
            _PREV[k2] = (now, usec)
    fp = kv.get("FragmentPath", "")
    deletable = scope == "user" and fp.startswith(USER_UNITS + os.sep) and os.path.isfile(fp) and made_by_bee(fp)
    unit_text = None
    if fp and os.path.isfile(fp):
        try:
            with open(fp, errors="replace") as f:
                unit_text = f.read(30000)
        except OSError:
            pass
    execs = re.search(r"argv\[\]=(.*?) ;", kv.get("ExecStart", ""))
    _, status, _ = run(sc(scope, "status", name, "--no-pager", "--lines=0"))
    extra = {k: kv[k] for k in ("Listen", "Where", "What", "TimersCalendar", "TimersMonotonic", "NextElapseUSecRealtime",
                                "LastTriggerUSec", "Unit", "PathChanged", "PathExists", "PathModified", "MemoryMax", "CPUQuotaPerSecUSec") if kv.get(k) and kv[k] not in ("infinity", "n/a", "0")}
    return {"name": name, "scope": scope, "type": utype(name), "desc": kv.get("Description"), "active": kv.get("ActiveState"),
            "sub": kv.get("SubState"), "file": kv.get("UnitFileState"), "path": fp, "dropins": kv.get("DropInPaths", ""),
            "pid": kv.get("MainPID"), "restarts": kv.get("NRestarts"), "result": kv.get("Result"), "restart_policy": kv.get("Restart"),
            "exec": execs[1] if execs else None, "since": kv.get("ActiveEnterTimestamp"), "tasks": kv.get("TasksCurrent"),
            "workdir": kv.get("WorkingDirectory"), "user": kv.get("User"), "triggered_by": kv.get("TriggeredBy"), "triggers": kv.get("Triggers"),
            "mem": mem, "cpu": cpu, "unit_text": unit_text, "deletable": deletable,
            "fields": parse_unit_fields(fp) if deletable else None,
            "protected": is_protected(scope, name), "extra": extra, "status": status.strip()[:3500],
            "timer_last": timer_last(kv.get("Unit") or (name[:-6] + ".service")) if name.endswith(".timer") and scope == "user" else None}


def logs(scope, name, n=200, grep="", prio=""):
    n = max(10, min(int(n), 2000))
    cmd = ["journalctl"] + (["--user"] if scope == "user" else []) + ["-u", name, "-n", str(n), "--no-pager", "-o", "short-iso"]
    if prio in ("err", "warning", "notice", "info"):
        cmd += ["-p", prio]
    if grep:
        if len(grep) > 100:
            raise ValueError("filtro demasiado largo")
        cmd += ["--grep", grep]
    _, out, err = run(cmd)
    return out or err


def deps(scope, name, reverse):
    cmd = sc(scope, "list-dependencies", "--plain", "--no-pager", name) + (["--reverse"] if reverse else [])
    _, out, _ = run(cmd, timeout=30)
    return "\n".join(out.splitlines()[:300])


# ---------- acciones ----------
def do_action(scope, names, action, force=False):
    if action not in ACTIONS:
        raise ValueError("acción inválida")
    if not isinstance(names, list) or not names or len(names) > 100:
        raise ValueError("selección inválida")
    names = [valid_unit(n) for n in names]
    for n in names:
        if not exists(scope, n):
            raise ValueError(f"{n} no existe")
        if n in NEVER and action in RISKY:
            raise ValueError("Bee no puede detenerse a sí mismo desde su propia interfaz")
    prot = [n for n in names if is_protected(scope, n) and action in RISKY]
    if prot and not force:
        raise ProtectedError(prot)
    cmd = sc(scope, *ACTIONS[action], *names)
    if scope == "system":
        cmd = ["pkexec"] + cmd
    rc, out, err = run(cmd, timeout=120)
    if no_agent(rc, err):
        raise NeedTerminal(sudo_line(cmd))
    _CACHE.clear(); _SUM["v"] = None
    return rc == 0, (out + err).strip()[:800]


class ProtectedError(Exception):
    def __init__(self, names):
        self.names = names


def daemon_reload(scope):
    cmd = sc(scope, "daemon-reload")
    full = (["pkexec"] if scope == "system" else []) + cmd
    rc, out, err = run(full, timeout=120)
    if no_agent(rc, err):
        raise NeedTerminal(sudo_line(full))
    _CACHE.clear()
    return rc == 0, (out + err).strip()[:500]


def validate_unit_fields(b):
    fields = {k: str(b.get(k) or "") for k in ("description", "exec", "workdir")}
    if any(("\n" in v or "\r" in v or "\0" in v) for v in fields.values()):
        raise ValueError("los campos no pueden tener saltos de línea")
    if not fields["exec"].strip():
        raise ValueError("falta el comando (ExecStart)")
    restart = b.get("restart", "on-failure")
    if restart not in ("no", "on-failure", "always"):
        raise ValueError("política de reinicio inválida")
    if fields["workdir"] and not os.path.isdir(os.path.expanduser(fields["workdir"])):
        raise ValueError("la carpeta de trabajo no existe")
    return fields, restart


def render_unit(name, fields, restart):
    lines = [MARK, "[Unit]", f"Description={fields['description'] or name}", "", "[Service]", f"ExecStart={fields['exec'].strip()}"]
    if fields["workdir"]:
        lines.append(f"WorkingDirectory={os.path.expanduser(fields['workdir'])}")
    lines += [f"Restart={restart}", "", "[Install]", "WantedBy=default.target", ""]
    return "\n".join(lines)


def create_unit(b):
    name = b.get("name", "")
    if not isinstance(name, str) or not NEW_RE.match(name):
        raise ValueError("nombre inválido (minúsculas, números y guiones)")
    fields, restart = validate_unit_fields(b)
    path = os.path.join(USER_UNITS, name + ".service")
    if os.path.exists(path) or exists("user", name + ".service"):
        raise ValueError("ya existe un servicio con ese nombre")
    os.makedirs(USER_UNITS, exist_ok=True)
    with open(path, "w") as f:
        f.write(render_unit(name, fields, restart))
    run(["systemctl", "--user", "daemon-reload"])
    if b.get("start"):
        ok, msg = do_action("user", [name + ".service"], "enable-now")
        if not ok:
            raise ValueError("creado, pero no arrancó: " + msg)
    _CACHE.clear()
    return name + ".service"


def update_unit(b):
    name = valid_unit(b.get("name"))
    d = detail("user", name)
    if not d["deletable"]:
        raise ValueError("solo se pueden editar servicios creados con Bee")
    fields, restart = validate_unit_fields(b)
    with open(d["path"], "w") as f:
        f.write(render_unit(name[:-8], fields, restart))
    run(["systemctl", "--user", "daemon-reload"])
    if b.get("restart_now") and d["active"] == "active":
        do_action("user", [name], "restart")
    _CACHE.clear()


def delete_unit(name):
    d = detail("user", name)
    if not d["deletable"] or name in NEVER:
        raise ValueError("solo se pueden eliminar servicios creados con Bee (los demás, como los de la suite, no)")
    run(["systemctl", "--user", "disable", "--now", name], timeout=40)
    os.remove(d["path"])
    if name.endswith(".timer"):
        pair = os.path.join(USER_UNITS, name[:-6] + ".service")
        if os.path.isfile(pair) and made_by_bee(pair):
            run(["systemctl", "--user", "stop", name[:-6] + ".service"], timeout=30)
            os.remove(pair)
    run(["systemctl", "--user", "daemon-reload"])
    _CACHE.clear(); _SUM["v"] = None


# ---------- análisis de arranque ----------
def to_ms(txt):
    ms = 0.0
    for num, unit in re.findall(r"([\d.]+)(min|ms|us|s|h)", txt):
        ms += float(num) * {"h": 3600000, "min": 60000, "s": 1000, "ms": 1, "us": 0.001}[unit]
    return ms


def boot_analysis(scope):
    _, summ, _ = run(["systemd-analyze"] + (["--user"] if scope == "user" else []) + ["--no-pager"], timeout=60)
    _, blame, _ = run(["systemd-analyze"] + (["--user"] if scope == "user" else []) + ["blame", "--no-pager"], timeout=60)
    items = []
    for l in blame.splitlines()[:40]:
        m = re.match(r"^\s*(.+?)\s+(\S+\.\w+)$", l)
        if m:
            items.append({"ms": to_ms(m[1]), "unit": m[2]})
    return {"summary": summ.strip().splitlines()[:2], "blame": items}


# ======================================================================
# Rooster: inicio de sesión (autostart), cron y temporizadores propios
# ======================================================================
AUTO_USER = os.environ.get("BEE_AUTOSTART_USER") or os.path.join(HOME, ".config", "autostart")
AUTO_SYS = os.environ.get("BEE_AUTOSTART_SYS") or "/etc/xdg/autostart"
DATA_DIR = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(HOME, ".local", "share"), "bee")
D_MARK = "# Creado por Bee (ZOO Linux)"
D_OVERRIDE = "# Override de Bee (ZOO Linux): oculta una entrada del sistema"
SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
DESK_RE = re.compile(r"^[A-Za-z0-9._@+-]{1,120}\.desktop$")


def parse_desktop(path):
    d, on = {}, False
    try:
        for l in open(path, encoding="utf-8", errors="replace"):
            l = l.rstrip("\n")
            if l.startswith("["):
                on = l.strip() == "[Desktop Entry]"
                continue
            if on and "=" in l and not l.lstrip().startswith("#"):
                k, v = l.split("=", 1)
                d[k.strip()] = v.strip()
    except OSError:
        return None
    return d


def first_line(path):
    try:
        with open(path, errors="replace") as f:
            return f.readline().strip()
    except OSError:
        return ""


def unit_for_autostart(fname):
    base = fname[:-8]
    esc = "".join(c if (c.isalnum() and c.isascii()) or c in ":_." else "\\x%02x" % ord(c) for c in base)
    return f"app-{esc}@autostart.service"


def current_desktops():
    _, out, _ = run(["systemctl", "--user", "show-environment"])
    for l in out.splitlines():
        if l.startswith("XDG_CURRENT_DESKTOP="):
            return [x for x in l.split("=", 1)[1].split(":") if x]
    return [x for x in (os.environ.get("XDG_CURRENT_DESKTOP") or "").split(":") if x]


def login_list():
    files = {}
    for src, d in (("system", AUTO_SYS), ("user", AUTO_USER)):
        for p in sorted(glob.glob(os.path.join(d, "*.desktop"))):
            files.setdefault(os.path.basename(p), {})[src] = p
    desktops = current_desktops()
    out = []
    for fname, srcs in files.items():
        eff_src = "user" if "user" in srcs else "system"
        path = srcs[eff_src]
        dd = parse_desktop(path) or {}
        base = parse_desktop(srcs["system"]) if "system" in srcs else None
        is_override = "user" in srcs and "system" in srcs
        bee_override = first_line(srcs.get("user", "")) == D_OVERRIDE if "user" in srcs else False
        hidden = dd.get("Hidden", "").lower() == "true" or dd.get("X-GNOME-Autostart-enabled", "").lower() == "false"
        only = [x for x in dd.get("OnlyShowIn", "").split(";") if x]
        notin = [x for x in dd.get("NotShowIn", "").split(";") if x]
        applies, why = True, ""
        if only and desktops and not set(only) & set(desktops):
            applies, why = False, "solo para " + ", ".join(only)
        if notin and set(notin) & set(desktops):
            applies, why = False, "no aplica a " + ", ".join(sorted(set(notin) & set(desktops)))
        shown = dd if not (bee_override and base) else base
        name = shown.get("Name[es]") or shown.get("Name") or fname[:-8]
        out.append({"file": fname, "name": name, "comment": shown.get("Comment[es]") or shown.get("Comment", ""), "exec": shown.get("Exec", ""),
                    "icon": shown.get("Icon", ""), "source": eff_src, "path": path, "override": is_override, "enabled": not hidden, "applies": applies, "why": why,
                    "delay": shown.get("X-GNOME-Autostart-Delay") or shown.get("X-Bee-Delay", ""), "bee": first_line(srcs.get("user", "")) == D_MARK,
                    "bee_override": bee_override, "unit": unit_for_autostart(fname), "user_file": srcs.get("user"), "system_file": srcs.get("system")})
    if out:
        _, txt, _ = run(["systemctl", "--user", "show", *[e["unit"] for e in out], "-p", "Id,ActiveState,LoadState", "--no-pager"], timeout=40)
        st_ = {}
        for block in txt.strip().split("\n\n"):
            kv = dict(l.split("=", 1) for l in block.splitlines() if "=" in l)
            if "Id" in kv:
                st_[kv["Id"]] = kv
        for e in out:
            kv = st_.get(e["unit"], {})
            e["running"] = kv.get("ActiveState") == "active"
            e["has_unit"] = kv.get("LoadState") == "loaded"
            e["state"] = kv.get("ActiveState", "inactive") if e["has_unit"] else "sin unidad"
    out.sort(key=lambda e: (e["source"] != "user", e["name"].lower()))
    return out


def set_desktop_keys(path, changes):
    """Edita claves de [Desktop Entry] conservando el resto del archivo (None borra la clave)."""
    lines = open(path, encoding="utf-8", errors="replace").read().split("\n")
    out, on, seen, end = [], False, set(), None
    for idx, l in enumerate(lines):
        if l.startswith("["):
            if on and end is None:
                end = len(out)
            on = l.strip() == "[Desktop Entry]"
        elif on and "=" in l and not l.lstrip().startswith("#"):
            k = l.split("=", 1)[0].strip()
            if k in changes:
                seen.add(k)
                if changes[k] is not None:
                    out.append(f"{k}={changes[k]}")
                continue
        out.append(l)
    if end is None:
        end = len(out)
        while end > 0 and out[end - 1] == "":
            end -= 1
    add = [f"{k}={v}" for k, v in changes.items() if v is not None and k not in seen]
    out[end:end] = add
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))


def valid_desktop(f):
    if not isinstance(f, str) or not DESK_RE.match(f) or f.startswith("."):
        raise ValueError("archivo de inicio inválido")
    return f


def login_toggle(fname, enable):
    fname = valid_desktop(fname)
    up, sp = os.path.join(AUTO_USER, fname), os.path.join(AUTO_SYS, fname)
    os.makedirs(AUTO_USER, exist_ok=True)
    if os.path.exists(up):
        if first_line(up) == D_OVERRIDE:
            if enable:
                os.remove(up)  # quitar el override devuelve la entrada del sistema tal cual
            else:
                set_desktop_keys(up, {"Hidden": "true", "X-GNOME-Autostart-enabled": "false"})
        elif enable:
            set_desktop_keys(up, {"Hidden": None, "X-GNOME-Autostart-enabled": "true"})
        else:
            set_desktop_keys(up, {"Hidden": "true", "X-GNOME-Autostart-enabled": "false"})
    elif os.path.exists(sp):
        if enable:
            return  # ya está activa
        d = parse_desktop(sp) or {}
        with open(up, "w", encoding="utf-8") as f:
            f.write(f"{D_OVERRIDE}\n[Desktop Entry]\nType=Application\nName={d.get('Name', fname[:-8])}\nHidden=true\nX-GNOME-Autostart-enabled=false\n")
    else:
        raise ValueError("la entrada no existe")
    run(["systemctl", "--user", "daemon-reload"])


def login_create(b):
    slug, cmd = b.get("name", ""), str(b.get("exec") or "").strip()
    if not isinstance(slug, str) or not SLUG_RE.match(slug):
        raise ValueError("nombre inválido (minúsculas, números y guiones)")
    fields = {k: str(b.get(k) or "") for k in ("title", "comment")}
    if not cmd or any(("\n" in v or "\r" in v or "\0" in v) for v in (cmd, *fields.values())):
        raise ValueError("el comando es obligatorio y no puede tener saltos de línea")
    try:
        delay = int(b.get("delay") or 0)
    except (TypeError, ValueError):
        raise ValueError("retraso inválido")
    if not 0 <= delay <= 600:
        raise ValueError("el retraso debe estar entre 0 y 600 s")
    fname = f"bee-{slug}.desktop"
    path = os.path.join(AUTO_USER, fname)
    if os.path.exists(path) or os.path.exists(os.path.join(AUTO_SYS, fname)):
        raise ValueError("ya existe una app de inicio con ese nombre")
    execl = f"sh -c {shlex.quote(f'sleep {delay}; exec {cmd}')}" if delay else cmd
    os.makedirs(AUTO_USER, exist_ok=True)
    lines = [D_MARK, "[Desktop Entry]", "Type=Application", f"Name={fields['title'] or slug}"]
    if fields["comment"]:
        lines.append(f"Comment={fields['comment']}")
    lines += [f"Exec={execl}", "Terminal=false", "X-GNOME-Autostart-enabled=true", f"X-Bee-Command={cmd}", f"X-Bee-Delay={delay}", ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    run(["systemctl", "--user", "daemon-reload"])
    return fname


def login_delete(fname):
    fname = valid_desktop(fname)
    up = os.path.join(AUTO_USER, fname)
    if not os.path.exists(up) or first_line(up) not in (D_MARK, D_OVERRIDE):
        raise ValueError("solo se pueden eliminar entradas creadas con Bee (las demás se desactivan, no se borran)")
    os.remove(up)
    run(["systemctl", "--user", "daemon-reload"])


# ---------- cron ----------
OFF_TAG = "#BEE-OFF# "
MACROS = {"@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0", "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *"}
MONTHN = {m: i + 1 for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split())}
DOWN = {d: i for i, d in enumerate("sun mon tue wed thu fri sat".split())}
DIAS = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"]


def lista_es(xs):
    xs = list(xs)
    return xs[0] if len(xs) == 1 else ", ".join(xs[:-1]) + " y " + xs[-1]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
CRON_ENV_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\s*=")


def cron_field(f, lo, hi, names=None):
    out = set()
    for part in f.split(","):
        step = 1
        if "/" in part:
            part, s = part.split("/", 1)
            if not s.isdigit() or int(s) < 1:
                raise ValueError("paso inválido")
            step = int(s)

        def conv(x):
            if x.isdigit():
                return int(x)
            if names and x.lower()[:3] in names and len(x) >= 3:
                return names[x.lower()[:3]]
            raise ValueError(f"valor inválido: {x}")
        if part == "*":
            a, b = lo, hi
        elif "-" in part:
            x, y = part.split("-", 1)
            a, b = conv(x), conv(y)
        else:
            a = conv(part)
            b = hi if step > 1 else a
        if a < lo or b > hi or a > b:
            raise ValueError(f"fuera de rango ({lo}–{hi})")
        out.update(range(a, b + 1, step))
    return out


def cron_split(expr):
    """Devuelve la expresión normalizada de 5 campos. Lanza ValueError si no es válida. @reboot -> None."""
    e = (expr or "").strip()
    if e == "@reboot":
        return None
    if e in MACROS:
        e = MACROS[e]
    f = e.split()
    if len(f) != 5:
        raise ValueError("la programación debe tener 5 campos (minuto hora día mes día-semana) o un atajo como @daily")
    cron_field(f[0], 0, 59); cron_field(f[1], 0, 23); cron_field(f[2], 1, 31); cron_field(f[3], 1, 12, MONTHN); cron_field(f[4], 0, 7, DOWN)
    return f


def cron_next(expr, n=3):
    f = cron_split(expr)
    if f is None:
        return []
    mins, hrs, doms, mons, dows = cron_field(f[0], 0, 59), cron_field(f[1], 0, 23), cron_field(f[2], 1, 31), cron_field(f[3], 1, 12, MONTHN), cron_field(f[4], 0, 7, DOWN)
    dows = {0 if d == 7 else d for d in dows}
    dom_r, dow_r = f[2] != "*", f[4] != "*"
    now = datetime.datetime.now().replace(second=0, microsecond=0) + datetime.timedelta(minutes=1)
    res = []
    for k in range(0, 800):
        day = (now + datetime.timedelta(days=k)).date()
        if day.month not in mons:
            continue
        dom_ok, dow_ok = day.day in doms, (day.isoweekday() % 7) in dows
        ok = (dom_ok or dow_ok) if (dom_r and dow_r) else (dom_ok and dow_ok)
        if not ok:
            continue
        for hh in sorted(hrs):
            for mm in sorted(mins):
                t = datetime.datetime(day.year, day.month, day.day, hh, mm)
                if t >= now:
                    res.append(int(t.timestamp()))
                    if len(res) >= n:
                        return res
    return res


def cron_human(expr):
    e = (expr or "").strip()
    if e == "@reboot":
        return "al iniciar el equipo"
    try:
        f = cron_split(e)
    except ValueError:
        return "programación no válida"
    m, h_, dom, mon, dow = f
    hhmm = lambda: f"{int(h_):02d}:{int(m):02d}"
    if f == ["*"] * 5:
        return "cada minuto"
    if m.startswith("*/") and h_ == dom == mon == dow == "*" and m[2:].isdigit():
        return f"cada {m[2:]} minutos"
    if m.isdigit() and h_ == dom == mon == dow == "*":
        return "cada hora, en el minuto %s" % m if m != "0" else "cada hora en punto"
    if m.isdigit() and h_.startswith("*/") and dom == mon == dow == "*":
        return f"cada {h_[2:]} horas (minuto {m})"
    if m.isdigit() and h_.isdigit():
        if dom == mon == dow == "*":
            return f"todos los días a las {hhmm()}"
        if dom == mon == "*" and dow != "*":
            ds = sorted({0 if d == 7 else d for d in cron_field(dow, 0, 7, DOWN)})
            if ds == [1, 2, 3, 4, 5]:
                return f"de lunes a viernes a las {hhmm()}"
            if ds == [0, 6]:
                return f"los fines de semana a las {hhmm()}"
            return "los " + lista_es(DIAS[d] for d in ds) + f" a las {hhmm()}"
        if mon == dow == "*" and dom != "*":
            return f"el día {dom} de cada mes a las {hhmm()}"
        if dow == "*" and dom != "*" and mon != "*":
            ms = sorted(cron_field(mon, 1, 12, MONTHN))
            return f"el día {dom} de " + lista_es(MESES[x - 1] for x in ms) + f" a las {hhmm()}"
    return "programación personalizada (" + e + ")"


def cron_bin():
    return shutil_which("crontab")


def shutil_which(x):
    for p in os.environ.get("PATH", "").split(":"):
        fp = os.path.join(p, x)
        if os.path.isfile(fp) and os.access(fp, os.X_OK):
            return fp
    return None


def cron_read_text():
    rc, out, err = run(["crontab", "-l"])
    if rc != 0:
        if "no crontab" in (err or "").lower():
            return ""
        raise ValueError("no se pudo leer el crontab: " + (err or "error").strip()[:120])
    return out


def cron_write_text(text):
    os.makedirs(os.path.join(DATA_DIR, "crontab"), exist_ok=True)
    try:
        old = cron_read_text()
    except ValueError:
        old = ""
    if old:
        with open(os.path.join(DATA_DIR, "crontab", time.strftime("%Y%m%d-%H%M%S") + "-%03d" % (int(time.time() * 1000) % 1000) + ".bak"), "w") as f:
            f.write(old)
    if not text.strip():
        rc, out, err = run(["crontab", "-r"])
        return
    r = subprocess.run(["crontab", "-"], input=text if text.endswith("\n") else text + "\n", capture_output=True, text=True, timeout=20, env=ENV)
    if r.returncode:
        raise ValueError("crontab rechazó el contenido: " + (r.stderr or "error").strip()[:160])


def cron_entries():
    text = cron_read_text()
    ents = []
    for i, raw in enumerate(text.split("\n")):
        l = raw.strip()
        if not l:
            continue
        off = l.startswith(OFF_TAG)
        body = l[len(OFF_TAG):] if off else l
        if body.startswith("#") or (not body):
            continue
        if CRON_ENV_RE.match(body) and not off:
            ents.append({"i": i, "kind": "env", "raw": raw})
            continue
        if body.startswith("@"):
            parts = body.split(None, 1)
            sched, cmd = parts[0], parts[1] if len(parts) > 1 else ""
        else:
            parts = body.split(None, 5)
            if len(parts) < 6:
                continue
            sched, cmd = " ".join(parts[:5]), parts[5]
        try:
            human, nxt = cron_human(sched), ([] if off else cron_next(sched, 3))
            valid = True
        except ValueError:
            human, nxt, valid = "programación no válida", [], False
        ents.append({"i": i, "kind": "job", "raw": raw, "schedule": sched, "command": cmd, "enabled": not off, "human": human, "next": nxt, "valid": valid})
    return text, ents


def cron_system():
    jobs = []
    for path in ["/etc/crontab"] + sorted(glob.glob("/etc/cron.d/*")):
        try:
            for l in open(path, errors="replace"):
                l = l.strip()
                if not l or l.startswith("#") or CRON_ENV_RE.match(l):
                    continue
                parts = l.split(None, 6) if not l.startswith("@") else l.split(None, 2)
                try:
                    if l.startswith("@"):
                        sched, user, cmd = parts[0], parts[1], parts[2] if len(parts) > 2 else ""
                    else:
                        sched, user, cmd = " ".join(parts[:5]), parts[5], parts[6] if len(parts) > 6 else ""
                    jobs.append({"file": path, "schedule": sched, "user": user, "command": cmd, "human": cron_human(sched)})
                except (IndexError, ValueError):
                    continue
        except OSError:
            continue
    dirs = {}
    for per in ("hourly", "daily", "weekly", "monthly"):
        d = f"/etc/cron.{per}"
        try:
            dirs[per] = sorted(x for x in os.listdir(d) if not x.startswith("."))
        except OSError:
            dirs[per] = []
    return {"jobs": jobs, "dirs": dirs}


def cron_info():
    if not cron_bin():
        return {"available": False}
    text, ents = cron_entries()
    return {"available": True, "service": run(["systemctl", "is-active", "cron"])[1].strip() or "inactive", "entries": ents, "system": cron_system(), "backups": len(glob.glob(os.path.join(DATA_DIR, "crontab", "*.bak")))}


def _line_check(lines, i, expect):
    if not isinstance(i, int) or i < 0 or i >= len(lines) or lines[i].strip() != str(expect or "").strip():
        raise ValueError("el crontab cambió mientras lo editabas; recarga la lista")


def clean_job(schedule, command):
    schedule, command = str(schedule or "").strip(), str(command or "").strip()
    cron_split(schedule)
    if not command or any(c in command for c in "\n\r\0"):
        raise ValueError("el comando es obligatorio y debe ir en una sola línea")
    if len(command) > 2000:
        raise ValueError("comando demasiado largo")
    return f"{schedule} {command}"


def cron_op(b):
    op = b.get("op")
    text = cron_read_text()
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if op == "add":
        lines.append(clean_job(b.get("schedule"), b.get("command")))
    elif op in ("edit", "toggle", "delete"):
        _line_check(lines, b.get("i"), b.get("expect"))
        i = b["i"]
        if op == "delete":
            del lines[i]
        elif op == "toggle":
            l = lines[i].strip()
            lines[i] = l[len(OFF_TAG):] if l.startswith(OFF_TAG) else OFF_TAG + l
        else:
            new = clean_job(b.get("schedule"), b.get("command"))
            lines[i] = (OFF_TAG if lines[i].strip().startswith(OFF_TAG) else "") + new
    else:
        raise ValueError("operación inválida")
    cron_write_text("\n".join(lines) + "\n" if lines else "")


def cron_run(b):
    text = cron_read_text()
    lines = text.split("\n")
    _line_check(lines, b.get("i"), b.get("expect"))
    _, ents = cron_entries()
    job = next((e for e in ents if e["i"] == b["i"] and e["kind"] == "job"), None)
    if not job:
        raise ValueError("esa línea no es una tarea")
    env = dict(os.environ)
    for e in ents:
        if e["kind"] == "env" and e["i"] < job["i"]:
            k, v = e["raw"].split("=", 1)
            env[k.strip()] = v.strip().strip("\"'")
    t0 = time.time()
    try:
        r = subprocess.run(["sh", "-c", job["command"]], capture_output=True, text=True, timeout=60, env=env, cwd=HOME)
        return {"code": r.returncode, "output": (r.stdout + r.stderr)[-3000:], "seconds": round(time.time() - t0, 1)}
    except subprocess.TimeoutExpired:
        return {"code": None, "output": "Sigue ejecutándose pasados 60 s; se cortó la espera (el proceso se terminó).", "seconds": 60}


# ---------- temporizadores propios ----------
def calendar_preview(expr, n=5):
    expr = str(expr or "").strip()
    if not expr or len(expr) > 100 or "\n" in expr or expr.startswith("-"):
        raise ValueError("horario inválido")
    rc, out, err = run(["systemd-analyze", "calendar", f"--iterations={n}", expr], timeout=15)
    if rc != 0:
        raise ValueError((err or out or "horario no válido").strip().splitlines()[-1][:160])
    norm = next((l.split(":", 1)[1].strip() for l in out.splitlines() if l.strip().startswith("Normalized form")), expr)
    nxt = [l.split(":", 1)[1].strip() for l in out.splitlines() if re.match(r"^\s*(Next elapse|Iteration #\d+)", l)]
    return {"normalized": norm, "next": nxt}


def create_timer(b):
    name = b.get("name", "")
    if not isinstance(name, str) or not NEW_RE.match(name):
        raise ValueError("nombre inválido (minúsculas, números y guiones)")
    cmd = str(b.get("command") or "").strip()
    desc = str(b.get("description") or "")
    wd = str(b.get("workdir") or "")
    if not cmd or any(c in (cmd + desc + wd) for c in "\n\r\0"):
        raise ValueError("el comando es obligatorio y los campos no pueden tener saltos de línea")
    if wd and not os.path.isdir(os.path.expanduser(wd)):
        raise ValueError("la carpeta de trabajo no existe")
    mode = b.get("mode")
    timer = ["[Timer]"]
    if mode == "calendar":
        calendar_preview(b.get("calendar"), 1)
        timer.append(f"OnCalendar={b['calendar'].strip()}")
        if b.get("persistent", True):
            timer.append("Persistent=true")
    elif mode == "boot":
        sec = int(b.get("seconds") or 0)
        if not 0 <= sec <= 86400:
            raise ValueError("retraso inválido (0–86400 s)")
        timer.append(f"OnStartupSec={sec}s" if sec else "OnStartupSec=1s")
    elif mode == "interval":
        sec = int(b.get("seconds") or 0)
        if not 30 <= sec <= 31536000:
            raise ValueError("el intervalo debe ser de al menos 30 s")
        timer += [f"OnStartupSec={min(sec, 300)}s", f"OnUnitActiveSec={sec}s"]
    else:
        raise ValueError("tipo de horario inválido")
    rd = int(b.get("random_delay") or 0)
    if not 0 <= rd <= 3600:
        raise ValueError("retraso aleatorio inválido (0–3600 s)")
    if rd:
        timer.append(f"RandomizedDelaySec={rd}s")
    sp, tp = os.path.join(USER_UNITS, name + ".service"), os.path.join(USER_UNITS, name + ".timer")
    if any(os.path.exists(x) or exists("user", os.path.basename(x)) for x in (sp, tp)):
        raise ValueError("ya existe un servicio o temporizador con ese nombre")
    os.makedirs(USER_UNITS, exist_ok=True)
    svc = [MARK, "[Unit]", f"Description={desc or name}", "", "[Service]", "Type=oneshot", f"ExecStart={cmd}"] + ([f"WorkingDirectory={os.path.expanduser(wd)}"] if wd else []) + [""]
    tim = [MARK, "[Unit]", f"Description=Temporizador de {desc or name}", ""] + timer + ["", "[Install]", "WantedBy=timers.target", ""]
    with open(sp, "w") as f:
        f.write("\n".join(svc))
    with open(tp, "w") as f:
        f.write("\n".join(tim))
    run(["systemctl", "--user", "daemon-reload"])
    ok, msg = do_action("user", [name + ".timer"], "enable-now")
    if not ok:
        raise ValueError("creado, pero no arrancó: " + msg)
    _CACHE.clear()
    return name + ".timer"


def timer_last(unit):
    _, out, _ = run(["systemctl", "--user", "show", unit, "-p", "Result,ExecMainStatus,ActiveState,ExecMainExitTimestamp", "--no-pager"])
    kv = dict(l.split("=", 1) for l in out.splitlines() if "=" in l)
    return {"service": unit, "result": kv.get("Result"), "status": kv.get("ExecMainStatus"), "active": kv.get("ActiveState"), "when": kv.get("ExecMainExitTimestamp")}


class H(BaseHTTPRequestHandler):
    server_version = "Bee"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text/", "application/j")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:")
        self.end_headers()
        self.wfile.write(data)

    def _host_ok(self):
        ok = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
        if self.headers.get("Host") not in ok:
            return False
        o = self.headers.get("Origin")
        return o is None or o in {f"http://{h}" for h in ok}

    def _file(self, n, ct):
        with open(os.path.join(STATIC, n), "rb") as f:
            self._send(200, f.read(), ct)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "host no permitido"})
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/":
                return self._file("index.html", "text/html")
            if u.path == "/app.js":
                return self._file("app.js", "application/javascript")
            if u.path == "/style.css":
                return self._file("style.css", "text/css")
            if u.path == "/zoo-theme.css":
                return self._file("zoo-theme.css", "text/css")
            if u.path == "/api/units":
                t = q.get("type", "service")
                if t not in TYPES:
                    raise ValueError("tipo inválido")
                return self._send(200, list_units(valid_scope(q.get("scope")), t))
            if u.path == "/api/summary":
                return self._send(200, summary())
            if u.path == "/api/unit":
                return self._send(200, detail(valid_scope(q.get("scope")), valid_unit(q.get("name"))))
            if u.path == "/api/logs":
                return self._send(200, {"text": logs(valid_scope(q.get("scope")), valid_unit(q.get("name")), q.get("n", 200), q.get("grep", ""), q.get("prio", ""))})
            if u.path == "/api/deps":
                return self._send(200, {"text": deps(valid_scope(q.get("scope")), valid_unit(q.get("name")), q.get("reverse") == "1")})
            if u.path == "/api/login":
                return self._send(200, login_list())
            if u.path == "/api/cron":
                return self._send(200, cron_info())
            if u.path == "/api/cron-preview":
                e = q.get("expr", "")
                return self._send(200, {"human": cron_human(e), "next": cron_next(e, 4) if e.strip() != "@reboot" else []})
            if u.path == "/api/calendar":
                return self._send(200, calendar_preview(q.get("expr")))
            if u.path == "/api/boot":
                return self._send(200, boot_analysis(valid_scope(q.get("scope"))))
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        self._send(404, {"error": "no encontrado"})

    def do_POST(self):
        if not self._host_ok() or self.headers.get("X-Bee") != "1":
            return self._send(403, {"error": "no permitido"})
        u = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            b = json.loads(self.rfile.read(min(n, 65536)) or b"{}")
        except Exception:
            return self._send(400, {"error": "JSON inválido"})
        if u.path == "/api/terminal":
            try:
                return self._send(200, open_terminal(b.get("cmd"), "Bee"))
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        try:
            if u.path == "/api/action":
                names = b.get("names") or ([b["name"]] if b.get("name") else [])
                ok, msg = do_action(valid_scope(b.get("scope")), names, b.get("action"), bool(b.get("force")))
                return self._send(200 if ok else 500, {"ok": ok, "output": msg, "error": None if ok else (msg or "falló")})
            if u.path == "/api/reload":
                ok, msg = daemon_reload(valid_scope(b.get("scope")))
                return self._send(200 if ok else 500, {"ok": ok, "error": None if ok else (msg or "falló")})
            if u.path == "/api/create":
                return self._send(200, {"ok": True, "name": create_unit(b)})
            if u.path == "/api/update":
                update_unit(b)
                return self._send(200, {"ok": True})
            if u.path == "/api/delete":
                delete_unit(valid_unit(b.get("name")))
                return self._send(200, {"ok": True})
            if u.path == "/api/login/toggle":
                login_toggle(b.get("file"), bool(b.get("enable")))
                _SUM["v"] = None
                return self._send(200, {"ok": True})
            if u.path == "/api/login/create":
                _SUM["v"] = None
                return self._send(200, {"ok": True, "file": login_create(b)})
            if u.path == "/api/login/delete":
                login_delete(b.get("file"))
                _SUM["v"] = None
                return self._send(200, {"ok": True})
            if u.path == "/api/cron/op":
                cron_op(b)
                _SUM["v"] = None
                return self._send(200, {"ok": True})
            if u.path == "/api/cron/run":
                return self._send(200, cron_run(b))
            if u.path == "/api/timer/create":
                _SUM["v"] = None
                return self._send(200, {"ok": True, "name": create_timer(b)})
        except ProtectedError as e:
            return self._send(409, {"error": "unidad protegida: " + ", ".join(e.names), "protected": e.names})
        except ValueError as e:
            return self._send(*fail(e))
        self._send(404, {"error": "no encontrado"})


if __name__ == "__main__":
    for sc_ in ("user", "system"):
        threading.Thread(target=_compute, args=(sc_, "service"), daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), H)
    print(f"Bee en http://localhost:{PORT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
