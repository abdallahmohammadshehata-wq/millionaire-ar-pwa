import { FALLBACK_QUESTIONS } from './questions-bank.js';

/* =========================================================================
   CONFIG & CONSTANTS
   ========================================================================= */
const DEFAULT_GEMINI_KEY = '';
const GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemma-4-26b-a4b-it', 'gemini-4-hydrogen'];
const ALLOWED_TIME_OPTIONS = [10, 15, 20, 30, 60];
const SAVED_TIME_SEC = Number(localStorage.getItem('mm_time_sec'));
const DEFAULT_QUESTION_SECONDS = ALLOWED_TIME_OPTIONS.includes(SAVED_TIME_SEC) ? SAVED_TIME_SEC : 10;
const ALLOWED_CHOICE_COUNTS = [2, 4, 6, 8, 10];
const SAVED_CHOICE_COUNT = Number(localStorage.getItem('mm_choice_count'));
const DEFAULT_CHOICE_COUNT = ALLOWED_CHOICE_COUNTS.includes(SAVED_CHOICE_COUNT) ? SAVED_CHOICE_COUNT : 4;
const OPTION_LETTERS = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح', 'ط', 'ي'];
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
const SOLO_PRIZE_VALUES = [100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 125000, 250000, 500000, 1000000];
const SAFE_INDICES = new Set([4, 9, 14]);

const ALL_CATEGORIES = ['تاريخ', 'جغرافيا', 'إسلامي', 'كرة قدم محلي', 'كرة قدم دولي', 'مسيرة لاعب', 'رياضة', 'معلومات عامة', 'ذكاء IQ'];
const CATEGORY_ICONS = {
  'تاريخ': '🏛️',
  'جغرافيا': '🌍',
  'إسلامي': '🕌',
  'كرة قدم محلي': '🏟️',
  'كرة قدم دولي': '⚽',
  'مسيرة لاعب': '👟',
  'رياضة': '🏅',
  'معلومات عامة': '💡',
  'ذكاء IQ': '🧠'
};
const ALL_LEVELS = ['سهل', 'متوسط', 'صعب', 'صعب جداً', 'أسطوري'];
const LEVEL_META = {
  'سهل': { emoji: '🟢', cls: 'lvl-easy', label: 'سهل' },
  'متوسط': { emoji: '🟡', cls: 'lvl-med', label: 'متوسط' },
  'صعب': { emoji: '🟠', cls: 'lvl-hard', label: 'صعب' },
  'صعب جداً': { emoji: '🔴', cls: 'lvl-vhard', label: 'صعب جداً' },
  'أسطوري': { emoji: '🔥', cls: 'lvl-legend', label: 'أسطوري' }
};

function createDefaultCategoryConfig(levels = ALL_LEVELS) {
  const cfg = {};
  ALL_CATEGORIES.forEach((cat) => {
    cfg[cat] = { enabled: true, levels: [...levels] };
  });
  return cfg;
}

function normalizeCategoryConfig(raw) {
  const cfg = createDefaultCategoryConfig();
  if (raw && typeof raw === 'object') {
    ALL_CATEGORIES.forEach((cat) => {
      const entry = raw[cat];
      if (entry && typeof entry === 'object') {
        const lvls = Array.isArray(entry.levels)
          ? entry.levels.filter((l) => ALL_LEVELS.includes(l))
          : [...ALL_LEVELS];
        cfg[cat] = {
          enabled: Boolean(entry.enabled),
          levels: lvls.length ? lvls : [...ALL_LEVELS]
        };
      }
    });
  }
  // Ensure at least 1 category is enabled
  if (!ALL_CATEGORIES.some((cat) => cfg[cat].enabled)) {
    cfg[ALL_CATEGORIES[0]].enabled = true;
  }
  return cfg;
}

function loadSavedCategoryConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem('mm_cat_config_v1') || 'null');
    if (parsed && typeof parsed === 'object') return normalizeCategoryConfig(parsed);
  } catch {}
  return createDefaultCategoryConfig();
}

function saveCategoryConfig(cfg) {
  localStorage.setItem('mm_cat_config_v1', JSON.stringify(normalizeCategoryConfig(cfg)));
}

function getEnabledEntries(cfg) {
  const norm = normalizeCategoryConfig(cfg);
  return ALL_CATEGORIES
    .filter((cat) => norm[cat].enabled)
    .map((cat) => ({ category: cat, levels: norm[cat].levels }));
}

const DEFAULT_CATEGORY_CONFIG = loadSavedCategoryConfig();

const SUBTOPIC_SEEDS = [
  'حضارات قديمة وعواصم منسية وألغاز رقمية ذكية',
  'سيرة نبوية وصحابة وغزوات وتاريخ أندلسي وعباسي',
  'كأس العالم وأبطال الأولمبياد وجغرافيا المضائق والأنهار',
  'الفضاء والفيزياء والطب واختراعات العلماء المسلمين والعالم',
  'ألغاز سرعة بديهة ومتتاليات رياضية قصيرة وثقافة عامة عالمية',
  'عجائب الطبيعة والجزر والقارات وأحداث القرن العشرين الكبرى',
  'القرآن الكريم وعلومه واللغة العربية وأسئلة ذكاء منطقي سريع'
];

function formatArabicSeconds(sec) {
  if (sec === 60) return 'دقيقة واحدة';
  return sec === 10 ? '10 ثوانٍ' : `${sec} ثانية`;
}

/* =========================================================================
   HAPTICS, MOOD LIGHTING & CONFETTI PARTICLE ENGINE
   ========================================================================= */
function haptic(kind) {
  if (!navigator.vibrate) return;
  try {
    if (kind === 'tap') navigator.vibrate(14);
    else if (kind === 'win') navigator.vibrate([25, 35, 55]);
    else if (kind === 'wrong') navigator.vibrate([80, 40, 80]);
    else if (kind === 'tick') navigator.vibrate(10);
  } catch {}
}

function setStudioMood(mood = 'idle') {
  document.body.dataset.mood = mood;
}

function triggerStageShake() {
  const stage = document.getElementById('millionaireStage');
  if (!stage) return;
  stage.classList.remove('shake');
  void stage.offsetWidth;
  stage.classList.add('shake');
}

class ParticleFX {
  constructor() {
    this.canvas = document.getElementById('fxCanvas');
    this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
    this.particles = [];
    this.running = false;
    if (this.canvas) {
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }
  }

  resize() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  burst(count = 55, palette = ['#fff3b0', '#f6c038', '#34d399', '#38bdf8', '#ffffff']) {
    if (!this.ctx) return;
    const cx = this.canvas.width * 0.5;
    const cy = this.canvas.height * 0.36;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2.4 + Math.random() * 6.8;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 90,
        y: cy + (Math.random() - 0.5) * 40,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 2.6,
        size: 4 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 0.25,
        color: palette[Math.floor(Math.random() * palette.length)],
        life: 1,
        decay: 0.011 + Math.random() * 0.012
      });
    }
    if (!this.running) {
      this.running = true;
      requestAnimationFrame(() => this.loop());
    }
  }

  loop() {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.16;
      p.vx *= 0.99;
      p.rot += p.vrot;
      p.life -= p.decay;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      this.ctx.save();
      this.ctx.globalAlpha = Math.max(0, p.life);
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rot);
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(-p.size / 2, -p.size * 0.35, p.size, p.size * 0.7);
      this.ctx.restore();
    }
    if (this.particles.length > 0) {
      requestAnimationFrame(() => this.loop());
    } else {
      this.running = false;
    }
  }
}

const fx = new ParticleFX();

/* =========================================================================
   PERSONAL STATS PERSISTENCE
   ========================================================================= */
function loadStats() {
  try {
    return JSON.parse(localStorage.getItem('mm_stats_v1') || '{"roomWins":0,"bestSolo":0,"totalCorrect":0}');
  } catch {
    return { roomWins: 0, bestSolo: 0, totalCorrect: 0 };
  }
}

function saveStats(stats) {
  localStorage.setItem('mm_stats_v1', JSON.stringify(stats));
  renderHomeStats();
}

function recordCorrectStat() {
  const s = loadStats();
  s.totalCorrect += 1;
  saveStats(s);
}

function recordRoomWinStat() {
  const s = loadStats();
  s.roomWins += 1;
  saveStats(s);
}

function recordSoloBestStat(amount) {
  const s = loadStats();
  if (amount > s.bestSolo) {
    s.bestSolo = amount;
    saveStats(s);
  }
}

function renderHomeStats() {
  const s = loadStats();
  const rw = $('statRoomWins');
  const bs = $('statBestSolo');
  const tc = $('statTotalCorrect');
  if (rw) rw.textContent = String(s.roomWins || 0);
  if (bs) bs.textContent = `${Number(s.bestSolo || 0).toLocaleString('en-US')} $`;
  if (tc) tc.textContent = String(s.totalCorrect || 0);
}

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
    [261.6, 329.6, 392.0, 523.2].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.13, i * 0.085));
  }

  playCountdownBeat(final = false) {
    this.tone(final ? 880 : 440, final ? 0.28 : 0.12, 'triangle', final ? 0.15 : 0.1);
  }

  playQuestionReveal() {
    this.tone(220, 0.22, 'triangle', 0.12, 0);
    this.tone(330, 0.28, 'triangle', 0.12, 0.08);
    this.tone(440, 0.35, 'sine', 0.11, 0.16);
  }

  playTick(secondsLeft) {
    const urgent = secondsLeft <= 3;
    this.tone(urgent ? 900 : 560, urgent ? 0.095 : 0.055, urgent ? 'square' : 'sine', urgent ? 0.08 : 0.045);
    if (urgent) haptic('tick');
  }

  playCorrect() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.26, 'triangle', 0.15, i * 0.072));
  }

  playWrong() {
    this.tone(185, 0.25, 'sawtooth', 0.14, 0);
    this.tone(135, 0.38, 'sawtooth', 0.15, 0.14);
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

function normalizeAndShuffleQuestion(raw, source = 'ai', targetChoiceCount = 4) {
  if (!raw || typeof raw.q !== 'string' || !Array.isArray(raw.options) || raw.options.length < 2) {
    return null;
  }
  const desired = ALLOWED_CHOICE_COUNTS.includes(Number(targetChoiceCount)) ? Number(targetChoiceCount) : 4;
  const rawOpts = raw.options.map((o) => String(o).trim()).filter(Boolean);
  if (rawOpts.length < 2) return null;

  let ansIdx = Number(raw.answer);
  if (!Number.isInteger(ansIdx) || ansIdx < 0 || ansIdx >= rawOpts.length) ansIdx = 0;
  const correctText = rawOpts[ansIdx];

  // Collect unique distractors from the question first
  const seen = new Set([correctText]);
  let distractors = [];
  for (let i = 0; i < rawOpts.length; i++) {
    if (i !== ansIdx && !seen.has(rawOpts[i])) {
      seen.add(rawOpts[i]);
      distractors.push(rawOpts[i]);
    }
  }

  // Shuffle existing distractors
  for (let i = distractors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [distractors[i], distractors[j]] = [distractors[j], distractors[i]];
  }

  const neededDistractors = desired - 1;
  if (distractors.length > neededDistractors) {
    distractors = distractors.slice(0, neededDistractors);
  } else if (distractors.length < neededDistractors) {
    // Supplement extra distractors cleanly from same category (or numeric neighbors for IQ)
    const cat = (raw.category || 'معلومات عامة').trim();
    const numVal = Number(correctText);
    if (cat === 'ذكاء IQ' && !Number.isNaN(numVal) && /^-?\d+(\.\d+)?$/.test(correctText)) {
      let step = Math.max(1, Math.round(Math.abs(numVal) * 0.08));
      for (let k = 1; distractors.length < neededDistractors && k < 40; k++) {
        for (const cand of [String(numVal + k * step), String(numVal - k * step)]) {
          if (distractors.length < neededDistractors && !seen.has(cand)) {
            seen.add(cand);
            distractors.push(cand);
          }
        }
      }
    }
    if (distractors.length < neededDistractors) {
      const catPool = [];
      for (const fq of FALLBACK_QUESTIONS) {
        if (fq.category === cat && Array.isArray(fq.options)) {
          for (const opt of fq.options) {
            const s = String(opt).trim();
            if (s && !seen.has(s)) catPool.push(s);
          }
        }
      }
      for (let i = catPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [catPool[i], catPool[j]] = [catPool[j], catPool[i]];
      }
      for (const cand of catPool) {
        if (distractors.length >= neededDistractors) break;
        if (!seen.has(cand)) {
          seen.add(cand);
          distractors.push(cand);
        }
      }
    }
  }

  const tagged = [{ text: correctText, isCorrect: true }, ...distractors.map((text) => ({ text, isCorrect: false }))];
  for (let i = tagged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [tagged[i], tagged[j]] = [tagged[j], tagged[i]];
  }
  const newAnswer = tagged.findIndex((t) => t.isCorrect);
  const rawLevel = String(raw.level || '').trim();
  const level = ALL_LEVELS.includes(rawLevel) ? rawLevel : 'متوسط';
  return {
    qId: 'q_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
    category: (raw.category || 'معلومات عامة').trim(),
    level,
    q: raw.q.trim(),
    options: tagged.map((t) => t.text),
    answer: newAnswer,
    source
  };
}

function generateDynamicIQQuestion(levels = ALL_LEVELS) {
  const chosenLevels = levels.length ? levels : ALL_LEVELS;
  const pickLevel = chosenLevels[Math.floor(Math.random() * chosenLevels.length)];
  if (pickLevel === 'سهل') {
    const start = Math.floor(3 + Math.random() * 10);
    const step = Math.floor(3 + Math.random() * 6);
    const seq = [start, start + step, start + step * 2, start + step * 3];
    const ans = start + step * 4;
    const opts = [String(ans), String(ans + step), String(ans - step), String(ans + 2)];
    return { category: 'ذكاء IQ', level: 'سهل', q: `أكمل المتتالية: ${seq.join(' ، ')} ، ... ؟`, options: opts, answer: 0 };
  }
  if (pickLevel === 'متوسط') {
    const x = Math.floor(4 + Math.random() * 9);
    const a = Math.floor(3 + Math.random() * 5);
    const b = Math.floor(4 + Math.random() * 12);
    const target = x * a + b;
    const opts = [String(x), String(x + 1), String(x - 1), String(x + 2)];
    return { category: 'ذكاء IQ', level: 'متوسط', q: `ما العدد الذي إذا ضربته في ${a} ثم أضفتَ إليه ${b} كان الناتج ${target}؟`, options: opts, answer: 0 };
  }
  if (pickLevel === 'صعب جداً') {
    // Alternating +a, *2 pattern
    const s = Math.floor(2 + Math.random() * 5);
    const add = Math.floor(3 + Math.random() * 4);
    const a1 = s;
    const a2 = a1 + add;
    const a3 = a2 * 2;
    const a4 = a3 + add;
    const ans = a4 * 2;
    const opts = [String(ans), String(ans + add), String(ans - 2), String(ans + 4)];
    return { category: 'ذكاء IQ', level: 'صعب جداً', q: `أكمل النمط المتناوب: ${a1} ، ${a2} ، ${a3} ، ${a4} ، ... ؟`, options: opts, answer: 0 };
  }
  if (pickLevel === 'أسطوري') {
    // Squares + offset: n^2 + n (or n^3 - n)
    const offset = Math.floor(2 + Math.random() * 4);
    const seq = [1, 2, 3, 4, 5].map((n) => n * n * n - n + offset);
    const ans = 6 * 6 * 6 - 6 + offset;
    const opts = [String(ans), String(ans - 6), String(ans + 6), String(ans + 12)];
    return { category: 'ذكاء IQ', level: 'أسطوري', q: `لغز أسطوري — ما الرقم التالي في المتتالية: ${seq.join(' ، ')} ، ... ؟`, options: opts, answer: 0 };
  }
  // صعب: increasing step or 2n+1 geometric progression
  if (Math.random() < 0.5) {
    const start = Math.floor(2 + Math.random() * 9);
    const step = Math.floor(2 + Math.random() * 4);
    const seq = [start];
    for (let i = 1; i <= 5; i++) seq.push(seq[i - 1] + i * step);
    const ans = seq.pop();
    const opts = [String(ans), String(ans + step), String(ans - step), String(ans + step * 2)];
    return { category: 'ذكاء IQ', level: 'صعب', q: `أكمل المتتالية الذهنية: ${seq.join(' ، ')} ، ... ؟`, options: opts, answer: 0 };
  }
  const s = Math.floor(2 + Math.random() * 5);
  const seq = [s, s * 2 + 1, (s * 2 + 1) * 2 + 1, ((s * 2 + 1) * 2 + 1) * 2 + 1];
  const ans = seq[3] * 2 + 1;
  const opts = [String(ans), String(ans - 2), String(ans + 2), String(ans + 4)];
  return { category: 'ذكاء IQ', level: 'صعب', q: `ما الرقم التالي في النمط: ${seq.join(' ، ')} ، ... ؟`, options: opts, answer: 0 };
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
    updateLobbyReadyIndicator();
  }

  async fetchBatchFromGemini(categoryConfig, count = 8, choiceCount = 4) {
    const key = getApiKey();
    if (!key) throw new Error('Missing API key');

    const desiredChoices = ALLOWED_CHOICE_COUNTS.includes(Number(choiceCount)) ? Number(choiceCount) : 4;
    const normCfg = normalizeCategoryConfig(categoryConfig);
    const entries = getEnabledEntries(normCfg);
    const cats = entries.map((e) => e.category);
    const recentSeen = getSeenQuestions().slice(-30);
    const seedTheme = SUBTOPIC_SEEDS[Math.floor(Math.random() * SUBTOPIC_SEEDS.length)];
    const randomSalt = Math.floor(100000 + Math.random() * 900000);

    const perCatLines = entries.map((e) => `- ${e.category}: مستوى الصعوبة المطلوب (${e.levels.join(' أو ')})`).join('\n');

    const footballHint = [];
    if (cats.includes('كرة قدم محلي')) {
      footballHint.push('بالنسبة لتصنيف «كرة قدم محلي»: ركّز على الدوري المصري الممتاز (الأهلي، الزمالك، الإسماعيلي، بيراميدز، كأس مصر، هدافو الدوري) والدوريات العربية (الدوري السعودي للمحترفين الهلال والنصر والاتحاد، المغربي، التونسي) وبطولات الأندية الأفريقية والآسيوية.');
    }
    if (cats.includes('كرة قدم دولي')) {
      footballHint.push('بالنسبة لتصنيف «كرة قدم دولي»: ركّز على كأس العالم، دوري أبطال أوروبا، الدوريات الأوروبية الخمس الكبرى، اليورو، كوبا أمريكا، الكرة الذهبية، وأساطير الكرة العالمية.');
    }
    if (cats.includes('مسيرة لاعب')) {
      footballHint.push('بالنسبة لتصنيف «مسيرة لاعب»: اكتب تسلسل الأندية التي لعب لها لاعب كرة قدم مشهور (عالمي أو عربي/مصري) بأسهم مثل: «من هو اللاعب صاحب هذه المسيرة: نادي أ ← نادي ب ← نادي ج ← نادي د؟» واجعل كل الاختيارات أسماء لاعبي كرة قدم حقيقيين متقاربين في الجيل أو الجنسية.');
    }

    const prompt = [
      `أنت معدّ أسئلة محترف لبرنامج المسابقات الشهير «من سيربح المليون».`,
      `أنشئ ${count} أسئلة ثقافية جديدة ومبتكرة ومتنوعة باللغة العربية الفصحى السليمة والواضحة.`,
      `التصنيفات المطلوبة ومستوى صعوبة كل تصنيف على حدة (التزم بدقة بصعوبة كل تصنيف!):`,
      perCatLines,
      `معايير الصعوبة: سهل = معلومات مشهورة ومباشرة | متوسط = تفاصيل وأرقام تحتاج ثقافة جيدة | صعب = معلومات دقيقة للخبراء | صعب جداً = معلومات نادرة ومتخصصة للغاية بمشتتات ذكية متقاربة | أسطوري = بمستوى سؤال المليون الأخير (معلومات موسوعية نادرة جداً وتواريخ وأسماء وأرقام فائقة الدقة لا يعرفها إلا القليل النادر مع خيارات متقاربة جداً).`,
      ...footballHint,
      `موجه التنوع العشوائي لهذه الدفعة (#${randomSalt}): ركّز على زوايا مشوقة تشمل ${seedTheme}.`,
      `شروط صارمة جداً:`,
      `1. اجعل نص السؤال واضحاً ومختصراً ومباشراً، وبما فيها أسئلة ذكاء IQ اجعلها ألغازاً سريعة البديهة ومتتاليات قصيرة.`,
      `2. كل سؤال يجب أن يحتوي على ${desiredChoices} خيارات مختلفة تماماً بالضبط (بدون ترقيم أ/ب/ج/د داخل النص)، وإجابة صحيحة واحدة مؤكدة علمياً وتاريخياً بنسبة 100%.`,
      `3. الحقل answer هو رقم الفهرس الصحيح (من 0 إلى ${desiredChoices - 1})، والحقل level يجب أن يطابق مستوى الصعوبة المحدد لذلك التصنيف بالضبط.`,
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
              level: { type: 'string' },
              q: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              answer: { type: 'integer' }
            },
            required: ['category', 'level', 'q', 'options', 'answer']
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

        const bodyObj = { model, input: prompt, store: false };
        if (!model.startsWith('gemma-')) {
          bodyObj.response_format = { type: 'text', mime_type: 'application/json', schema };
        } else {
          bodyObj.input += `\nأجب بصيغة JSON فقط بهذا الشكل: {"questions":[{"category":"${entries[0].category}","level":"${entries[0].levels[0]}","q":"...","options":["1","2","3","4"],"answer":0}]}`;
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
          const catEntry = normCfg[item.category];
          const allowedForCat = catEntry && catEntry.enabled ? catEntry.levels : entries[0].levels;
          if (!allowedForCat.includes(item.level)) {
            item.level = allowedForCat[Math.floor(Math.random() * allowedForCat.length)];
          }
          const normQ = normalizeAndShuffleQuestion(item, 'ai', desiredChoices);
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

  pullFallbackQuestion(categoryConfig, choiceCount = 4) {
    const normCfg = normalizeCategoryConfig(categoryConfig);
    const entries = getEnabledEntries(normCfg);
    const iqEntry = normCfg['ذكاء IQ'];

    if (iqEntry && iqEntry.enabled && Math.random() < (entries.length === 1 ? 0.5 : 0.2)) {
      const iqDynamic = generateDynamicIQQuestion(iqEntry.levels);
      if (iqDynamic) return normalizeAndShuffleQuestion(iqDynamic, 'ai', choiceCount);
    }

    const seen = new Set(getSeenQuestions());
    const matchesPerCategoryLevel = (q) => {
      const entry = normCfg[q.category];
      return Boolean(entry && entry.enabled && entry.levels.includes(q.level || 'متوسط'));
    };

    let pool = FALLBACK_QUESTIONS.filter((q) => matchesPerCategoryLevel(q) && !seen.has(q.q.slice(0, 90)));
    if (!pool.length) pool = FALLBACK_QUESTIONS.filter(matchesPerCategoryLevel);
    if (!pool.length) pool = FALLBACK_QUESTIONS.filter((q) => normCfg[q.category]?.enabled);
    if (!pool.length) pool = FALLBACK_QUESTIONS;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return normalizeAndShuffleQuestion(pick, 'bank', choiceCount);
  }

  async ensureReady(categoryConfig, minInitial = 5, choiceCount = 4) {
    if (!getApiKey()) {
      updateLobbyReadyIndicator();
      return;
    }
    if (this.queue.length >= minInitial) {
      updateLobbyReadyIndicator();
      return;
    }
    if (this.isFetching) return;
    this.isFetching = true;
    updateLobbyReadyIndicator();
    try {
      const fresh = await this.fetchBatchFromGemini(categoryConfig, 8, choiceCount);
      this.queue.push(...fresh);
    } catch (e) {
      console.warn('AI batch fallback triggered:', e.message);
    } finally {
      this.isFetching = false;
      updateLobbyReadyIndicator();
    }
  }

  async nextQuestion(categoryConfig, choiceCount = 4) {
    if (this.queue.length === 0 && getApiKey()) {
      await this.ensureReady(categoryConfig, 1, choiceCount);
    }
    if (getApiKey() && this.queue.length <= 4 && !this.isFetching) {
      this.isFetching = true;
      this.fetchBatchFromGemini(categoryConfig, 8, choiceCount)
        .then((fresh) => {
          this.queue.push(...fresh);
          updateLobbyReadyIndicator();
        })
        .catch(() => {})
        .finally(() => { this.isFetching = false; });
    }

    const q = this.queue.shift() || this.pullFallbackQuestion(categoryConfig, choiceCount);
    markQuestionSeen(q.q);
    updateSeenCountUI();
    return q;
  }
}

const aiEngine = new AIQuestionGenerator();

/* =========================================================================
   STATE & DOM HELPERS
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
  if (name !== 'game') setStudioMood('idle');
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
  if (label) el.style.fontSize = '1.12rem';
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 2300);
}

function setAiStatusPill(ok, modelName = '') {
  const pill = $('aiStatusPill');
  if (!pill) return;
  if (ok) {
    pill.innerHTML = `<span class="ai-dot"></span> ذكاء اصطناعي حي (${escapeHtml(modelName.replace('gemini-', 'Gemini '))})`;
    pill.style.color = '#6ee7b7';
  } else {
    pill.innerHTML = `<span class="ai-dot" style="background:#f6c038;box-shadow:0 0 8px #f6c038"></span> بنك متجدد ذكياً + ألغاز IQ`;
    pill.style.color = '#fcd34d';
  }
}

function updateLobbyReadyIndicator() {
  const el = $('lobbyAiReadyPill');
  if (!el) return;
  if (aiEngine.isFetching) {
    el.textContent = '⏳ جاري توليد حزمة أسئلة جديدة...';
    el.classList.remove('is-ready');
  } else if (aiEngine.queue.length > 0) {
    el.textContent = `✨ جاهز (${aiEngine.queue.length} سؤال ذكاء اصطناعي)`;
    el.classList.add('is-ready');
  } else if (getApiKey()) {
    el.textContent = '✨ مفتاح التوليد مفعّل';
    el.classList.add('is-ready');
  } else {
    el.textContent = '📚 بنك 110+ سؤال متنوع جاهز';
    el.classList.add('is-ready');
  }
}

function updateSeenCountUI() {
  const el = $('seenQuestionsCount');
  if (el) el.textContent = String(getSeenQuestions().length);
}

function runCountdownOverlay(caption = 'استعد للتحدي!') {
  return new Promise((resolve) => {
    const overlay = $('countdownOverlay');
    const digit = $('countdownDigit');
    const cap = $('countdownCaption');
    cap.textContent = caption;
    overlay.classList.remove('hidden');

    const steps = ['3', '2', '1', 'انطلق!'];
    let i = 0;
    const stepFn = () => {
      const val = steps[i];
      digit.textContent = val;
      digit.style.animation = 'none';
      void digit.offsetWidth;
      digit.style.animation = 'popDigit 0.42s cubic-bezier(0.2, 1.3, 0.4, 1)';
      sfx.playCountdownBeat(i === steps.length - 1);
      haptic(i === steps.length - 1 ? 'win' : 'tap');
      i += 1;
      if (i < steps.length) {
        setTimeout(stepFn, 580);
      } else {
        setTimeout(() => {
          overlay.classList.add('hidden');
          resolve();
        }, 420);
      }
    };
    stepFn();
  });
}

function animateNextRoundBar(durationMs) {
  const bar = $('nextRoundBar');
  if (!bar) return;
  bar.style.transition = 'none';
  bar.style.width = '100%';
  void bar.offsetWidth;
  bar.style.transition = `width ${durationMs}ms linear`;
  bar.style.width = '0%';
}

function resetNextRoundBar() {
  const bar = $('nextRoundBar');
  if (!bar) return;
  bar.style.transition = 'none';
  bar.style.width = '0%';
}

/* =========================================================================
   LOCAL UI COUNTDOWN (CONFIGURABLE: 10 / 15 / 20 / 30 SECONDS)
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

function startVisualTimer(durationMs = 10000, onLocalExpire = null) {
  stopVisualTimer();
  setStudioMood('tension');
  const startTs = performance.now();
  const totalSec = Math.max(1, Math.ceil(durationMs / 1000));
  lastTickSecond = totalSec;

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
      setStudioMood('urgent');
    } else {
      wrapEl.classList.remove('danger');
    }

    if (secCeil !== lastTickSecond && secCeil > 0 && secCeil < totalSec) {
      lastTickSecond = secCeil;
      if (secCeil <= 10) sfx.playTick(secCeil);
    }

    if (remainMs <= 0) {
      stopVisualTimer();
      if (typeof onLocalExpire === 'function') onLocalExpire();
    }
  };

  update();
  uiTimerInterval = setInterval(update, 40);
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
    questionSeconds: DEFAULT_QUESTION_SECONDS,
    choiceCount: DEFAULT_CHOICE_COUNT,
    categoryConfig: normalizeCategoryConfig(DEFAULT_CATEGORY_CONFIG)
  },

  soloSeconds: DEFAULT_QUESTION_SECONDS,
  soloChoiceCount: DEFAULT_CHOICE_COUNT,
  soloCategoryConfig: normalizeCategoryConfig(DEFAULT_CATEGORY_CONFIG),

  players: {},
  roundWrongIds: new Set(),

  currentRound: null,
  activeClientQId: null,
  myAnsweredRoundId: null,
  myChoiceIndex: null,

  soloIndex: 0,
  soloLifelines: { fifty: false, audience: false, friend: false, switchQ: false }
};

function getRoomDurationSec() {
  const sec = Number(gameState.settings.questionSeconds);
  return ALLOWED_TIME_OPTIONS.includes(sec) ? sec : 10;
}

function getRoomDurationMs() {
  return getRoomDurationSec() * 1000;
}

function getRoomChoiceCount() {
  const n = Number(gameState.settings.choiceCount);
  return ALLOWED_CHOICE_COUNTS.includes(n) ? n : 4;
}

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

function renderRoomCodeTiles(code) {
  $('displayRoomCode').textContent = code;
  const wrap = $('displayRoomCodeTiles');
  if (!wrap) return;
  const digits = String(code).padEnd(5, '-').slice(0, 5).split('');
  wrap.innerHTML = digits.map((d) => `<span class="code-tile">${escapeHtml(d)}</span>`).join('');
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
  resetNextRoundBar();
  setStudioMood('idle');
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
  gameState.activeClientQId = null;
  gameState.roundWrongIds.clear();
  gameState.players = {};
}

/* =========================================================================
   CREATE & JOIN MULTIPLAYER ROOMS
   ========================================================================= */
async function createMultiplayerRoom() {
  sfx.ensure();
  haptic('tap');
  getSelectedProfile();
  cleanupRoomSession();

  gameState.mode = 'multi';
  gameState.isHost = true;

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
      renderRoomCodeTiles(code);
      client = await connectMqttClient(broker.url, `${topicBase(code)}/evt`, { type: 'HOST_CLOSED' });
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

  aiEngine.clearQueue();
  aiEngine.ensureReady(gameState.settings.categoryConfig, 6, getRoomChoiceCount());
  startRoomHeartbeat();
}

async function joinMultiplayerRoom(rawCode) {
  sfx.ensure();
  haptic('tap');
  const code = String(rawCode || '').replace(/\D/g, '').trim();
  if (code.length < 4) {
    showToast('⚠️ يرجى إدخال كود الغرفة المكون من 5 أرقام');
    return;
  }

  getSelectedProfile();
  cleanupRoomSession();

  gameState.mode = 'multi';
  gameState.isHost = false;
  gameState.roomCode = code;

  const broker = selectBrokerForCode(code);
  showView('lobby');
  renderRoomCodeTiles(code);
  setLobbyBadge(true, '🔄 جاري البحث عن الغرفة...');
  updateLobbyUI();

  let client;
  try {
    client = await connectMqttClient(broker.url, `${topicBase(code)}/cmd`, { type: 'LEAVE', playerId: myProfile.id });
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
    client.publish(`${base}/cmd`, JSON.stringify({
      type: 'JOIN',
      player: { id: myProfile.id, name: myProfile.name, avatar: myProfile.avatar }
    }), { qos: 1 });
  });

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

    if (gameState.currentRound && !gameState.currentRound.resolved) {
      const r = gameState.currentRound;
      const durMs = r.durationMs || getRoomDurationMs();
      const remainMs = Math.max(1500, durMs - (Date.now() - r.startedAt));
      broadcastRoomEvent({
        type: 'LATE_SYNC',
        targetId: p.id,
        roundNum: r.roundNum,
        totalRounds: gameState.settings.totalRounds,
        qId: r.qId,
        category: r.category,
        level: r.level,
        q: r.q,
        options: r.options,
        source: r.source,
        durationMs: durMs,
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
  gameState.settings.categoryConfig = normalizeCategoryConfig(gameState.settings.categoryConfig);

  Object.values(gameState.players).forEach((p) => { p.score = 0; });
  publishHostRoomState('playing');

  broadcastRoomEvent({
    type: 'MATCH_STARTING',
    players: gameState.players,
    settings: gameState.settings
  });

  await Promise.all([
    aiEngine.ensureReady(gameState.settings.categoryConfig, 3, getRoomChoiceCount()),
    new Promise((r) => setTimeout(r, 2250))
  ]);
  hostLaunchQuestion(1);
}

function hostEndMatchEarly() {
  if (!gameState.isHost || gameState.mode !== 'multi') return;
  if (gameState.hostRoundTimeout) clearTimeout(gameState.hostRoundTimeout);
  if (gameState.hostNextRoundTimeout) clearTimeout(gameState.hostNextRoundTimeout);
  if (gameState.currentRound) gameState.currentRound.resolved = true;
  publishHostRoomState('finished');
  broadcastRoomEvent({ type: 'GAME_OVER', players: gameState.players });
}

async function hostLaunchQuestion(roundNum) {
  if (!gameState.isHost || gameState.mode !== 'multi') return;
  if (gameState.hostRoundTimeout) clearTimeout(gameState.hostRoundTimeout);
  if (gameState.hostNextRoundTimeout) clearTimeout(gameState.hostNextRoundTimeout);

  if (roundNum > gameState.settings.totalRounds) {
    publishHostRoomState('finished');
    broadcastRoomEvent({ type: 'GAME_OVER', players: gameState.players });
    return;
  }

  const durSec = getRoomDurationSec();
  const durMs = durSec * 1000;

  const qObj = await aiEngine.nextQuestion(gameState.settings.categoryConfig, getRoomChoiceCount());
  const activeRound = {
    roundNum,
    qId: qObj.qId,
    category: qObj.category,
    level: qObj.level,
    q: qObj.q,
    options: qObj.options,
    answer: qObj.answer,
    source: qObj.source,
    durationSec: durSec,
    durationMs: durMs,
    startedAt: Date.now(),
    resolved: false,
    answeredBy: {},
    wrongPlayers: {}
  };
  gameState.currentRound = activeRound;

  broadcastRoomEvent({
    type: 'QUESTION_START',
    roundNum,
    totalRounds: gameState.settings.totalRounds,
    qId: activeRound.qId,
    category: activeRound.category,
    level: activeRound.level,
    q: activeRound.q,
    options: activeRound.options,
    source: activeRound.source,
    durationMs: durMs,
    durationSec: durSec,
    players: gameState.players
  });

  gameState.hostRoundTimeout = setTimeout(() => {
    if (!gameState.currentRound || gameState.currentRound.qId !== activeRound.qId || activeRound.resolved) return;
    activeRound.resolved = true;
    publishHostRoomState('playing');
    broadcastRoomEvent({
      type: 'ROUND_END',
      qId: activeRound.qId,
      reason: 'timeout',
      durationSec: durSec,
      nextDelayMs: 2600,
      correctIndex: activeRound.answer,
      wrongPlayers: activeRound.wrongPlayers,
      players: gameState.players
    });
    gameState.hostNextRoundTimeout = setTimeout(() => hostLaunchQuestion(roundNum + 1), 2600);
  }, durMs + 300);
}

function processHostAnswer(playerId, qId, choiceIndex) {
  const r = gameState.currentRound;
  if (!r || r.resolved || r.qId !== qId) return;
  if (!gameState.players[playerId]) return;
  if (r.answeredBy[playerId] !== undefined) return;

  r.answeredBy[playerId] = choiceIndex;

  if (choiceIndex === r.answer) {
    r.resolved = true;
    if (gameState.hostRoundTimeout) clearTimeout(gameState.hostRoundTimeout);

    gameState.players[playerId].score += 1;
    const maxSec = r.durationSec || getRoomDurationSec();
    const elapsedSec = Math.min(maxSec, Math.max(0.1, (Date.now() - r.startedAt) / 1000)).toFixed(1);

    publishHostRoomState('playing');
    broadcastRoomEvent({
      type: 'ROUND_END',
      qId: r.qId,
      reason: 'correct',
      nextDelayMs: 3100,
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
    gameState.players[playerId].score -= 1;
    r.wrongPlayers[playerId] = choiceIndex;
    publishHostRoomState('playing');

    const activeIds = getActivePlayerIds();
    const allWrong = activeIds.every((pid) => r.wrongPlayers[pid] !== undefined);

    if (allWrong) {
      r.resolved = true;
      if (gameState.hostRoundTimeout) clearTimeout(gameState.hostRoundTimeout);

      broadcastRoomEvent({
        type: 'ROUND_END',
        qId: r.qId,
        reason: 'all_wrong',
        nextDelayMs: 2300,
        correctIndex: r.answer,
        wrongPlayers: r.wrongPlayers,
        players: gameState.players
      });

      gameState.hostNextRoundTimeout = setTimeout(() => hostLaunchQuestion(r.roundNum + 1), 2300);
    } else {
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
      nextDelayMs: 2300,
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
  if (state.settings) {
    gameState.settings = {
      ...gameState.settings,
      ...state.settings
    };
  }
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
    resetNextRoundBar();
    showView('lobby');
    updateLobbyUI();
    return;
  }

  if (evt.type === 'MATCH_STARTING') {
    if (evt.players) gameState.players = evt.players;
    if (evt.settings) gameState.settings = { ...gameState.settings, ...evt.settings };
    prepareGameStageUI('multi');
    setBanner('✨ جاري تحضير أسئلة متجددة بالذكاء الاصطناعي...', '');
    $('questionText').textContent = 'استعد! أول إجابة صحيحة تخطف النقطة...';
    resetOptionButtons(true);
    runCountdownOverlay('تحدي الغرفة يبدأ الآن!');
    return;
  }

  if (evt.type === 'QUESTION_START' || (evt.type === 'LATE_SYNC' && evt.targetId === myProfile.id)) {
    if (evt.players) gameState.players = evt.players;
    $('countdownOverlay').classList.add('hidden');
    prepareGameStageUI('multi');
    renderMultiplayerQuestion(evt, evt.remainMs || evt.durationMs || getRoomDurationMs());
    return;
  }

  if (evt.type === 'PLAYER_WRONG') {
    if (evt.players) gameState.players = evt.players;
    gameState.roundWrongIds.add(evt.playerId);
    sfx.playWrong();
    renderLiveScoreboard({ deltaId: evt.playerId, deltaVal: '-1' });

    if (evt.playerId === myProfile.id) {
      haptic('wrong');
      setStudioMood('wrong');
      triggerStageShake();
      setTimeout(() => { if (uiTimerInterval) setStudioMood('tension'); }, 650);
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
    resetNextRoundBar();
    renderMultiplayerPodium();
  }
}

function prepareGameStageUI(mode) {
  showView('game');
  const isSolo = mode === 'solo';
  $('soloLifelines').classList.toggle('hidden', !isSolo);
  $('btnToggleLadder').classList.toggle('hidden', !isSolo);
  $('soloLadderPanel').classList.toggle('hidden', !isSolo);
  $('gameLayout').classList.toggle('has-ladder', isSolo);
  $('liveScoreboard').classList.toggle('hidden', isSolo);
  $('inGameEmojiBar').classList.toggle('hidden', isSolo);
  $('btnHostFinishNow').classList.toggle('hidden', isSolo || !gameState.isHost);
  $('soloHelperBox').classList.add('hidden');
}

function renderLevelBadge(level) {
  const el = $('levelBadge');
  const meta = LEVEL_META[level] || LEVEL_META['متوسط'];
  if (el) {
    el.className = `hud-pill level-pill ${meta.cls}`;
    el.textContent = `${meta.emoji} ${meta.label}`;
  }
  const qBox = $('questionBox');
  if (qBox) qBox.dataset.level = meta.cls;
}

function renderAnswerButtons(options) {
  const grid = $('answersGrid');
  if (!grid) return;
  const list = Array.isArray(options) ? options : [];
  grid.classList.toggle('many-opts', list.length >= 6);
  grid.classList.toggle('dense-opts', list.length >= 8);
  grid.innerHTML = '';

  list.forEach((optText, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'hex-option-wrap';
    const keyHint = i === 9 ? '0' : String(i + 1);
    const letter = OPTION_LETTERS[i] || String(i + 1);
    wrap.innerHTML = `
      <span class="stage-line-sm"></span>
      <button type="button" class="hex-option" data-idx="${i}">
        <span class="hex-opt-inner">
          <span class="opt-key-hint">${keyHint}</span>
          <span class="opt-diamond">◆</span>
          <span class="opt-letter">${letter}</span>
          <span class="opt-text">${escapeHtml(optText)}</span>
        </span>
      </button>
      <span class="stage-line-sm"></span>
    `;
    const btn = wrap.querySelector('.hex-option');
    btn.addEventListener('click', () => {
      if (gameState.mode === 'multi') submitMultiplayerChoice(i);
      else if (gameState.mode === 'solo') submitSoloChoice(i);
    });
    grid.appendChild(wrap);
  });
}

function renderMultiplayerQuestion(evt, durationMs) {
  gameState.myAnsweredRoundId = null;
  gameState.myChoiceIndex = null;
  gameState.roundWrongIds.clear();
  resetNextRoundBar();

  const totalLabel = evt.totalRounds >= 500 ? '∞' : evt.totalRounds;
  $('roundProgressBadge').textContent = `السؤال ${evt.roundNum} / ${totalLabel}`;
  $('categoryBadge').textContent = `${evt.source === 'ai' ? '✨' : '📚'} ${evt.category}`;
  renderLevelBadge(evt.level);
  $('questionText').textContent = evt.q;

  renderAnswerButtons(evt.options);
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

  if (evt.wrongPlayers) {
    Object.keys(evt.wrongPlayers).forEach((pid) => gameState.roundWrongIds.add(pid));
  }

  if (evt.reason === 'correct') {
    sfx.playCorrect();
    setStudioMood('win');
    const meWon = evt.winnerId === myProfile.id;
    if (meWon) {
      haptic('win');
      fx.burst(65);
      recordCorrectStat();
    } else {
      fx.burst(30);
    }
    renderLiveScoreboard({ winnerId: evt.winnerId, deltaId: evt.winnerId, deltaVal: '+1' });
    setBanner(
      meWon
        ? `🏆 بطل الجولة! خطفت النقطة (+1) في ${evt.elapsedSec} ثانية!`
        : `🏆 ${evt.winnerAvatar} ${evt.winnerName} خطف النقطة (+1) في ${evt.elapsedSec} ثانية!`,
      'banner-win'
    );
  } else if (evt.reason === 'all_wrong') {
    sfx.playTimeout();
    haptic('wrong');
    setStudioMood('wrong');
    triggerStageShake();
    renderLiveScoreboard();
    setBanner('💥 كل المتسابقين أجابوا خطأ! يتم تغيير السؤال فوراً...', 'banner-wrong');
  } else {
    sfx.playTimeout();
    setStudioMood('wrong');
    renderLiveScoreboard();
    const secLabel = formatArabicSeconds(evt.durationSec || getRoomDurationSec());
    setBanner(`⏱️ انتهت مهلة الـ ${secLabel}! الانتقال للسؤال التالي...`, 'banner-wrong');
  }

  animateNextRoundBar(evt.nextDelayMs || 2600);
}

function submitMultiplayerChoice(choiceIndex) {
  if (!gameState.activeClientQId || gameState.myAnsweredRoundId === gameState.activeClientQId) return;
  haptic('tap');
  gameState.myAnsweredRoundId = gameState.activeClientQId;
  gameState.myChoiceIndex = choiceIndex;

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
   SOLO MILLIONAIRE MODE (15 Questions + Prize Ladder + 4 Lifelines)
   ========================================================================= */
function renderSoloLadder() {
  const list = $('soloLadderList');
  if (!list) return;
  list.innerHTML = '';
  SOLO_PRIZES.forEach((amount, idx) => {
    const li = document.createElement('li');
    let cls = 'ladder-step';
    if (SAFE_INDICES.has(idx)) cls += ' safe';
    if (idx < gameState.soloIndex) cls += ' passed';
    if (idx === gameState.soloIndex) cls += ' current';
    li.className = cls;
    li.innerHTML = `<span>${idx + 1}</span><span class="ltr-num">${amount} $</span>`;
    list.appendChild(li);
  });
}

async function startSoloMillionaire() {
  sfx.ensure();
  haptic('tap');
  getSelectedProfile();
  cleanupRoomSession();

  gameState.mode = 'solo';
  gameState.soloIndex = 0;
  gameState.soloLifelines = { fifty: false, audience: false, friend: false, switchQ: false };

  document.querySelectorAll('.lifeline-btn').forEach((b) => b.classList.remove('used'));
  prepareGameStageUI('solo');
  renderSoloLadder();
  setBanner('✨ جاري تحضير أسئلة رحلة المليون بالذكاء الاصطناعي...', '');
  $('questionText').textContent = 'استعد لرحلة المليون!';
  resetOptionButtons(true);

  await Promise.all([
    aiEngine.ensureReady(gameState.soloCategoryConfig, 4, gameState.soloChoiceCount),
    runCountdownOverlay('رحلة المليون تبدأ الآن!')
  ]);
  nextSoloQuestion();
}

async function nextSoloQuestion() {
  if (gameState.mode !== 'solo') return;
  if (gameState.soloIndex >= SOLO_PRIZES.length) {
    recordSoloBestStat(1000000);
    renderSoloResult(true);
    return;
  }

  resetNextRoundBar();
  $('soloHelperBox').classList.add('hidden');
  renderSoloLadder();

  const qObj = await aiEngine.nextQuestion(gameState.soloCategoryConfig, gameState.soloChoiceCount);
  gameState.currentRound = qObj;
  gameState.myAnsweredRoundId = null;

  const soloSec = gameState.soloSeconds || 10;
  const soloLabel = formatArabicSeconds(soloSec);

  $('roundProgressBadge').textContent = `السؤال ${gameState.soloIndex + 1} / 15`;
  $('soloPrizeBadge').textContent = `${SOLO_PRIZES[gameState.soloIndex]} $`;
  $('categoryBadge').textContent = `${qObj.source === 'ai' ? '✨' : '📚'} ${qObj.category}`;
  renderLevelBadge(qObj.level);
  $('questionText').textContent = qObj.q;

  renderAnswerButtons(qObj.options);
  setBanner(`💰 سؤال بقيمة ${SOLO_PRIZES[gameState.soloIndex]} $ — لديك ${soloLabel}!`, '');
  sfx.playQuestionReveal();

  startVisualTimer(soloSec * 1000, () => {
    if (gameState.mode !== 'solo' || gameState.myAnsweredRoundId) return;
    gameState.myAnsweredRoundId = qObj.qId;
    sfx.playTimeout();
    haptic('wrong');
    setStudioMood('wrong');
    triggerStageShake();
    revealSoloButtons(qObj.answer, -1);
    setBanner(`⏱️ انتهى الوقت (${soloLabel})! حظاً أوفر في الرحلة القادمة`, 'banner-wrong');
    animateNextRoundBar(2400);
    setTimeout(() => renderSoloResult(false), 2400);
  });
}

function submitSoloChoice(choiceIndex) {
  const qObj = gameState.currentRound;
  if (!qObj || gameState.myAnsweredRoundId) return;
  haptic('tap');
  gameState.myAnsweredRoundId = qObj.qId;
  stopVisualTimer();

  revealSoloButtons(qObj.answer, choiceIndex);

  if (choiceIndex === qObj.answer) {
    sfx.playCorrect();
    haptic('win');
    setStudioMood('win');
    recordCorrectStat();
    recordSoloBestStat(SOLO_PRIZE_VALUES[gameState.soloIndex]);
    fx.burst(SAFE_INDICES.has(gameState.soloIndex) ? 80 : 35);
    setBanner(`✅ إجابة صحيحة! وصلت إلى ${SOLO_PRIZES[gameState.soloIndex]} $`, 'banner-win');
    gameState.soloIndex += 1;
    renderSoloLadder();
    animateNextRoundBar(1900);
    setTimeout(() => nextSoloQuestion(), 1900);
  } else {
    sfx.playWrong();
    haptic('wrong');
    setStudioMood('wrong');
    triggerStageShake();
    setBanner('❌ إجابة خاطئة! انتهت رحلة المليون', 'banner-wrong');
    animateNextRoundBar(2300);
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

/* Visual Solo Lifelines (Adapts dynamically to 2, 4, 6, 8, or 10 options!) */
function useSolo5050() {
  const q = gameState.currentRound;
  if (gameState.mode !== 'solo' || !q || gameState.soloLifelines.fifty || gameState.myAnsweredRoundId) return;
  haptic('tap');
  gameState.soloLifelines.fifty = true;
  $('ll5050').classList.add('used');

  const wrongIndices = q.options.map((_, i) => i).filter((i) => i !== q.answer);
  wrongIndices.sort(() => Math.random() - 0.5);
  const removeCount = Math.max(1, Math.floor(q.options.length / 2));
  wrongIndices.slice(0, removeCount).forEach((idx) => {
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
  haptic('tap');
  gameState.soloLifelines.audience = true;
  $('llAudience').classList.add('used');

  const n = q.options.length;
  const high = Math.floor(54 + Math.random() * 18);
  let remaining = 100 - high;
  const out = new Array(n).fill(0);
  out[q.answer] = high;
  const wrongIdxs = q.options.map((_, i) => i).filter((i) => i !== q.answer);
  wrongIdxs.forEach((idx, k) => {
    if (k === wrongIdxs.length - 1) {
      out[idx] = Math.max(1, remaining);
    } else {
      const share = Math.max(1, Math.floor(Math.random() * Math.max(2, remaining - (wrongIdxs.length - k - 1))));
      out[idx] = share;
      remaining = Math.max(1, remaining - share);
    }
  });

  const box = $('soloHelperBox');
  box.innerHTML = `
    <div style="font-weight:800;color:#7dd3fc;font-size:0.84rem;">📊 نتائج تصويت الجمهور داخل الاستوديو</div>
    <div class="audience-chart ${n > 4 ? 'many-bars' : ''}">
      ${out.map((p, i) => `
        <div class="aud-col">
          <span class="aud-pct">${p}%</span>
          <div class="aud-bar-wrap"><div class="aud-bar" style="height:${p}%"></div></div>
          <span class="aud-let">${OPTION_LETTERS[i] || (i + 1)}</span>
        </div>
      `).join('')}
    </div>
  `;
  box.classList.remove('hidden');
}

function useSoloFriend() {
  const q = gameState.currentRound;
  if (gameState.mode !== 'solo' || !q || gameState.soloLifelines.friend || gameState.myAnsweredRoundId) return;
  haptic('tap');
  gameState.soloLifelines.friend = true;
  $('llFriend').classList.add('used');

  const letter = OPTION_LETTERS[q.answer] || String(q.answer + 1);
  const box = $('soloHelperBox');
  box.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;text-align:right;">
      <span style="font-size:1.8rem;">📞</span>
      <div>
        <strong style="color:#fff3b0;display:block;font-size:0.86rem;">صديقك الخبير على الخط:</strong>
        <span style="font-size:0.86rem;color:#e0f2fe;">«بسرعة قبل انتهاء الوقت! أنا متأكد بنسبة كبيرة أن الإجابة هي <strong>(${letter}) ${escapeHtml(q.options[q.answer])}</strong>!»</span>
      </div>
    </div>
  `;
  box.classList.remove('hidden');
}

async function useSoloSwitch() {
  if (gameState.mode !== 'solo' || gameState.soloLifelines.switchQ || gameState.myAnsweredRoundId) return;
  haptic('tap');
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
  $('stageBannerText').textContent = text;
}

function resetOptionButtons(disabled) {
  document.querySelectorAll('.hex-option').forEach((btn) => {
    btn.disabled = disabled;
    btn.classList.remove('selected-pending', 'correct', 'wrong', 'hidden-5050');
  });
}

function renderAvatarStrip() {
  const wrap = $('avatarStrip');
  const preview = $('selectedAvatarPreview');
  if (!wrap) return;
  preview.textContent = myProfile.avatar;
  wrap.innerHTML = '';
  AVATARS.forEach((av) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-opt' + (av === myProfile.avatar ? ' active' : '');
    btn.textContent = av;
    btn.setAttribute('aria-label', av);
    btn.addEventListener('click', () => {
      haptic('tap');
      myProfile.avatar = av;
      localStorage.setItem('mm_pavatar', av);
      renderAvatarStrip();
    });
    wrap.appendChild(btn);
  });
}

function syncSoloTimeUI() {
  document.querySelectorAll('#soloTimeSelector .mini-pill-opt').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.sec) === gameState.soloSeconds);
  });
}

function applyCategoryPreset(preset, targetCfg) {
  const cfg = normalizeCategoryConfig(targetCfg);
  if (preset === 'all-mixed') {
    ALL_CATEGORIES.forEach((c) => { cfg[c] = { enabled: true, levels: [...ALL_LEVELS] }; });
  } else if (preset === 'all-easy') {
    ALL_CATEGORIES.forEach((c) => { cfg[c] = { enabled: true, levels: ['سهل'] }; });
  } else if (preset === 'all-med') {
    ALL_CATEGORIES.forEach((c) => { cfg[c] = { enabled: true, levels: ['متوسط'] }; });
  } else if (preset === 'all-hard') {
    ALL_CATEGORIES.forEach((c) => { cfg[c] = { enabled: true, levels: ['صعب'] }; });
  } else if (preset === 'all-vhard') {
    ALL_CATEGORIES.forEach((c) => { cfg[c] = { enabled: true, levels: ['صعب جداً'] }; });
  } else if (preset === 'all-legend') {
    ALL_CATEGORIES.forEach((c) => { cfg[c] = { enabled: true, levels: ['أسطوري'] }; });
  } else if (preset === 'football') {
    ALL_CATEGORIES.forEach((c) => {
      const isFb = c === 'كرة قدم محلي' || c === 'كرة قدم دولي' || c === 'مسيرة لاعب';
      cfg[c] = { enabled: isFb, levels: cfg[c].levels.length ? [...cfg[c].levels] : [...ALL_LEVELS] };
    });
  }
  return cfg;
}

function renderCategoryMatrix(containerId, config, editable, onUpdate) {
  const wrap = $(containerId);
  if (!wrap) return;
  const cfg = normalizeCategoryConfig(config);
  wrap.innerHTML = '';

  ALL_CATEGORIES.forEach((cat) => {
    const entry = cfg[cat];
    const row = document.createElement('div');
    row.className = 'cat-matrix-row' + (entry.enabled ? '' : ' disabled-cat');

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'cat-toggle-btn';
    toggleBtn.disabled = !editable;
    toggleBtn.innerHTML = `<span class="cat-check-dot">${entry.enabled ? '✓' : ''}</span><span>${CATEGORY_ICONS[cat] || '✨'} ${escapeHtml(cat)}</span>`;
    toggleBtn.addEventListener('click', () => {
      if (!editable) return;
      haptic('tap');
      const enabledCount = ALL_CATEGORIES.filter((c) => cfg[c].enabled).length;
      if (entry.enabled && enabledCount <= 1) {
        showToast('⚠️ يجب الإبقاء على تصنيف واحد مفعّل على الأقل');
        return;
      }
      cfg[cat] = { enabled: !entry.enabled, levels: [...entry.levels] };
      onUpdate(cfg);
    });

    const levelsWrap = document.createElement('div');
    levelsWrap.className = 'cat-row-levels';
    ALL_LEVELS.forEach((lvl) => {
      const meta = LEVEL_META[lvl];
      const isActive = entry.enabled && entry.levels.includes(lvl);
      const lBtn = document.createElement('button');
      lBtn.type = 'button';
      lBtn.className = `row-lvl-btn ${meta.cls}` + (isActive ? ' active' : '');
      lBtn.disabled = !editable;
      lBtn.textContent = meta.label;
      lBtn.addEventListener('click', () => {
        if (!editable) return;
        haptic('tap');
        if (!entry.enabled) {
          // Clicking any difficulty on a disabled category re-enables it with that difficulty!
          cfg[cat] = { enabled: true, levels: [lvl] };
        } else if (entry.levels.includes(lvl)) {
          if (entry.levels.length > 1) {
            cfg[cat] = { enabled: true, levels: entry.levels.filter((x) => x !== lvl) };
          } else {
            showToast(`⚠️ يجب اختيار مستوى واحد على الأقل لتصنيف «${cat}»`);
            return;
          }
        } else {
          cfg[cat] = { enabled: true, levels: [...entry.levels, lvl] };
        }
        onUpdate(cfg);
      });
      levelsWrap.appendChild(lBtn);
    });

    row.appendChild(toggleBtn);
    row.appendChild(levelsWrap);
    wrap.appendChild(row);
  });
}

function syncSoloChoiceCountUI() {
  document.querySelectorAll('#soloChoiceCountSelector .mini-pill-opt').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.choices) === gameState.soloChoiceCount);
  });
}

function syncSoloMatrixUI() {
  const cfg = normalizeCategoryConfig(gameState.soloCategoryConfig);
  const count = getEnabledEntries(cfg).length;
  const btn = $('btnToggleSoloMatrix');
  if (btn) btn.textContent = `⚙️ تخصيص الصعوبة (${count}/${ALL_CATEGORIES.length} تصنيفات)`;

  renderCategoryMatrix('soloCategoryMatrix', cfg, true, (updated) => {
    gameState.soloCategoryConfig = normalizeCategoryConfig(updated);
    gameState.settings.categoryConfig = normalizeCategoryConfig(updated);
    saveCategoryConfig(updated);
    aiEngine.clearQueue();
    syncSoloMatrixUI();
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
        <span class="online-dot"></span>
        <span class="lp-avatar">${p.avatar}</span>
        <span>${escapeHtml(p.name)} ${p.id === myProfile.id ? '(أنت)' : ''}</span>
      </div>
      ${p.isHost ? '<span class="host-crown">👑 مضيف الغرفة</span>' : '<span class="host-crown" style="opacity:0.8">جاهز ⚡</span>'}
    `;
    list.appendChild(li);
  });

  $('hostNameLabel').textContent = hostName;
  $('hostControlsArea').classList.toggle('hidden', !gameState.isHost);
  $('guestWaitingArea').classList.toggle('hidden', gameState.isHost);

  document.querySelectorAll('#roundCountSelector .pill-opt').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.rounds) === gameState.settings.totalRounds);
    btn.disabled = !gameState.isHost;
  });
  document.querySelectorAll('#timeLimitSelector .pill-opt').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.sec) === getRoomDurationSec());
    btn.disabled = !gameState.isHost;
  });
  document.querySelectorAll('#choiceCountSelector .pill-opt').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.choices) === getRoomChoiceCount());
    btn.disabled = !gameState.isHost;
  });

  const presetsRow = $('lobbyPresetsRow');
  if (presetsRow) presetsRow.classList.toggle('hidden', !gameState.isHost);

  renderCategoryMatrix('lobbyCategoryMatrix', gameState.settings.categoryConfig, gameState.isHost, (updated) => {
    gameState.settings.categoryConfig = normalizeCategoryConfig(updated);
    gameState.soloCategoryConfig = normalizeCategoryConfig(updated);
    saveCategoryConfig(updated);
    aiEngine.clearQueue();
    syncSoloMatrixUI();
    updateLobbyUI();
    publishHostRoomState('lobby');
    aiEngine.ensureReady(gameState.settings.categoryConfig, 5, getRoomChoiceCount());
  });

  updateLobbyReadyIndicator();
}

function renderLiveScoreboard(opts = {}) {
  const wrap = $('liveScoreboard');
  if (!wrap) return;
  const sorted = Object.values(gameState.players).sort((a, b) => b.score - a.score);
  wrap.innerHTML = '';
  sorted.forEach((p) => {
    const div = document.createElement('div');
    let cls = 'score-chip';
    const isWrongNow = gameState.roundWrongIds.has(p.id);
    if (p.id === myProfile.id) cls += ' is-me';
    if (isWrongNow) cls += ' got-wrong';
    if (opts.winnerId === p.id) cls += ' got-winner';
    div.className = cls;

    const scoreSign = p.score > 0 ? `+${p.score}` : String(p.score);
    const statusIcon = opts.winnerId === p.id ? '🏆' : (isWrongNow ? '❌' : '');
    const deltaHtml = (opts.deltaId === p.id && opts.deltaVal)
      ? `<span class="delta-pop ${opts.deltaVal.startsWith('+') ? 'plus' : 'minus'}">${opts.deltaVal}</span>`
      : '';

    div.innerHTML = `
      ${deltaHtml}
      <span>${p.avatar}</span>
      <span class="sc-name">${escapeHtml(p.name)}</span>
      ${statusIcon ? `<span class="sc-status-tag">${statusIcon}</span>` : ''}
      <span class="sc-pts ${p.score < 0 ? 'neg' : ''}">${scoreSign}</span>
    `;
    wrap.appendChild(div);
  });
}

function renderMultiplayerPodium() {
  showView('results');
  sfx.playCorrect();
  fx.burst(95);
  setStudioMood('win');

  const sorted = Object.values(gameState.players).sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (top && top.id === myProfile.id && sorted.length > 1) {
    recordRoomWinStat();
  }

  $('resultsTrophy').textContent = '🏆';
  $('resultsTitle').textContent = top ? `بطل الغرفة: ${top.avatar} ${top.name}!` : 'انتهت الجولة!';
  $('resultsSubtitle').textContent = `الترتيب النهائي لـ ${sorted.length} ${sorted.length > 2 ? 'متسابقين' : 'متسابق'}`;

  const vp = $('visualPodium');
  if (sorted.length >= 2) {
    vp.classList.remove('hidden');
    const slots = [
      { rank: 2, p: sorted[1], medal: '🥈', cls: 'pillar-2' },
      { rank: 1, p: sorted[0], medal: '🥇', cls: 'pillar-1' },
      { rank: 3, p: sorted[2], medal: '🥉', cls: 'pillar-3' }
    ].filter((s) => s.p);

    vp.innerHTML = slots.map((s) => {
      const pts = s.p.score > 0 ? `+${s.p.score}` : String(s.p.score);
      return `
        <div class="podium-pillar ${s.cls}">
          <span class="pillar-avatar">${s.p.avatar}</span>
          <span class="pillar-name">${escapeHtml(s.p.name)}</span>
          <div class="pillar-block">
            <span class="pillar-medal">${s.medal}</span>
            <span class="pillar-pts">${pts} نقطة</span>
          </div>
        </div>
      `;
    }).join('');
  } else {
    vp.classList.add('hidden');
  }

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
  $('visualPodium').classList.add('hidden');
  if (wonMillion) {
    sfx.playCorrect();
    fx.burst(120);
    setStudioMood('win');
  }

  $('resultsTrophy').textContent = wonMillion ? '👑💰' : '🎯';
  $('resultsTitle').textContent = wonMillion
    ? 'مبروك! ربحت المليون كاملةً 1,000,000 $!'
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
function applyTheme(theme) {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  localStorage.setItem('mm_theme', t);
  const btn = $('btnThemeToggle');
  if (btn) {
    btn.textContent = t === 'light' ? '🌙' : '☀️';
    btn.title = t === 'light' ? 'التبديل إلى الوضع الليلي' : 'التبديل إلى الوضع النهاري';
  }
  const meta = $('metaThemeColor');
  if (meta) meta.setAttribute('content', t === 'light' ? '#f4f2ec' : '#050816');
}

function initApp() {
  applyTheme(document.documentElement.dataset.theme || localStorage.getItem('mm_theme') || 'dark');
  $('btnThemeToggle').addEventListener('click', () => {
    haptic('tap');
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    applyTheme(next);
  });

  $('inputPlayerName').value = myProfile.name;
  $('btnSoundToggle').textContent = sfx.muted ? '🔇' : '🔊';
  renderAvatarStrip();
  renderHomeStats();
  syncSoloTimeUI();
  syncSoloChoiceCountUI();
  syncSoloMatrixUI();
  updateSeenCountUI();

  $('btnSoundToggle').addEventListener('click', () => {
    sfx.muted = !sfx.muted;
    localStorage.setItem('mm_muted', sfx.muted ? '1' : '0');
    $('btnSoundToggle').textContent = sfx.muted ? '🔇' : '🔊';
    if (!sfx.muted) sfx.playIntro();
  });

  // Home actions
  $('btnCreateRoom').addEventListener('click', createMultiplayerRoom);
  $('btnJoinRoom').addEventListener('click', () => joinMultiplayerRoom($('inputRoomCode').value));
  $('inputRoomCode').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinMultiplayerRoom($('inputRoomCode').value);
  });
  $('inputRoomCode').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5);
  });
  $('btnPasteCode').addEventListener('click', async () => {
    try {
      const txt = (await navigator.clipboard.readText()).replace(/\D/g, '').slice(0, 5);
      if (txt) {
        $('inputRoomCode').value = txt;
        showToast('📋 تم لصق الكود: ' + txt);
      } else {
        showToast('الحافظة لا تحتوي على كود رقمي');
      }
    } catch {
      showToast('اضغط مطولاً داخل الخانة للصق الكود');
    }
  });
  $('btnStartSolo').addEventListener('click', startSoloMillionaire);

  // Solo configurable time selector (10 / 15 / 20 / 30s)
  document.querySelectorAll('#soloTimeSelector .mini-pill-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic('tap');
      const sec = Number(btn.dataset.sec);
      if (ALLOWED_TIME_OPTIONS.includes(sec)) {
        gameState.soloSeconds = sec;
        gameState.settings.questionSeconds = sec;
        localStorage.setItem('mm_time_sec', String(sec));
        syncSoloTimeUI();
      }
    });
  });

  // Solo configurable choice count selector (2 / 4 / 6 / 8 / 10)
  document.querySelectorAll('#soloChoiceCountSelector .mini-pill-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic('tap');
      const n = Number(btn.dataset.choices);
      if (ALLOWED_CHOICE_COUNTS.includes(n)) {
        gameState.soloChoiceCount = n;
        gameState.settings.choiceCount = n;
        localStorage.setItem('mm_choice_count', String(n));
        aiEngine.clearQueue();
        syncSoloChoiceCountUI();
      }
    });
  });

  // Solo per-category hardness drawer toggle & presets
  $('btnToggleSoloMatrix').addEventListener('click', () => {
    haptic('tap');
    $('soloMatrixDrawer').classList.toggle('hidden');
  });

  document.querySelectorAll('#soloPresetsRow .preset-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic('tap');
      const updated = applyCategoryPreset(btn.dataset.preset, gameState.soloCategoryConfig);
      gameState.soloCategoryConfig = updated;
      gameState.settings.categoryConfig = normalizeCategoryConfig(updated);
      saveCategoryConfig(updated);
      aiEngine.clearQueue();
      syncSoloMatrixUI();
    });
  });

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
  $('btnHostFinishNow').addEventListener('click', hostEndMatchEarly);

  $('btnToggleLadder').addEventListener('click', () => {
    $('soloLadderPanel').classList.toggle('mobile-open');
  });
  $('btnCloseLadder').addEventListener('click', () => {
    $('soloLadderPanel').classList.remove('mobile-open');
  });

  const copyCodeHandler = async () => {
    haptic('tap');
    try {
      await navigator.clipboard.writeText(gameState.roomCode);
      showToast('✅ تم نسخ كود الغرفة: ' + gameState.roomCode);
    } catch {
      showToast('كود الغرفة: ' + gameState.roomCode);
    }
  };
  $('btnCopyCode').addEventListener('click', copyCodeHandler);
  $('displayRoomCodeTiles').addEventListener('click', copyCodeHandler);

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
      showToast('🔗 تم نسخ الرابط المباشر للغرفة!');
    } catch {
      showToast(shareUrl);
    }
  });

  $('btnShareWhatsapp').addEventListener('click', () => {
    const shareUrl = `${location.origin}${location.pathname}?room=${encodeURIComponent(gameState.roomCode)}`;
    const secLabel = formatArabicSeconds(getRoomDurationSec());
    const msg = `🏆 تعال نلعب «من سيربح المليون» أونلاين!\n🔑 كود الغرفة: *${gameState.roomCode}*\n⏱️ مهلة السؤال ${secLabel} والأسرع يكسب +1!\nاضغط للدخول فوراً:\n${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  });

  $('btnShareResult').addEventListener('click', async () => {
    const title = $('resultsTitle').textContent;
    const sub = $('resultsSubtitle').textContent;
    const text = `🏆 ${title}\n${sub}\nجرب تحدي «من سيربح المليون أونلاين»:\n${location.origin}${location.pathname}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'نتيجتي في من سيربح المليون', text }); return; } catch {}
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('📤 تم نسخ النتيجة للمشاركة!');
    } catch {}
  });

  // Host Lobby Settings (Rounds, Time Limit, Categories)
  document.querySelectorAll('#roundCountSelector .pill-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!gameState.isHost) return;
      haptic('tap');
      gameState.settings.totalRounds = Number(btn.dataset.rounds);
      updateLobbyUI();
      publishHostRoomState('lobby');
    });
  });

  document.querySelectorAll('#timeLimitSelector .pill-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!gameState.isHost) return;
      haptic('tap');
      const sec = Number(btn.dataset.sec);
      if (ALLOWED_TIME_OPTIONS.includes(sec)) {
        gameState.settings.questionSeconds = sec;
        gameState.soloSeconds = sec;
        localStorage.setItem('mm_time_sec', String(sec));
        syncSoloTimeUI();
        updateLobbyUI();
        publishHostRoomState('lobby');
      }
    });
  });

  document.querySelectorAll('#choiceCountSelector .pill-opt').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!gameState.isHost) return;
      haptic('tap');
      const n = Number(btn.dataset.choices);
      if (ALLOWED_CHOICE_COUNTS.includes(n)) {
        gameState.settings.choiceCount = n;
        gameState.soloChoiceCount = n;
        localStorage.setItem('mm_choice_count', String(n));
        aiEngine.clearQueue();
        syncSoloChoiceCountUI();
        updateLobbyUI();
        publishHostRoomState('lobby');
        aiEngine.ensureReady(gameState.settings.categoryConfig, 5, n);
      }
    });
  });

  document.querySelectorAll('#lobbyPresetsRow .preset-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!gameState.isHost) return;
      haptic('tap');
      const updated = applyCategoryPreset(btn.dataset.preset, gameState.settings.categoryConfig);
      gameState.settings.categoryConfig = updated;
      gameState.soloCategoryConfig = normalizeCategoryConfig(updated);
      saveCategoryConfig(updated);
      aiEngine.clearQueue();
      syncSoloMatrixUI();
      updateLobbyUI();
      publishHostRoomState('lobby');
      aiEngine.ensureReady(gameState.settings.categoryConfig, 5, getRoomChoiceCount());
    });
  });

  $('btnHostStartGame').addEventListener('click', hostStartMatch);

  // Answer Buttons + Keyboard 1-4 Shortcuts
  document.querySelectorAll('.hex-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (gameState.mode === 'multi') submitMultiplayerChoice(idx);
      else if (gameState.mode === 'solo') submitSoloChoice(idx);
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $('settingsModal').classList.add('hidden');
      $('soloLadderPanel').classList.remove('mobile-open');
      return;
    }
    if (!views.game.classList.contains('active')) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const keyMap = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8, '0': 9 };
    if (keyMap[e.key] !== undefined) {
      const btn = document.querySelector(`.hex-option[data-idx="${keyMap[e.key]}"]`);
      if (btn && !btn.disabled) btn.click();
    }
  });

  // Solo Lifelines
  $('ll5050').addEventListener('click', useSolo5050);
  $('llAudience').addEventListener('click', useSoloAudience);
  $('llFriend').addEventListener('click', useSoloFriend);
  $('llSwitch').addEventListener('click', useSoloSwitch);

  // Emoji Reactions
  document.querySelectorAll('.emoji-trigger').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptic('tap');
      const emoji = btn.dataset.emoji;
      if (gameState.mode === 'multi' && gameState.mqttClient) {
        const base = topicBase(gameState.roomCode);
        if (gameState.isHost) {
          broadcastRoomEvent({ type: 'EMOJI', emoji, senderName: myProfile.name });
        } else {
          gameState.mqttClient.publish(`${base}/cmd`, JSON.stringify({
            type: 'EMOJI', emoji, senderName: myProfile.name
          }), { qos: 0 });
        }
      } else {
        spawnFloatingEmoji(emoji);
      }
    });
  });

  // Results Actions
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
    $('inputApiKey').type = 'password';
    $('testAiOutput').textContent = '';
    updateSeenCountUI();
    $('settingsModal').classList.remove('hidden');
  });
  $('btnCloseSettings').addEventListener('click', () => $('settingsModal').classList.add('hidden'));
  $('settingsModal').addEventListener('click', (e) => {
    if (e.target === $('settingsModal')) $('settingsModal').classList.add('hidden');
  });
  $('btnToggleKeyVis').addEventListener('click', () => {
    const inp = $('inputApiKey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  });
  $('btnSaveSettings').addEventListener('click', () => {
    const val = $('inputApiKey').value.trim();
    if (val) localStorage.setItem('mm_gemini_key', val);
    else localStorage.removeItem('mm_gemini_key');
    aiEngine.clearQueue();
    $('settingsModal').classList.add('hidden');
    showToast('✅ تم حفظ الإعدادات بنجاح');
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
      const batch = await aiEngine.fetchBatchFromGemini(gameState.settings.categoryConfig, 1, getRoomChoiceCount());
      out.style.color = '#6ee7b7';
      out.textContent = `✅ نجح التوليد! [${batch[0].category} • ${batch[0].level}]: ${batch[0].q}`;
    } catch (e) {
      out.style.color = '#fca5a5';
      out.textContent = `⚠️ تعذر الاتصال حالياً (${e.message}) — سيعمل البنك الاحتياطي تلقائياً`;
    }
  });

  // Support private client-side #key=... activation
  if (location.hash && location.hash.includes('key=')) {
    const hashParams = new URLSearchParams(location.hash.slice(1));
    const hk = hashParams.get('key');
    if (hk && hk.trim()) {
      localStorage.setItem('mm_gemini_key', hk.trim());
      showToast('✨ تم تفعيل مفتاح التوليد الذكي المباشر على جهازك بنجاح!', 3800);
    }
    window.history.replaceState({}, document.title, location.pathname + location.search);
  }
  if (getApiKey()) setAiStatusPill(true, 'Gemini Live');

  // Check URL deep link (?room=XXXXX)
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room');
  if (roomParam) {
    $('inputRoomCode').value = roomParam.replace(/\D/g, '').slice(0, 5);
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
