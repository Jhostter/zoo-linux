"""Centro de avisos de la suite: un único registro donde confluyen los avisos de Chameleon y los que genera ZOO (disco, memoria, servicios
caídos, apps que fallan). ZOO solo muestra notificación de escritorio de lo que genera él; lo de Chameleon ya la tiene y aquí solo se recoge."""
import json, os, shutil, subprocess, threading, time
import health

DATA = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share"), "zoo-linux")
FEED, STATEF = os.path.join(DATA, "feed.jsonl"), os.path.join(DATA, "feed-state.json")
TICK = int(os.environ.get("ZOO_TICK", "60"))
KEEP = 500
_L = threading.Lock()
_AL, _KNOWN = {}, {"units": None, "apps": set()}


def _state():
    try:
        with open(STATEF) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _save(s):
    os.makedirs(DATA, exist_ok=True)
    tmp = STATEF + ".tmp"
    with open(tmp, "w") as f:
        json.dump(s, f)
    os.replace(tmp, STATEF)


def dnd_active():
    """COSMIC: con «No molestar» las notificaciones no salen en pantalla."""
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    try:
        return open(os.path.join(base, "cosmic", "com.system76.CosmicNotifications", "v1", "do_not_disturb")).read().strip() == "true"
    except OSError:
        return False


def notify(title, body, urgent=False):
    if not shutil.which("gdbus"):
        return False
    try:
        return subprocess.run(["gdbus", "call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications", "--method", "org.freedesktop.Notifications.Notify",
                               "ZOO Linux", "0", "dialog-warning" if urgent else "dialog-information", title, body, "[]", f"{{'urgency': <byte {2 if urgent else 1}>}}", "12000" if urgent else "8000"],
                              capture_output=True, timeout=5).returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def add(source, level, title, body="", notified=False, desktop=False, t=None):
    """Añade un aviso. desktop=True además lo notifica en el escritorio (y registra si «No molestar» lo silencia)."""
    dnd = False
    if desktop:
        dnd = dnd_active()
        notified = notify(title, body, level == "bad") and not dnd
    ev = {"id": time.time_ns(), "t": int(t or time.time()), "source": source, "level": level, "title": title, "body": body, "notified": bool(notified), "dnd": dnd, "desktop": bool(desktop)}
    with _L:
        os.makedirs(DATA, exist_ok=True)
        with open(FEED, "a") as f:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    return ev


def read(limit=150):
    try:
        with open(FEED) as f:
            ls = f.readlines()[-limit:]
    except OSError:
        ls = []
    evs = []
    for l in ls:
        try:
            evs.append(json.loads(l))
        except ValueError:
            pass
    evs.reverse()
    rt = _state().get("read_to", 0)
    return {"events": evs, "unread": sum(1 for e in evs if e["t"] > rt and e["level"] != "info"), "read_to": rt, "dnd": dnd_active()}


def unread():
    return read(KEEP)["unread"]


def mark_read():
    s = _state()
    s["read_to"] = int(time.time())
    _save(s)


def clear():
    with _L:
        try:
            os.remove(FEED)
        except OSError:
            pass


def prune():
    with _L:
        try:
            with open(FEED) as f:
                ls = f.readlines()
        except OSError:
            return
        if len(ls) > KEEP:
            tmp = FEED + ".tmp"
            with open(tmp, "w") as f:
                f.writelines(ls[-KEEP:])
            os.replace(tmp, FEED)


def check(key, cond, clear_cond, fire, cooldown=3600):
    """Dispara fire() cuando cond se cumple en dos pasadas seguidas; no repite antes de `cooldown` s; rearma cuando clear_cond."""
    s = _AL.setdefault(key, {"n": 0, "active": False, "last": 0.0})
    now = time.time()
    if cond:
        s["n"] += 1
        if s["n"] >= 2 and (not s["active"] or now - s["last"] > cooldown):
            s["active"], s["last"] = True, now
            fire()
    else:
        s["n"] = 0
        if clear_cond:
            s["active"] = False


def tick(get_apps):
    apps = get_apps()["apps"]
    h = health.collect(apps)
    st, now = _state(), int(time.time())
    # 1) lo que ya avisó Chameleon (temperaturas, batería, perfiles automáticos)
    evs = health.jget(health.CHAMELEON + "/api/events", 2.0)
    if isinstance(evs, list):
        last = st.get("ch_t") or now - 86400
        new = sorted((e for e in evs if e.get("t", 0) > last and e.get("kind") in ("alert", "profile")), key=lambda e: e["t"])
        for e in new:
            add("Chameleon", "warn" if e["kind"] == "alert" else "info", e.get("title", ""), e.get("body", ""), notified=bool(e.get("notified")), t=e["t"])
        if new or not st.get("ch_t"):
            st["ch_t"] = max([last] + [e["t"] for e in new])
    # 2) espacio en disco
    d0 = (h["disks"] or [None])[0]
    if d0:
        low, crit = d0["free_pct"] < 10, d0["free_pct"] < 5
        check("disk", low, d0["free_pct"] > 12, lambda: add("Disco", "bad" if crit else "warn", f"Poco espacio en disco: {d0['free'] / 1e9:.0f} GB libres ({d0['free_pct']:.0f} %)",
                                                          "Abre Elephant para ver qué ocupa y limpiar.", desktop=True), cooldown=6 * 3600)
    # 3) memoria
    m = h["memory"]
    if m and m["avail_pct"] is not None:
        check("mem", m["avail_pct"] < 10 and m["swap_pct"] > 75, m["avail_pct"] > 20,
              lambda: add("Memoria", "warn", f"Memoria casi agotada: {m['avail_pct']:.0f} % libre y swap al {m['swap_pct']:.0f} %", "Abre Beaver para ver qué programas la usan.", desktop=True), cooldown=3600)
    # 4) servicios con error (los nuevos; al arrancar, un único resumen sin notificación)
    cur = set(h["failed"]["system"]) | set(h["failed"]["user"])
    if _KNOWN["units"] is None:
        if cur:
            add("Servicios", "warn", f"Hay {len(cur)} servicio(s) con error: " + ", ".join(sorted(cur)[:5]), "Abre Bee para revisarlos.")
    else:
        for u in sorted(cur - _KNOWN["units"]):
            add("Servicios", "warn", f"El servicio {u} ha fallado", "Abre Bee para ver el motivo y reiniciarlo.", desktop=True)
    _KNOWN["units"] = cur
    # 5) apps de la suite que han fallado
    failed = {a["id"]: a for a in apps if a["state"] == "failed"}
    for i in sorted(set(failed) - _KNOWN["apps"]):
        add("Suite", "bad", f"{failed[i]['name']} ha fallado", "Mira sus logs desde ZOO Linux y reiníciala.", desktop=True)
    _KNOWN["apps"] = set(failed)
    # 6) informativos (sin notificación): actualizaciones una vez al día y reinicio pendiente una vez por arranque
    today = time.strftime("%Y-%m-%d")
    if h["updates"].get("available") and h["updates"]["count"] > 0 and st.get("upd_day") != today:
        add("Actualizaciones", "info", f"Hay {h['updates']['count']} actualizaciones disponibles", "Revísalas en Horse Pack.")
        st["upd_day"] = today
    try:
        boot = open("/proc/sys/kernel/random/boot_id").read().strip()
    except OSError:
        boot = ""
    if h["reboot_required"] and st.get("reboot_boot") != boot:
        add("Actualizaciones", "info", "Hay que reiniciar para terminar de aplicar actualizaciones")
        st["reboot_boot"] = boot
    _save(st)


def vigia(get_apps):
    prune()
    time.sleep(min(8, TICK))
    n = 0
    while True:
        try:
            tick(get_apps)
            n += 1
            if n % 60 == 0:
                prune()
        except Exception:
            pass
        time.sleep(TICK)
