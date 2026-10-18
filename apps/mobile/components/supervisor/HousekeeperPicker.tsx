import { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import { Avatar } from "@/components/shared/mobileHandoff";
import { Button } from "@/components/ui/Button";
import {
  shownMinutes,
  type PickerCandidate,
  type PickerFilter,
  type PickerModel,
  type StaffWorkload,
} from "@/lib/housekeeping/roomAssignment";
import type { AssignableStaff, TeamLoad } from "@/lib/housekeeping/supervisor";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Housekeeper picker ────────────────────────────────────────────────────
   `HousekeeperPickerBody` is the searchable list used inside the Room Detail drawer (one Modal, no stacking).
   `HousekeeperPicker` is the bottom-sheet wrapper the Assignments screen already uses: same props as before,
   one tap still chooses. Neither shows "Assigned": a saved assignment is announced by whoever saved it, after
   the server confirmed. Availability and workload come from `roomAssignment` — never inferred here. */

type Translate = (key: string, options?: Record<string, unknown>) => string;

const AVAILABILITY_ICON: Record<string, keyof typeof Ionicons.glyphMap> = {
  on_shift: "checkmark-circle-outline",
  on_break: "cafe-outline",
  ended: "time-outline",
  not_clocked_in: "remove-circle-outline",
  unknown: "help-circle-outline",
};

function floorsText(floors: number[], t: Translate): string | null {
  if (floors.length === 0 || floors.length > 3) return null;
  return t(floors.length === 1 ? "roomBoard.assign.picker.floorOne" : "roomBoard.assign.picker.floorMany", { floors: floors.join(", ") });
}

export function workloadText(workload: StaffWorkload, t: Translate): string {
  const rooms = t("roomBoard.assign.picker.rooms", { count: workload.total });
  if (workload.total === 0) return t("roomBoard.assign.picker.noRooms");
  const minutes = shownMinutes(workload);
  const tail =
    minutes === null
      ? t("roomBoard.assign.picker.noEstimate")
      : workload.remainingRooms === 0
        ? t("roomBoard.assign.picker.nothingLeft")
        : t(workload.minutesComplete ? "roomBoard.assign.picker.remaining" : "roomBoard.assign.picker.remainingAtLeast", { minutes });
  return `${rooms} · ${tail}`;
}

function CandidateRow({
  candidate,
  selected,
  showAvailability,
  t,
  onSelect,
}: {
  candidate: PickerCandidate;
  selected: boolean;
  showAvailability: boolean;
  t: Translate;
  onSelect: (userId: string) => void;
}) {
  const theme = useTheme();
  const name = candidate.name ?? t("roomBoard.assign.picker.nameUnavailable");
  const load = workloadText(candidate.workload, t);
  const availability = t(`roomBoard.assign.availability.${candidate.availability}`);
  const floors = floorsText(candidate.floors, t);
  const action = candidate.isCurrent
    ? t("roomBoard.assign.picker.current")
    : selected
      ? t("roomBoard.assign.picker.selected")
      : t("roomBoard.assign.picker.select");
  const label = [name, showAvailability ? availability : null, load, candidate.workload.overloaded ? t("roomBoard.assign.picker.overload") : null, candidate.isCurrent ? t("roomBoard.assign.picker.currentA11y") : null]
    .filter(Boolean)
    .join(". ");
  return (
    <Pressable
      onPress={() => onSelect(candidate.userId)}
      disabled={candidate.isCurrent}
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: candidate.isCurrent }}
      accessibilityLabel={label}
      accessibilityHint={action}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: selected ? theme.primarySoft : theme.surface,
          borderColor: selected ? theme.primaryAction : theme.border,
          borderWidth: selected ? 2 : 1,
        },
        candidate.isCurrent && styles.rowDimmed,
        pressed && !candidate.isCurrent && styles.rowPressed,
      ]}
      testID={`picker-${candidate.userId}`}
    >
      <Avatar name={candidate.name ?? "?"} size={40} />
      <View style={styles.rowBody}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} numberOfLines={2} style={[styles.rowName, { color: theme.textPrimary }]}>
          {name}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLine, { color: theme.textSecondary }]}>
          {load}
        </Text>
        {showAvailability || floors ? (
          <View style={styles.metaRow}>
            {showAvailability ? (
              <View style={styles.metaItem}>
                <Ionicons name={AVAILABILITY_ICON[candidate.availability] ?? "help-circle-outline"} size={14} color={theme.textSecondary} />
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowMeta, { color: theme.textSecondary }]} testID={`picker-${candidate.userId}-availability`}>
                  {availability}
                </Text>
              </View>
            ) : null}
            {floors ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowMeta, { color: theme.textMuted }]}>
                {floors}
              </Text>
            ) : null}
          </View>
        ) : null}
        {candidate.workload.overloaded ? (
          <View style={styles.metaItem}>
            <Ionicons name="warning-outline" size={14} color={theme.destructiveAction} />
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowMeta, { color: theme.destructiveAction }]}>
              {t("roomBoard.assign.picker.overload")}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.rowAction}>
        <Ionicons
          name={selected ? "radio-button-on" : candidate.isCurrent ? "person-circle-outline" : "radio-button-off"}
          size={22}
          color={selected ? theme.primaryAction : theme.textMuted}
        />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowActionText, { color: selected ? theme.primaryAction : theme.textMuted }]}>
          {action}
        </Text>
      </View>
    </Pressable>
  );
}

export function HousekeeperPickerBody({
  picker,
  query,
  selectedId,
  t,
  showAvailability = true,
  hideFilters = false,
  onQuery,
  onFilter,
  onSelect,
}: {
  picker: PickerModel;
  query: string;
  selectedId: string | null;
  t: Translate;
  showAvailability?: boolean;
  /** No On shift / All staff chips and no unverified note (the Assignments screen has no roster to speak of). */
  hideFilters?: boolean;
  onQuery: (query: string) => void;
  onFilter: (filter: PickerFilter) => void;
  onSelect: (userId: string) => void;
}) {
  const theme = useTheme();
  const chip = (filter: PickerFilter, label: string) => {
    const active = picker.filter === filter;
    return (
      <Pressable
        key={filter}
        onPress={() => onFilter(filter)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        accessibilityLabel={label}
        style={[styles.chip, { backgroundColor: active ? theme.primaryAction : theme.surfaceMuted, borderColor: active ? theme.primaryAction : theme.border }]}
        testID={`picker-filter-${filter}`}
      >
        {active ? <Ionicons name="checkmark" size={14} color={theme.onPrimary} /> : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: active ? theme.onPrimary : theme.textPrimary }]}>
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.body}>
      <View style={[styles.searchBox, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="search-outline" size={18} color={theme.textMuted} />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder={t("roomBoard.assign.picker.search")}
          placeholderTextColor={theme.textMuted}
          accessibilityLabel={t("roomBoard.assign.picker.searchLabel")}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.searchInput, { color: theme.textPrimary }]}
          testID="picker-search"
        />
        {query ? (
          <Pressable onPress={() => onQuery("")} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("roomBoard.search.clear")} testID="picker-search-clear">
            <Ionicons name="close-circle" size={18} color={theme.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {hideFilters ? null : picker.rosterVerified ? (
        <View style={styles.chips} accessibilityRole="tablist">
          {chip("on_shift", t("roomBoard.assign.picker.filterOnShift", { count: picker.counts.onShift }))}
          {chip("all", t("roomBoard.assign.picker.filterAll", { count: picker.counts.all }))}
        </View>
      ) : (
        <View style={[styles.note, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]} accessibilityRole="alert" testID="picker-unverified">
          <Ionicons name="help-circle-outline" size={16} color={theme.textSecondary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.noteText, { color: theme.textSecondary }]}>
            {t("roomBoard.assign.picker.unverified")}
          </Text>
        </View>
      )}

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled" nestedScrollEnabled testID="picker-list">
        {picker.empty ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.empty, { color: theme.textMuted }]} testID="picker-empty">
            {t(`roomBoard.assign.picker.empty.${picker.empty}`, { query: query.trim() })}
          </Text>
        ) : (
          picker.candidates.map((candidate) => (
            <CandidateRow
              key={candidate.userId}
              candidate={candidate}
              selected={candidate.userId === selectedId}
              showAvailability={showAvailability}
              t={t}
              onSelect={onSelect}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

/* ─── Assignments screen wrapper (unchanged contract) ─────────────────────── */

function legacyWorkload(load: TeamLoad | undefined): StaffWorkload {
  if (!load) {
    return { total: 0, completed: 0, inProgress: 0, remainingRooms: 0, remainingMinutes: 0, roomsWithoutEstimate: 0, minutesComplete: true, overloaded: false };
  }
  return {
    total: load.total,
    completed: load.done,
    inProgress: load.inProgress,
    remainingRooms: Math.max(0, load.total - load.done),
    // TeamLoad caps its minutes at a working day: past that the figure is a floor, never the total.
    remainingMinutes: load.minutesLeft,
    roomsWithoutEstimate: 0,
    minutesComplete: !load.overAssigned,
    overloaded: load.overAssigned,
  };
}

export function HousekeeperPicker({
  visible,
  roomNumber,
  customTitle,
  staff,
  loads,
  saving,
  onSelect,
  onClose,
}: {
  visible: boolean;
  roomNumber: string | null;
  customTitle?: string | null;
  staff: AssignableStaff[];
  loads: TeamLoad[];
  saving: boolean;
  onSelect: (member: AssignableStaff) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [query, setQuery] = useState("");
  const loadById = new Map(loads.map((load) => [load.housekeeperId, load]));
  const needle = query.trim().toLowerCase();
  const everyone: PickerCandidate[] = staff.map((member) => ({
    userId: member.userId,
    name: member.name.trim() && member.name.trim() !== "—" ? member.name.trim() : null,
    availability: "unknown",
    workload: legacyWorkload(loadById.get(member.userId)),
    floors: [],
    isCurrent: false,
    ack: null,
    projection: null,
  }));
  const candidates = needle ? everyone.filter((candidate) => candidate.name?.toLowerCase().includes(needle)) : everyone;
  const picker: PickerModel = {
    filter: "all",
    candidates,
    counts: { onShift: 0, all: everyone.length },
    // This screen has no shift roster, so it makes no availability claim and offers no On shift list.
    rosterVerified: false,
    empty: candidates.length === 0 ? (everyone.length === 0 ? "no_staff" : "no_match") : null,
  };
  const title = customTitle ?? (roomNumber ? t("roomBoard.assign.picker.titleAssign", { room: roomNumber }) : t("picker.titleGeneric"));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} accessible={false} />
      <View
        accessibilityViewIsModal
        style={[styles.sheet, { paddingBottom: Math.max(20, insets.bottom + 12), backgroundColor: theme.background }]}
        testID="housekeeper-picker"
      >
        <View style={[styles.grabber, { backgroundColor: theme.border }]} />
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {title}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.subtitle, { color: theme.textMuted }]}>
          {t("roomBoard.assign.picker.subtitle")}
        </Text>
        <HousekeeperPickerBodyLegacy
          picker={picker}
          query={query}
          saving={saving}
          t={t}
          onQuery={setQuery}
          onSelect={(userId) => {
            const member = staff.find((candidate) => candidate.userId === userId);
            if (member && !saving) onSelect(member);
          }}
        />
        <Button label={t("common.cancel")} onPress={onClose} variant="secondary" loading={saving} style={styles.cancelBtn} />
      </View>
    </Modal>
  );
}

/** The shared body with the on-shift chips hidden (the Assignments screen has no roster). */
function HousekeeperPickerBodyLegacy({
  picker,
  query,
  saving,
  t,
  onQuery,
  onSelect,
}: {
  picker: PickerModel;
  query: string;
  saving: boolean;
  t: Translate;
  onQuery: (query: string) => void;
  onSelect: (userId: string) => void;
}) {
  return (
    <View pointerEvents={saving ? "none" : "auto"} style={saving ? styles.rowDimmed : undefined}>
      <HousekeeperPickerBody
        picker={picker}
        query={query}
        selectedId={null}
        t={t}
        showAvailability={false}
        hideFilters
        onQuery={onQuery}
        onFilter={() => undefined}
        onSelect={onSelect}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 16, paddingTop: 10, maxHeight: "85%" },
  grabber: { alignSelf: "center", width: 38, height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: "800", letterSpacing: 0.4 },
  subtitle: { fontSize: 13, marginTop: 2, marginBottom: 10 },
  body: { gap: 10, flexShrink: 1 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 12, minHeight: 48 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, minHeight: 44, justifyContent: "center" },
  chipText: { fontSize: 13.5, fontWeight: "700" },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderWidth: 1, borderRadius: R.md, padding: 10 },
  noteText: { flex: 1, fontSize: 12.5, lineHeight: 17 },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { gap: 8, paddingBottom: 6 },
  empty: { fontSize: 13.5, lineHeight: 19, textAlign: "center", paddingVertical: 22, paddingHorizontal: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: R.lg, paddingHorizontal: 12, paddingVertical: 11, minHeight: 64 },
  rowDimmed: { opacity: 0.55 },
  rowPressed: { opacity: 0.85 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowName: { fontSize: 15, fontWeight: "700" },
  rowLine: { fontSize: 12.5, lineHeight: 17 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 2 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  rowMeta: { fontSize: 12, fontWeight: "600" },
  rowAction: { alignItems: "center", gap: 2, minWidth: 56 },
  rowActionText: { fontSize: 11, fontWeight: "700" },
  cancelBtn: { marginTop: 12 },
});
