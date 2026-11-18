"""Modos: perfiles de uso que cambian varias cosas de una vez (perfil de energía, brillo, apps de la suite) y, si hace falta, proponen
los pasos con administrador como un comando para la terminal. Se guarda cómo estaba todo para poder volver atrás."""
import json, os, re, subprocess, time, urllib.error, urllib.request
import health

CONF = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "zoo-linux", "modes.json")
DATA = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "zoo-linux")
PREV, ACTIVE = os.path.join(DATA, "mode-prev.json"), os.path.join(DATA, "mode-active.json")
PROFILES = ("battery", "balanced", "performance")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,20}$")
SUDO_RE = re.compile(r"^systemctl (start|stop|restart) ([A-Za-z0-9_.@-]+(?: [A-Za-z0-9_.@-]+)*)$")
DEFAULTS = [
    {"id": "juego", "name": "Juego", "emoji": "🎮", "desc": "Máximo rendimiento: perfil de rendimiento y pantalla al máximo.", "profile": "performance", "brightness": 100, "stop_apps": [], "start_apps": [], "sudo": []},
    {"id": "bateria", "name": "Batería", "emoji": "🔋", "desc": "Máxima autonomía: perfil de ahorro, pantalla tenue y Docker apagado.", "profile": "battery", "brightness": 40,
     "stop_apps": ["docker-kong"], "start_apps": [], "sudo": ["systemctl stop docker docker.socket"]},
    {"id": "cine", "name": "Cine", "emoji": "🎬", "desc": "Para ver una película: perfil equilibrado, pantalla a media luz y «No molestar» (los avisos no saldrán en pantalla; al salir del modo se devuelve todo).",
     "profile": "balanced", "brightness": 55, "dnd": True, "stop_apps": [], "start_apps": [], "sudo": []},
    {"id": "trabajo", "name": "Trabajo", "emoji": "💼", "desc": "Equilibrado, con Docker y su panel encendidos.", "profile": "balanced", "brightness": 70,
     "stop_apps": [], "start_apps": ["docker-kong"], "sudo": ["systemctl start docker"]},
]


def clean_mode(m, app_ids):
    if not isinstance(m, dict) or not isinstance(m.get("id"), str) or not ID_RE.match(m["id"]):
        raise ValueError("id inválido")
    out = {"id": m["id"], "name": str(m.get("name") or m["id"])[:30], "emoji": str(m.get("emoji") or "🐾")[:8], "desc": str(m.get("desc") or "")[:200]}
    p = m.get("profile")
    if p is not None and p not in PROFILES:
        raise ValueError(f"{m['id']}: perfil inválido")
    out["profile"] = p
    d = m.get("dnd")
    if d is not None and not isinstance(d, bool):
        raise ValueError(f"{m['id']}: dnd debe ser verdadero, falso o ausente")
    out["dnd"] = d
    b = m.get("brightness")
    if b is not None and (isinstance(b, bool) or not isinstance(b, int) or not 5 <= b <= 100):
        raise ValueError(f"{m['id']}: brillo entre 5 y 100")
    out["brightness"] = b
    for k in ("stop_apps", "start_apps"):
        v = m.get(k) or []
        if not isinstance(v, list) or any(x not in app_ids for x in v):
            raise ValueError(f"{m['id']}: {k} contiene apps desconocidas")
        out[k] = v
    sd = m.get("sudo") or []
    if not isinstance(sd, list) or any(not isinstance(x, str) or not SUDO_RE.match(x) for x in sd):
        raise ValueError(f"{m['id']}: solo se permiten pasos «systemctl start|stop|restart <unidad>»")
    out["sudo"] = sd
    return out


def load(app_ids):
    errors, modes = [], []
    src = DEFAULTS
    try:
        with open(CONF, encoding="utf-8") as f:
            data = json.load(f)
        src = data.get("modes") if isinstance(data, dict) else data
        if not isinstance(src, list):
            raise ValueError("debe ser una lista de modos")
    except FileNotFoundError:
        pass
    except (OSError, ValueError) as e:
        errors.append(f"modes.json: {e} (se usan los modos de fábrica)")
        src = DEFAULTS
    for m in src:
        try:
            modes.append(clean_mode(m, app_ids))
        except ValueError as e:
            errors.append(str(e))
    return modes, errors


def _dnd_path():
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    return os.path.join(base, "cosmic", "com.system76.CosmicNotifications", "v1", "do_not_disturb")


def dnd_get():
    try:
        return open(_dnd_path()).read().strip() == "true"
    except OSError:
        return False


def dnd_set(v):
    """«No molestar» de COSMIC (su configuración la vigila el propio COSMIC)."""
    p = _dnd_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        f.write("true" if v else "false")
    os.replace(tmp, p)


def call(url, body):
    """POST JSON a otra app de la suite. Devuelve (ok, datos|mensaje)."""
    try:
        req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "X-Chameleon": "1"}, method="POST")
        with urllib.request.urlopen(req, timeout=25) as r:
            return True, json.load(r)
    except urllib.error.HTTPError as e:
        try:
            return False, json.load(e).get("error", f"error {e.code}")
        except ValueError:
            return False, f"error {e.code}"
    except (OSError, ValueError) as e:
        return False, "no responde"


def unit_active(u):
    return subprocess.run(["systemctl", "is-active", "--quiet", u], timeout=5).returncode == 0


def sudo_plan(cmds):
    """Solo los pasos que cambian algo con el estado actual."""
    need = []
    for c in cmds:
        verb, units = SUDO_RE.match(c).groups()
        us = units.split()
        act = [unit_active(u) for u in us]
        if verb == "stop" and any(act) or verb == "start" and not all(act) or verb == "restart":
            need.append(c)
    return need


def terminal_line(cmds):
    return " && ".join("sudo " + c for c in cmds) if cmds else None


def save(path, data):
    os.makedirs(DATA, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f)


def loadj(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def touched_of(m):
    """Qué ajustes toca un modo (los `restart` no cambian un estado que haya que devolver)."""
    units = sorted({u for c in m["sudo"] for v, us in [SUDO_RE.match(c).groups()] if v != "restart" for u in us.split()})
    return {"profile": m["profile"] is not None, "brightness": m["brightness"] is not None, "dnd": m["dnd"] is not None,
            "apps": sorted(set(m["stop_apps"]) | set(m["start_apps"])), "units": units}


EMPTY = {"profile": False, "brightness": False, "dnd": False, "apps": [], "units": []}


def listing(apps):
    modes, errors = load({a["id"] for a in apps})
    state = health.cached("cstate", 10, lambda: health.jget(health.CHAMELEON + "/api/state", 2.5))
    act = loadj(ACTIVE)
    matches = None
    if act and state:
        m = next((x for x in modes if x["id"] == act["id"]), None)
        if m:
            pr_ok = m["profile"] is None or state.get("profile") == m["profile"]
            br = (state.get("brightness") or {}).get("pct")
            br_ok = m["brightness"] is None or br is None or abs(br - m["brightness"]) <= 3
            dnd_ok = m["dnd"] is None or dnd_get() == m["dnd"]
            matches = pr_ok and br_ok and dnd_ok
    hint = None
    if state and state.get("graphics_mode") in ("hybrid", "integrated", "compute"):
        hint = f"Tu modo gráfico es «{state['graphics_mode']}»: para que un juego use la NVIDIA, lánzalo con la gráfica dedicada (variables __NV_PRIME_RENDER_OFFLOAD=1 __GLX_VENDOR_LIBRARY_NAME=nvidia) o cambia a «nvidia» en Chameleon (requiere reiniciar)."
    return {"modes": modes, "errors": errors, "state": state, "active": ({**act, "matches": matches} if act else None), "can_revert": act is not None, "hint": hint,
            "hold": (state or {}).get("hold"), "dnd": dnd_get()}


def _prof(profile, by):
    return call(health.CHAMELEON + "/api/profile", {"profile": profile, "by": by})


def _hold(on, by=None, label=None):
    return call(health.CHAMELEON + "/api/hold", {"on": on, "by": by, "label": label} if on else {"on": False})


def _running(a):
    return bool(a and a["state"] in ("running", "starting"))


def _plan_units(want, base_units):
    """Comandos `systemctl` para devolver unidades a su estado original."""
    out = []
    for u in want:
        was = base_units.get(u)
        if was is not None and unit_active(u) != was:
            out.append("systemctl " + ("start " if was else "stop ") + u)
    return out


def apply(mode_id, apps, do_app):
    """Aplica un modo sobre el estado ORIGINAL (el de antes de todos los modos), sin pisar lo que no es del modo:
    - la «foto» original se guarda una sola vez (al tocar cada ajuste por primera vez) y «Volver a como estaba» siempre vuelve a ella;
    - lo que tocaba el modo anterior y el nuevo no, se devuelve a su valor original (nada se queda colgado de un modo a otro);
    - lo que el usuario cambió a mano y ningún modo toca, no se toca.
    do_app(app_id, 'start'|'stop') -> (ok, msg). Los pasos con administrador no se ejecutan: se devuelven como comando para la terminal."""
    modes, _ = load({a["id"] for a in apps})
    m = next((x for x in modes if x["id"] == mode_id), None)
    if not m:
        raise ValueError("modo desconocido")
    act = loadj(ACTIVE)
    base = loadj(PREV) if act else None
    if not isinstance(base, dict) or not act:
        act, base = None, {"t": int(time.time()), "apps": {}, "units": {}}
    base.setdefault("apps", {}), base.setdefault("units", {})
    old = (act or {}).get("touched") or EMPTY
    new = touched_of(m)
    by, old_by = f"zoo:{m['id']}", f"zoo:{(act or {}).get('id', '')}"
    state = health.jget(health.CHAMELEON + "/api/state", 2.5)
    cur_apps = {a["id"]: _running(a) for a in apps}
    steps = []

    def step(name, ok, detail):
        steps.append({"step": name, "ok": ok, "detail": detail})

    # --- foto original, perezosa: solo de lo que ESTE modo toca y aún no estaba guardado
    if new["profile"] and "profile" not in base and state:
        base["profile"] = state.get("profile")
    if new["brightness"] and "brightness" not in base and state:
        base["brightness"] = (state.get("brightness") or {}).get("pct")
    if new["dnd"] and "dnd" not in base:
        base["dnd"] = dnd_get()
    for aid in new["apps"]:
        base["apps"].setdefault(aid, cur_apps.get(aid, False))
    for u in new["units"]:
        base["units"].setdefault(u, unit_active(u))

    # --- perfil de energía (y pausa del perfil automático de Chameleon mientras el modo lo fije)
    if new["profile"]:
        if not state:
            step("Perfil de energía", False, "Chameleon no responde")
        elif state.get("profile") == m["profile"]:
            step("Perfil de energía", True, "ya estaba así")
        else:
            ok, r = _prof(m["profile"], by)
            step("Perfil de energía", ok, m["profile"] if ok else str(r))
        if state:
            ok, r = _hold(True, by, m["name"])
            step("Perfil automático de Chameleon", ok, "en pausa mientras dure el modo" if ok else f"no se pudo pausar ({r})")
    elif old["profile"]:
        want = base.get("profile")
        if state and want and state.get("profile") != want:
            ok, r = _prof(want, old_by)
            step("Perfil de energía (vuelve a lo de antes)", ok, want if ok else str(r))
        if state:
            _hold(False)
            step("Perfil automático de Chameleon", True, "reanudado")
        base.pop("profile", None)
    # --- brillo
    if new["brightness"]:
        ok, r = call(health.CHAMELEON + "/api/brightness", {"which": "screen", "pct": m["brightness"]}) if state else (False, "Chameleon no responde")
        step("Brillo de pantalla", ok, f"{r['pct']} %" if ok else str(r))
    elif old["brightness"]:
        want = base.get("brightness")
        if state and want is not None:
            ok, r = call(health.CHAMELEON + "/api/brightness", {"which": "screen", "pct": max(5, int(want))})
            step("Brillo de pantalla (vuelve a lo de antes)", ok, f"{r['pct']} %" if ok else str(r))
        base.pop("brightness", None)
    # --- No molestar
    if new["dnd"]:
        try:
            if dnd_get() != m["dnd"]:
                dnd_set(m["dnd"])
                step("No molestar", True, "activado" if m["dnd"] else "desactivado")
            else:
                step("No molestar", True, "ya estaba así")
        except OSError as e:
            step("No molestar", False, str(e))
    elif old["dnd"]:
        want = base.get("dnd")
        try:
            if want is not None and dnd_get() != want:
                dnd_set(want)
                step("No molestar (vuelve a lo de antes)", True, "activado" if want else "desactivado")
        except OSError as e:
            step("No molestar", False, str(e))
        base.pop("dnd", None)
    # --- apps de la suite
    for aid in new["apps"]:
        want = aid in m["start_apps"]
        a = next((x for x in apps if x["id"] == aid), None)
        nm = a["name"] if a else aid
        if cur_apps.get(aid, False) == want:
            step(f"{'Iniciar' if want else 'Detener'} {nm}", True, "ya estaba así")
        else:
            ok, msg = do_app(aid, "start" if want else "stop")
            step(f"{'Iniciar' if want else 'Detener'} {nm}", ok, "hecho" if ok else msg)
    for aid in old["apps"]:
        if aid in new["apps"]:
            continue
        want = base["apps"].pop(aid, None)
        a = next((x for x in apps if x["id"] == aid), None)
        if want is not None and cur_apps.get(aid, False) != want:
            ok, msg = do_app(aid, "start" if want else "stop")
            step(f"{'Iniciar' if want else 'Detener'} {a['name'] if a else aid} (vuelve a lo de antes)", ok, "hecho" if ok else msg)
    # --- pasos con administrador: los del modo + los que devuelven lo que tocaba el modo anterior
    need = sudo_plan(m["sudo"])
    back = [u for u in old["units"] if u not in new["units"]]
    need += _plan_units(back, base["units"])
    for u in back:
        base["units"].pop(u, None)
    save(PREV, base)
    save(ACTIVE, {"id": m["id"], "t": int(time.time()), "touched": new})
    return {"ok": all(s["ok"] for s in steps), "mode": m["id"], "name": m["name"], "steps": steps, "terminal_cmd": terminal_line(need), "sudo_steps": need}


def revert(apps, do_app):
    """Vuelve al estado de ANTES DE TODOS LOS MODOS, solo en lo que algún modo tocó."""
    act, base = loadj(ACTIVE), loadj(PREV)
    if not act or not isinstance(base, dict):
        raise ValueError("No hay ningún modo activo que deshacer.")
    t = act.get("touched") or EMPTY
    by = f"zoo:{act['id']}"
    steps = []
    state = health.jget(health.CHAMELEON + "/api/state", 2.5)
    if t["profile"]:
        want = base.get("profile")
        if state and want:
            ok, r = _prof(want, by)
            steps.append({"step": "Perfil de energía", "ok": ok, "detail": want if ok else str(r)})
        if state:
            _hold(False)
            steps.append({"step": "Perfil automático de Chameleon", "ok": True, "detail": "reanudado"})
    if t["brightness"] and base.get("brightness") is not None and state:
        ok, r = call(health.CHAMELEON + "/api/brightness", {"which": "screen", "pct": max(5, int(base["brightness"]))})
        steps.append({"step": "Brillo de pantalla", "ok": ok, "detail": f"{r['pct']} %" if ok else str(r)})
    if t["dnd"] and base.get("dnd") is not None:
        try:
            dnd_set(base["dnd"])
            steps.append({"step": "No molestar", "ok": True, "detail": "activado" if base["dnd"] else "desactivado"})
        except OSError as e:
            steps.append({"step": "No molestar", "ok": False, "detail": str(e)})
    cur = {a["id"]: _running(a) for a in apps}
    for aid in t["apps"]:
        want = (base.get("apps") or {}).get(aid)
        a = next((x for x in apps if x["id"] == aid), None)
        if want is not None and cur.get(aid, False) != want:
            ok, msg = do_app(aid, "start" if want else "stop")
            steps.append({"step": ("Iniciar " if want else "Detener ") + (a["name"] if a else aid), "ok": ok, "detail": "hecho" if ok else msg})
    inv = _plan_units(t["units"], base.get("units") or {})
    for path in (ACTIVE, PREV):
        try:
            os.remove(path)
        except OSError:
            pass
    return {"ok": all(s["ok"] for s in steps), "mode": "revert", "name": "Estado anterior", "steps": steps, "terminal_cmd": terminal_line(inv), "sudo_steps": inv}
