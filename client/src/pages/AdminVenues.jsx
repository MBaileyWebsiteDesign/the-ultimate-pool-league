import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSetBreadcrumbs } from '../BreadcrumbContext.jsx';

export default function AdminVenues() {
  const [venues, setVenues] = useState(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  useSetBreadcrumbs([{ label: 'Home', to: '/' }, { label: 'Admin', to: '/admin/users' }, { label: 'Venues' }]);

  const load = () => api.adminListVenues().then(setVenues).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const onApprove = async (id) => {
    setError('');
    setBusyId(id);
    try {
      await api.adminApproveVenue(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const onReject = async (id) => {
    setError('');
    setBusyId(id);
    try {
      await api.adminRejectVenue(id);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  if (!venues) return <p>Loading…</p>;

  const pending = venues.filter((v) => v.status === 'pending');
  const decided = venues.filter((v) => v.status !== 'pending');

  return (
    <div>
      <p><Link to="/admin/users">&larr; Back to users</Link></p>
      <h1>Manage Venues</h1>
      <p className="muted">
        Venues players type in that aren't already on the list are queued here automatically -
        approve them to add them to the shared venue list, or reject them.
      </p>
      {error && <p className="error">{error}</p>}

      <section className="card">
        <h2>Pending Requests</h2>
        {pending.length === 0 ? (
          <p className="muted">No venue requests waiting on approval.</p>
        ) : (
          <ul className="fixture-list">
            {pending.map((v) => (
              <li key={v.id}>
                <span>
                  <strong>{v.name}</strong>
                  {v.requestedByName && <span className="muted"> · requested by {v.requestedByName}</span>}
                </span>
                <span className="inline-form" style={{ marginBottom: 0 }}>
                  <button className="btn btn-primary" disabled={busyId === v.id} onClick={() => onApprove(v.id)}>
                    Approve
                  </button>
                  <button className="btn" disabled={busyId === v.id} onClick={() => onReject(v.id)}>
                    Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>All Venues</h2>
        <table className="standings-table">
          <thead>
            <tr><th>Name</th><th>Status</th><th>Requested by</th></tr>
          </thead>
          <tbody>
            {decided.map((v) => (
              <tr key={v.id}>
                <td style={{ textAlign: 'left' }}>{v.name}</td>
                <td>
                  <span className={`status ${v.status === 'approved' ? 'status-completed' : ''}`}>{v.status}</span>
                </td>
                <td style={{ textAlign: 'left' }}>{v.requestedByName || '—'}</td>
              </tr>
            ))}
            {decided.length === 0 && <tr><td colSpan={3} className="muted">No approved or rejected venues yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}
