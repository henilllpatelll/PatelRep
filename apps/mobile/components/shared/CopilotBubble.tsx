import { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { MaterialIcons, Ionicons } from "@expo/vector-icons";

export type CopilotBubbleState = "idle" | "unread" | "thinking" | "listening";

const BUBBLE_SIZE = 54;
/** Distance from the screen's right edge — exported so the expand/collapse
 * transition in _layout.tsx can compute exactly how far to drift the bubble
 * toward the literal corner, without duplicating this magic number. */
export const BUBBLE_RIGHT_INSET = 18;
const INK = "#1a1815";
const VIOLET = "#4a2c8f";
const VIOLET_LIGHT = "#c8b8e3";

function PulseDot({ delay }: { delay: number }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.35, duration: 600, delay, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, delay]);

  return <Animated.View style={[styles.pulseDot, { opacity }]} />;
}

/** The always-present floating copilot entry point: a 54px charcoal disc with
 *  a violet hairline ring, matching the "collapsed bubble" design spec (2a).
 *  Tap opens/closes the corner card. Long-press starts voice capture. */
export function CopilotBubble({
  state,
  bottom,
  onPress,
  onLongPress,
  onPressOut,
  accessibilityLabel,
}: {
  state: CopilotBubbleState;
  bottom: number;
  onPress: () => void;
  onLongPress: () => void;
  onPressOut: () => void;
  accessibilityLabel: string;
}) {
  const listening = state === "listening";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      delayLongPress={450}
      style={[styles.bubble, { bottom }, listening && styles.bubbleListening]}
      testID="copilot-bubble"
    >
      {listening ? <View style={styles.listeningGlow} /> : null}

      {state === "thinking" ? (
        <View style={styles.thinkingRow}>
          <PulseDot delay={0} />
          <PulseDot delay={200} />
          <PulseDot delay={400} />
        </View>
      ) : listening ? (
        <Ionicons name="mic" size={18} color="#ffffff" />
      ) : (
        <MaterialIcons name="auto-awesome" size={20} color={VIOLET_LIGHT} />
      )}

      {state === "unread" ? <View style={styles.unreadDot} testID="copilot-bubble-unread-dot" /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bubble: {
    position: "absolute",
    right: BUBBLE_RIGHT_INSET,
    width: BUBBLE_SIZE,
    height: BUBBLE_SIZE,
    borderRadius: BUBBLE_SIZE / 2,
    backgroundColor: INK,
    borderWidth: 1.5,
    borderColor: VIOLET,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: INK,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  bubbleListening: {
    backgroundColor: VIOLET,
    borderColor: VIOLET_LIGHT,
  },
  listeningGlow: {
    position: "absolute",
    width: BUBBLE_SIZE + 10,
    height: BUBBLE_SIZE + 10,
    borderRadius: (BUBBLE_SIZE + 10) / 2,
    backgroundColor: "rgba(74,44,143,0.16)",
  },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  pulseDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: VIOLET_LIGHT },
  unreadDot: {
    position: "absolute",
    top: 1,
    right: 1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: VIOLET,
    borderWidth: 2,
    borderColor: "#f7f4ee",
  },
});
