#!/bin/sh
# Icono de ZOO Linux en la barra de estado, con autoarranque. Quitar: scripts/uninstall-tray.sh
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/zoo-linux-tray.desktop" <<D
[Desktop Entry]
Type=Application
Name=ZOO Linux (barra de estado)
Exec=$PY $DIR/tray/tray.py
NoDisplay=true
X-GNOME-Autostart-enabled=true
D
pkill -f "^$PY $DIR/tray/tray.py" 2>/dev/null || true
setsid nohup $PY "$DIR/tray/tray.py" >/dev/null 2>&1 &
echo "Icono instalado y en marcha. Quitar: sh $DIR/scripts/uninstall-tray.sh"
