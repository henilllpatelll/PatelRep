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
import {
  R,
  darkTheme,
  lightTheme,
  monoFont,
  type ThemeTokens,
} from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";

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

export function getToneColors(
  tone: Tone,
  theme: ThemeTokens = lightTheme,
) {
  const tones: Record<Tone, { bg: string; fg: string; line: string }> = {
    neutral: {
      bg: theme.surfaceMuted,
      fg: theme.textSecondary,
      line: theme.border,
    },
    dirty: {
      bg: theme.status.dirtySoft,
      fg: theme.status.dirty,
      line: theme.status.dirtyLine,
    },
    occupied: {
      bg: theme.status.dirtySoft,
      fg: theme.status.occupied,
      line: theme.status.dirtyLine,
    },
    progress: {
      bg: theme.status.inProgressSoft,
      fg: theme.status.inProgress,
      line: theme.status.inProgressLine,
    },
    clean: {
      bg: theme.status.cleanSoft,
      fg: theme.status.clean,
      line: theme.status.cleanLine,
    },
    ready: {
      bg: theme.status.readySoft,
      fg: theme.status.ready,
      line: theme.status.readyLine,
    },
    pickup: {
      bg: theme.status.pickupSoft,
      fg: theme.status.pickup,
      line: theme.status.pickupLine,
    },
    accent: {
      bg: theme.primarySoft,
      fg: theme.primaryAction,
      line: theme.primaryLine,
    },
    ai: {
      bg: theme.ai.soft,
      fg: theme.ai.primary,
      line: theme.ai.line,
    },
    alert: {
      bg: theme.status.dirtySoft,
      fg: theme.status.dirty,
      line: theme.status.dirtyLine,
    },
    caution: {
      bg: theme.status.pickupSoft,
      fg: theme.status.pickup,
      line: theme.status.pickupLine,
    },
    info: {
      bg: theme.status.cleanSoft,
      fg: theme.status.clean,
      line: theme.status.cleanLine,
    },
    ooo: {
      bg: theme.status.outOfOrderSoft,
      fg: theme.status.outOfOrder,
      line: theme.status.outOfOrderLine,
    },
  };

  return tones[tone];
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
  const theme = useTheme();
  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const palette = [
    theme.primaryAction,
    theme.status.ready,
    theme.status.pickup,
    theme.status.clean,
    theme.accentBrass,
    theme.ai.primary,
  ];
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
      <Text
        style={[
          styles.avatarText,
          { color: theme.shell.ink, fontSize: size * 0.38 },
        ]}
      >
        {initials || "?"}
      </Text>
    </View>
  );
}

export function IconButton({
  icon,
  tone = "neutral",
  size = 44,
  accessibilityLabel,
  onPress,
  disabled = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  tone?: Tone;
  size?: number;
  accessibilityLabel?: string;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const colors = getToneColors(tone, theme);
  const targetSize = Math.max(size, 44);
  const content = (
    <Ionicons
      name={icon}
      size={targetSize > 40 ? 18 : 16}
      color={colors.fg}
    />
  );
  const visualStyle = {
    width: targetSize,
    height: targetSize,
    borderRadius: R.md,
    backgroundColor: colors.bg,
    borderColor: colors.line,
  };

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.iconButton,
          visualStyle,
          pressed && !disabled ? styles.pressed : null,
          disabled ? styles.disabled : null,
        ]}
      >
        {content}
      </Pressable>
    );
  }

  return (
    <View
      accessible={Boolean(accessibilityLabel)}
      accessibilityRole={accessibilityLabel ? "image" : undefined}
      accessibilityLabel={accessibilityLabel}
      style={[styles.iconButton, visualStyle]}
    >
      {content}
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
  const theme = useTheme();
  const colors = getToneColors(tone, theme);

  return (
    <View style={[styles.pill, { backgroundColor: colors.bg, borderColor: colors.line }]}>
      {icon ? <Ionicons name={icon} size={10} color={colors.fg} /> : null}
      <Text style={[styles.pillText, { color: colors.fg }]}>{children}</Text>
    </View>
  );
}

export function AILabel({ children = "AI", confidence }: { children?: string; confidence?: number }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.aiLabel,
        { backgroundColor: theme.ai.soft, borderColor: theme.ai.line },
      ]}
    >
      <Ionicons name="sparkles" size={9} color={theme.ai.primary} />
      <Text style={[styles.aiLabelText, { color: theme.ai.primary }]}>
        {children}
      </Text>
      {confidence != null ? (
        <Mono style={[styles.aiConfidence, { color: theme.ai.primary }]}>
          {confidence}%
        </Mono>
      ) : null}
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
  const theme = useTheme();
  return (
    <View
      style={[
        styles.aiChip,
        { borderColor: theme.ai.line, backgroundColor: theme.ai.soft },
      ]}
    >
      <Ionicons name={icon} size={10} color={theme.ai.primary} />
      <Text style={[styles.aiChipText, { color: theme.ai.primary }]}>
        {children}
      </Text>
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
  const theme = useTheme();
  return (
    <View
      style={[
        styles.aiInsightCard,
        {
          backgroundColor: theme.ai.soft,
          borderColor: theme.ai.line,
        },
        compact && styles.aiInsightCardCompact,
      ]}
    >
      <AILabel>{title}</AILabel>
      {typeof children === "string" || typeof children === "number" ? (
        <Text
          style={[
            styles.aiInsightText,
            { color: theme.textPrimary },
            compact && styles.aiInsightTextCompact,
          ]}
        >
          {children}
        </Text>
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
  const theme = useTheme();
  return (
    <View style={styles.sectionLabel}>
      <View style={styles.sectionLeft}>
        <Text style={[styles.sectionText, { color: theme.textMuted }]}>
          {children}
        </Text>
        {hint ? (
          <Mono style={[styles.sectionHint, { color: theme.textDisabled }]}>
            {hint}
          </Mono>
        ) : null}
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
  accessibilityLabel,
  disabled = false,
}: {
  children: React.ReactNode;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  primary?: boolean;
  onDark?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const palette = onDark ? darkTheme : theme;
  const backgroundColor = primary
    ? palette.primaryAction
    : onDark
      ? darkTheme.glass
      : palette.surface;
  const color = primary
    ? palette.onPrimary
    : onDark
      ? darkTheme.textPrimary
      : palette.textPrimary;
  const fallbackLabel =
    typeof children === "string" || typeof children === "number"
      ? String(children)
      : undefined;

  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? fallbackLabel}
      accessibilityState={{ disabled }}
      style={[
        styles.heroButton,
        { backgroundColor },
        disabled ? styles.disabled : null,
      ]}
    >
      {icon ? <Ionicons name={icon} size={14} color={color} /> : null}
      <Text style={[styles.heroButtonText, { color }]}>{children}</Text>
      {primary && !icon ? <Ionicons name="arrow-forward" size={14} color={color} /> : null}
    </TouchableOpacity>
  );
}

export function FloatingAIButton({
  onPress,
  bottom = 92,
  accessibilityLabel = "Open AI Copilot",
  disabled = false,
}: {
  onPress?: () => void;
  bottom?: number;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <TouchableOpacity
      activeOpacity={0.84}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={[
        styles.floatingAIButton,
        {
          bottom,
          backgroundColor: theme.ai.primary,
          borderColor: theme.ai.line,
          shadowColor: theme.ai.primary,
        },
        disabled ? styles.disabled : null,
      ]}
    >
      <Ionicons name="sparkles" size={20} color={theme.onAi} />
    </TouchableOpacity>
  );
}

export function Segmented({
  items,
  accessibilityLabel,
}: {
  items: Array<{
    label: string;
    count?: number;
    active?: boolean;
    disabled?: boolean;
    onPress?: () => void;
  }>;
  accessibilityLabel?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={styles.segmented}
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
    >
      {items.map((item) => {
        const disabled = item.disabled === true || !item.onPress;
        return (
          <TouchableOpacity
            key={item.label}
            onPress={item.onPress}
            disabled={disabled}
            activeOpacity={disabled ? 1 : 0.7}
            accessibilityRole="radio"
            accessibilityLabel={item.label}
            accessibilityState={{
              selected: item.active === true,
              disabled,
            }}
            style={[
              styles.segment,
              {
                backgroundColor: item.active
                  ? theme.textPrimary
                  : theme.surface,
                borderColor: item.active
                  ? theme.primary
                  : theme.border,
              },
              disabled ? styles.disabled : null,
            ]}
          >
            <Text
              style={[
                styles.segmentText,
                {
                  color: item.active
                    ? theme.background
                    : theme.textSecondary,
                },
              ]}
            >
              {item.label}
            </Text>
            {item.count != null ? (
              <Mono
                style={[
                  styles.segmentCount,
                  {
                    color: item.active
                      ? theme.background
                      : theme.textMuted,
                  },
                ]}
              >
                {item.count}
              </Mono>
            ) : null}
          </TouchableOpacity>
        );
      })}
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
  const theme = useTheme();
  const dark = tone === "dark";
  const presentation = dark ? darkTheme : theme;

  return (
    <View
      style={[
        styles.copilotHero,
        {
          backgroundColor: dark
            ? darkTheme.surfaceElevated
            : presentation.ai.soft,
          borderWidth: 1,
          borderColor: dark
            ? darkTheme.glassBorder
            : presentation.ai.line,
        },
      ]}
    >
      <View
        style={[
          styles.sparkWash,
          { backgroundColor: presentation.ai.line },
        ]}
      />
      <View style={styles.copilotHeader}>
        <View
          style={[
            styles.sparkAvatar,
            { backgroundColor: presentation.ai.primary },
          ]}
        >
          <Ionicons name="sparkles" size={12} color={presentation.onAi} />
        </View>
        <Text
          style={[
            styles.copilotKicker,
            { color: presentation.ai.primary },
          ]}
        >
          {kicker}
        </Text>
        {confidence != null ? (
          <View style={styles.confidence}>
            <View
              style={[
                styles.confidenceDot,
                { backgroundColor: presentation.status.ready },
              ]}
            />
            <Mono
              style={[
                styles.confidenceText,
                { color: presentation.ai.secondary },
              ]}
            >
              {confidence}% sure
            </Mono>
          </View>
        ) : null}
      </View>
      <Text
        style={[
          styles.copilotBody,
          { color: presentation.textPrimary },
        ]}
      >
        {children}
      </Text>
      {actions ? <View style={styles.heroActions}>{actions}</View> : null}
      {foot ? (
        <View
          style={[
            styles.heroFoot,
            {
              borderTopColor: dark
                ? darkTheme.glassBorder
                : presentation.ai.line,
            },
          ]}
        >
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
  const theme = useTheme();
  const tone = getRoomTone(status);
  const colors = getToneColors(tone, theme);

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
      <Mono
        style={[
          styles.roomTileNumber,
          { color: theme.textPrimary, fontSize: size >= 40 ? 14 : 13 },
        ]}
      >
        {roomNumber}
      </Mono>
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
  const theme = useTheme();
  return (
    <View
      style={[
        styles.ringOuter,
        {
          backgroundColor: theme.surface,
          borderColor: theme.status.ready,
        },
      ]}
    >
      <View
        style={[styles.ringInner, { backgroundColor: theme.surface }]}
      >
        <Text style={[styles.ringValue, { color: theme.textPrimary }]}>
          {value}
        </Text>
        <Mono style={[styles.ringSub, { color: theme.textMuted }]}>
          of {total}
        </Mono>
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
  testID,
}: {
  lead: React.ReactNode;
  title: React.ReactNode;
  sub?: React.ReactNode;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={onPress ? "button" : undefined}
      style={[
        styles.row,
        {
          backgroundColor: theme.surface,
          borderColor: theme.border,
        },
        style,
      ]}
      testID={testID}
    >
      {lead}
      <View style={styles.rowBody}>
        <View style={styles.rowTitle}>{title}</View>
        {sub ? (
          <Text style={[styles.rowSub, { color: theme.textMuted }]}>
            {sub}
          </Text>
        ) : null}
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
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  aiConfidence: {
    fontSize: 10,
    opacity: 0.72,
  },
  aiChip: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 999,
    minHeight: 24,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  aiChipText: {
    fontSize: 10.5,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  aiInsightCard: {
    borderRadius: R.lg,
    borderWidth: 1,
    padding: 14,
    gap: 8,
  },
  aiInsightCardCompact: {
    padding: 12,
  },
  aiInsightText: {
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
  },
  sectionHint: {
    fontSize: 11,
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
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  floatingAIButton: {
    position: "absolute",
    right: 16,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowOpacity: 0.24,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
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
    alignItems: "center",
    justifyContent: "center",
  },
  ringInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: "center",
    justifyContent: "center",
  },
  ringValue: {
    fontSize: 26,
    lineHeight: 28,
  },
  ringSub: {
    fontSize: 10,
  },
  row: {
    borderWidth: 1,
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
    marginTop: 3,
    lineHeight: 16,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 5,
  },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.8 },
});
