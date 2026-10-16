import { NO_CAPABILITIES, useAiCapabilities, type AiCapabilities } from "@/lib/ai/capabilities";

/** Switch optional AI features on for a test (the app treats "not known yet" as off). */
export function setAiCapabilities(on: Partial<AiCapabilities> = { unifiedAssistant: true, photoAnalysis: true, taskTranslation: true }): void {
  useAiCapabilities.setState({ capabilities: { ...NO_CAPABILITIES, ...on }, fetchedAt: Date.now() });
}

export function resetAiCapabilities(): void {
  useAiCapabilities.setState({ capabilities: NO_CAPABILITIES, fetchedAt: null });
}
