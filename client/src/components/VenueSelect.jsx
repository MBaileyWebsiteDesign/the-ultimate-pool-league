import { useEffect, useState } from 'react';
import { api } from '../api.js';

const OTHER = '__other__';

// A dropdown of admin-approved venues, plus a "not listed" escape hatch that
// reveals a free-text field. Typing a name that isn't already approved is
// submitted as-is when the surrounding form saves (registration or profile
// update) - the server auto-queues it as a pending venue request (see
// ensureVenue in server/src/index.js), so there's no separate "submit
// request" button here.
export default function VenueSelect({ value, onChange }) {
  const [venues, setVenues] = useState(null);
  const [useOther, setUseOther] = useState(false);

  useEffect(() => {
    api.getVenues().then(setVenues).catch(() => setVenues({ approved: [], mine: [] }));
  }, []);

  const approved = venues?.approved || [];
  const matchesApproved = value && approved.some((v) => v.name.toLowerCase() === value.toLowerCase());
  const showOtherBox = useOther || (!!value && !matchesApproved);
  const pendingMine = (venues?.mine || []).filter((v) => v.status === 'pending');

  if (showOtherBox) {
    return (
      <div>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Venue name"
          required
        />
        {approved.length > 0 && (
          <button
            type="button"
            className="btn-link"
            onClick={() => { setUseOther(false); onChange(''); }}
          >
            choose from the list instead
          </button>
        )}
        <p className="muted" style={{ marginTop: 4, fontSize: '0.8rem' }}>
          Not in the list yet? This is saved as your venue right away and submitted for admin approval
          so it can be added to the shared list.
        </p>
      </div>
    );
  }

  return (
    <div>
      <select
        value={value || ''}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setUseOther(true);
            onChange('');
          } else {
            onChange(e.target.value);
          }
        }}
        required
      >
        <option value="" disabled>{venues ? 'Select a venue…' : 'Loading venues…'}</option>
        {approved.map((v) => (
          <option key={v.id} value={v.name}>{v.name}</option>
        ))}
        <option value={OTHER}>+ My venue isn't listed…</option>
      </select>
      {pendingMine.length > 0 && (
        <p className="muted" style={{ marginTop: 4, fontSize: '0.8rem' }}>
          Awaiting admin approval: {pendingMine.map((v) => v.name).join(', ')}
        </p>
      )}
    </div>
  );
}
