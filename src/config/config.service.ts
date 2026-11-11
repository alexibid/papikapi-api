import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

@Injectable()
export class ApiConfigService {
  private readonly _resourcesDir: string;
  private readonly _modelsDir: string;

  constructor() {
    const cwd = process.cwd();

    // Resolve resources directory path
    if (process.env['PAPIKAPI_RESOURCES_DIR']) {
      this._resourcesDir = process.env['PAPIKAPI_RESOURCES_DIR'];
    } else if (existsSync(join(cwd, 'resources'))) {
      this._resourcesDir = join(cwd, 'resources');
    } else if (existsSync(join(cwd, 'apps/papikapi-api/resources'))) {
      this._resourcesDir = join(cwd, 'apps/papikapi-api/resources');
    } else {
      this._resourcesDir = resolve(cwd, 'resources');
    }

    // Resolve models directory path
    if (process.env['PAPIKAPI_MODELS_DIR']) {
      this._modelsDir = process.env['PAPIKAPI_MODELS_DIR'];
    } else if (existsSync(join(cwd, 'public/models'))) {
      this._modelsDir = join(cwd, 'public/models');
    } else if (existsSync(join(cwd, 'apps/papikapi-api/public/models'))) {
      this._modelsDir = join(cwd, 'apps/papikapi-api/public/models');
    } else {
      this._modelsDir = resolve(cwd, 'public/models');
    }
  }

  get resourcesDir(): string {
    return this._resourcesDir;
  }

  get modelsDir(): string {
    return this._modelsDir;
  }

  get databasePath(): string {
    if (process.env['PAPIKAPI_DATABASE_PATH']) {
      return process.env['PAPIKAPI_DATABASE_PATH'];
    }
    return join(this._resourcesDir, 'papikapi.db');
  }

  modelDir(name: string): string {
    return join(this._modelsDir, this.cleanName(name));
  }

  resourceDir(name: string): string {
    return join(this._resourcesDir, this.cleanName(name));
  }

  cleanName(name: string): string {
    return (name || '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
}
