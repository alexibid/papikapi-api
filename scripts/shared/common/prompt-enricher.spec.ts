import { describe, expect, it } from 'vitest';
import { AlternativesGenerator } from '../../stage-1/step-1-alternatives.js';
import { PromptEnricher } from './prompt-enricher.js';
import { PromptGuard } from './prompt-guard.js';
import { TrainingReferences } from './training-references.js';
import { BodyPlans } from './body-plans.js';

describe('PromptEnricher.sanitize', () => {
  it.each([
    ['black tuxedo cat', 'bicolor black and white cat'],
    ['a Tuxedo Cat named Darth', 'a bicolor black and white Cat named Darth'],
    ['black and white tuxedo kitten with white socks', 'bicolor black and white kitten with white socks'],
    ['Tuxedo-cat', 'bicolor black and white-cat'],
    ['gato smoking', 'gato bicolor black and white'],
  ])('replaces clothing words in %s', (input, expected) => {
    expect(PromptEnricher.sanitize(input)).toBe(expected);
  });

  it.each([
    ['cat with whiskers', 'cat'],
    ['white muzzle with no whiskers', 'white muzzle'],
    ['cat, whiskerless, zero whiskers', 'cat'],
  ])('drops whiskers from %s', (input, expected) => {
    expect(PromptEnricher.sanitize(input)).toBe(expected);
  });

  it('turns a cap on the head into fur', () => {
    expect(PromptEnricher.sanitize('a cat with a black cap on its head')).not.toMatch(/\bcap\b|on its head/);
  });

  it('keeps a coloured cap that is part of a character', () => {
    expect(PromptEnricher.sanitize('a plumber with a red cap marked with a white circle')).toBe(
      'a plumber with a red cap marked with a white circle',
    );
  });
});

describe('PromptGuard', () => {
  it('rejects system directives inside the user prompt', () => {
    expect(() => PromptGuard.assertSubject('a cat standing on a plinth with zero shadows')).toThrow(/system directive/);
  });

  it('accepts a pure subject description', () => {
    const subject = PromptEnricher.subjectFrom('a cute black tuxedo cat, white blaze between the eyes, green eyes');
    expect(PromptGuard.assertSubject(subject)).toBe(subject);
  });

  it('rejects clothing and whisker triggers', () => {
    expect(() => PromptGuard.assertPrompt('a tuxedo cat')).toThrow(/tuxedo/);
    expect(() => PromptGuard.assertPrompt('a cat with whiskers')).toThrow(/whiskers/);
  });
});

describe('PromptGuard system block', () => {
  it('refuses a prompt that lacks the system block', () => {
    expect(() => PromptGuard.assertSystemBlock('a black and white cat')).toThrow(/mandatory system clause/);
  });

  it('refuses a block that lets the figure open its mouth', () => {
    const prompt = AlternativesGenerator.composePrompt('a t-rex', 0, 'orange');
    expect(() => PromptGuard.assertSystemBlock(prompt.replace(/mouth is always closed/, 'mouth may open'))).toThrow(/mouth/);
  });

  it('keeps the scarf of a blocky character as painted pixels, not as a built part', () => {
    const prompt = AlternativesGenerator.composePrompt('Alex from Minecraft with a scarf', 0, 'orange');
    expect(prompt).toMatch(/flat pixel patterns printed on those faces/);
    expect(() => PromptGuard.assertSystemBlock(prompt.replace(/never built as an extra block or flap/, 'built as blocks')))
      .toThrow(/extra block/);
  });

  it('refuses a thick or white plinth in place of the contrasting flat plane', () => {
    const prompt = AlternativesGenerator.composePrompt('a black and white cat', 1, 'orange');
    const slab = prompt.replace(/single flat sheet of plain matte orange paper of zero thickness/, 'thin white slab');
    expect(() => PromptGuard.assertSystemBlock(slab)).toThrow(/zero thickness/);
  });
});

describe('FLUX prompts', () => {
  const subject = PromptEnricher.subjectFrom('a cute black tuxedo cat with a white blaze between the eyes, standing');
  const cells = AlternativesGenerator.buildCellPrompts(subject, 1, 'orange');

  it('sends one prompt per alternative, each the user subject followed by the system block', () => {
    expect(cells).toHaveLength(6);
    cells.forEach((cell) => {
      expect(cell).toContain(`${subject}. The figure stands on one single flat sheet of plain matte orange paper`);
      expect(cell.indexOf('never sitting')).toBeLessThan(cell.indexOf(subject));
      expect(() => PromptGuard.assertPrompt(cell)).not.toThrow();
    });
  });

  it('states every system clause exactly once', () => {
    expect(cells[0].match(/three-quarter view/g)).toHaveLength(1);
    expect(cells[0].match(/single flat sheet/g)).toHaveLength(1);
  });

  it('keeps the system block out of the user subject', () => {
    expect(() => PromptGuard.assertSubject(`${subject}, on a plinth`)).toThrow(/system directive/);
  });
});

describe('default pose', () => {
  it('adds the system pose when the user describes none', () => {
    expect(AlternativesGenerator.composePrompt('a black and white cat', 1, 'orange')).toMatch(/never sitting, crouching or lying down/);
  });

  it('keeps the user pose and leaves the system pose out', () => {
    const prompt = AlternativesGenerator.composePrompt('a black and white cat sitting upright', 1, 'orange');
    expect(prompt).toMatch(/sitting upright/);
    expect(prompt).not.toMatch(/never sitting/);
  });
});

describe('support column for figures without legs', () => {
  it.each([
    'a cute orange clownfish swimming, with three thick white bands',
    'a cute gray hammerhead shark swimming, with a wide flat hammer-shaped head',
    'a cute coral-red octopus with a big round head and eight short arms',
    'a cute green sea turtle with a domed brown shell and four green flippers',
    'a cute golden-orange seahorse upright on its curled tail',
    'a cute red and blue propeller plane with a rounded red body',
  ])('holds "%s" up on a column instead of legs', (subject) => {
    const prompt = AlternativesGenerator.composePrompt(subject, 1, 'orange');
    expect(prompt).toMatch(/held up above the plane by one short, thick, round paper column/i);
    expect(prompt).not.toMatch(/Standing on all its legs/);
  });

  it.each([
    'a cute black and white cat with a jet-black head',
    'a cute brachiosaurus with a long neck',
    'a cute golden retriever puppy',
  ])('keeps "%s" standing on its own legs', (subject) => {
    const prompt = AlternativesGenerator.composePrompt(subject, 1, 'orange');
    expect(prompt).toMatch(/Standing on all its legs/);
    expect(prompt).not.toMatch(/paper column/);
  });

  it('lets FLUX paint the column in a colour that is neither the plane nor the figure', () => {
    const prompt = AlternativesGenerator.composePrompt('a cute red and blue propeller plane', 1, 'orange');
    expect(prompt).toMatch(/column in one solid colour that differs from both the plane and the figure/);
  });
});

describe('plane colour and reference rule', () => {
  it('gives FLUX the one plane colour chosen for the figure, sized to its footprint', () => {
    const prompt = AlternativesGenerator.composePrompt('a blue parrot', 1, 'orange');
    expect(prompt).toContain('single flat sheet of plain matte orange paper of zero thickness');
    expect(prompt).toContain("exactly as wide and as long as the figure's own footprint");
    expect(prompt).not.toMatch(/\{plane_colour\}|picked from/);
  });

  it('refuses a system block that lets the plane grow past the footprint', () => {
    const prompt = AlternativesGenerator.composePrompt('a blue parrot', 1, 'orange');
    const wide = prompt.replace(/exactly as wide and as long as the figure's own footprint/, 'slightly wider');
    expect(() => PromptGuard.assertSystemBlock(wide)).toThrow(/footprint/);
  });

  it('never asks for a saturated plane that would tint the figure', () => {
    expect(AlternativesGenerator.composePrompt('a fawn pug', 1, 'orange')).not.toMatch(/saturated/);
    expect(AlternativesGenerator.composePrompt('a fawn pug', 1, 'orange')).toMatch(/casts no colour onto it/);
  });

  it('tells the generator to take only colours and markings from the photo', () => {
    expect(AlternativesGenerator.composePrompt('a black and white cat', 1, 'orange')).toMatch(/never for its pose or camera angle/);
    expect(AlternativesGenerator.composePrompt('a black and white cat', 0, 'orange')).not.toMatch(/reference photo/);
  });
});

describe('PromptEnricher.enrichWithTraining & TrainingReferences', () => {
  it('automatically adds papikapi-style and minecraft keywords for Alex', () => {
    const raw = 'a cute blocky girl with long orange hair falling over the shoulders, pale skin, green eyes';
    const enriched = PromptEnricher.enrichWithTraining(raw, 'alex');
    expect(enriched).toMatch(/^papikapi-style/);
    expect(enriched).toMatch(/\bminecraft\b/i);
    expect(enriched).toMatch(/\balex\b/i);
  });

  it('automatically enriches generic minecraft prompts', () => {
    const raw = 'a cute blocky green creeper with a square head';
    const enriched = PromptEnricher.enrichWithTraining(raw, 'creeper');
    expect(enriched).toMatch(/^papikapi-style/);
    expect(enriched).toMatch(/\bminecraft\b/i);
  });

  it('matches alex to minecraft/alex.jpeg instead of a cat', () => {
    const raw = 'a cute blocky girl with long orange hair falling over the shoulders, pale skin, green eyes';
    const ref = TrainingReferences.findStyleImage('alex', raw);
    expect(ref).not.toBeNull();
    expect(ref?.item.file).toBe('minecraft/alex.jpeg');
    expect(ref?.item.group).toBe('minecraft');
  });

  it('matches other catalog figures to their exact training references', () => {
    expect(TrainingReferences.findStyleImage('black-tuxedo', 'black cat')?.item.file).toBe('cats/black-tuxedo.jpeg');
    expect(TrainingReferences.findStyleImage('cheetah', 'cub')?.item.file).toBe('safari/cheetah.jpeg');
    expect(TrainingReferences.findStyleImage('bear', 'cub')?.item.file).toBe('forest/bear.jpeg');
  });

  it.each([
    ['um gato no estilo minecraft', 'minecraft/cow.jpeg'],
    ['um dinossauro estilo minecraft', 'minecraft/cow.jpeg'],
    ['esqueleto estilo minecraft', 'minecraft/steve.jpeg'],
    ['carro estilo minecraft', 'minecraft/steve.jpeg'],
    ['uma vaca cubica do minecraft', 'minecraft/cow.jpeg'],
    ['um porco do minecraft', 'minecraft/pig.jpeg'],
  ])('deterministically forces minecraft reference and keywords for prompt: %s', (prompt, expectedRef) => {
    const ref = TrainingReferences.find(prompt);
    expect(ref).not.toBeNull();
    expect(ref?.item.group).toBe('minecraft');
    expect(ref?.item.file).toBe(expectedRef);

    const enriched = PromptEnricher.enrichWithTraining(prompt);
    expect(enriched).toMatch(/papikapi-style/);
    expect(enriched).toMatch(/minecraft/i);
    expect(enriched).toMatch(/blocky cuboid/);
  });
});

describe('TrainingReferences by body plan', () => {
  it.each([
    ['a cute white unicorn with a pastel pink mane', 'safari/zebra.jpeg'],
    ['um unicórnio branco', 'safari/zebra.jpeg'],
    ['a brown pony', 'safari/zebra.jpeg'],
    ['um cavalo-marinho amarelo', 'ocean/seahorse.jpeg'],
  ])('picks the reference with the same body for %s', (prompt, expected) => {
    expect(TrainingReferences.find(prompt)?.item.file).toBe(expected);
  });

  it('keeps a dog among canines', () => {
    expect(TrainingReferences.find('a white husky dog')?.item.body).toBe('canine');
  });

  it('never picks a reference because of a colour word alone', () => {
    expect(TrainingReferences.find('a white cloud')).toBeNull();
  });
});

describe('BodyPlans.isFourLegged', () => {
  it.each([
    ['a cute black and white cat with a jet-black head', true],
    ['um cavalo castanho', true],
    ['a cute owl', false],
    ['a seahorse', false],
    ['a red plane', false],
  ])('%s -> %s', (subject, expected) => {
    expect(BodyPlans.isFourLegged(subject)).toBe(expected);
  });
});
