# 🐴 Horse Pack

Horse Pack: panel web local para gestionar paquetes nativos (apt/dpkg). Solo biblioteca estándar de Python.

    python3 server.py        # http://localhost:4466

- Listar, filtrar, buscar, ver info, instalar, desinstalar, purgar, `apt update`, actualizar y autoremove.
- Las operaciones con privilegios usan `pkexec` (polkit pide la contraseña).
- Escucha solo en 127.0.0.1, valida Host/Origin, exige cabecera `X-Gestor` en POST y valida nombres de paquete.
- Puerto configurable con `GESTOR_PAQUETES_PORT`.

## Servicio

    ./scripts/install-service.sh   # systemd de usuario, arranca al iniciar sesión
    systemctl --user restart gestor-paquetes

## Icono de bandeja

    ./scripts/install-tray.sh   # caballo en la barra de estado (Python + AyatanaAppIndicator3), con autoarranque

## Operaciones persistentes y procesos bloqueantes

- Las operaciones de apt se lanzan desacopladas y su salida se guarda en `~/.local/share/gestor-paquetes/jobs/`: al recargar el navegador o reiniciar el servicio, el panel retoma la que siga en curso.
- Si otro proceso (apt, dpkg, unattended-upgrades, PackageKit…) tiene bloqueado apt, el panel lo detecta: puedes esperar (`DPkg::Lock::Timeout`) o ir a la vista **Procesos** para detenerlo (TERM) o forzarlo (KILL) con polkit.
- La vista **Procesos** también ofrece `dpkg --configure -a` y muestra `dpkg --audit`.

## Agrupación de instalados

Vista **Instalados** agrupable por tipo (aplicaciones con lanzador .desktop e icono / instalados por ti / bibliotecas y dependencias), por sección de dpkg o sin agrupar. Los grupos se pliegan; se recuerda la elección.

## Rendimiento

Vista **Rendimiento**: CPU, memoria/swap, disco, consumo del propio servicio (cgroup, con sus límites) y los procesos con más CPU o memoria, refrescados cada 2 s mientras la vista está abierta. Solo lee `/proc` y `/sys/fs/cgroup`.

## Flatpak y Snap

Horse Pack gestiona también **Flatpak** y **Snap**, junto a apt, con un selector de origen (**Todo / apt / Flatpak / Snap**) en Instalados, Buscar y Actualizaciones.

- **Instalados:** apps y runtimes de Flatpak (los runtimes se muestran con la casilla «runtimes») y snaps, con su icono, versión, tamaño y ámbito (sistema/usuario).
- **Buscar:** busca a la vez en apt, Flatpak y Snap; los resultados salen agrupados por origen.
- **Actualizaciones:** muestra «versión vieja → nueva» y botones para actualizar todo Flatpak o todo Snap; el contador del menú suma los tres orígenes.
- **Detalle:** versión, rama, licencia, origen, runtime y **permisos** de las apps Flatpak; para instalar se elige ámbito (sistema o usuario) y remoto.
- **Acciones:** instalar, desinstalar (con opción de borrar los datos), actualizar y «quitar runtimes sin uso». Las de sistema piden tu contraseña (`pkexec`); las de usuario no.
- **Selección mixta:** puedes marcar paquetes de varios orígenes y actuar a la vez; Horse Pack los agrupa por origen y ámbito y los ejecuta en cadena.
- **Snap sin instalar:** si `snapd` no está, la vista lo explica y ofrece instalarlo con apt.
- Los enlaces admiten parámetros: `#search?src=flatpak&q=telegram`, `#installed?src=snap`.

Seguridad: identificadores, remotos, canales y ámbitos se validan con listas estrictas; el remoto debe existir en el ámbito elegido; los runtimes no se desinstalan sueltos.

> Snap está verificado solo contra salidas de ejemplo (en el equipo de desarrollo `snapd` no estaba instalado).
