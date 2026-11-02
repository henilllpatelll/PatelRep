import {
  ASSET_PAGE_SIZE,
  EMPTY_ASSET_FILTERS,
  activeAssetFilterCount,
  assetBrowseKey,
  assetBrowseParams,
  ASSET_HISTORY_GROUPS,
  assetCardModel,
  assetQuickActions,
  buildAssetTimeline,
  filterAssetEvents,
  historyGroupCounts,
  historyGroupOf,
  parseAssetSection,
  hasAnyAssetFilter,
  mergeAssetPages,
  riskBand,
  type AssetFilters,
  type AssetRow,
} from "@/lib/engineering/assetModel";

const row = (id: string, over: Partial<AssetRow> = {}): AssetRow => ({
  id,
  name: `Asset ${id}`,
  service_status: "operational",
  active_work_order_count: 0,
  pm_overdue: false,
  pm_due_soon: false,
  repeat_repairs_90d: 0,
  has_active_prediction: false,
  had_downtime_365d: false,
  ...over,
});

describe("browse request", () => {
  it("asks for page, size and sort, and nothing else by default", () => {
    expect(assetBrowseParams(EMPTY_ASSET_FILTERS, "", 1)).toEqual({ page: 1, per_page: ASSET_PAGE_SIZE, sort_by: "name" });
  });

  it("sends the trimmed search text so the server searches the whole inventory", () => {
    expect(assetBrowseParams(EMPTY_ASSET_FILTERS, "  ac-312 ", 2)).toMatchObject({ q: "ac-312", page: 2 });
  });

  it("turns the quick chips into the real server filters, with 'attention' as a derived group (not a status)", () => {
    const quick = (q: AssetFilters["quick"]) => assetBrowseParams({ ...EMPTY_ASSET_FILTERS, quick: q }, "", 1);
    expect(quick("out_of_service")).toMatchObject({ status: "out_of_service" });
    expect(quick("active_repairs")).toMatchObject({ maintenance: "active_work_order" });
    expect(quick("attention")).toMatchObject({ attention: true });
    expect(quick("attention")).not.toHaveProperty("status");
  });

  it("combines sheet criteria, and a sheet criterion wins over the quick chip on the same field", () => {
    const params = assetBrowseParams(
      { ...EMPTY_ASSET_FILTERS, quick: "out_of_service", status: "degraded", categoryId: "c1", floor: 3, building: " A ", maintenance: "pm_overdue", reliability: "repeat_repairs", sort: "next_pm" },
      "",
      1,
    );
    expect(params).toMatchObject({ status: "degraded", category_id: "c1", floor: 3, building: "A", maintenance: "pm_overdue", reliability: "repeat_repairs", sort_by: "next_pm" });
  });

  it("keys a request by filters and search but not by page, so pages of one request share a bucket", () => {
    expect(assetBrowseKey(EMPTY_ASSET_FILTERS, "a")).toBe(assetBrowseKey(EMPTY_ASSET_FILTERS, " a "));
    expect(assetBrowseKey(EMPTY_ASSET_FILTERS, "a")).not.toBe(assetBrowseKey(EMPTY_ASSET_FILTERS, "b"));
    expect(assetBrowseKey({ ...EMPTY_ASSET_FILTERS, floor: 2 }, "a")).not.toBe(assetBrowseKey(EMPTY_ASSET_FILTERS, "a"));
  });
});

describe("filter indicators", () => {
  it("counts sheet criteria only (the chips and the search show their own state)", () => {
    expect(activeAssetFilterCount(EMPTY_ASSET_FILTERS)).toBe(0);
    expect(activeAssetFilterCount({ ...EMPTY_ASSET_FILTERS, quick: "attention" })).toBe(0);
    expect(activeAssetFilterCount({ ...EMPTY_ASSET_FILTERS, categoryId: "c", floor: 2, sort: "risk" })).toBe(3);
  });

  it("knows when anything narrows the list, so an empty result can say 'no matches' instead of 'no assets'", () => {
    expect(hasAnyAssetFilter(EMPTY_ASSET_FILTERS, "")).toBe(false);
    expect(hasAnyAssetFilter(EMPTY_ASSET_FILTERS, " x ")).toBe(true);
    expect(hasAnyAssetFilter({ ...EMPTY_ASSET_FILTERS, quick: "out_of_service" }, "")).toBe(true);
  });
});

describe("paging", () => {
  it("never shows a row twice when pages overlap", () => {
    const first = [row("a"), row("b")];
    const merged = mergeAssetPages(first, [row("b"), row("c")]);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("card model", () => {
  it("reads tag, category and place from the record and keeps service status separate from risk", () => {
    const card = assetCardModel(
      row("1", {
        name: "PTAC Unit",
        asset_tag: " AC-312 ",
        asset_categories: { name: "HVAC" },
        rooms: { room_number: "312" },
        service_status: "under_repair",
        active_work_order_count: 2,
        pm_overdue: true,
        failure_risk_score: 95,
      }),
    );
    expect(card).toMatchObject({ title: "PTAC Unit", tag: "AC-312", category: "HVAC", room: "312", status: "under_repair", activeRepairs: 2, pmOverdue: true });
  });

  it("uses the free-text location when there is no room", () => {
    expect(assetCardModel(row("2", { location_text: "Roof" }))).toMatchObject({ room: null, locationText: "Roof" });
  });
});

describe("risk bands", () => {
  it("bands a prediction score without ever inventing one", () => {
    expect(riskBand(null)).toBeNull();
    expect(riskBand(10)).toBe("low");
    expect(riskBand(40)).toBe("elevated");
    expect(riskBand(70)).toBe("high");
  });
});

describe("timeline", () => {
  it("lists only what the records state, newest first, with no inferred restore", () => {
    const events = buildAssetTimeline({
      downtime: [{ id: "d1", started_at: "2026-10-10T10:00:00Z", restored_at: null, impact_level: "out_of_service", work_order_id: "wo1" }],
      workOrders: [
        { id: "wo1", title: "No cooling", created_at: "2026-10-10T09:00:00Z", status: "completed", completed_at: "2026-10-12T09:00:00Z" },
        { id: "wo2", title: "Filter", created_at: "2026-10-01T09:00:00Z", status: "open", completed_at: null },
      ],
      pmCompletions: [{ id: "pm1", pm_schedule_id: "s1", completed_at: "2026-10-05T09:00:00Z", schedule_name: "Quarterly service" }],
      readings: [{ id: "r1", recorded_at: "2026-10-11T09:00:00Z", meter: "Pressure" }],
    });
    expect(events.map((e) => e.key)).toEqual([
      "repair_completed:wo1",
      "reading_recorded:r1",
      "downtime_started:d1",
      "work_order_created:wo1",
      "pm_completed:pm1",
      "work_order_created:wo2",
    ]);
    // A completed work order does not restore the asset: no restore event exists without a recorded restore time.
    expect(events.some((e) => e.type === "downtime_restored")).toBe(false);
  });

  it("adds a restore event only when a restore time was recorded", () => {
    const events = buildAssetTimeline({
      downtime: [{ id: "d1", started_at: "2026-10-10T10:00:00Z", restored_at: "2026-10-11T10:00:00Z" }],
      workOrders: [],
      pmCompletions: [],
      readings: [],
    });
    expect(events.map((e) => e.type)).toEqual(["downtime_restored", "downtime_started"]);
  });

  it("drops duplicates and unparseable times, and caps the length", () => {
    const wo = Array.from({ length: 50 }, (_, i) => ({ id: `w${i}`, title: "T", created_at: `2026-09-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`, status: "open" }));
    const events = buildAssetTimeline({ downtime: [], workOrders: [...wo, ...wo, { id: "bad", title: "x", created_at: "nope", status: "open" }], pmCompletions: [], readings: [] }, 30);
    expect(events).toHaveLength(30);
    expect(new Set(events.map((e) => e.key)).size).toBe(30);
    expect(events.some((e) => e.key.endsWith("bad"))).toBe(false);
  });
});

describe("History groups", () => {
  const types = ["pm_completed", "work_order_created", "repair_completed", "downtime_started", "downtime_restored", "reading_recorded"] as const;
  const events = types.map((type) => ({ type }));

  it("puts every event type in exactly one group, so the chips add up", () => {
    expect(types.map(historyGroupOf)).toEqual(["pm", "repairs", "repairs", "downtime", "downtime", "readings"]);
    const counts = historyGroupCounts(events);
    expect(counts).toEqual({ all: 6, pm: 1, repairs: 2, downtime: 2, readings: 1 });
    expect(counts.pm + counts.repairs + counts.downtime + counts.readings).toBe(counts.all);
  });

  it("filters to one group, or returns everything for all, without changing order", () => {
    expect(filterAssetEvents(events, "repairs").map((e) => e.type)).toEqual(["work_order_created", "repair_completed"]);
    expect(filterAssetEvents(events, "all")).toBe(events);
    expect(filterAssetEvents([], "pm")).toEqual([]);
    expect(ASSET_HISTORY_GROUPS[0]).toBe("all");
  });
});

describe("parseAssetSection", () => {
  it("accepts only the four real sections and otherwise opens Overview", () => {
    expect(parseAssetSection("readings")).toBe("readings");
    expect(parseAssetSection(["maintenance", "history"])).toBe("maintenance");
    for (const hostile of [undefined, null, "", "Readings", "../x", "readings?x=1", 4, {}]) expect(parseAssetSection(hostile)).toBe("overview");
  });
});

describe("assetQuickActions", () => {
  it("offers open, report, maintenance and label to everyone, and a reading only to a role that may record one", () => {
    expect(assetQuickActions(row("a1"), { isOnline: true, canRecordReading: false }).map((i) => i.action)).toEqual(["open", "report", "maintenance", "label"]);
    expect(assetQuickActions(row("a1"), { isOnline: true, canRecordReading: true }).map((i) => i.action)).toEqual(["open", "report", "reading", "maintenance", "label"]);
  });

  it("disables reporting offline (creating needs the network) and nothing else", () => {
    const offline = assetQuickActions(row("a1"), { isOnline: false, canRecordReading: true });
    expect(offline.filter((i) => i.disabled).map((i) => i.action)).toEqual(["report"]);
  });

  it("offers nothing for a row without an id", () => {
    expect(assetQuickActions({ id: "" }, { isOnline: true, canRecordReading: true })).toEqual([]);
  });
});
