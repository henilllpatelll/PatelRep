import { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { R } from "@/components/shared/tokens";
import { IconButton } from "@/components/shared/mobileHandoff";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function NewLogbookEntryScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isOnline } = useAppStore();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isUrgent, setIsUrgent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && body.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || !isOnline) return;
    setSaving(true);
    setError(null);
    try {
      await api.post("/logbook/entries", {
        title: title.trim(),
        body: body.trim(),
        is_urgent: isUrgent,
        department_id: null,
      });
      router.back();
    } catch {
      setError(t("logbook.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.topBar,
          { borderBottomColor: theme.borderSubtle, backgroundColor: theme.background },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t("logbook.newEntryTitle")}
        >
          <IconButton icon="chevron-back" tone="accent" size={36} />
        </Pressable>
        <Text style={[styles.topBarTitle, { color: theme.textPrimary }]}>
          {t("logbook.newEntryTitle")}
        </Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
          {t("logbook.fieldTitle")}
        </Text>
        <TextInput
          style={[
            styles.input,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              color: theme.textPrimary,
            },
          ]}
          value={title}
          onChangeText={setTitle}
          placeholder={t("logbook.titlePlaceholder")}
          placeholderTextColor={theme.textDisabled}
          maxLength={120}
        />

        <Text style={[styles.fieldLabel, { color: theme.textMuted }]}>
          {t("logbook.fieldDetails")}
        </Text>
        <TextInput
          style={[
            styles.input,
            styles.bodyInput,
            {
              backgroundColor: theme.surface,
              borderColor: theme.border,
              color: theme.textPrimary,
            },
          ]}
          value={body}
          onChangeText={setBody}
          placeholder={t("logbook.detailsPlaceholder")}
          placeholderTextColor={theme.textDisabled}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
        />

        <Card style={styles.urgentRow}>
          <View>
            <Text style={[styles.urgentLabel, { color: theme.textPrimary }]}>
              {t("logbook.markUrgent")}
            </Text>
            <Text style={[styles.urgentSub, { color: theme.textMuted }]}>
              {t("logbook.markUrgentSub")}
            </Text>
          </View>
          <Switch
            value={isUrgent}
            onValueChange={setIsUrgent}
            trackColor={{ true: theme.status.dirty, false: theme.border }}
            thumbColor={theme.surface}
          />
        </Card>

        {!isOnline ? (
          <View
            style={[
              styles.offlineWarning,
              {
                backgroundColor: theme.status.pickupSoft,
                borderColor: theme.status.pickupLine,
              },
            ]}
          >
            <Ionicons name="cloud-offline-outline" size={14} color={theme.status.pickup} />
            <Text style={[styles.offlineText, { color: theme.status.pickup }]}>
              {t("logbook.offlineWarning")}
            </Text>
          </View>
        ) : null}

        {error ? (
          <Text style={[styles.errorText, { color: theme.status.dirty }]}>{error}</Text>
        ) : null}

        <Button
          label={t("logbook.save")}
          onPress={submit}
          loading={saving}
          disabled={!canSubmit || !isOnline}
          style={styles.submitBtn}
          testID="logbook-save-button"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12,
    borderBottomWidth: 1,
    gap: 10,
  },
  backBtn: { borderRadius: R.md },
  topBarTitle: { fontSize: 17, fontWeight: "700" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 40, gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 },
  input: {
    borderWidth: 1,
    borderRadius: R.md, paddingHorizontal: 13, paddingVertical: 11,
    fontSize: 14,
  },
  bodyInput: { minHeight: 120, textAlignVertical: "top" },
  urgentRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 14, paddingVertical: 12,
  },
  urgentLabel: { fontSize: 14, fontWeight: "600" },
  urgentSub: { fontSize: 11, marginTop: 2 },
  offlineWarning: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1,
    borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10,
  },
  offlineText: { fontSize: 12 },
  errorText: { fontSize: 13, fontWeight: "600" },
  submitBtn: { marginTop: 8 },
});
