import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { usePalette, type Palette } from "@/components/ai/palette";
import type { ActionItem } from "@/lib/ai/conversationState";
import {
  DRAFT_LIMITS,
  GUEST_CATEGORIES,
  TASK_PRIORITIES,
  WORK_ORDER_CATEGORIES,
  roomIsUnverified,
  validatePreview,
  type DraftPatch,
} from "@/lib/ai/drafts";

interface Props {
  item: ActionItem;
  onEdit: (patch: DraftPatch) => void;
  onConfirm: () => void;
  onDismiss: () => void;
  /** Tighter spacing for the corner card. */
  compact?: boolean;
  /** The confirm drawer owns Confirm / Cancel; show only the editable fields. */
  hideActions?: boolean;
  /** Pin a palette (the legacy corner card is always dark). */
  palette?: Palette;
}

function Chips<T extends string>({
  value,
  options,
  label,
  render,
  onPick,
  disabled,
  styles,
}: {
  value: T;
  options: readonly T[];
  label: string;
  render: (option: T) => string;
  onPick: (option: T) => void;
  disabled: boolean;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            disabled={disabled}
            onPress={() => onPick(option)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{render(option)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * One proposed action, as a form the person can correct before anything is created. The assistant never
 * creates it: "Create" is the explicit confirmation, it can only be pressed once at a time, and success is
 * shown only after the server says the record exists.
 */
export function ActionPreviewCard({ item, onEdit, onConfirm, onDismiss, compact, hideActions, palette }: Props) {
  const { t } = useTranslation();
  const theme = usePalette(palette);
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { preview, status } = item;
  const { draft } = preview;
  const locked = status === "confirming" || status === "confirmed";
  const errors = validatePreview(preview);
  const invalid = Object.keys(errors).length > 0;
  const unverifiedRoom = roomIsUnverified(draft);

  const errorText = (field: keyof typeof errors) => (errors[field] ? t(`copilot.action.errors.${errors[field]}`) : null);

  if (status === "dismissed") return null;

  return (
    <View style={[styles.card, compact && styles.cardCompact]} testID={`action-card-${preview.kind}`}>
      <Text style={styles.kicker}>{t(`copilot.action.kind.${preview.kind}`)}</Text>
      <Text style={styles.hint}>{t("copilot.action.reviewHint")}</Text>

      <Text style={styles.label}>{t("copilot.action.fields.title")}</Text>
      <TextInput
        style={[styles.input, errors.title && styles.inputError]}
        value={draft.title}
        onChangeText={(title) => onEdit({ title })}
        editable={!locked}
        maxLength={DRAFT_LIMITS.title + 20}
        accessibilityLabel={t("copilot.action.fields.title")}
        placeholderTextColor={theme.textMuted}
      />
      {errorText("title") ? <Text style={styles.error}>{errorText("title")}</Text> : null}

      <Text style={styles.label}>{t("copilot.action.fields.room")}</Text>
      <TextInput
        style={[styles.input, errors.roomNumber && styles.inputError]}
        value={draft.roomNumber}
        onChangeText={(roomNumber) => onEdit({ roomNumber })}
        editable={!locked}
        keyboardType="default"
        autoCapitalize="characters"
        maxLength={DRAFT_LIMITS.roomNumber}
        accessibilityLabel={t("copilot.action.fields.room")}
        placeholder={t("copilot.action.fields.roomPlaceholder")}
        placeholderTextColor={theme.textMuted}
      />
      {draft.roomNumber.trim() ? (
        unverifiedRoom ? (
          <Text style={styles.warn}>{t("copilot.action.roomUnverified", { room: draft.roomNumber.trim() })}</Text>
        ) : (
          <Text style={styles.ok}>{t("copilot.action.roomVerified", { room: draft.roomNumber.trim() })}</Text>
        )
      ) : null}

      {preview.kind === "work_order" ? (
        <>
          <Text style={styles.label}>{t("copilot.action.fields.place")}</Text>
          <TextInput
            style={[styles.input, errors.location && styles.inputError]}
            value={preview.draft.locationText}
            onChangeText={(locationText) => onEdit({ locationText })}
            editable={!locked}
            maxLength={DRAFT_LIMITS.location}
            accessibilityLabel={t("copilot.action.fields.place")}
            placeholderTextColor={theme.textMuted}
          />
          {errorText("location") ? <Text style={styles.error}>{errorText("location")}</Text> : null}
          <Text style={styles.label}>{t("copilot.action.fields.category")}</Text>
          <Chips
            styles={styles}
            value={preview.draft.category}
            options={WORK_ORDER_CATEGORIES}
            label={t("copilot.action.fields.category")}
            render={(option) => t(`copilot.action.workOrderCategory.${option}`)}
            onPick={(category) => onEdit({ category })}
            disabled={locked}
          />
        </>
      ) : null}

      {preview.kind === "guest_request" ? (
        <>
          <Text style={styles.label}>{t("copilot.action.fields.guestName")}</Text>
          <TextInput
            style={[styles.input, errors.guestName && styles.inputError]}
            value={preview.draft.guestName}
            onChangeText={(guestName) => onEdit({ guestName })}
            editable={!locked}
            maxLength={DRAFT_LIMITS.guestName + 20}
            accessibilityLabel={t("copilot.action.fields.guestName")}
            placeholderTextColor={theme.textMuted}
          />
          <Text style={styles.label}>{t("copilot.action.fields.category")}</Text>
          <Chips
            styles={styles}
            value={preview.draft.category}
            options={GUEST_CATEGORIES}
            label={t("copilot.action.fields.category")}
            render={(option) => t(`copilot.action.guestCategory.${option}`)}
            onPick={(category) => onEdit({ category })}
            disabled={locked}
          />
        </>
      ) : null}

      <Text style={styles.label}>{t("copilot.action.fields.priority")}</Text>
      <Chips
            styles={styles}
        value={draft.priority}
        options={preview.kind === "guest_request" ? (["normal", "urgent"] as const) : TASK_PRIORITIES}
        label={t("copilot.action.fields.priority")}
        render={(option) => t(`copilot.action.priority.${option}`)}
        // Accessibility requests are always urgent.
        onPick={(priority) => onEdit({ priority })}
        disabled={locked || (preview.kind === "guest_request" && preview.draft.category === "accessibility")}
      />

      <Text style={styles.label}>{t("copilot.action.fields.details")}</Text>
      <TextInput
        style={[styles.input, styles.multiline, errors.description && styles.inputError]}
        value={draft.description}
        onChangeText={(description) => onEdit({ description })}
        editable={!locked}
        multiline
        maxLength={DRAFT_LIMITS.description}
        accessibilityLabel={t("copilot.action.fields.details")}
        placeholderTextColor={theme.textMuted}
      />

      {status === "failed" && item.failure ? (
        <Text style={styles.error} accessibilityLiveRegion="polite" testID="action-failure">
          {item.failure === "invalid_request" && item.failureMessage
            ? item.failureMessage
            : t(`copilot.notice.${item.failure}`)}
        </Text>
      ) : null}

      {hideActions ? null : status === "confirmed" ? (
        <View style={styles.doneRow} accessibilityLiveRegion="polite" testID="action-confirmed">
          <Ionicons name="checkmark-circle" size={16} color={theme.status.ready} />
          <Text style={styles.doneText}>
            {item.deduplicated ? t("copilot.action.alreadyCreated") : t(`copilot.action.created.${preview.kind}`)}
          </Text>
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("copilot.create")}
            accessibilityState={{ disabled: locked || invalid, busy: status === "confirming" }}
            disabled={locked || invalid}
            onPress={onConfirm}
            style={[styles.primary, (locked || invalid) && styles.disabled]}
            testID="action-confirm"
          >
            {status === "confirming" ? (
              <ActivityIndicator size="small" color={theme.onPrimary} />
            ) : (
              <Text style={styles.primaryText}>{status === "failed" ? t("copilot.action.retry") : t("copilot.create")}</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("copilot.dismiss")}
            disabled={status === "confirming"}
            onPress={onDismiss}
            style={[styles.secondary, status === "confirming" && styles.disabled]}
            testID="action-dismiss"
          >
            <Text style={styles.secondaryText}>{t("copilot.dismiss")}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const makeStyles = (theme: Palette) => StyleSheet.create({
  card: {
    marginTop: 4,
    marginBottom: 10,
    backgroundColor: theme.surfaceElevated,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.ai.line,
    alignSelf: "stretch",
  },
  cardCompact: { padding: 10 },
  kicker: { fontSize: 11, color: theme.ai.primary, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  hint: { fontSize: 12, color: theme.textMuted, marginTop: 2, marginBottom: 6 },
  label: { fontSize: 11, color: theme.textMuted, fontWeight: "600", marginTop: 8, marginBottom: 4 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: theme.textPrimary,
    backgroundColor: theme.surface,
  },
  multiline: { minHeight: 64, textAlignVertical: "top" },
  inputError: { borderColor: theme.status.dirty },
  error: { fontSize: 12, color: theme.status.dirty, marginTop: 4 },
  warn: { fontSize: 12, color: theme.status.pickup, marginTop: 4 },
  ok: { fontSize: 12, color: theme.status.ready, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: {
    minHeight: 36,
    paddingHorizontal: 12,
    justifyContent: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  chipSelected: { backgroundColor: theme.ai.soft, borderColor: theme.ai.primary },
  chipText: { fontSize: 13, color: theme.textSecondary },
  chipTextSelected: { color: theme.textPrimary, fontWeight: "600" },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  primary: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: theme.primaryAction,
  },
  primaryText: { color: theme.onPrimary, fontSize: 14, fontWeight: "700" },
  secondary: {
    flex: 1,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surfaceElevated,
  },
  secondaryText: { color: theme.textSecondary, fontSize: 14, fontWeight: "600" },
  disabled: { opacity: 0.45 },
  doneRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  doneText: { fontSize: 13, color: theme.textPrimary, fontWeight: "600" },
});
