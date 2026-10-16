import { useTranslation } from "react-i18next";
import { isVoiceEnabled, resolveSpeechLocale, useAiPreferences } from "@/lib/ai/preferences";
import type { SpeechLocale } from "@/lib/voice/locale";
import { isSpeechAvailable } from "@/lib/voice/speechModule";

export interface VoiceCapability {
  /** The phone can recognise speech at all. */
  available: boolean;
  /** Show microphone controls: the phone can listen AND the person has not turned voice input off. */
  enabled: boolean;
  /** The person turned voice off although the phone could listen (so the UI can say why a mic is missing). */
  offByChoice: boolean;
  /** The recognition locale: the person's speech-language choice, else the app language. */
  locale: SpeechLocale;
}

/** The one answer to "may this screen offer a microphone, and in which language does it listen?". */
export function useVoiceCapability(): VoiceCapability {
  const { i18n } = useTranslation();
  const voiceInput = useAiPreferences((state) => state.voiceInput);
  const speechLanguage = useAiPreferences((state) => state.speechLanguage);
  const available = isSpeechAvailable();
  return {
    available,
    enabled: isVoiceEnabled({ voiceInput }, available),
    offByChoice: available && !voiceInput,
    locale: resolveSpeechLocale({ speechLanguage }, i18n.resolvedLanguage ?? i18n.language),
  };
}
