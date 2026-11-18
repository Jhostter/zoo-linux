#!/usr/bin/env python3
"""Elephant: limpiador de disco de ZOO Linux. Escanea qué ocupa espacio, limpia cachés y restos
con vista previa y explora carpetas. Solo biblioteca estándar. Borra únicamente bajo $HOME o con
comandos fijos (pkexec) para apt, journal, logs rotados y volcados de memoria."""
import json, os, re, shlex, shutil, subprocess, threading, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = int(os.environ.get("ELEPHANT_PORT", "4477"))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
HOME = os.path.realpath(os.path.expanduser("~"))
CACHE = os.path.join(HOME, ".cache")
TRASH = os.path.join(HOME, ".local", "share", "Trash")
PROTECTED = {".ssh", ".gnupg", ".config", ".local", ".claude", ".cache"}  # hijos directos de $HOME que no se borran enteros
DEV_CACHES = [("npm", "~/.npm/_cacache"), ("gradle", "~/.gradle/caches"), ("cargo", "~/.cargo/registry/cache"),
              ("go", "~/go/pkg/mod/cache"), ("yarn-classic", "~/.yarn/cache")]
CAT_NAMES = {"trash": "Papelera", "cache": "Cachés de aplicaciones", "devcache": "Cachés de desarrollo", "apt": "Caché de apt",
             "journal": "Journal", "logs": "Logs rotados", "coredump": "Volcados de memoria", "kernels": "Kernels antiguos"}
JOURNAL_SIZES = {"100M", "200M", "500M", "1G"}
ENV = {**os.environ, "LC_ALL": "C.UTF-8"}


# ---------- utilidades ----------# ---------- pkexec sin agente de contraseñas ----------
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



def run(cmd, timeout=120, **kw):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=ENV, **kw)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "tiempo agotado"
    except FileNotFoundError:
        return 127, "", "no existe " + cmd[0]


def du_bytes(path):
    """Tamaño real en disco (bytes) de un archivo o carpeta, con baja prioridad de CPU/disco."""
    if not os.path.lexists(path):
        return 0
    _, out, _ = run(["nice", "-n", "19", "ionice", "-c3", "du", "-sb", "-x", "--", path], timeout=300)
    try:
        return int(out.split()[0])
    except (ValueError, IndexError):
        return 0


def free_bytes():
    sv = os.statvfs(HOME)
    return sv.f_bavail * sv.f_frsize


def disks():
    res, seen = [], set()
    for m in ("/", "/home"):
        try:
            sv, dev = os.statvfs(m), os.stat(m).st_dev
        except OSError:
            continue
        if dev in seen:
            continue
        seen.add(dev)
        res.append({"mount": m, "total": sv.f_blocks * sv.f_frsize, "free": sv.f_bavail * sv.f_frsize})
    return res


def under_home(path):
    rp = os.path.realpath(path)
    return rp != HOME and rp.startswith(HOME + os.sep)


def allowed_delete(path):
    """Ruta que se puede borrar: dentro de $HOME, no protegida, y propiedad del usuario."""
    if not isinstance(path, str) or not path.startswith("/") or "\0" in path:
        raise ValueError("ruta inválida")
    parent = os.path.realpath(os.path.dirname(path))
    full = os.path.join(parent, os.path.basename(path))  # no resuelve el último tramo (por si es symlink)
    if not (full.startswith(HOME + os.sep)):
        raise ValueError("solo se puede borrar dentro de tu carpeta personal")
    rel = os.path.relpath(full, HOME).split(os.sep)
    if len(rel) == 1 and rel[0] in PROTECTED:
        raise ValueError(f"{rel[0]} está protegida")
    if rel[:3] == [".local", "share", "Trash"] and len(rel) <= 3:
        raise ValueError("usa «vaciar papelera»")
    if not os.path.lexists(full):
        raise ValueError("no existe")
    if os.lstat(full).st_uid != os.getuid():
        raise ValueError("no es tuya")
    return full


def rm_any(path):
    if os.path.islink(path) or os.path.isfile(path):
        os.unlink(path)
    else:
        shutil.rmtree(path, ignore_errors=False)


# ---------- historial de espacio liberado ----------
DATA = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(HOME, ".local", "share"), "elephant")
HIST = os.path.join(DATA, "history.json")
_HLOCK = threading.Lock()


def hist_load():
    try:
        with open(HIST) as f:
            return json.load(f)
    except (OSError, ValueError):
        return []


def hist_add(title, freed):
    with _HLOCK:
        h = hist_load()
        h.append({"t": time.time(), "title": title, "freed": int(freed)})
        os.makedirs(DATA, exist_ok=True)
        with open(HIST, "w") as f:
            json.dump(h[-300:], f)


def free_trend():
    """Espacio libre en las últimas muestras (para ver si el disco se llena o se vacía)."""
    now = time.time()
    s = _TREND
    if not s or now - s[-1][0] > 120:
        s.append((now, free_bytes()))
        del s[:-60]
    return s


_TREND = []


# ---------- trabajos ----------
class Job:
    def __init__(self, title):
        self.id, self.title, self.out, self.done, self.code, self.freed = uuid.uuid4().hex, title, [], False, None, 0

    def log(self, t):
        self.out.append(t)


JOBS, JOB_LOCK = {}, threading.Lock()


def start_job(title, fn):
    with JOB_LOCK:
        if any(not j.done for j in JOBS.values()):
            return None
        for k in list(JOBS)[:-10]:
            JOBS.pop(k, None)
        j = Job(title)
        JOBS[j.id] = j

    def work():
        before = free_bytes()
        try:
            j.code = fn(j.log) or 0
        except Exception as e:
            j.log(f"Error: {e}\n")
            j.code = 1
        time.sleep(0.5)
        j.freed = max(0, free_bytes() - before)
        if j.code == 0:
            hist_add(j.title, j.freed)
        j.done = True
        _SCAN["stale"] = True
    threading.Thread(target=work, daemon=True).start()
    return j


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


# ---------- categorías de limpieza ----------
_SCAN = {"scanning": False, "cats": [], "at": 0, "stale": True, "done": 0, "total": 9}
_SCAN_LOCK = threading.Lock()


def running_key():
    m = re.match(r"(\d+\.\d+\.\d+-\d+)", os.uname().release)
    return m[1] if m else None


def kernel_info():
    """Kernels instalados agrupados por versión. Se conserva el que está en uso y uno de reserva."""
    _, out, _ = run(["dpkg-query", "-W", "-f", "${Package}\t${Installed-Size}\t${db:Status-Abbrev}\n",
                     "linux-image-*", "linux-headers-*", "linux-modules-*", "linux-modules-extra-*"])
    rx = re.compile(r"^linux-(?:image(?:-unsigned)?|headers|modules|modules-extra)-(\d+\.\d+\.\d+-\d+)")
    groups = {}
    for l in out.splitlines():
        p = l.split("\t")
        if len(p) == 3 and p[2].startswith("ii"):
            m = rx.match(p[0])
            if m:
                g = groups.setdefault(m[1], {"pkgs": [], "kb": 0})
                g["pkgs"].append(p[0])
                g["kb"] += int(p[1] or 0)
    ver = lambda k: tuple(int(x) for x in re.split(r"[.-]", k))
    run_k = running_key()
    keep = {run_k} if run_k else set()
    others = sorted((k for k in groups if k != run_k), key=ver, reverse=True)
    if others:
        keep.add(others[0])  # reserva
    return groups, keep


def scan_categories(emit):
    add = lambda **k: emit(k)
    t = du_bytes(TRASH)
    add(id="trash", icon="🗑️", name="Papelera", level="safe", size=t,
        desc="Lo que borraste y sigue ocupando espacio.", action="Vaciar papelera")
    # cachés de usuario: una entrada por subcarpeta
    items = []
    if os.path.isdir(CACHE):
        for n in sorted(os.listdir(CACHE)):
            p = os.path.join(CACHE, n)
            if os.path.isdir(p) and not os.path.islink(p):
                items.append({"name": n, "size": du_bytes(p)})
    items.sort(key=lambda x: -x["size"])
    add(id="cache", icon="🧺", name="Cachés de aplicaciones (~/.cache)", level="safe", size=sum(i["size"] for i in items),
        items=items, desc="Datos temporales que las apps vuelven a generar (navegadores, uv, pip, miniaturas…). Elige cuáles.", action="Limpiar seleccionadas")
    dev = [{"name": n, "path": p, "size": du_bytes(os.path.expanduser(p))} for n, p in DEV_CACHES if os.path.isdir(os.path.expanduser(p))]
    add(id="devcache", icon="🧰", name="Cachés de desarrollo", level="safe", size=sum(d["size"] for d in dev), items=dev,
        desc="npm, Gradle, Cargo, Go… Se vuelven a descargar al compilar.", action="Limpiar seleccionadas")
    add(id="apt", icon="📦", name="Caché de paquetes (apt)", level="safe", size=du_bytes("/var/cache/apt/archives"), root=True,
        desc="Archivos .deb ya instalados. `apt-get clean`.", action="Limpiar caché de apt")
    _, jo, _ = run(["journalctl", "--disk-usage"])
    m = re.search(r"take up ([\d.]+)([KMGT])", jo)
    jb = int(float(m[1]) * {"K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4}[m[2]]) if m else 0
    add(id="journal", icon="📜", name="Registros del sistema (journal)", level="review", size=jb, root=True,
        desc="Se conservan solo los más recientes hasta el tamaño que elijas.", action="Reducir journal", options=sorted(JOURNAL_SIZES))
    _, lo, _ = run(["find", "/var/log", "-type", "f", "(", "-name", "*.gz", "-o", "-name", "*.[0-9]", "-o", "-name", "*.old", ")", "-printf", "%s\n"])
    add(id="logs", icon="🗂️", name="Logs antiguos rotados (/var/log)", level="review",
        size=sum(int(x) for x in lo.split() if x.isdigit()), root=True,
        desc="Archivos .gz, .1, .old que ya rotaron. Los logs actuales no se tocan.", action="Borrar logs rotados")
    add(id="coredump", icon="💥", name="Volcados de memoria (coredumps)", level="safe", size=du_bytes("/var/lib/systemd/coredump") + du_bytes("/var/crash"),
        root=True, desc="Restos de programas que fallaron.", action="Borrar volcados")
    groups, keep = kernel_info()
    rem = {k: v for k, v in groups.items() if k not in keep}
    add(id="kernels", icon="🧬", name="Kernels antiguos", level="review", size=sum(v["kb"] for v in rem.values()) * 1024, root=True,
        items=[{"name": k, "size": v["kb"] * 1024, "pkgs": v["pkgs"]} for k, v in sorted(rem.items())],
        info=f"En uso: {running_key()} · de reserva: {', '.join(sorted(keep - {running_key()})) or '—'}",
        desc="Versiones que no están en uso ni son la de reserva.", action="Quitar kernels seleccionados")
    # docker: solo informativo
    rc, dout, _ = run(["docker", "system", "df", "--format", "{{.Type}}\t{{.Reclaimable}}"], timeout=10)
    add(id="docker", icon="🐳", name="Docker", level="info", size=0, info=("Apagado: nada que escanear." if rc else dout.strip().replace("\t", ": ").replace("\n", " · ")),
        desc="Imágenes y contenedores sin usar. Límpialos desde Docker Kong.", action=None)


def scan_worker():
    new = []

    def emit(c):  # cada categoría aparece en cuanto se calcula
        new.append(c)
        with _SCAN_LOCK:
            _SCAN.update(cats=list(new), done=len(new))
    try:
        with _SCAN_LOCK:
            _SCAN.update(cats=[], done=0)
        scan_categories(emit)
        with _SCAN_LOCK:
            _SCAN.update(at=time.time(), stale=False)
    finally:
        _SCAN["scanning"] = False


def ensure_scan(force=False):
    with _SCAN_LOCK:
        if _SCAN["scanning"]:
            return
        if force or _SCAN["stale"] or time.time() - _SCAN["at"] > 600:
            _SCAN["scanning"] = True
            threading.Thread(target=scan_worker, daemon=True).start()


# ---------- limpiezas ----------
def clean(cat, items, option):
    def do(log):
        if cat == "trash":
            n = 0
            for sub in ("files", "info", "expunged"):
                d = os.path.join(TRASH, sub)
                if os.path.isdir(d):
                    for e in os.listdir(d):
                        try:
                            rm_any(os.path.join(d, e)); n += 1
                        except OSError as ex:
                            log(f"No se pudo borrar {e}: {ex}\n")
            log(f"Papelera vaciada ({n} elementos).\n"); return 0
        if cat == "cache":
            for name in items:
                if not isinstance(name, str) or "/" in name or name in ("", ".", ".."):
                    raise ValueError("nombre inválido")
                p = os.path.join(CACHE, name)
                if os.path.isdir(p) and not os.path.islink(p):
                    log(f"Borrando ~/.cache/{name}…\n")
                    shutil.rmtree(p, ignore_errors=True)
            return 0
        if cat == "devcache":
            valid = {n: os.path.expanduser(p) for n, p in DEV_CACHES}
            for name in items:
                if name not in valid:
                    raise ValueError("caché desconocida")
                log(f"Borrando {valid[name]}…\n")
                shutil.rmtree(valid[name], ignore_errors=True)
            return 0
        if cat == "apt":
            return stream(["pkexec", "apt-get", "clean"], log)
        if cat == "journal":
            if option not in JOURNAL_SIZES:
                raise ValueError("tamaño inválido")
            return stream(["pkexec", "journalctl", f"--vacuum-size={option}"], log)
        if cat == "logs":
            return stream(["pkexec", "find", "/var/log", "-type", "f", "(", "-name", "*.gz", "-o", "-name", "*.[0-9]", "-o", "-name", "*.old", ")", "-print", "-delete"], log)
        if cat == "coredump":
            c = stream(["pkexec", "find", "/var/lib/systemd/coredump", "-mindepth", "1", "-delete"], log)
            return c
        if cat == "kernels":
            groups, keep = kernel_info()
            pk = []
            for k in items:
                if k not in groups or k in keep:
                    raise ValueError(f"el kernel {k} no se puede quitar")
                pk += groups[k]["pkgs"]
            if not pk:
                raise ValueError("nada que quitar")
            for nm in ("apt", "apt-get", "dpkg", "aptitude"):
                if subprocess.run(["pgrep", "-x", nm], capture_output=True).stdout.strip():
                    raise ValueError("apt está en uso por otro proceso")
            return stream(["pkexec", "env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "-y", "purge", *pk], log)
        raise ValueError("categoría desconocida")
    return do


# ---------- explorador ----------
_DU, _DU_LOCK = {}, threading.Lock()


def entry_of(p, size):
    try:
        mt = os.lstat(p).st_mtime
    except OSError:
        mt = None
    isdir = os.path.isdir(p) and not os.path.islink(p)
    return {"name": os.path.basename(p), "size": size, "dir": isdir, "mtime": mt,
            "deletable": under_home(p) and os.path.basename(p) not in (PROTECTED if os.path.dirname(p) == HOME else ())}


def du_dir(path, cache):
    """Calcula tamaños entrada por entrada (3 en paralelo) y los publica según terminan."""
    from concurrent.futures import ThreadPoolExecutor
    try:
        names = os.listdir(path)
    except OSError as e:
        raise ValueError(str(e))
    cache.update(entries=[], total=0, done=0, count=len(names))
    lock = threading.Lock()

    def one(n):
        p = os.path.join(path, n)
        if os.path.isdir(p) and not os.path.islink(p):
            size = du_bytes(p)
        else:
            try:
                size = os.lstat(p).st_blocks * 512
            except OSError:
                size = 0
        e = entry_of(p, size)
        with lock:
            cache["entries"].append(e)
            cache["entries"].sort(key=lambda x: -x["size"])
            cache["total"] += size
            cache["done"] += 1
    with ThreadPoolExecutor(3) as ex:
        list(ex.map(one, names))
    cache["entries"] = cache["entries"][:300]


def explore(path, force=False):
    rp = os.path.realpath(path)
    if not os.path.isdir(rp):
        raise ValueError("no es una carpeta")
    with _DU_LOCK:
        c = _DU.get(rp)
        if c and not force and (c["status"] == "running" or time.time() - c["t"] < 180):
            return {**c, "path": rp, "entries": list(c.get("entries", []))[:300]}
        _DU[rp] = c = {"status": "running", "t": time.time()}

    def w():
        try:
            du_dir(rp, c)
            c.update(status="done", t=time.time())
        except Exception as e:
            c.update(status="error", error=str(e))
    threading.Thread(target=w, daemon=True).start()
    return {**c, "path": rp, "entries": []}


_LG, _LG_LOCK = {}, threading.Lock()


def large_files(minmb, force=False):
    if minmb not in (50, 100, 500, 1024):
        raise ValueError("umbral inválido")
    with _LG_LOCK:
        c = _LG.get(minmb)
        if c and not force and (c["status"] == "running" or time.time() - c["t"] < 300):
            return c
        _LG[minmb] = c = {"status": "running", "t": time.time(), "files": []}

    def w():
        try:
            _, out, _ = run(["nice", "-n", "19", "ionice", "-c3", "find", HOME, "-xdev", "-type", "f", f"-size", f"+{minmb}M",
                             "-printf", "%s\t%T@\t%p\n"], timeout=900)
            files = []
            for l in out.splitlines():
                try:
                    sz, mt, p = l.split("\t", 2)
                except ValueError:
                    continue
                try:
                    allowed_delete(p)
                    ok = True
                except ValueError:
                    ok = False
                files.append({"path": p, "size": int(sz), "mtime": float(mt), "deletable": ok})
            files.sort(key=lambda f: -f["size"])
            c.update(files=files[:150], total=sum(f["size"] for f in files), count=len(files), status="done", t=time.time())
        except Exception as e:
            c.update(status="error", error=str(e))
    threading.Thread(target=w, daemon=True).start()
    return c


def trash_path(path, log):
    rc, out, err = run(["gio", "trash", "--", path])
    log((out + err) or "Movido a la papelera.\n")
    return rc


def delete_path(path, log):
    log(f"Borrando {path}…\n")
    rm_any(path)
    log("Borrado.\n")
    return 0


# ---------- HTTP ----------
class H(BaseHTTPRequestHandler):
    server_version = "Elephant"

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
        q = parse_qs(u.query)
        if u.path == "/":
            return self._file("index.html", "text/html")
        if u.path == "/app.js":
            return self._file("app.js", "application/javascript")
        if u.path == "/style.css":
            return self._file("style.css", "text/css")
        if u.path == "/zoo-theme.css":
            return self._file("zoo-theme.css", "text/css")
        if u.path == "/api/overview":
            ensure_scan(q.get("force", ["0"])[0] == "1")
            return self._send(200, {"disks": disks(), "scanning": _SCAN["scanning"], "cats": _SCAN["cats"], "at": _SCAN["at"], "home": HOME,
                                        "progress": [_SCAN["done"], _SCAN["total"]], "free_trend": free_trend()})
        if u.path == "/api/explore":
            try:
                return self._send(200, explore(q.get("path", [HOME])[0], q.get("force", ["0"])[0] == "1"))
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        if u.path == "/api/large":
            try:
                return self._send(200, large_files(int(q.get("min", ["100"])[0]), q.get("force", ["0"])[0] == "1"))
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        if u.path == "/api/history":
            h = hist_load()
            return self._send(200, {"items": h[::-1][:100], "total": sum(x["freed"] for x in h), "count": len(h)})
        if u.path == "/api/job":
            j = JOBS.get(q.get("id", [""])[0])
            if not j:
                return self._send(404, {"error": "no existe"})
            s = int(q.get("from", ["0"])[0])
            return self._send(200, {"lines": j.out[s:], "next": len(j.out), "done": j.done, "code": j.code, "freed": j.freed, "title": j.title})
        self._send(404, {"error": "no encontrado"})

    def do_POST(self):
        if not self._host_ok() or self.headers.get("X-Elephant") != "1":
            return self._send(403, {"error": "no permitido"})
        u = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(min(n, 1 << 20)) or b"{}")
        except Exception:
            return self._send(400, {"error": "JSON inválido"})
        try:
            if u.path == "/api/clean":
                cat, items = body.get("category"), body.get("items") or []
                if not isinstance(items, list) or len(items) > 500:
                    raise ValueError("datos inválidos")
                if cat in ("cache", "devcache", "kernels"):
                    for x in items:
                        if not isinstance(x, str) or not x or "/" in x or x in (".", ".."):
                            raise ValueError("nombre inválido")
                if cat == "journal" and body.get("option") not in JOURNAL_SIZES:
                    raise ValueError("tamaño inválido")
                if cat not in ("trash", "cache", "devcache", "apt", "journal", "logs", "coredump", "kernels"):
                    raise ValueError("categoría desconocida")
                fn = clean(cat, items, body.get("option"))
                title = CAT_NAMES.get(cat, str(cat))
            elif u.path in ("/api/trash", "/api/delete"):
                p = allowed_delete(body.get("path"))
                fn = (lambda log: trash_path(p, log)) if u.path == "/api/trash" else (lambda log: delete_path(p, log))
                title = ("Papelera: " if u.path == "/api/trash" else "Borrar: ") + os.path.basename(p)
                _DU.clear()
            else:
                return self._send(404, {"error": "no encontrado"})
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        j = start_job(title, fn)
        if not j:
            return self._send(409, {"error": "ya hay una operación en curso"})
        self._send(200, {"id": j.id})


if __name__ == "__main__":
    ensure_scan(True)
    srv = ThreadingHTTPServer((HOST, PORT), H)
    print(f"Elephant en http://localhost:{PORT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
