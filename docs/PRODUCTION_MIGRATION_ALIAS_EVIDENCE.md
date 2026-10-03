# Production migration alias evidence

`supabase/production-migration-aliases.json` is intentionally empty as of 2026-10-02. Repository evidence establishes that timestamp-style production history exists, but does not establish a precise one-to-one mapping for any individual remote timestamp ID.

## Evidence reviewed

- Commit `ec5761c07ef6427e094b78e755646e3b53adaae3` (2026-05-17) introduced five migration files (`035`–`039`) in one commit, while the observed production history has six timestamp IDs on that date. That bundle is insufficient to identify any individual pairing.
- `.planning/milestones/v1.0-phases/04-maintenance-and-housekeeping-programs/04-02-SUMMARY.md` documents timestamp-style remote tracking (including `20260721222226`) and states that it does not match local numeric files, but it does not link any timestamp to a specific file.
- `.planning/STATE.md` and `.planning/milestones/v1.0-phases/06-pms-and-ai-expansion/06-02-SUMMARY.md` document the broad history drift and why migration repair is unsafe; neither proves individual aliases.

No mapping is inferred from timestamp order, commit order, counts, or adjacent filenames. Add an alias only when a repository record supplies a direct, reviewable one-to-one link, then remove that ID from the unresolved list below.

## Verified aliases

None.

## Unresolved production timestamp IDs

```text
20260517181609  20260517181616  20260517181635  20260517181658
20260517181700  20260517181733  20260521072934  20260521084122
20260522153318  20260527074548  20260528214232  20260528214237
20260528214241  20260528214245  20260531135623  20260603012920
20260603024409  20260603024416  20260604064032  20260604070643
20260610063716  20260610063736  20260610063746  20260610063757
20260615171108  20260615200546  20260616194132  20260616194141
20260716153257  20260716153311  20260716153330  20260716153337
20260716153346  20260716162144  20260721211545  20260721211622
20260721211721  20260721211807  20260721211838  20260721211857
20260721211924  20260721211947  20260721212006  20260721212031
20260721212337  20260721222226  20260723143709  20260723143723
20260724140005  20260724193447  20260728090702  20260803010646
20260803193004  20260803193008  20260804014341  20260804063819
20260804124443  20260805011051  20260805020205  20260805074539
20260812215744  20260813153627  20260814125808  20260916021406
20260916021431  20260916081516  20260916195211  20260917005754
20260917070043  20260917153055  20260921190552  20260923233708
20260923233715  20260929053027  20260929193432  20260929201927
20260930091746  20260930193654  20261001021444  20261001021518
20261001021539  20261001021556  20261001021620  20261001043230
20261001043248  20261001043307  20261001162656
```

Unknown IDs remain release-blocking. This documentation and the alias registry do not mutate production schema or migration metadata.
