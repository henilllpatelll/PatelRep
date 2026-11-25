# Developer Harness V3 (D3.3) - QEMU supervisor. Runs QEMU inside a Windows Job Object owned by this process:
#   * JOB_OBJECT_LIMIT_PROCESS_MEMORY  : hard cap on QEMU's committed memory (guest RAM + overhead); exceeding it fails QEMU's allocation, not the host's
#   * JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: if this supervisor dies for any reason, Windows terminates QEMU (verified termination, no orphan VM)
#   * JOB_OBJECT_CPU_RATE_CONTROL (hard cap) : QEMU can never take more than the configured share of the host CPUs
#   * BelowNormal priority              : the owner's interactive applications win CPU contention
# No administrator rights needed. Writes a record (supervisor pid, qemu pid, start time) atomically, then waits for QEMU to exit.
param(
  [Parameter(Mandatory = $true)][string]$Qemu,
  [Parameter(Mandatory = $true)][string]$CommandLineFile,
  [Parameter(Mandatory = $true)][int]$MemoryLimitMB,
  [Parameter(Mandatory = $true)][int]$CpuRatePercent,
  [Parameter(Mandatory = $true)][string]$RecordFile,
  [Parameter(Mandatory = $true)][string]$Marker
)
$ErrorActionPreference = 'Stop'
if (-not ('Dh3Job' -as [type])) {
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class Dh3Job {
  [StructLayout(LayoutKind.Sequential)] public struct BASIC { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] public struct EXT { public BASIC Basic; public IO Io; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
  [StructLayout(LayoutKind.Sequential)] public struct CPU { public uint ControlFlags; public uint CpuRate; }
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, uint l);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr j, int c, IntPtr i, uint l, IntPtr r);
  // Read the CPU rate control back from Windows (acceptance scenario 9 checks the OS-reported cap, not only the requested one).
  public static uint[] QueryCpu(IntPtr job) {
    int m = Marshal.SizeOf(typeof(CPU)); IntPtr q = Marshal.AllocHGlobal(m);
    if (!QueryInformationJobObject(job, 15, q, (uint)m, IntPtr.Zero)) throw new Exception("QueryInformationJobObject(cpu) " + Marshal.GetLastWin32Error());
    CPU c = (CPU)Marshal.PtrToStructure(q, typeof(CPU)); return new uint[] { c.ControlFlags, c.CpuRate };
  }
  public static IntPtr Create(ulong memBytes, uint cpuRate) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null); if (job == IntPtr.Zero) throw new Exception("CreateJobObject " + Marshal.GetLastWin32Error());
    EXT e = new EXT(); e.Basic.LimitFlags = 0x2000 | 0x100 | 0x400 | 0x8; e.Basic.ActiveProcessLimit = 1; e.ProcessMemoryLimit = new UIntPtr(memBytes);  // KILL_ON_JOB_CLOSE | PROCESS_MEMORY | DIE_ON_UNHANDLED_EXCEPTION | ACTIVE_PROCESS (=1: QEMU can never spawn a child)
    int n = Marshal.SizeOf(typeof(EXT)); IntPtr p = Marshal.AllocHGlobal(n); Marshal.StructureToPtr(e, p, false);
    if (!SetInformationJobObject(job, 9, p, (uint)n)) throw new Exception("SetInformationJobObject(ext) " + Marshal.GetLastWin32Error());
    CPU c = new CPU(); c.ControlFlags = 0x1 | 0x4; c.CpuRate = cpuRate * 100;  // ENABLE | HARD_CAP ; rate in 1/100 percent
    int m = Marshal.SizeOf(typeof(CPU)); IntPtr q = Marshal.AllocHGlobal(m); Marshal.StructureToPtr(c, q, false);
    if (!SetInformationJobObject(job, 15, q, (uint)m)) throw new Exception("SetInformationJobObject(cpu) " + Marshal.GetLastWin32Error());
    // JobObjectBasicUIRestrictions (4) = JOB_OBJECT_UILIMIT_ALL (0xFF): no clipboard read/write, global atoms, desktop switching, display or system
    // settings, ExitWindows, or USER handles of processes outside the job.
    IntPtr u = Marshal.AllocHGlobal(4); Marshal.WriteInt32(u, 0xFF);
    if (!SetInformationJobObject(job, 4, u, 4)) throw new Exception("SetInformationJobObject(ui) " + Marshal.GetLastWin32Error());
    return job;
  }
}
'@
}
if ($CpuRatePercent -lt 5 -or $CpuRatePercent -gt 80) { throw 'SUPERVISOR.BAD_CPU_RATE' }
if ($MemoryLimitMB -lt 768 -or $MemoryLimitMB -gt 9216) { throw 'SUPERVISOR.BAD_MEMORY_LIMIT' }
$cmdline = [IO.File]::ReadAllText($CommandLineFile)
$job = [Dh3Job]::Create([uint64]$MemoryLimitMB * 1MB, [uint32]$CpuRatePercent)
$cpuq = [Dh3Job]::QueryCpu($job)
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = $Qemu; $psi.Arguments = $cmdline; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $false; $psi.RedirectStandardError = $false
$psi.EnvironmentVariables.Clear()
foreach ($k in 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'TEMP', 'TMP') { $v = [Environment]::GetEnvironmentVariable($k); if ($v) { $psi.EnvironmentVariables[$k] = $v } }
$psi.EnvironmentVariables['PATH'] = (Split-Path -Parent $Qemu) + ';' + $env:SYSTEMROOT + '\System32'
$proc = [Diagnostics.Process]::Start($psi)
if (-not [Dh3Job]::AssignProcessToJobObject($job, $proc.Handle)) { $proc.Kill(); throw 'SUPERVISOR.ASSIGN_FAILED' }
$proc.PriorityClass = [Diagnostics.ProcessPriorityClass]::BelowNormal
$rec = @{ schema = 'patelrep.developer-harness-v3.vm-supervisor'; marker = $Marker; supervisor_pid = $PID; qemu_pid = $proc.Id; qemu_start = $proc.StartTime.ToUniversalTime().ToString('o'); memory_limit_mb = $MemoryLimitMB; cpu_rate_percent = $CpuRatePercent; job_cpu_control_flags = [int]$cpuq[0]; job_cpu_rate = [int]$cpuq[1]; state = 'running' }
$tmp = "$RecordFile.$PID.tmp"; [IO.File]::WriteAllText($tmp, ($rec | ConvertTo-Json -Compress)); Move-Item -LiteralPath $tmp -Destination $RecordFile -Force
$proc.WaitForExit()
$rec.state = 'exited'; $rec.exit_code = $proc.ExitCode; $rec.exited_at = (Get-Date).ToUniversalTime().ToString('o')
$tmp = "$RecordFile.$PID.tmp"; [IO.File]::WriteAllText($tmp, ($rec | ConvertTo-Json -Compress)); Move-Item -LiteralPath $tmp -Destination $RecordFile -Force
