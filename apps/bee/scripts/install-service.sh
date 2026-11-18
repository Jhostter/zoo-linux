#!/usr/bin/env bash
# Instala Bee como servicio systemd de usuario (http://localhost:4488)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/bee.service" <<UNIT
[Unit]
Description=Bee (gestor de servicios systemd, ZOO Linux)

[Service]
ExecStart=$PY $DIR/server.py
Restart=on-failure
Nice=10
CPUQuota=15%
MemoryMax=128M
# No activar NoNewPrivileges: pkexec necesita elevar privilegios

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable bee.service
systemctl --user restart bee.service
echo "Listo: http://localhost:4488"
