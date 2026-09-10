/**
 * Тест «Кто ты сейчас» — визард на клиенте.
 *
 * Загружает вопросы через GET /api/quiz (без ключей c/t/a — они хранятся
 * только на сервере), показывает по одному вопросу, сохраняет черновик
 * ответов в localStorage (чтобы обновление страницы не сбрасывало прогресс),
 * а после 18-го вопроса и короткой контактной формы отправляет позиции
 * выбранных вариантов на POST /api/quiz/submit и рисует экран результата.
 *
 * Контактные данные (имя/телефон-email) собираются только для перехода к
 * следующему шагу пользователя — они НЕ отправляются на сервер и нигде не
 * сохраняются в этом шаге (сохранение в БД — отдельная будущая задача).
 */
(function () {
  'use strict';

  var API_BASE = window.QUANTUM_API_BASE_URL || '';
  var DRAFT_KEY = 'kvantumQuizDraft';

  var quizData = null; // ответ GET /api/quiz
  var flatQuestions = []; // [{ sphereKey, sphereName, sphereColor, qIndexInSphere, question, options }]
  var positions = []; // выбранные позиции (0-2) по каждому вопросу из flatQuestions, null пока не отвечен
  var currentIndex = 0;

  var els = {};

  function q(id) { return document.getElementById(id); }

  function cacheEls() {
    els.loading = q('quizLoading');
    els.error = q('quizError');
    els.intro = q('quizIntro');
    els.introText = q('quizIntroText');
    els.disclaimerShort = q('quizDisclaimerShort');
    els.startBtn = q('quizStartBtn');
    els.questionScreen = q('quizQuestionScreen');
    els.progressFill = q('quizProgressFill');
    els.progressLabel = q('quizProgressLabel');
    els.questionText = q('quizQuestionText');
    els.options = q('quizOptions');
    els.backBtn = q('quizBackBtn');
    els.nextBtn = q('quizNextBtn');
    els.contactScreen = q('quizContactScreen');
    els.contactForm = q('quizContactForm');
    els.nameInput = q('quizName');
    els.contactInput = q('quizContact');
    els.consentCheckbox = q('quizConsent');
    els.showResultBtn = q('quizShowResultBtn');
    els.resultScreen = q('quizResultScreen');
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showOnly(el) {
    [els.loading, els.error, els.intro, els.questionScreen, els.contactScreen, els.resultScreen].forEach(function (node) {
      if (node) node.hidden = (node !== el);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ positions: positions, currentIndex: currentIndex }));
    } catch (err) {
      // localStorage может быть недоступен (приватный режим и т.п.) — не критично
    }
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.positions)) return null;
      return parsed;
    } catch (err) {
      return null;
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (err) {
      // ignore
    }
  }

  function buildFlatQuestions(quiz) {
    var flat = [];
    quiz.spheres.forEach(function (sphere) {
      sphere.questions.forEach(function (question, qIndexInSphere) {
        flat.push({
          sphereKey: sphere.key,
          sphereName: sphere.name,
          sphereColor: sphere.color,
          qIndexInSphere: qIndexInSphere,
          question: question.question,
          options: question.options
        });
      });
    });
    return flat;
  }

  function fetchQuiz() {
    return fetch(API_BASE + '/api/quiz')
      .then(function (res) {
        if (!res.ok) throw new Error('quiz fetch failed');
        return res.json();
      });
  }

  function submitQuiz(answersBySphere) {
    return fetch(API_BASE + '/api/quiz/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: answersBySphere })
    }).then(function (res) {
      if (!res.ok) throw new Error('quiz submit failed');
      return res.json();
    });
  }

  function renderIntro() {
    els.introText.textContent = 'Пройди ' + quizData.meta.questionsLabel + ' и узнай, какая стратегия сейчас работает в шести ключевых сферах твоей жизни: деньги, отношения, здоровье, реализация, мышление и духовность.';
    els.disclaimerShort.textContent = quizData.disclaimer.short;
    showOnly(els.intro);
  }

  function renderQuestion() {
    var item = flatQuestions[currentIndex];
    var total = flatQuestions.length;

    els.progressFill.style.width = Math.round((currentIndex / total) * 100) + '%';
    els.progressLabel.textContent = 'Вопрос ' + (currentIndex + 1) + ' из ' + total;
    els.questionText.textContent = item.question;

    els.options.innerHTML = '';
    item.options.forEach(function (opt, optIndex) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-option';
      btn.textContent = opt.text;
      if (positions[currentIndex] === optIndex) btn.classList.add('is-selected');
      btn.addEventListener('click', function () {
        positions[currentIndex] = optIndex;
        saveDraft();
        renderQuestion();
      });
      els.options.appendChild(btn);
    });

    els.backBtn.style.visibility = currentIndex === 0 ? 'hidden' : 'visible';
    els.nextBtn.disabled = positions[currentIndex] == null;
    els.nextBtn.textContent = currentIndex === total - 1 ? 'Далее' : 'Далее';

    showOnly(els.questionScreen);
  }

  function goNext() {
    if (positions[currentIndex] == null) return;

    if (currentIndex < flatQuestions.length - 1) {
      currentIndex += 1;
      saveDraft();
      renderQuestion();
    } else {
      saveDraft();
      renderContactForm();
    }
  }

  function goBack() {
    if (currentIndex === 0) return;
    currentIndex -= 1;
    saveDraft();
    renderQuestion();
  }

  function renderContactForm() {
    updateShowResultBtnState();
    showOnly(els.contactScreen);
  }

  function updateShowResultBtnState() {
    var nameOk = els.nameInput.value.trim().length > 0;
    var contactOk = els.contactInput.value.trim().length > 0;
    var consentOk = els.consentCheckbox.checked;
    els.showResultBtn.disabled = !(nameOk && contactOk && consentOk);
  }

  function answersBySphereFromPositions() {
    var bySphere = {};
    flatQuestions.forEach(function (item, index) {
      if (!bySphere[item.sphereKey]) bySphere[item.sphereKey] = [];
      bySphere[item.sphereKey][item.qIndexInSphere] = positions[index];
    });
    return bySphere;
  }

  function sphereCardHtml(sphere) {
    var trajectoryHtml = '';
    if (sphere.trajectory) {
      trajectoryHtml = '' +
        '<details class="quiz-trajectory">' +
        '<summary>Мышление &middot; Реакция &middot; Действие</summary>' +
        '<div class="quiz-trajectory-body">' +
        '<p><strong>Мышление:</strong> ' + escapeHtml(sphere.trajectory.thinking) + '</p>' +
        '<p><strong>Реакция:</strong> ' + escapeHtml(sphere.trajectory.reaction) + '</p>' +
        '<p><strong>Действие:</strong> ' + escapeHtml(sphere.trajectory.action) + '</p>' +
        '</div>' +
        '</details>';
    }

    return '' +
      '<div class="quiz-sphere-card" style="--sphere-color:' + escapeHtml(sphere.color) + '">' +
      '<div class="quiz-sphere-name">' + escapeHtml(sphere.name) + '</div>' +
      '<div class="quiz-sphere-level">' + escapeHtml(sphere.levelTitle) + '</div>' +
      trajectoryHtml +
      '</div>';
  }

  function renderResult(result) {
    var overall = result.overall;

    var html = '' +
      '<div class="quiz-result-header" style="--level-color:' + escapeHtml(overall.hex) + '">' +
      '<div class="quiz-result-badge">Уровень ' + escapeHtml(overall.level) + ' из 3</div>' +
      '<h1>' + escapeHtml(overall.title) + '</h1>' +
      '<p class="quiz-result-devuiz">' + escapeHtml(overall.devuiz) + '</p>' +
      '</div>' +
      '<p class="quiz-result-text">' + escapeHtml(overall.text) + '</p>' +
      '<p class="quiz-result-growth"><strong>Точка роста:</strong> ' + escapeHtml(overall.growth) + '</p>' +
      '<p class="quiz-result-task"><strong>Задача уровня:</strong> ' + escapeHtml(overall.task) + '</p>' +
      '<h2 class="quiz-spheres-title">Результат по сферам</h2>' +
      '<div class="quiz-spheres-grid">' + result.spheres.map(sphereCardHtml).join('') + '</div>';

    if (result.allSpheresAdultPhrase) {
      html += '<p class="quiz-adult-phrase">' + escapeHtml(result.allSpheresAdultPhrase) + '</p>';
    }

    html += '' +
      '<p class="quiz-disclaimer-full">' + escapeHtml(result.disclaimer) + '</p>' +
      '<button type="button" class="btn btn-gold btn-lg btn-block" id="quizCtaBtn">Записаться на диагностику</button>';

    els.resultScreen.innerHTML = html;

    var ctaBtn = q('quizCtaBtn');
    if (ctaBtn) {
      ctaBtn.addEventListener('click', function () {
        window.location.href = '/?openConsult=1';
      });
    }

    clearDraft();
    showOnly(els.resultScreen);
  }

  function handleContactSubmit(event) {
    event.preventDefault();
    if (els.showResultBtn.disabled) return;

    els.showResultBtn.disabled = true;
    els.showResultBtn.textContent = 'Считаем результат…';

    submitQuiz(answersBySphereFromPositions())
      .then(renderResult)
      .catch(function () {
        els.showResultBtn.disabled = false;
        els.showResultBtn.textContent = 'Показать результат';
        alert('Не удалось посчитать результат. Попробуйте ещё раз.');
      });
  }

  function restoreDraftIfAny() {
    var draft = loadDraft();
    if (!draft) return false;
    if (draft.positions.length !== flatQuestions.length) return false;

    positions = draft.positions;
    currentIndex = Math.min(draft.currentIndex || 0, flatQuestions.length - 1);
    return true;
  }

  function init() {
    cacheEls();

    els.startBtn.addEventListener('click', function () {
      renderQuestion();
    });
    els.backBtn.addEventListener('click', goBack);
    els.nextBtn.addEventListener('click', goNext);
    els.contactForm.addEventListener('submit', handleContactSubmit);
    els.nameInput.addEventListener('input', updateShowResultBtnState);
    els.contactInput.addEventListener('input', updateShowResultBtnState);
    els.consentCheckbox.addEventListener('change', updateShowResultBtnState);

    fetchQuiz()
      .then(function (quiz) {
        quizData = quiz;
        flatQuestions = buildFlatQuestions(quiz);
        positions = new Array(flatQuestions.length).fill(null);

        var resumed = restoreDraftIfAny();
        if (resumed) {
          renderQuestion();
        } else {
          renderIntro();
        }
      })
      .catch(function () {
        showOnly(els.error);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
