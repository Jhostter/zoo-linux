#!/usr/bin/env bash
# Instala ZOO Linux como servicio systemd de usuario (http://localhost:4400)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/zoo-linux.service" <<UNIT
[Unit]
Description=ZOO Linux (lanzador de la suite)

[Service]
ExecStart=$PY $DIR/server.py
Restart=on-failure
Nice=10
CPUQuota=10%
MemoryMax=128M

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable zoo-linux.service
systemctl --user restart zoo-linux.service
echo "Listo: http://localhost:4400"
