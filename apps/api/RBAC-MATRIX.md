# RBAC Matrix

**Generated file -- do not hand-edit.** Regenerate with:

```
python apps/api/scripts/generate_rbac_matrix.py
```

Every route in `apps/api/routers/` (API prefix `/v1`), its required role(s), and its source location -- introspected via AST from `require_role(...)` call sites and `core/roles.py` constants, matching Phase 19's `RBAC-AUDIT.md` route-level-gate/object-level-check classification. `none` = any authenticated staff member (no role restriction). `role-restricted (inline, see source)` = no `require_role(...)` dependency, but the route body has an inline `if <cond involving .role>: raise HTTPException(...)` gate that denies access to non-matching roles (see the `Source` column for the resolved condition) -- distinct from an inline `.role` comparison that only filters/scopes a query or response without denying access, which remains `none`. `N/A (not role-based)` = gated by a separate, deliberate auth mechanism (cron secret, webhook signature) instead of a role. `N/A (feature-gated, not role-based)` = gated by `require_feature(...)` (`core/feature_flags.py`) -- authenticated (it wraps `get_current_user`) and restricted to tenants with the named flag enabled, but not role-restricted. `UNVERIFIED (no auth dependency detected)` = no `require_role(...)`, `require_feature(...)`, `verify_cron(...)`, or `get_current_user*` dependency was found at all -- flag for review, this may be a route with no authentication. A pytest drift guard (`apps/api/tests/smoke/test_rbac_matrix_contract.py`) fails CI if this file ever goes stale relative to the code it describes.

| Router | Route | Method | Required Role(s) | Source |
|---|---|---|---|---|
| ai_copilot.py | /v1/ai/copilot/chat | POST | none |  |
| ai_copilot.py | /v1/ai/housekeeping/briefing | POST | housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor') [L514] |
| ai_copilot.py | /v1/ai/housekeeping/shift-summary | POST | housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor') [L563] |
| ai_copilot.py | /v1/ai/supervisor/briefing | POST | housekeeping_supervisor | require_role('housekeeping_supervisor') [L606] |
| ai_copilot.py | /v1/ai/engineer/briefing | POST | chief_engineer, engineer | require_role('engineer', 'chief_engineer') [L649] |
| ai_copilot.py | /v1/ai/front-desk/briefing | POST | front_desk | require_role('front_desk') [L693] |
| ai_copilot.py | /v1/ai/gm/briefing | GET | gm | require_role('gm') [L738] |
| ai_copilot.py | /v1/ai/tasks/confirm | POST | none |  |
| ai_copilot.py | /v1/ai/work-orders/confirm | POST | none |  |
| ai_copilot.py | /v1/ai/guest-requests/confirm | POST | none |  |
| ai_copilot.py | /v1/ai/assignments/confirm | POST | engineer, gm, housekeeping_supervisor | require_role('housekeeping_supervisor', 'engineer', 'gm') [L936] |
| ai_copilot.py | /v1/ai/risk-alerts | GET | none |  |
| ai_copilot.py | /v1/ai/insights | GET | none |  |
| ai_copilot.py | /v1/ai/recommendations | GET | chief_engineer, gm, housekeeping_supervisor | require_role('gm', 'chief_engineer', 'housekeeping_supervisor') [L1069] |
| ai_copilot.py | /v1/ai/recommendations/metrics | GET | chief_engineer, gm, housekeeping_supervisor | require_role('gm', 'chief_engineer', 'housekeeping_supervisor') [L1083] |
| ai_copilot.py | /v1/ai/failure-predictions/{prediction_id}/recommendation | POST | chief_engineer, gm | require_role('gm', 'chief_engineer') [L1095] |
| ai_copilot.py | /v1/ai/recommendations/{recommendation_id}/authorize | POST | chief_engineer, gm | require_role('gm', 'chief_engineer') [L1144] |
| ai_copilot.py | /v1/ai/recommendations/{recommendation_id}/mark-executed | POST | chief_engineer, gm | require_role('gm', 'chief_engineer') [L1174] |
| ai_copilot.py | /v1/ai/recommendations/{recommendation_id}/outcome | POST | chief_engineer, gm | require_role('gm', 'chief_engineer') [L1195] |
| ai_copilot.py | /v1/ai/model-routes/{purpose} | PUT | gm | require_role('gm') [L1217] |
| assets.py | /v1/assets | GET | none |  |
| assets.py | /v1/assets | POST | engineer, gm | require_role('gm', 'engineer') [L76] |
| assets.py | /v1/assets/failure-predictions | GET | none |  |
| assets.py | /v1/assets/failure-predictions/history | GET | none |  |
| assets.py | /v1/assets/failure-predictions/{prediction_id}/acknowledge | POST | engineer, gm | require_role('gm', 'engineer') [L143] |
| assets.py | /v1/assets/failure-predictions/batch-acknowledge | POST | engineer, gm | require_role('gm', 'engineer') [L166] |
| assets.py | /v1/assets/failure-predictions/{prediction_id}/create-work-order | POST | engineer, gm | require_role('gm', 'engineer') [L196] |
| assets.py | /v1/assets/recurring-issues | GET | none |  |
| assets.py | /v1/assets/pm-schedules | GET | none |  |
| assets.py | /v1/assets/pm-schedules | POST | chief_engineer, engineer, gm | require_role('gm', 'engineer', 'chief_engineer') [L398] |
| assets.py | /v1/assets/pm-schedules/{schedule_id}/complete | POST | chief_engineer, engineer, gm | require_role('engineer', 'gm', 'chief_engineer') [L415] |
| assets.py | /v1/assets/pm-schedules/{schedule_id}/completions | GET | none |  |
| assets.py | /v1/assets/pm-schedules/{schedule_id} | PATCH | engineer, gm | require_role('engineer', 'gm') [L474] |
| assets.py | /v1/assets/pm-schedules/{schedule_id} | DELETE | engineer, gm | require_role('engineer', 'gm') [L501] |
| assets.py | /v1/assets/categories | GET | none |  |
| assets.py | /v1/assets/categories | POST | engineer, gm | require_role('gm', 'engineer') [L535] |
| assets.py | /v1/assets/{asset_id}/downtime | GET | none |  |
| assets.py | /v1/assets/{asset_id}/downtime | POST | chief_engineer, engineer, gm | require_role('engineer', 'chief_engineer', 'gm') [L570] |
| assets.py | /v1/assets/{asset_id}/downtime/{downtime_id}/restore | POST | chief_engineer, engineer, gm | require_role('engineer', 'chief_engineer', 'gm') [L587] |
| assets.py | /v1/assets/{asset_id}/reliability | GET | none |  |
| assets.py | /v1/assets/meters | POST | chief_engineer, gm | require_role('chief_engineer', 'gm') [L642] |
| assets.py | /v1/assets/meters/{meter_id} | GET | none |  |
| assets.py | /v1/assets/meters/{meter_id} | PATCH | chief_engineer, gm | require_role('chief_engineer', 'gm') [L665] |
| assets.py | /v1/assets/meters/{meter_id}/readings | GET | none |  |
| assets.py | /v1/assets/meters/{meter_id}/readings | POST | chief_engineer, engineer, gm | require_role('engineer', 'chief_engineer', 'gm') [L706] |
| assets.py | /v1/assets/{asset_id}/meters | GET | none |  |
| assets.py | /v1/assets/{asset_id}/meters | POST | chief_engineer, gm | require_role('chief_engineer', 'gm') [L733] |
| assets.py | /v1/assets/{asset_id}/condition-summary | GET | none |  |
| assets.py | /v1/assets/{asset_id} | GET | none |  |
| assets.py | /v1/assets/{asset_id} | PATCH | engineer, gm | require_role('gm', 'engineer') [L791] |
| assets.py | /v1/assets/{asset_id}/run-prediction | POST | engineer, gm | require_role('gm', 'engineer') [L816] |
| assets.py | /v1/assets/pm-schedules/{schedule_id}/completions/{completion_id} | GET | none |  |
| auth.py | /v1/auth/me | GET | none |  |
| auth.py | /v1/auth/hotel-context | POST | none |  |
| billing.py | /v1/billing/subscription | GET | gm | require_role('gm') [L17] |
| billing.py | /v1/billing/credits | GET | gm | require_role('gm') [L29] |
| billing.py | /v1/billing/portal | POST | gm | require_role('gm') [L113] |
| billing.py | /v1/billing/checkout | POST | gm | require_role('gm') [L133] |
| billing.py | /v1/billing/invoices | GET | gm | require_role('gm') [L165] |
| clean_sessions.py | /v1/clean-sessions | POST | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L284] |
| clean_sessions.py | /v1/clean-sessions | GET | none |  |
| clean_sessions.py | /v1/clean-sessions/active | GET | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L453] |
| clean_sessions.py | /v1/clean-sessions/summary | GET | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L476] |
| clean_sessions.py | /v1/clean-sessions/hotel-avg-clean-time | GET | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*_AVG_CLEAN_TIME_ROLES) [L527] |
| clean_sessions.py | /v1/clean-sessions/{session_id} | GET | gm, housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES, 'gm') [L590] |
| clean_sessions.py | /v1/clean-sessions/{session_id} | PATCH | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L618] |
| clean_sessions.py | /v1/clean-sessions/{session_id}/complete | POST | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L665] |
| clean_sessions.py | /v1/clean-sessions/{session_id}/blocker | POST | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L789] |
| clean_sessions.py | /v1/clean-sessions/{session_id}/photos | POST | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L868] |
| cleaning_checklists.py | /v1/housekeeping/checklists | GET | none |  |
| cleaning_checklists.py | /v1/housekeeping/checklists/{clean_type} | PUT | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L147] |
| cleaning_checklists.py | /v1/housekeeping/checklists/{clean_type}/reset | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L216] |
| engineering_insights.py | /v1/engineering/insights | GET | chief_engineer, gm | require_role('gm', 'chief_engineer') [L47] |
| evidence.py | /v1/evidence/applicability | GET | none |  |
| evidence.py | /v1/evidence/applicability | PUT | gm | require_role('gm') [L269] |
| evidence.py | /v1/evidence/documents | GET | none |  |
| evidence.py | /v1/evidence/documents/{document_id} | GET | none |  |
| evidence.py | /v1/evidence/documents/{document_id}/history | GET | none |  |
| evidence.py | /v1/evidence/documents | POST | gm | require_role('gm') [L316] |
| evidence.py | /v1/evidence/documents/{document_id}/approve | POST | gm | require_role('gm') [L340] |
| evidence.py | /v1/evidence/documents/{document_id}/supersede | POST | gm | require_role('gm') [L365] |
| evidence.py | /v1/evidence/documents/{document_id}/assignments | POST | chief_engineer, gm, housekeeping_supervisor | require_role(*COMPETENCY_MANAGER_ROLES) [L393] |
| evidence.py | /v1/evidence/my-acknowledgements | GET | none |  |
| evidence.py | /v1/evidence/documents/{document_id}/assignments | GET | chief_engineer, gm, housekeeping_supervisor | require_role(*COMPETENCY_MANAGER_ROLES) [L438] |
| evidence.py | /v1/evidence/acknowledgements/{assignment_id}/acknowledge | POST | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*EVIDENCE_CAPTURE_ROLES) [L452] |
| evidence.py | /v1/evidence/acknowledgements/{assignment_id}/competency | POST | chief_engineer, gm, housekeeping_supervisor | require_role(*COMPETENCY_MANAGER_ROLES) [L475] |
| evidence.py | /v1/evidence/records | POST | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*EVIDENCE_CAPTURE_ROLES) [L513] |
| evidence.py | /v1/evidence/records | GET | none |  |
| evidence.py | /v1/evidence/records/{record_id} | GET | none |  |
| evidence.py | /v1/evidence/records/{record_id}/file-url | GET | none |  |
| evidence.py | /v1/evidence/records/{record_id} | DELETE | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*EVIDENCE_CAPTURE_ROLES) [L557]; inline: current_user.role in COMPETENCY_MANAGER_ROLES [L562] |
| evidence.py | /v1/evidence/records/{record_id}/file | POST | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*EVIDENCE_CAPTURE_ROLES) [L576] |
| evidence.py | /v1/evidence/exceptions | GET | none |  |
| evidence.py | /v1/evidence/exceptions/{kind}/{reference_id}/actions | POST | gm | require_role('gm') [L651] |
| evidence.py | /v1/evidence/export | GET | gm | require_role('gm') [L706] |
| feature_flag_demo.py | /v1/internal/feature-flag-demo | GET | N/A (feature-gated, not role-based) | require_feature('staging_flag_demo') [L21] |
| feedback.py | /v1/feedback | POST | none |  |
| feedback.py | /v1/feedback | GET | gm | require_role('gm') [L131] |
| guest_requests.py | /v1/guest-requests | POST | none |  |
| guest_requests.py | /v1/guest-requests/{request_id}/transition | POST | role-restricted (inline, see source) | gate: if request.status == 'cancelled' and current_user.role not in MANAGER_ROLES: raise HTTPException(...) [L211]; inline: current_user.role not in MANAGER_ROLES [L211] |
| guest_requests.py | /v1/guest-requests/{request_id}/create-work-order | POST | front_desk, gm, housekeeping_supervisor | require_role(*WORK_ORDER_BRIDGE_ROLES) [L275] |
| guest_requests.py | /v1/guest-requests/{request_id}/messages | POST | role-restricted (inline, see source) | gate: if current_user.role not in MESSAGE_ROLES: raise HTTPException(...) [L369]; inline: current_user.role not in MESSAGE_ROLES [L369] |
| guest_requests.py | /v1/guest-requests/{request_id}/messages | GET | role-restricted (inline, see source) | gate: if current_user.role not in MESSAGE_ROLES: raise HTTPException(...) [L456]; inline: current_user.role not in MESSAGE_ROLES [L456] |
| guest_requests.py | /v1/guest-requests/{request_id}/satisfaction | POST | role-restricted (inline, see source) | gate: if current_user.role not in MESSAGE_ROLES: raise HTTPException(...) [L490]; inline: current_user.role not in MESSAGE_ROLES [L490] |
| guest_requests.py | /v1/guest-requests/{request_id}/recovery-actions | POST | role-restricted (inline, see source) | gate: if requires_approval and current_user.role not in {'gm', 'front_desk'}: raise HTTPException(...) [L531]; inline: current_user.role not in {'gm', 'front_desk'} [L531]; inline: current_user.role == 'gm' [L538] |
| guest_requests.py | /v1/guest-requests/metrics/summary | GET | none |  |
| guest_requests.py | /v1/guest-requests/accessibility/features | GET | none |  |
| guest_requests.py | /v1/guest-requests/sla-policies | GET | none |  |
| guest_requests.py | /v1/guest-requests/sla-policies | POST | role-restricted (inline, see source) | gate: if current_user.role not in MANAGER_ROLES: raise HTTPException(...) [L609]; inline: current_user.role not in MANAGER_ROLES [L609] |
| guest_requests.py | /v1/guest-requests/sla-policies/{policy_id} | PATCH | role-restricted (inline, see source) | gate: if current_user.role not in MANAGER_ROLES: raise HTTPException(...) [L651]; inline: current_user.role not in MANAGER_ROLES [L651] |
| guest_requests.py | /v1/guest-requests/sla-policies/{policy_id} | DELETE | role-restricted (inline, see source) | gate: if current_user.role not in MANAGER_ROLES: raise HTTPException(...) [L691]; inline: current_user.role not in MANAGER_ROLES [L691] |
| guest_requests.py | /v1/guest-requests/accessibility/features | PUT | role-restricted (inline, see source) | gate: if current_user.role not in {'gm', 'housekeeping_supervisor', 'engineer'}: raise HTTPException(...) [L712]; inline: current_user.role not in {'gm', 'housekeeping_supervisor', 'engineer'} [L712] |
| guest_requests.py | /v1/guest-requests | GET | none |  |
| guest_requests.py | /v1/guest-requests/{request_id} | PATCH | none |  |
| guest_requests.py | /v1/guest-requests/{request_id} | DELETE | role-restricted (inline, see source) | gate: if current_user.role not in MANAGER_ROLES: raise HTTPException(...) [L825]; inline: current_user.role not in MANAGER_ROLES [L825] |
| hotels.py | /v1/hotels | POST | none |  |
| hotels.py | /v1/hotels/{hotel_id} | GET | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*ALL_STAFF_ROLES) [L151] |
| hotels.py | /v1/hotels/{hotel_id} | PATCH | gm | require_role('gm') [L168] |
| hotels.py | /v1/hotels/{hotel_id}/housekeeping-settings | GET | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L227] |
| hotels.py | /v1/hotels/{hotel_id}/housekeeping-settings | PUT | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L243] |
| hotels.py | /v1/hotels/{hotel_id}/layout | GET | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L297] |
| hotels.py | /v1/hotels/{hotel_id}/layout | PUT | gm | require_role('gm') [L311] |
| hotels.py | /v1/hotels/{hotel_id}/stats | GET | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*ALL_STAFF_ROLES) [L336] |
| hotels.py | /v1/hotels/{hotel_id}/departments | GET | none |  |
| housekeeping.py | /v1/housekeeping/board | GET | none |  |
| housekeeping.py | /v1/housekeeping/my-rooms | GET | housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor') [L775] |
| housekeeping.py | /v1/housekeeping/assignments | GET | none |  |
| housekeeping.py | /v1/housekeeping/assignments | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L1011] |
| housekeeping.py | /v1/housekeeping/assignments/{assignment_id} | DELETE | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1133] |
| housekeeping.py | /v1/housekeeping/room-assignment/{room_id} | DELETE | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1188] |
| housekeeping.py | /v1/housekeeping/ai-suggest-assignments | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1307] |
| housekeeping.py | /v1/housekeeping/predictions | GET | none |  |
| housekeeping.py | /v1/housekeeping/room-readiness/{room_id}/reassign | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1779] |
| housekeeping.py | /v1/housekeeping/room-readiness/{room_id}/escalate | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1832] |
| housekeeping.py | /v1/housekeeping/room-readiness/{room_id}/acknowledge | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1862] |
| housekeeping.py | /v1/housekeeping/room-readiness/batch-reassign | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1882] |
| housekeeping.py | /v1/housekeeping/room-readiness/batch-acknowledge | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1902] |
| housekeeping.py | /v1/housekeeping/ready-for-inspection | GET | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1927] |
| housekeeping.py | /v1/housekeeping/ready-to-strip | GET | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2007] |
| housekeeping.py | /v1/housekeeping/inspections | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2082] |
| housekeeping.py | /v1/housekeeping/inspections/complete | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2167] |
| housekeeping.py | /v1/housekeeping/inspections/{inspection_id}/reclean | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2302] |
| housekeeping.py | /v1/housekeeping/inspections | GET | none |  |
| housekeeping.py | /v1/housekeeping/inspections/templates | GET | none |  |
| housekeeping.py | /v1/housekeeping/inspections/templates | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2516] |
| housekeeping.py | /v1/housekeeping/inspections/templates/{template_id} | PATCH | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2570] |
| housekeeping.py | /v1/housekeeping/inspections/{inspection_id}/photos | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2666] |
| housekeeping.py | /v1/housekeeping/end-shift-summary | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2723] |
| housekeeping.py | /v1/housekeeping/inspections/templates/{template_id} | DELETE | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2796] |
| housekeeping.py | /v1/housekeeping/import/hk-details/preview | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2880] |
| housekeeping.py | /v1/housekeeping/import/hk-details | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2897] |
| housekeeping.py | /v1/housekeeping/import/task-sheet/preview | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L3016] |
| housekeeping.py | /v1/housekeeping/import/task-sheet | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L3036] |
| integrations.py | /v1/integrations/opera/connect | POST | gm | require_role('gm') [L66] |
| integrations.py | /v1/integrations/opera/status | GET | none |  |
| integrations.py | /v1/integrations/opera/sync | POST | gm | require_role('gm') [L160] |
| integrations.py | /v1/integrations/opera/conflicts | GET | chief_engineer, gm | require_role('gm', 'chief_engineer') [L177] |
| integrations.py | /v1/integrations/opera/conflicts/{conflict_id}/resolve | POST | chief_engineer, gm | require_role('gm', 'chief_engineer') [L196] |
| integrations.py | /v1/integrations/opera/sftp/connect | POST | gm | require_role('gm') [L250] |
| integrations.py | /v1/integrations/opera/sftp/sync | POST | gm | require_role('gm') [L308] |
| integrations.py | /v1/integrations/opera/sftp/test | POST | gm | require_role('gm') [L326] |
| integrations.py | /v1/integrations/opera/sftp/files | GET | chief_engineer, gm | require_role('gm', 'chief_engineer') [L344] |
| integrations.py | /v1/integrations/opera/test | POST | gm | require_role('gm') [L359] |
| integrations.py | /v1/integrations/opera/disconnect | DELETE | gm | require_role('gm') [L376] |
| internal.py | /v1/internal/safety/training-assignments | POST | N/A (not role-based) | verify_cron(...) [L102] |
| internal.py | /v1/internal/safety/drill-follow-up | POST | N/A (not role-based) | verify_cron(...) [L133] |
| internal.py | /v1/internal/evidence/reminders | POST | N/A (not role-based) | verify_cron(...) [L147] |
| internal.py | /v1/internal/predictions/run | POST | N/A (not role-based) | verify_cron(...) [L161] |
| internal.py | /v1/internal/pm/check-due | POST | N/A (not role-based) | verify_cron(...) [L193] |
| internal.py | /v1/internal/tasks/generate-recurring | POST | N/A (not role-based) | verify_cron(...) [L250] |
| internal.py | /v1/internal/ai/failure-predictions | POST | N/A (not role-based) | verify_cron(...) [L283] |
| internal.py | /v1/internal/billing/monthly-trueup | POST | N/A (not role-based) | verify_cron(...) [L331] |
| internal.py | /v1/internal/logbook/shift-summary | POST | N/A (not role-based) | verify_cron(...) [L347] |
| internal.py | /v1/internal/reports/daily-summary-email | POST | N/A (not role-based) | verify_cron(...) [L381] |
| internal.py | /v1/internal/reports/run-schedules | POST | N/A (not role-based) | verify_cron(...) [L510] |
| internal.py | /v1/internal/opera/sync-reservations | POST | N/A (not role-based) | verify_cron(...) [L521] |
| internal.py | /v1/internal/opera/sftp-sync-reports | POST | N/A (not role-based) | verify_cron(...) [L546] |
| internal.py | /v1/internal/escalations/check | POST | N/A (not role-based) | verify_cron(...) [L625] |
| internal.py | /v1/internal/predictions/escalations/check | POST | N/A (not role-based) | verify_cron(...) [L810] |
| internal.py | /v1/internal/lost-found/retention-check | POST | N/A (not role-based) | verify_cron(...) [L874] |
| internal.py | /v1/internal/logbook/cleanup-expired | POST | N/A (not role-based) | verify_cron(...) [L916] |
| inventory.py | /v1/inventory/locations | POST | chief_engineer, engineer, gm | require_role(*_MANAGER_ROLES) [L79] |
| inventory.py | /v1/inventory/locations | GET | none |  |
| inventory.py | /v1/inventory/parts | POST | chief_engineer, engineer, gm | require_role(*_MANAGER_ROLES) [L109] |
| inventory.py | /v1/inventory/parts | GET | none |  |
| inventory.py | /v1/inventory/parts/{part_id} | GET | none |  |
| inventory.py | /v1/inventory/parts/{part_id} | PATCH | chief_engineer, engineer, gm | require_role(*_MANAGER_ROLES) [L186] |
| inventory.py | /v1/inventory/parts/{part_id}/transactions | POST | chief_engineer, engineer, gm | require_role(*_MANAGER_ROLES) [L215] |
| late_checkout.py | /v1/late-checkout/requests | POST | front_desk, gm, housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor', 'front_desk', 'gm') [L15] |
| late_checkout.py | /v1/late-checkout/requests | GET | none | inline: current_user.role == 'housekeeper' [L61] |
| late_checkout.py | /v1/late-checkout/requests/{request_id} | PATCH | front_desk, gm, housekeeping_supervisor | require_role('front_desk', 'gm', 'housekeeping_supervisor') [L73] |
| logbook.py | /v1/logbook/entries | POST | none |  |
| logbook.py | /v1/logbook/entries | GET | none |  |
| logbook.py | /v1/logbook/entries/{entry_id}/comments | GET | none |  |
| logbook.py | /v1/logbook/entries/{entry_id}/comments | POST | none |  |
| logbook.py | /v1/logbook/comments/{comment_id} | PATCH | none |  |
| logbook.py | /v1/logbook/comments/{comment_id} | DELETE | role-restricted (inline, see source) | gate: if current.data['author_id'] != current_user.user_id and current_user.role not in PROGRAM_MANAGER_ROLES: raise HTTPException(...) [L703]; inline: current_user.role not in PROGRAM_MANAGER_ROLES [L703] |
| logbook.py | /v1/logbook/entries/{entry_id}/read | POST | none |  |
| logbook.py | /v1/logbook/entries/{entry_id}/reads | GET | none |  |
| logbook.py | /v1/logbook/entries/{entry_id}/acknowledge | POST | none |  |
| logbook.py | /v1/logbook/entries/{entry_id}/acknowledgment-reminder | POST | role-restricted (inline, see source) | gate: if current_user.role not in PROGRAM_MANAGER_ROLES: raise HTTPException(...) [L739]; inline: current_user.role not in PROGRAM_MANAGER_ROLES [L739] |
| logbook.py | /v1/logbook/entries/{entry_id} | GET | none |  |
| logbook.py | /v1/logbook/entries/{entry_id}/attachments | GET | none |  |
| logbook.py | /v1/logbook/entries/{entry_id}/attachments/{record_id} | DELETE | role-restricted (inline, see source) | gate: if not (entry['author_id'] == current_user.user_id or current_user.role in PROGRAM_MANAGER_ROLES): raise HTTPException(...) [L804]; inline: current_user.role in PROGRAM_MANAGER_ROLES [L804] |
| logbook.py | /v1/logbook/entries/{entry_id}/translate | POST | none |  |
| logbook.py | /v1/logbook/comments/{comment_id}/translate | POST | none |  |
| logbook.py | /v1/logbook/entries/{entry_id} | PATCH | role-restricted (inline, see source) | gate: if not (is_author or is_privileged): raise HTTPException(...) [L891]; inline: current_user.role in PROGRAM_MANAGER_ROLES [L890] |
| logbook.py | /v1/logbook/entries/{entry_id} | DELETE | none |  |
| logbook.py | /v1/logbook/entries/{entry_id}/resolve | POST | role-restricted (inline, see source) | gate: if not (is_author or is_privileged): raise HTTPException(...) [L1024]; inline: current_user.role in PROGRAM_MANAGER_ROLES [L1023] |
| logbook.py | /v1/logbook/entries/{entry_id}/archive | POST | role-restricted (inline, see source) | gate: if not (is_author or is_privileged): raise HTTPException(...) [L1074]; inline: current_user.role in PROGRAM_MANAGER_ROLES [L1073] |
| logbook.py | /v1/logbook/entries/{entry_id}/carry-forward | POST | role-restricted (inline, see source) | gate: if not (is_author or is_privileged): raise HTTPException(...) [L1108]; inline: current_user.role in PROGRAM_MANAGER_ROLES [L1107] |
| logbook.py | /v1/logbook/entries/{entry_id}/continuity | GET | none |  |
| logbook.py | /v1/logbook/entries/{entry_id}/events | GET | none |  |
| logbook.py | /v1/logbook/shift-summary | GET | none |  |
| logbook.py | /v1/logbook/shift-summary/{shift_id} | GET | none |  |
| logbook.py | /v1/logbook/shift-summary/{summary_id}/acknowledge | POST | none |  |
| logbook.py | /v1/logbook/shift-summary/generate | POST | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L1384] |
| lost_found.py | /v1/lost-found/upload-photo | POST | none |  |
| lost_found.py | /v1/lost-found | POST | none |  |
| lost_found.py | /v1/lost-found | GET | none |  |
| lost_found.py | /v1/lost-found/tag-suggestion | GET | none |  |
| lost_found.py | /v1/lost-found/capabilities | GET | none |  |
| lost_found.py | /v1/lost-found/claims/summary | GET | none |  |
| lost_found.py | /v1/lost-found/claims | GET | none |  |
| lost_found.py | /v1/lost-found/claims | POST | none |  |
| lost_found.py | /v1/lost-found/claims/{claim_id} | GET | none |  |
| lost_found.py | /v1/lost-found/claims/{claim_id} | PATCH | none |  |
| lost_found.py | /v1/lost-found/claims/{claim_id}/events | GET | none |  |
| lost_found.py | /v1/lost-found/claims/{claim_id}/matches | GET | none |  |
| lost_found.py | /v1/lost-found/claims/{claim_id}/reject-match | POST | none |  |
| lost_found.py | /v1/lost-found/claims/{claim_id}/match | POST | none |  |
| lost_found.py | /v1/lost-found/claims/{claim_id}/remove-match | POST | none |  |
| lost_found.py | /v1/lost-found/claims/{claim_id}/cancel | POST | none |  |
| lost_found.py | /v1/lost-found/returns/summary | GET | none |  |
| lost_found.py | /v1/lost-found/returns | GET | none |  |
| lost_found.py | /v1/lost-found/returns/{return_id} | GET | none |  |
| lost_found.py | /v1/lost-found/returns/{return_id}/events | GET | none |  |
| lost_found.py | /v1/lost-found/{item_id}/returns | POST | none |  |
| lost_found.py | /v1/lost-found/returns/{return_id}/method | PATCH | none |  |
| lost_found.py | /v1/lost-found/returns/{return_id}/pickup-details | POST | none |  |
| lost_found.py | /v1/lost-found/returns/{return_id}/pickup-ready | POST | none |  |
| lost_found.py | /v1/lost-found/returns/{return_id}/pickup-complete | POST | none |  |
| lost_found.py | /v1/lost-found/returns/{return_id}/shipping-details | POST | none |  |
| lost_found.py | /v1/lost-found/returns/{return_id}/ship | POST | none |  |
| lost_found.py | /v1/lost-found/returns/{return_id}/complete-shipment | POST | none |  |
| lost_found.py | /v1/lost-found/disposition/summary | GET | none |  |
| lost_found.py | /v1/lost-found/disposition | GET | none |  |
| lost_found.py | /v1/lost-found/{item_id}/disposition | POST | none |  |
| lost_found.py | /v1/lost-found/{item_id}/void | POST | none |  |
| lost_found.py | /v1/lost-found/{item_id}/matches | GET | none |  |
| lost_found.py | /v1/lost-found/{item_id} | GET | none |  |
| lost_found.py | /v1/lost-found/{item_id}/custody-events | GET | none |  |
| lost_found.py | /v1/lost-found/{item_id}/custody-events | POST | role-restricted (inline, see source) | gate: if current_user.role not in LOST_FOUND_MANAGER_ROLES: raise HTTPException(...) [L1320]; inline: current_user.role not in LOST_FOUND_MANAGER_ROLES [L1320] |
| lost_found.py | /v1/lost-found/{item_id} | PATCH | role-restricted (inline, see source) | gate: if current_user.role not in LOST_FOUND_MANAGER_ROLES: raise HTTPException(...) [L1386]; inline: current_user.role not in LOST_FOUND_MANAGER_ROLES [L1386] |
| lost_found.py | /v1/lost-found/{item_id} | DELETE | none |  |
| management_roi.py | /v1/reports/roi/repeat-failures | GET | gm | require_role('gm') [L224] |
| management_roi.py | /v1/reports/roi/downtime-revenue | GET | gm | require_role('gm') [L248] |
| management_roi.py | /v1/reports/roi/housekeeping-efficiency | GET | gm | require_role('gm') [L284] |
| management_roi.py | /v1/reports/roi/inspection-trends | GET | gm | require_role('gm') [L324] |
| management_roi.py | /v1/reports/roi/pm-compliance | GET | gm | require_role('gm') [L356] |
| management_roi.py | /v1/reports/roi/training-readiness | GET | gm | require_role('gm') [L386] |
| management_roi.py | /v1/reports/roi/forecast-7day | GET | gm | require_role('gm') [L400] |
| notifications.py | /v1/notifications | GET | none |  |
| notifications.py | /v1/notifications/{notification_id}/read | PATCH | none |  |
| notifications.py | /v1/notifications/mark-all-read | POST | none |  |
| notifications.py | /v1/notifications/broadcast | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L53] |
| notifications.py | /v1/notifications/direct | POST | engineer, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'engineer') [L98] |
| onboarding.py | /v1/onboarding/status | GET | gm | require_role('gm') [L122] |
| onboarding.py | /v1/onboarding/rooms/import-csv | POST | gm | require_role('gm') [L186] |
| onboarding.py | /v1/onboarding/ai-assistant | POST | none |  |
| programs.py | /v1/programs/overview | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L95] |
| programs.py | /v1/programs/templates/initialize | POST | gm | require_role('gm') [L119] |
| programs.py | /v1/programs/templates/{template_id} | PUT | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L162] |
| programs.py | /v1/programs/templates | POST | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L194] |
| programs.py | /v1/programs/pm-schedules/{schedule_id}/deferrals | POST | chief_engineer, gm | require_role('gm', 'chief_engineer') [L223] |
| programs.py | /v1/programs/public-areas | POST | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L257] |
| programs.py | /v1/programs/deep-clean-schedules | POST | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L263] |
| programs.py | /v1/programs/deep-clean-schedules/{schedule_id}/complete | POST | gm, housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor', 'gm') [L275] |
| programs.py | /v1/programs/supply-pars | POST | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L295] |
| programs.py | /v1/programs/stayover-rule | PUT | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L302] |
| programs.py | /v1/programs/dnd-welfare-policy | PUT | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L309] |
| programs.py | /v1/programs/inspection-sampling-rules | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L316] |
| programs.py | /v1/programs/inspection-sample | GET | chief_engineer, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'chief_engineer') [L323] |
| programs.py | /v1/programs/inspection-quality | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L407] |
| programs.py | /v1/programs/deep-clean-schedules | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L421] |
| programs.py | /v1/programs/public-areas | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L433] |
| report_exports.py | /v1/reports/export | GET | none |  |
| report_exports.py | /v1/reports/delivery-status | GET | none | inline: current_user.role not in GM_ONLY_ROLES [L197] |
| report_exports.py | /v1/reports/schedules/recipients | GET | none |  |
| report_exports.py | /v1/reports/schedules | GET | none | inline: current_user.role not in GM_ONLY_ROLES [L224] |
| report_exports.py | /v1/reports/schedules/preview | POST | none |  |
| report_exports.py | /v1/reports/schedules | POST | none |  |
| report_exports.py | /v1/reports/schedules/{schedule_id} | PATCH | none |  |
| report_exports.py | /v1/reports/schedules/{schedule_id} | DELETE | none |  |
| report_exports.py | /v1/reports/schedules/{schedule_id}/deliveries | GET | none |  |
| report_exports.py | /v1/reports/schedules/{schedule_id}/deliveries/{delivery_id}/retry | POST | none |  |
| report_views.py | /v1/reports/views/overview | GET | none |  |
| report_views.py | /v1/reports/views/guest-experience | GET | none |  |
| report_views.py | /v1/reports/views/housekeeping | GET | none |  |
| report_views.py | /v1/reports/views/maintenance | GET | none |  |
| report_views.py | /v1/reports/views/team | GET | none |  |
| report_views.py | /v1/reports/views/management | GET | none |  |
| report_views.py | /v1/reports/trends | GET | none |  |
| report_views.py | /v1/reports/segments | GET | none |  |
| report_views.py | /v1/reports/records | GET | none |  |
| report_views.py | /v1/reports/employee/{user_id} | GET | none |  |
| report_views.py | /v1/reports/room-asset/{kind}/{entity_id} | GET | none |  |
| reports.py | /v1/reports/capabilities | GET | none |  |
| reports.py | /v1/reports/definitions | GET | UNVERIFIED (no auth dependency detected) |  |
| reports.py | /v1/reports/guest-recovery | GET | UNVERIFIED (no auth dependency detected) |  |
| reports.py | /v1/reports/daily-summary | GET | UNVERIFIED (no auth dependency detected) |  |
| reports.py | /v1/reports/staff-performance | GET | UNVERIFIED (no auth dependency detected) |  |
| reports.py | /v1/reports/maintenance | GET | UNVERIFIED (no auth dependency detected) |  |
| reports.py | /v1/reports/ai-usage | GET | gm | require_role('gm') [L238] |
| room_unavailability.py | /v1/room-unavailability/reasons | GET | none |  |
| room_unavailability.py | /v1/room-unavailability | GET | none | inline: current_user.role in LIMITED_ROOM_UNAVAILABILITY_VISIBILITY_ROLES [L76] |
| room_unavailability.py | /v1/room-unavailability/summary | GET | none |  |
| room_unavailability.py | /v1/room-unavailability/room/{room_id}/active | GET | none | inline: current_user.role in LIMITED_ROOM_UNAVAILABILITY_VISIBILITY_ROLES [L94] |
| room_unavailability.py | /v1/room-unavailability/{period_id} | GET | none | inline: current_user.role in LIMITED_ROOM_UNAVAILABILITY_VISIBILITY_ROLES [L105] |
| room_unavailability.py | /v1/room-unavailability | POST | engineer, gm, housekeeping_supervisor | require_role(*MANAGE_ROLES) [L111] |
| room_unavailability.py | /v1/room-unavailability/{period_id}/expected-return | PATCH | engineer, gm, housekeeping_supervisor | require_role(*MANAGE_ROLES) [L129] |
| room_unavailability.py | /v1/room-unavailability/{period_id}/release | POST | engineer, gm, housekeeping_supervisor | require_role(*MANAGE_ROLES) [L150] |
| rooms.py | /v1/rooms | GET | none |  |
| rooms.py | /v1/rooms/types | GET | none |  |
| rooms.py | /v1/rooms | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L302] |
| rooms.py | /v1/rooms/{room_id}/details | PATCH | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L342] |
| rooms.py | /v1/rooms/{room_id}/deletion-check | GET | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L397] |
| rooms.py | /v1/rooms/{room_id} | GET | none |  |
| rooms.py | /v1/rooms/{room_id}/status | PATCH | none | inline: current_user.role == 'gm' [L461] |
| rooms.py | /v1/rooms/{room_id}/checkout | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L567] |
| rooms.py | /v1/rooms/{room_id}/checkout | DELETE | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L676] |
| rooms.py | /v1/rooms/{room_id}/stayover | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L752] |
| rooms.py | /v1/rooms/{room_id}/checkin | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L845] |
| rooms.py | /v1/rooms/{room_id}/welfare-check | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L899] |
| rooms.py | /v1/rooms/{room_id}/re-clean | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L988] |
| rooms.py | /v1/rooms/{room_id}/strip | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1113] |
| rooms.py | /v1/rooms/{room_id}/dnd | PATCH | gm, housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor', 'gm') [L1160] |
| rooms.py | /v1/rooms/{room_id}/decline-service | PATCH | gm, housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor', 'gm') [L1201] |
| rooms.py | /v1/rooms/{room_id}/priority | PATCH | chief_engineer, front_desk, gm, housekeeping_supervisor | require_role(*RUSH_MANAGER_ROLES) [L1257] |
| rooms.py | /v1/rooms/{room_id}/service-attempts | POST | chief_engineer, gm, housekeeper, housekeeping_supervisor | require_role(*HOUSEKEEPING_EXCEPTION_REPORT_ROLES) [L1350] |
| rooms.py | /v1/rooms/{room_id}/service-attempts | GET | none |  |
| rooms.py | /v1/rooms/{room_id}/service-declined | POST | chief_engineer, gm, housekeeper, housekeeping_supervisor | require_role(*HOUSEKEEPING_EXCEPTION_REPORT_ROLES) [L1469] |
| rooms.py | /v1/rooms/{room_id}/discrepancies | POST | chief_engineer, gm, housekeeper, housekeeping_supervisor | require_role(*HOUSEKEEPING_EXCEPTION_REPORT_ROLES) [L1511] |
| rooms.py | /v1/rooms/{room_id}/discrepancies | GET | none |  |
| rooms.py | /v1/rooms/discrepancies/{discrepancy_id}/resolve | POST | front_desk, gm, housekeeping_supervisor | require_role(*DISCREPANCY_RESOLVER_ROLES) [L1590] |
| rooms.py | /v1/rooms/{room_id}/checkout-time | PATCH | engineer, front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'engineer', 'front_desk') [L1647] |
| rooms.py | /v1/rooms/{room_id}/status/undo | POST | none |  |
| rooms.py | /v1/rooms/{room_id}/history | GET | none |  |
| rooms.py | /v1/rooms/{room_id}/notes | POST | none |  |
| rooms.py | /v1/rooms/{room_id} | DELETE | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1850] |
| rooms.py | /v1/rooms/import | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1893] |
| safety.py | /v1/safety/training/courses | POST | gm | require_role('gm') [L70] |
| safety.py | /v1/safety/training/status | GET | none | inline: current_user.role not in MANAGER_ROLES [L84] |
| safety.py | /v1/safety/training/courses/{course_id}/assignments | POST | chief_engineer, gm, housekeeping_supervisor | require_role(*MANAGER_ROLES) [L121] |
| safety.py | /v1/safety/training/assignments/{assignment_id}/complete | POST | none |  |
| safety.py | /v1/safety/training/export | GET | chief_engineer, gm, housekeeping_supervisor | require_role(*MANAGER_ROLES) [L139] |
| safety.py | /v1/safety/incidents | POST | none |  |
| safety.py | /v1/safety/incidents | GET | chief_engineer, gm, housekeeping_supervisor | require_role(*MANAGER_ROLES) [L164] |
| safety.py | /v1/safety/incidents/{incident_id} | GET | none |  |
| safety.py | /v1/safety/incidents/{incident_id}/events | POST | chief_engineer, gm, housekeeping_supervisor | require_role(*MANAGER_ROLES) [L186] |
| safety.py | /v1/safety/chemicals | GET | none |  |
| safety.py | /v1/safety/chemicals | POST | chief_engineer, engineer, gm | require_role('gm', 'chief_engineer', 'engineer') [L210] |
| safety.py | /v1/safety/safety-information | GET | none |  |
| safety.py | /v1/safety/emergency/contacts | GET | none |  |
| safety.py | /v1/safety/emergency/contacts | POST | chief_engineer, gm, housekeeping_supervisor | require_role(*MANAGER_ROLES) [L249] |
| safety.py | /v1/safety/emergency/plans | GET | none |  |
| safety.py | /v1/safety/emergency/drills | POST | chief_engineer, gm, housekeeping_supervisor | require_role(*MANAGER_ROLES) [L264] |
| safety.py | /v1/safety/emergency/drills/{drill_id}/check-in | POST | none |  |
| scheduling.py | /v1/schedules/shifts | GET | none |  |
| scheduling.py | /v1/schedules/shifts | POST | engineer, gm, housekeeping_supervisor | require_role(*SUPERVISOR_ROLES) [L74] |
| scheduling.py | /v1/schedules/shifts/{shift_id} | PATCH | engineer, gm, housekeeping_supervisor | require_role(*SUPERVISOR_ROLES) [L109] |
| scheduling.py | /v1/schedules/shifts/{shift_id} | DELETE | engineer, gm, housekeeping_supervisor | require_role(*SUPERVISOR_ROLES) [L131] |
| scheduling.py | /v1/schedules/assignments/my-schedule | GET | none |  |
| scheduling.py | /v1/schedules/assignments | GET | none |  |
| scheduling.py | /v1/schedules/assignments | POST | engineer, gm, housekeeping_supervisor | require_role(*SUPERVISOR_ROLES) [L198] |
| scheduling.py | /v1/schedules/assignments/bulk | POST | engineer, gm, housekeeping_supervisor | require_role(*SUPERVISOR_ROLES) [L214] |
| scheduling.py | /v1/schedules/assignments/{assignment_id} | DELETE | engineer, gm, housekeeping_supervisor | require_role(*SUPERVISOR_ROLES) [L246] |
| scheduling.py | /v1/schedules/assignments/{assignment_id}/clock-in | PATCH | role-restricted (inline, see source) | gate: if not is_own and (not is_supervisor): raise HTTPException(...) [L280]; inline: current_user.role in SUPERVISOR_ROLES [L278] |
| scheduling.py | /v1/schedules/assignments/{assignment_id}/clock-out | PATCH | role-restricted (inline, see source) | gate: if not is_own and (not is_supervisor): raise HTTPException(...) [L313]; inline: current_user.role in SUPERVISOR_ROLES [L311] |
| scheduling.py | /v1/schedules/today-roster | GET | engineer, gm, housekeeping_supervisor | require_role(*SUPERVISOR_ROLES) [L334] |
| settings_activity.py | /v1/settings/activity/categories | GET | gm | require_role('gm') [L270] |
| settings_activity.py | /v1/settings/activity/actors | GET | gm | require_role('gm') [L278] |
| settings_activity.py | /v1/settings/activity | GET | gm | require_role('gm') [L303] |
| settings_activity.py | /v1/settings/activity/export | GET | gm | require_role('gm') [L329] |
| settings_activity.py | /v1/settings/activity/{event_id} | GET | gm | require_role('gm') [L392] |
| shifts.py | /v1/shifts/current | GET | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L40] |
| shifts.py | /v1/shifts/roster | GET | gm, housekeeping_supervisor | require_role(*ASSIGNMENT_SUPERVISOR_ROLES) [L52] |
| shifts.py | /v1/shifts/start | POST | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L91] |
| shifts.py | /v1/shifts/break | POST | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L127] |
| shifts.py | /v1/shifts/end | POST | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L172] |
| shifts.py | /v1/shifts/history | GET | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L208] |
| sop.py | /v1/sop/documents | GET | none |  |
| sop.py | /v1/sop/documents | POST | engineer, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'engineer') [L81] |
| sop.py | /v1/sop/documents/{document_id} | GET | none |  |
| sop.py | /v1/sop/documents/{document_id} | DELETE | gm | require_role('gm') [L176] |
| sop.py | /v1/sop/query | POST | none |  |
| staff.py | /v1/staff/me/push-token | PATCH | none |  |
| staff.py | /v1/staff/me/effective-role | GET | none |  |
| staff.py | /v1/staff | GET | chief_engineer, engineer, front_desk, gm, housekeeping_supervisor | require_role(*STAFF_DIRECTORY_ROLES) [L282]; inline: current_user.role in GM_ONLY_ROLES [L334]; inline: current_user.role not in GM_ONLY_ROLES [L295] |
| staff.py | /v1/staff/departments | GET | chief_engineer, engineer, front_desk, gm, housekeeping_supervisor | require_role(*STAFF_DIRECTORY_ROLES) [L348] |
| staff.py | /v1/staff/add-direct | POST | gm | require_role('gm') [L362] |
| staff.py | /v1/staff/custom-roles | GET | gm | require_role('gm') [L497] |
| staff.py | /v1/staff/custom-roles | POST | gm | require_role('gm') [L515] |
| staff.py | /v1/staff/custom-roles/{role_id} | PATCH | gm | require_role('gm') [L545] |
| staff.py | /v1/staff/custom-roles/{role_id} | DELETE | gm | require_role('gm') [L609] |
| staff.py | /v1/staff/{user_id} | GET | gm | require_role('gm') [L650] |
| staff.py | /v1/staff/{user_id}/profile | PATCH | gm | require_role('gm') [L682] |
| staff.py | /v1/staff/{user_id}/reactivate | POST | gm | require_role('gm') [L711] |
| staff.py | /v1/staff/{staff_id} | PATCH | gm | require_role('gm') [L722] |
| staff.py | /v1/staff/{staff_id} | DELETE | gm | require_role('gm') [L786] |
| staff_invitations.py | /v1/staff/invite | POST | gm | require_role('gm') [L193] |
| staff_invitations.py | /v1/staff/onboarding-invite | POST | none |  |
| staff_invitations.py | /v1/staff/invitations | GET | gm | require_role('gm') [L229] |
| staff_invitations.py | /v1/staff/invitations/accept | POST | none |  |
| staff_invitations.py | /v1/staff/invitations/{invitation_id}/resend | POST | gm | require_role('gm') [L347] |
| staff_invitations.py | /v1/staff/invitations/{invitation_id} | DELETE | gm | require_role('gm') [L394] |
| staff_invitations.py | /v1/staff/invitations/{invitation_id}/reissue | POST | gm | require_role('gm') [L418] |
| staff_schedules.py | /v1/staff/{user_id}/role-schedules | GET | gm | require_role('gm') [L36] |
| staff_schedules.py | /v1/staff/{user_id}/role-schedules | POST | gm | require_role('gm') [L55] |
| staff_schedules.py | /v1/staff/{user_id}/role-schedules/{schedule_id} | DELETE | gm | require_role('gm') [L108] |
| tasks.py | /v1/tasks | POST | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk', 'engineer', 'housekeeper', 'chief_engineer') [L190] |
| tasks.py | /v1/tasks/schedules | POST | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk', 'engineer', 'housekeeper', 'chief_engineer') [L231] |
| tasks.py | /v1/tasks/schedules/{schedule_id} | PATCH | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk', 'engineer', 'housekeeper', 'chief_engineer') [L278] |
| tasks.py | /v1/tasks | GET | none | inline: current_user.role == 'housekeeper' [L332] |
| tasks.py | /v1/tasks/workspace | GET | none |  |
| tasks.py | /v1/tasks/{task_id} | GET | none |  |
| tasks.py | /v1/tasks/{task_id}/claim | POST | housekeeper | require_role('housekeeper') [L416] |
| tasks.py | /v1/tasks/{task_id} | PATCH | role-restricted (inline, see source) | gate: if 'assigned_to' in update_data and current_user.role not in TASK_ASSIGNMENT_ROLES: raise HTTPException(...) [L473]; gate: if 'priority' in update_data and current_user.role not in MANAGER_ROLES: raise HTTPException(...) [L475]; gate: if 'status' in update_data and current_user.role not in MANAGER_ROLES: raise HTTPException(...) [L477]; gate: if editable_fields.intersection(update_data) and current_user.role not in MANAGER_ROLES: raise HTTPException(...) [L480]; inline: current_user.role not in TASK_ASSIGNMENT_ROLES [L473]; inline: current_user.role not in MANAGER_ROLES [L475]; inline: current_user.role not in MANAGER_ROLES [L477]; inline: current_user.role not in MANAGER_ROLES [L480] |
| tasks.py | /v1/tasks/{task_id} | DELETE | none |  |
| tasks.py | /v1/tasks/{task_id}/comments | POST | none |  |
| tasks.py | /v1/tasks/batch | POST | none |  |
| vendors.py | /v1/engineering/vendors | GET | none |  |
| vendors.py | /v1/engineering/vendors | POST | chief_engineer, gm | require_role(*MANAGE_VENDOR_ROLES) [L95] |
| vendors.py | /v1/engineering/vendors/{vendor_id} | GET | none |  |
| vendors.py | /v1/engineering/vendors/{vendor_id} | PATCH | chief_engineer, gm | require_role(*MANAGE_VENDOR_ROLES) [L114] |
| vendors.py | /v1/engineering/vendors/work-orders/{work_order_id}/engagements | GET | none |  |
| vendors.py | /v1/engineering/vendors/work-orders/{work_order_id}/engagements | POST | chief_engineer, engineer, gm | require_role(*ENGAGEMENT_ROLES) [L136] |
| vendors.py | /v1/engineering/vendors/engagements/{engagement_id} | PATCH | chief_engineer, engineer, gm | require_role(*ENGAGEMENT_ROLES) [L155] |
| webhooks.py | /v1/webhooks/opera | POST | UNVERIFIED (no auth dependency detected) |  |
| webhooks.py | /v1/webhooks/stripe | POST | UNVERIFIED (no auth dependency detected) |  |
| webhooks.py | /v1/webhooks/twilio-sms | POST | UNVERIFIED (no auth dependency detected) |  |
| webhooks.py | /v1/webhooks/twilio-status | POST | UNVERIFIED (no auth dependency detected) |  |
| work_orders.py | /v1/work-orders | POST | none |  |
| work_orders.py | /v1/work-orders | GET | none | inline: current_user.role == 'engineer' [L457] |
| work_orders.py | /v1/work-orders/stats | GET | none | inline: current_user.role == 'engineer' [L568]; inline: current_user.role == 'gm' [L659] |
| work_orders.py | /v1/work-orders/repair-codes | GET | none |  |
| work_orders.py | /v1/work-orders/repeat-suggestion | GET | none |  |
| work_orders.py | /v1/work-orders/{wo_id} | GET | none |  |
| work_orders.py | /v1/work-orders/{wo_id}/claim | POST | engineer, gm | require_role('engineer', 'gm') [L821] |
| work_orders.py | /v1/work-orders/{wo_id}/acknowledge | POST | engineer, gm | require_role('engineer', 'gm') [L876] |
| work_orders.py | /v1/work-orders/{wo_id}/arrive | POST | engineer, gm | require_role('engineer', 'gm') [L883] |
| work_orders.py | /v1/work-orders/{wo_id}/labor/start | POST | engineer, gm | require_role('engineer', 'gm') [L890] |
| work_orders.py | /v1/work-orders/{wo_id}/labor/pause | POST | engineer, gm | require_role('engineer', 'gm') [L905] |
| work_orders.py | /v1/work-orders/{wo_id}/events | GET | none |  |
| work_orders.py | /v1/work-orders/{wo_id}/labor | GET | none |  |
| work_orders.py | /v1/work-orders/{wo_id}/diagnosis | PATCH | engineer, gm | require_role('engineer', 'gm') [L929]; inline: current_user.role not in GM_ONLY_ROLES [L941] |
| work_orders.py | /v1/work-orders/{wo_id}/relationships | POST | engineer, gm | require_role('engineer', 'gm') [L968] |
| work_orders.py | /v1/work-orders/{wo_id}/complete | POST | engineer, gm | require_role('engineer', 'gm') [L986] |
| work_orders.py | /v1/work-orders/{wo_id}/transition | POST | engineer, gm | require_role('engineer', 'gm') [L1183] |
| work_orders.py | /v1/work-orders/{wo_id} | PATCH | engineer, gm | require_role('engineer', 'gm') [L1225] |
| work_orders.py | /v1/work-orders/{wo_id} | DELETE | gm | require_role('gm') [L1273] |
| work_orders.py | /v1/work-orders/bulk-archive | POST | engineer, gm | require_role('engineer', 'gm') [L1300] |
| work_orders.py | /v1/work-orders/bulk-archive-by-age | POST | engineer, gm | require_role('engineer', 'gm') [L1312] |
| work_orders.py | /v1/work-orders/bulk-unarchive | POST | engineer, gm | require_role('engineer', 'gm') [L1386] |
| work_orders.py | /v1/work-orders/{wo_id}/photos | POST | engineer, gm | require_role('engineer', 'gm') [L1434] |
| work_orders.py | /v1/work-orders/{wo_id}/comments | POST | none |  |
| work_orders.py | /v1/work-orders/{wo_id}/checklist | GET | none |  |
| work_orders.py | /v1/work-orders/{wo_id}/checklist | POST | chief_engineer, engineer, gm | require_role('engineer', 'chief_engineer', 'gm') [L1556] |
| work_orders.py | /v1/work-orders/{wo_id}/checklist/{item_id} | PATCH | chief_engineer, engineer, gm | require_role('engineer', 'chief_engineer', 'gm') [L1592] |
| work_orders.py | /v1/work-orders/{wo_id}/parts | GET | none |  |
| work_orders.py | /v1/work-orders/{wo_id}/duplicate-signal | GET | none |  |
| work_orders.py | /v1/work-orders/{wo_id}/merge | POST | chief_engineer, gm | require_role('chief_engineer', 'gm') [L1763] |
| work_orders.py | /v1/work-orders/{wo_id}/snooze | POST | chief_engineer, engineer, gm | require_role('engineer', 'chief_engineer', 'gm') [L1837] |

**40 routers, 473 routes.**
