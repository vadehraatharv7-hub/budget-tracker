export type ThemeChoice = 'auto' | 'light' | 'dark';
const KEY = 'bt_theme'; // same key (JSON-encoded) as the previous version of the app

export function getTheme(): ThemeChoice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as unknown;
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(choice: ThemeChoice = getTheme()): void {
  const root = document.documentElement;
  if (choice === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = choice;
}

export function setTheme(choice: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choice));
  } catch {
    /* ignore */
  }
  applyTheme(choice);
}
