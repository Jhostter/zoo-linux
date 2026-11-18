#!/usr/bin/env bash
# Instala el icono de bandeja (caballo) con autoarranque en la sesión
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
mkdir -p "$HOME/.config/autostart"
cat > "$HOME/.config/autostart/gestor-paquetes-tray.desktop" <<D
[Desktop Entry]
Type=Application
Name=Horse Pack (bandeja)
Exec=$PY $DIR/tray/tray.py
Icon=$DIR/tray/horse.png
X-GNOME-Autostart-enabled=true
D
pkill -f "$DIR/tray/tray.py" 2>/dev/null || true
nohup $PY "$DIR/tray/tray.py" >/dev/null 2>&1 &
echo "Icono instalado y en marcha. Quitar: rm ~/.config/autostart/gestor-paquetes-tray.desktop"
