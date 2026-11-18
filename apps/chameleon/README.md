# 🦎 Chameleon

Sensores y hardware de la suite ZOO Linux (http://localhost:4500). Solo biblioteca estándar de Python.

    ./scripts/install-service.sh   # servicio systemd de usuario `chameleon` (CPU 10 %, RAM 128 MB)

## Vistas

- **Resumen:** temperatura de CPU, GPU NVIDIA, SSD, módulo de RAM y WiFi; frecuencia y turbo; batería (carga, salud, ciclos, consumo y autonomía);
  gráfica de temperaturas en vivo (últimos minutos) y avisos (temperaturas altas, salud de la batería, GPU siempre activa con batería…).
- **Sensores:** todos los de `hwmon` y las zonas térmicas, agrupados por chip, con su barra de límites (alto/crítico), histórico y estado.
- **Energía:** perfil de energía (Batería / Equilibrado / Rendimiento), gobernador, turbo, frecuencia por hilo, batería, **modo gráfico**
  (integrada / híbrido / NVIDIA / cálculo, con confirmación escrita), **brillo** de pantalla y teclado, y **límite de potencia de la GPU**.
- **Consumo:** historial persistente (1 h a 14 días) de consumo en vatios, nivel de batería y temperaturas; autonomía estimada; y
  **«quién gasta ahora»** (procesos por uso de procesador con reparto aproximado de vatios, y procesos de la GPU).
- **Hardware:** equipo, procesador, memoria, GPUs, pantallas, almacenamiento, **salud del disco NVMe** (SMART), red, audio, USB y PCI.
  Botón **Descargar informe** (Markdown sin números de serie, MAC, IP ni nombres de redes).
- **Avisos:** notificaciones de escritorio (CPU/GPU/SSD calientes, batería baja/crítica), **perfil automático** al enchufar/desenchufar
  el cargador, interruptor del historial y registro de los últimos avisos.

## Consumo del propio servicio

Un hilo vigilante lee archivos de `/sys` cada 30 s (≈0,07 % de un núcleo, ~14 MB medidos en reposo). Reglas para no gastar batería:
la GPU NVIDIA **solo se consulta si ya está despierta** (`runtime_status`), como mucho 1 vez por minuto; los procesos solo se leen cuando
la vista Consumo está abierta; con el panel cerrado el muestreo rápido de 3 s no corre. Historial: 1 línea/minuto en
`~/.local/share/chameleon/history.jsonl` (14 días, ~2 MB, poda diaria). Ajustes en `~/.config/chameleon/settings.json`.

## Icono de bandeja (opcional)

    sh scripts/install-tray.sh      # círculo con la temperatura de la CPU (verde/ámbar/rojo) + menú con CPU/SSD/GPU/batería y atajos de perfil
    sh scripts/uninstall-tray.sh

Lee `/api/status` cada 15 s (solo devuelve lo ya medido). Es un proceso GTK aparte (~50 MB de RAM): por eso es opcional.

## Decisiones de seguridad

- Escucha solo en 127.0.0.1, valida Host/Origin y exige la cabecera `X-Chameleon` en los POST.
- Lo único que escribe es el perfil de energía (valores fijos: `battery`, `balanced`, `performance`). Se comprueba el **estado resultante**
  y no el código de salida, porque `system76-power` puede salir con error por ajustes que tu equipo no tiene (p. ej. SCSI `host0`) aunque el perfil sí se aplique.
- **El modo gráfico solo se cambia con confirmación escrita.** Cambiarlo reconstruye el initramfs y exige reiniciar; hasta entonces se muestra «Pendiente de reinicio» y puedes deshacerlo eligiendo de nuevo el modo anterior. Salvaguardas: se rechaza con la batería por debajo del 40 % y sin cargador, o si apt/dpkg está modificando paquetes; en modos «Integrada» y «Cálculo» la salida HDMI no funciona (cuelga de la NVIDIA). Se prueba con un `system76-power` simulado; el cambio real no se ejecuta en las pruebas.
  Muestra el modo actual y el comando exacto para quien quiera hacerlo conscientemente.
- **Acciones con administrador (pkexec, piden contraseña cada vez):** leer SMART del NVMe (script de solo lectura pasado en línea, no un archivo editable) y
  fijar el límite de la GPU (`nvidia-smi -pl`, validado entre la mitad del valor de fábrica y el máximo, se pierde al reiniciar; se comprueba el resultado).
  Con «Mantener tras reiniciar» crea `/etc/systemd/system/chameleon-gpu-limit.service` (oneshot con reintentos; marca `# Creado por Chameleon`; una sola contraseña,
  script en línea; se deshace si algo falla y no toca ni sobrescribe unidades ajenas). No activa el modo persistencia de NVIDIA (mantendría la GPU despierta). Se quita desde la misma tarjeta.
- **Sin agente de contraseñas (caso de este COSMIC):** si `pkexec` falla con «no agent / textual authentication agent» (los servicios de usuario no están en la sesión de login y
  polkit no los asocia a ningún agente), Chameleon no se rinde: responde 409 con el **comando exacto para pegar en una terminal** (`sudo …`, con el código en línea mediante heredoc;
  la interfaz tiene botón «Copiar comando» y «Ya lo ejecuté»). Para SMART del NVMe y los módulos de RAM el comando deja su salida en
  `~/.local/share/chameleon/` (`nvme-raw.hex`, `dmi-memory.txt`) y la interfaz la lee si tiene menos de 15 minutos, y la borra.
- Brillo vía `systemd-logind` (sin root); la pantalla nunca baja del 5 %.
- Los avisos no repiten antes de 20 min y exigen dos lecturas seguidas. El perfil automático solo actúa en la transición de cargador.
- No controla ventiladores ni límites de carga: solo se ofrecen si el hardware los expone (este equipo no los expone; tampoco retroiluminación de teclado).
