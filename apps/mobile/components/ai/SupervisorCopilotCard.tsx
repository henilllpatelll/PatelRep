import { CopilotCard, type CopilotCardProps } from "@/components/shared/CopilotCard";
import { useSupervisorCopilot } from "@/lib/ai/useSupervisorCopilot";

/**
 * The housekeeping supervisor's version of the floating Copilot card. It is the same card and the same single
 * conversation as every other role's; only the body differs. Mounted only while the card is open, so the
 * Today snapshot it reads is loaded (free endpoints) on open and nothing here asks a model by itself.
 */
export function SupervisorCopilotCard(props: Omit<CopilotCardProps, "supervisor">) {
  const supervisor = useSupervisorCopilot();
  return <CopilotCard {...props} supervisor={supervisor} />;
}
