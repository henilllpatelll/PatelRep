# Migration inventory

Generated from the repository SQL files. Signal labels are review cues, not SQL proof; the Docker-backed migration gate is the fresh-database execution proof.

| Filename | Identifier | Inferred purpose | Ordering | Static review signals |
| --- | --- | --- | --- | --- |
| 001_extensions.sql | 001 | extensions | deterministic identifier | additive/other |
| 002_tenants.sql | 002 | tenants | deterministic identifier | not null |
| 003_users_roles.sql | 003 | users roles | deterministic identifier | not null |
| 004_rooms.sql | 004 | rooms | deterministic identifier | not null |
| 005_scheduling.sql | 005 | scheduling | deterministic identifier | alter table, not null |
| 006_tasks.sql | 006 | tasks | deterministic identifier | not null |
| 007_work_orders.sql | 007 | work orders | deterministic identifier | not null |
| 008_assets_pm.sql | 008 | assets pm | deterministic identifier | alter table, not null |
| 009_inspections.sql | 009 | inspections | deterministic identifier | data change, not null |
| 010_sop_rag.sql | 010 | sop rag | deterministic identifier | not null |
| 011_guest_requests.sql | 011 | guest requests | deterministic identifier | not null |
| 012_logbook.sql | 012 | logbook | deterministic identifier | not null |
| 013_ai_systems.sql | 013 | ai systems | deterministic identifier | not null |
| 014_billing.sql | 014 | billing | deterministic identifier | not null |
| 015_indexes.sql | 015 | indexes | deterministic identifier | additive/other |
| 016_rls_policies.sql | 016 | rls policies | deterministic identifier | data change, alter table |
| 017_functions.sql | 017 | functions | deterministic identifier | data change, not null, trigger |
| 018_match_sop_chunks_fn.sql | 018 | match sop chunks fn | deterministic identifier | not null |
| 019_jwt_hook.sql | 019 | jwt hook | deterministic identifier | not null |
| 020_fix_credits_decimal.sql | 020 | fix credits decimal | deterministic identifier | DROP, data change, alter table |
| 0201_logbook_expires.sql | 0201 | logbook expires | Historical numeric workaround | alter table |
| 021_comment_indexes.sql | 021 | comment indexes | deterministic identifier | additive/other |
| 022_jwt_hook_null_role.sql | 022 | jwt hook null role | deterministic identifier | not null |
| 023_cascade_fk_delete.sql | 023 | cascade fk delete | deterministic identifier | DROP, alter table |
| 024_fix_room_status_history_trigger.sql | 024 | fix room status history trigger | deterministic identifier | DROP |
| 025_enable_realtime.sql | 025 | enable realtime | deterministic identifier | additive/other |
| 026_front_desk_modules.sql | 026 | front desk modules | deterministic identifier | alter table, not null |
| 027_staff_role_schedules.sql | 027 | staff role schedules | deterministic identifier | not null |
| 028_custom_roles.sql | 028 | custom roles | deterministic identifier | not null |
| 029_assign_custom_roles.sql | 029 | assign custom roles | deterministic identifier | alter table |
| 030_enable_realtime_work_orders.sql | 030 | enable realtime work orders | deterministic identifier | additive/other |
| 031_load_perf_indexes.sql | 031 | load perf indexes | deterministic identifier | additive/other |
| 032_work_orders_unclaimed_index.sql | 032 | work orders unclaimed index | deterministic identifier | additive/other |
| 033_realtime_room_status_and_lost_found_contact.sql | 033 | realtime room status and lost found contact | deterministic identifier | data change, alter table |
| 034_opera_oauth_states.sql | 034 | opera oauth states | deterministic identifier | alter table, not null |
| 035_enable_rls_missing_tables.sql | 035 | enable rls missing tables | deterministic identifier | alter table |
| 036_fix_function_search_path.sql | 036 | fix function search path | deterministic identifier | data change, not null |
| 037_fix_rls_initplan.sql | 037 | fix rls initplan | deterministic identifier | DROP, data change |
| 038_add_fk_indexes.sql | 038 | add fk indexes | deterministic identifier | additive/other |
| 039_drop_room_status_history_trigger.sql | 039 | drop room status history trigger | KNOWN HISTORICAL COLLISION | DROP |
| 039_drop_unused_indexes.sql | 039 | drop unused indexes | KNOWN HISTORICAL COLLISION | DROP |
| 040_dedup_room_status_history.sql | 040 | dedup room status history | deterministic identifier | data change |
| 041_escalation_level.sql | 041 | escalation level | deterministic identifier | DROP, alter table, not null |
| 042_guest_requests_priority.sql | 042 | guest requests priority | KNOWN HISTORICAL COLLISION | alter table, not null |
| 042_lost_found_photos_bucket.sql | 042 | lost found photos bucket | KNOWN HISTORICAL COLLISION | additive/other |
| 042_room_assignment_clean_type.sql | 042 | room assignment clean type | KNOWN HISTORICAL COLLISION | alter table, not null |
| 043_input_validation_and_pooling_indexes.sql | 043 | input validation and pooling indexes | deterministic identifier | not null |
| 044_fo_status.sql | 044 | fo status | deterministic identifier | alter table |
| 045_occupied_dirty_status.sql | 045 | occupied dirty status | deterministic identifier | DROP, alter table |
| 046_actual_checkout_at.sql | 046 | actual checkout at | deterministic identifier | alter table, not null |
| 047_room_status_clean_type.sql | 047 | room status clean type | deterministic identifier | alter table |
| 048_feedback_submissions.sql | 048 | feedback submissions | deterministic identifier | DROP, alter table, not null |
| 049_inspection_results_nullable_template_item.sql | 049 | inspection results nullable template item | deterministic identifier | DROP, alter table, not null |
| 050_work_order_photos_bucket.sql | 050 | work order photos bucket | deterministic identifier | additive/other |
| 051_work_order_guest_reported.sql | 051 | work order guest reported | deterministic identifier | alter table, not null |
| 052_strip_room.sql | 052 | strip room | deterministic identifier | alter table, not null |
| 053_fix_jwt_role_claim.sql | 053 | fix jwt role claim | deterministic identifier | not null |
| 054_cleaning_checklists.sql | 054 | cleaning checklists | deterministic identifier | alter table, not null |
| 055_room_clean_sessions.sql | 055 | room clean sessions | deterministic identifier | alter table, not null |
| 056_shift_sessions.sql | 056 | shift sessions | deterministic identifier | alter table, not null |
| 057_clean_photos_bucket.sql | 057 | clean photos bucket | deterministic identifier | additive/other |
| 058_clean_photos_private.sql | 058 | clean photos private | deterministic identifier | DROP, data change |
| 059_stay_reset_at.sql | 059 | stay reset at | deterministic identifier | alter table |
| 060_hotel_layout.sql | 060 | hotel layout | deterministic identifier | alter table |
| 061_late_checkout_requests.sql | 061 | late checkout requests | deterministic identifier | alter table, not null |
| 062_late_checkout_cancelled_status.sql | 062 | late checkout cancelled status | deterministic identifier | DROP, alter table |
| 063_latest_room_notes_rpc.sql | 063 | latest room notes rpc | deterministic identifier | not null |
| 064_merge_chief_engineer.sql | 064 | merge chief engineer | deterministic identifier | DROP, data change, alter table |
| 065_work_order_transition_audit.sql | 065 | work order transition audit | deterministic identifier | DROP, data change, alter table, not null, trigger |
| 066_inspection_photo_evidence.sql | 066 | inspection photo evidence | deterministic identifier | alter table, not null |
| 067_notification_delivery_history.sql | 067 | notification delivery history | deterministic identifier | alter table, not null |
| 068_cron_health.sql | 068 | cron health | deterministic identifier | not null |
| 069_evidence_foundation.sql | 069 | evidence foundation | deterministic identifier | alter table, not null |
| 070_texas_safety_compliance.sql | 070 | texas safety compliance | deterministic identifier | data change, alter table, not null, trigger |
| 071_operational_programs.sql | 071 | operational programs | deterministic identifier | data change, alter table, not null, trigger |
| 072_guest_recovery_and_roi.sql | 072 | guest recovery and roi | deterministic identifier | DROP, data change, alter table, not null, trigger |
| 073_pms_ai_governance.sql | 073 | pms ai governance | deterministic identifier | data change, alter table, not null, trigger |
| 074_evidence_applicability_contract.sql | 074 | evidence applicability contract | deterministic identifier | data change, alter table, trigger |
| 075_controlled_document_lifecycle.sql | 075 | controlled document lifecycle | deterministic identifier | data change, alter table, not null, trigger |
| 076_evidence_record_controls.sql | 076 | evidence record controls | deterministic identifier | data change, alter table, not null, trigger |
| 077_document_competency_retraining.sql | 077 | document competency retraining | deterministic identifier | data change, alter table, not null, trigger |
| 078_evidence_exception_engine.sql | 078 | evidence exception engine | deterministic identifier | DROP, data change, alter table, not null |
| 079_restrict_security_definer_rpcs.sql | 079 | restrict security definer rpcs | deterministic identifier | additive/other |
| 080_safety_workflow_hardening.sql | 080 | safety workflow hardening | deterministic identifier | alter table, not null |
| 081_pm_evidence_linkage.sql | 081 | pm evidence linkage | deterministic identifier | DROP, alter table, not null |
| 083_program_template_facilities.sql | 083 | program template facilities | deterministic identifier | DROP, alter table |
| 084_guest_phone_adr_and_retention.sql | 084 | guest phone adr and retention | deterministic identifier | DROP, data change, alter table, not null, trigger |
| 085_opera_pilot_flag.sql | 085 | opera pilot flag | deterministic identifier | DROP, alter table, not null |
| 086_logbook_entry_date_local.sql | 086 | logbook entry date local | deterministic identifier | data change |
| 087_lost_found_custody_cascade.sql | 087 | lost found custody cascade | deterministic identifier | DROP, data change, alter table, trigger |
| 088_ai_interactions_work_order_triage_type.sql | 088 | ai interactions work order triage type | deterministic identifier | DROP, alter table |
| 089_work_order_archive.sql | 089 | work order archive | deterministic identifier | alter table, not null |
| 090_stripe_webhook_events.sql | 090 | stripe webhook events | deterministic identifier | not null |
| 091_ai_interactions_widen_interaction_type.sql | 091 | ai interactions widen interaction type | deterministic identifier | DROP, alter table |
| 092_restore_chief_engineer_role.sql | 092 | restore chief engineer role | deterministic identifier | DROP, alter table |
| 093_guest_requests_delete_cascade.sql | 093 | guest requests delete cascade | deterministic identifier | DROP, data change, alter table, trigger |
| 094_tenant_is_test_flag.sql | 094 | tenant is test flag | deterministic identifier | DROP, alter table, not null |
| 095_room_readiness_acknowledgement.sql | 095 | room readiness acknowledgement | deterministic identifier | DROP, alter table, not null |
| 096_prediction_escalation_watermark.sql | 096 | prediction escalation watermark | deterministic identifier | DROP, alter table, not null |
| 097_web_redesign_sections.sql | 097 | web redesign sections | deterministic identifier | DROP, alter table, not null |
| 098_flip_web_redesign_sections_on.sql | 098 | flip web redesign sections on | deterministic identifier | data change, alter table |
| 099_ai_interactions_widen_briefing_types.sql | 099 | ai interactions widen briefing types | deterministic identifier | DROP, alter table |
| 100_ai_interactions_housekeeper_shift_recap.sql | 100 | ai interactions housekeeper shift recap | deterministic identifier | DROP, alter table |
| 101_pm_schedule_recurrence_basis.sql | 101 | pm schedule recurrence basis | deterministic identifier | alter table, not null |
| 102_engineering_parts_inventory.sql | 102 | engineering parts inventory | deterministic identifier | data change, alter table, not null, trigger |
| 103_guest_request_work_order_bridge.sql | 103 | guest request work order bridge | deterministic identifier | alter table, not null |
| 104_work_order_labor_cost_capture.sql | 104 | work order labor cost capture | deterministic identifier | alter table |
| 105_shift_summary_acknowledgment.sql | 105 | shift summary acknowledgment | deterministic identifier | alter table |
| 106_room_assignment_sequence.sql | 106 | room assignment sequence | deterministic identifier | alter table |
| 107_opera_sftp_report_ingestion.sql | 107 | opera sftp report ingestion | deterministic identifier | DROP, alter table, not null |
| 108_room_unavailability_schema.sql | 108 | room unavailability schema | deterministic identifier | data change, alter table, not null |
| 109_room_unavailability_seed.sql | 109 | room unavailability seed | deterministic identifier | additive/other |
| 110_room_unavailability_type.sql | 110 | room unavailability type | KNOWN HISTORICAL COLLISION | data change |
| 110_work_order_console_features.sql | 110 | work order console features | KNOWN HISTORICAL COLLISION | alter table, not null |
| 111_work_order_timing_labor.sql | 111 | work order timing labor | deterministic identifier | data change, alter table, not null, trigger |
| 112_engineering_repair_intelligence.sql | 112 | engineering repair intelligence | deterministic identifier | alter table, not null |
| 113_asset_downtime_reliability.sql | 113 | asset downtime reliability | deterministic identifier | data change, alter table, not null |
| 114_condition_monitoring.sql | 114 | condition monitoring | deterministic identifier | alter table, not null |
| 115_engineering_vendors_and_insights.sql | 115 | engineering vendors and insights | deterministic identifier | data change, alter table, not null, trigger |
| 116_task_recurrence.sql | 116 | task recurrence | deterministic identifier | alter table, not null |
| 117_logbook_structured_handoffs.sql | 117 | logbook structured handoffs | deterministic identifier | alter table, not null |
| 118_logbook_shift_continuity.sql | 118 | logbook shift continuity | deterministic identifier | alter table, not null |
| 119_shift_summary_identity.sql | 119 | shift summary identity | deterministic identifier | data change, alter table, not null |
| 120_logbook_search_indexes.sql | 120 | logbook search indexes | deterministic identifier | not null |
| 121_logbook_collaboration.sql | 121 | logbook collaboration | deterministic identifier | DROP, alter table, not null |
| 122_logbook_phase8_retention_translations.sql | 122 | logbook phase8 retention translations | deterministic identifier | DROP, alter table, not null |
| 123_housekeeping_exceptions.sql | 123 | housekeeping exceptions | deterministic identifier | data change, alter table, not null, trigger |
| 124_housekeeping_workload_settings.sql | 124 | housekeeping workload settings | deterministic identifier | alter table |
| 125_housekeeping_reclean_tracking.sql | 125 | housekeeping reclean tracking | deterministic identifier | alter table |
| 126_housekeeping_assignment_preferences.sql | 126 | housekeeping assignment preferences | deterministic identifier | alter table |
| 127_lost_found_phase2_intake_and_custody.sql | 127 | lost found phase2 intake and custody | deterministic identifier | alter table, not null |
| 128_lost_found_guest_claims.sql | 128 | lost found guest claims | deterministic identifier | alter table, not null |
| 129_lost_found_phase4_returns_disposition_void.sql | 129 | lost found phase4 returns disposition void | deterministic identifier | alter table, not null |
| 202_schema_readiness_contract.sql | 202 | schema readiness contract | deterministic identifier | additive/other |

