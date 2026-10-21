import { memo, useEffect, useState, type ComponentProps } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { Answer, ChecklistItem, ItemAnswer, RequiredNaPolicy } from "@/lib/inspections/types";
import { canAnswerNa, naNeedsNote } from "@/lib/inspections/validation";
import { NOTE_MAX_LENGTH, hasGuidance, type AnswerRefusal } from "@/lib/inspections/workspace";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  item: ChecklistItem;
  answer: ItemAnswer | undefined;
  /** This item failed the inspection being re-checked. */
  failedBefore: boolean;
  policy: RequiredNaPolicy;
  t: Translate;
  /** The photo the draft holds for this item (only ever a failed item's). */
  photoUri: string | null;
  /** …whose file is no longer on the phone. */
  photoLost: boolean;
  onAnswer: (itemId: string, result: Answer) => AnswerRefusal | "blocked" | "confirm_loss" | null;
  onNote: (itemId: string, note: string) => void;
  onGuidance: (itemId: string) => void;
  /** Open the issue drawer for this item. */
  onEditIssue: (itemId: string) => void;
  /** Changing an issue that has details to `choice` needs the supervisor's say-so first. */
  onConfirmChange: (itemId: string, choice: Answer) => void;
  onPhotoUnreadable: (itemId: string) => void;
}

const CHOICES: { result: Answer; label: string }[] = [
  { result: "pass", label: "inspect.workspace.answer.pass" },
  { result: "fail", label: "inspect.workspace.answer.fail" },
  { result: "na", label: "inspect.workspace.answer.na" },
];

/**
 * One checklist question. Pass / Issue / N/A record an explicit answer (tap the chosen one again to undo it); nothing
 * is ever answered for the supervisor. Pass and N/A are one tap. Choosing Issue opens the issue drawer; the row then
 * summarises what was recorded (severity, description, photo) and says plainly what is still missing.
 */
function ChecklistItemRowView({ item, answer, failedBefore, policy, photoUri, photoLost, t, onAnswer, onNote, onGuidance, onEditIssue, onConfirmChange, onPhotoUnreadable }: Props) {
  const theme = useTheme();
  const [noteOpen, setNoteOpen] = useState(false);
  const [text, setText] = useState(answer?.note ?? "");
  const [hint, setHint] = useState<string | null>(null);

  // A cleared answer clears its note box; an answer carried in from a draft fills it.
  useEffect(() => {
    if (!answer) {
      setText("");
      setNoteOpen(false);
    } else if (answer.note !== undefined && answer.note !== text) {
      setText(answer.note);
    }
  }, [answer?.note, answer === undefined]);

  const result = answer?.result;
  const needsNote = result === "na" && naNeedsNote(item, policy);
  const noteMissing = needsNote && !(answer?.note ?? "").trim();
  const showNote = noteOpen || Boolean(answer?.note) || noteMissing;
  const naAllowed = canAnswerNa(item, policy);

  const choose = (choice: Answer) => {
    setHint(null);
    const outcome = onAnswer(item.id, choice);
    if (outcome === "confirm_loss") {
      onConfirmChange(item.id, choice);
      return;
    }
    if (outcome === "na_not_allowed") setHint(t("inspect.workspace.na.notAllowed"));
    if (choice === "na" && outcome === null && naNeedsNote(item, policy)) setNoteOpen(true);
    // A new issue asks for its details straight away; a plain Pass or N/A never does.
    if (choice === "fail" && outcome === null && result !== "fail") onEditIssue(item.id);
  };

  const tone = (choice: Answer) => {
    if (choice === "pass") return { fg: theme.status.ready, bg: theme.status.readySoft, line: theme.status.readyLine };
    if (choice === "fail") return { fg: theme.status.dirty, bg: theme.status.dirtySoft, line: theme.status.dirtyLine };
    return { fg: theme.textPrimary, bg: theme.surfaceMuted, line: theme.textSecondary };
  };

  const labelFor = (choice: Answer) => t(`inspect.workspace.answer.${choice}`);
  const accent = result === "fail" ? theme.status.dirty : result === "pass" ? theme.status.ready : result === "na" ? theme.textSecondary : theme.border;

  return (
    <View
      style={[styles.card, { backgroundColor: theme.surface, borderColor: result === "fail" ? theme.status.dirtyLine : theme.border }]}
      testID={`workspace-item-${item.id}`}
    >
      <View style={[styles.rail, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} numberOfLines={3} testID={`workspace-item-title-${item.id}`}>
            {item.description}
          </Text>
          {hasGuidance(item) ? (
            <Pressable
              onPress={() => onGuidance(item.id)}
              accessibilityRole="button"
              accessibilityLabel={t("inspect.workspace.item.guidanceA11y", { item: item.description })}
              hitSlop={6}
              style={styles.info}
              testID={`workspace-guidance-${item.id}`}
            >
              <Ionicons name="information-circle-outline" size={22} color={theme.primaryAction} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.tags}>
          {!item.isRequired ? <Tag label={t("inspect.workspace.item.optional")} color={theme.textMuted} /> : !answer ? <Tag label={t("inspect.workspace.item.required")} color={theme.status.pickup} /> : null}
          {item.requiresPhotoOnFail ? <Tag label={t("inspect.workspace.item.photoNeeded")} color={theme.textSecondary} icon="camera-outline" /> : null}
          {failedBefore ? <Tag label={t("inspect.workspace.item.failedBefore")} color={theme.status.pickup} icon="refresh-outline" /> : null}
        </View>

        <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={item.description}>
          {CHOICES.map(({ result: choice }) => {
            const selected = result === choice;
            const colors = tone(choice);
            const blocked = choice === "na" && !naAllowed;
            return (
              <Pressable
                key={choice}
                onPress={() => choose(choice)}
                accessibilityRole="radio"
                accessibilityLabel={t("inspect.workspace.answer.a11y", { answer: labelFor(choice), item: item.description })}
                accessibilityHint={selected ? t("inspect.workspace.answer.clearHint") : blocked ? t("inspect.workspace.na.notAllowed") : undefined}
                accessibilityState={{ checked: selected, selected, disabled: blocked }}
                testID={`workspace-answer-${item.id}-${choice}`}
                style={({ pressed }) => [
                  styles.choice,
                  { backgroundColor: selected ? colors.bg : theme.surface, borderColor: selected ? colors.line : theme.border },
                  blocked && !selected && { opacity: 0.45 },
                  pressed && { opacity: 0.8 },
                ]}
              >
                {selected ? <Ionicons name={choice === "pass" ? "checkmark" : choice === "fail" ? "alert" : "remove"} size={16} color={colors.fg} /> : null}
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.choiceText, { color: selected ? colors.fg : theme.textSecondary }]} numberOfLines={1}>
                  {labelFor(choice)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {hint ? (
          <Text accessibilityLiveRegion="polite" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.pickup }]} testID={`workspace-hint-${item.id}`}>
            {hint}
          </Text>
        ) : null}

        {result === "fail" ? (
          <Pressable
            onPress={() => onEditIssue(item.id)}
            accessibilityRole="button"
            accessibilityLabel={t("inspect.workspace.item.editIssueA11y", { item: item.description })}
            style={[styles.issueBox, { borderColor: theme.status.dirtyLine, backgroundColor: theme.status.dirtySoft }]}
            testID={`workspace-issue-edit-${item.id}`}
          >
            <View style={styles.issueRow}>
              <Ionicons name="alert-circle" size={16} color={theme.status.dirty} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.issueText, { color: theme.status.dirty }]} testID={`workspace-issue-${item.id}`}>
                {answer?.severity === undefined ? t("inspect.workspace.item.detailsNeeded") : t("inspect.workspace.item.issueRecorded")}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.issueText, { color: answer?.severity ? theme.textPrimary : theme.status.pickup }]} testID={`workspace-issue-severity-text-${item.id}`}>
              {answer?.severity ? t(`inspect.workspace.issue.severity.${answer.severity}`) : t("inspect.workspace.item.severityNeeded")}
            </Text>
            {answer?.note ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textPrimary }]} numberOfLines={2} testID={`workspace-has-note-${item.id}`}>
                {answer.note}
              </Text>
            ) : null}
            {photoUri && !photoLost ? (
              <View style={styles.photoLine}>
                <Image
                  source={{ uri: photoUri }}
                  style={styles.thumb}
                  resizeMode="cover"
                  accessibilityLabel={t("inspect.workspace.item.photoThumbA11y", { item: item.description })}
                  onError={() => onPhotoUnreadable(item.id)}
                  testID={`workspace-issue-thumb-${item.id}`}
                />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textSecondary }]}>
                  {t("inspect.workspace.item.photoAttached")}
                </Text>
              </View>
            ) : photoLost ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.issueText, { color: theme.status.pickup }]} testID={`workspace-issue-photo-state-${item.id}`}>
                {t("inspect.workspace.item.photoLost")}
              </Text>
            ) : item.requiresPhotoOnFail ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.issueText, { color: theme.status.pickup }]} testID={`workspace-issue-photo-state-${item.id}`}>
                {t("inspect.workspace.item.photoRequiredMissing")}
              </Text>
            ) : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.editLink, { color: theme.primaryAction }]}>
              {t("inspect.workspace.item.editIssue")}
            </Text>
          </Pressable>
        ) : null}

        {answer && result !== "fail" ? (
          showNote ? (
            <View style={styles.noteBox}>
              <TextInput
                value={text}
                onChangeText={(next) => {
                  setText(next);
                  onNote(item.id, next);
                }}
                placeholder={needsNote ? t("inspect.workspace.note.requiredPlaceholder") : t("inspect.workspace.note.placeholder")}
                placeholderTextColor={theme.textMuted}
                maxLength={NOTE_MAX_LENGTH}
                multiline
                accessibilityLabel={t("inspect.workspace.note.a11y", { item: item.description })}
                style={[styles.input, { color: theme.textPrimary, borderColor: noteMissing ? theme.status.pickup : theme.border, backgroundColor: theme.background }]}
                testID={`workspace-note-${item.id}`}
              />
              {noteMissing ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.status.pickup }]} testID={`workspace-note-required-${item.id}`}>
                  {t("inspect.workspace.note.required")}
                </Text>
              ) : null}
            </View>
          ) : (
            <Pressable
              onPress={() => setNoteOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t("inspect.workspace.note.addA11y", { item: item.description })}
              style={styles.addNote}
              testID={`workspace-add-note-${item.id}`}
            >
              <Ionicons name="create-outline" size={16} color={theme.primaryAction} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.addNoteText, { color: theme.primaryAction }]}>
                {t("inspect.workspace.note.add")}
              </Text>
            </Pressable>
          )
        ) : null}
      </View>
    </View>
  );
}

function Tag({ label, color, icon }: { label: string; color: string; icon?: ComponentProps<typeof Ionicons>["name"] }) {
  return (
    <View style={styles.tag}>
      {icon ? <Ionicons name={icon} size={12} color={color} /> : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.tagText, { color }]}>
        {label}
      </Text>
    </View>
  );
}

export const ChecklistItemRow = memo(ChecklistItemRowView);

const styles = StyleSheet.create({
  card: { overflow: "hidden", flexDirection: "row", borderWidth: 1, borderRadius: R.md },
  rail: { width: 4 },
  body: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  title: { flex: 1, minWidth: 0, fontSize: 16, lineHeight: 22, fontWeight: "700" },
  info: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  tag: { flexDirection: "row", alignItems: "center", gap: 4 },
  tagText: { fontSize: 12, fontWeight: "700" },
  choices: { flexDirection: "row", gap: 8 },
  choice: { flex: 1, minHeight: MIN_TARGET, borderWidth: 1.5, borderRadius: R.md, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  choiceText: { fontSize: 15, fontWeight: "800", flexShrink: 1 },
  hint: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  issueBox: { borderWidth: 1, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 8, gap: 4, minHeight: MIN_TARGET },
  issueRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  noteText: { fontSize: 14, lineHeight: 19, fontWeight: "600" },
  photoLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  thumb: { width: 44, height: 44, borderRadius: R.sm },
  editLink: { fontSize: 13.5, fontWeight: "800", marginTop: 2 },
  issueText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "700" },
  noteBox: { gap: 4 },
  input: { minHeight: 44, maxHeight: 120, borderWidth: 1, borderRadius: R.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, textAlignVertical: "top" },
  addNote: { minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  addNoteText: { fontSize: 13.5, fontWeight: "700" },
});
