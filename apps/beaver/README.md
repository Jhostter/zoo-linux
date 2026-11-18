# 🦫 Beaver

Gestor de memoria y swap de la suite ZOO Linux (http://localhost:4499). Solo biblioteca estándar de Python.

    ./scripts/install-service.sh   # servicio systemd de usuario `beaver` (CPU 15 %, RAM 128 MB)

## Vistas

- **Resumen:** (incluye cuántas apps cerró systemd-oomd en las últimas 24 h y un aviso si lo ha hecho) RAM disponible y desglose real (aplicaciones, compartida, caché de archivos, kernel, otros, libre), swap, presión de
  memoria (PSI), muertes por OOM, gráficas en vivo (RAM, swap y actividad de swap) y consejos accionables.
- **Aplicaciones:** consumo agrupado por aplicación (Chrome con sus 30 procesos, etc.). «Huella» = memoria propia + swap, sin contar la
  caché de archivos. Se pueden cerrar o forzar aplicaciones y procesos propios.
- **Procesos:** todos los procesos del equipo, de todos los usuarios, en una tabla con filtro, orden, paginación y selección múltiple. Los de otros usuarios (root) se cierran con tu contraseña (un único `pkexec kill` para toda la selección).
- **Servicios:** memoria y swap por servicio de systemd (cgroups). En los de usuario se puede poner un límite suave (`MemoryHigh`) o duro (`MemoryMax`).
- **systemd-oomd** (en Swap y ajustes): instalar/activar el guardián contra la falta de memoria y configurar la protección de tu sesión (cierra la app que más memoria usa si la presión supera un umbral).
- **Swap y ajustes:** dispositivos de swap, **zram** (activar/reconfigurar/desactivar, con persistencia opcional), `vm.swappiness`,
  `vm.vfs_cache_pressure`, liberar caché, vaciar swap hacia la RAM, ajustes persistentes y los eventos de falta de memoria de los últimos 30 días: **cierres hechos por systemd-oomd** (aplicación, momento y motivo: presión o swap lleno) y muertes por el OOM killer del kernel.

## Seguridad

- Escucha solo en 127.0.0.1, valida Host/Origin y exige la cabecera `X-Beaver` en los POST.
- **Procesos:** los de otros usuarios solo con elevación explícita (`pkexec kill`, una contraseña por operación). Se comprueba `pid` + hora de inicio (evita matar un pid reutilizado); nunca `pid 1` ni Beaver.
  Los procesos de la sesión de escritorio (cosmic-*, pipewire, dbus, systemd…) exigen confirmación escrita.
- **Sistema:** scripts fijos vía `pkexec` con argumentos numéricos validados. «Vaciar swap» se rechaza si no hay RAM disponible suficiente
  (evita provocar un OOM). Los ajustes persistentes viven en `/etc/sysctl.d/99-beaver.conf` y `/etc/systemd/system/beaver-zram.service`
  y se pueden quitar desde la propia interfaz.
- Los límites por servicio son temporales (`--runtime`): no sobreviven a un reinicio.
