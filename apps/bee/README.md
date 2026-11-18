# 🐝 Bee

Gestor de systemd de la suite ZOO Linux (http://localhost:4488). Solo biblioteca estándar de Python.

    ./scripts/install-service.sh   # servicio systemd de usuario `bee`

**Qué gestiona:** servicios, sockets, temporizadores, rutas, montajes, objetivos y slices, tanto del
ámbito **Usuario** (sin permisos) como del **Sistema** (con `pkexec`/polkit), más el **análisis de arranque**.

- Lista con filtros (activos, con error, inactivos, habilitados, deshabilitados, enmascarados), búsqueda,
  orden por nombre/estado/memoria y contadores por tipo. Temporizadores con próxima y última ejecución.
- **Selección múltiple** y acciones en bloque (una sola llamada a systemctl / un solo prompt de contraseña).
- **Detalle:** estado, memoria, CPU, PID, reinicios, sockets/rutas/montajes con sus datos, logs en vivo con filtro de texto y
  "solo errores", texto de la unidad, dependencias (directas e inversas).
- **Acciones:** iniciar, detener, reiniciar, recargar, habilitar, deshabilitar, enmascarar, desenmascarar, limpiar error y
  recargar systemd (`daemon-reload`).
- **Crear y editar servicios de usuario** con un asistente (`~/.config/systemd/user`).

## Seguridad

- Escucha solo en 127.0.0.1, valida Host/Origin y exige la cabecera `X-Bee` en los POST.
- Nombres de unidad validados (no pueden empezar por `-`) y se comprueba que existan.
- **Unidades protegidas** (dbus, NetworkManager, polkit, logind, gestor de sesión, montajes del sistema, todos los objetivos y slices):
  se pueden gestionar, pero Bee exige una **confirmación escrita** y el servidor rechaza la acción sin `force`.
- Bee no puede detenerse a sí mismo desde su interfaz.
- Solo se pueden **editar o eliminar servicios creados con Bee** (marca `# Creado por Bee` en la primera línea).
- Una unidad cuyo archivo está en `~/.config/systemd/user` o `/etc/systemd/system` no se puede enmascarar (limitación de systemd);
  Bee no ofrece la opción en ese caso.

## Rooster: inicio de sesión, cron y tareas programadas

- **Inicio de sesión** (🚪): las apps de `~/.config/autostart` y `/etc/xdg/autostart` con interruptor para activarlas o desactivarlas. Desactivar una del sistema crea un *override* en tu carpeta (no toca el original) y reactivar lo quita. Muestra si la entrada **no aplica a tu escritorio** (`OnlyShowIn`/`NotShowIn`), su estado en systemd (`app-…@autostart.service`) y permite ▶/■ ahora. Puedes añadir apps (con retraso opcional); solo se pueden eliminar las creadas con Bee.
- **Cron** (⏰): tu crontab con el horario en español («de lunes a viernes a las 08:30»), la próxima ejecución, interruptor (la línea se conserva comentada con `#BEE-OFF#`), añadir, editar, eliminar y **ejecutar ahora** (con tus variables de entorno de cron). Las tareas del sistema (`/etc/crontab`, `/etc/cron.d`, `/etc/cron.daily`…) se ven en solo lectura. Antes de cada cambio se guarda una copia en `~/.local/share/bee/crontab`; si el crontab cambió mientras editabas, la operación se rechaza.
- **Temporizadores**: «+ Crear temporizador» crea un servicio y su `.timer` en `~/.config/systemd/user` (cada N minutos, cada hora, a diario, laborables, semanal, mensual, cada N horas, al iniciar sesión, o `OnCalendar` personalizado con vista previa de `systemd-analyze calendar`). En el detalle: **▶ Ejecutar ahora** y el resultado de la última ejecución. Al eliminar se borran temporizador y servicio.
- Selector de horario común con presets y vista previa de las próximas ejecuciones.
