import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { AccessibilityInfo, findNodeHandle, Platform } from "react-native";

/** Long enough for the slide-out to finish before the sheet's content is dropped. */
export const CLOSE_MS = 280;
/** Screen readers need a beat after a modal closes before focus can move back. */
const FOCUS_RETURN_MS = 120;

/** Which drawer is open, and for what. Ids only: the content is always re-read from the live model. */
export type HomeSheetState =
  | { kind: "roomActions"; roomId: string }
  | { kind: "why"; roomId: string | null }
  | { kind: "issue"; itemId: string }
  | { kind: "message" }
  | { kind: "progress" }
  | { kind: "markClean"; roomId: string }
  | { kind: "finishShift" }
  | { kind: "summary" }
  | { kind: "sync" }
  | { kind: "briefing" };

/**
 * One drawer at a time. Opening replaces whatever was open (the first slides
 * away before the second appears, so two native modals never overlap); closing
 * animates out, then gives screen-reader focus back to the control that opened it.
 */
export function useHomeSheet() {
  const [sheet, setSheet] = useState<HomeSheetState | null>(null);
  const [visible, setVisible] = useState(false);
  /** Changes on every open, so a drawer that keeps its own state starts fresh each time. */
  const [epoch, setEpoch] = useState(0);
  const visibleRef = useRef(false);
  const trigger = useRef<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (focusTimer.current) clearTimeout(focusTimer.current);
    },
    [],
  );

  const show = useCallback((next: HomeSheetState, opener?: RefObject<unknown>) => {
    trigger.current = opener?.current ?? null;
    setSheet(next);
    setEpoch((value) => value + 1);
    visibleRef.current = true;
    setVisible(true);
  }, []);

  const open = useCallback(
    (next: HomeSheetState, opener?: RefObject<unknown>) => {
      if (timer.current) clearTimeout(timer.current);
      if (!visibleRef.current) {
        show(next, opener);
        return;
      }
      visibleRef.current = false;
      setVisible(false);
      timer.current = setTimeout(() => show(next, opener), CLOSE_MS);
    },
    [show],
  );

  const close = useCallback(() => {
    visibleRef.current = false;
    setVisible(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSheet(null);
      const target = trigger.current;
      trigger.current = null;
      if (!target || Platform.OS === "web") return;
      focusTimer.current = setTimeout(() => {
        try {
          const node = findNodeHandle(target as never);
          if (node) AccessibilityInfo.setAccessibilityFocus(node);
        } catch {
          // Focus return is a courtesy; never let it break the screen.
        }
      }, FOCUS_RETURN_MS);
    }, CLOSE_MS);
  }, []);

  return { sheet, visible, epoch, open, close };
}
