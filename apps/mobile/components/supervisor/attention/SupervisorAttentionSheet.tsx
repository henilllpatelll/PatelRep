import { StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { SheetFact, SheetGone, SheetNotice, SheetSection } from "@/components/home/sheetParts";
import { Button } from "@/components/ui/Button";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { translateParams, type AttentionDetailView } from "@/lib/housekeeping/supervisorAttentionCenter";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

interface Props {
  visible: boolean;
  view: AttentionDetailView;
  isOnline: boolean;
  zone: string | null | undefined;
  language: string;
  t: Translate;
  onClose: () => void;
  /** Navigation is the screen's job; the sheet closes first, then calls this with the resolved primary. */
  onPrimary: (view: Extract<AttentionDetailView, { state: "ready" }>) => void;
}

/**
 * The detail for one attention item. It re-resolves against the live list on every render, so an item
 * that was resolved or changed while the sheet was open becomes a plain "no longer active" state with no
 * action on it. It explains and navigates; it never changes a room, a task or an assignment.
 */
export function SupervisorAttentionSheet({ visible, view, isOnline, zone, language, t, onClose, onPrimary }: Props) {
  const theme = useTheme();

  if (view.state === "gone") {
    return (
      <BottomSheet visible={visible} title={t("supervisorAttention.sheet.goneTitle")} onClose={onClose} grabber testID="attention-sheet">
        <SheetGone
          title={t("supervisorAttention.sheet.goneTitle")}
          body={t("supervisorAttention.sheet.goneBody")}
          closeLabel={t("supervisorAttention.sheet.goneClose")}
          onClose={onClose}
          testID="attention-sheet-gone"
        />
      </BottomSheet>
    );
  }

  const title = t(view.title.key, translateParams(t, view.title.params));
  const verifiedAt = view.source.fetchedAt ? formatHotelTime(new Date(view.source.fetchedAt), zone, language) : null;
  const sources = view.source.names.map((key) => t(key)).join(", ");
  const severity = t(`supervisorAttention.severity.${view.severity}`);

  return (
    <BottomSheet
      visible={visible}
      title={title}
      onClose={onClose}
      grabber
      testID="attention-sheet"
      footer={
        <View style={styles.footer}>
          <Button
            label={t(view.primary.labelKey)}
            onPress={() => onPrimary(view)}
            icon="arrow-forward-circle-outline"
            testID="attention-sheet-primary"
          />
          <Button label={t("supervisorAttention.sheet.close")} onPress={onClose} variant="secondary" testID="attention-sheet-close" />
        </View>
      }
    >
      <View style={styles.badges}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]} testID="attention-sheet-category">
          {t(`supervisorAttention.category.${view.category}`)}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.kicker, { color: view.severity === "critical" ? theme.status.dirty : view.severity === "high" ? theme.status.pickup : theme.textMuted }]}
          testID="attention-sheet-severity"
        >
          {`· ${severity}`}
        </Text>
      </View>

      {!isOnline ? <SheetNotice tone="warn" text={t("supervisorAttention.sheet.offlineNote")} testID="attention-sheet-offline" /> : null}

      <SheetSection title={t("supervisorAttention.sheet.whyHeading")}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID="attention-sheet-why">
          {t(view.whyKey, translateParams(t, view.whyParams))}
        </Text>
      </SheetSection>

      {view.facts.length > 0 ? (
        <SheetSection title={t("supervisorAttention.sheet.detailsHeading")}>
          {view.facts.map((fact, index) => (
            <SheetFact key={`${fact.key}-${index}`} icon={fact.icon} text={t(fact.key, translateParams(t, fact.params))} testID={`attention-sheet-fact-${index}`} />
          ))}
        </SheetSection>
      ) : null}

      {view.records.length > 0 ? (
        <SheetSection title={t("supervisorAttention.sheet.roomsHeading")}>
          {view.records.map((record) => (
            <View
              key={`${record.type}:${record.id}`}
              style={[styles.record, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
              accessible
              accessibilityLabel={[t("supervisorAttention.a11y.room", { label: record.label }), record.noteKey ? t(record.noteKey, translateParams(t, record.noteParams ?? {})) : null]
                .filter(Boolean)
                .join(". ")}
              testID={`attention-sheet-record-${record.id}`}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.recordLabel, { color: theme.textPrimary }]}>
                {record.label}
              </Text>
              {record.noteKey ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.recordNote, { color: theme.textSecondary }]}>
                  {t(record.noteKey, translateParams(t, record.noteParams ?? {}))}
                </Text>
              ) : null}
            </View>
          ))}
          {view.moreRecords > 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.more, { color: theme.textMuted }]} testID="attention-sheet-more">
              {t("supervisorAttention.sheet.moreRooms", { count: view.moreRecords })}
            </Text>
          ) : null}
        </SheetSection>
      ) : null}

      {view.restriction ? <SheetNotice tone="warn" text={t("supervisorAttention.sheet.restriction")} testID="attention-sheet-restriction" /> : null}

      <SheetSection title={t("supervisorAttention.sheet.sourceHeading")}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.source, { color: theme.textSecondary }]} testID="attention-sheet-source">
          {t("supervisorAttention.sheet.sourceLine", { sources })}
        </Text>
        {view.source.stale ? (
          <SheetNotice
            tone="warn"
            text={verifiedAt ? t("supervisorAttention.sheet.sourceStaleAt", { time: verifiedAt }) : t("supervisorAttention.sheet.sourceStale")}
            testID="attention-sheet-stale"
          />
        ) : null}
      </SheetSection>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { gap: 8 },
  badges: { flexDirection: "row", gap: 6 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase" },
  body: { fontSize: 15, lineHeight: 22 },
  source: { fontSize: 13, lineHeight: 18 },
  record: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, gap: 1 },
  recordLabel: { fontSize: 15, fontWeight: "800" },
  recordNote: { fontSize: 13, lineHeight: 18 },
  more: { fontSize: 12.5, fontWeight: "600", paddingHorizontal: 4 },
});
