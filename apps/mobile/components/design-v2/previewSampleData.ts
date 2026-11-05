/** SAMPLE DATA for the Design V2 reference preview. Hand-written, never read from or written to
 *  any backend, and shown on screen under an explicit "sample data" banner. Do not import this from
 *  production screens. */
export const previewSample = {
  person: "Maria",
  shiftStart: "8:00 AM",
  shiftEnd: "4:30 PM",
  unreadNotifications: 2,
  currentRoom: {
    number: "412",
    elapsedMinutes: 18,
    checklistDone: 6,
    checklistTotal: 9,
  },
  nextUp: { number: "414", estimateMinutes: 25 },
  supervisor: "Carla",
  today: { done: 4, total: 12, averageMinutes: 28 },
} as const;
