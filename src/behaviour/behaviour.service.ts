import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { DRIZZLE_DB } from '../database/database.provider.js';
import * as schema from '../database/schema.js';
import {
  AnchorDefinition,
  CANONICAL_ANCHOR_CATALOGUE,
  CANONICAL_ANCHORS,
  CanonicalAnchorId,
  CanonicalDomainId,
  NEGATION_WORDS_EN,
  RESOLUTION_CONJUNCTIONS_EN,
} from './behaviour.constants.js';

export interface EvaluatedDomainHit {
  domain: CanonicalDomainId;
  points: number;
  anchor: CanonicalAnchorId;
  explanationEn: string;
  explanationPt: string;
}

export interface BehaviourEvaluationResult {
  hits: EvaluatedDomainHit[];
  totalPoints: number;
  explanationEn: string;
  explanationPt: string;
}

export interface CompiledModelSnapshot {
  version: number;
  updatedAt: string;
  domains: readonly string[];
  anchors: Record<CanonicalAnchorId, AnchorDefinition>;
  negations: readonly string[];
  resolutions: readonly string[];
}

@Injectable()
export class BehaviourService implements OnModuleInit {
  constructor(
    @Inject(DRIZZLE_DB)
    private readonly db: BetterSQLite3Database<typeof schema>
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureInitialSeed();
  }

  async getLatestModel(): Promise<CompiledModelSnapshot> {
    const active = this.db
      .select()
      .from(schema.behaviourModelVersionsTable)
      .where(eq(schema.behaviourModelVersionsTable.isActive, 1))
      .get();

    if (active) {
      try {
        return JSON.parse(active.compiledSnapshot) as CompiledModelSnapshot;
      } catch {
        // Fallback to fresh compilation
      }
    }

    return this.compileSnapshot(1);
  }

  evaluateText(rawText: string): BehaviourEvaluationResult {
    const text = rawText.toLowerCase();
    const clauses = this.splitClauses(text);
    const domainScores: Partial<Record<CanonicalDomainId, { points: number; anchor: CanonicalAnchorId }>> = {};
    const hits: EvaluatedDomainHit[] = [];

    for (const clause of clauses) {
      const isNegated = NEGATION_WORDS_EN.some((neg) => {
        const regex = new RegExp(`\\b${neg}\\b`, 'i');
        return regex.test(clause);
      });

      if (isNegated) {
        continue;
      }

      for (const anchorId of CANONICAL_ANCHORS) {
        const def = CANONICAL_ANCHOR_CATALOGUE[anchorId];
        const match = def.keywords.some((kw) => {
          const regex = new RegExp(`\\b${kw}\\b`, 'i');
          return regex.test(clause);
        });

        if (match) {
          const current = domainScores[def.domain];
          const newPoints = Math.min((current?.points ?? 0) + def.defaultWeight, 3);
          domainScores[def.domain] = { points: newPoints, anchor: anchorId };
        }
      }
    }

    for (const [domain, data] of Object.entries(domainScores) as [CanonicalDomainId, { points: number; anchor: CanonicalAnchorId }][]) {
      const def = CANONICAL_ANCHOR_CATALOGUE[data.anchor];
      hits.push({
        domain,
        points: data.points,
        anchor: data.anchor,
        explanationEn: def.explanationEn,
        explanationPt: def.explanationPt,
      });
    }

    // Sort descending by points
    hits.sort((a, b) => b.points - a.points);

    const totalPoints = hits.reduce((sum, h) => sum + h.points, 0);

    const explanationEn = this.composeExplanation(hits, 'en');
    const explanationPt = this.composeExplanation(hits, 'pt');

    return {
      hits,
      totalPoints,
      explanationEn,
      explanationPt,
    };
  }

  private splitClauses(text: string): string[] {
    const rawClauses = text.split(/[.,;:!?]+/);
    const result: string[] = [];
    const splitRegex = new RegExp(`\\s+(?:${RESOLUTION_CONJUNCTIONS_EN.join('|')}|and)\\s+`, 'i');

    for (const part of rawClauses) {
      const segments = part.split(splitRegex).map((s) => s.trim()).filter(Boolean);
      result.push(...segments);
    }

    return result.length > 0 ? result : [text.trim()];
  }

  private composeExplanation(hits: EvaluatedDomainHit[], lang: 'en' | 'pt'): string {
    if (hits.length === 0) {
      return lang === 'en'
        ? 'A calm day observed with balanced participation.'
        : 'Um dia calmo registado com participação equilibrada.';
    }

    const items = hits.map((h) => (lang === 'en' ? h.explanationEn : h.explanationPt));
    if (lang === 'en') {
      return `Outstanding effort today: ${items.join('; ')}.`;
    }
    return `Excelente dedicação hoje: ${items.join('; ')}.`;
  }

  private compileSnapshot(version: number): CompiledModelSnapshot {
    return {
      version,
      updatedAt: new Date().toISOString(),
      domains: ['chores', 'school', 'behavior', 'dialogue', 'family'],
      anchors: CANONICAL_ANCHOR_CATALOGUE,
      negations: NEGATION_WORDS_EN,
      resolutions: RESOLUTION_CONJUNCTIONS_EN,
    };
  }

  private async ensureInitialSeed(): Promise<void> {
    const existing = this.db.select().from(schema.behaviourModelVersionsTable).get();
    if (!existing) {
      const snapshot = this.compileSnapshot(1);
      this.db
        .insert(schema.behaviourModelVersionsTable)
        .values({
          id: 'v1',
          versionNumber: 1,
          isActive: 1,
          compiledSnapshot: JSON.stringify(snapshot),
          checksum: 'init_v1',
          createdAt: new Date().toISOString(),
        })
        .run();
    }
  }
}
