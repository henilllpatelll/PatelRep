import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAssignmentPreferences, requestSmartBalancePlan } from "@/lib/api/housekeepingSupervisor";
import type { AssignmentsModel } from "@/lib/housekeeping/assignmentModel";
import type { MutationGate } from "@/lib/housekeeping/roomBoardState";
import { MAX_BATCH_CHANGES } from "@/lib/housekeeping/assignmentBatch";
import type { AssignmentDraftController } from "@/lib/housekeeping/useAssignmentDraft";
import {
  DEFAULT_PROPERTY_PREFERENCES,
  togglesFromProperty,
  type PropertyAssignmentPreferences,
  type SmartToggles,
} from "@/lib/housekeeping/smartBalancePolicy";
import { buildSmartInput, type BuildOutcome } from "@/lib/housekeeping/smartBalanceRequest";
import type { SmartScope, SmartUnavailable } from "@/lib/housekeeping/smartBalancePool";
import {
  addProposal,
  buildSmartPlan,
  editedCount,
  moveProposal,
  planFreshness,
  removeProposal,
  stagePayloads,
  type EditRefusal,
  type SmartPlan,
  type StaleReason,
} from "@/lib/housekeeping/smartBalancePlan";
import { buildPreview, buildStaffDetail, type SmartPreview, type StaffPlanDetail } from "@/lib/housekeeping/smartBalancePreview";
import { parseSmartBalanceResponse, type SmartBalanceBody, type SmartBalanceResponse } from "@/lib/housekeeping/smartBalanceWire";

/* ─── Smart Balance — the whole workflow ─────────────────────────────────────
   Composes the pure pieces into the one thing the Assignments screen drives:

       setup ──► generate (read-only request) ──► PREVIEW ──► staff detail / exceptions / edits
                                                      │
                                                      ▼
                                            Add to draft  ──►  the Phase 5 draft + review + ATOMIC publish

   READ-ONLY UNTIL THE SUPERVISOR PUBLISHES. Generating asks the planner for a proposal; editing changes only the local
   proposal; "Add to draft" stages PROPOSED changes into the one shared unpublished draft. Nothing here assigns, moves or
   removes a room - only the reviewed, confirmed, atomic publication does, through `useBatchPublication`.

   It reads the SAME model Rooms and Team read (no fetch or realtime channel of its own beyond the single planning request
   and one read of the property's stored preferences), single-flights the request, and throws away an answer that arrives
   for another hotel, person or day. A plan is checked against every newer board; one that no longer holds is marked stale
   and cannot be added to the draft - the supervisor refreshes and plans again, nothing is recalculated silently. */

export type SmartPanel = "setup" | "preview" | "detail" | "exceptions" | "conflict" | "discard" | null;
export type SmartPicker = { kind: "move"; roomId: string } | { kind: "add" } | null;
export type GenerationFailure = "offline" | "day_changed" | "permission" | "invalid" | "unavailable" | "unverified";
export type Generation = { kind: "idle" } | { kind: "loading" } | { kind: "failed"; failure: GenerationFailure } | { kind: "ready" };
export type PreferencesSource = "loading" | "property" | "defaults";
export type DraftResolution = "merge" | "replace";

/** What "Add to draft" did. */
export type AddOutcome = "added" | "needs_resolution" | "blocked" | "stale" | "nothing_added";

export interface SmartBalanceController {
  panel: SmartPanel;
  picker: SmartPicker;
  scope: SmartScope;
  toggles: SmartToggles;
  preferencesSource: PreferencesSource;
  generation: Generation;
  plan: SmartPlan | null;
  preview: SmartPreview | null;
  detailUserId: string | null;
  detail: StaffPlanDetail | null;
  stale: StaleReason[];
  /** What would be planned right now, for the setup drawer (counts only; nothing is requested). */
  setup: { blocked: SmartUnavailable | null; rooms: number; people: number; heldBack: number; selectedCount: number };
  /** Why the plan cannot be added to the draft right now (offline / board not live), or null. */
  paused: "offline" | "not_live" | null;
  canUndo: boolean;
  draftOverlap: number;
  open: () => void;
  close: () => void;
  setScope: (scope: SmartScope) => void;
  toggle: (key: keyof SmartToggles) => void;
  generate: () => Promise<void>;
  refreshAndReplan: () => Promise<void>;
  openDetail: (userId: string) => void;
  openExceptions: () => void;
  back: () => void;
  openPicker: (picker: SmartPicker) => void;
  move: (roomId: string, toUserId: string) => EditRefusal | null;
  add: (roomId: string, toUserId: string) => EditRefusal | null;
  remove: (roomId: string) => EditRefusal | null;
  undo: () => void;
  requestDiscard: () => void;
  confirmDiscard: () => void;
  addToDraft: (resolution?: DraftResolution) => AddOutcome;
}

export interface UseSmartBalanceInput {
  model: AssignmentsModel;
  gate: MutationGate;
  isOnline: boolean;
  scopeKey: string | null;
  hotelId: string | null;
  draft: AssignmentDraftController;
  /** The rooms the supervisor selected in the Rooms list (the "my selected rooms" scope). */
  selectedRoomIds: ReadonlySet<string>;
  /** Opens the Phase 5 draft review once changes are staged. */
  showReview: () => void;
  /** The rooms that went into the draft, so the caller can drop them from a selection. */
  onAdded?: (stagedRoomIds: string[]) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  toast: { success: (message: string) => void; error: (message: string) => void; info: (message: string) => void };
  /** Test seams. */
  requestPlan?: (body: SmartBalanceBody) => Promise<unknown>;
  loadPreferences?: (hotelId: string) => Promise<PropertyAssignmentPreferences>;
  now?: () => number;
  settle?: () => Promise<void>;
  refresh?: () => Promise<void>;
}

const defaultSettle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const HISTORY_LIMIT = 50;

function failureOf(error: unknown): GenerationFailure {
  // A server answer carries a status; anything without one (a dropped connection, a timeout) is just "unavailable".
  const status = typeof (error as { status?: unknown } | null)?.status === "number" ? (error as { status: number }).status : null;
  if (status === 409) return "day_changed";
  if (status === 401 || status === 403) return "permission";
  if (status === 422) return "invalid";
  return "unavailable";
}

export function useSmartBalance(input: UseSmartBalanceInput): SmartBalanceController {
  const { model, gate, isOnline, scopeKey, hotelId, draft, selectedRoomIds, showReview, t, toast } = input;
  const requestPlan = input.requestPlan ?? requestSmartBalancePlan;
  const loadPreferences = input.loadPreferences ?? fetchAssignmentPreferences;
  const now = input.now ?? Date.now;
  const settle = input.settle ?? defaultSettle;

  const [panel, setPanel] = useState<SmartPanel>(null);
  const [picker, setPicker] = useState<SmartPicker>(null);
  const [scope, setScopeState] = useState<SmartScope>("unassigned");
  const [property, setProperty] = useState<PropertyAssignmentPreferences>(DEFAULT_PROPERTY_PREFERENCES);
  const [preferencesSource, setPreferencesSource] = useState<PreferencesSource>("loading");
  const [toggles, setToggles] = useState<SmartToggles>(() => togglesFromProperty(DEFAULT_PROPERTY_PREFERENCES));
  const touched = useRef(false);
  const [generation, setGeneration] = useState<Generation>({ kind: "idle" });
  const [plan, setPlanState] = useState<SmartPlan | null>(null);
  const [history, setHistory] = useState<SmartPlan[]>([]);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

  const latest = useRef({ model, scopeKey, plan, draft, selectedRoomIds, gate, isOnline });
  latest.current = { model, scopeKey, plan, draft, selectedRoomIds, gate, isOnline };
  const requestId = useRef(0);
  const inFlight = useRef(false);

  const clearPlan = useCallback(() => {
    latest.current.plan = null;
    setPlanState(null);
    setHistory([]);
    setDetailUserId(null);
    setPicker(null);
    setGeneration({ kind: "idle" });
  }, []);

  // The property's stored preferences are DEFAULTS for the drawer, read once per hotel/person. A failed read is said, not hidden.
  useEffect(() => {
    if (panel !== "setup" || !hotelId || !scopeKey) return;
    let cancelled = false;
    setPreferencesSource("loading");
    loadPreferences(hotelId)
      .then((value) => {
        if (cancelled) return;
        setProperty(value);
        setPreferencesSource("property");
        if (!touched.current) setToggles(togglesFromProperty(value));
      })
      .catch(() => {
        if (cancelled) return;
        setProperty(DEFAULT_PROPERTY_PREFERENCES);
        setPreferencesSource("defaults");
        if (!touched.current) setToggles(togglesFromProperty(DEFAULT_PROPERTY_PREFERENCES));
      });
    return () => {
      cancelled = true;
    };
  }, [panel === "setup", hotelId, scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A different hotel, person or day: whatever was planned belongs to the old one and is thrown away.
  const lastScope = useRef({ scopeKey, hotelDate: model.hotelDate });
  useEffect(() => {
    if (lastScope.current.scopeKey === scopeKey && lastScope.current.hotelDate === model.hotelDate) return;
    lastScope.current = { scopeKey, hotelDate: model.hotelDate };
    requestId.current += 1; // any answer still on its way is for the old scope
    inFlight.current = false;
    touched.current = false;
    clearPlan();
    setPanel(null);
  }, [scopeKey, model.hotelDate, clearPlan]);

  const buildArgs = useCallback(
    (): Parameters<typeof buildSmartInput>[0] => ({
      model: latest.current.model,
      gateAllowed: latest.current.gate.allowed,
      isOnline: latest.current.isOnline,
      scope,
      selectedIds: latest.current.selectedRoomIds,
      toggles,
      property,
    }),
    [scope, toggles, property],
  );

  // What the setup drawer says it will plan: counts only, recomputed from the live model, no request.
  const setupOutcome = useMemo<BuildOutcome | null>(
    () => (panel === "setup" ? buildSmartInput({ model, gateAllowed: gate.allowed, isOnline, scope, selectedIds: selectedRoomIds, toggles, property }) : null),
    [panel, model, gate.allowed, isOnline, scope, selectedRoomIds, toggles, property],
  );
  const setup = useMemo(() => {
    const selectedCount = selectedRoomIds.size;
    if (!setupOutcome) return { blocked: null, rooms: 0, people: 0, heldBack: 0, selectedCount };
    if (setupOutcome.ok) {
      const { input: built } = setupOutcome;
      return { blocked: null, rooms: built.pool.rooms.length, people: built.receivers.length, heldBack: built.pool.excluded.length, selectedCount };
    }
    return { blocked: setupOutcome.reason, rooms: setupOutcome.pool.rooms.length, people: 0, heldBack: setupOutcome.pool.excluded.length, selectedCount };
  }, [setupOutcome, selectedRoomIds]);

  const stale = useMemo(() => (plan ? planFreshness(model, plan, scopeKey) : []), [model, plan, scopeKey]);
  const preview = useMemo(() => (plan ? buildPreview(model, plan) : null), [model, plan]);
  const detail = useMemo(() => (plan && detailUserId ? buildStaffDetail(model, plan, detailUserId) : null), [model, plan, detailUserId]);
  const paused = !isOnline ? "offline" : !gate.allowed ? "not_live" : null;

  const commit = useCallback((next: SmartPlan, previous: SmartPlan | null) => {
    latest.current.plan = next;
    setPlanState(next);
    if (previous) setHistory((current) => [...current.slice(-(HISTORY_LIMIT - 1)), previous]);
  }, []);

  /* ─── Navigation ─────────────────────────────────────────────────────────── */

  const open = useCallback(() => {
    setPanel(latest.current.plan ? "preview" : "setup");
  }, []);
  /** Hides the sheet. A plan is kept (the entry card offers to resume it); an unfinished request is abandoned. */
  const close = useCallback(() => {
    if (inFlight.current) {
      requestId.current += 1;
      inFlight.current = false;
    }
    setGeneration((current) => (current.kind === "loading" ? { kind: "idle" } : current));
    setPanel(null);
    setPicker(null);
  }, []);

  const setScope = useCallback((next: SmartScope) => setScopeState(next), []);
  const toggle = useCallback((key: keyof SmartToggles) => {
    touched.current = true;
    setToggles((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  /* ─── Generating ─────────────────────────────────────────────────────────── */

  const generate = useCallback(async () => {
    if (inFlight.current) return; // single flight: a second tap while a request is out does nothing
    const built = buildSmartInput(buildArgs());
    if (!built.ok) {
      setGeneration({ kind: "failed", failure: built.reason === "offline" ? "offline" : "unavailable" });
      return;
    }
    const { input: planInput } = built;
    const id = ++requestId.current;
    const startedScope = latest.current.scopeKey;
    const startedDate = latest.current.model.hotelDate;
    inFlight.current = true;
    setGeneration({ kind: "loading" });
    setPanel("setup");
    let raw: unknown;
    let failure: GenerationFailure | null = null;
    try {
      raw = await requestPlan(planInput.body);
    } catch (error) {
      failure = failureOf(error);
    }
    // A late answer for another request, hotel, person or day is ignored.
    if (id !== requestId.current || latest.current.scopeKey !== startedScope || latest.current.model.hotelDate !== startedDate || startedScope === null) {
      if (id === requestId.current) inFlight.current = false;
      return;
    }
    inFlight.current = false;
    if (failure) {
      setGeneration({ kind: "failed", failure });
      return;
    }
    const response: SmartBalanceResponse | null = parseSmartBalanceResponse(raw);
    const built2 = response ? buildSmartPlan(planInput, response, { scopeKey: startedScope, now: now(), model: latest.current.model }) : null;
    if (!built2 || !built2.ok) {
      setGeneration({ kind: "failed", failure: built2 && !built2.ok && built2.refusal === "wrong_day" ? "day_changed" : "unverified" });
      return;
    }
    setHistory([]);
    commit(built2.plan, null);
    setDetailUserId(null);
    setGeneration({ kind: "ready" });
    setPanel("preview");
  }, [buildArgs, commit, now, requestPlan]);

  const refreshAndReplan = useCallback(async () => {
    await input.refresh?.().catch(() => undefined);
    await settle();
    // The old plan is replaced, never patched; the supervisor's setup choices are kept.
    clearPlan();
    await generate();
  }, [clearPlan, generate, input, settle]);

  /* ─── Browsing the preview ───────────────────────────────────────────────── */

  const openDetail = useCallback((userId: string) => {
    setDetailUserId(userId);
    setPicker(null);
    setPanel("detail");
  }, []);
  const openExceptions = useCallback(() => setPanel("exceptions"), []);
  const openPicker = useCallback((next: SmartPicker) => setPicker(next), []);
  const back = useCallback(() => {
    if (picker) {
      setPicker(null);
      return;
    }
    if (panel === "detail" || panel === "exceptions" || panel === "conflict" || panel === "discard") {
      setPanel("preview");
      return;
    }
    close();
  }, [panel, picker, close]);

  /* ─── Editing the proposal (local only) ─────────────────────────────────── */

  const move = useCallback(
    (roomId: string, toUserId: string): EditRefusal | null => {
      const current = latest.current.plan;
      if (!current) return "unknown_room";
      const result = moveProposal(current, roomId, toUserId);
      if (!result.ok) return result.refusal;
      commit(result.plan, current);
      setPicker(null);
      return null;
    },
    [commit],
  );
  const remove = useCallback(
    (roomId: string): EditRefusal | null => {
      const current = latest.current.plan;
      if (!current) return "unknown_room";
      const result = removeProposal(current, roomId);
      if (!result.ok) return result.refusal;
      commit(result.plan, current);
      return null;
    },
    [commit],
  );
  const add = useCallback(
    (roomId: string, toUserId: string): EditRefusal | null => {
      const current = latest.current.plan;
      const entry = (latest.current.model.rooms ?? []).find((item) => item.room.roomId === roomId);
      if (!current || !entry) return "unknown_room";
      const result = addProposal(current, entry, toUserId);
      if (!result.ok) return result.refusal;
      commit(result.plan, current);
      setPicker(null);
      return null;
    },
    [commit],
  );
  const undo = useCallback(() => {
    setHistory((current) => {
      const previous = current[current.length - 1];
      if (!previous) return current;
      latest.current.plan = previous;
      setPlanState(previous);
      return current.slice(0, -1);
    });
  }, []);

  /* ─── Leaving ────────────────────────────────────────────────────────────── */

  const requestDiscard = useCallback(() => {
    const current = latest.current.plan;
    if (current && editedCount(current) > 0) setPanel("discard");
    else {
      clearPlan();
      setPanel(null);
    }
  }, [clearPlan]);
  const confirmDiscard = useCallback(() => {
    clearPlan();
    setPanel(null);
  }, [clearPlan]);

  /* ─── Into the unpublished draft ────────────────────────────────────────── */

  const draftOverlap = useMemo(() => {
    if (!plan || !draft.draft) return 0;
    const payload = stagePayloads(plan);
    return Object.keys(draft.draft.changes).filter((roomId) => roomId in payload.optimizer || roomId in payload.edited).length;
  }, [plan, draft.draft]);

  const addToDraft = useCallback(
    (resolution?: DraftResolution): AddOutcome => {
      const current = latest.current.plan;
      if (!current) return "nothing_added";
      if (!latest.current.isOnline || !latest.current.gate.allowed) return "blocked";
      if (planFreshness(latest.current.model, current, latest.current.scopeKey).length > 0) return "stale";
      const payload = stagePayloads(current);
      const held = latest.current.draft.draft;
      const existing = held ? Object.keys(held.changes) : [];
      const overlapping = existing.filter((roomId) => roomId in payload.optimizer || roomId in payload.edited);
      if (overlapping.length > 0 && !resolution) {
        setPanel("conflict");
        return "needs_resolution";
      }
      let optimizer = payload.optimizer;
      let edited = payload.edited;
      if (resolution === "replace") latest.current.draft.discard();
      else if (resolution === "merge") {
        // Keep what the supervisor already put in the draft: Smart Balance fills only the rooms the draft does not touch.
        const skip = new Set(overlapping);
        optimizer = Object.fromEntries(Object.entries(optimizer).filter(([roomId]) => !skip.has(roomId)));
        edited = Object.fromEntries(Object.entries(edited).filter(([roomId]) => !skip.has(roomId)));
      }
      const keptExisting = resolution === "replace" ? 0 : existing.length;
      const incoming = Object.keys(optimizer).length + Object.keys(edited).length;
      if (incoming + keptExisting > MAX_BATCH_CHANGES) {
        toast.error(t("assignments.v2.smart.draft.tooMany", { max: MAX_BATCH_CHANGES }));
        return "nothing_added";
      }
      const staged: string[] = [];
      let refused = 0;
      if (Object.keys(optimizer).length > 0) {
        const result = latest.current.draft.stage(optimizer, "smart_balance");
        staged.push(...result.staged);
        refused += result.rejected.length + result.overLimit.length;
      }
      if (Object.keys(edited).length > 0) {
        const result = latest.current.draft.stage(edited, "ai_editor");
        staged.push(...result.staged);
        refused += result.rejected.length + result.overLimit.length;
      }
      if (staged.length === 0 && incoming > 0) {
        toast.error(t("assignments.v2.smart.draft.nothingAdded"));
        return "nothing_added";
      }
      if (incoming === 0) toast.info(t("assignments.v2.smart.draft.keptYours"));
      else if (refused > 0) toast.info(t("assignments.v2.smart.draft.someRefused", { count: refused }));
      else toast.success(t("assignments.v2.smart.draft.added", { count: staged.length }));
      clearPlan();
      setPanel(null);
      input.onAdded?.(staged);
      showReview();
      return "added";
    },
    [clearPlan, input, showReview, t, toast],
  );

  return {
    panel,
    picker,
    scope,
    toggles,
    preferencesSource,
    generation,
    plan,
    preview,
    detailUserId,
    detail,
    stale,
    setup,
    paused,
    canUndo: history.length > 0,
    draftOverlap,
    open,
    close,
    setScope,
    toggle,
    generate,
    refreshAndReplan,
    openDetail,
    openExceptions,
    back,
    openPicker,
    move,
    add,
    remove,
    undo,
    requestDiscard,
    confirmDiscard,
    addToDraft,
  };
}
