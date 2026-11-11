import { existsSync } from 'node:fs';
import type { FigureDisplayNames, FigureIdentity, FigureLanguage } from './interfaces/index.js';
import { FigureId } from './figure-id.js';
import { PapikapiDatabase } from './papikapi-database.js';
import { WorkspacePaths } from './workspace-paths.js';

interface IdentityRow {
  readonly id: string;
  readonly subject: string;
  readonly display_name_pt: string | null;
  readonly display_name_en: string | null;
}

export class FigureRegistry {
  public static newId(): string {
    let id = FigureId.generate();
    while (this.exists(id)) id = FigureId.generate();
    return id;
  }

  public static exists(id: string): boolean {
    return this.rowOf(id) !== undefined
      || existsSync(WorkspacePaths.resourcePath(id))
      || existsSync(WorkspacePaths.modelPath(id));
  }

  public static hasDisplayName(id: string): boolean {
    return Boolean(this.rowOf(id)?.display_name_pt);
  }

  public static register(identity: FigureIdentity): void {
    const now = new Date().toISOString();
    PapikapiDatabase.connection()
      .prepare(`
        INSERT INTO models (id, subject, display_name_pt, display_name_en, status, created_at, updated_at)
        VALUES (@id, @subject, @pt, @en, 'PENDING', @now, @now)
        ON CONFLICT(id) DO UPDATE SET
          subject = @subject, display_name_pt = @pt, display_name_en = @en, updated_at = @now
      `)
      .run({ id: identity.id, subject: identity.subject, ...identity.displayName, now });
  }

  public static identityOf(id: string): FigureIdentity {
    const row = this.rowOf(id);
    const subject = row?.subject ?? id;
    const fallback = this.humanize(subject);
    return {
      id,
      subject,
      displayName: { pt: row?.display_name_pt ?? fallback, en: row?.display_name_en ?? fallback },
    };
  }

  public static displayNameOf(id: string, language: FigureLanguage): string {
    return this.identityOf(id).displayName[language];
  }

  public static subjectFrom(displayName: FigureDisplayNames): string {
    return displayName.en
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  public static humanize(subject: string): string {
    const words = subject.split('-').filter(Boolean).join(' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  private static rowOf(id: string): IdentityRow | undefined {
    const row: unknown = PapikapiDatabase.connection()
      .prepare('SELECT id, subject, display_name_pt, display_name_en FROM models WHERE id = ?')
      .get(id);
    return this.isIdentityRow(row) ? row : undefined;
  }

  private static isIdentityRow(row: unknown): row is IdentityRow {
    return typeof row === 'object' && row !== null && 'id' in row && 'subject' in row;
  }
}
