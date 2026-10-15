/** The speech-recognition locale for the app language. Spanish speakers are never recognised as English. */
export type SpeechLocale = "en-US" | "es-US";

export function speechLocale(language: string | null | undefined): SpeechLocale {
  return (language ?? "en").toLowerCase().startsWith("es") ? "es-US" : "en-US";
}
