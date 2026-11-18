# Portability & support matrix

ZOO Linux was built and tested on **one machine**: Pop!_OS 24.04 (COSMIC desktop), Python 3.12, x86-64, NVIDIA + Intel
hybrid laptop. This page says honestly what that means elsewhere. "Verified" = exercised by a person or by `test/smoke.py`.

## Hard requirements
| Need | Why | Verified |
|---|---|---|
| Linux + **systemd user session** | Apps run as `systemctl --user` services | yes (Pop!_OS) |
| **Python ≥ 3.9** | Uses `str.removesuffix` etc.; no third-party packages | 3.12 only — older versions untested |
| A browser | The UI is a local web page | Chrome/Chromium |

Without systemd you can still run any app by hand (`python3 apps/<app>/server.py`); the launcher's start/stop will not work.

## Graceful degradation (`python3 test/smoke.py --bare`)
`--bare` starts every app with an **empty `PATH`** (no `systemctl`, `apt`, `nvidia-smi`, `flatpak`, …) and checks that
each still serves its page and API without crashing. Missing tools produce empty/“unsupported” sections, not errors.

## Per app
| App | Works anywhere with systemd | Distro/desktop specifics |
|---|---|---|
| ZOO launcher | yes | "Do Not Disturb" detection/toggle uses COSMIC's config (other desktops: ignored). "Open in terminal" tries `cosmic-term`, `gnome-terminal`, `kitty`, `x-terminal-emulator`. Notifications use `gdbus` (freedesktop). Maintenance check uses `apt` for pending updates (skipped elsewhere). Tray icon needs GTK3 + AyatanaAppIndicator. |
| Elephant | yes | Package-cache/kernel cleaning is apt/Debian-oriented (`apt`, `journalctl`, `/boot`); user caches, trash (`gio trash`) and big files are generic. |
| Bee | yes | Autostart entries understand XDG autostart; "does not apply to COSMIC" detection is COSMIC-specific. |
| Beaver | yes | zram/sysctl/oomd changes write to `/etc` via `pkexec`. `systemd-oomd` is optional. |
| Chameleon | partly | Sensors (`hwmon`, thermal zones), battery and CPU are generic. **Power profiles use `system76-power`** (other daemons such as power-profiles-daemon are not supported yet). GPU info/limits need `nvidia-smi` (NVIDIA only). Graphics-mode switching: system76-power only, and never executed by the test-suite. |
| Horse Pack | **Debian/Ubuntu family only** | Built on apt/dpkg. Flatpak and Snap views work if those tools exist. On Fedora/Arch/openSUSE it starts but has no package data. |
| Ant | yes | Only useful with [Antigravity](https://antigravity.google) installed (reads its local data, can launch its `agy` CLI). |

## Privileged actions (`pkexec`)
Actions needing root (apt, zram, oomd, GPU limit, NVMe health, RAM inventory, killing other users' processes) call
`pkexec` with fixed argument lists. **They were never run for real in every case** — several were verified only
against fake `pkexec`/`systemctl` binaries. On setups where no polkit agent is reachable from a user service (we hit this on COSMIC),
the apps return the equivalent `sudo …` command to run in a terminal instead of failing.

## Known rough edges
- UI text and the per-app READMEs are in **Spanish**. i18n is not implemented.
- Horse Pack's service is still called `gestor-paquetes` and Docker Kong's `docker-gestor` (legacy names, kept for compatibility).
- Ports are fixed defaults (4400, 4455, 4466, 4477, 4488, 4499, 4500, 4511); override per app with `ZOO_PORT`, `BEE_PORT`, `BEAVER_PORT`,
  `ELEPHANT_PORT`, `CHAMELEON_PORT`, `GESTOR_PAQUETES_PORT`, `ANT_PORT` (and register the new port in the launcher).
- No packaging yet (`.deb`, AUR, Flatpak…). Install is "clone and run `install.sh`".
- Wayland/X11, GNOME, KDE, Xfce, Fedora, Arch: **not tested** — reports welcome (use the "Compatibility report" issue template).
