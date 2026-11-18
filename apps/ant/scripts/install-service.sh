#!/bin/sh
# Instala Ant como servicio de usuario (systemd) en http://localhost:4511
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
PY="$(command -v python3 || echo /usr/bin/python3)"
mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/ant.service" <<UNIT
[Unit]
Description=Ant - panel de agentes de Antigravity

[Service]
ExecStart=$PY $DIR/server.py
Restart=on-failure
KillMode=process
Nice=10

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now ant.service
echo "Ant en http://localhost:4511"
