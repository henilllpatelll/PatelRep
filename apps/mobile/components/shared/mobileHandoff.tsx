import React from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C, R, aiTokens, darkTheme, monoFont, statusTokens } from "@/components/shared/tokens";

export type Tone =
  | "neutral"
  | "dirty"
  | "occupied"
  | "progress"
  | "clean"
  | "ready"
  | "pickup"
  | "accent"
  | "ai"
  | "alert"
  | "caution"
  | "info"
  | "ooo";

const toneColors: Record<Tone, { bg: string; fg: string; line: string }> = {
  neutral: { bg: C.surface3, fg: C.ink2, line: C.line },
  dirty: { bg: C.alertSoft, fg: C.alert, line: C.alertLine },
  occupied: { bg: C.alertSoft, fg: C.occupied, line: C.alertLine },
  progress: { bg: C.cautionSoft, fg: C.caution, line: C.cautionLine },
  clean: { bg: C.infoSoft, fg: C.info, line: C.infoLine },
  ready: { bg: C.readySoft, fg: C.ready, line: C.readyLine },
  pickup: { bg: C.cautionSoft, fg: C.caution, line: C.cautionLine },
  accent: { bg: C.accentSoft, fg: C.accent, line: C.accentLine },
  ai: { bg: C.aiSoft, fg: C.ai, line: C.aiLine },
  alert: { bg: C.alertSoft, fg: C.alert, line: C.alertLine },
  caution: { bg: C.cautionSoft, fg: C.caution, line: C.cautionLine },
  info: { bg: C.infoSoft, fg: C.info, line: C.infoLine },
  ooo: { bg: C.oooSoft, fg: C.ooo, line: C.oooLine },
};

export function getToneColors(tone: Tone) {
  return toneColors[tone];
}

export function getRoomTone(status?: string): Tone {
  switch (status) {
    case "DIRTY":
      return "dirty";
    case "OCCUPIED":
      return "occupied";
    case "IN_PROGRESS":
      return "progress";
    case "CLEAN":
      return "clean";
    case "INSPECTED":
      return "ready";
    case "PICKUP":
      return "pickup";
    case "OOO":
    case "OUT_OF_ORDER":
    case "OUT_OF_SERVICE":
      return "ooo";
    default:
      return "neutral";
  }
}

export function Mono({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.mono, style]}>{children}</Text>;
}

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const palette = [C.accent, C.ready, C.caution, C.info, C.brass, C.ai];
  const hash = name.split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 0);

  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette[hash % palette.length],
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials || "?"}</Text>
    </View>
  );
}

export function IconButton({
  icon,
  tone = "neutral",
  size = 36,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  tone?: Tone;
  size?: number;
}) {
  const colors = toneColors[tone];

  return (
    <View
      style={[
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: R.md,
          backgroundColor: colors.bg,
          borderColor: colors.line,
        },
      ]}
    >
      <Ionicons name={icon} size={size > 40 ? 18 : 16} color={colors.fg} />
    </View>
  );
}

export function Pill({
  children,
  tone = "neutral",
  icon,
}: {
  children: React.ReactNode;
  tone?: Tone;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
}) {
  const colors = toneColors[tone];

  return (
    <View style={[styles.pill, { backgroundColor: colors.bg, borderColor: colors.line }]}>
      {icon ? <Ionicons name={icon} size={10} color={colors.fg} /> : null}
      <Text style={[styles.pillText, { color: colors.fg }]}>{children}</Text>
    </View>
  );
}

export function AILabel({ children = "AI", confidence }: { children?: string; confidence?: number }) {
  return (
    <View style={[styles.aiLabel, { backgroundColor: C.aiSoft, borderColor: C.aiLine }]}>
      <Ionicons name="sparkles" size={9} color={C.ai} />
      <Text style={styles.aiLabelText}>{children}</Text>
      {confidence != null ? <Mono style={styles.aiConfidence}>{confidence}%</Mono> : null}
    </View>
  );
}

export function AIChip({
  children,
  icon = "sparkles",
}: {
  children: React.ReactNode;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
}) {
  return (
    <View style={styles.aiChip}>
      <Ionicons name={icon} size={10} color={C.ai} />
      <Text style={styles.aiChipText}>{children}</Text>
    </View>
  );
}

export function AIInsightCard({
  title,
  children,
  actions,
  compact = false,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <View style={[styles.aiInsightCard, compact && styles.aiInsightCardCompact]}>
      <AILabel>{title}</AILabel>
      {typeof children === "string" || typeof children === "number" ? (
        <Text style={[styles.aiInsightText, compact && styles.aiInsightTextCompact]}>{children}</Text>
      ) : (
        <View style={styles.aiInsightContent}>{children}</View>
      )}
      {actions ? <View style={styles.aiInsightActions}>{actions}</View> : null}
    </View>
  );
}

export function SectionLabel({
  children,
  hint,
  action,
}: {
  children: React.ReactNode;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={styles.sectionLabel}>
      <View style={styles.sectionLeft}>
        <Text style={styles.sectionText}>{children}</Text>
        {hint ? <Mono style={styles.sectionHint}>{hint}</Mono> : null}
      </View>
      {action}
    </View>
  );
}

export function HeroButton({
  children,
  icon,
  primary,
  onDark = true,
  onPress,
}: {
  children: React.ReactNode;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  primary?: boolean;
  onDark?: boolean;
  onPress?: () => void;
}) {
  const backgroundColor = primary ? C.accent : onDark ? "rgba(255,253,252,0.11)" : C.surface;
  const color = primary ? "#fff" : onDark ? C.paper : C.ink;

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={onPress}
      style={[
        styles.heroButton,
        { backgroundColor },
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={color} /> : null}
      <Text style={[styles.heroButtonText, { color }]}>{children}</Text>
      {primary && !icon ? <Ionicons name="arrow-forward" size={14} color={color} /> : null}
    </TouchableOpacity>
  );
}

export function FloatingAIButton({
  label = "Ask AI",
  onPress,
  bottom = 92,
}: {
  label?: string;
  onPress?: () => void;
  bottom?: number;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={onPress}
      style={[styles.floatingAIButton, { bottom }]}
    >
      <Ionicons name="sparkles" size={15} color="#fff" />
      <Text style={styles.floatingAIText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function Segmented({
  items,
}: {
  items: Array<{ label: string; count?: number; active?: boolean; onPress?: () => void }>;
}) {
  return (
    <View style={styles.segmented}>
      {items.map((item) => (
        <TouchableOpacity
          key={item.label}
          onPress={item.onPress}
          activeOpacity={item.onPress ? 0.7 : 1}
          style={[
            styles.segment,
            {
              backgroundColor: item.active ? C.ink : C.surface,
              borderColor: item.active ? C.primary : C.line,
            },
          ]}
        >
          <Text style={[styles.segmentText, { color: item.active ? C.paper : C.ink2 }]}>{item.label}</Text>
          {item.count != null ? (
            <Mono style={[styles.segmentCount, { color: item.active ? C.paper : C.ink3 }]}>
              {item.count}
            </Mono>
          ) : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function CopilotHero({
  kicker,
  confidence,
  children,
  actions,
  foot,
  tone = "dark",
}: {
  kicker: string;
  confidence?: number;
  children: React.ReactNode;
  actions?: React.ReactNode;
  foot?: React.ReactNode;
  tone?: "dark" | "violet";
}) {
  const dark = tone === "dark";

  return (
    <View
      style={[
        styles.copilotHero,
        {
          backgroundColor: dark ? darkTheme.surfaceElevated : C.aiSoft,
          borderWidth: 1,
          borderColor: dark ? darkTheme.glassBorder : C.aiLine,
        },
      ]}
    >
      <View style={[styles.sparkWash, { backgroundColor: dark ? darkTheme.ai.line : aiTokens.line }]} />
      <View style={styles.copilotHeader}>
        <View style={[styles.sparkAvatar, { backgroundColor: dark ? darkTheme.ai.primary : C.ai }]}>
          <Ionicons name="sparkles" size={12} color="#fff" />
        </View>
        <Text style={[styles.copilotKicker, { color: dark ? darkTheme.ai.primary : C.ai }]}>
          {kicker}
        </Text>
        {confidence != null ? (
          <View style={styles.confidence}>
            <View style={styles.confidenceDot} />
            <Mono style={[styles.confidenceText, { color: dark ? darkTheme.ai.secondary : C.ai }]}>
              {confidence}% sure
            </Mono>
          </View>
        ) : null}
      </View>
      <Text style={[styles.copilotBody, { color: dark ? C.paper : C.ink }]}>{children}</Text>
      {actions ? <View style={styles.heroActions}>{actions}</View> : null}
      {foot ? (
        <View style={[styles.heroFoot, { borderTopColor: dark ? darkTheme.glassBorder : C.aiLine }]}>
          {foot}
        </View>
      ) : null}
    </View>
  );
}

export function RoomNumberTile({
  roomNumber,
  status,
  size = 46,
}: {
  roomNumber: string;
  status: string;
  size?: number;
}) {
  const tone = getRoomTone(status);
  const colors = toneColors[tone];

  return (
    <View
      style={[
        styles.roomTile,
        {
          width: size,
          height: size,
          borderRadius: size >= 40 ? R.md : 8,
          backgroundColor: colors.bg,
          borderColor: colors.line,
        },
      ]}
    >
      <Mono style={[styles.roomTileNumber, { fontSize: size >= 40 ? 14 : 13 }]}>{roomNumber}</Mono>
      <View style={[styles.statusDot, { backgroundColor: colors.fg }]} />
    </View>
  );
}

export function ProgressRing({
  value,
  total,
}: {
  value: number;
  total: number;
}) {
  return (
    <View style={styles.ringOuter}>
      <View style={styles.ringInner}>
        <Text style={styles.ringValue}>{value}</Text>
        <Mono style={styles.ringSub}>of {total}</Mono>
      </View>
    </View>
  );
}

export function HandoffRow({
  lead,
  title,
  sub,
  right,
  style,
  onPress,
}: {
  lead: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.row, style]}>
      {lead}
      <View style={styles.rowBody}>
        <View style={styles.rowTitle}>{title}</View>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mono: {
    fontFamily: monoFont,
    fontVariant: ["tabular-nums"],
  },
  avatar: {
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  avatarText: {
    color: "#fff",
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  iconButton: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    flexShrink: 0,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
  },
  pillText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  aiLabel: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  aiLabelText: {
    color: C.ai,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  aiConfidence: {
    color: C.ai,
    fontSize: 10,
    opacity: 0.72,
  },
  aiChip: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: C.aiLine,
    backgroundColor: C.aiSoft,
    borderRadius: 999,
    minHeight: 24,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  aiChipText: {
    color: C.ai,
    fontSize: 10.5,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  aiInsightCard: {
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.aiLine,
    backgroundColor: C.aiSoft,
    padding: 14,
    gap: 8,
  },
  aiInsightCardCompact: {
    padding: 12,
  },
  aiInsightText: {
    color: C.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "500",
  },
  aiInsightTextCompact: {
    fontSize: 13,
    lineHeight: 18,
  },
  aiInsightContent: {
    gap: 5,
  },
  aiInsightActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  sectionLabel: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  sectionLeft: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 10,
  },
  sectionText: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.1,
    color: C.ink3,
  },
  sectionHint: {
    fontSize: 11,
    color: C.ink4,
  },
  copilotHero: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 16,
    paddingHorizontal: 17,
    paddingVertical: 15,
  },
  sparkWash: {
    position: "absolute",
    top: 0,
    right: 0,
    width: 5,
    height: "100%",
  },
  copilotHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 9,
  },
  sparkAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  copilotKicker: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  confidence: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  confidenceDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: C.ready,
  },
  confidenceText: {
    fontSize: 11,
    fontWeight: "700",
  },
  copilotBody: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "500",
  },
  heroActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
    marginTop: 15,
  },
  heroFoot: {
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  heroButton: {
    minHeight: 48,
    borderRadius: 13,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  heroButtonText: {
    fontSize: 15,
    fontWeight: "600",
  },
  floatingAIButton: {
    position: "absolute",
    right: 16,
    minHeight: 48,
    borderRadius: 999,
    paddingHorizontal: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: C.ai,
    borderWidth: 1,
    borderColor: C.aiLine,
    shadowColor: C.ai,
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  floatingAIText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  segmented: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  segment: {
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  segmentText: {
    fontSize: 12.5,
    fontWeight: "600",
  },
  segmentCount: {
    fontSize: 11,
    fontWeight: "700",
    opacity: 0.72,
  },
  roomTile: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    gap: 2,
    flexShrink: 0,
  },
  roomTileNumber: {
    color: C.ink,
    fontWeight: "700",
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  ringOuter: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 7,
    borderColor: statusTokens.ready,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.surface,
  },
  ringInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  ringValue: {
    fontSize: 26,
    lineHeight: 28,
    color: C.ink,
  },
  ringSub: {
    fontSize: 10,
    color: C.ink3,
  },
  row: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 15,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  rowSub: {
    fontSize: 13,
    color: C.ink3,
    marginTop: 3,
    lineHeight: 16,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 5,
  },
});
