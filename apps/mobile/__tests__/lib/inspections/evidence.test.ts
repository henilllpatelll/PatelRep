import en from "@/i18n/locales/en.json";
import es from "@/i18n/locales/es.json";
import {
  ENCODE_LADDER,
  MAX_EVIDENCE_BYTES,
  captureEvidence,
  deleteEvidence,
  deleteRoomEvidence,
  evidenceDirFor,
  evidenceFileName,
  findMissingEvidence,
  isOwnedEvidenceUri,
  pruneEvidence,
  sweepEvidence,
  type CaptureFailure,
  type EvidenceDeps,
  type EvidenceFs,
  type EvidenceScope,
  type PickedAsset,
  type PickerResult,
} from "@/lib/inspections/evidence";

const scope: EvidenceScope = { hotelId: "hotel-1", userId: "sup-1", roomId: "room-205" };
const DOCS = "file:///data/documents";

/** An in-memory phone: file name → byte size. Folders are implied by paths. */
function fakeFs(initial: Record<string, number> = {}) {
  const files = new Map<string, number>(Object.entries(initial));
  const removed: string[] = [];
  const fs: EvidenceFs = {
    exists: async (uri) => files.has(uri),
    size: async (uri) => files.get(uri) ?? 0,
    remove: async (uri) => {
      removed.push(uri);
      for (const key of [...files.keys()]) if (key === uri || key.startsWith(`${uri}/`)) files.delete(key);
    },
    importFile: async (source, dir, name) => {
      const bytes = files.get(source);
      if (bytes === undefined) throw new Error("source missing");
      const target = `${DOCS}/${dir.join("/")}/${name}`;
      files.set(target, bytes);
      return target;
    },
    listFiles: async (dir) => [...files.keys()].filter((key) => key.startsWith(`${DOCS}/${dir.join("/")}/`) && !key.slice(`${DOCS}/${dir.join("/")}/`.length).includes("/")),
    listDirs: async (dir) => {
      const base = `${DOCS}/${dir.join("/")}/`;
      return [...new Set([...files.keys()].filter((key) => key.startsWith(base)).map((key) => key.slice(base.length).split("/")[0]))];
    },
    dirUri: async (dir) => `${DOCS}/${dir.join("/")}`,
  };
  return { fs, files, removed };
}

function deps(overrides: Partial<EvidenceDeps> & { fs?: EvidenceFs; picked?: PickerResult; encodedBytes?: number[] } = {}) {
  const { fs, files } = fakeFs({ "file:///cache/picked.heic": 9_000_000 });
  const store = overrides.fs ? undefined : files;
  const temps: string[] = [];
  const encodedBytes = overrides.encodedBytes ?? [400_000];
  let rung = 0;
  const base: EvidenceDeps = {
    requestCamera: async () => ({ granted: true, canAskAgain: true }),
    launchCamera: async () => overrides.picked ?? picked(),
    launchLibrary: async () => overrides.picked ?? picked(),
    encode: async () => {
      const bytes = encodedBytes[Math.min(rung, encodedBytes.length - 1)];
      const uri = `file:///cache/encoded-${rung}.jpg`;
      rung += 1;
      store?.set(uri, bytes);
      return { uri, width: 1600, height: 1200 };
    },
    discardTemp: async (uri) => {
      temps.push(uri);
    },
    fs: overrides.fs ?? fs,
    token: () => "tok123",
  };
  return { deps: { ...base, ...overrides, fs: overrides.fs ?? fs } as EvidenceDeps, files, temps };
}

const picked = (asset: Partial<PickedAsset> = {}): PickerResult => ({ canceled: false, assets: [{ uri: "file:///cache/picked.heic", mimeType: "image/heic", fileSize: 9_000_000, width: 4032, height: 3024, ...asset }] });

describe("where evidence lives", () => {
  it("is a per hotel / person / room folder, named without guest or room details", () => {
    expect(evidenceDirFor(scope)).toEqual(["inspection-evidence", "hotel-1", "sup-1", "room-205"]);
    expect(evidenceFileName("item-1", "tok")).toBe("item-1-tok.jpg");
  });

  it("refuses ids that could climb out of the folder", () => {
    expect(evidenceDirFor({ ...scope, roomId: "../other" })).toBeNull();
    expect(evidenceDirFor({ ...scope, hotelId: "a/b" })).toBeNull();
    expect(evidenceFileName("../x", "tok")).toBeNull();
    expect(evidenceFileName("item", "to k")).toBeNull();
  });

  it("owns only a .jpg directly inside this exact scope's folder", () => {
    const good = `${DOCS}/inspection-evidence/hotel-1/sup-1/room-205/item-1-tok.jpg`;
    expect(isOwnedEvidenceUri(good, scope)).toBe(true);
    expect(isOwnedEvidenceUri(good, { ...scope, roomId: "room-305" })).toBe(false);
    expect(isOwnedEvidenceUri(good, { ...scope, userId: "sup-2" })).toBe(false);
    expect(isOwnedEvidenceUri(good, { ...scope, hotelId: "hotel-2" })).toBe(false);
    expect(isOwnedEvidenceUri(`${DOCS}/inspection-evidence/hotel-1/sup-1/room-205/sub/item.jpg`, scope)).toBe(false);
    expect(isOwnedEvidenceUri(`${DOCS}/inspection-evidence/hotel-1/sup-1/room-205/../room-305/x.jpg`, scope)).toBe(false);
    expect(isOwnedEvidenceUri(`${DOCS}/inspection-evidence/hotel-1/sup-1/room-205/%2e%2e/x.jpg`, scope)).toBe(false);
    expect(isOwnedEvidenceUri(`${DOCS}/inspection-evidence/hotel-1/sup-1/room-205/x.png`, scope)).toBe(false);
    expect(isOwnedEvidenceUri("file:///cache/ImagePicker/x.jpg", scope)).toBe(false);
    expect(isOwnedEvidenceUri("https://example.com/inspection-evidence/hotel-1/sup-1/room-205/x.jpg", scope)).toBe(false);
    expect(isOwnedEvidenceUri(null, scope)).toBe(false);
  });
});

describe("taking or choosing a photo", () => {
  it("keeps a JPEG copy in the app's own folder, re-encoded, and reports the real size", async () => {
    const { deps: d, files, temps } = deps();
    const result = await captureEvidence("camera", scope, "item-1", d);
    expect(result).toEqual({ ok: true, photo: { uri: `${DOCS}/inspection-evidence/hotel-1/sup-1/room-205/item-1-tok123.jpg`, bytes: 400_000, width: 1600, height: 1200 } });
    expect(files.has(`${DOCS}/inspection-evidence/hotel-1/sup-1/room-205/item-1-tok123.jpg`)).toBe(true);
    // the picker's HEIC original and the encoder's temporary file are both tidied
    expect(temps).toEqual(expect.arrayContaining(["file:///cache/picked.heic", "file:///cache/encoded-0.jpg"]));
  });

  it("works from the library without asking for camera permission", async () => {
    const requestCamera = jest.fn(async () => ({ granted: false, canAskAgain: false }));
    const { deps: d } = deps({ requestCamera });
    expect((await captureEvidence("library", scope, "item-1", d)).ok).toBe(true);
    expect(requestCamera).not.toHaveBeenCalled();
  });

  it("explains a refused camera permission, and tells a retryable refusal from a permanent one", async () => {
    const denied = deps({ requestCamera: async () => ({ granted: false, canAskAgain: true }) });
    expect(await captureEvidence("camera", scope, "item-1", denied.deps)).toEqual({ ok: false, reason: "permission_denied" });
    const blocked = deps({ requestCamera: async () => ({ granted: false, canAskAgain: false }) });
    expect(await captureEvidence("camera", scope, "item-1", blocked.deps)).toEqual({ ok: false, reason: "permission_blocked" });
  });

  it("treats backing out as cancellation, not an error", async () => {
    const { deps: d } = deps({ picked: { canceled: true, assets: null } });
    expect(await captureEvidence("camera", scope, "item-1", d)).toEqual({ ok: false, reason: "cancelled" });
    const empty = deps({ picked: { canceled: false, assets: [] } });
    expect(await captureEvidence("library", scope, "item-1", empty.deps)).toEqual({ ok: false, reason: "cancelled" });
  });

  it("reports missing camera hardware and a failing picker distinctly", async () => {
    const camera = deps({ launchCamera: async () => { throw new Error("no camera"); } });
    expect(await captureEvidence("camera", scope, "item-1", camera.deps)).toEqual({ ok: false, reason: "camera_unavailable" });
    const library = deps({ launchLibrary: async () => { throw new Error("denied"); } });
    expect(await captureEvidence("library", scope, "item-1", library.deps)).toEqual({ ok: false, reason: "picker_failed" });
    const perm = deps({ requestCamera: async () => { throw new Error("boom"); } });
    expect(await captureEvidence("camera", scope, "item-1", perm.deps)).toEqual({ ok: false, reason: "camera_unavailable" });
  });

  it("rejects files that are not photos before touching them, and still tidies the picker's copy", async () => {
    const { deps: d, temps } = deps({ picked: picked({ mimeType: "application/pdf", uri: "file:///cache/x.pdf" }) });
    expect(await captureEvidence("library", scope, "item-1", d)).toEqual({ ok: false, reason: "unsupported" });
    expect(temps).toContain("file:///cache/x.pdf");
  });

  it.each(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"])("accepts %s and always stores a JPEG", async (mimeType) => {
    const { deps: d } = deps({ picked: picked({ mimeType }) });
    const result = await captureEvidence("library", scope, "item-1", d);
    expect(result.ok && result.photo.uri.endsWith(".jpg")).toBe(true);
  });

  it("refuses an absurdly large original without starting work", async () => {
    const encode = jest.fn();
    const { deps: d } = deps({ picked: picked({ fileSize: 31 * 1024 * 1024 }), encode });
    expect(await captureEvidence("library", scope, "item-1", d)).toEqual({ ok: false, reason: "too_large" });
    expect(encode).not.toHaveBeenCalled();
  });

  it("retries smaller until the photo fits the server's limit", async () => {
    const { deps: d, files } = deps({ encodedBytes: [MAX_EVIDENCE_BYTES + 1, MAX_EVIDENCE_BYTES + 1, 900_000] });
    const result = await captureEvidence("library", scope, "item-1", d);
    expect(result.ok && result.photo.bytes).toBe(900_000);
    expect(ENCODE_LADDER.length).toBe(3);
    expect([...files.keys()].filter((key) => key.includes("inspection-evidence"))).toHaveLength(1);
  });

  it("gives up with too_large (and keeps nothing) when even the smallest encode is over the limit", async () => {
    const { deps: d, files } = deps({ encodedBytes: [MAX_EVIDENCE_BYTES * 2] });
    expect(await captureEvidence("library", scope, "item-1", d)).toEqual({ ok: false, reason: "too_large" });
    expect([...files.keys()].some((key) => key.includes("inspection-evidence"))).toBe(false);
  });

  it("a failed conversion or an empty result is a conversion failure", async () => {
    const throws = deps({ encode: async () => { throw new Error("bad"); } });
    expect(await captureEvidence("library", scope, "item-1", throws.deps)).toEqual({ ok: false, reason: "convert_failed" });
    const empty = deps({ encodedBytes: [0] });
    expect(await captureEvidence("library", scope, "item-1", empty.deps)).toEqual({ ok: false, reason: "convert_failed" });
  });

  it("a write failure (disk full) is reported, and nothing half-written is left behind", async () => {
    const { fs, files, removed } = fakeFs({ "file:///cache/picked.heic": 1, "file:///cache/encoded-0.jpg": 400_000 });
    const failing: EvidenceFs = { ...fs, importFile: async () => { throw new Error("ENOSPC"); } };
    const { deps: d } = deps({ fs: failing });
    expect(await captureEvidence("library", scope, "item-1", d)).toEqual({ ok: false, reason: "save_failed" });
    expect([...files.keys()].some((key) => key.includes("inspection-evidence"))).toBe(false);
    expect(removed).toEqual([]);
  });

  it("a copy that does not read back as a usable size is removed and reported", async () => {
    const { fs, files } = fakeFs({ "file:///cache/encoded-0.jpg": 400_000 });
    const lying: EvidenceFs = { ...fs, importFile: async (source, dir, name) => { const target = await fs.importFile(source, dir, name); files.set(target, 0); return target; } };
    const { deps: d } = deps({ fs: lying });
    expect(await captureEvidence("library", scope, "item-1", d)).toEqual({ ok: false, reason: "save_failed" });
    expect([...files.keys()].some((key) => key.includes("inspection-evidence"))).toBe(false);
  });

  it("refuses to write for unsafe ids", async () => {
    const { deps: d } = deps();
    expect(await captureEvidence("library", { ...scope, roomId: "../x" }, "item-1", d)).toEqual({ ok: false, reason: "save_failed" });
    expect(await captureEvidence("library", scope, "../item", d)).toEqual({ ok: false, reason: "save_failed" });
  });

  it("every failure has a plain message in both languages", () => {
    const reasons: CaptureFailure[] = ["permission_denied", "permission_blocked", "camera_unavailable", "picker_failed", "unsupported", "too_large", "convert_failed", "save_failed"];
    const messages = (tree: unknown) => (tree as { inspect: { workspace: { photo: { error: Record<string, string> } } } }).inspect.workspace.photo.error;
    for (const reason of reasons) {
      expect(messages(en)[reason]).toBeTruthy();
      expect(messages(es)[reason]).toBeTruthy();
      expect(messages(es)[reason]).not.toBe(messages(en)[reason]);
    }
  });
});

describe("keeping, checking and cleaning up", () => {
  const mine = (name: string, room = "room-205") => `${DOCS}/inspection-evidence/hotel-1/sup-1/${room}/${name}.jpg`;

  it("deletes only files that are this scope's own", async () => {
    const { fs, files } = fakeFs({ [mine("a")]: 10, [mine("b", "room-305")]: 10, "file:///cache/library.jpg": 10 });
    expect(await deleteEvidence(mine("a"), scope, fs)).toBe(true);
    expect(await deleteEvidence(mine("b", "room-305"), scope, fs)).toBe(false);
    expect(await deleteEvidence("file:///cache/library.jpg", scope, fs)).toBe(false);
    expect(await deleteEvidence(null, scope, fs)).toBe(false);
    expect([...files.keys()].sort()).toEqual(["file:///cache/library.jpg", mine("b", "room-305")].sort());
  });

  it("discarding an inspection removes that room's folder and nothing else", async () => {
    const { fs, files } = fakeFs({ [mine("a")]: 10, [mine("b")]: 10, [mine("c", "room-305")]: 10 });
    expect(await deleteRoomEvidence(scope, fs)).toBe(true);
    expect([...files.keys()]).toEqual([mine("c", "room-305")]);
    expect(await deleteRoomEvidence({ ...scope, roomId: "../x" }, fs)).toBe(false);
  });

  it("a photo that is present, non-empty and within the limit is usable; every other case reads as no photo", async () => {
    const { fs } = fakeFs({ [mine("ok")]: 1000, [mine("empty")]: 0, [mine("huge")]: MAX_EVIDENCE_BYTES + 1, "file:///cache/foreign.jpg": 1000, [mine("other", "room-305")]: 1000 });
    const missing = await findMissingEvidence(
      { ok: mine("ok"), gone: mine("gone"), empty: mine("empty"), huge: mine("huge"), foreign: "file:///cache/foreign.jpg", otherRoom: mine("other", "room-305") },
      scope,
      fs,
    );
    expect(missing.sort()).toEqual(["empty", "foreign", "gone", "huge", "otherRoom"]);
  });

  it("a file system that throws is treated as missing, never as present", async () => {
    const { fs } = fakeFs();
    const broken: EvidenceFs = { ...fs, exists: async () => { throw new Error("io"); } };
    expect(await findMissingEvidence({ a: mine("a") }, scope, broken)).toEqual(["a"]);
  });

  it("prunes files the draft no longer refers to (a replaced or abandoned photo) and keeps the rest", async () => {
    const { fs, files } = fakeFs({ [mine("keep")]: 10, [mine("orphan")]: 10, [mine("other", "room-305")]: 10 });
    expect(await pruneEvidence(scope, [mine("keep")], fs)).toBe(1);
    expect([...files.keys()].sort()).toEqual([mine("keep"), mine("other", "room-305")].sort());
  });

  it("sweeps the folders of rooms with no draft, only for this person", async () => {
    const other = `${DOCS}/inspection-evidence/hotel-1/sup-2/room-1/x.jpg`;
    const { fs, files } = fakeFs({ [mine("a")]: 10, [mine("b", "room-305")]: 10, [other]: 10 });
    expect(await sweepEvidence("hotel-1", "sup-1", new Set(["room-205"]), fs)).toBe(1);
    expect([...files.keys()].sort()).toEqual([mine("a"), other].sort());
    expect(await sweepEvidence("../x", "sup-1", new Set(), fs)).toBe(0);
  });
});
