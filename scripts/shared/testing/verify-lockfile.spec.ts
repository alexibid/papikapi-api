import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findOverrideMismatches,
  parseLsProblems,
  verifyLockfile,
} from '../../../../../tools/ci/verify-lockfile.mjs';
import {
  LS_MOCKS,
  OVERRIDE_MOCKS,
  VERIFY_STUBS,
  WORKSPACE_EXPECTATIONS,
} from './verify-lockfile.mock.js';

interface JsonRecord {
  [key: string]: unknown;
}

interface PackageVersionEntry {
  lockfilePath: string;
  version: string;
}

const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);

const readWorkspaceJson = (relativePath: string): JsonRecord => {
  const raw = readFileSync(resolve(WORKSPACE_ROOT, relativePath), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`Expected JSON object in ${relativePath}`);
  }
  return parsed;
};

const parseSemverParts = (version: string): [number, number, number] => {
  const core = version.split('-')[0].split('+')[0];
  const parts = core.split('.').map((part) => Number.parseInt(part, 10));
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
};

const isVersionAtLeast = (version: string, minimum: string): boolean => {
  const [majA, minA, patA] = parseSemverParts(version);
  const [majB, minB, patB] = parseSemverParts(minimum);
  if (majA !== majB) {
    return majA > majB;
  }
  if (minA !== minB) {
    return minA > minB;
  }
  return patA >= patB;
};

const isSafeFormDataVersion = (version: string): boolean => {
  const [major] = parseSemverParts(version);
  if (major === 2) {
    return isVersionAtLeast(version, WORKSPACE_EXPECTATIONS.minimumVersions.formDataLegacy);
  }
  return isVersionAtLeast(version, WORKSPACE_EXPECTATIONS.minimumVersions.formData);
};

const extractLockfilePackageVersions = (lockfile: JsonRecord, packageName: string): PackageVersionEntry[] => {
  const packages = lockfile['packages'];
  if (!isRecord(packages)) {
    return [];
  }
  const exactKey = `node_modules/${packageName}`;
  const nestedSuffix = `/node_modules/${packageName}`;
  const entries: PackageVersionEntry[] = [];
  for (const [lockfilePath, metadata] of Object.entries(packages)) {
    if (lockfilePath !== exactKey && !lockfilePath.endsWith(nestedSuffix)) {
      continue;
    }
    if (isRecord(metadata) && typeof metadata['version'] === 'string') {
      entries.push({ lockfilePath, version: metadata['version'] });
    }
  }
  return entries;
};

const collectAllowlistPackages = (allowlist: JsonRecord): string[] => {
  const accepted = allowlist['accepted'];
  if (!Array.isArray(accepted)) {
    return [];
  }
  const names: string[] = [];
  for (const entry of accepted) {
    if (isRecord(entry) && typeof entry['package'] === 'string') {
      names.push(entry['package']);
    }
  }
  return names;
};

describe('findOverrideMismatches', () => {
  it('should return an empty list when all lockfile packages satisfy root overrides', () => {
    const mismatches = findOverrideMismatches(OVERRIDE_MOCKS.cleanManifest, OVERRIDE_MOCKS.cleanLockfile);

    expect(mismatches).toEqual([]);
  });

  it('should return an empty list when root manifest has no overrides or lockfile has no packages', () => {
    expect(findOverrideMismatches(OVERRIDE_MOCKS.emptyManifest, OVERRIDE_MOCKS.cleanLockfile)).toEqual([]);
    expect(findOverrideMismatches(OVERRIDE_MOCKS.cleanManifest, OVERRIDE_MOCKS.emptyLockfile)).toEqual([]);
  });

  it('should detect nested and hoisted packages violating global overrides for axios and form-data', () => {
    const mismatches = findOverrideMismatches(
      OVERRIDE_MOCKS.globalOverrideManifest,
      OVERRIDE_MOCKS.globalMismatchLockfile,
    );

    expect(mismatches).toHaveLength(2);
    expect(mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: 'axios',
          lockfilePath: 'node_modules/axios',
          installedVersion: '1.18.0',
          expectedRange: '^1.20.0',
          overrideKey: 'axios',
        }),
        expect.objectContaining({
          packageName: 'form-data',
          lockfilePath: 'node_modules/some-tool/node_modules/form-data',
          installedVersion: '4.0.4',
          expectedRange: '^4.0.6',
          overrideKey: 'form-data',
        }),
      ]),
    );
  });

  it('should allow 5.5.0 and 4.3.2 while rejecting 4.3.1 and 3.14.2 for range-targeted js-yaml overrides', () => {
    expect(findOverrideMismatches(OVERRIDE_MOCKS.rangeOverrideManifest, OVERRIDE_MOCKS.rangeCleanLockfile)).toEqual([]);
    const mismatches = findOverrideMismatches(
      OVERRIDE_MOCKS.rangeOverrideManifest,
      OVERRIDE_MOCKS.rangeMismatchLockfile,
    );

    expect(mismatches).toHaveLength(2);
    expect(mismatches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ packageName: 'js-yaml', lockfilePath: 'node_modules/legacy-a/node_modules/js-yaml', installedVersion: '4.3.1', expectedRange: '^4.3.2', overrideKey: 'js-yaml@<4.3.2' }),
        expect.objectContaining({ packageName: 'js-yaml', lockfilePath: 'node_modules/legacy-b/node_modules/js-yaml', installedVersion: '3.14.2', expectedRange: '^4.3.2', overrideKey: 'js-yaml@<4.3.2' }),
      ]),
    );
  });

  it('should resolve dollar-prefixed reference overrides against root dependencies', () => {
    expect(findOverrideMismatches(OVERRIDE_MOCKS.referenceOverrideManifest, OVERRIDE_MOCKS.referenceCleanLockfile)).toEqual([]);
    const mismatches = findOverrideMismatches(
      OVERRIDE_MOCKS.referenceOverrideManifest,
      OVERRIDE_MOCKS.referenceMismatchLockfile,
    );

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]).toEqual(
      expect.objectContaining({ packageName: 'vite', lockfilePath: 'node_modules/vitest/node_modules/vite', installedVersion: '7.3.1', expectedRange: '^8.0.5', overrideKey: 'vite' }),
    );
  });
});

describe('parseLsProblems', () => {
  it('should return no problems when npm ls exits 0 with a clean dependency tree', () => {
    expect(parseLsProblems(LS_MOCKS.cleanResult)).toEqual([]);
  });

  it('should extract JSON problems when npm ls reports ELSPROBLEMS', () => {
    const problems = parseLsProblems(LS_MOCKS.elsProblemsResult);

    expect(problems).toEqual([
      'invalid: js-yaml@4.1.0 /workspace/node_modules/js-yaml',
      'peer dep missing: js-yaml@^4.3.2, required by @nestjs/swagger',
    ]);
  });

  it('should fall back to stderr diagnostics when npm ls exits non-zero with non-JSON stdout', () => {
    const problems = parseLsProblems(LS_MOCKS.nonJsonErrorResult);

    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain('ELSPROBLEMS');
  });

  it('should return a fallback diagnostic when npm ls exits non-zero with empty output', () => {
    const problems = parseLsProblems(LS_MOCKS.emptyErrorResult);

    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('verifyLockfile', () => {
  it('should return ok when unstaged manifests, npm ci dry-run, npm ls, and root overrides all pass', () => {
    const result = verifyLockfile(VERIFY_STUBS.passingOptions());

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should fail with clear diagnostics when npm ls reports ELSPROBLEMS', () => {
    const result = verifyLockfile(VERIFY_STUBS.lsProblemsOptions());

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('js-yaml@4.1.0');
  });

  it('should fail with clear diagnostics when lockfile resolutions violate root overrides', () => {
    const result = verifyLockfile(VERIFY_STUBS.overrideMismatchOptions());

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('axios');
    expect(result.errors.join('\n')).toContain('form-data');
  });

  it('should fail with clear diagnostics when npm ci dry-run exits non-zero', () => {
    const result = verifyLockfile(VERIFY_STUBS.ciDryRunFailureOptions());

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('package-lock.json');
  });

  it('should fail with clear diagnostics when unstaged manifest changes exist', () => {
    const result = verifyLockfile(VERIFY_STUBS.unstagedManifestOptions());

    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toContain('package-lock.json');
  });
});

describe('workspace dependency and allowlist invariants', () => {
  const rootManifest = readWorkspaceJson('package.json');
  const rootLockfile = readWorkspaceJson('package-lock.json');
  const papikapiManifest = readWorkspaceJson('apps/papikapi-api/package.json');
  const auditAllowlist = readWorkspaceJson('tools/ci/audit-allowlist.json');

  it('should remove @usebruno/cli from apps/papikapi-api/package.json to eliminate the js-yaml conflict', () => {
    const deps = isRecord(papikapiManifest['dependencies']) ? papikapiManifest['dependencies'] : {};
    const devDeps = isRecord(papikapiManifest['devDependencies']) ? papikapiManifest['devDependencies'] : {};

    expect(deps[WORKSPACE_EXPECTATIONS.removedPapikapiDependency]).toBeUndefined();
    expect(devDeps[WORKSPACE_EXPECTATIONS.removedPapikapiDependency]).toBeUndefined();
  });

  it('should report zero override mismatches between root package.json and package-lock.json', () => {
    expect(findOverrideMismatches(rootManifest, rootLockfile)).toEqual([]);
  });

  it('should resolve every js-yaml entry in package-lock.json to at least 4.3.2 or 5.x', () => {
    const entries = extractLockfilePackageVersions(rootLockfile, 'js-yaml');
    const vulnerable = entries.filter(
      (entry) => !isVersionAtLeast(entry.version, WORKSPACE_EXPECTATIONS.minimumVersions.jsYaml),
    );

    expect(entries.length).toBeGreaterThan(0);
    expect(vulnerable).toEqual([]);
  });

  it('should resolve every axios entry in package-lock.json to at least 1.20.0', () => {
    const entries = extractLockfilePackageVersions(rootLockfile, 'axios');
    const vulnerable = entries.filter(
      (entry) => !isVersionAtLeast(entry.version, WORKSPACE_EXPECTATIONS.minimumVersions.axios),
    );

    expect(vulnerable).toEqual([]);
  });

  it('should resolve every form-data entry in package-lock.json to at least 2.5.6 on 2.x or at least 4.0.6', () => {
    const entries = extractLockfilePackageVersions(rootLockfile, 'form-data');
    const vulnerable = entries.filter((entry) => !isSafeFormDataVersion(entry.version));

    expect(vulnerable).toEqual([]);
  });

  it('should contain no @faker-js/faker entry below 10.5.0 in package-lock.json', () => {
    const entries = extractLockfilePackageVersions(rootLockfile, '@faker-js/faker');
    const vulnerable = entries.filter(
      (entry) => !isVersionAtLeast(entry.version, WORKSPACE_EXPECTATIONS.minimumVersions.faker),
    );

    expect(vulnerable).toEqual([]);
  });

  it('should remove all eight resolved packages from tools/ci/audit-allowlist.json', () => {
    const allowedPackages = collectAllowlistPackages(auditAllowlist);

    for (const removedPackage of WORKSPACE_EXPECTATIONS.removedAllowlistPackages) {
      expect(allowedPackages).not.toContain(removedPackage);
    }
  });
});
