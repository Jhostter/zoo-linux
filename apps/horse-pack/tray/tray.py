#!/usr/bin/env python3
"""Icono de caballo en la bandeja (StatusNotifierItem) para Horse Pack."""
import os, subprocess, gi
gi.require_version("Gtk", "3.0")
gi.require_version("AyatanaAppIndicator3", "0.1")
from gi.repository import Gtk, AyatanaAppIndicator3 as AI

URL = f"http://localhost:{os.environ.get('GESTOR_PAQUETES_PORT', '4466')}"
ICON = os.path.join(os.path.dirname(os.path.abspath(__file__)), "horse.png")


def sh(*cmd):
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


ind = AI.Indicator.new("gestor-paquetes", ICON, AI.IndicatorCategory.APPLICATION_STATUS)
ind.set_icon_full(ICON, "Horse Pack")
ind.set_title("Horse Pack")
ind.set_status(AI.IndicatorStatus.ACTIVE)
menu = Gtk.Menu()
for label, fn in [
    ("Abrir panel", lambda _: sh("xdg-open", URL)),
    ("Reiniciar servicio", lambda _: sh("systemctl", "--user", "restart", "gestor-paquetes")),
    ("Salir del icono", lambda _: Gtk.main_quit()),
]:
    it = Gtk.MenuItem(label=label)
    it.connect("activate", fn)
    menu.append(it)
menu.show_all()
ind.set_menu(menu)
Gtk.main()
