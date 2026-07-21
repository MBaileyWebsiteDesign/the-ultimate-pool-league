import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSetBreadcrumbs } from '../BreadcrumbContext.jsx';

export default function AdminUsers() {
  const [users, setUsers] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useSetBreadcrumbs([{ label: 'Home', to: '/' }, { label: 'Admin' }, { label: 'Users' }]);

  const load = (q) => api.adminListUsers(q).then(setUsers).catch((e) => setError(e.message));

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSearch = (e) => {
    e.preventDefault();
    load(query);
  };

  return (
    <div>
      <div className="page-header">
        <h1>Manage Users</h1>
        <span className="inline-form" style={{ marginBottom: 0 }}>
          <Link to="/admin/venues" className="btn">Manage Venues</Link>
          <Link to="/admin/audit-log" className="btn">View Audit Log</Link>
        </span>
      </div>

      <form className="inline-form" onSubmit={onSearch}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, venue or team…"
        />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>

      {error && <p className="error">{error}</p>}

      {!users ? (
        <p>Loading…</p>
      ) : (
        <table className="standings-table">
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Venue</th><th>Team</th><th>Class</th><th>Role</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ textAlign: 'left' }}>
                  <Link to={`/admin/users/${u.id}`}>{u.firstName} {u.lastName}</Link>
                </td>
                <td style={{ textAlign: 'left' }}>{u.email}</td>
                <td style={{ textAlign: 'left' }}>{u.venue}</td>
                <td style={{ textAlign: 'left' }}>{u.teamName}</td>
                <td>{u.classification || '—'}</td>
                <td>{u.role}</td>
                <td>
                  <span className={`status ${u.status === 'suspended' ? '' : 'status-completed'}`}>{u.status}</span>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr><td colSpan={7} className="muted">No users match that search.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
