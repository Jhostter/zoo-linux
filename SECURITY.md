# Security

ZOO Linux apps are **local tools that can change your system** (delete files, stop services, run privileged commands via polkit).

## Threat model
- Each app binds to `127.0.0.1` only, checks `Host`/`Origin` (anti DNS-rebinding/CSRF) and requires a custom header on `POST`.
- They run as your user. Root actions are separate `pkexec` invocations with fixed commands and validated arguments.
- **Do not expose these ports to a network, a tunnel or a reverse proxy.** There is no authentication beyond being local.

## Reporting a vulnerability
Please use GitHub's **private vulnerability reporting** (Security tab → "Report a vulnerability") instead of a public issue.
Include the app, version/commit, steps to reproduce and impact. Typical high-value findings: command/argument injection into
`pkexec`/`systemctl`/`apt`, path traversal in file or delete actions, bypass of the Host/Origin/header checks, deleting outside the allowed locations.
