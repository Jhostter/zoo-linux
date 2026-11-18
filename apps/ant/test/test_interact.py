#!/usr/bin/env python3
"""Interacción con los agentes: efectos teatrales, comandos del público (Twitch/bots), bono de tokens, recados y ficha de agente.
Arranca un servidor aislado con agy falso e IRC falso. Uso: python3 test/test_interact.py"""
import json, os, shlex, socket, subprocess, sys, tempfile, threading, time, urllib.request, urllib.error
from pathlib import Path
HERE = Path(__file__).resolve().parent
T = Path(tempfile.mkdtemp(prefix="ant-int-"))
env = dict(os.environ)
for kv in shlex.split(subprocess.run([sys.executable, str(HERE / "ui_env.py"), str(T)], capture_output=True, text=True, check=True).stdout):
    k, v = kv.split("=", 1); env[k] = v
PORT = 4597; env["ANT_PORT"] = str(PORT); env["ANT_MAX_RUNS"] = "6"; env["ANT_CHAT_FILE"] = str(T / "chat.json"); env["ANT_OFFICE_FILE"] = str(T / "office.json")
BASE = f"http://127.0.0.1:{PORT}"

# ---- IRC falso (Twitch): acepta la conexión, saluda con PING y manda comandos del público
GO = threading.Event()
irc_log, irc_srv = [], socket.socket(); irc_srv.bind(("127.0.0.1", 0)); irc_srv.listen(1); IRC_PORT = irc_srv.getsockname()[1]
def irc():
    c, _ = irc_srv.accept(); c.settimeout(10); buf = b""
    while b"JOIN" not in buf: buf += c.recv(4096)
    irc_log.append(buf.decode()); c.sendall(b"PING :tmi.twitch.tv\r\n")
    GO.wait(120)
    for u, t in (("espectador1", "!latigo coordinator"), ("espectador1", "!cafe coordinator"), ("otro_user", "!aplaudir 1"), ("troll", "!stop todo"), ("troll2", "hola a todos")):
        c.sendall(f":{u}!{u}@{u}.tmi.twitch.tv PRIVMSG #micanal :{t}\r\n".encode()); time.sleep(2.3)
    time.sleep(30)
threading.Thread(target=irc, daemon=True).start()
env.update(ANT_TWITCH_CHANNEL="micanal", ANT_TWITCH_HOST="127.0.0.1", ANT_TWITCH_PORT=str(IRC_PORT), ANT_TWITCH_TLS="0")
srv = subprocess.Popen([sys.executable, str(HERE.parent / "server.py")], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def call(path, body=None, headers=None):
    h = {"X-Ant": "1", "Content-Type": "application/json"} if headers is None else headers
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=h, method="GET" if body is None else "POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r: return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b"{}")
def wait(fn, secs=30, what=""):
    t0 = time.time()
    while time.time() - t0 < secs:
        try:
            v = fn()
            if v: return v
        except Exception: pass
        time.sleep(0.4)
    raise AssertionError("timeout: " + what)
fails = []
def check(name, cond, extra=""):
    print(("  ok  " if cond else "FALLA ") + name + (f"  [{extra}]" if not cond and extra else ""))
    if not cond: fails.append(name)

try:
    wait(lambda: call("/api/office")[0] == 200, 20, "servidor")
    demo = next(w for w in call("/api/workspaces")[1]["workspaces"] if w["name"] == "demo-app")["path"]
    print("== Efectos teatrales")
    code, r = call("/api/office/fx", {"kind": "whip", "target": "run:x"}, headers={})
    check("sin la cabecera X-Ant no se acepta ningún efecto", code == 403)
    code, r = call("/api/office/fx", {"kind": "explotar"}); check("un efecto desconocido se rechaza", code == 400)
    ws0 = call("/api/office")[1]; s0 = ws0["fx_seq"]
    for k in ("whip", "coffee", "praise", "scold", "focus"): code, r = call("/api/office/fx", {"kind": k, "target": "sw:x:y"}); assert code == 200
    st = call("/api/office")[1]
    check("los 5 efectos quedan en la cola que lee la oficina del stream, en orden", [e["kind"] for e in st["fx"][-5:]] == ["whip", "coffee", "praise", "scold", "focus"] and st["fx_seq"] == s0 + 5)
    check("el látigo dirigido suma al marcador de latigazos", st["stats"]["whips"] >= ws0["stats"]["whips"] + 1)

    print("== Comandos del público")
    ids = [w["id"] for w in st["workers"]]; check("hay agentes de prueba (enjambre de ejemplo)", len(ids) >= 3, str(ids))
    code, r = call("/api/office/command", {"text": "!latigo coordinator", "user": "ana"})
    ev = call("/api/office")[1]["fx"][-1]
    check("«!latigo coordinator» azota al coordinador y atribuye el efecto a la espectadora", r.get("ok") and ev["kind"] == "whip" and ev["target"].endswith(":coordinator") and ev["user"] == "ana", json.dumps(r))
    time.sleep(2.2); code, r = call("/api/office/command", {"text": "!cafe parser", "user": "ana"}); check("el mismo usuario no puede repetir en seguida (enfriamiento por usuario)", not r["ok"] and "espera" in r.get("error", ""), json.dumps(r))
    code, r = call("/api/office/command", {"text": "!latigo todos", "user": "bea"}); time.sleep(0)
    check("«todos» solo vale para el látigo y entra como 'all'", (r.get("ok") and r["target"] == "all") or "Demasiados" in r.get("error", ""), json.dumps(r))
    time.sleep(2.2)
    code, r = call("/api/office/command", {"text": "!aplaudir 1", "user": "cris"}); check("un número elige al agente nº N", r.get("ok") and r["kind"] == "praise", json.dumps(r))
    time.sleep(2.2); code, r = call("/api/office/command", {"text": "!reganar fantasma", "user": "dani"}); check("un agente que no existe se contesta con un error claro", not r["ok"] and "no encuentro" in r["error"], json.dumps(r))
    code, r = call("/api/office/command", {"text": "!ayuda", "user": "eva"}); check("«!ayuda» lista los comandos", r.get("ok") and "!latigo" in r["reply"])
    n0 = len(call("/api/runs")[1]["runs"]); seq0 = call("/api/office")[1]["fx_seq"]
    for t in ("!stop todo", "!lanzar hacer algo", "!bono 1000000", "!despedir parser", "hola"):
        code, r = call("/api/office/command", {"text": t, "user": "troll"}); assert r.get("ignored"), t
    check("el público NO puede disparar acciones reales (detener, lanzar, bono, despedir): se ignoran y no generan efecto", len(call("/api/runs")[1]["runs"]) == n0 and call("/api/office")[1]["fx_seq"] == seq0)
    code, r = call("/api/office/command", {"text": "!" + "x" * 300, "user": "troll"}); check("mensajes enormes se ignoran", r.get("ignored"))
    check("los nombres de usuario se sanean", call("/api/office/chat")[1]["recent"][0]["user"].replace("_", "").isalnum())

    print("== Chat de Twitch (IRC anónimo de solo lectura)")
    cs = wait(lambda: (lambda s: s if s["twitch"]["connected"] else None)(call("/api/office/chat")[1]), 15, "conexión IRC")
    check("se conecta al canal sin credenciales (usuario anónimo justinfan, contraseña de cortesía)", "NICK justinfan" in irc_log[0] and "JOIN #micanal" in irc_log[0] and cs["twitch"]["channel"] == "micanal")
    GO.set(); users = []
    def seen():
        global users
        users = [e["user"] for e in call("/api/office")[1]["fx"] if e.get("user") in ("espectador1", "otro_user", "troll", "troll2")]
        return "otro_user" in users
    wait(seen, 20, "comandos del chat"); time.sleep(5)  # deja pasar también los ignorados
    check("los comandos del chat llegan como efectos (y el PING se contesta: la conexión sigue viva)", "espectador1" in users and "otro_user" in users and "troll" not in users and call("/api/office/chat")[1]["twitch"]["connected"], str(users))
    check("el enfriamiento por usuario también aplica al chat (el 2º comando seguido de espectador1 se descarta)", users.count("espectador1") == 1, str(users))

    print("== Bono de tokens, recados y ficha del agente")
    r1 = call("/api/run", {"path": demo, "prompt": "SLEEP4 tarea con presupuesto", "isolation": "inherit", "token_budget": 100000})[1]
    rid = r1["id"]; wid = "run:" + rid
    d = wait(lambda: (lambda x: x if x.get("tokens") else None)(call("/api/office/agent?id=" + wid)[1]), 20, "uso medido")
    check("la ficha de un agente lanzado desde Ant trae rol, estado, tokens, pasos y presupuesto reales", d["kind"] == "run" and d["status"] == "running" and d["tokens"] > 0 and d["steps"] >= 1 and d["budget"] == 100000 and d["ws_name"] == "demo-app", json.dumps({k: d[k] for k in ("status", "tokens", "steps", "budget")}))
    check("dice qué puede hacerse: detener, bono y recado sí; reanudar no (sigue en marcha)", d["can"]["stop"]["ok"] and d["can"]["bonus"]["ok"] and d["can"]["message"]["ok"] and not d["can"]["resume"]["ok"])
    code, r = call("/api/run/bonus", {"id": rid, "tokens": 50000}); check("un bono amplía el presupuesto de una ejecución en marcha", code == 200 and r["token_budget"] == 150000, json.dumps(r))
    code, r = call("/api/run/bonus", {"id": rid, "tokens": 10}); check("un bono ridículo o desorbitado se rechaza", code == 400)
    code, r = call("/api/run/message", {"id": rid, "text": "Cuando acabes, añade un test.", "to": "implementer"}); check("un recado a un agente en pleno turno queda EN COLA (no se puede hablar a mitad de turno)", code == 200 and r.get("queued"), json.dumps(r))
    check("la ficha lo refleja", call("/api/office/agent?id=" + wid)[1]["pending_message"])
    f = wait(lambda: next((x for x in call("/api/runs")[1]["runs"] if x.get("followup_of") == rid), None), 30, "recado entregado")
    check("al terminar el turno el recado se envía solo continuando la MISMA conversación (agy --conversation)", f["conv"] and "--conversation" in Path(os.environ.get("ANT_DATA", str(T / "data")) if False else env["ANT_DATA"], "runs", f["id"], "out.log").read_text() and "Recado del jefe para implementer" in Path(env["ANT_DATA"], "runs", f["id"], "out.log").read_text())
    check("la ejecución de continuación hereda carpeta y modelo y no lleva presupuesto propio", f["cwd"] and f["token_budget"] == 0 and f["isolation"] == "inherit")
    code, r = call("/api/run/message", {"id": rid, "text": "otro recado directo"}); check("si el agente ya terminó bien, el recado se envía al momento", code == 200 and r.get("sent") and r.get("run"), json.dumps(r))
    r2 = call("/api/run", {"path": demo, "prompt": "SLOW parar", "isolation": "inherit", "token_budget": 100000})[1]
    wait(lambda: call("/api/office/agent?id=run:" + r2["id"])[1].get("tokens"), 20, "uso")
    code, r = call("/api/run/stop", {"id": r2["id"]}); wait(lambda: call("/api/run/" + r2["id"])[1]["status"] == "stopped", 20, "detenida")
    code, r = call("/api/run/message", {"id": r2["id"], "text": "hola"}); check("a una ejecución detenida no se le puede mandar un recado (explica por qué)", code == 409 and "stopped" in r["error"], json.dumps(r))
    code, r = call("/api/run/bonus", {"id": r2["id"], "tokens": 5000}); check("ni ampliarle el presupuesto: hay que reanudarla", code == 409)
    print("== Efectos reales opcionales del jefe (felicitar = bono, regañar = recado)")
    r3 = call("/api/run", {"path": demo, "prompt": "SLEEP4 para el jefe", "isolation": "inherit", "token_budget": 100000})[1]; wid3 = "run:" + r3["id"]
    wait(lambda: call("/api/office/agent?id=" + wid3)[1].get("tokens"), 20, "uso")
    q0 = call("/api/office")[1]["fx_seq"]
    code, r = call("/api/office/boss", {"kind": "praise", "target": wid3}); b0 = call("/api/run/" + r3["id"])[1]["token_budget"]
    check("felicitar SIN pedir efecto real es solo teatro: el efecto sale en la oficina y el presupuesto no cambia", code == 200 and r["real"] is None and call("/api/office")[1]["fx_seq"] == q0 + 1 and b0 == 100000, json.dumps(r))
    code, r = call("/api/office/boss", {"kind": "praise", "target": wid3, "real": True, "tokens": 30000})
    check("felicitar CON efecto real da el bono de tokens y además sale el efecto teatral", code == 200 and r["real"]["ok"] and r["real"]["tokens"] == 30000 and call("/api/run/" + r3["id"])[1]["token_budget"] == 130000 and call("/api/office")[1]["fx"][-1]["kind"] == "praise", json.dumps(r))
    check("el bono queda anotado como del jefe", [b["by"] for b in call("/api/run/" + r3["id"])[1]["bonuses"]] == ["boss"])
    code, r = call("/api/office/boss", {"kind": "praise", "target": wid3, "real": True, "tokens": 5})
    check("una cantidad ridícula se sube al mínimo (10 000) y una desorbitada se recorta (200 000)", r["real"]["tokens"] == 10000, json.dumps(r))
    code, r = call("/api/office/boss", {"kind": "praise", "target": wid3, "real": True, "tokens": 9999999}); check("tope de 200 000", r["real"]["tokens"] == 200000)
    code, r = call("/api/office/boss", {"kind": "praise", "target": wid3, "real": True})
    check("a los 3 bonos del jefe se niega el 4.º (no gastar cuota por un clic de broma), pero el efecto teatral sí ocurre", r["ok"] and not r["real"]["ok"] and "3 bonos" in r["real"]["error"], json.dumps(r))
    code, r = call("/api/office/boss", {"kind": "scold", "target": wid3, "real": True, "text": "ve más rápido"})
    d3 = call("/api/office/agent?id=" + wid3)[1]
    check("regañar CON efecto real deja un recado en cola para ese agente (se enviará al terminar su turno)", r["real"]["ok"] and r["real"].get("queued") and d3["pending_message"], json.dumps(r))
    f3 = wait(lambda: next((x for x in call("/api/runs")[1]["runs"] if x.get("followup_of") == r3["id"] and "regaña" in x["prompt"]), None), 40, "recado de la bronca entregado")
    check("el recado entregado lleva la bronca y el texto del jefe", "ve más rápido" in f3["prompt"] and "Recado del jefe" in f3["prompt"], f3["prompt"][:120])
    code, r = call("/api/office/boss", {"kind": "scold", "target": wid3})
    check("regañar sin efecto real no manda nada (solo teatro)", r["real"] is None)
    swp = next(w for w in call("/api/office")[1]["workers"] if w["id"].startswith("sw:") and w["id"].endswith(":parser"))
    code, r = call("/api/office/boss", {"kind": "praise", "target": swp["id"], "real": True})
    check("a un miembro de enjambre no lanzado desde Ant no se le da bono (explica por qué), aunque haya teatro", r["ok"] and not r["real"]["ok"] and "desde Ant" in r["real"]["error"], json.dumps(r))
    code, r = call("/api/office/boss", {"kind": "praise", "target": "demo3", "real": True}); check("un agente de ejemplo o figurante: sin efecto real", not r["real"]["ok"] and "reales" in r["real"]["error"])
    code, r = call("/api/office/boss", {"kind": "explotar", "target": wid3}); check("acciones desconocidas se rechazan", code == 400)
    code, r = call("/api/office/boss", {"kind": "praise", "target": wid3, "real": True}, headers={}); check("sin cabecera X-Ant no hay acción del jefe", code == 403)
    code, r = call("/api/office/command", {"text": "!aplaudir 1 real", "user": "troll9"}); b1 = call("/api/run/" + r3["id"])[1]["token_budget"]
    check("el público NUNCA da efecto real: sus comandos de felicitar/regañar no tocan el presupuesto ni mandan recados", b1 == 100000 + 30000 + 10000 + 200000)
    sw = next(w for w in call("/api/office")[1]["workers"] if w["id"].startswith("sw:") and w["id"].endswith(":parser"))
    d = call("/api/office/agent?id=" + sw["id"])[1]
    check("la ficha de un miembro de enjambre muestra su último mensaje del tablero y que no se lanzó desde Ant", d["kind"] == "swarm" and d["last_message"] and not d["can"]["stop"]["ok"] and "desde Ant" in d["can"]["stop"]["why"], json.dumps({k: d[k] for k in ("kind", "last_message")}))
    code, r = call("/api/office/agent?id=zzz"); check("un identificador raro da error, no un fallo", code == 400)
    code, r = call("/api/office/agent?id=sw:ffffffff:nadie"); check("un agente que ya no existe da 404", code == 404)
    # ---- estilo visual de la oficina
    code, r = call("/api/office/style"); check("por defecto el estilo es voxel y se listan los 3", r["style"] == "voxel" and r["styles"] == ["voxel", "toon", "cyber"], json.dumps(r))
    code, r = call("/api/office/style", {"style": "toon"}); check("cambiar a toon se acepta", code == 200 and r["style"] == "toon")
    check("el estado de la oficina (que sondea el stream/OBS) lleva el estilo", call("/api/office")[1]["style"] == "toon")
    code, r = call("/api/office/style", {"style": "vaporwave"}); check("un estilo desconocido se rechaza", code == 400)
    code, r = call("/api/office/style", {"style": "cyber"}, headers={}); check("sin cabecera X-Ant no se cambia el estilo", code == 403 and call("/api/office/style")[1]["style"] == "toon")
    check("el estilo se guarda en disco (sobrevive a reinicios)", json.loads((T / "office.json").read_text())["style"] == "toon")
finally:
    srv.terminate()
print(f"\nRESULTADO: {'TODO OK' if not fails else str(len(fails)) + ' fallos: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
