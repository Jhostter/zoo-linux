"""Abrir una terminal con un comando `sudo …` para que el usuario lo revise y lo ejecute allí (donde sí puede escribir su contraseña).
La terminal siempre muestra el comando entero y pregunta antes de ejecutarlo: nada corre sin que el usuario diga que sí."""
import os, shutil, subprocess

MAX_LEN = 20000
WRAP = r'''
printf '\n  %s\n\n' "$2"
printf '%s\n\n' "$1"
printf '¿Ejecutar este comando? [s/N] '
read r
case "$r" in
  s|S|y|Y|si|SI|sí|Sí) sh -c "$1"; rc=$?; printf '\n(terminó con código %s)\n' "$rc";;
  *) printf 'No se ejecutó nada.\n';;
esac
printf 'Pulsa Enter para cerrar '
read x
'''


def terminal_argv(cmd, title):
    """Orden de lanzamiento del emulador de terminal disponible (ZOO_TERMINAL permite forzar uno, p. ej. en pruebas)."""
    inner = ["sh", "-c", WRAP, "sh", cmd, title]
    forced = os.environ.get("ZOO_TERMINAL")
    if forced:
        return forced.split() + inner
    if shutil.which("cosmic-term"):
        return ["cosmic-term", "--"] + inner
    if shutil.which("gnome-terminal"):
        return ["gnome-terminal", "--"] + inner
    if shutil.which("kitty"):
        return ["kitty"] + inner
    if shutil.which("x-terminal-emulator"):
        return ["x-terminal-emulator", "-e"] + inner
    return None


def open_terminal(cmd, title="ZOO Linux"):
    if not isinstance(cmd, str) or not cmd.startswith("sudo ") or "\0" in cmd or len(cmd) > MAX_LEN:
        raise ValueError("solo se aceptan comandos que empiecen por «sudo »")
    title = str(title or "ZOO Linux")[:60].replace("\n", " ")
    argv = terminal_argv(cmd, "Comando propuesto por " + title)
    if not argv:
        raise ValueError("No encuentro ningún emulador de terminal instalado.")
    subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {"ok": True, "terminal": os.path.basename(argv[0])}
