# Developer Harness V3 (D3.3) adversarial isolation probe. Runs INSIDE the worker VM as the unprivileged `worker` user (the identity that
# would run Claude with Bypass Permissions). Every check ATTEMPTS the forbidden thing and reports what happened. Bounded: short timeouts,
# no payloads of value, synthetic data only. Prints one JSON object. Placeholders @@...@@ are filled by the host orchestrator.
import json, os, socket, stat, struct, subprocess, sys
TARGETS = json.loads('@@TARGETS@@')
R = {}

def tcp(host, port, t=4):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(t)
    try:
        s.connect((host, port)); return "CONNECTED"
    except socket.timeout: return "timeout"
    except OSError as e: return type(e).__name__
    finally: s.close()

def udp_dns(server, t=3):
    q = struct.pack(">HHHHHH", 0x1234, 0x0100, 1, 0, 0, 0) + b"\x07example\x03com\x00\x00\x01\x00\x01"
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(t)
    try:
        s.sendto(q, (server, 53)); s.recvfrom(512); return "ANSWERED"
    except socket.timeout: return "timeout"
    except OSError as e: return type(e).__name__
    finally: s.close()

def proxy_connect(target, t=8):
    s = socket.socket(); s.settimeout(t)
    try:
        s.connect(("127.0.0.1", 3128)); s.sendall(("CONNECT %s HTTP/1.1\r\nHost: %s\r\n\r\n" % (target, target)).encode())
        return s.recv(64).decode("latin1").split("\r\n")[0]
    except OSError as e: return "NO_PROXY:" + type(e).__name__
    finally: s.close()

def run(cmd):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=10); return p.returncode, (p.stdout + p.stderr)[-300:]
    except Exception as e: return -1, type(e).__name__

# 1 host filesystem / credentials
mounts = open("/proc/mounts").read().splitlines()
R["s1_host_fs_types"] = [m.split()[2] for m in mounts if m.split()[2] in ("9p", "virtiofs", "cifs", "smb3", "drvfs", "vboxsf", "fuse", "fuse.sshfs", "nfs", "nfs4")]
R["s1_paths_present"] = [p for p in ("/mnt/c", "/mnt/wsl", "/mnt/host", "/media/sf_host", "/run/WSL") if os.path.exists(p)]
R["s1_block_devices"] = sorted(d for d in os.listdir("/sys/block") if not d.startswith(("loop", "ram", "zram")))
R["s1_user"] = run(["id", "-un"])[1].strip()
# 2 Windows interop
R["s2_binfmt"] = sorted(os.listdir("/proc/sys/fs/binfmt_misc")) if os.path.isdir("/proc/sys/fs/binfmt_misc") else []
R["s2_windows_tools_on_path"] = [t for t in ("cmd.exe", "powershell.exe", "wsl.exe", "explorer.exe") if any(os.path.exists(os.path.join(p, t)) for p in os.environ.get("PATH", "").split(":"))]
pe = os.path.expanduser("~/.tmp/fake.exe"); os.makedirs(os.path.dirname(pe), exist_ok=True)
open(pe, "wb").write(b"MZ" + b"\0" * 126); os.chmod(pe, 0o755)
R["s2_pe_exec"] = run([pe])[1].strip()[:80]; os.unlink(pe)
# 3 host services (slirp gateway + the host's real addresses)
R["s3_host_tcp"] = {f"{h}:{p}": tcp(h, p) for h in TARGETS["host_addrs"] for p in TARGETS["host_ports"]}
R["s3_slirp_dns_udp"] = udp_dns("10.0.2.3")
# 4 controller surfaces (QMP, SSH forward, proxy listener as seen from the guest network) + through the proxy
R["s4_controller_tcp"] = {f"10.0.2.2:{p}": tcp("10.0.2.2", p) for p in TARGETS["controller_ports"]}
R["s4_via_proxy"] = {t: proxy_connect(t) for t in [f"127.0.0.1:{TARGETS['controller_ports'][0]}", f"localhost:{TARGETS['controller_ports'][0]}", "10.0.2.2:22"]}
# 5 internet + DNS
try:
    socket.getaddrinfo("example.com", 443); R["s5_resolver"] = "RESOLVED"
except OSError as e: R["s5_resolver"] = type(e).__name__
R["s5_public_dns_udp"] = {s: udp_dns(s) for s in ("1.1.1.1", "8.8.8.8")}
R["s5_direct_tcp"] = {f"{h}:443": tcp(h, 443) for h in ("1.1.1.1", "160.79.104.10", "140.82.112.3")}
R["s5_via_proxy"] = {t: proxy_connect(t) for t in ["example.com:443", "github.com:443", "registry.npmjs.org:443", "api.anthropic.com:80", "2130706433:443", "[::1]:443", "api.anthropic.com:443"]}
# 6 other VMs / WSL / Docker Desktop networks
R["s6_neighbors_tcp"] = {f"{h}:{p}": tcp(h, p, 3) for h in TARGETS["other_vm_addrs"] for p in (22, 80, 2375, 2376)}
# 7 container runtime sockets
R["s7_sockets"] = [p for p in ("/var/run/docker.sock", "/run/docker.sock", "/run/containerd/containerd.sock", "/run/podman/podman.sock", "/run/user/1001/podman/podman.sock") if os.path.exists(p)]
R["s7_tools"] = [t for t in ("docker", "podman", "nerdctl", "ctr") if any(os.path.exists(os.path.join(p, t)) for p in os.environ.get("PATH", "").split(":"))]
R["s7_sudo"] = run(["sudo", "-n", "true"])[0]
# 10 host integration channels
R["s10_virtio_ports"] = os.listdir("/sys/class/virtio-ports") if os.path.isdir("/sys/class/virtio-ports") else []
R["s10_usb_devices"] = os.listdir("/sys/bus/usb/devices") if os.path.isdir("/sys/bus/usb/devices") else []
R["s10_vsock"] = os.path.exists("/dev/vsock")
R["s10_agents"] = [p for p in ("/usr/bin/spice-vdagent", "/usr/bin/VBoxClient", "/usr/sbin/qemu-ga", "/usr/bin/vmtoolsd") if os.path.exists(p)]
# 11 clock: the unprivileged worker cannot change even the guest clock
R["s11_worker_set_clock"] = run(["date", "-s", "2030-01-01"])[0]
print(json.dumps(R))
