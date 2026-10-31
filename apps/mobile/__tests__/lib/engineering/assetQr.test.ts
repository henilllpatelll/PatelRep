import { ASSET_QR_PREFIX, buildAssetQrPayload, parseAssetCode } from "@/lib/engineering/assetQr";

const ID = "0b6f3a52-6a7c-4b1d-8d8e-1f2a3b4c5d6e";

describe("equipment code parsing", () => {
  it("reads the versioned PatelRep payload, and a printed payload round-trips", () => {
    expect(parseAssetCode(`${ASSET_QR_PREFIX}v1:${ID}`)).toEqual({ ok: true, kind: "id", value: ID });
    expect(parseAssetCode(buildAssetQrPayload(ID.toUpperCase()))).toEqual({ ok: true, kind: "id", value: ID });
  });

  it("keeps existing physical labels working: a bare id or an asset tag", () => {
    expect(parseAssetCode(ID)).toEqual({ ok: true, kind: "id", value: ID });
    expect(parseAssetCode("  AC-312 ")).toEqual({ ok: true, kind: "tag", value: "AC-312" });
    expect(parseAssetCode("HV/0002#a")).toEqual({ ok: true, kind: "tag", value: "HV/0002#a" });
  });

  it("refuses empty input and unsupported versions", () => {
    expect(parseAssetCode("")).toEqual({ ok: false, reason: "empty" });
    expect(parseAssetCode(null)).toEqual({ ok: false, reason: "empty" });
    expect(parseAssetCode(`${ASSET_QR_PREFIX}v2:${ID}`)).toEqual({ ok: false, reason: "unsupported_version" });
    expect(parseAssetCode(`${ASSET_QR_PREFIX}v1:not-a-uuid`)).toEqual({ ok: false, reason: "malformed" });
  });

  it("never treats a web address, deep link or free text as a destination", () => {
    for (const code of ["https://evil.example/asset/1", "http://x", "javascript:alert(1)", "patelrep://admin", "tel:+15555550100", "www.example.com", "two words", "mailto:a@b.c"]) {
      expect(parseAssetCode(code)).toMatchObject({ ok: false, reason: "not_an_asset_code" });
    }
  });

  it("rejects oversized payloads and tags with unsafe characters", () => {
    expect(parseAssetCode("A".repeat(300))).toEqual({ ok: false, reason: "too_long" });
    expect(parseAssetCode("A".repeat(80))).toMatchObject({ ok: false });
    expect(parseAssetCode("AC<script>")).toMatchObject({ ok: false });
    expect(parseAssetCode("AC;DROP")).toMatchObject({ ok: false });
  });

  it("carries only an id in a printed payload: no credentials or equipment details", () => {
    const payload = buildAssetQrPayload(ID);
    expect(payload).toBe(`patelrep:asset:v1:${ID}`);
    expect(payload).not.toMatch(/token|key|secret|name|serial/i);
  });
});
