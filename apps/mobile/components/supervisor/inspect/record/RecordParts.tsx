import { useState, type ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { ResultBadge } from "@/components/supervisor/inspect/history/ResultBadge";
import type { AnswerResult, AnswerView, InfoRow, IssueView, SectionView } from "@/lib/inspections/history/record";
import type { RelatedInspection } from "@/lib/inspections/history/timeline";
import { resultOf } from "@/lib/inspections/history/rows";
import type { Translate } from "@/lib/inspections/viewText";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { useTheme } from "@/lib/theme/useTheme";

/** A titled block of the record. */
export function RecordSection({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: theme.surface, borderColor: theme.border }]} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.kicker, { color: theme.textMuted }]}>
        {title.toUpperCase()}
      </Text>
      {children}
    </View>
  );
}

/* ─── Inspection information ─────────────────────────────────────────────── */

export function InfoRows({ rows, t }: { rows: readonly InfoRow[]; t: Translate }) {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      {rows.map((row) => {
        const value = row.valueKey ? t(row.valueKey) : row.value;
        return (
          <View key={row.key} style={styles.infoRow} accessible accessibilityLabel={`${t(`inspect.history.record.info.${row.key}`)}: ${value ?? t("inspect.history.record.notRecorded")}`} testID={`record-info-${row.key}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoLabel, { color: theme.textMuted }]}>
              {t(`inspect.history.record.info.${row.key}`)}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.infoValue, { color: value ? theme.textPrimary : theme.textMuted }]}>
              {value ?? t("inspect.history.record.notRecorded")}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* ─── Evidence ───────────────────────────────────────────────────────────── */

/**
 * One recorded photo, as a thumbnail. A photo the record says exists but whose link can't be made now is shown as
 * unavailable (with a retry), never as if there had been no photo.
 */
export function EvidenceThumb({
  answer,
  uri,
  t,
  onOpen,
  onRetry,
}: {
  answer: AnswerView;
  /** The current signed link, or null when none could be made. */
  uri: string | null;
  t: Translate;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const theme = useTheme();
  const [broken, setBroken] = useState(false);
  const label = answer.description || t("inspect.history.record.standardRemoved");
  if (answer.evidence === "none") return null;
  if (!uri || broken) {
    return (
      <Pressable
        onPress={() => {
          setBroken(false);
          onRetry();
        }}
        accessibilityRole="button"
        accessibilityLabel={t("inspect.history.record.evidenceUnavailableA11y", { item: label })}
        testID={`evidence-unavailable-${answer.id}`}
        style={[styles.thumbMissing, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
      >
        <Ionicons name="image-outline" size={22} color={theme.textMuted} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.thumbMissingText, { color: theme.textMuted }]}>
          {t("inspect.history.record.evidenceUnavailable")}
        </Text>
      </Pressable>
    );
  }
  return (
    <Pressable onPress={onOpen} accessibilityRole="imagebutton" accessibilityLabel={t("inspect.history.record.evidenceA11y", { item: label })} testID={`evidence-thumb-${answer.id}`} style={styles.thumbWrap}>
      <Image source={{ uri }} style={[styles.thumb, { backgroundColor: theme.surfaceMuted }]} resizeMode="cover" onError={() => setBroken(true)} accessible={false} />
    </Pressable>
  );
}

/* ─── Issues found ───────────────────────────────────────────────────────── */

export function IssueList({
  issues,
  resolveUri,
  t,
  onOpenEvidence,
  onRetryEvidence,
}: {
  issues: readonly IssueView[];
  resolveUri: (issue: IssueView) => string | null;
  t: Translate;
  onOpenEvidence: (issue: IssueView) => void;
  onRetryEvidence: (issue: IssueView) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      {issues.map((issue) => (
        <View key={issue.id} style={[styles.issue, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} testID={`record-issue-${issue.id}`}>
          {issue.section ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
              {issue.section.toUpperCase()}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.issueTitle, { color: theme.textPrimary }]}>
            {issue.description || t("inspect.history.record.standardRemoved")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.status.dirty }]}>
            {t("inspect.history.record.resultFailed")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} testID={`record-issue-severity-${issue.id}`}>
            {issue.severity ? t("inspect.history.record.severity", { severity: t(`inspect.workspace.issue.severity.${issue.severity}`) }) : t("inspect.history.record.severityNotRecorded")}
          </Text>
          {issue.note ? (
            <View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
                {t("inspect.history.record.note").toUpperCase()}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]} testID={`record-issue-note-${issue.id}`}>
                {issue.note}
              </Text>
            </View>
          ) : null}
          {issue.evidence !== "none" ? (
            <View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.textMuted }]}>
                {t("inspect.history.record.evidence").toUpperCase()}
              </Text>
              <EvidenceThumb answer={issue} uri={resolveUri(issue)} t={t} onOpen={() => onOpenEvidence(issue)} onRetry={() => onRetryEvidence(issue)} />
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/* ─── Checklist ──────────────────────────────────────────────────────────── */

const ANSWER_ICON: Record<AnswerResult, React.ComponentProps<typeof Ionicons>["name"]> = {
  pass: "checkmark-circle-outline",
  fail: "close-circle-outline",
  na: "remove-circle-outline",
  unknown: "help-circle-outline",
};

export function ChecklistSections({ sections, defaultOpen, t }: { sections: readonly SectionView[]; defaultOpen: ReadonlySet<string>; t: Translate }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <View style={styles.stack}>
      {sections.map((section) => {
        const expanded = open[section.key] ?? defaultOpen.has(section.key);
        return <SectionCard key={section.key} section={section} expanded={expanded} t={t} onToggle={() => setOpen((previous) => ({ ...previous, [section.key]: !expanded }))} />;
      })}
    </View>
  );
}

function SectionCard({ section, expanded, t, onToggle }: { section: SectionView; expanded: boolean; t: Translate; onToggle: () => void }) {
  const theme = useTheme();
  const title = section.title ?? t("inspect.history.record.sectionOther");
  const tally = t("inspect.history.record.sectionTally", { passed: section.passed, total: section.answered });
  return (
    <View style={[styles.sectionCard, { borderColor: theme.border }]} testID={`record-section-${section.key}`}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={t("inspect.history.record.sectionA11y", { title, tally, na: section.na })}
        testID={`record-section-toggle-${section.key}`}
        style={styles.sectionHead}
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionTitle, { color: theme.textPrimary }]} numberOfLines={2}>
          {title.toUpperCase()}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionTally, { color: section.failed > 0 ? theme.status.dirty : theme.textSecondary }]}>
          {tally}
        </Text>
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={16} color={theme.textMuted} />
      </Pressable>
      {expanded ? (
        <View style={styles.answers}>
          {section.answers.map((answer) => (
            <View key={answer.id} style={styles.answerRow} accessible accessibilityLabel={t("inspect.history.record.answerA11y", { item: answer.description || t("inspect.history.record.standardRemoved"), result: t(`inspect.history.record.answer.${answer.result}`) })} testID={`record-answer-${answer.id}`}>
              <Ionicons name={ANSWER_ICON[answer.result]} size={18} color={answer.result === "fail" ? theme.status.dirty : theme.textMuted} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.answerText, { color: theme.textPrimary }]}>
                {answer.description || t("inspect.history.record.standardRemoved")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.answerResult, { color: answer.result === "fail" ? theme.status.dirty : theme.textSecondary }]}>
                {t(`inspect.history.record.answer.${answer.result}`)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ─── Related inspections ────────────────────────────────────────────────── */

export function RelatedList({ items, timeZone, language, t, onOpen }: { items: readonly RelatedInspection[]; timeZone: string | null | undefined; language: string; t: Translate; onOpen: (id: string) => void }) {
  const theme = useTheme();
  return (
    <View style={styles.stack}>
      {items.map((item) => {
        const clock = item.completedAtMs === null ? "—" : `${new Date(item.completedAtMs).toLocaleDateString(language === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", timeZone: timeZone ?? undefined })} · ${formatHotelTime(new Date(item.completedAtMs), timeZone, language) ?? ""}`;
        const role = t(`inspect.history.record.type.${item.role}`);
        return (
          <Pressable
            key={item.id}
            onPress={() => !item.current && onOpen(item.id)}
            disabled={item.current}
            accessibilityRole="button"
            accessibilityState={{ disabled: item.current, selected: item.current }}
            accessibilityLabel={t(item.current ? "inspect.history.record.relatedCurrentA11y" : "inspect.history.record.relatedA11y", { role, time: clock })}
            testID={`record-related-${item.id}`}
            style={({ pressed }) => [styles.related, { backgroundColor: item.current ? theme.surfaceMuted : theme.surface, borderColor: theme.border, opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={styles.relatedText}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.answerText, { color: theme.textPrimary }]}>
                {item.current ? t("inspect.history.record.relatedCurrent", { role }) : role}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textMuted }]}>
                {item.inspector ? `${clock} · ${item.inspector}` : clock}
              </Text>
            </View>
            <ResultBadge result={resultOf(item.result)} t={t} />
            {!item.current ? <Ionicons name="chevron-forward" size={14} color={theme.textDisabled} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 10 },
  kicker: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.8 },
  stack: { gap: 8 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, minHeight: 26 },
  infoLabel: { fontSize: 13.5, fontWeight: "600" },
  infoValue: { fontSize: 14.5, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  issue: { borderWidth: 1, borderRadius: R.md, padding: 12, gap: 6 },
  issueTitle: { fontSize: 16, fontWeight: "800", lineHeight: 22 },
  meta: { fontSize: 13, fontWeight: "600", lineHeight: 18 },
  body: { fontSize: 14.5, lineHeight: 21 },
  thumbWrap: { width: 96, height: 96, marginTop: 6 },
  thumb: { width: 96, height: 96, borderRadius: R.md },
  thumbMissing: { marginTop: 6, minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" },
  thumbMissingText: { fontSize: 13, fontWeight: "600", flexShrink: 1 },
  sectionCard: { borderWidth: 1, borderRadius: R.md, overflow: "hidden" },
  sectionHead: { minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  sectionTitle: { flex: 1, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  sectionTally: { fontSize: 13.5, fontWeight: "800" },
  answers: { paddingHorizontal: 12, paddingBottom: 10, gap: 8 },
  answerRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, minHeight: 26 },
  answerText: { flex: 1, fontSize: 14.5, lineHeight: 20 },
  answerResult: { fontSize: 13, fontWeight: "700" },
  related: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 8 },
  relatedText: { flex: 1, minWidth: 0, gap: 1 },
});
