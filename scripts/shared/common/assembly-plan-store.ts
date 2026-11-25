import type Database from 'better-sqlite3';
import { PapikapiDatabase } from './papikapi-database.js';

interface AssemblyPlanRow {
  readonly assembly_plan: string | null;
}

interface ColumnInfo {
  readonly name: string;
}

function isAssemblyPlanRow(value: unknown): value is AssemblyPlanRow {
  return (
    typeof value === 'object' &&
    value !== null &&
    'assembly_plan' in value &&
    (typeof value.assembly_plan === 'string' || value.assembly_plan === null)
  );
}

function isColumnInfo(value: unknown): value is ColumnInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    typeof value.name === 'string'
  );
}

export class AssemblyPlanStore {
  public static save(modelId: string, assemblyPlan: string): void {
    const db = PapikapiDatabase.connection();
    this.ensureAssemblyPlanColumn(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO models (id, subject, status, assembly_plan, created_at, updated_at)
       VALUES (?, ?, 'DONE', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         assembly_plan = excluded.assembly_plan,
         updated_at = excluded.updated_at`,
    ).run(modelId, modelId, assemblyPlan, now, now);
  }

  public static has(modelId: string): boolean {
    const db = PapikapiDatabase.connection();
    if (!this.hasAssemblyPlanColumn(this.modelColumns(db))) {
      return false;
    }
    const row: unknown = db
      .prepare('SELECT assembly_plan FROM models WHERE id = ?')
      .get(modelId);
    return (
      isAssemblyPlanRow(row) &&
      typeof row.assembly_plan === 'string' &&
      row.assembly_plan.trim().length > 0
    );
  }

  private static ensureAssemblyPlanColumn(db: Database.Database): void {
    const columns = this.modelColumns(db);
    if (columns.length > 0 && !this.hasAssemblyPlanColumn(columns)) {
      db.exec('ALTER TABLE models ADD COLUMN assembly_plan TEXT');
    }
  }

  private static modelColumns(db: Database.Database): readonly ColumnInfo[] {
    return db.prepare('PRAGMA table_info(models)').all().filter(isColumnInfo);
  }

  private static hasAssemblyPlanColumn(columns: readonly ColumnInfo[]): boolean {
    return columns.some((column) => column.name === 'assembly_plan');
  }
}
