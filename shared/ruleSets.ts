export type WordLengthRule = 'standard' | 'no-two-letter-words' | 'no-three-letter-words';
export type AreaBonusRule = 'none' | 'closed-rectangle-area';

const WORD_LENGTH_RULES = new Set<WordLengthRule>([
  'standard',
  'no-two-letter-words',
  'no-three-letter-words',
]);

const AREA_BONUS_RULES = new Set<AreaBonusRule>([
  'none',
  'closed-rectangle-area',
]);

export function isWordLengthRule(value: unknown): value is WordLengthRule {
  return typeof value === 'string' && WORD_LENGTH_RULES.has(value as WordLengthRule);
}

export function isAreaBonusRule(value: unknown): value is AreaBonusRule {
  return typeof value === 'string' && AREA_BONUS_RULES.has(value as AreaBonusRule);
}

export function minimumWordLengthForRule(rule: WordLengthRule): number {
  switch (rule) {
    case 'no-two-letter-words':
      return 3;
    case 'no-three-letter-words':
      return 4;
    case 'standard':
      return 2;
  }
}
