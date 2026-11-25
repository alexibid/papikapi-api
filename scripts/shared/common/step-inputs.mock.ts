import type { CliArguments } from '../cli/orchestrator.interface.js';

const DEFAULT_FLAGS: CliArguments = {
  stage: null,
  step: null,
  fromStep: null,
  force: false,
  model: null,
  pick: null,
  prompt: null,
  ref: null,
};

export const STEP_INPUTS_MOCKS = {
  models: ['zz-step-inputs-one', 'zz-step-inputs-two'],
  emptyModel: 'zz-step-inputs-empty',
  missingModel: 'zz-step-inputs-missing',
  timestamp: '2026-11-21T20:00:00.000Z',
  defaultFlags: DEFAULT_FLAGS,
  forceFlags: { ...DEFAULT_FLAGS, force: true },
  assemblyPayload: JSON.stringify({ dimensionsMm: [10, 10, 10], pieces: [], checks: { pieces: 0 } }),
  netPayload: JSON.stringify({ islands: [] }),
  s5ResourceOutputs: ['stage-5/step-1-assembly.json', 'stage-5/step-1-manifest.json'],
};
