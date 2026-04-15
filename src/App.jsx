import { useMemo, useState } from "react";
import {
  fetchActivities,
  fetchActivityDetail,
  fetchActivityDetails,
  formatDistance,
  formatDate,
  summarizeActivity,
} from "./strava.js";

const splitColumns = [
  "split",
  "distance",
  "moving_time",
  "average_speed",
  "elevation_difference_feet",
  "average_heartrate",
  "average_grade_adjusted_speed",
];

function App() {
  const [token, setToken] = useState("");
  const [limit, setLimit] = useState(10);
  const [splitUnits, setSplitUnits] = useState("miles");
  const [activityId, setActivityId] = useState("");
  const [recentActivities, setRecentActivities] = useState([]);
  const [loadedActivities, setLoadedActivities] = useState([]);
  const [status, setStatus] = useState({
    message: "No activities loaded yet.",
    tone: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [pullingActivityId, setPullingActivityId] = useState("");

  const summaries = useMemo(
    () => loadedActivities.map((activity) => summarizeActivity(activity, splitUnits)),
    [loadedActivities, splitUnits],
  );
  const jsonOutput = useMemo(() => JSON.stringify(summaries, null, 2), [summaries]);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmedToken = token.trim();
    const requestedLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

    setIsLoading(true);
    setLoadedActivities([]);
    setStatus({ message: "Fetching activities from Strava...", tone: "" });

    try {
      const activities = await fetchActivities(trimmedToken, requestedLimit);
      let sourceActivities = activities;

      if (!trimmedToken && activities.length > 0) {
        setStatus({
          message: `Loaded ${activities.length} activities. Fetching detailed stats...`,
          tone: "",
        });
        sourceActivities = await fetchActivityDetails(activities, (current, total, name) => {
          setStatus({
            message: `Fetching detailed stats ${current}/${total}: ${name}`,
            tone: "",
          });
        });
      }

      setLoadedActivities(sourceActivities);
      setStatus({
        message: trimmedToken
          ? `Loaded summary stats for ${sourceActivities.length} activities.`
          : `Loaded detailed stats for ${sourceActivities.length} activities.`,
        tone: "success",
      });
    } catch (error) {
      const corsHint =
        error instanceof TypeError
          ? " Browser CORS rules may block direct Strava API calls; use the local server instead."
          : "";

      setStatus({
        message: `${error.message || "Could not fetch activities."}${corsHint}`,
        tone: "error",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopy() {
    if (!jsonOutput) return;

    await navigator.clipboard.writeText(jsonOutput);
    setStatus({ message: "Copied JSON to clipboard.", tone: "success" });
  }

  function handleSplitUnitsChange(value) {
    setSplitUnits(value);

    if (loadedActivities.length > 0) {
      setStatus({
        message: `Updated splits to ${value} for ${loadedActivities.length} activities.`,
        tone: "success",
      });
    }
  }

  async function handleLoadRecent() {
    const trimmedToken = token.trim();

    setIsLoadingRecent(true);
    setStatus({ message: "Fetching last 10 activities...", tone: "" });

    try {
      const activities = await fetchActivities(trimmedToken, 10);
      setRecentActivities(activities);
      setStatus({
        message: `Loaded ${activities.length} recent activities.`,
        tone: "success",
      });
    } catch (error) {
      setStatus({
        message: error.message || "Could not fetch recent activities.",
        tone: "error",
      });
    } finally {
      setIsLoadingRecent(false);
    }
  }

  async function handlePullActivity(id) {
    const normalizedId = String(id || "").trim();

    if (!/^\d+$/.test(normalizedId)) {
      setStatus({ message: "Enter a numeric Strava activity ID.", tone: "error" });
      return;
    }

    setPullingActivityId(normalizedId);
    setStatus({ message: `Fetching activity ${normalizedId}...`, tone: "" });

    try {
      const detail = await fetchActivityDetail(normalizedId);
      setLoadedActivities([detail]);
      setActivityId(normalizedId);
      setStatus({
        message: `Loaded detailed stats for activity ${normalizedId}.`,
        tone: "success",
      });
    } catch (error) {
      setStatus({
        message: error.message || `Could not fetch activity ${normalizedId}.`,
        tone: "error",
      });
    } finally {
      setPullingActivityId("");
    }
  }

  return (
    <main className="shell">
      <section className="intro">
        <p className="eyebrow">Strava API</p>
        <h1>Activity export for ChatGPT</h1>
        <p>Fetch recent activities and copy a clean JSON summary you can send in a chat.</p>
      </section>

      <section className="panel" aria-labelledby="setup-title">
        <h2 id="setup-title">Fetch activities</h2>
        <form className="controls" onSubmit={handleSubmit}>
          <label>
            Access token override
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              type="password"
              autoComplete="off"
              placeholder="Optional when server env vars are set"
            />
          </label>

          <label>
            Activities to request
            <input
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              type="number"
              min="1"
              max="50"
            />
          </label>

          <label>
            Split units
            <select
              value={splitUnits}
              onChange={(event) => handleSplitUnitsChange(event.target.value)}
            >
              <option value="miles">Miles</option>
              <option value="kilometers">Kilometers</option>
            </select>
          </label>

          <div className="actions">
            <button type="submit" disabled={isLoading}>
              {isLoading ? "Fetching..." : "Fetch from Strava"}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={summaries.length === 0}
              onClick={handleCopy}
            >
              Copy JSON
            </button>
          </div>
        </form>

        <p className="note">
          Leave the token blank to use the local server env vars. Paste a token only for a
          one-off browser request.
        </p>

        <div className="oauth-help">
          <h3>Need activity permission?</h3>
          <p>Authorize this app with Strava, then copy the new refresh token into your .env file.</p>
          <a className="button-link" href="/api/authorize">
            Authorize with Strava
          </a>
        </div>
      </section>

      <section className="lookup-grid" aria-label="Activity lookup tools">
        <div className="panel">
          <div className="panel-heading">
            <h2>Last 10 activities</h2>
            <button type="button" onClick={handleLoadRecent} disabled={isLoadingRecent}>
              {isLoadingRecent ? "Loading..." : "Load last 10"}
            </button>
          </div>
          <RecentActivityList
            activities={recentActivities}
            splitUnits={splitUnits}
            pullingActivityId={pullingActivityId}
            onPullActivity={handlePullActivity}
          />
        </div>

        <div className="panel">
          <h2>Pull by activity ID</h2>
          <form
            className="id-lookup"
            onSubmit={(event) => {
              event.preventDefault();
              handlePullActivity(activityId);
            }}
          >
            <label>
              Activity ID
              <input
                value={activityId}
                onChange={(event) => setActivityId(event.target.value)}
                inputMode="numeric"
                placeholder="Paste activity ID"
              />
            </label>
            <button type="submit" disabled={Boolean(pullingActivityId)}>
              {pullingActivityId ? "Pulling..." : "Pull activity"}
            </button>
          </form>
          <p className="note">
            Pulling by ID uses the local server credentials and loads one detailed activity into
            the cards and JSON output.
          </p>
        </div>
      </section>

      <section className={`status-row ${status.tone}`.trim()} aria-live="polite">
        <p>{status.message}</p>
      </section>

      <section className="grid" aria-label="Activity results">
        <div className="panel">
          <h2>Activity cards</h2>
          <ActivityList activities={summaries} />
        </div>

        <div className="panel">
          <h2>JSON for ChatGPT</h2>
          <textarea value={jsonOutput} readOnly spellCheck="false" />
        </div>
      </section>
    </main>
  );
}

function RecentActivityList({ activities, splitUnits, pullingActivityId, onPullActivity }) {
  if (activities.length === 0) {
    return <p className="empty-state">No recent activities loaded yet.</p>;
  }

  return (
    <div className="recent-list">
      {activities.map((activity) => {
        const id = String(activity.id);
        const distance = formatDistance(activity.distance, splitUnits);

        return (
          <article className="recent-card" key={id}>
            <div>
              <h3>{activity.name || "Untitled activity"}</h3>
              <p>
                ID: {id}
                {activity.distance !== null && activity.distance !== undefined
                  ? ` | ${distance.value} ${distance.unit}`
                  : ""}
              </p>
            </div>
            <button
              type="button"
              className="secondary"
              disabled={pullingActivityId === id}
              onClick={() => onPullActivity(id)}
            >
              {pullingActivityId === id ? "Pulling..." : "Pull"}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function ActivityList({ activities }) {
  if (activities.length === 0) {
    return (
      <div className="activity-list">
        <p>No activities returned for this token.</p>
      </div>
    );
  }

  return (
    <div className="activity-list">
      {activities.map((activity) => (
        <ActivityCard key={activity.id} activity={activity} />
      ))}
    </div>
  );
}

function ActivityCard({ activity }) {
  const metaFields = [
    activity.sport_type,
    activity.started_at ? formatDate(activity.started_at) : null,
    `${activity.distance_miles} mi`,
    activity.moving_time,
    `${activity.elevation_gain_feet} ft gain`,
    `${activity.average_speed_mph} mph avg`,
  ].filter(Boolean);

  const detailFields = [
    ["Calories", activity.calories],
    ["Avg HR", activity.average_heartrate],
    ["Max HR", activity.max_heartrate],
    ["Avg cadence", activity.average_cadence],
    ["Avg watts", activity.average_watts],
    ["Weighted watts", activity.weighted_average_watts],
    ["KJ", activity.kilojoules],
    ["Suffer score", activity.suffer_score],
    ["PRs", activity.pr_count],
    ["Achievements", activity.achievement_count],
    ["Gear", activity.gear],
  ].filter(([, value]) => value !== null && value !== undefined && value !== "");

  return (
    <article className="activity-card">
      <h3>{activity.name || "Untitled activity"}</h3>

      <div className="activity-meta">
        {metaFields.map((field) => (
          <span key={field}>{field}</span>
        ))}
      </div>

      {detailFields.length > 0 && (
        <dl className="detail-grid">
          {detailFields.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {(activity.splits.length > 0 ||
        activity.best_efforts.length > 0 ||
        activity.segment_efforts.length > 0) && (
        <details className="activity-details">
          <summary>Splits and efforts</summary>

          {activity.splits.length > 0 && (
            <MiniTable title="Splits" rows={activity.splits} columns={splitColumns} />
          )}
          {activity.best_efforts.length > 0 && (
            <MiniTable title="Best efforts" rows={activity.best_efforts} />
          )}
          {activity.segment_efforts.length > 0 && (
            <MiniTable title="Segments" rows={activity.segment_efforts} />
          )}
        </details>
      )}
    </article>
  );
}

function MiniTable({ title, rows, columns = null }) {
  const keys = columns || Object.keys(rows[0] || {}).slice(0, 5);

  return (
    <section className="mini-table-section">
      <h4>{title}</h4>
      <table>
        <thead>
          <tr>
            {keys.map((key) => (
              <th key={key}>{formatColumnLabel(key, rows[0])}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${title}-${index}`}>
              {keys.map((key) => (
                <td key={key}>{row[key] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function formatColumnLabel(key, firstRow) {
  const labels = {
    average_grade_adjusted_speed: `grade adj speed (${firstRow?.average_grade_adjusted_speed_unit || ""})`,
    average_heartrate: "avg HR",
    average_speed: `avg speed (${firstRow?.average_speed_unit || ""})`,
    distance: `distance (${firstRow?.distance_unit || ""})`,
    elevation_difference_feet: "elev diff (ft)",
    moving_time: "moving time",
  };

  return labels[key] || key.replaceAll("_", " ");
}

export default App;
