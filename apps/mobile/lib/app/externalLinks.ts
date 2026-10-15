/**
 * Opening addresses outside the app. Only plain https addresses a person can see in a browser are allowed:
 * no custom app schemes (which could land on a privileged in-app route), no embedded credentials, no scripts.
 * Where a configured address is missing or invalid the row that would open it is not shown at all, so there is
 * never a link that goes nowhere.
 */
import Constants from "expo-constants";
import { Linking } from "react-native";

const MAX_URL_LENGTH = 2048;

/** Returns the normalised https URL, or null when it is not safe to open. */
export function parseExternalUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text || text.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (!url.hostname || !url.hostname.includes(".")) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

export type OpenLinkResult = "opened" | "invalid" | "offline" | "failed";

export async function openExternalUrl(raw: unknown, online: boolean): Promise<OpenLinkResult> {
  const url = parseExternalUrl(raw);
  if (!url) return "invalid";
  // These pages live on the web, so say so up front instead of letting the browser show its own error.
  if (!online) return "offline";
  try {
    await Linking.openURL(url);
    return "opened";
  } catch {
    return "failed";
  }
}

export interface LegalLinks {
  privacyPolicyUrl: string | null;
  termsOfServiceUrl: string | null;
}

/**
 * The published Privacy Policy and Terms of Service addresses, from `expo.extra.legal` in app.json:
 *   "extra": { "legal": { "privacyPolicyUrl": "https://...", "termsOfServiceUrl": "https://..." } }
 * Nothing is configured yet, because PatelRep has not published either document. Add the real addresses there
 * once they exist and the rows appear; an invalid address is treated as not configured.
 */
export function readLegalLinks(extra: unknown = Constants.expoConfig?.extra): LegalLinks {
  const legal = (extra as { legal?: Record<string, unknown> } | null | undefined)?.legal;
  return {
    privacyPolicyUrl: parseExternalUrl(legal?.privacyPolicyUrl),
    termsOfServiceUrl: parseExternalUrl(legal?.termsOfServiceUrl),
  };
}
