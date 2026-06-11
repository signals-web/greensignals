import { useState, useCallback, useRef, useMemo } from 'react';
import Papa from 'papaparse';
import type {
  SignType,
  Building,
  FacingDirection,
} from '../platform/index.ts';
import { addInstance, getInstances, updateInstance } from '../lib/instances.ts';
import { parseBuildingsCsv } from '../lib/parseBuildingsCsv.ts';
import { mapHeaders, remapRow } from '../lib/csvHeaders.ts';

// ─── Types ──────────────────────────────────────────────────────────────────

type TabId = 'buildings' | 'destinations' | 'schedule';

interface Props {
  signTypes: Record<string, SignType>;
  onClose: () => void;
  /** Called after buildings are imported so App can persist them. */
  onBuildingsImported: (buildings: Building[]) => void;
}

// Validation result wrappers
interface ParsedBuilding {
  row: number;
  building: Building;
}

interface BuildingRejection {
  row: number;
  reason: string;
}

interface ParsedDestination {
  row: number;
  signCode: string;
  destinationName: string;
  arrowDeg: number | null;
  walkTime?: string;
  matched: boolean;
  instanceId?: string;
}

interface ParsedScheduleItem {
  row: number;
  signCode: string;
  typeCode: string;
  locationDescription: string;
  facingDirection?: FacingDirection;
  matched: boolean;
  signTypeId?: string;
}

// Header-name normalization (HEADER_ALIASES / mapHeaders / remapRow)
// lives in ../lib/csvHeaders.ts — extracted for end-to-end import tests.

// ─── Arrow direction parsing ────────────────────────────────────────────────

const DIRECTION_TO_DEG: Record<string, number> = {
  n: 270, north: 270, up: 270,
  ne: 315, northeast: 315,
  e: 0, east: 0, right: 0,
  se: 45, southeast: 45,
  s: 90, south: 90, down: 90,
  sw: 135, southwest: 135,
  w: 180, west: 180, left: 180,
  nw: 225, northwest: 225,
  'straight': 270, 'ahead': 270,
};

function parseArrowDirection(raw?: string): number | null {
  if (!raw || raw.trim() === '') return null;
  const lower = raw.trim().toLowerCase();
  if (DIRECTION_TO_DEG[lower] !== undefined) return DIRECTION_TO_DEG[lower];
  const num = parseFloat(lower);
  if (!isNaN(num)) return ((num % 360) + 360) % 360;
  return null;
}

const VALID_FACING: Set<string> = new Set(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

function parseFacingDirection(raw?: string): FacingDirection | undefined {
  if (!raw) return undefined;
  const upper = raw.trim().toUpperCase();
  return VALID_FACING.has(upper) ? (upper as FacingDirection) : undefined;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ImportModal({ signTypes, onClose, onBuildingsImported }: Props) {
  const [tab, setTab] = useState<TabId>('buildings');
  const fileRef = useRef<HTMLInputElement>(null);

  // Buildings state
  const [parsedBuildings, setParsedBuildings] = useState<ParsedBuilding[]>([]);
  const [buildingFile, setBuildingFile] = useState<string>('');
  // Phase 6 — track rejected rows so the post-parse panel can render
  // "X imported / Y rejected (with reasons)" instead of silently
  // swallowing the bad rows. Pre-Phase-6 the filter logic just
  // dropped rows on the floor.
  const [buildingRejections, setBuildingRejections] = useState<BuildingRejection[]>([]);

  // Destinations state
  const [parsedDests, setParsedDests] = useState<ParsedDestination[]>([]);
  const [destFile, setDestFile] = useState<string>('');

  // Schedule state
  const [parsedSchedule, setParsedSchedule] = useState<ParsedScheduleItem[]>([]);
  const [scheduleFile, setScheduleFile] = useState<string>('');

  // Import result messages
  const [message, setMessage] = useState<string>('');

  // ── File parsing ──────────────────────────────────────────────────────

  const handleFile = useCallback(
    (file: File) => {
      setMessage('');
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const result = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h: string) => h.trim(),
        });

        if (result.errors.length > 0) {
          setMessage(`CSV parse error: ${result.errors[0]?.message ?? 'unknown'}`);
          return;
        }

        const rawHeaders = result.meta.fields ?? [];
        const headerMap = mapHeaders(rawHeaders);
        const rows = result.data.map((r) => remapRow(r, headerMap));

        if (tab === 'buildings') {
          parseBuildingRows(rows, file.name);
        } else if (tab === 'destinations') {
          parseDestinationRows(rows, file.name);
        } else {
          parseScheduleRows(rows, file.name);
        }
      };
      reader.readAsText(file);
    },
    [tab],
  );

  const parseBuildingRows = (rows: Record<string, string>[], fileName: string) => {
    // Phase 6 — delegate to the pure helper. Required columns:
    // building_name, lat, lng. building_code is now optional with
    // auto-generation as b001, b002, … so a Tufts-shape CSV (Dest
    // ID, Name, Category, Lat, Lng) imports cleanly. Unknown columns
    // are dropped silently; bad rows surface in the rejections list.
    const result = parseBuildingsCsv(rows);
    setParsedBuildings(result.buildings);
    setBuildingRejections(result.rejected);
    setBuildingFile(fileName);
  };

  const parseDestinationRows = (rows: Record<string, string>[], fileName: string) => {
    // Live instances only — a CSV row pointing at a soft-deleted sign
    // should land in the "unmatched" bucket, not resurrect its data.
    const instances = getInstances().filter((i) => !i.archivedAt);
    const idSet = new Set(instances.map((i) => i.id.toLowerCase()));

    const dests: ParsedDestination[] = rows
      .filter((r) => r.sign_code?.trim() && r.destination_name?.trim())
      .map((r, i) => {
        const signCode = r.sign_code!.trim();
        const matchedInst = instances.find(
          (inst) => inst.id.toLowerCase() === signCode.toLowerCase(),
        );
        return {
          row: i + 2,
          signCode,
          destinationName: r.destination_name!.trim(),
          arrowDeg: parseArrowDirection(r.arrow_direction),
          walkTime: r.walk_time?.trim() || undefined,
          matched: idSet.has(signCode.toLowerCase()),
          instanceId: matchedInst?.id,
        };
      });
    setParsedDests(dests);
    setDestFile(fileName);
  };

  const parseScheduleRows = (rows: Record<string, string>[], fileName: string) => {
    // Build code-to-id lookup
    const codeToType: Record<string, SignType> = {};
    for (const st of Object.values(signTypes)) {
      codeToType[st.code.toLowerCase()] = st;
    }

    const items: ParsedScheduleItem[] = rows
      .filter((r) => r.sign_code?.trim() && r.type_code?.trim())
      .map((r, i) => {
        const typeCode = r.type_code!.trim();
        const matchedType = codeToType[typeCode.toLowerCase()];
        return {
          row: i + 2,
          signCode: r.sign_code!.trim(),
          typeCode,
          locationDescription: r.location_description?.trim() ?? '',
          facingDirection: parseFacingDirection(r.facing_direction),
          matched: !!matchedType,
          signTypeId: matchedType?.id,
        };
      });
    setParsedSchedule(items);
    setScheduleFile(fileName);
  };

  // ── Import actions ────────────────────────────────────────────────────

  const importBuildings = useCallback(() => {
    const buildings = parsedBuildings.map((p) => p.building);
    onBuildingsImported(buildings);
    // Phase 6 — include rejection count in the result so designers
    // can see what didn't land at a glance. The rejection list itself
    // is already rendered in the preview pane.
    const rejCount = buildingRejections.length;
    const rejNote =
      rejCount > 0
        ? ` ${rejCount} row${rejCount !== 1 ? 's' : ''} rejected (see preview).`
        : '';
    setMessage(
      `Imported ${buildings.length} building${buildings.length !== 1 ? 's' : ''}.${rejNote}`,
    );
    setParsedBuildings([]);
    setBuildingRejections([]);
    setBuildingFile('');
  }, [parsedBuildings, buildingRejections, onBuildingsImported]);

  const importDestinations = useCallback(() => {
    // Group destinations by instance
    const byInstance = new Map<string, ParsedDestination[]>();
    for (const d of parsedDests) {
      if (!d.matched || !d.instanceId) continue;
      const list = byInstance.get(d.instanceId) ?? [];
      list.push(d);
      byInstance.set(d.instanceId, list);
    }

    let updated = 0;
    for (const [instId, dests] of byInstance) {
      const inst = getInstances().find((i) => i.id === instId && !i.archivedAt);
      if (!inst) continue;

      // Build new Side A destinations (append to existing)
      const existing = inst.sides[0]?.destinations ?? [];
      const newDests = dests.map((d) => ({
        arrow: d.arrowDeg,
        name: d.destinationName,
        walkTime: d.walkTime,
      }));

      const updatedSides = inst.sides.length > 0
        ? inst.sides.map((s, idx) =>
            idx === 0
              ? { ...s, destinations: [...existing, ...newDests] }
              : s,
          )
        : [{ label: 'FRONT', destinations: newDests }];

      updateInstance(instId, { sides: updatedSides });
      updated++;
    }

    const matched = parsedDests.filter((d) => d.matched).length;
    const unmatched = parsedDests.length - matched;
    setMessage(
      `Updated ${updated} sign instance${updated !== 1 ? 's' : ''} with ${matched} destination${matched !== 1 ? 's' : ''}.` +
        (unmatched > 0 ? ` ${unmatched} row${unmatched !== 1 ? 's' : ''} skipped (unmatched sign code).` : ''),
    );
    setParsedDests([]);
    setDestFile('');
  }, [parsedDests]);

  const importSchedule = useCallback(() => {
    let created = 0;
    let skipped = 0;

    for (const item of parsedSchedule) {
      if (!item.matched || !item.signTypeId) {
        skipped++;
        continue;
      }
      const st = signTypes[item.signTypeId];
      addInstance(
        item.signTypeId,
        0, // lat — will be 0 until placed on map
        0, // lng
        st?.code,
        {
          id: item.signCode,
          location: item.locationDescription,
          facing: item.facingDirection,
        },
      );
      created++;
    }

    setMessage(
      `Created ${created} sign instance${created !== 1 ? 's' : ''}.` +
        (skipped > 0 ? ` ${skipped} row${skipped !== 1 ? 's' : ''} skipped (unmatched type code).` : ''),
    );
    setParsedSchedule([]);
    setScheduleFile('');
  }, [parsedSchedule, signTypes]);

  // ── Drop zone ─────────────────────────────────────────────────────────

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.csv')) handleFile(file);
    },
    [handleFile],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const handlePick = useCallback(() => {
    fileRef.current?.click();
  }, []);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset so the same file can be re-selected
      e.target.value = '';
    },
    [handleFile],
  );

  // ── Which data is loaded for current tab ──────────────────────────────

  const hasData =
    (tab === 'buildings' && (parsedBuildings.length > 0 || buildingRejections.length > 0)) ||
    (tab === 'destinations' && parsedDests.length > 0) ||
    (tab === 'schedule' && parsedSchedule.length > 0);

  const currentFile =
    tab === 'buildings' ? buildingFile : tab === 'destinations' ? destFile : scheduleFile;

  // Stats
  const destMatched = useMemo(() => parsedDests.filter((d) => d.matched).length, [parsedDests]);
  const destUnmatched = parsedDests.length - destMatched;
  const schedMatched = useMemo(() => parsedSchedule.filter((s) => s.matched).length, [parsedSchedule]);
  const schedUnmatched = parsedSchedule.length - schedMatched;

  return (
    <div className="import-overlay" onClick={onClose}>
      <div className="import-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="import-header">
          <div className="import-title">Import Data</div>
          <button className="import-close" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="import-tabs">
          {(['buildings', 'destinations', 'schedule'] as TabId[]).map((t) => (
            <button
              key={t}
              className={`import-tab${tab === t ? ' active' : ''}`}
              onClick={() => { setTab(t); setMessage(''); }}
            >
              {t === 'buildings' ? 'Buildings' : t === 'destinations' ? 'Destinations' : 'Sign Schedule'}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="import-body">
          {/* Message */}
          {message && (
            <div className="import-message">{message}</div>
          )}

          {/* File drop zone */}
          {!hasData && (
            <div
              className="import-dropzone"
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={handlePick}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                style={{ display: 'none' }}
                onChange={handleInputChange}
              />
              <div className="dropzone-icon">CSV</div>
              <div className="dropzone-text">
                Drop a CSV file here, or click to browse
              </div>
              <div className="dropzone-hint">
                {tab === 'buildings'
                  ? 'Required: building_name, lat, lng. Optional: building_code (auto-generated b001… when missing), floor_count, abbreviation. Extra columns dropped silently.'
                  : tab === 'destinations'
                    ? 'Columns: sign_code, destination_name, arrow_direction, walk_time (optional)'
                    : 'Columns: sign_code, type_code, location_description, facing_direction (optional)'}
              </div>
            </div>
          )}

          {/* Buildings — all-rejected case (no successful imports, only
              rejections). Pre-Phase-6 this would have fallen back to
              the drop zone and looked like nothing happened, so a
              malformed CSV gave zero feedback. */}
          {tab === 'buildings' && parsedBuildings.length === 0 && buildingRejections.length > 0 && (
            <>
              <div className="import-file-name">
                {currentFile} — 0 imported, {buildingRejections.length} rejected
              </div>
              <div className="import-rejection-list" data-testid="building-rejections">
                {buildingRejections.slice(0, 10).map((rej) => (
                  <div key={rej.row} className="import-rejection">
                    Row {rej.row}: {rej.reason}
                  </div>
                ))}
                {buildingRejections.length > 10 && (
                  <div className="import-rejection-more">
                    …and {buildingRejections.length - 10} more
                  </div>
                )}
              </div>
              <div className="import-actions">
                <button
                  className="import-btn secondary"
                  onClick={() => {
                    setParsedBuildings([]);
                    setBuildingRejections([]);
                    setBuildingFile('');
                  }}
                >
                  Clear
                </button>
              </div>
            </>
          )}

          {/* Buildings preview */}
          {tab === 'buildings' && parsedBuildings.length > 0 && (
            <>
              <div className="import-file-name">
                {currentFile} — {parsedBuildings.length} row{parsedBuildings.length !== 1 ? 's' : ''}
                {buildingRejections.length > 0 && (
                  <span className="import-warn">
                    {' '}({buildingRejections.length} rejected)
                  </span>
                )}
              </div>
              {/* Phase 6 — surface rejection reasons so designers can fix
                  their CSV instead of guessing why rows are missing. Pre-
                  Phase-6 rejected rows were dropped silently. */}
              {buildingRejections.length > 0 && (
                <div
                  className="import-rejection-list"
                  data-testid="building-rejections"
                >
                  {buildingRejections.slice(0, 10).map((rej) => (
                    <div key={rej.row} className="import-rejection">
                      Row {rej.row}: {rej.reason}
                    </div>
                  ))}
                  {buildingRejections.length > 10 && (
                    <div className="import-rejection-more">
                      …and {buildingRejections.length - 10} more
                    </div>
                  )}
                </div>
              )}
              <div className="import-table-wrap">
                <table className="import-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>Lat</th>
                      <th>Lng</th>
                      <th>Floors</th>
                      <th>Abbr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedBuildings.map((p) => (
                      <tr key={p.building.id}>
                        <td className="mono">{p.building.code}</td>
                        <td>{p.building.name}</td>
                        <td className="mono">{p.building.lat?.toFixed(5) ?? ''}</td>
                        <td className="mono">{p.building.lng?.toFixed(5) ?? ''}</td>
                        <td>{p.building.floorCount ?? ''}</td>
                        <td>{p.building.abbreviation ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="import-actions">
                <button
                  className="import-btn secondary"
                  onClick={() => {
                    setParsedBuildings([]);
                    setBuildingRejections([]);
                    setBuildingFile('');
                  }}
                >
                  Clear
                </button>
                <button className="import-btn primary" onClick={importBuildings}>
                  Import {parsedBuildings.length} building{parsedBuildings.length !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}

          {/* Destinations preview */}
          {tab === 'destinations' && parsedDests.length > 0 && (
            <>
              <div className="import-file-name">
                {currentFile} — {parsedDests.length} rows
                {destUnmatched > 0 && (
                  <span className="import-warn"> ({destUnmatched} unmatched)</span>
                )}
              </div>
              <div className="import-table-wrap">
                <table className="import-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Sign Code</th>
                      <th>Destination</th>
                      <th>Arrow</th>
                      <th>Walk Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedDests.map((d, i) => (
                      <tr key={i} className={d.matched ? '' : 'row-warn'}>
                        <td>
                          <span className={`import-status ${d.matched ? 'status-ok' : 'status-warn'}`}>
                            {d.matched ? 'OK' : 'No match'}
                          </span>
                        </td>
                        <td className="mono">{d.signCode}</td>
                        <td>{d.destinationName}</td>
                        <td className="mono">{d.arrowDeg !== null ? `${d.arrowDeg}\u00b0` : '--'}</td>
                        <td>{d.walkTime ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="import-actions">
                <button className="import-btn secondary" onClick={() => { setParsedDests([]); setDestFile(''); }}>
                  Clear
                </button>
                <button className="import-btn primary" onClick={importDestinations} disabled={destMatched === 0}>
                  Import {destMatched} destination{destMatched !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}

          {/* Schedule preview */}
          {tab === 'schedule' && parsedSchedule.length > 0 && (
            <>
              <div className="import-file-name">
                {currentFile} — {parsedSchedule.length} rows
                {schedUnmatched > 0 && (
                  <span className="import-warn"> ({schedUnmatched} unmatched type codes)</span>
                )}
              </div>
              <div className="import-table-wrap">
                <table className="import-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Sign Code</th>
                      <th>Type Code</th>
                      <th>Location</th>
                      <th>Facing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedSchedule.map((s, i) => (
                      <tr key={i} className={s.matched ? '' : 'row-warn'}>
                        <td>
                          <span className={`import-status ${s.matched ? 'status-ok' : 'status-warn'}`}>
                            {s.matched ? 'OK' : 'No match'}
                          </span>
                        </td>
                        <td className="mono">{s.signCode}</td>
                        <td className="mono">{s.typeCode}</td>
                        <td>{s.locationDescription}</td>
                        <td className="mono">{s.facingDirection ?? '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="import-actions">
                <button className="import-btn secondary" onClick={() => { setParsedSchedule([]); setScheduleFile(''); }}>
                  Clear
                </button>
                <button className="import-btn primary" onClick={importSchedule} disabled={schedMatched === 0}>
                  Create {schedMatched} instance{schedMatched !== 1 ? 's' : ''}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
