# CI/CD: GitHub Actions → Tailscale → Proxmox LXC

```
pull request ─▶ CI (tests, syntax, npm audit, dependency review) · CodeQL · Docker build + smoke test
push to main ─▶ CI ─▶ Deploy ─▶ runner joins your tailnet (tag:ci)
                                   └─ tailscale ssh deploy@budget-tracker "sudo budget-update <sha>"
                                        └─ git fetch · npm ci · restart · health check · auto-rollback
              └▶ Docker image published to ghcr.io/<owner>/budget-tracker (:latest, :sha-…)
```

| Workflow | Runs on | Does |
|---|---|---|
| `ci.yml` | PRs, non-main pushes, called by deploy | `npm run check`, `npm test` (25 API/auth/security tests), `npm audit`, dependency review (PR) |
| `docker.yml` | PRs touching the image, pushes to main, tags | builds, starts the container and smoke-tests it (non-root, auth enforced), publishes to GHCR with provenance + SBOM |
| `codeql.yml` | PRs, main, weekly | CodeQL `security-extended` for JavaScript |
| `deploy.yml` | push to main, manual | CI → deploy to the homelab; manual runs deploy any ref (**rollback**) |
| Dependabot | weekly | npm, Docker and the pinned action SHAs |

All third-party actions are pinned to commit SHAs. Jobs get read-only tokens unless they need more.
**Deploy does nothing until you set `DEPLOY_ENABLED=true`** (step 3), so merging the pipeline is safe.

## One-time setup

### 1. Tailscale
1. Admin console → **DNS**: enable MagicDNS and **HTTPS Certificates** (needed for `tailscale serve`).
2. Admin console → **Access controls**: add (merge into your policy):
   ```jsonc
   "tagOwners": {
     "tag:ci":     ["autogroup:admin"],
     "tag:budget": ["autogroup:admin"],
   },
   "acls": [
     // you (and your devices) open the app over HTTPS
     {"action": "accept", "src": ["autogroup:member"], "dst": ["tag:budget:443"]},
     // the CI runner may reach SSH only
     {"action": "accept", "src": ["tag:ci"], "dst": ["tag:budget:22"]},
   ],
   "ssh": [
     // Tailscale SSH: CI may log in as the unprivileged `deploy` user, nothing else
     {"action": "accept", "src": ["tag:ci"], "dst": ["tag:budget"], "users": ["deploy"]},
   ],
   ```
3. **Settings → Keys → Generate auth key** for the container: tag `tag:budget`, *pre-approved*, *not* reusable. Copy it.
4. **Settings → OAuth clients → Generate**: scope **Auth Keys: Write**, tag `tag:ci`. Copy the client ID and secret.

### 2. The container
In `Homelab/projects/budget-tracker/`, set `tailscale_auth_key` (put it in `Homelab/shared/proxmox/credential.auto.tfvars`, which is git-ignored and linked into the project) and
`terraform apply`. The container joins the tailnet as `budget-tracker`, serves the app at
`https://budget-tracker.<your-tailnet>.ts.net` and trusts only the `deploy` user's `sudo budget-update`.

### 3. GitHub
```bash
gh secret set TS_OAUTH_CLIENT_ID --env homelab      # paste when prompted
gh secret set TS_OAUTH_SECRET    --env homelab
gh variable set DEPLOY_ENABLED --body true          # turns the deploy job on
gh variable set TS_HOST --body budget-tracker       # only if you changed tailscale_hostname
```
The `homelab` environment already exists. To require a manual approval before each deploy, add yourself under
*Settings → Environments → homelab → Required reviewers*.

### 4. Try it
*Actions → Deploy to homelab → Run workflow* (leave `ref` empty). Then push a commit to `main` and watch it roll out.

## Day to day
- **Roll back:** *Run workflow* with `ref` = an older tag or commit SHA.
- **A failed deploy rolls itself back** on the server (health check on `/api/session`) and the job goes red.
- **Protect `main`** (recommended): require pull requests and the checks `Test`, `Dependency audit` before merging:
  ```bash
  gh api -X PUT repos/{owner}/{repo}/branches/main/protection --input - <<'JSON'
  {"required_status_checks":{"strict":true,"contexts":["Test","Dependency audit"]},
   "enforce_admins":false,"required_pull_request_reviews":null,"restrictions":null}
  JSON
  ```

## Threat model of the deploy path
- The runner is a *tagged, ephemeral* tailnet node; the ACL lets it reach only port 22 of the app container.
- Tailscale SSH maps it to `deploy`, which has no password and no keys, and may run exactly one command through sudo.
  `budget-update` validates its argument, and only pulls from the repo configured at provisioning time.
- The OAuth secret can only mint `tag:ci` auth keys; revoke it in the admin console if it leaks.
- Pull requests from forks do not receive secrets, and the deploy job only runs on `main` or manual dispatch.
