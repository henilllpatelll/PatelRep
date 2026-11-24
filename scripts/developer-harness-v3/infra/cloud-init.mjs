// Developer Harness V3 (D3.3) — worker guest configuration (pure generators; no I/O).
//
// Guest accounts: `ctl` (controller; SSH key only; sudo) and `worker` (Claude; no sudo, no SSH login, no password). sshd accepts only `ctl`, no
// agent/X11/tunnel/stream forwarding, and exactly one REMOTE listen (guest 127.0.0.1:3128 → the controller's egress proxy). The worker home is a
// small persistent disk that a root boot-time sanitizer reduces to the Claude login files before any worker process can run (no task residue).
// Claude's managed settings are root-owned. cloud-init is disabled after provisioning so a later boot can never re-run per-instance config.
import { MANAGED_SETTINGS } from '../runtime/launcher.mjs'

const indent = (s, n) => s.split('\n').map((l) => (l ? ' '.repeat(n) + l : l)).join('\n')
const yamlStr = (s) => JSON.stringify(s)

export const SSHD_CONFIG = [
  'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'PermitRootLogin no', 'AllowUsers ctl', 'AuthenticationMethods publickey',
  'AllowAgentForwarding no', 'X11Forwarding no', 'PermitTunnel no', 'AllowStreamLocalForwarding no', 'GatewayPorts no',
  'AllowTcpForwarding remote', 'PermitListen 127.0.0.1:3128', 'PermitOpen none', 'PermitUserEnvironment no', 'MaxSessions 16', 'ClientAliveInterval 30', '',
].join('\n')

export const SYSCTL = ['kernel.dmesg_restrict = 1', 'kernel.kptr_restrict = 2', 'kernel.unprivileged_bpf_disabled = 1', 'net.ipv6.conf.all.disable_ipv6 = 1', 'net.ipv6.conf.default.disable_ipv6 = 1', 'fs.protected_symlinks = 1', 'fs.protected_hardlinks = 1', 'fs.protected_fifos = 2', 'fs.protected_regular = 2',
  // Security review S4: the worker must not ptrace the Claude process it runs beside (only root may attach). It can still write into its own
  // process's stdout via /proc (same uid), so guest-relayed stream facts are never treated as provider-verified (see 14 §3).
  'kernel.yama.ptrace_scope = 2', ''].join('\n')

/**
 * Root-owned sanitizer for the persistent worker home. Runs at boot before sshd (which REQUIRES its success), i.e. before any worker process exists.
 * Security properties (security review B1): every operation is directory-fd relative with O_NOFOLLOW; the two kept files are READ (regular, size-
 * bounded, single-link, non-FIFO) and then EVERYTHING is deleted before anything is written; new files are created with O_CREAT|O_EXCL|O_NOFOLLOW;
 * the credentials file must match the expected top-level shape; any exception wipes the whole home and exits non-zero (no marker → no sshd).
 * Residual (documented): the kept JSON values remain a small covert channel between tasks.
 */
export const SANITIZER_PY = String.raw`#!/usr/bin/python3 -I
# Developer Harness V3 D3.3: reduce /home/worker to the Claude login files. Root-owned; runs at boot before sshd.
import json, os, shutil, stat, sys
HOME, MARK, UID = "/home/worker", "/run/dh3-sanitized", 1001
JSON_KEYS = {"oauthAccount", "userID", "hasCompletedOnboarding", "lastOnboardingVersion", "firstStartTime", "numStartups", "installMethod", "autoUpdates"}
CRED_KEYS = {"claudeAiOauth"}
NF = os.O_NOFOLLOW
def wipe(dfd, name):
    st = os.lstat(name, dir_fd=dfd)
    if stat.S_ISDIR(st.st_mode): shutil.rmtree(name, dir_fd=dfd)
    else: os.unlink(name, dir_fd=dfd)
def read_json(dfd, name, maxb):
    fd = os.open(name, os.O_RDONLY | NF | os.O_NONBLOCK, dir_fd=dfd)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or st.st_size > maxb or st.st_nlink != 1: raise ValueError("not a small regular file")
        return json.loads(os.read(fd, maxb + 1))
    finally: os.close(fd)
def create(dfd, name, data, mode=0o600):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | NF, mode, dir_fd=dfd)
    try: os.write(fd, data); os.fsync(fd); os.fchown(fd, UID, UID)
    finally: os.close(fd)
def sanitize():
    try: os.unlink(MARK)
    except FileNotFoundError: pass
    if not stat.S_ISDIR(os.lstat(HOME).st_mode): raise ValueError("home is not a directory")
    h = os.open(HOME, os.O_RDONLY | os.O_DIRECTORY | NF)
    try:
        cj, cred = None, None
        names = os.listdir(h)
        if ".claude.json" in names:
            try:
                d = read_json(h, ".claude.json", 65536)
                cj = {k: v for k, v in d.items() if k in JSON_KEYS} if isinstance(d, dict) else None
            except Exception: cj = None
        if ".claude" in names and stat.S_ISDIR(os.lstat(".claude", dir_fd=h).st_mode):
            c = os.open(".claude", os.O_RDONLY | os.O_DIRECTORY | NF, dir_fd=h)
            try:
                if ".credentials.json" in os.listdir(c):
                    try:
                        d = read_json(c, ".credentials.json", 16384)
                        if isinstance(d, dict) and set(d) <= CRED_KEYS and isinstance(d.get("claudeAiOauth"), dict): cred = d
                    except Exception: cred = None
            finally: os.close(c)
        for n in os.listdir(h): wipe(h, n)          # nothing the worker left behind survives, temp names included
        os.mkdir(".claude", 0o700, dir_fd=h); os.chown(".claude", UID, UID, dir_fd=h, follow_symlinks=False)
        os.mkdir(".tmp", 0o700, dir_fd=h); os.chown(".tmp", UID, UID, dir_fd=h, follow_symlinks=False)
        if cj is not None: create(h, ".claude.json", json.dumps(cj).encode())
        if cred is not None:
            c = os.open(".claude", os.O_RDONLY | os.O_DIRECTORY | NF, dir_fd=h)
            try: create(c, ".credentials.json", json.dumps(cred).encode())
            finally: os.close(c)
        for n in os.listdir("/etc/skel"):
            src = os.path.join("/etc/skel", n)
            if os.path.isfile(src) and not os.path.islink(src):
                with open(src, "rb") as f: create(h, n, f.read(65536), 0o644)
        os.fchown(h, UID, UID); os.fchmod(h, 0o700)
    finally: os.close(h)
    with open(MARK, "w") as f: f.write("ok\n")
try:
    sanitize()
except Exception as e:
    try:
        h = os.open(HOME, os.O_RDONLY | os.O_DIRECTORY | NF)
        for n in os.listdir(h): wipe(h, n)
        os.close(h)
    except Exception: pass
    print("dh3 sanitizer failed; home wiped:", type(e).__name__, file=sys.stderr)
    sys.exit(1)
`

export const SANITIZER_UNIT = ['[Unit]', 'Description=Developer Harness V3: sanitize persistent worker home', 'RequiresMountsFor=/home/worker', 'Before=ssh.service ssh.socket', '', '[Service]', 'Type=oneshot',
  'RemainAfterExit=yes', 'ExecStart=/usr/local/sbin/patelrep-sanitize-home', '', '[Install]', 'WantedBy=multi-user.target', ''].join('\n')
/** sshd (service and socket activation) REQUIRES a successful sanitizer: if it fails, the controller cannot connect at all (fail closed). */
export const SSH_REQUIRES_SANITIZER = ['[Unit]', 'Requires=patelrep-sanitize-home.service', 'After=patelrep-sanitize-home.service', ''].join('\n')
export const SANITIZED_MARKER = '/run/dh3-sanitized'

/**
 * @param {{name:string, controllerPublicKey:string, hostKeyPrivate:string, hostKeyPublic:string}} o
 */
export function buildUserData(o) {
  for (const k of ['controllerPublicKey', 'hostKeyPublic']) if (!/^ssh-ed25519 [A-Za-z0-9+/=]+( \S+)?$/.test(String(o[k]).trim())) throw new Error(`CLOUDINIT.BAD_KEY:${k}`)
  if (!/^-----BEGIN OPENSSH PRIVATE KEY-----\n[\s\S]+\n-----END OPENSSH PRIVATE KEY-----\n?$/.test(String(o.hostKeyPrivate).replace(/\r\n/g, '\n'))) throw new Error('CLOUDINIT.BAD_HOST_KEY')
  const managed = `${JSON.stringify(MANAGED_SETTINGS, null, 2)}\n`
  const file = (path, content, perms = '0644', owner = 'root:root') => `  - path: ${path}\n    owner: ${owner}\n    permissions: '${perms}'\n    content: |\n${indent(content.replace(/\r\n/g, '\n'), 6)}`
  return `#cloud-config
hostname: ${o.name}
disable_root: true
ssh_pwauth: false
ssh_deletekeys: true
ssh_genkeytypes: []
ssh_keys:
  ed25519_private: |
${indent(o.hostKeyPrivate.replace(/\r\n/g, '\n').trim(), 4)}
  ed25519_public: ${yamlStr(o.hostKeyPublic.trim())}
disk_setup:
  /dev/disk/by-id/virtio-dh3auth:
    table_type: gpt
    layout: true
    overwrite: false
fs_setup:
  - label: dh3home
    filesystem: ext4
    device: /dev/disk/by-id/virtio-dh3auth
    partition: auto
    overwrite: false
mounts:
  - [ "LABEL=dh3home", "/home/worker", "ext4", "defaults,nodev,nosuid", "0", "2" ]
users:
  - name: ctl
    shell: /bin/bash
    lock_passwd: true
    sudo: "ALL=(ALL) NOPASSWD:ALL"
    ssh_authorized_keys:
      - ${yamlStr(o.controllerPublicKey.trim())}
  - name: worker
    uid: 1001
    shell: /bin/bash
    lock_passwd: true
    no_create_home: true
write_files:
${file('/etc/ssh/sshd_config.d/10-dh3.conf', SSHD_CONFIG)}
${file('/etc/claude-code/managed-settings.json', managed)}
${file('/etc/sysctl.d/90-dh3.conf', SYSCTL)}
${file('/usr/local/sbin/patelrep-sanitize-home', SANITIZER_PY, '0755')}
${file('/etc/systemd/system/patelrep-sanitize-home.service', SANITIZER_UNIT)}
${file('/etc/systemd/system/ssh.service.d/10-dh3-requires-sanitizer.conf', SSH_REQUIRES_SANITIZER)}
${file('/etc/systemd/system/ssh.socket.d/10-dh3-requires-sanitizer.conf', SSH_REQUIRES_SANITIZER)}
runcmd:
  - [ systemctl, mask, --now, serial-getty@ttyS0.service ]
  - [ systemctl, daemon-reload ]
  - [ systemctl, enable, patelrep-sanitize-home.service ]
  - [ /usr/local/sbin/patelrep-sanitize-home ]
  - [ sysctl, --system ]
  - [ systemctl, restart, ssh ]
  - [ touch, /var/lib/dh3-cloud-init-done ]
`
}

export const buildMetaData = ({ name, instanceId }) => `instance-id: ${instanceId}\nlocal-hostname: ${name}\n`

/**
 * Root provisioning script run by the controller over SSH (stdin) while the egress proxy is in the `provisioning` profile. The Claude binary is
 * streamed in by the controller beforehand (/tmp/dh3-claude.tgz) and verified HERE against the pin before installation.
 */
export function buildProvisionScript({ claudeSha512Hex, claudeVersion }) {
  if (!/^[0-9a-f]{128}$/.test(claudeSha512Hex) || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(claudeVersion)) throw new Error('PROVISION.BAD_PIN')
  return `set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
test -f /var/lib/dh3-cloud-init-done
printf 'Acquire::http::Proxy "http://127.0.0.1:3128";\\nAcquire::https::Proxy "http://127.0.0.1:3128";\\n' > /etc/apt/apt.conf.d/90dh3-proxy
# Debian 13 cloud images point apt at mirror lists (mirror+file:///etc/apt/mirrors/*.list); the proxy only tunnels HTTPS, so rewrite both forms.
for f in /etc/apt/sources.list.d/debian.sources /etc/apt/mirrors/*.list; do [ -f "$f" ] && sed -i 's#http://deb.debian.org#https://deb.debian.org#g; s#http://security.debian.org#https://deb.debian.org#g' "$f"; done
! grep -rqs 'http://' /etc/apt/mirrors/ /etc/apt/sources.list.d/
apt-get -o Acquire::Retries=3 update
apt-get install -y --no-install-recommends git ca-certificates ripgrep procps psmisc
echo "${claudeSha512Hex}  /tmp/dh3-claude.tgz" | sha512sum -c -
install -d -o root -g root -m 0755 /opt/patelrep-claude/${claudeVersion} /opt/patelrep-claude/bin
tar -xzf /tmp/dh3-claude.tgz -C /opt/patelrep-claude/${claudeVersion} --no-same-owner package/claude
install -o root -g root -m 0555 /opt/patelrep-claude/${claudeVersion}/package/claude /opt/patelrep-claude/bin/claude
rm -rf /opt/patelrep-claude/${claudeVersion}/package /tmp/dh3-claude.tgz
ln -sfn /opt/patelrep-claude/bin/claude /usr/local/bin/claude
rm -f /etc/apt/apt.conf.d/90dh3-proxy
apt-get clean
install -d -o root -g root -m 0755 /work
touch /etc/cloud/cloud-init.disabled
sha512sum /opt/patelrep-claude/bin/claude | cut -d' ' -f1 > /var/lib/dh3-claude.sha512
/opt/patelrep-claude/bin/claude --version | head -1 > /var/lib/dh3-claude.version || true
sync
echo DH3_PROVISION_OK
`
}
