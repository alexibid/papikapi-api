export interface ManifestStageRecord {
  readonly stageId: string;
  readonly status: string;
  readonly seconds: number;
  readonly costUsd: number;
  readonly costNote?: string;
  readonly parameters?: Record<string, unknown>;
  readonly metrics?: Record<string, unknown>;
  readonly data?: Record<string, unknown>;
  readonly at: string;
}

export interface ModelRecord {
  readonly id: string;
  readonly subject: string;
  readonly prompt?: string;
  readonly fluxPrompt?: string;
  readonly status: string;
  readonly chosenPick?: number;
  readonly totalSeconds: number;
  readonly totalCostUsd: number;
  readonly primaryMeshPath?: string;
  readonly sheetPath?: string;
  readonly previewPath?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly stages?: readonly ManifestStageRecord[];
}

export interface StageTimingAggregate {
  readonly stageId: string;
  readonly sampleCount: number;
  readonly avgSeconds: number;
  readonly minSeconds: number;
  readonly maxSeconds: number;
  readonly totalCostUsd: number;
}

export interface ManifestQueryFilter {
  readonly query?: string;
  readonly status?: string;
  readonly minTotalSeconds?: number;
  readonly maxTotalSeconds?: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface IManifestRepository {
  findAll(filter?: ManifestQueryFilter): Promise<readonly ModelRecord[]>;
  findById(id: string): Promise<ModelRecord | null>;
  save(model: ModelRecord): Promise<void>;
  delete(id: string): Promise<boolean>;
  getStageAggregates(): Promise<readonly StageTimingAggregate[]>;
  getTotalTimes(): Promise<
    readonly {
      id: string;
      subject: string;
      totalSeconds: number;
      stagesCount: number;
    }[]
  >;
  count(filter?: ManifestQueryFilter): Promise<number>;
}

export const MANIFEST_REPOSITORY = Symbol('MANIFEST_REPOSITORY');
