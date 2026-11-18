#!/usr/bin/env bash
# Quita los servicios de usuario de ZOO Linux. NO borra datos (~/.local/share/<app>, ~/.config/zoo-linux…) ni esta carpeta.
#   ./uninstall.sh                  todos
#   ./uninstall.sh --apps bee,ant   solo esos
set -euo pipefail
ALL="zoo-linux elephant bee beaver chameleon gestor-paquetes ant"
SEL="$ALL"
if [ "${1:-}" = "--apps" ]; then
  [ -n "${2:-}" ] || { echo "--apps necesita una lista" >&2; exit 1; }
  SEL=""; for a in $(printf '%s' "$2" | tr ',' ' '); do case "$a" in zoo) a=zoo-linux;; horse-pack) a=gestor-paquetes;; esac; SEL="$SEL $a"; done
elif [ -n "${1:-}" ]; then echo "uso: $0 [--apps a,b]" >&2; exit 1; fi
U="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
for s in $SEL; do
  case " $ALL " in *" $s "*) ;; *) echo "app desconocida: $s" >&2; exit 1;; esac
  if [ -f "$U/$s.service" ]; then
    systemctl --user disable --now "$s.service" 2>/dev/null || true
    rm -f "$U/$s.service"; echo "  · $s quitado"
  fi
done
systemctl --user daemon-reload 2>/dev/null || true
for t in zoo-linux-tray chameleon-tray gestor-paquetes-tray; do rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/$t.desktop"; done
echo "Hecho. Tus datos siguen en ~/.local/share y ~/.config (bórralos a mano si quieres)."
