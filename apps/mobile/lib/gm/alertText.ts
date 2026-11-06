import type { AlertItem } from "@/lib/gm/riskAlerts";

type T = (key: string, options?: Record<string, unknown>) => string;

/** Words for one alert, composed from structured facts through translated templates (never pre-formatted English).
 *  `stamp` formats an ISO instant in the hotel's zone (or returns null). */
export function describeAlert(item: AlertItem, t: T, stamp: (iso: string | null) => string | null): { title: string; detail: string } {
  const f = item.facts;
  const parts: string[] = [];
  const room = item.roomNumber ? t("alertsV2.facts.room", { room: item.roomNumber }) : null;
  switch (item.kind) {
    case "sla_breach": {
      if (f.workOrderNumber) parts.push(t("alertsV2.facts.wo", { number: f.workOrderNumber }));
      const due = stamp(item.timestamp);
      if (due) parts.push(t("alertsV2.facts.due", { time: due }));
      return { title: item.title || t("alertsV2.kinds.sla_breach"), detail: parts.join(" · ") };
    }
    case "room_risk": {
      if (typeof f.minutesToCheckin === "number") parts.push(t("alertsV2.facts.checkin", { minutes: Math.max(0, Math.round(f.minutesToCheckin)) }));
      if (f.factors && f.factors.length) parts.push(t("alertsV2.facts.factors", { list: f.factors.slice(0, 3).join(", ") }));
      return { title: room ?? t("alertsV2.kinds.room_risk"), detail: parts.join(" · ") };
    }
    case "asset_risk": {
      if (typeof f.score === "number") parts.push(t("alertsV2.facts.failureRisk", { score: Math.round(f.score) }));
      return { title: item.title || t("alertsV2.kinds.asset_risk"), detail: parts.join(" · ") };
    }
    case "low_stock": {
      if (typeof f.onHand === "number" && typeof f.minimum === "number") parts.push(t("alertsV2.facts.stock", { onHand: f.onHand, minimum: f.minimum }));
      return { title: item.title || t("alertsV2.kinds.low_stock"), detail: parts.join(" · ") };
    }
    case "guest_issue": {
      if (room) parts.push(room);
      if (item.description) parts.push(item.description);
      return { title: item.title || t("alertsV2.kinds.guest_issue"), detail: parts.join(" · ") };
    }
    case "recurring": {
      if (typeof f.woCount === "number" && typeof f.windowDays === "number") parts.push(t("alertsV2.facts.recurring", { count: f.woCount, days: f.windowDays }));
      if (!item.assetName && room) return { title: room, detail: parts.join(" · ") };
      return { title: item.assetName || room || t("alertsV2.kinds.recurring"), detail: parts.join(" · ") };
    }
    default: {
      const where = item.roomNumber ? t("alertsV2.facts.room", { room: item.roomNumber }) : item.assetName;
      return { title: item.title, detail: [item.description, where].filter(Boolean).join(" · ") };
    }
  }
}
