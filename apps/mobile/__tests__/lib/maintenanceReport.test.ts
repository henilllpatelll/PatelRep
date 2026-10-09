jest.mock("@/lib/api/client", () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { ApiError, api: { get: jest.fn(), post: jest.fn() } };
});
jest.mock("@/lib/api/workOrders", () => ({ createWorkOrder: jest.fn(), uploadWorkOrderPhoto: jest.fn() }));
jest.mock("@/lib/offline/db", () => ({ enqueueAction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/housekeeping/photo", () => ({ prepareForUpload: jest.fn(async (uri: string) => `resized:${uri}`) }));

import { api, ApiError } from "@/lib/api/client";
import { createWorkOrder, uploadWorkOrderPhoto } from "@/lib/api/workOrders";
import { enqueueAction } from "@/lib/offline/db";
import {
  EMPTY_MAINTENANCE_DRAFT,
  MAINTENANCE_PRIORITIES,
  MAINTENANCE_TITLE_MAX,
  attachMaintenancePhoto,
  buildMaintenancePayload,
  createMaintenanceWorkOrder,
  isMaintenanceDirty,
  validateMaintenance,
} from "@/lib/housekeeping/maintenanceReport";

const mockCreate = createWorkOrder as jest.Mock;
const mockUpload = uploadWorkOrderPhoto as jest.Mock;
const mockEnqueue = enqueueAction as jest.Mock;
const mockGet = api.get as jest.Mock;

const draft = { ...EMPTY_MAINTENANCE_DRAFT, title: "Sink leaking", category: "plumbing" as const };
const payload = buildMaintenancePayload("room-1", draft);

beforeEach(() => jest.clearAllMocks());

describe("validation", () => {
  it("needs a title and a category", () => {
    expect(validateMaintenance(EMPTY_MAINTENANCE_DRAFT)).toEqual({ title: "required", category: "required" });
    expect(validateMaintenance(draft)).toEqual({});
  });

  it("bounds the title to the API limit", () => {
    expect(validateMaintenance({ ...draft, title: "x".repeat(MAINTENANCE_TITLE_MAX + 1) }).title).toBe("tooLong");
  });

  it("offers priorities up to urgent only", () => {
    expect(MAINTENANCE_PRIORITIES).toEqual(["low", "normal", "urgent"]);
  });
});

describe("payload", () => {
  it("links the room and trims the text; no out-of-order flags", () => {
    expect(buildMaintenancePayload("room-1", { ...draft, title: "  Sink leaking ", details: " drips ", priority: "urgent" })).toEqual({
      room_id: "room-1",
      title: "Sink leaking",
      description: "drips",
      category: "plumbing",
      priority: "urgent",
    });
  });

  it("leaves description out when there are no details", () => {
    expect(payload.description).toBeUndefined();
  });
});

describe("dirty", () => {
  it("is clean for the empty form and dirty once anything is entered or attached", () => {
    expect(isMaintenanceDirty(EMPTY_MAINTENANCE_DRAFT, null)).toBe(false);
    expect(isMaintenanceDirty({ ...EMPTY_MAINTENANCE_DRAFT, title: "x" }, null)).toBe(true);
    expect(isMaintenanceDirty(EMPTY_MAINTENANCE_DRAFT, "file:///p.jpg")).toBe(true);
  });
});

describe("createMaintenanceWorkOrder", () => {
  it("creates online", async () => {
    mockCreate.mockResolvedValue("wo-1");
    expect(await createMaintenanceWorkOrder(payload, { isOnline: true, mayHaveBeenSent: false })).toEqual({ kind: "created", workOrderId: "wo-1" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("queues offline through the existing work-order queue", async () => {
    expect(await createMaintenanceWorkOrder(payload, { isOnline: false, mayHaveBeenSent: false })).toEqual({ kind: "queued" });
    expect(mockEnqueue).toHaveBeenCalledWith("work_order", "create", payload);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("flags a lost answer as ambiguous and a rejection as definite", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Request timed out"));
    expect(await createMaintenanceWorkOrder(payload, { isOnline: true, mayHaveBeenSent: false })).toMatchObject({ kind: "failed", ambiguous: true });
    mockCreate.mockRejectedValueOnce(new ApiError("bad", 422));
    expect(await createMaintenanceWorkOrder(payload, { isOnline: true, mayHaveBeenSent: false })).toMatchObject({ kind: "failed", ambiguous: false });
  });

  it("reuses the work order the earlier attempt made instead of creating another", async () => {
    mockGet.mockResolvedValue({ data: [{ id: "wo-9", title: "Sink leaking", created_by: "user-1" }] });
    expect(await createMaintenanceWorkOrder(payload, { isOnline: true, userId: "user-1", mayHaveBeenSent: true })).toEqual({ kind: "created", workOrderId: "wo-9" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("does not mistake somebody else's work order for its own", async () => {
    mockGet.mockResolvedValue({ data: [{ id: "wo-9", title: "Sink leaking", created_by: "someone-else" }] });
    mockCreate.mockResolvedValue("wo-new");
    expect(await createMaintenanceWorkOrder(payload, { isOnline: true, userId: "user-1", mayHaveBeenSent: true })).toEqual({ kind: "created", workOrderId: "wo-new" });
  });
});

describe("attachMaintenancePhoto", () => {
  it("uploads the resized photo to the given work order only", async () => {
    mockUpload.mockResolvedValue({});
    expect(await attachMaintenancePhoto("wo-1", "file:///p.jpg")).toEqual({ ok: true });
    expect(mockUpload).toHaveBeenCalledWith("wo-1", "resized:file:///p.jpg");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("reports a failed upload without throwing", async () => {
    mockUpload.mockRejectedValue(new Error("HTTP 500"));
    expect(await attachMaintenancePhoto("wo-1", "file:///p.jpg")).toEqual({ ok: false, message: "HTTP 500" });
  });
});
