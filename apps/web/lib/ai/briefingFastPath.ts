// Deterministic, zero-credit answers for "Ask about this" on the shift-briefing
// panel — grounded directly in the board-state numbers already on screen, so a
// question about pace or departures doesn't need a model round-trip. Anything
// that doesn't match falls through to the shared copilot pipeline (null).

export interface BriefingHkStat {
  name: string
  assigned: number
  done: number
}

export interface BriefingRisk {
  room_number?: string
}

export interface BriefingWorkOrder {
  title: string
  location?: string
}

export interface BriefingBoardStats {
  hkStats: BriefingHkStat[]
  departure: number
  vacant: number
  risks: BriefingRisk[]
  urgentWorkOrders: BriefingWorkOrder[]
  cleanTime?: { todayAvgMinutes: number; deltaMinutes?: number | null } | null
}

export interface BriefingAnswer {
  message: string
  filter?: 'DEPARTURE' | 'VACANT'
}

export function answerBriefingQuestion(question: string, stats: BriefingBoardStats): BriefingAnswer | null {
  const q = question.toLowerCase()

  if (/behind|falling behind|need(s)? help|struggl|who.?s (slow|pac)/.test(q)) {
    const behind = stats.hkStats
      .filter((hk) => hk.assigned > 0 && hk.done / hk.assigned < 0.5)
      .sort((a, b) => a.done / a.assigned - b.done / b.assigned)
    if (behind.length === 0) {
      return { message: 'Everyone is on pace right now — no one is under half their board.' }
    }
    const names = behind.slice(0, 2).map((h) => h.name).join(' and ')
    const departureNote = stats.departure > 0 ? ' with departures still open' : ''
    return {
      message: `${names} ${behind.length > 1 ? 'are' : 'is'} under half their board${departureNote}. Moving a room or two off ${behind[0].name} would even out the floor.`,
    }
  }

  if (/checkout|check-out|check out|departure/.test(q)) {
    return {
      message: stats.departure > 0
        ? `${stats.departure} room${stats.departure !== 1 ? 's are' : ' is'} on departure today. Worth clearing those first so front desk isn't waiting on a room.`
        : 'No departures on the board right now.',
      filter: 'DEPARTURE',
    }
  }

  if (/vacant/.test(q)) {
    return {
      message: stats.vacant > 0
        ? `${stats.vacant} room${stats.vacant !== 1 ? 's are' : ' is'} vacant right now.`
        : 'No vacant rooms on the board right now.',
      filter: 'VACANT',
    }
  }

  if (/risk|flagged|at risk/.test(q)) {
    if (stats.risks.length === 0) {
      return { message: 'Nothing is flagged at risk right now — the board is clean.' }
    }
    const rooms = stats.risks.slice(0, 3).map((r) => r.room_number).filter(Boolean).join(', ')
    return {
      message: `${stats.risks.length} room${stats.risks.length !== 1 ? 's are' : ' is'} flagged at risk${rooms ? ` (${rooms})` : ''}. Worth checking those before end of shift.`,
    }
  }

  if (/urgent|work order/.test(q)) {
    if (stats.urgentWorkOrders.length === 0) {
      return { message: 'No urgent work orders open right now.' }
    }
    const first = stats.urgentWorkOrders[0]
    const loc = first.location ?? 'an unassigned area'
    return {
      message: `${stats.urgentWorkOrders.length} urgent work order${stats.urgentWorkOrders.length !== 1 ? 's are' : ' is'} open, starting with ${first.title} at ${loc}. Get that assigned first.`,
    }
  }

  if (/clean time|pace today|average/.test(q)) {
    if (!stats.cleanTime?.todayAvgMinutes) return null
    const delta = stats.cleanTime.deltaMinutes
    const deltaNote = delta != null && delta !== 0 ? `, ${delta > 0 ? '+' : ''}${delta}m vs the 7-day average` : ''
    const verdict = delta != null && delta < 0 ? 'Ahead of pace — good day to pull a room forward.' : 'On pace with the usual rhythm.'
    return { message: `Average clean time today is ${stats.cleanTime.todayAvgMinutes}m${deltaNote}. ${verdict}` }
  }

  return null
}
