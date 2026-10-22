import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Native <dialog>: focus trapping, Escape to close and the backdrop come from the browser. */
export function Dialog({ open, title, onClose, children, footer }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          <div className="dialog__header">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Close" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
          {children}
          {footer && <div className="dialog__footer">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
