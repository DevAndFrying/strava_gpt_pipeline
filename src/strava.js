const metersToMiles = (meters) => meters / 1609.344;
const metersToKilometers = (meters) => meters / 1000;
const metersToFeet = (meters) => meters * 3.28084;
const footSportTypes = new Set(["Run", "TrailRun", "VirtualRun", "Walk", "Hike"]);

export function formatHeartRate(value) {
  return value === null || value === undefined ? null : Number(Number(value).toFixed(2));
}

export function formatDistance(meters, units) {
  const distance =
    units === "kilometers" ? metersToKilometers(meters || 0) : metersToMiles(meters || 0);

  return {
    value: Number(distance.toFixed(2)),
    unit: units === "kilometers" ? "km" : "mi",
  };
}

export function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

function isFootSport(activity) {
  return footSportTypes.has(activity.sport_type || activity.type);
}

function formatCadence(activity) {
  if (activity.average_cadence === null || activity.average_cadence === undefined) {
    return null;
  }

  const cadence = Number(activity.average_cadence);

  if (!Number.isFinite(cadence)) {
    return null;
  }

  if (isFootSport(activity)) {
    return `${Number((cadence * 2).toFixed(1))} spm`;
  }

  return `${Number(cadence.toFixed(1))} rpm`;
}

function calculateStrideLength(activity) {
  const cadence = Number(activity.average_cadence);
  const distance = Number(activity.distance);
  const movingTime = Number(activity.moving_time);

  if (
    !isFootSport(activity) ||
    !Number.isFinite(cadence) ||
    !Number.isFinite(distance) ||
    !Number.isFinite(movingTime) ||
    cadence <= 0 ||
    distance <= 0 ||
    movingTime <= 0
  ) {
    return null;
  }

  const steps = cadence * 2 * (movingTime / 60);

  if (steps <= 0) {
    return null;
  }

  const meters = distance / steps;

  return {
    meters: Number(meters.toFixed(2)),
    feet: Number(metersToFeet(meters).toFixed(2)),
  };
}

export function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function summarizeActivity(activity, splitUnits) {
  const splitSource =
    splitUnits === "kilometers" ? activity.splits_metric : activity.splits_standard;
  const fallbackSplitSource =
    splitUnits === "kilometers" ? activity.splits_standard : activity.splits_metric;
  const sourceSplits = Array.isArray(splitSource) ? splitSource : fallbackSplitSource;

  const splits = Array.isArray(sourceSplits)
    ? sourceSplits.map((split) => ({
        split: split.split,
        distance:
          splitUnits === "kilometers"
            ? Number(metersToKilometers(split.distance || 0).toFixed(2))
            : Number(metersToMiles(split.distance || 0).toFixed(2)),
        distance_unit: splitUnits === "kilometers" ? "km" : "mi",
        moving_time: formatDuration(split.moving_time || 0),
        elevation_difference_feet: Number(metersToFeet(split.elevation_difference || 0).toFixed(0)),
        average_speed:
          splitUnits === "kilometers"
            ? Number(((split.average_speed || 0) * 3.6).toFixed(2))
            : Number(((split.average_speed || 0) * 2.23694).toFixed(2)),
        average_speed_unit: splitUnits === "kilometers" ? "km/h" : "mph",
        average_heartrate: formatHeartRate(split.average_heartrate),
        average_grade_adjusted_speed: split.average_grade_adjusted_speed
          ? splitUnits === "kilometers"
            ? Number((split.average_grade_adjusted_speed * 3.6).toFixed(2))
            : Number((split.average_grade_adjusted_speed * 2.23694).toFixed(2))
          : null,
        average_grade_adjusted_speed_unit: splitUnits === "kilometers" ? "km/h" : "mph",
      }))
    : [];

  const bestEfforts = Array.isArray(activity.best_efforts)
    ? activity.best_efforts.slice(0, 8).map((effort) => ({
        name: effort.name,
        distance_miles: Number(metersToMiles(effort.distance || 0).toFixed(2)),
        elapsed_time: formatDuration(effort.elapsed_time || 0),
        moving_time: formatDuration(effort.moving_time || 0),
        started_at: effort.start_date_local || effort.start_date,
      }))
    : [];

  const segmentEfforts = Array.isArray(activity.segment_efforts)
    ? activity.segment_efforts.slice(0, 8).map((effort) => ({
        name: effort.name,
        elapsed_time: formatDuration(effort.elapsed_time || 0),
        moving_time: formatDuration(effort.moving_time || 0),
        distance_miles: Number(metersToMiles(effort.distance || 0).toFixed(2)),
        average_watts: effort.average_watts ?? null,
        average_heartrate: formatHeartRate(effort.average_heartrate),
      }))
    : [];
  const strideLength = calculateStrideLength(activity);

  return {
    id: activity.id,
    name: activity.name,
    sport_type: activity.sport_type || activity.type,
    started_at: activity.start_date_local || activity.start_date,
    distance_miles: Number(metersToMiles(activity.distance || 0).toFixed(2)),
    moving_time: formatDuration(activity.moving_time || 0),
    elapsed_time: formatDuration(activity.elapsed_time || 0),
    elevation_gain_feet: Number(metersToFeet(activity.total_elevation_gain || 0).toFixed(0)),
    average_speed_mph: Number(((activity.average_speed || 0) * 2.23694).toFixed(2)),
    max_speed_mph: Number(((activity.max_speed || 0) * 2.23694).toFixed(2)),
    average_heartrate: formatHeartRate(activity.average_heartrate),
    max_heartrate: formatHeartRate(activity.max_heartrate),
    calories: activity.calories ?? null,
    perceived_exertion: activity.perceived_exertion ?? null,
    suffer_score: activity.suffer_score ?? null,
    average_cadence: activity.average_cadence ?? null,
    cadence: formatCadence(activity),
    stride_length_meters: strideLength?.meters ?? null,
    stride_length_feet: strideLength?.feet ?? null,
    average_watts: activity.average_watts ?? null,
    weighted_average_watts: activity.weighted_average_watts ?? null,
    max_watts: activity.max_watts ?? null,
    kilojoules: activity.kilojoules ?? null,
    device_watts: activity.device_watts ?? null,
    has_heartrate: activity.has_heartrate ?? null,
    trainer: activity.trainer ?? false,
    commute: activity.commute ?? false,
    gear: activity.gear?.name || activity.gear_id || null,
    description: activity.description || null,
    elevation_high_feet:
      activity.elev_high === null || activity.elev_high === undefined
        ? null
        : Number(metersToFeet(activity.elev_high).toFixed(0)),
    elevation_low_feet:
      activity.elev_low === null || activity.elev_low === undefined
        ? null
        : Number(metersToFeet(activity.elev_low).toFixed(0)),
    kudos_count: activity.kudos_count ?? 0,
    achievement_count: activity.achievement_count ?? 0,
    pr_count: activity.pr_count ?? 0,
    photo_count: activity.total_photo_count ?? activity.photo_count ?? 0,
    splits,
    best_efforts: bestEfforts,
    segment_efforts: segmentEfforts,
  };
}

export async function fetchActivities(token, limit) {
  const useTokenOverride = Boolean(token);
  const url = new URL(
    useTokenOverride
      ? "https://www.strava.com/api/v3/athlete/activities"
      : "/api/activities",
    window.location.href,
  );
  url.searchParams.set("per_page", String(limit));

  const options = useTokenOverride
    ? {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    : {};

  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throwResponseError(response, data);
  }

  if (!Array.isArray(data)) {
    throw new Error("Strava returned an unexpected response.");
  }

  return data;
}

export async function fetchActivityDetail(id) {
  const response = await fetch(`/api/activities/${id}`);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throwResponseError(response, data);
  }

  return data;
}

export async function fetchActivityDetails(activities, onProgress) {
  const details = [];

  for (let index = 0; index < activities.length; index += 1) {
    const activity = activities[index];
    onProgress(index + 1, activities.length, activity.name || activity.id);
    details.push(await fetchActivityDetail(activity.id));
  }

  return details;
}

export function formatApiErrorDetails(data) {
  const details = [];

  if (data?.credential_mode) {
    details.push(`credential mode: ${data.credential_mode}`);
  }

  if (Array.isArray(data?.details?.errors)) {
    for (const error of data.details.errors) {
      const field = [error.resource, error.field].filter(Boolean).join(".");
      const code = error.code ? ` ${error.code}` : "";
      details.push(`${field || "error"}${code}`.trim());
    }
  }

  return details.length ? ` (${details.join("; ")})` : "";
}

function throwResponseError(response, data) {
  if (response.status === 401) {
    throw new Error(
      `Strava rejected this token. Use a current OAuth access token with activity:read or activity:read_all scope.${formatApiErrorDetails(data)}`,
    );
  }

  throw new Error(
    `${data?.message || `Strava returned HTTP ${response.status}`}${formatApiErrorDetails(data)}`,
  );
}
