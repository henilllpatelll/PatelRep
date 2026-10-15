import { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { PostCompletionState, type CompletionOutcome } from "@/components/home/PostCompletionState";
import { SheetGone, SheetNotice } from "@/components/home/sheetParts";
import { useScreenReaderEnabled } from "@/lib/accessibility/useScreenReader";
import { useReducedMotion } from "@/lib/accessibility/useReducedMotion";
import type { HomeModel } from "@/lib/housekeeping/homeModel";
import { findRoomEntry } from "@/lib/housekeeping/homeSheets";
import { blockMessageKey, rejectionNeedsRoom, resolveMarkCleanReadiness } from "@/lib/housekeeping/markCleanReadiness";
import { markRoomClean } from "@/lib/housekeeping/markClean";
import type { TextContext, Translate } from "@/lib/housekeeping/myRoomsText";
import { nextRoomAfter } from "@/lib/housekeeping/postCompletion";
import { useHousekeeperAccent, useTheme } from "@/lib/theme/useTheme";
import { selectSession, useCleanSessionStore } from "@/stores/cleanSessionStore";

const HOLD_DURATION_MS = 700;
/** At most this many unfinished items are named; the rest are counted. */
const MISSING_SHOWN = 3;

interface Rejection {
  code: string;
  message: string;
  missing: string[];
}

type Stage = "confirm" | "submitting" | "done";

interface Props {
  visible: boolean;
  roomId: string;
  model: HomeModel;
  isOnline: boolean;
  t: Translate;
  ctx: TextContext;
  onClose: () => void;
  /** Leaves the sheet for the room screen (checklist, linen, conflicts). */
  onOpenRoom: (roomId: string) => void;
  onOpenSync: () => void;
  /** The server confirmed the completion. */
  onConfirmed: (roomId: string) => void;
}

/**
 * Submitting a room as Clean, in one sheet from start to finish. It asks the
 * live model whether the room can be submitted right now (assigned, not
 * restricted, session valid, required items done, not a departure that needs
 * linen counts), keeps the protected hold-to-confirm gesture, and offers an
 * explicit tap alternative that runs the very same checks and the same single
 * server transition. The room is only called Clean once the server says so;
 * offline it is "saved on this phone". It never marks a room inspected.
 */
export function MarkCleanConfirmationSheet({ visible, roomId, model, isOnline, t, ctx, onClose, onOpenRoom, onOpenSync, onConfirmed }: Props) {
  const theme = useTheme();
  const accent = useHousekeeperAccent();
  const screenReader = useScreenReaderEnabled();
  const reducedMotion = useReducedMotion();
  const session = useCleanSessionStore(selectSession(roomId));
  const entry = findRoomEntry(model, roomId);

  const [stage, setStage] = useState<Stage>("confirm");
  const [outcome, setOutcome] = useState<{ kind: CompletionOutcome; roomNumber: string } | null>(null);
  const [rejection, setRejection] = useState<Rejection | null>(null);
  const [restoring, setRestoring] = useState(false);

  const readiness = resolveMarkCleanReadiness({ model, roomId, session, isOnline });
  const readinessRef = useRef(readiness);
  readinessRef.current = readiness;
  const entryRef = useRef(entry);
  entryRef.current = entry;
  const submitting = useRef(false);
  const mounted = useRef(true);
  const fill = useRef(new Animated.Value(0)).current;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (holdTimer.current) clearTimeout(holdTimer.current);
    };
  }, []);

  // Bring this phone's copy of the session up to date with the server (read-only for an open session).
  const roomStatus = entry?.room.status;
  useEffect(() => {
    if (!visible || !isOnline || !roomStatus || stage !== "confirm") return;
    let cancelled = false;
    setRestoring(true);
    void useCleanSessionStore
      .getState()
      .restoreForRoom({ id: roomId, status: roomStatus })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, isOnline, roomId]);

  const cancelHold = useCallback(
    (duration = 150) => {
      if (holdTimer.current) {
        clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      Animated.timing(fill, { toValue: 0, duration, useNativeDriver: false }).start();
    },
    [fill],
  );

  // A hold never survives the app leaving the foreground or the sheet closing.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") cancelHold(0);
    });
    return () => sub.remove();
  }, [cancelHold]);
  useEffect(() => {
    if (!visible) cancelHold(0);
  }, [visible, cancelHold]);

  const submit = useCallback(async () => {
    // Re-checked at the moment of confirming: the model may have moved since the sheet opened.
    const ready = readinessRef.current;
    const current = entryRef.current;
    if (submitting.current || ready.state !== "ready" || !current) return;
    submitting.current = true;
    setRejection(null);
    setStage("submitting");
    try {
      const result = await markRoomClean(current.room);
      if (result.outcome === "confirmed") onConfirmed(roomId);
      if (!mounted.current) return;
      if (result.outcome === "rejected") {
        setRejection({ code: result.code, message: result.message, missing: result.missing ?? [] });
        setStage("confirm");
      } else {
        setOutcome({ kind: result.outcome, roomNumber: ready.roomNumber });
        setStage("done");
      }
    } catch (err) {
      if (!mounted.current) return;
      setRejection({ code: "UNKNOWN", message: err instanceof Error ? err.message : "", missing: [] });
      setStage("confirm");
    } finally {
      submitting.current = false;
      cancelHold(0);
    }
  }, [cancelHold, onConfirmed, roomId]);

  const onHoldStart = () => {
    if (readinessRef.current.state !== "ready" || submitting.current) return;
    Animated.timing(fill, { toValue: 1, duration: HOLD_DURATION_MS, easing: Easing.linear, useNativeDriver: false }).start();
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      void submit();
    }, HOLD_DURATION_MS);
  };

  const roomNumber = entry?.room.room_number ?? (readiness.state === "blocked" ? readiness.roomNumber : null) ?? "";
  const busy = stage === "submitting";

  /* ─── Done: submitted (or saved on this phone) ─────────────────────────────── */
  if (stage === "done" && outcome) {
    const next = nextRoomAfter(model, roomId);
    return (
      <BottomSheet
        visible={visible}
        title={t(`home.postComplete.${outcome.kind}Heading`, { room: outcome.roomNumber })}
        onClose={onClose}
        grabber
        testID="mark-clean-sheet"
      >
        <PostCompletionState
          outcome={outcome.kind}
          roomNumber={outcome.roomNumber}
          next={next}
          t={t}
          ctx={ctx}
          onOpenNext={onOpenRoom}
          onOpenSync={onOpenSync}
          onBackHome={onClose}
        />
      </BottomSheet>
    );
  }

  /* ─── The room is no longer here ───────────────────────────────────────────── */
  if (readiness.state === "blocked" && (readiness.reason === "not_assigned" || readiness.reason === "already_done") && !busy) {
    return (
      <BottomSheet visible={visible} title={t("home.markClean.titleGeneric")} onClose={onClose} grabber testID="mark-clean-sheet">
        <SheetGone
          title={t(`${blockMessageKey(readiness.reason)}.title`)}
          body={t(`${blockMessageKey(readiness.reason)}.body`, { room: roomNumber })}
          closeLabel={t("home.markClean.backHome")}
          onClose={onClose}
          testID="mark-clean-gone"
        />
      </BottomSheet>
    );
  }

  const rejectionText = rejection ? rejectionMessage(rejection, t) : null;
  const missingList = (readiness.state === "blocked" ? readiness.missing : rejection?.missing) ?? [];
  const showHold = readiness.state === "ready" && !screenReader && !reducedMotion && !busy;

  return (
    <BottomSheet
      visible={visible}
      title={t("home.markClean.title", { room: roomNumber })}
      onClose={onClose}
      grabber
      testID="mark-clean-sheet"
      footer={
        readiness.state === "ready" ? (
          <>
            {showHold ? (
              <>
                <Pressable
                  onPressIn={onHoldStart}
                  onPressOut={() => cancelHold()}
                  accessibilityRole="button"
                  accessibilityLabel={t("home.markClean.holdCta")}
                  accessibilityHint={t("home.markClean.holdHint")}
                  testID="mark-clean-hold"
                  style={[styles.holdBtn, { backgroundColor: accent.bgPressed }]}
                >
                  <Animated.View
                    style={[styles.holdFill, { backgroundColor: accent.bg, width: fill.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]}
                  />
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.holdText, { color: theme.onPrimary }]}>
                    {t("home.markClean.holdCta")}
                  </Text>
                </Pressable>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.release, { color: theme.textMuted }]}>
                  {t("home.markClean.releaseHint")}
                </Text>
              </>
            ) : null}
            <Button
              label={t(showHold ? "home.markClean.tapInstead" : "home.markClean.tapCta")}
              onPress={() => void submit()}
              variant={showHold ? "secondary" : "primary"}
              size={showHold ? "md" : "lg"}
              loading={busy}
              disabled={busy}
              accessibilityLabel={t("home.markClean.tapA11y", { room: roomNumber })}
              testID="mark-clean-tap"
            />
          </>
        ) : readiness.action === "none" ? (
          <Button label={t("home.markClean.backHome")} onPress={onClose} variant="secondary" testID="mark-clean-close" />
        ) : (
          <>
            <Button
              label={t(readiness.action === "finish_checklist" ? "home.markClean.finishChecklist" : "home.markClean.openRoom")}
              onPress={() => onOpenRoom(roomId)}
              size="lg"
              testID="mark-clean-open-room"
            />
            <Button label={t("home.markClean.backHome")} onPress={onClose} variant="secondary" testID="mark-clean-close" />
          </>
        )
      }
    >
      {restoring && !session && isOnline ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]} testID="mark-clean-loading">
          {t("home.markClean.loading")}
        </Text>
      ) : readiness.state === "ready" ? (
        <>
          <View style={[styles.check, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]} accessible testID="mark-clean-checklist">
            <Ionicons name="checkmark-circle" size={22} color={theme.status.ready} />
            <View style={styles.checkText}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.checkTitle, { color: theme.textPrimary }]}>
                {t("home.markClean.checklistComplete")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
                {t("home.markClean.checklistCount", { done: readiness.done, total: readiness.total })}
              </Text>
            </View>
          </View>
          <View style={styles.facts}>
            <Fact label={t("home.markClean.newStatusLabel")} value={t(readiness.willQueue ? "home.markClean.newStatusQueued" : "home.markClean.newStatusClean")} testID="mark-clean-new-status" />
            <Fact label={t("home.markClean.nextStepLabel")} value={t("home.markClean.nextStepInspection")} testID="mark-clean-next-step" />
          </View>
          {readiness.willQueue ? <SheetNotice tone="warn" text={t("home.markClean.offlineNotice")} testID="mark-clean-offline" /> : null}
        </>
      ) : (
        <SheetNotice tone="warn" text={t(`${blockMessageKey(readiness.reason)}.body`, { room: roomNumber, done: readiness.done, total: readiness.total })} testID={`mark-clean-blocked-${readiness.reason}`} />
      )}

      {missingList.length > 0 ? (
        <View style={styles.missing} testID="mark-clean-missing">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.checkTitle, { color: theme.textPrimary }]}>
            {t("home.markClean.stillOpen")}
          </Text>
          {missingList.slice(0, MISSING_SHOWN).map((label) => (
            <Text key={label} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
              {`• ${label}`}
            </Text>
          ))}
          {missingList.length > MISSING_SHOWN ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
              {t("home.markClean.andMore", { count: missingList.length - MISSING_SHOWN })}
            </Text>
          ) : null}
        </View>
      ) : null}

      {rejectionText ? <SheetNotice tone="error" text={rejectionText} testID="mark-clean-error" /> : null}
      {rejection && rejectionNeedsRoom(rejection.code) && readiness.state === "ready" ? (
        <Button label={t("home.markClean.openRoom")} onPress={() => onOpenRoom(roomId)} variant="secondary" testID="mark-clean-error-open-room" />
      ) : null}
    </BottomSheet>
  );
}

function Fact({ label, value, testID }: { label: string; value: string; testID?: string }) {
  const theme = useTheme();
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label} ${value}`} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.factValue, { color: theme.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

/** The server's own words are never shown raw: known codes get the room-screen sentence, the rest a plain one. */
function rejectionMessage(rejection: Rejection, t: Translate): string {
  const key = `rooms.detail.session.errors.${rejection.code}`;
  const known = t(key);
  if (known !== key) return known;
  return t("home.markClean.failed");
}

const styles = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  check: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 14, padding: 14 },
  checkText: { flex: 1, minWidth: 0, gap: 1 },
  checkTitle: { fontSize: 15, fontWeight: "800" },
  facts: { gap: 8 },
  fact: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  factLabel: { fontSize: 13, fontWeight: "600" },
  factValue: { flexShrink: 1, fontSize: 15, fontWeight: "800", textAlign: "right" },
  missing: { gap: 4 },
  holdBtn: { minHeight: 56, borderRadius: 12, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  holdFill: { position: "absolute", left: 0, top: 0, bottom: 0 },
  holdText: { fontSize: 16, fontWeight: "700", letterSpacing: 0.2 },
  release: { textAlign: "center", fontSize: 12 },
});
