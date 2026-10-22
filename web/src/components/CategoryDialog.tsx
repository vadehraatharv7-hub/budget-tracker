import { useState, type FormEvent } from 'react';
import { Dialog } from './Dialog';
import { CategoryIcon } from './CategoryIcon';
import { CATEGORY_COLORS, CATEGORY_ICONS, CATEGORY_ICON_SLUGS } from '@/lib/categoryIcons';
import type { Category } from '@/lib/types';

interface Props {
  open: boolean;
  category: Category | null; // null = creating
  onClose: () => void;
  onSave: (values: { name: string; icon: string; color: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function CategoryDialog({ open, category, onClose, onSave, onDelete }: Props) {
  return (
    <Dialog open={open} title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      {open && <Form key={category?.id ?? 'new'} category={category} onClose={onClose} onSave={onSave} onDelete={onDelete} />}
    </Dialog>
  );
}

function Form({ category, onClose, onSave, onDelete }: Omit<Props, 'open'>) {
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? 'tag');
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0]!);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    await onSave({ name: name.trim(), icon, color });
    setBusy(false);
    onClose();
  };

  return (
    <form onSubmit={submit}>
      <div className="dialog__body">
        <div className="row-flex">
          <CategoryIcon slug={icon} color={color} />
          <label className="field" style={{ flex: 1 }}>
            <span className="field__label">Name</span>
            <input className="input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} required />
          </label>
        </div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label">Icon</legend>
          <div className="icon-grid">
            {CATEGORY_ICON_SLUGS.map((slug) => {
              const Icon = CATEGORY_ICONS[slug]!;
              return (
                <button key={slug} type="button" aria-pressed={icon === slug} aria-label={slug.replace(/-/g, ' ')} onClick={() => setIcon(slug)}>
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="field__label">Colour</legend>
          <div className="swatches">
            {CATEGORY_COLORS.map((c) => (
              <button key={c} type="button" className="swatch" aria-label={`Colour ${c}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} />
            ))}
          </div>
        </fieldset>
      </div>
      <div className="dialog__footer">
        {onDelete && (
          <button
            type="button"
            className="btn btn--danger"
            onClick={async () => {
              if (!window.confirm(`Remove "${category?.name}"? Past transactions keep their data.`)) return;
              await onDelete();
              onClose();
            }}
          >
            Remove
          </button>
        )}
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
          Save
        </button>
      </div>
    </form>
  );
}
