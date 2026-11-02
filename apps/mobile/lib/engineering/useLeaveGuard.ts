import { useCallback, useEffect, useState } from "react";
import { BackHandler } from "react-native";

/**
 * Asks before leaving a form that has unsaved work. The on-screen Back, the Android hardware Back and the discard sheet
 * share one decision, so no path loses typed work without a question. `blocked` (a save in flight) swallows Back.
 */
export function useLeaveGuard({ dirty, blocked, onLeave }: { dirty: boolean; blocked?: boolean; onLeave: () => void }) {
  const [asking, setAsking] = useState(false);

  const requestBack = useCallback(() => {
    if (blocked) return;
    if (!dirty) return onLeave();
    setAsking(true);
  }, [blocked, dirty, onLeave]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (asking) {
        setAsking(false);
        return true;
      }
      if (blocked) return true;
      if (dirty) {
        setAsking(true);
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [asking, blocked, dirty]);

  return {
    asking,
    requestBack,
    keepEditing: () => setAsking(false),
    discard: () => {
      setAsking(false);
      onLeave();
    },
  };
}
