# PatelRep — Billing & Usage Metering

## 1. Pricing Summary

| Component | Amount | Details |
|---|---|---|
| Base subscription | $99/month/property | Unlimited task management, scheduling, logbook |
| Included AI credits | 5,000/month | Included in base fee, resets monthly |
| AI overage | $0.02/credit | Charged above included credits |
| Monthly cap | $2.50 × room_count | Maximum total bill regardless of usage |
| Free trial | 1 month | 10,000 AI credits, no card required |

**Example for 100-room hotel:**
- Base fee: $99
- Average monthly AI usage: ~6,000 credits
- Overage: 1,000 × $0.02 = $20
- Total: $119/month
- Cap enforced: min($119, 100 × $2.50) = min($119, $250) → $119 (under cap)

**Example for 200-room hotel at max usage:**
- Unlimited AI use → cap = 200 × $2.50 = $500/month maximum ever

---

## 2. Stripe Setup

### 2.1 Stripe Products & Prices

Configure in Stripe Dashboard before launch:

```python
# One-time setup script
import stripe

# Base subscription product
base_product = stripe.Product.create(name="PatelRep Base")
base_price = stripe.Price.create(
    product=base_product.id,
    unit_amount=9900,        # $99.00 in cents
    currency="usd",
    recurring={"interval": "month"},
)

# AI credit overage product (metered)
# Note: For MVP, overage is calculated and invoiced separately via Invoice Items
# This keeps billing simple without requiring Stripe Metered Billing API complexity
overage_product = stripe.Product.create(name="PatelRep AI Credits Overage")
overage_price = stripe.Price.create(
    product=overage_product.id,
    unit_amount=2,           # $0.02 in cents per credit
    currency="usd",
    recurring={"interval": "month", "usage_type": "metered"},
)
```

### 2.2 Customer Creation (On Hotel Signup)

```python
async def create_stripe_customer(hotel: Hotel, gm_email: str) -> str:
    customer = stripe.Customer.create(
        email=gm_email,
        name=hotel.name,
        metadata={
            "hotel_id": str(hotel.id),
            "room_count": str(hotel.room_count),
            "city": hotel.city,
        }
    )

    await supabase.table("subscriptions").insert({
        "tenant_id": str(hotel.id),
        "stripe_customer_id": customer.id,
        "plan_status": "trialing",
        "trial_end": (datetime.now() + timedelta(days=30)).isoformat(),
        "credits_included": 10000,  # Extra credits during trial
        "base_fee_cents": 9900,
    })

    return customer.id
```

### 2.3 Trial-to-Paid Conversion

```python
async def activate_paid_subscription(hotel_id: str, payment_method_id: str):
    sub = await get_subscription(hotel_id)

    # Attach payment method to customer
    stripe.PaymentMethod.attach(payment_method_id, customer=sub.stripe_customer_id)
    stripe.Customer.modify(sub.stripe_customer_id,
        invoice_settings={"default_payment_method": payment_method_id})

    # Create subscription (starts immediately after trial)
    stripe_sub = stripe.Subscription.create(
        customer=sub.stripe_customer_id,
        items=[{"price": settings.STRIPE_BASE_PRICE_ID}],
        trial_end="now",    # End trial immediately if converting early
        metadata={"hotel_id": hotel_id}
    )

    await update_subscription(hotel_id, {
        "stripe_subscription_id": stripe_sub.id,
        "plan_status": "active",
        "current_period_start": datetime.fromtimestamp(stripe_sub.current_period_start),
        "current_period_end": datetime.fromtimestamp(stripe_sub.current_period_end),
        "credits_included": 5000,  # Back to standard after trial
        "cap_cents": hotel.room_count * 250,  # $2.50/room in cents
    })
```

---

## 3. Credit Ledger System

### 3.1 Ledger Structure

One row per hotel per billing period, updated in real-time:

```sql
-- Current period ledger (auto-created at period start)
SELECT * FROM credit_ledger
WHERE tenant_id = $hotel_id
  AND period_start <= CURRENT_DATE
  AND period_end >= CURRENT_DATE;

-- Example row:
{
  tenant_id: "abc-123",
  period_start: "2026-03-01",
  period_end: "2026-03-31",
  credits_included: 5000,
  credits_used: 3847,
  credits_purchased: 0,
  overage_credits: 0,   -- computed: max(0, used - included - purchased)
  overage_cost_cents: 0 -- computed: overage_credits * 2
}
```

### 3.2 Credit Deduction (Per AI Interaction)

```python
# Called from every AI endpoint before processing
async def deduct_credits(hotel_id: str, interaction_type: str) -> tuple[bool, str]:
    """
    Returns (success, reason).
    success=False means: block this AI interaction (cap reached).
    """
    CREDIT_COSTS = {
        "task_creation": 1.0,
        "room_prediction": 0.5,
        "sop_query": 2.0,
        "failure_prediction": 0.25,
        "shift_summary": 3.0,
        "gm_insight": 2.0,
        "assignment_suggestion": 0.5,
        "onboarding_assistant": 1.0,
    }

    credits = CREDIT_COSTS.get(interaction_type, 1.0)
    ledger = await get_current_ledger(hotel_id)

    if not ledger:
        # Create ledger for new period
        ledger = await create_period_ledger(hotel_id)

    # Check if at hard cap
    if ledger.cap_cents and ledger.overage_cost_cents >= ledger.cap_cents - 9900:
        return False, "Monthly cap reached. Upgrade or wait for next billing period."

    # Check trial credits exhausted
    sub = await get_subscription(hotel_id)
    if sub.plan_status == "trialing" and ledger.credits_used >= ledger.credits_included:
        return False, "Trial credits exhausted. Please add a payment method to continue."

    # Deduct credits atomically
    await supabase.rpc("increment_credits_used", {
        "hotel_id": hotel_id,
        "credits": credits
    })

    return True, "ok"
```

```sql
-- Atomic credit increment function (prevents race conditions)
CREATE OR REPLACE FUNCTION increment_credits_used(hotel_id UUID, credits DECIMAL)
RETURNS VOID AS $$
  UPDATE credit_ledger
  SET credits_used = credits_used + credits
  WHERE tenant_id = hotel_id
    AND period_start <= CURRENT_DATE
    AND period_end >= CURRENT_DATE;
$$ LANGUAGE sql;
```

### 3.3 Period Ledger Creation (Monthly)

```python
# Creates new ledger row at the start of each billing period
async def create_period_ledger(hotel_id: str):
    sub = await get_subscription(hotel_id)
    today = date.today()
    period_start = date(today.year, today.month, 1)
    # Period end: last day of month
    period_end = period_start + relativedelta(months=1) - timedelta(days=1)

    return await supabase.table("credit_ledger").upsert({
        "tenant_id": hotel_id,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
        "credits_included": sub.credits_included,
        "credits_used": 0,
        "credits_purchased": 0,
    }).execute()
```

---

## 4. Monthly Billing True-Up

### 4.1 True-Up Job (Railway Cron, Last Day of Month)

```python
# POST /internal/billing/monthly-trueup
async def monthly_billing_trueup():
    """
    Run on the last day of each month.
    Creates Stripe Invoice Items for AI credit overages.
    """
    active_hotels = await get_active_paid_hotels()

    for hotel in active_hotels:
        ledger = await get_current_period_ledger(hotel.id)
        if not ledger or ledger.is_finalized:
            continue

        if ledger.overage_credits > 0:
            # Calculate actual overage (never exceed cap)
            max_overage_cents = ledger.cap_cents - 9900 if ledger.cap_cents else None
            overage_cents = min(
                ledger.overage_credits * 2,  # $0.02 per credit
                max_overage_cents or ledger.overage_credits * 2
            )

            if overage_cents > 0:
                # Create Stripe Invoice Item (added to next invoice)
                stripe.InvoiceItem.create(
                    customer=hotel.stripe_customer_id,
                    amount=int(overage_cents),
                    currency="usd",
                    description=f"AI Credits Overage: {ledger.overage_credits} credits @ $0.02",
                    metadata={
                        "hotel_id": hotel.id,
                        "period": ledger.period_start.strftime("%Y-%m"),
                        "credits_included": ledger.credits_included,
                        "credits_used": ledger.credits_used,
                        "overage_credits": ledger.overage_credits,
                    }
                )

        # Mark ledger as finalized
        await finalize_ledger(ledger.id)
```

---

## 5. Stripe Webhooks

```python
# Handle Stripe events to keep subscription state in sync
@router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    event = await verify_stripe_webhook(request)

    handlers = {
        "customer.subscription.updated": handle_subscription_updated,
        "customer.subscription.deleted": handle_subscription_cancelled,
        "invoice.payment_succeeded": handle_payment_succeeded,
        "invoice.payment_failed": handle_payment_failed,
    }

    handler = handlers.get(event.type)
    if handler:
        await handler(event.data.object)

async def handle_payment_failed(subscription):
    hotel_id = subscription.metadata.get("hotel_id")
    await update_subscription(hotel_id, {"plan_status": "past_due"})
    # Send email to GM (via Supabase Email or Resend)
    await send_payment_failed_email(hotel_id)
    # Downgrade: disable AI features, keep basic task management active
    await disable_ai_features(hotel_id)

async def handle_subscription_cancelled(subscription):
    hotel_id = subscription.metadata.get("hotel_id")
    await update_subscription(hotel_id, {"plan_status": "cancelled"})
    # Mark hotel as inactive after 30-day grace period
    await schedule_deactivation(hotel_id, days=30)
```

---

## 6. Billing UI Components

### 6.1 Credits Usage Widget (GM Dashboard)

```
┌──────────────────────────────────────────┐
│  AI Credits — March 2026                  │
│                                           │
│  Used: 3,847 / 5,000 included             │
│  ████████████████░░░░  77%               │
│                                           │
│  Remaining: 1,153 credits                 │
│  At current rate: will last ~8 days       │
│                                           │
│  Monthly cap: $250.00 (100 rooms)         │
│  Current estimate: $99.00                 │
│  Projected total: $115.00                 │
│                                           │
│  [View Usage Breakdown] [Manage Billing]  │
└──────────────────────────────────────────┘
```

### 6.2 Billing Settings Page

```
┌──────────────────────────────────────────┐
│  SUBSCRIPTION                             │
│  Plan: PatelRep Base — $99/month          │
│  Status: ● Active                         │
│  Next billing: April 1, 2026             │
│  [Manage in Stripe Portal]                │
│                                           │
│  USAGE THIS PERIOD                        │
│  Task creation:    2,100 interactions     │
│  Room predictions: 1,200 × 0.5           │
│  SOP queries:      180 × 2               │
│  Shift summaries:  47 × 3                │
│  ─────────────────                        │
│  Total: 3,847 credits ($76.94 value)     │
│  Included: 5,000 (0 overage)             │
│  ─────────────────                        │
│  Estimated bill: $99.00                   │
│                                           │
│  PAYMENT METHOD                           │
│  Visa ···· 4242 | Expires 09/27          │
│  [Update Payment Method]                  │
└──────────────────────────────────────────┘
```

---

## 7. Multi-Property Group Billing

For hotel groups (same owner, multiple properties):

```python
async def create_group_consolidated_invoice(group_id: str):
    """
    For hotel groups: generate a single consolidated monthly invoice.
    Applied as group discount on the total.
    """
    group = await get_tenant_group(group_id)
    member_hotels = await get_group_members(group_id)

    total_before_discount = sum([
        hotel.base_fee + hotel.overage_this_month
        for hotel in member_hotels
    ])

    discount = total_before_discount * (group.group_discount_pct / 100)
    total_after_discount = total_before_discount - discount

    # Create single Stripe Invoice for group owner
    # (individual hotel Stripe subscriptions are paused, group billing replaces them)
```

---

## 8. Revenue Projections

| Hotels | Monthly Revenue | Monthly Infra | Gross Margin |
|---|---|---|---|
| 1 (pilot, free) | $0 | ~$130 | -$130 |
| 10 | ~$1,100 | ~$200 | ~82% |
| 50 | ~$5,500 | ~$400 | ~93% |
| 100 | ~$11,000 | ~$600 | ~95% |
| 500 | ~$55,000 | ~$2,000 | ~96% |

*Assumes average $110/hotel/month (base + typical AI overage), infra scales sublinearly.*
