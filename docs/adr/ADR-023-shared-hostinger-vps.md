# ADR-023: Shared Hostinger VPS for V1, with a fixed resource share and a path to a dedicated host

Status: Accepted (2026-10-31)
Date: 2026-10-31
Amends: [ADR-002](ADR-002-single-host-compose.md), [ADR-022](ADR-022-python-backend-simplified-platform.md) (host only; the process model, Compose, Python backend and self-hosted web are unchanged)

## Context

The docs written on 2026-09-29 and 2026-09-30 assumed one DigitalOcean Basic droplet (`s-2vcpu-4gb`, 2 shared vCPU, 4 GiB RAM, 80 GiB disk, $24 per month) used only by idraft. That is no longer true:

- idraft runs on a Hostinger VPS (187.126.121.25): Ubuntu 24.04, 4 vCPU, 16 GB RAM (15.6 GiB visible), 193 GB disk, 2 GB swap.
- The same VPS will also host a second project. idraft gets half of the machine, about 8 GB RAM, and the other project gets the rest. The split follows need and is reviewed as measured load arrives.
- If idraft gets a real user base, it moves to its own fresh VPS of 16 GB or 32 GB RAM.

Measured on 2026-10-31 (idle, nothing collecting yet): load average 0.06, 1.06 GB RAM used of 16 GB, 8.3 GB of 193 GB disk used, database 15 MB, Redis 1.1 MB, `next-server` about 170 MB, `uvicorn` about 165 MB.

## Decision

1. **Host.** The V1 host is the shared Hostinger VPS above. Every DigitalOcean-specific item in the docs (droplet sizes, Cloud Firewall, `doctl` resize, DO weekly backups, DO Volumes, private VPC, DO monitoring) is replaced by its Hostinger or host-level equivalent. Provider features are used only for things the provider offers on this plan; anything not verified in hPanel is marked "verify" and is never the only copy of data.
2. **Resource share.** idraft is capped at **8 GB RAM, with a soft limit of 7 GB**, and **fair-share CPU** (idle CPU may be used, a busy neighbour cannot take more than its share). The cap is enforced by a systemd slice, `idraft.slice` (`MemoryHigh=7G`, `MemoryMax=8G`, `CPUWeight=100`), and every Compose service sets `cgroup_parent: idraft.slice` besides its own `mem_limit`. The other project gets its own slice with the same shape. The host keeps about 1 GB for the kernel, systemd, sshd, the edge proxy, dockerd and journald. The 2 GB swap is shared and is a safety net only.
3. **Sizing profile.** The 8 GB profile that docs 22 and 28 defined as "scaling step 1" is now the **baseline profile**: Postgres `mem_limit` 3000m, `shared_buffers` 2 GB, `effective_cache_size` 5 GB, `work_mem` 16 MB, `maintenance_work_mem` 256 MB, `max_connections` 80; worker `mem_limit` 768m. The old 4 GB profile survives only as the laptop and CI profile.
4. **Isolation between the two projects.** Separate Compose project names, separate Docker networks, separate Postgres and Redis instances (no shared database server), separate secret files, separate Unix users for deploys, and no published container ports on public addresses. Postgres 16 on port 5432 is the system cluster and is not used by idraft; idraft uses its own Postgres 18 on loopback.
5. **Public edge.** Ports 80 and 443 can be bound once. TLS and hostname routing for both projects therefore live in one **host-level edge proxy** that neither project owns. idraft keeps its own `caddy` service as the application gateway (routing `/api/*` to `api`, everything else to `web`, security headers, rate limits), bound to loopback only, with automatic HTTPS off. The edge proxy forwards idraft's hostnames to it and sets the client address header; the gateway trusts that header only from loopback. The edge implementation (today's nginx, or a host-level Caddy) is an open decision, D-H2 in doc 30.
6. **Firewall.** The Hostinger VPS firewall (hPanel) and `ufw` on the host: SSH (restricted as in doc 22 section 6), 80 and 443 to the world, everything else closed. The DigitalOcean Cloud Firewall and private VPC sections are removed.
7. **Backups.** The database-aware copy is unchanged: nightly encrypted `pg_dump` to Cloudflare R2, with the monthly restore drill. Host snapshots from Hostinger (whatever the plan includes; verify in hPanel) replace the DO weekly droplet backups as the second copy, with a manual snapshot before every risky change. A snapshot is never counted as the only backup.
8. **Cost.** The fixed cost is no longer a $24 droplet. It is **50% of the Hostinger VPS invoice** (the owner enters the amount; the docs use the symbol `H` for idraft's half) plus R2 (about $1) plus $0 for free tiers. Variable costs (DataForSEO, LLM) are unchanged.
9. **Path to a dedicated host.** Moving idraft to its own VPS (16 GB, then 32 GB) is a planned scaling step, not an emergency. Because the whole stack is Compose and the data is in nightly dumps, a move is: provision, run `infra/bootstrap.sh`, restore the latest dump, switch DNS, retire the old stack. The triggers are in doc 28 section 7.

## Alternatives considered

- **Keep documenting a DigitalOcean droplet.** Rejected: it is not what runs, and every capacity number would be wrong.
- **One Postgres and one Redis shared by both projects.** Rejected: one project's migration, vacuum or runaway query would hit the other, and a restore could not be done per project.
- **Give each project a hard 8 GB partition (a VM or fixed cgroup CPU quota).** Rejected for CPU: a hard CPU quota wastes the idle half. Memory is capped hard because memory pressure takes both projects down; CPU is shared by weight.
- **Let the first project to bind 80 and 443 own the edge.** Rejected: it couples the other project's uptime and certificates to idraft's deploys.

## Consequences

- The host is still a single point of failure, and now also a shared one: a mistake in the other project (fork bomb, disk fill, bad firewall change) is an idraft incident. Mitigations: slices, disk alerts that count both projects, per-project deploy users, R2 backups that do not depend on the host.
- Capacity is larger than the original plan in RAM (8 GB against 4 GB) and in disk (about 185 GB free against 40 GB usable for PostgreSQL), so the original "resize to 8 GB" and "attach a Volume" steps are not needed in V1. CPU is the thing to watch: 4 vCPU shared, so idraft has about 2 vCPU guaranteed under contention (the original plan had 2 shared vCPU).
- The Hostinger plan details (price, snapshot features, in-place plan upgrade, outbound network limits) are not verified in these docs; doc 30 lists them as open items for the owner.

## Revisit triggers

Any of the dedicated-host triggers in doc 28 section 7: the `idraft.slice` memory above 70% of 8 GB for a week or swap in steady use; host `MemAvailable` under 2 GB more than twice a week; host load average above 3.5 for 15 minutes more than three times a week; idraft database over 20 GB; the other project needing more than its half; or the tool being offered to outside customers (step 6).
