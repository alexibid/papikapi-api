export const OUTPUT_CLEANER_MOCKS = {
  primaryModel: 'zz-output-cleaner-one',
  secondaryModel: 'zz-output-cleaner-two',
  emptyDirModel: 'zz-output-cleaner-empty',
  missingDirModel: 'zz-output-cleaner-missing',
  batchModelCount: 56,
  batchModelPrefix: 'zz-batch-model-',
  timestamp: '2026-11-21T20:00:00.000Z',
  assemblyPayload: JSON.stringify({
    version: 1,
    pieces: [{ id: 1, name: 'head' }],
    hinges: [],
  }),
  netPayload: JSON.stringify({ dimensionsMm: [100, 100, 100], pieces: [] }),
  mediaFiles: [
    'model.glb',
    'preview-three-quarter.webp',
    'preview-three-quarter-wireframe.webp',
    'sheets.pdf',
    'art.jpeg',
    'alternatives.jpeg',
  ],
  preservedResourceFiles: [
    'stage-1/step-2-art.jpeg',
    'stage-2/step-2-3d.glb',
    'stage-3/step-5-plinth.glb',
    'stage-4/step-1-net.json',
  ],
};
