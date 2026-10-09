import * as SQLite from "expo-sqlite";

// Promise-mutex: all concurrent getDb() calls share one initialization promise.
// Prevents two callers racing to open + init the DB on the same connection.
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!_dbPromise) {
    _dbPromise = SQLite.openDatabaseAsync("patelrep.db")
      .then(async (db) => {
        await initSchema(db);
        return db;
      })
      .catch((err) => {
        _dbPromise = null; // allow retry on next call
        throw err;
      });
  }
  return _dbPromise;
}

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  // PRAGMA journal_mode = WAL cannot run inside a transaction.
  // execAsync on Android wraps its batch in an implicit transaction, which causes
  // "cannot rollback - no transaction is active" when the PRAGMA aborts it.
  // Run it separately first, outside any transaction context.
  await db.runAsync("PRAGMA journal_mode = WAL");

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      room_number TEXT NOT NULL,
      floor INTEGER,
      status TEXT NOT NULL,
      risk_level TEXT,
      dnd_flag INTEGER DEFAULT 0,
      vip_flag INTEGER DEFAULT 0,
      guest_name TEXT,
      checkin_time TEXT,
      checkout_time TEXT,
      actual_checkout_at TEXT,
      fo_status TEXT,
      clean_type TEXT,
      clean_type_label TEXT,
      latest_note TEXT,
      latest_note_at TEXT,
      open_work_order_id TEXT,
      open_work_order_number TEXT,
      open_work_order_title TEXT,
      open_work_order_priority TEXT,
      open_work_order_status TEXT,
      assignment_date TEXT,
      last_cleaned_at TEXT,
      last_inspected_at TEXT,
      updated_at TEXT,
      predicted_ready_at TEXT,
      assignment_id TEXT,
      room_type_code TEXT,
      room_type_name TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      task_type TEXT NOT NULL,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      room_id TEXT,
      room_number TEXT,
      assigned_to TEXT,
      due_at TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_orders (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      room_number TEXT,
      claimed_by TEXT,
      due_at TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      attempts INTEGER DEFAULT 0
    );
  `);

  // Migrate existing rooms table — SQLite doesn't support IF NOT EXISTS on ALTER TABLE,
  // so attempt each column individually and swallow duplicate-column errors.
  const roomsMigrations = [
    "ALTER TABLE rooms ADD COLUMN vip_flag INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN checkin_time TEXT",
    "ALTER TABLE rooms ADD COLUMN checkout_time TEXT",
    "ALTER TABLE rooms ADD COLUMN actual_checkout_at TEXT",
    "ALTER TABLE rooms ADD COLUMN fo_status TEXT",
    "ALTER TABLE rooms ADD COLUMN clean_type TEXT",
    "ALTER TABLE rooms ADD COLUMN clean_type_label TEXT",
    "ALTER TABLE rooms ADD COLUMN latest_note TEXT",
    "ALTER TABLE rooms ADD COLUMN latest_note_at TEXT",
    "ALTER TABLE rooms ADD COLUMN open_work_order_id TEXT",
    "ALTER TABLE rooms ADD COLUMN open_work_order_number TEXT",
    "ALTER TABLE rooms ADD COLUMN open_work_order_title TEXT",
    "ALTER TABLE rooms ADD COLUMN open_work_order_priority TEXT",
    "ALTER TABLE rooms ADD COLUMN open_work_order_status TEXT",
    "ALTER TABLE rooms ADD COLUMN assignment_date TEXT",
    "ALTER TABLE rooms ADD COLUMN last_cleaned_at TEXT",
    "ALTER TABLE rooms ADD COLUMN last_inspected_at TEXT",
    "ALTER TABLE rooms ADD COLUMN updated_at TEXT",
    "ALTER TABLE rooms ADD COLUMN room_type_code TEXT",
    "ALTER TABLE rooms ADD COLUMN room_type_name TEXT",
    // My Rooms dashboard: ordering, rush, access/return-later and reclean context.
    "ALTER TABLE rooms ADD COLUMN building TEXT",
    "ALTER TABLE rooms ADD COLUMN sequence_order INTEGER",
    "ALTER TABLE rooms ADD COLUMN priority INTEGER",
    "ALTER TABLE rooms ADD COLUMN priority_reason TEXT",
    "ALTER TABLE rooms ADD COLUMN priority_needed_by TEXT",
    "ALTER TABLE rooms ADD COLUMN do_not_service INTEGER DEFAULT 0",
    "ALTER TABLE rooms ADD COLUMN dnd_retry_at TEXT",
    "ALTER TABLE rooms ADD COLUMN dnd_attempt_count INTEGER",
    "ALTER TABLE rooms ADD COLUMN service_declined_reason TEXT",
    "ALTER TABLE rooms ADD COLUMN reclean_requested_at TEXT",
    "ALTER TABLE rooms ADD COLUMN reclean_corrections TEXT",
    "ALTER TABLE rooms ADD COLUMN base_clean_minutes INTEGER",
    // Phase 3: priority note/reason, DND/decline history, structured reclean details.
    "ALTER TABLE rooms ADD COLUMN priority_note TEXT",
    "ALTER TABLE rooms ADD COLUMN dnd_started_at TEXT",
    "ALTER TABLE rooms ADD COLUMN dnd_last_attempt_at TEXT",
    "ALTER TABLE rooms ADD COLUMN service_declined_note TEXT",
    "ALTER TABLE rooms ADD COLUMN service_declined_at TEXT",
    "ALTER TABLE rooms ADD COLUMN reclean_details TEXT",
  ];
  for (const sql of roomsMigrations) {
    try {
      await db.runAsync(sql);
    } catch {
      // column already exists — safe to ignore
    }
  }
}

// Room operations
type RoomRecord = Record<string, unknown>;

const text = (value: unknown): string | null => (value == null ? null : String(value));
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function roomRow(room: RoomRecord, now: string): [string, unknown][] {
  const nested = (room.rooms ?? null) as { room_types?: { base_clean_minutes?: number } | null } | null;
  return [
    ["id", room.id as string],
    ["room_number", room.room_number as string],
    ["floor", (room.floor as number) ?? null],
    ["status", room.status as string],
    ["risk_level", text(room.risk_level)],
    ["dnd_flag", room.dnd_flag ? 1 : 0],
    ["vip_flag", room.vip_flag ? 1 : 0],
    ["guest_name", text(room.guest_name)],
    ["checkin_time", text(room.checkin_time)],
    ["checkout_time", text(room.checkout_time)],
    ["actual_checkout_at", text(room.actual_checkout_at)],
    ["fo_status", text(room.fo_status)],
    ["clean_type", text(room.clean_type)],
    ["clean_type_label", text(room.clean_type_label)],
    ["latest_note", text(room.latest_note)],
    ["latest_note_at", text(room.latest_note_at)],
    ["open_work_order_id", text(room.open_work_order_id)],
    ["open_work_order_number", text(room.open_work_order_number)],
    ["open_work_order_title", text(room.open_work_order_title)],
    ["open_work_order_priority", text(room.open_work_order_priority)],
    ["open_work_order_status", text(room.open_work_order_status)],
    ["assignment_date", text(room.assignment_date)],
    ["last_cleaned_at", text(room.last_cleaned_at)],
    ["last_inspected_at", text(room.last_inspected_at)],
    ["updated_at", text(room.updated_at)],
    ["predicted_ready_at", text(room.predicted_ready_at)],
    ["assignment_id", text(room.assignment_id)],
    ["room_type_code", text(room.room_type_code)],
    ["room_type_name", text(room.room_type_name)],
    ["building", text(room.building)],
    ["sequence_order", num(room.sequence_order)],
    ["priority", num(room.priority)],
    ["priority_reason", text(room.priority_reason)],
    ["priority_needed_by", text(room.priority_needed_by)],
    ["priority_note", text(room.priority_note)],
    ["dnd_started_at", text(room.dnd_started_at)],
    ["dnd_last_attempt_at", text(room.dnd_last_attempt_at)],
    ["service_declined_note", text(room.service_declined_note)],
    ["service_declined_at", text(room.service_declined_at)],
    ["reclean_details", room.reclean_details ? JSON.stringify(room.reclean_details) : null],
    ["do_not_service", room.do_not_service ? 1 : 0],
    ["dnd_retry_at", text(room.dnd_retry_at)],
    ["dnd_attempt_count", num(room.dnd_attempt_count)],
    ["service_declined_reason", text(room.service_declined_reason)],
    ["reclean_requested_at", text(room.reclean_requested_at)],
    ["reclean_corrections", Array.isArray(room.reclean_corrections) ? JSON.stringify(room.reclean_corrections) : null],
    ["base_clean_minutes", num(nested?.room_types?.base_clean_minutes)],
    ["synced_at", now],
  ];
}

export interface UpsertRoomsOptions {
  /**
   * The assignment date these rooms are the COMPLETE list for. Cached rows for
   * that date that are no longer in the list (reassigned away, cancelled) are
   * removed, so an offline restart never shows a room the attendant lost.
   */
  replaceDate?: string;
}

export async function upsertRooms(rooms: unknown[], options: UpsertRoomsOptions = {}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    if (options.replaceDate) {
      const keep = (rooms as RoomRecord[]).map((room) => String(room.id));
      if (keep.length === 0) {
        await db.runAsync("DELETE FROM rooms WHERE assignment_date = ?", [options.replaceDate]);
      } else {
        await db.runAsync(
          `DELETE FROM rooms WHERE assignment_date = ? AND id NOT IN (${keep.map(() => "?").join(", ")})`,
          [options.replaceDate, ...keep],
        );
      }
    }
    for (const room of rooms as RoomRecord[]) {
      const row = roomRow(room, now);
      await db.runAsync(
        `INSERT OR REPLACE INTO rooms (${row.map(([column]) => column).join(", ")})
         VALUES (${row.map(() => "?").join(", ")})`,
        row.map(([, value]) => value as string | number | null),
      );
    }
  });
}

/** Drop every cached room — called when a different user signs in on this device. */
export async function clearRoomsCache(): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM rooms");
}

/** Turn a cached SQLite row back into the shape the API returns. */
function hydrateCachedRoom(row: RoomRecord): RoomRecord {
  let corrections: string[] | null = null;
  if (typeof row.reclean_corrections === "string") {
    try {
      const parsed: unknown = JSON.parse(row.reclean_corrections);
      if (Array.isArray(parsed)) corrections = parsed.map(String);
    } catch {
      corrections = null;
    }
  }
  let details: unknown = null;
  if (typeof row.reclean_details === "string") {
    try {
      details = JSON.parse(row.reclean_details);
    } catch {
      details = null;
    }
  }
  const base = num(row.base_clean_minutes);
  return {
    ...row,
    reclean_details: details,
    dnd_flag: Boolean(row.dnd_flag),
    vip_flag: Boolean(row.vip_flag),
    do_not_service: Boolean(row.do_not_service),
    reclean_corrections: corrections,
    rooms: base ? { room_types: { base_clean_minutes: base } } : null,
  };
}

export async function getRooms(): Promise<unknown[]> {
  const db = await getDb();
  return db.getAllAsync("SELECT * FROM rooms ORDER BY floor, room_number");
}

export async function getRoomsByDate(assignmentDate: string): Promise<unknown[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RoomRecord>(
    "SELECT * FROM rooms WHERE assignment_date = ? ORDER BY floor, room_number",
    [assignmentDate]
  );
  return rows.map(hydrateCachedRoom);
}

// Sync queue operations
export async function enqueueAction(
  entityType: string,
  action: string,
  payload: unknown,
  entityId?: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_queue (entity_type, entity_id, action, payload, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [entityType, entityId ?? null, action, JSON.stringify(payload), new Date().toISOString()]
  );
}

const MAX_SYNC_ATTEMPTS = 5;

export async function getPendingSyncQueue(): Promise<unknown[]> {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT * FROM sync_queue WHERE attempts < ${MAX_SYNC_ATTEMPTS} ORDER BY created_at ASC LIMIT 50`
  );
}

export async function incrementSyncQueueAttempts(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    "UPDATE sync_queue SET attempts = attempts + 1 WHERE id = ?",
    [id]
  );
}

export async function deleteSyncQueueItem(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync("DELETE FROM sync_queue WHERE id = ?", [id]);
}
