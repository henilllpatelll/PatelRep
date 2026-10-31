jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn(), post: jest.fn() } }));

import { resolveAssetCode } from "@/lib/engineering/assetLookup";

const ID = "0b6f3a52-6a7c-4b1d-8d8e-1f2a3b4c5d6e";
const asset = { id: ID, name: "PTAC Unit", asset_tag: "AC-312" };
const apiError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("resolving a scanned or typed code", () => {
  it("looks a valid label up by id or by tag through the property-scoped API", async () => {
    const lookup = jest.fn().mockResolvedValue(asset);
    expect(await resolveAssetCode(`patelrep:asset:v1:${ID}`, { isOnline: true, lookup })).toEqual({ kind: "found", asset, fromCache: false });
    expect(lookup).toHaveBeenLastCalledWith({ kind: "id", value: ID });
    await resolveAssetCode("AC-312", { isOnline: true, lookup });
    expect(lookup).toHaveBeenLastCalledWith({ kind: "tag", value: "AC-312" });
  });

  it("never calls the API for an invalid payload or an arbitrary web address", async () => {
    const lookup = jest.fn();
    for (const code of ["", "https://evil.example/x", "javascript:alert(1)", "patelrep:asset:v9:abc", "two words"]) {
      expect((await resolveAssetCode(code, { isOnline: true, lookup })).kind).toBe("invalid");
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("gives one answer for an unknown asset and for another property's asset: not found", async () => {
    const lookup = jest.fn().mockRejectedValue(apiError(404));
    expect(await resolveAssetCode(ID, { isOnline: true, lookup })).toEqual({ kind: "not_found" });
  });

  it("maps the other server answers to distinct, honest outcomes", async () => {
    const run = (err: unknown) => resolveAssetCode("AC-1", { isOnline: true, lookup: jest.fn().mockRejectedValue(err) });
    expect(await run(apiError(403))).toEqual({ kind: "forbidden" });
    expect(await run(apiError(401))).toEqual({ kind: "forbidden" });
    expect(await run(apiError(409))).toEqual({ kind: "ambiguous" });
    expect(await run(apiError(500))).toEqual({ kind: "failed" });
  });

  it("offline, opens only an asset this person already loaded in this hotel", async () => {
    const lookup = jest.fn();
    const findCached = jest.fn().mockReturnValue(asset);
    expect(await resolveAssetCode("AC-312", { isOnline: false, lookup, findCached })).toEqual({ kind: "found", asset, fromCache: true });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("offline with nothing cached says a connection is needed (and never pretends it knows)", async () => {
    const outcome = await resolveAssetCode("AC-999", { isOnline: false, findCached: () => null, lookup: jest.fn() });
    expect(outcome).toEqual({ kind: "offline" });
  });

  it("falls back to the same cache when the request itself cannot reach the server", async () => {
    const lookup = jest.fn().mockRejectedValue(new Error("Network request failed"));
    expect(await resolveAssetCode("AC-312", { isOnline: true, lookup, findCached: () => asset })).toMatchObject({ kind: "found", fromCache: true });
    expect(await resolveAssetCode("AC-312", { isOnline: true, lookup, findCached: () => null })).toEqual({ kind: "offline" });
  });
});
