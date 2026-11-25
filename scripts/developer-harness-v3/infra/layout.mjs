// Developer Harness V3 (D3.3) — on-disk layout of the local infrastructure. Everything D3.3 creates lives under ONE root outside every
// repository checkout, so removal is a single, manifest-checked operation and no candidate worktree can reach controller state.
import path from 'node:path'

export function defaultRoot(env = process.env) {
  const base = env.LOCALAPPDATA ?? (env.HOME ? path.join(env.HOME, '.local', 'share') : null)
  if (!base) throw new Error('LAYOUT.NO_BASE_DIRECTORY')
  return path.join(base, 'PatelRep', 'dh3')
}

/** All paths are derived from `root`; nothing is read from the environment here. */
export function layout(root) {
  const p = (...x) => path.join(root, ...x)
  return Object.freeze({
    root,
    manifest: p('setup-manifest.json'),
    downloads: p('downloads'),
    gnupg: p('gnupg'),
    msys2: p('runtime', 'msys64'),
    qemu: p('runtime', 'msys64', 'ucrt64', 'bin', 'qemu-system-x86_64.exe'),
    qemuImg: p('runtime', 'msys64', 'ucrt64', 'bin', 'qemu-img.exe'),
    images: p('images'),
    baseImage: p('images', 'debian-13-genericcloud-amd64.qcow2'),
    claudePackage: p('images', 'claude-code-linux-x64.tgz'),
    workers: p('workers'),
    worker: (id) => {
      if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(id)) throw new Error('LAYOUT.INVALID_WORKER_ID')
      const w = (...x) => p('workers', id, ...x)
      return Object.freeze({ dir: w(), golden: w('golden.qcow2'), auth: w('auth.qcow2'), task: w('task.qcow2'), seed: w('seed.iso'), seedDir: w('seed'),
        sshKey: w('ssh', 'controller_ed25519'), knownHosts: w('ssh', 'known_hosts'), hostKeyDir: w('ssh', 'hostkeys'), record: w('vm-record.json'), lease: w('lease.json'), log: w('supervisor.log') })
    },
    state: p('state'),
    sessionLock: p('state', 'reasoning-session.lock'),
    reservations: p('state', 'reservations.json'),
    executions: p('state', 'executions'),
    governor: p('state', 'governor.json'),
    subscription: p('state', 'subscription.json'),
    samples: p('state', 'samples.jsonl'),
    evidence: p('evidence'),
  })
}

/** True when `target` is `root` itself or strictly inside it (case-insensitive on Windows). Used before every delete. */
export function isInside(root, target, platform = process.platform) {
  const norm = (x) => (platform === 'win32' ? path.win32.resolve(x).toLowerCase() : path.posix.resolve(x))
  const r = norm(root); const t = norm(target)
  const sep = platform === 'win32' ? '\\' : '/'
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep)
}
