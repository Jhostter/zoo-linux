#!/bin/sh
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
rm -f "$HOME/.config/autostart/zoo-linux-tray.desktop"
pkill -f "^$PY $DIR/tray/tray.py" 2>/dev/null || true
echo "Icono quitado."
