import { ScrollView, StyleSheet } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PmCompletionSummary, type PmRecordedSummary } from "@/components/engineering/pm/PmCompletionSummary";
import type { PmCompletionResult } from "@/lib/api/pm";
import { formatDueDate } from "@/lib/engineering/pmSchedules";
import { assetRoute, isSafeRouteId, pmRecordRoute } from "@/lib/engineering/routes";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import { useAppStore } from "@/stores/appStore";

interface Props {
  scheduleId: string;
  summary: PmRecordedSummary;
  result: PmCompletionResult;
}

/** Times as the hotel's own clock and language show them; an unknown zone never hides the confirmation. */
function recordedAt(iso: string, language: string, zone: string | null | undefined): string | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  try {
    return at.toLocaleString(language.toLowerCase().startsWith("es") ? "es-US" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: zone ?? undefined });
  } catch {
    return null;
  }
}

/** The screen after the server confirmed a completion: what was recorded, the real work orders, and where to go next. */
export function PmRecordedView({ scheduleId, summary, result }: Props) {
  const { i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const equipment = assetRoute(summary.assetId);

  return (
    <ScrollView contentContainerStyle={[styles.pad, { paddingBottom: insets.bottom + 24 }]}>
      <PmCompletionSummary
        summary={summary}
        result={result}
        recordedAtLabel={recordedAt(result.completed_at, i18n.language, hotelTimezone)}
        nextDueLabel={formatDueDate(hotelDateKey(result.next_due_at, hotelTimezone), i18n.language)}
        onViewRecord={() => router.replace((pmRecordRoute(result.id, scheduleId) ?? "/(app)/pm-schedules") as never)}
        onViewEquipment={equipment ? () => router.push(equipment as never) : null}
        onOpenWorkOrder={(id) => {
          if (isSafeRouteId(id)) router.push(`/(app)/work-orders/${id}` as never);
        }}
        onDone={() => router.replace("/(app)/pm-schedules" as never)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 16 },
});
