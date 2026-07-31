import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

export function useReducedMotion(): boolean {
  const [isReducedMotionEnabled, setIsReducedMotionEnabled] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let receivedLivePreference = false;

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        receivedLivePreference = true;
        if (isMounted) {
          setIsReducedMotionEnabled(enabled);
        }
      },
    );

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isMounted && !receivedLivePreference) {
          setIsReducedMotionEnabled(enabled);
        }
      })
      .catch(() => {
        // Accessibility preference lookup must never block floor work.
      });

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  return isReducedMotionEnabled;
}
