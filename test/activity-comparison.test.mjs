import test from "node:test";
import assert from "node:assert/strict";
import { compareActivities, normalizeGarminActivity, normalizeStravaActivity } from "../src/activity-comparison.mjs";

const strava = (id, start, extra = {}) => ({ id, name: "Morning run", sport_type: "Run", start_date: start, ...extra });
const garmin = (id, start, extra = {}) => ({ activityId: id, activityName: "Morning run", startTimeGMT: start, ...extra });

test("matches at exactly five minutes in either direction, but not beyond", () => {
  for (const start of ["2026-11-02T11:55:00Z", "2026-11-02T12:05:00Z"]) {
    assert.equal(compareActivities([strava(1, "2026-11-02T12:00:00Z")], [garmin(2, start)]).pairs.length, 1);
  }
  const result = compareActivities([strava(1, "2026-11-02T12:00:00Z")], [garmin(2, "2026-11-02T12:05:00.001Z")]);
  assert.equal(result.pairs.length, 0);
  assert.deepEqual(result.unmatched_strava_ids, [1]);
  assert.deepEqual(result.unmatched_garmin_ids, [2]);
});

test("matches UTC instants across offsets and midnight; Garmin GMT without Z is UTC", () => {
  const result = compareActivities(
    [strava(1, "2026-11-01T19:59:00-05:00")],
    [garmin(2, "2026-11-02 01:01:00")],
  );
  assert.equal(result.pairs[0].start_difference_seconds, 120);
  assert.equal(result.garmin[0].started_at, "2026-11-02T01:01:00.000Z");
});

test("does not infer UTC from local-only or invalid dates; accepts Garmin epoch milliseconds", () => {
  const result = compareActivities(
    [strava(1, null, { start_date_local: "2026-11-02T12:00:00" }), strava(2, "invalid")],
    [garmin(3, null, { startTimeLocal: "2026-11-02T12:00:00" })],
  );
  assert.equal(result.pairs.length, 0);
  assert.equal(normalizeGarminActivity(garmin(4, null, { beginTimestamp: Date.parse("2026-11-02T12:00:00Z") })).started_at, "2026-11-02T12:00:00.000Z");
});

test("pairs nearest starts first and uses each activity once, independently of input order", () => {
  const left = [strava(1, "2026-11-02T12:00:00Z"), strava(2, "2026-11-02T12:04:00Z")];
  const right = [garmin(3, "2026-11-02T12:03:50Z"), garmin(4, "2026-11-02T12:00:20Z")];
  const expected = [[2, 3], [1, 4]];
  for (const [a, b] of [[left, right], [[...left].reverse(), [...right].reverse()]]) {
    assert.deepEqual(compareActivities(a, b).pairs.map((pair) => [pair.strava_id, pair.garmin_id]), expected);
  }
  const single = compareActivities(left, [right[0], right[0]]);
  assert.equal(single.pairs.length, 1);
  assert.deepEqual(single.unmatched_strava_ids, [1]);
});

test("normalizes detailed Garmin metrics and computes signed differences in common units", () => {
  const result = compareActivities(
    [strava(1, "2026-11-02T12:00:00Z", { distance: 5000, moving_time: 1800, average_heartrate: 140, total_elevation_gain: 0 })],
    [garmin(2, "2026-11-02T12:00:10Z", {
      distance: 9000,
      activityTypeDTO: { typeKey: "running" },
      summaryDTO: { distance: 5020.12345, movingDuration: 1798.5, averageHR: 142, elevationGain: 0 },
    })],
  );
  const fields = Object.fromEntries(result.pairs[0].fields.map((field) => [field.field, field]));
  assert.equal(result.garmin[0].sport_type, "Run");
  assert.equal(fields.sport_type.status, "same");
  assert.equal(fields.distance_meters.garmin, 5020.12345);
  assert.equal(fields.distance_meters.delta, 20.123);
  assert.equal(fields.moving_time_seconds.delta, -1.5);
  assert.equal(fields.average_heartrate.delta, 2);
  assert.equal(fields.elevation_gain_meters.delta, 0);
  assert.equal(fields.elevation_gain_meters.status, "same");
});

test("missing metrics remain null and are not compared as zero", () => {
  const result = compareActivities(
    [strava(1, "2026-11-02T12:00:00Z", { calories: 0, average_heartrate: "", average_speed: "invalid" })],
    [garmin(2, "2026-11-02T12:00:00Z", { duration: 900 })],
  );
  const fields = Object.fromEntries(result.pairs[0].fields.map((field) => [field.field, field]));
  assert.equal(fields.calories.strava, 0);
  assert.equal(fields.calories.garmin, null);
  assert.equal(fields.calories.delta, null);
  assert.equal(fields.calories.status, "missing");
  assert.equal(fields.moving_time_seconds.garmin, null);
  assert.equal(fields.elapsed_time_seconds.garmin, null);
  assert.equal(normalizeStravaActivity({ average_heartrate: "" }).average_heartrate, null);
  assert.equal(normalizeStravaActivity({ average_speed: "invalid" }).average_speed_mps, null);
});
