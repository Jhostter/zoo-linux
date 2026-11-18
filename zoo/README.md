# 🐾 ZOO Linux

Lanzador común de la suite ZOO Linux: una página local (http://localhost:4400) que muestra las apps de la suite, su estado y consumo, y permite abrirlas, iniciarlas, pararlas, reiniciarlas, ver sus logs y activar su autoarranque. Solo biblioteca estándar de Python.

    python3 server.py              # prueba rápida
    ./scripts/install-service.sh   # servicio systemd de usuario `zoo-linux` (CPU 10 %, RAM 128 MB)

## Apps de la suite

| App | Servicio | Puerto |
|---|---|---|
| 🐵 Docker Kong | `docker-gestor` | 4455 |
| 🐴 Horse Pack | `gestor-paquetes` | 4466 |
| 🐘 Elephant | `elephant` | 4477 |
| 🐝 Bee | `bee` | 4488 |
| 🦫 Beaver | `beaver` | 4499 |
| 🦎 Chameleon | `chameleon` | 4500 |
| 🐜 Ant | `ant` | 4511 |

Están en `apps.default.json` (las carpetas son relativas a esta; una app no instalada aparece como «no instalada»). Para añadir otra, usa el botón **+ Añadir una app** de la página, o crea un JSON en `~/.config/zoo-linux/apps.d/<id>.json`:

    {"id": "elephant-clean", "name": "Elephant Clean", "emoji": "🐘", "tagline": "Limpiador de disco",
     "category": "Sistema", "port": 4477, "service": "elephant-clean", "dir": "~/elephant-clean"}

Cada app es un servicio systemd **de usuario** que sirve una web local en su puerto.

## Seguridad

Escucha solo en 127.0.0.1, valida Host/Origin, exige la cabecera `X-Zoo` en los POST y solo actúa sobre servicios registrados (nombres validados). No puede gestionarse a sí mismo. No usa privilegios de root.

## Icono en la barra de estado

    sh scripts/install-tray.sh     # huella 🐾 con menú: abrir ZOO Linux y, por cada app, Abrir / Iniciar / Detener / Reiniciar
    sh scripts/uninstall-tray.sh

Consulta `/api/apps` cada 30 s (~20 ms) y solo reconstruye el menú si cambió el estado de alguna app. Las apps registradas en
`~/.config/zoo-linux/apps.d/` aparecen solas. Es un proceso GTK aparte (~50 MB de RAM), opcional.

## Centro de la suite (pestañas)

- **Panel:** estado de un vistazo con tarjetas que llevan a cada herramienta: temperatura y batería (Chameleon), memoria y swap, disco, servicios con error
  (sistema y usuario), actualizaciones (Horse Pack), Docker y la propia suite. Se apoya en lecturas directas del sistema y en las APIs ligeras de Chameleon (`/api/status`, `/api/state`)
  y Horse Pack; sin vigilantes extra en esas apps. Incluye modos rápidos y los últimos avisos.
- **Avisos:** un único registro (`~/.local/share/zoo-linux/feed.jsonl`, 500 máx.) con lo que avisa Chameleon (temperaturas, batería, perfiles automáticos) y lo que genera ZOO:
  disco < 10 %, memoria casi agotada con swap alto, servicios nuevos con error, apps de la suite que fallan (más un resumen diario de actualizaciones y el reinicio pendiente).
  ZOO solo notifica en el escritorio lo que genera él (con dos lecturas seguidas y enfriamiento; avisa si «No molestar» lo silencia); lo de Chameleon ya lo notificó Chameleon.
  El número de avisos sin leer sale en la pestaña, el título de la página y el icono de bandeja. Un vigía en segundo plano (cada 60 s) ≈ 0,2 % de CPU y ~25 MB.
- **Modos:** Juego / Batería / Trabajo (editables en `~/.config/zoo-linux/modes.json`). Cada modo puede fijar el perfil de energía y el brillo (vía Chameleon), iniciar o detener
  apps de la suite y proponer pasos con administrador. Antes de aplicar se guarda cómo estaba todo y **«Volver a como estaba»** lo restaura. Formato:

      {"modes":[{"id":"cine","name":"Cine","emoji":"🎬","desc":"…","profile":"balanced","brightness":55,
                 "start_apps":[],"stop_apps":["bee"],"sudo":["systemctl stop cups"]}]}

  Los pasos `sudo` solo pueden ser `systemctl start|stop|restart <unidades>` (se rechaza cualquier otra cosa) y nunca se ejecutan solos.
  El modo gráfico no se cambia desde los modos (exige reiniciar): se avisa de cómo lanzar un juego con la NVIDIA si estás en híbrido.
  **Modo Cine** (perfil equilibrado, brillo 55 %, «No molestar») y campo opcional `"dnd": true|false` en cualquier modo (escribe `~/.config/cosmic/com.system76.CosmicNotifications/v1/do_not_disturb`; COSMIC lo aplica al instante).

  **Cómo se encadenan (sin pisarse):** la «foto» del estado original se guarda una sola vez, al tocar cada ajuste por primera vez, y «Volver a como estaba» siempre vuelve a ella (no al modo anterior).
  Al pasar de un modo a otro, lo que el anterior tocó y el nuevo no se devuelve a su valor original (p. ej. Cine → Batería devuelve «No molestar»); lo que cambiaste a mano y ningún modo toca, no se toca.
  **Con Chameleon:** si un modo fija el perfil de energía, ZOO pone en pausa el perfil automático de Chameleon (`POST /api/hold`, `by=zoo:<modo>`) para que no lo pise al enchufar/desenchufar el cargador;
  la pausa se levanta al salir del modo, al pasar a un modo que no fija perfil o si cambias el perfil a mano (el modo sigue activo pero figura «cambiado a mano»). No toca tus ajustes guardados de Chameleon.

## Abrir en terminal (permisos de administrador)

Los servicios de usuario de COSMIC no pueden pedir la contraseña (no hay agente de polkit para ellos). Cuando una app necesita administrador, muestra el comando y un botón
**«Abrir en terminal»**: la app llama a `POST /api/terminal` de ZOO, que abre `cosmic-term` (o gnome-terminal/kitty/x-terminal-emulator; `ZOO_TERMINAL` fuerza uno) con el comando **sin ejecutarlo**:
la terminal lo enseña entero y pregunta «¿Ejecutar este comando? [s/N]» (por defecto No). Solo se aceptan comandos que empiezan por `sudo `. El comando viaja como argumento, no se interpreta antes de confirmar.
Disponible en Chameleon, Bee, Beaver y Horse Pack (en los registros de tareas de Elephant y Horse Pack el comando sale en el log para copiarlo).

## Apps bajo demanda

Para bajar la memoria fija de la suite, ZOO mantiene paradas las apps que no usas y las despierta al abrirlas (Gestionar apps → «Apps bajo demanda»; 20 min de inactividad por defecto, 2–240).

- **Cómo despierta:** una app «en espera» tiene su puerto guardado por ZOO. Si alguien lo abre (marco de ZOO, marcador, pestaña antigua), ZOO suelta el puerto, arranca el servicio y muestra
  una pantalla «Despertando…» que recarga sola. Una conexión sin petición (precarga del navegador) no despierta nada; una petición de API recibe un 503 con `Retry-After` y también la despierta.
- **Cuándo se apaga sola:** sin conexiones nuevas en su puerto durante N min (se lee `/proc/net/tcp`, **sin sondear a las apps**, que contaría como actividad; los sockets recién cerrados cuentan ~60 s más),
  con CPU baja y sin procesos hijos (un trabajo en curso la mantiene). Queda registrado en Avisos.
- **«Detener» a mano** la deja apagada del todo (sin puerto guardado) hasta que la inicies: una pestaña vieja no la resucita.
- **Siempre encendidas** (por defecto): Chameleon (historial, avisos, perfil automático) y Docker Kong (alertas de contenedores e historial). Cada tarjeta tiene el interruptor y avisa de lo que se pausa.
- Ajustes: `~/.config/zoo-linux/ondemand.json` (`{"enabled": true, "idle_minutes": 20, "always": ["chameleon","docker-kong"]}`). Limitaciones: pierden el estado en memoria al apagarse;
  una pestaña abierta que sondea a su app la mantiene despierta (como era de esperar).

## Mantenimiento guiado

Pestaña **Mantenimiento** → «Revisar todo»: actualizaciones (leyendo apt, sin sondear a Horse Pack), reinicio pendiente, espacio en disco y qué se puede limpiar (usa el análisis de Elephant si ya está hecho;
si no, estimaciones baratas: **no despierta a Elephant**, cuyo análisis completo tarda minutos), servicios con error, salud del SSD (lectura SMART guardada por Chameleon), salud de la batería y espacio recuperable en Docker.
Solo lee. Cada punto lleva a la herramienta que lo arregla; el resultado se conserva y deja un aviso en el registro.

## Interfaz unificada y tema compartido

ZOO es ahora un marco con barra lateral (Panel, Mantenimiento, Avisos, Modos, Gestionar apps y una entrada por herramienta que se abre **dentro** de ZOO, en un iframe; al salir se descarga para que no mantenga despierta a la app).
Si el marco no te conviene, «↗ Pestaña nueva» abre la app aparte. Las apps detectan que van enmarcadas (`html.embedded`) y ocultan su cabecera de marca.
**Tema compartido:** `static/zoo-theme.css` (colores, semáforo, series, foco, scrollbars, reglas del modo enmarcado) es la única fuente; `scripts/sync-theme.sh` lo copia a Chameleon, Bee, Beaver, Elephant y Horse Pack,
que lo cargan antes de su `style.css` y solo definen su acento. Docker Kong (Next.js/Tailwind) no lo usa: se enmarca tal cual.
