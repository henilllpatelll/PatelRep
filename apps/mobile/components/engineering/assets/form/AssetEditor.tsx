import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { LocationSheet } from "@/components/engineering/report/LocationSheet";
import { OptionSheet } from "@/components/engineering/report/OptionSheet";
import { ChoiceChips, FieldLabel, InlineError, LineInput, Note, TextArea } from "@/components/engineering/workorder/sheetKit";
import { DetailRow, Panel, PanelTitle } from "@/components/engineering/assets/assetUi";
import { DateField } from "./DateField";
import { PhotoField } from "./PhotoField";
import { listAssetCategories, type AssetDetail } from "@/lib/api/assets";
import { CRITICALITY_LEVELS, ASSET_NOTES_MAX, ASSET_TEXT_MAX, type AssetFieldKey } from "@/lib/engineering/assetForm";
import { useAssetEditor } from "@/lib/engineering/useAssetEditor";
import { useAsyncResource } from "@/lib/engineering/useAsyncResource";
import { useLeaveGuard } from "@/lib/engineering/useLeaveGuard";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

interface Props {
  mode: "create" | "edit";
  /** Edit: the record as just read from the server. */
  original?: AssetDetail | null;
  onSaved: (asset: AssetDetail) => void;
  onLeave: () => void;
}

/** Register Equipment / Edit Equipment: one full-screen form, four short sections, saved by one button. */
export function AssetEditor({ mode, original = null, onSaved, onLeave }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const categories = useAsyncResource((signal) => listAssetCategories(signal), { scope, key: "asset-categories" });
  const categoryList = useMemo(() => categories.data ?? [], [categories.data]);
  const editor = useAssetEditor({ mode, scope, original, categories: categoryList, onSaved });
  const guard = useLeaveGuard({ dirty: editor.dirty && !editor.registered, blocked: editor.saving, onLeave });
  const [sheet, setSheet] = useState<"location" | "category" | null>(null);
  const { values, errors, showErrors } = editor;
  const create = mode === "create";

  const fieldError = (key: AssetFieldKey): string | null => {
    const code = errors[key];
    if (!code || !showErrors) return null;
    return t(`assets.form.errors.${code}`, { max: key === "notes" ? ASSET_NOTES_MAX : ASSET_TEXT_MAX });
  };
  const place =
    values.location?.kind === "room"
      ? t("assets.roomLabel", { room: values.location.roomNumber }) + (values.locationNote.trim() ? ` · ${values.locationNote.trim()}` : "")
      : values.location?.text ?? null;

  const header = (
    <View style={[styles.hero, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
      <Pressable onPress={guard.requestBack} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={8} style={styles.back} testID="asset-form-back">
        <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.shell.ink, fontSize: 15 }}>
          {t("common.back")}
        </Text>
      </Pressable>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heroTitle, { color: theme.shell.ink }]}>
        {t(create ? "assets.form.title.create" : "assets.form.title.edit")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroSub, { color: theme.shell.ink2 }]}>
        {t(create ? "assets.form.subtitle.create" : "assets.form.subtitle.edit")}
      </Text>
    </View>
  );

  // Registered, but the photo did not upload: the equipment exists, so say so and never offer to register it again.
  if (create && editor.registered && editor.photoFailed) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background }]} testID="asset-form-partial">
        {header}
        <View style={styles.partial}>
          <Ionicons name="checkmark-circle" size={44} color={theme.status.ready} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.partialTitle, { color: theme.textPrimary }]}>
            {t("assets.form.partial.title", { name: editor.registered.name })}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.partialBody, { color: theme.textSecondary }]}>
            {t("assets.form.partial.body")}
          </Text>
          <Button label={t("assets.form.partial.retry")} icon="camera-outline" onPress={() => void editor.submit()} loading={editor.saving} disabled={!isOnline} size="lg" testID="asset-form-retry-photo" />
          <Button label={t("assets.form.partial.open")} variant="secondary" onPress={editor.skipPhoto} disabled={editor.saving} testID="asset-form-open-registered" />
        </View>
      </View>
    );
  }

  const failure = editor.failure;
  const failureText =
    failure && failure.kind !== "conflict" && failure.kind !== "has_open_work"
      ? failure.kind === "unconfirmed"
        ? t(create ? "assets.form.failure.unconfirmedCreate" : "assets.form.failure.unconfirmedEdit")
        : failure.kind === "validation" && failure.message
          ? failure.message
          : t(`assets.form.failure.${failure.kind}`)
      : null;
  const submitLabel = editor.phase === "photo" ? t("assets.form.uploadingPhoto") : editor.saving ? t("assets.form.saving") : t(create ? "assets.form.submit.create" : "assets.form.submit.edit");
  const nothingToSave = !create && !editor.dirty;

  return (
    <KeyboardAvoidingView style={[styles.container, { backgroundColor: theme.background }]} behavior={Platform.OS === "ios" ? "padding" : undefined} testID="asset-form">
      {header}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {failureText ? (
          <View style={[styles.banner, { backgroundColor: theme.status.dirtySoft }]} accessibilityLiveRegion="assertive" testID="asset-form-failure">
            <Ionicons name="alert-circle" size={18} color={theme.status.dirty} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textPrimary }]}>
              {editor.photoFailed && !create ? t("assets.form.failure.photoAfterSave") : failureText}
            </Text>
          </View>
        ) : null}
        {failure?.kind === "conflict" ? (
          <Panel testID="asset-form-conflict">
            <PanelTitle>{t("assets.form.conflict.title")}</PanelTitle>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textSecondary }]}>
              {t("assets.form.conflict.body")}
            </Text>
            <Button label={t("assets.form.conflict.mine")} onPress={() => void editor.resolveConflict("mine")} testID="asset-form-conflict-mine" />
            <Button label={t("assets.form.conflict.latest")} variant="secondary" onPress={() => void editor.resolveConflict("latest")} testID="asset-form-conflict-latest" />
          </Panel>
        ) : null}
        {!isOnline ? <Note tone="warn" testID="asset-form-offline">{t(create ? "assets.form.offlineCreate" : "assets.form.offlineEdit")}</Note> : null}

        <Panel testID="asset-form-identity">
          <PanelTitle>{t("assets.form.sections.identity")}</PanelTitle>
          <View style={styles.field}>
            <FieldLabel required>{t("assets.form.name")}</FieldLabel>
            <LineInput value={values.name} onChangeText={(name) => editor.update({ name })} placeholder={t("assets.form.namePlaceholder")} maxLength={ASSET_TEXT_MAX} invalid={!!fieldError("name")} accessibilityLabel={t("assets.form.name")} testID="asset-form-name" />
            {fieldError("name") ? <InlineError testID="asset-form-name-error">{fieldError("name")}</InlineError> : null}
          </View>
          <View style={styles.field}>
            <FieldLabel required>{t("assets.form.category")}</FieldLabel>
            <Pressable
              onPress={() => setSheet("category")}
              accessibilityRole="button"
              accessibilityLabel={`${t("assets.form.category")}. ${values.categoryName ?? t("assets.form.choose")}`}
              style={[styles.pick, { borderColor: fieldError("categoryId") ? theme.status.dirty : theme.border, backgroundColor: theme.surfaceSubtle }]}
              testID="asset-form-category"
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ flex: 1, fontSize: 15, color: values.categoryName ? theme.textPrimary : theme.textDisabled }}>
                {values.categoryName ?? t("assets.form.choose")}
              </Text>
              <Ionicons name="chevron-down" size={18} color={theme.textMuted} />
            </Pressable>
            {categories.failure && !categories.data ? <InlineError>{t("assets.form.categoriesFailed")}</InlineError> : null}
            {fieldError("categoryId") ? <InlineError testID="asset-form-category-error">{fieldError("categoryId")}</InlineError> : null}
          </View>
          <View style={styles.field}>
            <FieldLabel>{t("assets.form.tag")}</FieldLabel>
            <LineInput value={values.assetTag} onChangeText={(assetTag) => editor.update({ assetTag })} placeholder={t("assets.form.tagPlaceholder")} autoCapitalize="characters" autoCorrect={false} maxLength={64} invalid={!!fieldError("assetTag")} accessibilityLabel={t("assets.form.tag")} testID="asset-form-tag" />
            {fieldError("assetTag") ? <InlineError testID="asset-form-tag-error">{fieldError("assetTag")}</InlineError> : <Note>{t("assets.form.tagHint")}</Note>}
          </View>
          {(["manufacturer", "model", "serialNumber"] as const).map((key) => (
            <View key={key} style={styles.field}>
              <FieldLabel>{t(`assets.form.${key}`)}</FieldLabel>
              <LineInput value={values[key]} onChangeText={(text) => editor.update({ [key]: text })} maxLength={ASSET_TEXT_MAX} autoCorrect={false} invalid={!!fieldError(key)} accessibilityLabel={t(`assets.form.${key}`)} testID={`asset-form-${key}`} />
              {fieldError(key) ? <InlineError>{fieldError(key)}</InlineError> : null}
            </View>
          ))}
        </Panel>

        <Panel testID="asset-form-location">
          <PanelTitle>{t("assets.form.sections.location")}</PanelTitle>
          <Pressable
            onPress={() => setSheet("location")}
            accessibilityRole="button"
            accessibilityLabel={`${t("assets.form.location")}. ${place ?? t("assets.form.choose")}`}
            style={[styles.pick, { borderColor: fieldError("location") ? theme.status.dirty : theme.border, backgroundColor: theme.surfaceSubtle }]}
            testID="asset-form-location-pick"
          >
            <Ionicons name={values.location?.kind === "room" ? "bed-outline" : "location-outline"} size={18} color={theme.textMuted} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ flex: 1, fontSize: 15, color: place ? theme.textPrimary : theme.textDisabled }}>
              {values.location?.kind === "room" ? t("assets.roomLabel", { room: values.location.roomNumber }) : (values.location?.text ?? t("assets.form.chooseLocation"))}
            </Text>
            <Ionicons name="chevron-down" size={18} color={theme.textMuted} />
          </Pressable>
          {values.location?.kind === "room" ? (
            <View style={styles.field}>
              <FieldLabel>{t("assets.form.locationNote")}</FieldLabel>
              <LineInput value={values.locationNote} onChangeText={(locationNote) => editor.update({ locationNote })} maxLength={255} placeholder={t("assets.form.locationNotePlaceholder")} accessibilityLabel={t("assets.form.locationNote")} testID="asset-form-location-note" />
            </View>
          ) : null}
          {values.location ? (
            <Pressable onPress={() => editor.update({ location: null, locationNote: "" })} accessibilityRole="button" style={styles.textButton} testID="asset-form-location-clear">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.status.dirty, fontSize: 14, fontWeight: "600" }}>
                {t("assets.form.clearLocation")}
              </Text>
            </Pressable>
          ) : (
            <Note>{t("assets.form.locationHint")}</Note>
          )}
          {fieldError("location") ? <InlineError>{fieldError("location")}</InlineError> : null}
        </Panel>

        <Panel testID="asset-form-details">
          <PanelTitle>{t("assets.form.sections.details")}</PanelTitle>
          <DateField label={t("assets.form.installed")} value={values.installationDate} onChange={(installationDate) => editor.update({ installationDate })} error={fieldError("installationDate")} testID="asset-form-installed" />
          <DateField label={t("assets.form.warranty")} value={values.warrantyExpires} onChange={(warrantyExpires) => editor.update({ warrantyExpires })} error={fieldError("warrantyExpires")} testID="asset-form-warranty" />
          <View style={styles.field}>
            <FieldLabel>{t("assets.form.criticality")}</FieldLabel>
            <ChoiceChips options={CRITICALITY_LEVELS.map((level) => ({ value: level, label: t(`assets.criticality.${level}`) }))} value={values.criticality} onChange={(criticality) => editor.update({ criticality })} testIDPrefix="asset-form-criticality" />
          </View>
          <View style={styles.field}>
            <FieldLabel>{t("assets.form.notes")}</FieldLabel>
            <TextArea value={values.notes} onChangeText={(notes) => editor.update({ notes })} maxLength={ASSET_NOTES_MAX} invalid={!!fieldError("notes")} accessibilityLabel={t("assets.form.notes")} testID="asset-form-notes" />
            {fieldError("notes") ? <InlineError>{fieldError("notes")}</InlineError> : null}
          </View>
          <View style={styles.field}>
            <FieldLabel>{t("assets.form.photo")}</FieldLabel>
            <PhotoField existingUrl={original?.photo_url ?? null} change={editor.photo} onChange={editor.setPhoto} disabled={editor.saving} isOnline={isOnline} />
          </View>
        </Panel>

        <Panel testID="asset-form-review">
          <PanelTitle>{t("assets.form.sections.review")}</PanelTitle>
          <DetailRow label={t("assets.detail.name")} value={values.name.trim() || t("assets.form.notSet")} />
          <DetailRow label={t("assets.detail.tag")} value={values.assetTag.trim() || t("assets.form.notSet")} />
          <DetailRow label={t("assets.detail.type")} value={values.categoryName ?? t("assets.form.notSet")} />
          <DetailRow label={t("assets.detail.location")} value={place ?? t("assets.form.notSet")} />
          <DetailRow label={t("assets.form.criticality")} value={t(`assets.criticality.${values.criticality}`)} />
          {values.installationDate ? <DetailRow label={t("assets.detail.installed")} value={values.installationDate} /> : null}
          {values.warrantyExpires ? <DetailRow label={t("assets.detail.warranty")} value={values.warrantyExpires} /> : null}
        </Panel>
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: theme.background, borderTopColor: theme.borderSubtle, paddingBottom: insets.bottom + 12 }]}>
        <Button
          label={submitLabel}
          onPress={() => void editor.submit()}
          loading={editor.saving}
          disabled={editor.saving || !isOnline || nothingToSave}
          size="lg"
          testID="asset-form-submit"
        />
      </View>

      <LocationSheet
        visible={sheet === "location"}
        current={values.location}
        recent={[]}
        isOnline={isOnline}
        onSelect={(location) => {
          editor.update({ location, locationNote: location.kind === "room" && values.location?.kind === "room" ? values.locationNote : "" });
          setSheet(null);
        }}
        onClose={() => setSheet(null)}
      />
      <OptionSheet
        visible={sheet === "category"}
        title={t("assets.form.category")}
        options={categoryList.map((c) => ({ value: c.id, label: c.name }))}
        value={values.categoryId}
        onSelect={(id) => editor.update({ categoryId: id, categoryName: categoryList.find((c) => c.id === id)?.name ?? null })}
        onClose={() => setSheet(null)}
        testID="asset-form-category-sheet"
      />
      <BottomSheet visible={guard.asking} title={t("assets.form.discard.title")} onClose={guard.keepEditing} testID="asset-form-discard-sheet">
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.bannerText, { color: theme.textSecondary }]}>
          {t("assets.form.discard.body")}
        </Text>
        <Button label={t("assets.form.discard.keep")} onPress={guard.keepEditing} size="lg" testID="asset-form-discard-keep" />
        <Button label={t("assets.form.discard.discard")} variant="secondary" onPress={guard.discard} testID="asset-form-discard-confirm" />
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, gap: 6 },
  back: { flexDirection: "row", alignItems: "center", minHeight: 44, marginLeft: -4 },
  heroTitle: { fontSize: 25, lineHeight: 30, fontWeight: "600" },
  heroSub: { fontSize: 13.5 },
  content: { paddingHorizontal: 18, paddingTop: 14, gap: 12 },
  field: { gap: 6 },
  pick: { minHeight: 48, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  textButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  banner: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, alignItems: "flex-start" },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20 },
  footer: { paddingHorizontal: 18, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  partial: { padding: 24, gap: 14, alignItems: "stretch" },
  partialTitle: { fontSize: 20, fontWeight: "600", textAlign: "center" },
  partialBody: { fontSize: 14.5, lineHeight: 21, textAlign: "center" },
});
