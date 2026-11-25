export const MODELS_SERVICE_MOCKS = {
  modelId: 'rb83aitm',
  secondaryModelId: '2ia2hryn',
  missingModelId: 'zzmissing',
  emptyPlanModelId: 'zzemptyp',
  whitespacePlanModelId: 'zzwhitep',
  diskOnlyModelId: 'zzdiskon',
  timestamp: '2026-11-21T20:00:00.000Z',
  validAssemblyPlan: JSON.stringify({
    dimensionsMm: [100, 120, 80],
    pieces: [{ number: 1, areaMm2: 200, faces: [], centre: [0, 0, 0], tray: [0, 0], size: [10, 10], progressStart: 0, progressEnd: 1 }],
    checks: { pieces: 1, faces: 2, hinges: 1, maxHingeResidualMm: 0, maxFoldAngleDeg: 90, mirroredPieces: 0, extraRoots: 0 },
  }),
  secondaryAssemblyPlan: JSON.stringify({
    dimensionsMm: [80, 90, 70],
    pieces: [],
    checks: { pieces: 0, faces: 0, hinges: 0, maxHingeResidualMm: 0, maxFoldAngleDeg: 0, mirroredPieces: 0, extraRoots: 0 },
  }),
  diskFallbackPayload: JSON.stringify({ source: 'stale-disk-file' }),
};
