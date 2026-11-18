"""Contabilidad de tokens de Ant: lee el consumo REAL de los transcripts de Antigravity.

Cada ejecución lleva una marca `[ant-run:<id>]` en su prompt; así se localiza su conversación sin
adivinar. Si es un enjambre, se suman también los transcripts de todos sus miembros.
Lectura incremental (los transcripts solo crecen): cada consulta lee únicamente lo nuevo.
"""
import json
import os
import threading
from pathlib import Path

MARK = "[ant-run:%s]"
_lock = threading.Lock()
_offsets = {}   # ruta -> (bytes leídos, acumulado)
_conv_cache = {}  # run_id -> conversation_id


def _empty():
    return {"in": 0, "cache": 0, "out": 0, "steps": 0}


def file_usage(path):
    """Acumulado de tokens de un transcript, leyendo solo desde el último punto."""
    p = Path(path)
    try:
        size = p.stat().st_size
    except OSError:
        return _empty()
    with _lock:
        off, acc = _offsets.get(str(p), (0, _empty()))
        if size < off:  # el archivo se rehízo: empezar de cero
            off, acc = 0, _empty()
        if size == off:
            return dict(acc)
        acc = dict(acc)
        try:
            with open(p, "rb") as f:
                f.seek(off)
                data = f.read()
        except OSError:
            return dict(acc)
        end = data.rfind(b"\n") + 1  # ignorar una última línea a medio escribir
        for line in data[:end].splitlines():
            try:
                d = json.loads(line)
            except ValueError:
                continue
            if "input_tokens" in d or "output_tokens" in d:
                acc["in"] += int(d.get("input_tokens") or 0)
                acc["cache"] += int(d.get("cache_read_tokens") or 0)
                acc["out"] += int(d.get("output_tokens") or 0)
                acc["steps"] += 1
        _offsets[str(p)] = (off + end, acc)
        return dict(acc)


def transcript_path(brains, conv):
    for b in brains:
        p = Path(b) / conv / ".system_generated" / "logs" / "transcript.jsonl"
        if p.is_file():
            return p
    return None


def find_conversation(brains, run_id, started):
    """Conversación cuyo primer mensaje contiene la marca de la ejecución."""
    if run_id in _conv_cache:
        return _conv_cache[run_id]
    needle = (MARK % run_id).encode()
    for b in brains:
        b = Path(b)
        if not b.is_dir():
            continue
        for c in b.iterdir():
            p = c / ".system_generated" / "logs" / "transcript.jsonl"
            try:
                if p.stat().st_mtime < started - 15:
                    continue
                with open(p, "rb") as f:
                    first = f.readline(400_000)
            except OSError:
                continue
            if needle in first:
                _conv_cache[run_id] = c.name
                return c.name
    return None


def run_usage(brains, run):
    """{in, cache, out, total, steps, by_agent, conv} o None si aún no se encuentra la conversación."""
    conv = run.get("conv") or find_conversation(brains, run["id"], run["started"])
    if not conv:
        return None
    by_agent, total = {}, _empty()
    tp = transcript_path(brains, conv)
    if tp:
        u = file_usage(tp)
        by_agent["coordinador" if run.get("swarm") else "agente"] = u
    members = None
    for b in brains:
        m = Path(b) / conv / ".system_generated" / "swarm" / "members.json"
        if m.is_file():
            try:
                members = json.loads(m.read_text()).get("members", {})
            except (OSError, ValueError):
                members = None
            break
    for name, info in (members or {}).items():
        cid = info.get("conversation_id")
        if not cid or cid == conv:
            continue
        mp = transcript_path(brains, cid)
        if mp:
            by_agent[name] = file_usage(mp)
    for u in by_agent.values():
        for k in total:
            total[k] += u[k]
    return {**total, "total": total["in"] + total["out"], "by_agent": by_agent, "conv": conv}
