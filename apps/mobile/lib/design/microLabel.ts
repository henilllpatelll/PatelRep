import { isDesignV2Enabled } from "@/lib/design/designV2";

/** Micro-label typography for static StyleSheets (section kickers, eyebrows, group titles).
 *
 *  Design System V2 retires shouted capitals: labels keep their translated sentence case, no tracking and a
 *  readable floor of 12. The flag is a bundle-time constant, so with it off every call returns the legacy value
 *  and the legacy look is byte-identical. Use these in a style that cannot reach `useV2Text()` (module-level or
 *  shared style objects); inside a component prefer `useV2Text().label`. */
export const microLabelCase = (): "uppercase" | "none" => (isDesignV2Enabled() ? "none" : "uppercase");

export const microLabelTracking = (legacy: number): number => (isDesignV2Enabled() ? 0 : legacy);

export const microLabelSize = (legacy: number): number => (isDesignV2Enabled() ? Math.max(legacy, 12) : legacy);
