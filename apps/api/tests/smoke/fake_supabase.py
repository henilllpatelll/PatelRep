"""Richer in-memory Supabase fake for clean-sessions / checklists / shifts tests.

Extends the FakeDB pattern used in test_inspection_templates.py with update,
delete, maybe_single, neq, gte, in_ and limit support.
"""

from types import SimpleNamespace


class FakeStorageBucket:
    def __init__(self, db, bucket):
        self.db = db
        self.bucket = bucket

    def upload(self, path, contents, _options=None):
        self.db.storage_uploads.append((self.bucket, path, contents))
        return SimpleNamespace(path=path)


class FakeStorage:
    def __init__(self, db):
        self.db = db

    def from_(self, bucket):
        return FakeStorageBucket(self.db, bucket)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.inserts = []
        self.updates = []
        self.deletes = []
        self.storage_uploads = []
        self.storage = FakeStorage(self)
        self._id_counter = 0

    def next_id(self, table_name):
        self._id_counter += 1
        return f"{table_name}-{self._id_counter}"

    def table(self, name):
        return FakeQuery(self, name)


class FakeQuery:
    def __init__(self, db, table_name):
        self.db = db
        self.table_name = table_name
        self.action = "select"
        self.payload = None
        self.filters = []  # (op, column, value)
        self.order_column = None
        self.order_desc = False
        self.limit_count = None
        self.single = False

    def select(self, *_args, **_kwargs):
        self.action = "select"
        return self

    def insert(self, payload):
        self.action = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.action = "update"
        self.payload = payload
        return self

    def delete(self):
        self.action = "delete"
        return self

    def eq(self, column, value):
        self.filters.append(("eq", column, value))
        return self

    def neq(self, column, value):
        self.filters.append(("neq", column, value))
        return self

    def gte(self, column, value):
        self.filters.append(("gte", column, value))
        return self

    def in_(self, column, values):
        self.filters.append(("in", column, list(values)))
        return self

    def like(self, column, pattern):
        self.filters.append(("like", column, pattern))
        return self

    def order(self, column, desc=False, **_kwargs):
        self.order_column = column
        self.order_desc = desc
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def maybe_single(self):
        self.single = True
        return self

    def _matches(self, row):
        for op, column, value in self.filters:
            actual = row.get(column)
            if op == "eq" and actual != value:
                return False
            if op == "neq" and actual == value:
                return False
            if op == "gte" and (actual is None or str(actual) < str(value)):
                return False
            if op == "in" and actual not in value:
                return False
            if op == "like":
                prefix = value.rstrip("%")
                if not isinstance(actual, str) or not actual.startswith(prefix):
                    return False
        return True

    def execute(self):
        rows = self.db.rows.setdefault(self.table_name, [])
        matched = [row for row in rows if self._matches(row)]
        if self.order_column:
            matched = sorted(
                matched,
                key=lambda row: str(row.get(self.order_column) or ""),
                reverse=self.order_desc,
            )
        if self.limit_count is not None:
            matched = matched[: self.limit_count]

        if self.action == "select":
            if self.single:
                return SimpleNamespace(data=matched[0] if matched else None)
            return SimpleNamespace(data=matched)

        if self.action == "insert":
            payload_rows = self.payload if isinstance(self.payload, list) else [self.payload]
            saved = []
            for payload in payload_rows:
                assert isinstance(payload, dict)
                row = {
                    "id": payload.get("id") or self.db.next_id(self.table_name),
                    **payload,
                }
                rows.append(row)
                self.db.inserts.append((self.table_name, row))
                saved.append(row)
            return SimpleNamespace(data=saved)

        if self.action == "update":
            updated = []
            for row in matched:
                row.update(self.payload)
                self.db.updates.append((self.table_name, dict(row)))
                updated.append(row)
            return SimpleNamespace(data=updated)

        if self.action == "delete":
            for row in matched:
                rows.remove(row)
                self.db.deletes.append((self.table_name, row))
            return SimpleNamespace(data=matched)

        return SimpleNamespace(data=[])
