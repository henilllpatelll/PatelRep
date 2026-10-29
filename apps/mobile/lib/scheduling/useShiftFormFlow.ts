import { useCallback, useState } from "react";
import {
  createShift,
  createShiftsBatch,
  failureFromBlocking,
  fetchShiftDetail,
  previewShifts,
  updateShift,
  type PreviewResult,
  type ScheduleWarning,
  type ShiftTemplate,
  type WriteFailure,
} from "@/lib/api/schedulingManage";
import type { TeamShift } from "@/lib/api/schedulingTeam";
import { buildInputs, buildPatch, diffShifts, draftFromShift, matchesIntent, type ChangedField, type FormMode, type ShiftDraft } from "@/lib/scheduling/shiftForm";
import { useWriteGuard } from "@/lib/scheduling/useWriteGuard";

/* The save flow behind Add / Edit / Copy Shift.

   create  validate with the server first (preview), then write. A single clean shift is written straight away; a
           recurring series, or anything with warnings or already-scheduled days, is shown for review first.
   edit    one guarded write carrying `expected_version`. If someone else changed the shift, nothing is overwritten:
           the server's current row is fetched, what differs is listed, and the person must save again on purpose.
   retry   a lost answer is `unconfirmed`. Repeating a create is safe (the server treats the same person/shift/date as
           already scheduled); repeating an edit is checked against the server's row, so an edit that did land is
           reported as saved instead of being applied twice or flagged as someone else's change. */

export type SavedKind = "created" | "updated";

export interface SavedSummary {
  kind: SavedKind;
  /** Shifts newly written (a recurring series can be many). */
  count: number;
  /** Shifts that were already scheduled exactly like this, so nothing new was written. */
  unchanged: number;
  warnings: ScheduleWarning[];
  /** The edit had already been saved by an earlier, unanswered attempt. */
  alreadySaved: boolean;
}

export type FlowStep = "form" | "review";

interface Args {
  mode: FormMode;
  source: TeamShift | null;
  templateOf: (id: string | null) => ShiftTemplate | null;
  onSaved: (summary: SavedSummary) => void;
  /** The shift no longer exists (removed by someone else): the form cannot continue. */
  onGone: () => void;
}

export function useShiftFormFlow({ mode, source, templateOf, onSaved, onGone }: Args) {
  const { busy, run } = useWriteGuard();
  const [original, setOriginal] = useState<TeamShift | null>(mode === "edit" ? source : null);
  const [step, setStep] = useState<FlowStep>("form");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [latest, setLatest] = useState<TeamShift | null>(null);

  const backToForm = useCallback(() => {
    setStep("form");
    setPreview(null);
    setFailure(null);
  }, []);

  const commitCreate = useCallback(
    async (draft: ShiftDraft, template: ShiftTemplate) => {
      const inputs = buildInputs(draft, template);
      if (inputs.length === 0) return;
      const series = inputs.length > 1 || draft.recurring;
      const res = await run(async (): Promise<SavedSummary> => {
        if (series) {
          const batch = await createShiftsBatch(inputs);
          return { kind: "created", count: batch.created, unchanged: batch.unchanged, warnings: batch.warnings, alreadySaved: false };
        }
        const one = await createShift(inputs[0]);
        return { kind: "created", count: one.created ? 1 : 0, unchanged: one.created ? 0 : 1, warnings: one.warnings, alreadySaved: false };
      });
      if (!res) return;
      if (!res.ok) {
        setFailure(res.failure);
        return;
      }
      onSaved(res.value);
    },
    [onSaved, run],
  );

  const saveEdit = useCallback(
    async (draft: ShiftDraft, template: ShiftTemplate) => {
      if (!original) return;
      const patch = buildPatch(original, draft, template);
      if (!patch) return;
      setFailure(null);
      const res = await run(() => updateShift(original.id, patch));
      if (!res) return;
      if (res.ok) {
        onSaved({ kind: "updated", count: 1, unchanged: 0, warnings: res.value.warnings, alreadySaved: false });
        return;
      }
      const failed = res.failure;
      if (failed.kind === "not_found") {
        onGone();
        return;
      }
      if (failed.kind === "version_conflict" || failed.kind === "unconfirmed") {
        // Compare with the server's row: our own earlier attempt may already have landed.
        let current = failed.current;
        if (!current) {
          try {
            current = (await fetchShiftDetail(original.id)).shift;
          } catch {
            current = null;
          }
        }
        if (current && matchesIntent(current, patch) && current.version > original.version) {
          onSaved({ kind: "updated", count: 1, unchanged: 0, warnings: [], alreadySaved: true });
          return;
        }
        if (current && failed.kind === "version_conflict") {
          setLatest(current);
          setFailure(failed);
          return;
        }
      }
      setFailure(failed);
    },
    [onGone, onSaved, original, run],
  );

  /** First press: validate (create) or write (edit). */
  const submit = useCallback(
    async (draft: ShiftDraft, template: ShiftTemplate) => {
      if (mode === "edit") {
        await saveEdit(draft, template);
        return;
      }
      const inputs = buildInputs(draft, template);
      if (inputs.length === 0) return;
      setFailure(null);
      const res = await run(() => previewShifts(inputs));
      if (!res) return;
      if (!res.ok) {
        setFailure(res.failure);
        return;
      }
      const result = res.value;
      if (!result.ok) {
        setFailure(result.blocking ? failureFromBlocking(result.blocking) : null);
        return;
      }
      setPreview(result);
      if (draft.recurring || result.warnings.length > 0 || result.unchangedCount > 0) {
        setStep("review");
        return;
      }
      await commitCreate(draft, template);
    },
    [commitCreate, mode, run, saveEdit],
  );

  /** Second press, from the review step: write exactly what was reviewed. */
  const confirm = useCallback(
    async (draft: ShiftDraft, template: ShiftTemplate) => {
      setFailure(null);
      await commitCreate(draft, template);
    },
    [commitCreate],
  );

  /** After a version conflict: adopt the server's row as the starting point. Nothing is saved by this. */
  const adoptLatest = useCallback((): ShiftDraft | null => {
    if (!latest) return null;
    const draft = draftFromShift(latest, templateOf(latest.shiftId), latest.departmentId);
    setOriginal(latest);
    setLatest(null);
    setFailure(null);
    return draft;
  }, [latest, templateOf]);

  const changedFields: ChangedField[] = original && latest ? diffShifts(original, latest) : [];

  return { busy, step, preview, failure, latest, changedFields, original, submit, confirm, backToForm, adoptLatest, clearFailure: () => setFailure(null) };
}
