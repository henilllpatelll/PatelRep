import {
  LOCAL_ID_PREFIX,
  MAX_PM_LOCAL_BYTES,
  MAX_PM_PHOTO_BYTES,
  isLocalEvidenceId,
  isOwnLocalPhoto,
  isStorageFull,
  localPhotoReadable,
  newPhotoToken,
  persistPmPhoto,
  removeLocalPhoto,
  sweepOrphanPhotos,
  type LocalPhotoDeps,
  type LocalPhotoFs,
} from "@/lib/engineering/pmLocalEvidence";

/** An in-memory phone: files keyed by address, with the same folder layout the real one uses. */
function memoryFs(opts: { failCopyWith?: Error } = {}) {
  const files = new Map<string, number>();
  const base = "file:///docs/";
  const fs: LocalPhotoFs = {
    exists: async (u) => files.has(u),
    size: async (u) => files.get(u) ?? 0,
    remove: async (u) => void files.delete(u),
    importFile: async (source, dir, name) => {
      if (opts.failCopyWith) throw opts.failCopyWith;
      const target = `${base}${dir.join("/")}/${name}`;
      files.set(target, files.get(source) ?? 0);
      return target;
    },
    listFiles: async (dir) => [...files.keys()].filter((k) => k.startsWith(`${base}${dir.join("/")}/`)),
    dirUri: async (dir) => `${base}${dir.join("/")}/`,
  };
  return { files, fs };
}

function setup(owner: string | null = "t1:u1", opts: Parameters<typeof memoryFs>[0] = {}, clock = { now: Date.parse("2026-03-01T00:00:00Z") }) {
  const mem = memoryFs(opts);
  let n = 0;
  const deps: LocalPhotoDeps = { fs: mem.fs, owner: () => owner, now: () => clock.now, token: () => newPhotoToken(clock.now - 1000, () => ++n / 100) };
  return { ...mem, deps, clock };
}

describe("durable PM photos", () => {
  it("copies a picked photo into the person's own folder and reports a local id", async () => {
    const { files, deps } = setup();
    files.set("file:///cache/pick.jpg", 2000);
    const res = await persistPmPhoto("file:///cache/pick.jpg", deps);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.photo.id.startsWith(LOCAL_ID_PREFIX)).toBe(true);
    expect(res.photo.uri).toContain("/pm-evidence/t1_u1/");
    expect(res.photo.bytes).toBe(2000);
    expect(await localPhotoReadable(res.photo.uri, deps)).toBe(true);
    expect(isLocalEvidenceId(res.photo.id)).toBe(true);
    expect(isLocalEvidenceId("ev-1")).toBe(false);
  });

  it("refuses without an owner, a missing source, or an oversized photo - and saves nothing", async () => {
    const none = setup(null);
    none.files.set("file:///cache/a.jpg", 10);
    expect(await persistPmPhoto("file:///cache/a.jpg", none.deps)).toEqual({ ok: false, reason: "no_owner" });
    const s = setup();
    expect(await persistPmPhoto("file:///cache/gone.jpg", s.deps)).toEqual({ ok: false, reason: "missing_source" });
    s.files.set("file:///cache/big.jpg", MAX_PM_PHOTO_BYTES + 1);
    expect(await persistPmPhoto("file:///cache/big.jpg", s.deps)).toEqual({ ok: false, reason: "too_large" });
    expect([...s.files.keys()].some((k) => k.includes("pm-evidence"))).toBe(false);
  });

  it("tells a full phone apart from a generic failure, and never reports a failed copy as saved", async () => {
    const full = setup("t1:u1", { failCopyWith: Object.assign(new Error("No space left on device"), { code: "ENOSPC" }) });
    full.files.set("file:///cache/a.jpg", 10);
    expect(await persistPmPhoto("file:///cache/a.jpg", full.deps)).toEqual({ ok: false, reason: "storage_full" });
    const broken = setup("t1:u1", { failCopyWith: new Error("boom") });
    broken.files.set("file:///cache/a.jpg", 10);
    expect(await persistPmPhoto("file:///cache/a.jpg", broken.deps)).toEqual({ ok: false, reason: "save_failed" });
    expect(isStorageFull(new Error("disk is full"))).toBe(true);
    expect(isStorageFull(new Error("network"))).toBe(false);
  });

  it("stops at the per-person quota instead of filling the phone", async () => {
    const s = setup();
    s.files.set("file:///docs/pm-evidence/t1_u1/old.jpg", MAX_PM_LOCAL_BYTES - 100);
    s.files.set("file:///cache/new.jpg", 500);
    expect(await persistPmPhoto("file:///cache/new.jpg", s.deps)).toEqual({ ok: false, reason: "quota" });
  });

  it("discards a copy that does not read back", async () => {
    const s = setup();
    s.files.set("file:///cache/zero.jpg", 5);
    const real = s.deps.fs.importFile;
    s.deps.fs.importFile = async (src, dir, name) => {
      const uri = await real(src, dir, name);
      s.files.set(uri, 0);
      return uri;
    };
    expect(await persistPmPhoto("file:///cache/zero.jpg", s.deps)).toEqual({ ok: false, reason: "save_failed" });
    expect([...s.files.keys()].filter((k) => k.includes("pm-evidence"))).toEqual([]);
  });

  it("only ever deletes inside the signed-in person's own folder", async () => {
    const s = setup();
    s.files.set("file:///docs/pm-evidence/t1_u1/a.jpg", 5);
    s.files.set("file:///docs/pm-evidence/t1_u2/b.jpg", 5);
    s.files.set("file:///photos/library.jpg", 5);
    expect(await isOwnLocalPhoto("file:///docs/pm-evidence/t1_u2/b.jpg", s.deps)).toBe(false);
    expect(await removeLocalPhoto("file:///docs/pm-evidence/t1_u2/b.jpg", s.deps)).toBe(false);
    expect(await removeLocalPhoto("file:///photos/library.jpg", s.deps)).toBe(false);
    expect(await removeLocalPhoto("file:///docs/pm-evidence/t1_u1/../t1_u2/b.jpg", s.deps)).toBe(false);
    expect(await removeLocalPhoto("file:///docs/pm-evidence/t1_u1/a.jpg", s.deps)).toBe(true);
    expect(s.files.has("file:///docs/pm-evidence/t1_u2/b.jpg")).toBe(true);
  });

  it("sweeps only old, unreferenced files", async () => {
    const s = setup();
    const old = newPhotoToken(s.clock.now - 3 * 86_400_000, () => 0.1);
    const fresh = newPhotoToken(s.clock.now - 60_000, () => 0.2);
    const kept = newPhotoToken(s.clock.now - 5 * 86_400_000, () => 0.3);
    for (const t of [old, fresh, kept]) s.files.set(`file:///docs/pm-evidence/t1_u1/${t}.jpg`, 9);
    const removed = await sweepOrphanPhotos(new Set([`file:///docs/pm-evidence/t1_u1/${kept}.jpg`]), s.deps);
    expect(removed).toBe(1);
    expect(s.files.has(`file:///docs/pm-evidence/t1_u1/${old}.jpg`)).toBe(false);
    expect(s.files.has(`file:///docs/pm-evidence/t1_u1/${fresh}.jpg`)).toBe(true);
    expect(s.files.has(`file:///docs/pm-evidence/t1_u1/${kept}.jpg`)).toBe(true);
  });
});
