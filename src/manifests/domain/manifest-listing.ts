import { summarize } from './figure-manifest.js';
import type {
  FigureSources,
  ManifestListQuery,
  ManifestPage,
  ManifestSortKey,
  ManifestSummary,
  PipelineStepInfo,
} from './manifest.types.js';

type Comparator = (a: ManifestSummary, b: ManifestSummary) => number;

const COMPARATORS: Readonly<Record<ManifestSortKey, Comparator>> = {
  name: (a, b) => a.name.pt.localeCompare(b.name.pt, 'pt'),
  created: (a, b) => a.createdAt.localeCompare(b.createdAt),
  updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
  cost: (a, b) => a.costUsd - b.costUsd,
  seconds: (a, b) => a.seconds - b.seconds,
};

/** Search, filter, sort and page the figures; the search covers the code, subject, both names and the prompt. */
export function pageOf(
  figures: readonly FigureSources[],
  pipeline: readonly PipelineStepInfo[],
  query: ManifestListQuery,
): ManifestPage {
  const matching = figures
    .filter((sources) => matchesText(sources, query.query))
    .map((sources) => summarize(sources, pipeline))
    .filter((summary) => matchesFilters(summary, query));
  const direction = query.order === 'asc' ? 1 : -1;
  const sorted = [...matching].sort((a, b) => COMPARATORS[query.sort](a, b) * direction);
  return {
    total: sorted.length,
    limit: query.limit,
    offset: query.offset,
    items: sorted.slice(query.offset, query.offset + query.limit),
  };
}

function matchesText(sources: FigureSources, text: string | undefined): boolean {
  const needle = text?.trim().toLowerCase();
  if (!needle) return true;
  const { model } = sources;
  return [model.id, model.subject, model.name.pt, model.name.en, model.prompt ?? '']
    .some((field) => field.toLowerCase().includes(needle));
}

function matchesFilters(summary: ManifestSummary, query: ManifestListQuery): boolean {
  const day = summary.updatedAt.slice(0, 10);
  return (!query.status || summary.status === query.status)
    && (!query.from || day >= query.from)
    && (!query.to || day <= query.to);
}
