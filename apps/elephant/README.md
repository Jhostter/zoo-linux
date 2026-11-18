# 🐘 Elephant

Limpiador de disco de la suite ZOO Linux (http://localhost:4477). Solo biblioteca estándar de Python.

    ./scripts/install-service.sh   # servicio systemd de usuario `elephant`

## Vistas

- **Limpieza:** medidor de disco segmentado por categoría (clic en un segmento para ir a ella), aviso si el disco pasa del 90 %,
  categorías con casilla de inclusión, **«Limpiar selección»** en un clic (secuencial, con una confirmación que lista todo) y
  resultado con el espacio liberado. Las categorías aparecen según se escanean. Las cachés seguras vienen preseleccionadas
  (las caras de volver a descargar, no). Categorías: papelera, `~/.cache` por carpeta (con filtro y atajos), cachés de
  desarrollo, apt, journal, logs rotados, volcados de memoria y kernels antiguos (se conserva el que está en uso y uno de reserva).
- **Archivos grandes:** los mayores ficheros de tu carpeta personal con umbral de 50 MB / 100 MB / 500 MB / 1 GB.
- **Explorador:** tamaños por carpeta calculados en paralelo y mostrados según terminan, con filtro, orden por tamaño/nombre/fecha,
  fecha de modificación y copiar ruta.
- **Historial:** total liberado y cada limpieza (`~/.local/share/elephant/history.json`).

## Seguridad

- Escucha solo en 127.0.0.1, valida Host/Origin y exige la cabecera `X-Elephant` en los POST.
- Solo borra bajo `$HOME`, nunca `~/.ssh`, `~/.gnupg`, `~/.config`, `~/.local`, `~/.claude` ni `~/.cache` enteros, ni rutas ajenas.
- Lo que requiere root son comandos fijos vía `pkexec` (apt-get clean, journalctl --vacuum-size, find en /var/log, apt-get purge de kernels validados). Nunca rutas arbitrarias.
- El escaneo usa `nice` e `ionice` para no ralentizar el equipo.
