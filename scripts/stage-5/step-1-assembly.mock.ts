import type { ModelManifest } from '../shared/common/interfaces/index.js';
import type { ColouredTriangle } from './interfaces/assembly.interface.js';

const MANIFEST_STUB: ModelManifest = {
  version: 1,
  subject: 'zz-assembly-single',
  stages: {},
  totalSeconds: 0,
  totalCostUsd: 0,
  updatedAt: '2026-11-21T20:00:00.000Z',
};

export const STEP_1_ASSEMBLY_MOCKS = {
  modelId: 'zz-assembly-single',
  multiPieceModelId: 'zz-assembly-multi',
  missingNetModelId: 'zz-assembly-missing-net',
  stalePlan: JSON.stringify({ stale: true }),
  timestamp: '2026-11-21T20:00:00.000Z',
  manifestStub: MANIFEST_STUB,
  singlePieceNet: {
    dimensionsMm: [10, 10, 10],
    meshScale: 1,
    mesh: {
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      faces: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    },
    pieces: [
      {
        number: 1,
        faceIds: [0, 1],
        faces: [
          [
            [0, 0],
            [10, 0],
            [0, 10],
          ],
          [
            [0, 0],
            [0, 10],
            [-10, 0],
          ],
        ],
        cuts: [],
        folds: [{ a: [0, 0], b: [0, 10], kind: 'mountain' }],
        joins: [],
        areaMm2: 100,
      },
    ],
  },
  multiPieceNet: {
    dimensionsMm: [10, 10, 10],
    meshScale: 1,
    mesh: {
      vertices: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      faces: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    },
    pieces: [
      {
        number: 1,
        faceIds: [0],
        faces: [
          [
            [0, 0],
            [10, 0],
            [0, 10],
          ],
        ],
        cuts: [],
        folds: [],
        joins: [{ piece: 2, edges: [0] }],
        areaMm2: 50,
      },
      {
        number: 2,
        faceIds: [1],
        faces: [
          [
            [0, 0],
            [0, 10],
            [-10, 0],
          ],
        ],
        cuts: [],
        folds: [],
        joins: [{ piece: 1, edges: [0] }],
        areaMm2: 50,
      },
    ],
  },
  colouredTriangles: [
    {
      corners: [
        [0, 0, 0],
        [10, 0, 0],
        [0, 10, 0],
      ],
      colour: [0.8, 0.2, 0.2],
    },
    {
      corners: [
        [0, 0, 0],
        [0, 10, 0],
        [0, 0, 10],
      ],
      colour: [0.2, 0.6, 0.8],
    },
  ] satisfies ColouredTriangle[],
};
