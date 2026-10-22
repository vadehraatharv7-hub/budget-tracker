# Budget Tracker

A self-hosted budget tracker PWA for your homelab. Log expenses and income in **DKK or INR**, split your budget into
**categories**, and watch a *safe-to-spend-per-day* number tell you whether you're on track. Works on phone and laptop,
installs to the home screen, sends push notifications, and can be automated from the iOS **Shortcuts** app.

- Zero build step. Node 22.5+ (uses built-in `node:sqlite`), one dependency (`web-push`).
- Rates: ECB reference rates via [Frankfurter](https://frankfurter.dev) (fallback open.er-api.com), refreshed once a day, with history. Each transaction stores its original amount, currency **and the rate at the time**, so history never drifts. Manual rate override on the Convert tab.
- Data lives in one SQLite file (`DB_PATH`). Export CSV / JSON backup from Settings.

## Run it

```bash
docker compose up -d --build        # then open http://<server-ip>:3000
```

or without Docker:

```bash
npm install
APP_PASSWORD=secret npm start
```

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `APP_PASSWORD` | *(none)* | Password for the web UI. **Set it** if anything beyond your LAN can reach the app |
| `DB_PATH` | `./data/budget.db` | SQLite file |
| `TRUST_PROXY` | *(off)* | Set to `1` behind a reverse proxy so throttling uses the real client IP and cookies get `Secure` |
| `ALLOWED_HOSTS` | *(any)* | Comma-separated hostnames; other `Host` headers get 421 (DNS-rebinding defence) |
| `TZ` | system | Time zone for "today", reminders, recurring items |
| `VAPID_SUBJECT` | `mailto:budget@example.com` | Contact used for web push |

Try it with sample data: `DB_PATH=./data/demo.db npm run seed:demo && DB_PATH=./data/demo.db npm start`.

## HTTPS is required for install + push

Service workers and push notifications only work on **HTTPS** (or `localhost`). On iOS, push also requires the app to be
**added to the Home Screen** (iOS 16.4+). Easiest options for a homelab:

- **Tailscale**: `tailscale serve --bg 3000` gives you `https://<machine>.<tailnet>.ts.net` with a real certificate, reachable only from your devices — ideal, and it also lets Shortcuts reach the server when you're away from home.
- **Caddy / Traefik / Nginx Proxy Manager** in front, with a domain and Let's Encrypt.

Then on iPhone: Safari → Share → **Add to Home Screen** → open it from the Home Screen → Settings → **Enable on this device**.

## iPhone Shortcuts

Settings → *iPhone Shortcuts* shows your server address and **API token**. Endpoints (header `Authorization: Bearer <token>`):

| Method | Path | Body |
|---|---|---|
| `POST` | `/api/shortcuts/expense` | `{"amount":"45,5","currency":"DKK","category":"groceries","note":"Netto"}` (`currency`, `category`, `note`, `date` optional; category matches by name/prefix) |
| `GET` | `/api/shortcuts/categories` | → `{"categories":[...]}` for a *Choose from List* |
| `GET` | `/api/shortcuts/summary` | → `{"message":"…"}` ("how am I doing?") |

Build the shortcut: **Ask for Input** (Number) → **Choose from List** → **Get Contents of URL** (POST, JSON, header above) → **Get Dictionary Value** `message` → **Show Result**.
Then trigger it from Siri, the Action Button, Back Tap, or the home screen.
**Fully automatic:** Shortcuts → Automation → **Transaction** (Apple Pay) → run the shortcut with *Amount* and *Merchant* → every tap-to-pay is logged without opening anything.

## Features

Quick-add (type `120 netto groceries` or `₹450 auto`, frequent categories first, remembers note→category) · edit/delete ·
income + cash flow · per-category budgets with green/amber (≥75%)/red states · safe-to-spend per day · budget pace, daily and
6-month charts · "ways to spend less" insights · recurring items (rent, Spotify, salary) · savings goals with monthly target ·
app lock (PIN + Face ID/Touch ID) · push alerts at 75%/100%, daily reminder, Sunday recap · offline entry queue · CSV import/export, JSON backup/restore.

## CI/CD

GitHub Actions runs tests, CodeQL, dependency audit and a Docker smoke test on every PR, and deploys `main` to a Proxmox LXC over Tailscale. Setup and threat model: [docs/DEPLOY.md](docs/DEPLOY.md). `npm test` runs the same suite locally.

## Security notes

Password (HMAC-signed HttpOnly cookie, login throttling), separate API token for Shortcuts, strict CSP, no third-party scripts or
trackers (the only outbound call is the daily exchange-rate fetch from the server). Everything is stored on your server.
**App lock** (Settings): 6-digit PIN (PBKDF2, throttled after 5 wrong tries) plus optional Face ID / Touch ID via WebAuthn, verified locally; locks on launch and after the delay you choose. It guards against someone picking up your unlocked device — it is per-device and doesn't encrypt server data, so also put the `data` volume on an encrypted disk. Needs HTTPS (or localhost).

See [SECURITY-AUDIT.md](SECURITY-AUDIT.md) for the full audit, fixes and residual risks.

## Layout

```
server/   index.js (API + static)  db.js  rates.js  summary.js  push.js  scheduler.js
public/   index.html  app.js  charts.js  styles.css  sw.js  manifest.webmanifest  icons/
scripts/  make-icons.js  seed-demo.js
```
