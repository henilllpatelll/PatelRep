# Developer Harness V3 (D3.3) - build the cloud-init NoCloud seed ISO (volume label "cidata") with the built-in Windows IMAPI2 COM API.
# No administrator rights, no third-party tool. Input: a directory containing exactly user-data and meta-data. Output: an ISO9660+Joliet image.
param([Parameter(Mandatory = $true)][string]$SourceDir, [Parameter(Mandatory = $true)][string]$OutFile)
$ErrorActionPreference = 'Stop'
$names = @(Get-ChildItem -LiteralPath $SourceDir -File | ForEach-Object Name | Sort-Object)
if (($names -join ',') -ne 'meta-data,user-data') { throw "SEED.UNEXPECTED_FILES: $($names -join ',')" }
$fsi = New-Object -ComObject IMAPI2FS.MsftFileSystemImage
$fsi.FileSystemsToCreate = 3   # ISO9660 + Joliet (Joliet keeps the lowercase hyphenated names cloud-init expects)
$fsi.VolumeName = 'cidata'
$fsi.Root.AddTree($SourceDir, $false)
$img = $fsi.CreateResultImage()
$stream = $img.ImageStream
if (-not ('Dh3IsoWriter' -as [type])) {
  Add-Type -TypeDefinition @'
using System; using System.IO; using System.Runtime.InteropServices; using System.Runtime.InteropServices.ComTypes;
public static class Dh3IsoWriter {
  public static void Write(object comStream, string path) {
    IStream s = (IStream)comStream; byte[] buf = new byte[65536]; IntPtr read = Marshal.AllocHGlobal(8);
    try { using (FileStream f = new FileStream(path, FileMode.CreateNew, FileAccess.Write)) {
      while (true) { s.Read(buf, buf.Length, read); int n = Marshal.ReadInt32(read); if (n <= 0) break; f.Write(buf, 0, n); } } }
    finally { Marshal.FreeHGlobal(read); }
  }
}
'@
}
if (Test-Path -LiteralPath $OutFile) { Remove-Item -LiteralPath $OutFile -Force }
[Dh3IsoWriter]::Write($stream, $OutFile)
"SEED_ISO_OK $((Get-Item -LiteralPath $OutFile).Length)"
