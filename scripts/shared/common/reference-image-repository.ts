import { PapikapiDatabase } from './papikapi-database.js';

interface PathRow {
  readonly path: string;
}

/** Reference photos of a figure, registered in model_files with file_type 'reference'. */
export class ReferenceImageRepository {
  public static paths(model: string): readonly string[] {
    const rows: readonly unknown[] = PapikapiDatabase.connection()
      .prepare("SELECT path FROM model_files WHERE model_id = ? AND file_type = 'reference' ORDER BY id")
      .all(model);
    return rows.filter((row): row is PathRow => this.isPathRow(row)).map((row) => row.path);
  }

  private static isPathRow(row: unknown): row is PathRow {
    return typeof row === 'object' && row !== null && 'path' in row && typeof row.path === 'string';
  }
}
