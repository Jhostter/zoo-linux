#!/usr/bin/env bash
# ZOO Linux — instalador de la suite como servicios systemd DE USUARIO (no necesita root).
#   ./install.sh                       lanzador + apps recomendadas para este equipo
#   ./install.sh --all                 todas las apps
#   ./install.sh --apps elephant,bee   solo esas (el lanzador `zoo` se instala siempre)
#   ./install.sh --tray                además, icono en la bandeja (requiere GTK + AyatanaAppIndicator)
#   ./install.sh --list | --dry-run | --help
# Los servicios apuntan a ESTA carpeta: no la muevas ni la borres después de instalar (si la mueves, vuelve a ejecutar).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
APPS_ALL="zoo elephant bee beaver chameleon horse-pack ant"
SEL="" ; ALL=0; TRAY=0; DRY=0; LIST=0
say() { printf '%s\n' "$*"; }
warn() { printf '⚠  %s\n' "$*" >&2; }
die() { printf '✖  %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --all) ALL=1 ;;
    --apps) shift; [ $# -gt 0 ] || die "--apps necesita una lista separada por comas"; SEL="$(printf '%s' "$1" | tr ',' ' ')" ;;
    --apps=*) SEL="$(printf '%s' "${1#--apps=}" | tr ',' ' ')" ;;
    --tray) TRAY=1 ;;
    --dry-run) DRY=1 ;;
    --list) LIST=1 ;;
    -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "opción desconocida: $1 (usa --help)" ;;
  esac
  shift
done

dir_of() { [ "$1" = zoo ] && echo "$ROOT/zoo" || echo "$ROOT/apps/$1"; }
port_of() { case "$1" in zoo) echo 4400;; horse-pack) echo 4466;; elephant) echo 4477;; bee) echo 4488;; beaver) echo 4499;; chameleon) echo 4500;; ant) echo 4511;; esac; }
unit_of() { case "$1" in zoo) echo zoo-linux;; horse-pack) echo gestor-paquetes;; *) echo "$1";; esac; }
note_of() { case "$1" in
  zoo) echo "lanzador y centro de la suite";; elephant) echo "limpiador de disco";; bee) echo "gestor de servicios systemd";;
  beaver) echo "memoria, swap y zram";; chameleon) echo "sensores, batería y energía";; horse-pack) echo "paquetes apt/dpkg, Flatpak y Snap (solo Debian/Ubuntu y derivadas)";;
  ant) echo "agentes de Antigravity (solo si usas Antigravity)";; esac; }

if [ "$LIST" = 1 ]; then
  for a in $APPS_ALL; do printf '%-11s :%-5s %s\n' "$a" "$(port_of "$a")" "$(note_of "$a")"; done
  say "Docker Kong (gestor de Docker, Node.js) se instala aparte: https://github.com/Jhostter/docker-kong"
  exit 0
fi

# ---- comprobaciones
[ "$(uname -s)" = Linux ] || die "ZOO Linux solo funciona en Linux."
command -v python3 >/dev/null || die "Falta python3 (se necesita 3.9 o superior)."
python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || die "Se necesita Python 3.9 o superior (tienes $(python3 -V 2>&1))."
if [ "$DRY" = 0 ]; then
  command -v systemctl >/dev/null || die "Falta systemd (systemctl). Sin systemd puedes ejecutar cada app a mano: python3 apps/<app>/server.py"
  systemctl --user show-environment >/dev/null 2>&1 || die "No hay sesión de usuario de systemd (systemctl --user falla). Ejecútalo desde una sesión gráfica o con 'loginctl enable-linger \$USER'."
fi

# ---- qué instalar
HAVE_APT=0; command -v apt-get >/dev/null && command -v dpkg >/dev/null && HAVE_APT=1
if [ -n "$SEL" ]; then TODO="zoo $SEL"
elif [ "$ALL" = 1 ]; then TODO="$APPS_ALL"
else TODO="zoo elephant bee beaver chameleon"; [ "$HAVE_APT" = 1 ] && TODO="$TODO horse-pack"; fi
TODO="$(printf '%s\n' $TODO | awk '!s[$0]++' | tr '\n' ' ')"
for a in $TODO; do
  case " $APPS_ALL " in *" $a "*) ;; *) die "app desconocida: $a (usa --list)";; esac
  [ -f "$(dir_of "$a")/scripts/install-service.sh" ] || die "falta $(dir_of "$a")/scripts/install-service.sh"
done
case " $TODO " in *" horse-pack "*) [ "$HAVE_APT" = 1 ] || warn "Horse Pack gestiona paquetes apt/dpkg y aquí no hay apt: se instalará, pero sus vistas principales no tendrán datos." ;; esac

say "ZOO Linux → instalando: $TODO"
[ "$DRY" = 1 ] && say "(simulacro: no se cambia nada)"
for a in $TODO; do
  p="$(port_of "$a")"
  if python3 - "$p" <<'PY' 2>/dev/null
import socket, sys
s = socket.socket(); s.settimeout(0.3)
sys.exit(0 if s.connect_ex(("127.0.0.1", int(sys.argv[1]))) == 0 else 1)
PY
  then
    if [ "$DRY" = 0 ] && ! systemctl --user is-active --quiet "$(unit_of "$a").service" 2>/dev/null; then
      warn "el puerto $p (para $a) ya está en uso por otro programa: la app no podrá arrancar hasta que lo liberes."
    fi
  fi
  if [ "$DRY" = 1 ]; then say "  · $a  ->  sh $(dir_of "$a")/scripts/install-service.sh   (http://localhost:$p)"; continue; fi
  say "  · $a  (http://localhost:$p)"
  bash "$(dir_of "$a")/scripts/install-service.sh" >/dev/null
done

if [ "$TRAY" = 1 ]; then
  if [ "$DRY" = 1 ]; then say "  · bandeja ->  sh $ROOT/zoo/scripts/install-tray.sh"
  elif python3 -c 'import gi, cairo; gi.require_version("AyatanaAppIndicator3","0.1")' 2>/dev/null; then sh "$ROOT/zoo/scripts/install-tray.sh"
  else warn "Para el icono de bandeja faltan python3-gi, python3-gi-cairo y gir1.2-ayatanaappindicator3-0.1 (Debian/Ubuntu). Saltado."; fi
fi

say ""
say "Listo. Abre http://localhost:4400"
say "Las apps arrancan con tu sesión. Quitar: ./uninstall.sh"
