import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Notice } from "@/components/management/HomeParts";
import { DetailHeader } from "@/components/shared/HeadersV2";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";
import { ApiError } from "@/lib/api/client";
import { GUEST_REQUEST_PAGE_SIZE, allowedTransitions, type GuestRequestView } from "@/lib/frontDesk/guestRequests";
import { fetchGuestRequest, transitionGuestRequest } from "@/lib/frontDesk/guestRequestsApi";
import { formatHotelTime } from "@/lib/housekeeping/hotelTime";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useAppStore } from "@/stores/appStore";

/* ─── Guest request detail ────────────────────────────────────────────────────
   Loads the request from the newest page of the list (the API has no single-request read) and offers ONLY the next
   steps the server's lifecycle allows from its current status (`allowedTransitions`, mirrored read-only). Every
   change goes through `POST /guest-requests/:id/transition`, the one supported route; the server validates the
   lifecycle and role again and answers 422 / 403 otherwise, and both are reported plainly. There is no assignee in
   the API, so there is no assign control. Cancelling asks for a second tap. A single in-flight lock stops a double tap
   from sending two changes. */

const STATUS_BADGE: Record<string, StatusKey> = {
  open: "pickup",
  reopened: "pickup",
  acknowledged: "inProgress",
  dispatched: "inProgress",
  arrived: "inProgress",
  guest_contacted: "inProgress",
  resolved: "completed",
  verified: "completed",
};

export default function GuestRequestDetailScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const { requestId } = useLocalSearchParams<{ requestId: string }>();
  const role = useAppStore((s) => s.user?.effective_role ?? s.user?.role);
  const isOnline = useAppStore((s) => s.isOnline);
  const zone = useAppStore((s) => s.hotelTimezone);
  const language = i18n.resolvedLanguage?.startsWith("es") ? "es" : "en";

  const [request, setRequest] = useState<GuestRequestView | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const inFlight = useRef(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!requestId) return;
    if (!isOnline) {
      setState((s) => (s === "loading" ? "error" : s));
      return;
    }
    const mine = ++seq.current;
    try {
      const found = await fetchGuestRequest(requestId);
      if (mine !== seq.current) return;
      setRequest(found);
      setState(found ? "ready" : "missing");
    } catch {
      if (mine !== seq.current) return;
      setState((s) => (s === "ready" ? s : "error"));
    }
  }, [isOnline, requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(
    async (next: string) => {
      if (!request || inFlight.current) return;
      if (!isOnline) {
        toast.error(t("guestRequestsV2.detail.offline"));
        return;
      }
      inFlight.current = true;
      setSaving(next);
      try {
        await transitionGuestRequest(request.id, next, note);
        setNote("");
        setConfirmCancel(false);
        toast.success(t("guestRequestsV2.detail.done", { status: t(`guestRequestsV2.status.${next}`) }));
        await load();
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        toast.error(status === 403 ? t("guestRequestsV2.detail.forbidden") : status === 422 ? t("guestRequestsV2.detail.invalid") : t("guestRequestsV2.detail.failed"));
        // A refused step usually means the status moved on; show the truth.
        if (status === 422 || status === 403) await load();
      } finally {
        inFlight.current = false;
        setSaving(null);
      }
    },
    [request, isOnline, note, toast, t, load],
  );

  const back = () => router.back();
  const header = (title: string) => <DetailHeader title={title} onBack={back} backLabel={t("guestRequestsV2.detail.back")} testID="request-detail-header" />;

  if (state === "loading") {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        {header(t("guestRequestsV2.detail.title"))}
        <StateBlock status="loading" style={styles.center} />
      </View>
    );
  }
  if (state === "error" || state === "missing" || !request) {
    return (
      <View style={[styles.root, { backgroundColor: theme.background }]}>
        {header(t("guestRequestsV2.detail.title"))}
        {state === "missing" ? (
          <StateBlock status="empty" emptyIcon="search-outline" emptyTitle={t("guestRequestsV2.detail.notFound")} emptyBody={t("guestRequestsV2.detail.notFoundBody", { count: GUEST_REQUEST_PAGE_SIZE })} style={styles.center} />
        ) : (
          <StateBlock status="error" errorMessage={`${t("guestRequestsV2.error.title")}. ${t("guestRequestsV2.error.body")}`} onRetry={() => void load()} retryLabel={t("common.retry")} style={styles.center} />
        )}
      </View>
    );
  }

  const actions = allowedTransitions(request.status, role);
  const statusKey = request.status in STATUS_BADGE || request.status === "cancelled" ? request.status : "unknown";
  const badge = STATUS_BADGE[request.status];
  const stamp = (iso: string | null) => (iso ? formatHotelTime(new Date(iso), zone, language) : null);
  const created = stamp(request.createdAt);
  const due = request.stage !== "resolved" ? stamp(request.dueAt) : null;
  const resolved = stamp(request.resolvedAt);
  const busy = saving !== null;

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: theme.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {header(request.roomNumber ? t("guestRequests.roomLabel", { room: request.roomNumber }) : t("guestRequestsV2.detail.title"))}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="request-detail">
        {!isOnline ? <Notice testID="request-detail-offline" text={t("guestRequestsV2.detail.offline")} /> : null}

        <Card style={styles.card}>
          <View style={styles.badges}>
            {badge ? <StatusBadge statusKey={badge} label={t(`guestRequestsV2.status.${statusKey}`)} /> : <AppText variant="label">{t(`guestRequestsV2.status.${statusKey}`)}</AppText>}
            {request.urgent && request.stage !== "resolved" ? <StatusBadge statusKey="urgent" label={t("guestRequestsV2.urgent")} /> : null}
          </View>
          <AppText variant="title" testID="request-detail-title">
            {request.title || t("guestRequestsV2.untitled")}
          </AppText>
          <AppText variant="caption" tone="secondary">
            {t("guestRequestsV2.detail.need")}
          </AppText>
          <AppText variant="body" testID="request-detail-description">
            {request.description || t("guestRequestsV2.detail.noDescription")}
          </AppText>
        </Card>

        <Card style={styles.card}>
          <Fact label={t("guestRequestsV2.detail.room")} value={request.roomNumber} />
          <Fact label={t("guestRequestsV2.detail.guest")} value={request.guestName} />
          <Fact label={t("guestRequestsV2.detail.created")} value={created} />
          <Fact label={t("guestRequestsV2.detail.due")} value={due} />
          <Fact label={t("guestRequestsV2.detail.resolvedAt")} value={resolved} />
        </Card>

        <Button testID="request-ask-assistant" label={t("guestRequestsV2.ask")} icon="sparkles-outline" variant="tertiary" size="md" onPress={() => router.push("/(app)/copilot" as never)} />

        <Card style={styles.card} testID="request-detail-actions">
          <AppText variant="headline">{t("guestRequestsV2.detail.next")}</AppText>
          {actions.length === 0 ? (
            <AppText variant="caption" tone="secondary">
              {t("guestRequestsV2.detail.noActions")}
            </AppText>
          ) : (
            <>
              <View>
                <AppText variant="label" tone="secondary" style={styles.noteLabel}>
                  {t("guestRequestsV2.detail.note")}
                </AppText>
                <TextInput
                  value={note}
                  onChangeText={setNote}
                  placeholder={t("guestRequestsV2.detail.notePlaceholder")}
                  placeholderTextColor={theme.textMuted}
                  accessibilityLabel={t("guestRequestsV2.detail.note")}
                  multiline
                  maxLength={2000}
                  editable={!busy}
                  style={[styles.note, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.textPrimary }]}
                  testID="request-detail-note"
                />
              </View>
              {actions
                .filter((a) => a !== "cancelled")
                .map((a, index) => (
                  <Button
                    key={a}
                    testID={`request-action-${a}`}
                    label={saving === a ? t("guestRequestsV2.detail.saving") : t(`guestRequestsV2.detail.action.${a}`)}
                    variant={index === 0 ? "primary" : "secondary"}
                    size="md"
                    loading={saving === a}
                    disabled={busy || !isOnline}
                    onPress={() => void submit(a)}
                  />
                ))}
              {actions.includes("cancelled") ? (
                confirmCancel ? (
                  <View style={[styles.confirm, { borderColor: theme.status.dirtyLine, backgroundColor: theme.status.dirtySoft }]} testID="request-cancel-confirm">
                    <AppText variant="bodyStrong">{t("guestRequestsV2.detail.confirmCancelTitle")}</AppText>
                    <AppText variant="caption" tone="secondary">
                      {t("guestRequestsV2.detail.confirmCancelBody")}
                    </AppText>
                    <Button testID="request-cancel-confirm-yes" label={t("guestRequestsV2.detail.confirmCancel")} variant="destructive" size="md" disabled={busy || !isOnline} loading={saving === "cancelled"} onPress={() => void submit("cancelled")} />
                    <Button testID="request-cancel-confirm-no" label={t("guestRequestsV2.detail.keep")} variant="ghost" size="md" disabled={busy} onPress={() => setConfirmCancel(false)} />
                  </View>
                ) : (
                  <Button testID="request-action-cancelled" label={t("guestRequestsV2.detail.action.cancelled")} variant="ghost" size="md" disabled={busy || !isOnline} onPress={() => setConfirmCancel(true)} />
                )
              ) : null}
            </>
          )}
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}, ${value}`}>
      <AppText variant="caption" tone="secondary" style={styles.factLabel}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" numeric style={styles.factValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  content: { padding: spaceV2.page, gap: spaceV2.md, paddingBottom: 40 },
  card: { padding: spaceV2.lg, gap: spaceV2.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  fact: { flexDirection: "row", gap: spaceV2.md, alignItems: "flex-start" },
  factLabel: { width: 96 },
  factValue: { flex: 1 },
  noteLabel: { marginBottom: 4 },
  note: { borderWidth: 1, borderRadius: radiusV2.input, padding: spaceV2.md, minHeight: 80, fontSize: 16, textAlignVertical: "top" },
  confirm: { borderWidth: 1, borderRadius: radiusV2.control, padding: spaceV2.md, gap: spaceV2.sm },
});
