export const CANONICAL_DOMAINS = [
  'chores',
  'school',
  'behavior',
  'dialogue',
  'family',
] as const;

export type CanonicalDomainId = (typeof CANONICAL_DOMAINS)[number];

export const CANONICAL_ANCHORS = [
  // Chores
  'morning_routine',
  'hygiene_grooming',
  'meal_independence',
  'room_order',
  'bedtime_routine',
  // School
  'homework_completion',
  'focus_study',
  'classroom_conduct',
  'school_preparation',
  'curiosity_effort',
  // Behavior
  'screen_transition',
  'frustration_tolerance',
  'calm_down_recovery',
  'patience_waiting',
  'respect_compliance',
  // Dialogue
  'day_sharing',
  'truthfulness_honesty',
  'active_listening',
  'conflict_resolution',
  'needs_articulation',
  // Family
  'sibling_sharing',
  'household_cooperation',
  'kindness_empathy',
  'family_quality_time',
  'protecting_caring',
] as const;

export type CanonicalAnchorId = (typeof CANONICAL_ANCHORS)[number];

export interface AnchorDefinition {
  readonly id: CanonicalAnchorId;
  readonly domain: CanonicalDomainId;
  readonly defaultWeight: number;
  readonly keywords: readonly string[];
  readonly explanationEn: string;
  readonly explanationPt: string;
}

export const CANONICAL_ANCHOR_CATALOGUE: Record<CanonicalAnchorId, AnchorDefinition> = {
  // Chores
  morning_routine: {
    id: 'morning_routine',
    domain: 'chores',
    defaultWeight: 2,
    keywords: ['woke', 'wake', 'dressed', 'dress', 'clothes', 'shoes', 'morning', 'ready'],
    explanationEn: 'completed the morning routine smoothly',
    explanationPt: 'cumpriu a rotina matinal com autonomia',
  },
  hygiene_grooming: {
    id: 'hygiene_grooming',
    domain: 'chores',
    defaultWeight: 2,
    keywords: ['teeth', 'brush', 'bath', 'shower', 'washed', 'hair', 'soap', 'clean'],
    explanationEn: 'took care of personal hygiene without resistance',
    explanationPt: 'cuidou da higiene pessoal sem hesitar',
  },
  meal_independence: {
    id: 'meal_independence',
    domain: 'chores',
    defaultWeight: 2,
    keywords: ['soup', 'food', 'ate', 'eat', 'plate', 'dinner', 'lunch', 'breakfast', 'vegetables', 'table'],
    explanationEn: 'ate meals well and stayed at the table',
    explanationPt: 'comeu bem a refeição e manteve-se à mesa',
  },
  room_order: {
    id: 'room_order',
    domain: 'chores',
    defaultWeight: 2,
    keywords: ['toys', 'tidy', 'tidied', 'room', 'bed', 'clean', 'organized', 'put away', 'desk'],
    explanationEn: 'organized personal space and put toys away',
    explanationPt: 'arrumou o quarto e guardou os brinquedos',
  },
  bedtime_routine: {
    id: 'bedtime_routine',
    domain: 'chores',
    defaultWeight: 2,
    keywords: ['sleep', 'bed', 'bedtime', 'pajamas', 'slept', 'night'],
    explanationEn: 'went to bed on time and settled peacefully',
    explanationPt: 'foi para a cama a horas e descansou tranquilamente',
  },

  // School
  homework_completion: {
    id: 'homework_completion',
    domain: 'school',
    defaultWeight: 3,
    keywords: ['homework', 'exercises', 'tasks', 'finished', 'done', 'worksheet', 'assignment'],
    explanationEn: 'finished homework tasks diligently',
    explanationPt: 'completou os trabalhos de casa com dedicação',
  },
  focus_study: {
    id: 'focus_study',
    domain: 'school',
    defaultWeight: 2,
    keywords: ['study', 'studied', 'read', 'reading', 'book', 'test', 'exam', 'concentrated', 'focus'],
    explanationEn: 'focused on reading and studying',
    explanationPt: 'manteve o foco no estudo e na leitura',
  },
  classroom_conduct: {
    id: 'classroom_conduct',
    domain: 'school',
    defaultWeight: 2,
    keywords: ['teacher', 'class', 'school', 'lesson', 'participated', 'praise', 'good mark'],
    explanationEn: 'showed great engagement and conduct at school',
    explanationPt: 'teve uma excelente postura e elogios na escola',
  },
  school_preparation: {
    id: 'school_preparation',
    domain: 'school',
    defaultWeight: 2,
    keywords: ['backpack', 'bag', 'pencil', 'case', 'notebooks', 'supplies'],
    explanationEn: 'kept school backpack and materials organized',
    explanationPt: 'preparou a mochila e o material escolar',
  },
  curiosity_effort: {
    id: 'curiosity_effort',
    domain: 'school',
    defaultWeight: 2,
    keywords: ['curious', 'question', 'learned', 'effort', 'tried', 'discovered', 'science', 'math'],
    explanationEn: 'demonstrated curiosity and persistent effort to learn',
    explanationPt: 'demonstrou curiosidade e vontade de aprender',
  },

  // Behavior
  screen_transition: {
    id: 'screen_transition',
    domain: 'behavior',
    defaultWeight: 3,
    keywords: ['screen', 'tv', 'television', 'ipad', 'tablet', 'game', 'playstation', 'console', 'turn off', 'stopped'],
    explanationEn: 'turned off screens without fuss when asked',
    explanationPt: 'desligou os ecrãs com cooperação quando foi pedido',
  },
  frustration_tolerance: {
    id: 'frustration_tolerance',
    domain: 'behavior',
    defaultWeight: 3,
    keywords: ['calm', 'patience', 'accepted', 'lost', 'game', 'game over', 'no complaint', 'tantrum', 'frustration'],
    explanationEn: 'handled frustration and setbacks with maturity',
    explanationPt: 'lidou com a frustração e superou as contrariedades',
  },
  calm_down_recovery: {
    id: 'calm_down_recovery',
    domain: 'behavior',
    defaultWeight: 3,
    keywords: ['breathe', 'breath', 'calmed', 'recovered', 'apologized', 'peace', 'soothed'],
    explanationEn: 'took deep breaths and recovered composure quickly',
    explanationPt: 'respirou fundo e recuperou a calma com serenidade',
  },
  patience_waiting: {
    id: 'patience_waiting',
    domain: 'behavior',
    defaultWeight: 2,
    keywords: ['waited', 'wait', 'turn', 'queue', 'patient', 'patiently'],
    explanationEn: 'waited patiently for their turn',
    explanationPt: 'soube esperar pacientemente pela sua vez',
  },
  respect_compliance: {
    id: 'respect_compliance',
    domain: 'behavior',
    defaultWeight: 2,
    keywords: ['obeyed', 'listened', 'complied', 'polite', 'respectful', 'first time', 'agreed'],
    explanationEn: 'respected family guidelines on the first call',
    explanationPt: 'respeitou os combinados à primeira sem discutir',
  },

  // Dialogue
  day_sharing: {
    id: 'day_sharing',
    domain: 'dialogue',
    defaultWeight: 2,
    keywords: ['talked', 'shared', 'told', 'story', 'feelings', 'felt', 'day', 'expressed'],
    explanationEn: 'shared stories and open feelings about the day',
    explanationPt: 'partilhou como correu o dia e expressou sentimentos',
  },
  truthfulness_honesty: {
    id: 'truthfulness_honesty',
    domain: 'dialogue',
    defaultWeight: 3,
    keywords: ['truth', 'honest', 'honesty', 'admitted', 'apologized', 'confessed', 'sincere'],
    explanationEn: 'demonstrated honesty and owned up to mistakes',
    explanationPt: 'foi sincero e assumiu os erros com coragem',
  },
  active_listening: {
    id: 'active_listening',
    domain: 'dialogue',
    defaultWeight: 2,
    keywords: ['listened', 'advice', 'understood', 'attentive', 'heard'],
    explanationEn: 'listened attentively and took guidance to heart',
    explanationPt: 'escutou com atenção os conselhos dos adultos',
  },
  conflict_resolution: {
    id: 'conflict_resolution',
    domain: 'dialogue',
    defaultWeight: 3,
    keywords: ['resolved', 'talked it out', 'agreed', 'compromise', 'negotiated', 'peacefully'],
    explanationEn: 'resolved disagreements through words instead of conflict',
    explanationPt: 'resolveu desavenças com diálogo em vez de conflito',
  },
  needs_articulation: {
    id: 'needs_articulation',
    domain: 'dialogue',
    defaultWeight: 2,
    keywords: ['asked', 'help', 'please', 'explained', 'nicely', 'calmly'],
    explanationEn: 'articulated needs calmly and asked for help politely',
    explanationPt: 'pediu ajuda com calma e explicou o que precisava',
  },

  // Family
  sibling_sharing: {
    id: 'sibling_sharing',
    domain: 'family',
    defaultWeight: 3,
    keywords: ['shared', 'share', 'brother', 'sister', 'sibling', 'together', 'turns'],
    explanationEn: 'shared toys and took turns with siblings',
    explanationPt: 'partilhou brinquedos e cooperou com os irmãos',
  },
  household_cooperation: {
    id: 'household_cooperation',
    domain: 'family',
    defaultWeight: 2,
    keywords: ['helped', 'help', 'table', 'dishes', 'trash', 'cooking', 'grandparents', 'parents'],
    explanationEn: 'participated enthusiastically in household chores',
    explanationPt: 'ajudou nas tarefas domésticas e na vida da casa',
  },
  kindness_empathy: {
    id: 'kindness_empathy',
    domain: 'family',
    defaultWeight: 3,
    keywords: ['hug', 'kiss', 'affection', 'caring', 'comforted', 'kind', 'sweet', 'love'],
    explanationEn: 'showed genuine kindness and affection towards family',
    explanationPt: 'demonstrou carinho e empatia com a família',
  },
  family_quality_time: {
    id: 'family_quality_time',
    domain: 'family',
    defaultWeight: 2,
    keywords: ['walk', 'game night', 'outing', 'together', 'meal', 'cheerful', 'celebrated'],
    explanationEn: 'engaged cheerfully in family moments',
    explanationPt: 'participou com alegria nas atividades em família',
  },
  protecting_caring: {
    id: 'protecting_caring',
    domain: 'family',
    defaultWeight: 2,
    keywords: ['dog', 'cat', 'pet', 'baby', 'younger', 'plant', 'fed', 'looked after'],
    explanationEn: 'took gentle care of pets and younger family members',
    explanationPt: 'cuidou com carinho dos animais de estimação e dos mais novos',
  },
};

export const NEGATION_WORDS_EN = ['not', "didn't", 'did not', 'never', 'refused', 'no', "won't", "wouldn't", 'without'];
export const RESOLUTION_CONJUNCTIONS_EN = ['but', 'although', 'however', 'yet', 'later', 'then', 'eventually'];
