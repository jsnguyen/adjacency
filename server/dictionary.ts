import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildWordSet } from './rules.ts';

export type DictionaryMode = 'inline' | 'file' | 'system' | 'permissive';

export type Dictionary = {
  words: Set<string>;
  mode: DictionaryMode;
  source: string;
};

const SYSTEM_DICTIONARIES = [
  '/usr/share/dict/words',
  '/usr/share/dict/web2',
];

const SCRABBLE_SHORT_WORDS = [
  'AA', 'AB', 'AD', 'AE', 'AG', 'AH', 'AI', 'AL', 'AM', 'AN', 'AR', 'AS', 'AT', 'AW', 'AX', 'AY',
  'BA', 'BE', 'BI', 'BO', 'BY',
  'DA', 'DE', 'DO',
  'ED', 'EF', 'EH', 'EL', 'EM', 'EN', 'ER', 'ES', 'ET', 'EW', 'EX',
  'FA', 'FE',
  'GI', 'GO',
  'HA', 'HE', 'HI', 'HM', 'HO',
  'ID', 'IF', 'IN', 'IS', 'IT',
  'JO',
  'KA', 'KI', 'KO', 'KY',
  'LA', 'LI', 'LO',
  'MA', 'ME', 'MI', 'MM', 'MO', 'MU', 'MY',
  'NA', 'NE', 'NO', 'NU',
  'OD', 'OE', 'OF', 'OH', 'OI', 'OK', 'OM', 'ON', 'OP', 'OR', 'OS', 'OW', 'OX', 'OY',
  'PA', 'PE', 'PI',
  'QI',
  'RE',
  'SH', 'SI', 'SO',
  'TA', 'TE', 'TI', 'TO',
  'UH', 'UM', 'UN', 'UP', 'US', 'UT',
  'WE', 'WO',
  'XI', 'XU',
  'YA', 'YE', 'YO',
  'ZA',
];

export function loadDictionary(): Dictionary {
  if (process.env.ADJACENCY_WORDS) {
    const words = buildWordSet(process.env.ADJACENCY_WORDS);
    return { words, mode: 'inline', source: 'ADJACENCY_WORDS' };
  }

  const configuredPath = process.env.ADJACENCY_DICTIONARY;
  if (configuredPath) {
    return loadDictionaryFile(configuredPath, 'file');
  }

  const bundledPath = fileURLToPath(new URL('./dictionary.txt', import.meta.url));
  if (existsSync(bundledPath)) {
    return loadDictionaryFile(bundledPath, 'file');
  }

  for (const path of SYSTEM_DICTIONARIES) {
    if (existsSync(path)) {
      return loadDictionaryFile(path, 'system');
    }
  }

  return { words: new Set(), mode: 'permissive', source: 'none' };
}

function loadDictionaryFile(path: string, mode: DictionaryMode): Dictionary {
  const words = buildWordSet(readFileSync(path, 'utf8'));
  for (const word of SCRABBLE_SHORT_WORDS) {
    words.add(word);
  }
  return { words, mode, source: path };
}
