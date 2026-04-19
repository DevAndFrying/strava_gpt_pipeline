import { useEffect, useMemo, useRef, useState } from "react";
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

const recentExpandDelayMs = 1000;
const recentCollapseDelayMs = 4000;
const recentCollapseThreshold = 50;
const actionCooldownMs = 900;
const statusSuccessDurationMs = 5000;
const metersToFeet = (meters) => meters * 3.28084;

function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [token, setToken] = useState("");
  const [limit, setLimit] = useState(10);
  const [recentLimit, setRecentLimit] = useState(10);
  const [splitUnits, setSplitUnits] = useState("miles");
  const [activityId, setActivityId] = useState("");
  const [recentActivities, setRecentActivities] = useState([]);
  const [loadedActivities, setLoadedActivities] = useState([]);
  const [status, setStatus] = useState({
    message: "No activities loaded yet.",
    tone: "",
  });
  const [toast, setToast] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingRecent, setIsLoadingRecent] = useState(false);
  const [isRecentExpanded, setIsRecentExpanded] = useState(true);
  const [pullingActivityId, setPullingActivityId] = useState("");
  const actionLocks = useRef(new Map());
  const recentExpandTimer = useRef(null);
  const recentCollapseTimer = useRef(null);
  const recentPanelHasFocus = useRef(false);
  const statusTimer = useRef(null);
  const toastTimer = useRef(null);

  const summaries = useMemo(
    () => loadedActivities.map((activity) => summarizeActivity(activity, splitUnits)),
    [loadedActivities, splitUnits],
  );
  const jsonOutput = useMemo(() => JSON.stringify(summaries, null, 2), [summaries]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    clearTimeout(statusTimer.current);

    if (status.tone === "success" && status.message) {
      statusTimer.current = setTimeout(() => {
        setStatus({ message: "", tone: "" });
      }, statusSuccessDurationMs);
    }

    return () => {
      clearTimeout(statusTimer.current);
    };
  }, [status]);

  useEffect(() => {
    return () => {
      clearTimeout(recentExpandTimer.current);
      clearTimeout(recentCollapseTimer.current);
      clearTimeout(statusTimer.current);
      clearTimeout(toastTimer.current);
    };
  }, []);

  function showToast(nextToast, duration = 3200) {
    clearTimeout(toastTimer.current);
    setToast(nextToast);

    if (duration !== null) {
      toastTimer.current = setTimeout(() => {
        setToast(null);
      }, duration);
    }
  }

  function beginAction(actionKey) {
    const now = Date.now();
    const lock = actionLocks.current.get(actionKey);

    if (lock?.inFlight || (lock && now - lock.lastStartedAt < actionCooldownMs)) {
      return false;
    }

    actionLocks.current.set(actionKey, { inFlight: true, lastStartedAt: now });
    return true;
  }

  function endAction(actionKey) {
    const lock = actionLocks.current.get(actionKey);

    if (lock) {
      actionLocks.current.set(actionKey, {
        inFlight: false,
        lastStartedAt: lock.lastStartedAt,
      });
    }
  }

  function toggleTheme() {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!beginAction("fetch-activities")) return;

    const trimmedToken = token.trim();
    const requestedLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);

    setIsLoading(true);
    setLoadedActivities([]);
    showToast(
      { message: "Fetching activities from Strava...", tone: "", isLoading: true },
      null,
    );

    try {
      const activities = await fetchActivities(trimmedToken, requestedLimit);
      let sourceActivities = activities;

      if (!trimmedToken && activities.length > 0) {
        showToast({
          message: `Loaded ${activities.length} activities. Fetching detailed stats...`,
          tone: "",
          isLoading: true,
        }, null);
        sourceActivities = await fetchActivityDetails(activities, (current, total, name) => {
          showToast({
            message: `Fetching detailed stats ${current}/${total}: ${name}`,
            tone: "",
            isLoading: true,
          }, null);
        });
      }

      setLoadedActivities(sourceActivities);
      setStatus({
        message: trimmedToken
          ? `Loaded summary stats for ${sourceActivities.length} activities.`
          : `Loaded detailed stats for ${sourceActivities.length} activities.`,
        tone: "success",
      });
      showToast(
        {
          message: trimmedToken
            ? `Loaded summary stats for ${sourceActivities.length} activities.`
            : `Loaded detailed stats for ${sourceActivities.length} activities.`,
          tone: "success",
        },
      );
    } catch (error) {
      const corsHint =
        error instanceof TypeError
          ? " Browser CORS rules may block direct Strava API calls; use the local server instead."
          : "";

      setStatus({
        message: `${error.message || "Could not fetch activities."}${corsHint}`,
        tone: "error",
      });
      showToast({
        message: `${error.message || "Could not fetch activities."}${corsHint}`,
        tone: "error",
      });
    } finally {
      setIsLoading(false);
      endAction("fetch-activities");
    }
  }

  async function handleCopy() {
    if (summaries.length === 0) return;
    if (!beginAction("copy-json")) return;

    try {
      await navigator.clipboard.writeText(jsonOutput);
      showToast({ message: "Copied JSON to clipboard.", tone: "success" });
    } catch (error) {
      showToast({
        message: "Could not copy JSON automatically. Select the JSON and copy it manually.",
        tone: "error",
      });
    } finally {
      endAction("copy-json");
    }
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
    if (!beginAction("load-recent")) return;

    const trimmedToken = token.trim();
    const requestedLimit = Math.min(Math.max(Number(recentLimit) || 10, 1), 50);

    setIsLoadingRecent(true);
    showToast(
      { message: `Fetching last ${requestedLimit} activities...`, tone: "", isLoading: true },
      null,
    );

    try {
      const activities = await fetchActivities(trimmedToken, requestedLimit);
      clearTimeout(recentExpandTimer.current);
      clearTimeout(recentCollapseTimer.current);
      setIsRecentExpanded(true);
      setRecentActivities(activities);
      setStatus({
        message: `Loaded ${activities.length} recent activities.`,
        tone: "success",
      });
      showToast({ message: `Loaded ${activities.length} recent activities.`, tone: "success" });
    } catch (error) {
      setStatus({
        message: error.message || "Could not fetch recent activities.",
        tone: "error",
      });
      showToast({
        message: error.message || "Could not fetch recent activities.",
        tone: "error",
      });
    } finally {
      setIsLoadingRecent(false);
      endAction("load-recent");
    }
  }

  function scheduleRecentExpand() {
    if (recentActivities.length <= recentCollapseThreshold) {
      setIsRecentExpanded(true);
      return;
    }

    clearTimeout(recentCollapseTimer.current);
    clearTimeout(recentExpandTimer.current);
    recentExpandTimer.current = setTimeout(() => {
      setIsRecentExpanded(true);
    }, recentExpandDelayMs);
  }

  function scheduleRecentCollapse() {
    clearTimeout(recentExpandTimer.current);
    clearTimeout(recentCollapseTimer.current);

    if (recentActivities.length <= recentCollapseThreshold || isLoadingRecent) {
      setIsRecentExpanded(true);
      return;
    }

    recentCollapseTimer.current = setTimeout(() => {
      setIsRecentExpanded(false);
    }, recentCollapseDelayMs);
  }

  function handleRecentBlur(event) {
    if (event.currentTarget.contains(event.relatedTarget)) {
      return;
    }

    recentPanelHasFocus.current = false;
    scheduleRecentCollapse();
  }

  function handleRecentFocus() {
    recentPanelHasFocus.current = true;
    scheduleRecentExpand();
  }

  function handleRecentMouseLeave() {
    if (!recentPanelHasFocus.current) {
      scheduleRecentCollapse();
    }
  }

  async function handlePullActivity(id) {
    const normalizedId = String(id || "").trim();

    if (!/^\d+$/.test(normalizedId)) {
      setStatus({ message: "Enter a numeric Strava activity ID.", tone: "error" });
      showToast({ message: "Enter a numeric Strava activity ID.", tone: "error" });
      return;
    }

    const actionKey = `pull-activity-${normalizedId}`;
    if (!beginAction(actionKey)) return;

    setPullingActivityId(normalizedId);
    showToast(
      { message: `Fetching activity ${normalizedId}...`, tone: "", isLoading: true },
      null,
    );

    try {
      const detail = await fetchActivityDetail(normalizedId);
      setLoadedActivities([detail]);
      setActivityId(normalizedId);
      setStatus({
        message: `Loaded detailed stats for activity ${normalizedId}.`,
        tone: "success",
      });
      showToast({
        message: `Loaded detailed stats for activity ${normalizedId}.`,
        tone: "success",
      });
    } catch (error) {
      setStatus({
        message: error.message || `Could not fetch activity ${normalizedId}.`,
        tone: "error",
      });
      showToast({
        message: error.message || `Could not fetch activity ${normalizedId}.`,
        tone: "error",
      });
    } finally {
      setPullingActivityId("");
      endAction(actionKey);
    }
  }

  return (
    <main className="shell">
      <div className="top-bar">
        <button
          type="button"
          className="theme-toggle"
          aria-pressed={theme === "dark"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </div>

      <section className="intro">
        <p className="eyebrow">Strava API</p>
        <h1>Activity export for ChatGPT</h1>
        <p>Fetch recent activities and copy a clean JSON summary you can send in a chat.</p>
      </section>

      <section className="panel setup-panel" aria-labelledby="setup-title">
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
        <div
          className="panel lookup-panel recent-panel"
          onFocus={handleRecentFocus}
          onBlur={handleRecentBlur}
          onMouseEnter={scheduleRecentExpand}
          onMouseLeave={handleRecentMouseLeave}
        >
          <div className="panel-heading">
            <h2>Recent activities</h2>
            <form
              className="recent-controls"
              onSubmit={(event) => {
                event.preventDefault();
                handleLoadRecent();
              }}
            >
              <label>
                Count
                <input
                  value={recentLimit}
                  onChange={(event) => setRecentLimit(event.target.value)}
                  type="number"
                  min="1"
                  max="50"
                />
              </label>
              <button type="submit" disabled={isLoadingRecent}>
                {isLoadingRecent ? "Loading..." : "Load"}
              </button>
            </form>
          </div>
          <RecentActivityList
            activities={recentActivities}
            splitUnits={splitUnits}
            isExpanded={
              isRecentExpanded ||
              recentActivities.length <= recentCollapseThreshold ||
              isLoadingRecent
            }
            pullingActivityId={pullingActivityId}
            onPullActivity={handlePullActivity}
          />
        </div>

        <div className="panel lookup-panel id-panel">
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

      {status.message && (
        <section className={`status-row ${status.tone}`.trim()} aria-live="polite">
          <p>{status.message}</p>
        </section>
      )}

      <section className="grid" aria-label="Activity results">
        <div className="panel activity-panel">
          <h2>Activity cards</h2>
          <ActivityList activities={summaries} />
        </div>

        <JsonOutputCard
          jsonOutput={jsonOutput}
          canCopy={summaries.length > 0}
          onCopy={handleCopy}
        />
      </section>
      <Toast toast={toast} />
    </main>
  );
}

function Toast({ toast }) {
  if (!toast) return null;

  return (
    <div
      className={`toast ${toast.tone || ""} ${toast.isLoading ? "is-loading" : ""}`.trim()}
      role="status"
      aria-live="polite"
    >
      <p>{toast.message}</p>
      {toast.isLoading && (
        <div className="toast-loading-bar" aria-hidden="true">
          <span />
        </div>
      )}
    </div>
  );
}

function JsonOutputCard({ jsonOutput, canCopy, onCopy }) {
  function handleKeyDown(event) {
    if (!canCopy || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    onCopy();
  }

  return (
    <div
      className={`panel json-card ${canCopy ? "is-copyable" : ""}`.trim()}
      role="button"
      tabIndex={canCopy ? 0 : -1}
      aria-disabled={!canCopy}
      aria-label="Copy JSON for ChatGPT"
      onClick={canCopy ? onCopy : undefined}
      onKeyDown={handleKeyDown}
    >
      <div className="json-card-heading">
        <h2>JSON for ChatGPT</h2>
        <p>{canCopy ? "Click this card to copy." : "Fetch an activity to create JSON."}</p>
      </div>
      {canCopy && (
        <pre className="json-output" aria-label="JSON output">{jsonOutput}</pre>
      )}
    </div>
  );
}

function RecentActivityList({
  activities,
  splitUnits,
  isExpanded,
  pullingActivityId,
  onPullActivity,
}) {
  if (activities.length === 0) {
    return <p className="empty-state">No recent activities loaded yet.</p>;
  }

  return (
    <div className={`recent-list-shell ${isExpanded ? "is-expanded" : "is-collapsed"}`}>
      <p className="recent-collapsed-note" aria-hidden={isExpanded}>
        {activities.length} recent activities hidden. Focus here for 1 second to expand.
      </p>
      <div className="recent-list-clip" aria-hidden={!isExpanded}>
        <div className="recent-list">
          {activities.map((activity) => {
            const id = String(activity.id);
            const distance = formatDistance(activity.distance, splitUnits);
            const hasDistance = activity.distance !== null && activity.distance !== undefined;
            const sport = activity.sport_type || activity.type || "Activity";
            const startedAt = activity.start_date || activity.start_date_local;
            const date = startedAt ? formatDate(startedAt) : null;
            const elevationGain =
              activity.total_elevation_gain === null ||
              activity.total_elevation_gain === undefined
                ? null
                : Number(metersToFeet(activity.total_elevation_gain).toFixed(0));

            return (
              <article className="recent-card" key={id}>
                <div>
                  <h3>{activity.name || "Untitled activity"}</h3>
                  <div className="recent-primary-meta">
                    <span>{sport}</span>
                    {hasDistance && (
                      <span>
                        {distance.value} {distance.unit}
                      </span>
                    )}
                  </div>
                  <p>
                    ID: {id}
                    {date ? ` | ${date}` : ""}
                    {elevationGain !== null ? ` | ${elevationGain} ft gain` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="secondary"
                  disabled={pullingActivityId === id}
                  tabIndex={isExpanded ? 0 : -1}
                  onClick={() => onPullActivity(id)}
                >
                  {pullingActivityId === id ? "Pulling..." : "Pull"}
                </button>
              </article>
            );
          })}
        </div>
      </div>
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
    ["Cadence", activity.cadence],
    [
      "Stride length",
      activity.stride_length_meters !== null && activity.stride_length_meters !== undefined
        ? `${activity.stride_length_meters} m / ${activity.stride_length_feet} ft`
        : null,
    ],
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
        <section className="activity-details" aria-label="Splits and efforts">
          {activity.splits.length > 0 && (
            <MiniTable title="Splits" rows={activity.splits} columns={splitColumns} />
          )}
          {activity.best_efforts.length > 0 && (
            <MiniTable title="Best efforts" rows={activity.best_efforts} />
          )}
          {activity.segment_efforts.length > 0 && (
            <MiniTable title="Segments" rows={activity.segment_efforts} />
          )}
        </section>
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
