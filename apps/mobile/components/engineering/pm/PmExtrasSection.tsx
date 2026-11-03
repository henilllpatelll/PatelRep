import { Pressable, StyleSheet, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { PmDraft, PmDraftDefect, PmDraftPart } from "@/lib/engineering/pmChecklist";
import { PmPhotoField } from "./PmPhotoField";

interface Props {
  draft: PmDraft;
  patch: (fn: (d: PmDraft) => PmDraft) => void;
  online: boolean;
  uploading: boolean;
  /** Review was attempted: show field errors. */
  showErrors: boolean;
  invalidPartIds: ReadonlySet<string>;
  invalidDefectIds: ReadonlySet<string>;
  laborInvalid: boolean;
  onAddPhoto: (uri: string, signal: AbortSignal) => Promise<void>;
  onRemovePhoto: (evidenceId: string) => void;
  /** Reports where a field sits inside this section so "Fix this" can scroll to it. */
  onAnchor?: (key: string, y: number) => void;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const SEVERITIES: ReadonlyArray<NonNullable<PmDraftDefect["severity"]>> = ["low", "medium", "high"];

function Label({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: theme.textMuted }]}>
      {children}
    </Text>
  );
}

function Input(props: React.ComponentProps<typeof TextInput> & { invalid?: boolean }) {
  const theme = useTheme();
  const { invalid, style, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={theme.textDisabled}
      {...rest}
      style={[styles.input, { color: theme.textPrimary, borderColor: invalid ? theme.status.dirty : theme.border, backgroundColor: theme.surfaceSubtle }, style]}
    />
  );
}

/**
 * Everything beyond the checklist: labor, parts, extra defects, general photos and final notes. Parts and labor are
 * recorded with the inspection exactly as typed - the API does not deduct stock for a PM, and the copy says so.
 */
export function PmExtrasSection({ draft, patch, online, uploading, showErrors, invalidPartIds, invalidDefectIds, laborInvalid, onAddPhoto, onRemovePhoto, onAnchor }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  const anchor = (key: string) => (e: LayoutChangeEvent) => onAnchor?.(key, e.nativeEvent.layout.y);
  const setPart = (id: string, change: Partial<PmDraftPart>) => patch((d) => ({ ...d, parts: d.parts.map((p) => (p.id === id ? { ...p, ...change } : p)) }));
  const setDefect = (id: string, change: Partial<PmDraftDefect>) => patch((d) => ({ ...d, defects: d.defects.map((x) => (x.id === id ? { ...x, ...change } : x)) }));

  return (
    <View style={styles.wrap} testID="pm-extras">
      <View onLayout={anchor("labor")}>
        <Label>{t("pm.extras.labor")}</Label>
      </View>
      <Input
        value={draft.laborMinutes}
        onChangeText={(laborMinutes) => patch((d) => ({ ...d, laborMinutes: laborMinutes.replace(/[^0-9]/g, "") }))}
        keyboardType="number-pad"
        placeholder={t("pm.extras.laborPlaceholder")}
        invalid={showErrors && laborInvalid}
        accessibilityLabel={t("pm.extras.labor")}
        testID="pm-labor-input"
      />
      {showErrors && laborInvalid ? (
        <Text style={[styles.error, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
          {t("pm.errors.laborInvalid")}
        </Text>
      ) : null}

      <Label>{t("pm.extras.parts")}</Label>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
        {t("pm.extras.partsNote")}
      </Text>
      {draft.parts.map((part) => (
        <View key={part.id} onLayout={anchor(`part:${part.id}`)}>
        <View style={styles.pair}>
          <Input
            value={part.name}
            onChangeText={(name) => setPart(part.id, { name })}
            placeholder={t("pm.extras.partName")}
            invalid={showErrors && invalidPartIds.has(part.id)}
            style={styles.grow}
            accessibilityLabel={t("pm.extras.partName")}
            testID={`pm-part-${part.id}-name`}
          />
          <Input
            value={part.qty}
            onChangeText={(qty) => setPart(part.id, { qty: qty.replace(/[^0-9.]/g, "") })}
            keyboardType="decimal-pad"
            placeholder={t("pm.extras.qty")}
            invalid={showErrors && invalidPartIds.has(part.id)}
            style={styles.qty}
            accessibilityLabel={t("pm.extras.qty")}
            testID={`pm-part-${part.id}-qty`}
          />
          <Pressable
            onPress={() => patch((d) => ({ ...d, parts: d.parts.filter((p) => p.id !== part.id) }))}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel={t("pm.extras.remove")}
          >
            <Ionicons name="trash-outline" size={20} color={theme.textMuted} />
          </Pressable>
        </View>
        {showErrors && invalidPartIds.has(part.id) ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
            {t("pm.errors.partInvalid")}
          </Text>
        ) : null}
        </View>
      ))}
      <Pressable
        onPress={() => patch((d) => ({ ...d, parts: [...d.parts, { id: newId(), name: "", qty: "1" }] }))}
        style={styles.add}
        accessibilityRole="button"
        testID="pm-part-add"
      >
        <Ionicons name="add-circle-outline" size={20} color={theme.primaryAction} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.addText, { color: theme.primaryAction }]}>
          {t("pm.extras.addPart")}
        </Text>
      </Pressable>

      <Label>{t("pm.extras.defects")}</Label>
      {draft.defects.map((defect) => (
        <View key={defect.id} style={styles.defect} onLayout={anchor(`defect:${defect.id}`)}>
          <View style={styles.pair}>
            <Input
              value={defect.description}
              onChangeText={(description) => setDefect(defect.id, { description })}
              placeholder={t("pm.extras.defectPlaceholder")}
              invalid={showErrors && invalidDefectIds.has(defect.id)}
              style={styles.grow}
              multiline
              accessibilityLabel={t("pm.extras.defectPlaceholder")}
              testID={`pm-defect-${defect.id}-text`}
            />
            <Pressable
              onPress={() => patch((d) => ({ ...d, defects: d.defects.filter((x) => x.id !== defect.id) }))}
              style={styles.iconButton}
              accessibilityRole="button"
              accessibilityLabel={t("pm.extras.remove")}
            >
              <Ionicons name="trash-outline" size={20} color={theme.textMuted} />
            </Pressable>
          </View>
          {showErrors && invalidDefectIds.has(defect.id) ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.error, { color: theme.status.dirty }]} accessibilityLiveRegion="polite">
              {t("pm.errors.defectInvalid")}
            </Text>
          ) : null}
          <View style={styles.severity} accessibilityRole="radiogroup">
            {SEVERITIES.map((sev) => {
              const selected = defect.severity === sev;
              return (
                <Pressable
                  key={sev}
                  onPress={() => setDefect(defect.id, { severity: selected ? null : sev })}
                  style={[styles.sevChip, { borderColor: selected ? theme.primaryLine : theme.border, backgroundColor: selected ? theme.primarySoft : theme.surfaceSubtle }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                >
                  <Text maxFontSizeMultiplier={1.3} style={[styles.sevText, { color: selected ? theme.primaryAction : theme.textPrimary }]}>
                    {t(`pm.severity.${sev}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
      <Pressable
        onPress={() => patch((d) => ({ ...d, defects: [...d.defects, { id: newId(), description: "", severity: null }] }))}
        style={styles.add}
        accessibilityRole="button"
        testID="pm-defect-add"
      >
        <Ionicons name="add-circle-outline" size={20} color={theme.primaryAction} />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.addText, { color: theme.primaryAction }]}>
          {t("pm.extras.addDefect")}
        </Text>
      </Pressable>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.hint, { color: theme.textMuted }]}>
        {t("pm.extras.defectsNote")}
      </Text>

      <Label>{t("pm.extras.generalPhotos")}</Label>
      <PmPhotoField photos={draft.photos} uploading={uploading} online={online} onAdd={onAddPhoto} onRemove={onRemovePhoto} testID="pm-general-photos" />

      <Label>{t("pm.extras.notes")}</Label>
      <Input
        value={draft.notes}
        onChangeText={(notes) => patch((d) => ({ ...d, notes }))}
        placeholder={t("pm.extras.notesPlaceholder")}
        multiline
        style={styles.notes}
        accessibilityLabel={t("pm.extras.notes")}
        testID="pm-notes-input"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  label: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, marginTop: 8, textTransform: "uppercase" },
  hint: { fontSize: 13, lineHeight: 18 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15 },
  notes: { minHeight: 90, textAlignVertical: "top" },
  pair: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1 },
  qty: { width: 76 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  add: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  addText: { fontSize: 14, fontWeight: "700" },
  defect: { gap: 8 },
  severity: { flexDirection: "row", gap: 8 },
  sevChip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  sevText: { fontSize: 14, fontWeight: "600" },
  error: { fontSize: 13 },
});
