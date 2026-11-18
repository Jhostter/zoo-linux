"""Conversación de Antigravity con VARIOS `/swarm` seguidos: el título se sustituye y los agentes se añaden al mismo members.json
(es lo que hace Antigravity de verdad). Uso: make_multi(brain_dir) -> id de la conversación."""
import json, time
from pathlib import Path
CONV = "ffffffff-0000-0000-0000-00000000000a"


def user(text, when):
    return {"step_index": 0, "type": "USER_INPUT", "content": f"<USER_REQUEST> {text} </USER_REQUEST> <ADDITIONAL_METADATA> The current local time is: {when}. </ADDITIONAL_METADATA>"}


def calls(*cs):
    return {"step_index": 1, "type": "PLANNER_RESPONSE", "tool_calls": [{"name": "swarm", "args": {k: json.dumps(v) for k, v in c.items()}} for c in cs]}


def make_multi(brain, fresh=True):
    d = Path(brain) / CONV / ".system_generated"
    (d / "swarm").mkdir(parents=True, exist_ok=True); (d / "logs").mkdir(parents=True, exist_ok=True)
    lines = [user("/swarm Tarea A: analizar el proyecto", "2026-11-17T10:00:00-04:00"),
             calls({"action": "title", "title": "Titulo A"}),
             calls({"action": "add", "brief": "hacer A1", "name": "a1"}, {"action": "add", "brief": "hacer A2", "name": "a2"},
                   {"action": "add", "brief": "You are this swarm's stall monitor. Load the swarm_monitor skill.", "name": "monitor"}),
             calls({"action": "kill", "name": "a1"}, {"action": "kill", "name": "a2"}),
             user("gracias, ¿y ahora cómo lo pruebo?", "2026-11-17T10:30:00-04:00"),
             user("/swarm Tarea B: rediseñar la pantalla de inicio", "2026-11-17T11:00:00-04:00"),
             calls({"action": "title", "title": "Titulo B"}), calls({"action": "add", "brief": "hacer B1", "name": "b1"})]
    (d / "logs" / "transcript.jsonl").write_text("\n".join(json.dumps(x) for x in lines) + "\n")
    mem = lambda cid, **k: {"conversation_id": cid, "role": "worker", "model": "m", "wait_since": None, "killed": False, "last_read_seq": 5, **k}
    (d / "swarm" / "members.json").write_text(json.dumps({"title": "Titulo B", "members": {
        "coordinator": mem(CONV, role="coordinator", wait_since=9), "monitor": mem("m0000001", wait_since=9),
        "a1": mem("a0000001", killed=True), "a2": mem("a0000002", killed=True), "b1": mem("b0000001")}}))
    msgs = [(1, "coordinator", "@a1 haz A1", "10:01:00"), (2, "coordinator", "@a2 haz A2", "10:01:01"), (3, "a1", "@coordinator [done] A1", "10:10:00"),
            (4, "a2", "@coordinator [done] A2", "10:11:00"), (5, "coordinator", "[done] Tarea A terminada", "10:12:00"),
            (6, "coordinator", "@b1 haz B1", "11:01:00"), (7, "coordinator", "@monitor resume", "11:01:05"), (8, "b1", "@coordinator [done] B1", "11:20:00"),
            (9, "coordinator", "[done] Tarea B terminada", "11:21:00"), (10, "monitor", "@coordinator [stall] nadie avanza desde hace 10 min", "11:30:00")]
    (d / "swarm" / "board.jsonl").write_text("\n".join(json.dumps({"seq": s, "agent": a, "text": t, "time": "2026-11-17 " + h, "kind": "msg", "request_id": ""}) for s, a, t, h in msgs) + "\n")
    now = time.time()
    for f in list((d / "swarm").iterdir()) + [d / "logs" / "transcript.jsonl"]:
        import os; os.utime(f, (now, now))
    return CONV
