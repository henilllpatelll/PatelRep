/** Human label for a work-order category / vendor trade key ("hvac" -> "HVAC", "general_repair" -> "General Repair"). */
export function formatTradeLabel(trade: string): string {
  if (trade.toLowerCase() === 'hvac') return 'HVAC'
  return trade.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}
