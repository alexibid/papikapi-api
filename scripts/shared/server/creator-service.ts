import { copyFileSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { InlineImage } from '../common/interfaces/index.js';
import { CatalogueManager } from '../common/catalogue-manager.js';
import { ImageMime } from '../common/image-mime.js';
import { OutputCleaner } from '../common/output-cleaner.js';
import { PipelineConfigLoader } from '../common/pipeline-config.js';
import { ProgressHub } from '../common/progress-hub.js';
import { PromptRepository } from '../common/prompt-repository.js';
import { WorkspacePaths } from '../common/workspace-paths.js';
import { AlternativesGenerator } from '../../stage-1/step-1-alternatives.js';
import { AlternativePicker } from '../../stage-1/step-2-pick.js';
import { ArtUpscaler } from '../../stage-1/step-3-upscale.js';
import { TrellisInputGenerator } from '../../stage-2/step-1-trellis-input.js';
import { TrellisGenerator } from '../../stage-2/step-2-trellis.js';
import { SimplifyGenerator } from '../../stage-3/step-1-simplify.js';
import { TrellisAtlasGenerator } from '../../stage-3/step-2-trellis-atlas.js';
import { AtlasGenerator } from '../../stage-3/step-3-atlas.js';
import { TexturizeGenerator } from '../../stage-3/step-4-texturize.js';
import { PlinthGenerator } from '../../stage-3/step-5-plinth.js';
import { PreviewsGenerator } from '../../stage-3/step-6-previews.js';
import { UnfoldGenerator } from '../../stage-4/step-1-unfold.js';
import { SheetsExporter } from '../../stage-4/step-2-sheets.js';
import { AssemblyGenerator } from '../../stage-5/step-1-assembly.js';
import type { FigureIdentity } from '../common/interfaces/index.js';
import { FigureId } from '../common/figure-id.js';
import { FigureRegistry } from '../common/figure-registry.js';
import type {
  CreatorBuildResult,
  CreatorGenerationRequest,
  CreatorIdentityRequest,
  CreatorModelInfo,
  CreatorSheetFile,
} from './creator-service.interface.js';

const PT_TO_EN_DICTIONARY: Readonly<Record<string, string>> = {
  // Animals
  cao: 'dog',
  cachorro: 'dog',
  canino: 'dog',
  cachorrinho: 'puppy',
  gato: 'cat',
  gata: 'cat',
  gatinho: 'kitten',
  peluche: 'plush',
  pelucia: 'plush',
  boneco: 'toy',
  boneca: 'doll',
  urso: 'bear',
  ursinho: 'bear-cub',
  leao: 'lion',
  leoa: 'lion',
  tigre: 'tiger',
  elefante: 'elephant',
  girafa: 'giraffe',
  dinossauro: 'dino',
  dino: 'dino',
  tubarao: 'shark',
  golfinho: 'dolphin',
  tartaruga: 'turtle',
  coelho: 'rabbit',
  cavalo: 'horse',
  pato: 'duck',
  porco: 'pig',
  vaca: 'cow',
  ovelha: 'sheep',
  macaco: 'monkey',
  raposa: 'fox',
  lobo: 'wolf',
  passaro: 'bird',
  ave: 'bird',
  peixe: 'fish',
  panda: 'panda',
  koala: 'koala',
  coala: 'koala',
  coruja: 'owl',
  esquilo: 'squirrel',
  zebra: 'zebra',
  pinguim: 'penguin',
  polvo: 'octopus',
  dragao: 'dragon',
  unicornio: 'unicorn',
  monstro: 'monster',
  robo: 'robot',

  // Vehicles
  carro: 'car',
  carrinho: 'car',
  camiao: 'truck',
  caminhao: 'truck',
  bombeiros: 'fire-truck',
  policia: 'police-car',
  comboio: 'train',
  trem: 'train',
  aviao: 'plane',
  barco: 'boat',
  navio: 'ship',
  submarino: 'submarine',
  foguete: 'rocket',
  trator: 'tractor',

  // Colors
  preto: 'black',
  preta: 'black',
  branco: 'white',
  branca: 'white',
  azul: 'blue',
  azuis: 'blue',
  vermelho: 'red',
  vermelha: 'red',
  amarelo: 'yellow',
  amarela: 'yellow',
  verde: 'green',
  verdes: 'green',
  castanho: 'brown',
  cinzento: 'grey',
  cinza: 'grey',
  rosa: 'pink',
  roxo: 'purple',
  laranja: 'orange',
  dourado: 'gold',

  // Modifiers
  bebe: 'baby',
  pequeno: 'little',
  grande: 'big',
  fofo: 'cute',
  fofinho: 'cute',
  engracado: 'funny',
  divertido: 'funny',
  voador: 'winged',
  asas: 'wings',
  bicolor: 'bicolor',
  tuxedo: 'tuxedo',
};

const STOP_WORDS = new Set([
  'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as', 'the', 'an',
  'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
  'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'com', 'e', 'que',
  'para', 'por', 'tipo', 'estilo', 'cute', 'of', 'in', 'with', 'and',
  'low', 'poly', 'faceted', '3d', 'papercraft', 'model', 'seen', 'eye',
  'level', 'three', 'quarter', 'view', 'camera', 'feet', 'resting', 'one',
  'flat', 'ground', 'plane',
]);

export class CreatorService {
  public static figureIdOf(value: string): string {
    const id = (value ?? '').trim();
    if (FigureId.isValid(id) || FigureRegistry.exists(id)) return id;
    throw new Error(`Unknown figure id '${id}'`);
  }

  public static resolveIdentity(request: CreatorIdentityRequest): FigureIdentity {
    const id = this.isKnownOrValid(request.id) ? request.id : FigureRegistry.newId();
    if (request.displayName) {
      return { id, subject: FigureRegistry.subjectFrom(request.displayName), displayName: request.displayName };
    }
    if (FigureRegistry.exists(id)) return FigureRegistry.identityOf(id);
    const subject = this.deriveSubject(request.prompt) || id;
    const name = FigureRegistry.humanize(subject);
    return { id, subject, displayName: { pt: name, en: name } };
  }

  private static isKnownOrValid(id: string | undefined): id is string {
    return id !== undefined && (FigureId.isValid(id) || FigureRegistry.exists(id));
  }

  public static deriveSubject(prompt: string): string {
    const raw = (prompt ?? '').trim();
    if (!raw) return '';

    // Strip boilerplate studio prefixes if present
    let subject = raw
      .replace(/^low-poly\s+faceted\s+3d\s+papercraft\s+model\s+of\s+/i, '')
      .replace(/\s+seen\s+in\s+an\s+eye-level[\s\S]*$/i, '');

    // If there is an explicit "Subject:" line, use that
    const subjectMatch = subject.match(/(?:^|\n)Subject:\s*([^\n.]+)/i);
    if (subjectMatch) {
      subject = subjectMatch[1].trim();
    } else {
      subject = subject.split(/[\n.;]|\s+(?:seen\s+in|with\s+all\s+feet)\b/i)[0].trim();
    }

    // Strip "com ...", "with ...", or extra anatomical clauses that aren't part of the core subject name
    const coreSubject = subject.split(/\s+(?:with|com)\s+/i)[0].trim();

    // Check iconic character names
    if (/\b(snoopy|snoopi)\b/i.test(subject)) {
      return /\b(peluche|pelucia|plush|boneco|toy)\b/i.test(subject) ? 'snoopy-plush' : 'snoopy';
    }
    if (/\b(pac-man|pacman)\b/i.test(subject)) return 'pac-man';
    if (/\b(mario)\b/i.test(subject)) return 'mario';
    if (/\b(sonic)\b/i.test(subject)) return 'sonic';
    if (/\b(pikachu)\b/i.test(subject)) return 'pikachu';
    if (/\b(kirby)\b/i.test(subject)) return 'kirby';
    if (/\b(yoshi)\b/i.test(subject)) return 'yoshi';
    if (/\b(darth)\b/i.test(subject)) return /\b(cat|gato)\b/i.test(subject) ? 'cat-darth' : 'darth';
    if (/\b(alex)\b/i.test(subject)) return 'alex';
    if (/\b(steve)\b/i.test(subject)) return 'steve';
    if (/\b(creeper)\b/i.test(subject)) return 'creeper';
    if (/\b(zombie)\b/i.test(subject)) return 'zombie';

    const normalized = (coreSubject || subject)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
    const translated: string[] = [];

    for (const token of tokens) {
      if (token in PT_TO_EN_DICTIONARY) {
        translated.push(PT_TO_EN_DICTIONARY[token]);
      } else if (!STOP_WORDS.has(token)) {
        translated.push(token);
      }
    }

    const candidate = translated.join('-');
    return (
      candidate
        .replace(/^(?:a-cute|cute|a)-+/i, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
        .replace(/-+$/, '') || ''
    );
  }

  public static dataUrlToImage(dataUrl: string): InlineImage {
    const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) {
      const raw = Buffer.from(dataUrl, 'base64');
      return { bytes: raw, mime: 'image/jpeg' };
    }
    return {
      mime: match[1],
      bytes: Buffer.from(match[2], 'base64'),
    };
  }

  public static async generateAlternatives(identity: FigureIdentity, request: CreatorGenerationRequest) {
    const { prompt, images } = request;
    const cleanName = identity.id;
    FigureRegistry.register(identity);
    const referenceImages = Array.isArray(images) && images.length > 0
      ? images.map((img) => CreatorService.dataUrlToImage(img))
      : [];

    PromptRepository.saveFigure(cleanName, 's1-step-1', prompt);
    ProgressHub.begin(cleanName, ['s1-step-1']);
    try {
      const result = await AlternativesGenerator.execute({
        name: cleanName,
        subject: identity.subject,
        prompt,
        referenceImages,
      });
      OutputCleaner.purgeNonMediaFiles(cleanName);
      ProgressHub.finish(cleanName);
      return result;
    } catch (err) {
      ProgressHub.fail(cleanName, (err as Error).message);
      throw err;
    }
  }

  public static async buildModel(
    name: string,
    pick: number,
  ): Promise<CreatorBuildResult> {
    const cleanName = CreatorService.figureIdOf(name);
    ProgressHub.begin(cleanName, [
      's1-step-2',
      's1-step-3',
      's2-step-1',
      's2-step-2',
      's3-step-1',
      's3-step-2',
      's3-step-3',
      's3-step-4',
      's3-step-5',
      's3-step-6',
      's4-step-1',
      's4-step-2',
      's5-step-1',
    ]);
    try {
      const cropResult = await AlternativePicker.execute({ name: cleanName, pick });
      await ArtUpscaler.execute({ name: cleanName });
      await TrellisInputGenerator.execute({ name: cleanName });
      const trellisResult = await TrellisGenerator.execute(cleanName, pick);
      try {
        await SimplifyGenerator.execute(cleanName, pick);
        await TrellisAtlasGenerator.execute(cleanName);
        await AtlasGenerator.execute(cleanName);
        await TexturizeGenerator.execute(cleanName);
        await PlinthGenerator.execute(cleanName);
        await PreviewsGenerator.execute(cleanName);
        await UnfoldGenerator.execute(cleanName);
        await SheetsExporter.execute(cleanName);
        await AssemblyGenerator.execute(cleanName);
      } catch (postTrellisErr) {
        console.warn(`[creator] Post-Trellis stages skipped or failed: ${(postTrellisErr as Error).message}`);
        const pubGlb = join(WorkspacePaths.modelPath(cleanName), 'model.glb');
        const trellisGlb = join(WorkspacePaths.stageResourceDir(cleanName, 'stage-2'), 'step-2-3d.glb');
        if (!existsSync(pubGlb) && existsSync(trellisGlb)) {
          copyFileSync(trellisGlb, pubGlb);
        }
      }
      OutputCleaner.purgeNonMediaFiles(cleanName);
      CatalogueManager.sync();
      ProgressHub.finish(cleanName);
      return { cropResult, trellisResult };
    } catch (err) {
      ProgressHub.fail(cleanName, (err as Error).message);
      throw err;
    }
  }

  public static getSheet(name: string): CreatorSheetFile | null {
    const cleanName = CreatorService.figureIdOf(name);
    const step1 = PipelineConfigLoader.getStep('s1-step-1');
    const stage0Dir = join(WorkspacePaths.resourcePath(cleanName), step1.stage_dir);
    const publicDir = WorkspacePaths.modelPath(cleanName);

    const candidates: string[] = [];
    for (const ext of step1.outputs.allowed_extensions) {
      const resBase = step1.outputs.sheet_resource.replace(/\.[^/.]+$/, '');
      candidates.push(join(stage0Dir, `${resBase}${ext}`));
      const pubBase = step1.outputs.sheet_public.replace(/\.[^/.]+$/, '');
      candidates.push(join(publicDir, `${pubBase}${ext}`));
    }

    const sheetPath = candidates.find((p) => existsSync(p));
    if (!sheetPath) return null;

    const bytes = readFileSync(sheetPath);
    const mime = ImageMime.of(bytes);
    return { bytes, mime };
  }

  public static getModelInfo(name: string): CreatorModelInfo {
    const cleanName = CreatorService.figureIdOf(name);
    const step1 = PipelineConfigLoader.getStep('s1-step-1');
    const step2 = PipelineConfigLoader.getStep('s1-step-2');
    const step3 = PipelineConfigLoader.getStep('s2-step-2');

    const stage0Dir = join(WorkspacePaths.resourcePath(cleanName), step1.stage_dir);
    const publicDir = WorkspacePaths.modelPath(cleanName);

    const candidates: string[] = [];
    for (const ext of step1.outputs.allowed_extensions) {
      const resBase = step1.outputs.sheet_resource.replace(/\.[^/.]+$/, '');
      candidates.push(join(stage0Dir, `${resBase}${ext}`));
      const pubBase = step1.outputs.sheet_public.replace(/\.[^/.]+$/, '');
      candidates.push(join(publicDir, `${pubBase}${ext}`));
    }
    const hasAlternatives = candidates.some((p) => existsSync(p));

    const cachedPicks: number[] = [];
    const alternativesCount = step1.parameters?.alternatives_count !== undefined
      ? Number(step1.parameters.alternatives_count)
      : 6;
    for (let p = 1; p <= alternativesCount; p++) {
      const pattern = step3.outputs.model_pick_resource_pattern.replace('{pick}', String(p));
      const pickGlb = join(WorkspacePaths.resourcePath(cleanName), step3.outputs.stage_dir, pattern);
      if (existsSync(pickGlb) && statSync(pickGlb).size > 1000) {
        cachedPicks.push(p);
      }
    }

    let currentPick: number | null = null;
    const pubModel = join(publicDir, step3.outputs.model_public);
    const hasPubModel = existsSync(pubModel) && statSync(pubModel).size > 1000;

    const step2Manifest = join(stage0Dir, step2.outputs.manifest);
    if (existsSync(step2Manifest) && hasPubModel) {
      try {
        const parsed = JSON.parse(readFileSync(step2Manifest, 'utf-8'));
        if (parsed?.data?.chosenPick) {
          currentPick = Number(parsed.data.chosenPick);
          if (!cachedPicks.includes(currentPick)) {
            cachedPicks.push(currentPick);
          }
        }
      } catch {}
    }

    cachedPicks.sort((a, b) => a - b);

    return {
      id: cleanName,
      hasAlternatives,
      sheetUrl: hasAlternatives ? `/api/creator/sheet?id=${cleanName}` : null,
      cachedPicks,
      currentPick,
    };
  }

  public static deleteModel(name: string): string {
    const cleanName = CreatorService.figureIdOf(name);
    const resourceDir = WorkspacePaths.resourcePath(cleanName);
    const publicDir = WorkspacePaths.modelPath(cleanName);

    if (existsSync(resourceDir)) {
      rmSync(resourceDir, { recursive: true, force: true });
    }
    if (existsSync(publicDir)) {
      rmSync(publicDir, { recursive: true, force: true });
    }

    CatalogueManager.sync();
    return cleanName;
  }
}
