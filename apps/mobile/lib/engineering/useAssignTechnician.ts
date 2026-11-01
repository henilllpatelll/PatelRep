import { useCallback, useRef, useState } from "react";
import { assignWorkOrder, type AssignResult } from "@/lib/api/engineeringTeam";
import { emitAssignmentChanged } from "@/lib/engineering/teamEvents";
import { classifyAssignError, type AssignFailure } from "@/lib/engineering/teamModel";

export interface AssignHandle {
  busy: boolean;
  failure: AssignFailure | null;
  clearFailure: () => void;
  /** Resolves with the server's answer, or null when it was refused or not sent (see `failure`). */
  submit: (input: { workOrderId: string; assignedTo: string; expectedAssignedTo: string | null; note?: string }) => Promise<AssignResult | null>;
}

/**
 * One assignment at a time. The guard is a ref, so two taps in the same tick cannot send two requests. Success is
 * reported only after the server accepted it; a refusal keeps the sheet open with what went wrong.
 */
export function useAssignTechnician(online: boolean): AssignHandle {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<AssignFailure | null>(null);

  const submit = useCallback<AssignHandle["submit"]>(
    async (input) => {
      if (inFlight.current) return null;
      if (!online) {
        setFailure("offline");
        return null;
      }
      inFlight.current = true;
      setBusy(true);
      setFailure(null);
      try {
        const result = await assignWorkOrder(input);
        emitAssignmentChanged();
        return result;
      } catch (err) {
        setFailure(classifyAssignError(err));
        return null;
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [online],
  );

  return { busy, failure, clearFailure: () => setFailure(null), submit };
}
