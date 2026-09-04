/**
 * Подсчёт результата теста "Кто ты сейчас" — шаг 3 переноса теста
 * (см. data/quiz.js и project-kvantum-us-site).
 *
 * Чистая функция: без побочных эффектов, без обращения к БД/сети.
 * Каждый вопрос отвечен одним из трёх ключей:
 *   c — Ребёнок  (уровень 1)
 *   t — Подросток (уровень 2)
 *   a — Взрослый  (уровень 3)
 *
 * Вход — answers: объект по 6 сферам, у каждой сферы массив из 3 ключей
 * ('c'|'t'|'a'), в порядке вопросов внутри сферы. Например:
 *   {
 *     money: ['c', 't', 'a'],
 *     relationships: ['a', 'a', 'a'],
 *     health: ['c', 'c', 't'],
 *     realization: ['t', 't', 't'],
 *     mindset: ['a', 'c', 't'],
 *     spirituality: ['c', 't', 'a']
 *   }
 *
 * Выход:
 *   {
 *     overallKey: 'c'|'t'|'a',
 *     overallLevel: 1|2|3,
 *     sphereKeys: { money: 'a', relationships: 'a', ... },
 *     sphereLevels: { money: 3, relationships: 3, ... },
 *     adultSpheres: number   // сколько из 6 сфер вышли на уровень 3 (Взрослый)
 *   }
 *
 * Мода (наиболее частый ключ) с тай-брейком a > c > t, когда несколько
 * ключей набрали одинаковое максимальное количество голосов.
 */

const VALID_KEYS = ['c', 't', 'a'];
const SPHERE_KEYS = ['money', 'relationships', 'health', 'realization', 'mindset', 'spirituality'];
const KEY_TO_LEVEL = { c: 1, t: 2, a: 3 };

// Тай-брейк: при ничьей побеждает более "взрослый" уровень — a, затем c, затем t.
// (порядок предпочтения именно такой, а не по номеру уровня, задан заказчиком)
const TIEBREAK_ORDER = ['a', 'c', 't'];

/**
 * Мода массива ключей 'c'|'t'|'a' с тай-брейком a > c > t.
 * @param {string[]} keys
 * @returns {'c'|'t'|'a'}
 */
function modeWithTiebreak(keys) {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('modeWithTiebreak: keys must be a non-empty array');
  }

  const counts = { c: 0, t: 0, a: 0 };
  for (const key of keys) {
    if (!VALID_KEYS.includes(key)) {
      throw new Error(`modeWithTiebreak: invalid answer key "${key}"`);
    }
    counts[key] += 1;
  }

  const maxCount = Math.max(counts.c, counts.t, counts.a);
  return TIEBREAK_ORDER.find((key) => counts[key] === maxCount);
}

/**
 * Подсчитывает результат теста по ответам на все 18 вопросов (6 сфер x 3).
 * @param {Record<string, string[]>} answers
 */
function scoreQuiz(answers) {
  if (!answers || typeof answers !== 'object') {
    throw new Error('scoreQuiz: answers must be an object keyed by sphere');
  }

  const sphereKeys = {};
  const sphereLevels = {};
  const allKeys = [];

  for (const sphere of SPHERE_KEYS) {
    const sphereAnswers = answers[sphere];
    if (!Array.isArray(sphereAnswers) || sphereAnswers.length !== 3) {
      throw new Error(`scoreQuiz: expected exactly 3 answers for sphere "${sphere}"`);
    }

    const sphereKey = modeWithTiebreak(sphereAnswers);
    sphereKeys[sphere] = sphereKey;
    sphereLevels[sphere] = KEY_TO_LEVEL[sphereKey];
    allKeys.push(...sphereAnswers);
  }

  const overallKey = modeWithTiebreak(allKeys);
  const adultSpheres = SPHERE_KEYS.reduce(
    (count, sphere) => count + (sphereKeys[sphere] === 'a' ? 1 : 0),
    0
  );

  return {
    overallKey,
    overallLevel: KEY_TO_LEVEL[overallKey],
    sphereKeys,
    sphereLevels,
    adultSpheres
  };
}

module.exports = {
  scoreQuiz,
  modeWithTiebreak,
  SPHERE_KEYS,
  KEY_TO_LEVEL,
  TIEBREAK_ORDER
};
