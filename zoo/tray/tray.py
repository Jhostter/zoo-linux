#!/usr/bin/env python3
"""Icono de ZOO Linux en la barra de estado (StatusNotifierItem): abre el lanzador y cada app del zoo, y permite
iniciar, detener o reiniciar sus servicios. Consulta /api/apps cada 30 s (cuesta ~20 ms) y solo reconstruye el menú si algo cambió."""
import json, os, subprocess, tempfile, urllib.request
import cairo, gi
gi.require_version("Gtk", "3.0")
gi.require_version("AyatanaAppIndicator3", "0.1")
from gi.repository import GLib, Gtk, AyatanaAppIndicator3 as AI

PORT = os.environ.get("ZOO_PORT", "4400")
BASE = f"http://localhost:{PORT}"
EVERY = int(os.environ.get("ZOO_TRAY_EVERY", "30"))
DIR = os.path.join(os.environ.get("XDG_RUNTIME_DIR") or tempfile.gettempdir(), "zoo-linux-tray")
os.makedirs(DIR, mode=0o700, exist_ok=True)
_sig = [None]


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=3) as r:
        return json.load(r)


def sh(*cmd):
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def paw(ok):
    """Huella verde (gris si el lanzador no responde)."""
    S = 48
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, S, S)
    c = cairo.Context(surf)
    c.set_source_rgb(*((0.30, 0.60, 0.16) if ok else (0.45, 0.48, 0.53)))
    c.arc(S / 2, S / 2, S / 2 - 1, 0, 6.2832)
    c.fill()
    c.set_source_rgb(1, 1, 1)
    c.save(); c.translate(24, 31); c.scale(1.0, 0.82); c.arc(0, 0, 10, 0, 6.2832); c.restore(); c.fill()
    for x, y, r in ((11, 21, 4.2), (18.5, 13.5, 4.6), (29.5, 13.5, 4.6), (37, 21, 4.2)):
        c.arc(x, y, r, 0, 6.2832); c.fill()
    path = os.path.join(DIR, "ok.png" if ok else "off.png")
    surf.write_to_png(path)
    return path


def act(app, action):
    def go(_):
        try:
            req = urllib.request.Request(BASE + "/api/action", data=json.dumps({"id": app, "action": action}).encode(), headers={"X-Zoo": "1", "Content-Type": "application/json"}, method="POST")
            urllib.request.urlopen(req, timeout=45).read()
        except Exception as e:
            sh("gdbus", "call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications", "--method", "org.freedesktop.Notifications.Notify",
               "ZOO Linux", "0", "dialog-error", f"No se pudo {action} {app}", str(e)[:120], "[]", "{}", "6000")
        GLib.timeout_add_seconds(2, lambda: refresh() and False)
    return go


def notify_user(title, body):
    sh("gdbus", "call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications", "--method", "org.freedesktop.Notifications.Notify",
       "ZOO Linux", "0", "dialog-information", title, body, "[]", "{}", "8000")


def post(path, body, timeout=45):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={"X-Zoo": "1", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def apply_mode(mid, name):
    def go(_):
        try:
            r = post("/api/modes/apply", {"id": mid})
            bad = [x["step"] for x in r["steps"] if not x["ok"]]
            notify_user(f"Modo {name} activado" + (" (con avisos)" if bad else ""), ("No se pudo: " + ", ".join(bad)) if bad else "; ".join(f"{x['step']}: {x['detail']}" for x in r["steps"])[:200])
            if r.get("terminal_cmd"):
                post("/api/terminal", {"cmd": r["terminal_cmd"], "title": f"ZOO Linux (modo {name})"})
        except Exception as e:
            notify_user(f"No se pudo activar el modo {name}", str(e)[:150])
        GLib.timeout_add_seconds(2, lambda: refresh() and False)
    return go


ind = AI.Indicator.new("zoo-linux", "dialog-information", AI.IndicatorCategory.APPLICATION_STATUS)
ind.set_title("ZOO Linux")
ind.set_status(AI.IndicatorStatus.ACTIVE)


def build(apps, unread=0, modes=()):
    m = Gtk.Menu()

    def add(label, cb=None, parent=None):
        it = Gtk.MenuItem(label=label)
        if cb:
            it.connect("activate", cb)
        else:
            it.set_sensitive(False)
        (parent or m).append(it)
        return it
    if apps is None:
        add("ZOO Linux no responde")
        add("Iniciar el lanzador", lambda _: sh("systemctl", "--user", "start", "zoo-linux"))
    else:
        add("🐾 Abrir ZOO Linux", lambda _: sh("xdg-open", BASE))
        add(f"🔔 {unread} aviso{'s' if unread != 1 else ''} sin leer" if unread else "🔔 Sin avisos nuevos", lambda _: sh("xdg-open", BASE + "/#feed"))
        if modes:
            mt = Gtk.MenuItem(label="🎛️ Modos")
            sub = Gtk.Menu()
            for md in modes:
                add(f"{md['emoji']} {md['name']}", apply_mode(md["id"], md["name"]), sub)
            mt.set_submenu(sub)
            m.append(mt)
        m.append(Gtk.SeparatorMenuItem())
        for a in apps:
            run, sb = a["state"] == "running", a["state"] == "standby"
            top = Gtk.MenuItem(label=f"{a['emoji']} {a['name']}  {'● en marcha' if run else '💤 en espera' if sb else '○ parada'}")
            sub = Gtk.Menu()
            add("Abrir" + (" (despierta)" if sb else ""), lambda _, u=a["url"]: sh("xdg-open", u), sub) if (run or sb) else None
            if sb:
                add("Iniciar ya", act(a["id"], "start"), sub)
            elif run:
                add("Reiniciar", act(a["id"], "restart"), sub)
                add("Detener", act(a["id"], "stop"), sub)
            else:
                add("Iniciar", act(a["id"], "start"), sub)
            top.set_submenu(sub)
            m.append(top)
    m.append(Gtk.SeparatorMenuItem())
    add("Salir del icono", lambda _: Gtk.main_quit())
    m.show_all()
    return m


def refresh():
    try:
        d = get("/api/apps")
        apps, unread = d["apps"], d.get("unread", 0)
    except Exception:
        apps, unread = None, 0
    try:
        modes = tuple({"id": x["id"], "name": x["name"], "emoji": x["emoji"]} for x in get("/api/modes")["modes"]) if apps is not None else ()
    except Exception:
        modes = ()
    sig = None if apps is None else (tuple((a["id"], a["state"], a["name"], a["emoji"], a["url"]) for a in apps), unread, tuple(m["id"] for m in modes))
    if sig != _sig[0]:
        _sig[0] = sig
        ind.set_menu(build(apps, unread, modes))
        ind.set_icon_full(paw(apps is not None), "ZOO Linux")
        n = sum(1 for a in apps if a["state"] == "running") if apps else 0
        ind.set_title("ZOO Linux · " + (f"{n} de {len(apps)} apps en marcha" + (f" · {unread} avisos" if unread else "") if apps is not None else "lanzador apagado"))
    return True


refresh()
GLib.timeout_add_seconds(EVERY, refresh)
Gtk.main()
