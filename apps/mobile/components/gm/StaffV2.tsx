import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Notice, SectionHead } from "@/components/management/HomeParts";
import { ScreenHeader } from "@/components/shared/HeadersV2";
import { Avatar } from "@/components/shared/mobileHandoff";
import { radiusV2, spaceV2, touchV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { getStaff, type StaffMember } from "@/lib/api/staff";
import { useSource } from "@/lib/management/useSource";
import { useTheme } from "@/lib/theme/useTheme";
import { useAppStore } from "@/stores/appStore";

/* ─── GM Staff (Design System V2) ─────────────────────────────────────────────
   The active-staff directory the API already returns (`GET /staff`, GM/management roles only). It is a directory, not
   attendance: nothing here says who is on shift, and the screen says so. The per-person "rooms today" / "orders
   today" counts are the ones the API supplies, shown as given. Read-only. */

const ROLE_ORDER = ["gm", "housekeeping_supervisor", "chief_engineer", "engineer", "housekeeper", "inspector", "front_desk"];

export function StaffV2() {
  const { t } = useTranslation();
  const theme = useTheme();
  const isOnline = useAppStore((s) => s.isOnline);
  const source = useSource(async () => (await getStaff()).data?.staff ?? []);
  const [query, setQuery] = useState("");
  const [pulling, setPulling] = useState(false);

  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await source.refresh();
    } finally {
      setPulling(false);
    }
  }, [source]);

  const active = useMemo(() => (source.data ?? []).filter((m) => m.is_active), [source.data]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? active.filter((m) => `${m.full_name} ${m.email ?? ""}`.toLowerCase().includes(q)) : active;
  }, [active, query]);
  const groups = useMemo(() => {
    const by: Record<string, StaffMember[]> = {};
    for (const m of matches) (by[m.role] ??= []).push(m);
    const known = ROLE_ORDER.filter((r) => by[r]?.length);
    const other = Object.keys(by).filter((r) => !ROLE_ORDER.includes(r));
    return [...known, ...other].map((role) => ({ role, members: by[role] }));
  }, [matches]);

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]} testID="staff-v2">
      <ScreenHeader title={t("tabs.staff")} subtitle={source.data ? t("staffV2.summary", { count: active.length }) : undefined} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={theme.primaryAction} />}>
        {!isOnline ? <Notice testID="staff-offline" text={t("managementHome.notice.offline")} /> : source.stale ? <Notice testID="staff-stale" text={t("managementHome.notice.stale")} /> : null}
        <AppText variant="caption" tone="muted" testID="staff-note">
          {t("staffV2.note")}
        </AppText>

        <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border, borderRadius: radiusV2.input }]}>
          <Ionicons name="search-outline" size={18} color={theme.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t("staffV2.search")}
            placeholderTextColor={theme.textMuted}
            accessibilityLabel={t("staffV2.search")}
            autoCorrect={false}
            autoCapitalize="none"
            style={[styles.searchInput, { color: theme.textPrimary }]}
            testID="staff-search"
          />
        </View>

        {source.status === "loading" || (source.status === "idle" && isOnline) ? (
          <StateBlock status="loading" />
        ) : !source.data && !isOnline ? (
          <StateBlock status="offline" offlineTitle={t("staffV2.offline.title")} offlineBody={t("staffV2.offline.body")} />
        ) : !source.data ? (
          <StateBlock status="error" errorMessage={`${t("staffV2.error.title")}. ${t("staffV2.error.body")}`} onRetry={() => void onRefresh()} retryLabel={t("common.retry")} />
        ) : active.length === 0 ? (
          <StateBlock status="empty" emptyIcon="people-outline" emptyTitle={t("staff.noStaff")} emptyBody={t("staff.pullToRefresh")} />
        ) : matches.length === 0 ? (
          <StateBlock status="empty" emptyIcon="search-outline" emptyTitle={t("staffV2.noMatch")} emptyBody={t("staffV2.noMatchBody")} />
        ) : (
          groups.map(({ role, members }) => (
            <View key={role} style={styles.group} testID={`staff-group-${role}`}>
              <SectionHead title={`${t(`staff.roles.${role}`, { defaultValue: role })} · ${members.length}`} />
              <Card style={styles.card}>
                {members.map((m, index) => (
                  <View
                    key={m.id}
                    style={[styles.row, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSubtle }]}
                    accessible
                    accessibilityLabel={[m.full_name, m.rooms_today != null ? `${m.rooms_today} ${t("staff.rooms")}` : m.orders_today != null ? `${m.orders_today} ${t("staff.orders")}` : null].filter(Boolean).join(", ")}
                    testID={`staff-${m.id}`}
                  >
                    <Avatar name={m.full_name} size={40} />
                    <View style={styles.grow}>
                      <AppText variant="bodyStrong" numberOfLines={2}>
                        {m.full_name}
                      </AppText>
                      {m.email ? (
                        <AppText variant="caption" tone="muted" numberOfLines={1}>
                          {m.email}
                        </AppText>
                      ) : null}
                    </View>
                    {m.rooms_today != null || m.orders_today != null ? (
                      <View style={styles.stat}>
                        <AppText variant="headline" numeric>
                          {m.rooms_today ?? m.orders_today}
                        </AppText>
                        <AppText variant="micro" tone="muted">
                          {m.rooms_today != null ? t("staff.rooms") : t("staff.orders")}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                ))}
              </Card>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spaceV2.page, gap: spaceV2.md, paddingBottom: 40 },
  search: { flexDirection: "row", alignItems: "center", gap: spaceV2.sm, borderWidth: 1, paddingHorizontal: spaceV2.md, minHeight: touchV2.comfortable },
  searchInput: { flex: 1, fontSize: 16, minHeight: touchV2.comfortable },
  group: { gap: spaceV2.sm },
  card: { paddingVertical: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: spaceV2.md, padding: spaceV2.md, minHeight: 60 },
  grow: { flex: 1, minWidth: 0 },
  stat: { alignItems: "center", minWidth: 44 },
});
