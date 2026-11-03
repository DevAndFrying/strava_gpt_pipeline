export const matchWindowSeconds = 5 * 60;

export const comparisonMetrics = [
  ["distance_meters", "Distance", "m"],
  ["moving_time_seconds", "Moving time", "s"],
  ["elapsed_time_seconds", "Elapsed time", "s"],
  ["elevation_gain_meters", "Elevation gain", "m"],
  ["average_speed_mps", "Average speed", "m/s"],
  ["max_speed_mps", "Max speed", "m/s"],
  ["average_heartrate", "Average heart rate", "bpm"],
  ["max_heartrate", "Max heart rate", "bpm"],
  ["calories", "Calories", "kcal"],
  ["average_watts", "Average power", "W"],
  ["max_watts", "Max power", "W"],
  ["average_temperature_celsius", "Average temperature", "°C"],
];

function number(value) {
  if (value === null || value === undefined || typeof value === "boolean" || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// GMT fields sometimes omit Z. Local timestamps must never be used for matching.
function utcDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) return null;
  const iso = value.trim().replace(" ", "T");
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

const sportTypes = {
  running: "Run", trail_running: "TrailRun", treadmill_running: "Run", track_running: "Run",
  walking: "Walk", casual_walking: "Walk", hiking: "Hike", cycling: "Ride", road_biking: "Ride",
  mountain_biking: "MountainBikeRide", gravel_cycling: "GravelRide", virtual_ride: "VirtualRide",
  swimming: "Swim", lap_swimming: "Swim", open_water_swimming: "Swim",
  strength_training: "WeightTraining", yoga: "Yoga", pilates: "Pilates",
};

export function normalizeGarminActivity(activity) {
  const summary = { ...activity, ...activity.summaryDTO };
  const type = activity.activityTypeDTO?.typeKey || activity.activityType?.typeKey || null;
  const timestamp = number(activity.beginTimestamp);
  return {
    source: "garmin",
    id: activity.activityId,
    name: activity.activityName || null,
    sport_type: sportTypes[type] || type,
    started_at: utcDate(summary.startTimeGMT) ||
      (timestamp !== null && Number.isFinite(new Date(timestamp).getTime()) ? new Date(timestamp).toISOString() : null),
    distance_meters: number(summary.distance),
    moving_time_seconds: number(summary.movingDuration),
    elapsed_time_seconds: number(summary.elapsedDuration),
    elevation_gain_meters: number(summary.elevationGain),
    average_speed_mps: number(summary.averageSpeed),
    max_speed_mps: number(summary.maxSpeed),
    average_heartrate: number(summary.averageHR),
    max_heartrate: number(summary.maxHR),
    calories: number(summary.calories),
    average_watts: number(summary.averagePower ?? summary.avgPower),
    max_watts: number(summary.maxPower),
    average_temperature_celsius: number(summary.averageTemperature),
  };
}

export function normalizeStravaActivity(activity) {
  return {
    source: "strava",
    id: activity.id,
    name: activity.name || null,
    sport_type: activity.sport_type || activity.type || null,
    started_at: utcDate(activity.start_date),
    distance_meters: number(activity.distance),
    moving_time_seconds: number(activity.moving_time),
    elapsed_time_seconds: number(activity.elapsed_time),
    elevation_gain_meters: number(activity.total_elevation_gain),
    average_speed_mps: number(activity.average_speed),
    max_speed_mps: number(activity.max_speed),
    average_heartrate: number(activity.average_heartrate),
    max_heartrate: number(activity.max_heartrate),
    calories: number(activity.calories),
    average_watts: number(activity.average_watts),
    max_watts: number(activity.max_watts),
    average_temperature_celsius: number(activity.average_temp),
  };
}

function uniqueActivities(activities, normalize) {
  return [...new Map(activities.map(normalize).map((activity) => [String(activity.id), activity])).values()];
}

function diffActivities(strava, garmin) {
  return [
    ["name", "Name", ""], ["sport_type", "Sport", ""], ["started_at", "Start (UTC)", ""],
    ...comparisonMetrics,
  ].map(([field, label, unit]) => {
    const left = strava[field];
    const right = garmin[field];
    const missing = left === null || right === null;
    const delta = typeof left === "number" && typeof right === "number"
      ? Number((right - left).toFixed(3)) : null;
    return {
      field, label, unit, strava: left, garmin: right, delta,
      status: missing ? "missing" : (delta === null ? left === right : delta === 0) ? "same" : "different",
    };
  });
}

export function compareActivities(stravaActivities, garminActivities) {
  const strava = uniqueActivities(stravaActivities, normalizeStravaActivity);
  const garmin = uniqueActivities(garminActivities, normalizeGarminActivity);
  const candidates = [];
  for (const left of strava) {
    if (!left.started_at) continue;
    for (const right of garmin) {
      if (!right.started_at) continue;
      const offset = (Date.parse(right.started_at) - Date.parse(left.started_at)) / 1000;
      if (Math.abs(offset) <= matchWindowSeconds) candidates.push({ left, right, offset });
    }
  }
  candidates.sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) ||
    String(a.left.id).localeCompare(String(b.left.id)) || String(a.right.id).localeCompare(String(b.right.id)));
  const usedStrava = new Set();
  const usedGarmin = new Set();
  const pairs = [];
  for (const { left, right, offset } of candidates) {
    if (usedStrava.has(left.id) || usedGarmin.has(right.id)) continue;
    usedStrava.add(left.id);
    usedGarmin.add(right.id);
    pairs.push({
      strava_id: left.id,
      garmin_id: right.id,
      start_difference_seconds: offset,
      fields: diffActivities(left, right),
    });
  }
  return {
    match_window_seconds: matchWindowSeconds,
    delta_direction: "Garmin minus Strava",
    strava,
    garmin,
    pairs,
    unmatched_strava_ids: strava.filter((activity) => !usedStrava.has(activity.id)).map((activity) => activity.id),
    unmatched_garmin_ids: garmin.filter((activity) => !usedGarmin.has(activity.id)).map((activity) => activity.id),
  };
}
