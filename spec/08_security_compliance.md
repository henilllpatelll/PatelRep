# PatelRep — Security & Compliance

## 1. Authentication

### 1.1 Supabase Auth (JWT-based)

- **Login methods:** Email magic link (managers), Email + password (staff)
- **JWT expiry:** 1 hour access token, 7-day refresh token
- **Token storage:**
  - Web: Supabase JS stores JWT in `localStorage` (with `supabase.auth.onAuthStateChange`)
  - Mobile: Supabase React Native client stores in `expo-secure-store` (encrypted iOS Keychain / Android Keystore)
- **Custom JWT claims:** `hotel_id` and `role` injected via database function → enforces RLS context

### 1.2 Staff PIN / Quick Login (Mobile)

For housekeeping staff who share devices or need fast access:
- After first magic link login, staff can set a 4-digit PIN
- PIN stored as bcrypt hash on `user_profiles`
- PIN unlocks a short-lived session (8 hours, matching a shift)
- GM can force PIN reset for all staff at any time

### 1.3 Session Management

```python
# FastAPI JWT verification middleware
from jose import jwt, JWTError

async def verify_supabase_jwt(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated"
        )
        # Extract hotel_id and role from custom claims
        hotel_id = payload.get("hotel_id")
        role = payload.get("role")
        if not hotel_id or not role:
            raise HTTPException(401, "Invalid token claims")
        return {"user_id": payload["sub"], "hotel_id": hotel_id, "role": role}
    except JWTError:
        raise HTTPException(401, "Invalid token")
```

---

## 2. Authorization (RBAC + RLS)

### 2.1 Row-Level Security Architecture

Every table has RLS enforced at the PostgreSQL level. This means even if the application has a bug that leaks a `hotel_id`, the database will reject the query.

**Three-layer defense:**
1. FastAPI middleware validates JWT and sets request context
2. All queries include `tenant_id` filter in application code
3. Supabase RLS policy enforces `tenant_id` check at DB level regardless

### 2.2 RLS Policies by Role

```sql
-- GMs and supervisors see all rows for their hotel
CREATE POLICY "supervisor_full_access" ON tasks
  FOR ALL USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') IN ('gm', 'housekeeping_supervisor', 'chief_engineer', 'front_desk')
  );

-- Housekeepers see only their assigned tasks
CREATE POLICY "housekeeper_own_tasks" ON tasks
  FOR SELECT USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') = 'housekeeper'
    AND assigned_to = auth.uid()
  );

-- Engineers see only engineering work orders
CREATE POLICY "engineer_work_orders" ON work_orders
  FOR SELECT USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') = 'engineer'
    AND (assigned_to = auth.uid() OR assigned_to IS NULL)
  );

-- Billing data: GM only
CREATE POLICY "gm_billing_access" ON credit_ledger
  FOR ALL USING (
    tenant_id = (auth.jwt() ->> 'hotel_id')::uuid
    AND (auth.jwt() ->> 'role') = 'gm'
  );
```

### 2.3 API-Level Authorization (FastAPI)

```python
# FastAPI role dependencies
def require_role(*roles: str):
    async def check_role(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(403, f"Role {current_user.role} cannot access this endpoint")
        return current_user
    return check_role

# Usage in router
@router.post("/housekeeping/assignments")
async def create_assignments(
    user: User = Depends(require_role("gm", "housekeeping_supervisor"))
):
    ...

@router.patch("/billing/subscription")
async def update_subscription(
    user: User = Depends(require_role("gm"))
):
    ...
```

---

## 3. Data Protection

### 3.1 Encryption at Rest

- **Supabase PostgreSQL:** Encrypted at rest (AES-256) — managed by Supabase
- **Supabase Storage:** Files encrypted at rest — managed by Supabase
- **Opera Cloud OAuth tokens:** Stored using Supabase Vault (pgcrypto-based encrypted columns)

```sql
-- Opera credentials encrypted with Supabase Vault
CREATE TABLE opera_credentials (
  ...
  access_token  TEXT,   -- Encrypted: vault.encrypt(token, key_id)
  refresh_token TEXT,   -- Encrypted
  ...
);

-- Encrypt on write
UPDATE opera_credentials
SET access_token = vault.encrypt(new_token, 'opera_token_key_id')
WHERE tenant_id = $1;

-- Decrypt on read (FastAPI service role only)
SELECT vault.decrypt(access_token, 'opera_token_key_id') as token
FROM opera_credentials WHERE tenant_id = $1;
```

### 3.2 Encryption in Transit

- All HTTP traffic: TLS 1.3 minimum (enforced by Cloudflare + Railway + Vercel)
- Internal Supabase connections: TLS enforced
- Railway → Supabase: Connection string uses `?sslmode=require`

### 3.3 Secrets Management

- **Railway:** API keys stored as Railway environment variables (encrypted at rest by Railway)
- **Vercel:** `NEXT_PUBLIC_*` keys for client-side only; never expose secret keys to client
- **Mobile app:** No secrets in the mobile app bundle. All API calls go through FastAPI which holds the secrets.
- **Local development:** `.env` files, never committed (`.gitignore`)

```bash
# .gitignore — critical entries
.env
.env.local
.env.production
*.pem
supabase/.env
```

---

## 4. Input Validation & Security

### 4.1 API Input Validation (Pydantic)

```python
from pydantic import BaseModel, field_validator, constr

class CreateTaskRequest(BaseModel):
    title: constr(min_length=1, max_length=200, strip_whitespace=True)
    description: str | None = None
    task_type: Literal["housekeeping", "engineering", "guest_request", "general"]
    priority: Literal["urgent", "normal", "low"]
    room_id: UUID | None = None
    nl_input: constr(max_length=1000) | None = None

    @field_validator("title")
    def no_html(cls, v):
        # Strip any HTML tags (XSS prevention)
        return strip_html(v)
```

### 4.2 SQL Injection Prevention

All database queries use Supabase's parameterized query builder or raw SQL with bound parameters:

```python
# SAFE - parameterized via Supabase client
result = await supabase.table("tasks")\
    .select("*")\
    .eq("tenant_id", hotel_id)\
    .eq("status", status)\
    .execute()

# SAFE - bound parameters in raw SQL
result = await supabase.rpc("match_sop_chunks", {
    "query_embedding": embedding,
    "hotel_id": hotel_id,
    "match_threshold": 0.75
})

# NEVER do string interpolation in SQL
# BAD: f"SELECT * FROM tasks WHERE tenant_id = '{hotel_id}'"
```

### 4.3 Rate Limiting

```python
# FastAPI rate limiting middleware
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

# Per-endpoint limits
@router.post("/ai/copilot/chat")
@limiter.limit("30/minute")    # 30 AI requests per minute per IP
async def copilot_chat(...):
    ...

@router.post("/auth/login")
@limiter.limit("10/minute")    # Prevent brute force
async def login(...):
    ...
```

### 4.4 File Upload Security

```python
ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB

async def validate_upload(file: UploadFile):
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(400, "Invalid file type")
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(413, "File too large")
    # Virus scan: for MVP, rely on Supabase's built-in scanning
    # Production: add ClamAV or cloud malware scanning
    return content
```

---

## 5. PCI DSS Compliance

### 5.1 SAQ A Compliance (No Card Data Stored)

PatelRep is **PCI DSS SAQ A compliant** by design:
- **No credit card numbers stored** — ever
- **No card data transmitted** through PatelRep servers
- All payment processing handled entirely by **Stripe.js** (tokenization in browser/app)
- PatelRep only stores: `stripe_customer_id`, `stripe_subscription_id`, invoice records

### 5.2 Stripe Integration Security

```python
# Webhook signature verification (prevents spoofed Stripe events)
import stripe

@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
        )
    except stripe.error.SignatureVerificationError:
        raise HTTPException(400, "Invalid Stripe signature")

    # Process event...
```

---

## 6. GDPR & CCPA Compliance

### 6.1 Personal Data Inventory

Guest PII received from Opera Cloud:
- `guest_name` (first + last)
- `guest_email` (in some configurations)
- VIP codes and preferences

Staff PII stored in PatelRep:
- Full name, email, phone, employee ID

### 6.2 Data Processing Agreement

- PatelRep's Terms of Service includes a Data Processing Addendum (DPA)
- Hotels (data controllers) authorize PatelRep (data processor) to process guest PII for operations purposes only
- PatelRep does not use guest data for training AI models

### 6.3 Data Retention & Deletion

```python
# Scheduled job: archive data older than 12 months to cold storage
@router.post("/internal/data/archive")
async def archive_old_data():
    cutoff_date = datetime.now() - timedelta(days=365)
    # Archive tasks, work_orders, room_status_history to cold storage
    # Keep aggregate stats, delete row-level PII from hot DB
    await archive_records_before(cutoff_date)

# GDPR deletion endpoint (staff account deletion)
@router.delete("/users/{user_id}")
async def delete_user(user_id: UUID, current_user: User = Depends(require_role("gm"))):
    # Anonymize: replace name/email with "Deleted Staff"
    # Keep task/work order records (operational history) but remove user association
    await anonymize_user_data(user_id)
    await supabase.auth.admin.delete_user(str(user_id))

# Guest data deletion (GDPR right to erasure request via hotel)
@router.delete("/guests/{opera_profile_id}/data")
async def delete_guest_data(opera_profile_id: str):
    await supabase.table("opera_reservations")\
        .update({"guest_name": "Deleted", "guest_email": None})\
        .eq("guest_profile_id", opera_profile_id)\
        .execute()
```

### 6.4 Data Subject Rights (GDPR)

| Right | Implementation |
|---|---|
| Right to Access | GM can export all hotel data as JSON via `/reports/data-export` |
| Right to Erasure | GM triggers staff/guest data deletion via settings |
| Right to Portability | Data export in JSON and CSV formats |
| Right to Rectification | Staff profile editing available to GM |
| Data Residency | Supabase US East region (Virginia) — disclose to EU hotels if applicable |

---

## 7. Opera Cloud Webhook Security

```python
# Validate Opera Business Events webhook signature
import hmac, hashlib

@router.post("/webhooks/opera")
async def opera_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("x-opera-signature")
    hotel_id = request.headers.get("x-opera-hotel-id")

    # Fetch hotel's Opera shared secret
    opera_secret = await get_opera_webhook_secret(hotel_id)

    expected = hmac.new(
        opera_secret.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, signature or ""):
        raise HTTPException(401, "Invalid Opera webhook signature")

    # Process event...
```

---

## 8. Security Checklist for Launch

- [ ] All endpoints require authentication (except `/webhooks/*`, `/health`)
- [ ] RLS policies tested on all tables via Supabase Studio
- [ ] Rate limiting on auth and AI endpoints
- [ ] Stripe webhook signature verification
- [ ] Opera webhook signature verification
- [ ] File upload size + MIME type validation
- [ ] No secrets in frontend code or mobile app bundle
- [ ] HTTPS enforced on all domains (HSTS header)
- [ ] Security headers set on Vercel (X-Frame-Options, CSP, etc.)
- [ ] Supabase service role key only used in FastAPI (never in client)
- [ ] Pydantic validation on all request bodies
- [ ] SQL injection prevention: no string interpolation in queries
- [ ] GDPR: privacy policy + DPA in place before accepting non-Texas customers
- [ ] PCI: Stripe tokenization only, no card data in PatelRep DB
- [ ] Session management: tokens invalidated on role change
