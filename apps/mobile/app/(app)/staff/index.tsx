import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/stores/appStore";
import { C, R } from "@/components/shared/tokens";
import { Avatar, Pill, SectionLabel } from "@/components/shared/mobileHandoff";

type StaffMember = {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  rooms_today?: number;
  orders_today?: number;
};

const ROLE_LABEL_KEYS: Record<string, string> = {
  housekeeper: "staff.roles.housekeeper",
  inspector: "staff.roles.inspector",
  engineer: "staff.roles.engineer",
  housekeeping_supervisor: "staff.roles.housekeeping_supervisor",
  chief_engineer: "staff.roles.chief_engineer",
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
  const { isOnline } = useAppStore();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadStaff = useCallback(async () => {
    if (!isOnline) { setLoading(false); return; }
    try {
      const res = await api.get<{ data: StaffMember[] }>("/staff");
      setStaff(res.data ?? []);
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
  const roleOrder = ["gm", "housekeeping_supervisor", "chief_engineer", "housekeeper", "inspector", "engineer", "front_desk"];
  const sortedGroups = roleOrder.filter((r) => grouped[r]?.length > 0);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>{t("tabs.staff")}</Text>
        <Text style={styles.subtitle}>{t("staff.activeCount", { count: staff.filter((m) => m.is_active).length })}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {sortedGroups.map((role) => (
          <View key={role}>
            <SectionLabel hint={`${grouped[role].length}`}>{t(ROLE_LABEL_KEYS[role] ?? role)}</SectionLabel>
            {grouped[role].map((member) => (
              <View key={member.id} style={styles.memberRow}>
                <Avatar name={member.full_name} size={38} />
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{member.full_name}</Text>
                  <Text style={styles.memberEmail}>{member.email}</Text>
                </View>
                {member.rooms_today != null ? (
                  <View style={styles.statBadge}>
                    <Text style={styles.statNum}>{member.rooms_today}</Text>
                    <Text style={styles.statLabel}>{t("staff.rooms")}</Text>
                  </View>
                ) : member.orders_today != null ? (
                  <View style={styles.statBadge}>
                    <Text style={styles.statNum}>{member.orders_today}</Text>
                    <Text style={styles.statLabel}>{t("staff.orders")}</Text>
                  </View>
                ) : null}
                <Pill tone="ready">{t("staff.active")}</Pill>
              </View>
            ))}
          </View>
        ))}

        {staff.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="people-outline" size={32} color={C.ink4} />
            <Text style={styles.emptyTitle}>{t("staff.noStaff")}</Text>
            <Text style={styles.emptyText}>{t("staff.pullToRefresh")}</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  header: {
    paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.line2, backgroundColor: C.paper, gap: 3,
  },
  title: { fontSize: 22, fontWeight: "700", color: C.ink },
  subtitle: { fontSize: 12, color: C.ink3 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 32, gap: 8 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 14, fontWeight: "600", color: C.ink },
  memberEmail: { fontSize: 11, color: C.ink4 },
  statBadge: { alignItems: "center", marginRight: 4 },
  statNum: { fontSize: 16, fontWeight: "700", color: C.ink },
  statLabel: { fontSize: 9, color: C.ink4, fontWeight: "600" },
  emptyCard: { alignItems: "center", paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 13, color: C.ink3 },
});
