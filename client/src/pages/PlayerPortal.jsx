import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../AuthContext.jsx';
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

function MyFixtures() {
  const [fixtures, setFixtures] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getMyFixtures().then(setFixtures).catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!fixtures) return <p>Loading…</p>;

  const upcoming = fixtures.filter((f) => f.status !== 'completed');
  const recent = fixtures.filter((f) => f.status === 'completed').slice(-10).reverse();

  return (
    <section className="card">
      <h2>My Fixtures</h2>
      {fixtures.length === 0 && (
        <p className="muted">You're not registered in any division or team yet - an admin or captain can add you from Manage Users / a division's roster.</p>
      )}

      {upcoming.length > 0 && (
        <>
          <h3 style={{ fontSize: '1rem', color: 'var(--muted)' }}>Upcoming</h3>
          <ul className="fixture-list">
            {upcoming.map((f) => (
              <li key={f.id}>
                <Link to={`/fixtures/${f.id}`}>
                  {f.leagueName} · {f.divisionName} · Round {f.round} vs {f.opponentName}
                </Link>
                <span className="muted">{f.scheduledDate || 'date TBC'}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {recent.length > 0 && (
        <>
          <h3 style={{ fontSize: '1rem', color: 'var(--muted)' }}>Recent results</h3>
          <ul className="fixture-list">
            {recent.map((f) => (
              <li key={f.id}>
                <Link to={`/fixtures/${f.id}`}>
                  {f.leagueName} · {f.divisionName} · Round {f.round} vs {f.opponentName}
                </Link>
                <span className="status status-completed">completed</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// The Player Management Portal - every account's home base: profile details,
// password, and a personal fixture list (upcoming + recent results) across
// every division/team they're registered in. Admins and captains land here
// too via "My Account" in the header; their extra Admin/Captain Portal links
// sit alongside this rather than replacing it, since every account is a
// player account first.
export default function PlayerPortal() {
  const { user, updateUser } = useAuth();
  useSetBreadcrumbs([{ label: 'Home', to: '/' }, { label: 'My Account' }]);

  if (!user) return <p>Loading…</p>;

  const badges = [user.isAdmin && 'Admin', user.isCaptain && 'Captain'].filter(Boolean);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>My Account</h1>
          <p className="muted">
            {badges.length > 0 ? `Player account · ${badges.join(' & ')}` : 'Player account'}
            {user.playerId && (
              <> · <Link to={`/players/${user.playerId}`}>View my stats &amp; match history</Link></>
            )}
          </p>
        </div>
      </div>

      <MyFixtures />
      <ProfileForm player={user} onSaved={updateUser} />
      <ChangePasswordForm />
    </div>
  );
}
