export type EyeSettings = Readonly<Record<string, number | readonly number[]>>;

export interface ArtInput {
  readonly art_stage_dir: string;
  readonly art_resource: string;
}
