#!/usr/bin/env python3
"""Qué hace cada agente: clasificación de la herramienta en categorías genéricas + /api/office. Uso: python3 test/test_activity.py"""
import os, shlex, subprocess, sys, tempfile
from pathlib import Path
HERE = Path(__file__).resolve().parent
T = Path(tempfile.mkdtemp(prefix="ant-act-"))
for kv in shlex.split(subprocess.run([sys.executable, str(HERE / "ui_env.py"), str(T)], capture_output=True, text=True, check=True).stdout):
    k, v = kv.split("=", 1); os.environ[k] = v
sys.path.insert(0, str(HERE.parent))
import server  # noqa: E402

fails = []
def check(name, cond, extra=""):
    print(("  ok  " if cond else "FALLA ") + name + (f"  [{extra}]" if not cond and extra else ""))
    if not cond: fails.append(name)

CASES = {"write_file: src/x.js": "write", "replace_file_content": "write", "multi_replace_file_content": "write", "run_command: npm test": "run", "command_status": "run",
         "swarm: status": "coordinate", "post_message": "coordinate", "read_board": "coordinate", "swarm_wait": "wait", "grep_search: foo": "read", "view_file": "read",
         "list_dir": "read", "find_by_name": "read", "read_url_content": "browse", "browser_subagent": "browse", "Voy a revisar los archivos del proyecto": "think",
         "": "", "tool_desconocida": "other"}
print("== Clasificación de la actividad")
check("cada herramienta cae en su categoría", all(server.activity_kind(a) == k for a, k in CASES.items()), str({a: server.activity_kind(a) for a, k in CASES.items() if server.activity_kind(a) != k}))
check("'swarm_wait' es esperar y no coordinar (el orden de las reglas importa)", server.activity_kind("swarm_wait") == "wait")
check("las categorías no revelan nada del proyecto (solo palabras genéricas)", set(CASES.values()) <= {"write", "run", "coordinate", "wait", "read", "browse", "think", "other", ""})

print("== /api/office")
st = server.office_state()
by = {w["id"].split(":")[-1]: w for w in st["workers"]}
check("el miembro que trabaja trae la categoría de su herramienta real (parser: write_file → write)", by["parser"]["act"] == "write" and by["parser"]["state"] == "working" and not by["parser"]["waiting"], str({k: (v["state"], v["act"]) for k, v in by.items()}))
check("los miembros que esperan mensajes de otros (swarm_wait) NO figuran como «sin órdenes»: están en espera real", all(by[n]["waiting"] and by[n]["act"] == "wait" and by[n]["state"] == "idle" for n in ("coordinator", "verifier")), str({k: (v["state"], v["act"], v["waiting"]) for k, v in by.items()}))
check("y el detalle (solo se muestra con ?reveal=1) viene acotado a 80 caracteres", all(len(w["detail"]) <= 80 for w in st["workers"]) and "ejecutar pruebas" in by["verifier"]["detail"])

print("== Enjambres vivos y abandonados")
import json as _j, time as _t
brain = next(Path(os.environ["ANT_GEMINI_DIR"]).rglob("brain"))
old_conv = "dddddddd-0000-0000-0000-000000000009"; sd = brain / old_conv / ".system_generated" / "swarm"; sd.mkdir(parents=True)
(sd / "members.json").write_text(_j.dumps({"title": "Enjambre abandonado", "members": {"coordinator": {"conversation_id": old_conv, "role": "coordinator", "model": "m", "wait_since": 5, "killed": False}}}))
(sd / "board.jsonl").write_text(_j.dumps({"seq": 1, "agent": "coordinator", "text": "hola", "time": "x"}) + "\n")
ld = brain / old_conv / ".system_generated" / "logs"; ld.mkdir(parents=True); (ld / "transcript.jsonl").write_text(_j.dumps({"step_index": 0, "type": "PLANNER_RESPONSE"}) + "\n")
for f in (sd / "members.json", sd / "board.jsonl", ld / "transcript.jsonl"): os.utime(f, (_t.time() - 6 * 3600, _t.time() - 6 * 3600))
ids = [w["id"] for w in server.office_state()["workers"]]
check("un enjambre abandonado (6 h sin actividad) NO aparece en la oficina, aunque sus miembros sigan «esperando»", not any(i.startswith("sw:dddddddd") for i in ids), str(ids))
check("y el enjambre vivo sí", any(i.startswith("sw:aaaaaaaa") for i in ids), str(ids))
print("== Caché del transcript")
conv = next(w for w in st["workers"]).get("id")
import time
p = next(Path(os.environ["ANT_GEMINI_DIR"]).rglob("transcript.jsonl"))
cid = p.parents[2].name
a = server.transcript_info(cid); b = server.transcript_info(cid)
check("sin cambios en el transcript se reutiliza la lectura (mismo objeto)", a is b)
with open(p, "a") as f: f.write('{"type":"PLANNER_RESPONSE","tool_calls":[{"name":"grep_search","args":{}}]}\n')
c = server.transcript_info(cid)
check("si el transcript crece se vuelve a leer y se ve la herramienta nueva", c is not a and server.activity_kind(c["activity"]) == "read", c["activity"])
print(f"\nRESULTADO: {'TODO OK' if not fails else str(len(fails)) + ' fallos: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
