# Security audit — Budget Tracker

Scope: `server/*`, `public/*`, `Dockerfile`, `docker-compose.yml`. Method: manual code review, `npm audit`, and live
exploit attempts against a running instance (with and without `APP_PASSWORD`). Findings marked **Fixed** were re-tested
after the fix. Date: 2026-10-22.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | **High** | **SSRF via push subscription.** `/api/push/subscribe` accepted any `endpoint` URL and the server later connected to it (confirmed: a listener on `127.0.0.1` received a connection). In a homelab that is a pivot into internal services. | **Fixed** — https-only, no port/credentials, allowlist of real push services (FCM, Mozilla, Apple, Windows); re-checked at send time. Lookalike `fcm.googleapis.com.evil.com` rejected. |
| 2 | **High** | **Session cookie was a fixed HMAC of the password.** Never expired, couldn't be revoked, logout did nothing server-side, and a leaked cookie allowed offline guessing of the password. | **Fixed** — random 256-bit session tokens, stored hashed in SQLite, 90-day expiry, revoked on logout, all revoked when `APP_PASSWORD` changes. Old-style forged cookie → 401. |
| 3 | **High (by design)** | **No `APP_PASSWORD` ⇒ whole API open**, including `/api/state`, which returns the Shortcuts API token. | **Mitigated** — loud startup warning, README/compose mark the password as required; token can now be regenerated from Settings. You must still set the password. |
| 4 | **Medium** | **CSRF / cross-origin writes.** A cross-origin form POST (`application/x-www-form-urlencoded`) was accepted. Cookie `SameSite=Lax` blocks it for logged-in users, but nothing server-side did. | **Fixed** — any non-GET request carrying an `Origin` header must match the `Host` (or `X-Forwarded-Host` with `TRUST_PROXY`). Cross-origin → 403; Shortcuts (no Origin) unaffected. |
| 5 | **Medium** | **Stored markup / CSS injection** through category `icon` and `color` (`<img src` and `red;background:url(//evil)` were stored and rendered into `innerHTML` / `style`). CSP blocks script execution, so impact was HTML/CSS injection, not XSS. | **Fixed** — server enforces `#rrggbb` colours and strips markup characters from icons/names (also on backup restore); client re-sanitises before rendering. Names are HTML-escaped at render. |
| 6 | **Medium** | **CSV formula injection.** A note like `=HYPERLINK(...)` was exported verbatim and would execute in Excel/Numbers. | **Fixed** — cells starting with `= + - @ TAB CR` are prefixed with `'`. |
| 7 | **Medium** | **Shortcuts API token had no brute-force throttle** (login did). | **Fixed** — shared per-IP throttle (8 failures → 15 min lockout). Token is 192-bit so guessing is infeasible regardless. Side effect: a noisy attacker can lock *your* IP out of Shortcuts; behind a reverse proxy set `TRUST_PROXY=1` so the real client IP is used. |
| 8 | **Medium** | **DNS rebinding** against an unauthenticated instance. | **Mitigated** — optional `ALLOWED_HOSTS` rejects unknown `Host` headers (421). With a password set, rebinding gains nothing. |
| 9 | Low | `month` query param was unvalidated and used in a `LIKE` pattern (`%` returned everything). | **Fixed** — strict `YYYY-MM`. |
| 10 | Low | Manual rate override accepted absurd values that would corrupt totals. | **Fixed** — 0.1–1000. |
| 11 | Low | CSV import unbounded rows (CPU cost per row). | **Fixed** — 5,000 row cap. |
| 12 | Low | No HSTS; session cookie `Secure` depends on proxy header. | **Fixed** — HSTS and `Secure` are set when the request arrived over HTTPS (direct or `X-Forwarded-Proto`). |
| 13 | Low | Docker: bind-mounted `./data` is root-owned, so the non-root `node` user couldn't write; no container hardening. | **Fixed** — named volume, `read_only`, `cap_drop: ALL`, `no-new-privileges`. |
| 14 | Low | Service worker cached authenticated API responses; they survived logout on shared devices. | **Fixed** — logout clears all caches. |

## Checked and found safe

- **Path traversal** in static serving: 7 variants (`..`, `%2e%2e`, `%2f`, `%5c`, NUL, nested) never returned source.
- **Authentication coverage:** with a password set, every `/api/*` route (including exports and backups) returns 401 without a session; forged and malformed cookies rejected.
- **SQL injection:** all queries are parameterised; the only interpolated identifiers are hard-coded table names.
- **Login throttling:** 8 failures → 429.
- **CORS:** no `Access-Control-*` headers are ever sent.
- **Body size:** 1 MB cap (2 MB request → 400).
- **Headers:** CSP (`script-src 'self'`, `frame-ancestors 'none'`, `base-uri 'none'`), `nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`, `Permissions-Policy`.
- **Dependencies:** `npm audit` → 0 vulnerabilities (single dependency: `web-push`).
- **Secrets:** VAPID private key and API token are excluded from `backup.json`; restore cannot overwrite them; errors don't leak stack traces.
- **Outbound traffic:** only the daily rate fetch (Frankfurter / open.er-api.com) and push delivery to the allowlisted services.

## Accepted / residual risks

- **No TLS in the app itself.** Terminate HTTPS in front (Tailscale, Caddy, Traefik). Without it, the password and cookie cross your LAN in clear text. HTTPS is also required for install, push and app lock.
- **Data at rest is unencrypted** (SQLite file, API token in settings). Put the volume on an encrypted disk and restrict backups.
- **CSP allows `style-src 'unsafe-inline'`** because the UI uses inline `style` attributes. Scripts are still locked to `'self'`; after fix #5 no user-controlled value reaches a style attribute unvalidated.
- **App lock is a casual gate**, not encryption: PIN hash and passkey public key sit in `localStorage`, and a 6-digit PIN can be brute-forced offline by someone who copies that storage (PBKDF2 210k slows but doesn't prevent this). It protects against someone picking up your unlocked device, not against a forensic attacker.
- **Single-user model:** one password, one API token, no per-device sessions list or roles.
- **Push metadata:** notifications travel via Apple/Google/Mozilla push services (payload is encrypted end-to-end to the device, but the services see that a push occurred).

## Recommended deployment checklist

1. Set a strong `APP_PASSWORD`; bind the port to a LAN/Tailscale address.
2. Serve over HTTPS; set `TRUST_PROXY=1` and `ALLOWED_HOSTS=<your hostname>` when behind a proxy.
3. Keep the `budget-data` volume on an encrypted disk; back it up (Settings → Backup JSON also works).
4. Regenerate the Shortcuts token after sharing a screenshot of Settings or changing phones.
