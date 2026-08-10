// Validates the static vocabulary data in src/data/vocabulary/*.json.
// No third-party dependencies — only Node's built-in fs/path/url modules.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const vocabDir = path.join(__dirname, '..', 'src', 'data', 'vocabulary');

const EXPECTED_COUNTS = {
  developer: 500,
  'project-manager': 500,
  'ai-research': 10,
};

const VALID_WORD_BOOK_IDS = new Set(Object.keys(EXPECTED_COUNTS));

const REQUIRED_STRING_FIELDS = [
  'id',
  'term',
  'chineseMeaning',
  'partOfSpeech',
  'englishDefinition',
  'exampleSentence',
  'exampleTranslation',
  'wordBookId',
];

const ORIGINAL_DEVELOPER_IDS = [
  'dev-stakeholder',
  'dev-refactor',
  'dev-deployment',
  'dev-legacy-code',
  'dev-scalability',
  'dev-debugging',
  'dev-code-review',
  'dev-dependency',
  'dev-repository',
  'dev-technical-debt',
];

const PLACEHOLDER_PATTERNS = [/\btodo\b/i, /\bplaceholder\b/i, /\bexample project\b/i, /\[.*\]/];

const CJK_REGEX = /[一-鿿㐀-䶿豈-﫿]/;

function normalizeTerm(term) {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

function readJsonFile(fileName) {
  const filePath = path.join(vocabDir, fileName);
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

const files = {
  developer: 'developer.json',
  'project-manager': 'projectManager.json',
  'ai-research': 'aiResearch.json',
};

const errors = [];

const byWordBook = {};
for (const [wordBookId, fileName] of Object.entries(files)) {
  byWordBook[wordBookId] = readJsonFile(fileName);
}

// 1-3: exact counts per word book.
for (const [wordBookId, expected] of Object.entries(EXPECTED_COUNTS)) {
  const actual = byWordBook[wordBookId].length;
  if (actual !== expected) {
    errors.push(`Expected ${expected} items for wordBookId "${wordBookId}", found ${actual}.`);
  }
}

// Combine all items the same way sampleVocabulary.ts does (developer, then
// project-manager, then ai-research), to also cover check 13.
const combined = [...byWordBook.developer, ...byWordBook['project-manager'], ...byWordBook['ai-research']];

// 4: global id uniqueness. 13: no object duplicated in the aggregated array.
const seenIds = new Map();
for (const item of combined) {
  if (!item || typeof item !== 'object' || typeof item.id !== 'string') {
    errors.push(`Found an item without a valid string id: ${JSON.stringify(item)}`);
    continue;
  }
  if (seenIds.has(item.id)) {
    errors.push(`Duplicate id across the aggregated vocabulary: "${item.id}".`);
  } else {
    seenIds.set(item.id, item);
  }
}

// 5: per-word-book normalized term uniqueness.
for (const [wordBookId, items] of Object.entries(byWordBook)) {
  const seenTerms = new Map();
  for (const item of items) {
    if (typeof item.term !== 'string') continue;
    const normalized = normalizeTerm(item.term);
    if (seenTerms.has(normalized)) {
      errors.push(
        `Duplicate term (after trim/lowercase/whitespace-collapse) in "${wordBookId}": "${item.term}" collides with "${seenTerms.get(normalized)}".`,
      );
    } else {
      seenTerms.set(normalized, item.term);
    }
  }
}

// 6-8, 11: per-item field checks.
for (const item of combined) {
  if (!item || typeof item !== 'object') continue;
  const label = typeof item.id === 'string' ? item.id : '<unknown id>';

  if (!VALID_WORD_BOOK_IDS.has(item.wordBookId)) {
    errors.push(`Item "${label}" has an invalid wordBookId: ${JSON.stringify(item.wordBookId)}.`);
  }

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = item[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`Item "${label}" is missing a non-empty string field "${field}".`);
    }
  }

  if (!Array.isArray(item.tags) || item.tags.length === 0) {
    errors.push(`Item "${label}" must have a non-empty tags array.`);
  } else if (!item.tags.every((tag) => typeof tag === 'string' && tag.trim().length > 0)) {
    errors.push(`Item "${label}" has a tags array with a non-string or empty entry.`);
  }

  const textFieldsToScan = [
    item.term,
    item.chineseMeaning,
    item.partOfSpeech,
    item.englishDefinition,
    item.exampleSentence,
    item.exampleTranslation,
  ];
  for (const text of textFieldsToScan) {
    if (typeof text !== 'string') continue;
    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(text)) {
        errors.push(`Item "${label}" appears to contain placeholder text: "${text}".`);
        break;
      }
    }
  }
}

// 9-10: developer-specific checks.
for (const item of byWordBook.developer) {
  if (typeof item.id !== 'string' || !item.id.startsWith('dev-')) {
    errors.push(`Developer item has an id that doesn't start with "dev-": ${JSON.stringify(item.id)}.`);
  }
  if (typeof item.chineseMeaning !== 'string' || !CJK_REGEX.test(item.chineseMeaning)) {
    errors.push(`Developer item "${item.id}" has a chineseMeaning without Chinese characters.`);
  }
  if (typeof item.exampleTranslation !== 'string' || !CJK_REGEX.test(item.exampleTranslation)) {
    errors.push(`Developer item "${item.id}" has an exampleTranslation without Chinese characters.`);
  }
}

// 12: original 10 developer ids must still exist.
const developerIds = new Set(byWordBook.developer.map((item) => item.id));
for (const id of ORIGINAL_DEVELOPER_IDS) {
  if (!developerIds.has(id)) {
    errors.push(`Original developer id "${id}" is missing.`);
  }
}

if (errors.length > 0) {
  console.error(`Vocabulary validation failed with ${errors.length} error(s):\n`);
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(
  `Vocabulary validation passed: ${byWordBook.developer.length} developer, ${byWordBook['project-manager'].length} project-manager, ${byWordBook['ai-research'].length} ai-research (${combined.length} total).`,
);
