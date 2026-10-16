import { useCallback, useMemo } from "react";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { SupervisorAttentionSheet } from "@/components/supervisor/attention/SupervisorAttentionSheet";
import { resolveAttentionDetail, type AttentionDetailView } from "@/lib/housekeeping/supervisorAttentionCenter";
import type { SupervisorToday } from "@/lib/housekeeping/supervisorToday";
import { isSupervisorSafePath, type SupervisorHref } from "@/lib/navigation/supervisorRoutes";

/** Open a supervisor destination. Refuses anything that is not a registered supervisor route. */
export function openSupervisorHref(href: SupervisorHref): boolean {
  if (!isSupervisorSafePath(href.pathname)) return false;
  router.push((href.params ? { pathname: href.pathname, params: href.params } : href.pathname) as never);
  return true;
}

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
  return <SupervisorAttentionSheet visible view={view} isOnline={isOnline} zone={zone} language={language} t={t} onClose={onClose} onPrimary={onPrimary} />;
}
