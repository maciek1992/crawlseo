# Deploy: CrawlSEO on Proxmox

Reference steps for deploying this fork to the target Proxmox VM. This is the
"how to do it" doc; for current status and session-by-session history see
[DEPLOY-PROGRESS.md](DEPLOY-PROGRESS.md), and for access details (SSH
aliases, IPs, credentials location) see [../CLAUDE.md](../CLAUDE.md). The
full architecture decision and rationale live in
[../PLAN-KEYWORDTOOL.md](../PLAN-KEYWORDTOOL.md) (section "Serwer
(Proxmox)") — this doc only extracts the actionable steps.

## Target architecture

```
Internet → router :443 → Caddy (LXC 201, existing) → HTTP over LAN → VM 116 :3000 (Next.js in Docker)
```

Domain: `crawlseo.83-15-212-106.sslip.io` (sslip.io wildcard DNS, resolves to
the ISP's public IP — zero router/DNS changes needed). Firewall is enforced
at the Proxmox VM level (not `ufw` — Docker's own iptables rules bypass
`ufw` for published ports).

## VM spec

| Parameter | Value |
|---|---|
| OS | Debian 13 (trixie) netinst, minimal, no GUI |
| CPU | 2 vCore, type `host` |
| RAM | 4 GB (Next.js build needs ~2-3 GB), ballooning off |
| Swap | 2 GB |
| Disk | 32 GB, VirtIO SCSI single, `discard=on`, `iothread=1`, `ssd=1` |
| Network | VirtIO, bridge `vmbr0`, static/reserved IP |
| Options | QEMU Guest Agent on, start at boot on |
| Backup | vzdump snapshot, daily, keep 7 |

## One-time host setup

1. `apt update && apt full-upgrade`; install `qemu-guest-agent ca-certificates curl git gnupg openssl unattended-upgrades`.
2. Non-root sudo user, SSH key-only (`PasswordAuthentication no`, `PermitRootLogin no`).
3. Docker Engine + `docker-compose-plugin` from the **official Docker repo**
   (not Debian's `docker.io`); add the deploy user to the `docker` group.
4. HTTPS via the existing Caddy instance on LXC 201 (`192.168.1.201`) — see
   "Caddy block" below. Required because Google OAuth login (`lib/auth.ts`)
   won't accept a redirect URI on a private IP or plain HTTP.
5. Proxmox firewall at the VM level: inbound tcp 3000 only from
   `192.168.1.201` (Caddy), inbound tcp 22 from LAN, everything else DROP.
   Postgres is never published (see the `docker-compose.yml` fix below).
6. Right after the first successful login, set `DISABLE_REGISTRATION=true`
   and restart — this app is exposed publicly with only Google OAuth gating
   access, and the OAuth consent screen should stay in Testing mode with a
   single test user.

## Caddy block (on LXC 201)

The existing Caddy instance already serves the MTE KB block; add a
**separate** block for CrawlSEO, don't touch the existing one:

```
crawlseo.83-15-212-106.sslip.io {
	encode gzip
	reverse_proxy <VM_IP>:3000
}
```

Before reloading: `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak`, then
`caddy validate --config /etc/caddy/Caddyfile` and only then
`systemctl reload caddy`. Caddy provisions its own Let's Encrypt cert via
HTTP-01 on port 80 automatically.

## Deploy

```
git clone <fork> ~/crawlseo && cd ~/crawlseo
cp .env.example .env
# Fill in: NEXTAUTH_SECRET (openssl rand -hex 32), POSTGRES_PASSWORD,
# GOOGLE_CLIENT_ID/SECRET, NEXTAUTH_URL=https://crawlseo.83-15-212-106.sslip.io,
# AUTH_TRUST_HOST=true
docker compose up -d --build
```

`docker-compose.yml` in this fork builds the app image locally
(`build: .` / `image: crawlseo:local`) instead of pulling
`ghcr.io/crawlseo/crawlseo` — the upstream image doesn't have this fork's
changes. Postgres's `5432:5432` port publish has been removed; the database
is reachable only inside the compose network.

Google Cloud Console: create an OAuth client (Web application), redirect URI
`https://crawlseo.83-15-212-106.sslip.io/api/auth/callback/google`, consent
screen type External + Testing, test user = your own account, scope
`webmasters.readonly`.

Update: `git pull && docker compose up -d --build`.
Sync with upstream (on the laptop): `git fetch upstream && git merge upstream/main`, then push to the fork.

## Known risks

- **Google OAuth + sslip.io**: sslip.io isn't on the Public Suffix List, so
  Google Cloud Console may reject it as an "authorized domain" outside of
  Testing mode. Testing mode with a single test user should work; if not,
  fall back to a free DuckDNS subdomain (on the PSL) or a cheap real domain,
  pointed at the same Caddy setup.
- The ISP's public IP is dynamic — both sslip.io names (MTE KB and CrawlSEO)
  break together if it changes; this is an existing, accepted risk.
- CrawlSEO depends on LXC 201 being up (single reverse proxy for both
  services) — accepted trade-off, not addressed here.

## Migration validation before first deploy

Prisma migrations for this feature were written by hand as raw SQL (not via
`prisma migrate dev`, which needs a live database this laptop doesn't have).
Before pointing the compose stack's `migrate deploy` at a real database,
validate the hand-written SQL against `prisma/schema.prisma` using a
throwaway Postgres container — see PLAN-KEYWORDTOOL.md, "Weryfikacja" step
1a, for the exact commands (`prisma migrate diff` flags depend on the
installed Prisma version — check `npx prisma migrate diff --help` first).
