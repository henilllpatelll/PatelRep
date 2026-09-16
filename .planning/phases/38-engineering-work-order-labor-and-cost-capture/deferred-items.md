# Deferred Items — Phase 38

## Out-of-scope pre-existing test failures (not caused by 38-02)

Discovered while running the full `apps/api` suite during 38-02 execution.
Confirmed present at the pre-38-02 baseline (they fail with 38-02 working
changes stashed), so they are unrelated to labor/cost capture. They live in
the Management ROI reporting domain, not engineering work orders.

- `tests/test_management_roi.py::test_roi_downtime_revenue_uses_tenant_adr`
  — asserts `total_downtime_hours == 48.0`, gets `0`.
- `tests/test_management_roi.py::test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`
- `tests/test_management_roi.py::test_roi_pm_compliance_reads_pm_deferrals_table`

Not fixed here (SCOPE BOUNDARY: only auto-fix issues directly caused by this
plan's changes). Belongs to a Management ROI phase/owner.
