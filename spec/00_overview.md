# PatelRep — Product Overview & Vision

## 1. Product Summary

**PatelRep** is an AI-powered hotel staff operations platform for independent hotels (50–150 rooms) in Texas. It combines Quore-style departmental simplicity with Alice-level predictive intelligence at independent hotel prices.

**Core problem:** Hotels waste 20–30% of labor hours on manual task coordination, missed handoffs, and reactive maintenance. Managers drown in WhatsApp groups and Excel while guest complaints pile up from delayed room readiness and missed SLAs.

**Solution:** An "AI Staff Copilot" that makes every staff member 2x more productive through:
1. Conversational task creation ("AC broken in 514, urgent" → task created + routed automatically)
2. Predictive intelligence ("Room 312 will miss 3PM check-in — reassign now")
3. Proactive insights ("Engineering overtime spiking 40% — rebalance shifts")
4. Instant SOP answers ("VIP turndown procedure?" → step-by-step + tasks created)

---

## 2. Positioning

| Competitor | Weakness | PatelRep Advantage |
|---|---|---|
| Quore | Simple task lists, no AI | AI-native, predictive routing |
| Alice/Actabl | $4–9/room/mo, enterprise-only | $99/mo flat + AI credits, independent-friendly |
| WhatsApp + Excel | No structure, no history | Structured ops + AI, replaces chaos |

---

## 3. Target Market

- **Primary:** 50–150 room independent and low-to-mid brand hotels in Texas
- **Secondary:** Small hotel groups (2–5 properties) under single ownership
- **ICP (Ideal Customer Profile):**
  - Independent or soft-brand hotel
  - 20–80 staff members
  - GM who wears multiple hats
  - Currently using WhatsApp/GroupMe for staff coordination
  - Budget-conscious, not enterprise IT

---

## 4. Core Modules (MVP)

### 4.1 Housekeeping Module
- Real-time room status board (Dirty / Clean / Inspected / OOO / Pickup)
- AI auto-room assignment with supervisor approval
- Room readiness prediction (check-in risk scoring)
- NL task creation via quick-action buttons + typed natural language
- Supervisor inspection workflow with configurable checklist
- SOP library with pgvector RAG Q&A

### 4.2 Engineering / Maintenance Module
- Work order creation + tracking (any staff can create)
- Mobile photo upload (before/after)
- SLA tracking (Urgent 1hr / Normal 4hr / Low end-of-day)
- Preventive maintenance scheduling with asset register
- AI failure prediction with cost impact estimates

### 4.3 Front Desk Module
- Create tasks for any department via NL
- Read-only room status view
- Guest request tracking (with SLA: 15-min target)
- Lost & found log
- Read-only guest profile view (from Opera Cloud)

### 4.4 Management Dashboard (Web)
- Live operations overview (room status heatmap, open work orders)
- AI risk alerts panel ("3 rooms at risk of missing check-in")
- Labor efficiency metrics (rooms/hr, SLA compliance rate)
- Trend analytics (weekly/monthly charts)
- ROI metrics: labor hours saved, check-in readiness rate, SLA compliance %

### 4.5 Logbook
- AI-generated shift handoff summary from task data
- Timestamped manual shift notes per department
- Searchable history

### 4.6 Staff Scheduling (Basic MVP)
- Shift calendar: who works, what hours, which department
- On-shift / off-shift status
- Used by AI for workload balancing and assignment

---

## 5. User Roles & Permissions

| Role | Platform | Key Permissions |
|---|---|---|
| **Housekeeper** | Mobile only | View own assigned rooms, mark status, NL task creation |
| **Maintenance/Engineer** | Mobile only | View/claim work order queue, upload photos, mark complete |
| **Housekeeping Supervisor** | Mobile + Web | Assign/reassign rooms, approve AI suggestions, run inspections, view dept analytics |
| **Chief Engineer** | Mobile + Web | Manage work order queue, configure PM schedules + asset register, view dept analytics |
| **Front Desk** | Mobile + Web | Create tasks (any dept), read-only room status, guest requests, lost & found |
| **General Manager** | Web primary | Full property access, all analytics, AI insights, staff management, billing, integrations |

---

## 6. Pricing Model

### Per-Property Pricing
| Component | Amount | Notes |
|---|---|---|
| Base fee | $99/month | Unlimited basic task management + scheduling + logbook |
| Included AI credits | 5,000/month | Included in base fee |
| Additional AI credits | $0.02/credit | Charged at monthly true-up |
| Maximum cap | $2.50/room/month | Total cost capped regardless of AI usage |

### AI Credit Costs by Interaction Type
| Interaction | Credits | Cost |
|---|---|---|
| NL task creation | 1 credit | $0.02 |
| Room readiness prediction (per room) | 0.5 credits | $0.01 |
| SOP RAG query | 2 credits | $0.04 |
| Asset failure prediction (nightly, per asset) | 0.25 credits | $0.005 |
| Shift summary generation | 3 credits | $0.06 |
| GM insights query | 2 credits | $0.04 |

### Example Cost for 100-Room Hotel
- Base fee: $99
- 100 rooms × 2 daily interactions = ~6,000 AI credits/month
- Overage: 1,000 credits × $0.02 = $20
- **Total: $119/month** (vs. Quore at $400–900/month)
- Cap: 100 rooms × $2.50 = $250/month maximum ever

### Trial
- 1 month free trial with 10,000 AI credits
- No credit card required to start

---

## 7. Go-to-Market

- **Pilot:** 1 committed Texas hotel on 1-month free trial
- **Launch:** Texas independent hotel market, direct outreach + referrals
- **Growth:** Hotel owner associations (THLA), property management company networks
- **Enterprise upsell:** Multi-property discount, custom AI agents, white-label mobile apps

---

## 8. Key Metrics for Product Success

- Check-in readiness rate: rooms ready before guest arrival (target: >95%)
- SLA compliance rate: tasks/work orders completed within SLA (target: >90%)
- Labor hours saved per week (target: 10+ hours/week for 100-room hotel)
- Time to first AI interaction after onboarding (target: <15 minutes)
- Monthly active users per hotel (target: >80% of staff)
