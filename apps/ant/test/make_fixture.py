#!/usr/bin/env python3
"""Crea un ~/.gemini de juguete con un enjambre falso (formato según el README
del plugin swarm de Antigravity). Uso: make_fixture.py <dir_destino>"""
import json
import sys
import time
from pathlib import Path

root = Path(sys.argv[1])
g = root / "gemini"
ws = root / "workspace-demo"
(ws / ".git").mkdir(parents=True)
(g / "config" / "projects").mkdir(parents=True)
(g / "config" / "projects" / "p1.json").write_text(json.dumps({
    "id": "p1", "name": "demo",
    "projectResources": {"resources": [{"gitFolder": {"folderUri": f"file://{ws}"}}]}}))

brain = g / "antigravity" / "brain"
coord, w1, w2 = "aaaaaaaa-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002", "cccccccc-0000-0000-0000-000000000003"
sd = brain / coord / ".system_generated" / "swarm"
sd.mkdir(parents=True)
now = time.time()
(sd / "members.json").write_text(json.dumps({"title": "refactor del parser", "members": {
    "parser": {"conversation_id": w1, "model": "Claude Sonnet 5.5", "role": "implementer", "last_read_seq": 2, "wait_since": None, "killed": False},
    "verifier": {"conversation_id": w2, "model": "Claude Sonnet 5.5", "role": "reviewer", "last_read_seq": 4, "wait_since": now - 30, "killed": False},
    "old": {"conversation_id": "", "model": "x", "killed": True}}}))
msgs = [(1, "coordinator", "@parser arregla los 3 tests de parser_test.rs"),
        (2, "parser", "ok, empiezo"),
        (3, "parser", "@verifier [done] 3 tests pasan"),
        (4, "verifier", "@parser falta el caso vacío en src/parser.rs:40"),
        (5, "verifier", "@coordinator [stall] nadie se mueve")]
(sd / "board.jsonl").write_text("\n".join(json.dumps({"seq": s, "agent": a, "text": t, "time": "now"}) for s, a, t in msgs) + "\n")
for conv, act in ((w1, "Editando src/parser.rs"), (w2, "Ejecutando cargo test")):
    d = brain / conv / ".system_generated" / "logs"
    d.mkdir(parents=True)
    (d / "transcript.jsonl").write_text("\n".join(json.dumps(
        {"step_index": i, "type": "PLANNER_RESPONSE", "status": "DONE", "content": act if i == 2 else "paso"}) for i in range(3)) + "\n")
print(root)
