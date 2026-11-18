#!/usr/bin/env bash
# Instala Chameleon como servicio systemd de usuario (http://localhost:4500)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/chameleon.service" <<UNIT
[Unit]
Description=Chameleon (sensores y hardware, ZOO Linux)

[Service]
ExecStart=$PY $DIR/server.py
Restart=on-failure
Nice=10
CPUQuota=10%
MemoryMax=128M
# No activar NoNewPrivileges: pkexec necesita elevar privilegios (lectura de módulos de RAM)

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable chameleon.service
systemctl --user restart chameleon.service
echo "Listo: http://localhost:4500"
