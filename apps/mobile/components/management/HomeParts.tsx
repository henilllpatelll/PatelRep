import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, LinkButton, Kicker } from "@/components/home/homeUi";
import { radiusV2, spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { LinearProgress, type ProgressTone } from "@/components/ui/LinearProgress";
import { useTheme } from "@/lib/theme/useTheme";

type IconName = React.ComponentProps<typeof Ionicons>["name"];
export type PartTone = "neutral" | "alert" | "attention" | "ready" | "info";

export function useToneColors() {
  const theme = useTheme();
  const s = theme.status;
  return {
    neutral: { fg: theme.textSecondary, bg: theme.surfaceMuted, line: theme.borderSubtle },
    alert: { fg: s.dirty, bg: s.dirtySoft, line: s.dirtyLine },
    attention: { fg: s.pickup, bg: s.pickupSoft, line: s.pickupLine },
    ready: { fg: s.ready, bg: s.readySoft, line: s.readyLine },
    info: { fg: theme.primaryAction, bg: theme.primarySoft, line: theme.borderSubtle },
  } as const;
}

export function SectionHead({
  title,
  actionLabel,
  onAction,
  testID,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.sectionHead} testID={testID}>
      <Kicker>{title}</Kicker>
      {actionLabel && onAction ? <LinkButton label={actionLabel} onPress={onAction} testID={testID ? `${testID}-action` : undefined} /> : null}
    </View>
  );
}

/** A plain-language data-quality line (offline, partial, stale, failed). Announced politely; never decorative. */
export function Notice({ text, tone = "attention", testID }: { text: string; tone?: "attention" | "alert" | "neutral"; testID?: string }) {
  const c = useToneColors()[tone];
  return (
    <View style={[styles.notice, { backgroundColor: c.bg, borderColor: c.line }]} accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID}>
      <Ionicons name="information-circle-outline" size={18} color={c.fg} />
      <AppText variant="caption" style={styles.grow} maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {text}
      </AppText>
    </View>
  );
}

/** One exception that leads somewhere real. Icon + words carry the meaning; the tint only reinforces it. */
export function AttentionRow({
  icon,
  tone,
  title,
  subtitle,
  onPress,
  first,
  testID,
}: {
  icon: IconName;
  tone: PartTone;
  title: string;
  subtitle?: string;
  onPress: () => void;
  first?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  const c = useToneColors()[tone];
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle].filter(Boolean).join(". ")}
      style={({ pressed }) => [styles.row, !first && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.borderSubtle }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: c.bg }]}>
        <Ionicons name={icon} size={18} color={c.fg} />
      </View>
      <View style={styles.grow}>
        <AppText variant="bodyStrong" maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="caption" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={theme.textDisabled} />
    </Pressable>
  );
}

/** Count + share bar. The visible "x of y" text is the primary signal; the bar only illustrates it. */
export function ShareRow({
  label,
  count,
  total,
  tone,
  countText,
  a11yLabel,
  testID,
}: {
  label: string;
  count: number;
  total: number;
  tone: ProgressTone;
  countText?: string;
  a11yLabel: string;
  testID?: string;
}) {
  return (
    <View style={styles.share} testID={testID}>
      <View style={styles.shareTop}>
        <AppText variant="body" style={styles.grow} maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {label}
        </AppText>
        <AppText variant="bodyStrong" numeric maxFontSizeMultiplier={MAX_FONT_SCALE}>
          {countText ?? String(count)}
        </AppText>
      </View>
      <LinearProgress value={count} total={total} tone={tone} accessibilityLabel={a11yLabel} height={6} />
    </View>
  );
}

export function ActionTile({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tile, { backgroundColor: theme.surface, borderColor: theme.borderSubtle, borderRadius: radiusV2.card }, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.tileIcon, { backgroundColor: theme.primarySoft }]}>
        <Ionicons name={icon} size={20} color={theme.primaryAction} />
      </View>
      <AppText variant="bodyStrong" numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.grow}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 32 },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: spaceV2.sm, borderWidth: 1, borderRadius: radiusV2.control, padding: spaceV2.md },
  row: { flexDirection: "row", alignItems: "center", gap: spaceV2.md, minHeight: 56, paddingVertical: spaceV2.sm, paddingHorizontal: spaceV2.md },
  rowIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  share: { gap: 6 },
  shareTop: { flexDirection: "row", alignItems: "center", gap: spaceV2.sm },
  tile: { flexBasis: "47%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: spaceV2.sm, minHeight: 56, padding: spaceV2.md, borderWidth: 1 },
  tileIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
});
