# Hosting and CI/CD: Cloudflare Tunnel + Tailscale + GitHub Actions

Two separate paths, each doing one job:

```
Users ─▶ https://budget.example.com ─▶ Cloudflare (TLS, WAF, optional Access)
                                          └─ Tunnel ─▶ cloudflared (in the LXC) ─▶ app on 127.0.0.1:3000

push to main ─▶ CI ─▶ Deploy ─▶ GitHub runner joins your tailnet (tag:ci)
                                   └─ tailscale ssh deploy@budget-tracker "sudo budget-update <sha>"
                                        └─ git fetch · npm ci · build web app · swap dist · restart · health check · auto-rollback
```

- **Cloudflare Tunnel publishes the app.** The container makes an outbound connection to Cloudflare, so you open no
  ports on your router. HTTPS comes from Cloudflare, which is what install-to-home-screen, push notifications and
  app lock need.
- **Tailscale is only the deploy path.** GitHub Actions reaches the container over Tailscale SSH. Nothing about the
  app is exposed through it.

| Workflow | Runs on | Does |
|---|---|---|
| `ci.yml` | PRs, called by deploy | `npm run check` (TypeScript), `npm run test:web` (25 unit tests), `npm run build`, `npm test` (41 API/auth/security/proxy/static tests), `npm audit`, dependency review (PR) |
| `docker.yml` | PRs touching the image, pushes to main, tags | builds, smoke-tests (non-root, auth enforced), publishes to GHCR with provenance + SBOM |
| `codeql.yml` | PRs, main, weekly | CodeQL `security-extended` for JavaScript |
| `deploy.yml` | push to main, manual | CI → deploy over Tailscale; a manual run deploys any ref (**rollback**) |
| Dependabot | weekly | npm, Docker and the pinned action SHAs |

All third-party actions are pinned to commit SHAs. **Deploy does nothing until you set `DEPLOY_ENABLED=true`.**

## One-time setup

### 1. Cloudflare Tunnel (publishes the app)
You need a domain whose DNS is on Cloudflare.
1. Zero Trust dashboard → **Networks → Tunnels → Create a tunnel** → *Cloudflared* → name it `budget-tracker`.
2. On the install screen, copy the **token** (the long string after `--token`). You will not run the shown command:
   Terraform installs and starts cloudflared for you.
3. **Public Hostname** tab → add: subdomain `budget`, your domain, service type **HTTP**, URL `localhost:3000`.
4. Keep the token private. It goes into `credential.auto.tfvars` in step 3.

### 2. Tailscale (GitHub deploys only)
1. **Access controls**: add (merge into your policy). No HTTPS certificates or MagicDNS HTTPS are needed any more:
   ```jsonc
   "tagOwners": {
     "tag:ci":     ["autogroup:admin"],
     "tag:budget": ["autogroup:admin"],
   },
   "acls": [
     // the CI runner may reach SSH on the container, nothing else
     {"action": "accept", "src": ["tag:ci"], "dst": ["tag:budget:22"]},
   ],
   "ssh": [
     // Tailscale SSH: CI may log in as the unprivileged `deploy` user only
     {"action": "accept", "src": ["tag:ci"], "dst": ["tag:budget"], "users": ["deploy"]},
   ],
   ```
2. **Settings → Keys → Generate auth key** for the container: tag `tag:budget`, *pre-approved*, *not* reusable.
3. **Settings → OAuth clients → Generate**: scope **Auth Keys: Write**, tag `tag:ci`. Copy the client ID and secret.

### 3. The container
In `Homelab/projects/budget-tracker/`:
```hcl
# terraform.tfvars
public_hostname = "budget.example.com"
```
```hcl
# Homelab/shared/proxmox/credential.auto.tfvars   (git-ignored, mode 600) - add:
cloudflare_tunnel_token = "eyJ..."
tailscale_auth_key      = "tskey-auth-..."
```
`terraform apply`. The container starts cloudflared, the app listens on `127.0.0.1` only (nothing on your LAN can talk
to it directly), it trusts the client IP Cloudflare supplies, and it only answers to `public_hostname`.
Open `https://budget.example.com` and sign in.

### 4. GitHub
```bash
gh secret set TS_OAUTH_CLIENT_ID --env homelab      # paste when prompted
gh secret set TS_OAUTH_SECRET    --env homelab
gh variable set DEPLOY_ENABLED --body true
gh variable set TS_HOST --body budget-tracker       # only if you changed tailscale_hostname
```
The `homelab` environment exists already; add yourself under *Settings → Environments → homelab → Required reviewers*
for a manual approval before each deploy. Then *Actions → Deploy to homelab → Run workflow* to test.

## Recommended: lock the front door (Cloudflare Access)
The app has its own password, login throttling and a strict CSP, but it is now reachable from the whole internet.
Put a second lock in front of it.

1. **Zero Trust → Access → Applications → Add → Self-hosted**: hostname `budget.example.com`, policy **Allow** →
   *Emails* = yours (one-time PIN by email, or your identity provider). Set the session duration to **1 month**:
   when the Access session expires the installed app can't reach the server until you reopen it and sign in again.
2. **Let iOS Shortcuts through.** Shortcuts can't do an interactive login, so add a second self-hosted application for
   the path `budget.example.com/api/shortcuts` with a **Service Auth** policy, and create a **Service Token**
   (Access → Service Auth). In your Shortcut's *Get Contents of URL*, add two headers:
   `CF-Access-Client-Id` and `CF-Access-Client-Secret`. (The more specific path wins over the whole-site rule.) The
   existing API-token header stays: both checks apply.
3. **WAF rate limit** (free plan allows one rule): Security → WAF → Rate limiting → URI path `/api/login`,
   about 5 requests per 10 seconds per IP → block.

If you skip Access, at least do step 3 and use a long, unique `app_password`.

## Day to day
- **Roll back:** *Run workflow* with `ref` = an older tag or commit SHA.
- **A failed deploy rolls itself back** on the server (health check on `/api/session`) and the job goes red.
- **Tunnel status:** `ssh root@<container> journalctl -u cloudflared -n 50` (or the Zero Trust dashboard).
- **Protect `main`** (recommended): require pull requests and the checks `Test`, `Dependency audit`:
  ```bash
  gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input - <<'JSON'
  {"required_status_checks":{"strict":true,"contexts":["Test","Dependency audit"]},
   "enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}
  JSON
  ```

## Notes and threat model
- **App lock biometrics are tied to the hostname** (a WebAuthn rule). If you change `public_hostname`, turn Face ID /
  Touch ID off and on again in Settings.
- **Client IPs.** In tunnel mode the app reads `CF-Connecting-IP` and ignores `X-Forwarded-For`, which a visitor can
  forge. Because the app listens on loopback only, only cloudflared can set that header.
- **Cloudflare sees your traffic** in the clear (it terminates TLS). Fine for a personal budget app; if that matters,
  use Tailscale-only access instead (set `tailscale_serve = true`, no tunnel token).
- **Deploy path:** the runner is a tagged, ephemeral tailnet node limited to port 22. Tailscale SSH maps it to `deploy`,
  which has no password or keys and may run exactly one command through sudo; `budget-update` validates its argument and
  only pulls from the repository configured at provisioning time. Revoke the OAuth secret in the Tailscale admin
  console if it leaks. Fork pull requests never receive secrets, and deploys only run on `main` or manual dispatch.
- **Tokens.** The tunnel token is stored in `/etc/cloudflared.env` (root-only) and Terraform state. Rotate it by
  creating a new tunnel token in the dashboard and re-applying.
