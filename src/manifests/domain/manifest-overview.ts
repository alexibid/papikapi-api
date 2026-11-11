import { roundCost, roundSeconds, sum, summarize } from './figure-manifest.js';
import type {
  DayActivity,
  FigureSources,
  LatestStepRow,
  ManifestOverview,
  PipelineStepInfo,
  StepRunRow,
  StepStatistics,
} from './manifest.types.js';

const TOP_FIGURES = 5;

/**
 * Pipeline-wide figures: what every step takes on average (its latest successful run per figure), what one figure
 * costs end to end (the sum of those averages) and what `estimateFigures` more would take, plus what was really
 * spent, repeats included, by step and by day.
 */
export function overviewOf(
  figures: readonly FigureSources[],
  pipeline: readonly PipelineStepInfo[],
  estimateFigures: number,
): ManifestOverview {
  const steps = pipeline.map((step) => statisticsOf(step, figures));
  const runs = figures.flatMap((sources) => sources.runs);
  const perFigure = {
    seconds: roundSeconds(sum(steps.map((step) => step.avgSeconds))),
    costUsd: roundCost(sum(steps.map((step) => step.avgCostUsd))),
  };
  const summaries = figures.map((sources) => summarize(sources, pipeline));
  return {
    figures: figures.length,
    spent: {
      seconds: roundSeconds(sum(runs.map((run) => run.seconds))),
      costUsd: roundCost(sum(runs.map((run) => run.costUsd))),
      runs: runs.length,
    },
    perFigure,
    estimate: {
      figures: estimateFigures,
      seconds: roundSeconds(perFigure.seconds * estimateFigures),
      costUsd: roundCost(perFigure.costUsd * estimateFigures),
    },
    steps,
    byDay: daysOf(runs),
    mostExpensive: [...summaries].sort((a, b) => b.costUsd - a.costUsd).slice(0, TOP_FIGURES),
    slowest: [...summaries].sort((a, b) => b.seconds - a.seconds).slice(0, TOP_FIGURES),
  };
}

function statisticsOf(step: PipelineStepInfo, figures: readonly FigureSources[]): StepStatistics {
  const done: LatestStepRow[] = figures.flatMap((sources) =>
    sources.steps.filter((row) => row.stageId === step.stageId && row.status === 'DONE'));
  const runs: StepRunRow[] = figures.flatMap((sources) => sources.runs.filter((run) => run.stageId === step.stageId));
  const seconds = done.map((row) => row.seconds);
  return {
    ...step,
    figures: done.length,
    avgSeconds: roundSeconds(average(seconds)),
    minSeconds: roundSeconds(seconds.length ? Math.min(...seconds) : 0),
    maxSeconds: roundSeconds(seconds.length ? Math.max(...seconds) : 0),
    avgCostUsd: roundCost(average(done.map((row) => row.costUsd))),
    runs: runs.length,
    spentCostUsd: roundCost(sum(runs.map((run) => run.costUsd))),
  };
}

function daysOf(runs: readonly StepRunRow[]): readonly DayActivity[] {
  const days = new Map<string, StepRunRow[]>();
  for (const run of runs) {
    const day = run.finishedAt.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), run]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, dayRuns]) => ({
      day,
      runs: dayRuns.length,
      seconds: roundSeconds(sum(dayRuns.map((run) => run.seconds))),
      costUsd: roundCost(sum(dayRuns.map((run) => run.costUsd))),
    }));
}

function average(values: readonly number[]): number {
  return values.length ? sum(values) / values.length : 0;
}
