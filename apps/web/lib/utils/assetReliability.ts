export type AssetOperationalStatus =
  | "operating"
  | "degraded"
  | "out_of_service";

type ActiveDowntime = {
  impact_level: "degraded" | "out_of_service";
};

/**
 * Server-calculated downtime minutes are formatted only for display. This must
 * never be used to persist a duration or decide whether an asset is available.
 */
export function formatReliabilityDuration(
  minutes: number | null | undefined,
): string | null {
  if (minutes == null || minutes < 0) return null;
  const total = Math.floor(minutes);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const remainingMinutes = total % 60;
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  return `${remainingMinutes}m`;
}

export function assetOperationalStatus(
  activeDowntime?: ActiveDowntime | null,
): AssetOperationalStatus {
  if (activeDowntime?.impact_level === "out_of_service") {
    return "out_of_service";
  }
  if (activeDowntime?.impact_level === "degraded") return "degraded";
  return "operating";
}
