import { Injectable } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

@Injectable()
export class ApiConfigService {
  private readonly _resourcesDir: string;
  private readonly _modelsDir: string;
  private readonly _pipelinePath: string;

  constructor() {
    const cwd = process.cwd();

    // Resolve pipeline.json path
    if (process.env['PAPIKAPI_PIPELINE_PATH']) {
      this._pipelinePath = process.env['PAPIKAPI_PIPELINE_PATH'];
    } else if (existsSync(join(cwd, 'pipeline.json'))) {
      this._pipelinePath = join(cwd, 'pipeline.json');
    } else {
      this._pipelinePath = resolve(cwd, '../papikapi-studio/pipeline.json');
    }

    // Resolve resources directory path
    if (process.env['PAPIKAPI_RESOURCES_DIR']) {
      this._resourcesDir = process.env['PAPIKAPI_RESOURCES_DIR'];
    } else if (existsSync(join(cwd, 'resources'))) {
      this._resourcesDir = join(cwd, 'resources');
    } else {
      this._resourcesDir = resolve(cwd, '../papikapi-studio/resources');
    }

    // Resolve models directory path
    if (process.env['PAPIKAPI_MODELS_DIR']) {
      this._modelsDir = process.env['PAPIKAPI_MODELS_DIR'];
    } else if (existsSync(join(cwd, 'public/models'))) {
      this._modelsDir = join(cwd, 'public/models');
    } else {
      this._modelsDir = resolve(cwd, '../papikapi-studio/public/models');
    }
  }

  get resourcesDir(): string {
    return this._resourcesDir;
  }

  get modelsDir(): string {
    return this._modelsDir;
  }

  get pipelinePath(): string {
    return this._pipelinePath;
  }

  get databasePath(): string {
    if (process.env['PAPIKAPI_DATABASE_PATH']) {
      return process.env['PAPIKAPI_DATABASE_PATH'];
    }
    return join(this._resourcesDir, 'papikapi.db');
  }

  get indexFile(): string {
    return join(this._modelsDir, 'index.json');
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
