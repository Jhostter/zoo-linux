# 🐜 Ant

Panel local para ver y organizar agentes de **Antigravity**. Solo stdlib de Python,
escucha en `127.0.0.1:4511`. Parte de la suite ZOO Linux.

- **Inicio**: estado general, lanzamiento rápido (tarea + rol/equipo + workspace), lo que corre ahora y recientes.
- **Enjambres**: observa en vivo los swarms nativos (`/swarm`): agentes, estado, tablero (Markdown, filtro por agente), grafo de menciones. Solo lectura.
- **Lanzador**: asistente en pasos (tarea → quién → dónde → avanzado) con **resumen y avisos** antes de lanzar; un agente o un enjambre con equipo; relanzar, detener, descartar.
- **Workspaces**: reúne las fuentes de Antigravity (proyectos, IDE, CLI) + carpetas añadidas en Ant; instala roles por equipo; «Lanzar aquí».
- **Roles y equipos**: 25 roles en 6 categorías (producto/diseño, construcción, **móviles nativos y multiplataforma**, **migraciones**, calidad/seguridad, operaciones) y 8 equipos prediseñados; editor de roles propios (`~/.config/ant/roles/`).
- **Lanzamientos** (`#/runs`, tecla `4`): historial completo de todo lo lanzado desde Ant, con búsqueda (tarea, workspace, rol, modelo), filtro por estado (en marcha, terminadas, con problemas, detenidas), selector de workspace, tokens medidos y duración de cada uno; pulsar uno abre su detalle (`#/runs/<id>`). Inicio sigue mostrando los 6 últimos con un enlace «Ver todos».
- Rutas reales (`#/runs/<id>`, `#/swarms/<id>`), tema claro/oscuro, atajos (`?`), accesible (contraste AA verificado, foco visible, `prefers-reduced-motion`) y adaptable a móvil.

Instalar el servicio: `sh scripts/install-service.sh`. Pruebas: `test/make_fixture.py`
crea un `~/.gemini` de juguete; arrancar con `ANT_GEMINI_DIR=<dir>/gemini ANT_PORT=4599`.

## Qué NO está verificado
El formato de `board.jsonl` / `members.json` sale del README del plugin swarm de
Antigravity; no había ningún swarm real en la máquina al construirlo, así que el
parser se probó solo con datos de ejemplo. El estado «trabajando/esperando» es una
aproximación (`wait_since` + `killed`). Si Antigravity cambia ese formato interno, el
observador puede dejar de mostrar datos (no rompe nada más).

## 💼 La Oficina del Prompt (stream)

Escena para OBS: los agentes reales (ejecuciones del Lanzador y miembros de enjambres)
aparecen como empleados en cubículos; tú eres el jefe del látigo. Estados: trabajando
(teclea), esperando (café, zZ), entregado (celebra), falló (humo, ERR), sin cuota
(pantalla gris), detenido (caja «DESPEDIDO»). Una orden nueva = latigazo.

- **Para OBS:** fuente *Navegador*, `http://localhost:4511/office`, 1920×1080.
  Parámetros: `?title=Texto` · `?bg=transparent` · `?sound=1` (chasquido; activa «Controlar audio vía OBS»)
  · `?demo=1` (agentes inventados, para ensayar) · `?reveal=1` (muestra la tarea real).
- **Para mandar órdenes:** abre en otra pestaña `http://localhost:4511/office?control=1`
  (workspace, modelo, modo, orden, 🔥 Látigo / 🔥🔥 A todos). No lo captures con OBS.
- **Privacidad:** por defecto NO se muestra contenido real (ni tareas, ni rutas, ni nombres de
  proyecto): solo rol y frases cómicas. Con `?reveal=1` se ve la primera línea de la tarea.
- Los terminados se quedan 3 min en su cubículo; máximo 8 a la vez (cuenta ejecuciones y enjambres).

### Estética: distopía corporativa (sátira oscura) y UI diegética
La oficina es un diorama 3D sucio y cableado: paredes manchadas, moqueta quemada, cielo contaminado,
fluorescentes que parpadean. Todo dato vive **dentro** de la escena, sin paneles de caja encima:
- **Montañas de papel = tokens quemados hoy** (dato real de Ant) y papeles cayendo de tolvas del techo.
- **Tubos de café** inyectados a cada silla ocupada (fluyen más rápido si el agente trabaja).
- **El Ojo del Jefe**: monitor gigante cuya pupila sigue al jefe y se enrojece con cada latigazo o fallo.
- **Marcador de estadio** con «ENTREGADAS HOY», trabajando, quemados, latigazos y tokens; cartel de neón
  con el título (`?title=`) y lámpara «EN VIVO».
- **Agentes** con ojeras, sudor y tecleo inhumano. **Si un agente falla, su escritorio explota y arde**
  (solo al producirse el cambio; al cargar la página no explota nada) y el Ojo se pone rojo.
- Rendimiento: la geometría estática se fusiona por material y los personajes se «hornean» por pieza (≈290 llamadas de dibujo en vez de ≈700); sombras a 1024 y densidad de píxeles ≤1,5.
- Insignias y globos son sprites 3D. La única capa 2D es una **terminal** verde sobre negro, sin bordes,
  abajo a la izquierda, con las frases del jefe y los eventos de los agentes reales.

### Interactuar con los agentes (modo operador)
`/office?control=1` (o `?interact=1`) activa la interacción; la oficina del stream (sin esos parámetros) nunca captura clics.
- **Seleccionar:** clic en un agente (o teclas `1`–`8`, `Tab`) → la cámara se acerca y lo sigue, aparece su **ficha** (terminal,
  sin cajas) con modelo, tiempo, tokens, pasos, presupuesto, qué hace y carpeta. Arrastrar gira la cámara, la rueda acerca,
  `Esc`/doble clic/`0` la recolocan. Sin `?control=1` la ficha solo muestra categorías (nada de carpeta, tarea ni mensajes).
- **Acciones reales** (solo sobre agentes lanzados desde Ant; si no se puede, el botón explica por qué): *despedir* (con
  confirmación; detiene la ejecución, o todo el enjambre), *reanudar*, *reintentar*, *+50k tokens* (amplía el presupuesto de una
  ejecución en marcha), *recado* y *nueva tarea*. El **recado** continúa la conversación con `agy --conversation <id>`: a un agente
  en pleno turno no se le puede hablar (`agy --print` no es interactivo), así que queda **en cola** y se envía al terminar bien.
- **Efectos teatrales:** látigo dirigido, café gratis (se espabila y sorbe), felicitar (el jefe va y aplaude) y regañar (el jefe
  señala con el dedo). Se envían al servidor (`POST /api/office/fx`) y los reproduce también la oficina del stream.
- **Cámara automática** (stream; `?cam=fixed` la desactiva, botón «Cámara auto» en la barra del operador): enfoca el látigo, las
  explosiones, el extintor y las entregas, y vuelve al plano general; no pisa al operador cuando mueve la cámara a mano.
- **Comandos del público** (solo efectos teatrales; **nunca** acciones reales): `!latigo [rol|n|todos]`, `!cafe`, `!aplaudir`, `!reganar`,
  `!camara`, `!ayuda`, con enfriamiento por usuario (15 s) y global (2 s). Llegan por Twitch (lectura anónima del chat, sin
  credenciales: `ANT_TWITCH_CHANNEL=micanal` o `~/.config/ant/chat.json` con `{"twitch_channel": "micanal"}`) o por
  `POST /api/office/command {text, user}` desde cualquier otro bot (YouTube, Nightbot…). La conexión a Twitch está probada contra un IRC
  simulado, **no contra Twitch real**.

### Todo lo que se ve es real
Con un enjambre vivo o un agente trabajando **no hay figurantes** (solo salen cuando no hay nadie real). Un enjambre cuenta como vivo si tuvo actividad (tablero o transcripts) en los últimos 20 min (`ANT_SWARM_LIVE_SECS`): los abandonados, cuyos miembros se quedan «esperando» para siempre, no aparecen. Las etiquetas dicen la verdad:
un miembro que espera mensajes de otros pone «esperando a otros» (no «esperando órdenes»), uno sin actividad >5 min «sin actividad
reciente», y se queda en su mesa; los agentes sin rol se distinguen por el final de su id (`AGENTE 962F`); los apodos de las mesas y
los roles de figurantes/demo no se repiten.

### Látigo, sonido y efectos reales del jefe
- **Látigo:** una cuerda de 30 puntos con dos tramos (grueso junto a la mano, fino en la punta). El jefe arma el brazo hacia atrás (la cuerda se enrolla), lo
  lanza con todo el cuerpo y la **onda recorre la cuerda** hasta que la punta llega al agente en el chasquido (t = 0,56 s de simulación), con destello en la
  punta, chispas, tajo rojo, sacudida fuerte y **cámara lenta de impacto**; el agente golpeado se lleva las manos a la cara («¡AU!») y los vecinos se encogen.
- **Sonido sintetizado** (WebAudio, sin archivos; apagado por defecto): `?sound=1` para el stream/OBS (`?vol=0.6`, `?hum=0` quita el zumbido) o el botón
  **🔊 Sonido** de la barra del operador (se recuerda). 14 sonidos: whoosh + crack + ouch del látigo (con panorama según el agente), tecleo ambiente, alarma al
  fallar, estallido, chisporroteo del fuego, siseo del extintor, café, aplausos, gruñido de la bronca, campanita al terminar, «fiuu» del avión de papel y «blip»
  de los comandos del público. Los navegadores exigen un gesto del usuario para arrancar el audio (en OBS no).
- **Efectos reales opcionales** (solo operador, `?control=1`): en la ficha, el interruptor **«efecto real»** (apagado por defecto, se recuerda) hace que
  **felicitar** dé +50k tokens al presupuesto de esa ejecución y que **regañar** deje un recado en cola (texto editable). Siempre pide confirmación; máximo 3
  bonos del jefe por ejecución; solo en agentes lanzados desde Ant. `POST /api/office/boss {kind, target, real, text?, tokens?}`. El **público nunca**
  tiene efecto real: sus comandos solo hacen teatro.

### Quién es cada agente y qué hace
Cada agente real lleva sobre la cabeza una etiqueta 3D con **su rol** (`IMPLEMENTER`, `parser`…) y **lo que está
haciendo ahora**; la placa de su mesa repite el rol. La actividad sale de la herramienta que el agente usa de verdad
(leída del transcript de Antigravity) y se agrupa en categorías genéricas: ✍️ escribiendo código, 📖 leyendo archivos,
⚙️ ejecutando comandos, 💭 pensando, 📣 coordinando, ⏳ esperando a otros, 🌐 consultando la web. Cada una se anima
distinto (teclea, barre líneas con la vista, ráfagas + pausa mirando la terminal, mano en la barbilla, gesticula y
habla, tamborilea) y el monitor muestra lo suyo (código, documento, terminal verde, puntos que laten, chat, rueda de
espera, navegador). Los que no trabajan llevan la etiqueta más pequeña con su estado; los figurantes solo una insignia.
- **Privacidad:** por defecto solo se ve la categoría; el nombre de la herramienta y su argumento (`write_file: …`)
  aparecen únicamente con `?reveal=1`. El workspace y la tarea nunca se muestran sin `?reveal=1`.
- La terminal anota los cambios de actividad (como mucho uno cada 15 s por agente).

### Vida de los personajes
Cada agente tiene carácter fijo según su id (nervioso, vago, ansioso, estoico, chismoso) y reacciona al entorno:
- **Mirada y nervios:** miran a su pantalla; echan ojeadas al jefe; si el jefe se acerca se yerguen y teclean más
  rápido, y suspiran de alivio cuando se va. Un latigazo hace que los vecinos se encojan y miren.
- **Micro-gestos** (12): frotarse los ojos, estirarse, bostezar, crujir nudillos, sorbo del tubo de café, girar el
  cuello, mirar el móvil, tamborilear con el bolígrafo, recostarse, mirar alrededor, gesticular y toser. Ocioso
  mucho rato = se duerme (Zzz) y se sobresalta si llega el jefe.
- **Cansancio real:** crece con el tiempo que lleva ejecutándose el agente (más ojeras, sudor, encorvado, párpados
  caídos, bostezos).
- **Fallo:** primero pánico (tecleo frenético, glitch en el monitor, grito), luego explota; queda tiznado y tosiendo;
  los compañeros se asustan y uno acude con el extintor y apaga el fuego.
- **Éxito:** celebra (puño, baile o giro en la silla) y lleva el informe a la mesa del jefe, que gruñe una frase.
- **Vida social:** los mensajes reales del enjambre salen volando como **aviones de papel** entre los agentes (la API
  solo da quién escribe a quién, nunca el contenido); el coordinador visita las mesas; los figurantes van al
  dispensador, a la impresora o a mirar por la ventana, y charlan si coinciden.

### Estilos visuales (selector en Ant)
La oficina se puede ver en tres estilos; se cambian desde Ant, en la barra lateral **🎨 Estilo de la oficina**
(tarjetas con miniatura). El elegido se guarda en `~/.config/ant/office.json` (`ANT_OFFICE_FILE`) y la oficina
abierta, incluida la fuente de navegador de OBS, lo recoge sola con su sondeo: no hay que recargar.

| Estilo | Qué es |
|---|---|
| **voxel** (por defecto) | Bloques tipo Minecraft con luz cálida; dibuja directo, sin post-proceso. |
| **toon** | Dibujo animado: contornos oscuros (detección de bordes sobre la profundidad), colores por escalones, sombras levantadas. |
| **cyber** | Cyberpunk: neones magenta/cian, niebla violeta, bloom, aberración cromática, grano y viñeta. |

- `?style=voxel|toon|cyber` en la URL fuerza uno solo en esa ventana (tiene prioridad sobre el guardado).
- API: `GET /api/office/style` → `{style, styles}`; `POST /api/office/style {style}` (cabecera `X-Ant: 1`). `/api/office` incluye `style`.
- El post-proceso está escrito a mano (`static/office-fx.js`, sin librerías extra); las etiquetas y burbujas se dibujan
  en una pasada aparte para que sigan nítidas. Las miniaturas del selector son `static/styles/*.jpg`.

### Figurantes (empleados de ambiente)
Con pocos agentes reales, la oficina se rellena hasta 5 «figurantes» (etiquetados así) que trabajan,
descansan y se queman al azar; el jefe les da algún latigazo si no hay trabajo real. No cuentan en los
marcadores. Se ceden el sitio a los agentes reales. `?ambient=0` los desactiva, `?ambient=N` (1–8) fija cuántos.

## Varios `/swarm` en una misma conversación = enjambres individuales
Antigravity guarda **un solo enjambre por conversación**: cada `/swarm …` nuevo escrito en esa misma conversación sustituye el título y
añade workers al mismo `members.json`/`board.jsonl`. Ant los separa: lee el transcript del coordinador (de forma incremental, puede pesar
varios MB) y reparte cada lanzamiento con **su título** (`swarm title`), **su tarea** (el texto del `/swarm`), **sus agentes** (los
`swarm add`; el coordinador y el monitor de bloqueos, compartidos, acompañan al último) y **su tablero** (cada mensaje va al lanzamiento
de su autor o, si es del coordinador, al de a quién se dirige; los demás heredan el anterior). Ids: `<conversación>~<n>`; el id de la
conversación sin `~` abre el último, así que los enlaces antiguos siguen valiendo. Una conversación con un solo `/swarm` (o sin transcript)
se muestra como siempre. La oficina del stream solo usa el lanzamiento vigente de cada conversación.

### Detalle de un enjambre
- **Cabecera:** estado real (*en ejecución* / *esperando* / *terminado ✓*), nº de agentes y mensajes, duración (cronómetro vivo si sigue en
  marcha), tokens de los agentes del lanzamiento (el coordinador y el monitor sirven a todos los `/swarm` de la conversación y se marcan como
  compartidos) y la última actividad. Selector de los demás lanzamientos de la conversación, la **tarea** completa, una barra de
  «N de M agentes entregaron» y, al terminar, el **resultado final** (el `[done]` del coordinador).
- **Equipo:** una tarjeta por agente (los que trabajan primero; coordinador y monitor al final) con su estado, cuántos pasos, tokens y
  mensajes lleva, qué hace ahora (categoría legible + herramienta cruda) y **su entrega** (`entregó #n` salta a ese mensaje). Pulsarla filtra el tablero.
- **Conversación del equipo:** cada mensaje con avatar, destinatarios (`→ @a @b`), hora, tipo (entrega / bloqueo / hallazgos), copiar y colapso con
  degradado; avisos «⏱ 12 min después» entre fases; búsqueda de texto y filtros Todo / Entregas / Alertas / por agente.
- **Quién delega a quién** (ancho completo): diagrama **por rondas**. Arriba el coordinador; debajo, los que trabajan en paralelo; luego los que
  esperan las entregas de otros. Tres relaciones distintas: **reparto** (violeta: la primera orden del coordinador a cada agente), **entrega a quien la
  espera** (verde: sale del «Espera a que @x, @y publiquen…» del brief de cada agente, no de todas las menciones) y **correcciones y dudas** entre
  agentes (ámbar discontinuo, con nº de mensajes). La entrega al coordinador es una marca ✓ en cada agente (con su hora), las dudas al coordinador una
  insignia con su número y las alertas del monitor un nodo aparte. Se resalta al pasar por un agente y un clic filtra el tablero. Los tipos de
  mensaje se deciden por el INICIO del texto: un brief que *pide* un `[done]` no es una entrega, uno que *empieza* por `[done]` sí.
  **Línea de tiempo:** cuándo entró cada agente, cuándo habló (cada punto salta a su
  mensaje) y cuándo entregó (✓). Accesible con teclado y adaptada a móvil.

## Enjambre con Orchestrator (Argon)
En el Lanzador, «Lanzar como enjambre» ejecuta `agy --print "/swarm <tarea>"` con el modelo
**Orchestrator (Argon)** como coordinador (`gemini-pro-orchestrator-g1-pro`: planifica con Argon y delega la
ejecución en Gemini 4 Hydrogen). Se puede fijar el modelo de los workers (se indica en el prompt).
Los miembros del enjambre aparecen en la pestaña Enjambres y como empleados en `/office`.

**Permisos (importante):** en modo headless `agy` no puede preguntar; si una herramienta necesita un permiso no
concedido, la ejecución se **aborta con código 0 y sin salida** (Ant lo muestra como «bloqueada por permisos»).
«Permitir comandos habituales» pasa `--settings` (solo esa sesión, no se guarda) con una lista acotada
(git local, ls, cat, grep…; sin `git push`). «Aprobar todos» = `--dangerously-skip-permissions`, bajo tu responsabilidad.

Ant lee las conversaciones de los **tres** directorios `~/.gemini/{antigravity,antigravity-cli,antigravity-ide}/brain`
(el CLI `agy` escribe en `antigravity-cli`).

## Pruebas
- `python3 test/test_runs.py` — API (agy falso + git real).
- `python3 test/ui_env.py <dir>` crea un entorno aislado; arrancar `server.py` con las variables que imprime (puerto 4590) y
  `node test/ui_test.mjs http://localhost:4590 <dir_capturas>` — E2E en Chrome real (100 comprobaciones, sin dependencias). `test/test_launches.py` + `test/ui_launches.mjs` (con `ui_env.py <dir> --multi`) prueban la separación de lanzamientos.
- `node test/ui_smoke.mjs http://localhost:4511` — humo de solo lectura contra el servicio real.

## 🧠 Orquestador eficiente (ahorro de tokens)
El **Lanzador automático** (por defecto, también en Inicio y en la barra del jefe de `/office?control=1`) planifica **antes de gastar**:
analiza la tarea (tipo, esfuerzo XS–XL, frentes independientes) y decide *un agente barato* o *un enjambre mínimo*, el rol, el modelo, los permisos,
un **presupuesto de tokens** y una **estimación** con sus motivos y las alternativas descartadas. Planificar cuesta **0 tokens** (local y determinista, `planner.py`).
- **Sin azar:** mismas entradas → mismo plan; tareas simples nunca generan enjambre; cada decisión es explicable (`¿Por qué este plan?`).
- **Medición real:** cada ejecución lleva una marca `[ant-run:ID]` para localizar su conversación y sumar los tokens reales (`usage.py`, también por agente en un enjambre).
- **Presupuesto con corte:** un vigilante (cada 2 s) detiene la ejecución si lo supera (estado «presupuesto agotado»). El corte llega con margen de ~un paso de agente (observado +20 %). Detener el proceso detiene también a los workers (verificado: 0 tokens tras el corte).
- **Guardas:** plan caro (> 300 k) y tarea repetida piden confirmación; permisos de solo lectura concedidos de antemano (un permiso denegado **aborta** la ejecución y esos tokens se pierden); sin monitor ni narrator en los enjambres.
- **Calibración:** las estimaciones empiezan como heurísticas y pasan a la mediana medida cuando hay ≥ 3 ejecuciones del mismo esfuerzo/tipo.

### Lo que se midió (no se asume)
| Hecho | Medición |
|---|---|
| Swarm trivial (2 archivos) con monitor | ≈ 470 k tokens procesados; coordinador 63 %, monitor 12 % |
| Mismo tipo de tarea con un agente | ≈ 15–20 k |
| Reglas de ahorro en el prompt (tarea pequeña) | sin efecto medible (16,9 k vs 17,0 k): no es lo que ahorra |
| Lo que sí ahorra | no usar enjambre si no hace falta, nivel de modelo, evitar abortos, cortar por presupuesto |
- Las reglas genéricas de ahorro en el prompt se retiraron: medido sin efecto en tareas individuales; solo se conservan las del enjambre (sin monitor/narrator, tope de workers).

## Enjambres cortados y ejecuciones bloqueadas
- **Reanudar:** si una ejecución se interrumpe (presupuesto, tiempo, parada, cuota) y su copia aislada conserva trabajo, el detalle ofrece «Reanudar con un agente»:
  lanza UN agente (más barato que el enjambre) en la **misma copia y rama**, con un resumen automático (motivo, commits, archivos y últimos mensajes del tablero) y la orden de no rehacer lo hecho. La ejecución original cede su copia (descartarla ya no la borra).
- **Bloqueo por permisos:** se muestra el comando exacto que se denegó y los tokens perdidos, con «Relanzar permitiendo scripts del proyecto» (npm/pnpm/yarn run, tests, tsc, eslint…) o «con todos los permisos». El planificador activa el perfil de scripts solo si el proyecto los define.
- **PATH de los agentes:** un servicio de systemd arranca sin `node`/`npm` del usuario (nvm, fnm, volta, cargo…). Ant los añade al PATH de cada agente (`ANT_EXTRA_PATH` para añadir más). Verificado con `agy` real.
- **Enjambres que no arrancan:** la pestaña Enjambres lista también los lanzados desde Ant que aún no existen en Antigravity (el coordinador está planificando) o fallaron antes de crear workers.

## 🔗 Dependencias enlazadas (node_modules)
Una copia aislada (git worktree) no trae `node_modules` ni `.env`, así que `npm run type-check`, tests o lint no podían ejecutarse en ella. Con el perfil «scripts del proyecto»,
Ant **enlaza** (symlink, sin copiar gigas) los `node_modules` de la carpeta principal —raíz y a 1–2 niveles: `apps/*`, `packages/*`…— dentro de la copia. Es opt-in en el modo manual y automático cuando el plan detecta scripts.
Salvaguardas (todas con prueba):
1. `.gitignore` con `node_modules/` **no ignora un enlace** (solo carpetas): Ant añade una línea marcada `# ant: enlaces de dependencias…` + `node_modules` a `.git/info/exclude` (idempotente; puedes borrarla sin riesgo). Así ni `git status` ni `git add -A` ven el enlace.
2. Al descartar, primero se **desenlaza** y nunca se sigue el enlace: tus dependencias reales no se tocan (verificado con PrestaCore: mismas entradas y fechas).
3. El agente recibe la orden de **no instalar ni modificar** dependencias (los comandos install/add/remove tampoco están permitidos), y si el contenido compartido cambia aun así, el detalle lo marca con un aviso rojo.
4. Límite conocido: en monorepos con paquetes internos enlazados dentro de `node_modules`, esos se resuelven contra la carpeta principal, no contra la copia (se avisa al agente).
No se enlaza `.env` (contiene secretos).
