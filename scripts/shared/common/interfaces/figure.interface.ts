export type FigureLanguage = 'pt' | 'en';

export interface FigureDisplayNames {
  readonly pt: string;
  readonly en: string;
}

export interface FigureIdentity {
  readonly id: string;
  readonly subject: string;
  readonly displayName: FigureDisplayNames;
}
