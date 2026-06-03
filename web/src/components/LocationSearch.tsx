import { useState, useCallback, useRef, useEffect } from 'react';

interface SearchResult {
  id: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
}

interface Props {
  onSelect: (lat: number, lng: number, name: string) => void;
  maptilerKey: string;
}

/**
 * Location search using MapTiler Geocoding API.
 * Lets the user search for a city/address/campus to center the map.
 */
export function LocationSearch({ onSelect, maptilerKey }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback(
    (q: string) => {
      if (!q.trim() || !maptilerKey) {
        setResults([]);
        return;
      }
      setLoading(true);
      const base = import.meta.env.DEV ? '/maptiler' : 'https://api.maptiler.com';
      fetch(
        `${base}/geocoding/${encodeURIComponent(q)}.json?key=${maptilerKey}&limit=5`,
      )
        .then((r) => r.json())
        .then((data: any) => {
          const features = data.features ?? [];
          setResults(
            features.map((f: any) => ({
              id: f.id,
              place_name: f.place_name,
              center: f.center as [number, number],
            })),
          );
          setOpen(true);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    },
    [maptilerKey],
  );

  const handleInput = useCallback(
    (value: string) => {
      setQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => search(value), 300);
    },
    [search],
  );

  const handleSelect = useCallback(
    (r: SearchResult) => {
      const [lng, lat] = r.center;
      setQuery(r.place_name);
      setOpen(false);
      setResults([]);
      onSelect(lat, lng, r.place_name);
    },
    [onSelect],
  );

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setOpen(false);
  }, []);

  return (
    <div className="loc-search" ref={wrapRef}>
      <input
        className="loc-search-input"
        type="text"
        value={query}
        onChange={(e) => handleInput(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search location…"
      />
      {loading && <div className="loc-search-spinner" />}
      {!loading && query && (
        <button
          className="loc-search-clear"
          onClick={handleClear}
          title="Clear search"
          type="button"
        >
          ×
        </button>
      )}
      {open && results.length > 0 && (
        <ul className="loc-search-results">
          {results.map((r) => (
            <li
              key={r.id}
              className="loc-search-item"
              onClick={() => handleSelect(r)}
            >
              {r.place_name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
