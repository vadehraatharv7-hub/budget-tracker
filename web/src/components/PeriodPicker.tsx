import { ChevronLeft, ChevronRight } from 'lucide-react';
import { currentMonth, monthLabel, shiftMonth } from '@/lib/dates';

interface Props {
  month: string;
  onChange: (month: string) => void;
}

export function PeriodPicker({ month, onChange }: Props) {
  const now = currentMonth();
  return (
    <div className="seg" role="group" aria-label="Period" style={{ alignItems: 'center' }}>
      <button type="button" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))} style={{ padding: '0 6px' }}>
        <ChevronLeft size={16} />
      </button>
      <button type="button" onClick={() => onChange(now)} style={{ minWidth: 128 }} aria-label={`${monthLabel(month)}. Go to current month`}>
        {monthLabel(month)}
      </button>
      <button type="button" aria-label="Next month" disabled={month >= now} onClick={() => onChange(shiftMonth(month, 1))} style={{ padding: '0 6px', opacity: month >= now ? 0.35 : 1 }}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
