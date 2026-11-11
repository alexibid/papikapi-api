import type { StepPrompts } from './interfaces/index.js';
import { PapikapiDatabase } from './papikapi-database.js';

interface ContentRow {
  readonly content: string;
}

interface PromptEntry {
  readonly id: string;
  readonly stepId: string;
  readonly modelId: string | null;
  readonly content: string;
}

/** Every prompt of the pipeline lives in the `prompts` table: the step's system parts and each figure's own text. */
export class PromptRepository {
  public static forStep(stepId: string): StepPrompts {
    const system = this.read(`${stepId}:system`);
    if (!system) throw new Error(`No system prompt for step '${stepId}' in the prompts table`);
    return {
      system,
      referenceRule: this.read(`${stepId}:reference_rule`),
      defaultPose: this.read(`${stepId}:default_pose`),
      supportedPose: this.read(`${stepId}:supported_pose`),
      fourLeggedPose: this.read(`${stepId}:four_legged_pose`),
      negative: this.read(`${stepId}:negative`),
    };
  }

  public static forFigure(model: string): string {
    const prompt = this.read(this.figureId(model));
    if (!prompt) throw new Error(`No prompt for figure '${model}' in the prompts table: run step 1 with --prompt`);
    return prompt;
  }

  public static saveStepPart(id: string, content: string): void {
    const stepId = id.split(':')[0];
    this.upsert({ id, stepId, modelId: null, content });
  }

  public static saveFigure(model: string, stepId: string, content: string): void {
    const now = new Date().toISOString();
    PapikapiDatabase.connection()
      .prepare(
        `INSERT INTO models (id, subject, status, created_at, updated_at) VALUES (?, ?, 'PENDING', ?, ?)
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(model, model, now, now);
    this.upsert({ id: this.figureId(model), stepId, modelId: model, content });
  }

  private static figureId(model: string): string {
    return `figure:${model}`;
  }

  private static read(id: string): string | undefined {
    const row: unknown = PapikapiDatabase.connection().prepare('SELECT content FROM prompts WHERE id = ?').get(id);
    return this.isContentRow(row) && row.content.trim().length > 0 ? row.content : undefined;
  }

  private static upsert(entry: PromptEntry): void {
    PapikapiDatabase.connection()
      .prepare(
        `INSERT INTO prompts (id, step_id, model_id, content, updated_at) VALUES (@id, @stepId, @modelId, @content, @now)
         ON CONFLICT(id) DO UPDATE SET content = excluded.content, step_id = excluded.step_id,
           model_id = excluded.model_id, updated_at = excluded.updated_at`,
      )
      .run({ ...entry, now: new Date().toISOString() });
  }

  private static isContentRow(row: unknown): row is ContentRow {
    return typeof row === 'object' && row !== null && 'content' in row && typeof row.content === 'string';
  }
}
