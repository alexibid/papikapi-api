export type FigureStatus = 'DONE' | 'FAILED' | 'IN_PROGRESS' | 'PENDING';

export interface DisplayNames {
  readonly pt: string;
  readonly en: string;
}

export interface PipelineStepInfo {
  readonly stageId: string;
  readonly stage: string;
  readonly name: string;
  readonly label: string;
}

export interface ModelRow {
  readonly id: string;
  readonly subject: string;
  readonly name: DisplayNames;
  readonly prompt: string | null;
  readonly fluxPrompt: string | null;
  readonly chosenPick: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LatestStepRow {
  readonly modelId: string;
  readonly stageId: string;
  readonly status: string;
  readonly seconds: number;
  readonly costUsd: number;
  readonly costNote: string | null;
  readonly finishedAt: string | null;
  readonly metrics: Readonly<Record<string, unknown>> | null;
  readonly data: Readonly<Record<string, unknown>> | null;
}

export interface StepRunRow {
  readonly modelId: string;
  readonly stageId: string;
  readonly status: string;
  readonly seconds: number;
  readonly costUsd: number;
  readonly costNote: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly version: string | null;
}

export interface PublishedFile {
  readonly kind: string;
  readonly url: string;
  readonly bytes: number;
}

export interface FigureSources {
  readonly model: ModelRow;
  readonly steps: readonly LatestStepRow[];
  readonly runs: readonly StepRunRow[];
  readonly files: readonly PublishedFile[];
}

export interface FigureTotals {
  readonly pipelineSeconds: number;
  readonly pipelineCostUsd: number;
  readonly spentSeconds: number;
  readonly spentCostUsd: number;
  readonly runs: number;
}

export interface FigureFacts {
  readonly mode: string | null;
  readonly paperFaces: number | null;
  readonly eyeTexels: number | null;
  readonly artEyes: boolean;
}

export interface ManifestStep extends PipelineStepInfo {
  readonly status: string;
  readonly seconds: number;
  readonly costUsd: number;
  readonly costNote: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly runs: number;
  readonly spentCostUsd: number;
  readonly version: string | null;
  readonly metrics: Readonly<Record<string, unknown>> | null;
  readonly data: Readonly<Record<string, unknown>> | null;
}

export interface ManifestRun {
  readonly stageId: string;
  readonly status: string;
  readonly seconds: number;
  readonly costUsd: number;
  readonly costNote: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly version: string | null;
}

export interface FigureVersions {
  readonly createdWith: string | null;
  readonly updatedWith: string | null;
}

export interface ManifestSummary {
  readonly id: string;
  readonly name: DisplayNames;
  readonly subject: string;
  readonly status: FigureStatus;
  readonly seconds: number;
  readonly costUsd: number;
  readonly runs: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly versions: FigureVersions;
  readonly previewUrl: string | null;
}

export interface ManifestDetail extends Omit<ManifestSummary, 'seconds' | 'costUsd' | 'runs' | 'previewUrl'> {
  readonly prompt: string | null;
  readonly fluxPrompt: string | null;
  readonly chosenPick: number | null;
  readonly figure: FigureFacts;
  readonly totals: FigureTotals;
  readonly steps: readonly ManifestStep[];
  readonly history: readonly ManifestRun[];
  readonly files: readonly PublishedFile[];
}

export type ManifestSortKey = 'name' | 'created' | 'updated' | 'cost' | 'seconds';

export interface ManifestListQuery {
  readonly query?: string;
  readonly status?: FigureStatus;
  readonly from?: string;
  readonly to?: string;
  readonly sort: ManifestSortKey;
  readonly order: 'asc' | 'desc';
  readonly limit: number;
  readonly offset: number;
}

export interface ManifestPage {
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly items: readonly ManifestSummary[];
}

export interface StepStatistics extends PipelineStepInfo {
  readonly figures: number;
  readonly avgSeconds: number;
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly avgCostUsd: number;
  readonly runs: number;
  readonly spentCostUsd: number;
}

export interface DayActivity {
  readonly day: string;
  readonly runs: number;
  readonly seconds: number;
  readonly costUsd: number;
}

export interface ManifestOverview {
  readonly figures: number;
  readonly spent: { readonly seconds: number; readonly costUsd: number; readonly runs: number };
  readonly perFigure: { readonly seconds: number; readonly costUsd: number };
  readonly estimate: { readonly figures: number; readonly seconds: number; readonly costUsd: number };
  readonly steps: readonly StepStatistics[];
  readonly byDay: readonly DayActivity[];
  readonly mostExpensive: readonly ManifestSummary[];
  readonly slowest: readonly ManifestSummary[];
}
