#!/usr/bin/env python3
"""Varios `/swarm` en la misma conversación de Antigravity = enjambres individuales. Uso: python3 test/test_launches.py"""
import json, os, shlex, subprocess, sys, tempfile, time
from pathlib import Path
HERE = Path(__file__).resolve().parent
T = Path(tempfile.mkdtemp(prefix="ant-launch-"))
for kv in shlex.split(subprocess.run([sys.executable, str(HERE / "ui_env.py"), str(T), "--multi"], capture_output=True, text=True, check=True).stdout):
    k, v = kv.split("=", 1); os.environ[k] = v
sys.path.insert(0, str(HERE.parent)); sys.path.insert(0, str(HERE))
import server  # noqa: E402
from multi_fixture import CONV, user, calls  # noqa: E402
fails = []
def check(name, cond, extra=""):
    print(("  ok  " if cond else "FALLA ") + name + (f"  [{extra}]" if not cond and extra else ""))
    if not cond: fails.append(name)

print("== Separación de lanzamientos")
sw = server.swarm_details(CONV)
check("dos /swarm en la misma conversación dan DOS enjambres (no uno con el título sustituido)", len(sw) == 2, str([(x["id"], x["title"]) for x in sw]))
A, B = sw
check("cada uno conserva SU título y SU tarea", (A["title"], B["title"]) == ("Titulo A", "Titulo B") and "Tarea A" in A["prompt"] and "Tarea B" in B["prompt"])
check("ids distintos (conv~n), numerados y con el último marcado", (A["id"], B["id"]) == (CONV + "~1", CONV + "~2") and (A["n"], A["of"], A["latest"]) == (1, 2, False) and (B["n"], B["of"], B["latest"]) == (2, 2, True))
check("los agentes NO se mezclan: A tiene a1 y a2; B tiene b1", [m["name"] for m in A["members"]] == ["a1", "a2"] and "b1" in [m["name"] for m in B["members"]] and not {"a1", "a2"} & {m["name"] for m in B["members"]}, str([[m["name"] for m in x["members"]] for x in sw]))
check("el coordinador y el monitor (compartidos) acompañan solo al lanzamiento vigente", {"coordinator", "monitor"} <= {m["name"] for m in B["members"]} and not {"coordinator", "monitor"} & {m["name"] for m in A["members"]})
check("el tablero se reparte: A los mensajes 1-5 (incl. el «[done]» final del coordinador) y B los 6-10 (incl. «@monitor resume» y el [stall] del monitor)", [m["seq"] for m in A["board"]] == [1, 2, 3, 4, 5] and [m["seq"] for m in B["board"]] == [6, 7, 8, 9, 10], str([[m["seq"] for m in x["board"]] for x in sw]))
check("las aristas del grafo son de cada lanzamiento", {(e["from"], e["to"]) for e in A["edges"]} == {("coordinator", "a1"), ("coordinator", "a2"), ("a1", "coordinator"), ("a2", "coordinator")} and ("coordinator", "b1") in {(e["from"], e["to"]) for e in B["edges"]})
from datetime import datetime, timezone
check("la hora de inicio sale de la orden del usuario (10:00 -04:00 = 14:00 UTC)", A["started"] == datetime(2026, 11, 17, 14, 0, tzinfo=timezone.utc).timestamp() and B["started"] == datetime(2026, 11, 17, 15, 0, tzinfo=timezone.utc).timestamp(), str((A["started"], B["started"])))
check("un lanzamiento viejo muestra a sus agentes como terminados", all(m["state"] == "killed" for m in A["members"]))
check("la actividad de un lanzamiento viejo es la de su último mensaje (10:12), no la del tablero entero", A["updated"] == time.mktime(time.strptime("2026-11-17 10:12:00", "%Y-%m-%d %H:%M:%S")) and A["updated"] < B["updated"], str((A["updated"], B["updated"])))
print("== Estado, duración, entregas y tokens")
check("A está terminado (todos sus agentes muertos y el coordinador dio su [done] final); B sigue en ejecución (b1 trabaja)", (A["status"], B["status"]) == ("done", "running"), str((A["status"], B["status"])))
check("el resultado final de A es el [done] del coordinador (mensaje 5); B aún no lo tiene (sigue trabajando)", A["result"]["seq"] == 5 and "Tarea A terminada" in A["result"]["text"] and B["result"] is None)
check("la duración sale de la orden y del último mensaje: A terminó a las 10:12", A["ended"] is not None and B["ended"] is None and A["started"] < A["ended"])
check("cuenta quién entregó: A 2 de 2 y B 1 de 1 (b1 entregó, pero sigue vivo: el enjambre no está terminado)", (A["workers_done"], A["workers_total"], B["workers_done"], B["workers_total"]) == (2, 2, 1, 1), str((A["workers_done"], A["workers_total"], B["workers_done"], B["workers_total"])))
ma = {m["name"]: m for m in A["members"]}
check("cada agente trae su entrega (mensaje, hora y texto), cuántos mensajes envió y cuándo apareció", ma["a1"]["done"]["seq"] == 3 and "A1" in ma["a1"]["done"]["text"] and ma["a2"]["done"]["seq"] == 4 and ma["a1"]["sent"] == 1 and ma["a1"]["first_seen"] is not None)
check("coordinador y monitor figuran como compartidos (sus tokens son de todos los lanzamientos)", all(m["shared"] for m in B["members"] if m["name"] in ("coordinator", "monitor")) and not any(m["shared"] for m in A["members"]))
check("los mensajes llevan su hora (epoch) y el detalle cuenta el total", all(m["t"] for m in A["board"]) and server.swarm_detail(CONV + "~2", since=8)["total"] == 5)
check("cada lanzamiento sabe cuáles son sus hermanos y en qué estado", [x["status"] for x in B["siblings"]] == ["done", "running"] and [x["n"] for x in A["siblings"]] == [1, 2])
print("== Accesos por id")
check("el id de la conversación (sin ~) apunta al ÚLTIMO lanzamiento (enlaces antiguos siguen valiendo)", server.swarm_detail(CONV)["title"] == "Titulo B")
check("«conv~1» devuelve el primero", server.swarm_detail(CONV + "~1")["title"] == "Titulo A" and server.swarm_detail(CONV + "~3") is None)
check("el parámetro since filtra por mensaje dentro de ese lanzamiento", [m["seq"] for m in server.swarm_detail(CONV + "~2", since=7)["board"]] == [8, 9, 10])
ls = [x for x in server.list_swarms() if x["conv"] == CONV]
check("la lista de enjambres muestra ambos, cada uno con su título", sorted(x["title"] for x in ls) == ["Titulo A", "Titulo B"])
ofs = {w["id"] for w in server.office_state()["workers"]}
check("la oficina del stream solo usa el lanzamiento vigente (b1 sí, a1 no)", f"sw:{CONV[:8]}:b1" in ofs and f"sw:{CONV[:8]}:a1" not in ofs, str(ofs))
print("== Lectura incremental del transcript")
tp = server.conv_dir(CONV) / ".system_generated" / "logs" / "transcript.jsonl"
with open(tp, "a") as f:
    f.write(json.dumps(user("/swarm Tarea C: otra cosa", "2026-11-17T12:00:00-04:00")) + "\n")
    f.write(json.dumps(calls({"action": "title", "title": "Titulo C"})) [:40])  # línea a medias
mid = server.swarm_details(CONV)
check("con la línea del título a medias, el lanzamiento nuevo aparece pero SIN heredar el título del anterior (usa su tarea)", len(mid) == 3 and mid[-1]["title"] == "Tarea C: otra cosa" and mid[1]["title"] == "Titulo B", str([x["title"] for x in mid]))
with open(tp, "a") as f:
    f.write(json.dumps(calls({"action": "title", "title": "Titulo C"}))[40:] + "\n")
    f.write(json.dumps(calls({"action": "add", "brief": "x", "name": "c1"})) + "\n")
sw3 = server.swarm_details(CONV)
check("un /swarm nuevo se detecta sin releer todo: ahora hay 3 y el último es C (con su agente c1)", len(sw3) == 3 and sw3[-1]["title"] == "Titulo C" and "c1" not in [m["name"] for m in sw3[0]["members"]], str([x["title"] for x in sw3]))
check("la caché avanzó hasta el final del archivo", server._LAUNCH_CACHE[str(tp)]["off"] == tp.stat().st_size)
print("== Un solo /swarm o sin transcript: como siempre")
single = [x for x in server.list_swarms() if x["conv"].startswith("aaaaaaaa")]
check("el enjambre de ejemplo (sin /swarm en su transcript) sigue siendo uno solo, con su id de siempre", len(single) == 1 and single[0]["id"] == single[0]["conv"] and single[0]["of"] == 1 and single[0]["latest"])
print(f"\nRESULTADO: {'TODO OK' if not fails else str(len(fails)) + ' fallos: ' + '; '.join(fails)}")
sys.exit(1 if fails else 0)
