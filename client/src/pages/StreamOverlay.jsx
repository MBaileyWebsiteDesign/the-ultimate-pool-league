import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api.js';
import './streamOverlay.css';

// Standalone OBS "Browser Source" scoreboard for one fixture - deliberately
// outside the normal app shell (see App.jsx): no header, no breadcrumbs, no
// login gate, transparent background, big high-contrast text designed to be
// keyed over live video rather than browsed on its own. Polls
// GET /api/overlay/fixtures/:id (a public, unauthenticated endpoint - see
// server/src/index.js) every few seconds rather than opening a websocket,
// since a stream operator just needs "close enough to live", and polling
// needs zero additional server infrastructure.
//
// Usage: add this page's URL as an OBS Browser Source, e.g.
//   https://your-deployment.example.com/overlay/<fixtureId>
// The fixture id is the same one in a normal fixture page's URL
// (/fixtures/<fixtureId>) - copy it from there.
const POLL_INTERVAL_MS = 5000;

export default function StreamOverlay() {
  const { fixtureId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => {
    // Force a transparent canvas regardless of the app's normal page
    // background (styles.css sets `body { background: var(--bg) }` for
    // every other page) - restore it on unmount for tidiness, even though
    // in real OBS usage this page is never navigated away from.
    const previousBodyBackground = document.body.style.background;
    document.body.style.background = 'transparent';
    return () => {
      document.body.style.background = previousBodyBackground;
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let timer;

    const poll = () => {
      api.getOverlayFixture(fixtureId)
        .then((result) => {
          if (!mountedRef.current) return;
          setData(result);
          setError('');
        })
        .catch((err) => {
          if (!mountedRef.current) return;
          setError(err.message);
        })
        .finally(() => {
          if (mountedRef.current) timer = setTimeout(poll, POLL_INTERVAL_MS);
        });
    };
    poll();

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
    };
  }, [fixtureId]);

  // Errors and the initial load render nothing visible rather than an error
  // box - a blank transparent frame is the right failure mode for something
  // keyed live over video (an OBS operator would rather see nothing than a
  // jarring error card), but the message still renders as an HTML comment-
  // like faint corner note for debugging while setting the source up.
  if (!data) {
    return <div className="overlay-root overlay-empty">{error && <span className="overlay-debug">{error}</span>}</div>;
  }

  const raceOrLegsLabel = data.legsTotal != null
    ? `Best of ${data.legsTotal} legs`
    : data.raceTo != null
      ? `Race to ${data.raceTo}`
      : null;

  const statusClass = data.status === 'completed'
    ? 'overlay-status-completed'
    : data.status === 'in_progress'
      ? 'overlay-status-live'
      : 'overlay-status-scheduled';

  const statusLabel = data.status === 'completed'
    ? 'Final'
    : data.status === 'in_progress'
      ? 'Live'
      : 'Upcoming';

  return (
    <div className="overlay-root">
      <div className="overlay-card">
        <div className="overlay-header">
          <span className="overlay-competition">
            {data.leagueName}{data.divisionName ? ` · ${data.divisionName}` : ''}
          </span>
          <span className="overlay-round">{data.roundLabel}</span>
        </div>

        <div className="overlay-scoreboard">
          <Entrant entrant={data.home} highlight={data.winner === 'home'} />
          <div className="overlay-vs-block">
            <span className={`overlay-status-pill ${statusClass}`}>{statusLabel}</span>
            <span className="overlay-vs">vs</span>
          </div>
          <Entrant entrant={data.away} highlight={data.winner === 'away'} />
        </div>

        <div className="overlay-footer">
          {!data.bothEntrantsKnown && <span>Waiting on an earlier round</span>}
          {data.bothEntrantsKnown && data.winner === 'draw' && <span>Match drawn</span>}
          {data.bothEntrantsKnown && raceOrLegsLabel && <span>{raceOrLegsLabel}</span>}
        </div>
      </div>
    </div>
  );
}

function Entrant({ entrant, highlight }) {
  return (
    <div className={`overlay-entrant${highlight ? ' overlay-entrant-winner' : ''}`}>
      <div className="overlay-entrant-name">{entrant.name}</div>
      {entrant.subLabel && <div className="overlay-entrant-sub">{entrant.subLabel}</div>}
      <div className="overlay-entrant-score">{entrant.score}</div>
    </div>
  );
}
