import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/housekeeping/roomDetail/BottomSheet";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { SheetNotice } from "@/components/home/sheetParts";
import { R } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import type { AssignableStaff } from "@/lib/housekeeping/supervisor";
import { availabilityKey, filterStaff, roleKey } from "@/lib/housekeeping/supervisorComms";
import { knownValue, type Derived, type SourceState } from "@/lib/housekeeping/supervisorSources";
import type { TeamPulse } from "@/lib/housekeeping/supervisorTeam";
import { useTheme } from "@/lib/theme/useTheme";

interface Props {
  visible: boolean;
  /** The authorized staff list for this hotel (GET /staff, active housekeeping accounts only). */
  staff: SourceState<AssignableStaff[]>;
  /** Shift status and workload are added only when the board and roster were actually read. */
  team: Derived<TeamPulse>;
  viewerId: string | null;
  onSelect: (member: AssignableStaff) => void;
  onRetry: () => void;
  onClose: () => void;
}

/**
 * "Who do you want to message?" Opened by the Message staff quick action, which has no recipient yet.
 * One person is chosen, then the composer opens for exactly that person. The list is the hotel's own staff
 * list; the server re-checks the recipient on send, so this is convenience, not the security boundary.
 */
export function StaffPickerSheet({ visible, staff, team, viewerId, onSelect, onRetry, onClose }: Props) {
  if (!visible) return null;
  return <PickerBody staff={staff} team={team} viewerId={viewerId} onSelect={onSelect} onRetry={onRetry} onClose={onClose} />;
}

function PickerBody({ staff, team, viewerId, onSelect, onRetry, onClose }: Omit<Props, "visible">) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const all = knownValue(staff, []);
  const rows = useMemo(() => (all ? filterStaff(all, viewerId, query) : []), [all, viewerId, query]);
  const everyone = useMemo(() => (all ? filterStaff(all, viewerId, "") : []), [all, viewerId]);
  const pulseById = useMemo(() => new Map((team.value?.members ?? []).map((member) => [member.userId, member])), [team.value]);

  let content;
  if (staff.status === "loading") {
    content = <SheetNotice text={t("supervisorComms.picker.loading")} testID="picker-loading" />;
  } else if (all === null) {
    const forbidden = staff.status === "failed" && staff.failure.kind === "forbidden";
    content = (
      <View style={styles.stack}>
        <SheetNotice text={t(forbidden ? "supervisorComms.picker.forbidden" : "supervisorComms.picker.failed")} tone="error" testID="picker-failed" />
        {forbidden ? null : <Button label={t("supervisorComms.retry")} onPress={onRetry} variant="secondary" size="sm" testID="picker-retry" />}
      </View>
    );
  } else if (everyone.length === 0) {
    content = <SheetNotice text={t("supervisorComms.picker.empty")} testID="picker-empty" />;
  } else if (rows.length === 0) {
    content = <SheetNotice text={t("supervisorComms.picker.noResults", { query: query.trim() })} testID="picker-no-results" />;
  } else {
    content = (
      <View style={styles.list}>
        {rows.map((member) => {
          const pulse = pulseById.get(member.userId);
          const role = roleKey(member.role);
          const status = t(availabilityKey(team.value ? (pulse?.availability ?? "unknown") : "unknown"));
          const total = pulse?.load?.total ?? 0;
          const work = team.value ? (total > 0 ? t("supervisorComms.picker.rooms", { count: total }) : t("supervisorComms.picker.noRooms")) : null;
          const meta = [role ? t(role) : null, status, work].filter(Boolean).join(" · ");
          return (
            <Pressable
              key={member.userId}
              onPress={() => onSelect(member)}
              testID={`picker-${member.userId}`}
              accessibilityRole="button"
              accessibilityLabel={t("supervisorComms.picker.pickA11y", { name: member.name, role: role ? t(role) : "", status })}
              style={({ pressed }) => [styles.row, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border }, pressed && { opacity: 0.75 }]}
            >
              <Avatar name={member.name} size={40} />
              <View style={styles.rowBody}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={1}>
                  {member.name}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.meta, { color: theme.textSecondary }]} numberOfLines={2}>
                  {meta}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <BottomSheet
      visible
      title={t("supervisorComms.picker.title")}
      onClose={onClose}
      grabber
      tall
      testID="staff-picker-sheet"
      footer={<Button label={t("common.cancel")} onPress={onClose} variant="secondary" testID="picker-cancel" />}
    >
      <View style={styles.body}>
        {all && everyone.length > 0 ? (
          <TextInput
            testID="picker-search"
            value={query}
            onChangeText={setQuery}
            placeholder={t("supervisorComms.picker.search")}
            placeholderTextColor={theme.textMuted}
            accessibilityLabel={t("supervisorComms.picker.searchLabel")}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
            style={[styles.search, { backgroundColor: theme.surfaceSubtle, borderColor: theme.border, color: theme.textPrimary }]}
          />
        ) : null}
        {content}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12 },
  stack: { gap: 8 },
  search: { minHeight: MIN_TARGET, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 14, fontSize: 15 },
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TARGET + 12, padding: 10, borderWidth: 1, borderRadius: R.md },
  rowBody: { flex: 1, gap: 1 },
  name: { fontSize: 15, fontWeight: "700" },
  meta: { fontSize: 12.5, lineHeight: 17 },
});
