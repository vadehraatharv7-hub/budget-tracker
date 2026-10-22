import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Plus, Receipt, Search } from 'lucide-react';
import { Card } from '@/components/Card';
import { CategoryIcon } from '@/components/CategoryIcon';
import { EmptyState } from '@/components/EmptyState';
import { useEntryDialog } from '@/components/EntryDialog';
import { PageHeader } from '@/components/PageHeader';
import { PeriodPicker } from '@/components/PeriodPicker';
import { useAppState, useExpenses, useIncome, useMonth } from '@/hooks/data';
import { dayLabel, shortDate } from '@/lib/dates';
import { formatMoney, formatNumber } from '@/lib/money';
import type { Category, Currency, Expense, Income, Kind } from '@/lib/types';

interface Row {
  key: string;
  kind: Kind;
  id: number;
  date: string;
  title: string;
  categoryId: number | null;
  amountBase: number;
  amount: number;
  currency: Currency;
  source: string;
  expense?: Expense;
  income?: Income;
}

const toRows = (expenses: Expense[], income: Income[]): Row[] => [
  ...expenses.map((e): Row => ({ key: `e${e.id}`, kind: 'expense', id: e.id, date: e.date, title: e.note, categoryId: e.category_id, amountBase: e.amount_base, amount: e.amount, currency: e.currency, source: e.source, expense: e })),
  ...income.map((i): Row => ({ key: `i${i.id}`, kind: 'income', id: i.id, date: i.date, title: i.source, categoryId: null, amountBase: i.amount_base, amount: i.amount, currency: i.currency, source: 'app', income: i })),
];

const SOURCE_LABEL: Record<string, string> = { shortcut: 'Shortcut', recurring: 'Recurring', import: 'Imported' };

export function Transactions() {
  const [month, setMonth] = useMonth();
  const [params, setParams] = useSearchParams();
  const { data: state } = useAppState();
  const expenses = useExpenses(month);
  const income = useIncome(month);
  const { open } = useEntryDialog();
  const [query, setQuery] = useState('');
  const [currency, setCurrency] = useState<'all' | Currency>('all');
  const category = params.get('c') ?? 'all';
  const base = state?.settings.base_currency ?? 'DKK';
  const cats = state?.categories ?? [];
  const catById = (id: number | null) => cats.find((c) => c.id === id);

  const setCategory = (c: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (c === 'all') next.delete('c');
      else next.set('c', c);
      return next;
    }, { replace: true });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return toRows(expenses.data ?? [], income.data ?? [])
      .filter((r) => (category === 'all' ? true : category === 'none' ? r.kind === 'expense' && r.categoryId === null : r.categoryId === Number(category)))
      .filter((r) => currency === 'all' || r.currency === currency)
      .filter((r) => !q || `${r.title} ${catById(r.categoryId)?.name ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => (a.date === b.date ? b.id - a.id : a.date < b.date ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses.data, income.data, category, currency, query, state]);

  const spent = rows.filter((r) => r.kind === 'expense').reduce((t, r) => t + r.amountBase, 0);
  const earned = rows.filter((r) => r.kind === 'income').reduce((t, r) => t + r.amountBase, 0);
  const loading = expenses.isLoading || income.isLoading;
  const editRow = (r: Row) => open({ kind: r.kind, expense: r.expense, income: r.income });

  const days = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return [...map];
  }, [rows]);

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Everything you have spent or received."
        actions={
          <>
            <PeriodPicker month={month} onChange={setMonth} />
            <a className="btn" href="/api/export.csv" download>
              <Download size={16} /> Export
            </a>
            <button type="button" className="btn btn--primary only-desktop" onClick={() => open()}>
              <Plus size={16} /> Add transaction
            </button>
          </>
        }
      />

      <div className="toolbar">
        <div className="input-search input-search--grow" style={{ flex: '1 1 220px' }}>
          <Search size={16} />
          <input className="input" type="search" placeholder="Search description or category" aria-label="Search transactions" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="select" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {cats.map((c: Category) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value="none">Uncategorised</option>
        </select>
        <select className="select" aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as 'all' | Currency)}>
          <option value="all">All currencies</option>
          <option value="DKK">DKK</option>
          <option value="INR">INR</option>
        </select>
      </div>

      <Card flush>
        {loading ? (
          <div className="skeleton" style={{ height: 240, margin: 16 }} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={(expenses.data?.length ?? 0) + (income.data?.length ?? 0) === 0 ? 'No transactions this month' : 'No matching transactions'}
            action={
              <button className="btn btn--primary" onClick={() => open()}>
                <Plus size={16} /> Add transaction
              </button>
            }
          >
            {(expenses.data?.length ?? 0) + (income.data?.length ?? 0) === 0 ? 'Add one to start tracking this month.' : 'Try a different search or clear a filter.'}
          </EmptyState>
        ) : (
          <>
            <div className="only-desktop">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="num">Amount ({base})</th>
                    <th className="num hide-sm">Original</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const c = catById(r.categoryId);
                    return (
                      <tr key={r.key} data-clickable="true" tabIndex={0} onClick={() => editRow(r)} onKeyDown={(e) => e.key === 'Enter' && editRow(r)}>
                        <td className="num" style={{ whiteSpace: 'nowrap', color: 'var(--text-2)', textAlign: 'left' }}>
                          {shortDate(r.date)}
                        </td>
                        <td>
                          <span style={{ fontWeight: 500 }}>{r.title || (r.kind === 'income' ? 'Income' : c?.name ?? 'Expense')}</span>{' '}
                          {SOURCE_LABEL[r.source] && <span className="badge">{SOURCE_LABEL[r.source]}</span>}
                        </td>
                        <td>
                          {r.kind === 'income' ? (
                            <span className="badge badge--pos">Income</span>
                          ) : c ? (
                            <div className="cat-name">
                              <CategoryIcon slug={c.icon} color={c.color} size="sm" />
                              <span style={{ fontWeight: 400 }}>{c.name}</span>
                            </div>
                          ) : (
                            <span className="faint">Uncategorised</span>
                          )}
                        </td>
                        <td className={`num${r.kind === 'income' ? ' amount-pos' : ''}`} style={{ fontWeight: 500 }}>
                          {r.kind === 'income' ? '+' : ''}
                          {formatNumber(r.amountBase, base, 2)}
                        </td>
                        <td className="num hide-sm faint">{r.currency !== base ? formatMoney(r.amount, r.currency, 2) : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="tx-list only-mobile">
              {days.map(([date, list]) => (
                <div key={date}>
                  <div className="tx-day">
                    <span>{dayLabel(date)}</span>
                    <span className="num">{formatMoney(list.filter((r) => r.kind === 'expense').reduce((t, r) => t + r.amountBase, 0), base)}</span>
                  </div>
                  {list.map((r) => {
                    const c = catById(r.categoryId);
                    return (
                      <button key={r.key} type="button" className="tx-row" onClick={() => editRow(r)}>
                        {r.kind === 'income' ? <span className="cat-icon" style={{ background: 'var(--pos-soft)', color: 'var(--pos)' }}>+</span> : <CategoryIcon slug={c?.icon ?? 'tag'} color={c?.color ?? '#8b8a85'} />}
                        <span className="tx-row__main">
                          <div className="tx-row__title">{r.title || (r.kind === 'income' ? 'Income' : c?.name ?? 'Expense')}</div>
                          <div className="small faint">
                            {r.kind === 'income' ? 'Income' : c?.name ?? 'Uncategorised'}
                            {SOURCE_LABEL[r.source] ? ` · ${SOURCE_LABEL[r.source]}` : ''}
                          </div>
                        </span>
                        <span className={`tx-row__amount num${r.kind === 'income' ? ' amount-pos' : ''}`}>
                          {r.kind === 'income' ? '+' : ''}
                          {formatMoney(r.amountBase, base)}
                          {r.currency !== base && <small>{formatMoney(r.amount, r.currency)}</small>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="list-row small muted" style={{ borderTop: '1px solid var(--border)' }}>
              <span>{rows.length} {rows.length === 1 ? 'transaction' : 'transactions'}</span>
              <span className="num">
                Spent {formatMoney(spent, base)}
                {earned > 0 ? ` · Income ${formatMoney(earned, base)}` : ''}
              </span>
            </div>
          </>
        )}
      </Card>
    </>
  );
}
