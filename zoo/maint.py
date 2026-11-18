"""Mantenimiento guiado: una lista de comprobaciones que se ejecutan con «Revisar todo» y dicen qué conviene hacer y con qué herramienta.
Solo lee: no cambia nada del sistema. Evita despertar apps pesadas (Elephant haría un análisis de minutos): usa lo que ya sepa o estimaciones baratas."""
import json, os, re, shutil, subprocess, threading, time
import health, ondemand

DATA = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "zoo-linux")
STATEF = os.path.join(DATA, "maintenance.json")
ELEPHANT = "http://127.0.0.1:" + os.environ.get("ELEPHANT_PORT", "4477")
DOCKER_SOCK = os.environ.get("ZOO_DOCKER_SOCK", "/var/run/docker.sock")
_L = threading.Lock()
LIST = [("updates", "Actualizaciones", "🐴"), ("reboot", "Reinicio pendiente", "🔁"), ("disk", "Espacio en disco", "🐘"), ("units", "Servicios con error", "🐝"),
        ("smart", "Salud del disco (SSD)", "💾"), ("battery", "Salud de la batería", "🔋"), ("docker", "Docker", "🐵")]
RANK = {"ok": 0, "info": 1, "warn": 2, "bad": 3}
RUN = {"running": False, "started": 0, "finished": 0, "checks": []}


def gb(n):
    return f"{n / 1e9:.1f} GB" if n >= 1e8 else f"{n / 1e6:.0f} MB"


def parse_size(t):
    m = re.match(r"([\d.]+)\s*([kKMGT]?B)", t or "")
    if not m:
        return 0
    return float(m[1]) * {"B": 1, "kB": 1e3, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12}[m[2] if m[2] in ("B", "kB", "KB", "MB", "GB", "TB") else m[2].upper()]


def du(path, timeout=8):
    try:
        r = subprocess.run(["du", "-sb", path], capture_output=True, text=True, timeout=timeout)
        return int(r.stdout.split()[0]) if r.stdout.strip() else 0
    except (subprocess.TimeoutExpired, OSError, ValueError, IndexError):
        return 0


def res(status, headline, detail="", app=None, label=None, path=None):
    return {"status": status, "headline": headline, "detail": detail, "action": ({"app": app, "label": label or "Abrir", "path": path or ""} if app else None)}


# ---------- comprobaciones ----------
def c_updates():
    up = health.updates()
    if not up.get("available"):
        return res("info", "No se pudo consultar apt", "Prueba de nuevo en un momento.", "horse-pack", "Abrir Horse Pack")
    n, held = up["count"], up["held"]
    d = f"{held} más retenidas por apt (necesitan «full-upgrade»; revísalas en Horse Pack)." if held else ""
    return res("warn" if n >= 30 else "info" if (n or held) else "ok", "Al día" if not n else f"{n} para instalar", d, "horse-pack", "Abrir Horse Pack")


def c_reboot():
    req = os.path.exists("/var/run/reboot-required")
    try:
        days = float(open("/proc/uptime").read().split()[0]) / 86400
    except OSError:
        days = 0
    if req:
        return res("warn", "Hay un reinicio pendiente", "Se instalaron actualizaciones (kernel o bibliotecas) que solo se aplican al reiniciar.")
    if days >= 30:
        return res("info", f"Encendido desde hace {days:.0f} días", "Reiniciar de vez en cuando aplica actualizaciones del kernel y libera memoria.")
    return res("ok", "Sin reinicio pendiente", f"Encendido desde hace {days:.1f} días.")


def elephant_cats():
    """Categorías de Elephant SOLO si ya está en marcha con el análisis hecho (despertarla dispararía un análisis de minutos)."""
    listen, _ = ondemand.net_ports()
    port = int(ELEPHANT.rsplit(":", 1)[1])
    if port not in listen or ondemand.armed("elephant"):
        return None
    d = health.jget(ELEPHANT + "/api/overview", 4)
    if not d or d.get("scanning") or not d.get("cats"):
        return None
    return [(c["name"], c["size"]) for c in d["cats"] if c.get("level") == "safe" and c.get("size")]


def c_disk():
    u = shutil.disk_usage("/")
    pct = u.free / u.total * 100
    base = "bad" if pct < 5 else "warn" if pct < 10 else "ok"
    cats = elephant_cats()
    src = "según el último análisis de Elephant"
    if cats is None:
        src = "estimado a grandes rasgos (Elephant da el detalle exacto)"
        home = os.path.expanduser("~")
        cats = [(n, v) for n, v in (("Caché de paquetes (apt)", du("/var/cache/apt/archives")), ("Papelera", du(os.path.join(home, ".local/share/Trash"))), ("Cachés de aplicaciones", du(os.path.join(home, ".cache"), 12))) if v]
    cats.sort(key=lambda x: -x[1])
    rec = sum(v for _, v in cats)
    d = f"{pct:.0f} % libre ({gb(u.free)} de {gb(u.total)}). "
    if rec >= 2e9:
        d += f"Se pueden recuperar ~{gb(rec)} {src}: " + ", ".join(f"{n} {gb(v)}" for n, v in cats[:3]) + "."
    return res(max(base, "info" if rec >= 2e9 else "ok", key=lambda x: RANK[x]), f"{gb(u.free)} libres" + (f" · ~{gb(rec)} limpiables" if rec >= 2e9 else ""), d, "elephant", "Abrir Elephant")


def c_units():
    fl = health.failed_units()
    names = fl["system"] + fl["user"]
    if not names:
        return res("ok", "Ningún servicio con error", "Sistema y usuario en orden.")
    return res("warn", f"{len(names)} con error", ", ".join(names[:6]) + ("…" if len(names) > 6 else "") + ". Bee te dice por qué fallaron.", "bee", "Abrir Bee")


def c_smart():
    d = health.jget(health.CHAMELEON + "/api/nvme", 4)
    if d is None:
        return res("info", "Chameleon no responde", "No se pudo mirar la salud del SSD.", "chameleon", "Abrir Chameleon")
    s = d.get("smart")
    if not s:
        return res("warn", "Sin lectura de salud todavía", "Chameleon puede leer el desgaste y los errores del SSD (te pedirá hacerlo con sudo en una terminal).", "chameleon", "Leer en Chameleon", "/#hardware")
    age = (time.time() - s.get("at", 0)) / 86400
    txt = f"{s['used_pct']} % de desgaste · {s['power_on_hours']} h encendido · {s['media_errors']} errores de medio · {s['tb_written']} TB escritos"
    st = {"ok": "ok", "warn": "warn", "bad": "bad"}.get(s.get("verdict"), "info")
    if s.get("issues"):
        txt += " · " + ", ".join(s["issues"])
    if age > 30 and st == "ok":
        return res("info", f"Lectura de hace {age:.0f} días", txt + ". Conviene repetirla.", "chameleon", "Actualizar lectura", "/#hardware")
    return res(st, {"ok": "Buena", "warn": "Revisar", "bad": "Mala"}.get(s.get("verdict"), "—"), txt + f" (leída hace {age:.0f} d).", "chameleon", "Ver en Chameleon", "/#hardware")


def c_battery():
    d = health.jget(health.CHAMELEON + "/api/state", 4)
    b = (d or {}).get("battery") or {}
    if d is None:
        return res("info", "Chameleon no responde", "", "chameleon", "Abrir Chameleon")
    if not b.get("present"):
        return res("ok", "Sin batería", "Este equipo no tiene batería que revisar.")
    h = b.get("health")
    if h is None:
        return res("info", "Salud desconocida", "")
    cyc = f" · {int(b['cycles'])} ciclos de carga" if b.get("cycles") is not None else ""
    return res("bad" if h < 60 else "warn" if h < 80 else "ok", f"{h:.0f} % de su capacidad original", f"Una batería sana conserva más del 80 %{cyc}.", "chameleon", "Ver en Chameleon", "/#power")


def c_docker():
    if not os.path.exists(DOCKER_SOCK):
        return res("ok", "Docker apagado", "Nada que revisar (ahorra memoria y batería).")
    try:
        r = subprocess.run(["docker", "system", "df", "--format", "{{json .}}"], capture_output=True, text=True, timeout=10)
    except (subprocess.TimeoutExpired, OSError):
        return res("info", "No se pudo consultar Docker", "")
    if r.returncode:
        return res("info", "No se pudo consultar Docker", (r.stderr or "").strip()[:120], "docker-kong", "Abrir Docker Kong")
    items = []
    for l in r.stdout.splitlines():
        try:
            j = json.loads(l)
            items.append((j.get("Type", "?"), parse_size((j.get("Reclaimable") or "").split(" ")[0])))
        except ValueError:
            pass
    rec = sum(v for _, v in items)
    top = ", ".join(f"{n} {gb(v)}" for n, v in sorted(items, key=lambda x: -x[1])[:3] if v > 1e7)
    return res("warn" if rec >= 5e9 else "info" if rec >= 1e9 else "ok", f"~{gb(rec)} recuperables" if rec >= 1e8 else "Sin nada que limpiar", ("Imágenes, caché y contenedores sin usar: " + top + ". Límpialos desde Docker Kong.") if top else "", "docker-kong", "Abrir Docker Kong")


FUNCS = {"updates": c_updates, "reboot": c_reboot, "disk": c_disk, "units": c_units, "smart": c_smart, "battery": c_battery, "docker": c_docker}


# ---------- ejecución ----------
def _pending():
    return [{"id": i, "title": t, "emoji": e, "status": "pending", "headline": "", "detail": "", "action": None, "t": 0} for i, t, e in LIST]


def _save():
    os.makedirs(DATA, exist_ok=True)
    with open(STATEF, "w") as f:
        json.dump({"finished": RUN["finished"], "checks": RUN["checks"]}, f)


def load():
    try:
        with open(STATEF) as f:
            d = json.load(f)
        if isinstance(d.get("checks"), list) and d["checks"]:
            RUN.update(finished=d.get("finished", 0), checks=d["checks"])
            return
    except (OSError, ValueError):
        pass
    RUN["checks"] = _pending()


load()


def state():
    with _L:
        cs = RUN["checks"]
        worst = max((RANK.get(c["status"], 0) for c in cs), default=0)
        return {"running": RUN["running"], "started": RUN["started"], "finished": RUN["finished"], "checks": json.loads(json.dumps(cs)),
                "summary": {"attention": sum(1 for c in cs if c["status"] in ("warn", "bad")), "info": sum(1 for c in cs if c["status"] == "info"), "worst": ["ok", "info", "warn", "bad"][worst],
                            "done": sum(1 for c in cs if c["status"] != "pending" and c["status"] != "running")}}


def _worker(on_done):
    try:
        with _L:
            RUN["checks"] = _pending()
        for i, title, emoji in LIST:
            with _L:
                next(c for c in RUN["checks"] if c["id"] == i)["status"] = "running"
            try:
                r = FUNCS[i]()
            except Exception as e:
                r = res("info", "No se pudo comprobar", str(e)[:120])
            with _L:
                c = next(c for c in RUN["checks"] if c["id"] == i)
                c.update(r, t=int(time.time()))
        with _L:
            RUN["finished"] = int(time.time())
            _save()
        if on_done:
            on_done(state())
    finally:
        with _L:
            RUN["running"] = False


def start(on_done=None):
    with _L:
        if RUN["running"]:
            return False
        RUN.update(running=True, started=int(time.time()))
    threading.Thread(target=_worker, args=(on_done,), daemon=True).start()
    return True
