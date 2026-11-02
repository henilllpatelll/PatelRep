import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { SettingsSection } from "@/components/settings/SettingsSection";
import { useTextContext } from "@/components/housekeeping/useTextContext";
import { formatClock } from "@/lib/housekeeping/myRoomsText";
import type { PmDraftSummary } from "@/lib/engineering/pmDraftStore";
import type { PmQueuedItem } from "@/lib/engineering/pmSyncItems";
import { needsPerson, stateLabelKey } from "@/lib/engineering/pmSyncState";
import { SETTINGS_MAX_FONT_SCALE as MAX_FONT_SCALE } from "@/lib/settings/a11y";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  items: readonly PmQueuedItem[];
  drafts: readonly PmDraftSummary[];
  loaded: boolean;
  onRetry: (rowId: number) => void;
  onSubmitAnyway: (rowId: number) => void;
  onDiscard: (rowId: number) => void;
}

const inspectionRoute = (scheduleId: string) => `/(app)/pm-schedules/inspect/${scheduleId}` as never;

/**
 * Saved PM inspections and unfinished drafts, from the real queue and the real drafts. Every line says in words where the
 * work stands (waiting, syncing, needs review, could not sync) - none is ever shown as recorded, because a recorded
 * inspection leaves this list. Discarding is a deliberate second tap and only removes unsent work from this phone.
 */
export function PmSyncSection({ items, drafts, loaded, onRetry, onSubmitAnyway, onDiscard }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const ctx = useTextContext();
  const [confirming, setConfirming] = useState<number | null>(null);

  return (
    <>
      <SettingsSection title={t("engineeringSync.pm.title")} testID="esync-pm">
        {items.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="esync-pm-empty">
            {loaded ? t("engineeringSync.pm.none") : t("engineeringSync.unreadable")}
          </Text>
        ) : (
          <View style={styles.list}>
            {items.map((item) => {
              const attention = needsPerson(item.state);
              const saved = formatClock(item.savedAt, ctx);
              return (
                <View key={item.rowId} style={[styles.item, { borderColor: attention ? theme.status.dirtyLine : theme.border }]} testID={`esync-pm-item-${item.rowId}`}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.strong, { color: theme.textPrimary }]}>
                    {item.label}
                  </Text>
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={[styles.state, { color: attention ? theme.status.dirty : theme.textSecondary }]}
                    accessibilityLiveRegion="polite"
                    testID={`esync-pm-state-${item.rowId}`}
                  >
                    {t(stateLabelKey(item.state))}
                  </Text>
                  {item.stop ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
                      {t(`engineeringSync.pm.stop.${item.stop}`, { defaultValue: t("engineeringSync.pm.stop.invalid") })}
                    </Text>
                  ) : null}
                  {item.unknownOutcome && !item.stop ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
                      {t("engineeringSync.pm.unknownNote")}
                    </Text>
                  ) : null}
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                    {[item.photos > 0 ? t("engineeringSync.pm.photosLabel", { count: item.photos }) : null, saved].filter(Boolean).join(" · ")}
                  </Text>
                  <View style={styles.actions}>
                    {item.canOpen && item.scheduleId ? (
                      <Button label={t("engineeringSync.pm.open")} variant="secondary" size="sm" onPress={() => router.push(inspectionRoute(item.scheduleId as string))} testID={`esync-pm-open-${item.rowId}`} />
                    ) : null}
                    {item.canRetry ? <Button label={t("engineeringSync.pm.retry")} variant="secondary" size="sm" onPress={() => onRetry(item.rowId)} testID={`esync-pm-retry-${item.rowId}`} /> : null}
                    {item.canSubmitAnyway ? (
                      <Button label={t("engineeringSync.pm.submitAnyway")} variant="secondary" size="sm" onPress={() => onSubmitAnyway(item.rowId)} testID={`esync-pm-anyway-${item.rowId}`} />
                    ) : null}
                    {confirming === item.rowId ? (
                      <Button
                        label={t("engineeringSync.pm.confirmDiscard")}
                        variant="destructive"
                        size="sm"
                        onPress={() => {
                          setConfirming(null);
                          onDiscard(item.rowId);
                        }}
                        testID={`esync-pm-discard-confirm-${item.rowId}`}
                      />
                    ) : (
                      <Button label={t("engineeringSync.pm.discard")} variant="ghost" size="sm" onPress={() => setConfirming(item.rowId)} testID={`esync-pm-discard-${item.rowId}`} />
                    )}
                  </View>
                  {confirming === item.rowId ? (
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                      {t("engineeringSync.pm.discardWarning")}
                    </Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </SettingsSection>

      <SettingsSection title={t("engineeringSync.pm.draftsTitle")} testID="esync-pm-drafts">
        {drafts.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="esync-pm-drafts-empty">
            {t("engineeringSync.pm.draftsNone")}
          </Text>
        ) : (
          <View style={styles.list}>
            {drafts.map((draft) => (
              <View key={draft.scheduleId} style={[styles.item, { borderColor: theme.border }]} testID={`esync-pm-draft-${draft.scheduleId}`}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.strong, { color: theme.textPrimary }]}>
                  {draft.label ?? t("pm.inspection")}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.state, { color: theme.textSecondary }]}>
                  {t(stateLabelKey("local_draft"))}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                  {[t("engineeringSync.pm.draftProgress", { answered: draft.answered, total: draft.total }), t("engineeringSync.pm.draftsHint")].join(" · ")}
                </Text>
                <View style={styles.actions}>
                  <Button label={t("engineeringSync.pm.continue")} variant="secondary" size="sm" onPress={() => router.push(inspectionRoute(draft.scheduleId))} testID={`esync-pm-continue-${draft.scheduleId}`} />
                </View>
              </View>
            ))}
          </View>
        )}
      </SettingsSection>
    </>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, padding: 12 },
  item: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  strong: { fontSize: 15, fontWeight: "700" },
  state: { fontSize: 13, fontWeight: "700" },
  meta: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  empty: { fontSize: 14, padding: 14 },
});
