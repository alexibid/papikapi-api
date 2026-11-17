const CREATOR_SERVICE_MODULE = '../../scripts/shared/server/creator-service.js';

export interface CreatorIdentity {
  readonly id: string;
  readonly displayName?: unknown;
}

export interface BuiltModel {
  readonly cropResult: { readonly publicArtPath?: string };
  readonly trellisResult: { readonly cached?: boolean };
}

export interface CreatorServicePort {
  resolveIdentity(request: object): CreatorIdentity;
  generateAlternatives(identity: CreatorIdentity, request: object): Promise<Readonly<Record<string, unknown>>>;
  buildModel(name: string, pick: number): Promise<BuiltModel>;
}

interface CreatorServiceModule {
  readonly CreatorService: CreatorServicePort;
}

export async function loadCreatorService(): Promise<CreatorServicePort> {
  const loaded: CreatorServiceModule = await import(CREATOR_SERVICE_MODULE);
  return loaded.CreatorService;
}
