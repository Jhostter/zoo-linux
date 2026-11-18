#!/bin/sh
# Copia el tema compartido (zoo/static/zoo-theme.css) a todas las apps de la suite.
# Úsalo después de editar el tema. Las apps ya lo cargan (index.html) y lo sirven (/zoo-theme.css).
SRC="$(cd "$(dirname "$0")/.." && pwd)/static/zoo-theme.css"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
for d in "$ROOT/apps/chameleon" "$ROOT/apps/bee" "$ROOT/apps/beaver" "$ROOT/apps/elephant" "$ROOT/apps/horse-pack"; do
  if [ -d "$d/static" ]; then cp "$SRC" "$d/static/zoo-theme.css" && echo "✔ $d"; else echo "· $d (no existe)"; fi
done
