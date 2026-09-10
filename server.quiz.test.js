/**
 * Простой supertest на POST /api/quiz/submit — проверяет, что валидный набор
 * ответов (позиции 0-2 на каждый из 18 вопросов) даёт 200 и разумную структуру
 * ответа. Не трогает БД (роут не использует Prisma).
 */
const request = require('supertest');
const app = require('./server');
const QUANTUM_QUIZ = require('./data/quiz');

function buildAnswers(pickPosition) {
  const answers = {};
  QUANTUM_QUIZ.spheres.forEach((sphere) => {
    answers[sphere.key] = sphere.questions.map(() => pickPosition());
  });
  return answers;
}

describe('POST /api/quiz/submit', () => {
  test('valid answers return 200 with a full result structure', async () => {
    const answers = buildAnswers(() => 0);

    const res = await request(app)
      .post('/api/quiz/submit')
      .send({ answers })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body.overall).toBeDefined();
    expect([1, 2, 3]).toContain(res.body.overall.level);
    expect(typeof res.body.overall.title).toBe('string');
    expect(Array.isArray(res.body.spheres)).toBe(true);
    expect(res.body.spheres).toHaveLength(6);
    expect(typeof res.body.adultSpheres).toBe('number');
    expect(typeof res.body.disclaimer).toBe('string');

    res.body.spheres.forEach((sphere) => {
      expect(sphere).toHaveProperty('key');
      expect(sphere).toHaveProperty('name');
      expect(sphere).toHaveProperty('level');
      if (sphere.level < 3) {
        expect(sphere.trajectory).toEqual(
          expect.objectContaining({
            thinking: expect.any(String),
            reaction: expect.any(String),
            action: expect.any(String)
          })
        );
      }
    });
  });

  test('missing answers returns 400', async () => {
    const res = await request(app)
      .post('/api/quiz/submit')
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });

  test('invalid position (out of range) returns 400', async () => {
    const answers = buildAnswers(() => 0);
    answers.money[0] = 5;

    const res = await request(app)
      .post('/api/quiz/submit')
      .send({ answers })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });

  test('missing sphere returns 400', async () => {
    const answers = buildAnswers(() => 0);
    delete answers.mindset;

    const res = await request(app)
      .post('/api/quiz/submit')
      .send({ answers })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });
});
