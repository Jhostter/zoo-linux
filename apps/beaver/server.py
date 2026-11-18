#!/usr/bin/env python3
"""Beaver: gestor de memoria y swap de ZOO Linux. Mide RAM/swap/presión (PSI), atribuye el consumo por
aplicación, permite cerrar procesos propios, limitar servicios y ajustar swappiness, caché, zram y swap.
Solo biblioteca estándar. Las acciones de sistema usan scripts fijos vía pkexec con argumentos validados."""
import json, os, pwd, re, shlex, signal, subprocess, threading, time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error, urllib.request
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = int(os.environ.get("BEAVER_PORT", "4499"))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
UID = os.getuid()
ENV = {**os.environ, "LC_ALL": "C.UTF-8", "SYSTEMD_COLORS": "0"}
SYSCTL_FILE = "/etc/sysctl.d/99-beaver.conf"
ZRAM_UNIT = "/etc/systemd/system/beaver-zram.service"
OOMD_DROPIN = "/etc/systemd/system/user@.service.d/90-beaver-oomd.conf"
PROTECTED_PREFIX = ("systemd", "(sd-pam)", "dbus", "pipewire", "wireplumber", "Xwayland", "cosmic-", "xdg-", "gnome-keyring",
                    "gcr-", "polkit", "ssh-agent", "gvfs", "at-spi", "kitty-session")  # sesión de escritorio: pide confirmación escrita
NAME_RE = re.compile(r"^[A-Za-z0-9_:@][A-Za-z0-9:_.@\\\-]{0,199}\.service$")

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


def rd(path, default=""):
    try:
        with open(path) as f:
            return f.read()
    except OSError:
        return default


def kvfile(path):
    d = {}
    for l in rd(path).splitlines():
        if ":" in l:
            k, v = l.split(":", 1)
            try:
                d[k.strip()] = int(v.split()[0])
            except (ValueError, IndexError):
                pass
    return d


# ---------- métricas del sistema ----------
def meminfo():
    m = kvfile("/proc/meminfo")
    total = m["MemTotal"]
    anon, shmem = m.get("AnonPages", 0), m.get("Shmem", 0)
    cache = max(0, m.get("Cached", 0) - shmem) + m.get("Buffers", 0) + m.get("SReclaimable", 0)
    kernel = m.get("SUnreclaim", 0) + m.get("KernelStack", 0) + m.get("PageTables", 0)
    free = m.get("MemFree", 0)
    other = max(0, total - anon - shmem - cache - kernel - free)
    return {"total": total, "available": m.get("MemAvailable", 0), "free": free, "anon": anon, "shmem": shmem, "cache": cache,
            "kernel": kernel, "other": other, "swap_total": m.get("SwapTotal", 0), "swap_free": m.get("SwapFree", 0),
            "swap_cached": m.get("SwapCached", 0), "dirty": m.get("Dirty", 0)}


def vmstat():
    d = {}
    for l in rd("/proc/vmstat").splitlines():
        p = l.split()
        if len(p) == 2 and p[0] in ("pswpin", "pswpout", "oom_kill", "pgmajfault"):
            d[p[0]] = int(p[1])
    return d


def psi():
    out = {}
    for l in rd("/proc/pressure/memory").splitlines():
        p = l.split()
        if p:
            out[p[0]] = {k: float(v) for k, v in (x.split("=") for x in p[1:] if x.split("=")[0].startswith("avg"))}
    return out


def swaps():
    res = []
    for l in rd("/proc/swaps").splitlines()[1:]:
        p = l.split()
        if len(p) >= 5:
            res.append({"name": p[0], "type": p[1], "size": int(p[2]), "used": int(p[3]), "prio": int(p[4])})
    return res


def zram():
    res = []
    for d in sorted(os.listdir("/sys/block")) if os.path.isdir("/sys/block") else []:
        if not d.startswith("zram"):
            continue
        base = f"/sys/block/{d}/"
        size = int(rd(base + "disksize", "0").strip() or 0)
        algo = rd(base + "comp_algorithm").strip()
        cur = re.search(r"\[(\S+)\]", algo)
        mm = rd(base + "mm_stat").split()
        info = {"name": d, "disksize": size, "algo": cur[1] if cur else algo, "algos": re.sub(r"[\[\]]", "", algo).split()}
        if len(mm) >= 3:
            info.update(orig=int(mm[0]), compr=int(mm[1]), mem_used=int(mm[2]))
        res.append(info)
    return res


def sysctls():
    def g(n, default=None):
        try:
            return int(rd(f"/proc/sys/vm/{n}").strip())
        except ValueError:
            return default
    return {"swappiness": g("swappiness"), "vfs_cache_pressure": g("vfs_cache_pressure"), "overcommit_memory": g("overcommit_memory"),
            "persist_sysctl": os.path.exists(SYSCTL_FILE), "persist_zram": os.path.exists(ZRAM_UNIT)}


HIST, _LAST_V, _LAST_REQ, _LOCK = deque(maxlen=240), {"t": 0, "v": None}, [0.0], threading.Lock()


def sample():
    with _LOCK:
        now = time.time()
        m, v = meminfo(), vmstat()
        rate_in = rate_out = 0.0
        if _LAST_V["v"] and now > _LAST_V["t"]:
            dt = now - _LAST_V["t"]
            rate_in = max(0, v.get("pswpin", 0) - _LAST_V["v"].get("pswpin", 0)) / dt
            rate_out = max(0, v.get("pswpout", 0) - _LAST_V["v"].get("pswpout", 0)) / dt
        _LAST_V.update(t=now, v=v)
        p = psi()
        HIST.append({"t": now, "used_pct": round(100 * (m["total"] - m["available"]) / m["total"], 1), "avail": m["available"],
                     "swap_used": m["swap_total"] - m["swap_free"], "swin": round(rate_in, 1), "swout": round(rate_out, 1),
                     "psi": p.get("some", {}).get("avg10", 0.0)})


def sampler():
    while True:
        if time.time() - _LAST_REQ[0] < 120:
            try:
                sample()
            except Exception:
                pass
        time.sleep(3)


# ---------- procesos y aplicaciones ----------
KNOWN = {"chrome": "Google Chrome", "msedge": "Microsoft Edge", "firefox": "Firefox", "firefox-bin": "Firefox", "code": "VS Code",
         "claude": "Claude", "kitty": "Kitty", "thunderbird": "Thunderbird", "slack": "Slack", "discord": "Discord", "spotify": "Spotify"}
INTERP = {"python", "python3", "node", "java", "ruby", "perl", "bash", "sh", "zsh", "deno", "bun"}


def clk_start(pid):
    try:
        s = rd(f"/proc/{pid}/stat")
        return int(s[s.rindex(")") + 2:].split()[19])
    except (ValueError, IndexError):
        return 0


def label_of(comm, exe, cmd):
    base = os.path.basename(exe) if exe else comm
    for k in (base, comm):
        if k in KNOWN:
            return KNOWN[k]
    if re.match(r"^(python\d?(\.\d+)?|node|java|deno|bun)$", base) and len(cmd) > 1:
        script = next((a for a in cmd[1:] if not a.startswith("-")), "")
        if script:
            parts = script.rstrip("/").split("/")
            return f"{base} · {parts[-2] if len(parts) > 1 and parts[-1] in ('server.py', 'server.mjs', 'main.py', 'index.js', 'app.py') else parts[-1]}"
    return base or comm


_PC = {"t": 0, "v": None}


def processes():
    if _PC["v"] and time.time() - _PC["t"] < 2:
        return _PC["v"]
    res = []
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        pid = int(d)
        try:
            st = {}
            for l in rd(f"/proc/{pid}/status").splitlines():
                k, _, v = l.partition(":")
                if k in ("Name", "Uid", "VmRSS", "RssAnon", "RssFile", "RssShmem", "VmSwap", "Threads"):
                    st[k] = v.strip()
            if "VmRSS" not in st:
                continue  # hilos del kernel
            kb = lambda k: int(st.get(k, "0 kB").split()[0])
            try:
                exe = os.readlink(f"/proc/{pid}/exe")
            except OSError:
                exe = ""
            cmd = rd(f"/proc/{pid}/cmdline").split("\0")[:8]
            res.append({"pid": pid, "name": st["Name"], "uid": int(st["Uid"].split()[0]), "threads": int(st.get("Threads", "1") or 1), "rss": kb("VmRSS"), "anon": kb("RssAnon"),
                        "file": kb("RssFile"), "shmem": kb("RssShmem"), "swap": kb("VmSwap"), "app": label_of(st["Name"], exe, cmd),
                        "cmd": " ".join(cmd).strip()[:160], "start": clk_start(pid)})
        except (OSError, ValueError, KeyError):
            continue
    _PC.update(t=time.time(), v=res)
    return res


CRITICAL = {"NetworkManager", "sshd", "Xorg", "login", "agetty", "getty", "udisksd", "upowerd", "wpa_supplicant", "gdm", "gdm3", "sddm",
            "lightdm", "accounts-daemon", "init", "cron", "chronyd", "tailscaled", "containerd", "dockerd"}


def is_protected(name):
    return name.startswith(PROTECTED_PREFIX) or name in CRITICAL or name == "kitty"


_UN = {}


def uname(uid):
    if uid not in _UN:
        try:
            _UN[uid] = pwd.getpwuid(uid).pw_name
        except KeyError:
            _UN[uid] = str(uid)
    return _UN[uid]


def proc_list(q, sort, page, per, mine):
    rows = []
    ql = (q or "").lower()
    for p in processes():
        if mine and p["uid"] != UID:
            continue
        if ql and ql not in p["name"].lower() and ql not in p["app"].lower() and ql not in p["cmd"].lower() and ql != str(p["pid"]):
            continue
        rows.append({**{k: p[k] for k in ("pid", "name", "app", "anon", "shmem", "file", "swap", "rss", "threads", "cmd", "start")},
                     "user": uname(p["uid"]), "mine": p["uid"] == UID, "mem": p["anon"] + p["shmem"], "protected": is_protected(p["name"])})
    keyf = {"mem": lambda r: -r["mem"], "swap": lambda r: -r["swap"], "rss": lambda r: -r["rss"], "pid": lambda r: r["pid"], "name": lambda r: r["name"].lower(), "threads": lambda r: -r["threads"]}.get(sort, lambda r: -r["mem"])
    rows.sort(key=keyf)
    per = max(10, min(int(per or 50), 200)); page = max(0, int(page or 0))
    return {"total": len(rows), "page": page, "per": per, "rows": rows[page * per:(page + 1) * per], "me": uname(UID)}


def apps():
    groups = {}
    for p in processes():
        g = groups.setdefault((p["app"], p["uid"]), {"app": p["app"], "mine": p["uid"] == UID, "uid": p["uid"], "procs": [], "anon": 0, "shmem": 0, "file": 0, "swap": 0})
        g["procs"].append({k: p[k] for k in ("pid", "name", "anon", "shmem", "file", "swap", "cmd", "start")})
        for k in ("anon", "shmem", "file", "swap"):
            g[k] += p[k]
    out = []
    for g in groups.values():
        g["footprint"] = g["anon"] + g["shmem"] + g["swap"]
        g["count"] = len(g["procs"])
        g["protected"] = any(is_protected(x["name"]) for x in g["procs"])
        g["procs"].sort(key=lambda x: -(x["anon"] + x["shmem"] + x["swap"]))
        g["procs"] = g["procs"][:60]
        out.append(g)
    out.sort(key=lambda g: -g["footprint"])
    return out[:80]


def kill_pids(items, sig, force, elevate=False):
    if sig not in ("TERM", "KILL"):
        raise ValueError("señal inválida")
    if not isinstance(items, list) or not items or len(items) > 200:
        raise ValueError("selección inválida")
    by = {p["pid"]: p for p in processes()}
    res, need_force, other = [], [], []
    for it in items:
        pid, start = it.get("pid"), it.get("start")
        p = by.get(pid)
        if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 1 or pid == os.getpid() or pid == os.getppid():
            res.append({"pid": pid, "ok": False, "error": "no permitido"}); continue
        if not p or p["start"] != start:
            res.append({"pid": pid, "ok": False, "error": "el proceso ya no existe"}); continue
        if p["uid"] != UID and not elevate:
            res.append({"pid": pid, "ok": False, "error": "no es tuyo (hace falta permiso de administrador)"}); continue
        if is_protected(p["name"]) and not force:
            need_force.append(p["name"]); continue
        if p["uid"] == UID:
            try:
                os.kill(pid, signal.SIGTERM if sig == "TERM" else signal.SIGKILL)
                res.append({"pid": pid, "ok": True})
            except OSError as e:
                res.append({"pid": pid, "ok": False, "error": str(e)})
        else:
            other.append(p)
    if need_force and not any(r["ok"] for r in res) and not other:
        raise ProtectedError(sorted(set(need_force)))
    if other:
        kcmd = ["pkexec", "kill", "-s", sig, *[str(p["pid"]) for p in other]]
        rc, out, err = run(kcmd, timeout=180)
        if no_agent(rc, err):
            raise NeedTerminal(sudo_line(kcmd))
        for p in other:
            res.append({"pid": p["pid"], "ok": rc == 0, "error": None if rc == 0 else (err or out or "falló").strip()[:160], "elevated": True})
    _PC["v"] = None
    return res


class ProtectedError(Exception):
    def __init__(self, names):
        self.names = names


# ---------- servicios (cgroups) ----------
_SC = {}


def services(scope):
    c = _SC.get(scope)
    if c and time.time() - c[0] < 3:
        return c[1]
    base = ["systemctl"] + (["--user"] if scope == "user" else [])
    _, out, _ = run(base + ["list-units", "--type=service", "--state=active", "--no-legend", "--plain", "--no-pager"])
    names = [l.split()[0] for l in out.splitlines() if l.split() and not l.startswith("-")]
    res = []
    if names:
        _, txt, _ = run(base + ["show", *names, "-p", "Id,Description,ControlGroup,MemoryHigh,MemoryMax", "--no-pager"], timeout=40)
        for block in txt.strip().split("\n\n"):
            kv = dict(l.split("=", 1) for l in block.splitlines() if "=" in l)
            cg = kv.get("ControlGroup")
            if not cg or not kv.get("Id") or re.match(r"^user(@|-)", kv["Id"]):
                continue  # user@N.service agrega toda la sesión: ya se ve por aplicaciones
            root = "/sys/fs/cgroup" + cg
            anon = swap = 0
            for l in rd(root + "/memory.stat").splitlines():
                if l.startswith("anon "):
                    anon = int(l.split()[1]) // 1024
                elif l.startswith("shmem "):
                    anon += int(l.split()[1]) // 1024
            try:
                swap = int(rd(root + "/memory.swap.current", "0").strip() or 0) // 1024
            except ValueError:
                pass
            lim = lambda v: None if v in ("infinity", "", None) else int(v) // 1024
            res.append({"name": kv["Id"], "desc": kv.get("Description", ""), "mem": anon, "swap": swap,
                        "high": lim(kv.get("MemoryHigh")), "max": lim(kv.get("MemoryMax"))})
    res.sort(key=lambda s: -(s["mem"] + s["swap"]))
    _SC[scope] = (time.time(), res[:100])
    return _SC[scope][1]


def set_limit(name, kind, mb):
    if not NAME_RE.match(name or ""):
        raise ValueError("servicio inválido")
    if name in ("beaver.service",):
        raise ValueError("no se puede limitar a Beaver desde su propia interfaz")
    if kind not in ("high", "max"):
        raise ValueError("tipo de límite inválido")
    prop = "MemoryHigh" if kind == "high" else "MemoryMax"
    if mb is None:
        val = "infinity"
    elif isinstance(mb, int) and not isinstance(mb, bool) and 64 <= mb <= 131072:
        val = f"{mb}M"
    else:
        raise ValueError("límite inválido (64 MB – 128 GB)")
    rc, out, err = run(["systemctl", "--user", "set-property", "--runtime", name, f"{prop}={val}"])
    _SC.clear()
    if rc:
        raise ValueError((err or out or "falló").strip()[:200])
    return f"{prop}={val}"


# ---------- acciones de sistema (scripts fijos, argumentos validados, pkexec) ----------
SCRIPTS = {
    "swappiness": 'sysctl -w vm.swappiness="$1"',
    "swappiness-persist": 'sysctl -w vm.swappiness="$1" && printf "vm.swappiness=%s\\n" "$1" > ' + SYSCTL_FILE,
    "cachepressure": 'sysctl -w vm.vfs_cache_pressure="$1"',
    "cachepressure-persist": 'sysctl -w vm.vfs_cache_pressure="$1" && printf "vm.vfs_cache_pressure=%s\\n" "$1" >> ' + SYSCTL_FILE,
    "persist-clear": "rm -f " + SYSCTL_FILE + ' && echo "Ajustes persistentes eliminados (se aplican al reiniciar)"',
    "dropcaches": 'sync; echo "$1" > /proc/sys/vm/drop_caches && echo "Caché liberada (nivel $1)"',
    "swapcycle": 'set -e; while [ $# -gt 1 ]; do dev="$1"; prio="$2"; shift 2; echo "swapoff $dev"; swapoff "$dev"; '
                 'if [ "$prio" -ge 0 ]; then swapon -p "$prio" "$dev"; else swapon "$dev"; fi; echo "swapon $dev"; done',
    "zram-on": 'set -e; size="$1"; algo="$2"; prio="$3"; modprobe zram 2>/dev/null || true; '
               '[ -e /sys/block/zram0 ] || { echo "No existe /sys/block/zram0"; exit 1; }; '
               'if [ "$(cat /sys/block/zram0/disksize)" != "0" ]; then swapoff /dev/zram0 2>/dev/null || true; echo 1 > /sys/block/zram0/reset; fi; '
               'echo "$algo" > /sys/block/zram0/comp_algorithm; echo "$size" > /sys/block/zram0/disksize; mkswap /dev/zram0 > /dev/null; '
               'swapon -p "$prio" /dev/zram0; echo "zram activo ($algo, prioridad $prio)"',
    "zram-persist": 'printf "%s" "$1" > ' + ZRAM_UNIT + ' && systemctl daemon-reload && systemctl enable beaver-zram.service && echo "zram se activará al arrancar"',
    "oomd-install": 'DEBIAN_FRONTEND=noninteractive apt-get install -y -o Dpkg::Options::=--force-confold systemd-oomd && systemctl enable --now systemd-oomd && echo "systemd-oomd instalado y activo"',
    "oomd-enable": 'systemctl enable --now systemd-oomd && echo "systemd-oomd activo"',
    "oomd-disable": 'systemctl disable --now systemd-oomd && echo "systemd-oomd desactivado"',
    "oomd-protect": 'mkdir -p /etc/systemd/system/user@.service.d && printf "%s" "$1" > ' + OOMD_DROPIN + ' && systemctl daemon-reload && '
                    '{ systemctl try-restart systemd-oomd || true; } && echo "Protección activada para tu sesión (puede requerir cerrar sesión y volver a entrar)"',
    "oomd-unprotect": 'rm -f ' + OOMD_DROPIN + ' && systemctl daemon-reload && { systemctl try-restart systemd-oomd || true; } && echo "Protección de sesión desactivada"',
    "zram-off": 'swapoff /dev/zram0 2>/dev/null || true; [ -e /sys/block/zram0/reset ] && echo 1 > /sys/block/zram0/reset; '
                'systemctl disable beaver-zram.service 2>/dev/null || true; rm -f ' + ZRAM_UNIT + '; systemctl daemon-reload; echo "zram desactivado"',
}


def unit_escape(cmd):
    """systemd expande $VAR y %x dentro de ExecStart: se escapan como $$ y %%."""
    return cmd.replace("$", "$$").replace("%", "%%")


def zram_unit_text(size, algo, prio):
    on = SCRIPTS["zram-on"].replace('"$1"', f'"{size}"').replace('"$2"', f'"{algo}"').replace('"$3"', f'"{prio}"')
    on = on.replace('size="$1"; algo="$2"; prio="$3"; ', "")
    return ("[Unit]\nDescription=Beaver zram swap (ZOO Linux)\nAfter=local-fs.target\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\n"
            f"ExecStart=/bin/sh -c '{unit_escape(on)}'\nExecStop=/bin/sh -c 'swapoff /dev/zram0 || true; echo 1 > /sys/block/zram0/reset'\n\n[Install]\nWantedBy=multi-user.target\n")


def oomd_dropin_text(limit, swap):
    t = "[Service]\nManagedOOMMemoryPressure=kill\nManagedOOMMemoryPressureLimit=%d%%\n" % limit
    return t + ("ManagedOOMSwap=kill\n" if swap else "")


def run_root(key, *args, timeout=180):
    rcmd = ["pkexec", "sh", "-c", SCRIPTS[key], "sh", *map(str, args)]
    rc, out, err = run(rcmd, timeout=timeout)
    if no_agent(rc, err):
        raise NeedTerminal(sudo_line(rcmd))
    return rc == 0, (out + err).strip()[:1500]


_ROOT_LOCK = threading.Lock()


def root_action(b):
    a = b.get("action")
    m = meminfo()
    if not _ROOT_LOCK.acquire(blocking=False):
        raise ValueError("ya hay una acción de sistema en curso")
    try:
        if a in ("swappiness", "cachepressure"):
            v = b.get("value")
            lo, hi = (0, 200) if a == "swappiness" else (10, 500)
            if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
                raise ValueError(f"valor fuera de rango ({lo}–{hi})")
            key = a + ("-persist" if b.get("persist") else "")
            if a == "cachepressure" and b.get("persist") and not os.path.exists(SYSCTL_FILE):
                key = "cachepressure-persist"
            ok, out = run_root(key, v)
        elif a == "persist-clear":
            ok, out = run_root("persist-clear")
        elif a == "dropcaches":
            lvl = b.get("level")
            if lvl not in (1, 3):
                raise ValueError("nivel inválido")
            ok, out = run_root("dropcaches", lvl)
        elif a == "swapcycle":
            current = {s["name"]: s for s in swaps()}
            chosen = [current[n] for n in (b.get("devices") or []) if n in current]
            if not chosen:
                raise ValueError("ningún dispositivo de swap válido")
            used = sum(s["used"] for s in chosen)
            if m["available"] < used * 1.15 + 800 * 1024:
                raise ValueError(f"No hay RAM suficiente para vaciar el swap: harían falta {round(used * 1.15 / 1024 + 800)} MB libres y hay {round(m['available'] / 1024)} MB. Cierra aplicaciones primero.")
            args = []
            for s in chosen:
                args += [s["name"], s["prio"]]
            ok, out = run_root("swapcycle", *args, timeout=600)
        elif a == "zram-on":
            gb = b.get("size_gb")
            algos = zram()[0]["algos"] if zram() else ["zstd", "lzo"]
            algo = b.get("algo", "zstd")
            if not isinstance(gb, int) or isinstance(gb, bool) or not 1 <= gb <= 32 or gb * 1048576 > m["total"] * 0.75:
                raise ValueError("tamaño de zram inválido (máximo el 75 % de tu RAM)")
            if algo not in algos or not re.fullmatch(r"[a-z0-9]+", algo):
                raise ValueError("algoritmo no soportado")
            size, prio = gb * 1024 ** 3, 100
            ok, out = run_root("zram-on", size, algo, prio)
            if ok and b.get("persist"):
                ok2, out2 = run_root("zram-persist", zram_unit_text(size, algo, prio))
                out += "\n" + out2
                ok = ok and ok2
        elif a == "zram-off":
            ok, out = run_root("zram-off")
        elif a in ("oomd-enable", "oomd-disable", "oomd-unprotect"):
            if a == "oomd-enable" and not oomd_info()["installed"]:
                raise ValueError("systemd-oomd no está instalado")
            ok, out = run_root(a)
        elif a == "oomd-install":
            for nm in ("apt", "apt-get", "dpkg", "aptitude"):
                if subprocess.run(["pgrep", "-x", nm], capture_output=True).stdout.strip():
                    raise ValueError("apt está en uso por otro proceso; espera a que termine")
            if oomd_info()["installed"]:
                raise ValueError("systemd-oomd ya está instalado")
            ok, out = run_root("oomd-install", timeout=600)
        elif a == "oomd-protect":
            lim, swp = b.get("limit"), bool(b.get("swap"))
            if lim not in (40, 50, 60, 70, 80):
                raise ValueError("límite inválido")
            if not oomd_info()["installed"]:
                raise ValueError("instala systemd-oomd primero")
            ok, out = run_root("oomd-protect", oomd_dropin_text(lim, swp))
        else:
            raise ValueError("acción desconocida")
        return ok, out
    finally:
        _ROOT_LOCK.release()


# ---------- consejos ----------
def tips(m, sw, zr, sc, groups):
    t = []
    rec = oomd_recent()
    if rec:
        e = rec[0]
        t.append({"level": "warn", "text": f"systemd-oomd ha cerrado {len(rec)} aplicación{'es' if len(rec) > 1 else ''} en las últimas 24 h por falta de memoria (la última: {e['name']}, {e['t'][11:16]}). Conviene revisar qué consume tanto en «Aplicaciones»."})
    gb = lambda kb: f"{kb / 1048576:.1f} GB"
    avail_pct = 100 * m["available"] / m["total"]
    su = (m["swap_total"] - m["swap_free"])
    if avail_pct < 10:
        t.append({"level": "bad", "text": f"Queda solo un {avail_pct:.0f} % de RAM disponible ({gb(m['available'])}). Conviene cerrar aplicaciones pesadas."})
    if m["swap_total"] and su / m["swap_total"] > 0.5:
        t.append({"level": "bad", "text": f"El swap está al {100 * su / m['swap_total']:.0f} %: algo está presionando la memoria. Si se llena, el sistema empieza a matar procesos."})
    if not any(s["name"].startswith("/dev/zram") for s in sw):
        t.append({"level": "info", "text": "zram no está activo. Comprime la memoria en RAM antes de escribir al disco: es más rápido que el swap en archivo y rinde como tener más RAM.", "action": "zram"})
    if sc["swappiness"] is not None and sc["swappiness"] > 100:
        t.append({"level": "warn", "text": f"swappiness es {sc['swappiness']}: el kernel usa mucho el swap aunque haya RAM libre."})
    top = [g for g in groups if g["mine"]][:1]
    if top and top[0]["footprint"] > m["total"] * 0.2:
        g = top[0]
        t.append({"level": "warn", "text": f"{g['app']} usa {gb(g['footprint'])} ({100 * g['footprint'] / m['total']:.0f} % de tu RAM) en {g['count']} proceso{'s' if g['count'] > 1 else ''}."})
    pr = psi()
    if pr.get("some", {}).get("avg60", 0) > 10:
        t.append({"level": "bad", "text": f"Presión de memoria alta ({pr['some']['avg60']:.0f} %): los procesos esperan a que haya memoria libre."})
    if not os.path.exists("/usr/lib/systemd/systemd-oomd") and not os.path.exists("/lib/systemd/systemd-oomd"):
        t.append({"level": "info", "text": "systemd-oomd no está instalado: si la memoria se agota, solo actuará el OOM killer del kernel (lento y poco selectivo). Se puede instalar y activar desde aquí.", "action": "oomd"})
    if not t:
        t.append({"level": "ok", "text": "La memoria está sana: hay RAM disponible, el swap casi no se usa y no hay presión."})
    return t


def oom_events():
    _, out, _ = run(["journalctl", "-k", "--since", "-30 days", "--no-pager", "-o", "short-iso", "--grep", "Out of memory|oom-kill:|Killed process"], timeout=30)
    return [l[:220] for l in out.splitlines() if "-- No entries" not in l][-20:]


OOMD_RX = re.compile(r"^(\S+)\s+\S+\s+systemd-oomd\[\d+\]: Killed (\S+) due to (.*)$")
PRESS_RX = re.compile(r"memory pressure for (\S+) being ([\d.]+)% > ([\d.]+)% for > (\S+)")
SWAP_RX = re.compile(r"memory used \((\d+)\) / total \((\d+)\) and swap used \((\d+)\) / total \((\d+)\) being more than ([\d.]+)%")


def friendly_cgroup(cg):
    last = cg.rstrip("/").split("/")[-1]
    name = re.sub(r"\.(scope|service|slice)$", "", last)
    name = re.sub(r"^app-", "", name)
    name = re.sub(r"\\x([0-9a-f]{2})", lambda m: chr(int(m[1], 16)), name)
    name = re.sub(r"-\d+$", "", name)  # sufijo de pid de los scopes transitorios
    return name or last


def parse_oomd(text):
    """Cierres hechos por systemd-oomd (líneas «Killed <cgroup> due to …» del diario)."""
    ev = []
    for l in text.splitlines():
        m = OOMD_RX.match(l)
        if not m:
            continue
        t, cg, why = m.groups()
        e = {"t": t, "cgroup": cg, "name": friendly_cgroup(cg), "kind": "otro", "detail": why[:160]}
        p, sw = PRESS_RX.search(why), SWAP_RX.search(why)
        if p:
            e.update(kind="presión", detail=f"presión {p[2]} % (límite {p[3]} % durante {p[4]})")
        elif sw:
            e.update(kind="swap", detail=f"memoria y swap llenos (más del {sw[5]} %)")
        ev.append(e)
    return ev


_OD = {"t": 0, "v": []}


def oomd_events(force=False):
    if not force and time.time() - _OD["t"] < 60:
        return _OD["v"]
    _, out, _ = run(["journalctl", "-u", "systemd-oomd.service", "--since", "-30 days", "--no-pager", "-o", "short-iso", "--grep", "Killed /.* due to memory"], timeout=20)  # -u: sin él recorre TODO el diario (40 s con 1 GB)
    _OD.update(t=time.time(), v=sorted(parse_oomd(out), key=lambda e: e["t"], reverse=True)[:50])
    return _OD["v"]


def oomd_recent(hours=24):
    cut = time.time() - hours * 3600
    out = []
    for e in oomd_events():
        try:
            ts = time.mktime(time.strptime(e["t"][:19], "%Y-%m-%dT%H:%M:%S"))
        except ValueError:
            continue
        if ts >= cut:
            out.append(e)
    return out


def limit_pct(v):
    """systemd devuelve el umbral como fracción de 2^32-1 (p. ej. 2576980377 = 60 %)."""
    v = (v or "").strip()
    if v.isdigit() and int(v) > 100:
        return f"{round(int(v) / 4294967295 * 100)} %"
    return v if v and v != "0" else ""


def oomd_info():
    def sh(*a):
        return run(list(a))[1].strip()
    installed = os.path.exists("/usr/lib/systemd/systemd-oomd") or os.path.exists("/lib/systemd/systemd-oomd")
    show = {}
    for l in sh("systemctl", "show", f"user@{UID}.service", "-p", "ManagedOOMMemoryPressure", "-p", "ManagedOOMMemoryPressureLimit", "-p", "ManagedOOMSwap", "--no-pager").splitlines():
        k, _, v = l.partition("=")
        show[k] = v
    return {"installed": installed, "enabled": sh("systemctl", "is-enabled", "systemd-oomd") or "not-found", "active": sh("systemctl", "is-active", "systemd-oomd") or "inactive",
            "pressure": show.get("ManagedOOMMemoryPressure", "auto"), "limit": limit_pct(show.get("ManagedOOMMemoryPressureLimit", "")), "swap": show.get("ManagedOOMSwap", "auto"),
            "dropin": os.path.exists(OOMD_DROPIN), "candidate": run(["apt-cache", "policy", "systemd-oomd"])[1].split("Candidate:")[-1].split("\n")[0].strip()[:40]}


def overview():
    _LAST_REQ[0] = time.time()
    if not HIST or time.time() - HIST[-1]["t"] > 4:
        sample()
    m, sw, zr, sc, v = meminfo(), swaps(), zram(), sysctls(), vmstat()
    oomd = run(["systemctl", "is-active", "systemd-oomd"])[1].strip()
    rec = oomd_recent()
    return {"oomd_kills_24h": len(rec), "oomd_last": rec[0] if rec else None, "mem": m, "swaps": sw, "zram": zr, "sysctl": sc, "psi": psi(), "oom_kills": v.get("oom_kill", 0), "oomd": oomd, "history": list(HIST),
            "tips": tips(m, sw, zr, sc, apps()), "ncpu": os.cpu_count(), "uptime": int(float(rd("/proc/uptime", "0").split()[0]))}


class H(BaseHTTPRequestHandler):
    server_version = "Beaver"

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
        _LAST_REQ[0] = time.time()
        try:
            if u.path == "/":
                return self._file("index.html", "text/html")
            if u.path == "/app.js":
                return self._file("app.js", "application/javascript")
            if u.path == "/style.css":
                return self._file("style.css", "text/css")
            if u.path == "/zoo-theme.css":
                return self._file("zoo-theme.css", "text/css")
            if u.path == "/api/overview":
                return self._send(200, overview())
            if u.path == "/api/apps":
                return self._send(200, {"apps": apps(), "total": meminfo()["total"], "me": UID})
            if u.path == "/api/services":
                if q.get("scope") not in ("user", "system"):
                    raise ValueError("ámbito inválido")
                return self._send(200, services(q["scope"]))
            if u.path == "/api/procs":
                return self._send(200, proc_list(q.get("q"), q.get("sort", "mem"), q.get("page", 0), q.get("per", 50), q.get("mine") == "1"))
            if u.path == "/api/oomd":
                return self._send(200, oomd_info())
            if u.path == "/api/oom":
                return self._send(200, {"events": oom_events(), "oomd": oomd_events(True)})
        except ValueError as e:
            return self._send(*fail(e))
        self._send(404, {"error": "no encontrado"})

    def do_POST(self):
        if not self._host_ok() or self.headers.get("X-Beaver") != "1":
            return self._send(403, {"error": "no permitido"})
        u = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            b = json.loads(self.rfile.read(min(n, 65536)) or b"{}")
        except Exception:
            return self._send(400, {"error": "JSON inválido"})
        if u.path == "/api/terminal":
            try:
                return self._send(200, open_terminal(b.get("cmd"), "Beaver"))
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        try:
            if u.path == "/api/kill":
                return self._send(200, {"results": kill_pids(b.get("items"), b.get("signal", "TERM"), bool(b.get("force")), bool(b.get("elevate")))})
            if u.path == "/api/limit":
                return self._send(200, {"ok": True, "applied": set_limit(b.get("name"), b.get("kind"), b.get("mb"))})
            if u.path == "/api/root":
                ok, out = root_action(b)
                return self._send(200 if ok else 500, {"ok": ok, "output": out, "error": None if ok else (out or "falló")})
        except ProtectedError as e:
            return self._send(409, {"error": "procesos de la sesión de escritorio: " + ", ".join(e.names), "protected": e.names})
        except ValueError as e:
            return self._send(*fail(e))
        self._send(404, {"error": "no encontrado"})


if __name__ == "__main__":
    threading.Thread(target=sampler, daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), H)
    print(f"Beaver en http://localhost:{PORT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
