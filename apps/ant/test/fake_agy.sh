#!/bin/sh
# agy de juguete para probar el lanzador sin gastar cuota.
[ "$1" = "models" ] && { echo 'Fetching available models...' >&2; printf 'claude-opus-5-5-low\tClaude Opus 5.5 (Low)\nclaude-sonnet-5-5-low\tClaude Sonnet 5.5 (Low)\ngemini-4-hydrogen-low\tGemini 4 Hydrogen (Low)\ngemini-pro-orchestrator-g1-pro\tOrchestrator (Argon)\ngemini-4-hydrogen-medium\tGemini 4 Hydrogen (Medium)\ngemini-4-hydrogen-high\tGemini 4 Hydrogen (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n'; exit 0; }
if [ "$1" = "--conversation" ]; then  # continuar una conversación con un mensaje nuevo (recados del jefe)
  CONV="$2"; TXT="$4"; echo "continuando conversación $CONV"; echo "recado: $TXT"; echo "cwd: $PWD"; echo "args: $*"
  f="$ANT_GEMINI_DIR/antigravity-cli/brain/$CONV/.system_generated/logs/transcript.jsonl"
  [ -f "$f" ] && printf '{"step_index":9,"type":"PLANNER_RESPONSE","model":"fake","input_tokens":2000,"cache_read_tokens":0,"output_tokens":100}\n' >> "$f"
  exit 0
fi
P="$2"
# transcript falso con tokens, como el de Antigravity (para probar la medición y el presupuesto)
if [ -n "$ANT_GEMINI_DIR" ]; then
  D="$ANT_GEMINI_DIR/antigravity-cli/brain/conv-$$/.system_generated/logs"; mkdir -p "$D"
  printf '{"step_index":0,"type":"USER_INPUT","content":%s}\n' "$(printf '%s' "$P" | python3 -c 'import sys,json;print(json.dumps(sys.stdin.read()))')" > "$D/transcript.jsonl"
  printf '{"step_index":1,"type":"PLANNER_RESPONSE","model":"fake","input_tokens":12000,"cache_read_tokens":3000,"output_tokens":800}\n' >> "$D/transcript.jsonl"
fi
echo "args: $*"
echo "cwd: $PWD"
echo "path: $PATH"
case "$P" in
  *QUOTA*) echo "error: Individual quota reached. Resets in 1h15m23s." >&2
           echo 'AGY_ERROR: {"status":"RESOURCE_EXHAUSTED"}' >&2; exit 3;;
  *BLOCKED*) echo 'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.' >&2; exit 0;;
  *TIMEOUT*) echo "[agy] print timeout after 1m0s" >&2; echo 'AGY_ERROR: {"short_error":"print timeout"}' >&2; exit 3;;
  *DEPSMOD*) mkdir -p node_modules/paquete-nuevo && echo "instalado" > node_modules/paquete-nuevo/index.js; echo "modifiqué node_modules";;
  *NPMBLOCK*) printf '{"step_index":2,"type":"PLANNER_RESPONSE","model":"fake","input_tokens":9000,"cache_read_tokens":0,"output_tokens":100,"tool_calls":[{"name":"run_command","args":{"CommandLine":"\\"npm run type-check && npm test\\""}}]}\n' >> "$D/transcript.jsonl"
           echo 'jetski: no output produced — a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied.' >&2; exit 0;;
  *"Trabajo ya hecho"*) echo "reanudado: continúo solo lo que falta"; if [ -e .git ]; then echo "continuado $$" > continuacion.txt; git add continuacion.txt; git -c user.name=f -c user.email=f@f commit -qm "feat: continuación"; fi;;
  *BURN*)  if [ -e .git ]; then echo "parcial $$" > parcial.txt; git add parcial.txt; git -c user.name=f -c user.email=f@f commit -qm "feat: trabajo parcial"; fi
           echo "args: $*" >/dev/null;
           i=2; while [ $i -lt 40 ]; do printf '{"step_index":%s,"type":"PLANNER_RESPONSE","model":"fake","input_tokens":30000,"cache_read_tokens":0,"output_tokens":500}\n' $i >> "$D/transcript.jsonl"; i=$((i+1)); sleep 1; done;;
  *BURN_OLD*)  i=2; while [ $i -lt 40 ]; do printf '{"step_index":%s,"type":"PLANNER_RESPONSE","model":"fake","input_tokens":30000,"cache_read_tokens":0,"output_tokens":500}\n' $i >> "$D/transcript.jsonl"; i=$((i+1)); sleep 1; done;;
  *SLOW*)  sleep 60;;
  *SLEEP4*) sleep 4;;
  *EDIT*)  echo hola > hecho.txt; git add hecho.txt; git -c user.name=f -c user.email=f@f commit -qm "feat: hecho"; echo "commit hecho";;
  *DIRTY*) echo sin-commit > suelto.txt; git add -N suelto.txt 2>/dev/null; echo "cambio sin commit";;
esac
exit 0
