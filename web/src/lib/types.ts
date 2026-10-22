export type Currency = 'DKK' | 'INR';
export type Kind = 'expense' | 'income';

export interface Category {
  id: number;
  name: string;
  icon: string;
  color: string;
  budget: number;
  sort: number;
  archived: number;
}

export interface Settings {
  base_currency: Currency;
  monthly_budget: number;
  daily_reminder: boolean;
  reminder_time: string;
  weekly_recap: boolean;
  alert_thresholds: boolean;
  rate_override: number | null;
}

export interface Rate {
  dkk_inr: number;
  date: string;
  fetched_at: string | null;
  override?: boolean;
}

export interface AppState {
  settings: Settings;
  apiToken: string;
  categories: Category[];
  rate: Rate | null;
  vapidPublicKey: string;
  pushDevices: number;
  today: string;
  usage: number[];
}

export interface Expense {
  id: number;
  date: string;
  amount: number;
  currency: Currency;
  amount_base: number;
  rate: number;
  category_id: number | null;
  note: string;
  source: string;
  created_at: string;
}

export interface Income {
  id: number;
  date: string;
  amount: number;
  currency: Currency;
  amount_base: number;
  rate: number;
  source: string;
  created_at: string;
}

export interface CategorySummary {
  id: number | null;
  name: string;
  icon: string;
  color: string;
  budget: number;
  spent: number;
  prev: number;
  count: number;
  pct: number | null;
  remaining: number | null;
  projected: number;
}

export interface DailyPoint {
  day: number;
  date: string;
  spent: number;
  cum: number;
  ideal: number | null;
  future: boolean;
}

export interface Insight {
  kind: 'good' | 'warn' | 'bad' | 'info';
  text: string;
}

export interface Summary {
  month: string;
  base: Currency;
  isCurrent: boolean;
  dim: number;
  dayNow: number;
  daysLeft: number;
  budget: number;
  allocated: number;
  unallocated: number;
  spent: number;
  spentToday: number;
  income: number;
  net: number;
  remaining: number;
  prevSpent: number;
  projected: number;
  allowance: number | null;
  avgDaily: number;
  noSpendDays: number;
  pace: number | null;
  categories: CategorySummary[];
  daily: DailyPoint[];
  trend: { month: string; spent: number }[];
  topNotes: { name: string; total: number; count: number }[];
  insights: Insight[];
}

export interface Recurring {
  id: number;
  kind: Kind;
  amount: number;
  currency: Currency;
  category_id: number | null;
  note: string;
  day: number;
  active: number;
  last_run: string | null;
}

export interface Goal {
  id: number;
  name: string;
  icon: string;
  target: number;
  saved: number;
  deadline: string | null;
}

export interface RatesPayload {
  current: Rate | null;
  history: { date: string; dkk_inr: number }[];
}

export interface NewEntry {
  amount: string;
  currency: Currency;
  category_id?: number | null;
  category?: number | null;
  note?: string;
  source?: string;
  date?: string;
}
