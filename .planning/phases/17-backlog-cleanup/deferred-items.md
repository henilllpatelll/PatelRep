# Deferred Items — Phase 17 Backlog Cleanup

## From 17-04 (Management ROI formula leak)

**2 pre-existing failing tests in `apps/api/tests/test_management_roi.py`, unrelated to this plan's scope:**

- `test_roi_downtime_revenue_uses_tenant_adr`
- `test_roi_housekeeping_efficiency_pairs_in_progress_to_clean`

Both were introduced by commits `cf545a0e` and `22fb775d` ("test(05-06): add failing router tests for ...") — deliberate TDD red-phase tests for phase 5 plan 06, predating and unrelated to 17-04's `definition` string fix. They fail on `main` independent of any 17-04 change. Out of scope per deviation Rule scope boundary (pre-existing failures in unrelated test coverage). Left unfixed; owner of phase 5 plan 06 (or whichever plan implements the corresponding router behavior) should resolve.

## Also observed in 17-02 (Scheduling duplicate-shift guard)

Same 2 pre-existing failures reconfirmed present and unrelated during 17-02's full-suite verification run (546 passed, 2 failed — same two tests, same root cause as above). No new information; logged here only to confirm they were re-checked and are not a regression from 17-02's scope.
