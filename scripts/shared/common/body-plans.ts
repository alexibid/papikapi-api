export type BodyPlan =
  | 'equine' | 'feline' | 'canine' | 'ursine' | 'cervid' | 'giraffe' | 'heavy-mammal' | 'small-mammal' | 'bird'
  | 'dinosaur' | 'fish' | 'cephalopod' | 'turtle' | 'seahorse' | 'road-vehicle' | 'aircraft' | 'watercraft'
  | 'character';

const BODY_WORDS: Readonly<Record<BodyPlan, readonly string[]>> = {
  equine: ['horse', 'pony', 'unicorn', 'donkey', 'mule', 'zebra', 'foal', 'mare', 'stallion', 'cavalo', 'egua', 'ponei',
    'unicornio', 'burro', 'mula', 'potro'],
  feline: ['cat', 'kitten', 'kitty', 'lion', 'tiger', 'cheetah', 'leopard', 'panther', 'lynx', 'siamese', 'calico', 'tabby',
    'gato', 'gata', 'gatinho', 'gatinha', 'leao', 'leoa', 'tigre', 'chita', 'leopardo', 'pantera', 'lince', 'siames'],
  canine: ['dog', 'puppy', 'wolf', 'fox', 'pug', 'dalmatian', 'rottweiler', 'shepherd', 'retriever', 'cao', 'cachorro',
    'cachorrinho', 'cadela', 'lobo', 'raposa', 'dalmata', 'pastor'],
  ursine: ['bear', 'panda', 'urso', 'ursinho'],
  cervid: ['deer', 'fawn', 'reindeer', 'moose', 'veado', 'cervo', 'cervinho', 'rena', 'alce'],
  giraffe: ['giraffe', 'girafa'],
  'heavy-mammal': ['elephant', 'hippo', 'hippopotamus', 'rhino', 'rhinoceros', 'elefante', 'hipopotamo', 'rinoceronte'],
  'small-mammal': ['squirrel', 'raccoon', 'rabbit', 'bunny', 'hamster', 'mouse', 'hedgehog', 'esquilo', 'guaxinim', 'coelho',
    'hamster', 'rato', 'ourico'],
  bird: ['owl', 'bird', 'parrot', 'penguin', 'duck', 'chicken', 'coruja', 'mocho', 'passaro', 'papagaio', 'pinguim', 'pato',
    'galinha'],
  dinosaur: ['dinosaur', 'dino', 'rex', 'raptor', 'velociraptor', 'triceratops', 'stegosaurus', 'brachiosaurus',
    'ankylosaurus', 'dinossauro', 'estegossauro', 'braquiossauro', 'anquilossauro', 'triceratopo'],
  fish: ['fish', 'shark', 'dolphin', 'whale', 'orca', 'clownfish', 'peixe', 'tubarao', 'golfinho', 'baleia'],
  cephalopod: ['octopus', 'squid', 'polvo', 'lula'],
  turtle: ['turtle', 'tortoise', 'tartaruga', 'cagado'],
  seahorse: ['seahorse', 'hippocampus', 'cavalo-marinho'],
  'road-vehicle': ['car', 'truck', 'tractor', 'train', 'bus', 'carro', 'camiao', 'trator', 'comboio', 'autocarro', 'trem'],
  aircraft: ['plane', 'airplane', 'aeroplane', 'jet', 'helicopter', 'aviao', 'helicoptero'],
  watercraft: ['submarine', 'boat', 'ship', 'submarino', 'barco', 'navio'],
  character: ['mario', 'sonic', 'kirby', 'yoshi', 'pikachu', 'donkey', 'kong'],
};

const FOUR_LEGGED: readonly BodyPlan[] = ['equine', 'feline', 'canine', 'cervid', 'giraffe', 'heavy-mammal'];

const COMPOUND_FIRST: readonly BodyPlan[] = ['seahorse', 'character'];

export class BodyPlans {
  public static words(text: string): readonly string[] {
    return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z-]+/).filter(Boolean)
      .flatMap((word) => [word, ...word.split('-')]);
  }

  public static of(text: string): BodyPlan | undefined {
    const words = new Set(this.words(text));
    const plans = Object.keys(BODY_WORDS) as BodyPlan[];
    const ordered = [...COMPOUND_FIRST, ...plans.filter((plan) => !COMPOUND_FIRST.includes(plan))];
    return ordered.find((plan) => this.matches(plan, words));
  }

  /** Animals that stand on four legs: a photo of one sitting must never turn it into a figure on its hind legs. */
  public static isFourLegged(text: string): boolean {
    const plan = this.of(text);
    return plan !== undefined && FOUR_LEGGED.includes(plan);
  }

  private static matches(plan: BodyPlan, words: ReadonlySet<string>): boolean {
    if (plan === 'character') {
      return words.has('donkey') ? words.has('kong') : BODY_WORDS.character.some((word) => words.has(word));
    }
    return BODY_WORDS[plan].some((word) => words.has(word));
  }
}
