import { act, renderHook } from "@testing-library/react-native";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/lib/api/assets", () => ({ createAsset: jest.fn(), updateAsset: jest.fn(), getAsset: jest.fn(), removeAssetPhoto: jest.fn() }));
jest.mock("@/lib/api/assetPhoto", () => ({ uploadAssetPhoto: jest.fn() }));
jest.mock("@/lib/housekeeping/photo", () => ({ prepareForUpload: jest.fn(async (uri: string) => `${uri}#small`) }));

import { createAsset, getAsset, removeAssetPhoto, updateAsset } from "@/lib/api/assets";
import { uploadAssetPhoto } from "@/lib/api/assetPhoto";
import { formFromAsset } from "@/lib/engineering/assetForm";
import { takeAssetListStale } from "@/lib/engineering/useAssetBrowse";
import { useAssetEditor } from "@/lib/engineering/useAssetEditor";
import { resetAsyncResourceCache } from "@/lib/engineering/useAsyncResource";
import type { AssetDetail } from "@/lib/api/assets";

const m = { create: createAsset as jest.Mock, update: updateAsset as jest.Mock, get: getAsset as jest.Mock, upload: uploadAssetPhoto as jest.Mock, remove: removeAssetPhoto as jest.Mock };
const CAT = "11111111-1111-4111-8111-111111111111";
const CATEGORIES = [{ id: CAT, name: "HVAC", code: "hvac" }];
const apiError = (status: number, code?: string, detail?: unknown) => Object.assign(new Error(`HTTP ${status}`), { status, code, detail });
const ASSET: AssetDetail = { id: "a1", name: "Chiller", category_id: CAT, asset_tag: "CH-1", row_version: 3, asset_categories: { name: "HVAC", code: "hvac" }, rooms: null };

beforeEach(() => {
  jest.clearAllMocks();
  resetAsyncResourceCache();
  takeAssetListStale();
});

const register = (onSaved = jest.fn()) =>
  renderHook(() => useAssetEditor({ mode: "create", scope: "h1:u1", categories: CATEGORIES, onSaved }));
const edit = (original: AssetDetail = ASSET, onSaved = jest.fn()) =>
  renderHook(() => useAssetEditor({ mode: "edit", scope: "h1:u1", original, categories: CATEGORIES, onSaved }));

function fill(hook: ReturnType<typeof register>, over: Record<string, unknown> = {}) {
  act(() => hook.result.current.update({ name: "Pool pump", categoryId: CAT, categoryName: "HVAC", assetTag: "PP-1", ...over }));
}

describe("registering equipment", () => {
  it("validates before sending anything, and shows the errors only after a first attempt", async () => {
    const hook = register();
    expect(hook.result.current.showErrors).toBe(false);
    await act(async () => hook.result.current.submit());
    expect(m.create).not.toHaveBeenCalled();
    expect(hook.result.current.errors).toEqual({ name: "name_required", categoryId: "category_required" });
    expect(hook.result.current.showErrors).toBe(true);
  });

  it("registers once, tells the caller only after the server confirmed, and marks the list stale", async () => {
    m.create.mockResolvedValue({ ...ASSET, id: "new1" });
    const onSaved = jest.fn();
    const hook = register(onSaved);
    fill(hook);
    expect(hook.result.current.dirty).toBe(true);
    await act(async () => hook.result.current.submit());
    expect(m.create).toHaveBeenCalledTimes(1);
    expect(m.create.mock.calls[0][0]).toMatchObject({ name: "Pool pump", category_id: CAT, asset_tag: "PP-1" });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "new1" }));
    expect(takeAssetListStale()).toBe(true);
  });

  it("an unconfirmed attempt can be repeated safely: the SAME record id is sent again", async () => {
    m.create.mockRejectedValueOnce(new Error("Request timed out")).mockResolvedValueOnce({ ...ASSET, id: "new1" });
    const onSaved = jest.fn();
    const hook = register(onSaved);
    fill(hook);
    await act(async () => hook.result.current.submit());
    expect(hook.result.current.failure).toEqual({ kind: "unconfirmed" });
    expect(onSaved).not.toHaveBeenCalled();
    expect(hook.result.current.values.name).toBe("Pool pump"); // the entries survive
    await act(async () => hook.result.current.submit());
    expect(m.create).toHaveBeenCalledTimes(2);
    expect(m.create.mock.calls[1][0].id).toBe(m.create.mock.calls[0][0].id);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("ignores a second tap while the first is still in flight", async () => {
    let resolve!: (v: AssetDetail) => void;
    m.create.mockReturnValue(new Promise<AssetDetail>((r) => (resolve = r)));
    const hook = register();
    fill(hook);
    let first!: Promise<void>;
    await act(async () => {
      first = hook.result.current.submit() as Promise<void>;
      void hook.result.current.submit();
    });
    expect(hook.result.current.saving).toBe(true);
    expect(m.create).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ ...ASSET, id: "new1" });
      await first;
    });
  });

  it("a duplicate tag keeps the form, marks the tag field, and does not claim success", async () => {
    m.create.mockRejectedValue(apiError(409, "asset_tag_in_use"));
    const onSaved = jest.fn();
    const hook = register(onSaved);
    fill(hook);
    await act(async () => hook.result.current.submit());
    expect(hook.result.current.errors.assetTag).toBe("tag_in_use");
    expect(hook.result.current.failure).toEqual({ kind: "tag_in_use" });
    expect(onSaved).not.toHaveBeenCalled();
    act(() => hook.result.current.update({ assetTag: "PP-2" }));
    expect(hook.result.current.errors.assetTag).toBeUndefined();
  });

  it("a permission refusal is explained and nothing is claimed", async () => {
    m.create.mockRejectedValue(apiError(403));
    const hook = register();
    fill(hook);
    await act(async () => hook.result.current.submit());
    expect(hook.result.current.failure).toEqual({ kind: "forbidden" });
  });

  it("uploads the photo only after the equipment exists, then finishes", async () => {
    m.create.mockResolvedValue({ ...ASSET, id: "new1", row_version: 1 });
    m.upload.mockResolvedValue({ ...ASSET, id: "new1", row_version: 2, photo_url: "https://signed/p" });
    const onSaved = jest.fn();
    const hook = register(onSaved);
    fill(hook);
    act(() => hook.result.current.setPhoto({ kind: "new", uri: "file:///p.jpg" }));
    await act(async () => hook.result.current.submit());
    expect(m.upload).toHaveBeenCalledWith(expect.objectContaining({ assetId: "new1", uri: "file:///p.jpg#small", expectedRowVersion: 1 }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ photo_url: "https://signed/p" }));
  });

  it("a failed photo leaves the equipment registered, says so, and a retry never registers again", async () => {
    m.create.mockResolvedValue({ ...ASSET, id: "new1", row_version: 1 });
    m.upload.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce({ ...ASSET, id: "new1", row_version: 2 });
    const onSaved = jest.fn();
    const hook = register(onSaved);
    fill(hook);
    act(() => hook.result.current.setPhoto({ kind: "new", uri: "file:///p.jpg" }));
    await act(async () => hook.result.current.submit());
    expect(hook.result.current.registered?.id).toBe("new1");
    expect(hook.result.current.photoFailed).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();

    await act(async () => hook.result.current.submit());
    expect(m.create).toHaveBeenCalledTimes(1); // no second asset
    expect(m.upload).toHaveBeenCalledTimes(2);
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("lets the person skip a failed photo and open the registered equipment", async () => {
    m.create.mockResolvedValue({ ...ASSET, id: "new1", row_version: 1 });
    m.upload.mockRejectedValue(new Error("Network request failed"));
    const onSaved = jest.fn();
    const hook = register(onSaved);
    fill(hook);
    act(() => hook.result.current.setPhoto({ kind: "new", uri: "file:///p.jpg" }));
    await act(async () => hook.result.current.submit());
    act(() => hook.result.current.skipPhoto());
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "new1" }));
    expect(m.create).toHaveBeenCalledTimes(1);
  });
});

describe("editing equipment", () => {
  it("starts clean and sends nothing until something changes", async () => {
    const hook = edit();
    expect(hook.result.current.dirty).toBe(false);
    await act(async () => hook.result.current.submit());
    expect(m.update).not.toHaveBeenCalled();
  });

  it("sends only the changes, with the loaded version, and primes the detail cache with the confirmed record", async () => {
    m.update.mockResolvedValue({ ...ASSET, notes: "Serviced", row_version: 4 });
    const onSaved = jest.fn();
    const hook = edit(ASSET, onSaved);
    act(() => hook.result.current.update({ notes: "Serviced" }));
    expect(hook.result.current.dirty).toBe(true);
    await act(async () => hook.result.current.submit());
    expect(m.update).toHaveBeenCalledWith("a1", { notes: "Serviced", expected_row_version: 3 });
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ row_version: 4 }));
    expect(takeAssetListStale()).toBe(true);
  });

  it("a stale version is a conflict: nothing is lost, and the person chooses", async () => {
    m.update.mockRejectedValueOnce(apiError(409, "asset_conflict", { current: { id: "a1" } }));
    const hook = edit();
    act(() => hook.result.current.update({ notes: "mine" }));
    await act(async () => hook.result.current.submit());
    expect(hook.result.current.failure).toMatchObject({ kind: "conflict" });
    expect(hook.result.current.values.notes).toBe("mine");
  });

  it("'keep my changes' retries against the latest version, still sending only what the person changed", async () => {
    m.update.mockRejectedValueOnce(apiError(409, "asset_conflict", { current: { id: "a1" } })).mockResolvedValueOnce({ ...ASSET, notes: "mine", row_version: 8 });
    m.get.mockResolvedValue({ ...ASSET, manufacturer: "Theirs", row_version: 7 });
    const hook = edit();
    act(() => hook.result.current.update({ notes: "mine" }));
    await act(async () => hook.result.current.submit());
    await act(async () => hook.result.current.resolveConflict("mine"));
    expect(hook.result.current.failure).toBeNull();
    await act(async () => hook.result.current.submit());
    expect(m.update).toHaveBeenLastCalledWith("a1", { notes: "mine", expected_row_version: 7 });
  });

  it("'load their version' replaces the form with the latest record and drops the person's edits", async () => {
    m.update.mockRejectedValueOnce(apiError(409, "asset_conflict", { current: { id: "a1" } }));
    m.get.mockResolvedValue({ ...ASSET, name: "Chiller (renamed)", row_version: 7 });
    const hook = edit();
    act(() => hook.result.current.update({ notes: "mine" }));
    await act(async () => hook.result.current.submit());
    await act(async () => hook.result.current.resolveConflict("latest"));
    expect(hook.result.current.values.name).toBe("Chiller (renamed)");
    expect(hook.result.current.values.notes).toBe("");
    expect(hook.result.current.dirty).toBe(false);
  });

  it("changes saved before a failed photo are not sent again on retry", async () => {
    m.update.mockResolvedValue({ ...ASSET, notes: "n", row_version: 4 });
    m.upload.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValueOnce({ ...ASSET, row_version: 5 });
    const onSaved = jest.fn();
    const hook = edit(ASSET, onSaved);
    act(() => {
      hook.result.current.update({ notes: "n" });
      hook.result.current.setPhoto({ kind: "new", uri: "file:///p.jpg" });
    });
    await act(async () => hook.result.current.submit());
    expect(hook.result.current.photoFailed).toBe(true);
    expect(onSaved).not.toHaveBeenCalled();
    await act(async () => hook.result.current.submit());
    expect(m.update).toHaveBeenCalledTimes(1);
    expect(m.upload).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRowVersion: 4 }));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("removing the photo calls the remove endpoint, not an upload", async () => {
    m.remove.mockResolvedValue({ ...ASSET, photo_url: null, row_version: 4 });
    const hook = edit({ ...ASSET, photo_url: "https://signed/p" });
    act(() => hook.result.current.setPhoto({ kind: "remove" }));
    await act(async () => hook.result.current.submit());
    expect(m.remove).toHaveBeenCalledWith("a1");
    expect(m.upload).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  it("a record the form was opened for stays what it was loaded as", () => {
    const hook = edit();
    expect(hook.result.current.values).toEqual(formFromAsset(ASSET));
  });
});
