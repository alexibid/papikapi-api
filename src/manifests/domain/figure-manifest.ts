import type {
  FigureFacts,
  FigureVersions,
  FigureSources,
  FigureStatus,
  FigureTotals,
  LatestStepRow,
  ManifestDetail,
  ManifestRun,
  ManifestStep,
  ManifestSummary,
  PipelineStepInfo,
  StepRunRow,
} from './manifest.types.js';

const SIMPLIFY_STEP = 's3-step-1';
const ATLAS_STEP = 's3-step-3';
const PREVIEW_KIND = 'preview-three-quarter';

export function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100;
}

export function roundCost(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function summarize(sources: FigureSources, pipeline: readonly PipelineStepInfo[]): ManifestSummary {
  const totals = totalsOf(sources, pipeline);
  return {
    id: sources.model.id,
    name: sources.model.name,
    subject: sources.model.subject,
    status: statusOf(sources.steps, pipeline),
    seconds: totals.pipelineSeconds,
    costUsd: totals.spentCostUsd,
    runs: totals.runs,
    createdAt: sources.model.createdAt,
    updatedAt: sources.model.updatedAt,
    versions: versionsOf(sources.runs),
    previewUrl: sources.files.find((file) => file.kind === PREVIEW_KIND)?.url ?? null,
  };
}

export function detailOf(sources: FigureSources, pipeline: readonly PipelineStepInfo[]): ManifestDetail {
  const { model } = sources;
  return {
    id: model.id,
    name: model.name,
    subject: model.subject,
    status: statusOf(sources.steps, pipeline),
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
    versions: versionsOf(sources.runs),
    prompt: model.prompt,
    fluxPrompt: model.fluxPrompt,
    chosenPick: model.chosenPick,
    figure: factsOf(sources.steps),
    totals: totalsOf(sources, pipeline),
    steps: pipeline.map((step) => stepOf(step, sources)),
    history: [...sources.runs].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt)).map(runOf),
    files: sources.files,
  };
}

/** Pipeline totals count the latest run of each step (what the figure costs now); spent totals count every run. */
export function totalsOf(sources: FigureSources, pipeline: readonly PipelineStepInfo[]): FigureTotals {
  const latest = sources.steps.filter((row) => pipeline.some((step) => step.stageId === row.stageId));
  return {
    pipelineSeconds: roundSeconds(sum(latest.map((row) => row.seconds))),
    pipelineCostUsd: roundCost(sum(latest.map((row) => row.costUsd))),
    spentSeconds: roundSeconds(sum(sources.runs.map((run) => run.seconds))),
    spentCostUsd: roundCost(sum(sources.runs.map((run) => run.costUsd))),
    runs: sources.runs.length,
  };
}

export function statusOf(steps: readonly LatestStepRow[], pipeline: readonly PipelineStepInfo[]): FigureStatus {
  const statuses = pipeline.map((step) => steps.find((row) => row.stageId === step.stageId)?.status);
  if (statuses.some((status) => status === 'FAILED')) return 'FAILED';
  if (statuses.every((status) => status === 'DONE')) return 'DONE';
  return statuses.some((status) => status !== undefined) ? 'IN_PROGRESS' : 'PENDING';
}

function stepOf(step: PipelineStepInfo, sources: FigureSources): ManifestStep {
  const latest = sources.steps.find((row) => row.stageId === step.stageId);
  const runs = sources.runs.filter((run) => run.stageId === step.stageId);
  const lastRun = [...runs].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))[0];
  return {
    ...step,
    status: latest?.status ?? 'PENDING',
    seconds: latest?.seconds ?? 0,
    costUsd: latest?.costUsd ?? 0,
    costNote: latest?.costNote ?? null,
    startedAt: lastRun?.startedAt ?? null,
    finishedAt: latest?.finishedAt ?? null,
    runs: runs.length,
    spentCostUsd: roundCost(sum(runs.map((run) => run.costUsd))),
    version: lastRun?.version ?? null,
    metrics: latest?.metrics ?? null,
    data: latest?.data ?? null,
  };
}

function factsOf(steps: readonly LatestStepRow[]): FigureFacts {
  const simplify = steps.find((row) => row.stageId === SIMPLIFY_STEP)?.metrics ?? {};
  const atlas = steps.find((row) => row.stageId === ATLAS_STEP)?.metrics ?? {};
  const eyeTexels = numberOf(atlas['eyeTexels']);
  return {
    mode: typeof simplify['mode'] === 'string' ? simplify['mode'] : null,
    paperFaces: numberOf(simplify['meshFaces']),
    eyeTexels,
    artEyes: (eyeTexels ?? 0) > 0,
  };
}

function runOf(run: StepRunRow): ManifestRun {
  return {
    stageId: run.stageId,
    status: run.status,
    seconds: run.seconds,
    costUsd: run.costUsd,
    costNote: run.costNote,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    version: run.version,
  };
}

/** The app versions the figure's first and latest runs were made with. */
export function versionsOf(runs: readonly StepRunRow[]): FigureVersions {
  const ordered = [...runs].sort((a, b) => a.finishedAt.localeCompare(b.finishedAt));
  return { createdWith: ordered[0]?.version ?? null, updatedWith: ordered.at(-1)?.version ?? null };
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
