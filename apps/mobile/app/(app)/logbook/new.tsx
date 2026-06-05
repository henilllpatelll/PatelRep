import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { C, R } from "@/components/shared/tokens";
import { HeroButton } from "@/components/shared/mobileHandoff";

export default function NewLogbookEntryScreen() {
  const { t } = useTranslation();
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
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={C.accent} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>{t("logbook.newEntryTitle")}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>{t("logbook.fieldTitle")}</Text>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder={t("logbook.titlePlaceholder")}
          placeholderTextColor={C.ink4}
          maxLength={120}
        />

        <Text style={styles.fieldLabel}>{t("logbook.fieldDetails")}</Text>
        <TextInput
          style={[styles.input, styles.bodyInput]}
          value={body}
          onChangeText={setBody}
          placeholder={t("logbook.detailsPlaceholder")}
          placeholderTextColor={C.ink4}
          multiline
          numberOfLines={6}
          textAlignVertical="top"
        />

        <View style={styles.urgentRow}>
          <View>
            <Text style={styles.urgentLabel}>{t("logbook.markUrgent")}</Text>
            <Text style={styles.urgentSub}>{t("logbook.markUrgentSub")}</Text>
          </View>
          <Switch
            value={isUrgent}
            onValueChange={setIsUrgent}
            trackColor={{ true: C.alert, false: C.line }}
            thumbColor={C.surface}
          />
        </View>

        {!isOnline ? (
          <View style={styles.offlineWarning}>
            <Ionicons name="cloud-offline-outline" size={14} color={C.caution} />
            <Text style={styles.offlineText}>{t("logbook.offlineWarning")}</Text>
          </View>
        ) : null}

        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}

        <HeroButton
          primary
          onPress={submit}
        >
          {saving ? (
            <ActivityIndicator size="small" color={C.surface} />
          ) : (
            t("logbook.save")
          )}
        </HeroButton>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.line2, backgroundColor: C.paper,
    gap: 10,
  },
  backBtn: { padding: 2 },
  topBarTitle: { fontSize: 17, fontWeight: "700", color: C.ink },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 40, gap: 10 },
  fieldLabel: { fontSize: 12, fontWeight: "700", color: C.ink3, textTransform: "uppercase", letterSpacing: 0.6 },
  input: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: R.md, paddingHorizontal: 13, paddingVertical: 11,
    fontSize: 14, color: C.ink,
  },
  bodyInput: { minHeight: 120, textAlignVertical: "top" },
  urgentRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.line,
    borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12,
  },
  urgentLabel: { fontSize: 14, fontWeight: "600", color: C.ink },
  urgentSub: { fontSize: 11, color: C.ink3, marginTop: 2 },
  offlineWarning: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: C.cautionSoft, borderWidth: 1, borderColor: C.cautionLine,
    borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 10,
  },
  offlineText: { fontSize: 12, color: C.caution },
  errorText: { fontSize: 13, color: C.alert, fontWeight: "600" },
  submitBtn: { marginTop: 8 },
});
