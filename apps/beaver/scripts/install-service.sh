#!/usr/bin/env bash
# Instala Beaver como servicio systemd de usuario (http://localhost:4499)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/beaver.service" <<UNIT
[Unit]
Description=Beaver (gestor de memoria y swap, ZOO Linux)

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
systemctl --user enable beaver.service
systemctl --user restart beaver.service
echo "Listo: http://localhost:4499"
