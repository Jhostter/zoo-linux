# 🐾 ZOO Linux

**Una suite de paneles web locales, pequeños, para gestionar tu escritorio Linux; cada uno con nombre de animal.**
Solo biblioteca estándar de Python, sin compilar nada, sin nube ni telemetría. Cada app es un servicio de *usuario* de systemd
que sirve una web en `127.0.0.1`, y un lanzador (`zoo`) las une.

🇬🇧 [English README](README.md)

| | App | Qué hace | Puerto |
|---|---|---|---|
| 🐾 | **ZOO** (`zoo/`) | Lanzador y centro de control: estado/CPU/RAM de las apps, iniciar/parar, avisos, modos (juego / batería / trabajo / cine), arranque bajo demanda | 4400 |
| 🐘 | **Elephant** | Limpiador de disco: cachés, papelera, logs y kernels viejos, archivos grandes, explorador | 4477 |
| 🐝 | **Bee** | Gestor de systemd: servicios, temporizadores, sockets, arranque, autostart, cron, asistentes | 4488 |
| 🦫 | **Beaver** | Memoria y swap: consumo por aplicación, zram, swappiness, systemd-oomd, límites por servicio | 4499 |
| 🦎 | **Chameleon** | Sensores y hardware: temperaturas, salud de batería, perfiles de energía, GPU NVIDIA, inventario, historial y avisos | 4500 |
| 🐴 | **Horse Pack** | Paquetes: apt/dpkg, `.deb`/tar/AppImage, Flatpak, Snap, diagnóstico de bloqueos de apt | 4466 |
| 🐜 | **Ant** | Panel de enjambres de agentes de [Antigravity](https://antigravity.google) (+ oficina 3D para stream con estilos toon/cyberpunk) | 4511 |
| 🐵 | **[Docker Kong](https://github.com/Jhostter/docker-kong)** | Gestor de Docker (Node.js), repositorio aparte | 4455 |

> **Estado: alfa.** Desarrollada y probada en un solo equipo (Pop!_OS 24.04 + COSMIC, Python 3.12, x86-64). Está pensada para
> degradar con elegancia en otros sistemas; consulta [docs/PORTABILITY.md](docs/PORTABILITY.md) para ver qué está verificado y qué no.
> Varias acciones con privilegios (`pkexec`) solo se probaron con binarios falsos. **Lee lo que hace una acción antes de confirmarla:
> estas herramientas pueden borrar archivos y parar servicios.**

## Instalación

Requisitos: Linux con **systemd** (sesión de usuario) y **Python ≥ 3.9**. Ningún paquete pip.

```sh
git clone https://github.com/Jhostter/zoo-linux.git
cd zoo-linux
./install.sh --dry-run        # ver qué haría
./install.sh                  # lanzador + apps recomendadas para este equipo
# ./install.sh --all          # todo (incluida Ant)
# ./install.sh --apps bee,elephant --tray
```

Abre **http://localhost:4400**. Los servicios corren como tu usuario (sin root), arrancan con tu sesión y tienen límites de
CPU/RAM. Las unidades apuntan a esta carpeta: no la muevas (si la mueves, vuelve a ejecutar `./install.sh`).
Para quitarlo todo: `./uninstall.sh` (nunca borra tus datos).

Sin instalar nada: `python3 zoo/server.py` (o cualquier `apps/<app>/server.py`).

## Reglas comunes

Solo escucha en `127.0.0.1`; valida Host/Origin; los POST exigen una cabecera propia; sin dependencias; tema claro/oscuro; las acciones
con privilegios usan `pkexec` y, si no hay agente polkit, muestran el comando `sudo …` para copiar; los borrados piden confirmación;
consumo mínimo (límites de CPU/RAM y arranque bajo demanda).

## Contribuir

Ver [CONTRIBUTING.md](CONTRIBUTING.md). Se agradece sobre todo: pruebas en otras distros/escritorios, traducciones (la interfaz está en
español) y nuevos animales. Seguridad: [SECURITY.md](SECURITY.md). Licencia: [MIT](LICENSE).
