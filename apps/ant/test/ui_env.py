#!/usr/bin/env python3
"""Entorno aislado para probar la UI: repo git real, proyectos, un swarm de ejemplo y agy falso.
Uso: python3 ui_env.py <dir>   -> imprime las variables de entorno para arrancar server.py"""
import json, subprocess, sys, time
from pathlib import Path
T = Path(sys.argv[1]); T.mkdir(parents=True, exist_ok=True)
def sh(*a, cwd): subprocess.run(a, cwd=cwd, check=True, capture_output=True)
def repo(name):
    p = T / name; p.mkdir(); sh("git", "init", "-q", cwd=p); (p / "a.txt").write_text("x\n"); sh("git", "add", ".", cwd=p)
    sh("git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init", cwd=p); return p
g = T / "gemini"; (g / "config" / "projects").mkdir(parents=True)
demo, otro = repo("demo-app"), repo("tienda-movil"); nogit = T / "carpeta-sin-git"; nogit.mkdir()
for i, (n, p) in enumerate([("demo-app", demo), ("tienda-movil", otro), ("carpeta-sin-git", nogit)]):
    (g / "config" / "projects" / f"p{i}.json").write_text(json.dumps({"id": f"p{i}", "name": n, "projectResources": {"resources": [{"folderUri": f"file://{p}"}]}}))
brain = g / "antigravity-cli" / "brain"; coord = "aaaaaaaa-0000-0000-0000-000000000001"; w1, w2 = "bbbbbbbb-0000-0000-0000-000000000002", "cccccccc-0000-0000-0000-000000000003"
sd = brain / coord / ".system_generated" / "swarm"; sd.mkdir(parents=True); now = time.time()
(sd / "members.json").write_text(json.dumps({"title": "Migrar el módulo de pagos", "members": {
    "coordinator": {"conversation_id": coord, "role": "coordinator", "model": "gemini-flash-worker-agy", "wait_since": 5, "killed": False},
    "parser": {"conversation_id": w1, "model": "gemini-4-hydrogen-low", "role": "worker", "last_read_seq": 2, "wait_since": None, "killed": False},
    "verifier": {"conversation_id": w2, "model": "gemini-4-hydrogen-low", "role": "worker", "last_read_seq": 4, "wait_since": 4, "killed": False}}}))
msgs = [(1, "coordinator", "@parser migra `src/pagos.js` al nuevo cliente. **Solo ese archivo.**"), (2, "parser", "Empiezo ahora."),
        (3, "parser", "@verifier [done] Migrado `src/pagos.js`, 12 llamadas cambiadas.\n```\ngrep -n clienteViejo src/pagos.js\n(sin resultados)\n```"),
        (4, "verifier", "@parser falta el caso de reintentos en la línea 40. " + "Detalle largo. " * 40), (5, "verifier", "@coordinator [stall] nadie avanza")]
(sd / "board.jsonl").write_text("\n".join(json.dumps({"seq": s, "agent": a, "text": t, "time": "x"}) for s, a, t in msgs) + "\n")
for conv, act in ((coord, "swarm: status"), (w1, "write_file"), (w2, "run_command: ejecutar pruebas")):
    d = brain / conv / ".system_generated" / "logs"; d.mkdir(parents=True, exist_ok=True)
    (d / "transcript.jsonl").write_text(json.dumps({"step_index": 0, "type": "PLANNER_RESPONSE", "model": "gemini-4-hydrogen-low", "tool_calls": [{"name": act.split(":")[0], "args": {"toolSummary": act.split(": ")[1] if ": " in act else ""}}]}) + "\n")
if "--multi" in sys.argv:  # conversación con varios /swarm seguidos (para probar que se separan)
    sys.path.insert(0, str(Path(__file__).resolve().parent)); from multi_fixture import make_multi; make_multi(brain)
(T / "ide.json").write_text("{}")
env = {"ANT_PORT": "4590", "ANT_GEMINI_DIR": str(g), "ANT_DATA": str(T / "data"), "ANT_AGY": str(Path(__file__).with_name("fake_agy.sh")), "ANT_USER_ROLES": str(T / "ur"),
       "ANT_IDE_STORAGE": str(T / "ide.json"), "ANT_IDE_STATE_DB": str(T / "none.vscdb"), "ANT_WORKSPACES_FILE": str(T / "manual.json"), "ANT_OFFICE_FILE": str(T / "office.json"), "ANT_ALLOWED_ROOTS": str(T), "ANT_MAX_RUNS": "3"}
print(" ".join(f"{k}='{v}'" for k, v in env.items()))
