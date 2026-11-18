import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, vi } from 'vitest';
import { PapikapiDatabase } from '../common/papikapi-database.js';
import { PipelineConfigLoader } from '../common/pipeline-config.js';
import { WorkspacePaths } from '../common/workspace-paths.js';
import { fixtureDatabase, pipelineConfigFixture } from './test-fixtures.js';

const sandbox = mkdtempSync(join(tmpdir(), 'papikapi-spec-'));

vi.spyOn(WorkspacePaths, 'resourcesDir', 'get').mockReturnValue(join(sandbox, 'resources'));
vi.spyOn(WorkspacePaths, 'publicModelsDir', 'get').mockReturnValue(join(sandbox, 'public', 'models'));
vi.spyOn(PipelineConfigLoader, 'load').mockReturnValue(pipelineConfigFixture());
vi.spyOn(PapikapiDatabase, 'connection').mockReturnValue(fixtureDatabase());

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));
