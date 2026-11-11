import { describe, expect, it } from 'vitest';
import { FigureId } from '../common/figure-id.js';
import { CreatorService } from './creator-service.js';

describe('CreatorService.resolveIdentity', () => {
  it('keeps a well-formed id sent by the app and derives the subject from the english display name', () => {
    const identity = CreatorService.resolveIdentity({
      id: 'k7f2p9qx',
      prompt: 'a very cute pink pig',
      displayName: { pt: 'Porco cor-de-rosa', en: 'Pink pig' },
    });
    expect(identity).toEqual({
      id: 'k7f2p9qx',
      subject: 'pink-pig',
      displayName: { pt: 'Porco cor-de-rosa', en: 'Pink pig' },
    });
  });

  it('creates a new short id when the app sends none', () => {
    const identity = CreatorService.resolveIdentity({
      prompt: 'a lion',
      displayName: { pt: 'Leão', en: 'Lion' },
    });
    expect(FigureId.isValid(identity.id)).toBe(true);
    expect(identity.subject).toBe('lion');
  });

  it('replaces a slug-like id that is neither well formed nor known', () => {
    const identity = CreatorService.resolveIdentity({ id: 'um-snoopy-engracado', prompt: 'a lion' });
    expect(FigureId.isValid(identity.id)).toBe(true);
  });

  it('derives subject and display name from the prompt when the app sends no display name', () => {
    const identity = CreatorService.resolveIdentity({ id: 'zz9zz9zz', prompt: 'a cute white dog Snoopy in plush' });
    expect(identity.subject).toBe('snoopy-plush');
    expect(identity.displayName).toEqual({ pt: 'Snoopy plush', en: 'Snoopy plush' });
  });
});

describe('CreatorService.figureIdOf', () => {
  it('accepts a well-formed figure id', () => {
    expect(CreatorService.figureIdOf(' k7f2p9qx ')).toBe('k7f2p9qx');
  });

  it('refuses a value that is not a figure id', () => {
    expect(() => CreatorService.figureIdOf('../etc')).toThrow(/Unknown figure id/);
  });
});

describe('CreatorService.deriveSubject', () => {
  it('keeps the english subject of a studio prompt', () => {
    const subject = CreatorService.deriveSubject(
      'low-poly faceted 3D papercraft model of a cute emerald green baby dragon with gold belly. Seen in an EYE-LEVEL THREE-QUARTER VIEW...',
    );
    expect(subject).toBe('emerald-green-baby-dragon');
  });

  it('translates a portuguese prompt left untranslated by a failed translation', () => {
    expect(CreatorService.deriveSubject('um gato preto')).toBe('cat-black');
  });
});
