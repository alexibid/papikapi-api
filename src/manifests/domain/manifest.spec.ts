import { describe, expect, it } from 'vitest';
import { listQueryOf } from '../manifest-query.js';
import { detailOf, statusOf, summarize } from './figure-manifest.js';
import { pageOf } from './manifest-listing.js';
import { overviewOf } from './manifest-overview.js';
import type { FigureSources, LatestStepRow, PipelineStepInfo, StepRunRow } from './manifest.types.js';

const PIPELINE: readonly PipelineStepInfo[] = [
  { stageId: 's1-step-1', stage: 'Stage 1', name: 'Alternatives', label: 'ALTERNATIVES' },
  { stageId: 's2-step-2', stage: 'Stage 2', name: 'TRELLIS', label: '3D-GLB' },
];

function step(stageId: string, seconds: number, costUsd: number): LatestStepRow {
  return { modelId: 'm', stageId, status: 'DONE', seconds, costUsd, costNote: null,
    finishedAt: '2026-11-05T10:00:00.000Z', metrics: null, data: null };
}

function run(stageId: string, costUsd: number, finishedAt: string, version = '0.1.0'): StepRunRow {
  return { modelId: 'm', stageId, status: 'DONE', seconds: 10, costUsd, costNote: null,
    startedAt: finishedAt, finishedAt, version };
}

function figure(id: string, namePt: string, runs: readonly StepRunRow[]): FigureSources {
  return {
    model: { id, subject: id, name: { pt: namePt, en: namePt }, prompt: `a cute ${namePt}`, fluxPrompt: null,
      chosenPick: 2, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-05T10:00:00.000Z' },
    steps: [step('s1-step-1', 20, 0.003), step('s2-step-2', 100, 0.07), step('s9-old', 5, 1)],
    runs,
    files: [{ kind: 'preview-three-quarter', url: `/models/${id}/preview-three-quarter.webp`, bytes: 1 }],
  };
}

const ALEX = figure('alex', 'Alex', [run('s1-step-1', 0.003, '2026-11-04T09:00:00.000Z'),
  run('s2-step-2', 0.07, '2026-11-04T10:00:00.000Z'), run('s2-step-2', 0.09, '2026-11-05T10:00:00.000Z', '0.2.0')]);
const PUG = figure('pug', 'Pug', [run('s2-step-2', 0.05, '2026-11-05T11:00:00.000Z')]);

describe('figure manifest', () => {
  it('counts every run in the spent totals and only the latest pipeline steps in the pipeline totals', () => {
    const detail = detailOf(ALEX, PIPELINE);
    expect(detail.totals).toEqual({ pipelineSeconds: 120, pipelineCostUsd: 0.073, spentSeconds: 30,
      spentCostUsd: 0.163, runs: 3 });
  });

  it('lists the steps in pipeline order with their run count, newest run first in the history', () => {
    const detail = detailOf(ALEX, PIPELINE);
    expect(detail.steps.map((entry) => [entry.stageId, entry.runs])).toEqual([['s1-step-1', 1], ['s2-step-2', 2]]);
    expect(detail.history[0].finishedAt).toBe('2026-11-05T10:00:00.000Z');
  });

  it('names the versions the figure was created and last changed with, and each step its own', () => {
    const detail = detailOf(ALEX, PIPELINE);
    expect(detail.versions).toEqual({ createdWith: '0.1.0', updatedWith: '0.2.0' });
    expect(detail.steps[1].version).toBe('0.2.0');
  });

  it('is done only when every pipeline step is done', () => {
    expect(statusOf([step('s1-step-1', 1, 0)], PIPELINE)).toBe('IN_PROGRESS');
    expect(statusOf([], PIPELINE)).toBe('PENDING');
    expect(statusOf([{ ...step('s2-step-2', 1, 0), status: 'FAILED' }], PIPELINE)).toBe('FAILED');
    expect(summarize(ALEX, PIPELINE).status).toBe('DONE');
  });
});

describe('manifest listing', () => {
  it('finds a figure by its name and sorts by cost', () => {
    const page = pageOf([ALEX, PUG], PIPELINE, listQueryOf({ query: 'pug' }));
    expect(page.items.map((item) => item.id)).toEqual(['pug']);
    const byCost = pageOf([ALEX, PUG], PIPELINE, listQueryOf({ sort: 'cost', order: 'asc' }));
    expect(byCost.items.map((item) => item.id)).toEqual(['pug', 'alex']);
  });

  it('rejects an unknown sort key', () => {
    expect(() => listQueryOf({ sort: 'colour' })).toThrow("'sort' must be one of");
  });
});

describe('manifest overview', () => {
  it('averages each step over the figures and estimates more figures from those averages', () => {
    const overview = overviewOf([ALEX, PUG], PIPELINE, 30);
    expect(overview.perFigure).toEqual({ seconds: 120, costUsd: 0.073 });
    expect(overview.estimate).toEqual({ figures: 30, seconds: 3600, costUsd: 2.19 });
    expect(overview.spent.costUsd).toBe(0.213);
    expect(overview.byDay.map((day) => [day.day, day.runs])).toEqual([['2026-11-05', 2], ['2026-11-04', 2]]);
  });
});
