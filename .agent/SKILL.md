---
name PulseGuard System Architecture & Engineering Spec
description Master architectural guidelines, Docker orchestration rules, high-throughput SQL patterns, and phased implementation roadmap for PulseGuard SaaS.
---

# 1. System Overview & Architectural Vision
You are acting as a Principal System Architect building PulseGuard—a Multi-Tenant Real-Time Uptime, Synthetic Monitoring, and Incident Management SaaS.

## Core Engineering Rules (Strict Enforcement)
1. Database & Raw SQL First
   - Do NOT use heavy ORMs (like Sequelize or Prisma) for high-throughput telemetry or analytical queries.
   - Use `mysql2promise` with connection pooling.
   - All telemetry writes (`ping_logs`) must use batch inserts.
   - All analytical reads (Uptime %, P95P99 latency, status timelines) must use Raw SQL with Composite Covering Indexes, Common Table Expressions (CTEs), and Window Functions (`PERCENTILE_CONT` simulation, `LAG`, `LEAD`).
   - State-mutating worker queries must use ACID transactions and row-level locking (`SELECT ... FOR UPDATE` or `SKIP LOCKED`) to prevent race conditions across distributed workers.
2. Docker & Network Isolation
   - Every component must be containerized using multi-stage `Dockerfile` builds for production efficiency.
   - Use two isolated bridge networks in Docker Compose
     - `frontend_net` Accessible by Next.js UI and API Server.
     - `backend_net` Strictly internal for `mysql-db`, `redis-queue`, `ping-worker`, and `api-server`.
   - Every container must define a `healthcheck` and resource limits.
3. Zero Host Port Collisions
   - The host machine runs local development services on standard ports. Map Docker ports on the host as follows
     - MySQL `33073306`
     - Redis `63806379`
     - API Server `40004000`
     - Next.js Web Dashboard `30003000`
4. Phased Execution Protocol
   - CRITICAL Never implement multiple phases at once. Only execute the specific Phase requested by the user, run verification commands, and wait for architectural review before proceeding.

---

# 2. Monorepo Target Structure
```text
pulseguard-saas
├── .env.example
├── .env
├── docker-compose.yml
├── database
│   ├── init.sql              # DDL Tables, Range Partitions, Composite Indexes
│   └── seed.sql              # Initial tenant & sample monitors
├── api-server               # Node.js + ExpressFastify + mysql2 + ioredis + SSE
├── ping-worker              # Node.js Background Scheduler & BullMQ Worker
└── web-dashboard            # Next.js (App Router, TypeScript, Tailwind CSS)