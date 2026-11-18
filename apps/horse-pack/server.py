#!/usr/bin/env python3
"""Horse Pack: gestor de paquetes nativos (apt/dpkg) con panel web local. Solo biblioteca estándar."""
import glob, json, os, re, shlex, shutil, subprocess, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error, urllib.request
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = int(os.environ.get("GESTOR_PAQUETES_PORT", "4466"))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9+.\-]{0,100}(:[a-z0-9\-]+)?$")
ACTIONS = {
    "update": ["update"],
    "install": ["install"],
    "remove": ["remove"],
    "purge": ["purge"],
    "upgrade": ["install", "--only-upgrade"],
    "upgrade-all": ["upgrade"],
    "autoremove": ["autoremove"],
    "configure-a": None,  # dpkg --configure -a
}
NEEDS_PKGS = {"install", "remove", "purge", "upgrade"}
ENV = {**os.environ, "LC_ALL": "C.UTF-8", "LANG": "C.UTF-8"}

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




def run(cmd, timeout=60):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=ENV)
    except (OSError, subprocess.TimeoutExpired):  # programa ausente (p. ej. sin apt) o demasiado lento
        return ""
    return r.stdout


_INST = {"sig": None, "data": None}
_LANG = (os.environ.get("LANG", "en")[:2] or "en")


def parse_desktop(path):
    name = lname = icon = None
    hidden = False
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            on = False
            for l in f:
                l = l.strip()
                if l.startswith("["):
                    if on:
                        break
                    on = l == "[Desktop Entry]"
                elif on:
                    if l.startswith("Name="):
                        name = l[5:]
                    elif l.startswith(f"Name[{_LANG}]="):
                        lname = l.split("=", 1)[1]
                    elif l.startswith("Icon="):
                        icon = l[5:]
                    elif l in ("NoDisplay=true", "Hidden=true", "Type=Service"):
                        hidden = True
    except OSError:
        return None
    return None if hidden or not (lname or name) else {"name": lname or name, "icon": icon}


def desktop_apps():
    """paquete -> {name, icon} para los que instalan un lanzador visible (.desktop)."""
    apps, d = {}, "/var/lib/dpkg/info"
    for fn in os.listdir(d):
        if not fn.endswith(".list"):
            continue
        try:
            with open(os.path.join(d, fn), errors="replace") as f:
                for l in f:
                    if l.startswith("/usr/share/applications/") and l.rstrip().endswith(".desktop"):
                        info = parse_desktop(l.strip())
                        if info:
                            apps[fn[:-5].split(":")[0]] = info
                            break
        except OSError:
            pass
    return apps


def auto_installed():
    """Paquetes instalados como dependencia (equivale a lo contrario de apt-mark showmanual, pero instantáneo)."""
    auto = set()
    try:
        with open("/var/lib/apt/extended_states", errors="replace") as f:
            for stanza in f.read().split("\n\n"):
                if "Auto-Installed: 1" in stanza:
                    m = re.search(r"^Package: (\S+)", stanza, re.M)
                    if m:
                        auto.add(m[1])
    except OSError:
        pass
    return auto


def installed():
    try:
        sig = os.stat("/var/lib/dpkg/status").st_mtime_ns
    except OSError:
        sig = None
    if _INST["sig"] == sig and _INST["data"] is not None:
        return _INST["data"]
    out = run(["dpkg-query", "-W", "-f",
               "${Package}\t${Version}\t${Installed-Size}\t${db:Status-Abbrev}\t${binary:Summary}\t${Section}\n"])
    auto = auto_installed()
    apps = desktop_apps()
    res = []
    for line in out.splitlines():
        p = line.split("\t")
        if len(p) == 6 and p[3].startswith("ii"):
            res.append({"name": p[0], "version": p[1], "size_kb": int(p[2] or 0), "desc": p[4],
                        "section": p[5].split("/")[-1] or "otros", "manual": p[0] not in auto,
                        "app": apps.get(p[0]), "installed": True})
    _INST.update(sig=sig, data=res)
    return res


def search(q):
    names = {p["name"] for p in installed()}
    out = run(["apt-cache", "search", "--", q])
    res = []
    for line in out.splitlines()[:300]:
        n, _, d = line.partition(" - ")
        res.append({"name": n, "desc": d, "installed": n in names})
    return res


def info(name):
    return run(["apt-cache", "show", "--", name])


_HELD = {"sig": None, "set": set()}


def apt_sig():
    sig = 0
    for pth in ("/var/lib/dpkg/status", "/var/lib/apt/lists"):
        try:
            sig = max(sig, os.stat(pth).st_mtime_ns)
        except OSError:
            pass
    return sig


_HELD_LOCK = threading.Lock()


def warm_held():
    """Recalcula los retenidos en segundo plano (la simulación puede tardar decenas de segundos en frío)."""
    if _HELD["sig"] != apt_sig() and not _HELD_LOCK.locked():
        threading.Thread(target=upgradable, daemon=True).start()


def held_back():
    """Paquetes que `apt-get upgrade` retiene (necesitan instalar o quitar otros). Simulación, sin root."""
    with _HELD_LOCK:
        return _held_back()


def _held_back():
    sig = apt_sig()
    if _HELD["sig"] != sig:
        out = run(["apt-get", "-s", "upgrade"], timeout=180)
        names, on = set(), False
        for l in out.splitlines():
            if l.startswith("The following packages have been kept back"):
                on = True
            elif on and l.startswith("  "):
                names.update(l.split())
            elif on:
                on = False
        _HELD.update(sig=sig, set=names)
    return _HELD["set"]


_UP = {"sig": None, "data": None}
_UP_LOCK = threading.Lock()


def upgradable():
    with _UP_LOCK:
        sig = apt_sig()
        if _UP["sig"] != sig or _UP["data"] is None:
            _UP.update(sig=sig, data=_upgradable())
        return _UP["data"]


def _upgradable():
    out = run(["apt", "list", "--upgradable"])
    res = []
    for line in out.splitlines():
        m = re.match(r"^(\S+?)/(\S+) (\S+) (\S+) \[upgradable from: (\S+)\]", line)
        if m:
            res.append({"name": m[1], "version": m[3], "old": m[5], "installed": True,
                        "desc": f"{m[5]} → {m[3]}"})
    held = held_back()
    for r in res:
        r["held"] = r["name"] in held or any(h.split(":")[0] == r["name"] for h in held)
    return res


def stream(cmd, log):
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=ENV)
    seen = False
    for line in p.stdout:
        seen = seen or "authentication agent" in line.lower()
        log(line)
    rc = p.wait()
    if rc == 127 and seen and cmd[:1] == ["pkexec"]:
        log("\n⚠ Tu escritorio no permite pedir la contraseña desde esta página (los servicios no tienen agente de polkit).\n"
            "Abre una terminal, ejecuta este comando y luego vuelve aquí y actualiza:\n\n    " + sudo_line(cmd) + "\n")
    return rc


HOME = os.path.expanduser("~")
DATA = os.path.join(HOME, ".local", "share", "gestor-paquetes")
UPLOADS = os.path.join(HOME, ".cache", "gestor-paquetes", "uploads")
MANIFEST = os.path.join(DATA, "manifest.json")
MAX_UPLOAD = 4 * 1024 ** 3
TAR_EXT = (".tar.gz", ".tgz", ".tar.xz", ".txz", ".tar.bz2", ".tbz2", ".tar.zst", ".tar.lz", ".tar")
APP_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._+\-]{0,80}$")


def safe_name(n):
    return re.sub(r"[^A-Za-z0-9._+\-]", "_", os.path.basename(n))[:120] or "archivo"


def kind_of(n):
    l = n.lower()
    if l.endswith(".deb"): return "deb"
    if l.endswith(".appimage"): return "appimage"
    if l.endswith(".zip"): return "zip"
    if l.endswith(TAR_EXT): return "tar"
    return None


def base_name(n):
    for e in sorted(TAR_EXT + (".zip", ".appimage", ".deb"), key=len, reverse=True):
        if n.lower().endswith(e):
            n = n[: -len(e)]
            break
    return re.sub(r"[^A-Za-z0-9._+\-]", "_", n).strip("._-") or "app"


def load_manifest():
    try:
        with open(MANIFEST) as f:
            return json.load(f)
    except Exception:
        return {}


def save_manifest(m):
    os.makedirs(DATA, exist_ok=True)
    with open(MANIFEST, "w") as f:
        json.dump(m, f, indent=1)


def find_execs(root):
    found = []
    bindir = os.path.join(root, "bin")
    cands = []
    if os.path.isdir(bindir):
        cands = [os.path.join(bindir, x) for x in sorted(os.listdir(bindir))]
    else:
        cands = [os.path.join(root, x) for x in sorted(os.listdir(root))]
    for c in cands:
        if os.path.isfile(c) and os.access(c, os.X_OK) and ".so" not in os.path.basename(c):
            found.append(c)
    return found


def extract(path, kind, dest, log):
    os.makedirs(dest)
    if kind == "tar":
        return stream(["tar", "-xf", path, "-C", dest, "--no-same-owner"], log)
    import zipfile
    root = os.path.realpath(dest)
    with zipfile.ZipFile(path) as z:
        for i in z.infolist():
            t = os.path.realpath(os.path.join(root, i.filename))
            if t != root and not t.startswith(root + os.sep):
                raise ValueError(f"ruta insegura en zip: {i.filename}")
        for i in z.infolist():
            t = z.extract(i, root)
            mode = (i.external_attr >> 16) & 0o777
            if mode and not i.is_dir():
                os.chmod(t, mode)
    return 0


def install_file(upload_id, scope, name, log):
    d = os.path.join(UPLOADS, upload_id)
    files = os.listdir(d)
    if len(files) != 1:
        raise ValueError("subida no encontrada")
    path, fname = os.path.join(d, files[0]), files[0]
    kind = kind_of(fname)
    if kind == "deb":
        log(f"Instalando {fname} con apt (resuelve dependencias)…\n")
        return stream(["pkexec", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "-y",
                       "install", path], log)
    name = name or base_name(fname)
    if not APP_NAME_RE.match(name):
        raise ValueError("nombre inválido")
    system = scope == "system"
    opt = "/opt" if system else os.path.join(HOME, ".local", "opt")
    bindir = "/usr/local/bin" if system else os.path.join(HOME, ".local", "bin")
    dest = os.path.join(opt, name)
    man = load_manifest()
    if name in man or os.path.exists(dest):
        raise ValueError(f"'{name}' ya existe; desinstálalo primero")
    stage = os.path.join(d, "stage")
    if kind == "appimage":
        os.makedirs(stage)
        root = stage
        shutil.copy(path, os.path.join(stage, fname))
        os.chmod(os.path.join(stage, fname), 0o755)
    else:
        log(f"Extrayendo {fname}…\n")
        code = extract(path, kind, stage, log)
        if code:
            return code
        ents = os.listdir(stage)
        root = os.path.join(stage, ents[0]) if len(ents) == 1 and os.path.isdir(os.path.join(stage, ents[0])) else stage
    execs = find_execs(root)
    log(f"Copiando a {dest}…\n")
    if system:
        code = stream(["pkexec", "sh", "-c", 'mkdir -p "$1" && cp -a --no-preserve=ownership "$2/." "$1/"', "sh", dest, root], log)
        if code:
            return code
    else:
        os.makedirs(opt, exist_ok=True)
        shutil.copytree(root, dest, symlinks=True)
    links = []
    os.makedirs(bindir, exist_ok=True) if not system else None
    for e in execs:
        target = os.path.join(dest, os.path.relpath(e, root))
        link = os.path.join(bindir, os.path.basename(e).replace(".AppImage", "").replace(".appimage", ""))
        if os.path.lexists(link):
            log(f"Omitido enlace existente: {link}\n")
            continue
        if system:
            if stream(["pkexec", "ln", "-s", target, link], log):
                continue
        else:
            os.symlink(target, link)
        links.append(link)
        log(f"Enlace: {link} → {target}\n")
    man[name] = {"scope": scope if system else "user", "dir": dest, "links": links, "source": fname}
    save_manifest(man)
    shutil.rmtree(d, ignore_errors=True)
    log(f"Instalado '{name}'. Ejecutables enlazados: {len(links)}\n")
    return 0


def uninstall_file(name, log):
    man = load_manifest()
    e = man.get(name)
    if not e:
        raise ValueError("no está registrado")
    system = e["scope"] == "system"
    opt = "/opt" if system else os.path.join(HOME, ".local", "opt")
    if e["dir"] != os.path.join(opt, name):
        raise ValueError("ruta del registro no válida")
    for l in e["links"]:
        if os.path.islink(l):
            log(f"Quitando {l}\n")
            if system:
                stream(["pkexec", "rm", "-f", l], log)
            else:
                os.unlink(l)
    log(f"Borrando {e['dir']}\n")
    if system:
        if stream(["pkexec", "rm", "-rf", e["dir"]], log):
            return 1
    else:
        shutil.rmtree(e["dir"], ignore_errors=True)
    del man[name]
    save_manifest(man)
    log("Desinstalado.\n")
    return 0


JOBS_DIR = os.path.join(DATA, "jobs")


def pid_alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        with open(f"/proc/{pid}/stat") as f:
            return f.read().rsplit(")", 1)[1].split()[0] != "Z"
    except Exception:
        return False


class Job:
    """Operación con salida en disco: sobrevive a recargas del navegador y reinicios del servicio."""

    def __init__(self, title, kind, jid=None, pid=None):
        self.id = jid or uuid.uuid4().hex
        self.title, self.kind, self.pid = title, kind, pid
        self.dir = os.path.join(JOBS_DIR, self.id)
        self.logf = os.path.join(self.dir, "out.log")
        self.exitf = os.path.join(self.dir, "exit")
        self.thread_alive = False

    @classmethod
    def load(cls, jid):
        if not re.fullmatch(r"[0-9a-f]{32}", jid or ""):
            return None
        try:
            with open(os.path.join(JOBS_DIR, jid, "meta.json")) as f:
                m = json.load(f)
            return cls(m["title"], m["kind"], jid, m.get("pid"))
        except Exception:
            return None

    def _meta(self):
        with open(os.path.join(self.dir, "meta.json"), "w") as f:
            json.dump({"title": self.title, "kind": self.kind, "pid": self.pid, "started": time.time()}, f)

    def log(self, text):
        with open(self.logf, "ab") as f:
            f.write(text.encode())

    def code(self):
        try:
            with open(self.exitf) as f:
                return int(f.read().strip())
        except Exception:
            return None

    def finish(self, code):
        tmp = self.exitf + ".tmp"
        with open(tmp, "w") as f:
            f.write(str(code))
        os.replace(tmp, self.exitf)

    def running(self):
        alive = self.thread_alive if self.kind == "func" else pid_alive(self.pid)
        if self.code() is not None:
            return False
        if alive:
            return True
        if self.kind == "func":
            self.log("\nOperación interrumpida (reinicio del servicio).\n")
            self.finish(-2)
        else:
            self.finish(-1)
        return False

    def read(self, start):
        done = not self.running()
        try:
            with open(self.logf, "rb") as f:
                f.seek(start)
                data = f.read(1 << 20)
        except FileNotFoundError:
            data = b""
        if not done and b"\n" in data:
            data = data[: data.rindex(b"\n") + 1]
        elif not done and len(data) < 4096:
            data = b""
        return {"text": data.decode("utf-8", "replace"), "next": start + len(data), "done": done,
                "code": self.code(), "title": self.title}

    def start_func(self, target):
        os.makedirs(self.dir, mode=0o700)
        open(self.logf, "wb").close()
        self._meta()
        self.thread_alive = True
        threading.Thread(target=self._run, args=(target,), daemon=True).start()

    def _run(self, target):
        try:
            code = target(self.log)
        except Exception as e:
            self.log(f"Error: {e}\n")
            code = -1
        self.finish(-1 if code is None else code)
        self.thread_alive = False

    def start_cmd(self, cmd):
        os.makedirs(self.dir, mode=0o700)
        with open(self.logf, "ab") as lf:
            # Si pkexec no puede pedir la contraseña (sin agente de polkit), el registro explica cómo hacerlo en una terminal.
            help_txt = ("\n⚠ Tu escritorio no permite pedir la contraseña desde esta página (los servicios no tienen agente de polkit).\n"
                        "Abre una terminal, ejecuta este comando y luego vuelve aquí y actualiza:\n\n    " + sudo_line(cmd) + "\n") if cmd[:1] == ["pkexec"] else ""
            wrapper = ('f=$1; l=$2; h=$3; shift 3; "$@"; rc=$?; '
                       'if [ "$rc" = 127 ] && [ -n "$h" ] && grep -q "authentication agent" "$l" 2>/dev/null; then printf "%s\\n" "$h"; fi; echo $rc > "$f"')
            p = subprocess.Popen(["sh", "-c", wrapper, "sh", self.exitf, self.logf, help_txt] + cmd,
                                 stdout=lf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                                 start_new_session=True, env=ENV)
        self.pid = p.pid
        self._meta()
        threading.Thread(target=p.wait, daemon=True).start()


def all_jobs():
    try:
        ids = sorted(os.listdir(JOBS_DIR), key=lambda d: os.path.getmtime(os.path.join(JOBS_DIR, d)))
    except FileNotFoundError:
        return []
    return [j for j in (Job.load(i) for i in ids) if j]


def running_job():
    for j in all_jobs():
        if j.running():
            return j
    return None


def prune_jobs(keep=20):
    for j in all_jobs()[:-keep]:
        if not j.running():
            shutil.rmtree(j.dir, ignore_errors=True)


BLOCK_NAMES = {"apt", "apt-get", "aptitude", "dpkg", "unattended-upgr", "unattended-upgrade",
               "packagekitd", "apt.systemd.daily", "pop-upgrade", "aptd"}
ME = os.environ.get("USER") or str(os.getuid())


def pk_busy():
    """¿PackageKit tiene alguna transacción en curso? Si no se puede saber, se asume que sí (lado seguro)."""
    try:
        r = subprocess.run(["busctl", "--system", "call", "org.freedesktop.PackageKit", "/org/freedesktop/PackageKit",
                            "org.freedesktop.PackageKit", "GetTransactionList"], capture_output=True, text=True, timeout=5, env=ENV)
        m = re.match(r"ao (\d+)", r.stdout.strip())
        return r.returncode != 0 or not m or int(m[1]) > 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return True


def list_blockers():
    """Procesos que suelen retener los bloqueos de apt/dpkg, marcando los que son de esta app."""
    out = run(["ps", "-eo", "pid=,ppid=,user:20=,etimes=,args="])
    procs, parent = [], {}
    for line in out.splitlines():
        p = line.split(None, 4)
        if len(p) < 5:
            continue
        pid, ppid, user, et, args = int(p[0]), int(p[1]), p[2], int(p[3]), p[4]
        parent[pid] = ppid
        toks = args.split()
        names = {os.path.basename(toks[0])}
        if os.path.basename(toks[0]).startswith("python") and len(toks) > 1:
            names.add(os.path.basename(toks[1]))
        simulation = any(t in ("-s", "--simulate", "--just-print", "--dry-run", "--no-act") for t in toks[1:6])  # las simulaciones no toman el bloqueo
        if names & BLOCK_NAMES and not simulation and not (len(toks) > 1 and toks[1] in ("list", "search", "show", "policy", "depends", "--audit")):
            procs.append({"pid": pid, "user": user, "elapsed": et, "cmd": args[:200]})
    # packagekitd es un demonio que se queda un rato vivo sin hacer nada: solo bloquea si tiene una transacción activa
    if any(p["cmd"].split()[0].endswith("packagekitd") for p in procs) and not pk_busy():
        procs = [p for p in procs if not p["cmd"].split()[0].endswith("packagekitd")]
    mine = set()
    j = running_job() if "running_job" in globals() else None
    if j and j.pid:
        for pr in procs:
            x = pr["pid"]
            for _ in range(20):
                if x == j.pid:
                    mine.add(pr["pid"])
                    break
                x = parent.get(x, 0)
                if x <= 1:
                    break
    for pr in procs:
        pr["own"] = pr["pid"] in mine
    return procs


def apt_busy():
    ext = [p for p in list_blockers() if not p["own"]]
    if ext:
        return os.path.basename(ext[0]["cmd"].split()[0]), ext[0]["pid"]
    return None


def tail_file(path, nbytes):
    try:
        with open(path, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - nbytes))
            return f.read().decode("utf-8", "replace")
    except PermissionError:
        return None
    except FileNotFoundError:
        return ""


def clean_term(text):
    i = text.rfind("Log started:")
    if i >= 0:
        text = text[i:]
    lines = [l.split("\r")[-1].rstrip() or l.split("\r")[0].rstrip() for l in text.split("\n")]
    out = []
    for l in lines:
        if l or (out and out[-1]):
            out.append(l)
    return "\n".join(out)


def proc_log(pid):
    if pid not in {p["pid"] for p in list_blockers()}:
        return {"alive": False}
    me = next(p for p in list_blockers() if p["pid"] == pid)
    rows = []
    for line in run(["ps", "-eo", "pid=,ppid=,etimes=,args="]).splitlines():
        p = line.split(None, 3)
        if len(p) == 4:
            rows.append((int(p[0]), int(p[1]), int(p[2]), p[3]))
    kids, todo = [], [pid]
    while todo:
        cur = todo.pop()
        for r in rows:
            if r[1] == cur:
                kids.append({"pid": r[0], "elapsed": r[2], "cmd": r[3][:160]})
                todo.append(r[0])
    phase = "En ejecución"
    for k in kids:
        c = k["cmd"]
        m = re.search(r"--(unpack|configure|remove|purge|triggers-only)\b", c)
        if "/apt/methods/" in c:
            phase = "Descargando paquetes"
        elif m:
            phase = {"unpack": "Desempaquetando", "configure": "Configurando", "remove": "Eliminando",
                     "purge": "Purgando", "triggers-only": "Ejecutando disparadores"}[m[1]]
            break
    term = tail_file("/var/log/apt/term.log", 65536)
    dpkg = tail_file("/var/log/dpkg.log", 6000)
    return {"alive": True, "cmd": me["cmd"], "user": me["user"], "elapsed": me["elapsed"], "phase": phase,
            "children": kids[:30],
            "term": None if term is None else clean_term(term)[-20000:],
            "dpkg": None if dpkg is None else "\n".join(dpkg.splitlines()[-25:])}


# ---------- métricas de consumo ----------
import pwd
from collections import deque

CLK = os.sysconf("SC_CLK_TCK")
PAGE = os.sysconf("SC_PAGE_SIZE")
NCPU = os.cpu_count() or 1
_M = {"t": 0.0, "cpu": None, "procs": {}, "self_usec": None, "hist": deque(maxlen=150), "last": None}
_M_LOCK = threading.Lock()
_USERS = {}


def _user(uid):
    if uid not in _USERS:
        try:
            _USERS[uid] = pwd.getpwuid(uid).pw_name
        except KeyError:
            _USERS[uid] = str(uid)
    return _USERS[uid]


def _read(path):
    with open(path) as f:
        return f.read()


def _cgroup():
    try:
        rel = _read("/proc/self/cgroup").strip().split("::", 1)[1]
        p = "/sys/fs/cgroup" + rel
        return p if os.path.isdir(p) else None
    except Exception:
        return None


def _cg_int(base, name):
    try:
        v = _read(os.path.join(base, name)).strip()
        return None if v == "max" else int(v)
    except Exception:
        return None


def metrics(sort="cpu"):
    with _M_LOCK:
        now = time.monotonic()
        if _M["last"] is None or now - _M["t"] >= 1.0:
            _M["last"] = _sample(now)
        res = dict(_M["last"])
    procs = sorted(res.pop("procs"), key=lambda p: p["mem_kb" if sort == "mem" else "cpu"], reverse=True)[:30]
    res["procs"] = procs
    res["history"] = list(_M["hist"])
    return res


def _sample(now):
    dt = now - _M["t"] if _M["t"] else 0
    first = _M["t"] == 0
    # CPU global
    f = _read("/proc/stat").splitlines()[0].split()[1:]
    vals = list(map(int, f))
    total, idle = sum(vals[:8]), vals[3] + vals[4]
    cpu = 0.0
    if _M["cpu"] and total > _M["cpu"][0]:
        cpu = 100 * (1 - (idle - _M["cpu"][1]) / (total - _M["cpu"][0]))
    _M["cpu"] = (total, idle)
    # memoria
    mi = {l.split(":")[0]: int(l.split()[1]) for l in _read("/proc/meminfo").splitlines() if ":" in l}
    mem_total, mem_avail = mi["MemTotal"], mi["MemAvailable"]
    swap_total, swap_free = mi.get("SwapTotal", 0), mi.get("SwapFree", 0)
    # procesos
    cg = _cgroup()
    mine = set()
    if cg:
        try:
            mine = {int(x) for x in _read(os.path.join(cg, "cgroup.procs")).split()}
        except Exception:
            pass
    prev, cur, plist = _M["procs"], {}, []
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        pid = int(d)
        try:
            st = _read(f"/proc/{pid}/stat")
            comm = st[st.index("(") + 1: st.rindex(")")]
            f = st[st.rindex(")") + 2:].split()
            ticks = int(f[11]) + int(f[12])
            rss = int(f[21]) * PAGE // 1024
            cur[pid] = ticks
            pct = 0.0
            if pid in prev and dt > 0:
                pct = max(0.0, (ticks - prev[pid]) / CLK / dt * 100)
            try:
                cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\0", b" ").decode("utf-8", "replace").strip()
            except OSError:
                cmd = ""
            plist.append({"pid": pid, "name": comm, "cmd": (cmd or f"[{comm}]")[:160], "user": _user(os.stat(f"/proc/{pid}").st_uid),
                          "cpu": round(pct, 1), "mem_kb": rss, "threads": int(f[17]),
                          "own": pid in mine, "apt": comm in BLOCK_NAMES or comm.startswith("unattended")})
        except (OSError, ValueError, IndexError):
            continue
    _M["procs"] = cur
    # este servicio (cgroup)
    me = None
    if cg:
        usec = _cg_int(cg, "cpu.stat") if False else None
        try:
            for l in _read(os.path.join(cg, "cpu.stat")).splitlines():
                if l.startswith("usage_usec"):
                    usec = int(l.split()[1])
        except Exception:
            pass
        self_cpu = 0.0
        if usec is not None and _M["self_usec"] is not None and dt > 0:
            self_cpu = max(0.0, (usec - _M["self_usec"]) / 1e6 / dt * 100)
        _M["self_usec"] = usec
        quota = None
        try:
            q = _read(os.path.join(cg, "cpu.max")).split()
            quota = None if q[0] == "max" else round(int(q[0]) / int(q[1]) * 100)
        except Exception:
            pass
        anon = cache = 0
        try:
            for l in _read(os.path.join(cg, "memory.stat")).splitlines():
                k, v = l.split()
                if k == "anon":
                    anon = int(v) // 1024
                elif k == "file":
                    cache = int(v) // 1024
        except Exception:
            pass
        me = {"cpu": round(self_cpu, 1), "mem_kb": anon, "cache_kb": cache,
              "mem_max_kb": (lambda v: v // 1024 if v else None)(_cg_int(cg, "memory.max")),
              "cpu_limit": quota, "pids": len(mine), "own_rss_kb": next((p["mem_kb"] for p in plist if p["pid"] == os.getpid()), 0)}
    # discos
    disks, seen = [], set()
    for mnt in ("/", "/home"):
        try:
            sv = os.statvfs(mnt)
            dev = os.stat(mnt).st_dev
            if dev in seen:
                continue
            seen.add(dev)
            tot, free = sv.f_blocks * sv.f_frsize, sv.f_bavail * sv.f_frsize
            disks.append({"mount": mnt, "total": tot, "free": free})
        except OSError:
            pass
    pt = round(100 * (mem_total - mem_avail) / mem_total, 1)
    out = {"t": time.time(), "ncpu": NCPU, "cpu": round(cpu, 1), "load": os.getloadavg(),
           "uptime": int(float(_read("/proc/uptime").split()[0])),
           "mem": {"total_kb": mem_total, "used_kb": mem_total - mem_avail, "pct": pt,
                   "swap_total_kb": swap_total, "swap_used_kb": swap_total - swap_free},
           "disks": disks, "self": me, "procs": plist}
    _M["t"] = now
    if not first:
        _M["hist"].append({"t": out["t"], "cpu": out["cpu"], "mem": pt,
                           "self_cpu": me["cpu"] if me else 0, "self_mem_mb": round(me["mem_kb"] / 1024, 1) if me else 0})
    return out


def stop_process(pid, sig):
    if sig not in ("TERM", "KILL"):
        raise ValueError("señal inválida")
    if pid not in {p["pid"] for p in list_blockers()}:
        raise ValueError("ese proceso ya no es un bloqueante conocido")
    owner = run(["ps", "-o", "user:20=", "-p", str(pid)]).strip()
    if owner == ME:
        os.kill(pid, getattr(__import__("signal"), "SIG" + sig))
        return "ok"
    kcmd = ["pkexec", "kill", "-s", sig, str(pid)]
    r = subprocess.run(kcmd, capture_output=True, text=True, timeout=120)
    if no_agent(r.returncode, r.stderr):
        raise NeedTerminal(sudo_line(kcmd))
    if r.returncode:
        raise ValueError((r.stderr or "no se pudo detener").strip()[:200])
    return "ok"


def start_job(title, func=None, cmd=None, apt=True):  # apt=False: sin comprobar bloqueos
    """Devuelve un Job, o un str con el motivo si no se pudo iniciar."""
    with JOB_LOCK:
        if running_job():
            return "Ya hay una operación en curso"
        busy = apt_busy() if apt else None
        if busy:
            return f"BLOQUEADO|Otro proceso ({busy[0]}, pid {busy[1]}) está usando apt/dpkg.|{busy[1]}"
        prune_jobs()
        j = Job(title, "cmd" if cmd else "func")
        j.start_cmd(cmd) if cmd else j.start_func(func)
        return j


JOB_LOCK = threading.Lock()


# ---------- Flatpak y Snap ----------
FP_ID_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_-]+)+$")
REMOTE_RE = re.compile(r"^[A-Za-z0-9._-]{1,60}$")
SNAP_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$")
CHAN_RE = re.compile(r"^[a-z0-9][a-z0-9./_-]{0,39}$")
_SRC = {"fp": {"t": 0, "v": None}, "fpu": {"t": 0, "v": None}, "snap": {"t": 0, "v": None}, "snapu": {"t": 0, "v": None}, "st": {"t": 0, "v": None}}


def src_clear():
    for c in _SRC.values():
        c["t"] = 0


def cached(key, ttl, fn):
    c = _SRC[key]
    if c["v"] is not None and time.time() - c["t"] < ttl:
        return c["v"]
    c["v"], c["t"] = fn(), time.time()
    return c["v"]


def run2(cmd, timeout=60):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=ENV)
        return r.returncode, r.stdout, r.stderr
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        return 124, "", str(e)


def size_kb(txt):
    """«7.2 MB» (con espacio no separable, base 1000) -> KB aproximados en base 1024."""
    m = re.match(r"^\s*([\d.,]+)\s*(bytes|B|kB|KB|MB|GB|TB)\s*$", (txt or "").replace("\xa0", " "))
    if not m:
        return 0
    n = float(m[1].replace(",", "."))
    mult = {"bytes": 1, "B": 1, "kB": 1e3, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12}[m[2]]
    return int(n * mult / 1024)


def have(cmd):
    return shutil.which(cmd) is not None


def fp_status():
    def go():
        if not have("flatpak"):
            return {"available": False}
        remotes = []
        for l in run(["flatpak", "remotes", "--columns=name,url,options"]).splitlines():
            p = l.split("\t")
            if len(p) >= 3:
                remotes.append({"name": p[0], "url": p[1], "scope": "user" if "user" in p[2].split(",") else "system"})
        return {"available": True, "version": run(["flatpak", "--version"]).strip(), "remotes": remotes}
    return cached("st", 60, lambda: {"flatpak": go(), "snap": snap_status()})["flatpak"]


def snap_status():
    if have("snap"):
        return {"available": True, "version": (run(["snap", "--version"]).splitlines() or [""])[0]}
    cand = re.search(r"Candidate:\s*(\S+)", run(["apt-cache", "policy", "snapd"]))
    return {"available": False, "candidate": cand[1] if cand and cand[1] != "(none)" else None}


def fp_installed():
    def go():
        if not have("flatpak"):
            return []
        res, cols = [], "--columns=application,name,version,branch,origin,installation,size,description,ref"
        for kind, flag in (("app", "--app"), ("runtime", "--runtime")):
            for l in run(["flatpak", "list", flag, cols], timeout=60).splitlines():
                p = l.split("\t")
                if len(p) < 9 or not FP_ID_RE.match(p[0]):
                    continue
                res.append({"src": "flatpak", "name": p[0], "title": p[1] or p[0], "version": p[2], "branch": p[3], "origin": p[4], "scope": p[5],
                            "size_kb": size_kb(p[6]), "desc": p[7] or ("Runtime de Flatpak" if kind == "runtime" else ""), "ref": p[8], "kind": kind,
                            "section": "flatpak", "manual": kind == "app", "installed": True,
                            "app": {"name": p[1] or p[0], "icon": p[0]} if kind == "app" else None})
        return res
    return cached("fp", 20, go)


def fp_search(q):
    if not have("flatpak") or not q or q.startswith("-") or len(q) > 100:
        return []
    have_ids = {(i["name"]) for i in fp_installed()}
    res = []
    for l in run(["flatpak", "search", "--columns=application,name,description,version,remotes", q], timeout=60).splitlines()[:200]:
        p = l.split("\t")
        if len(p) >= 5 and FP_ID_RE.match(p[0]):
            res.append({"src": "flatpak", "name": p[0], "title": p[1], "desc": p[2], "version": p[3], "remotes": [x for x in p[4].split(",") if x],
                        "installed": p[0] in have_ids, "section": "flatpak", "app": {"name": p[1], "icon": p[0]}})
    return res


def fp_updates(force=False):
    def go():
        if not have("flatpak"):
            return []
        old = {(i["name"], i["scope"]): i["version"] for i in fp_installed()}
        res = []
        for scope in ("system", "user"):
            for l in run(["flatpak", "remote-ls", f"--{scope}", "--updates", "--columns=application,name,version,branch,origin,ref"], timeout=90).splitlines():
                p = l.split("\t")
                if len(p) >= 6 and FP_ID_RE.match(p[0]):
                    kind = "runtime" if p[5].startswith("runtime/") else "app"
                    o = old.get((p[0], scope), "")
                    res.append({"src": "flatpak", "name": p[0], "title": p[1] or p[0], "version": p[2], "branch": p[3], "origin": p[4], "scope": scope, "kind": kind,
                                "installed": True, "section": "flatpak", "desc": f"{o} → {p[2]}" if o and p[2] else (p[2] or "nueva versión"),
                                "app": {"name": p[1] or p[0], "icon": p[0]} if kind == "app" else None})
        return res
    if force:
        _SRC["fpu"]["t"] = 0
    return cached("fpu", 180, go)


def fp_info(fid, scope, remote):
    if not FP_ID_RE.match(fid or "") or scope not in ("user", "system"):
        raise ValueError("datos inválidos")
    inst = any(i["name"] == fid and i["scope"] == scope for i in fp_installed())
    if inst:
        text = run(["flatpak", "info", f"--{scope}", fid])
        perms = run(["flatpak", "info", f"--{scope}", "--show-permissions", fid])
        return {"text": text.strip(), "perms": perms.strip(), "installed": True}
    if not REMOTE_RE.match(remote or ""):
        raise ValueError("remoto inválido")
    return {"text": run(["flatpak", "remote-info", f"--{scope}", remote, fid], timeout=60).strip(), "perms": "", "installed": False}


def _cols(header, line):
    """Divide una tabla alineada de snap usando las posiciones de las cabeceras."""
    pos = [m.start() for m in re.finditer(r"\S+", header)]
    # las columnas empiezan donde empieza cada palabra de la cabecera
    out = []
    for i, st_ in enumerate(pos):
        end = pos[i + 1] if i + 1 < len(pos) else len(line)
        out.append(line[st_:end].strip())
    return out


def snap_installed():
    def go():
        if not have("snap"):
            return []
        lines = run(["snap", "list"]).splitlines()
        if not lines:
            return []
        hdr, res = lines[0], []
        for l in lines[1:]:
            c = _cols(hdr, l)
            if len(c) >= 6 and SNAP_RE.match(c[0]):
                size = 0
                try:
                    size = os.path.getsize(f"/var/lib/snapd/snaps/{c[0]}_{c[2]}.snap") // 1024
                except OSError:
                    pass
                res.append({"src": "snap", "name": c[0], "title": c[0], "version": c[1], "rev": c[2], "tracking": c[3], "publisher": c[4], "notes": c[5],
                            "size_kb": size, "desc": f"{c[4]} · {c[3]}" + (f" · {c[5]}" if c[5] not in ("-", "") else ""), "installed": True,
                            "section": "snap", "manual": c[5] != "base" and "base" not in c[5], "app": None})
        return res
    return cached("snap", 20, go)


def snap_search(q):
    if not have("snap") or not q or q.startswith("-") or len(q) > 100:
        return []
    have_names = {i["name"] for i in snap_installed()}
    rc, out, err = run2(["snap", "find", q], timeout=60)
    lines = out.splitlines()
    if not lines:
        return []
    hdr, res = lines[0], []
    for l in lines[1:]:
        c = _cols(hdr, l)
        if len(c) >= 5 and SNAP_RE.match(c[0]):
            res.append({"src": "snap", "name": c[0], "title": c[0], "version": c[1], "publisher": c[2], "notes": c[3], "desc": c[4],
                        "installed": c[0] in have_names, "section": "snap", "app": None})
    return res[:150]


def snap_updates(force=False):
    def go():
        if not have("snap"):
            return []
        rc, out, err = run2(["snap", "refresh", "--list"], timeout=60)
        lines = out.splitlines()
        if not lines:
            return []
        hdr, res = lines[0], []
        for l in lines[1:]:
            c = _cols(hdr, l)
            if len(c) >= 5 and SNAP_RE.match(c[0]):
                res.append({"src": "snap", "name": c[0], "title": c[0], "version": c[1], "rev": c[2], "size_kb": size_kb(c[3]), "publisher": c[4],
                            "installed": True, "section": "snap", "desc": f"nueva revisión {c[2]} ({c[1]})", "app": None})
        return res
    if force:
        _SRC["snapu"]["t"] = 0
    return cached("snapu", 180, go)


def snap_info(name):
    if not SNAP_RE.match(name or ""):
        raise ValueError("nombre inválido")
    return {"text": run(["snap", "info", name], timeout=60).strip()}


def src_job_cmd(b):
    """Construye (con validación estricta) el comando de una acción de Flatpak o Snap."""
    source, action, ids = b.get("source"), b.get("action"), b.get("ids") or []
    if not isinstance(ids, list) or len(ids) > 50:
        raise ValueError("selección inválida")
    if source == "flatpak":
        if not have("flatpak"):
            raise ValueError("Flatpak no está instalado")
        scope = b.get("scope", "system")
        if scope not in ("user", "system"):
            raise ValueError("ámbito inválido")
        if not all(isinstance(i, str) and FP_ID_RE.match(i) for i in ids):
            raise ValueError("identificador de Flatpak inválido")
        pre = ["pkexec"] if scope == "system" else []
        base = pre + ["flatpak"]
        common = [f"--{scope}", "-y", "--noninteractive"]
        if action == "install":
            remote = b.get("remote", "")
            if not ids or not REMOTE_RE.match(remote) or not any(r["name"] == remote and r["scope"] == scope for r in (fp_status().get("remotes") or [])):
                raise ValueError("remoto no configurado en ese ámbito")
            return base + ["install"] + common + [remote] + ids
        if action == "uninstall":
            if not ids:
                raise ValueError("faltan aplicaciones")
            return base + ["uninstall"] + common + (["--delete-data"] if b.get("delete_data") else []) + ids
        if action == "update":
            return base + ["update"] + common + ids
        if action == "unused":
            return base + ["uninstall", "--unused"] + common
        raise ValueError("acción inválida")
    if source == "snap":
        if action == "install-snapd":
            return ["pkexec", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "-y", "install", "snapd"]
        if not have("snap"):
            raise ValueError("snapd no está instalado")
        if not all(isinstance(i, str) and SNAP_RE.match(i) for i in ids):
            raise ValueError("nombre de snap inválido")
        if action == "install":
            if not ids:
                raise ValueError("faltan snaps")
            ch = b.get("channel")
            if ch and not CHAN_RE.match(ch):
                raise ValueError("canal inválido")
            return ["pkexec", "snap", "install"] + (["--classic"] if b.get("classic") else []) + (["--channel", ch] if ch else []) + ids
        if action == "remove":
            if not ids:
                raise ValueError("faltan snaps")
            return ["pkexec", "snap", "remove"] + (["--purge"] if b.get("purge") else []) + ids
        if action == "refresh":
            return ["pkexec", "snap", "refresh"] + ids
        raise ValueError("acción inválida")
    raise ValueError("origen inválido")


class H(BaseHTTPRequestHandler):
    server_version = "GestorPaquetes"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text/", "application/j")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'")
        self.end_headers()
        self.wfile.write(data)

    def _host_ok(self):
        # Defensa contra DNS rebinding y peticiones cruzadas
        ok = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
        if self.headers.get("Host") not in ok:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin in {f"http://{h}" for h in ok}

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "host no permitido"})
        u = urlparse(self.path)
        q = parse_qs(u.query)
        arg = (q.get("q") or q.get("name") or q.get("id") or q.get("pid") or [""])[0].strip()
        try:
            if u.path == "/":
                return self._file("index.html", "text/html")
            if u.path == "/style.css":
                return self._file("style.css", "text/css")
            if u.path == "/zoo-theme.css":
                return self._file("zoo-theme.css", "text/css")
            if u.path == "/app.js":
                return self._file("app.js", "application/javascript")
            if u.path == "/api/installed":
                items = installed()
                if arg:
                    items = [i for i in items if arg.lower() in i["name"] or arg.lower() in i["desc"].lower()]
                return self._send(200, items)
            if u.path == "/api/search":
                if not arg or arg.startswith("-") or len(arg) > 100:
                    return self._send(400, {"error": "búsqueda inválida"})
                return self._send(200, search(arg))
            if u.path == "/api/upgradable":
                return self._send(200, upgradable())
            if u.path == "/api/info":
                if not NAME_RE.match(arg):
                    return self._send(400, {"error": "nombre inválido"})
                return self._send(200, {"text": info(arg)})
            if u.path == "/api/sources":
                return self._send(200, {"flatpak": fp_status(), "snap": snap_status()})
            if u.path == "/api/fp/installed":
                return self._send(200, fp_installed())
            if u.path == "/api/fp/search":
                return self._send(200, fp_search(arg))
            if u.path == "/api/fp/updates":
                return self._send(200, fp_updates(q.get("force", ["0"])[0] == "1"))
            if u.path == "/api/fp/info":
                return self._send(200, fp_info(arg, q.get("scope", ["system"])[0], q.get("remote", [""])[0]))
            if u.path == "/api/snap/installed":
                return self._send(200, snap_installed())
            if u.path == "/api/snap/search":
                return self._send(200, snap_search(arg))
            if u.path == "/api/snap/updates":
                return self._send(200, snap_updates(q.get("force", ["0"])[0] == "1"))
            if u.path == "/api/snap/info":
                return self._send(200, snap_info(arg))
            if u.path == "/api/files":
                return self._send(200, [{"name": k, **v} for k, v in load_manifest().items()])
            if u.path == "/api/job":
                j = Job.load(arg)
                if not j:
                    return self._send(404, {"error": "no existe"})
                r = j.read(int(q.get("from", ["0"])[0]))
                if r.get("done"):
                    src_clear()
                return self._send(200, r)
            if u.path == "/api/status":
                warm_held()
                j = running_job()
                sig = 0
                for pth in ("/var/lib/dpkg/status", "/var/lib/apt/lists", "/var/lib/flatpak/app", "/var/lib/flatpak/runtime",
                            os.path.expanduser("~/.local/share/flatpak/app"), "/var/lib/snapd/snaps"):
                    try:
                        sig = max(sig, os.stat(pth).st_mtime_ns)
                    except OSError:
                        pass
                return self._send(200, {"job": {"id": j.id, "title": j.title} if j else None,
                                        "blockers": [p for p in list_blockers() if not p["own"]],
                                        "sig": str(sig)})
            if u.path == "/api/metrics":
                sort = "mem" if q.get("sort", ["cpu"])[0] == "mem" else "cpu"
                return self._send(200, metrics(sort))
            if u.path == "/api/icon":
                return self._icon(arg)
            if u.path == "/api/why":
                if not NAME_RE.match(arg):
                    return self._send(400, {"error": "nombre inválido"})
                out = run(["apt-get", "-s", "install", "--only-upgrade", "--", arg], timeout=90)
                return self._send(200, {"text": out.strip()[-4000:]})
            if u.path == "/api/proclog":
                return self._send(200, proc_log(int(arg or 0)))
            if u.path == "/api/blockers":
                audit = run(["dpkg", "--audit"]).strip()
                return self._send(200, {"procs": list_blockers(), "audit": audit[:3000]})
        except subprocess.TimeoutExpired:
            return self._send(504, {"error": "tiempo agotado"})
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        self._send(404, {"error": "no encontrado"})

    def do_POST(self):
        if not self._host_ok() or self.headers.get("X-Gestor") != "1":
            return self._send(403, {"error": "no permitido"})
        u = urlparse(self.path)
        if u.path == "/api/upload":
            return self._upload(parse_qs(u.query))
        if u.path not in ("/api/run", "/api/install-file", "/api/uninstall-file", "/api/stop", "/api/src/run", "/api/terminal"):
            return self._send(404, {"error": "no encontrado"})
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(min(n, 1 << 20)) or b"{}")
        except Exception:
            return self._send(400, {"error": "JSON inválido"})
        if u.path == "/api/terminal":
            try:
                return self._send(200, open_terminal(body.get("cmd"), "Horse Pack"))
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        title = str(body.get("title") or "Operación")[:80]
        if u.path == "/api/stop":
            try:
                pid = int(body.get("pid"))
                stop_process(pid, body.get("signal", "TERM"))
            except subprocess.TimeoutExpired:
                return self._send(504, {"error": "tiempo agotado esperando autorización"})
            except (ValueError, TypeError, ProcessLookupError, PermissionError) as e:
                return self._send(*fail(e))
            return self._send(200, {"ok": True})
        if u.path == "/api/src/run":
            try:
                cmd = src_job_cmd(body)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            j = start_job(title, cmd=cmd, apt=(body.get("action") == "install-snapd"))
            return self._send(409, self._busy(j)) if isinstance(j, str) else self._send(200, {"id": j.id})
        if u.path == "/api/install-file":
            uid, scope, name = body.get("id", ""), body.get("scope", "user"), body.get("name", "")
            if not re.fullmatch(r"[0-9a-f]{32}", uid) or scope not in ("user", "system"):
                return self._send(400, {"error": "datos inválidos"})
            j = start_job(title, func=lambda log: install_file(uid, scope, name, log))
            return self._send(409, self._busy(j)) if isinstance(j, str) else self._send(200, {"id": j.id})
        if u.path == "/api/uninstall-file":
            name = body.get("name", "")
            if not APP_NAME_RE.match(name):
                return self._send(400, {"error": "nombre inválido"})
            j = start_job(title, func=lambda log: uninstall_file(name, log), apt=False)
            return self._send(409, self._busy(j)) if isinstance(j, str) else self._send(200, {"id": j.id})
        action = body.get("action")
        pkgs = body.get("packages") or []
        if action not in ACTIONS:
            return self._send(400, {"error": "acción inválida"})
        if action in NEEDS_PKGS and not pkgs:
            return self._send(400, {"error": "faltan paquetes"})
        if len(pkgs) > 3000:
            return self._send(400, {"error": "demasiados paquetes (máx. 3000)"})
        if not all(isinstance(p, str) and NAME_RE.match(p) for p in pkgs):
            return self._send(400, {"error": "nombre de paquete inválido"})
        wait = bool(body.get("wait"))
        if action == "configure-a":
            cmd = ["pkexec", "env", "DEBIAN_FRONTEND=noninteractive", "dpkg", "--configure", "-a",
                   "--force-confold"]
        else:
            cmd = ["pkexec", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "-y",
                   "-o", "Dpkg::Options::=--force-confold"]
            if wait:
                cmd += ["-o", "DPkg::Lock::Timeout=900"]
            cmd += ACTIONS[action]
            if action in NEEDS_PKGS:
                cmd += pkgs
        j = start_job(title, cmd=cmd, apt=not wait)
        if isinstance(j, str):
            return self._send(409, self._busy(j))
        self._send(200, {"id": j.id})

    def _icon(self, name):
        if not re.fullmatch(r"[A-Za-z0-9._+\-]{1,100}", name or ""):
            return self._send(400, {"error": "nombre inválido"})
        roots = ["/usr/share/pixmaps"]
        for sz in ("128x128", "64x64", "256x256", "48x48", "512x512", "32x32", "scalable"):
            roots.append(f"/usr/share/icons/hicolor/{sz}/apps")
        for th in ("Pop", "Adwaita", "Papirus"):
            roots.append(f"/usr/share/icons/{th}/scalable/apps")
        for base in ("/var/lib/flatpak/exports/share/icons/hicolor", os.path.expanduser("~/.local/share/flatpak/exports/share/icons/hicolor")):
            for sz in ("128x128", "64x64", "256x256", "48x48", "scalable"):
                roots.append(f"{base}/{sz}/apps")
        roots += sorted(glob.glob("/var/lib/flatpak/appstream/*/x86_64/active/icons/*"), reverse=True)
        for r in roots:
            for ext, ct in ((".png", "image/png"), (".svg", "image/svg+xml")):
                pth = os.path.join(r, name + ext)
                if os.path.isfile(pth):
                    with open(pth, "rb") as f:
                        data = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", ct)
                    self.send_header("Content-Length", str(len(data)))
                    self.send_header("Cache-Control", "max-age=86400")
                    self.send_header("X-Content-Type-Options", "nosniff")
                    self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'")
                    self.end_headers()
                    self.wfile.write(data)
                    return
        self._send(404, {"error": "sin icono"})

    def _busy(self, msg):
        if msg.startswith("BLOQUEADO|"):
            _, text, pid = msg.split("|")
            return {"error": text, "blocked": True, "pid": int(pid)}
        return {"error": msg}

    def _upload(self, q):
        fname = safe_name(q.get("name", [""])[0])
        n = int(self.headers.get("Content-Length", "0"))
        if not kind_of(fname):
            return self._send(400, {"error": "formato no soportado (.deb, .tar.*, .zip, .AppImage)"})
        if n <= 0 or n > MAX_UPLOAD:
            return self._send(400, {"error": "tamaño inválido"})
        uid = uuid.uuid4().hex
        d = os.path.join(UPLOADS, uid)
        os.makedirs(d, mode=0o700)
        left = n
        with open(os.path.join(d, fname), "wb") as f:
            while left:
                chunk = self.rfile.read(min(1 << 20, left))
                if not chunk:
                    break
                f.write(chunk)
                left -= len(chunk)
        if left:
            shutil.rmtree(d, ignore_errors=True)
            return self._send(400, {"error": "subida incompleta"})
        self._send(200, {"id": uid, "name": fname, "kind": kind_of(fname), "suggested": base_name(fname)})

    def _file(self, name, ctype):
        with open(os.path.join(STATIC, name), "rb") as f:
            self._send(200, f.read(), ctype)


if __name__ == "__main__":
    threading.Thread(target=metrics, daemon=True).start()  # primera muestra
    threading.Thread(target=held_back, daemon=True).start()
    threading.Thread(target=installed, daemon=True).start()  # precalienta la caché
    srv = ThreadingHTTPServer((HOST, PORT), H)
    print(f"Horse Pack en http://localhost:{PORT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
