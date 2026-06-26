export function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** JS getTimezoneOffset(): positive for UTC-behind zones (e.g. 300 for CDT UTC-5). */
export function localTzOffset(): number {
  return new Date().getTimezoneOffset();
}

/** "Wed · Jun 12 · {suffix}" hero meta line, localized by language preference. */
export function dynamicShiftMeta(languagePref: string, suffix: string): string {
  const now = new Date();
  const locale = languagePref === "es" ? "es-MX" : "en-US";
  const weekday = now.toLocaleDateString(locale, { weekday: "short" });
  const month = now.toLocaleDateString(locale, { month: "short" });
  return `${weekday} · ${month} ${now.getDate()} · ${suffix}`;
}
