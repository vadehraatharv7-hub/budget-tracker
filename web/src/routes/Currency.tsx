import { useState } from 'react';
import { ArrowDownUp, RefreshCw } from 'lucide-react';
import { Card } from '@/components/Card';
import { PageHeader } from '@/components/PageHeader';
import { RateChart } from '@/components/charts/RateChart';
import { useAction } from '@/hooks/useAction';
import { useRates } from '@/hooks/data';
import { api } from '@/lib/api';
import { convert, parseAmount } from '@/lib/money';
import type { Currency as Cur, RatesPayload } from '@/lib/types';

export function Currency() {
  const { data, isLoading } = useRates();
  const run = useAction();
  const [from, setFrom] = useState<Cur>('DKK');
  const [amount, setAmount] = useState('1000');
  const [manual, setManual] = useState('');
  const rate = data?.current ?? null;
  const to: Cur = from === 'DKK' ? 'INR' : 'DKK';
  const value = parseAmount(amount);
  const result = rate && Number.isFinite(value) ? convert(value, from, to, rate.dkk_inr) : null;
  const history = (data?.history ?? []).map((h) => ({ date: h.date, value: h.dkk_inr }));
  const first = history[0];
  const change = rate && first && history.length > 3 ? ((rate.dkk_inr - first.value) / first.value) * 100 : null;

  if (isLoading) return <div className="skeleton" style={{ height: 320 }} />;

  return (
    <>
      <PageHeader title="Currency" description="Convert between Danish kroner and Indian rupees." />
      {!rate ? (
        <Card>
          <div className="empty">
            <h3>No exchange rate yet</h3>
            <p>The server needs internet access once to fetch it. You can also enter your own rate below.</p>
            <button className="btn btn--primary" onClick={() => void run(() => api<RatesPayload>('/api/rates/refresh', { method: 'POST' }), 'Rate updated.')}>
              <RefreshCw size={16} /> Fetch now
            </button>
          </div>
        </Card>
      ) : (
        <div className="two-col">
          <div>
            <Card title="Converter">
              <div className="convert-box">
                <label htmlFor="conv-from">{from === 'DKK' ? 'Danish krone (DKK)' : 'Indian rupee (INR)'}</label>
                <input id="conv-from" className="num" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <button type="button" className="convert-swap" aria-label="Swap currencies" onClick={() => setFrom(to)}>
                <ArrowDownUp size={15} />
              </button>
              <div className="convert-box">
                <label htmlFor="conv-to">{to === 'DKK' ? 'Danish krone (DKK)' : 'Indian rupee (INR)'}</label>
                <input id="conv-to" className="num" readOnly value={result === null ? '' : new Intl.NumberFormat(to === 'INR' ? 'en-IN' : 'en-GB', { maximumFractionDigits: 2 }).format(result)} />
              </div>
              <div className="quick">
                {[100, 500, 1000, 5000, 10000].map((n) => (
                  <button key={n} type="button" className="btn btn--sm" onClick={() => setAmount(String(n))}>
                    {n.toLocaleString('en-GB')}
                  </button>
                ))}
              </div>
            </Card>
            <Card title="Use your own rate" meta="Optional">
              <p className="muted" style={{ marginBottom: 12 }}>
                Your bank rarely matches the reference rate. Enter what you actually get (INR per 1 DKK) and new transactions will use it.
              </p>
              <div className="row-flex">
                <input className="input input--num" inputMode="decimal" placeholder={rate.dkk_inr.toFixed(2)} value={manual || (rate.override ? String(rate.dkk_inr) : '')} onChange={(e) => setManual(e.target.value)} aria-label="INR per DKK" />
                <button className="btn btn--primary" onClick={() => void run(() => api('/api/settings', { method: 'PUT', body: { rate_override: manual || (rate.override ? String(rate.dkk_inr) : '') } }), 'Your rate is in use.')}>
                  Use
                </button>
                {rate.override && (
                  <button className="btn" onClick={() => void run(() => api('/api/settings', { method: 'PUT', body: { rate_override: null } }), 'Back to the market rate.')}>
                    Reset
                  </button>
                )}
              </div>
            </Card>
          </div>
          <div>
            <Card
              title="Exchange rate"
              meta={
                <button type="button" className="btn btn--sm" onClick={() => void run(() => api<RatesPayload>('/api/rates/refresh', { method: 'POST' }), 'Rate updated.')}>
                  <RefreshCw size={14} /> Refresh
                </button>
              }
            >
              <div className="row-flex" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span className="num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}>
                  1 DKK = {'₹'}
                  {rate.dkk_inr.toFixed(2)}
                </span>
                {change !== null && (
                  <span className={`badge ${change >= 0 ? 'badge--pos' : 'badge--warn'}`}>
                    {change >= 0 ? '+' : '−'}
                    {Math.abs(change).toFixed(1)}% over {history.length} days
                  </span>
                )}
              </div>
              <p className="small muted num" style={{ margin: '4px 0 16px' }}>
                1 INR = {(1 / rate.dkk_inr).toFixed(4)} DKK {'·'} {rate.override ? 'Your manual rate' : `European Central Bank reference rate, ${rate.date}`}
              </p>
              <RateChart points={history} />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
