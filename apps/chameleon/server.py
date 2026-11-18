#!/usr/bin/env python3
"""Chameleon: sensores y hardware de ZOO Linux. Temperaturas, GPU NVIDIA, batería, perfiles de energía,
pantallas, almacenamiento, red e inventario. Solo biblioteca estándar. Lectura de /sys, /proc y herramientas
estándar; el único cambio que hace es el perfil de energía (system76-power), reversible y sin root."""
import glob, json, os, re, shlex, shutil, subprocess, threading, time
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import urllib.error, urllib.request
from urllib.parse import urlparse, parse_qs

HOST = "127.0.0.1"
PORT = int(os.environ.get("CHAMELEON_PORT", "4500"))
STATIC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
ENV = {**os.environ, "LC_ALL": "C.UTF-8", "NO_COLOR": "1", "SYSTEMD_COLORS": "0"}
HW = os.environ.get("CHAMELEON_HWMON", "/sys/class/hwmon")
PS = os.environ.get("CHAMELEON_POWER_SUPPLY", "/sys/class/power_supply")
PROFILES = ("battery", "balanced", "performance")


def run(cmd, timeout=15, inp=None):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env=ENV, input=inp)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return 124, "", "tiempo agotado"
    except FileNotFoundError:
        return 127, "", "no existe " + cmd[0]


def rd(path, default=None):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


def num(path, scale=1.0):
    v = rd(path)
    try:
        return int(v) / scale
    except (TypeError, ValueError):
        return None


def have(c):
    return shutil.which(c) is not None


# ---------- sensores ----------
CHIP = {"coretemp": "CPU", "nvme": "SSD NVMe", "spd5118": "Módulo de RAM", "iwlwifi_1": "WiFi", "iwlwifi": "WiFi", "BAT0": "Batería", "BAT1": "Batería",
        "ADP0": "Cargador", "acpitz": "ACPI", "k10temp": "CPU", "thermal": "Zonas térmicas", "nvidia": "GPU NVIDIA", "amdgpu": "GPU AMD", "nouveau": "GPU"}


def friendly(chip, label):
    l = label
    if re.match(r"^Package id \d+$", l):
        l = "Paquete"
    elif re.match(r"^Core \d+$", l):
        l = "Núcleo " + l.split()[1]
    elif l == "Composite":
        l = "Compuesto"
    return l


def sane(v, lo=-50, hi=150):
    return v is not None and lo < v < hi


def sensors():
    out = []
    for d in sorted(glob.glob(HW + "/hwmon*")):
        chip = rd(d + "/name", os.path.basename(d))
        for f in sorted(glob.glob(d + "/temp*_input")):
            n = re.search(r"temp(\d+)_input", f)[1]
            v = num(f, 1000)
            if not sane(v):
                continue
            label = rd(f"{d}/temp{n}_label", f"temp{n}")
            hi = next((x for x in (num(f"{d}/temp{n}_max", 1000), num(f"{d}/temp{n}_high", 1000)) if sane(x, 0, 150)), None)
            cr = num(f"{d}/temp{n}_crit", 1000)
            out.append({"id": f"{chip}/{n}/{label}", "kind": "temp", "chip": chip, "group": CHIP.get(chip, chip), "label": friendly(chip, label), "raw_label": label,
                        "value": round(v, 1), "unit": "°C", "high": hi, "crit": cr if sane(cr, 0, 150) else None})
        for f in sorted(glob.glob(d + "/fan*_input")):
            n = re.search(r"fan(\d+)_input", f)[1]
            v = num(f)
            if v is not None:
                out.append({"id": f"{chip}/fan{n}", "kind": "fan", "chip": chip, "group": CHIP.get(chip, chip), "label": rd(f"{d}/fan{n}_label", f"Ventilador {n}"), "value": v, "unit": "RPM"})
        for f in sorted(glob.glob(d + "/in*_input")):
            n = re.search(r"in(\d+)_input", f)[1]
            v = num(f, 1000)
            if v is not None:
                out.append({"id": f"{chip}/in{n}", "kind": "volt", "chip": chip, "group": CHIP.get(chip, chip), "label": rd(f"{d}/in{n}_label", f"Tensión {n}"), "value": round(v, 2), "unit": "V"})
        for f in sorted(glob.glob(d + "/power*_average") + glob.glob(d + "/power*_input")):
            n = re.search(r"power(\d+)_", f)[1]
            v = num(f, 1e6)
            if v is not None:
                out.append({"id": f"{chip}/pw{n}", "kind": "power", "chip": chip, "group": CHIP.get(chip, chip), "label": rd(f"{d}/power{n}_label", f"Potencia {n}"), "value": round(v, 2), "unit": "W"})
    for z in sorted(glob.glob("/sys/class/thermal/thermal_zone*")):
        t, v = rd(z + "/type", "zona"), num(z + "/temp", 1000)
        if sane(v) and v != 0:
            out.append({"id": f"thermal/{os.path.basename(z)}/{t}", "kind": "temp", "chip": "thermal", "group": "Zonas térmicas", "label": t, "raw_label": t, "value": round(v, 1), "unit": "°C", "high": None, "crit": None})
    for s in out:
        s["level"] = level(s)
    return out


def level(s):
    if s["kind"] != "temp":
        return "ok"
    v, hi, cr = s["value"], s.get("high"), s.get("crit")
    if hi and cr and hi < cr - 20:
        # umbral «alto» suave de fábrica (p. ej. módulos de RAM: 55 °C con crítico a 85 °C): avisa pronto, alarma tarde
        if v >= cr:
            return "crit"
        if v >= cr - 10:
            return "hot"
        return "warm" if v >= hi else "ok"
    if cr and v >= cr:
        return "crit"
    if hi and v >= hi:
        return "hot"
    if hi and v >= hi - 8:
        return "warm"
    if not hi and v >= 90:
        return "hot"
    if not hi and v >= 80:
        return "warm"
    return "ok"


# ---------- GPU NVIDIA ----------
def na(x):
    x = (x or "").strip()
    return None if x in ("", "[N/A]", "N/A", "[Not Supported]", "Not Supported") else x


def tofloat(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


_GPU = {"t": 0, "v": None}


def gpu():
    if time.time() - _GPU["t"] < 2 and _GPU["v"] is not None:
        return _GPU["v"]
    if not have("nvidia-smi"):
        v = {"available": False}
    else:
        q = "name,driver_version,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,power.draw,power.limit,clocks.current.graphics,clocks.current.memory,fan.speed,pstate,persistence_mode"
        rc, out, err = run(["nvidia-smi", f"--query-gpu={q}", "--format=csv,noheader,nounits"], timeout=10)
        p = [x.strip() for x in out.strip().split("\n")[0].split(",")] if rc == 0 and out.strip() else []
        if len(p) < 14:
            v = {"available": False, "error": (err or out or "sin datos").strip()[:120]}
        else:
            v = {"available": True, "name": p[0], "driver": p[1], "temp": tofloat(p[2]), "util": tofloat(p[3]), "mem_util": tofloat(p[4]), "mem_used": tofloat(p[5]), "mem_total": tofloat(p[6]),
                 "power": tofloat(p[7]), "power_limit": tofloat(na(p[8])), "clock_gr": tofloat(p[9]), "clock_mem": tofloat(p[10]), "fan": tofloat(na(p[11])), "pstate": p[12], "persistence": p[13]}
            rc2, out2, _ = run(["nvidia-smi", "pmon", "-c", "1"], timeout=10)
            procs = []
            for l in out2.splitlines():
                if l.startswith("#") or not l.strip():
                    continue
                c = l.split(None, 8)
                if len(c) >= 8 and c[1].isdigit():
                    procs.append({"pid": int(c[1]), "type": c[2], "sm": tofloat(c[3]), "mem": tofloat(c[4]), "name": c[-1] if len(c) > 8 else c[7]})
            v["procs"] = procs
    v["graphics_mode"] = graphics_mode()
    _GPU.update(t=time.time(), v=v)
    return v


def graphics_mode():
    if not have("system76-power"):
        return None
    rc, out, _ = run(["system76-power", "graphics"], timeout=8)
    return out.strip() if rc == 0 else None


# ---------- batería ----------
def battery():
    for b in sorted(glob.glob(PS + "/BAT*")):
        g = lambda n: rd(f"{b}/{n}")
        ef, ed, en = num(b + "/energy_full"), num(b + "/energy_full_design"), num(b + "/energy_now")
        if ef is None:  # algunos equipos exponen carga (µAh) en vez de energía (µWh)
            ef, ed, en = num(b + "/charge_full"), num(b + "/charge_full_design"), num(b + "/charge_now")
        pw = num(b + "/power_now")
        status = g("status") or "Unknown"
        hours = None
        if pw and pw > 0 and en is not None:
            hours = en / pw if status == "Discharging" else ((ef - en) / pw if status == "Charging" and ef else None)
        return {"present": True, "name": os.path.basename(b), "status": status, "capacity": num(b + "/capacity"), "energy_now_wh": round(en / 1e6, 2) if en else None, "energy_full_wh": round(ef / 1e6, 2) if ef else None,
                "energy_design_wh": round(ed / 1e6, 2) if ed else None, "health": round(100 * ef / ed, 1) if ef and ed else None, "power_w": round(pw / 1e6, 2) if pw is not None else None,
                "voltage_v": round(num(b + "/voltage_now", 1e6), 2) if num(b + "/voltage_now") else None, "cycles": num(b + "/cycle_count"), "technology": g("technology"),
                "manufacturer": g("manufacturer"), "model": g("model_name"), "hours": round(hours, 2) if hours else None,
                "ac": any(rd(p + "/online") == "1" for p in glob.glob(PS + "/A*") + glob.glob(PS + "/ADP*")),
                "limit_supported": os.path.exists(b + "/charge_control_end_threshold") and bool(g("charge_control_end_threshold"))}
    return {"present": False}


# ---------- CPU y energía ----------
def cpu():
    freqs = []
    for f in sorted(glob.glob("/sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_cur_freq")):
        v = num(f, 1000)
        if v:
            freqs.append(round(v))
    model = ""
    for l in (rd("/proc/cpuinfo", "") or "").splitlines():
        if l.startswith("model name"):
            model = l.split(":", 1)[1].strip()
            break
    p0 = "/sys/devices/system/cpu/cpu0/cpufreq/"
    maxf = num(p0 + "cpuinfo_max_freq", 1000)
    return {"model": model, "threads": os.cpu_count(), "freqs": freqs, "freq_avg": round(sum(freqs) / len(freqs)) if freqs else None, "freq_max_now": max(freqs) if freqs else None, "freq_max": round(maxf) if maxf else None,
            "governor": rd(p0 + "scaling_governor"), "epp": rd(p0 + "energy_performance_preference"), "governors": (rd(p0 + "scaling_available_governors", "") or "").split(),
            "turbo": rd("/sys/devices/system/cpu/intel_pstate/no_turbo") == "0" if rd("/sys/devices/system/cpu/intel_pstate/no_turbo") is not None else None,
            "pstate": rd("/sys/devices/system/cpu/intel_pstate/status"), "load": [round(x, 2) for x in os.getloadavg()]}


def profile():
    if not have("system76-power"):
        return {"available": False}
    rc, out, err = run(["system76-power", "profile"], timeout=8)
    if rc:
        return {"available": False, "error": (err or out).strip()[:100]}
    name = re.search(r"Power Profile:\s*(\w+)", out)
    rng = re.search(r"CPU:\s*(.+)", out)
    return {"available": True, "current": name[1].lower() if name else None, "cpu": rng[1].strip() if rng else None}


def set_profile(p, by=None):
    if p not in PROFILES:
        raise ValueError("perfil inválido")
    if not have("system76-power"):
        raise ValueError("system76-power no está instalado")
    rc, out, err = run(["system76-power", "profile", p], timeout=20)
    cur = profile()
    if cur.get("current") != p:  # la fuente de verdad es el estado resultante, no el código de salida
        raise ValueError((err or out or f"el perfil sigue siendo {cur.get('current')}").strip()[:200])
    hold = get_hold()
    if hold and by != hold.get("by"):  # alguien cambió el perfil a mano mientras un modo lo tenía fijado: manda el usuario y se reanuda el perfil automático
        release_hold()
        log_event("profile", "Perfil automático reanudado", f"Cambiaste el perfil a mano mientras estaba en pausa por «{hold.get('label') or hold.get('by')}».")
    msg = (err or out or "").strip()
    # system76-power sale con error si no puede ajustar algo que tu equipo no tiene (p. ej. el SCSI host0), aunque el perfil sí se aplica
    return {**cur, "warning": re.sub(r"^.*?Errors found when setting profile:\s*", "", msg, flags=re.S)[:240] if rc and msg else None}



# ---------- modo gráfico (cambio con salvaguardas) ----------
GFX_MODES = ("integrated", "hybrid", "nvidia", "compute")
DATA_DIR = os.path.join(os.environ.get("XDG_DATA_HOME") or os.path.join(os.path.expanduser("~"), ".local", "share"), "chameleon")
GFX_FILE = os.path.join(DATA_DIR, "graphics.json")


def boot_time():
    try:
        return time.time() - float((rd("/proc/uptime", "0") or "0").split()[0])
    except ValueError:
        return 0.0


def gfx_pending():
    """Cambio solicitado después del último arranque: no se aplica hasta reiniciar."""
    try:
        with open(GFX_FILE) as f:
            d = json.load(f)
    except (OSError, ValueError):
        return None
    return d if d.get("at", 0) > boot_time() else None


def apt_busy():
    """Devuelve el nombre de un apt/dpkg que esté modificando paquetes (las simulaciones y consultas no cuentan)."""
    names, sim, qry = {"apt", "apt-get", "dpkg", "aptitude"}, {"-s", "--simulate", "--just-print", "--dry-run", "--no-act"}, {"list", "search", "show", "policy", "depends", "--audit", "-l", "-L", "-S", "--list", "--status"}
    for l in run(["ps", "-eo", "args"])[1].splitlines()[1:]:
        t = l.split()
        if t and os.path.basename(t[0]) in names and not (sim & set(t[1:6])) and not (len(t) > 1 and t[1] in qry):
            return os.path.basename(t[0])
    return None


def set_graphics(mode):
    if mode not in GFX_MODES:
        raise ValueError("modo gráfico inválido")
    if not have("system76-power"):
        raise ValueError("system76-power no está instalado")
    cur = graphics_mode()
    if cur is None:
        raise ValueError("no se pudo leer el modo gráfico actual")
    if cur == mode:
        raise ValueError(f"ya está en modo «{mode}»")
    pend = gfx_pending()
    if pend and pend.get("mode") == mode:
        raise ValueError(f"el modo «{mode}» ya está pendiente de reinicio")
    b = battery()
    if b.get("present") and b["status"] == "Discharging" and (b.get("capacity") or 0) < 40:
        raise ValueError("Conecta el cargador: con la batería por debajo del 40 % no es seguro reconstruir el arranque.")
    busy = apt_busy()
    if busy:
        raise ValueError(f"Hay una operación de paquetes en curso ({busy}). Espera a que termine: reconstruir el arranque a la vez puede dejarlo a medias.")
    rc, out, err = run(["system76-power", "graphics", mode], timeout=300)
    _GPU["t"] = 0  # la caché de la GPU incluye el modo gráfico: que la próxima lectura sea fresca
    after = graphics_mode()
    if after != mode:
        raise ValueError((err or out or "el modo no se aplicó").strip()[:240])
    os.makedirs(DATA_DIR, exist_ok=True)
    if pend and mode == pend.get("previous"):
        os.remove(GFX_FILE)  # has vuelto al modo que ya estaba activo desde el arranque: no queda nada pendiente
    else:
        with open(GFX_FILE, "w") as f:
            json.dump({"mode": mode, "previous": cur if not pend else pend.get("previous"), "at": time.time()}, f)
    return {"configured": after, "previous": cur, "pending": gfx_pending(), "warning": (err or "").strip()[:200] if rc else None}

# ---------- historial ----------
HIST, _LAST_REQ, _LOCK = {}, [0.0], threading.Lock()
KEYS = {}


def sample():
    with _LOCK:
        now = time.time()
        for s in sensors():
            if s["kind"] == "temp":
                HIST.setdefault(s["id"], deque(maxlen=100)).append((now, s["value"]))
        g = gpu()
        if g.get("available"):
            for k, v in (("gpu:temp", g["temp"]), ("gpu:util", g["util"]), ("gpu:power", g["power"])):
                if v is not None:
                    HIST.setdefault(k, deque(maxlen=100)).append((now, v))
        b = battery()
        if b.get("present") and b.get("power_w") is not None:
            HIST.setdefault("batt:power", deque(maxlen=100)).append((now, b["power_w"]))
        c = cpu()
        if c["freq_avg"]:
            HIST.setdefault("cpu:freq", deque(maxlen=100)).append((now, c["freq_avg"]))


def sampler():
    while True:
        active = time.time() - _LAST_REQ[0] < 120
        if active:
            try:
                sample()
            except Exception:
                pass
        time.sleep(3 if active else 10)


def hist(key):
    return [v for _, v in HIST.get(key, [])]


def pick(ss, chip, label=None, raw=None):
    for s in ss:
        if s["chip"] == chip and s["kind"] == "temp" and (label is None or s.get("raw_label") == label):
            return s
    return None


def overview():
    _LAST_REQ[0] = time.time()
    if not HIST or time.time() - max((d[-1][0] for d in HIST.values() if d), default=0) > 5:
        sample()
    ss = sensors()
    pkg = pick(ss, "coretemp", "Package id 0") or pick(ss, "k10temp") or pick(ss, "thermal", "x86_pkg_temp")
    nvme = pick(ss, "nvme", "Composite")
    dimm, wifi = pick(ss, "spd5118"), pick(ss, "iwlwifi_1") or pick(ss, "iwlwifi")
    g, b, c, pr = gpu(), battery(), cpu(), profile()
    warns = []
    for s in ss:
        if s["level"] in ("hot", "crit"):
            warns.append({"level": "bad" if s["level"] == "crit" else "warn", "text": f"{s['group']} · {s['label']} a {s['value']} °C" + (f" (límite {s['high']} °C)" if s.get("high") else "")})
    if b.get("present") and b.get("health") and b["health"] < 80:
        warns.append({"level": "warn", "text": f"La batería conserva solo el {b['health']:.0f} % de su capacidad original."})
    pend = gfx_pending()
    if pend:
        warns.append({"level": "warn", "text": f"Cambio de modo gráfico pendiente: «{pend['previous']}» → «{pend['mode']}». Se aplica al reiniciar el equipo."})
    elif g.get("available") and g.get("graphics_mode") == "nvidia" and b.get("present") and b["status"] == "Discharging":
        warns.append({"level": "info", "text": "Estás con batería y la GPU NVIDIA siempre activa (modo gráfico «nvidia»): gasta más batería que el modo híbrido."})
    if pr.get("current") == "performance" and b.get("present") and b["status"] == "Discharging":
        warns.append({"level": "info", "text": "Perfil «Rendimiento» con batería: la autonomía baja bastante."})
    if not any(s["kind"] == "fan" for s in ss) and not (g.get("available") and g.get("fan") is not None):
        warns.append({"level": "info", "text": "Tu equipo no expone la velocidad de los ventiladores al sistema (es habitual en portátiles Lenovo), así que no se pueden mostrar ni controlar."})
    status = "bad" if any(w["level"] == "bad" for w in warns) else "warn" if any(w["level"] == "warn" for w in warns) else "ok"
    return {"cpu": {**c, "temp": pkg["value"] if pkg else None, "high": pkg.get("high") if pkg else None}, "gpu": g, "battery": b, "profile": pr,
            "nvme": nvme, "dimm": dimm, "wifi": wifi, "warnings": warns, "status": status, "ncores": len([s for s in ss if s.get("raw_label", "").startswith("Core ")]) if ss else 0,
            "history": {"cpu": hist(pkg["id"]) if pkg else [], "gpu": hist("gpu:temp"), "nvme": hist(nvme["id"]) if nvme else [], "dimm": hist(dimm["id"]) if dimm else [], "power": hist("batt:power"), "freq": hist("cpu:freq"), "gpu_util": hist("gpu:util")}}


def sensors_api():
    _LAST_REQ[0] = time.time()
    ss = sensors()
    for s in ss:
        s["history"] = hist(s["id"])
    return ss


# ---------- hardware ----------
_HWC = {"t": 0, "v": None}


def lines(cmd, timeout=10):
    rc, out, _ = run(cmd, timeout)
    return out.splitlines() if rc == 0 else []


def parse_lscpu():
    d = {}
    for l in lines(["lscpu"]):
        if ":" in l:
            k, v = l.split(":", 1)
            d[k.strip()] = v.strip()
    return {"model": d.get("Model name"), "threads": d.get("CPU(s)"), "cores": d.get("Core(s) per socket"), "sockets": d.get("Socket(s)"), "max_mhz": d.get("CPU max MHz"), "min_mhz": d.get("CPU min MHz"),
            "l2": d.get("L2 cache"), "l3": d.get("L3 cache"), "arch": d.get("Architecture"), "virt": d.get("Virtualization")}


def parse_lspci():
    gpus, nets, allp = [], [], []
    for l in lines(["lspci"]):
        allp.append(l)
    cur = None
    for l in lines(["lspci", "-nnk"]):
        if l and not l.startswith("\t"):
            cur = {"line": l, "driver": None, "modules": None}
            low = l.lower()
            if "vga" in low or "3d controller" in low or "display controller" in low:
                gpus.append(cur)
            elif "network controller" in low or "ethernet controller" in low:
                nets.append(cur)
        elif cur and "Kernel driver in use:" in l:
            cur["driver"] = l.split(":", 1)[1].strip()
        elif cur and "Kernel modules:" in l:
            cur["modules"] = l.split(":", 1)[1].strip()
    return gpus, nets, allp


def parse_displays():
    res = []
    for c in sorted(glob.glob("/sys/class/drm/card*-*")):
        card = os.path.basename(c).split("-")[0]
        vendor = rd(f"/sys/class/drm/{card}/device/vendor", "")
        modes = (rd(c + "/modes", "") or "").splitlines()
        res.append({"name": os.path.basename(c)[len(card) + 1:], "gpu": {"0x8086": "Intel", "0x10de": "NVIDIA", "0x1002": "AMD"}.get(vendor, vendor), "status": rd(c + "/status"), "enabled": rd(c + "/enabled"), "mode": modes[0] if modes else None})
    bl = []
    for b in glob.glob("/sys/class/backlight/*"):
        m, cur = num(b + "/max_brightness"), num(b + "/brightness")
        if m and cur is not None:
            bl.append({"name": os.path.basename(b), "percent": round(100 * cur / m)})
    return {"outputs": res, "backlight": bl}


def parse_storage():
    rc, out, _ = run(["lsblk", "-J", "-d", "-o", "NAME,MODEL,SIZE,ROTA,TRAN,TYPE"])
    disks = []
    try:
        for d in json.loads(out).get("blockdevices", []):
            if d.get("type") == "disk" and not d["name"].startswith(("zram", "loop", "ram")) and d.get("size") not in ("0B", "0", None):
                disks.append({"name": d["name"], "model": (d.get("model") or "").strip(), "size": d.get("size"), "rotational": bool(d.get("rota")), "tran": d.get("tran")})
    except (ValueError, KeyError):
        pass
    return disks


def parse_network():
    res = []
    for l in lines(["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"]):
        p = l.split(":")
        if len(p) >= 4 and p[1] in ("wifi", "ethernet", "bluetooth"):
            res.append({"device": p[0], "type": p[1], "state": p[2], "connection": p[3]})
    return res


def parse_bluetooth():
    d = {}
    for l in lines(["bluetoothctl", "show"], 5):
        l = l.strip()
        if ":" in l and not l.startswith("Controller"):
            k, v = l.split(":", 1)
            d[k.strip()] = v.strip()
    return {"name": d.get("Name"), "powered": d.get("Powered"), "discoverable": d.get("Discoverable")} if d else None


def parse_audio():
    res, sec = {"sinks": [], "sources": []}, None
    for l in lines(["wpctl", "status"], 5):
        s = re.sub(r"[│├└─]", " ", l).strip()
        if s.endswith("Sinks:"):
            sec = "sinks"
        elif s.endswith("Sources:"):
            sec = "sources"
        elif s.endswith(":") and not s.startswith(("Audio", "Video")) and sec:
            sec = None
        elif sec and s:
            m = re.match(r"^(\*)?\s*(\d+)\.\s+(.+?)\s+\[vol:", s)
            if m:
                res[sec].append({"name": m[3].strip(), "default": bool(m[1])})
    return res


def parse_usb():
    return [re.sub(r"^Bus \d+ Device \d+: ID ", "", l) for l in lines(["lsusb"]) if "root hub" not in l.lower()]


def hardware(force=False):
    if not force and _HWC["v"] and time.time() - _HWC["t"] < 120:
        return _HWC["v"]
    gpus, nets, allp = parse_lspci()
    v = {"system": {k: rd(f"/sys/class/dmi/id/{f}") for k, f in (("vendor", "sys_vendor"), ("product", "product_version"), ("model", "product_name"), ("bios", "bios_version"), ("bios_date", "bios_date"), ("bios_vendor", "bios_vendor"))},
         "cpu": parse_lscpu(), "memory_total_kb": int((re.search(r"MemTotal:\s+(\d+)", rd("/proc/meminfo", "") or "") or [0, 0])[1]), "gpus": gpus, "network_pci": nets, "displays": parse_displays(),
         "storage": parse_storage(), "network": parse_network(), "bluetooth": parse_bluetooth(), "audio": parse_audio(), "usb": parse_usb(), "pci": allp,
         "smart_tools": have("smartctl"), "kernel": os.uname().release}
    _HWC.update(t=time.time(), v=v)
    return v


def parse_dmidecode(text):
    mods = []
    for block in re.split(r"\n\n+", text):
        ls = block.splitlines()
        if "Memory Device" not in ls[:3]:
            continue
        d = {}
        for l in ls[ls.index("Memory Device") + 1:]:
            if ":" in l:
                k, v = l.split(":", 1)
                d[k.strip()] = v.strip()
        if d.get("Size", "").startswith("No Module"):
            continue
        mods.append({"locator": d.get("Locator"), "size": d.get("Size"), "type": d.get("Type"), "speed": d.get("Configured Memory Speed") or d.get("Speed"), "maker": d.get("Manufacturer"),
                     "part": (d.get("Part Number") or "").strip(), "form": d.get("Form Factor")})
    return mods


class NeedTerminal(ValueError):
    """pkexec no puede pedir la contraseña (sin agente gráfico para el servicio): se pide al usuario ejecutar el comando en su terminal."""
    def __init__(self, cmd, then):
        super().__init__("No puedo abrir el diálogo de contraseña desde aquí (tu escritorio no ofrece un agente de polkit a los servicios). Ejecuta este comando en una terminal; te pedirá tu contraseña allí.")
        self.cmd, self.then = cmd, then


def pk(argv, timeout, cmd, then):
    rc, out, err = run(["pkexec", *argv], timeout=timeout)
    if rc == 127 and "agent" in err.lower():
        raise NeedTerminal(cmd, then)
    return rc, out, err


def heredoc(code, args, redirect=""):
    """Comando para pegar en una terminal: el mismo código que iría a pkexec, en línea (no hay archivo que alguien pueda cambiar antes de ejecutarlo como root)."""
    return f"sudo python3 -I - {args}{redirect} <<'PYEOF'\n{code.strip()}\nPYEOF"


def fresh_file(path, what):
    try:
        if time.time() - os.stat(path).st_mtime > 900:
            raise ValueError(f"El archivo con {what} es antiguo (más de 15 minutos): vuelve a ejecutar el comando.")
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        raise ValueError(f"Todavía no existe el archivo con {what}: ejecuta primero el comando en la terminal.")


DMI_FILE = os.path.join(DATA_DIR, "dmi-memory.txt")


def ram_modules(from_file=False):
    if from_file:
        txt = fresh_file(DMI_FILE, "los módulos de RAM")
        os.remove(DMI_FILE)
        return parse_dmidecode(txt)
    os.makedirs(DATA_DIR, exist_ok=True)
    rc, out, err = pk(["dmidecode", "-t", "memory"], 120, f"sudo dmidecode -t memory > {shlex.quote(DMI_FILE)}", "ram")
    if rc:
        raise ValueError((err or "no se pudo leer (¿cancelaste la contraseña?)").strip()[:140])
    return parse_dmidecode(out)


def power_api():
    _LAST_REQ[0] = time.time()
    return {"profile": profile(), "cpu": cpu(), "battery": battery(), "gpu": gpu(), "graphics_pending": gfx_pending(), "history": {"power": hist("batt:power"), "freq": hist("cpu:freq")}}


# ---------- ajustes ----------
CONF_DIR = os.path.join(os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config"), "chameleon")
SET_FILE = os.path.join(CONF_DIR, "settings.json")
HIST_FILE, EVT_FILE, SMART_FILE = (os.path.join(DATA_DIR, n) for n in ("history.jsonl", "events.jsonl", "nvme-smart.json"))
HIST_DAYS, TICK = 14, int(os.environ.get("CHAMELEON_TICK", "30"))
DEFAULTS = {"alerts": {"enabled": True, "cpu_temp": 92, "gpu_temp": 85, "nvme_temp": 70, "batt_low": 20, "batt_crit": 10},
            "auto_profile": {"enabled": False, "ac": "balanced", "battery": "battery"},
            "history": {"enabled": True}}
RANGES = {"alerts": {"cpu_temp": (60, 110), "gpu_temp": (60, 100), "nvme_temp": (40, 85), "batt_low": (5, 50), "batt_crit": (3, 30)}}
_SET = {"mt": None, "v": None}


def get_settings():
    try:
        mt = os.stat(SET_FILE).st_mtime
    except OSError:
        mt = None
    if _SET["v"] is None or _SET["mt"] != mt:
        v = json.loads(json.dumps(DEFAULTS))
        try:
            with open(SET_FILE) as f:
                saved = json.load(f)
            for sec, d in DEFAULTS.items():
                for k in d:
                    if isinstance(saved.get(sec), dict) and k in saved[sec] and type(saved[sec][k]) is type(d[k]):
                        v[sec][k] = saved[sec][k]
        except (OSError, ValueError):
            pass
        _SET.update(mt=mt, v=v)
    return _SET["v"]


def save_settings(patch):
    if not isinstance(patch, dict):
        raise ValueError("ajustes inválidos")
    cur = json.loads(json.dumps(get_settings()))
    for sec, d in patch.items():
        if sec not in DEFAULTS or not isinstance(d, dict):
            raise ValueError(f"sección desconocida: {sec}")
        for k, val in d.items():
            if k not in DEFAULTS[sec]:
                raise ValueError(f"ajuste desconocido: {sec}.{k}")
            want = type(DEFAULTS[sec][k])
            if type(val) is not want:
                raise ValueError(f"{sec}.{k}: tipo inválido")
            if want is int:
                lo, hi = RANGES[sec][k]
                if not lo <= val <= hi:
                    raise ValueError(f"{sec}.{k}: debe estar entre {lo} y {hi}")
            if sec == "auto_profile" and k in ("ac", "battery") and val not in PROFILES:
                raise ValueError("perfil inválido")
            cur[sec][k] = val
    if cur["alerts"]["batt_crit"] >= cur["alerts"]["batt_low"]:
        raise ValueError("El umbral crítico de batería debe ser menor que el de batería baja.")
    os.makedirs(CONF_DIR, exist_ok=True)
    tmp = SET_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(cur, f, indent=1)
    os.replace(tmp, SET_FILE)
    _SET["v"] = None
    return get_settings()


# ---------- pausa del perfil automático (la pide un modo de ZOO Linux) ----------
HOLD_FILE = os.path.join(DATA_DIR, "hold.json")
HOLD_RE = re.compile(r"^[a-z0-9:_-]{1,40}$")


def get_hold():
    try:
        with open(HOLD_FILE) as f:
            d = json.load(f)
        return d if isinstance(d, dict) and d.get("by") else None
    except (OSError, ValueError):
        return None


def release_hold():
    try:
        os.remove(HOLD_FILE)
    except OSError:
        pass


def set_hold(on, by, label=None):
    """Mientras dure, el perfil automático (al enchufar/desenchufar) no cambia el perfil. No toca los ajustes guardados del usuario."""
    if not isinstance(on, bool):
        raise ValueError("on debe ser verdadero o falso")
    if on:
        if not isinstance(by, str) or not HOLD_RE.match(by):
            raise ValueError("«by» inválido")
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(HOLD_FILE, "w") as f:
            json.dump({"by": by, "label": str(label or by)[:40], "t": int(time.time())}, f)
    else:
        release_hold()
    return {"hold": get_hold()}


# ---------- eventos y avisos de escritorio ----------
def log_event(kind, title, body="", notified=False):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(EVT_FILE, "a") as f:
            f.write(json.dumps({"t": int(time.time()), "kind": kind, "title": title, "body": body, "notified": notified}, ensure_ascii=False) + "\n")
    except OSError:
        pass


def read_events(n=50):
    try:
        with open(EVT_FILE) as f:
            ls = f.readlines()[-n:]
    except OSError:
        return []
    out = []
    for l in ls:
        try:
            out.append(json.loads(l))
        except ValueError:
            pass
    return out[::-1]


def gq(s):  # cadena para gdbus (texto GVariant)
    return "'" + s.replace("\\", "\\\\").replace("'", "\\'").replace("\n", " ") + "'"


def dnd_active():
    """COSMIC: con «No molestar» activado las notificaciones no salen en pantalla (solo quedan en el centro de notificaciones)."""
    base = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return (rd(os.path.join(base, "cosmic", "com.system76.CosmicNotifications", "v1", "do_not_disturb")) or "").strip() == "true"


def notify(title, body, urgent=False):
    if not have("gdbus"):
        return False
    rc, _, _ = run(["gdbus", "call", "--session", "--dest", "org.freedesktop.Notifications", "--object-path", "/org/freedesktop/Notifications",
                    "--method", "org.freedesktop.Notifications.Notify", "Chameleon", "0", "dialog-warning" if urgent else "dialog-information", title, body, "[]",
                    f"{{'urgency': <byte {2 if urgent else 1}>}}", "12000" if urgent else "8000"], timeout=5)
    return rc == 0


# ---------- vigilante ligero (solo lee /sys cada 30 s; no despierta la GPU dedicada) ----------
STATE = {"t": 0}
_AL, _AC, _LASTP = {}, [None], [0.0]
PCI = os.environ.get("CHAMELEON_PCI", "/sys/bus/pci/devices")
_NV = []


def gpu_active():
    """True si la NVIDIA está despierta. Preguntarle a nvidia-smi cuando duerme la despertaría y gastaría batería."""
    if not _NV:
        _NV.append(next((d for d in sorted(glob.glob(PCI + "/*")) if rd(d + "/vendor") == "0x10de" and (rd(d + "/class") or "").startswith("0x03")), None))
    d = _NV[0]
    return d is not None and rd(d + "/power/runtime_status") in ("active", None)


def gpu_light():
    if not have("nvidia-smi") or not gpu_active():
        return None
    rc, out, _ = run(["nvidia-smi", "--query-gpu=temperature.gpu,utilization.gpu,power.draw", "--format=csv,noheader,nounits"], timeout=10)
    p = [x.strip() for x in out.strip().split(",")] if rc == 0 else []
    return {"temp": tofloat(p[0]), "util": tofloat(p[1]), "power": tofloat(na(p[2]))} if len(p) == 3 else None


def snap(with_gpu):
    b, ss = battery(), sensors()
    pkg = pick(ss, "coretemp", "Package id 0") or pick(ss, "k10temp") or pick(ss, "thermal", "x86_pkg_temp")
    nv = pick(ss, "nvme", "Composite")
    g = gpu_light() if with_gpu else None
    return {"t": int(time.time()), "cpu_temp": pkg["value"] if pkg else None, "nvme_temp": nv["value"] if nv else None, "gpu_temp": g["temp"] if g else None,
            "gpu_util": g["util"] if g else None, "gpu_w": g["power"] if g else None, "gpu_awake": bool(g), "batt": b.get("capacity") if b.get("present") else None,
            "batt_w": b.get("power_w") if b.get("present") else None, "status": b.get("status") if b.get("present") else None, "ac": b.get("ac") if b.get("present") else None,
            "hours": b.get("hours") if b.get("present") else None}


def hist_write(s):
    os.makedirs(DATA_DIR, exist_ok=True)
    rec = {"t": s["t"], "p": s["batt"], "w": s["batt_w"], "s": (s["status"] or "?")[:1], "c": s["cpu_temp"], "n": s["nvme_temp"], "g": s["gpu_temp"], "gw": s["gpu_w"]}
    with open(HIST_FILE, "a") as f:
        f.write(json.dumps({k: v for k, v in rec.items() if v is not None}, separators=(",", ":")) + "\n")


def hist_read(since):
    out = []
    try:
        with open(HIST_FILE) as f:
            for l in f:
                try:
                    r = json.loads(l)
                except ValueError:
                    continue
                if r.get("t", 0) >= since:
                    out.append(r)
    except OSError:
        pass
    return out


def prune():
    cut = time.time() - HIST_DAYS * 86400
    for path, keep in ((HIST_FILE, lambda r: r.get("t", 0) >= cut), (EVT_FILE, None)):
        try:
            with open(path) as f:
                ls = f.readlines()
        except OSError:
            continue
        if keep is None:
            ls = ls[-500:]
        else:
            ls = [l for l in ls if _ok(l, keep)]
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            f.writelines(ls)
        os.replace(tmp, path)


def _ok(l, keep):
    try:
        return keep(json.loads(l))
    except ValueError:
        return False


def check(key, cond, clear, title, body, urgent=False):
    s = _AL.setdefault(key, {"n": 0, "active": False, "last": 0.0})
    now = time.time()
    if cond:
        s["n"] += 1
        if s["n"] >= 2 and (not s["active"] or now - s["last"] > 1200):  # dos lecturas seguidas; repetir cada 20 min como mucho
            s["active"], s["last"] = True, now
            log_event("alert", title, body, notify(title, body, urgent))
    else:
        s["n"] = 0
        if clear:
            s["active"] = False


def evaluate(s, cfg):
    a, d = cfg["alerts"], s["status"] == "Discharging"
    if a["enabled"]:
        for key, name, val, thr in (("cpu", "El procesador", s["cpu_temp"], a["cpu_temp"]), ("gpu", "La gráfica NVIDIA", s["gpu_temp"], a["gpu_temp"]), ("nvme", "El disco NVMe", s["nvme_temp"], a["nvme_temp"])):
            if val is not None:
                check("t" + key, val >= thr, val < thr - 5, f"{name} está a {val:.0f} °C", f"Superó tu umbral de {thr} °C. Cierra programas pesados o mejora la ventilación.", True)
        if s["batt"] is not None:
            check("bcrit", d and s["batt"] <= a["batt_crit"], not d or s["batt"] > a["batt_crit"] + 3, f"Batería crítica: {s['batt']:.0f} %", "Conecta el cargador ya o guarda tu trabajo.", True)
            if s["batt"] > a["batt_crit"]:
                check("blow", d and s["batt"] <= a["batt_low"], not d or s["batt"] > a["batt_low"] + 3, f"Batería baja: {s['batt']:.0f} %", "Conviene conectar el cargador pronto.")
    ap = cfg["auto_profile"]
    if s["ac"] is not None:
        if _AC[0] is not None and s["ac"] != _AC[0] and ap["enabled"] and get_hold():
            h_ = get_hold()
            log_event("profile", "Perfil automático en pausa", f"{'Cargador conectado' if s['ac'] else 'Cargador desconectado'}: no se cambió el perfil porque «{h_.get('label') or h_['by']}» lo tiene fijado.")
        elif _AC[0] is not None and s["ac"] != _AC[0] and ap["enabled"]:
            target = ap["ac"] if s["ac"] else ap["battery"]
            why = "cargador conectado" if s["ac"] else "cargador desconectado"
            try:
                if profile().get("current") != target:
                    set_profile(target, by="auto")
                    log_event("profile", f"Perfil «{target}» activado", f"Automático: {why}.")
            except ValueError as e:
                log_event("profile", "No se pudo cambiar el perfil automáticamente", str(e))
        _AC[0] = s["ac"]


def watcher():
    last_gpu = 0.0
    time.sleep(min(5, TICK))
    while True:
        try:
            cfg, now = get_settings(), time.time()
            tick_gpu = now - last_gpu >= TICK * 2 - 5  # la GPU se consulta como mucho una vez por minuto (y solo si ya está despierta)
            s = snap(with_gpu=tick_gpu)
            if tick_gpu:
                last_gpu = now
            fresh = dict(s)  # lo que se evalúa: solo lecturas nuevas
            if not tick_gpu:  # entre lecturas de GPU se conserva la última solo para mostrarla
                s.update({k: STATE.get(k) for k in ("gpu_temp", "gpu_util", "gpu_w", "gpu_awake")})
            STATE.clear(), STATE.update(s)
            if tick_gpu and cfg["history"]["enabled"]:
                hist_write(s)
            evaluate(fresh, cfg)
            if now - _LASTP[0] > 86400:
                prune()
                _LASTP[0] = now
        except Exception:
            pass
        time.sleep(TICK)


def history_api(rng):
    secs = {"1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800, "14d": 1209600}.get(rng, 21600)
    now = int(time.time())
    rows = hist_read(now - secs)
    nb, step = 240, max(secs / 240, 60)
    buckets = {}
    for r in rows:
        buckets.setdefault(int((r["t"] - (now - secs)) // step), []).append(r)
    pts = []
    for i in sorted(buckets):
        rs = buckets[i]
        pt = {"t": int(now - secs + (i + 0.5) * step), "s": rs[-1].get("s")}
        for k in ("p", "w", "c", "n", "g", "gw"):
            v = [r[k] for r in rs if k in r]
            if v:
                pt[k] = round(sum(v) / len(v), 2)
        pts.append(pt)
    dis = [r for r in rows if r.get("s") == "D" and r.get("w")]
    avg_w = round(sum(r["w"] for r in dis) / len(dis), 1) if dis else None
    b = battery()
    full = b.get("energy_full_wh") if b.get("present") else None
    return {"range": rng, "points": pts, "step": step, "records": len(rows), "summary": {
        "avg_w_discharging": avg_w, "peak_w": round(max((r["w"] for r in rows if "w" in r and r.get("s") == "D"), default=0), 1) or None,
        "minutes_discharging": len(dis), "est_full_hours": round(full / avg_w, 1) if full and avg_w else None,
        "now_hours": b.get("hours") if b.get("present") else None, "max_cpu": max((r["c"] for r in rows if "c" in r), default=None),
        "max_nvme": max((r["n"] for r in rows if "n" in r), default=None), "max_gpu": max((r["g"] for r in rows if "g" in r), default=None)}}


def state_api():
    """Estado actual de los ajustes que ZOO puede cambiar (modos). Solo lanza dos consultas rápidas, no toca la GPU."""
    b = brightness_api()
    bt = battery()
    return {"profile": profile().get("current"), "graphics_mode": graphics_mode(), "graphics_pending": gfx_pending(), "brightness": b.get("screen"),
            "battery": {"health": bt.get("health"), "cycles": bt.get("cycles"), "present": bt.get("present")}, "hold": get_hold()}


def open_terminal(cmd):
    """Pide a ZOO Linux que abra una terminal con el comando (que ZOO muestra y solo ejecuta si el usuario confirma allí)."""
    if not isinstance(cmd, str) or not cmd.startswith("sudo ") or len(cmd) > 20000:
        raise ValueError("comando inválido")
    req = urllib.request.Request("http://127.0.0.1:" + os.environ.get("ZOO_PORT", "4400") + "/api/terminal", data=json.dumps({"cmd": cmd, "title": "Chameleon"}).encode(),
                                 headers={"X-Zoo": "1", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise ValueError(json.load(e).get("error", "ZOO no pudo abrir la terminal"))
    except OSError:
        raise ValueError("No se pudo contactar con ZOO Linux (¿está en marcha?)")


def status_api():
    return {k: STATE.get(k) for k in ("t", "cpu_temp", "nvme_temp", "gpu_temp", "gpu_awake", "batt", "batt_w", "status", "ac", "hours")}


# ---------- procesos: quién gasta ----------
CLK = os.sysconf("SC_CLK_TCK") if hasattr(os, "sysconf") else 100
_PR = {"t": 0.0, "d": {}}
GENERIC = {"python3", "python", "node", "java", "sh", "bash", "electron", "ruby", "perl"}


def proc_snapshot():
    d = {}
    for p in os.listdir("/proc"):
        if not p.isdigit():
            continue
        try:
            with open(f"/proc/{p}/stat") as f:
                s = f.read()
        except OSError:
            continue
        i = s.rfind(")")
        rest = s[i + 2:].split()
        if len(rest) > 12:
            d[int(p)] = (s[s.find("(") + 1:i], int(rest[11]) + int(rest[12]))
    return d


def app_name(pid, comm):
    if comm in GENERIC:
        try:
            with open(f"/proc/{pid}/cmdline", "rb") as f:
                a = [x.decode("utf-8", "replace") for x in f.read().split(b"\0") if x]
            for x in a[1:]:
                if not x.startswith("-"):
                    return os.path.basename(x) or comm
        except OSError:
            pass
    return comm


def procs_api():
    now = time.time()
    if now - _PR["t"] > 8 or not _PR["d"]:
        _PR.update(t=now, d=proc_snapshot())
        time.sleep(1.0)
        now = time.time()
    prev, t0 = _PR["d"], _PR["t"]
    cur = proc_snapshot()
    dt = max(now - t0, 0.5)
    _PR.update(t=now, d=cur)
    rows = [(pid, c, (j - prev[pid][1]) if pid in prev else 0) for pid, (c, j) in cur.items()]
    total = sum(max(r[2], 0) for r in rows)
    groups = {}
    for pid, comm, dj in sorted(rows, key=lambda r: -r[2])[:60]:
        if dj <= 0:
            continue
        g = groups.setdefault(app_name(pid, comm), {"name": None, "n": 0, "j": 0})
        g["n"] += 1
        g["j"] += dj
    b = battery()
    dyn = None
    if b.get("present") and b.get("status") == "Discharging" and b.get("power_w"):
        ws = [r["w"] for r in hist_read(now - 86400) if r.get("s") == "D" and r.get("w")]
        if len(ws) >= 10:
            dyn = max(0.0, b["power_w"] - sorted(ws)[len(ws) // 20])  # lo que gasta por encima del reposo habitual (percentil 5 del último día)
    apps = []
    for name, g in sorted(groups.items(), key=lambda x: -x[1]["j"])[:12]:
        apps.append({"name": name, "procs": g["n"], "cpu_core_pct": round(g["j"] / (dt * CLK) * 100, 1), "share": round(g["j"] / total * 100, 1) if total else 0,
                     "est_w": round(dyn * g["j"] / total, 2) if dyn is not None and total else None})
    gpu_info = {"awake": gpu_active(), "procs": []}
    if gpu_info["awake"]:
        gpu_info["procs"] = (gpu().get("procs") or [])[:8]
    return {"dt": round(dt, 1), "threads": os.cpu_count(), "apps": apps, "dyn_w": round(dyn, 1) if dyn is not None else None, "gpu": gpu_info,
            "discharging": bool(b.get("present") and b.get("status") == "Discharging")}


# ---------- salud del disco NVMe ----------
NVME_CODE = r'''
import fcntl, struct, sys, ctypes, re
dev = sys.argv[1]
assert re.fullmatch(r"/dev/nvme[0-9]+", dev)
buf = ctypes.create_string_buffer(512)
cmd = bytearray(struct.pack("<BBHIIIQQII" + "I" * 6 + "II", 0x02, 0, 0, 0xFFFFFFFF, 0, 0, 0, ctypes.addressof(buf), 0, 512, (127 << 16) | 0x02, 0, 0, 0, 0, 0, 0, 0))
with open(dev, "rb") as f:
    fcntl.ioctl(f, 0xC0484E41, cmd)
print(buf.raw.hex())
'''
NVME_SYS = os.environ.get("CHAMELEON_NVME", "/sys/class/nvme")


def nvme_devices():
    out = []
    for d in sorted(glob.glob(NVME_SYS + "/nvme[0-9]*")):
        n = os.path.basename(d)
        st = (rd(f"/sys/block/{n}n1/stat", "") or "").split()
        out.append({"dev": "/dev/" + n, "name": n, "model": rd(d + "/model"), "firmware": rd(d + "/firmware_rev"), "state": rd(d + "/state"), "transport": rd(d + "/transport"),
                    "written_since_boot_gb": round(int(st[6]) * 512 / 1e9, 1) if len(st) > 6 else None})
    return out


def parse_smart(raw):
    if len(raw) < 200:
        raise ValueError("respuesta SMART incompleta")
    u = lambda a, b: int.from_bytes(raw[a:b], "little")
    cw, temp, spare, thr, used = raw[0], u(1, 3) - 273, raw[3], raw[4], raw[5]
    s = {"critical_warning": cw, "temp_c": temp, "spare_pct": spare, "spare_threshold_pct": thr, "used_pct": used, "tb_read": round(u(32, 48) * 512000 / 1e12, 2),
         "tb_written": round(u(48, 64) * 512000 / 1e12, 2), "power_cycles": u(112, 128), "power_on_hours": u(128, 144), "unsafe_shutdowns": u(144, 160), "media_errors": u(160, 176),
         "error_entries": u(176, 192), "minutes_over_warning_temp": u(192, 196), "minutes_over_critical_temp": u(196, 200)}
    flags = [t for bit, t in ((0, "poco espacio de reserva"), (1, "temperatura fuera de rango"), (2, "fiabilidad degradada"), (3, "solo lectura"), (4, "memoria volátil fallando")) if cw >> bit & 1]
    issues = list(flags)
    if used >= 90:
        issues.append(f"desgaste del {used} %")
    if spare <= thr:
        issues.append("reserva por debajo del umbral")
    if s["media_errors"]:
        issues.append(f"{s['media_errors']} errores de medio")
    s["issues"], s["verdict"] = issues, "bad" if flags or spare <= thr or used >= 100 else "warn" if issues else "ok"
    return s


def nvme_api():
    saved = None
    try:
        with open(SMART_FILE) as f:
            saved = json.load(f)
    except (OSError, ValueError):
        pass
    return {"devices": nvme_devices(), "smart": saved}


NVME_RAW = os.path.join(DATA_DIR, "nvme-raw.hex")


def nvme_smart(from_file=False):
    devs = nvme_devices()
    if not devs:
        raise ValueError("No se detecta ningún disco NVMe.")
    if from_file:
        out, err, rc = fresh_file(NVME_RAW, "la lectura SMART"), "", 0
        os.remove(NVME_RAW)
    else:
        if not have("pkexec"):
            raise ValueError("Falta pkexec para pedir permisos de administrador.")
        os.makedirs(DATA_DIR, exist_ok=True)
        rc, out, err = pk(["/usr/bin/python3", "-I", "-c", NVME_CODE, devs[0]["dev"]], 90, heredoc(NVME_CODE, devs[0]["dev"], f" > {shlex.quote(NVME_RAW)}"), "nvme")
    if rc in (126, 127):
        raise ValueError("Cancelaste la petición de contraseña." if rc == 126 else "No se pudo pedir permisos.")
    try:
        s = parse_smart(bytes.fromhex(out.strip()))
    except ValueError:
        raise ValueError((err.strip().splitlines() or ["No se pudo leer el registro SMART del disco."])[-1][:200])
    s["at"] = int(time.time())
    s["dev"] = devs[0]["dev"]
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SMART_FILE, "w") as f:
        json.dump(s, f)
    return s


# ---------- límites de la GPU NVIDIA ----------
def _gpu_limits_raw():
    if not have("nvidia-smi"):
        return {"supported": False, "why": "No hay driver NVIDIA."}
    if not gpu_active():
        return {"supported": None, "why": "La gráfica NVIDIA está dormida (modo híbrido). Se despierta al consultarla, así que no la miro hasta que lo pidas.", "asleep": True}
    rc, out, _ = run(["nvidia-smi", "-q", "-d", "POWER"], timeout=10)
    f = lambda k: next((tofloat(m[1]) for m in re.finditer(rf"^\s*{k}\s*:\s*([\d.]+) W", out, re.M)), None)
    cur, lo, hi, df = f("Current Power Limit"), f("Min Power Limit"), f("Max Power Limit"), f("Default Power Limit")
    if rc or None in (cur, lo, hi):
        return {"supported": False, "why": "Tu gráfica (portátil) no permite cambiar el límite de potencia: el fabricante lo bloquea."}
    if df:
        lo = max(lo, float(round(df / 2)))  # el mínimo que declara el driver puede ser 1 W: dejaría la gráfica inservible; se limita a la mitad del valor de fábrica
    return {"supported": True, "current": cur, "min": lo, "max": hi, "default": df}


UNIT_DIR = os.environ.get("CHAMELEON_UNIT_DIR", "/etc/systemd/system")
GPU_UNIT = os.path.join(UNIT_DIR, "chameleon-gpu-limit.service")
GPU_MARK = "# Creado por Chameleon"
# Se ejecuta como root con pkexec, pasado en línea (no hay archivo editable que alguien pudiera cambiar). Solo escribe/borra SU unidad, reconocida por la marca.
GPU_ROOT_CODE = r'''
import os, re, subprocess, sys
act, path, MARK = sys.argv[1], "/etc/systemd/system/chameleon-gpu-limit.service", "# Creado por Chameleon"
name = os.path.basename(path)
if os.path.exists(path) and MARK not in open(path, encoding="utf-8", errors="replace").read():
    sys.exit("Ya existe una unidad con ese nombre que no es de Chameleon; no la toco.")
def sc(*a):
    r = subprocess.run(["systemctl", *a], capture_output=True, text=True)
    if r.returncode: sys.exit((r.stderr or r.stdout).strip()[:200] or "systemctl falló")
if act == "enable":
    w, smi = int(sys.argv[2]), sys.argv[3]
    assert 1 <= w <= 1000 and re.fullmatch(r"/[A-Za-z0-9_./-]+", smi)
    unit = (MARK + "\n[Unit]\nDescription=Límite de potencia de la GPU NVIDIA (Chameleon)\nAfter=systemd-modules-load.service nvidia-persistenced.service\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\n"
            "ExecStart=/bin/sh -c 'for i in 1 2 3 4 5 6 7 8 9 10; do " + smi + " -pl " + str(w) + " && exit 0; sleep 3; done; exit 1'\n\n[Install]\nWantedBy=multi-user.target\n")
    open(path, "w", encoding="utf-8").write(unit)
    try:
        sc("daemon-reload"); sc("enable", name); sc("restart", name)
    except SystemExit:  # si algo falla, no dejar una unidad a medias
        subprocess.run(["systemctl", "disable", name], capture_output=True)
        os.remove(path)
        subprocess.run(["systemctl", "daemon-reload"], capture_output=True)
        raise
elif act == "disable":
    if os.path.exists(path):
        sc("disable", "--now", name); os.remove(path); sc("daemon-reload")
else:
    sys.exit("acción inválida")
'''


def gpu_persist_state():
    try:
        t = open(GPU_UNIT, encoding="utf-8", errors="replace").read()
    except OSError:
        return {"enabled": False, "watts": None}
    m = re.search(r"-pl (\d+)", t)
    return {"enabled": GPU_MARK in t, "watts": int(m[1]) if m else None}


def gpu_limits():
    return {**_gpu_limits_raw(), "persist": gpu_persist_state()}


def _root(args, timeout=90):
    if not have("pkexec"):
        raise ValueError("Falta pkexec para pedir permisos de administrador.")
    rc, out, err = pk(["/usr/bin/python3", "-I", "-c", GPU_ROOT_CODE, *args], timeout, heredoc(GPU_ROOT_CODE, " ".join(shlex.quote(x) for x in args)), "gpu")
    if rc in (126, 127):
        raise ValueError("Cancelaste la petición de contraseña." if rc == 126 else "No se pudo pedir permisos.")
    if rc:
        raise ValueError((err.strip().splitlines() or ["no se pudo completar"])[-1][:220])


def set_gpu_limit(watts, persist=None):
    lim = gpu_limits()
    if not lim.get("supported"):
        raise ValueError(lim.get("why") or "No soportado.")
    if not isinstance(watts, (int, float)) or isinstance(watts, bool) or not lim["min"] <= watts <= lim["max"]:
        raise ValueError(f"El límite debe estar entre {lim['min']:.0f} y {lim['max']:.0f} W.")
    if persist is True:  # un solo permiso: crea la unidad y la arranca (eso aplica el límite ahora mismo)
        _root(["enable", str(int(watts)), shutil.which("nvidia-smi") or "/usr/bin/nvidia-smi"])
    else:
        rc, out, err = pk(["nvidia-smi", "-pl", str(int(watts))], 60, f"sudo nvidia-smi -pl {int(watts)}", "gpu")
        if rc in (126, 127):
            raise ValueError("Cancelaste la petición de contraseña." if rc == 126 else "No se pudo pedir permisos.")
    after = gpu_limits()
    if abs((after.get("current") or 0) - int(watts)) > 1:
        raise ValueError("El límite no cambió: el firmware de tu portátil lo ha vuelto a ajustar." + (" El arranque automático sí quedó creado." if persist is True else ""))
    return {**after, "note": "Se mantiene en cada arranque." if persist is True else "Se pierde al reiniciar."}


def gpu_persist_off():
    if not gpu_persist_state()["enabled"] and not os.path.exists(GPU_UNIT):
        return {"persist": gpu_persist_state(), "note": "No había nada que quitar."}
    _root(["disable"])
    return {"persist": gpu_persist_state(), "note": "Quitado. El límite actual dura hasta reiniciar."}


# ---------- brillo ----------
BL = os.environ.get("CHAMELEON_BACKLIGHT", "/sys/class/backlight")
LEDS = os.environ.get("CHAMELEON_LEDS", "/sys/class/leds")


def light(d):
    cur, mx = num(d + "/brightness"), num(d + "/max_brightness")
    return {"name": os.path.basename(d), "value": int(cur), "max": int(mx), "pct": round(cur / mx * 100)} if cur is not None and mx else None


def brightness_api():
    scr = next(filter(None, (light(d) for d in sorted(glob.glob(BL + "/*")))), None)
    kb = next(filter(None, (light(d) for d in sorted(glob.glob(LEDS + "/*kbd_backlight*")))), None)
    return {"screen": scr, "keyboard": kb}


def set_brightness(which, pct):
    if which not in ("screen", "keyboard") or isinstance(pct, bool) or not isinstance(pct, (int, float)):
        raise ValueError("petición inválida")
    pct = max(5 if which == "screen" else 0, min(100, int(pct)))  # la pantalla nunca por debajo del 5 %: no quedarse a oscuras
    cur = brightness_api()[which]
    if not cur:
        raise ValueError("Tu equipo no expone el control de " + ("la pantalla." if which == "screen" else "la retroiluminación del teclado."))
    val = max(0 if which == "keyboard" else 1, round(cur["max"] * pct / 100))
    sub = "backlight" if which == "screen" else "leds"
    if not have("gdbus"):
        raise ValueError("Falta gdbus.")
    rc, out, err = run(["gdbus", "call", "--system", "--dest", "org.freedesktop.login1", "--object-path", "/org/freedesktop/login1/session/auto",
                        "--method", "org.freedesktop.login1.Session.SetBrightness", sub, cur["name"], str(val)], timeout=8)
    after = brightness_api()[which]
    if rc or not after or abs(after["value"] - val) > max(1, cur["max"] // 100):
        raise ValueError((err or out or "No se pudo cambiar el brillo.").strip()[:200])
    return after


# ---------- informe ----------
ES_BATT = {"Charging": "cargando", "Discharging": "descargando", "Not charging": "conectada sin cargar", "Full": "completa"}
ES_LVL = {"ok": "normal", "warm": "templada", "hot": "caliente", "crit": "crítica"}
def report_md():
    hw, b, ss, sm, g = hardware(), battery(), sensors(), nvme_api(), gpu()
    hs = history_api("24h")["summary"]
    L = [f"# Informe del equipo · {time.strftime('%Y-%m-%d %H:%M')}", "", "_Generado por Chameleon (ZOO Linux). No incluye números de serie, direcciones MAC/IP ni nombres de redes._", "",
         "## Equipo", f"- {hw['system'].get('vendor')} {hw['system'].get('product')} ({hw['system'].get('model')})", f"- BIOS {hw['system'].get('bios')} ({hw['system'].get('bios_date')})", f"- Núcleo Linux {hw.get('kernel')}",
         f"- Procesador: {hw['cpu'].get('model')} · {hw['cpu'].get('cores')} núcleos / {hw['cpu'].get('threads')} hilos", f"- Memoria RAM: {hw.get('memory_total_kb', 0) / 1048576:.1f} GB"]
    L += [f"- Gráfica: {x['line'].split(': ', 1)[-1]}" for x in hw.get("gpus", [])]
    L += [f"- Almacenamiento: {d['model']} · {d['size']}" for d in hw.get("storage", [])]
    L += [f"- Pantalla: {o['name']} {o['mode']}" for o in hw.get("displays", {}).get("outputs", []) if o.get("status") == "connected"]
    if g.get("available"):
        L += [f"- NVIDIA {g['name']} · driver {g['driver']} · modo gráfico «{g.get('graphics_mode')}»"]
    if b.get("present"):
        mdl = " ".join(x for x in (b.get("manufacturer"), b.get("model"), b.get("technology")) if x)
        L += ["", "## Batería"] + ([f"- {mdl}"] if mdl else []) + [f"- Salud: {b.get('health')} % ({b.get('energy_full_wh')} Wh de {b.get('energy_design_wh')} Wh de fábrica)",
              f"- Ciclos de carga: {int(b['cycles']) if b.get('cycles') is not None else '—'}", f"- Ahora: {b.get('capacity'):.0f} % ({ES_BATT.get(b.get('status'), b.get('status'))})"]
    L += ["", "## Temperaturas ahora", "| Sensor | °C | Estado |", "|---|---|---|"] + [f"| {s['group']} · {s['label']} | {s['value']} | {ES_LVL.get(s['level'], s['level'])} |" for s in ss if s["kind"] == "temp" and s["chip"] != "thermal"]
    sm_ = sm.get("smart")
    L += ["", "## Salud del disco NVMe"]
    for d in sm.get("devices", []):
        L.append(f"- {d['model']} · firmware {d['firmware']} · estado {d['state']}")
    L += ([f"- Última lectura SMART ({time.strftime('%Y-%m-%d', time.localtime(sm_['at']))}): desgaste {sm_['used_pct']} %, reserva {sm_['spare_pct']} %, {sm_['tb_written']} TB escritos, {sm_['power_on_hours']} h encendido, {sm_['unsafe_shutdowns']} apagados bruscos, {sm_['media_errors']} errores de medio"]
          if sm_ else ["- Sin lectura SMART completa todavía (se hace desde la pestaña Hardware)."])
    L += ["", "## Últimas 24 horas"]
    L += [f"- Consumo medio con batería: {hs['avg_w_discharging']} W" if hs["avg_w_discharging"] else "- Sin datos suficientes de consumo.",
          f"- Autonomía estimada con ese consumo: {hs['est_full_hours']} h" if hs["est_full_hours"] else None,
          f"- Temperatura máxima: CPU {hs['max_cpu']} °C · SSD {hs['max_nvme']} °C" + (f" · GPU {hs['max_gpu']} °C" if hs["max_gpu"] is not None else "")]
    ev = [e for e in read_events(200) if e["kind"] == "alert" and e["t"] > time.time() - 7 * 86400]
    L += ["", "## Avisos de los últimos 7 días"] + ([f"- {time.strftime('%d/%m %H:%M', time.localtime(e['t']))} · {e['title']}" for e in ev[:20]] or ["- Ninguno."])
    return "\n".join(x for x in L if x is not None) + "\n"



class H(BaseHTTPRequestHandler):
    server_version = "Chameleon"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + ("; charset=utf-8" if ctype.startswith(("text/", "application/j")) else ""))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:")
        self.end_headers()
        self.wfile.write(data)

    def _host_ok(self):
        ok = {f"localhost:{PORT}", f"127.0.0.1:{PORT}"}
        if self.headers.get("Host") not in ok:
            return False
        o = self.headers.get("Origin")
        return o is None or o in {f"http://{h}" for h in ok}

    def _file(self, n, ct):
        with open(os.path.join(STATIC, n), "rb") as f:
            self._send(200, f.read(), ct)

    def do_GET(self):
        if not self._host_ok():
            return self._send(403, {"error": "host no permitido"})
        u = urlparse(self.path)
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/":
                return self._file("index.html", "text/html")
            if u.path == "/app.js":
                return self._file("app.js", "application/javascript")
            if u.path == "/style.css":
                return self._file("style.css", "text/css")
            if u.path == "/zoo-theme.css":
                return self._file("zoo-theme.css", "text/css")
            if u.path == "/api/overview":
                return self._send(200, overview())
            if u.path == "/api/sensors":
                return self._send(200, sensors_api())
            if u.path == "/api/power":
                return self._send(200, power_api())
            if u.path == "/api/hardware":
                return self._send(200, hardware(q.get("force") == "1"))
            if u.path == "/api/status":
                return self._send(200, status_api())
            if u.path == "/api/state":
                return self._send(200, state_api())
            if u.path == "/api/history":
                return self._send(200, history_api(q.get("range", "6h")))
            if u.path == "/api/events":
                return self._send(200, read_events())
            if u.path == "/api/settings":
                return self._send(200, {**get_settings(), "_dnd": dnd_active(), "_hold": get_hold()})
            if u.path == "/api/procs":
                return self._send(200, procs_api())
            if u.path == "/api/nvme":
                return self._send(200, nvme_api())
            if u.path == "/api/gpu-limits":
                return self._send(200, gpu_limits())
            if u.path == "/api/brightness":
                return self._send(200, brightness_api())
            if u.path == "/api/report":
                body = report_md().encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/markdown; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="informe-equipo-{time.strftime("%Y%m%d")}.md"')
                self.send_header("Content-Length", str(len(body)))
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                return self.wfile.write(body)
        except Exception as e:
            return self._send(500, {"error": str(e)[:200]})
        self._send(404, {"error": "no encontrado"})

    def do_POST(self):
        if not self._host_ok() or self.headers.get("X-Chameleon") != "1":
            return self._send(403, {"error": "no permitido"})
        u = urlparse(self.path)
        try:
            n = int(self.headers.get("Content-Length", "0"))
            b = json.loads(self.rfile.read(min(n, 65536)) or b"{}")
        except Exception:
            return self._send(400, {"error": "JSON inválido"})
        try:
            if u.path == "/api/profile":
                return self._send(200, set_profile(b.get("profile"), b.get("by") if isinstance(b.get("by"), str) else None))
            if u.path == "/api/hold":
                return self._send(200, set_hold(b.get("on"), b.get("by"), b.get("label")))
            if u.path == "/api/graphics":
                return self._send(200, set_graphics(b.get("mode")))
            if u.path == "/api/settings":
                return self._send(200, save_settings(b))
            if u.path == "/api/terminal":
                return self._send(200, open_terminal(b.get("cmd")))
            if u.path == "/api/test-alert":
                ok = notify("Chameleon: aviso de prueba", "Si ves esto, las notificaciones funcionan.")
                return self._send(200, {"delivered": ok, "dnd": dnd_active()})
            if u.path == "/api/nvme-smart":
                return self._send(200, nvme_smart(b.get("from_file") is True))
            if u.path == "/api/gpu-limit":
                return self._send(200, gpu_persist_off() if b.get("persist") is False else set_gpu_limit(b.get("watts"), b.get("persist")))
            if u.path == "/api/brightness":
                return self._send(200, set_brightness(b.get("which"), b.get("pct")))
            if u.path == "/api/ram-modules":
                return self._send(200, {"modules": ram_modules(b.get("from_file") is True)})
        except NeedTerminal as e:
            return self._send(409, {"error": str(e), "terminal_cmd": e.cmd, "then": e.then})
        except ValueError as e:
            return self._send(400, {"error": str(e)})
        self._send(404, {"error": "no encontrado"})


if __name__ == "__main__":
    threading.Thread(target=sampler, daemon=True).start()
    threading.Thread(target=watcher, daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), H)
    print(f"Chameleon en http://localhost:{PORT}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
