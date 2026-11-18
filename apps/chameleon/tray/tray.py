#!/usr/bin/env python3
"""Icono de bandeja de Chameleon (StatusNotifierItem). Muestra la temperatura de la CPU en un círculo de color y
un menú con CPU/SSD/GPU/batería y atajos de perfil. Consulta /api/status cada 15 s: ese endpoint solo devuelve lo
que el vigilante ya midió, así que no cuesta nada ni despierta la GPU. Solo biblioteca estándar + GTK."""
import json, os, subprocess, tempfile, urllib.request
import cairo, gi
gi.require_version("Gtk", "3.0")
gi.require_version("AyatanaAppIndicator3", "0.1")
from gi.repository import GLib, Gtk, AyatanaAppIndicator3 as AI

PORT = os.environ.get("CHAMELEON_PORT", "4500")
BASE = f"http://localhost:{PORT}"
EVERY = int(os.environ.get("CHAMELEON_TRAY_EVERY", "15"))
DIR = os.path.join(os.environ.get("XDG_RUNTIME_DIR") or tempfile.gettempdir(), "chameleon-tray")
os.makedirs(DIR, mode=0o700, exist_ok=True)
BATT = {"Charging": "cargando", "Discharging": "descargando", "Not charging": "conectada", "Full": "completa"}
PROFILES = (("battery", "Perfil: Batería"), ("balanced", "Perfil: Equilibrado"), ("performance", "Perfil: Rendimiento"))
_n = [0]
_last = [None]


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=2) as r:
        return json.load(r)


def draw(text, rgb):
    """Círculo de color con el número dentro; se alternan dos archivos para que la bandeja detecte el cambio."""
    S = 48
    surf = cairo.ImageSurface(cairo.FORMAT_ARGB32, S, S)
    c = cairo.Context(surf)
    c.arc(S / 2, S / 2, S / 2 - 2, 0, 6.2832)
    c.set_source_rgb(*rgb)
    c.fill()
    c.set_source_rgb(1, 1, 1)
    c.select_font_face("sans-serif", cairo.FONT_SLANT_NORMAL, cairo.FONT_WEIGHT_BOLD)
    c.set_font_size(26 if len(text) <= 2 else 19)
    ext = c.text_extents(text)
    c.move_to(S / 2 - ext.width / 2 - ext.x_bearing, S / 2 - ext.height / 2 - ext.y_bearing)
    c.show_text(text)
    _n[0] ^= 1
    path = os.path.join(DIR, f"icon{_n[0]}.png")
    surf.write_to_png(path)
    return path


def level(t):
    if t is None:
        return "-", (0.45, 0.48, 0.53)
    return str(round(t)), (0.86, 0.25, 0.28) if t >= 85 else (0.85, 0.58, 0.10) if t >= 70 else (0.10, 0.62, 0.44)


ind = AI.Indicator.new("chameleon", "dialog-information", AI.IndicatorCategory.HARDWARE)
ind.set_title("Chameleon")
ind.set_status(AI.IndicatorStatus.ACTIVE)
menu = Gtk.Menu()


def item(label, cb=None):
    it = Gtk.MenuItem(label=label)
    if cb:
        it.connect("activate", cb)
    else:
        it.set_sensitive(False)
    menu.append(it)
    return it


def sh(*cmd):
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def set_profile(p):
    def go(_):
        try:
            req = urllib.request.Request(BASE + "/api/profile", data=json.dumps({"profile": p}).encode(), headers={"X-Chameleon": "1", "Content-Type": "application/json"}, method="POST")
            urllib.request.urlopen(req, timeout=20).read()
        except Exception as e:
            sh("gdbus", "call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications", "--method", "org.freedesktop.Notifications.Notify",
               "Chameleon", "0", "dialog-error", "No se pudo cambiar el perfil", str(e)[:120], "[]", "{}", "6000")
    return go


l_cpu, l_gpu, l_bat = item("CPU …"), item("GPU …"), item("Batería …")
menu.append(Gtk.SeparatorMenuItem())
item("Abrir Chameleon", lambda _: sh("xdg-open", BASE))
for p, name in PROFILES:
    item(name, set_profile(p))
menu.append(Gtk.SeparatorMenuItem())
item("Salir del icono", lambda _: Gtk.main_quit())
menu.show_all()
ind.set_menu(menu)


def refresh():
    try:
        s = get("/api/status")
    except Exception:
        s = None
    key = None if not s or not s.get("t") else (round(s["cpu_temp"]) if s.get("cpu_temp") is not None else None, s.get("batt"), s.get("status"), s.get("gpu_temp"), s.get("gpu_awake"), s.get("nvme_temp"))
    if key != _last[0]:
        _last[0] = key
        if s is None or not s.get("t"):
            l_cpu.set_label("Chameleon no responde" if s is None else "Esperando la primera lectura…")
            l_gpu.set_label("")
            l_bat.set_label("")
            ind.set_icon_full(draw(*level(None)), "sin datos")
        else:
            text, rgb = level(s.get("cpu_temp"))
            ind.set_icon_full(draw(text, rgb), f"CPU {text} °C")
            ind.set_title(f"Chameleon · CPU {text} °C")
            ssd = f" · SSD {s['nvme_temp']:.0f} °C" if s.get("nvme_temp") is not None else ""
            l_cpu.set_label(f"CPU {s['cpu_temp']:.0f} °C{ssd}" if s.get("cpu_temp") is not None else "CPU sin lectura")
            l_gpu.set_label(f"GPU NVIDIA {s['gpu_temp']:.0f} °C" if s.get("gpu_temp") is not None else "GPU NVIDIA dormida" if not s.get("gpu_awake") else "GPU sin lectura")
            if s.get("batt") is not None:
                w = f" · {s['batt_w']:.0f} W" if s.get("batt_w") else ""
                hrs = f" · quedan {int(s['hours'])} h {round(s['hours'] % 1 * 60)} min" if s.get("hours") and s.get("status") == "Discharging" else ""
                l_bat.set_label(f"Batería {s['batt']:.0f} % ({BATT.get(s.get('status'), s.get('status'))}){w}{hrs}")
            else:
                l_bat.set_label("Sin batería")
    return True


refresh()
GLib.timeout_add_seconds(EVERY, refresh)
Gtk.main()
