import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class WorkspacePaths {
  private static readonly here = dirname(fileURLToPath(import.meta.url));
  public static readonly appRoot = resolve(WorkspacePaths.here, '../../..');
  public static readonly workspaceRoot = resolve(WorkspacePaths.appRoot, '../..');
  public static readonly envFile = join(WorkspacePaths.appRoot, '.env');

  public static get resourcesDir(): string {
    return join(WorkspacePaths.appRoot, 'resources');
  }

  public static get publicModelsDir(): string {
    return join(WorkspacePaths.appRoot, 'public/models');
  }

  public static resourcePath(subject: string): string {
    return join(WorkspacePaths.resourcesDir, subject);
  }

  public static modelPath(subject: string): string {
    return join(WorkspacePaths.publicModelsDir, subject);
  }

  public static stageResourceDir(subject: string, stageDir: string): string {
    return join(WorkspacePaths.resourcePath(subject), stageDir);
  }
}
