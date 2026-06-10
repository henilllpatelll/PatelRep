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
export async function upsertRooms(rooms: unknown[]): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    for (const room of rooms as Record<string, unknown>[]) {
      await db.runAsync(
        `INSERT OR REPLACE INTO rooms
         (id, room_number, floor, status, risk_level, dnd_flag, vip_flag, guest_name,
          checkin_time, checkout_time, actual_checkout_at, fo_status,
          clean_type, clean_type_label, latest_note, latest_note_at,
          open_work_order_id, open_work_order_number, open_work_order_title,
          open_work_order_priority, open_work_order_status, assignment_date,
          last_cleaned_at, last_inspected_at, updated_at, predicted_ready_at, assignment_id, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          room.id as string,
          room.room_number as string,
          (room.floor as number) ?? null,
          room.status as string,
          (room.risk_level as string) ?? null,
          room.dnd_flag ? 1 : 0,
          room.vip_flag ? 1 : 0,
          (room.guest_name as string) ?? null,
          (room.checkin_time as string) ?? null,
          (room.checkout_time as string) ?? null,
          (room.actual_checkout_at as string) ?? null,
          (room.fo_status as string) ?? null,
          (room.clean_type as string) ?? null,
          (room.clean_type_label as string) ?? null,
          (room.latest_note as string) ?? null,
          (room.latest_note_at as string) ?? null,
          (room.open_work_order_id as string) ?? null,
          (room.open_work_order_number as string) ?? null,
          (room.open_work_order_title as string) ?? null,
          (room.open_work_order_priority as string) ?? null,
          (room.open_work_order_status as string) ?? null,
          (room.assignment_date as string) ?? null,
          (room.last_cleaned_at as string) ?? null,
          (room.last_inspected_at as string) ?? null,
          (room.updated_at as string) ?? null,
          (room.predicted_ready_at as string) ?? null,
          (room.assignment_id as string) ?? null,
          now,
        ]
      );
    }
  });
}

export async function getRooms(): Promise<unknown[]> {
  const db = await getDb();
  return db.getAllAsync("SELECT * FROM rooms ORDER BY floor, room_number");
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
