#!/usr/bin/env python3
"""Humo de la suite: arranca cada app desde esta carpeta, con un HOME vacío y puertos libres, y comprueba que responde
(página principal + un endpoint JSON) sin errores en el log. No toca tus servicios ni tus datos.  Uso: python3 test/smoke.py [--bare]
--bare: PATH vacío (como un sistema sin apt, systemctl, nvidia-smi, flatpak…): las apps deben degradar con elegancia, no caerse."""
import json, os, socket, subprocess, sys, tempfile, time, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# (carpeta, variable de puerto, endpoint JSON que debe responder 200)
APPS = [("zoo", "ZOO_PORT", "/api/apps"), ("apps/elephant", "ELEPHANT_PORT", "/api/overview"), ("apps/bee", "BEE_PORT", "/api/units?scope=user&type=service"),
        ("apps/beaver", "BEAVER_PORT", "/api/overview"), ("apps/chameleon", "CHAMELEON_PORT", "/api/status"),
        ("apps/horse-pack", "GESTOR_PAQUETES_PORT", "/api/sources"), ("apps/ant", "ANT_PORT", "/api/home")]


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def get(port, path, timeout=20):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=timeout) as r:
        return r.status, r.read()


fails = []
def check(name, ok, extra=""):
    print(("  ok  " if ok else "FALLA ") + name + (f"  [{extra}]" if extra and not ok else ""))
    if not ok: fails.append(name)


BARE = "--bare" in sys.argv
home = tempfile.mkdtemp(prefix="zoo-smoke-")
for sub in ("data", "config"): os.makedirs(os.path.join(home, sub))
for folder, var, ep in APPS:
    port = free_port()
    env = {**os.environ, "HOME": home, "XDG_DATA_HOME": os.path.join(home, "data"), "XDG_CONFIG_HOME": os.path.join(home, "config"), var: str(port), "ZOO_PORT": str(free_port())}
    if BARE: env["PATH"] = "/nonexistent"
    env["ZOO_PORT"] = str(port) if var == "ZOO_PORT" else env["ZOO_PORT"]
    log = open(os.path.join(home, os.path.basename(folder) + ".log"), "w+")
    p = subprocess.Popen([sys.executable, os.path.join(ROOT, folder, "server.py")], env=env, stdout=log, stderr=subprocess.STDOUT, cwd=home)
    try:
        up = False
        for _ in range(60):
            if p.poll() is not None: break
            try: get(port, "/", 3); up = True; break
            except Exception: time.sleep(0.5)
        check(f"{folder}: arranca y sirve la página principal", up, "murió" if p.poll() is not None else "sin respuesta")
        if up:
            try:
                st, body = get(port, ep); json.loads(body); check(f"{folder}: {ep} responde JSON", st == 200)
            except Exception as e:
                check(f"{folder}: {ep} responde JSON", False, str(e)[:120])
    finally:
        p.terminate()
        try: p.wait(5)
        except Exception: p.kill()
        log.seek(0); txt = log.read()
        check(f"{folder}: sin excepciones en el log", "Traceback" not in txt, txt[-300:])
print(f"\nRESULTADO: {'TODO OK' if not fails else str(len(fails)) + ' fallos: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
