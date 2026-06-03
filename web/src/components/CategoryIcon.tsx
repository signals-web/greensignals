import { Icon } from '@iconify/react';
import type { SignCategory } from '../platform/index.ts';

/** Category → color + Phosphor icon mapping for sign type differentiation. */
export const CATEGORY_META: Record<
  SignCategory,
  { color: string; icon: string; label: string }
> = {
  identification: { color: 'var(--cat-identification)', icon: 'ph:buildings-bold', label: 'ID' },
  directional:    { color: 'var(--cat-directional)',    icon: 'ph:signpost-bold',   label: 'D' },
  regulatory:     { color: 'var(--cat-regulatory)',     icon: 'ph:shield-warning-bold', label: 'R' },
  informational:  { color: 'var(--cat-informational)',  icon: 'ph:info-bold',       label: 'IN' },
};

/** Inline icon for each sign category with distinct color. */
export function CategoryIcon({ category, size = 18 }: { category: SignCategory; size?: number }) {
  const meta = CATEGORY_META[category];
  if (!meta) return null;
  return (
    <Icon
      icon={meta.icon}
      width={size}
      height={size}
      style={{ color: meta.color, flexShrink: 0 }}
    />
  );
}
