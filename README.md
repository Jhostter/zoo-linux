# 🐾 ZOO Linux

**A suite of small, local web panels to manage your Linux desktop — each one named after an animal.**
Pure Python standard library, no build step, no cloud, no telemetry. Every app is a systemd *user* service
that serves a web page on `127.0.0.1`, and one launcher (`zoo`) ties them together.

🇪🇸 [Léeme en español](README.es.md)

| | App | What it does | Port |
|---|---|---|---|
| 🐾 | **ZOO** (`zoo/`) | Launcher & control center: app status/CPU/RAM, start/stop, alerts feed, usage modes (gaming / battery / work / cinema), "wake on demand" so idle apps cost nothing | 4400 |
| 🐘 | **Elephant** | Disk cleaner: caches, trash, old logs/kernels, big files, folder explorer | 4477 |
| 🐝 | **Bee** | systemd manager: services, timers, sockets, boot analysis, autostart, crontab, wizards to create units/timers | 4488 |
| 🦫 | **Beaver** | Memory & swap: per-app usage, zram, swappiness, systemd-oomd, per-service limits | 4499 |
| 🦎 | **Chameleon** | Sensors & hardware: temperatures, battery health, power profiles, NVIDIA GPU, inventory, history & alerts | 4500 |
| 🐴 | **Horse Pack** | Package manager: apt/dpkg, `.deb`/tar/AppImage, Flatpak, Snap, apt lock diagnosis | 4466 |
| 🐜 | **Ant** | Dashboard for [Antigravity](https://antigravity.google) agent swarms (+ a 3D "stream office" with toon/cyberpunk styles) | 4511 |
| 🐵 | **[Docker Kong](https://github.com/Jhostter/docker-kong)** | Docker manager (Node.js) — separate repository | 4455 |

> **Status: early / alpha.** Developed and tested on one machine (Pop!_OS 24.04 + COSMIC, Python 3.12, x86-64).
> Everything is designed to degrade gracefully elsewhere, but see [docs/PORTABILITY.md](docs/PORTABILITY.md)
> for what is and isn't verified. Several privileged actions (anything using `pkexec`) have only been tested
> with fake binaries. **Read what an action does before confirming it — these tools can delete files and stop services.**

### Ant's stream office in its three visual styles (voxel · toon · cyberpunk, switchable from Ant)

<p>
<img src="apps/ant/static/styles/voxel.jpg" width="32%" alt="voxel style">
<img src="apps/ant/static/styles/toon.jpg" width="32%" alt="toon style">
<img src="apps/ant/static/styles/cyber.jpg" width="32%" alt="cyberpunk style">
</p>

## Install

Requirements: Linux with **systemd** (user session), **Python ≥ 3.9**. No pip packages.

```sh
git clone https://github.com/Jhostter/zoo-linux.git
cd zoo-linux
./install.sh --dry-run        # see what would happen
./install.sh                  # launcher + recommended apps for this machine
# ./install.sh --all          # everything (also Ant)
# ./install.sh --apps bee,elephant --tray
```

Then open **http://localhost:4400**. Services run as *you* (no root), start with your session and are
resource-capped (CPU/RAM quotas in each unit). The units point at this folder — keep it where it is
(re-run `./install.sh` if you move it). Remove everything with `./uninstall.sh` (your data is never deleted).

Try without installing anything: `python3 zoo/server.py` (or any `apps/<app>/server.py`).

The optional tray icon needs `python3-gi`, `python3-gi-cairo` and `gir1.2-ayatanaappindicator3-0.1` (Debian/Ubuntu names).

## Design rules shared by all apps

- Listens on `127.0.0.1` only; validates `Host`/`Origin`; every `POST` requires a custom header (CSRF).
- Standard library only; static front-end without build tools; light and dark theme (shared `zoo-theme.css`).
- Privileged actions go through `pkexec` with fixed commands. If no polkit agent is available (some desktops
  and all headless services), the app shows the exact `sudo …` command to copy instead of failing.
- Deletions only touch safe locations and ask for confirmation; protected items need typed confirmation.
- Low footprint: services have CPU/RAM limits and ZOO can start apps on demand and stop them when idle.

## Layout

```
install.sh / uninstall.sh     install as systemd user services
zoo/                          launcher + shared theme + tray
apps/<app>/                   each app: server.py, static/, scripts/install-service.sh, README.md
test/smoke.py                 boots every app in an empty HOME and checks it answers (also --bare: empty PATH)
docs/                         portability matrix, architecture notes
```

Each app has its own README (currently in Spanish — translations welcome).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Most wanted: testing on other distros/desktops (Fedora, Arch, openSUSE,
GNOME, KDE), translations (UI strings are Spanish today), and new animals 🦉 (logs), 🐿️ (…).
Security issues: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
