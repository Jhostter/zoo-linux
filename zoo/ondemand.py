"""Apps bajo demanda: ZOO mantiene paradas las apps que no se usan y las despierta al abrirlas.

* Una app «en espera» tiene su puerto guardado por ZOO. Si alguien lo abre (marcador, pestaña antigua, el marco de ZOO…), ZOO suelta el puerto,
  arranca el servicio y contesta con una pantalla «Despertando…» que recarga sola cuando la app responde.
* Una app en marcha que lleva N minutos sin tráfico (se mira /proc/net/tcp: sin conexiones nuevas en su puerto) y sin trabajo en curso
  (CPU baja, sin procesos hijos) se detiene sola y vuelve a quedar en espera.
* «Detener» a mano la deja apagada del todo (sin puerto guardado) hasta que la inicies.
No se modifica ninguna app: todo ocurre aquí y con lecturas baratas (sin sondear a las apps, que contaría como actividad)."""
import json, os, selectors, socket, subprocess, threading, time

CONF = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "zoo-linux", "ondemand.json")
DATA = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.expanduser("~/.local/share"), "zoo-linux")
STATEF = os.path.join(DATA, "ondemand-state.json")
DEFAULT = {"enabled": True, "idle_minutes": 20, "always": ["chameleon", "docker-kong"]}
# Apps con tareas que solo funcionan si están encendidas: se avisa en su tarjeta antes de dejarlas bajo demanda
NOTES = {"chameleon": "Vigila temperaturas y batería, guarda el historial y lanza los avisos: apagada, todo eso se pausa.",
         "docker-kong": "Tiene alertas de contenedores e historial activos: apagada, se pausan."}
SCALE = float(os.environ.get("ZOO_IDLE_SCALE", "60"))      # segundos por «minuto» (solo se cambia en pruebas)
TICK = float(os.environ.get("ZOO_OD_TICK", "30"))
WAKE_GRACE = float(os.environ.get("ZOO_WAKE_GRACE", "45"))  # tras despertar una app no se vuelve a guardar su puerto durante este tiempo
SELF = "zoo-linux"
_L = threading.RLock()
_S = {"parked": [], "mem": {}}      # parked: apps detenidas a mano; mem: última RAM vista (KB) para estimar el ahorro
_woken, _last_seen, _prev_tick = {}, {}, {}


# ---------- configuración ----------
def get_cfg():
    cfg = json.loads(json.dumps(DEFAULT))
    try:
        with open(CONF, encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d.get("enabled"), bool):
            cfg["enabled"] = d["enabled"]
        if isinstance(d.get("idle_minutes"), int) and not isinstance(d["idle_minutes"], bool) and 2 <= d["idle_minutes"] <= 240:
            cfg["idle_minutes"] = d["idle_minutes"]
        if isinstance(d.get("always"), list) and all(isinstance(x, str) for x in d["always"]):
            cfg["always"] = d["always"]
    except (OSError, ValueError):
        pass
    return cfg


def save_cfg(patch, app_ids):
    cfg = get_cfg()
    if not isinstance(patch, dict):
        raise ValueError("ajustes inválidos")
    for k, v in patch.items():
        if k == "enabled":
            if not isinstance(v, bool):
                raise ValueError("enabled debe ser verdadero o falso")
            cfg[k] = v
        elif k == "idle_minutes":
            if isinstance(v, bool) or not isinstance(v, int) or not 2 <= v <= 240:
                raise ValueError("idle_minutes debe estar entre 2 y 240")
            cfg[k] = v
        elif k == "always":
            if not isinstance(v, list) or any(x not in app_ids for x in v):
                raise ValueError("always contiene apps desconocidas")
            cfg[k] = sorted(set(v))
        else:
            raise ValueError(f"ajuste desconocido: {k}")
    os.makedirs(os.path.dirname(CONF), exist_ok=True)
    tmp = CONF + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=1)
    os.replace(tmp, CONF)
    return cfg


def is_ondemand(app_id):
    cfg = get_cfg()
    return cfg["enabled"] and app_id != SELF and app_id not in cfg["always"]


# ---------- estado persistente ----------
def _load():
    try:
        with open(STATEF) as f:
            d = json.load(f)
        _S["parked"] = [x for x in d.get("parked", []) if isinstance(x, str)]
        _S["mem"] = {k: v for k, v in (d.get("mem") or {}).items() if isinstance(v, int)}
    except (OSError, ValueError):
        pass


def _save():
    os.makedirs(DATA, exist_ok=True)
    tmp = STATEF + ".tmp"
    with open(tmp, "w") as f:
        json.dump(_S, f)
    os.replace(tmp, STATEF)


_load()


def park(app_id):
    with _L:
        if app_id not in _S["parked"]:
            _S["parked"].append(app_id)
            _save()
    disarm(app_id)


def unpark(app_id):
    with _L:
        if app_id in _S["parked"]:
            _S["parked"].remove(app_id)
            _save()


def parked(app_id):
    return app_id in _S["parked"]


# ---------- lectura de /proc/net/tcp (sin abrir conexiones: sondear contaría como actividad) ----------
def net_ports():
    """(puertos en escucha, puertos locales con conexiones vivas o recientes)."""
    listen, active = set(), set()
    for f in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(f) as fh:
                next(fh)
                for l in fh:
                    p = l.split()
                    port, st = int(p[1].rsplit(":", 1)[1], 16), p[3]
                    (listen if st == "0A" else active).add(port)
        except (OSError, ValueError, StopIteration):
            pass
    return listen, active


# ---------- puerto guardado ----------
class Holder:
    def __init__(self):
        self.socks, self.apps, self.cmds = {}, {}, []
        self.sel = selectors.DefaultSelector()
        self.r, self.w = socket.socketpair()
        self.r.setblocking(False)
        self.sel.register(self.r, selectors.EVENT_READ, None)
        self.thread = threading.Thread(target=self.loop, daemon=True)
        self.thread.start()

    def _poke(self):
        try:
            self.w.send(b"x")
        except OSError:
            pass

    def arm(self, app):
        with _L:
            if app["id"] in self.socks:
                return True
            s = socket.socket()
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", app["port"]))
                s.listen(16)
            except OSError:
                s.close()
                return False
            s.setblocking(False)
            self.socks[app["id"]] = s
            self.apps[app["id"]] = app
            self.cmds.append(("add", app["id"]))
        self._poke()
        return True

    def _drop(self, sock):
        try:
            self.sel.unregister(sock)
        except (KeyError, ValueError):
            pass
        try:
            sock.close()
        except OSError:
            pass

    def disarm(self, app_id):
        """Cierra el puerto guardado y vuelve solo cuando está realmente cerrado (el servicio que arranca después necesita poder usarlo)."""
        with _L:
            s = self.socks.pop(app_id, None)
            self.apps.pop(app_id, None)
        if not s:
            return False
        if threading.current_thread() is self.thread:
            self._drop(s)
        else:
            ev = threading.Event()
            with _L:
                self.cmds.append(("del", (s, ev)))
            self._poke()
            ev.wait(2)
        return True

    def armed(self, app_id):
        return app_id in self.socks

    def loop(self):
        registered = {}
        while True:
            with _L:
                cmds, self.cmds = self.cmds, []
            for kind, x in cmds:
                if kind == "add":
                    s = self.socks.get(x)
                    if s:
                        try:
                            self.sel.register(s, selectors.EVENT_READ, x)
                            registered[x] = s
                        except (ValueError, KeyError):
                            pass
                else:
                    self._drop(x[0])
                    x[1].set()
            for key, _ in self.sel.select(timeout=30):
                if key.data is None:
                    try:
                        key.fileobj.recv(4096)
                    except OSError:
                        pass
                    continue
                try:
                    conn, _ = key.fileobj.accept()
                except OSError:
                    continue
                try:
                    self.on_connect(key.data, conn)
                except Exception:
                    pass
                finally:
                    try:
                        conn.close()
                    except OSError:
                        pass

    def on_connect(self, app_id, conn):
        app = self.apps.get(app_id)
        if not app:
            return
        conn.settimeout(0.6)
        try:
            data = conn.recv(8192)
        except (socket.timeout, OSError):
            return                      # conexión especulativa del navegador (sin petición): no se despierta nada
        if not data:
            return
        head = data.split(b"\r\n\r\n")[0].decode("latin-1", "replace")
        lines = head.split("\r\n")
        hdr = {k.strip().lower(): v.strip() for k, v in (l.split(":", 1) for l in lines[1:] if ":" in l)}
        port = app["port"]
        if hdr.get("host") not in (f"localhost:{port}", f"127.0.0.1:{port}"):
            conn.sendall(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
            return
        method, path = (lines[0].split(" ") + ["", ""])[:2]
        wake(app)                       # suelta el puerto y arranca el servicio
        if method == "GET" and "text/html" in hdr.get("accept", ""):
            body = splash(app).encode()
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Zoo-Wake: 1\r\nConnection: close\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)
        else:
            body = json.dumps({"error": f"{app['name']} estaba en reposo y se está despertando: vuelve a intentarlo en unos segundos."}).encode()
            conn.sendall(b"HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\nRetry-After: 2\r\nX-Zoo-Wake: 1\r\nConnection: close\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)


def splash(app):
    nm = app["name"].replace("<", "&lt;")
    return f'''<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{nm}</title>
<style>:root{{color-scheme:dark light}}body{{margin:0;min-height:100vh;display:grid;place-items:center;font:15px system-ui,sans-serif;background:#0f1115;color:#e8eaee}}
@media(prefers-color-scheme:light){{body{{background:#f4f5f7;color:#1b2027}}}}.b{{text-align:center;padding:24px}}.e{{font-size:56px;animation:p 1.2s infinite}}@keyframes p{{50%{{transform:scale(1.12);opacity:.7}}}}
small{{opacity:.65}}</style><div class="b"><div class="e">{app["emoji"]}</div><h2 id="t">Despertando {nm}…</h2><small id="s">Estaba en reposo para ahorrar memoria. Un momento.</small></div>
<script>const t0=Date.now();(async function poll(){{try{{const r=await fetch("/zoo-wake-ping",{{cache:"no-store"}});if(!r.headers.get("x-zoo-wake")){{location.reload();return}}}}catch(e){{}}
if(Date.now()-t0>60000){{document.getElementById("t").textContent="No ha arrancado";document.getElementById("s").textContent="Mira sus registros desde ZOO Linux → Apps → Logs.";return}}setTimeout(poll,700)}})()</script></html>'''


_holder = None


def holder():
    global _holder
    if _holder is None:
        _holder = Holder()
    return _holder


def arm(app):
    return holder().arm(app)


def disarm(app_id):
    return holder().disarm(app_id) if _holder else False


def armed(app_id):
    return bool(_holder and _holder.armed(app_id))


def wake(app):
    """Suelta el puerto y arranca el servicio (no espera)."""
    disarm(app["id"])
    unpark(app["id"])
    _woken[app["id"]] = time.time()
    _last_seen[app["id"]] = time.time()
    subprocess.Popen(["systemctl", "--user", "start", app["service"] + ".service"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def ensure_running(app, timeout=40):
    """Para usos explícitos del usuario (p. ej. mantenimiento): despierta la app y espera a que responda."""
    listen, _ = net_ports()
    if app["port"] in listen and not armed(app["id"]):
        return True
    wake(app)
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(0.5)
        if app["port"] in net_ports()[0] and not armed(app["id"]):
            return True
    return False


# ---------- gestor: guarda puertos y apaga lo que no se usa ----------
def standby(app_id):
    return armed(app_id)


def saved_kb(apps):
    return sum(_S["mem"].get(a["id"], 0) for a in apps if a.get("state") == "standby")


def tick(get_apps, on_event):
    cfg = get_cfg()
    now = time.time()
    listen, active = net_ports()
    for a in get_apps()["apps"]:
        i = a["id"]
        if i == SELF or a["state"] == "missing":
            continue
        od = is_ondemand(i)
        svc_active = a["state"] in ("running", "starting")
        if a.get("mem_kb") and a["state"] == "running":
            old = _S["mem"].get(i)
            if old is None or abs(a["mem_kb"] - old) > max(old, 1) * 0.15:  # solo si cambia de verdad: evita reescribir el archivo a cada pasada
                _S["mem"][i] = a["mem_kb"]
                _save()
        if not od:
            disarm(i)
            continue
        if svc_active:
            disarm(i)
            busy = (a.get("cpu") or 0) > 3 or (a.get("procs") or 1) > 1
            if a["port"] in active or busy or i not in _last_seen:
                _last_seen[i] = now
            if a["state"] == "running" and now - _last_seen[i] > cfg["idle_minutes"] * SCALE and now - _woken.get(i, 0) > WAKE_GRACE:
                r = subprocess.run(["systemctl", "--user", "stop", a["service"] + ".service"], capture_output=True, timeout=40)
                if r.returncode == 0:
                    on_event(a, cfg["idle_minutes"])
                    time.sleep(0.4)
                    arm(a)
        elif a["state"] in ("stopped", "standby") and not parked(i) and now - _woken.get(i, 0) > WAKE_GRACE:
            if a["port"] not in listen or armed(i):
                arm(a)
        else:
            disarm(i)


def manager(get_apps, on_event):
    time.sleep(3)
    while True:
        try:
            tick(get_apps, on_event)
        except Exception:
            pass
        time.sleep(TICK)


def info(apps):
    cfg = get_cfg()
    return {**cfg, "saved_kb": saved_kb(apps), "apps": {a["id"]: {"mode": "ondemand" if is_ondemand(a["id"]) else "always", "standby": a.get("state") == "standby", "parked": parked(a["id"]), "note": NOTES.get(a["id"])} for a in apps if a["id"] != SELF}}
