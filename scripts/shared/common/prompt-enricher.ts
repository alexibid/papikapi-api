import { TrainingReferences } from './training-references.js';

export class PromptEnricher {
  private static readonly bicolour = 'bicolor black and white';

  public static sanitize(input: string): string {
    const clean = input
      .replace(/\b(?:black\s+(?:and\s+white\s+)?)?tuxedos?\b(?:[\s-]+style)?/gi, this.bicolour)
      .replace(/\bsmoking\b/gi, this.bicolour)
      .replace(/\bblack\s+(?:head\s+)?cap\b(?:\s+(?:on|over)\s+(?:its|the|his|her)\s+head)?/gi, 'black fur covering the top of the head and ears')
      .replace(/(?:\b(?:with|com)\s+)?(?:\b(?:zero|no|without|sem)\s+)?(?:facial\s+)?\b(?:whiskers?|bigodes?|whiskerless)\b/gi, '');
    return clean.replace(/\s+,/g, ',').replace(/,(\s*,)+/g, ',').replace(/\s{2,}/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
  }

  public static subjectFrom(userText: string): string {
    return this.sanitize(userText);
  }

  public static enrichWithTraining(subject: string, modelName?: string): string {
    const clean = this.sanitize(subject);
    const query = modelName || clean;
    const ref = (modelName ? TrainingReferences.find(modelName) : null) ?? TrainingReferences.find(clean);

    let enriched = clean;

    if (ref) {
      const group = ref.item.group.toLowerCase();
      const name = ref.item.name.toLowerCase();

      // Minecraft figures: ensure 'minecraft' and character keywords are present
      if (group === 'minecraft' || /\bminecraft\b/i.test(query)) {
        if (!/\bminecraft\b/i.test(enriched)) {
          enriched = `minecraft, ${enriched}`;
        }
        if (!/\b(blocky|cuboid|voxel)\b/i.test(enriched)) {
          enriched = `blocky cuboid, ${enriched}`;
        }
        if (modelName === name && !new RegExp(`\\b${name}\\b`, 'i').test(enriched)) {
          enriched = `${name}, ${enriched}`;
        }
      }

      // Ensure style trigger 'papikapi-style' is present at the beginning
      if (!enriched.toLowerCase().includes('papikapi-style')) {
        enriched = `papikapi-style, ${enriched}`;
      }
    } else if (/\bminecraft\b/i.test(query)) {
      if (!enriched.toLowerCase().includes('papikapi-style')) {
        enriched = `papikapi-style, ${enriched}`;
      }
    }

    return enriched;
  }

  private static readonly poseWords = new RegExp(
    `\\b(${[
      'stand(?:s|ing)?', 'sit(?:s|ting)?', 'seated', 'lying', 'lies', 'crouch(?:es|ing)?', 'walk(?:s|ing)?',
      'run(?:s|ning)?', 'jump(?:s|ing)?', 'leap(?:s|ing)?', 'swim(?:s|ming)?', 'fly(?:ing)?', 'flies',
      'sleep(?:s|ing)?', 'curled', 'rear(?:s|ing)?', 'pose', 'posture', 'stance',
    ].join('|')})\\b`,
    'i',
  );

  private static readonly supportedSubjects = new RegExp(
    `\\b(${[
      '\\w*fish(?:es)?', 'sharks?', 'whales?', 'dolphins?', 'orcas?', 'octopus(?:es)?', 'squids?', 'seahorses?',
      'sting ?rays?', 'mantas?', 'eels?', 'sea turtles?', 'marine turtles?', 'submarines?',
      '(?:air|aero)?planes?', 'aircraft', 'jets?(?!-)', 'helicopters?', 'rockets?', 'spaceships?', 'drones?',
      'balloons?', 'gliders?', 'fly(?:ing)?', 'flies', 'floating', 'hovering', 'soaring', 'gliding',
    ].join('|')})\\b`,
    'i',
  );

  public static describesPose(subject: string): boolean {
    return this.poseWords.test(subject);
  }

  public static needsSupport(subject: string): boolean {
    return this.supportedSubjects.test(subject);
  }
}
