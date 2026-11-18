#!/usr/bin/env bash
# Instala Elephant como servicio systemd de usuario (http://localhost:4477)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/elephant.service" <<UNIT
[Unit]
Description=Elephant (limpiador de disco, ZOO Linux)

[Service]
ExecStart=$PY $DIR/server.py
Restart=on-failure
Nice=15
IOSchedulingClass=idle
CPUQuota=25%
MemoryMax=256M
# No activar NoNewPrivileges: pkexec necesita elevar privilegios

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable elephant.service
systemctl --user restart elephant.service
echo "Listo: http://localhost:4477"
