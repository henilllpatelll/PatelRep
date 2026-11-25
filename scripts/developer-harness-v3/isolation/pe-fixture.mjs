// Developer Harness V3 (D3.3) — harmless Windows executable fixture for acceptance scenario 2 (Windows executable interop).
//
// A malformed "MZ + zeros" header proves little: no loader on any system would run it. This fixture is a WELL-FORMED 1 KiB PE32+ x64 console
// executable (DOS header, PE signature, COFF header, PE32+ optional header, one .text section) whose entry point is `xor eax,eax; ret`: on
// Windows it starts and exits with code 0 and does nothing else (no imports, no data, no relocations). Acceptance runs it on the HOST once as a
// positive control (Windows accepts it as an executable), then the unprivileged GUEST worker tries to execve it: without a Windows-interop
// handler (a WSL-style binfmt_misc `MZ` entry or similar) the Linux kernel must refuse it with ENOEXEC. Deterministic: the same bytes every time.
const SECTION_ALIGNMENT = 0x1000
const FILE_ALIGNMENT = 0x200
const CODE = Buffer.from([0x31, 0xc0, 0xc3]) // xor eax, eax ; ret

export function buildPeFixture() {
  const b = Buffer.alloc(0x400)
  b.write('MZ', 0, 'latin1'); b.writeUInt32LE(0x40, 0x3c) // IMAGE_DOS_HEADER: e_magic, e_lfanew → PE header at 0x40
  b.write('PE\0\0', 0x40, 'latin1')
  const coff = 0x44 // IMAGE_FILE_HEADER
  b.writeUInt16LE(0x8664, coff) // Machine: AMD64
  b.writeUInt16LE(1, coff + 2) // NumberOfSections
  b.writeUInt16LE(0xf0, coff + 16) // SizeOfOptionalHeader (PE32+)
  b.writeUInt16LE(0x0023, coff + 18) // RELOCS_STRIPPED | EXECUTABLE_IMAGE | LARGE_ADDRESS_AWARE
  const o = 0x58 // IMAGE_OPTIONAL_HEADER64
  b.writeUInt16LE(0x20b, o) // Magic: PE32+
  b.writeUInt32LE(FILE_ALIGNMENT, o + 4) // SizeOfCode
  b.writeUInt32LE(0x1000, o + 16) // AddressOfEntryPoint
  b.writeUInt32LE(0x1000, o + 20) // BaseOfCode
  b.writeBigUInt64LE(0x140000000n, o + 24) // ImageBase
  b.writeUInt32LE(SECTION_ALIGNMENT, o + 32); b.writeUInt32LE(FILE_ALIGNMENT, o + 36)
  b.writeUInt16LE(6, o + 40) // MajorOperatingSystemVersion
  b.writeUInt16LE(6, o + 48) // MajorSubsystemVersion
  b.writeUInt32LE(0x2000, o + 56) // SizeOfImage (headers page + .text page)
  b.writeUInt32LE(FILE_ALIGNMENT, o + 60) // SizeOfHeaders
  b.writeUInt16LE(3, o + 68) // Subsystem: WINDOWS_CUI
  b.writeUInt16LE(0x0100, o + 70) // DllCharacteristics: NX_COMPAT
  b.writeBigUInt64LE(0x100000n, o + 72); b.writeBigUInt64LE(0x1000n, o + 80) // stack reserve / commit
  b.writeBigUInt64LE(0x100000n, o + 88); b.writeBigUInt64LE(0x1000n, o + 96) // heap reserve / commit
  b.writeUInt32LE(16, o + 108) // NumberOfRvaAndSizes (all data directories empty)
  const s = o + 0xf0 // IMAGE_SECTION_HEADER .text
  b.write('.text', s, 'latin1')
  b.writeUInt32LE(CODE.length, s + 8) // VirtualSize
  b.writeUInt32LE(0x1000, s + 12) // VirtualAddress
  b.writeUInt32LE(FILE_ALIGNMENT, s + 16) // SizeOfRawData
  b.writeUInt32LE(FILE_ALIGNMENT, s + 20) // PointerToRawData
  b.writeUInt32LE(0x60000020, s + 36) // CNT_CODE | MEM_EXECUTE | MEM_READ
  CODE.copy(b, FILE_ALIGNMENT)
  return b
}

/** Structural validation against the PE/COFF format. Empty result = a well-formed PE32+ x64 console executable whose only code exits 0. */
export function validatePeFixture(b) {
  if (!Buffer.isBuffer(b) || b.length < 0x400) return ['PE.TOO_SHORT']
  const p = []
  if (b.toString('latin1', 0, 2) !== 'MZ') p.push('PE.NO_MZ')
  const lfanew = b.readUInt32LE(0x3c)
  if (lfanew + 4 + 20 + 0xf0 + 40 > b.length) return [...p, 'PE.BAD_LFANEW']
  if (b.toString('latin1', lfanew, lfanew + 4) !== 'PE\0\0') p.push('PE.NO_SIGNATURE')
  const coff = lfanew + 4; const o = coff + 20
  if (b.readUInt16LE(coff) !== 0x8664) p.push('PE.NOT_AMD64')
  if (b.readUInt16LE(coff + 2) !== 1) p.push('PE.SECTION_COUNT')
  if (b.readUInt16LE(coff + 16) !== 0xf0) p.push('PE.OPTIONAL_HEADER_SIZE')
  if ((b.readUInt16LE(coff + 18) & 0x0002) === 0) p.push('PE.NOT_EXECUTABLE_IMAGE')
  if (b.readUInt16LE(o) !== 0x20b) p.push('PE.NOT_PE32_PLUS')
  const entry = b.readUInt32LE(o + 16); const secAlign = b.readUInt32LE(o + 32); const fileAlign = b.readUInt32LE(o + 36)
  const sizeOfImage = b.readUInt32LE(o + 56); const sizeOfHeaders = b.readUInt32LE(o + 60)
  if (b.readUInt16LE(o + 68) !== 3) p.push('PE.NOT_CONSOLE_SUBSYSTEM')
  if (b.readUInt32LE(o + 108) !== 16) p.push('PE.DATA_DIRECTORY_COUNT')
  for (let i = 0; i < 16; i += 1) if (b.readUInt32LE(o + 112 + i * 8) !== 0 || b.readUInt32LE(o + 116 + i * 8) !== 0) p.push(`PE.DATA_DIRECTORY_NOT_EMPTY:${i}`)
  if (secAlign !== SECTION_ALIGNMENT || fileAlign !== FILE_ALIGNMENT || sizeOfHeaders % fileAlign || sizeOfImage % secAlign) p.push('PE.ALIGNMENT')
  const s = o + 0xf0
  const vsize = b.readUInt32LE(s + 8); const va = b.readUInt32LE(s + 12); const raw = b.readUInt32LE(s + 16); const ptr = b.readUInt32LE(s + 20)
  if (b.toString('latin1', s, s + 5) !== '.text') p.push('PE.SECTION_NAME')
  if (va % secAlign || va + Math.max(vsize, raw) > sizeOfImage || ptr + raw > b.length || ptr < sizeOfHeaders) p.push('PE.SECTION_BOUNDS')
  if ((b.readUInt32LE(s + 36) & 0x20000020) !== 0x20000020) p.push('PE.SECTION_NOT_EXECUTABLE_CODE')
  if (entry < va || entry >= va + vsize) p.push('PE.ENTRY_OUTSIDE_TEXT')
  else if (!b.subarray(ptr + (entry - va), ptr + vsize).equals(CODE)) p.push('PE.CODE_NOT_EXIT0')
  return p
}
