// Developer Harness V3 (D3.3) — QEMU command line for the isolated worker (pure, validated).
//
// Isolation is expressed by what is ABSENT: -nodefaults (no default NIC, VGA, serial, parallel, floppy, CD), no USB controller, no audio, no
// display, no monitor, no serial/parallel, no shared folders (no -virtfs / fat: drives), no clipboard/drag-drop agent (no spice/vdagent), no
// guest agent channel. The single NIC is QEMU user networking with `restrict=on` (guest cannot open ANY connection to the host or beyond) and
// exactly one inbound hostfwd on host loopback for the controller's SSH. There is NO QMP/monitor channel at all (security review S1: a loopback TCP
// QMP is reachable from Docker Desktop containers / mirrored WSL, and QEMU's Windows pipe chardev blocks VM start until a client connects).
// Shutdown is controller-initiated over SSH; forced stop kills the verified supervisor (Job Object kill-on-close). `validateQemuArgs` is an exact allow-list.
export const ACCELS = Object.freeze(['whpx', 'tcg'])

/**
 * @param {{name:string, ramMb:number, cpus:number, accel:'whpx'|'tcg', taskDisk:string, authDisk?:string|null, seedIso?:string|null, sshPort:number}} o
 */
export function buildQemuArgs(o) {
  if (!/^dh3-[a-z0-9-]{1,32}$/.test(o.name ?? '')) throw new Error('QEMU.BAD_NAME')
  if (!Number.isInteger(o.ramMb) || o.ramMb < 512 || o.ramMb > 8192 || o.ramMb % 256) throw new Error('QEMU.BAD_RAM')
  if (!Number.isInteger(o.cpus) || o.cpus < 1 || o.cpus > 6) throw new Error('QEMU.BAD_CPUS')
  if (!ACCELS.includes(o.accel)) throw new Error('QEMU.BAD_ACCEL')
  if (!Number.isInteger(o.sshPort) || o.sshPort < 1024 || o.sshPort > 65535) throw new Error('QEMU.BAD_PORT')
  const disk = (f, id) => { if (/[,\n]/.test(f) || !/\.qcow2$/i.test(f)) throw new Error('QEMU.BAD_DISK_PATH'); return ['-drive', `file=${f},if=none,id=${id},format=qcow2,cache=writeback,discard=unmap,detect-zeroes=unmap`, '-device', `virtio-blk-pci,drive=${id},serial=dh3${id}`] }
  if (o.seedIso && (/[,\n]/.test(o.seedIso) || !/\.iso$/i.test(o.seedIso))) throw new Error('QEMU.BAD_SEED_PATH')
  const args = [
    '-nodefaults', '-no-user-config',
    '-name', o.name,
    // QEMU 11: the accelerator is selected only with -accel (combining it with -machine accel= is rejected).
    '-machine', 'q35,usb=off,vmport=off,smm=off',
    '-accel', o.accel === 'tcg' ? 'tcg,thread=multi,tb-size=128' : 'whpx',
    '-cpu', o.accel === 'tcg' ? 'max' : 'qemu64,+sse4.1,+sse4.2,+popcnt,+ssse3',
    '-smp', `${o.cpus},sockets=1,cores=${o.cpus},threads=1`,
    '-m', `${o.ramMb}M`,
    '-overcommit', 'mem-lock=off',
    '-display', 'none', '-vga', 'none', '-monitor', 'none', '-serial', 'none', '-parallel', 'none',
    '-rtc', 'base=utc,clock=host',
    ...disk(o.taskDisk, 'task'),
    ...(o.authDisk ? disk(o.authDisk, 'auth') : []),
    ...(o.seedIso ? ['-drive', `file=${o.seedIso},if=none,id=seed,media=cdrom,readonly=on,format=raw`, '-device', 'ide-cd,drive=seed,bus=ide.0'] : []),
    '-netdev', `user,id=n0,restrict=on,ipv6=off,hostname=${o.name},hostfwd=tcp:127.0.0.1:${o.sshPort}-:22`,
    '-device', 'virtio-net-pci,netdev=n0,romfile=',
    '-device', 'virtio-rng-pci',
    '-device', 'virtio-balloon-pci,free-page-reporting=on',
  ]
  const problems = validateQemuArgs(args)
  if (problems.length) throw new Error(`QEMU.INVARIANT:${problems[0]}`)
  return args
}

// Exact allow-list: flag → validator of its value. Any flag not listed (e.g. -nic, -net, -object, -blockdev, -readconfig, -fw_cfg, -add-fd,
// -mem-path, -bios, -kernel, -virtfs, -incoming, -plugin, -gdb, -S) is refused. Every flag except the two booleans takes exactly one value.
const BOOL_FLAGS = new Set(['-nodefaults', '-no-user-config'])
const DEVICE_RE = /^(virtio-blk-pci,drive=(task|auth),serial=dh3(task|auth)|ide-cd,drive=seed,bus=ide\.0|virtio-net-pci,netdev=n0,romfile=|virtio-rng-pci|virtio-balloon-pci,free-page-reporting=on)$/
const VALUE_RULES = {
  '-name': (v) => /^dh3-[a-z0-9-]{1,32}$/.test(v),
  '-machine': (v) => v === 'q35,usb=off,vmport=off,smm=off',
  '-accel': (v) => v === 'whpx' || v === 'tcg,thread=multi,tb-size=128',
  '-cpu': (v) => v === 'max' || v === 'qemu64,+sse4.1,+sse4.2,+popcnt,+ssse3',
  '-smp': (v) => /^[1-6],sockets=1,cores=[1-6],threads=1$/.test(v),
  '-m': (v) => /^\d{3,4}M$/.test(v),
  '-overcommit': (v) => v === 'mem-lock=off',
  '-display': (v) => v === 'none', '-vga': (v) => v === 'none', '-monitor': (v) => v === 'none', '-serial': (v) => v === 'none', '-parallel': (v) => v === 'none',
  '-rtc': (v) => v === 'base=utc,clock=host',
  '-drive': (v) => /^file=[^,\n]+\.qcow2,if=none,id=(task|auth),format=qcow2,cache=writeback,discard=unmap,detect-zeroes=unmap$/i.test(v) || /^file=[^,\n]+\.iso,if=none,id=seed,media=cdrom,readonly=on,format=raw$/i.test(v),
  '-device': (v) => DEVICE_RE.test(v),
  '-netdev': (v) => /^user,id=n0,restrict=on,ipv6=off,hostname=dh3-[a-z0-9-]{1,32},hostfwd=tcp:127\.0\.0\.1:\d{4,5}-:22$/.test(v),
}

/** Returns problems (empty = acceptable). Every token must be an allow-listed flag followed by an allow-listed value. */
export function validateQemuArgs(args) {
  const p = []
  if (!args.includes('-nodefaults')) p.push('NODEFAULTS_MISSING')
  for (let i = 0; i < args.length; i += 1) {
    const f = args[i]
    if (BOOL_FLAGS.has(f)) continue
    if (!Object.hasOwn(VALUE_RULES, f)) { p.push(`FORBIDDEN_FLAG:${String(f).slice(0, 40)}`); continue }
    const v = args[i + 1]
    if (typeof v !== 'string' || !VALUE_RULES[f](v)) p.push(`FORBIDDEN_VALUE:${f}`)
    i += 1
  }
  if (args.filter((a) => a === '-netdev').length !== 1) p.push('NETDEV_COUNT')
  return [...new Set(p)]
}

/** Windows command-line quoting (CommandLineToArgvW rules) for the supervisor's CreateProcess call. */
export function quoteWindowsArg(a) {
  if (a === '') return '""'
  if (!/[\s"]/.test(a)) return a
  let out = '"'; let bs = 0
  for (const ch of a) {
    if (ch === '\\') { bs += 1; continue }
    if (ch === '"') { out += '\\'.repeat(bs * 2 + 1) + '"'; bs = 0; continue }
    out += '\\'.repeat(bs) + ch; bs = 0
  }
  return `${out}${'\\'.repeat(bs * 2)}"`
}
export const windowsCommandLine = (exe, args) => [exe, ...args].map(quoteWindowsArg).join(' ')
