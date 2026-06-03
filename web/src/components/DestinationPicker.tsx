// ─── Destination picker — type-ahead for the SignCard edit row ─────────────
//
// Replaces the free-text "Destination name..." input in SignCard's edit
// table with a hybrid: users can still type a free-text name for ad-hoc
// destinations that don't warrant a first-class record, OR select from
// the project's existing DestinationPlace records. Selecting a record
// links the row via `destinationPlaceId`, which unlocks scoring and
// downstream wiring.
//
// Editing the text after linking breaks the link: typing any edit sets
// `destinationPlaceId` back to undefined unless the text still matches
// the linked record's name exactly. Keeps the rule simple — the text
// field is the source of truth for display, the link is a separate
// binding users opt into.

import { useEffect, useRef, useState } from 'react';
import type { DestinationPlace } from '../platform/index.ts';

interface Props {
  value: string;
  destinationPlaceId?: string;
  destinations: DestinationPlace[];
  onChange: (next: { name: string; destinationPlaceId?: string }) => void;
  placeholder?: string;
}

export function DestinationPicker({
  value,
  destinationPlaceId,
  destinations,
  onChange,
  placeholder,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click — matches LocationSearch's pattern.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Filter: destinations whose name contains the query, case-insensitive,
  // case-insensitive prefix first then substring. Archived records are
  // filtered out upstream but we defensively exclude here too.
  const query = value.trim().toLowerCase();
  const active = destinations.filter((d) => !d.archivedAt);
  const matches = query
    ? active
        .filter((d) => d.name.toLowerCase().includes(query))
        .sort((a, b) => {
          const aStarts = a.name.toLowerCase().startsWith(query);
          const bStarts = b.name.toLowerCase().startsWith(query);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 8)
    : active.slice(0, 8);

  const linkedPlace = destinationPlaceId
    ? destinations.find((d) => d.id === destinationPlaceId)
    : null;

  const handleInput = (next: string) => {
    // Typing breaks the link unless the text still matches the linked
    // record exactly — keeps the "is this still linked?" mental model
    // predictable.
    if (linkedPlace && next.trim() !== linkedPlace.name) {
      onChange({ name: next });
    } else {
      onChange({
        name: next,
        ...(destinationPlaceId && { destinationPlaceId }),
      });
    }
  };

  const handlePick = (dest: DestinationPlace) => {
    onChange({ name: dest.name, destinationPlaceId: dest.id });
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleUnlink = () => {
    onChange({ name: value });
  };

  return (
    <div className="dest-picker" ref={wrapRef}>
      <input
        ref={inputRef}
        className="edit-input"
        value={value}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? 'Destination name...'}
      />
      {destinationPlaceId && (
        <button
          type="button"
          className="dest-picker-linked-chip"
          onClick={handleUnlink}
          title="Unlink from destination database"
        >
          {'\u2317'} linked
        </button>
      )}
      {open && matches.length > 0 && (
        <ul className="dest-picker-results">
          {matches.map((dest) => (
            <li
              key={dest.id}
              className={`dest-picker-item${
                dest.id === destinationPlaceId ? ' active' : ''
              }`}
              onClick={() => handlePick(dest)}
            >
              <span className="dest-picker-name">{dest.name}</span>
              <span className="dest-picker-meta">
                {dest.tier}
                {dest.district ? ` · ${dest.district}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
