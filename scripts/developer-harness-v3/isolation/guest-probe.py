# Developer Harness V3 (D3.3) adversarial isolation probe, version 3. Runs INSIDE the worker VM as the unprivileged `worker` user (the identity
# that would run Claude with Bypass Permissions). Every check ATTEMPTS the forbidden thing and reports RAW facts: exact errno names, raw kernel
# text, device ids. It decides nothing — the HOST evaluates (isolation/acceptance-rules.mjs), because guest output is untrusted data. Bounded:
# short timeouts, synthetic data only. Prints one JSON object whose last key is "complete". Placeholders @@...@@ are filled by the host.
import base64, errno, fcntl, hashlib, json, os, socket, stat, struct, subprocess
TARGETS = json.loads('@@TARGETS@@')
PE_FIXTURE = base64.b64decode('@@PE_B64@@')
R = {"probe_version": 3}

def en(e):
    n = getattr(e, "errno", None)
    return errno.errorcode.get(n, "E?%s" % n) if isinstance(n, int) else type(e).__name__

def section(name, fn):
    try: R[name] = fn()
    except Exception as e: R[name] = {"__error__": type(e).__name__ + ":" + en(e)}

def tcp(host, port, t=4):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(t)
    try:
        s.connect((host, port)); return "CONNECTED"
    except socket.timeout: return "timeout"
    except OSError as e: return en(e)
    finally: s.close()

def udp_dns(server, t=3):
    q = struct.pack(">HHHHHH", 0x1234, 0x0100, 1, 0, 0, 0) + b"\x07example\x03com\x00\x00\x01\x00\x01"
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(t)
    try:
        s.sendto(q, (server, 53)); s.recvfrom(512); return "ANSWERED"
    except socket.timeout: return "timeout"
    except OSError as e: return en(e)
    finally: s.close()

def proxy_connect(target, t=8):
    s = socket.socket(); s.settimeout(t)
    try:
        s.connect(("127.0.0.1", 3128)); s.sendall(("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n" % (target, target)).encode())
        return s.recv(64).decode("latin1").split("\r\n")[0]
    except OSError as e: return "NO_PROXY:" + en(e)
    finally: s.close()

def run_rc(cmd):
    try: return subprocess.run(cmd, capture_output=True, timeout=10).returncode
    except Exception as e: return "ERR:" + en(e)

def exec_try(path):
    try:
        p = subprocess.run([path], capture_output=True, timeout=10); return {"ran": True, "rc": p.returncode}
    except subprocess.TimeoutExpired: return {"ran": True, "rc": None, "timeout": True}
    except OSError as e: return {"ran": False, "errno": en(e)}

def read_small(p, n=4096):
    with open(p, "rb") as f: return f.read(n).decode("latin1")

# The probe runs with a minimal PATH, so the standard binary directories are searched as well: a tool outside that PATH must not go unseen.
STD_BIN_DIRS = ("/usr/local/sbin", "/usr/local/bin", "/usr/sbin", "/usr/bin", "/sbin", "/bin", "/usr/games", "/usr/local/games", "/snap/bin", "/opt/bin")
def on_path(names):
    dirs = [p for p in os.environ.get("PATH", "").split(":") if p] + list(STD_BIN_DIRS)
    return sorted({t for t in names for p in dirs if os.path.lexists(os.path.join(p, t))})

def mounts():
    return [l.split() for l in read_small("/proc/mounts", 1 << 20).splitlines() if len(l.split()) >= 3]

# 1 host filesystem / credentials
def s1():
    m = mounts()
    return {"fs_types": sorted({x[2] for x in m}), "root_fs_type": next((x[2] for x in m if x[1] == "/"), None),
            "paths_present": [p for p in ("/mnt/c", "/mnt/wsl", "/mnt/host", "/media/sf_host", "/run/WSL", "/init") if os.path.lexists(p)],
            "block_devices": sorted(d for d in os.listdir("/sys/block") if not d.startswith(("loop", "ram", "zram"))),
            "user": subprocess.run(["id", "-un"], capture_output=True, text=True, timeout=10).stdout.strip()}

# 2 Windows interop: binfmt_misc raw state, a well-formed PE fixture, a positive exec control, host Windows binary paths
def s2():
    d = "/proc/sys/fs/binfmt_misc"
    entries = sorted(os.listdir(d)) if os.path.isdir(d) else None  # listing first: it may trigger the automount
    handlers = {}
    for n in (entries or []):
        if n in ("register", "status"): continue
        try: handlers[n] = read_small(os.path.join(d, n))
        except OSError as e: handlers[n] = {"read_error": en(e)}
    status = None
    if entries and "status" in entries:
        try: status = read_small(os.path.join(d, "status")).strip()
        except OSError as e: status = {"read_error": en(e)}
    tmp = os.path.expanduser("~/.tmp"); os.makedirs(tmp, exist_ok=True)
    def put(name, data, mode=0o755):
        p = os.path.join(tmp, name)
        with open(p, "wb") as f: f.write(data)
        os.chmod(p, mode); return p
    files = {"pe_exe": put("dh3fixture.exe", PE_FIXTURE), "pe_noext": put("dh3fixture", PE_FIXTURE), "mz_stub": put("dh3mz.exe", b"MZ" + b"\0" * 126),
             "positive_control": put("dh3ok.sh", b"#!/bin/sh\nexit 42\n")}
    with open(files["pe_exe"], "rb") as f: written = hashlib.sha256(f.read()).hexdigest()
    ex = {k: exec_try(p) for k, p in files.items()}
    for p in files.values(): os.unlink(p)
    host = {p: exec_try(p) for p in ("/mnt/c/Windows/System32/cmd.exe", "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", "/init")}
    return {"binfmt_dir_entries": entries, "binfmt_mounted": any(x[2] == "binfmt_misc" for x in mounts()), "binfmt_status": status, "binfmt_handlers": handlers,
            "fixture_sha256_written": written, "exec": ex, "host_binary_paths": host,
            "windows_tools_on_path": on_path(("cmd.exe", "powershell.exe", "pwsh.exe", "wsl.exe", "wslpath", "explorer.exe")),
            "wsl_env": sorted(k for k in os.environ if k.startswith("WSL"))}

# 3 host services (slirp gateway + the host's real addresses)
def s3():
    return {"host_tcp": {"%s:%d" % (h, p): tcp(h, p) for h in TARGETS["host_addrs"] for p in TARGETS["host_ports"]}, "slirp_dns_udp": udp_dns("10.0.2.3")}

# 4 controller surfaces from the guest network + through the proxy (no QMP exists)
def s4():
    cp = TARGETS["controller_ports"]
    return {"controller_tcp": {"10.0.2.2:%d" % p: tcp("10.0.2.2", p) for p in cp},
            "via_proxy": {t: proxy_connect(t) for t in ["127.0.0.1:%d" % cp[0], "localhost:%d" % cp[0], "10.0.2.2:22"]}}

# 5 internet + DNS
def s5():
    try: socket.getaddrinfo("example.com", 443); resolver = "RESOLVED"
    except socket.gaierror as e: resolver = "gaierror:%s" % e.errno
    except OSError as e: resolver = en(e)
    return {"resolver": resolver, "public_dns_udp": {s: udp_dns(s) for s in ("1.1.1.1", "8.8.8.8")},
            "direct_tcp": {"%s:443" % h: tcp(h, 443) for h in ("1.1.1.1", "160.79.104.10", "140.82.112.3")},
            "via_proxy": {t: proxy_connect(t) for t in ["example.com:443", "github.com:443", "registry.npmjs.org:443", "api.anthropic.com:80", "2130706433:443", "[::1]:443", "api.anthropic.com:443"]}}

# 6 other VMs / WSL / Docker Desktop networks
def s6():
    return {"neighbors_tcp": {"%s:%d" % (h, p): tcp(h, p, 3) for h in TARGETS["other_vm_addrs"] for p in (22, 80, 2375, 2376)}}

# 7 container runtime sockets / privilege
def s7():
    return {"sockets": [p for p in ("/var/run/docker.sock", "/run/docker.sock", "/run/containerd/containerd.sock", "/run/podman/podman.sock", "/run/user/1001/podman/podman.sock", "/run/user/1001/docker.sock") if os.path.lexists(p)],
            "tools": on_path(("docker", "podman", "nerdctl", "ctr", "lxc", "incus")),
            "sudo_rc": run_rc(["sudo", "-n", "true"]),
            "groups": subprocess.run(["id", "-Gn"], capture_output=True, text=True, timeout=10).stdout.split()}

# 10 host integration channels: virtio ports, USB, VSOCK (raw socket/ioctl/connect results), modules, device ids, VMBus, agents
def listdir_or_none(p):
    return sorted(os.listdir(p)) if os.path.isdir(p) else None

def node_facts(p):
    # A /dev node proves nothing by itself (kmod creates static nodes for drivers that never load): what matters is whether the kernel has
    # REGISTERED the device (/sys/dev/char/<major>:<minor> exists only for a registered character device).
    st = os.lstat(p)
    f = {"mode": st.st_mode & 0o7777, "uid": st.st_uid, "char": stat.S_ISCHR(st.st_mode)}
    if f["char"]:
        f["major"], f["minor"] = os.major(st.st_rdev), os.minor(st.st_rdev)
        f["registered"] = os.path.exists("/sys/dev/char/%d:%d" % (f["major"], f["minor"]))
    else: f["registered"] = None
    return f

def vsock():
    AF_VSOCK = getattr(socket, "AF_VSOCK", 40)
    v = {"dev_node": os.path.lexists("/dev/vsock")}
    if v["dev_node"]:
        try: v["node"] = node_facts("/dev/vsock")
        except OSError as e: v["node"] = {"stat_error": en(e)}
        try:
            fd = os.open("/dev/vsock", os.O_RDONLY)
            try: v["local_cid"] = struct.unpack("I", fcntl.ioctl(fd, 0x7B9, b"\0" * 4))[0]  # IOCTL_VM_SOCKETS_GET_LOCAL_CID
            except OSError as e: v["local_cid"] = "ERR:" + en(e)
            finally: os.close(fd)
        except OSError as e: v["dev_open"] = en(e)
    try:
        s = socket.socket(AF_VSOCK, socket.SOCK_STREAM); s.close(); v["stream_socket"] = "created"
    except OSError as e: v["stream_socket"] = en(e)
    if v["stream_socket"] == "created":
        v["connect"] = {}
        for cid, port in ((0, 1024), (2, 22), (2, 1024), (2, 9999), (3, 1024)):
            s = socket.socket(AF_VSOCK, socket.SOCK_STREAM); s.settimeout(3)
            try: s.connect((cid, port)); v["connect"]["%d:%d" % (cid, port)] = "CONNECTED"
            except socket.timeout: v["connect"]["%d:%d" % (cid, port)] = "timeout"
            except OSError as e: v["connect"]["%d:%d" % (cid, port)] = en(e)
            finally: s.close()
        try:
            s = socket.socket(AF_VSOCK, socket.SOCK_DGRAM)
            try: s.sendto(b"x", (2, 1024)); v["dgram"] = "SENT"
            except OSError as e: v["dgram"] = en(e)
            finally: s.close()
        except OSError as e: v["dgram"] = en(e)
    return v

def dev_channels():
    out = []
    for n in sorted(os.listdir("/dev")):
        if not n.startswith(("vport", "hvc", "vhost", "vmci", "vboxguest", "kvm", "vsock", "hv_")): continue
        try: f = node_facts(os.path.join("/dev", n))
        except OSError as e: f = {"stat_error": en(e)}
        f["name"] = n; out.append(f)
    return out

def s10():
    def ids(bus, keys):
        out = []
        for d in listdir_or_none(bus) or []:
            out.append(":".join(read_small(os.path.join(bus, d, k), 64).strip() for k in keys))
        return sorted(out)
    return {"virtio_ports": listdir_or_none("/sys/class/virtio-ports") or [], "usb_devices": listdir_or_none("/sys/bus/usb/devices") or [],
            "virtio_devices": ids("/sys/bus/virtio/devices", ("vendor", "device")), "pci_devices": ids("/sys/bus/pci/devices", ("vendor", "device")),
            "vmbus_devices": listdir_or_none("/sys/bus/vmbus/devices"), "modules": listdir_or_none("/sys/module") or [],
            "dev_channels": dev_channels(),
            "agents": [p for p in ("/usr/bin/spice-vdagent", "/usr/bin/VBoxClient", "/usr/sbin/qemu-ga", "/usr/bin/vmtoolsd", "/usr/sbin/hv_kvp_daemon", "/usr/bin/vmhgfs-fuse") if os.path.lexists(p)],
            "vsock": vsock()}

# 11 clock: the unprivileged worker cannot change even the guest clock
def s11():
    return {"worker_date_s_rc": run_rc(["date", "-s", "2030-01-01"])}

for name, fn in (("s1", s1), ("s2", s2), ("s3", s3), ("s4", s4), ("s5", s5), ("s6", s6), ("s7", s7), ("s10", s10), ("s11", s11)): section(name, fn)
R["complete"] = True
print(json.dumps(R))
