export interface StepPrompts {
  readonly system: string;
  readonly referenceRule?: string;
  readonly defaultPose?: string;
  readonly supportedPose?: string;
  readonly fourLeggedPose?: string;
  readonly negative?: string;
}
