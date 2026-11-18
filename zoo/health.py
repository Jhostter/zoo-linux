"""Panel de salud de la suite: lecturas directas y baratas del sistema + las APIs ligeras de Chameleon y Horse Pack.
Todo con caché corta; si una app no responde, su tarjeta lo dice en vez de romper el panel."""
import json, os, shutil, subprocess, threading, time, urllib.request

CHAMELEON = "http://127.0.0.1:" + os.environ.get("CHAMELEON_PORT", "4500")
HORSE = "http://127.0.0.1:" + os.environ.get("GESTOR_PAQUETES_PORT", "4466")
DOCKER_SOCK = os.environ.get("ZOO_DOCKER_SOCK", "/var/run/docker.sock")
_C, _L = {}, threading.Lock()


def cached(key, ttl, fn):
    with _L:
        hit = _C.get(key)
        if hit and time.time() - hit[0] < ttl:
            return hit[1]
    v = fn()
    with _L:
        _C[key] = (time.time(), v)
    return v


def jget(url, timeout=1.5, body=None, headers=None):
    try:
        req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers or {}, method="POST" if body is not None else "GET")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception:
        return None


def run(cmd, timeout=6):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return 124, ""


def meminfo():
    d = {}
    try:
        for l in open("/proc/meminfo"):
            k, v = l.split(":")
            d[k] = int(v.split()[0])
    except (OSError, ValueError):
        return None
    tot, av, st, sf = d.get("MemTotal", 0), d.get("MemAvailable", 0), d.get("SwapTotal", 0), d.get("SwapFree", 0)
    psi = None
    try:
        psi = float(open("/proc/pressure/memory").readline().split("avg10=")[1].split()[0])
    except (OSError, IndexError, ValueError):
        pass
    return {"total_kb": tot, "avail_kb": av, "avail_pct": round(av / tot * 100, 1) if tot else None, "swap_total_kb": st, "swap_used_kb": st - sf,
            "swap_pct": round((st - sf) / st * 100, 1) if st else 0.0, "psi10": psi}


def disks():
    out, seen = [], set()
    for path in ("/", os.path.expanduser("~")):
        try:
            dev = os.stat(path).st_dev
            if dev in seen:
                continue
            seen.add(dev)
            u = shutil.disk_usage(path)
            out.append({"mount": path, "total": u.total, "free": u.free, "free_pct": round(u.free / u.total * 100, 1)})
        except OSError:
            pass
    return out


def failed_units():
    def one(scope):
        rc, txt = run(["systemctl", f"--{scope}", "--failed", "--no-legend", "--plain", "--no-pager"])
        return sorted({l.split()[0] for l in txt.splitlines() if l.strip()}) if rc == 0 else []
    return {"system": one("system"), "user": one("user")}


def docker_state():
    if not os.path.exists(DOCKER_SOCK):
        return {"state": "off", "running": None}
    rc, txt = run(["docker", "ps", "-q"], timeout=4)
    return {"state": "on", "running": len(txt.split()) if rc == 0 else None}


def updates():
    """Actualizaciones pendientes leyendo apt directamente (sondear a Horse Pack la despertaría o la mantendría encendida).
    count = las que instalaría `apt upgrade`; held = las que apt retiene (requieren full-upgrade)."""
    rc, txt = run(["apt", "list", "--upgradable"], timeout=25)
    total = [l.split("/")[0] for l in txt.splitlines() if "/" in l and "upgradable" in l]
    rc2, sim = run(["apt-get", "-s", "-o", "Debug::NoLocking=1", "upgrade"], timeout=40)
    inst = sum(1 for l in sim.splitlines() if l.startswith("Inst "))
    if rc != 0 and not total:
        return {"available": False}
    return {"available": True, "count": inst, "held": max(0, len(total) - inst), "total": len(total)}


_BG = {}


def bg(key, ttl, fn):
    """Devuelve el último valor y, si caducó, lo recalcula en segundo plano (nunca bloquea una petición)."""
    with _L:
        hit = _BG.get(key)
        stale = not hit or time.time() - hit["t"] > ttl
        if stale and not (hit and hit.get("busy")):
            _BG[key] = {**(hit or {"v": None}), "t": hit["t"] if hit else 0, "busy": True}
            def work():
                try:
                    v = fn()
                except Exception:
                    v = None
                with _L:
                    _BG[key] = {"v": v, "t": time.time(), "busy": False}
            threading.Thread(target=work, daemon=True).start()
        return (_BG.get(key) or {}).get("v")


def lvl(*pairs, default="ok"):
    for cond, l in pairs:
        if cond:
            return l
    return default


def collect(apps):
    """apps: lista de status() de ZOO. Devuelve datos crudos + tarjetas ya redactadas."""
    sysd = cached("chameleon", 5, lambda: jget(CHAMELEON + "/api/status", 1.5))
    state = cached("cstate", 10, lambda: jget(CHAMELEON + "/api/state", 2.5)) if sysd else None
    mem = meminfo()
    dk = disks()
    fl = cached("failed", 20, failed_units)
    up = bg("updates", 1800, updates) or {"available": False, "warming": True}
    dock = cached("docker", 15, docker_state)
    reboot = os.path.exists("/var/run/reboot-required")
    cards = []
    if sysd and not sysd.get("t"):
        cards.append({"id": "power", "emoji": "🦎", "title": "Temperatura y batería", "value": "Midiendo…", "sub": "Chameleon acaba de arrancar", "app": "chameleon", "level": "mut"})
    elif sysd:
        t, b, st, w = sysd.get("cpu_temp"), sysd.get("batt"), sysd.get("status"), sysd.get("batt_w")
        dis = st == "Discharging"
        head = f"{t:.0f} °C" if t is not None else "—"
        sub = []
        if b is not None:
            sub.append(f"batería {b:.0f} %" + (" (descargando" + (f", {w:.0f} W" if w else "") + ")" if dis else " (conectada)"))
        if sysd.get("gpu_temp") is not None:
            sub.append(f"GPU {sysd['gpu_temp']:.0f} °C")
        elif sysd.get("gpu_awake") is False:
            sub.append("GPU dormida")
        if state and state.get("profile"):
            sub.append("perfil " + {"battery": "batería", "balanced": "equilibrado", "performance": "rendimiento"}.get(state["profile"], state["profile"]))
        cards.append({"id": "power", "emoji": "🦎", "title": "Temperatura y batería", "value": head, "sub": " · ".join(sub), "app": "chameleon",
                      "level": lvl((t is not None and t >= 85, "bad"), (dis and b is not None and b <= 10, "bad"), (t is not None and t >= 75, "warn"), (dis and b is not None and b <= 20, "warn"))})
    else:
        cards.append({"id": "power", "emoji": "🦎", "title": "Temperatura y batería", "value": "—", "sub": "Chameleon no responde", "app": "chameleon", "level": "mut"})
    if mem:
        used = 100 - (mem["avail_pct"] or 0)
        cards.append({"id": "mem", "emoji": "🦫", "title": "Memoria", "value": f"{used:.0f} % en uso", "sub": f"{mem['avail_kb'] / 1048576:.1f} GB libres de {mem['total_kb'] / 1048576:.1f} GB · swap {mem['swap_pct']:.0f} %", "app": "beaver",
                      "level": lvl((mem["avail_pct"] is not None and mem["avail_pct"] < 8, "bad"), (mem["avail_pct"] is not None and mem["avail_pct"] < 15, "warn"), (mem["swap_pct"] > 80, "warn"))})
    if dk:
        d0 = dk[0]
        cards.append({"id": "disk", "emoji": "🐘", "title": "Disco", "value": f"{d0['free'] / 1e9:.0f} GB libres", "sub": f"{d0['free_pct']:.0f} % libre de {d0['total'] / 1e9:.0f} GB en {d0['mount']}", "app": "elephant",
                      "level": lvl((d0["free_pct"] < 5, "bad"), (d0["free_pct"] < 10, "warn"))})
    nf = len(fl["system"]) + len(fl["user"])
    cards.append({"id": "units", "emoji": "🐝", "title": "Servicios", "value": "Todo en orden" if not nf else f"{nf} con error", "sub": ", ".join((fl["system"] + fl["user"])[:4]) + ("…" if nf > 4 else "") if nf else "Ninguna unidad fallida (sistema y usuario)", "app": "bee",
                  "level": "warn" if nf else "ok"})
    if up.get("available"):
        c = up["count"]
        cards.append({"id": "updates", "emoji": "🐴", "title": "Actualizaciones", "value": "Al día" if not c else f"{c} disponibles", "sub": (f"{up['held']} retenidas · " if up["held"] else "") + ("reinicio pendiente" if reboot else "sin reinicio pendiente"), "app": "horse-pack",
                      "level": lvl((reboot, "warn"), (c >= 50, "warn"), (c > 0, "info"))})
    else:
        cards.append({"id": "updates", "emoji": "🐴", "title": "Actualizaciones", "value": "Comprobando…" if up.get("warming") else "—", "sub": "Mirando apt en segundo plano" if up.get("warming") else "No se pudo consultar apt", "app": "horse-pack", "level": "mut"})
    if dock["state"] == "on":
        cards.append({"id": "docker", "emoji": "🐵", "title": "Docker", "value": "En marcha", "sub": (f"{dock['running']} contenedores" if dock["running"] is not None else "estado desconocido"), "app": "docker-kong", "level": "ok"})
    else:
        cards.append({"id": "docker", "emoji": "🐵", "title": "Docker", "value": "Apagado", "sub": "El demonio no está en marcha (ahorra memoria y batería)", "app": "docker-kong", "level": "mut"})
    import ondemand
    run_n = sum(1 for a in apps if a["state"] == "running")
    sb = sum(1 for a in apps if a["state"] == "standby")
    bad = [a["name"] for a in apps if a["state"] == "failed"]
    mem_kb = sum(a.get("mem_kb") or 0 for a in apps)
    saved = ondemand.saved_kb(apps)
    cards.append({"id": "suite", "emoji": "🐾", "title": "La suite", "value": f"{run_n} de {len(apps)} en marcha" + (f" · {sb} en espera" if sb else ""),
                  "sub": ("con error: " + ", ".join(bad) if bad else f"{mem_kb / 1024:.0f} MB de RAM" + (f" · ahorras ~{saved / 1024:.0f} MB con las apps en espera" if saved else "")), "app": None, "level": "bad" if bad else "ok"})
    return {"t": int(time.time()), "chameleon": sysd, "state": state, "memory": mem, "disks": dk, "failed": fl, "updates": up, "docker": dock, "reboot_required": reboot, "cards": cards}
