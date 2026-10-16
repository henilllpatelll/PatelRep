import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SupervisorAttentionSheet } from "@/components/supervisor/attention/SupervisorAttentionSheet";
import { resolveAttentionDetail, type AttentionDetailView } from "@/lib/housekeeping/supervisorAttentionCenter";
import type { SupervisorToday } from "@/lib/housekeeping/supervisorToday";
import { assistantScope } from "@/lib/ai/session";
import { openSupervisorHref } from "@/lib/navigation/openSupervisorHref";
import { useAppStore } from "@/stores/appStore";
import { launchSupervisorCopilot } from "@/stores/supervisorCopilotStore";

export { openSupervisorHref };

interface Props {
  /** The item the sheet is open for; null = closed. */
  itemId: string | null;
  today: SupervisorToday;
  isOnline: boolean;
  zone: string | null | undefined;
  language: string;
  onClose: () => void;
}

/**
 * The Attention detail sheet, shared by Today and the Attention Center. It resolves the item from the
 * live `today` snapshot, so both screens show the same facts and a resolved item reads as "no longer active".
 */
export function AttentionSheetHost({ itemId, today, isOnline, zone, language, onClose }: Props) {
  const { t } = useTranslation();
  const someone = t("supervisorToday.attention.someone");
  const scope = assistantScope(useAppStore((state) => state.user));
  // The room comes from the verified detail view; the Copilot re-checks it against the board when it opens.
  const onAsk = useCallback(
    (room: { id: string; label: string }) => {
      onClose();
      launchSupervisorCopilot(scope, { roomId: room.id, roomNumber: room.label });
    },
    [onClose, scope],
  );
  const view = useMemo<AttentionDetailView>(
    () =>
      itemId
        ? resolveAttentionDetail(today.attention, today.sources, itemId, { now: today.generatedAt, zone, language, someone })
        : { state: "gone" },
    [itemId, today.attention, today.sources, today.generatedAt, zone, language, someone],
  );
  const onPrimary = useCallback(
    (ready: Extract<AttentionDetailView, { state: "ready" }>) => {
      onClose();
      openSupervisorHref(ready.primary.href);
    },
    [onClose],
  );
  if (!itemId) return null;
  return <SupervisorAttentionSheet visible view={view} isOnline={isOnline} zone={zone} language={language} t={t} onClose={onClose} onPrimary={onPrimary} onAsk={onAsk} />;
}
