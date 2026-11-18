#!/bin/sh
systemctl --user disable --now ant.service 2>/dev/null || true
rm -f "$HOME/.config/systemd/user/ant.service"
systemctl --user daemon-reload
echo "Servicio quitado (los datos y roles propios no se tocan)."
