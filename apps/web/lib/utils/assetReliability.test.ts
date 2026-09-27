import assert from "node:assert/strict";
import test from "node:test";
import {
  assetOperationalStatus,
  formatReliabilityDuration,
} from "./assetReliability";

test("formats compact reliability durations without client-derived persistence", () => {
  assert.equal(formatReliabilityDuration(43), "43m");
  assert.equal(formatReliabilityDuration(61 * 24 * 60), "61d");
  assert.equal(formatReliabilityDuration(61), "1h 1m");
  assert.equal(formatReliabilityDuration(null), null);
});

test("prioritizes an active complete downtime over degraded and operating states", () => {
  assert.equal(
    assetOperationalStatus({ impact_level: "out_of_service" }),
    "out_of_service",
  );
  assert.equal(assetOperationalStatus({ impact_level: "degraded" }), "degraded");
  assert.equal(assetOperationalStatus(undefined), "operating");
});
