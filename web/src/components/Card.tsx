import type { ReactNode } from 'react';

interface Props {
  title?: string;
  meta?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}

export function Card({ title, meta, children, flush, className }: Props) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {title && (
        <div className="card__header">
          <h2>{title}</h2>
          {meta && <div className="small faint">{meta}</div>}
        </div>
      )}
      <div className={flush ? 'card__body card__body--flush' : 'card__body'}>{children}</div>
    </section>
  );
}
