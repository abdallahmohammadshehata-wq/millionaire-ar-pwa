// Question engine: Gemini generation per category, anti-repetition memory, offline fallbacks.
import { CAT_BY_ID, LEVELS } from './data.js';
import { FALLBACK_QUESTIONS } from './bank.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Ordered fallback chain. 3.x models use thinking for accuracy (cuts hallucinated facts a lot).
const MODELS = [
  { id: 'gemini-3.5-flash-lite', thinking: 'high', timeout: 25000 },
  { id: 'gemini-3.5-flash', thinking: 'low', timeout: 20000 },
  { id: 'gemini-flash-lite-latest', thinking: null, timeout: 15000 },
  { id: 'gemini-2.5-flash-lite', thinking: null, timeout: 15000 },
];
const BATCH = 6;          // questions per request
const MAX_PARALLEL = 3;   // concurrent Gemini requests
const FOREIGN_SCRIPT = /[֐-׿Ѐ-ӿͰ-Ͽ぀-ヿ㐀-鿿가-힯฀-๿ऀ-ॿ]/;

/* ----------------------------- helpers ----------------------------- */
export function normAr(s) {
  return String(s ?? '')
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
function jaccard(a, b) {
  const A = new Set(a.split(' ').filter((w) => w.length > 2));
  const B = new Set(b.split(' ').filter((w) => w.length > 2));
  if (A.size < 3 || B.size < 3) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / (A.size + B.size - i);
}
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const pickN = (arr, n) => shuffle(arr).slice(0, n);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isNumeric = (s) => /^-?\d+(\.\d+)?$/.test(String(s).trim());
const cleanOpt = (s) => String(s ?? '').replace(/^\s*(?:[أ-ي]|[a-jA-J]|\d{1,2})\s*[\)\-\.:]\s+/, '').trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* -------------------------- seen memory ---------------------------- */
const SEEN_KEY = 'mm2_seen_v1';
class SeenStore {
  constructor() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(SEEN_KEY) || 'null'); } catch { /* ignore */ }
    this.h = Array.isArray(d?.h) ? d.h : [];      // hashes of every question ever shown (long memory)
    this.t = Array.isArray(d?.t) ? d.t : [];      // recent normalized texts (fuzzy paraphrase check)
    this.a = d?.a && typeof d.a === 'object' ? d.a : {}; // recent correct answers per category
    this.hSet = new Set(this.h);
  }
  save() {
    try { localStorage.setItem(SEEN_KEY, JSON.stringify({ h: this.h, t: this.t, a: this.a })); } catch { /* quota */ }
  }
  has(q) {
    const n = normAr(q.q);
    if (this.hSet.has(hash(n))) return true;
    for (const t of this.t) if (jaccard(n, t) >= 0.75) return true;
    return false;
  }
  answerUsed(cat, ans) {
    const n = normAr(ans);
    if (cat === 'ذكاء IQ' || isNumeric(n) || n.length < 4) return false;
    return (this.a[cat] || []).slice(-80).includes(n);
  }
  mark(q) {
    const n = normAr(q.q);
    const h = hash(n);
    if (!this.hSet.has(h)) { this.h.push(h); this.hSet.add(h); }
    while (this.h.length > 5000) this.hSet.delete(this.h.shift());
    this.t.push(n.slice(0, 160)); while (this.t.length > 400) this.t.shift();
    const ans = normAr(q.options[q.answer]);
    const list = (this.a[q.cat] ||= []);
    if (!list.includes(ans)) list.push(ans);
    while (list.length > 150) list.shift();
    this.save();
  }
  recentAnswers(cat, n = 60) {
    return (this.a[cat] || []).slice(-n);
  }
  rank(q) { const i = this.h.indexOf(hash(normAr(q.q))); return i; } // -1 = never seen; lower = older
  get count() { return this.h.length; }
  clear() { this.h = []; this.t = []; this.a = {}; this.hSet = new Set(); this.save(); }
}

/* --------------------------- IQ generator -------------------------- */
function iqQuestion(level) {
  const r = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const L = LEVELS.indexOf(level);
  const kinds = [
    () => { const s = r(2, 20), d = r(2, 9 + L * 3); const seq = [0, 1, 2, 3].map((i) => s + d * i); return { q: `أكمل المتتالية: ${seq.join(' ، ')} ، ؟`, a: s + d * 4, step: d }; },
    () => { const s = r(1, 4), m = r(2, 3); const seq = [0, 1, 2, 3].map((i) => s * m ** i); return { q: `أكمل المتتالية: ${seq.join(' ، ')} ، ؟`, a: s * m ** 4, step: s }; },
    () => { const s = r(1, 9), d = r(1, 4); const seq = [s]; for (let i = 1; i < 5; i++) seq.push(seq[i - 1] + d * i); return { q: `ما العدد التالي: ${seq.join(' ، ')} ، ؟`, a: seq[4] + d * 5, step: d }; },
    () => { const x = r(3, 15), a = r(2, 9), b = r(1, 20); return { q: `ما العدد الذي إذا ضربته في ${a} ثم أضفت إليه ${b} يكون الناتج ${x * a + b}؟`, a: x, step: 1 }; },
    () => { const s = r(2, 6), k = r(2, 5); const seq = [s]; for (let i = 1; i < 5; i++) seq.push(i % 2 ? seq[i - 1] + k : seq[i - 1] * 2); return { q: `أكمل النمط المتناوب: ${seq.join(' ، ')} ، ؟`, a: seq[4] + k, step: k }; },
    () => { const o = r(1, 9); const seq = [1, 2, 3, 4, 5].map((n) => n * n + o); return { q: `ما العدد التالي: ${seq.join(' ، ')} ، ؟`, a: 36 + o, step: 2 }; },
    () => { const age = r(5, 15), m = r(2, 4), y = r(3, 12); return { q: `عمر أحمد ${age} سنة، وعمر أبيه ${m} أضعاف عمره. كم سيكون مجموع عمريهما بعد ${y} سنوات؟`, a: age * (m + 1) + 2 * y, step: y }; },
    () => { const o = r(0, 5); const seq = [1, 2, 3, 4, 5].map((n) => n ** 3 - n + o); return { q: `لغز صعب: ${seq.join(' ، ')} ، ؟`, a: 210 + o, step: 6 }; },
  ];
  const pool = L <= 1 ? kinds.slice(0, 4) : L === 2 ? kinds.slice(2, 7) : kinds.slice(4);
  const k = pick(pool)();
  const wrong = new Set();
  for (let i = 1; wrong.size < 9 && i < 60; i++) {
    for (const c of [k.a + i * k.step, k.a - i * k.step, k.a + i, k.a - i]) if (c !== k.a && c > 0) wrong.add(c);
  }
  return { cat: 'ذكاء IQ', level, q: k.q, correct: String(k.a), wrong: shuffle([...wrong]).map(String) };
}

/* ------------------------------ engine ----------------------------- */
export class QuestionEngine {
  constructor({ getKey, onStatus } = {}) {
    this.getKey = getKey || (() => '');
    this.onStatus = onStatus || (() => {});
    this.seen = new SeenStore();
    this.choices = 4;
    this.pools = {};      // cat -> raw items {cat, level, q, correct, wrong[]}
    this.inflight = {};   // cat -> Promise
    this.matchAsked = new Set();
    this.running = 0; this.waiters = [];
    this.epoch = 0;
    this.aborts = new Set();
    this.status = { ai: null, model: '', error: '' };
  }

  setChoices(n) { if (n !== this.choices) { this.choices = n; this.reset(); } }
  reset() {
    this.epoch++; this.pools = {}; this.inflight = {};
    for (const c of this.aborts) c.abort(); this.aborts.clear();
  }
  /** Cancel queued/running generation for categories no longer in use (keeps finished pools). */
  retarget(cats) {
    for (const c of Object.keys(this.inflight)) if (!cats.includes(c)) this.inflight[c].abort?.();
  }
  newMatch() { this.matchAsked = new Set(); }
  hasKey() { return !!this.getKey(); }

  _setStatus(s) { this.status = { ...this.status, ...s }; this.onStatus(this.status); }

  async _slot() {
    if (this.running < MAX_PARALLEL) { this.running++; return; }
    await new Promise((res) => this.waiters.push(res));
    this.running++;
  }
  _release() { this.running--; const w = this.waiters.shift(); if (w) w(); }

  _isDup(item) {
    const n = normAr(item.q);
    if (this.matchAsked.has(n)) return true;
    if (this.seen.has(item)) return true;
    if (this.seen.answerUsed(item.cat, item.correct)) return true;
    for (const p of this.pools[item.cat] || []) {
      const pn = normAr(p.q);
      if (pn === n || jaccard(pn, n) >= 0.75) return true;
      if (item.cat !== 'ذكاء IQ' && normAr(p.correct) === normAr(item.correct) && !isNumeric(item.correct)) return true;
    }
    return false;
  }

  _validate(raw, cat, fallbackLevel, allowed) {
    const q = String(raw?.q ?? '').trim();
    const correct = cleanOpt(raw?.correct);
    if (q.length < 8 || !correct) return null;
    if (FOREIGN_SCRIPT.test(q + correct + (raw.wrong || []).join(''))) return null;
    const nc = normAr(correct);
    if (nc.length >= 4 && !isNumeric(nc) && normAr(q).includes(nc)) return null; // answer leaked in question
    const seen = new Set([nc]);
    const wrong = [];
    for (const w of Array.isArray(raw.wrong) ? raw.wrong : []) {
      const c = cleanOpt(w); const n = normAr(c);
      if (!c || seen.has(n)) continue;
      seen.add(n); wrong.push(c);
    }
    if (wrong.length < 1) return null;
    const level = allowed.includes(raw.level) ? raw.level : fallbackLevel;
    return { cat, level, q, correct, wrong };
  }

  _prompt(cat, levels) {
    const c = CAT_BY_ID[cat];
    const k = Math.max(1, this.choices - 1);
    const angles = pickN(c.angles, 2);
    const avoid = this.seen.recentAnswers(cat, 70);
    const levelDefs = LEVELS.map((l, i) => `${i + 1}. ${l}`).join(' | ');
    const lines = [
      'أنت معدّ أسئلة محترف ودقيق جداً لبرنامج المسابقات «من سيربح المليون».',
      `اكتب ${levels.length} أسئلة جديدة تماماً، وكلها من تصنيف «${cat}» فقط ولا شيء غيره.`,
      `وصف التصنيف: ${c.desc}`,
      `ركّز في هذه الدفعة على الزوايا التالية للتنويع: ${angles.join('، ')}. (رقم عشوائي للتنويع: ${Math.floor(Math.random() * 1e6)})`,
      `مستوى صعوبة كل سؤال بالترتيب: ${levels.map((l, i) => `السؤال ${i + 1} = ${l}`).join('، ')}.`,
      `مقياس الصعوبة من الأسهل للأصعب: ${levelDefs}. ${LEVELS.map((l) => `«${l}»: ${levelDesc(l)}`).join(' — ')}`,
      'القواعد الصارمة:',
      `- لكل سؤال إجابة صحيحة واحدة مؤكدة 100% (في الحقل correct) و${k} إجابات خاطئة مقنعة ومختلفة (في الحقل wrong) من نفس نوع الإجابة الصحيحة تماماً.`,
      '- لا تكتب أي سؤال لست متأكداً تماماً من صحته؛ استبدله بسؤال آخر تعرف إجابته يقيناً.',
      '- العربية الفصحى الواضحة فقط، بدون أي حروف من لغات أخرى، وبدون ترقيم أو حروف (أ/ب/ج) داخل الخيارات.',
      '- لا تذكر الإجابة ولا تلمّح لها في نص السؤال. ولا تكرر نفس الإجابة الصحيحة بين أسئلة الدفعة.',
      '- السؤال قصير وواضح (سطر أو سطران).',
    ];
    if (c.career) {
      lines.push(
        `- صيغة السؤال: «من هو اللاعب${c.egyptian ? ' المصري' : ''} صاحب هذه المسيرة؟ النادي الأول ← النادي الثاني ← ...». اكتب الأندية الاحترافية الحقيقية للاعب بالترتيب الزمني الصحيح (يمكن ذكر الإعارات، بدون فرق الناشئين).`,
        `- كل الاختيارات أسماء لاعبين${c.egyptian ? ' مصريين حقيقيين' : ' غير مصريين حقيقيين'} من نفس المركز أو الحقبة تقريباً ليكون التمييز صعباً.`,
        '- تحقق ذهنياً من كل نادٍ في المسيرة قبل كتابته؛ إذا لم تتذكر المسيرة كاملة بدقة فاختر لاعباً آخر.',
        '- اختر فقط لاعبين معروفين وموثّقة مسيراتهم جيداً (لاعبو منتخبات ونجوم أندية كبيرة). ارفع الصعوبة بتقارب الخيارات (نفس الحقبة والمركز والأندية) وبالأندية الأقل شهرة في المسيرة، وليس باختيار لاعبين مغمورين.',
      );
    }
    if (cat === 'ذكاء IQ') {
      lines.push('- اللغز يُحل ذهنياً في ثوانٍ، وله حل واحد فقط بلا أي لبس. احسب الحل خطوة بخطوة وتأكد منه قبل كتابته.');
    }
    if (avoid.length) lines.push(`- ممنوع تماماً أي سؤال إجابته الصحيحة واحدة من هذه (استُخدمت من قبل): ${avoid.join('، ')}.`);
    return lines.join('\n');
  }

  async _callModel(model, prompt, outer) {
    const key = this.getKey();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), model.timeout);
    const onOuter = () => ctrl.abort();
    outer?.addEventListener('abort', onOuter);
    const generationConfig = {
      temperature: 1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          questions: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                level: { type: 'STRING' }, q: { type: 'STRING' },
                correct: { type: 'STRING' }, wrong: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['level', 'q', 'correct', 'wrong'],
            },
          },
        },
        required: ['questions'],
      },
    };
    if (model.thinking) generationConfig.thinkingConfig = { thinkingLevel: model.thinking };
    try {
      const res = await fetch(`${API}/${model.id}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status; err.body = (await res.text()).slice(0, 300);
        throw err;
      }
      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('no JSON');
      const parsed = JSON.parse(m[0]);
      return Array.isArray(parsed.questions) ? parsed.questions : [];
    } finally { clearTimeout(timer); outer?.removeEventListener('abort', onOuter); }
  }

  /** Generate a batch for one category. Each element of `levels` is the target level of one question. */
  async _generate(cat, levels, allowed, ctrl) {
    if (!this.hasKey()) return 0;
    const epoch = this.epoch;
    this.aborts.add(ctrl);
    await this._slot();
    try {
      if (ctrl.signal.aborted || epoch !== this.epoch) return 0;
      const prompt = this._prompt(cat, levels);
      let lastErr = null;
      for (const model of MODELS) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const list = await this._callModel(model, prompt, ctrl.signal);
            if (epoch !== this.epoch || ctrl.signal.aborted) return 0;
            let added = 0;
            const pool = (this.pools[cat] ||= []);
            list.forEach((raw, i) => {
              const item = this._validate(raw, cat, levels[i] || levels[0], allowed);
              if (item && !this._isDup(item)) { pool.push(item); added++; }
            });
            this._setStatus({ ai: true, model: model.id, error: '' });
            return added;
          } catch (e) {
            if (ctrl.signal.aborted || epoch !== this.epoch) return 0;
            lastErr = e;
            const retriable = !e.status || e.status === 429 || e.status >= 500;
            if (e.status === 400 || e.status === 403 || e.status === 401) {
              if (e.status !== 400) { this._setStatus({ ai: false, error: `المفتاح مرفوض (${e.status})` }); return 0; }
              break; // model doesn't accept this config -> next model
            }
            if (!retriable) break;
            await new Promise((r) => setTimeout(r, 900 + attempt * 1200));
          }
        }
      }
      this._setStatus({ ai: false, error: lastErr ? String(lastErr.message) : 'busy' });
      return 0;
    } finally { this._release(); this.aborts.delete(ctrl); }
  }

  _ensure(cat, allowed, wantLevels = []) {
    if (!this.hasKey() || this.inflight[cat]) return this.inflight[cat];
    const levels = [...wantLevels];
    while (levels.length < BATCH) levels.push(pick(allowed));
    const ctrl = new AbortController();
    const p = this._generate(cat, levels.slice(0, BATCH), allowed, ctrl).finally(() => { if (this.inflight[cat] === p) delete this.inflight[cat]; });
    p.abort = () => { ctrl.abort(); if (this.inflight[cat] === p) delete this.inflight[cat]; };
    this.inflight[cat] = p;
    return p;
  }

  /** Warm pools for upcoming slots: [{cat, level, allowed}] */
  prefetch(slots) {
    const need = {};
    for (const s of slots) (need[s.cat] ||= { allowed: s.allowed, levels: [] }).levels.push(s.level);
    for (const [cat, n] of Object.entries(need)) {
      const have = (this.pools[cat] || []).length;
      if (have < n.levels.length + 1) this._ensure(cat, n.allowed, n.levels);
    }
  }

  _pop(cat, level, allowed) {
    const pool = this.pools[cat] || [];
    for (const pass of [0, 1]) {
      for (let i = 0; i < pool.length; i++) {
        const it = pool[i];
        if (pass === 0 && it.level !== level) continue;
        if (pass === 1 && !allowed.includes(it.level)) continue;
        pool.splice(i, 1);
        if (this.seen.has(it) || this.matchAsked.has(normAr(it.q))) { i--; continue; }
        return it;
      }
    }
    return null;
  }

  _bank(cat, level, allowed) {
    const items = FALLBACK_QUESTIONS.filter((b) => b.category === cat).map((b) => ({
      cat, level: b.level || 'متوسط', q: b.q, correct: b.options[b.answer],
      wrong: b.options.filter((_, i) => i !== b.answer), src: 'bank',
    })).filter((b) => !this.matchAsked.has(normAr(b.q)));
    const unseen = items.filter((b) => !this.seen.has(b));
    const byLevel = (arr, lv) => arr.filter((b) => lv.includes(b.level));
    let cands = byLevel(unseen, [level]);
    if (!cands.length) cands = byLevel(unseen, allowed);
    if (!cands.length && cat === 'ذكاء IQ') return { ...iqQuestion(level), src: 'gen' };
    if (!cands.length) cands = unseen;
    if (!cands.length) cands = items.sort((x, y) => this.seen.rank(x) - this.seen.rank(y)).slice(0, 3);
    return cands.length ? { ...pick(cands) } : null;
  }

  _padWrong(item) {
    const need = this.choices - 1;
    const wrong = shuffle(item.wrong).slice(0, need);
    if (wrong.length >= need) return wrong;
    const used = new Set([normAr(item.correct), ...wrong.map(normAr)]);
    if (isNumeric(item.correct)) {
      const a = Number(item.correct); const step = Math.max(1, Math.round(Math.abs(a) * 0.1));
      for (let i = 1; wrong.length < need && i < 50; i++) {
        for (const c of [a + i * step, a - i * step]) {
          const s = String(c); if (wrong.length < need && !used.has(s) && c >= 0) { used.add(s); wrong.push(s); }
        }
      }
      return wrong;
    }
    // Same-category answers of similar length (names with names, places with places).
    const words = item.correct.split(/\s+/).length;
    const pool = [];
    for (const p of [...(this.pools[item.cat] || []), ...FALLBACK_QUESTIONS.filter((b) => b.category === item.cat).map((b) => ({ correct: b.options[b.answer], wrong: b.options }))]) {
      for (const o of [p.correct, ...(p.wrong || [])]) {
        if (o && !isNumeric(o) && Math.abs(String(o).split(/\s+/).length - words) <= 1) pool.push(String(o));
      }
    }
    for (const o of shuffle(pool)) {
      if (wrong.length >= need) break;
      const n = normAr(o); if (!used.has(n)) { used.add(n); wrong.push(o); }
    }
    return wrong;
  }

  _finalize(item, src) {
    const wrong = this._padWrong(item);
    const opts = shuffle([{ t: item.correct, ok: true }, ...wrong.map((t) => ({ t, ok: false }))]);
    const q = {
      id: uid(), cat: item.cat, level: item.level, q: item.q,
      options: opts.map((o) => o.t), answer: opts.findIndex((o) => o.ok), src: item.src || src,
    };
    this.matchAsked.add(normAr(q.q));
    this.seen.mark(q);
    return q;
  }

  /** Get the next question for a category/level. Waits for AI up to waitMs, then falls back. */
  async take(cat, level, allowed, waitMs = 18000) {
    allowed = allowed?.length ? allowed : LEVELS;
    let item = this._pop(cat, level, allowed);
    if (!item && this.hasKey()) {
      this._ensure(cat, allowed, [level]);
      const deadline = Date.now() + waitMs;
      while (!item && Date.now() < deadline) {
        const p = this.inflight[cat];
        await Promise.race([p || new Promise((r) => setTimeout(r, 250)), new Promise((r) => setTimeout(r, 400))]);
        item = this._pop(cat, level, allowed);
        if (!item && !this.inflight[cat]) {
          // Request finished but all items were duplicates/invalid: try once more if time allows.
          if (deadline - Date.now() > 9000) this._ensure(cat, allowed, [level]); else break;
        }
      }
    }
    if (item) {
      if ((this.pools[cat] || []).length < 2) this._ensure(cat, allowed);
      return this._finalize(item, 'ai');
    }
    if (cat === 'ذكاء IQ' && Math.random() < 0.6) return this._finalize({ ...iqQuestion(level), src: 'gen' }, 'gen');
    const b = this._bank(cat, level, allowed);
    if (b) return this._finalize(b, 'bank');
    return this._finalize({ ...iqQuestion(level), src: 'gen' }, 'gen');
  }

  /** Quick connectivity check used by settings. */
  async test() {
    const prompt = this._prompt('معلومات عامة', ['سهل']);
    for (const model of MODELS.slice(0, 2)) {
      try { const list = await this._callModel(model, prompt); return { ok: true, model: model.id, sample: list[0] }; } catch (e) { var err = e; }
    }
    return { ok: false, error: err ? `${err.message} ${err.body || ''}` : 'unknown' };
  }
}

function levelDesc(l) {
  return {
    'سهل': 'معلومة مشهورة يعرفها أغلب الناس',
    'متوسط': 'تحتاج ثقافة جيدة',
    'صعب': 'معلومة دقيقة يعرفها المهتمون فقط',
    'صعب جداً': 'معلومة نادرة ومتخصصة بخيارات متقاربة جداً',
    'أسطوري': 'بمستوى سؤال المليون الأخير: تفصيلة موسوعية نادرة جداً وخيارات شديدة التقارب',
  }[l];
}
