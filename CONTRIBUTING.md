# Contributing

Thanks for helping! This project is small on purpose: **Python standard library only, no build step**.

## Ground rules
- No new runtime dependencies (Python or JS). Front-ends are plain JS/CSS served as static files.
- Each app listens on `127.0.0.1` only, validates `Host`/`Origin`, and requires a custom header on every `POST`.
- Privileged actions: fixed command lists via `pkexec`, validated inputs, and the "no polkit agent → show the `sudo …` command" fallback.
- Never make a destructive action run without confirmation. Don't test destructive actions against real services — use a throwaway one.
- A missing binary or file must never crash an app: return an empty/“unsupported” result (check with `python3 test/smoke.py --bare`).

## Dev loop
```sh
python3 apps/bee/server.py            # run an app directly (static files are read from disk: just reload the page)
python3 test/smoke.py                 # every app boots in an empty HOME and answers
python3 test/smoke.py --bare          # …and with an empty PATH
python3 -m compileall -q zoo apps     # syntax check
```
Ant has its own end-to-end tests in `apps/ant/test/` (see its README; the browser ones need Chrome and Node ≥ 22).

## Adding an app (a new animal 🦉)
1. Create `apps/<name>/` with `server.py`, `static/`, `scripts/install-service.sh`, `README.md`.
2. Add it to `zoo/apps.default.json`, `install.sh` (port/unit tables) and `uninstall.sh`, and to `test/smoke.py`.
3. Load the shared theme: `<link rel="stylesheet" href="/zoo-theme.css">` and serve `/zoo-theme.css` (see Bee), then run `zoo/scripts/sync-theme.sh`.

## Pull requests
Small and focused; say how you tested (distro, desktop, Python version). Commit messages in English or Spanish, imperative mood.
