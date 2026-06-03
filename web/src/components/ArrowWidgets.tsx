import { ARROW_PATH, ARROW_VB, DIRECTIONS } from './arrows.ts';
import type { FacingDirection } from '../platform/index.ts';
import { getAllowedArrowDegs } from '../lib/directions.ts';

/** Read-only arrow display for a given degree rotation.
 *  When `clamped` is true, a subtle indicator is shown. */
export function ArrowDisplay({ deg, clamped }: { deg: number | null; clamped?: boolean }) {
  if (deg === null || deg === undefined) {
    return <div className="arrow-display no-arrow">&mdash;</div>;
  }
  return (
    <div className="arrow-display" style={{ position: 'relative' }}>
      <svg viewBox={ARROW_VB} width={20} height={20} style={{ fill: 'inherit', transform: `rotate(${deg}deg)` }}>
        <path d={ARROW_PATH} />
      </svg>
      {clamped && (
        <span
          className="arrow-clamped-badge"
          title="Arrow adjusted — destination is behind this sign face"
        >
          !
        </span>
      )}
    </div>
  );
}

/** 3x3 arrow direction picker grid.
 *  When `facing` is provided, arrows that point behind the sign are disabled. */
export function ArrowPicker({
  value,
  onChange,
  facing,
}: {
  value: number | null;
  onChange: (deg: number | null) => void;
  facing?: FacingDirection;
}) {
  const allowed = facing ? getAllowedArrowDegs(facing) : null;

  return (
    <div className="arrow-picker-grid">
      {DIRECTIONS.map((d, i) => {
        const isNone = d.deg === null;
        const isSelected = isNone
          ? value === null || value === undefined
          : Number(value) === d.deg;
        const isDisabled = !isNone && allowed !== null && !allowed.has(d.deg!);

        if (isNone) {
          return (
            <button
              key={i}
              type="button"
              className={`arrow-pick-btn no-arrow-btn${isSelected ? ' selected' : ''}`}
              onClick={() => onChange(null)}
              title="No arrow"
            >
              &mdash;
            </button>
          );
        }

        return (
          <button
            key={i}
            type="button"
            className={`arrow-pick-btn${isSelected ? ' selected' : ''}${isDisabled ? ' disabled-arrow' : ''}`}
            onClick={() => {
              if (!isDisabled) onChange(d.deg);
            }}
            title={isDisabled ? 'Behind sign face' : d.label}
            disabled={isDisabled}
          >
            <svg
              viewBox={ARROW_VB}
              width={14}
              height={14}
              style={{ fill: 'inherit', transform: `rotate(${d.deg}deg)` }}
            >
              <path d={ARROW_PATH} />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
