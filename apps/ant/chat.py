"""Comandos del público para la oficina del stream.

SOLO efectos teatrales (látigo, café, aplauso, bronca, cámara): el público NUNCA dispara acciones reales
(detener, lanzar, gastar tokens). Los comandos llegan por dos vías:
  - Chat de Twitch, leído de forma anónima (IRC de solo lectura, sin credenciales): ANT_TWITCH_CHANNEL o ~/.config/ant/chat.json
  - POST /api/office/command {text, user}: para cualquier otro bot (YouTube, Nightbot, StreamElements…).
"""
import json
import os
import random
import re
import socket
import ssl
import threading
import time
import unicodedata
from pathlib import Path

HOME = Path.home()
CONFIG_FILE = Path(os.environ.get("ANT_CHAT_FILE") or HOME / ".config" / "ant" / "chat.json")

# alias -> efecto. Los textos se comparan sin tildes ni mayúsculas.
ALIASES = {
    "latigo": "whip", "whip": "whip", "azota": "whip", "azotar": "whip",
    "cafe": "coffee", "coffee": "coffee",
    "aplaudir": "praise", "aplauso": "praise", "felicitar": "praise", "clap": "praise", "praise": "praise",
    "reganar": "scold", "bronca": "scold", "scold": "scold",
    "camara": "focus", "cam": "focus", "focus": "focus", "enfoca": "focus",
}
NEEDS_TARGET = {"whip", "coffee", "praise", "scold"}  # sin objetivo: se elige uno al azar
HELP = "!latigo [rol|n|todos] · !cafe [rol|n] · !aplaudir [rol|n] · !reganar [rol|n] · !camara [rol|n]"


def norm(s):
    s = unicodedata.normalize("NFD", str(s or "")).lower()
    return "".join(c for c in s if unicodedata.category(c) != "Mn").strip()


def clean_user(u):
    return re.sub(r"[^A-Za-z0-9_]", "", str(u or ""))[:25] or "anónimo"


def load_config():
    cfg = {"enabled": True, "twitch_channel": "", "cooldown_user": 15.0, "cooldown_global": 2.0}
    try:
        cfg.update(json.loads(CONFIG_FILE.read_text()))
    except (OSError, ValueError):
        pass
    if os.environ.get("ANT_TWITCH_CHANNEL"):
        cfg["twitch_channel"] = os.environ["ANT_TWITCH_CHANNEL"]
    cfg["twitch_channel"] = re.sub(r"[^a-z0-9_]", "", str(cfg.get("twitch_channel", "")).lower().lstrip("#"))
    return cfg


class Chat:
    def __init__(self, push, workers, cfg=None):
        """push(kind, target, user) añade un efecto a la oficina; workers() -> [{id, role, state}] actuales."""
        self.push, self.workers, self.cfg = push, workers, cfg or load_config()
        self.last_user, self.last_global = {}, 0.0
        self.recent = []
        self.twitch = {"channel": self.cfg["twitch_channel"], "connected": False, "error": ""}
        self._lock = threading.Lock()

    # ---- interpretación
    def resolve(self, arg, kind):
        """Devuelve (target, error). target = id de worker, 'all' o None."""
        ws = [w for w in self.workers() if w.get("state") != "stopped"]
        a = norm(arg)
        if not a:
            return ((random.choice(ws)["id"], None) if ws else (None, None)) if kind in NEEDS_TARGET else (None, None)
        if a in ("todos", "todas", "all") and kind == "whip":
            return "all", None
        if a.isdigit():
            i = int(a) - 1
            return (ws[i]["id"], None) if 0 <= i < len(ws) else (None, f"no hay agente nº {a}")
        for w in ws:
            if a in norm(w.get("role") or "agente"):
                return w["id"], None
        return None, f"no encuentro a «{str(arg)[:20]}»"

    def handle(self, text, user="anónimo"):
        text = str(text or "").strip()
        user = clean_user(user)
        if not text.startswith("!") or len(text) > 200:
            return {"ok": False, "ignored": True}
        if not self.cfg.get("enabled", True):
            return {"ok": False, "error": "Los comandos del público están desactivados."}
        parts = text[1:].split(None, 1)
        cmd = norm(parts[0]) if parts else ""
        if cmd in ("ayuda", "help", "comandos"):
            return {"ok": True, "kind": "help", "reply": HELP}
        kind = ALIASES.get(cmd)
        if not kind:
            return {"ok": False, "ignored": True}
        now = time.time()
        with self._lock:
            if now - self.last_user.get(user, 0) < float(self.cfg["cooldown_user"]):
                return self._log(user, text, {"ok": False, "error": f"{user}: espera unos segundos entre comandos."})
            if now - self.last_global < float(self.cfg["cooldown_global"]):
                return self._log(user, text, {"ok": False, "error": "Demasiados comandos a la vez."})
            target, err = self.resolve(parts[1] if len(parts) > 1 else "", kind)
            if err:
                return self._log(user, text, {"ok": False, "error": err})
            self.last_global = self.last_user[user] = now
            if len(self.last_user) > 500:
                self.last_user = {u: t for u, t in self.last_user.items() if now - t < 60}
        ev = self.push(kind, target, user)
        return self._log(user, text, {"ok": True, "kind": kind, "target": target, "seq": ev["seq"]})

    def _log(self, user, text, res):
        self.recent = ([{"user": user, "text": text[:80], "ok": bool(res.get("ok")), "at": time.time()}] + self.recent)[:10]
        return res

    def status(self):
        return {"enabled": bool(self.cfg.get("enabled", True)), "twitch": dict(self.twitch), "recent": self.recent, "help": HELP,
                "cooldown_user": self.cfg["cooldown_user"]}

    # ---- Twitch (solo lectura, anónimo: no necesita cuenta ni token)
    def start_twitch(self):
        if not self.cfg["twitch_channel"]:
            return None
        t = threading.Thread(target=self._twitch_loop, daemon=True)
        t.start()
        return t

    def _twitch_loop(self):
        host = os.environ.get("ANT_TWITCH_HOST", "irc.chat.twitch.tv")
        port = int(os.environ.get("ANT_TWITCH_PORT", "6697"))
        tls = os.environ.get("ANT_TWITCH_TLS", "1") != "0"
        delay = 2
        while True:
            try:
                raw = socket.create_connection((host, port), timeout=20)
                sock = ssl.create_default_context().wrap_socket(raw, server_hostname=host) if tls else raw
                sock.settimeout(300)
                sock.sendall(f"PASS SCHMOOPIIE\r\nNICK justinfan{random.randint(10000, 99999)}\r\nJOIN #{self.cfg['twitch_channel']}\r\n".encode())
                self.twitch.update(connected=True, error="")
                delay, buf = 2, b""
                while True:
                    data = sock.recv(4096)
                    if not data:
                        raise ConnectionError("el servidor cerró la conexión")
                    buf += data
                    while b"\r\n" in buf:
                        line, buf = buf.split(b"\r\n", 1)
                        self._irc_line(sock, line.decode("utf-8", "replace"))
            except Exception as e:  # reconecta con espera creciente
                self.twitch.update(connected=False, error=str(e)[:120])
                time.sleep(delay)
                delay = min(delay * 2, 60)

    def _irc_line(self, sock, line):
        if line.startswith("PING"):
            sock.sendall(("PONG" + line[4:] + "\r\n").encode())
            return
        m = re.match(r"^(?:@\S+ )?:([^!\s]+)![^ ]* PRIVMSG #\S+ :(.*)$", line)
        if m:
            self.handle(m.group(2), m.group(1))
