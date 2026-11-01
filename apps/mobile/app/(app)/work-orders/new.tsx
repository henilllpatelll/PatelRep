import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { FieldLabel, InlineError, LineInput, Note, TextArea, sheetStyles } from "@/components/engineering/workorder/sheetKit";
import { EvidenceInput } from "@/components/engineering/report/EvidenceInput";
import { LocationSheet } from "@/components/engineering/report/LocationSheet";
import { MoreOptions } from "@/components/engineering/report/MoreOptions";
import { OptionSheet } from "@/components/engineering/report/OptionSheet";
import { PriorityPicker } from "@/components/engineering/report/PriorityPicker";
import { ReportSuccess } from "@/components/engineering/report/ReportSuccess";
import { formatWhen } from "@/components/engineering/rooms/roomUi";
import { REPORT_CATEGORIES, DESCRIPTION_MAX, TITLE_MAX, type ReportAsset, type ReportCategory, type ReportDraft } from "@/lib/engineering/reportIssue";
import { useReportIssue } from "@/lib/engineering/useReportIssue";
import { buildCreateBody } from "@/lib/engineering/roomAvailability";
import { useAppStore } from "@/stores/appStore";

function param(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first && first.trim() ? first : undefined;
}

/** Report an Issue: the one shared way to create a work order, whatever screen the person came from. */
export default function ReportIssueScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const role = user?.effective_role ?? user?.role;
  const locale = i18n.resolvedLanguage ?? "en";

  // What the entry point already knows. Computed once: it describes how the person arrived, not what they typed.
  const prefill = useMemo<Partial<ReportDraft>>(() => {
    const out: Partial<ReportDraft> = {};
    const roomId = param(params.roomId);
    const roomNumber = param(params.roomNumber);
    if (roomId && roomNumber) out.location = { kind: "room", roomId, roomNumber, floor: param(params.floor) ? Number(param(params.floor)) : null };
    const assetId = param(params.assetId);
    const assetName = param(params.assetName);
    if (assetId && assetName) {
      const asset: ReportAsset = {
        id: assetId,
        name: assetName,
        categoryCode: param(params.assetCategory) ?? null,
        roomId: param(params.assetRoomId) ?? null,
        roomNumber: param(params.assetRoomNumber) ?? null,
        locationText: param(params.assetLocation) ?? null,
      };
      out.asset = asset;
    }
    const source = param(params.source);
    if (source === "pm" || source === "guest" || source === "staff_patrol" || source === "self") out.source = source;
    const title = param(params.title);
    if (title) out.title = title.slice(0, TITLE_MAX);
    return out;
  }, []);

  const report = useReportIssue({ scope, userId: user?.id ?? null, isOnline, prefill });
  const { draft, validation, showErrors, submitting } = report;
  const [sheet, setSheet] = useState<"location" | "category" | "discard" | "review" | null>(null);
  const cameFrom = param(params.from);
  const backLabel = cameFrom === "room" ? t("report.success.backRoom") : cameFrom === "asset" ? t("report.success.backAsset") : t("report.success.backWork");

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/work-orders" as never);
  }, []);

  // Back asks first when there is typed work to lose; the draft is also kept on this device.
  const requestBack = useCallback(() => {
    if (report.outcome || !report.dirty) return leave();
    setSheet("discard");
  }, [leave, report.dirty, report.outcome]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (sheet) {
        setSheet(null);
        return true;
      }
      if (report.dirty && !report.outcome) {
        setSheet("discard");
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [report.dirty, report.outcome, sheet]);

  const needsReview = draft.roomDown != null;
  const press = async () => {
    if (needsReview) {
      if (!validation.errors.length && !validation.roomDown.length) setSheet("review");
      else await report.submit();
      return;
    }
    await report.submit();
  };

  const place = draft.location ? (draft.location.kind === "room" ? t("report.location.roomLabel", { room: draft.location.roomNumber }) : draft.location.text) : null;
  const err = (e: (typeof validation.errors)[number]) => showErrors && validation.errors.includes(e);
  const failureText = report.failure
    ? report.failure.message === "needs_connection"
      ? t("report.errors.needsConnection")
      : report.failure.ambiguous
        ? t("report.errors.ambiguous")
        : report.failure.status === 403
          ? t("report.errors.forbidden")
          : report.failure.message
    : null;

  const openCreated = useCallback(() => {
    if (report.outcome?.kind === "created" && report.outcome.workOrderId) router.replace({ pathname: "/(app)/work-orders/[woId]", params: { woId: report.outcome.workOrderId } } as never);
  }, [report.outcome]);

  if (report.outcome) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.hero, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heroTitle, { color: theme.shell.ink }]}>
            {t("report.title")}
          </Text>
        </View>
        <ReportSuccess
          outcome={report.outcome}
          draft={draft}
          photosPending={report.photosPending}
          retryingPhotos={report.retryingPhotos}
          onRetryPhotos={() => void report.retryPhotos()}
          onView={openCreated}
          onBack={leave}
          onAnother={report.reset}
          backLabel={backLabel}
        />
      </View>
    );
  }

  const downBody = draft.roomDown && draft.location?.kind === "room" ? buildCreateBody(draft.location.roomId, draft.roomDown, report.reasons) : null;
  const submitLabel = !isOnline ? t("report.submitOffline") : needsReview ? t("report.submitReview") : t("report.submit");

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined} testID="report-issue-screen">
      <View style={[styles.hero, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
        <Pressable onPress={requestBack} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={8} style={styles.back} testID="report-back-button">
          <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.shell.ink, fontSize: 15 }}>
            {t("common.back")}
          </Text>
        </Pressable>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heroTitle, { color: theme.shell.ink }]}>
          {t("report.title")}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroSub, { color: theme.shell.ink2 }]}>
          {t("report.subtitle")}
        </Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {report.restored ? (
          <View style={[styles.banner, { backgroundColor: theme.primarySoft }]} accessibilityLiveRegion="polite" testID="report-restored">
            <Ionicons name="document-text-outline" size={16} color={theme.primary} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textPrimary }]}>
              {t("report.restored")}
            </Text>
            <Pressable onPress={() => void report.discard()} accessibilityRole="button" style={styles.bannerAction} testID="report-start-over">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.primary, fontWeight: "700" }}>
                {t("report.startOver")}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {!isOnline ? <Note tone="warn" testID="report-offline">{t("report.offline")}</Note> : null}

        <View style={sheetStyles.stack}>
          <FieldLabel required>{t("report.fields.location")}</FieldLabel>
          <Pressable
            onPress={() => setSheet("location")}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={`${t("report.fields.location")}: ${place ?? t("report.fields.locationPlaceholder")}`}
            style={[styles.pick, { borderColor: err("location_required") || err("asset_room_mismatch") ? theme.status.dirty : theme.border, backgroundColor: theme.surfaceSubtle }]}
            testID="report-location"
          >
            <Ionicons name={draft.location?.kind === "room" ? "bed-outline" : "location-outline"} size={18} color={theme.textMuted} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pickText, { color: place ? theme.textPrimary : theme.textDisabled }]} numberOfLines={2}>
              {place ?? t("report.fields.locationPlaceholder")}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </Pressable>
          {err("location_required") ? <InlineError>{t("report.errors.location_required")}</InlineError> : null}
          {err("location_too_long") ? <InlineError>{t("report.errors.location_too_long")}</InlineError> : null}
          {err("asset_room_mismatch") ? <InlineError>{t("report.errors.asset_room_mismatch")}</InlineError> : null}
          {draft.asset ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }} testID="report-asset-note">
              {t("report.fields.forEquipment", { name: draft.asset.name })}
            </Text>
          ) : null}

          <FieldLabel required>{t("report.fields.title")}</FieldLabel>
          <LineInput
            value={draft.title}
            onChangeText={(title) => report.update({ title })}
            editable={!submitting}
            maxLength={TITLE_MAX}
            placeholder={t("report.fields.titlePlaceholder")}
            accessibilityLabel={t("report.fields.title")}
            returnKeyType="next"
            invalid={err("title_required") || err("title_too_long")}
            testID="report-title"
          />
          {err("title_required") ? <InlineError>{t("report.errors.title_required")}</InlineError> : null}

          <FieldLabel>{t("report.fields.description")}</FieldLabel>
          <TextArea
            value={draft.description}
            onChangeText={(description) => report.update({ description })}
            editable={!submitting}
            maxLength={DESCRIPTION_MAX}
            placeholder={t("report.fields.descriptionPlaceholder")}
            accessibilityLabel={t("report.fields.description")}
            invalid={err("description_too_long")}
            testID="report-description"
          />
          {draft.description.length > DESCRIPTION_MAX - 200 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12 }}>
              {t("report.fields.remaining", { count: DESCRIPTION_MAX - draft.description.length })}
            </Text>
          ) : null}

          <FieldLabel required>{t("report.fields.category")}</FieldLabel>
          <Pressable
            onPress={() => setSheet("category")}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityLabel={`${t("report.fields.category")}: ${t(`workOrders.category.${draft.category}`)}`}
            style={[styles.pick, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            testID="report-category"
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pickText, { color: theme.textPrimary }]}>
              {t(`workOrders.category.${draft.category}`)}
            </Text>
            <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
          </Pressable>

          <FieldLabel required>{t("report.fields.priority")}</FieldLabel>
          <PriorityPicker
            value={draft.priority}
            emergencyConfirmed={draft.emergencyConfirmed}
            onChange={report.setPriority}
            onConfirmEmergency={(emergencyConfirmed) => report.update({ emergencyConfirmed })}
            showErrors={showErrors}
            disabled={submitting}
          />
          {err("emergency_unconfirmed") ? <InlineError>{t("report.errors.emergency_unconfirmed")}</InlineError> : null}

          <FieldLabel>{t("report.fields.evidence")}</FieldLabel>
          <EvidenceInput photos={report.photos} isOnline={isOnline} disabled={submitting} onAdd={report.addPhoto} onRemove={report.removePhoto} onCaption={report.setPhotoCaption} />

          <MoreOptions report={report} role={role} isOnline={isOnline} locale={locale} disabled={submitting} />
          {err("impact_needs_asset") ? <InlineError>{t("report.errors.impact_needs_asset")}</InlineError> : null}
          {err("room_down_needs_room") ? <InlineError>{t("report.errors.room_down_needs_room")}</InlineError> : null}
        </View>

        {failureText ? (
          <InlineError testID="report-failure">{failureText}</InlineError>
        ) : null}
        {report.failure?.ambiguous ? <Note>{t("report.errors.ambiguousHint")}</Note> : null}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: theme.background, borderTopColor: theme.border }]}>
        <Button label={submitLabel} onPress={() => void press()} loading={submitting} disabled={submitting} size="lg" testID="report-submit" />
      </View>

      <LocationSheet visible={sheet === "location"} current={draft.location} recent={report.recent} isOnline={isOnline} onSelect={report.setLocation} onClose={() => setSheet(null)} />
      <OptionSheet
        visible={sheet === "category"}
        title={t("report.fields.category")}
        options={REPORT_CATEGORIES.map((value: ReportCategory) => ({ value, label: t(`workOrders.category.${value}`) }))}
        value={draft.category}
        onSelect={(category) => report.update({ category })}
        onClose={() => setSheet(null)}
        testID="report-category-sheet"
      />

      <BottomSheet
        visible={sheet === "discard"}
        title={t("report.discard.title")}
        onClose={() => setSheet(null)}
        testID="report-discard-sheet"
        footer={
          <View style={sheetStyles.stack}>
            <Button label={t("report.discard.keep")} onPress={() => setSheet(null)} size="lg" testID="report-discard-keep" />
            <Button label={t("report.discard.saveLeave")} variant="secondary" onPress={() => { setSheet(null); leave(); }} testID="report-discard-save" />
            <Button
              label={t("report.discard.discard")}
              variant="ghost"
              onPress={() => {
                setSheet(null);
                void report.discard().then(leave);
              }}
              testID="report-discard-discard"
            />
          </View>
        }
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20 }}>
          {t("report.discard.body")}
        </Text>
      </BottomSheet>

      <BottomSheet
        visible={sheet === "review"}
        title={t("report.review.title")}
        onClose={() => setSheet(null)}
        testID="report-review-sheet"
        footer={
          <View style={sheetStyles.stack}>
            <Button
              label={t("report.review.confirm")}
              onPress={async () => {
                setSheet(null);
                await report.submit();
              }}
              loading={submitting}
              disabled={submitting || !downBody}
              size="lg"
              testID="report-review-confirm"
            />
            <Button label={t("report.review.edit")} variant="ghost" onPress={() => setSheet(null)} testID="report-review-edit" />
          </View>
        }
      >
        <View style={sheetStyles.stack}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textPrimary, fontSize: 14.5, lineHeight: 21 }}>
            {t("report.review.body", { room: draft.location?.kind === "room" ? draft.location.roomNumber : "", type: draft.roomDown?.type ? t(`engRooms.down.types.${draft.roomDown.type}`) : "" })}
          </Text>
          {draft.roomDown?.returnAt ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13.5 }}>
              {t("engRooms.down.expectedBack", { time: formatWhen(draft.roomDown.returnAt, locale) })}
            </Text>
          ) : null}
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }}>
            {t("engRooms.pmsNote")}
          </Text>
        </View>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, gap: 4 },
  back: { flexDirection: "row", alignItems: "center", minHeight: 44, alignSelf: "flex-start" },
  heroTitle: { fontSize: 27, lineHeight: 32, fontWeight: "600" },
  heroSub: { fontSize: 13 },
  content: { padding: 18, gap: 14 },
  pick: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  pickText: { flex: 1, fontSize: 15, fontWeight: "600" },
  banner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  bannerText: { flex: 1, fontSize: 13 },
  bannerAction: { minHeight: 44, justifyContent: "center", paddingHorizontal: 6 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 18, paddingTop: 10, borderTopWidth: 1 },
});
