import type { FigureDisplayNames } from './figure.interface.js';

export interface CatalogueModelEntry {
  readonly id: string;
  readonly displayName: FigureDisplayNames;
  readonly model: string;
  readonly preview: string;
  readonly image: string;
}
