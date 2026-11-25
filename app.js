import { FALLBACK_QUESTIONS } from './questions-bank.js';

/* =========================================================================
   CONFIG & CONSTANTS
   ========================================================================= */
const DEFAULT_GEMINI_KEY = '';
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemma-4-26b-a4b-it', 'gemini-4-hydrogen'];
const QUESTION_DURATION_MS = 10000; // مهلة السؤال الكلية 10 ثوانٍ بالضبط
const CIRCUMFERENCE = 2 * Math.PI * 43; // r=43 -> ~270.17

const BROKERS = [
  { id: 'emqx', prefixDigits: '12345678', url: 'wss://broker.emqx.io:8084/mqtt' },
  { id: 'hivemq', prefixDigits: '9', url: 'wss://broker.hivemq.com:8884/mqtt' }
];

const AVATARS = ['👑', '🦁', '🦅', '🚀', '⚡', '🧠', '🎯', '🌟', '💎', '🔥', '🐯', '🛡️'];

const SOLO_PRIZES = [
  '100', '200', '300', '500', '1,000',
  '2,000', '4,000', '8,000', '16,000', '32,000',
  '64,000', '125,000', '250,000', '500,000', '1,000,000'
];

const ALL_CATEGORIES = ['تاريخ', 'جغرافيا', 'إسلامي', 'رياضة', 'معلومات عامة', 'ذكاء IQ'];

const SUBTOPIC_SEEDS = [
  'حضارات قديمة وعواصم منسية وألغاز رقمية ذكية',
  'سيرة نبوية وصحابة وغزوات وتاريخ أندلسي وعباسي',
  'كأس العالم وأبطال الأولمبياد وجغرافيا المضائق والأنهار',
  'الفضاء والفيزياء والطب واختراعات العلماء المسلمين والعالم',
  'ألغاز سرعة بديهة ومتتاليات رياضية قصيرة وثقافة عامة عالمية',
  'عجائب الطبيعة والجزر والقارات وأحداث القرن العشرين الكبرى',
  'القرآن الكريم وعلومه واللغة العربية وأسئلة ذكاء منطقي سريع'
];

/* =========================================================================
   WEB AUDIO SYNTHESIZER (Millionaire Studio Sound Effects)
   ========================================================================= */
class StudioAudio {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('mm_muted') === '1';
  }

  ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  tone(freq, dur = 0.15, type = 'sine', vol = 0.12, delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  playIntro() {
    [261.6, 329.6, 392.0, 523.2].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.13, i * 0.09));
  }

  playQuestionReveal() {
    this.tone(220, 0.22, 'triangle', 0.12, 0);
    this.tone(330, 0.28, 'triangle', 0.12, 0.08);
    this.tone(440, 0.35, 'sine', 0.11, 0.16);
  }

  playTick(secondsLeft) {
    const urgent = secondsLeft <= 3;
    this.tone(urgent ? 880 : 560, urgent ? 0.09 : 0.055, urgent ? 'square' : 'sine', urgent ? 0.08 : 0.045);
  }

  playCorrect() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.26, 'triangle', 0.15, i * 0.075));
  }

  playWrong() {
    this.tone(185, 0.26, 'sawtooth', 0.14, 0);
    this.tone(138, 0.38, 'sawtooth', 0.15, 0.14);
  }

  playTimeout() {
    this.tone(310, 0.22, 'triangle', 0.12, 0);
    this.tone(233, 0.38, 'triangle', 0.13, 0.15);
  }
}

const sfx = new StudioAudio();

/* =========================================================================
   SEEN QUESTIONS MEMORY & SHUFFLING HELPERS
   ========================================================================= */
function getApiKey() {
  return (localStorage.getItem('mm_gemini_key') || DEFAULT_GEMINI_KEY).trim();
}

function getSeenQuestions() {
  try {
    return JSON.parse(localStorage.getItem('mm_seen_q_v1') || '[]');
  } catch {
    return [];
  }
}

function markQuestionSeen(qText) {
  if (!qText) return;
  const norm = qText.trim().slice(0, 90);
  const seen = getSeenQuestions().filter((x) => x !== norm);
  seen.push(norm);
  while (seen.length > 140) seen.shift();
  localStorage.setItem('mm_seen_q_v1', JSON.stringify(seen));
}

function normalizeAndShuffleQuestion(raw, source = 'ai') {
  if (!raw || typeof raw.q !== 'string' || !Array.isArray(raw.options) || raw.options.length < 4) {
    return null;
  }
  const cleanOpts = raw.options.slice(0, 4).map((o) => String(o).trim());
  let ansIdx = Number(raw.answer);
  if (!Number.isInteger(ansIdx) || ansIdx < 0 || ansIdx > 3) ansIdx = 0;
  if (cleanOpts.some((o) => !o)) return null;

  // Shuffle options so correct choice is uniformly distributed across أ / ب / ج / د
  const tagged = cleanOpts.map((text, idx) => ({ text, isCorrect: idx === ansIdx }));
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  const newAnswer = tagged.findIndex((t) => t.isCorrect);
  return {
    qId: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    category: (raw.category || 'معلومات عامة').trim(),
    q: raw.q.trim(),
    options: tagged.map((t) => t.text),
    answer: newAnswer,
    source
  };
}

function generateDynamicIQQuestion() {
  const type = Math.floor(Math.random() * 3);
  if (type === 0) {
    // Arithmetic progression with increasing step: a, a+d, a+3d, a+6d, a+10d
    const start = Math.floor(2 + Math.random() * 9);
    const step = Math.floor(2 + Math.random() * 4);
    const seq = [start];
    for (let i = 1; i <= 5; i++) seq.push(seq[i - 1] + i * step);
    const ans = seq.pop();
    const opts = [String(ans), String(ans + step), String(ans - step), String(ans + step * 2)];
    return { category: 'ذكاء IQ', q: `أكمل المتتالية الذهنية: ${seq.join(' ، ')} ، ... ؟`, options: opts, answer: 0 };
  }
  if (type === 1) {
    // x * a + b = target
    const x = Math.floor(4 + Math.random() * 9);
    const a = Math.floor(3 + Math.random() * 5);
    const b = Math.floor(4 + Math.random() * 12);
    const target = x * a + b;
    const opts = [String(x), String(x + 1), String(x - 1), String(x + 2)];
    return { category: 'ذكاء IQ', q: `ما العدد الذي إذا ضربته في ${a} ثم أضفتَ إليه ${b} كان الناتج ${target}؟`, options: opts, answer: 0 };
  }
  // Geometric + offset: n -> 2n + 1
  const s = Math.floor(2 + Math.random() * 5);
  const seq = [s, s * 2 + 1, (s * 2 + 1) * 2 + 1, ((s * 2 + 1) * 2 + 1) * 2 + 1];
  const ans = seq[3] * 2 + 1;
  const opts = [String(ans), String(ans - 2), String(ans + 2), String(ans + 4)];
  return { category: 'ذكاء IQ', q: `ما الرقم التالي في النمط: ${seq.join(' ، ')} ، ... ؟`, options: opts, answer: 0 };
}

/* =========================================================================
   AI DYNAMIC QUESTION GENERATOR (Interactions API v1)
   ========================================================================= */
class AIQuestionGenerator {
  constructor() {
    this.queue = [];
    this.isFetching = false;
  }

  clearQueue() {
    this.queue = [];
  }

  async fetchBatchFromGemini(categories = ALL_CATEGORIES, count = 8) {
    const key = getApiKey();
    if (!key) throw new Error('Missing API key');

    const cats = categories.length ? categories : ALL_CATEGORIES;
    const recentSeen = getSeenQuestions().slice(-30);
    const seedTheme = SUBTOPIC_SEEDS[Math.floor(Math.random() * SUBTOPIC_SEEDS.length)];
    const randomSalt = Math.floor(100000 + Math.random() * 900000);

    const prompt = [
      `أنت معدّ أسئلة محترف لبرنامج المسابقات الشهير «من سيربح المليون».`,
      `أنشئ ${count} أسئلة ثقافية جديدة ومبتكرة ومتنوعة باللغة العربية الفصحى السليمة والواضحة.`,
      `وزّع الأسئلة بالتساوي قدر الإمكان على التصنيفات التالية: (${cats.join('، ')}).`,
      `موجه التنوع العشوائي لهذه الدفعة (#${randomSalt}): ركّز على زوايا مشوقة تشمل ${seedTheme}.`,
      `شروط صارمة جداً:`,
      `1. مدة الإجابة في اللعبة 10 ثوانٍ فقط؛ لذلك اجعل نص السؤال واضحاً ومختصراً ومباشراً (أقل من 18 كلمة)، وبما فيها أسئلة ذكاء IQ اجعلها ألغازاً سريعة البديهة ومتتاليات قصيرة تُحل ذهنياً في ثوانٍ.`,
      `2. كل سؤال له 4 خيارات مختلفة تماماً (بدون ترقيم أ/ب/ج/د داخل النص)، وإجابة صحيحة واحدة مؤكدة علمياً وتاريخياً بنسبة 100%.`,
      `3. الحقل answer هو رقم الفهرس الصحيح (0 أو 1 أو 2 أو 3).`,
      recentSeen.length ? `4. لا تكرر نهائياً أياً من هذه الأسئلة السابقة:\n- ${recentSeen.join('\n- ')}` : ''
    ].filter(Boolean).join('\n');

    const schema = {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              category: { type: 'string' },
              q: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              answer: { type: 'integer' }
            },
            required: ['category', 'q', 'options', 'answer']
          }
        }
      },
      required: ['questions']
    };

    let lastErr = null;
    for (const model of GEMINI_MODELS) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 14000);

        const bodyObj = {
          model,
          input: prompt,
          store: false
        };
        // Structured JSON schema supported natively on Interactions v1
        if (!model.startsWith('gemma-')) {
          bodyObj.response_format = {
            type: 'text',
            mime_type: 'application/json',
            schema
          };
        } else {
          bodyObj.input += '\nأجب بصيغة JSON فقط بهذا الشكل: {"questions":[{"category":"...","q":"...","options":["1","2","3","4"],"answer":0}]}';
        }

        const resp = await fetch(`https://generativelanguage.googleapis.com/v1/interactions?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj),
          signal: controller.signal
        });
        clearTimeout(timer);

        if (!resp.ok) {
          const errTxt = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${errTxt.slice(0, 140)}`);
        }

        const data = await resp.json();
        let rawText = '';
        if (typeof data.output_text === 'string') {
          rawText = data.output_text;
        } else if (Array.isArray(data.steps)) {
          for (const st of data.steps) {
            if (st.type === 'model_output' && Array.isArray(st.content)) {
              for (const part of st.content) {
                if (part.type === 'text' && part.text) rawText += part.text;
              }
            }
          }
        }

        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON object in output');
        const parsed = JSON.parse(jsonMatch[0]);
        const list = Array.isArray(parsed.questions) ? parsed.questions : [];
        const seenSet = new Set(getSeenQuestions());
        const valid = [];
        for (const item of list) {
          const normQ = normalizeAndShuffleQuestion(item, 'ai');
          if (normQ && !seenSet.has(normQ.q.slice(0, 90))) {
            valid.push(normQ);
          }
        }
        if (valid.length > 0) {
          setAiStatusPill(true, model);
          return valid;
        }
      } catch (err) {
        lastErr = err;
      }
    }
    setAiStatusPill(false);
    throw lastErr || new Error('All AI models busy');
  }

  pullFallbackQuestion(categories = ALL_CATEGORIES) {
    const cats = new Set(categories.length ? categories : ALL_CATEGORIES);
    // 25% chance when IQ is enabled to synthesize a brand-new mental-math / sequence IQ puzzle for 10s play
    if (cats.has('ذكاء IQ') && Math.random() < 0.25) {
      const iqDynamic = generateDynamicIQQuestion();
      if (iqDynamic) return normalizeAndShuffleQuestion(iqDynamic, 'ai');
    }
    const seen = new Set(getSeenQuestions());
    let pool = FALLBACK_QUESTIONS.filter((q) => cats.has(q.category) && !seen.has(q.q.slice(0, 90)));
    if (!pool.length) {
      pool = FALLBACK_QUESTIONS.filter((q) => cats.has(q.category));
    }
    if (!pool.length) pool = FALLBACK_QUESTIONS;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return normalizeAndShuffleQuestion(pick, 'bank');
  }

  async ensureReady(categories = ALL_CATEGORIES, minInitial = 5) {
    if (!getApiKey()) return;
    if (this.queue.length >= minInitial) return;
    if (this.isFetching) return;
    this.isFetching = true;
    try {
      const fresh = await this.fetchBatchFromGemini(categories, 8);
      this.queue.push(...fresh);
    } catch (e) {
      console.warn('AI batch fallback triggered:', e.message);
    } finally {
      this.isFetching = false;
    }
  }

  async nextQuestion(categories = ALL_CATEGORIES) {
    if (this.queue.length === 0 && getApiKey()) {
      await this.ensureReady(categories, 1);
    }
    // Pre-fetch next batch silently in background when queue runs low
    if (getApiKey() && this.queue.length <= 4 && !this.isFetching) {
      this.isFetching = true;
      this.fetchBatchFromGemini(categories, 8)
        .then((fresh) => this.queue.push(...fresh))
        .catch(() => {})
        .finally(() => { this.isFetching = false; });
    }

    const q = this.queue.shift() || this.pullFallbackQuestion(categories);
    markQuestionSeen(q.q);
    updateSeenCountUI();
    return q;
  }
}

const aiEngine = new AIQuestionGenerator();

/* =========================================================================
   STATE & DOM REFERENCES
   ========================================================================= */
const myProfile = {
  id: sessionStorage.getItem('mm_pid') || ('p_' + Math.random().toString(36).slice(2, 10)),
  name: localStorage.getItem('mm_pname') || '',
  avatar: localStorage.getItem('mm_pavatar') || AVATARS[0]
};
sessionStorage.setItem('mm_pid', myProfile.id);

const $ = (id) => document.getElementById(id);

const views = {
  home: $('viewHome'),
  lobby: $('viewLobby'),
  game: $('viewGame'),
  results: $('viewResults')
};

function showView(name) {
  Object.entries(views).forEach(([k, el]) => el.classList.toggle('active', k === name));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function showToast(msg, duration = 2800) {
  const box = $('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, duration);
}

function spawnFloatingEmoji(emoji, label = '') {
  const wrap = $('floatingReactions');
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.style.left = `${12 + Math.random() * 76}%`;
  el.textContent = label ? `${emoji} ${label}` : emoji;
  if (label) el.style.fontSize = '1.15rem';
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

function setAiStatusPill(ok, modelName = '') {
  const pill = $('aiStatusPill');
  if (ok) {
    pill.textContent = `✨ أسئلة متجددة بالذكاء الاصطناعي (${modelName.replace('gemini-', 'Gemini ')})`;
    pill.style.color = '#6ee7b7';
  } else {
    pill.textContent = '✨ أسئلة متجددة ذكياً (وضع احتياطي سريع)';
    pill.style.color = '#fcd34d';
  }
}

function updateSeenCountUI() {
  const el = $('seenQuestionsCount');
  if (el) el.textContent = String(getSeenQuestions().length);
}

/* =========================================================================
   LOCAL UI COUNTDOWN (10 SECONDS)
   ========================================================================= */
let uiTimerInterval = null;
let lastTickSecond = -1;

function stopVisualTimer() {
  if (uiTimerInterval) {
    clearInterval(uiTimerInterval);
    uiTimerInterval = null;
  }
  $('timerOrbWrap').classList.remove('danger');
}

function startVisualTimer(durationMs = QUESTION_DURATION_MS, onLocalExpire = null) {
  stopVisualTimer();
  const startTs = performance.now();
  lastTickSecond = Math.ceil(durationMs / 1000);

  const circle = $('timerCircle');
  const numEl = $('timerNumber');
  const barEl = $('timeBarFill');
  const wrapEl = $('timerOrbWrap');

  const update = () => {
    const elapsed = performance.now() - startTs;
    const remainMs = Math.max(0, durationMs - elapsed);
    const ratio = remainMs / durationMs;
    const secCeil = Math.ceil(remainMs / 1000);

    numEl.textContent = String(secCeil);
    circle.style.strokeDashoffset = String(CIRCUMFERENCE * (1 - ratio));
    barEl.style.transform = `scaleX(${ratio})`;

    if (secCeil <= 3 && remainMs > 0) {
      wrapEl.classList.add('danger');
    } else {
      wrapEl.classList.remove('danger');
    }

    if (secCeil !== lastTickSecond && secCeil > 0 && secCeil <= 9) {
      lastTickSecond = secCeil;
      sfx.playTick(secCeil);
    }

    if (remainMs <= 0) {
      stopVisualTimer();
      if (typeof onLocalExpire === 'function') onLocalExpire();
    }
  };

  update();
  uiTimerInterval = setInterval(update, 50);
}

/* =========================================================================
   GAME & MULTIPLAYER ENGINE
   ========================================================================= */
const gameState = {
  mode: null, // 'multi' | 'solo'
  isHost: false,
  roomCode: '',
  mqttClient: null,
  heartbeatTimer: null,
  hostRoundTimeout: null,
  hostNextRoundTimeout: null,

  settings: {
    totalRounds: 15,
    categories: [...ALL_CATEGORIES]
  },

  // Map of playerId -> { id, name, avatar, score, isHost, lastSeen }
  players: {},

  // Current active question round
  currentRound: null,
  myAnsweredRoundId: null,
  myChoiceIndex: null,

  // Solo mode state
  soloIndex: 0,
  soloLifelines: { fifty: false, audience: false, friend: false, switchQ: false }
};

function getSelectedProfile() {
  const rawName = $('inputPlayerName').value.trim();
  myProfile.name = rawName || `متسابق ${Math.floor(100 + Math.random() * 899)}`;
  localStorage.setItem('mm_pname', myProfile.name);
  localStorage.setItem('mm_pavatar', myProfile.avatar);
  return myProfile;
}

function topicBase(code) {
  return `mm-ar-2026-v1/room/${code}`;
}

function selectBrokerForCode(code, preferIndex = 0) {
  if (code && code.startsWith('9')) return BROKERS[1];
  return BROKERS[preferIndex] || BROKERS[0];
}

function connectMqttClient(brokerUrl, willTopic, willPayload) {
  return new Promise((resolve, reject) => {
    if (!window.mqtt) {
      reject(new Error('مكتبة الاتصال جاري تحميلها، حاول بعد لحظة'));
      return;
    }
    const client = window.mqtt.connect(brokerUrl, {
      clientId: `mm_${myProfile.id}_${Math.random().toString(36).slice(2, 6)}`,
      clean: true,
      connectTimeout: 7500,
      reconnectPeriod: 2000,
      will: willTopic
        ? { topic: willTopic, payload: JSON.stringify(willPayload), qos: 1, retain: false }
        : undefined
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { client.end(true); } catch {}
        reject(new Error('انتهت مهلة الاتصال بالخادم'));
      }
    }, 8000);

    client.once('connect', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(client);
      }
    });

    client.once('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        try { client.end(true); } catch {}
        reject(err);
      }
    });
  });
}

function cleanupRoomSession() {
  stopVisualTimer();
  if (gameState.heartbeatTimer) clearInterval(gameState.heartbeatTimer);
  if (gameState.hostRoundTimeout) clearTimeout(gameState.hostRoundTimeout);
  if (gameState.hostNextRoundTimeout) clearTimeout(gameState.hostNextRoundTimeout);
  gameState.heartbeatTimer = null;
  gameState.hostRoundTimeout = null;
  gameState.hostNextRoundTimeout = null;

  if (gameState.mqttClient) {
    try {
      const base = topicBase(gameState.roomCode);
      if (gameState.isHost) {
        // Clear retained room state and notify guests
        gameState.mqttClient.publish(`${base}/state`, '', { qos: 1, retain: true });
        gameState.mqttClient.publish(`${base}/evt`, JSON.stringify({ type: 'HOST_CLOSED' }), { qos: 1 });
      } else {
        gameState.mqttClient.publish(`${base}/cmd`, JSON.stringify({ type: 'LEAVE', playerId: myProfile.id }), { qos: 1 });
      }
      setTimeout(() => {
        try { gameState.mqttClient.end(true); } catch {}
        gameState.mqttClient = null;
      }, 180);
    } catch {
      gameState.mqttClient = null;
    }
  }
  gameState.currentRound = null;
  gameState.players = {};
}

/* =========================================================================
   CREATE & JOIN MULTIPLAYER ROOMS
   ========================================================================= */
async function createMultiplayerRoom() {
  sfx.ensure();
  getSelectedProfile();
  cleanupRoomSession();

  gameState.mode = 'multi';
  gameState.isHost = true;

  // Try primary broker (EMQX -> prefix 1..8), fallback to HiveMQ (prefix 9)
  let client = null;
  let code = '';
  for (let i = 0; i < BROKERS.length; i++) {
    const broker = BROKERS[i];
    const firstDigit = broker.prefixDigits[Math.floor(Math.random() * broker.prefixDigits.length)];
    const restDigits = String(Math.floor(1000 + Math.random() * 9000));
    code = firstDigit + restDigits;
    try {
      setLobbyBadge(true, '🔄 جاري فتح الغرفة...');
      showView('lobby');
      $('displayRoomCode').textContent = code;
      client = await connectMqttClient(
        broker.url,
        `${topicBase(code)}/evt`,
        { type: 'HOST_CLOSED' }
      );
      break;
    } catch (e) {
      console.warn('Broker fallback:', broker.id, e.message);
    }
  }

  if (!client) {
    showView('home');
    showToast('⚠️ تعذر الاتصال بخادم الغرف، تحقق من اتصال الإنترنت');
    return;
  }

  gameState.roomCode = code;
  gameState.mqttClient = client;
  gameState.players = {
    [myProfile.id]: {
      id: myProfile.id,
      name: myProfile.name,
      avatar: myProfile.avatar,
      score: 0,
      isHost: true,
      lastSeen: Date.now()
    }
  };

  setupRoomSubscriptions();
  publishHostRoomState('lobby');
  updateLobbyUI();
  setLobbyBadge(false, '🟢 الغرفة متصلة وجاهزة لأي شبكة');
  sfx.playIntro();

  // Warm up AI question batch immediately while waiting in lobby!
  aiEngine.clearQueue();
  aiEngine.ensureReady(gameState.settings.categories, 6);

  startRoomHeartbeat();
}

async function joinMultiplayerRoom(rawCode) {
  sfx.ensure();
  const code = String(rawCode || '').replace(/\s+/g, '').trim();
  if (code.length < 4) {
    showToast('⚠️ يرجى إدخال كود الغرفة الصحيح (5 أرقام)');
    return;
  }

  getSelectedProfile();
  cleanupRoomSession();

  gameState.mode = 'multi';
  gameState.isHost = false;
  gameState.roomCode = code;

  const broker = selectBrokerForCode(code);
  showView('lobby');
  $('displayRoomCode').textContent = code;
  setLobbyBadge(true, '🔄 جاري البحث عن الغرفة...');
  updateLobbyUI();

  let client;
  try {
    client = await connectMqttClient(
      broker.url,
      `${topicBase(code)}/cmd`,
      { type: 'LEAVE', playerId: myProfile.id }
    );
  } catch {
    showView('home');
    showToast('⚠️ تعذر الاتصال بالشبكة، حاول مرة أخرى');
    return;
  }

  gameState.mqttClient = client;
  let roomFound = false;

  client.on('message', (topic, buf) => {
    const str = buf.toString();
    if (!str) return;
    let msg;
    try { msg = JSON.parse(str); } catch { return; }

    if (topic.endsWith('/state')) {
      roomFound = true;
      handleGuestStateSync(msg);
    } else if (topic.endsWith('/evt')) {
      roomFound = true;
      handleRoomEvent(msg);
    }
  });

  const base = topicBase(code);
  client.subscribe([`${base}/state`, `${base}/evt`], { qos: 1 }, () => {
    // Announce JOIN to Host
    client.publish(`${base}/cmd`, JSON.stringify({
      type: 'JOIN',
      player: {
        id: myProfile.id,
        name: myProfile.name,
        avatar: myProfile.avatar
      }
    }), { qos: 1 });
  });

  // Verify room exists within 4.5s
  setTimeout(() => {
    if (!roomFound && gameState.mode === 'multi' && !gameState.isHost) {
      cleanupRoomSession();
      showView('home');
      showToast('❌ لم يتم العثور على غرفة نشطة بهذا الكود! تأكد من الكود.');
    }
  }, 4500);

  startRoomHeartbeat();
}

function setupRoomSubscriptions() {
  const client = gameState.mqttClient;
  const base = topicBase(gameState.roomCode);

  client.on('message', (topic, buf) => {
    const str = buf.toString();
    if (!str) return;
    let msg;
    try { msg = JSON.parse(str); } catch { return; }

    if (gameState.isHost && topic.endsWith('/cmd')) {
      handleHostIncomingCmd(msg);
    } else if (topic.endsWith('/evt')) {
      handleRoomEvent(msg);
    }
  });

  client.subscribe([`${base}/cmd`, `${base}/evt`], { qos: 1 });
}

function startRoomHeartbeat() {
  if (gameState.heartbeatTimer) clearInterval(gameState.heartbeatTimer);
  gameState.heartbeatTimer = setInterval(() => {
    if (!gameState.mqttClient || gameState.mode !== 'multi') return;
    const base = topicBase(gameState.roomCode);
    if (gameState.isHost) {
      gameState.players[myProfile.id].lastSeen = Date.now();
      // Prune disconnected guests (>16s silent)
      let changed = false;
      const now = Date.now();
      for (const pid of Object.keys(gameState.players)) {
        if (pid !== myProfile.id && now - (gameState.players[pid].lastSeen || now) > 16000) {
          delete gameState.players[pid];
          changed = true;
        }
      }
      if (changed) {
        publishHostRoomState(gameState.currentRound ? 'playing' : 'lobby');
        updateLobbyUI();
        renderLiveScoreboard();
        checkIfAllRemainingWrongAfterLeave();
      }
    } else {
      gameState.mqttClient.publish(`${base}/cmd`, JSON.stringify({
        type: 'HEARTBEAT',
        playerId: myProfile.id
      }), { qos: 0 });
    }
  }, 4500);
}

/* =========================================================================
   HOST AUTHORITATIVE LOGIC
   ========================================================================= */
function publishHostRoomState(status = 'lobby') {
  if (!gameState.isHost || !gameState.mqttClient) return;
  const payload = {
    status,
    roomCode: gameState.roomCode,
    hostId: myProfile.id,
    settings: gameState.settings,
    players: gameState.players,
    updatedAt: Date.now()
  };
  gameState.mqttClient.publish(
    `${topicBase(gameState.roomCode)}/state`,
    JSON.stringify(payload),
    { qos: 1, retain: true }
  );
}

function broadcastRoomEvent(evtObj) {
  if (!gameState.mqttClient) return;
  gameState.mqttClient.publish(
    `${topicBase(gameState.roomCode)}/evt`,
    JSON.stringify(evtObj),
    { qos: 1 }
  );
}

function handleHostIncomingCmd(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'JOIN' && msg.player?.id) {
    const p = msg.player;
    const existingScore = gameState.players[p.id]?.score ?? 0;
    gameState.players[p.id] = {
      id: p.id,
      name: String(p.name || 'متسابق').slice(0, 18),
      avatar: p.avatar || '🎯',
      score: existingScore,
      isHost: false,
      lastSeen: Date.now()
    };
    publishHostRoomState(gameState.currentRound ? 'playing' : 'lobby');
    updateLobbyUI();
    renderLiveScoreboard();
    showToast(`👋 انضم ${gameState.players[p.id].name} إلى الغرفة!`);

    // If game is already running, send current question snapshot so late joiner can play next/current!
    if (gameState.currentRound && !gameState.currentRound.resolved) {
      const r = gameState.currentRound;
      const remainMs = Math.max(1500, QUESTION_DURATION_MS - (Date.now() - r.startedAt));
      broadcastRoomEvent({
        type: 'LATE_SYNC',
        targetId: p.id,
        roundNum: r.roundNum,
        totalRounds: gameState.settings.totalRounds,
        qId: r.qId,
        category: r.category,
        q: r.q,
        options: r.options,
        source: r.source,
        remainMs,
        players: gameState.players
      });
    }
  } else if (msg.type === 'HEARTBEAT' && msg.playerId) {
    if (gameState.players[msg.playerId]) {
      gameState.players[msg.playerId].lastSeen = Date.now();
    }
  } else if (msg.type === 'LEAVE' && msg.playerId) {
    const name = gameState.players[msg.playerId]?.name;
    delete gameState.players[msg.playerId];
    publishHostRoomState(gameState.currentRound ? 'playing' : 'lobby');
    updateLobbyUI();
    renderLiveScoreboard();
    if (name) showToast(`🚪 غادر ${name} الغرفة`);
    checkIfAllRemainingWrongAfterLeave();
  } else if (msg.type === 'ANSWER') {
    processHostAnswer(msg.playerId, msg.qId, Number(msg.choiceIndex));
  } else if (msg.type === 'EMOJI' && msg.emoji) {
    broadcastRoomEvent({ type: 'EMOJI', emoji: msg.emoji, senderName: msg.senderName || '' });
  }
}

function getActivePlayerIds() {
  return Object.keys(gameState.players);
}

async function hostStartMatch() {
  if (!gameState.isHost) return;
  if (gameState.settings.categories.length === 0) {
    gameState.settings.categories = [...ALL_CATEGORIES];
  }

  // Reset all scores for new match
  Object.values(gameState.players).forEach((p) => { p.score = 0; });
  publishHostRoomState('playing');

  broadcastRoomEvent({
    type: 'MATCH_STARTING',
    players: gameState.players,
    settings: gameState.settings
  });

  await aiEngine.ensureReady(gameState.settings.categories, 3);
  hostLaunchQuestion(1);
}

async function hostLaunchQuestion(roundNum) {
  if (!gameState.isHost || gameState.mode !== 'multi') return;
  if (gameState.hostRoundTimeout) clearTimeout(gameState.hostRoundTimeout);
  if (gameState.hostNextRoundTimeout) clearTimeout(gameState.hostNextRoundTimeout);

  if (roundNum > gameState.settings.totalRounds) {
    publishHostRoomState('finished');
    broadcastRoomEvent({
      type: 'GAME_OVER',
      players: gameState.players
    });
    return;
  }

  const qObj = await aiEngine.nextQuestion(gameState.settings.categories);
  const activeRound = {
    roundNum,
    qId: qObj.qId,
    category: qObj.category,
    q: qObj.q,
    options: qObj.options,
    answer: qObj.answer,
    source: qObj.source,
    startedAt: Date.now(),
    resolved: false,
    answeredBy: {},   // playerId -> choiceIdx
    wrongPlayers: {}  // playerId -> choiceIdx
  };
  gameState.currentRound = activeRound;

  broadcastRoomEvent({
    type: 'QUESTION_START',
    roundNum,
    totalRounds: gameState.settings.totalRounds,
    qId: activeRound.qId,
    category: activeRound.category,
    q: activeRound.q,
    options: activeRound.options,
    source: activeRound.source,
    durationMs: QUESTION_DURATION_MS,
    players: gameState.players
  });

  // Authoritative 10s timer (+300ms network transit tolerance for 9.9s clicks)
  gameState.hostRoundTimeout = setTimeout(() => {
    if (!gameState.currentRound || gameState.currentRound.qId !== activeRound.qId || activeRound.resolved) return;
    activeRound.resolved = true;
    publishHostRoomState('playing');
    broadcastRoomEvent({
      type: 'ROUND_END',
      qId: activeRound.qId,
      reason: 'timeout',
      correctIndex: activeRound.answer,
      wrongPlayers: activeRound.wrongPlayers,
      players: gameState.players
    });
    gameState.hostNextRoundTimeout = setTimeout(() => hostLaunchQuestion(roundNum + 1), 2600);
  }, QUESTION_DURATION_MS + 300);
}

function processHostAnswer(playerId, qId, choiceIndex) {
  const r = gameState.currentRound;
  if (!r || r.resolved || r.qId !== qId) return;
  if (!gameState.players[playerId]) return;
  if (r.answeredBy[playerId] !== undefined) return; // Already answered this question

  r.answeredBy[playerId] = choiceIndex;

  if (choiceIndex === r.answer) {
    // FIRST CORRECT ANSWER WINS +1 POINT IMMEDIATELY!
    r.resolved = true;
    if (gameState.hostRoundTimeout) clearTimeout(gameState.hostRoundTimeout);

    gameState.players[playerId].score += 1;
    const elapsedSec = Math.min(10, Math.max(0.1, (Date.now() - r.startedAt) / 1000)).toFixed(1);

    publishHostRoomState('playing');
    broadcastRoomEvent({
      type: 'ROUND_END',
      qId: r.qId,
      reason: 'correct',
      winnerId: playerId,
      winnerName: gameState.players[playerId].name,
      winnerAvatar: gameState.players[playerId].avatar,
      elapsedSec,
      correctIndex: r.answer,
      wrongPlayers: r.wrongPlayers,
      players: gameState.players
    });

    gameState.hostNextRoundTimeout = setTimeout(() => hostLaunchQuestion(r.roundNum + 1), 3100);
  } else {
    // WRONG ANSWER: -1 POINT! Other players still get a chance!
    gameState.players[playerId].score -= 1;
    r.wrongPlayers[playerId] = choiceIndex;
    publishHostRoomState('playing');

    const activeIds = getActivePlayerIds();
    const allWrong = activeIds.every((pid) => r.wrongPlayers[pid] !== undefined);

    if (allWrong) {
      // ALL PLAYERS ANSWERED WRONG -> CHANGE QUESTION IMMEDIATELY!
      r.resolved = true;
      if (gameState.hostRoundTimeout) clearTimeout(gameState.hostRoundTimeout);

      broadcastRoomEvent({
        type: 'ROUND_END',
        qId: r.qId,
        reason: 'all_wrong',
        correctIndex: r.answer,
        wrongPlayers: r.wrongPlayers,
        players: gameState.players
      });

      gameState.hostNextRoundTimeout = setTimeout(() => hostLaunchQuestion(r.roundNum + 1), 2300);
    } else {
      // Announce wrong penalty (-1) without leaking which choice was wrong to remaining players!
      broadcastRoomEvent({
        type: 'PLAYER_WRONG',
        qId: r.qId,
        playerId,
        playerName: gameState.players[playerId].name,
        players: gameState.players
      });
    }
  }
}

function checkIfAllRemainingWrongAfterLeave() {
  if (!gameState.isHost || !gameState.currentRound || gameState.currentRound.resolved) return;
  const r = gameState.currentRound;
  const activeIds = getActivePlayerIds();
  if (activeIds.length > 0 && activeIds.every((pid) => r.wrongPlayers[pid] !== undefined)) {
    r.resolved = true;
    if (gameState.hostRoundTimeout) clearTimeout(gameState.hostRoundTimeout);
    broadcastRoomEvent({
      type: 'ROUND_END',
      qId: r.qId,
      reason: 'all_wrong',
      correctIndex: r.answer,
      wrongPlayers: r.wrongPlayers,
      players: gameState.players
    });
    gameState.hostNextRoundTimeout = setTimeout(() => hostLaunchQuestion(r.roundNum + 1), 2300);
  }
}

/* =========================================================================
   CLIENT / SHARED MULTIPLAYER EVENT HANDLERS
   ========================================================================= */
function handleGuestStateSync(state) {
  if (!state || !state.players) return;
  gameState.players = state.players;
  if (state.settings) gameState.settings = state.settings;
  setLobbyBadge(false, '🟢 متصل بالغرفة بنجاح');
  updateLobbyUI();
  renderLiveScoreboard();
}

function handleRoomEvent(evt) {
  if (!evt || !evt.type) return;

  if (evt.type === 'HOST_CLOSED') {
    if (!gameState.isHost) {
      cleanupRoomSession();
      showView('home');
      showToast('ℹ️ أغلق مضيف الغرفة الجلسة');
    }
    return;
  }

  if (evt.type === 'EMOJI') {
    spawnFloatingEmoji(evt.emoji, evt.senderName);
    return;
  }

  if (evt.type === 'RETURN_LOBBY') {
    if (evt.players) gameState.players = evt.players;
    stopVisualTimer();
    showView('lobby');
    updateLobbyUI();
    return;
  }

  if (evt.type === 'MATCH_STARTING') {
    if (evt.players) gameState.players = evt.players;
    if (evt.settings) gameState.settings = evt.settings;
    prepareGameStageUI('multi');
    setBanner('✨ جاري توليد أسئلة متجددة بالذكاء الاصطناعي...', '');
    $('questionText').textContent = 'استعد! الأسئلة قادمة خلال لحظات...';
    resetOptionButtons(true);
    sfx.playIntro();
    return;
  }

  if (evt.type === 'QUESTION_START' || (evt.type === 'LATE_SYNC' && evt.targetId === myProfile.id)) {
    if (evt.players) gameState.players = evt.players;
    prepareGameStageUI('multi');
    renderMultiplayerQuestion(evt, evt.remainMs || evt.durationMs || QUESTION_DURATION_MS);
    return;
  }

  if (evt.type === 'PLAYER_WRONG') {
    if (evt.players) gameState.players = evt.players;
    sfx.playWrong();
    renderLiveScoreboard({ wrongId: evt.playerId });

    if (evt.playerId === myProfile.id) {
      // Highlight my wrong choice red & keep locked
      if (gameState.myChoiceIndex !== null) {
        const btn = document.querySelector(`.hex-option[data-idx="${gameState.myChoiceIndex}"]`);
        if (btn) {
          btn.classList.remove('selected-pending');
          btn.classList.add('wrong');
        }
      }
      setBanner('❌ إجابة خاطئة (-1 نقطة)! الفرصة انتقلت لباقي المتسابقين...', 'banner-wrong');
    } else {
      setBanner(`⚡ ${evt.playerName} تسرّع وجاوب غلط (-1)! الفرصة أمامك الآن لخطف (+1)!`, 'banner-wrong');
    }
    return;
  }

  if (evt.type === 'ROUND_END') {
    if (evt.players) gameState.players = evt.players;
    stopVisualTimer();
    revealRoundOutcome(evt);
    return;
  }

  if (evt.type === 'GAME_OVER') {
    if (evt.players) gameState.players = evt.players;
    stopVisualTimer();
    renderMultiplayerPodium();
  }
}

function prepareGameStageUI(mode) {
  showView('game');
  $('soloLifelines').classList.toggle('hidden', mode !== 'solo');
  $('soloPrizeBadge').classList.toggle('hidden', mode !== 'solo');
  $('liveScoreboard').classList.toggle('hidden', mode !== 'multi');
  $('inGameEmojiBar').classList.toggle('hidden', mode !== 'multi');
  $('soloHelperBox').classList.add('hidden');
}

function renderMultiplayerQuestion(evt, durationMs) {
  gameState.myAnsweredRoundId = null;
  gameState.myChoiceIndex = null;

  const totalLabel = evt.totalRounds >= 500 ? '∞' : evt.totalRounds;
  $('roundProgressBadge').textContent = `السؤال ${evt.roundNum} / ${totalLabel}`;
  $('categoryBadge').textContent = `${evt.source === 'ai' ? '✨' : '📚'} ${evt.category}`;
  $('questionText').textContent = evt.q;

  evt.options.forEach((opt, i) => {
    $('optText' + i).textContent = opt;
  });

  resetOptionButtons(false);
  gameState.activeClientQId = evt.qId;

  setBanner('⚡ الأسرع إجابةً صحيحة يكسب (+1) — الإجابة الخاطئة (-1)!', '');
  renderLiveScoreboard();
  sfx.playQuestionReveal();

  startVisualTimer(durationMs);
}

function revealRoundOutcome(evt) {
  const buttons = document.querySelectorAll('.hex-option');
  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    btn.classList.remove('selected-pending');
    if (idx === evt.correctIndex) {
      btn.classList.add('correct');
    } else if (evt.wrongPlayers && evt.wrongPlayers[myProfile.id] === idx) {
      btn.classList.add('wrong');
    }
  });

  if (evt.reason === 'correct') {
    sfx.playCorrect();
    renderLiveScoreboard({ winnerId: evt.winnerId });
    const meWon = evt.winnerId === myProfile.id;
    setBanner(
      meWon
        ? `🏆 أحسنت! خطفت النقطة (+1) في ${evt.elapsedSec} ثانية!`
        : `🏆 ${evt.winnerAvatar} ${evt.winnerName} أجاب أولاً بشكل صحيح وخطف (+1) في ${evt.elapsedSec} ث!`,
      'banner-win'
    );
  } else if (evt.reason === 'all_wrong') {
    sfx.playTimeout();
    renderLiveScoreboard();
    setBanner('💥 كل المتسابقين أجابوا خطأ! يتم تغيير السؤال الآن...', 'banner-wrong');
  } else {
    sfx.playTimeout();
    renderLiveScoreboard();
    setBanner('⏱️ انتهت مهلة الـ 10 ثوانٍ! جاري الانتقال للسؤال التالي...', 'banner-wrong');
  }
}

function submitMultiplayerChoice(choiceIndex) {
  if (!gameState.activeClientQId || gameState.myAnsweredRoundId === gameState.activeClientQId) return;
  gameState.myAnsweredRoundId = gameState.activeClientQId;
  gameState.myChoiceIndex = choiceIndex;

  // Lock buttons immediately for this player
  document.querySelectorAll('.hex-option').forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === choiceIndex) btn.classList.add('selected-pending');
  });

  if (gameState.isHost) {
    processHostAnswer(myProfile.id, gameState.activeClientQId, choiceIndex);
  } else if (gameState.mqttClient) {
    gameState.mqttClient.publish(`${topicBase(gameState.roomCode)}/cmd`, JSON.stringify({
      type: 'ANSWER',
      playerId: myProfile.id,
      qId: gameState.activeClientQId,
      choiceIndex
    }), { qos: 1 });
  }
}

/* =========================================================================
   SOLO MILLIONAIRE MODE (15 Questions + 4 Lifelines + 10s Timer)
   ========================================================================= */
async function startSoloMillionaire() {
  sfx.ensure();
  getSelectedProfile();
  cleanupRoomSession();

  gameState.mode = 'solo';
  gameState.soloIndex = 0;
  gameState.soloLifelines = { fifty: false, audience: false, friend: false, switchQ: false };

  document.querySelectorAll('.lifeline-btn').forEach((b) => b.classList.remove('used'));
  prepareGameStageUI('solo');
  setBanner('✨ جاري تحضير أسئلة رحلة المليون بالذكاء الاصطناعي...', '');
  $('questionText').textContent = 'استعد لرحلة المليون!';
  resetOptionButtons(true);
  sfx.playIntro();

  await aiEngine.ensureReady(ALL_CATEGORIES, 4);
  nextSoloQuestion();
}

async function nextSoloQuestion() {
  if (gameState.mode !== 'solo') return;
  if (gameState.soloIndex >= SOLO_PRIZES.length) {
    renderSoloResult(true);
    return;
  }

  $('soloHelperBox').classList.add('hidden');
  const qObj = await aiEngine.nextQuestion(ALL_CATEGORIES);
  gameState.currentRound = qObj;
  gameState.myAnsweredRoundId = null;

  $('roundProgressBadge').textContent = `السؤال ${gameState.soloIndex + 1} / 15`;
  $('soloPrizeBadge').textContent = `${SOLO_PRIZES[gameState.soloIndex]} $`;
  $('categoryBadge').textContent = `${qObj.source === 'ai' ? '✨' : '📚'} ${qObj.category}`;
  $('questionText').textContent = qObj.q;

  qObj.options.forEach((opt, i) => {
    $('optText' + i).textContent = opt;
  });

  resetOptionButtons(false);
  setBanner(`💰 سؤال بقيمة ${SOLO_PRIZES[gameState.soloIndex]} — لديك 10 ثوانٍ!`, '');
  sfx.playQuestionReveal();

  startVisualTimer(QUESTION_DURATION_MS, () => {
    if (gameState.mode !== 'solo' || gameState.myAnsweredRoundId) return;
    gameState.myAnsweredRoundId = qObj.qId;
    sfx.playTimeout();
    revealSoloButtons(qObj.answer, -1);
    setBanner('⏱️ انتهى الوقت (10 ثوانٍ)! حظاً أوفر في المرة القادمة', 'banner-wrong');
    setTimeout(() => renderSoloResult(false), 2400);
  });
}

function submitSoloChoice(choiceIndex) {
  const qObj = gameState.currentRound;
  if (!qObj || gameState.myAnsweredRoundId) return;
  gameState.myAnsweredRoundId = qObj.qId;
  stopVisualTimer();

  revealSoloButtons(qObj.answer, choiceIndex);

  if (choiceIndex === qObj.answer) {
    sfx.playCorrect();
    setBanner(`✅ إجابة صحيحة! ربحت ${SOLO_PRIZES[gameState.soloIndex]} $`, 'banner-win');
    gameState.soloIndex += 1;
    setTimeout(() => nextSoloQuestion(), 1900);
  } else {
    sfx.playWrong();
    setBanner('❌ إجابة خاطئة! انتهت رحلة المليون', 'banner-wrong');
    setTimeout(() => renderSoloResult(false), 2300);
  }
}

function revealSoloButtons(correctIdx, chosenIdx) {
  document.querySelectorAll('.hex-option').forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === correctIdx) btn.classList.add('correct');
    else if (idx === chosenIdx) btn.classList.add('wrong');
  });
}

/* Lifelines */
function useSolo5050() {
  const q = gameState.currentRound;
  if (gameState.mode !== 'solo' || !q || gameState.soloLifelines.fifty || gameState.myAnsweredRoundId) return;
  gameState.soloLifelines.fifty = true;
  $('ll5050').classList.add('used');

  const wrongIndices = [0, 1, 2, 3].filter((i) => i !== q.answer);
  wrongIndices.sort(() => Math.random() - 0.5);
  wrongIndices.slice(0, 2).forEach((idx) => {
    const btn = document.querySelector(`.hex-option[data-idx="${idx}"]`);
    if (btn) {
      btn.classList.add('hidden-5050');
      btn.disabled = true;
    }
  });
}

function useSoloAudience() {
  const q = gameState.currentRound;
  if (gameState.mode !== 'solo' || !q || gameState.soloLifelines.audience || gameState.myAnsweredRoundId) return;
  gameState.soloLifelines.audience = true;
  $('llAudience').classList.add('used');

  const letters = ['أ', 'ب', 'ج', 'د'];
  const pcts = [8, 10, 12, 70];
  const out = [0, 0, 0, 0];
  out[q.answer] = pcts[3];
  let rem = [pcts[0], pcts[1], pcts[2]];
  [0, 1, 2, 3].filter((i) => i !== q.answer).forEach((idx, k) => { out[idx] = rem[k]; });

  const box = $('soloHelperBox');
  box.textContent = `📊 تصويت الجمهور: ` + out.map((p, i) => `(${letters[i]}: ${p}%)`).join('  •  ');
  box.classList.remove('hidden');
}

function useSoloFriend() {
  const q = gameState.currentRound;
  if (gameState.mode !== 'solo' || !q || gameState.soloLifelines.friend || gameState.myAnsweredRoundId) return;
  gameState.soloLifelines.friend = true;
  $('llFriend').classList.add('used');

  const letters = ['أ', 'ب', 'ج', 'د'];
  const box = $('soloHelperBox');
  box.textContent = `📞 صديقك الخبير يقول: «أنا شبه متأكد أن الإجابة الصحيحة هي (${letters[q.answer]}) ${q.options[q.answer]}!»`;
  box.classList.remove('hidden');
}

async function useSoloSwitch() {
  if (gameState.mode !== 'solo' || gameState.soloLifelines.switchQ || gameState.myAnsweredRoundId) return;
  gameState.soloLifelines.switchQ = true;
  $('llSwitch').classList.add('used');
  stopVisualTimer();
  await nextSoloQuestion();
}

/* =========================================================================
   UI RENDERING HELPERS
   ========================================================================= */
function setLobbyBadge(connecting, text) {
  const b = $('networkStatusBadge');
  b.textContent = text;
  b.classList.toggle('connecting', connecting);
}

function setBanner(text, extraClass) {
  const el = $('stageStatusBanner');
  el.className = 'stage-status-banner' + (extraClass ? ' ' + extraClass : '');
  el.textContent = text;
}

function resetOptionButtons(disabled) {
  document.querySelectorAll('.hex-option').forEach((btn) => {
    btn.disabled = disabled;
    btn.classList.remove('selected-pending', 'correct', 'wrong', 'hidden-5050');
  });
}

function updateLobbyUI() {
  const list = $('lobbyPlayersList');
  const playersArr = Object.values(gameState.players);
  $('lobbyPlayerCount').textContent = String(playersArr.length);

  list.innerHTML = '';
  let hostName = 'المضيف';
  playersArr.forEach((p) => {
    if (p.isHost) hostName = p.name;
    const li = document.createElement('li');
    li.className = 'lobby-player-item' + (p.id === myProfile.id ? ' is-me' : '');
    li.innerHTML = `
      <div class="lp-left">
        <span class="lp-avatar">${p.avatar}</span>
        <span>${escapeHtml(p.name)} ${p.id === myProfile.id ? '(أنت)' : ''}</span>
      </div>
      ${p.isHost ? '<span class="host-crown">👑 مضيف الغرفة</span>' : '<span class="host-crown" style="opacity:0.75">جاهز ⚡</span>'}
    `;
    list.appendChild(li);
  });

  $('hostNameLabel').textContent = hostName;
  $('hostControlsArea').classList.toggle('hidden', !gameState.isHost);
  $('guestWaitingArea').classList.toggle('hidden', gameState.isHost);

  // Sync round selector & category chips
  document.querySelectorAll('#roundCountSelector .pill-opt').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.rounds) === gameState.settings.totalRounds);
    btn.disabled = !gameState.isHost;
  });
  document.querySelectorAll('#categorySelector .cat-chip').forEach((btn) => {
    btn.classList.toggle('active', gameState.settings.categories.includes(btn.dataset.cat));
    btn.disabled = !gameState.isHost;
  });
}

function renderLiveScoreboard(highlight = {}) {
  const wrap = $('liveScoreboard');
  if (!wrap) return;
  const sorted = Object.values(gameState.players).sort((a, b) => b.score - a.score);
  wrap.innerHTML = '';
  sorted.forEach((p) => {
    const div = document.createElement('div');
    let cls = 'score-chip';
    if (p.id === myProfile.id) cls += ' is-me';
    if (highlight.wrongId === p.id) cls += ' got-wrong';
    if (highlight.winnerId === p.id) cls += ' got-winner';
    div.className = cls;

    const scoreSign = p.score > 0 ? `+${p.score}` : String(p.score);
    div.innerHTML = `
      <span>${p.avatar}</span>
      <span class="sc-name">${escapeHtml(p.name)}</span>
      <span class="sc-pts ${p.score < 0 ? 'neg' : ''}">${scoreSign}</span>
    `;
    wrap.appendChild(div);
  });
}

function renderMultiplayerPodium() {
  showView('results');
  sfx.playCorrect();
  const sorted = Object.values(gameState.players).sort((a, b) => b.score - a.score);
  const top = sorted[0];

  $('resultsTrophy').textContent = '🏆';
  $('resultsTitle').textContent = top ? `البطل: ${top.avatar} ${top.name}!` : 'انتهت الجولة!';
  $('resultsSubtitle').textContent = 'الترتيب النهائي لنقاط الغرفة';

  const container = $('podiumContainer');
  container.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];

  sorted.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'podium-row' + (idx === 0 ? ' rank-1' : '');
    const pts = p.score > 0 ? `+${p.score}` : String(p.score);
    row.innerHTML = `
      <div class="podium-left">
        <span>${medals[idx] || `#${idx + 1}`}</span>
        <span>${p.avatar}</span>
        <span>${escapeHtml(p.name)}</span>
      </div>
      <span class="podium-score">${pts} نقطة</span>
    `;
    container.appendChild(row);
  });

  $('btnPlayAgain').textContent = gameState.isHost ? '🔄 جولة جديدة بأسئلة متجددة' : '🔙 العودة لردهة الغرفة';
}

function renderSoloResult(wonMillion) {
  showView('results');
  $('resultsTrophy').textContent = wonMillion ? '👑💰' : '🎯';
  $('resultsTitle').textContent = wonMillion
    ? 'مبروك! لقد ربحت المليون كاملةً 1,000,000 $!'
    : `انتهت المحاولة عند السؤال ${gameState.soloIndex + 1}`;

  const earned = gameState.soloIndex > 0 ? SOLO_PRIZES[gameState.soloIndex - 1] + ' $' : '0 $';
  $('resultsSubtitle').textContent = `رصيدك المحقق في هذه الرحلة: ${earned}`;

  $('podiumContainer').innerHTML = `
    <div class="podium-row rank-1">
      <div class="podium-left">
        <span>${myProfile.avatar}</span>
        <span>${escapeHtml(myProfile.name)}</span>
      </div>
      <span class="podium-score">${earned}</span>
    </div>
  `;
  $('btnPlayAgain').textContent = '🔄 رحلة جديدة بأسئلة متجددة';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* =========================================================================
   EVENT LISTENERS & PWA BOOTSTRAP
   ========================================================================= */
function initApp() {
  // Restore profile UI
  $('inputPlayerName').value = myProfile.name;
  $('btnCycleAvatar').textContent = myProfile.avatar;
  $('btnSoundToggle').textContent = sfx.muted ? '🔇' : '🔊';
  updateSeenCountUI();

  // Avatar cycler
  $('btnCycleAvatar').addEventListener('click', () => {
    const idx = (AVATARS.indexOf(myProfile.avatar) + 1) % AVATARS.length;
    myProfile.avatar = AVATARS[idx];
    $('btnCycleAvatar').textContent = myProfile.avatar;
    localStorage.setItem('mm_pavatar', myProfile.avatar);
  });

  // Sound toggle
  $('btnSoundToggle').addEventListener('click', () => {
    sfx.muted = !sfx.muted;
    localStorage.setItem('mm_muted', sfx.muted ? '1' : '0');
    $('btnSoundToggle').textContent = sfx.muted ? '🔇' : '🔊';
    if (!sfx.muted) sfx.playIntro();
  });

  // Home & Navigation
  $('btnCreateRoom').addEventListener('click', createMultiplayerRoom);
  $('btnJoinRoom').addEventListener('click', () => joinMultiplayerRoom($('inputRoomCode').value));
  $('inputRoomCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinMultiplayerRoom($('inputRoomCode').value);
  });
  $('btnStartSolo').addEventListener('click', startSoloMillionaire);

  $('btnHomeBrand').addEventListener('click', () => {
    cleanupRoomSession();
    showView('home');
  });

  $('btnLeaveLobby').addEventListener('click', () => {
    cleanupRoomSession();
    showView('home');
  });

  $('btnQuitMatch').addEventListener('click', () => {
    cleanupRoomSession();
    showView('home');
  });

  // Copy & Share Room Link
  $('btnCopyCode').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(gameState.roomCode);
      showToast('✅ تم نسخ كود الغرفة: ' + gameState.roomCode);
    } catch {
      showToast('كود الغرفة: ' + gameState.roomCode);
    }
  });

  $('btnShareLink').addEventListener('click', async () => {
    const shareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(gameState.roomCode)}`;
    const shareData = {
      title: 'تحدي من سيربح المليون أونلاين',
      text: `ادخل معي غرفة المسابقة بكود (${gameState.roomCode})! الأسرع يخطف النقطة 🔥`,
      url: shareUrl
    };
    if (navigator.share) {
      try { await navigator.share(shareData); return; } catch {}
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('🔗 تم نسخ الرابط المباشر للغرفة! أرسله لأصدقائك');
    } catch {
      showToast(shareUrl);
    }
  });

  // Host Lobby Settings
  document.querySelectorAll('#roundCountSelector .pill-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!gameState.isHost) return;
      gameState.settings.totalRounds = Number(btn.dataset.rounds);
      updateLobbyUI();
      publishHostRoomState('lobby');
    });
  });

  document.querySelectorAll('#categorySelector .cat-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!gameState.isHost) return;
      const cat = btn.dataset.cat;
      const list = gameState.settings.categories;
      if (list.includes(cat)) {
        if (list.length > 1) gameState.settings.categories = list.filter((c) => c !== cat);
      } else {
        gameState.settings.categories = [...list, cat];
      }
      aiEngine.clearQueue();
      updateLobbyUI();
      publishHostRoomState('lobby');
    });
  });

  $('btnHostStartGame').addEventListener('click', hostStartMatch);

  // Answer Buttons
  document.querySelectorAll('.hex-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (gameState.mode === 'multi') submitMultiplayerChoice(idx);
      else if (gameState.mode === 'solo') submitSoloChoice(idx);
    });
  });

  // Solo Lifelines
  $('ll5050').addEventListener('click', useSolo5050);
  $('llAudience').addEventListener('click', useSoloAudience);
  $('llFriend').addEventListener('click', useSoloFriend);
  $('llSwitch').addEventListener('click', useSoloSwitch);

  // Live Emoji Reactions
  document.querySelectorAll('.emoji-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      const emoji = btn.dataset.emoji;
      if (gameState.mode === 'multi' && gameState.mqttClient) {
        const base = topicBase(gameState.roomCode);
        if (gameState.isHost) {
          broadcastRoomEvent({ type: 'EMOJI', emoji, senderName: myProfile.name });
        } else {
          gameState.mqttClient.publish(`${base}/cmd`, JSON.stringify({
            type: 'EMOJI',
            emoji,
            senderName: myProfile.name
          }), { qos: 0 });
        }
      } else {
        spawnFloatingEmoji(emoji);
      }
    });
  });

  // Results buttons
  $('btnPlayAgain').addEventListener('click', () => {
    if (gameState.mode === 'solo') {
      startSoloMillionaire();
    } else if (gameState.mode === 'multi') {
      if (gameState.isHost) {
        publishHostRoomState('lobby');
        broadcastRoomEvent({ type: 'RETURN_LOBBY', players: gameState.players });
        showView('lobby');
        updateLobbyUI();
      } else {
        showView('lobby');
        updateLobbyUI();
      }
    }
  });

  $('btnBackHome').addEventListener('click', () => {
    cleanupRoomSession();
    showView('home');
  });

  // Settings Modal
  $('btnSettings').addEventListener('click', () => {
    $('inputApiKey').value = getApiKey();
    $('testAiOutput').textContent = '';
    updateSeenCountUI();
    $('settingsModal').classList.remove('hidden');
  });
  $('btnCloseSettings').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
  $('btnSaveSettings').addEventListener('click', () => {
    const val = $('inputApiKey').value.trim();
    if (val) localStorage.setItem('mm_gemini_key', val);
    else localStorage.removeItem('mm_gemini_key');
    aiEngine.clearQueue();
    $('settingsModal').classList.add('hidden');
    showToast('✅ تم حفظ الإعدادات');
  });
  $('btnClearSeen').addEventListener('click', () => {
    localStorage.removeItem('mm_seen_q_v1');
    updateSeenCountUI();
    showToast('🗑️ تم مسح سجل الأسئلة السابقة');
  });
  $('btnTestAi').addEventListener('click', async () => {
    const out = $('testAiOutput');
    out.style.color = '#fcd34d';
    out.textContent = '⏳ جاري توليد سؤال تجريبي مباشر...';
    const val = $('inputApiKey').value.trim();
    if (val) localStorage.setItem('mm_gemini_key', val);
    try {
      const batch = await aiEngine.fetchBatchFromGemini(ALL_CATEGORIES, 1);
      out.style.color = '#6ee7b7';
      out.textContent = `✅ نجح التوليد! [${batch[0].category}]: ${batch[0].q}`;
    } catch (e) {
      out.style.color = '#fca5a5';
      out.textContent = `⚠️ تعذر الاتصال حالياً (${e.message}) — سيعمل البنك الاحتياطي تلقائياً`;
    }
  });

  // Support private client-side #key=... activation (never sent to server or stored in Git)
  if (location.hash && location.hash.includes('key=')) {
    const hashParams = new URLSearchParams(location.hash.slice(1));
    const hk = hashParams.get('key');
    if (hk && hk.trim()) {
      localStorage.setItem('mm_gemini_key', hk.trim());
      showToast('✨ تم تفعيل مفتاح التوليد الذكي المباشر على جهازك بنجاح!', 3800);
    }
    window.history.replaceState({}, document.title, location.pathname + location.search);
  }

  // Check URL deep link (?room=XXXXX)
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    $('inputRoomCode').value = roomParam.trim();
    showToast(`🔑 تم تعبئة كود الغرفة (${roomParam})! اكتب اسمك واضغط انضمام`, 4200);
    window.history.replaceState({}, document.title, location.pathname);
  }

  // Register Service Worker & PWA Install Prompt
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('btnInstallPwa').classList.remove('hidden');
  });
  $('btnInstallPwa').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('btnInstallPwa').classList.add('hidden');
  });
}

initApp();
