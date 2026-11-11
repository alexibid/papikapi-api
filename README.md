# Papikapi API — Generative 3D Papercraft Service

Enterprise-grade NestJS REST API and headless 3D generative pipeline for creating printable, folded low-poly papercraft models from text prompts or reference images.

---

## 🌟 Key Capabilities

* **End-to-End Generative Pipeline:** From prompt/references (FLUX.2) to AI 3D synthesis (TRELLIS.2), watertight mesh reduction, full-fidelity texture preservation, automated 2D net unfolding, A4 PDF booklets, and interactive 3D assembly plans.
* **Database-First Architecture:** Single source of truth in SQLite (`resources/papikapi.db`). Zero `.json` manifests or text files stored on disk.
* **Dynamic Assembly & Model Serving:** Serves 3D GLBs, assembly plans (`assembly.json`), PDFs, and model catalogues directly from SQLite and media stores.
* **Containerized Deployment:** Dockerized multi-port container (4505, 4500, 4502) with healthchecks and volume bindings.
* **Instant Regression & Safe Updates System:** Implements a 5-pillar regression battery with Golden Figures verification, Zod schema validation, and 1-second atomic rollback.

---

## 🏗️ Architecture

```text
apps/papikapi-api/
├── src/                          # NestJS REST API
│   ├── database/                 # SQLite provider (better-sqlite3) & Drizzle ORM schema
│   ├── generator/                # Generation SSE progress & worker triggers
│   ├── manifests/                # Figure manifests: steps, runs, costs, times, estimates
│   └── models/                   # Model catalogue, binary meshes, dynamic assembly plans
├── scripts/                      # Headless Pipeline Orchestration (TypeScript)
│   ├── common/                   # Database manifest manager, catalogue sync, path resolvers
│   ├── stage-1/                  # Alternatives (FLUX.2), Pick, Trellis Input
│   ├── stage-2/                  # 3D Synthesis (TRELLIS.2), Base Cut, Details
│   ├── stage-3/                  # Simplify (no voxel remesh), Atlas Extraction, Plinth
│   ├── stage-4/                  # Unfolding (2D net), Printable A4 Sheets Booklet
│   └── stage-5/                  # 3D Assembly Animation Plan
├── resources/                    # Development working area & SQLite database
│   └── papikapi.db               # SQLite database in WAL mode
├── public/models/                # Production media assets (.glb, .jpeg, .png, .pdf)
├── Dockerfile                    # Multi-stage production container build
├── docker-compose.yml            # Container orchestration with volume mounts
├── PIPELINE.md                   # Full technical pipeline specification
└── qa-stages.md                  # Quality gates & Golden Figures regression suite
```

---

## 🐳 Docker Deployment

The API runs as a high-availability Docker container that forwards host ports `4505`, `4500`, and `4502` to internal port `4505`, allowing seamless backwards compatibility with older studio tools and web clients:

```bash
# Build and start the container
docker compose up -d --build

# Inspect container health and logs
docker logs -f papikapi-api
```

### Port Mapping
* **`http://localhost:4505`**: Official NestJS REST API and OpenAPI Swagger documentation (`/api/docs`).
* **`http://localhost:4500`**: Public media and dynamic asset routes (`/models/:id/assembly.json`, `/models/:id/model.glb`).
* **`http://localhost:4502`**: Creator endpoints (`/api/creator/generate`, `/api/creator/pick`, `/api/creator/progress`).

---

## 📡 Core API Endpoints

| Method | Path | Description | Source |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Service and remote GPU healthcheck | In-memory |
| `GET` | `/api/v1/models` | List all available models with previews | SQLite (`models`) |
| `GET` | `/api/v1/models/:id` | Full model details and metadata | SQLite (`models`) |
| `GET` | `/models/:id/assembly.json` | Dynamic assembly plan for 3D viewers | SQLite (`models.assembly_plan`) |
| `GET` | `/figures/:id/assembly.json` | Alias for frontend client compatibility | SQLite (`models.assembly_plan`) |
| `GET` | `/api/v1/models/:id/mesh` | Streams binary 3D model (`model.glb`) | Filesystem media |
| `GET` | `/api/v1/models/:id/sheet` | Streams binary A4 assembly guide (`sheets.pdf`) | Filesystem media |
| `POST` | `/api/creator/generate` | Generates 3x2 alternatives grid | RunPod FLUX.2 Worker |
| `POST` | `/api/creator/pick` | Selects variation and initiates 3D synthesis | RunPod TRELLIS Worker |
| `GET` | `/api/creator/progress` | Real-time Server-Sent Events (SSE) stream | ProgressHub |
| `DELETE`| `/api/v1/models/:id` | Deletes model from DB and disk | SQLite & Filesystem |
| `GET` | `/api/v1/manifests` | Figures with status, time, cost and dates; `query`, `status`, `from`, `to`, `sort` (name, created, updated, cost, seconds), `order`, `limit`, `offset` | SQLite (`models`, `model_stages`, `step_runs`) |
| `GET` | `/api/v1/manifests/:id` | Full manifest of one figure: every step in pipeline order, every run, totals, dates, published files | SQLite & Filesystem |
| `GET` | `/api/v1/manifests/summary?figures=N` | Average time and cost per step and per figure, estimate for N figures, spend by day, most expensive and slowest figures | SQLite (`model_stages`, `step_runs`) |
| `GET` | `/api/v1/pipeline/stages` | Stages and steps in running order | SQLite (`pipeline_versions`) |
| `GET` | `/api/v1/pipeline/config` | Full active pipeline configuration | SQLite (`pipeline_versions`) |

Every step execution is recorded in `step_runs` (never overwritten), so spent time and cost include repeated runs; `model_stages` keeps the latest result of each step. The Bruno collection in `bruno/` covers every endpoint: `npx bru run --env local` from `bruno/`.

Interactive API documentation is available at `http://localhost:4505/api/docs`.

---

## 💻 CLI Pipeline Execution

```bash
# Run complete pipeline for a model
npx tsx scripts/shared/cli/stage-orchestrator.ts --model alex

# Run specific stage (e.g. Stage 3: Simplify & Plinth)
npx tsx scripts/shared/cli/stage-orchestrator.ts --model alex --stage 3

# Run from a specific step onward
npx tsx scripts/shared/cli/stage-orchestrator.ts --model alex --from-step s3-step-1 --pick 1

# Compile TypeScript check
npm run build
```

---

## 🛡️ Safe Updates & Instant Regression System

To ensure that system configuration and heuristics can be updated through database changes without breaking production models or causing quality regressions:

1. **Immutable Configuration Versions:** Configurations are versioned semantically (`pipeline_versions` table) and never overwritten in place.
2. **Schema Contract Guard:** Incoming configurations are strictly validated with Zod before insertion.
3. **1-Second Instant Rollback:** Pointing `system_settings.active_pipeline_version` to an earlier version restores previous behavior without requiring server restarts.
4. **Golden Figures Benchmark:** Every release candidate must pass blocking quality gates (`openEdges == 0`, 0 chamfers on 90° edges, full-resolution atlas) across the 5 reference figures: **Alex**, **Mario**, **Creeper**, **Pikachu**, and **Sonic**.

Refer to [qa-stages.md](qa-stages.md) and [PIPELINE.md](PIPELINE.md) for full quality thresholds and technical specifications.
