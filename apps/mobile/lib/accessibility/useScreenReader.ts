import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/** True while VoiceOver / TalkBack is running. A sustained press is not a reliable gesture with one. */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;
    let live = false;
    const subscription = AccessibilityInfo.addEventListener("screenReaderChanged", (value) => {
      live = true;
      if (mounted) setEnabled(value);
    });
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (mounted && !live) setEnabled(value);
      })
      .catch(() => {
        // A failed lookup leaves the standard (hold) control in place.
      });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}
