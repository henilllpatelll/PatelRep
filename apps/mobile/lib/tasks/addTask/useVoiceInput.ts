import { useCallback, useEffect, useRef, useState } from "react";
import { speechModule, useSpeechRecognitionEvent, type SpeechEvent } from "@/lib/voice/speechModule";
import { resolveSpeechLocale, useAiPreferences } from "@/lib/ai/preferences";

/* ─── Voice input for the Describe step ─────────────────────────────────────
   Tap -> (ask for the microphone the first time) -> listen -> the words land in the editable text
   box. It never creates a task, never records to a file (no `recordingOptions`), and never starts
   by itself. The phone's own speech service does the transcription; PatelRep stores no audio.

   `supported` is false in Expo Go / builds without the native module: the screen then simply has no
   microphone button instead of a dead one. */

export type VoiceState =
  | "idle"
  | "requesting"
  | "listening"
  | "processing"
  | "denied"
  | "nospeech"
  | "error";

interface Options {
  /** "en" / "es" (anything starting with "es" is Spanish). */
  language: string;
  /** Final transcript, ready to append to the text box. */
  onTranscript: (text: string) => void;
}

export function useVoiceInput({ language, onTranscript }: Options) {
  const voiceChosen = useAiPreferences((state) => state.voiceInput);
  const speechLanguage = useAiPreferences((state) => state.speechLanguage);
  // Off by choice behaves exactly like a phone that cannot listen: no microphone is offered, typing is unchanged.
  const supported = voiceChosen && !!speechModule && (speechModule.isRecognitionAvailable?.() ?? true);
  const [state, setState] = useState<VoiceState>("idle");
  const [interim, setInterim] = useState("");
  const heard = useRef("");
  const delivered = useRef(false);
  const active = useRef(false);
  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  const deliver = useCallback((text: string) => {
    const clean = text.trim();
    if (!clean || delivered.current) return false;
    delivered.current = true;
    onTranscriptRef.current(clean);
    return true;
  }, []);

  useSpeechRecognitionEvent("start", () => {
    if (active.current) setState("listening");
  });

  useSpeechRecognitionEvent("result", (event: SpeechEvent) => {
    if (!active.current) return;
    const transcript = event?.results?.[0]?.transcript ?? "";
    heard.current = transcript;
    if (event?.isFinal) {
      deliver(transcript);
      setInterim("");
    } else {
      setInterim(transcript);
    }
  });

  useSpeechRecognitionEvent("error", (event: SpeechEvent) => {
    if (!active.current) return;
    active.current = false;
    setInterim("");
    const code = event?.error ?? "";
    if (code === "aborted") setState("idle");
    else if (code === "not-allowed" || code === "service-not-allowed") setState("denied");
    else if (code === "no-speech" || code === "speech-timeout") setState("nospeech");
    else setState("error");
  });

  useSpeechRecognitionEvent("end", () => {
    if (!active.current) return;
    active.current = false;
    setInterim("");
    // Some engines end without flagging the last result final: keep what was heard.
    if (deliver(heard.current)) setState("idle");
    else setState(delivered.current ? "idle" : "nospeech");
  });

  const start = useCallback(async () => {
    if (!speechModule || active.current) return;
    heard.current = "";
    delivered.current = false;
    setInterim("");
    setState("requesting");
    try {
      const permission = await speechModule.requestPermissionsAsync?.();
      if (permission && !permission.granted) {
        setState("denied");
        return;
      }
      active.current = true;
      speechModule.start({
        lang: resolveSpeechLocale({ speechLanguage }, language),
        interimResults: true,
        continuous: false,
        // No recordingOptions: the audio is never saved by the app.
      });
      setState("listening");
    } catch {
      active.current = false;
      setState("error");
    }
  }, [language, speechLanguage]);

  const stop = useCallback(() => {
    if (!speechModule || !active.current) return;
    setState("processing");
    try {
      speechModule.stop();
    } catch {
      active.current = false;
      setState("error");
    }
  }, []);

  const toggle = useCallback(() => {
    if (state === "listening") stop();
    else if (state !== "processing" && state !== "requesting") void start();
  }, [state, start, stop]);

  const clear = useCallback(() => setState("idle"), []);

  // Leaving the screen/sheet always releases the microphone.
  useEffect(
    () => () => {
      if (active.current) {
        active.current = false;
        try {
          speechModule?.abort?.();
        } catch {
          // already stopped
        }
      }
    },
    [],
  );

  return { supported, state, interim, toggle, stop, clear };
}
