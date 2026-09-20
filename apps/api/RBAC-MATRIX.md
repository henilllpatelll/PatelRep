# RBAC Matrix

**Generated file -- do not hand-edit.** Regenerate with:

```
python apps/api/scripts/generate_rbac_matrix.py
```

Every route in `apps/api/routers/` (API prefix `/v1`), its required role(s), and its source location -- introspected via AST from `require_role(...)` call sites and `core/roles.py` constants, matching Phase 19's `RBAC-AUDIT.md` route-level-gate/object-level-check classification. `none` = any authenticated staff member (no role restriction). `role-restricted (inline, see source)` = no `require_role(...)` dependency, but the route body has an inline `if <cond involving .role>: raise HTTPException(...)` gate that denies access to non-matching roles (see the `Source` column for the resolved condition) -- distinct from an inline `.role` comparison that only filters/scopes a query or response without denying access, which remains `none`. `N/A (not role-based)` = gated by a separate, deliberate auth mechanism (cron secret, webhook signature) instead of a role. `UNVERIFIED (no auth dependency detected)` = no `require_role(...)`, `verify_cron(...)`, or `get_current_user*` dependency was found at all -- flag for review, this may be a route with no authentication. A pytest drift guard (`apps/api/tests/smoke/test_rbac_matrix_contract.py`) fails CI if this file ever goes stale relative to the code it describes.

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
| assets.py | /v1/assets | POST | engineer, gm | require_role('gm', 'engineer') [L50] |
| assets.py | /v1/assets/failure-predictions | GET | none |  |
| assets.py | /v1/assets/failure-predictions/history | GET | none |  |
| assets.py | /v1/assets/failure-predictions/{prediction_id}/acknowledge | POST | engineer, gm | require_role('gm', 'engineer') [L114] |
| assets.py | /v1/assets/failure-predictions/batch-acknowledge | POST | engineer, gm | require_role('gm', 'engineer') [L137] |
| assets.py | /v1/assets/failure-predictions/{prediction_id}/create-work-order | POST | engineer, gm | require_role('gm', 'engineer') [L167] |
| assets.py | /v1/assets/recurring-issues | GET | none |  |
| assets.py | /v1/assets/pm-schedules | GET | none |  |
| assets.py | /v1/assets/pm-schedules | POST | chief_engineer, engineer, gm | require_role('gm', 'engineer', 'chief_engineer') [L369] |
| assets.py | /v1/assets/pm-schedules/{schedule_id}/complete | POST | chief_engineer, engineer, gm | require_role('engineer', 'gm', 'chief_engineer') [L386] |
| assets.py | /v1/assets/pm-schedules/{schedule_id} | PATCH | engineer, gm | require_role('engineer', 'gm') [L422] |
| assets.py | /v1/assets/pm-schedules/{schedule_id} | DELETE | engineer, gm | require_role('engineer', 'gm') [L449] |
| assets.py | /v1/assets/categories | GET | none |  |
| assets.py | /v1/assets/categories | POST | engineer, gm | require_role('gm', 'engineer') [L483] |
| assets.py | /v1/assets/{asset_id} | GET | none |  |
| assets.py | /v1/assets/{asset_id} | PATCH | engineer, gm | require_role('gm', 'engineer') [L522] |
| assets.py | /v1/assets/{asset_id}/run-prediction | POST | engineer, gm | require_role('gm', 'engineer') [L543] |
| assets.py | /v1/assets/pm-schedules/{schedule_id}/completions/{completion_id} | GET | none |  |
| auth.py | /v1/auth/me | GET | none |  |
| auth.py | /v1/auth/hotel-context | POST | none |  |
| billing.py | /v1/billing/subscription | GET | gm | require_role('gm') [L17] |
| billing.py | /v1/billing/credits | GET | gm | require_role('gm') [L29] |
| billing.py | /v1/billing/portal | POST | gm | require_role('gm') [L111] |
| billing.py | /v1/billing/checkout | POST | gm | require_role('gm') [L131] |
| billing.py | /v1/billing/invoices | GET | gm | require_role('gm') [L163] |
| clean_sessions.py | /v1/clean-sessions | POST | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L114] |
| clean_sessions.py | /v1/clean-sessions | GET | none |  |
| clean_sessions.py | /v1/clean-sessions/active | GET | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L273] |
| clean_sessions.py | /v1/clean-sessions/summary | GET | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L296] |
| clean_sessions.py | /v1/clean-sessions/hotel-avg-clean-time | GET | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*_AVG_CLEAN_TIME_ROLES) [L347] |
| clean_sessions.py | /v1/clean-sessions/{session_id} | GET | gm, housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES, 'gm') [L410] |
| clean_sessions.py | /v1/clean-sessions/{session_id} | PATCH | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L437] |
| clean_sessions.py | /v1/clean-sessions/{session_id}/complete | POST | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L476] |
| clean_sessions.py | /v1/clean-sessions/{session_id}/blocker | POST | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L567] |
| clean_sessions.py | /v1/clean-sessions/{session_id}/photos | POST | housekeeper, housekeeping_supervisor | require_role(*SESSION_ROLES) [L625] |
| cleaning_checklists.py | /v1/housekeeping/checklists | GET | none |  |
| cleaning_checklists.py | /v1/housekeeping/checklists/{clean_type} | PUT | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L146] |
| cleaning_checklists.py | /v1/housekeeping/checklists/{clean_type}/reset | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L200] |
| evidence.py | /v1/evidence/applicability | GET | none |  |
| evidence.py | /v1/evidence/applicability | PUT | gm | require_role('gm') [L234] |
| evidence.py | /v1/evidence/documents | GET | none |  |
| evidence.py | /v1/evidence/documents/{document_id} | GET | none |  |
| evidence.py | /v1/evidence/documents/{document_id}/history | GET | none |  |
| evidence.py | /v1/evidence/documents | POST | gm | require_role('gm') [L281] |
| evidence.py | /v1/evidence/documents/{document_id}/approve | POST | gm | require_role('gm') [L305] |
| evidence.py | /v1/evidence/documents/{document_id}/supersede | POST | gm | require_role('gm') [L330] |
| evidence.py | /v1/evidence/documents/{document_id}/assignments | POST | chief_engineer, gm, housekeeping_supervisor | require_role(*COMPETENCY_MANAGER_ROLES) [L358] |
| evidence.py | /v1/evidence/my-acknowledgements | GET | none |  |
| evidence.py | /v1/evidence/documents/{document_id}/assignments | GET | chief_engineer, gm, housekeeping_supervisor | require_role(*COMPETENCY_MANAGER_ROLES) [L403] |
| evidence.py | /v1/evidence/acknowledgements/{assignment_id}/acknowledge | POST | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*EVIDENCE_CAPTURE_ROLES) [L417] |
| evidence.py | /v1/evidence/acknowledgements/{assignment_id}/competency | POST | chief_engineer, gm, housekeeping_supervisor | require_role(*COMPETENCY_MANAGER_ROLES) [L440] |
| evidence.py | /v1/evidence/records | POST | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*EVIDENCE_CAPTURE_ROLES) [L478] |
| evidence.py | /v1/evidence/records | GET | none |  |
| evidence.py | /v1/evidence/records/{record_id} | GET | none |  |
| evidence.py | /v1/evidence/records/{record_id}/file-url | GET | none |  |
| evidence.py | /v1/evidence/records/{record_id}/file | POST | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*EVIDENCE_CAPTURE_ROLES) [L517] |
| evidence.py | /v1/evidence/exceptions | GET | none |  |
| evidence.py | /v1/evidence/exceptions/{kind}/{reference_id}/actions | POST | gm | require_role('gm') [L592] |
| evidence.py | /v1/evidence/export | GET | gm | require_role('gm') [L647] |
| feedback.py | /v1/feedback | POST | none |  |
| feedback.py | /v1/feedback | GET | gm | require_role('gm') [L131] |
| guest_requests.py | /v1/guest-requests | POST | none |  |
| guest_requests.py | /v1/guest-requests/{request_id}/transition | POST | none |  |
| guest_requests.py | /v1/guest-requests/{request_id}/create-work-order | POST | front_desk, gm, housekeeping_supervisor | require_role(*WORK_ORDER_BRIDGE_ROLES) [L256] |
| guest_requests.py | /v1/guest-requests/{request_id}/messages | POST | role-restricted (inline, see source) | gate: if current_user.role not in MESSAGE_ROLES: raise HTTPException(...) [L350]; inline: current_user.role not in MESSAGE_ROLES [L350] |
| guest_requests.py | /v1/guest-requests/{request_id}/messages | GET | role-restricted (inline, see source) | gate: if current_user.role not in MESSAGE_ROLES: raise HTTPException(...) [L437]; inline: current_user.role not in MESSAGE_ROLES [L437] |
| guest_requests.py | /v1/guest-requests/{request_id}/satisfaction | POST | role-restricted (inline, see source) | gate: if current_user.role not in MESSAGE_ROLES: raise HTTPException(...) [L471]; inline: current_user.role not in MESSAGE_ROLES [L471] |
| guest_requests.py | /v1/guest-requests/{request_id}/recovery-actions | POST | role-restricted (inline, see source) | gate: if requires_approval and current_user.role not in {'gm', 'front_desk'}: raise HTTPException(...) [L512]; inline: current_user.role not in {'gm', 'front_desk'} [L512]; inline: current_user.role == 'gm' [L519] |
| guest_requests.py | /v1/guest-requests/metrics/summary | GET | none |  |
| guest_requests.py | /v1/guest-requests/accessibility/features | GET | none |  |
| guest_requests.py | /v1/guest-requests/sla-policies | GET | none |  |
| guest_requests.py | /v1/guest-requests/sla-policies | POST | role-restricted (inline, see source) | gate: if current_user.role not in SLA_POLICY_ROLES: raise HTTPException(...) [L581]; inline: current_user.role not in SLA_POLICY_ROLES [L581] |
| guest_requests.py | /v1/guest-requests/sla-policies/{policy_id} | DELETE | role-restricted (inline, see source) | gate: if current_user.role not in SLA_POLICY_ROLES: raise HTTPException(...) [L613]; inline: current_user.role not in SLA_POLICY_ROLES [L613] |
| guest_requests.py | /v1/guest-requests/accessibility/features | PUT | role-restricted (inline, see source) | gate: if current_user.role not in {'gm', 'housekeeping_supervisor', 'engineer'}: raise HTTPException(...) [L630]; inline: current_user.role not in {'gm', 'housekeeping_supervisor', 'engineer'} [L630] |
| guest_requests.py | /v1/guest-requests | GET | none |  |
| guest_requests.py | /v1/guest-requests/{request_id} | PATCH | none |  |
| guest_requests.py | /v1/guest-requests/{request_id} | DELETE | role-restricted (inline, see source) | gate: if current_user.role not in SLA_POLICY_ROLES: raise HTTPException(...) [L730]; inline: current_user.role not in SLA_POLICY_ROLES [L730] |
| hotels.py | /v1/hotels | POST | none |  |
| hotels.py | /v1/hotels/{hotel_id} | GET | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*ALL_STAFF_ROLES) [L117] |
| hotels.py | /v1/hotels/{hotel_id} | PATCH | gm | require_role('gm') [L134] |
| hotels.py | /v1/hotels/{hotel_id}/layout | GET | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L159] |
| hotels.py | /v1/hotels/{hotel_id}/layout | PUT | gm | require_role('gm') [L173] |
| hotels.py | /v1/hotels/{hotel_id}/stats | GET | chief_engineer, engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role(*ALL_STAFF_ROLES) [L193] |
| hotels.py | /v1/hotels/{hotel_id}/departments | GET | none |  |
| housekeeping.py | /v1/housekeeping/board | GET | none |  |
| housekeeping.py | /v1/housekeeping/my-rooms | GET | housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor') [L598] |
| housekeeping.py | /v1/housekeeping/assignments | GET | none |  |
| housekeeping.py | /v1/housekeeping/assignments | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L828] |
| housekeeping.py | /v1/housekeeping/assignments/{assignment_id} | DELETE | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L950] |
| housekeeping.py | /v1/housekeeping/room-assignment/{room_id} | DELETE | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1005] |
| housekeeping.py | /v1/housekeeping/ai-suggest-assignments | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1124] |
| housekeeping.py | /v1/housekeeping/predictions | GET | none |  |
| housekeeping.py | /v1/housekeeping/room-readiness/{room_id}/reassign | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1469] |
| housekeeping.py | /v1/housekeeping/room-readiness/{room_id}/escalate | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1522] |
| housekeeping.py | /v1/housekeeping/room-readiness/{room_id}/acknowledge | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1552] |
| housekeeping.py | /v1/housekeeping/room-readiness/batch-reassign | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1572] |
| housekeeping.py | /v1/housekeeping/room-readiness/batch-acknowledge | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1592] |
| housekeeping.py | /v1/housekeeping/ready-for-inspection | GET | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1617] |
| housekeeping.py | /v1/housekeeping/ready-to-strip | GET | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1697] |
| housekeeping.py | /v1/housekeeping/inspections | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1772] |
| housekeeping.py | /v1/housekeeping/inspections/{inspection_id}/reclean | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1845] |
| housekeeping.py | /v1/housekeeping/inspections | GET | none |  |
| housekeeping.py | /v1/housekeeping/inspections/templates | GET | none |  |
| housekeeping.py | /v1/housekeeping/inspections/templates | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2045] |
| housekeeping.py | /v1/housekeeping/inspections/templates/{template_id} | PATCH | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2087] |
| housekeeping.py | /v1/housekeeping/inspections/{inspection_id}/photos | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2155] |
| housekeeping.py | /v1/housekeeping/end-shift-summary | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2212] |
| housekeeping.py | /v1/housekeeping/inspections/templates/{template_id} | DELETE | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2285] |
| housekeeping.py | /v1/housekeeping/import/hk-details | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2308] |
| housekeeping.py | /v1/housekeeping/import/task-sheet | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L2424] |
| integrations.py | /v1/integrations/opera/connect | POST | gm | require_role('gm') [L29] |
| integrations.py | /v1/integrations/opera/status | GET | none |  |
| integrations.py | /v1/integrations/opera/sync | POST | gm | require_role('gm') [L111] |
| integrations.py | /v1/integrations/opera/conflicts | GET | chief_engineer, gm | require_role('gm', 'chief_engineer') [L128] |
| integrations.py | /v1/integrations/opera/conflicts/{conflict_id}/resolve | POST | chief_engineer, gm | require_role('gm', 'chief_engineer') [L147] |
| integrations.py | /v1/integrations/opera/sftp/connect | POST | gm | require_role('gm') [L192] |
| integrations.py | /v1/integrations/opera/sftp/sync | POST | gm | require_role('gm') [L242] |
| integrations.py | /v1/integrations/opera/sftp/test | POST | gm | require_role('gm') [L260] |
| integrations.py | /v1/integrations/opera/sftp/files | GET | chief_engineer, gm | require_role('gm', 'chief_engineer') [L278] |
| integrations.py | /v1/integrations/opera/test | POST | gm | require_role('gm') [L293] |
| integrations.py | /v1/integrations/opera/disconnect | DELETE | gm | require_role('gm') [L310] |
| internal.py | /v1/internal/safety/training-assignments | POST | N/A (not role-based) | verify_cron(...) [L99] |
| internal.py | /v1/internal/safety/drill-follow-up | POST | N/A (not role-based) | verify_cron(...) [L130] |
| internal.py | /v1/internal/evidence/reminders | POST | N/A (not role-based) | verify_cron(...) [L144] |
| internal.py | /v1/internal/predictions/run | POST | N/A (not role-based) | verify_cron(...) [L158] |
| internal.py | /v1/internal/pm/check-due | POST | N/A (not role-based) | verify_cron(...) [L190] |
| internal.py | /v1/internal/ai/failure-predictions | POST | N/A (not role-based) | verify_cron(...) [L247] |
| internal.py | /v1/internal/billing/monthly-trueup | POST | N/A (not role-based) | verify_cron(...) [L295] |
| internal.py | /v1/internal/logbook/shift-summary | POST | N/A (not role-based) | verify_cron(...) [L304] |
| internal.py | /v1/internal/reports/daily-summary-email | POST | N/A (not role-based) | verify_cron(...) [L348] |
| internal.py | /v1/internal/opera/sync-reservations | POST | N/A (not role-based) | verify_cron(...) [L457] |
| internal.py | /v1/internal/opera/sftp-sync-reports | POST | N/A (not role-based) | verify_cron(...) [L482] |
| internal.py | /v1/internal/escalations/check | POST | N/A (not role-based) | verify_cron(...) [L561] |
| internal.py | /v1/internal/predictions/escalations/check | POST | N/A (not role-based) | verify_cron(...) [L744] |
| internal.py | /v1/internal/lost-found/retention-check | POST | N/A (not role-based) | verify_cron(...) [L806] |
| internal.py | /v1/internal/logbook/cleanup-expired | POST | N/A (not role-based) | verify_cron(...) [L829] |
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
| logbook.py | /v1/logbook/entries/{entry_id} | PATCH | role-restricted (inline, see source) | gate: if not (is_author or is_privileged): raise HTTPException(...) [L166]; inline: current_user.role in ('gm', 'housekeeping_supervisor', 'engineer') [L165] |
| logbook.py | /v1/logbook/entries/{entry_id} | DELETE | role-restricted (inline, see source) | gate: if not (is_author or is_privileged): raise HTTPException(...) [L218]; inline: current_user.role in ('gm', 'housekeeping_supervisor', 'engineer') [L217] |
| logbook.py | /v1/logbook/shift-summary | GET | none |  |
| logbook.py | /v1/logbook/shift-summary/{shift_id} | GET | none |  |
| logbook.py | /v1/logbook/shift-summary/{summary_id}/acknowledge | POST | none |  |
| logbook.py | /v1/logbook/shift-summary/generate | POST | engineer, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'engineer') [L324] |
| lost_found.py | /v1/lost-found/upload-photo | POST | none |  |
| lost_found.py | /v1/lost-found | POST | none |  |
| lost_found.py | /v1/lost-found | GET | none |  |
| lost_found.py | /v1/lost-found/{item_id} | GET | none |  |
| lost_found.py | /v1/lost-found/{item_id}/custody-events | GET | none |  |
| lost_found.py | /v1/lost-found/{item_id}/custody-events | POST | role-restricted (inline, see source) | gate: if current_user.role not in {'front_desk', 'housekeeping_supervisor', 'gm'}: raise HTTPException(...) [L170]; inline: current_user.role not in {'front_desk', 'housekeeping_supervisor', 'gm'} [L170] |
| lost_found.py | /v1/lost-found/{item_id} | PATCH | role-restricted (inline, see source) | gate: if current_user.role not in {'front_desk', 'housekeeping_supervisor', 'gm'}: raise HTTPException(...) [L218]; inline: current_user.role not in {'front_desk', 'housekeeping_supervisor', 'gm'} [L218] |
| lost_found.py | /v1/lost-found/{item_id} | DELETE | role-restricted (inline, see source) | gate: if current_user.role not in {'front_desk', 'housekeeping_supervisor', 'gm'}: raise HTTPException(...) [L256]; inline: current_user.role not in {'front_desk', 'housekeeping_supervisor', 'gm'} [L256] |
| management_roi.py | /v1/reports/roi/repeat-failures | GET | gm | require_role('gm') [L199] |
| management_roi.py | /v1/reports/roi/downtime-revenue | GET | gm | require_role('gm') [L220] |
| management_roi.py | /v1/reports/roi/housekeeping-efficiency | GET | gm | require_role('gm') [L253] |
| management_roi.py | /v1/reports/roi/inspection-trends | GET | gm | require_role('gm') [L290] |
| management_roi.py | /v1/reports/roi/pm-compliance | GET | gm | require_role('gm') [L316] |
| management_roi.py | /v1/reports/roi/training-readiness | GET | gm | require_role('gm') [L340] |
| management_roi.py | /v1/reports/roi/forecast-7day | GET | gm | require_role('gm') [L353] |
| notifications.py | /v1/notifications | GET | none |  |
| notifications.py | /v1/notifications/{notification_id}/read | PATCH | none |  |
| notifications.py | /v1/notifications/mark-all-read | POST | none |  |
| notifications.py | /v1/notifications/broadcast | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L53] |
| notifications.py | /v1/notifications/direct | POST | engineer, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'engineer') [L98] |
| onboarding.py | /v1/onboarding/status | GET | gm | require_role('gm') [L122] |
| onboarding.py | /v1/onboarding/rooms/import-csv | POST | gm | require_role('gm') [L186] |
| onboarding.py | /v1/onboarding/ai-assistant | POST | none |  |
| programs.py | /v1/programs/overview | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L121] |
| programs.py | /v1/programs/templates/initialize | POST | gm | require_role('gm') [L145] |
| programs.py | /v1/programs/templates/{template_id} | PUT | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L188] |
| programs.py | /v1/programs/templates | POST | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L220] |
| programs.py | /v1/programs/pm-schedules/{schedule_id}/deferrals | POST | chief_engineer, gm | require_role('gm', 'chief_engineer') [L249] |
| programs.py | /v1/programs/public-areas | POST | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L283] |
| programs.py | /v1/programs/deep-clean-schedules | POST | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L289] |
| programs.py | /v1/programs/deep-clean-schedules/{schedule_id}/complete | POST | gm, housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor', 'gm') [L301] |
| programs.py | /v1/programs/supply-pars | POST | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L321] |
| programs.py | /v1/programs/stayover-rule | PUT | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L328] |
| programs.py | /v1/programs/dnd-welfare-policy | PUT | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L335] |
| programs.py | /v1/programs/inspection-sampling-rules | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L342] |
| programs.py | /v1/programs/inspection-sample | GET | chief_engineer, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'chief_engineer') [L349] |
| programs.py | /v1/programs/inspection-quality | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L433] |
| programs.py | /v1/programs/deep-clean-schedules | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L447] |
| programs.py | /v1/programs/public-areas | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L459] |
| reports.py | /v1/reports/guest-recovery | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L16] |
| reports.py | /v1/reports/daily-summary | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L41] |
| reports.py | /v1/reports/staff-performance | GET | chief_engineer, engineer, gm, housekeeping_supervisor | require_role(*PROGRAM_MANAGER_ROLES) [L88] |
| reports.py | /v1/reports/maintenance | GET | chief_engineer, engineer, gm | require_role('gm', 'engineer', 'chief_engineer') [L241] |
| reports.py | /v1/reports/ai-usage | GET | gm | require_role('gm') [L357] |
| rooms.py | /v1/rooms | GET | none |  |
| rooms.py | /v1/rooms/{room_id} | GET | none |  |
| rooms.py | /v1/rooms/{room_id}/status | PATCH | none | inline: current_user.role == 'gm' [L198] |
| rooms.py | /v1/rooms/{room_id}/checkout | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L270] |
| rooms.py | /v1/rooms/{room_id}/checkout | DELETE | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L379] |
| rooms.py | /v1/rooms/{room_id}/stayover | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L455] |
| rooms.py | /v1/rooms/{room_id}/checkin | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L548] |
| rooms.py | /v1/rooms/{room_id}/welfare-check | POST | front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk') [L602] |
| rooms.py | /v1/rooms/{room_id}/re-clean | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L691] |
| rooms.py | /v1/rooms/{room_id}/strip | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L816] |
| rooms.py | /v1/rooms/{room_id}/dnd | PATCH | gm, housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor', 'gm') [L863] |
| rooms.py | /v1/rooms/{room_id}/decline-service | PATCH | gm, housekeeper, housekeeping_supervisor | require_role('housekeeper', 'housekeeping_supervisor', 'gm') [L895] |
| rooms.py | /v1/rooms/{room_id}/checkout-time | PATCH | engineer, front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'engineer', 'front_desk') [L926] |
| rooms.py | /v1/rooms/{room_id}/status/undo | POST | none |  |
| rooms.py | /v1/rooms/{room_id}/history | GET | none |  |
| rooms.py | /v1/rooms/{room_id}/notes | POST | none |  |
| rooms.py | /v1/rooms/{room_id} | DELETE | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1129] |
| rooms.py | /v1/rooms/import | POST | gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor') [L1155] |
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
| shifts.py | /v1/shifts/current | GET | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L38] |
| shifts.py | /v1/shifts/start | POST | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L50] |
| shifts.py | /v1/shifts/break | POST | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L86] |
| shifts.py | /v1/shifts/end | POST | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L131] |
| shifts.py | /v1/shifts/history | GET | housekeeper, housekeeping_supervisor | require_role(*SHIFT_ROLES) [L167] |
| sop.py | /v1/sop/documents | GET | none |  |
| sop.py | /v1/sop/documents | POST | engineer, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'engineer') [L81] |
| sop.py | /v1/sop/documents/{document_id} | GET | none |  |
| sop.py | /v1/sop/documents/{document_id} | DELETE | gm | require_role('gm') [L176] |
| sop.py | /v1/sop/query | POST | none |  |
| staff.py | /v1/staff/me/push-token | PATCH | none |  |
| staff.py | /v1/staff/me/effective-role | GET | none |  |
| staff.py | /v1/staff | GET | chief_engineer, engineer, front_desk, gm, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'engineer', 'chief_engineer', 'front_desk') [L85]; inline: current_user.role == 'gm' [L146] |
| staff.py | /v1/staff/invitations | GET | gm | require_role('gm') [L155] |
| staff.py | /v1/staff/invite | POST | gm | require_role('gm') [L208] |
| staff.py | /v1/staff/onboarding-invite | POST | none |  |
| staff.py | /v1/staff/add-direct | POST | gm | require_role('gm') [L251] |
| staff.py | /v1/staff/custom-roles | GET | gm | require_role('gm') [L325] |
| staff.py | /v1/staff/custom-roles | POST | gm | require_role('gm') [L340] |
| staff.py | /v1/staff/custom-roles/{role_id} | PATCH | gm | require_role('gm') [L359] |
| staff.py | /v1/staff/custom-roles/{role_id} | DELETE | gm | require_role('gm') [L376] |
| staff.py | /v1/staff/{user_id}/role-schedules | GET | gm | require_role('gm') [L390] |
| staff.py | /v1/staff/{user_id}/role-schedules | POST | gm | require_role('gm') [L407] |
| staff.py | /v1/staff/{user_id}/role-schedules/{schedule_id} | DELETE | gm | require_role('gm') [L440] |
| staff.py | /v1/staff/{staff_id} | PATCH | gm | require_role('gm') [L456] |
| staff.py | /v1/staff/{staff_id} | DELETE | gm | require_role('gm') [L489] |
| tasks.py | /v1/tasks | POST | engineer, front_desk, gm, housekeeper, housekeeping_supervisor | require_role('gm', 'housekeeping_supervisor', 'front_desk', 'engineer', 'housekeeper') [L71] |
| tasks.py | /v1/tasks | GET | none | inline: current_user.role == 'housekeeper' [L142] |
| tasks.py | /v1/tasks/{task_id} | GET | none |  |
| tasks.py | /v1/tasks/{task_id} | PATCH | none |  |
| tasks.py | /v1/tasks/{task_id} | DELETE | none |  |
| tasks.py | /v1/tasks/{task_id}/comments | POST | none |  |
| tasks.py | /v1/tasks/batch | POST | none |  |
| webhooks.py | /v1/webhooks/opera | POST | UNVERIFIED (no auth dependency detected) |  |
| webhooks.py | /v1/webhooks/stripe | POST | UNVERIFIED (no auth dependency detected) |  |
| webhooks.py | /v1/webhooks/twilio-sms | POST | UNVERIFIED (no auth dependency detected) |  |
| webhooks.py | /v1/webhooks/twilio-status | POST | UNVERIFIED (no auth dependency detected) |  |
| work_orders.py | /v1/work-orders | POST | none |  |
| work_orders.py | /v1/work-orders | GET | none | inline: current_user.role == 'engineer' [L224] |
| work_orders.py | /v1/work-orders/stats | GET | none | inline: current_user.role == 'engineer' [L319]; inline: current_user.role == 'gm' [L410] |
| work_orders.py | /v1/work-orders/{wo_id} | GET | none |  |
| work_orders.py | /v1/work-orders/{wo_id}/claim | POST | engineer, gm | require_role('engineer', 'gm') [L523] |
| work_orders.py | /v1/work-orders/{wo_id}/complete | POST | engineer, gm | require_role('engineer', 'gm') [L566] |
| work_orders.py | /v1/work-orders/{wo_id}/transition | POST | engineer, gm | require_role('engineer', 'gm') [L693] |
| work_orders.py | /v1/work-orders/{wo_id} | PATCH | engineer, gm | require_role('engineer', 'gm') [L733] |
| work_orders.py | /v1/work-orders/{wo_id} | DELETE | gm | require_role('gm') [L781] |
| work_orders.py | /v1/work-orders/bulk-archive | POST | engineer, gm | require_role('engineer', 'gm') [L808] |
| work_orders.py | /v1/work-orders/bulk-archive-by-age | POST | engineer, gm | require_role('engineer', 'gm') [L820] |
| work_orders.py | /v1/work-orders/bulk-unarchive | POST | engineer, gm | require_role('engineer', 'gm') [L894] |
| work_orders.py | /v1/work-orders/{wo_id}/photos | POST | engineer, gm | require_role('engineer', 'gm') [L942] |
| work_orders.py | /v1/work-orders/{wo_id}/comments | POST | none |  |

**31 routers, 317 routes.**
