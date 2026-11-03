import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { ManagementHeader, SectionTitle } from "@/components/engineering/pm/management/ManagementChrome";
import { DateField } from "@/components/engineering/assets/form/DateField";
import { ChoiceChips, FieldLabel, InlineError, LineInput, Note, TextArea } from "@/components/engineering/workorder/sheetKit";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { assignPmChecklist, createPmSchedule, deactivatePmSchedule, updatePmSchedule } from "@/lib/api/pmManagement";
import { browseAssets } from "@/lib/api/assets";
import { listPmTemplates } from "@/lib/api/pm";
import { EMPTY_ASSET_FILTERS, type AssetRow } from "@/lib/engineering/assetModel";
import { adaptPmTemplates, type PmTemplate } from "@/lib/engineering/pmChecklist";
import { classifyManagementFailure, type ManagementFailure } from "@/lib/engineering/pmManagement";
import {
  DESCRIPTION_MAX,
  EMPTY_SCHEDULE_FORM,
  INTERVAL_TYPES,
  NAME_MAX,
  diffSchedule,
  formFromSchedule,
  hasChanges,
  toCreateBody,
  validateSchedule,
  type ScheduleFormValues,
  type ScheduleProblem,
  type ScheduleSnapshot,
} from "@/lib/engineering/scheduleForm";
import { canManagePmSchedules } from "@/lib/engineering/roles";
import { pmScheduleRoute, PM_LIST_ROUTE } from "@/lib/engineering/routes";
import { usePmSchedules } from "@/lib/engineering/usePmSchedules";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

const PROGRAMS = "/(app)/pm-schedules/management/programs";

export default function PmScheduleFormScreen() {
  const { scheduleId } = useLocalSearchParams<{ scheduleId?: string }>();
  const editing = !!scheduleId;
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const timezone = useAppStore((s) => s.hotelTimezone);
  const allowed = canManagePmSchedules(user?.effective_role ?? user?.role);

  const data = usePmSchedules();
  const schedule = useMemo(() => (editing ? data.schedules.find((s) => s.id === scheduleId) ?? null : null), [editing, data.schedules, scheduleId]);
  const original = useMemo<ScheduleSnapshot | null>(
    () =>
      schedule
        ? {
            name: schedule.name,
            description: schedule.description,
            intervalType: schedule.intervalType,
            intervalDays: schedule.intervalDays,
            estimatedMinutes: schedule.estimatedMinutes,
            recurrenceBasis: schedule.recurrenceBasis,
            checklistId: schedule.checklist.state === "unassigned" ? null : schedule.checklist.templateId ?? null,
          }
        : null,
    [schedule],
  );

  const [values, setValues] = useState<ScheduleFormValues>(EMPTY_SCHEDULE_FORM);
  const [seeded, setSeeded] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<ManagementFailure | null>(null);
  const [partial, setPartial] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [templates, setTemplates] = useState<PmTemplate[] | null>(null);
  const [templatesFailed, setTemplatesFailed] = useState(false);
  const [assetQuery, setAssetQuery] = useState("");
  const [assetResults, setAssetResults] = useState<AssetRow[] | null>(null);
  const [pickedAsset, setPickedAsset] = useState<{ id: string; name: string; place: string } | null>(null);
  const working = useRef(false);

  // Edit: seed the form once, from the schedule as it stands on the server.
  useEffect(() => {
    if (editing && original && !seeded) {
      setValues(formFromSchedule(original));
      setSeeded(true);
    }
  }, [editing, original, seeded]);

  useEffect(() => {
    if (!allowed || !isOnline) return;
    let live = true;
    listPmTemplates()
      .then((rows) => live && setTemplates(adaptPmTemplates(rows)))
      .catch(() => live && setTemplatesFailed(true));
    return () => {
      live = false;
    };
  }, [allowed, isOnline]);

  // Real equipment of this property only: the server's inventory search, never a typed id.
  useEffect(() => {
    if (editing || !allowed || !isOnline || pickedAsset) return;
    let live = true;
    const handle = setTimeout(() => {
      browseAssets(EMPTY_ASSET_FILTERS, assetQuery, 1)
        .then((page) => live && setAssetResults(page.rows.slice(0, 8)))
        .catch(() => live && setAssetResults([]));
    }, assetQuery ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(handle);
    };
  }, [editing, allowed, isOnline, assetQuery, pickedAsset]);

  const set = (patch: Partial<ScheduleFormValues>) => setValues((v) => ({ ...v, ...patch }));
  const legacyUnbound = editing && original?.checklistId == null;
  const problems = validateSchedule(values, editing ? "edit" : "create", timezone, new Date(), legacyUnbound);
  const shown = (p: ScheduleProblem) => touched && problems.includes(p);
  const changes = original ? diffSchedule(original, values) : null;
  const canSave = editing ? !!changes && hasChanges(changes) : true;
  const template = templates?.find((tpl) => tpl.id === values.checklistId) ?? null;
  const boundMissing = editing && values.checklistId != null && templates != null && !template;

  const submit = async () => {
    if (working.current) return;
    setTouched(true);
    if (problems.length > 0) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    setPartial(false);
    try {
      if (editing && schedule && changes) {
        let patched = false;
        try {
          if (Object.keys(changes.fields).length > 0) {
            await updatePmSchedule(schedule.id, changes.fields, schedule.rowVersion ?? 1);
            patched = true;
          }
          if (changes.checklistChanged) await assignPmChecklist(schedule.id, values.checklistId);
        } catch (err) {
          if (patched) setPartial(true);
          throw err;
        }
        toast.success(t("pmMgmt.form.savedToast"));
        void data.reload();
        router.back();
      } else {
        const body = toCreateBody(values, timezone);
        if (!body) return;
        const created = await createPmSchedule(body);
        toast.success(t("pmMgmt.form.createdToast"));
        void data.reload();
        router.replace((pmScheduleRoute(created.id) ?? PM_LIST_ROUTE) as never);
      }
    } catch (err) {
      setFailure(classifyManagementFailure(err));
      if (classifyManagementFailure(err).kind === "version_conflict") void data.reload();
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (!schedule || working.current) return;
    working.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await deactivatePmSchedule(schedule.id);
      toast.success(t("pmMgmt.form.deactivatedToast"));
      setConfirmOff(false);
      void data.reload();
      router.replace(PROGRAMS as never);
    } catch (err) {
      setFailure(classifyManagementFailure(err));
      setConfirmOff(false);
    } finally {
      working.current = false;
      setBusy(false);
    }
  };

  const title = editing ? t("pmMgmt.form.editTitle") : t("pmMgmt.form.createTitle");
  const blocked = !allowed ? "forbidden" : editing && !schedule ? (data.loading ? "loading" : "empty") : null;
  const err = (p: ScheduleProblem) => (shown(p) ? <InlineError testID={`pm-form-error-${p}`}>{t(`pmMgmt.form.problem.${p}`)}</InlineError> : null);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ManagementHeader title={title} subtitle={editing ? undefined : t("pmMgmt.form.createSubtitle")} testID="pm-form" />
      {blocked ? (
        <EngineeringState status={blocked} onRetry={() => void data.reload()} emptyTitle={t("pm.detail.notFound")} />
      ) : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} keyboardShouldPersistTaps="handled">
          {!isOnline ? <Note tone="warn">{t("pmMgmt.needsConnection")}</Note> : null}

          <SectionTitle>{t("pmMgmt.form.sectionEquipment")}</SectionTitle>
          {editing ? (
            <Card style={styles.pick}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pickName, { color: theme.textPrimary }]}>
                {schedule?.assetName ?? t("pmSchedules.unknownAsset")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>{t("pmMgmt.form.equipmentFixed")}</Text>
            </Card>
          ) : pickedAsset ? (
            <Card style={styles.pick}>
              <View style={{ flex: 1 }}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pickName, { color: theme.textPrimary }]}>{pickedAsset.name}</Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>{pickedAsset.place}</Text>
              </View>
              <Button label={t("pmMgmt.form.changeEquipment")} variant="ghost" onPress={() => { setPickedAsset(null); set({ assetId: null }); }} testID="pm-form-change-asset" />
            </Card>
          ) : (
            <>
              <LineInput value={assetQuery} onChangeText={setAssetQuery} placeholder={t("pmMgmt.form.searchEquipment")} accessibilityLabel={t("pmMgmt.form.searchEquipment")} autoCorrect={false} testID="pm-form-asset-search" />
              {(assetResults ?? []).map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() => {
                    const place = [a.asset_tag, a.location_text ?? a.rooms?.room_number, a.asset_categories?.name].filter(Boolean).join(" · ");
                    setPickedAsset({ id: a.id, name: a.name, place });
                    set({ assetId: a.id, name: values.name || a.name });
                  }}
                  accessibilityRole="button"
                  testID={`pm-form-asset-${a.id}`}
                  style={[styles.option, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }]}
                >
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pickName, { color: theme.textPrimary }]} numberOfLines={1}>{a.name}</Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]} numberOfLines={1}>
                    {[a.asset_tag, a.location_text ?? a.rooms?.room_number, a.asset_categories?.name].filter(Boolean).join(" · ")}
                  </Text>
                </Pressable>
              ))}
              {assetResults && assetResults.length === 0 ? <Text style={{ color: theme.textMuted }}>{t("pmMgmt.form.noEquipment")}</Text> : null}
              {err("asset_missing")}
            </>
          )}

          <FieldLabel required>{t("pmMgmt.form.name")}</FieldLabel>
          <LineInput value={values.name} onChangeText={(name) => set({ name })} maxLength={NAME_MAX} accessibilityLabel={t("pmMgmt.form.name")} invalid={shown("name_missing")} testID="pm-form-name" />
          {err("name_missing")}
          <FieldLabel>{t("pmMgmt.form.description")}</FieldLabel>
          <TextArea value={values.description} onChangeText={(description) => set({ description })} maxLength={DESCRIPTION_MAX} placeholder={t("pmMgmt.form.descriptionPlaceholder")} accessibilityLabel={t("pmMgmt.form.description")} testID="pm-form-description" />

          <SectionTitle>{t("pmMgmt.form.sectionProcedure")}</SectionTitle>
          {templatesFailed ? (
            <InlineError testID="pm-form-templates-error">{t("pmMgmt.form.templatesFailed")}</InlineError>
          ) : templates == null ? (
            <Text style={{ color: theme.textMuted }}>{t("pmMgmt.loading")}</Text>
          ) : templates.length === 0 ? (
            <InlineError testID="pm-form-no-templates">{t("pmMgmt.form.noTemplates")}</InlineError>
          ) : (
            <View accessibilityRole="radiogroup" style={styles.stack}>
              {templates.map((tpl) => {
                const selected = tpl.id === values.checklistId;
                return (
                  <Pressable
                    key={tpl.id}
                    onPress={() => set({ checklistId: tpl.id })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    testID={`pm-form-template-${tpl.id}`}
                    style={[styles.option, { backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle, borderColor: selected ? theme.primaryLine : theme.border }]}
                  >
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pickName, { color: theme.textPrimary }]} numberOfLines={2}>
                      {(i18n.language.startsWith("es") && tpl.nameEs) || tpl.name}
                    </Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
                      {t("pmMgmt.form.templateMeta", { version: tpl.version ?? 1, steps: tpl.items.length, evidence: tpl.items.filter((i) => i.requiresEvidence).length })}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          )}
          {boundMissing ? <InlineError testID="pm-form-bound-missing">{t("pmMgmt.form.boundMissing")}</InlineError> : null}
          {editing && changes?.checklistChanged ? <Note tone="warn" testID="pm-form-checklist-warning">{t("pmMgmt.form.checklistWarning")}</Note> : null}
          {err("checklist_missing")}

          <SectionTitle>{t("pmMgmt.form.sectionRecurrence")}</SectionTitle>
          <ChoiceChips
            value={values.intervalType}
            onChange={(intervalType) => set({ intervalType })}
            testIDPrefix="pm-form-interval"
            options={INTERVAL_TYPES.map((key) => ({ value: key, label: t(`pmSchedules.interval.${key}`) }))}
          />
          {values.intervalType === "custom" ? (
            <>
              <FieldLabel required>{t("pmMgmt.form.everyDays")}</FieldLabel>
              <LineInput value={values.intervalDays} onChangeText={(intervalDays) => set({ intervalDays })} keyboardType="number-pad" maxLength={4} accessibilityLabel={t("pmMgmt.form.everyDays")} invalid={shown("interval_days")} testID="pm-form-interval-days" />
              {err("interval_days")}
            </>
          ) : null}
          {editing ? (
            <Note testID="pm-form-due-note">{t("pmMgmt.form.dueNote")}</Note>
          ) : (
            <>
              <DateField label={t("pmMgmt.form.firstDue")} value={values.firstDueDate} onChange={(firstDueDate) => set({ firstDueDate })} error={shown("due_missing") ? t("pmMgmt.form.problem.due_missing") : shown("due_past") ? t("pmMgmt.form.problem.due_past") : null} testID="pm-form-first-due" />
            </>
          )}
          <FieldLabel>{t("pmMgmt.form.basis")}</FieldLabel>
          <ChoiceChips
            value={values.recurrenceBasis}
            onChange={(recurrenceBasis) => set({ recurrenceBasis })}
            testIDPrefix="pm-form-basis"
            options={[
              { value: "scheduled_date", label: t("pmMgmt.form.basisScheduled"), hint: t("pmMgmt.form.basisScheduledHint") },
              { value: "completion_date", label: t("pmMgmt.form.basisCompletion"), hint: t("pmMgmt.form.basisCompletionHint") },
            ]}
          />
          <FieldLabel required>{t("pmMgmt.form.minutes")}</FieldLabel>
          <LineInput value={values.estimatedMinutes} onChangeText={(estimatedMinutes) => set({ estimatedMinutes })} keyboardType="number-pad" maxLength={4} accessibilityLabel={t("pmMgmt.form.minutes")} invalid={shown("minutes")} testID="pm-form-minutes" />
          {err("minutes")}

          <SectionTitle>{t("pmMgmt.form.sectionResponsibility")}</SectionTitle>
          <Note>{t("pmMgmt.form.responsibilityNote")}</Note>

          {!editing ? (
            <>
              <SectionTitle>{t("pmMgmt.form.sectionReview")}</SectionTitle>
              <Card style={styles.review} testID="pm-form-review">
                {[
                  [t("pmMgmt.form.reviewEquipment"), pickedAsset?.name],
                  [t("pmMgmt.form.reviewProcedure"), template ? `${template.name} v${template.version ?? 1}` : null],
                  [t("pmMgmt.form.name"), values.name.trim() || null],
                  [t("pmMgmt.form.reviewRepeats"), values.intervalType === "custom" ? t("pmMgmt.form.everyNDays", { days: values.intervalDays || "?" }) : t(`pmSchedules.interval.${values.intervalType}`)],
                  [t("pmMgmt.form.firstDue"), values.firstDueDate || null],
                  [t("pmMgmt.form.minutes"), values.estimatedMinutes || null],
                ].map(([label, value]) => (
                  <View key={label as string} style={styles.reviewRow}>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>{label}</Text>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.reviewValue, { color: theme.textPrimary }]}>{(value as string | null) ?? "–"}</Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {failure ? <InlineError testID="pm-form-failure">{t(`pmMgmt.failure.${failure.kind}`)}</InlineError> : null}
          {partial ? <InlineError testID="pm-form-partial">{t("pmMgmt.form.partial")}</InlineError> : null}

          <Button label={editing ? t("pmMgmt.form.save") : t("pmMgmt.form.create")} onPress={() => void submit()} loading={busy} disabled={busy || !isOnline || !canSave} size="lg" testID="pm-form-submit" />
          {editing ? (
            <Button label={t("pmMgmt.form.deactivate")} variant="destructive" onPress={() => setConfirmOff(true)} disabled={busy || !isOnline} testID="pm-form-deactivate" />
          ) : null}
        </ScrollView>
      )}

      <BottomSheet visible={confirmOff} title={t("pmMgmt.form.deactivateTitle")} onClose={busy ? () => undefined : () => setConfirmOff(false)} testID="pm-form-deactivate-sheet">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pickName, { color: theme.textPrimary }]}>{t("pmMgmt.form.deactivateBody", { name: schedule?.name ?? "" })}</Text>
        <Note>{t("pmMgmt.form.deactivateEffects")}</Note>
        <Button label={t("pmMgmt.form.deactivateConfirm")} variant="destructive" onPress={() => void turnOff()} loading={busy} disabled={busy || !isOnline} size="lg" testID="pm-form-deactivate-confirm" />
        <Button label={t("common.cancel")} variant="ghost" onPress={() => setConfirmOff(false)} disabled={busy} testID="pm-form-deactivate-cancel" />
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10 },
  stack: { gap: 8 },
  pick: { padding: 14, gap: 4, flexDirection: "row", alignItems: "center" },
  pickName: { fontSize: 15, fontWeight: "700" },
  hint: { fontSize: 13, lineHeight: 18 },
  option: { minHeight: 52, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center", gap: 2 },
  review: { padding: 14, gap: 8 },
  reviewRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  reviewValue: { fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },
});
