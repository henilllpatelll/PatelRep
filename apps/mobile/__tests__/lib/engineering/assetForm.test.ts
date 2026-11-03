import {
  EMPTY_ASSET_FORM,
  assetFormChanged,
  buildCreateBody,
  buildUpdateBody,
  classifySaveFailure,
  formFromAsset,
  fromIsoDate,
  isIsoDate,
  mergeSavedAsset,
  registrationStarted,
  toIsoDate,
  validateAssetForm,
  type AssetFormValues,
} from "@/lib/engineering/assetForm";
import type { AssetDetail } from "@/lib/api/assets";

const ID = "0b6f3a52-6a7c-4b1d-8d8e-1f2a3b4c5d6e";
const CAT = "11111111-1111-4111-8111-111111111111";
const ROOM = "22222222-2222-4222-8222-222222222222";
const form = (over: Partial<AssetFormValues> = {}): AssetFormValues => ({ ...EMPTY_ASSET_FORM, name: "Chiller 2", categoryId: CAT, categoryName: "HVAC", ...over });
const room = { kind: "room" as const, roomId: ROOM, roomNumber: "312", floor: 3 };

describe("validation", () => {
  it("requires a name and a category, and nothing else", () => {
    expect(validateAssetForm(EMPTY_ASSET_FORM)).toEqual({ name: "name_required", categoryId: "category_required" });
    expect(validateAssetForm(form())).toEqual({});
    expect(validateAssetForm(form({ name: "   " })).name).toBe("name_required");
    expect(validateAssetForm(form({ name: "x".repeat(121) })).name).toBe("name_too_long");
  });

  it("accepts only tags the scanner and the server accept", () => {
    expect(validateAssetForm(form({ assetTag: "AC-312/B#2" }))).toEqual({});
    for (const bad of ["has space", "-leading", "tag!", "x".repeat(65)]) expect(validateAssetForm(form({ assetTag: bad })).assetTag).toBe("tag_invalid");
    expect(validateAssetForm(form({ assetTag: "  " }))).toEqual({});
  });

  it("checks dates as real calendar days, in a sensible order", () => {
    const today = new Date(2026, 5, 15);
    expect(validateAssetForm(form({ installationDate: "2024-02-30" }), today).installationDate).toBe("date_invalid");
    expect(validateAssetForm(form({ installationDate: "06/15/2024" }), today).installationDate).toBe("date_invalid");
    expect(validateAssetForm(form({ installationDate: "2028-01-01" }), today).installationDate).toBe("install_too_far_ahead");
    expect(validateAssetForm(form({ installationDate: "2027-06-15" }), today)).toEqual({});
    expect(validateAssetForm(form({ installationDate: "2024-06-01", warrantyExpires: "2024-01-01" }), today).warrantyExpires).toBe("warranty_before_install");
    expect(validateAssetForm(form({ installationDate: "2024-06-01", warrantyExpires: "2029-06-01" }), today)).toEqual({});
    expect(validateAssetForm(form({ warrantyExpires: "2029-06-01" }), today)).toEqual({});
  });

  it("round-trips ISO dates without a timezone shift", () => {
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2023-02-29")).toBe(false);
    expect(toIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(fromIsoDate("2026-01-05")?.getDate()).toBe(5);
    expect(fromIsoDate("nope")).toBeNull();
  });
});

describe("registration body", () => {
  it("carries the one client-generated id and only what was filled in", () => {
    expect(buildCreateBody(form(), ID)).toEqual({ id: ID, name: "Chiller 2", category_id: CAT, criticality: "medium" });
    const full = buildCreateBody(
      form({ assetTag: " CH-2 ", manufacturer: "Trane", model: "X1", serialNumber: "S9", location: room, locationNote: "behind vanity", installationDate: "2024-01-02", warrantyExpires: "2029-01-02", criticality: "high", notes: " serviced " }),
      ID,
    );
    expect(full).toEqual({
      id: ID, name: "Chiller 2", category_id: CAT, criticality: "high", asset_tag: "CH-2", manufacturer: "Trane", model: "X1", serial_number: "S9",
      room_id: ROOM, location_text: "behind vanity", installation_date: "2024-01-02", warranty_expires: "2029-01-02", notes: "serviced",
    });
  });

  it("a non-room area needs no room and is stored as location text", () => {
    const body = buildCreateBody(form({ location: { kind: "other", text: " Roof " } }), ID);
    expect(body.location_text).toBe("Roof");
    expect("room_id" in body).toBe(false);
  });

  it("tells a started form from a blank one", () => {
    expect(registrationStarted(EMPTY_ASSET_FORM)).toBe(false);
    expect(registrationStarted({ ...EMPTY_ASSET_FORM, notes: "x" })).toBe(true);
  });
});

const ASSET: AssetDetail = {
  id: ID, name: "PTAC Unit", asset_tag: "AC-312", category_id: CAT, room_id: ROOM, location_text: "behind vanity", manufacturer: "Amana",
  model: null, serial_number: null, installation_date: "2022-03-01", warranty_expires: "2030-03-01", notes: null, criticality: "high",
  row_version: 4, asset_categories: { name: "HVAC", code: "hvac" }, rooms: { room_number: "312", floor: 3, building: "A" },
  pm_schedules: [{ id: "s1", name: "Quarterly" }], service_status: "operational", active_work_order_count: 2,
};

describe("the edit form", () => {
  it("is filled from the real record, inventing nothing", () => {
    const values = formFromAsset(ASSET);
    expect(values).toMatchObject({ name: "PTAC Unit", categoryId: CAT, categoryName: "HVAC", assetTag: "AC-312", manufacturer: "Amana", model: "", serialNumber: "", locationNote: "behind vanity", criticality: "high", installationDate: "2022-03-01", notes: "" });
    expect(values.location).toEqual({ kind: "room", roomId: ROOM, roomNumber: "312", floor: 3 });
    expect(formFromAsset({ ...ASSET, room_id: null, rooms: null, location_text: "Roof", criticality: null }).location).toEqual({ kind: "other", text: "Roof" });
    expect(formFromAsset({ ...ASSET, room_id: null, rooms: null, location_text: null }).location).toBeNull();
    expect(formFromAsset({ ...ASSET, criticality: null }).criticality).toBe("medium");
  });

  it("sends nothing when nothing changed, and only the changed fields otherwise", () => {
    const base = formFromAsset(ASSET);
    expect(buildUpdateBody(base, { ...base }, 4)).toBeNull();
    expect(assetFormChanged(base, base)).toBe(false);
    expect(buildUpdateBody(base, { ...base, model: "PTH153", notes: "ok" }, 4)).toEqual({ model: "PTH153", notes: "ok", expected_row_version: 4 });
  });

  it("names emptied optional fields in clear_fields instead of dropping them silently", () => {
    const base = formFromAsset(ASSET);
    const body = buildUpdateBody(base, { ...base, manufacturer: "  ", warrantyExpires: "", location: null, locationNote: "" }, 4);
    expect(body).toEqual({ clear_fields: ["manufacturer", "room_id", "location_text", "warranty_expires"], expected_row_version: 4 });
  });

  it("moving to a different room, or to a free-text area, changes the right columns", () => {
    const base = formFromAsset(ASSET);
    expect(buildUpdateBody(base, { ...base, location: { kind: "other", text: "Pool plant" }, locationNote: "" }, null)).toEqual({ location_text: "Pool plant", clear_fields: ["room_id"] });
    expect(buildUpdateBody(base, { ...base, location: { ...room, roomId: "33333333-3333-4333-8333-333333333333", roomNumber: "410" } }, null)).toEqual({ room_id: "33333333-3333-4333-8333-333333333333" });
  });

  it("does not send a version it does not have", () => {
    const base = formFromAsset(ASSET);
    expect(buildUpdateBody(base, { ...base, notes: "n" }, null)).toEqual({ notes: "n" });
  });
});

describe("what a confirmed save does to the cached detail", () => {
  it("rebuilds the joined pieces from the saved values and keeps the derived ones", () => {
    const base = formFromAsset(ASSET);
    const values = { ...base, name: "PTAC Unit 2", categoryId: "c2", categoryName: "Plumbing", location: { kind: "other" as const, text: "Roof" }, locationNote: "" };
    const merged = mergeSavedAsset(ASSET, { ...ASSET, name: "PTAC Unit 2", category_id: "c2", room_id: null, location_text: "Roof", row_version: 5 }, values, [{ id: "c2", name: "Plumbing", code: "plumbing" }]);
    expect(merged).toMatchObject({ name: "PTAC Unit 2", row_version: 5, rooms: null, asset_categories: { name: "Plumbing", code: "plumbing" }, active_work_order_count: 2, service_status: "operational" });
    expect(merged.pm_schedules).toEqual(ASSET.pm_schedules);
  });

  it("takes the photo address from the save when it has one, and keeps the old one otherwise", () => {
    const base = formFromAsset(ASSET);
    const withPhoto = { ...ASSET, photo_url: "https://signed/old" };
    expect(mergeSavedAsset(withPhoto, { ...ASSET, photo_url: "https://signed/new" }, base, []).photo_url).toBe("https://signed/new");
    expect(mergeSavedAsset(withPhoto, { ...ASSET }, base, []).photo_url).toBe("https://signed/old");
    expect(mergeSavedAsset(withPhoto, { ...ASSET, photo_url: null }, base, []).photo_url).toBeNull();
  });
});

describe("explaining a failed save", () => {
  const api = (status: number, code?: string, detail?: unknown, message = "x") => Object.assign(new Error(message), { status, code, detail });
  it("recognises the server's stable reasons", () => {
    expect(classifySaveFailure(api(409, "asset_tag_in_use"))).toEqual({ kind: "tag_in_use" });
    expect(classifySaveFailure(api(409, "asset_conflict", { current: { id: ID } }))).toEqual({ kind: "conflict", current: { id: ID } });
    expect(classifySaveFailure(api(409, "asset_has_open_work_orders"))).toEqual({ kind: "has_open_work", code: "asset_has_open_work_orders" });
    expect(classifySaveFailure(api(403))).toEqual({ kind: "forbidden" });
    expect(classifySaveFailure(api(404))).toEqual({ kind: "not_found" });
    expect(classifySaveFailure(api(422, undefined, undefined, "bad date"))).toEqual({ kind: "validation", message: "bad date" });
    expect(classifySaveFailure(api(500))).toEqual({ kind: "failed" });
  });

  it("treats a timeout or dropped connection as unconfirmed - the request may have landed", () => {
    for (const message of ["Request timed out", "Network request failed", "Failed to fetch"]) expect(classifySaveFailure(new Error(message))).toEqual({ kind: "unconfirmed" });
    expect(classifySaveFailure(new Error("boom"))).toEqual({ kind: "failed" });
  });
});
