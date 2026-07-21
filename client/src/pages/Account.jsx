import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { usePlayerAuth } from '../PlayerAuthContext.jsx';
import { useSetBreadcrumbs } from '../BreadcrumbContext.jsx';
import VenueSelect from '../components/VenueSelect.jsx';

const CLASSIFICATIONS = ['A', 'B', 'C', 'D'];

function ProfileForm({ player, onSaved }) {
  const [form, setForm] = useState({
    firstName: player.firstName,
    lastName: player.lastName,
    email: player.email,
    phone: player.phone || '',
    venue: player.venue,
    teamName: player.teamName,
    classification: player.classification || '',
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const updated = await api.updateMe({ ...form, classification: form.classification || null });
      onSaved(updated);
      setSuccess('Details updated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card form" onSubmit={onSubmit}>
      <h2>Your Details</h2>
      <label>
        First name
        <input value={form.firstName} onChange={set('firstName')} required />
      </label>
      <label>
        Last name
        <input value={form.lastName} onChange={set('lastName')} required />
      </label>
      <label>
        Email
        <input type="email" value={form.email} onChange={set('email')} required />
      </label>
      <label>
        Phone <span className="muted">(optional)</span>
        <input type="tel" value={form.phone} onChange={set('phone')} />
      </label>
      <label>
        Venue
        <VenueSelect value={form.venue} onChange={(name) => setForm({ ...form, venue: name })} />
      </label>
      <label>
        Team name
        <input value={form.teamName} onChange={set('teamName')} required />
      </label>
      <label>
        Classification <span className="muted">(optional)</span>
        <select value={form.classification} onChange={set('classification')}>
          <option value="">Not set</option>
          {CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      {success && <p className="banner banner-success">{success}</p>}
      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save Details'}
      </button>
    </form>
  );
}

function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match');
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Password changed.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="card form" onSubmit={onSubmit}>
      <h2>Change Password</h2>
      <label>
        Current password
        <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
      </label>
      <label>
        New password
        <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required />
      </label>
      <label>
        Confirm new password
        <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required />
      </label>
      {error && <p className="error">{error}</p>}
      {success && <p className="banner banner-success">{success}</p>}
      <button className="btn btn-primary" type="submit" disabled={submitting}>
        {submitting ? 'Changing…' : 'Change Password'}
      </button>
    </form>
  );
}

export default function Account() {
  const { player, updateUser } = usePlayerAuth();
  useSetBreadcrumbs([{ label: 'Home', to: '/' }, { label: 'My Account' }]);

  if (!player) return <p>Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>My Account</h1>
          <p className="muted">
            {player.role === 'admin' ? 'Player & admin account' : 'Player account'}
            {player.playerId && (
              <> · <Link to={`/players/${player.playerId}`}>View my stats &amp; match history</Link></>
            )}
          </p>
        </div>
      </div>

      <ProfileForm player={player} onSaved={updateUser} />
      <ChangePasswordForm />
    </div>
  );
}
