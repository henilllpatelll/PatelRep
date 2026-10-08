"""Small stateful in-memory Supabase fake shared by the People (staff) contract tests."""

from types import SimpleNamespace


# column defaults the real schema applies on insert
DB_DEFAULTS = {"staff_role_schedules": {"is_active": True}}


class FakeQuery:
    def __init__(self, db, table):
        self.db, self.table = db, table
        self.mode, self.payload, self.on_conflict = "select", None, None
        self.filters, self.desc_col, self.limit_n = [], None, None
        self.order_col, self.single_mode = None, None

    # builders -------------------------------------------------------------
    def select(self, *_a, **_k):
        self.mode = "select"
        return self

    def insert(self, payload):
        self.mode, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.mode, self.payload = "update", payload
        return self

    def upsert(self, payload, on_conflict=None):
        self.mode, self.payload, self.on_conflict = "upsert", payload, on_conflict
        return self

    def delete(self):
        self.mode = "delete"
        return self

    def eq(self, c, v):
        self.filters.append(("eq", c, v))
        return self

    def neq(self, c, v):
        self.filters.append(("neq", c, v))
        return self

    def in_(self, c, v):
        self.filters.append(("in", c, set(v)))
        return self

    def gte(self, c, v):
        self.filters.append(("gte", c, v))
        return self

    def is_(self, c, v):
        self.filters.append(("is", c, None if v == "null" else v))
        return self

    def order(self, c, desc=False):
        self.order_col, self.desc_col = c, desc
        return self

    def limit(self, n):
        self.limit_n = n
        return self

    def single(self):
        self.single_mode = "single"
        return self

    def maybe_single(self):
        self.single_mode = "maybe"
        return self

    # execution ------------------------------------------------------------
    def _match(self, row):
        for op, c, v in self.filters:
            cur = row.get(c)
            if op == "eq" and cur != v:
                return False
            if op == "neq" and cur == v:
                return False
            if op == "in" and cur not in v:
                return False
            if op == "is" and cur != v:
                return False
            if op == "gte" and (cur is None or str(cur) < str(v)):
                return False
        return True

    def execute(self):
        rows = self.db.rows.setdefault(self.table, [])
        if self.mode == "insert":
            out = []
            for p in self.payload if isinstance(self.payload, list) else [self.payload]:
                self.db.check_insert(self.table, p, rows)
                new = {
                    "id": f"{self.table}-{len(rows) + 1}",
                    **DB_DEFAULTS.get(self.table, {}),
                    **p,
                }
                rows.append(new)
                out.append(dict(new))
            return SimpleNamespace(data=out)
        if self.mode == "upsert":
            keys = (self.on_conflict or "id").split(",")
            p = dict(self.payload)
            for r in rows:
                if all(r.get(k) == p.get(k) for k in keys):
                    r.update(p)
                    return SimpleNamespace(data=[dict(r)])
            new = {"id": f"{self.table}-{len(rows) + 1}", **p}
            rows.append(new)
            return SimpleNamespace(data=[dict(new)])
        matched = [r for r in rows if self._match(r)]
        if self.mode == "update":
            for r in matched:
                r.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in matched])
        if self.mode == "delete":
            for r in matched:
                rows.remove(r)
            return SimpleNamespace(data=[dict(r) for r in matched])
        if self.order_col:
            matched = sorted(
                matched,
                key=lambda r: r.get(self.order_col) or "",
                reverse=bool(self.desc_col),
            )
        if self.limit_n is not None:
            matched = matched[: self.limit_n]
        data = [dict(r) for r in matched]
        if self.single_mode:
            return SimpleNamespace(data=data[0] if data else None)
        return SimpleNamespace(data=data)


class FakeAdmin:
    def __init__(self):
        self.users = []  # SimpleNamespace(id, email, email_confirmed_at)
        self.invite_error = None  # Exception to raise from invite_user_by_email
        self.invited = []
        self.password_updates = []
        self.created = []
        self.deleted = []

    def list_users(self, page=1, per_page=50):
        return SimpleNamespace(users=list(self.users))

    def invite_user_by_email(self, email, options=None):
        if self.invite_error:
            raise self.invite_error
        self.invited.append((email, options))

    def get_user_by_id(self, uid):
        for u in self.users:
            if u.id == uid:
                return SimpleNamespace(user=u)
        raise Exception("user not found")

    def create_user(self, attrs):
        u = SimpleNamespace(
            id=f"auth-new-{len(self.users) + 1}",
            email=attrs["email"],
            email_confirmed_at="2026-01-01",
        )
        self.users.append(u)
        self.created.append(attrs)
        return SimpleNamespace(user=u)

    def update_user_by_id(self, uid, attrs):
        self.password_updates.append((uid, attrs))

    def delete_user(self, uid):
        self.deleted.append(uid)


class FakeDB:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.auth = SimpleNamespace(admin=FakeAdmin())

    def table(self, name):
        return FakeQuery(self, name)

    def check_insert(self, table, payload, rows):
        if (
            table == "staff_invitations"
            and not payload.get("accepted_at")
            and not payload.get("revoked_at")
        ):
            for r in rows:
                if (
                    r["tenant_id"] == payload["tenant_id"]
                    and r["email"].lower() == payload["email"].lower()
                    and not r.get("accepted_at")
                    and not r.get("revoked_at")
                ):
                    raise Exception(
                        "duplicate key value violates unique constraint uq_staff_invitations_live_email 23505"
                    )
