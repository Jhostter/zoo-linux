#!/usr/bin/env bash
# Instala el gestor como servicio systemd de usuario (http://localhost:4466)
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="$(command -v python3 || echo /usr/bin/python3)"
UNIT_DIR="$HOME/.config/systemd/user"
mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/gestor-paquetes.service" <<UNIT
[Unit]
Description=Horse Pack (panel local)

[Service]
ExecStart=$PY $DIR/server.py
Restart=on-failure
KillMode=process
Nice=10
CPUQuota=30%
MemoryMax=512M
# No activar NoNewPrivileges: pkexec necesita elevar privilegios

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now gestor-paquetes.service
echo "Listo: http://localhost:4466"
