import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { monoFont } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { getProgress, groupBySection, itemKey, type ChecklistItem } from "@/lib/housekeeping/cleanSession";
import { MAX_FONT_SCALE } from "./BottomSheet";

const LOST_FOUND_LABEL = /lost\s*(&|and)?\s*found/i;

interface Props {
  title: string;
  items: ChecklistItem[];
  /** Item keys whose latest state is on this device only. */
  pendingKeys: ReadonlySet<string>;
  /** Finished or waiting on the server: items cannot change. */
  locked: boolean;
  /** Shown instead of the list while there is nothing to render. */
  placeholder?: string | null;
  /** Inspector's note per correction label (reclean only). */
  notes?: Record<string, string>;
  onToggle: (key: string, checked: boolean) => void;
  onReportFoundItem: () => void;
}

function AnimatedBox({ checked }: { checked: boolean }) {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  const reduceMotion = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled?.().then((value) => {
      reduceMotion.current = Boolean(value);
    });
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!checked || reduceMotion.current) return;
    scale.setValue(0.82);
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }).start();
  }, [checked, scale]);

  return (
    <Animated.View
      style={[
        styles.box,
        { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, transform: [{ scale }] },
        checked && { backgroundColor: theme.status.ready, borderColor: theme.status.ready },
      ]}
    >
      {checked ? <Ionicons name="checkmark" size={18} color={theme.onPrimary} /> : null}
    </Animated.View>
  );
}

/**
 * The server-snapshotted checklist, grouped by the configured sections in their
 * original order. Rows are big tap targets; sections collapse so the one being
 * worked stays on screen; expansion is held here so it survives re-renders and
 * background syncs (the list is never re-fetched per tick).
 */
export function CleaningChecklist({ title, items, pendingKeys, locked, placeholder, notes, onToggle, onReportFoundItem }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const progress = getProgress(items);
  const groups = groupBySection(items);
  const grouped = groups.length > 1;
  const hasRequired = progress.requiredTotal > 0;

  // Explicit user choices, plus sections we have already opened for them so the
  // list does not fold up under their finger when a section completes.
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [autoOpened, setAutoOpened] = useState<ReadonlySet<string>>(new Set());
  const firstOpen = groups.find((group) => group.items.some((item) => !item.checked))?.section ?? groups[0]?.section;

  useEffect(() => {
    if (!firstOpen || autoOpened.has(firstOpen)) return;
    setAutoOpened((prev) => new Set(prev).add(firstOpen));
  }, [firstOpen, autoOpened]);

  const isOpen = (section: string) => chosen[section] ?? (!grouped || autoOpened.has(section) || section === firstOpen);

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="cleaning-checklist">
      <View style={styles.header}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
          {title}
        </Text>
        {items.length > 0 ? (
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.count, { color: theme.textSecondary }]}
            accessibilityLabel={t("rooms.work.checklist.progressA11y", { done: progress.done, total: progress.total })}
            testID="checklist-count"
          >
            {progress.done} / {progress.total}
          </Text>
        ) : null}
      </View>

      {items.length > 0 ? (
        <View
          style={[styles.track, { backgroundColor: theme.surfaceSubtle }]}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: progress.total, now: progress.done }}
        >
          <View
            style={[
              styles.fill,
              { backgroundColor: theme.status.ready, width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` },
            ]}
          />
        </View>
      ) : null}

      {items.length > 0 && hasRequired ? (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.requiredSummary, { color: progress.requiredRemaining.length === 0 ? theme.status.ready : theme.status.pickup }]}
        >
          {t("rooms.detail.session.requiredProgress", { done: progress.requiredDone, total: progress.requiredTotal })}
        </Text>
      ) : null}

      {items.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.placeholder, { color: theme.textMuted }]}>
          {placeholder ?? t("rooms.detail.session.noChecklist")}
        </Text>
      ) : null}

      {groups.map((group) => {
        const done = group.items.filter((item) => item.checked).length;
        const open = isOpen(group.section);
        return (
          <View key={group.section} style={styles.group} testID={`checklist-section-${group.section}`}>
            {grouped ? (
              <Pressable
                onPress={() => setChosen((prev) => ({ ...prev, [group.section]: !open }))}
                style={styles.sectionHeader}
                accessibilityRole="button"
                accessibilityLabel={t("rooms.work.checklist.sectionA11y", { section: group.section, done, total: group.items.length })}
                accessibilityState={{ expanded: open }}
                testID={`checklist-toggle-${group.section}`}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionTitle, { color: theme.textSecondary }]}>
                  {group.section}
                </Text>
                <View style={styles.sectionRight}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionCount, { color: done === group.items.length ? theme.status.ready : theme.textMuted }]}>
                    {done} / {group.items.length}
                  </Text>
                  <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.textMuted} />
                </View>
              </Pressable>
            ) : null}

            {open
              ? group.items.map((item) => {
                  const key = itemKey(item);
                  const pending = pendingKeys.has(key);
                  const note = notes?.[item.label];
                  const label = `${item.label}${item.is_required ? `, ${t("rooms.detail.session.required")}` : hasRequired ? `, ${t("rooms.work.checklist.optional")}` : ""}`;
                  return (
                    <View key={key}>
                      <Pressable
                        style={styles.row}
                        onPress={() => {
                          if (!locked) onToggle(key, !item.checked);
                        }}
                        accessibilityRole="checkbox"
                        accessibilityLabel={pending ? `${label}, ${t("rooms.work.checklist.saving")}` : label}
                        accessibilityHint={locked ? t("rooms.work.checklist.lockedHint") : undefined}
                        accessibilityState={{ checked: item.checked, disabled: locked }}
                        testID={`checklist-item-${key}`}
                      >
                        <AnimatedBox checked={item.checked} />
                        <View style={styles.rowCopy}>
                          <Text
                            maxFontSizeMultiplier={MAX_FONT_SCALE}
                            style={[
                              styles.rowText,
                              { color: theme.textPrimary },
                              item.checked && { color: theme.textMuted, textDecorationLine: "line-through" },
                            ]}
                          >
                            {item.label}
                          </Text>
                          {note ? (
                            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowNote, { color: theme.textSecondary }]}>
                              {note}
                            </Text>
                          ) : null}
                        </View>
                        {pending ? (
                          <View testID={`pending-${key}`} accessible={false}>
                            <Ionicons name="cloud-upload-outline" size={15} color={theme.textMuted} />
                          </View>
                        ) : null}
                        {item.is_required && !item.checked ? (
                          <Text
                            maxFontSizeMultiplier={MAX_FONT_SCALE}
                            style={[styles.tag, { color: theme.status.pickup, borderColor: theme.status.pickupLine, backgroundColor: theme.status.pickupSoft }]}
                          >
                            {t("rooms.detail.session.required")}
                          </Text>
                        ) : !item.is_required && !item.checked && hasRequired ? (
                          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.optional, { color: theme.textMuted }]}>
                            {t("rooms.work.checklist.optional")}
                          </Text>
                        ) : null}
                      </Pressable>
                      {LOST_FOUND_LABEL.test(item.label) && item.checked ? (
                        <Pressable
                          style={styles.lostFound}
                          onPress={onReportFoundItem}
                          accessibilityRole="button"
                          accessibilityLabel={t("rooms.detail.lostFoundLink")}
                        >
                          <Ionicons name="bag-outline" size={14} color={theme.status.pickup} />
                          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.lostFoundText, { color: theme.status.pickup }]}>
                            {t("rooms.detail.lostFoundLink")}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })
              : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { flex: 1, fontSize: 16, fontWeight: "900" },
  count: { fontFamily: monoFont, fontSize: 15, fontWeight: "800" },
  track: { height: 8, borderRadius: 4, overflow: "hidden" },
  fill: { height: 8, borderRadius: 4 },
  requiredSummary: { fontSize: 13, fontWeight: "700" },
  placeholder: { fontSize: 14, lineHeight: 20 },
  group: { gap: 2 },
  sectionHeader: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitle: { flex: 1, fontSize: 12, fontWeight: "900", letterSpacing: 0.7, textTransform: "uppercase" },
  sectionRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionCount: { fontFamily: monoFont, fontSize: 13, fontWeight: "800" },
  row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, gap: 2 },
  rowText: { fontSize: 15, fontWeight: "600", lineHeight: 21 },
  rowNote: { fontSize: 13, lineHeight: 18 },
  tag: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  optional: { fontSize: 11, fontWeight: "700" },
  lostFound: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, marginLeft: 40 },
  lostFoundText: { fontSize: 13, fontWeight: "800", textDecorationLine: "underline" },
});
