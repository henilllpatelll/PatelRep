import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import type { RoomClassification } from "@/lib/housekeeping/needsAttention";
import { formatClock, type TextContext } from "@/lib/housekeeping/myRoomsText";
import { resolveReturnTime } from "@/lib/housekeeping/hotelTime";
import type { AttemptResult } from "@/lib/housekeeping/serviceAttempts";

const MAX_FONT_SCALE = 1.6;
const TIME_PRESETS = ["11:00 AM", "12:00 PM", "1:00 PM", "2:00 PM", "3:00 PM"];

interface RoomRestrictionPanelProps {
  room: Room;
  classification: RoomClassification;
  ctx: TextContext;
  isOnline: boolean;
  busy: boolean;
  supervisorNotified: boolean;
  notifying: boolean;
  /** Record a pre-entry attempt on the server. Resolves true when it was recorded. */
  onRecord: (result: AttemptResult, returnAt?: string) => Promise<boolean>;
  onNotifySupervisor: () => void;
  onReturnToRoute: () => void;
  /**
   * Room Detail's sticky bar owns "Record attempt" and "Back to route": it can
   * open the attempt options from outside (recordOpen) and hide the panel's own
   * copies of those two buttons (compact). Standalone use is unchanged.
   */
  recordOpen?: boolean;
  onRecordOpenChange?: (open: boolean) => void;
  compact?: boolean;
}

type PanelKind = "dnd" | "do_not_service" | "service_declined" | "come_back_later" | "retry_due";

function panelKind(room: Room, c: RoomClassification): PanelKind | null {
  if (c.reasons.includes("dnd")) return "dnd";
  if (c.reasons.includes("do_not_service")) return "do_not_service";
  if (c.reasons.includes("service_declined")) return "service_declined";
  if (c.reasons.includes("come_back_later")) return "come_back_later";
  // The agreed retry has arrived: not a restriction any more, but worth saying.
  if (!room.dnd_flag && c.retry?.due) return "retry_due";
  return null;
}

export function hasRestrictionPanel(room: Room, c: RoomClassification): boolean {
  return panelKind(room, c) !== null;
}

/**
 * Authoritative DND / Do Not Service / declined / come-back-later state for the
 * room, with the persisted attempt history. Anything the server does not know
 * is shown as unknown — never as "no restriction".
 */
export function RoomRestrictionPanel({
  room,
  classification,
  ctx,
  isOnline,
  busy,
  supervisorNotified,
  notifying,
  onRecord,
  onNotifySupervisor,
  onReturnToRoute,
  recordOpen,
  onRecordOpenChange,
  compact = false,
}: RoomRestrictionPanelProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [openState, setOpenState] = useState(false);
  const open = recordOpen ?? openState;
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const value = typeof next === "function" ? next(open) : next;
    setOpenState(value);
    onRecordOpenChange?.(value);
  };
  const [askTime, setAskTime] = useState(false);
  const [timeText, setTimeText] = useState("");
  const [timeError, setTimeError] = useState<string | null>(null);

  const kind = panelKind(room, classification);
  if (!kind) return null;

  const retry = classification.retry;
  const lastAttempt = formatClock(retry?.lastAttemptAt, ctx);
  const retryTime = formatClock(retry?.at, ctx);
  const restricted = kind !== "retry_due";
  const canRecord = kind === "dnd" || kind === "come_back_later" || kind === "retry_due";
  const options: AttemptResult[] =
    kind === "dnd"
      ? ["dnd_no_response", "return_later", "guest_answered", "dnd_cleared"]
      : ["dnd_no_response", "return_later", "guest_answered"];
  const showHistory = kind === "dnd" || kind === "come_back_later" || kind === "retry_due" || (retry?.attempts ?? 0) > 0;
  const accent = restricted ? theme.status.dirty : theme.status.pickup;

  async function choose(result: AttemptResult) {
    if (result === "return_later") {
      setAskTime(true);
      setTimeError(null);
      return;
    }
    const saved = await onRecord(result);
    if (saved) {
      setOpen(false);
      setAskTime(false);
    }
  }

  async function submitTime(text: string) {
    const resolved = resolveReturnTime(text, ctx.timeZone);
    if (!resolved.ok) {
      setTimeError(t(resolved.reason === "past" ? "rooms.dash.detail.restriction.timePast" : "rooms.dash.detail.restriction.timeInvalid"));
      return;
    }
    setTimeError(null);
    const saved = await onRecord("return_later", resolved.iso);
    if (saved) {
      setOpen(false);
      setAskTime(false);
      setTimeText("");
    }
  }

  return (
    <View
      testID="restriction-panel"
      accessibilityRole="alert"
      style={[
        styles.panel,
        {
          backgroundColor: restricted ? theme.status.dirtySoft : theme.status.pickupSoft,
          borderColor: restricted ? theme.status.dirtyLine : theme.status.pickupLine,
        },
      ]}
    >
      {restricted ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heading, { color: accent }]}>
          {t("rooms.dash.detail.restriction.doNotEnter")}
        </Text>
      ) : null}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
        {kind === "retry_due"
          ? t("rooms.dash.detail.restriction.retryDue")
          : t(`rooms.dash.detail.restriction.${kind}`)}
      </Text>

      {kind === "service_declined" && room.service_declined_note?.trim() ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
          {room.service_declined_note.trim()}
        </Text>
      ) : null}

      {showHistory ? (
        <View style={styles.history}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
            {lastAttempt
              ? t("rooms.dash.detail.restriction.lastAttempt", { time: lastAttempt })
              : t("rooms.dash.detail.restriction.lastAttemptUnknown")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
            {t("rooms.dash.detail.restriction.attempts", { count: retry?.attempts ?? 0 })}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]}>
            {retryTime
              ? t("rooms.dash.detail.restriction.retry", { time: retryTime })
              : t("rooms.dash.detail.restriction.retryUnset")}
          </Text>
        </View>
      ) : null}

      {!isOnline && canRecord ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.status.pickup }]}>
          {t("rooms.dash.detail.restriction.needsConnection")}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {canRecord && !compact ? (
          <ActionButton
            label={t("rooms.dash.detail.restriction.recordAttempt")}
            onPress={() => setOpen((value) => !value)}
            disabled={busy || !isOnline}
            primary
            testID="restriction-record"
          />
        ) : null}

        {open && canRecord ? (
          <View style={styles.options}>
            {options.map((result) => (
              <ActionButton
                key={result}
                label={t(`rooms.dash.detail.restriction.options.${result}`)}
                onPress={() => void choose(result)}
                disabled={busy}
                testID={`restriction-option-${result}`}
              />
            ))}
          </View>
        ) : null}

        {open && askTime ? (
          <View style={styles.timeBox}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textPrimary }]}>
              {t("rooms.dash.detail.restriction.timePrompt")}
            </Text>
            <View style={styles.presets}>
              {TIME_PRESETS.map((preset) => (
                <ActionButton key={preset} label={preset} onPress={() => void submitTime(preset)} disabled={busy} compact />
              ))}
            </View>
            <TextInput
              value={timeText}
              onChangeText={(value) => {
                setTimeText(value);
                setTimeError(null);
              }}
              placeholder={t("rooms.dash.detail.restriction.timePlaceholder")}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={t("rooms.dash.detail.restriction.timePrompt")}
              autoCapitalize="characters"
              autoCorrect={false}
              style={[styles.timeInput, { color: theme.textPrimary, borderColor: theme.border, backgroundColor: theme.surface }]}
              testID="restriction-time-input"
            />
            {timeError ? (
              <Text accessibilityRole="alert" style={[styles.meta, { color: theme.status.dirty }]}>
                {timeError}
              </Text>
            ) : null}
            <ActionButton
              label={t("rooms.dash.detail.restriction.confirmTime")}
              onPress={() => void submitTime(timeText)}
              disabled={busy || !timeText.trim()}
              testID="restriction-time-confirm"
            />
          </View>
        ) : null}

        <ActionButton
          label={supervisorNotified ? t("rooms.dash.detail.restriction.notified") : t("rooms.dash.detail.restriction.notifySupervisor")}
          onPress={onNotifySupervisor}
          disabled={!isOnline || notifying || supervisorNotified}
          testID="restriction-notify"
        />
        {compact ? null : (
          <ActionButton label={t("rooms.dash.detail.restriction.returnToRoute")} onPress={onReturnToRoute} testID="restriction-return" />
        )}
        {busy || notifying ? <ActivityIndicator color={theme.primaryAction} /> : null}
      </View>
    </View>
  );
}

function ActionButton({
  label,
  onPress,
  disabled,
  primary,
  compact,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
  compact?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      testID={testID}
      style={[
        styles.button,
        compact && styles.buttonCompact,
        primary
          ? { backgroundColor: theme.primaryAction, borderColor: theme.primaryAction }
          : { backgroundColor: theme.surface, borderColor: theme.border },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.buttonText, { color: primary ? theme.onPrimary : theme.textPrimary }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1.5, borderRadius: 16, padding: 16, gap: 8, marginBottom: 12 },
  heading: { fontSize: 18, fontWeight: "900", letterSpacing: 0.6 },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  meta: { fontSize: 14, lineHeight: 20 },
  history: { gap: 2 },
  actions: { gap: 8, marginTop: 4 },
  options: { gap: 8 },
  timeBox: { gap: 8 },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  timeInput: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  button: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  buttonCompact: { minHeight: 44, minWidth: 88 },
  buttonText: { fontSize: 15, fontWeight: "800", textAlign: "center" },
});
