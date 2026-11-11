import type { FigureDisplayNames } from '../common/interfaces/index.js';
import type { PickAlternativeResponse } from '../../stage-1/stage-1.interface.js';
import type { TrellisGenerateResponse } from '../../stage-2/interfaces/trellis.interface.js';

export interface CreatorModelInfo {
  readonly id: string;
  readonly hasAlternatives: boolean;
  readonly sheetUrl: string | null;
  readonly cachedPicks: readonly number[];
  readonly currentPick: number | null;
}

export interface CreatorSheetFile {
  readonly bytes: Buffer;
  readonly mime: string;
}

export interface CreatorBuildResult {
  readonly cropResult: PickAlternativeResponse;
  readonly trellisResult: TrellisGenerateResponse;
}

export interface CreatorPickResponse {
  readonly success: boolean;
  readonly id: string;
  readonly pick: number;
  readonly cached: boolean;
  readonly artPath: string;
  readonly modelPath: string;
}

export interface CreatorIdentityRequest {
  readonly id?: string;
  readonly prompt: string;
  readonly displayName?: FigureDisplayNames;
}

export interface CreatorGenerationRequest {
  readonly prompt: string;
  readonly images?: readonly string[];
}

export interface CreatorGeneratePayload extends CreatorIdentityRequest {
  readonly images?: readonly string[];
}

export interface CreatorPickPayload {
  readonly id: string;
  readonly pick: number;
}
