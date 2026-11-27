export interface MockCommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

export interface MockRootManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  overrides?: Record<string, string>;
}

export interface MockLockfile {
  lockfileVersion: number;
  packages: Record<string, { version?: string }>;
}

export interface MockVerifyOptions {
  cwd: string;
  readUnstaged: () => string[];
  runCiDryRun: () => MockCommandResult;
  runNpmLs: () => MockCommandResult;
  readJson: (filePath: string) => unknown;
}

export const OVERRIDE_MOCKS = {
  cleanManifest: {
    devDependencies: {
      vite: '^8.0.5',
    },
    overrides: {
      axios: '^1.20.0',
      'form-data': '^4.0.6',
      'js-yaml@<4.3.2': '^4.3.2',
      vite: '$vite',
    },
  } satisfies MockRootManifest,
  cleanLockfile: {
    lockfileVersion: 3,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/axios': { version: '1.20.0' },
      'node_modules/form-data': { version: '4.0.6' },
      'node_modules/js-yaml': { version: '5.5.0' },
      'node_modules/nested/node_modules/js-yaml': { version: '4.3.2' },
      'node_modules/vite': { version: '8.0.5' },
    },
  } satisfies MockLockfile,
  emptyManifest: {} satisfies MockRootManifest,
  emptyLockfile: {
    lockfileVersion: 3,
    packages: {},
  } satisfies MockLockfile,
  globalOverrideManifest: {
    overrides: {
      axios: '^1.20.0',
      'form-data': '^4.0.6',
    },
  } satisfies MockRootManifest,
  globalMismatchLockfile: {
    lockfileVersion: 3,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/axios': { version: '1.18.0' },
      'node_modules/some-tool/node_modules/form-data': { version: '4.0.4' },
    },
  } satisfies MockLockfile,
  rangeOverrideManifest: {
    overrides: {
      'js-yaml@<4.3.2': '^4.3.2',
    },
  } satisfies MockRootManifest,
  rangeCleanLockfile: {
    lockfileVersion: 3,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/js-yaml': { version: '5.5.0' },
      'node_modules/swagger/node_modules/js-yaml': { version: '4.3.2' },
    },
  } satisfies MockLockfile,
  rangeMismatchLockfile: {
    lockfileVersion: 3,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/js-yaml': { version: '5.5.0' },
      'node_modules/safe/node_modules/js-yaml': { version: '4.3.2' },
      'node_modules/legacy-a/node_modules/js-yaml': { version: '4.3.1' },
      'node_modules/legacy-b/node_modules/js-yaml': { version: '3.14.2' },
    },
  } satisfies MockLockfile,
  referenceOverrideManifest: {
    devDependencies: {
      vite: '^8.0.5',
    },
    overrides: {
      vite: '$vite',
    },
  } satisfies MockRootManifest,
  referenceCleanLockfile: {
    lockfileVersion: 3,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/vite': { version: '8.0.5' },
    },
  } satisfies MockLockfile,
  referenceMismatchLockfile: {
    lockfileVersion: 3,
    packages: {
      '': { version: '1.0.0' },
      'node_modules/vitest/node_modules/vite': { version: '7.3.1' },
    },
  } satisfies MockLockfile,
};

export const LS_MOCKS = {
  cleanResult: {
    status: 0,
    stdout: JSON.stringify({ name: 'ibid-workspace', dependencies: {} }),
    stderr: '',
  } satisfies MockCommandResult,
  elsProblemsResult: {
    status: 1,
    stdout: JSON.stringify({
      error: { code: 'ELSPROBLEMS' },
      problems: [
        'invalid: js-yaml@4.1.0 /workspace/node_modules/js-yaml',
        'peer dep missing: js-yaml@^4.3.2, required by @nestjs/swagger',
      ],
    }),
    stderr: '',
  } satisfies MockCommandResult,
  nonJsonErrorResult: {
    status: 1,
    stdout: 'unexpected non-json output',
    stderr: 'npm error code ELSPROBLEMS\nnpm error invalid: js-yaml@4.1.0',
  } satisfies MockCommandResult,
  emptyErrorResult: {
    status: 1,
    stdout: '',
    stderr: '',
  } satisfies MockCommandResult,
};

const createJsonReader = (manifest: MockRootManifest, lockfile: MockLockfile) => (filePath: string): unknown => {
  if (filePath.endsWith('package-lock.json')) {
    return lockfile;
  }
  return manifest;
};

export const VERIFY_STUBS = {
  passingOptions: (): MockVerifyOptions => ({
    cwd: '/workspace',
    readUnstaged: () => [],
    runCiDryRun: () => ({ status: 0, stdout: '', stderr: '' }),
    runNpmLs: () => LS_MOCKS.cleanResult,
    readJson: createJsonReader(OVERRIDE_MOCKS.cleanManifest, OVERRIDE_MOCKS.cleanLockfile),
  }),
  lsProblemsOptions: (): MockVerifyOptions => ({
    cwd: '/workspace',
    readUnstaged: () => [],
    runCiDryRun: () => ({ status: 0, stdout: '', stderr: '' }),
    runNpmLs: () => LS_MOCKS.elsProblemsResult,
    readJson: createJsonReader(OVERRIDE_MOCKS.cleanManifest, OVERRIDE_MOCKS.cleanLockfile),
  }),
  overrideMismatchOptions: (): MockVerifyOptions => ({
    cwd: '/workspace',
    readUnstaged: () => [],
    runCiDryRun: () => ({ status: 0, stdout: '', stderr: '' }),
    runNpmLs: () => LS_MOCKS.cleanResult,
    readJson: createJsonReader(OVERRIDE_MOCKS.globalOverrideManifest, OVERRIDE_MOCKS.globalMismatchLockfile),
  }),
  ciDryRunFailureOptions: (): MockVerifyOptions => ({
    cwd: '/workspace',
    readUnstaged: () => [],
    runCiDryRun: () => ({ status: 1, stdout: '', stderr: 'npm error package-lock.json does not match package.json' }),
    runNpmLs: () => LS_MOCKS.cleanResult,
    readJson: createJsonReader(OVERRIDE_MOCKS.cleanManifest, OVERRIDE_MOCKS.cleanLockfile),
  }),
  unstagedManifestOptions: (): MockVerifyOptions => ({
    cwd: '/workspace',
    readUnstaged: () => ['package-lock.json'],
    runCiDryRun: () => ({ status: 0, stdout: '', stderr: '' }),
    runNpmLs: () => LS_MOCKS.cleanResult,
    readJson: createJsonReader(OVERRIDE_MOCKS.cleanManifest, OVERRIDE_MOCKS.cleanLockfile),
  }),
};

export const WORKSPACE_EXPECTATIONS = {
  minimumVersions: {
    jsYaml: '4.3.2',
    axios: '1.20.0',
    formDataLegacy: '2.5.6',
    formData: '4.0.6',
    faker: '10.5.0',
  },
  removedAllowlistPackages: [
    '@faker-js/faker',
    '@usebruno/cli',
    '@usebruno/converters',
    '@usebruno/js',
    '@usebruno/requests',
    'axios',
    'form-data',
    'js-yaml',
  ],
  removedPapikapiDependency: '@usebruno/cli',
};
