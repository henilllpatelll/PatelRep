import { useCallback, useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { getStaff, type StaffMember } from "@/lib/api/staff";
import { useAppStore } from "@/stores/appStore";
import { Card } from "@/components/ui/Card";
import { Avatar, Pill, SectionLabel } from "@/components/shared/mobileHandoff";
import { StateBlock } from "@/components/ui/StateBlock";
import { useTheme } from "@/lib/theme/useTheme";


const ROLE_LABEL_KEYS: Record<string, string> = {
  housekeeper: "staff.roles.housekeeper",
  inspector: "staff.roles.inspector",
  engineer: "staff.roles.engineer",
  housekeeping_supervisor: "staff.roles.housekeeping_supervisor",
  front_desk: "staff.roles.front_desk",
  gm: "staff.roles.gm",
};

function groupByRole(members: StaffMember[]) {
  const groups: Record<string, StaffMember[]> = {};
  for (const m of members) {
    const key = m.role;
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }
  return groups;
}

export default function StaffScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isOnline } = useAppStore();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStaff = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const res = await getStaff();
      setStaff(res.data?.staff ?? []);
    } catch {
      setStaff([]);
    } finally {
      setLoading(false);
    }
  }, [isOnline]);

  useEffect(() => { loadStaff(); }, [loadStaff]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadStaff();
    setRefreshing(false);
  }, [loadStaff]);

  const grouped = groupByRole(staff.filter((m) => m.is_active));
  const roleOrder = ["gm", "housekeeping_supervisor", "engineer", "housekeeper", "inspector", "engineer", "front_desk"];
  const sortedGroups = roleOrder.filter((r) => grouped[r]?.length > 0);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("tabs.staff")}</Text>
        <Text style={[styles.subtitle, { color: theme.textMuted }]}>{t("staff.activeCount", { count: staff.filter((m) => m.is_active).length })}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        {sortedGroups.map((role) => (
          <View key={role}>
            <SectionLabel hint={`${grouped[role].length}`}>{t(ROLE_LABEL_KEYS[role] ?? role)}</SectionLabel>
            {grouped[role].map((member) => (
              <Card key={member.id} style={styles.memberRow}>
                <Avatar name={member.full_name} size={38} />
                <View style={styles.memberInfo}>
                  <Text style={[styles.memberName, { color: theme.textPrimary }]}>{member.full_name}</Text>
                  <Text style={[styles.memberEmail, { color: theme.textDisabled }]}>{member.email}</Text>
                </View>
                {member.rooms_today != null ? (
                  <View style={styles.statBadge}>
                    <Text style={[styles.statNum, { color: theme.textPrimary }]}>{member.rooms_today}</Text>
                    <Text style={[styles.statLabel, { color: theme.textDisabled }]}>{t("staff.rooms")}</Text>
                  </View>
                ) : member.orders_today != null ? (
                  <View style={styles.statBadge}>
                    <Text style={[styles.statNum, { color: theme.textPrimary }]}>{member.orders_today}</Text>
                    <Text style={[styles.statLabel, { color: theme.textDisabled }]}>{t("staff.orders")}</Text>
                  </View>
                ) : null}
                <Pill tone="ready">{t("staff.active")}</Pill>
              </Card>
            ))}
          </View>
        ))}

        {staff.length === 0 ? (
          <StateBlock
            status="empty"
            emptyIcon="people-outline"
            emptyTitle={t("staff.noStaff")}
            emptyBody={t("staff.pullToRefresh")}
            style={styles.emptyCard}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, gap: 3,
  },
  title: { fontSize: 22, fontWeight: "700" },
  subtitle: { fontSize: 12 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 8 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: "600" },
  memberEmail: { fontSize: 11 },
  statBadge: { alignItems: "center", marginRight: 4 },
  statNum: { fontSize: 16, fontWeight: "700" },
  statLabel: { fontSize: 9, fontWeight: "600" },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
});
