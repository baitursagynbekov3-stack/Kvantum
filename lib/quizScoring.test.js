const { scoreQuiz, modeWithTiebreak, SPHERE_KEYS } = require('./quizScoring');

function allSpheres(fillArray) {
  const answers = {};
  for (const sphere of SPHERE_KEYS) {
    answers[sphere] = fillArray(sphere);
  }
  return answers;
}

describe('modeWithTiebreak', () => {
  test('returns the single dominant key', () => {
    expect(modeWithTiebreak(['c', 'c', 't'])).toBe('c');
    expect(modeWithTiebreak(['t', 't', 'a'])).toBe('t');
    expect(modeWithTiebreak(['a', 'a', 'c'])).toBe('a');
  });

  test('tie-break order is a > c > t when all three keys tie', () => {
    expect(modeWithTiebreak(['c', 't', 'a'])).toBe('a');
  });

  test('tie-break picks a over c when only those two tie', () => {
    expect(modeWithTiebreak(['a', 'a', 'c', 'c'])).toBe('a');
  });

  test('tie-break picks c over t when only those two tie', () => {
    expect(modeWithTiebreak(['c', 'c', 't', 't'])).toBe('c');
  });

  test('throws on invalid key', () => {
    expect(() => modeWithTiebreak(['c', 'x', 'a'])).toThrow();
  });

  test('throws on empty input', () => {
    expect(() => modeWithTiebreak([])).toThrow();
  });
});

describe('scoreQuiz', () => {
  test('all answers "c" across all spheres → overall level 1 (Ребёнок)', () => {
    const answers = allSpheres(() => ['c', 'c', 'c']);
    const result = scoreQuiz(answers);

    expect(result.overallKey).toBe('c');
    expect(result.overallLevel).toBe(1);
    expect(result.adultSpheres).toBe(0);
    for (const sphere of SPHERE_KEYS) {
      expect(result.sphereKeys[sphere]).toBe('c');
      expect(result.sphereLevels[sphere]).toBe(1);
    }
  });

  test('all answers "t" across all spheres → overall level 2 (Подросток)', () => {
    const answers = allSpheres(() => ['t', 't', 't']);
    const result = scoreQuiz(answers);

    expect(result.overallKey).toBe('t');
    expect(result.overallLevel).toBe(2);
    expect(result.adultSpheres).toBe(0);
  });

  test('all answers "a" across all spheres → overall level 3 (Взрослый), adultSpheres = 6', () => {
    const answers = allSpheres(() => ['a', 'a', 'a']);
    const result = scoreQuiz(answers);

    expect(result.overallKey).toBe('a');
    expect(result.overallLevel).toBe(3);
    expect(result.adultSpheres).toBe(6);
    for (const sphere of SPHERE_KEYS) {
      expect(result.sphereKeys[sphere]).toBe('a');
      expect(result.sphereLevels[sphere]).toBe(3);
    }
  });

  test('overall tie between all three levels resolves to "a" (tie-break a > c > t)', () => {
    // Ровно по 6 ответов c/t/a на 18 вопросов -> ничья по общему счёту.
    const answers = allSpheres(() => ['c', 't', 'a']);
    const result = scoreQuiz(answers);

    expect(result.overallKey).toBe('a');
    expect(result.overallLevel).toBe(3);
  });

  test('mixed answers are scored correctly per sphere independently', () => {
    const answers = {
      money: ['c', 'c', 't'],          // мода c
      relationships: ['a', 'a', 'a'],  // мода a
      health: ['t', 't', 'a'],         // мода t
      realization: ['c', 't', 'a'],    // ничья -> тай-брейк a
      mindset: ['a', 'a', 'c'],        // мода a
      spirituality: ['c', 'c', 'c']    // мода c
    };
    const result = scoreQuiz(answers);

    expect(result.sphereKeys).toEqual({
      money: 'c',
      relationships: 'a',
      health: 't',
      realization: 'a',
      mindset: 'a',
      spirituality: 'c'
    });
    expect(result.sphereLevels).toEqual({
      money: 1,
      relationships: 3,
      health: 2,
      realization: 3,
      mindset: 3,
      spirituality: 1
    });
  });

  test('adultSpheres counts only spheres whose mode is "a"', () => {
    const answers = {
      money: ['a', 'a', 'a'],
      relationships: ['a', 'a', 'c'],
      health: ['c', 'c', 'c'],
      realization: ['t', 't', 't'],
      mindset: ['a', 't', 'c'], // tie -> a
      spirituality: ['t', 'a', 'a']
    };
    const result = scoreQuiz(answers);

    // adult spheres: money, relationships, mindset, spirituality = 4
    expect(result.adultSpheres).toBe(4);
  });

  test('throws if a sphere is missing from the input', () => {
    const answers = allSpheres(() => ['c', 'c', 'c']);
    delete answers.mindset;
    expect(() => scoreQuiz(answers)).toThrow();
  });

  test('throws if a sphere does not have exactly 3 answers', () => {
    const answers = allSpheres(() => ['c', 'c', 'c']);
    answers.money = ['c', 'c'];
    expect(() => scoreQuiz(answers)).toThrow();
  });

  test('throws if answers is not an object', () => {
    expect(() => scoreQuiz(null)).toThrow();
    expect(() => scoreQuiz(undefined)).toThrow();
  });
});
