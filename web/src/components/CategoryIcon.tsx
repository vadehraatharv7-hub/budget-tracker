import { iconFor } from '@/lib/categoryIcons';

interface Props {
  slug: string;
  color: string;
  size?: 'sm' | 'md';
}

/** Category glyph on a soft tint of its colour. Colour only marks identity; it is never the sole signal. */
export function CategoryIcon({ slug, color, size = 'md' }: Props) {
  const Icon = iconFor(slug);
  return (
    <span className={`cat-icon${size === 'sm' ? ' cat-icon--sm' : ''}`} style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }} aria-hidden="true">
      <Icon size={size === 'sm' ? 14 : 17} strokeWidth={1.9} />
    </span>
  );
}
