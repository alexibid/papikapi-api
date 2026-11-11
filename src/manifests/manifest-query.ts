import { BadRequestException } from '@nestjs/common';
import type { FigureStatus, ManifestListQuery, ManifestSortKey } from './domain/manifest.types.js';

export interface RawListQuery {
  readonly query?: string;
  readonly status?: string;
  readonly from?: string;
  readonly to?: string;
  readonly sort?: string;
  readonly order?: string;
  readonly limit?: string;
  readonly offset?: string;
}

const SORT_KEYS: readonly ManifestSortKey[] = ['name', 'created', 'updated', 'cost', 'seconds'];
const STATUSES: readonly FigureStatus[] = ['DONE', 'FAILED', 'IN_PROGRESS', 'PENDING'];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The list query as typed values; anything malformed is a 400 that says which parameter is wrong. */
export function listQueryOf(raw: RawListQuery): ManifestListQuery {
  return {
    query: raw.query?.trim() || undefined,
    status: oneOf(raw.status?.toUpperCase(), STATUSES, 'status'),
    from: dayOf(raw.from, 'from'),
    to: dayOf(raw.to, 'to'),
    sort: oneOf(raw.sort, SORT_KEYS, 'sort') ?? 'updated',
    order: oneOf(raw.order, ['asc', 'desc'] as const, 'order') ?? 'desc',
    limit: Math.min(wholeNumber(raw.limit, 'limit') ?? DEFAULT_LIMIT, MAX_LIMIT),
    offset: wholeNumber(raw.offset, 'offset') ?? 0,
  };
}

export function estimateOf(raw: string | undefined): number {
  return wholeNumber(raw, 'figures') ?? 1;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], name: string): T | undefined {
  if (value === undefined || value === '') return undefined;
  const found = allowed.find((option) => option === value);
  if (!found) {
    throw new BadRequestException(`'${name}' must be one of: ${allowed.join(', ')}`);
  }
  return found;
}

function dayOf(value: string | undefined, name: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (!DAY.test(value)) {
    throw new BadRequestException(`'${name}' must be a day as YYYY-MM-DD`);
  }
  return value;
}

function wholeNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`'${name}' must be a whole number of zero or more`);
  }
  return parsed;
}
