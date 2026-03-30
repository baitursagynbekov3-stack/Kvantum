(function (root, factory) {
  var defaults = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = defaults;
  }

  if (root) {
    root.QUANTUM_DEFAULT_PROGRAMS = defaults;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  return [
    {
      name: 'Brain Charge',
      name_ru: 'Зарядка мозга',
      tagline: 'Reality Reprogramming',
      tagline_ru: 'Перепрограммирование реальности',
      tier: 'entry',
      tierLabel: 'Entry Point',
      tierLabel_ru: 'Точка входа',
      cssClass: '',
      popular: false,
      priceAmount: '1 000',
      priceAmount_ru: '1 000',
      priceCurrency: 'KGS / month',
      priceCurrency_ru: 'сом / мес',
      priceNumeric: 1000,
      purchaseCurrency: 'KGS',
      features: [
        '21-day program',
        '15 minutes per day',
        'Sessions at 6:00 AM Kyrgyzstan time',
        'Work with thoughts and feelings',
        'State transformation techniques',
        'Changes in life, relationships, and finances'
      ],
      features_ru: [
        'Программа 21 день',
        '15 минут в день',
        'Сессии в 6:00 утра (КР)',
        'Работа с мыслями и чувствами',
        'Трансформация состояния',
        'Изменения в жизни, отношениях и финансах'
      ],
      buttonText: 'Start',
      buttonText_ru: 'Начать',
      detailsPrimaryAction: true,
      detailsButton: 'Learn More',
      detailsButton_ru: 'Узнать подробнее',
      detailsText: 'Brain Charge is a daily practice that rewires your thinking, removes inner blocks, and launches new results in money, state, and life. You begin to think differently, and your reality starts to change.',
      detailsText_ru: 'Зарядка мозга — это ежедневная практика, которая перепрошивает мышление, убирает внутренние блоки и запускает новые результаты в деньгах, состоянии и жизни. Ты начинаешь думать по-другому — и твоя реальность начинает меняться.',
      detailsVideos: [
        {
          title: 'Main transformation story',
          subtitle: 'Video review · Coming soon',
          src: '/videos/brain-charge-main.mp4',
          poster: '/images/review-3-poster.jpg',
          isPrimary: true
        },
        {
          title: 'Daily practice result',
          subtitle: 'Video review · Coming soon',
          src: '/videos/brain-charge-extra-1.mp4',
          poster: '',
          isPrimary: false
        },
        {
          title: 'Shift in state and focus',
          subtitle: 'Video review · Coming soon',
          src: '/videos/brain-charge-extra-2.mp4',
          poster: '',
          isPrimary: false
        }
      ],
      detailsVideos_ru: [
        {
          title: 'Главная история трансформации',
          subtitle: 'Видео отзыв · скоро здесь',
          src: '/videos/brain-charge-main.mp4',
          poster: '/images/review-3-poster.jpg',
          isPrimary: true
        },
        {
          title: 'Результат ежедневной практики',
          subtitle: 'Видео отзыв · скоро здесь',
          src: '/videos/brain-charge-extra-1.mp4',
          poster: '',
          isPrimary: false
        },
        {
          title: 'Сдвиг в состоянии и фокусе',
          subtitle: 'Видео отзыв · скоро здесь',
          src: '/videos/brain-charge-extra-2.mp4',
          poster: '',
          isPrimary: false
        }
      ],
      detailsReviews: [
        {
          text: 'By the first week I felt calmer, more focused, and stopped reacting to everything emotionally.',
          author: 'Aigerim',
          role: 'Program participant'
        },
        {
          text: 'The practice helped me make faster decisions and finally move from thoughts to real action.',
          author: 'Elvira',
          role: 'Entrepreneur'
        },
        {
          text: 'I got my inner support back. Less chaos inside, more confidence, energy, and results.',
          author: 'Meerim',
          role: 'KVANTUM client'
        }
      ],
      detailsReviews_ru: [
        {
          text: 'Уже в первую неделю я стала спокойнее, собраннее и перестала так остро реагировать на всё вокруг.',
          author: 'Айгерим',
          role: 'Участница программы'
        },
        {
          text: 'Практика помогла быстрее принимать решения и перейти из постоянных мыслей в реальные действия.',
          author: 'Эльвира',
          role: 'Предприниматель'
        },
        {
          text: 'Я вернула внутреннюю опору. Внутри стало меньше хаоса, а снаружи — больше уверенности, энергии и результатов.',
          author: 'Мээрим',
          role: 'Клиент KVANTUM'
        }
      ],
      actionType: 'purchase',
      order: 1
    },
    {
      name: 'Diagnostic',
      name_ru: 'Диагностика',
      tagline: 'State Enhancement',
      tagline_ru: 'Усиление состояния',
      tier: 'standard',
      tierLabel: '',
      tierLabel_ru: '',
      cssClass: '',
      popular: false,
      priceAmount: '5 000',
      priceAmount_ru: '5 000',
      priceCurrency: 'KGS / month',
      priceCurrency_ru: 'сом / месяц',
      priceNumeric: 5000,
      purchaseCurrency: 'KGS',
      features: [
        '4-week program',
        '2 sessions with Altynai',
        '2 sessions with a curator',
        'Confidence and inner security',
        'Self-worth and self-love',
        'Freedom and inner foundation'
      ],
      features_ru: [
        'Программа 4 недели',
        '2 встречи с Алтынай',
        '2 встречи с куратором',
        'Защищённость и уверенность',
        'Ценность и любовь к себе',
        'Свобода и внутренняя опора'
      ],
      buttonText: 'Join the Club',
      buttonText_ru: 'Вступить в клуб',
      actionType: 'purchase',
      order: 3
    },
    {
      name: 'Intensive "Mom & Dad"',
      name_ru: 'Интенсив «Папа, Мама»',
      tagline: 'Root Cause Work',
      tagline_ru: 'Проработка корней',
      tier: 'popular',
      tierLabel: 'Popular',
      tierLabel_ru: 'Популярная',
      cssClass: 'popular',
      popular: true,
      priceAmount: '$300',
      priceAmount_ru: '$300',
      priceCurrency: '',
      priceCurrency_ru: '',
      priceNumeric: 300,
      purchaseCurrency: 'USD',
      features: [
        '1 month, 10 lessons',
        '20 practical exercises',
        '3 Zoom sessions',
        'Separation and independence',
        'Release from inherited scenarios',
        'Restoring family hierarchy',
        'Removing childhood blocks'
      ],
      features_ru: [
        '1 месяц, 10 уроков',
        '20 практических упражнений',
        '3 Zoom встречи',
        'Сепарация и независимость',
        'Выход из чужих сценариев',
        'Восстановление иерархии',
        'Снятие детских блоков'
      ],
      buttonText: 'Sign Up',
      buttonText_ru: 'Записаться',
      detailsPrimaryAction: true,
      detailsText: 'Intensive "Mom & Dad — My Two Wings" is a deep transformational program where you work through ancestral patterns, remove inner blocks, and reclaim your energy. You build inner support, heal deficits of love and acceptance, and start shaping relationships, money, and your life from a state of strength rather than lack.',
      detailsText_ru: 'Интенсив «Папа, мама — мои два крыла» — это глубокая трансформационная программа, где ты прорабатываешь родовые сценарии, убираешь внутренние блоки и возвращаешь свою энергию. Ты выстраиваешь внутреннюю опору, закрываешь дефициты любви и принятия, и начинаешь по-другому строить отношения, деньги и свою жизнь — из состояния силы, а не нехватки.',
      detailsVideos: [
        {
          title: 'Main transformation story',
          subtitle: 'Video review',
          src: '/videos/mom-dad-main.mp4',
          poster: '',
          isPrimary: true
        },
        {
          title: 'Shift in relationships and support',
          subtitle: 'Video review',
          src: '/videos/mom-dad-extra-1.mp4',
          poster: '',
          isPrimary: false
        },
        {
          title: 'Inner strength and acceptance',
          subtitle: 'Video review',
          src: '/videos/mom-dad-extra-2.mp4',
          poster: '',
          isPrimary: false
        }
      ],
      detailsVideos_ru: [
        {
          title: 'Главная история трансформации',
          subtitle: 'Видео отзыв',
          src: '/videos/mom-dad-main.mp4',
          poster: '',
          isPrimary: true
        },
        {
          title: 'Сдвиг в отношениях и опоре',
          subtitle: 'Видео отзыв',
          src: '/videos/mom-dad-extra-1.mp4',
          poster: '',
          isPrimary: false
        },
        {
          title: 'Внутренняя сила и принятие',
          subtitle: 'Видео отзыв',
          src: '/videos/mom-dad-extra-2.mp4',
          poster: '',
          isPrimary: false
        }
      ],
      actionType: 'purchase',
      order: 4
    },
    {
      name: 'REBOOT',
      name_ru: 'REBOOT',
      tagline: 'Conscious Reality Management',
      tagline_ru: 'Осознанное управление реальностью',
      tier: 'premium',
      tierLabel: 'Premium',
      tierLabel_ru: 'Премиум',
      cssClass: '',
      popular: false,
      priceAmount: '$1,000',
      priceAmount_ru: '$1,000',
      priceCurrency: '',
      priceCurrency_ru: '',
      priceNumeric: 1000,
      purchaseCurrency: 'USD',
      features: [
        '8 weeks, 24 sessions',
        '20 lessons and 20 practices',
        '1 session with Altynai',
        '2 sessions with curators',
        'Values and personal principles',
        'State management',
        'Relationships without dependency',
        'Financial control'
      ],
      features_ru: [
        '8 недель, 24 встречи',
        '20 уроков и 20 практик',
        '1 встреча с Алтынай',
        '2 встречи с кураторами',
        'Ценности и личные принципы',
        'Управление состоянием',
        'Отношения без зависимости',
        'Финансы под вашим контролем'
      ],
      buttonText: 'Transform',
      buttonText_ru: 'Трансформироваться',
      detailsPrimaryAction: true,
      detailsText: 'REBOOT — REALITY REPROGRAMMING is a systemic transformational program where you rewire your thinking, remove limiting beliefs, and step out of old scenarios. You build inner support, shift your state, and start making decisions that drive growth in money, relationships, and self-realization. This is not about motivation — it is about real change at the level of thinking, emotions, and action.',
      detailsText_ru: 'Перезагрузка — ПЕРЕПРОГРАММИРОВАНИЕ РЕАЛЬНОСТИ — это системная трансформационная программа, где ты перепрошиваешь мышление, убираешь ограничивающие установки и выходишь из старых сценариев. Ты выстраиваешь внутреннюю опору, меняешь состояние и начинаешь принимать решения, которые приводят к росту в деньгах, отношениях и реализации. Это не про мотивацию — это про реальные изменения на уровне мышления, эмоций и действий.',
      detailsVideos: [
        {
          title: 'Main transformation story',
          subtitle: 'Video review',
          src: '/videos/reboot-main.mp4',
          poster: '',
          isPrimary: true
        },
        {
          title: 'Shift in decisions and money',
          subtitle: 'Video review',
          src: '/videos/reboot-extra-1.mp4',
          poster: '',
          isPrimary: false
        },
        {
          title: 'Change in state and realization',
          subtitle: 'Video review',
          src: '/videos/reboot-extra-2.mp4',
          poster: '',
          isPrimary: false
        }
      ],
      detailsVideos_ru: [
        {
          title: 'Главная история трансформации',
          subtitle: 'Видео отзыв',
          src: '/videos/reboot-main.mp4',
          poster: '',
          isPrimary: true
        },
        {
          title: 'Сдвиг в решениях и деньгах',
          subtitle: 'Видео отзыв',
          src: '/videos/reboot-extra-1.mp4',
          poster: '',
          isPrimary: false
        },
        {
          title: 'Изменение состояния и реализации',
          subtitle: 'Видео отзыв',
          src: '/videos/reboot-extra-2.mp4',
          poster: '',
          isPrimary: false
        }
      ],
      detailsReviews: [
        {
          text: 'I felt lightness, enjoyment, and even euphoria. Thank you, Altynai.',
          author: 'Amina',
          role: 'Program participant'
        },
        {
          text: 'I realized there are things more valuable than money, things that money cannot buy.',
          author: 'Sofia',
          role: 'Reboot'
        },
        {
          text: 'I understood again that the true value is me and my life. When we allow ourselves to have what we really want, we receive it.',
          author: 'Leila',
          role: 'Transformation student'
        }
      ],
      detailsReviews_ru: [
        {
          text: 'Здравствуйте всем. У меня появилась легкость, наслаждение, эйфория. Благодарю вас, Алтынай.',
          author: 'Амина',
          role: 'Участница программы'
        },
        {
          text: 'Доброе утро. Я осознала, что есть вещи, которые дороже, чем деньги, и которые не покупаются деньгами.',
          author: 'София',
          role: 'Перезагрузка'
        },
        {
          text: 'Алтынай, благодарю за танец и за практику. Я еще раз поняла, что ценность — это я и моя жизнь, а остальное вторично. Если мы разрешим себе иметь то, что хотим, то мы это получим. Спасибо за бесценные знания.',
          author: 'Лейла',
          role: 'Участница трансформации'
        }
      ],
      actionType: 'purchase',
      order: 2
    },
    {
      name: 'Mentorship',
      name_ru: 'Наставничество',
      tagline: 'University of Self-Knowledge',
      tagline_ru: 'Университет в самопознании',
      tier: 'elite',
      tierLabel: 'Elite',
      tierLabel_ru: 'Элитная',
      cssClass: '',
      popular: false,
      priceAmount: 'Contact us',
      priceAmount_ru: 'Уточните',
      priceCurrency: 'our managers',
      priceCurrency_ru: 'у менеджеров',
      priceNumeric: 0,
      purchaseCurrency: 'KGS',
      features: [
        'Field reading',
        'Emotions and subconscious blocks',
        'Quantum field work',
        '30 NLP practices',
        'Constellation basics',
        'Live practice with curators',
        'Full knowledge transfer'
      ],
      features_ru: [
        'Считывание поля',
        'Эмоции и блоки подсознания',
        'Работа с квантовым полем',
        '30 практик НЛП',
        'Основы расстановок',
        'Живая практика с кураторами',
        'Полная передача знаний'
      ],
      buttonText: 'Learn More',
      buttonText_ru: 'Узнать подробнее',
      actionType: 'consult',
      order: 5
    }
  ];
});
