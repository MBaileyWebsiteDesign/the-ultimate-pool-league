import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSetBreadcrumbs } from '../BreadcrumbContext.jsx';

export default function AdminAuditLog() {
  const [entries, setEntries] = useState(null);
  const [error, setError] = useState('');

  useSetBreadcrumbs([{ label: 'Home', to: '/' }, { label: 'Admin', to: '/admin/users' }, { label: 'Audit Log' }]);

  useEffect(() => {
    api.adminGetAuditLog().then(setEntries).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <p><Link to="/admin/users">&larr; Back to users</Link></p>
      <h1>Audit Log</h1>
      <p className="muted">
        Recent admin actions - score overrides and edits to user accounts. Most recent first.
      </p>
      {error && <p className="error">{error}</p>}
      {!entries ? (
        <p>Loading…</p>
      ) : (
        <ul className="fixture-list">
          {entries.map((e) => (
            <li key={e.id}>
              <span>
                <strong>{e.actor}</strong> — {e.details}
              </span>
              <span className="muted">{new Date(e.at).toLocaleString()}</span>
            </li>
          ))}
          {entries.length === 0 && <li className="muted">No admin actions recorded yet.</li>}
        </ul>
      )}
    </div>
  );
}
