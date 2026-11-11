import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InlineImage, ReferenceItem } from './interfaces/index.js';
import { ImageMime } from './image-mime.js';
import { WorkspacePaths } from './workspace-paths.js';
import { BodyPlans } from './body-plans.js';

const COLOUR_WORDS: ReadonlySet<string> = new Set([
  'white', 'black', 'gray', 'grey', 'orange', 'golden', 'blue', 'eyed', 'red', 'pink', 'brown', 'yellow', 'green', 'purple',
]);

export class TrainingReferences {
  private static cachedItems: readonly ReferenceItem[] | null = null;

  public static loadIndex(): readonly ReferenceItem[] {
    if (this.cachedItems) return this.cachedItems;

    const indexPath = join(WorkspacePaths.appRoot, 'scripts/shared/training/references/index.json');
    if (!existsSync(indexPath)) {
      this.cachedItems = [];
      return this.cachedItems;
    }

    try {
      const raw = readFileSync(indexPath, 'utf-8');
      this.cachedItems = JSON.parse(raw) as ReferenceItem[];
    } catch {
      this.cachedItems = [];
    }

    return this.cachedItems;
  }

  public static find(query: string): { item: ReferenceItem; path: string } | null {
    const items = this.loadIndex();
    if (items.length === 0) return null;
    const normalized = query.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const words = query.toLowerCase().split(/[^a-z0-9]+/g).filter((w) => w.length > 2);
    const item = items.find((i) => i.name.toLowerCase() === normalized)
      ?? this.minecraftItem(items, words, normalized)
      ?? this.sameBody(items, query);
    return item ? this.located(item) : null;
  }

  private static located(item: ReferenceItem): { item: ReferenceItem; path: string } | null {
    const fullPath = join(WorkspacePaths.appRoot, 'scripts/shared/training/references', item.file);
    return existsSync(fullPath) ? { item, path: fullPath } : null;
  }

  private static minecraftItem(items: readonly ReferenceItem[], words: readonly string[], normalized: string): ReferenceItem | undefined {
    if (!words.includes('minecraft') && !normalized.includes('minecraft')) return undefined;
    const blocky = items.filter((i) => i.group === 'minecraft');
    const named = (name: string) => blocky.find((i) => i.name === name);
    const fallback = named('steve') ?? blocky[0];
    const rules: readonly (readonly [readonly string[], string])[] = [
      [['alex', 'girl', 'mulher', 'garota'], 'alex'],
      [['creeper'], 'creeper'],
      [['zombie', 'zumbi'], 'zombie'],
      [['cow', 'vaca', 'cat', 'gato', 'dog', 'cao', 'cão', 'cachorro', 'dino', 'dinossauro'], 'cow'],
      [['pig', 'porco'], 'pig'],
    ];
    const rule = rules.find(([keys]) => words.some((w) => keys.includes(w)));
    return (rule ? named(rule[1]) : undefined) ?? fallback;
  }

  private static sameBody(items: readonly ReferenceItem[], query: string): ReferenceItem | undefined {
    const body = BodyPlans.of(query);
    if (!body) return undefined;
    const candidates = items.filter((i) => i.body === body);
    const words = new Set(BodyPlans.words(query).filter((w) => !COLOUR_WORDS.has(w)));
    const score = (item: ReferenceItem) => item.name.split('-').filter((token) => words.has(token)).length;
    return [...candidates].sort((first, second) => score(second) - score(first))[0];
  }

  public static getItemsByGroup(group: string): readonly ReferenceItem[] {
    const items = this.loadIndex();
    return items.filter((i) => i.group.toLowerCase() === group.toLowerCase());
  }

  public static findRelated(query: string, count = 6): readonly { item: ReferenceItem; path: string }[] {
    const items = this.loadIndex();
    if (items.length === 0) return [];

    const results: { item: ReferenceItem; path: string }[] = [];
    const seenNames = new Set<string>();

    const primary = this.find(query);
    if (primary) {
      results.push(primary);
      seenNames.add(primary.item.name);

      const groupItems = this.getItemsByGroup(primary.item.group);
      for (const gi of groupItems) {
        if (results.length >= count) break;
        if (!seenNames.has(gi.name)) {
          const fullPath = join(WorkspacePaths.appRoot, 'scripts/shared/training/references', gi.file);
          if (existsSync(fullPath)) {
            results.push({ item: gi, path: fullPath });
            seenNames.add(gi.name);
          }
        }
      }
    }

    for (const it of items) {
      if (results.length >= count) break;
      if (!seenNames.has(it.name)) {
        const fullPath = join(WorkspacePaths.appRoot, 'scripts/shared/training/references', it.file);
        if (existsSync(fullPath)) {
          results.push({ item: it, path: fullPath });
          seenNames.add(it.name);
        }
      }
    }

    return results;
  }

  public static findStyleImage(name: string, prompt: string): { image: InlineImage; item: ReferenceItem; path: string } | null {
    return this.getInlineImage(name) ?? this.getInlineImage(prompt);
  }

  public static getInlineImage(query: string): { image: InlineImage; item: ReferenceItem; path: string } | null {
    const match = this.find(query);
    if (!match) return null;

    try {
      const bytes = readFileSync(match.path);
      const mime = ImageMime.of(bytes);
      return {
        image: { bytes, mime },
        item: match.item,
        path: match.path,
      };
    } catch {
      return null;
    }
  }
}
