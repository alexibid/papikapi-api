# Papikapi API

NestJS API and headless generation pipeline for papikapi's printable papercraft figures. From a
prompt or reference images it generates the art (FLUX.2), the 3D mesh (TRELLIS.2), a simplified
low-poly model with its texture atlas, the unfolded 2D net, an A4 PDF booklet and the 3D assembly
plan. It also scores diary sentences for the papikapi app.

The full pipeline specification is in [PIPELINE.md](./PIPELINE.md).

This app is a submodule of [ibid-workspace](https://github.com/alexibid/ibid-workspace). It keeps
its own `package.json` and dependencies.

## Structure

```
apps/papikapi-api/
  src/                  NestJS API
    database/           SQLite (better-sqlite3) and the Drizzle schema
    models/             Model catalogue, meshes, sheets and assembly plans
    generator/          Generation endpoints and progress (SSE)
    manifests/          Per-figure steps, runs, time and cost, and the summary
    pipeline/           The active pipeline configuration and its stages
    behaviour/          Scores a diary sentence into behaviour domains and points
    config/             Environment configuration
  scripts/
    stage-1/ … stage-5/ The pipeline steps (TypeScript, Python and Blender)
    shared/             CLI orchestrator, common helpers, migrations, RunPod workers,
                        reports, training notes, Docker and test helpers
  resources/            Working area and the SQLite database (papikapi.db)
  public/models/        Published media: .glb, images and .pdf
  bruno/                Bruno collection for every endpoint
  Dockerfile, docker-compose.yml
```

| Stage | Does                                                |
| :---- | :-------------------------------------------------- |
| 1     | Art alternatives (FLUX.2), pick, upscale            |
| 2     | TRELLIS input and 3D synthesis                      |
| 3     | Simplification, atlas extraction, plinth            |
| 4     | Unfolding into a 2D net and the printable A4 sheets |
| 5     | The 3D assembly animation plan                      |

The GPU steps run on RunPod Serverless workers, billed per second of compute. See
[scripts/shared/runpod/README.md](./scripts/shared/runpod/README.md).

## Data

SQLite is the single source of truth: models, step results (`model_stages`), every run of every
step (`step_runs`, never overwritten) and the versioned pipeline configuration
(`pipeline_versions`). A new configuration is validated with Zod before it is stored, and
pointing `system_settings.active_pipeline_version` at an earlier version rolls back without a
restart.

## Endpoints

The API listens on port 4505 (`PORT` overrides it). Swagger is at
`http://localhost:4505/api/docs`.

| Method   | Path                                     | Does                                                                                                                                      |
| :------- | :--------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/health`                         | Service and GPU health                                                                                                                    |
| `GET`    | `/api/v1/models` (also `/api/catalogue`) | Every model with its preview                                                                                                              |
| `GET`    | `/api/v1/models/:id`                     | One model                                                                                                                                 |
| `GET`    | `/api/v1/models/:id/mesh`                | The `model.glb`                                                                                                                           |
| `GET`    | `/api/v1/models/:id/sheet`               | The A4 PDF                                                                                                                                |
| `GET`    | `/models/:id/assembly.json`              | The assembly plan (also `/figures/:id/assembly.json`, `/api/v1/models/:id/assembly`)                                                      |
| `POST`   | `/api/v1/models/sync`                    | Syncs the catalogue with the published media                                                                                              |
| `DELETE` | `/api/v1/models/:id`                     | Deletes a model from the database and the disk                                                                                            |
| `POST`   | `/api/v1/generator/alternatives`         | Generates the art alternatives                                                                                                            |
| `POST`   | `/api/v1/generator/synthesize`           | Starts the 3D synthesis of the picked art                                                                                                 |
| `GET`    | `/api/v1/generator/progress/:id/latest`  | Latest progress of a generation                                                                                                           |
| `GET`    | `/api/v1/manifests`                      | Figures with status, time, cost and dates; filter, sort and page with `query`, `status`, `from`, `to`, `sort`, `order`, `limit`, `offset` |
| `GET`    | `/api/v1/manifests/:id`                  | Every step and run of one figure, with totals and published files                                                                         |
| `GET`    | `/api/v1/manifests/summary?figures=N`    | Average time and cost per step and figure, and an estimate for N figures                                                                  |
| `GET`    | `/api/v1/pipeline/stages`                | Stages and steps in running order                                                                                                         |
| `GET`    | `/api/v1/pipeline/config`                | The active pipeline configuration                                                                                                         |
| `POST`   | `/api/behaviour/evaluate`                | Scores a sentence into behaviour domains and points                                                                                       |
| `GET`    | `/api/behaviour/model/latest`            | The current behaviour model                                                                                                               |

The `/api/creator/*` routes (`generate`, `pick`, `progress`, `info`, `sheet`, `delete`, `sync`)
remain for the studio's older client.

## Commands

Run from the workspace root.

| For                                              | Command                                                                              |
| :----------------------------------------------- | :----------------------------------------------------------------------------------- |
| Serve with reload (port 4505)                    | `npx nx serve papikapi-api`                                                          |
| Compile                                          | `npx nx build papikapi-api`                                                          |
| Unit tests                                       | `npx nx test papikapi-api`                                                           |
| Native tests (Python and geometry)               | `npx nx test-native papikapi-api`                                                    |
| Every endpoint through Bruno                     | `npm run api:test:bruno`                                                             |
| Whole pipeline for a model, rerunning every step | `npx nx figure papikapi-api --model=<id>`                                            |
| One stage or one step                            | `npx nx stage:3 papikapi-api --model=<id>` · `stage:3:step:1`                        |
| Publish the figures                              | `npx nx publish papikapi-api`                                                        |
| Figure report                                    | `npx nx report papikapi-api`                                                         |
| Container                                        | `npm run api:docker:build` · `api:docker:up` · `api:docker:down` · `api:docker:logs` |

The container is `papikapi-api`. It maps host ports 4505, 4500 and 4502 to the API's 4505, so
older clients that used the studio's former ports keep working.

## Quality gate

Before a pipeline change ships, the reference figures must pass the blocking checks in
[PIPELINE.md](./PIPELINE.md): no open edges, no chamfers on 90° edges, and a full-resolution
atlas.
