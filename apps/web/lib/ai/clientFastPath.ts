import type { CopilotResponse } from '@/lib/api/ai'

// ── Patterns ─────────────────────────────────────────────────────────────────
// Housekeeping and guest-request only — engineering goes to the API so it gets
// routed to work_order_creation (a proper work order, not a task).

interface Pattern {
  re: RegExp
  type: 'housekeeping' | 'guest_request'
  priority: 'urgent' | 'normal' | 'low'
  roomFirst: boolean  // true = room in group[0], desc in group[1]
}

const PATTERNS: Pattern[] = [
  // "room 101 needs towels" / "101 needs towels"
  { re: /^(?:room\s*#?\s*)?(\d+)\s+needs?\s+(.+)$/i, type: 'housekeeping', priority: 'normal', roomFirst: true },
  // "send/bring/deliver towels to room 101"
  { re: /(?:send|bring|deliver)\s+(.+?)\s+to\s+(?:room\s*#?\s*)?(\d+)/i, type: 'housekeeping', priority: 'normal', roomFirst: false },
  // "101 guest requesting/wants/needs rollaway"
  { re: /^(?:room\s*#?\s*)?(\d+)\s+guest\s+(?:requesting|needs?|wants?)\s+(.+)$/i, type: 'guest_request', priority: 'normal', roomFirst: true },
  // "101 towels" / "101 linens" (supply shorthand)
  { re: /^(?:room\s*#?\s*)?(\d+)\s+(towels?|linens?|sheets?|soap|shampoo|amenities|supplies|trash|garbage|pillows?|blankets?|tp|toilet\s+paper|coffee|cups?)$/i, type: 'housekeeping', priority: 'normal', roomFirst: true },
  // "clean/vacuum/mop/turndown 101"
  { re: /^(clean|vacuum|mop|sanitize|disinfect|turndown|turn\s+down)\s+(?:room\s*#?\s*)?(\d+)$/i, type: 'housekeeping', priority: 'normal', roomFirst: false },
  // "101 checkout" / "101 departure"
  { re: /^(?:room\s*#?\s*)?(\d+)\s+(checkout|check\s*out|departure|check-out)$/i, type: 'housekeeping', priority: 'normal', roomFirst: true },
  // "restock/resupply 101"
  { re: /^(restock|resupply|refill)\s+(?:room\s*#?\s*)?(\d+)$/i, type: 'housekeeping', priority: 'normal', roomFirst: false },
  // "101 vip" / "vip in 101"
  { re: /^(?:room\s*#?\s*)?(\d+)\s+(vip\s*.*)$/i, type: 'housekeeping', priority: 'urgent', roomFirst: true },
  { re: /^vip\s+(?:in\s+)?(?:room\s*#?\s*)?(\d+)(?:\s+(.+))?$/i, type: 'housekeeping', priority: 'urgent', roomFirst: true },
]

// ── Client fast path ──────────────────────────────────────────────────────────

export function clientFastPath(message: string): CopilotResponse | null {
  const text = message.trim()
  for (const { re, type, priority, roomFirst } of PATTERNS) {
    const m = re.exec(text)
    if (!m) continue
    const g = m.slice(1)
    if (g.length < 2) continue
    const room = roomFirst ? g[0] : g[1]
    const desc = roomFirst ? g[1] : g[0]
    if (!room || !desc) continue
    const title = `${desc.trim().charAt(0).toUpperCase() + desc.trim().slice(1)} — Room ${room}`
    return {
      response_type: 'task_preview',
      message: "I recognised that — here's what I'll create:",
      tasks: [{
        title,
        description: undefined,
        task_type: type,
        priority,
        room_id: null,
        room_number_display: room,
        due_at: undefined,
        confidence: 0.92,
      }],
      requires_confirmation: true,
      credits_used: 0,
      model_used: 'rule_engine',
    }
  }
  return null
}

// ── Off-topic filter ──────────────────────────────────────────────────────────

const HOTEL_KEYWORDS = [
  'towel', 'towels', 'linen', 'linens', 'sheet', 'sheets', 'clean', 'cleaning',
  'vacuum', 'mop', 'trash', 'garbage', 'soap', 'shampoo', 'amenities', 'supplies',
  'turndown', 'checkout', 'departure', 'vip', 'restock', 'resupply', 'refill',
  'ac', 'hvac', 'heat', 'heating', 'plumbing', 'leak', 'elevator', 'broken',
  'repair', 'fix', 'maintenance', 'light', 'lights', 'door', 'lock', 'tv', 'wifi',
  'guest', 'rollaway', 'crib', 'pillow', 'pillows', 'blanket', 'blankets',
  'room', 'floor', 'assign', 'sop', 'procedure', 'protocol', 'inspection',
  'task', 'insight', 'report', 'schedule', 'shift', 'work order',
  // Spanish
  'toalla', 'toallas', 'habitación', 'habitacion', 'limpia', 'necesita', 'roto',
]

export function isOffTopic(message: string): boolean {
  const lower = message.toLowerCase()
  if (/\d/.test(lower)) return false  // has a number → likely a room reference
  return !HOTEL_KEYWORDS.some((kw) => lower.includes(kw))
}

export const OFF_TOPIC_RESPONSE: CopilotResponse = {
  response_type: 'answer',
  message: "I'm focused on hotel operations — I can create tasks, log work orders, answer SOP questions, or show insights. What do you need?",
  credits_used: 0,
  model_used: null,
}
