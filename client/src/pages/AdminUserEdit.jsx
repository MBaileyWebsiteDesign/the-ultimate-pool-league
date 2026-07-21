import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useSetBreadcrumbs } from '../BreadcrumbContext.jsx';
import VenueSelect from '../components/VenueSelect.jsx';

const CLASSIFICATIONS = ['A', 'B', 'C', 'D'];

function ProfileForm({ user, onSaved, setError, setSuccess }) {
  const [form, setForm] = useState({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone || '',
    venue: user.venue,
    teamName: user.teamName,
    classification: user.classification || '',
  });
  const [submitting, setSubmitting] = useState(false);
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const updated = await api.adminUpdateUser(user.id, { ...form, classification: form.classification || null });
      onSaved(updated);
      setSuccess('Profile updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card form" onSubmit={onSubmit}>
      <h2>Profile</h2>
      <label>First name<input value={form.firstName} onChange={set('firstName')} required /></label>
      <label>Last name<input value={form.lastName} onChange={set('lastName')} required /></label>
      <label>Email<input type="email" value={form.email} onChange={set('email')} required /></label>
      <label>Phone <span className="muted">(optional)</span><input type="tel" value={form.phone} onChange={set('phone')} /></label>
      <label>Venue<VenueSelect value={form.venue} onChange={(name) => setForm({ ...form, venue: name })} /></label>
      <label>Team name<input value={form.teamName} onChange={set('teamName')} required /></label>
      <label>
        Classification <span className="muted">(optional)</span>
        <select value={form.classification} onChange={set('classification')}>
          <option value="">Not set</option>
          {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save Profile'}
      </button>
    </form>
  );
}

function RoleStatusPanel({ user, onSaved, setError, setSuccess }) {
  const [busy, setBusy] = useState(false);

  const toggleRole = async () => {
    setError(''); setSuccess(''); setBusy(true);
    const nextRole = user.role === 'admin' ? 'player' : 'admin';
    try {
      const updated = await api.adminSetRole(user.id, nextRole);
      onSaved(updated);
      setSuccess(`Role set to ${nextRole}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleStatus = async () => {
    setError(''); setSuccess(''); setBusy(true);
    const nextStatus = user.status === 'suspended' ? 'active' : 'suspended';
    try {
      const updated = await api.adminSetStatus(user.id, nextStatus);
      onSaved(updated);
      setSuccess(`Account ${nextStatus === 'suspended' ? 'suspended' : 'reactivated'}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Role &amp; Status</h2>
      <p className="muted">
        Current role: <strong>{user.role}</strong> · Current status: <strong>{user.status}</strong>
      </p>
      <div className="inline-form">
        <button className="btn" disabled={busy} onClick={toggleRole}>
          {user.role === 'admin' ? 'Demote to Player' : 'Promote to Admin'}
        </button>
        <button className="btn" disabled={busy} onClick={toggleStatus}>
          {user.status === 'suspended' ? 'Reactivate Account' : 'Suspend Account'}
        </button>
      </div>
    </section>
  );
}

function ResetPasswordForm({ user, setError, setSuccess }) {
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess('');
    setSubmitting(true);
    try {
      await api.adminResetPassword(user.id, newPassword);
      setNewPassword('');
      setSuccess('Password reset - share the new password with the player securely.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card form" onSubmit={onSubmit}>
      <h2>Force Password Reset</h2>
      <p className="muted">Sets a new password directly - no need to know the current one.</p>
      <label>
        New password
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
      </label>
      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Resetting…' : 'Reset Password'}
      </button>
    </form>
  );
}

export default function AdminUserEdit() {
  const { userId } = useParams();
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    api.adminGetUser(userId).then(setUser).catch((e) => setError(e.message));
  }, [userId]);

  useSetBreadcrumbs(
    user
      ? [{ label: 'Home', to: '/' }, { label: 'Admin', to: '/admin/users' }, { label: 'Users', to: '/admin/users' }, { label: `${user.firstName} ${user.lastName}` }]
      : [{ label: 'Home', to: '/' }, { label: 'Admin', to: '/admin/users' }, { label: 'Users', to: '/admin/users' }, { label: 'Loading…' }]
  );

  if (!user && !error) return <p>Loading…</p>;

  return (
    <div>
      <p><Link to="/admin/users">&larr; Back to all users</Link></p>
      {error && <p className="error">{error}</p>}
      {success && <p className="banner banner-success">{success}</p>}
      {user && (
        <>
          <h1>{user.firstName} {user.lastName}</h1>
          {user.playerId && (
            <p className="muted"><Link to={`/players/${user.playerId}`}>View their stats &amp; match history</Link></p>
          )}
          <ProfileForm user={user} onSaved={setUser} setError={setError} setSuccess={setSuccess} />
          <RoleStatusPanel user={user} onSaved={setUser} setError={setError} setSuccess={setSuccess} />
          <ResetPasswordForm user={user} setError={setError} setSuccess={setSuccess} />
        </>
      )}
    </div>
  );
}
