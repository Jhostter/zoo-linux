#!/usr/bin/env python3
"""ZOO Linux: lanzador común de la suite. Muestra las apps, su estado y consumo, y permite
abrirlas, iniciarlas, pararlas, reiniciarlas y ver sus logs. Solo biblioteca estándar."""
import glob, json, os, re, socket, subprocess, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import feed, health, maint, modes, ondemand, terminal

HOST = "127.0.0.1"
PORT = int(os.environ.get("ZOO_PORT", "4400"))
ROOT = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(ROOT, "static")
CONF = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config"), "zoo-linux", "apps.d")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,30}$")
SVC_RE = re.compile(r"^[A-Za-z0-9_.@:-]{1,80}$")
ACTIONS = {"start": ["start"], "stop": ["stop"], "restart": ["restart"],
           "autostart-on": ["enable"], "autostart-off": ["disable"]}
SELF_SERVICE = "zoo-linux"


def clean(a, source):
    """Valida un descriptor de app; devuelve dict normalizado o lanza ValueError."""
    if not isinstance(a, dict):
        raise ValueError("descriptor inválido")
    i, name, svc = a.get("id"), a.get("name"), a.get("service")
    port = a.get("port")
    if not isinstance(i, str) or not ID_RE.match(i):
        raise ValueError("id inválido (minúsculas, números y guiones)")
    if not isinstance(name, str) or not 1 <= len(name) <= 40:
        raise ValueError("nombre inválido")
    if not isinstance(svc, str) or not SVC_RE.match(svc):
        raise ValueError("servicio inválido")
    if svc.removesuffix(".service") == SELF_SERVICE:
        raise ValueError("no se puede registrar el propio lanzador")
    if not isinstance(port, int) or isinstance(port, bool) or not 1 <= port <= 65535:
        raise ValueError("puerto inválido")
    return {"id": i, "name": name, "emoji": str(a.get("emoji") or "🐾")[:8],
            "tagline": str(a.get("tagline") or "")[:160], "category": str(a.get("category") or "Otras")[:30],
            "port": port, "service": svc.removesuffix(".service"), "dir": str(a.get("dir") or "")[:200],
            "url": f"http://localhost:{port}", "source": source}


def app_dir(d):
    """Carpeta de una app: `~/…`, ruta absoluta o relativa a la carpeta del lanzador (`../apps/elephant`)."""
    d = os.path.expanduser(str(d))
    return d if os.path.isabs(d) else os.path.normpath(os.path.join(ROOT, d))


def load_apps():
    apps, errors = {}, []
    sources = [(os.environ.get("ZOO_APPS_FILE") or os.path.join(ROOT, "apps.default.json"), "default")] + [(f, "custom") for f in sorted(glob.glob(os.path.join(CONF, "*.json")))]
    for path, src in sources:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            for a in (data if isinstance(data, list) else [data]):
                try:
                    c = clean(a, src)
                    if src == "custom" and c["id"] in apps and apps[c["id"]]["source"] == "default":
                        continue  # los de fábrica no se pisan
                    apps[c["id"]] = c
                except ValueError as e:
                    errors.append(f"{os.path.basename(path)}: {e}")
        except (OSError, ValueError) as e:
            errors.append(f"{os.path.basename(path)}: {e}")
    return list(apps.values()), errors


def run(cmd, timeout=15):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr)
    except subprocess.TimeoutExpired:
        return 124, "tiempo agotado"
    except OSError:  # el programa no existe en este sistema
        return 127, "no existe " + str(cmd[0])


def port_open(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def read_int(path, key=None):
    try:
        with open(path) as f:
            txt = f.read()
        if key is None:
            return int(txt.strip())
        for l in txt.splitlines():
            if l.startswith(key + " "):
                return int(l.split()[1])
    except (OSError, ValueError):
        pass
    return None


_PREV = {}
_LOCK = threading.Lock()


def status():
    apps, errors = load_apps()
    out = {}
    if apps:
        _, txt = run(["systemctl", "--user", "show", *[a["service"] + ".service" for a in apps],
                      "-p", "Id,LoadState,ActiveState,SubState,UnitFileState,ControlGroup,ActiveEnterTimestampMonotonic,MainPID"])
        for block in txt.strip().split("\n\n"):
            kv = dict(l.split("=", 1) for l in block.splitlines() if "=" in l)
            if "Id" in kv:
                out[kv["Id"].removesuffix(".service")] = kv
    try:
        up_now = float(open("/proc/uptime").read().split()[0])
    except OSError:
        up_now = 0
    now = time.monotonic()
    listen_ports, _ = ondemand.net_ports()
    res = []
    with _LOCK:
        for a in apps:
            kv = out.get(a["service"], {})
            load, act = kv.get("LoadState", "not-found"), kv.get("ActiveState", "inactive")
            listening = a["port"] in listen_ports and not ondemand.armed(a["id"])
            if load == "not-found":
                state = "missing"
            elif act == "active":
                state = "running" if listening else "starting"
            elif act in ("activating", "reloading"):
                state = "starting"
            elif act == "failed":
                state = "failed"
            else:
                state = "standby" if ondemand.armed(a["id"]) else "stopped"
            mem = cpu = uptime = procs = None
            cg = kv.get("ControlGroup")
            if act == "active" and cg:
                base = "/sys/fs/cgroup" + cg
                try:
                    with open(os.path.join(base, "cgroup.procs")) as f:
                        procs = len(f.read().split())
                except OSError:
                    pass
                anon = read_int(os.path.join(base, "memory.stat"), "anon")
                mem = None if anon is None else anon // 1024
                usec = read_int(os.path.join(base, "cpu.stat"), "usage_usec")
                prev = _PREV.get(a["id"])
                if usec is not None:
                    if prev and now > prev[0]:
                        cpu = round(max(0.0, (usec - prev[1]) / 1e6 / (now - prev[0]) * 100), 1)
                    _PREV[a["id"]] = (now, usec)
                ts = kv.get("ActiveEnterTimestampMonotonic")
                if ts and ts.isdigit() and int(ts) > 0:
                    uptime = max(0, int(up_now - int(ts) / 1e6))
            else:
                _PREV.pop(a["id"], None)
            res.append({**a, "state": state, "autostart": kv.get("UnitFileState") == "enabled",
                        "mem_kb": mem, "cpu": cpu, "uptime": uptime, "procs": procs, "mode": "ondemand" if ondemand.is_ondemand(a["id"]) else "always", "note": ondemand.NOTES.get(a["id"]),
                        "dir_exists": bool(a["dir"]) and os.path.isdir(app_dir(a["dir"]))})
    return {"apps": res, "errors": errors, "config_dir": CONF}


def find(app_id):
    return next((a for a in load_apps()[0] if a["id"] == app_id), None)


def do_app(app_id, verb):
    """Inicia o detiene una app de la suite (servicio de usuario). Devuelve (ok, mensaje)."""
    a = find(app_id)
    if not a or verb not in ("start", "stop"):
        return False, "app o acción inválida"
    if verb == "start":
        ondemand.disarm(a["id"])  # el puerto guardado debe quedar libre antes de arrancar
        ondemand.unpark(a["id"])
    elif ondemand.is_ondemand(a["id"]):
        ondemand.park(a["id"])    # detenida a mano: no se vuelve a despertar sola hasta que se inicie
    code, txt = run(["systemctl", "--user", verb, a["service"] + ".service"], timeout=40)
    return code == 0, txt.strip()[:200]


def unread_cached():
    return health.cached("unread", 5, feed.unread)


class H(BaseHTTPRequestHandler):
    server_version = "ZooLinux"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text/", "application/j")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-src http://localhost:* http://127.0.0.1:*")
        self.end_headers()
        self.wfile.write(data)

    def _host_ok(self):
        ok = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
        if self.headers.get("Host") not in ok:
            return False
        o = self.headers.get("Origin")
        return o is None or o in {f"http://{h}" for h in ok}

    def _file(self, name, ctype):
        with open(os.path.join(STATIC, name), "rb") as f:
            self._send(200, f.read(), ctype)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "host no permitido"})
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/":
            return self._file("index.html", "text/html")
        if u.path == "/app.js":
            return self._file("app.js", "application/javascript")
        if u.path == "/style.css":
            return self._file("style.css", "text/css")
        if u.path == "/zoo-theme.css":
            return self._file("zoo-theme.css", "text/css")
        if u.path == "/api/apps":
            return self._send(200, {**status(), "unread": unread_cached()})
        if u.path == "/api/ondemand":
            return self._send(200, ondemand.info(status()["apps"]))
        if u.path == "/api/maintenance":
            return self._send(200, maint.state())
        if u.path == "/api/health":
            apps = status()["apps"]
            return self._send(200, {**health.collect(apps), "unread": unread_cached()})
        if u.path == "/api/feed":
            return self._send(200, feed.read(int(q.get("limit", ["150"])[0]) if q.get("limit", ["150"])[0].isdigit() else 150))
        if u.path == "/api/modes":
            return self._send(200, modes.listing(status()["apps"]))
        if u.path == "/api/logs":
            a = find(q.get("id", [""])[0])
            if not a:
                return self._send(404, {"error": "app desconocida"})
            code, txt = run(["journalctl", "--user", "-u", a["service"] + ".service", "-n", "200", "--no-pager", "-o", "short-iso"])
            return self._send(200, {"text": txt})
        self._send(404, {"error": "no encontrado"})

    def do_POST(self):
        if not self._host_ok() or self.headers.get("X-Zoo") != "1":
            return self._send(403, {"error": "no permitido"})
        u = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(min(n, 65536)) or b"{}")
        except Exception:
            return self._send(400, {"error": "JSON inválido"})
        if u.path == "/api/action":
            a = find(body.get("id", ""))
            act = body.get("action")
            if not a or act not in ACTIONS:
                return self._send(400, {"error": "acción o app inválida"})
            if act in ("start", "restart"):
                ondemand.disarm(a["id"])
                ondemand.unpark(a["id"])
            elif act == "stop" and ondemand.is_ondemand(a["id"]):
                ondemand.park(a["id"])
            code, txt = run(["systemctl", "--user", *ACTIONS[act], a["service"] + ".service"], timeout=40)
            return self._send(200 if code == 0 else 500, {"ok": code == 0, "output": txt.strip()[:500]})
        if u.path == "/api/ondemand":
            try:
                ondemand.save_cfg(body, {x["id"] for x in load_apps()[0]})
                return self._send(200, ondemand.info(status()["apps"]))
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        if u.path == "/api/maintenance/run":
            def done(st):
                sm = st["summary"]
                feed.add("Mantenimiento", "warn" if sm["attention"] else "info", f"Revisión completa: {sm['attention']} cosa(s) por atender" if sm["attention"] else "Revisión completa: todo en orden",
                         " · ".join(f"{c['title']}: {c['headline']}" for c in st["checks"] if c["status"] in ("warn", "bad"))[:300])
            return self._send(200, {"started": maint.start(done)})
        if u.path == "/api/terminal":
            try:
                return self._send(200, terminal.open_terminal(body.get("cmd"), body.get("title")))
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        if u.path == "/api/feed/read":
            feed.mark_read()
            health.cached("unread", 0, feed.unread)
            return self._send(200, {"ok": True})
        if u.path == "/api/feed/clear":
            feed.clear()
            return self._send(200, {"ok": True})
        if u.path in ("/api/modes/apply", "/api/modes/revert"):
            try:
                apps = status()["apps"]
                res = modes.apply(body.get("id"), apps, do_app) if u.path.endswith("apply") else modes.revert(apps, do_app)
                feed.add("Modos", "info" if res["ok"] else "warn", ("Modo «%s» activado" % res["name"]) if res["mode"] != "revert" else "Vuelta al estado anterior",
                         " · ".join(f"{x['step']}: {x['detail']}" for x in res["steps"]))
                return self._send(200, res)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
        if u.path == "/api/register":
            try:
                c = clean(body, "custom")
                if any(x["id"] == c["id"] for x in load_apps()[0]):
                    raise ValueError("ya existe una app con ese id")
                os.makedirs(CONF, exist_ok=True)
                keep = {k: c[k] for k in ("id", "name", "emoji", "tagline", "category", "port", "service", "dir")}
                with open(os.path.join(CONF, c["id"] + ".json"), "w", encoding="utf-8") as f:
                    json.dump(keep, f, ensure_ascii=False, indent=2)
            except ValueError as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, {"ok": True})
        if u.path == "/api/unregister":
            a = find(body.get("id", ""))
            if not a or a["source"] != "custom":
                return self._send(400, {"error": "solo se pueden quitar las apps añadidas por ti"})
            try:
                os.remove(os.path.join(CONF, a["id"] + ".json"))
            except OSError as e:
                return self._send(500, {"error": str(e)})
            return self._send(200, {"ok": True})
        self._send(404, {"error": "no encontrado"})


if __name__ == "__main__":
    threading.Thread(target=feed.vigia, args=(status,), daemon=True).start()
    threading.Thread(target=ondemand.manager, args=(status, lambda a, m: feed.add("Suite", "info", f"{a['name']} se apagó tras {m} min sin uso", "Se despierta sola en cuanto la abras.")), daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), H)
    print(f"ZOO Linux en http://localhost:{PORT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
