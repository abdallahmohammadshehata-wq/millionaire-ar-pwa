import {
  CATEGORIES, CAT_BY_ID, CAT_IDS, LEVELS, LEVEL_META, TIME_OPTIONS, CHOICE_OPTIONS, ROUND_OPTIONS,
  LETTERS, PRESETS, PRIZES, SAFE_STEPS, AVATARS, REACTIONS, defaultConfig, normalizeConfig, enabledCats,
} from './data.js';
import { QuestionEngine, shuffle } from './engine.js';
import { RoomLink, newCode, brokerFor } from './net.js';

let BUILT_IN_KEY = '';
try { BUILT_IN_KEY = (await import('./config.js')).GEMINI_KEY || ''; } catch { /* no config */ }

/* ============================== utils ============================== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtMoney = (n) => n.toLocaleString('en-US');
const fmtTime = (s) => (s === 60 ? 'دقيقة' : `${s} ث`);
const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const prefs = Object.assign({
  id: uid(), name: '', avatar: AVATARS[0], muted: false,
  soloTime: 30, soloChoices: 4, roomTime: 10, roomChoices: 4, rounds: 10,
  soloCfg: defaultConfig(), roomCfg: defaultConfig(),
}, load('mm2_prefs', {}));
prefs.soloCfg = normalizeConfig(prefs.soloCfg);
prefs.roomCfg = normalizeConfig(prefs.roomCfg);
const savePrefs = () => save('mm2_prefs', prefs);
savePrefs();
const stats = Object.assign({ wins: 0, best: 0, correct: 0 }, load('mm2_stats', {}));
const saveStats = () => save('mm2_stats', stats);

// Accept a key from a shared link (#key=...) once, then strip it from the URL.
(() => {
  const m = location.hash.match(/key=([^&]+)/);
  if (m) { localStorage.setItem('mm2_key', decodeURIComponent(m[1]).trim()); history.replaceState(null, '', location.pathname + location.search); }
  const legacy = localStorage.getItem('mm_gemini_key');
  if (legacy && !localStorage.getItem('mm2_key')) localStorage.setItem('mm2_key', legacy);
})();
const getKey = () => (localStorage.getItem('mm2_key') || BUILT_IN_KEY || '').trim();

/* ============================== engine ============================= */
const engine = new QuestionEngine({ getKey, onStatus: updateAiPill });
function updateAiPill(s = engine.status) {
  const pill = $('aiPill');
  let cls = 'idle', txt = 'أسئلة ذكية';
  if (!engine.hasKey()) { cls = 'warn'; txt = 'بدون مفتاح AI'; }
  else if (s.ai === true) { cls = 'ok'; txt = 'أسئلة ذكية ✨'; }
  else if (s.ai === false) { cls = 'warn'; txt = 'بنك احتياطي'; }
  pill.className = `ai-pill ${cls}`;
  pill.querySelector('b').textContent = txt;
  pill.title = s.error ? `آخر خطأ: ${s.error}` : (s.model ? `النموذج: ${s.model}` : '');
}

/* =============================== sound ============================= */
const sfx = {
  ctx: null,
  tone(f, d = 0.12, type = 'sine', v = 0.12, delay = 0) {
    if (prefs.muted) return;
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      const t = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + d + 0.02);
    } catch { /* */ }
  },
  tap() { this.tone(660, 0.05, 'triangle', 0.06); },
  tick() { this.tone(880, 0.05, 'square', 0.04); },
  correct() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, i * 0.09)); },
  wrong() { this.tone(180, 0.35, 'sawtooth', 0.1); this.tone(140, 0.4, 'sawtooth', 0.08, 0.12); },
  start() { [392, 523, 659].forEach((f, i) => this.tone(f, 0.2, 'sine', 0.12, i * 0.12)); },
};
const vibrate = (p) => { try { navigator.vibrate?.(p); } catch { /* */ } };

/* =============================== ui ================================ */
function show(view) {
  for (const v of ['viewHome', 'viewLobby', 'viewGame', 'viewResults']) $(v).classList.toggle('hidden', v !== view);
  document.body.dataset.view = view;
  window.scrollTo({ top: 0 });
}
function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`; el.textContent = msg;
  $('toasts').append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}
function banner(html, kind = '') {
  const b = $('banner');
  b.className = `banner ${kind}`; b.innerHTML = html || '';
}
function floatEmoji(e, name) {
  const el = document.createElement('div');
  el.className = 'floater';
  el.style.insetInlineStart = `${10 + Math.random() * 75}%`;
  el.innerHTML = `<span>${esc(e)}</span><small>${esc(name || '')}</small>`;
  $('floaters').append(el);
  setTimeout(() => el.remove(), 2600);
}

function seg(el, options, value, onChange, fmt = String, readOnly = false) {
  el.innerHTML = '';
  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = fmt(o);
    b.className = o === value ? 'on' : '';
    b.disabled = readOnly && o !== value;
    if (!readOnly) b.onclick = () => { sfx.tap(); onChange(o); seg(el, options, o, onChange, fmt, readOnly); };
    el.append(b);
  }
}

function lvlChip(level, extra = '') {
  const m = LEVEL_META[level] || LEVEL_META['متوسط'];
  return `<span class="lv ${m.key} ${extra}">${esc(level)}</span>`;
}

function renderMatrix(el, cfg, onChange, readOnly = false) {
  el.innerHTML = '';
  for (const c of CATEGORIES) {
    const e = cfg[c.id];
    const row = document.createElement('div');
    row.className = `m-row ${e.on ? '' : 'off'}`;
    const cat = document.createElement('button');
    cat.type = 'button'; cat.className = 'm-cat';
    cat.innerHTML = `<span class="tick">${e.on ? '✓' : ''}</span>${c.icon} ${esc(c.id)}`;
    cat.disabled = readOnly;
    cat.onclick = () => {
      if (e.on && enabledCats(cfg).length === 1) return toast('لازم تصنيف واحد على الأقل');
      e.on = !e.on; sfx.tap(); onChange(cfg); renderMatrix(el, cfg, onChange, readOnly);
    };
    const lv = document.createElement('div');
    lv.className = 'm-levels';
    for (const l of LEVELS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `lv ${LEVEL_META[l].key} ${e.levels.includes(l) ? 'on' : ''}`;
      b.textContent = l; b.disabled = readOnly || !e.on;
      b.onclick = () => {
        if (e.levels.includes(l)) {
          if (e.levels.length === 1) return toast('لازم مستوى واحد على الأقل لكل تصنيف');
          e.levels = e.levels.filter((x) => x !== l);
        } else e.levels = LEVELS.filter((x) => x === l || e.levels.includes(x));
        sfx.tap(); onChange(cfg); renderMatrix(el, cfg, onChange, readOnly);
      };
      lv.append(b);
    }
    row.append(cat, lv);
    el.append(row);
  }
}
function renderPresets(el, getCfg, setCfg, readOnly = false) {
  el.innerHTML = '';
  el.classList.toggle('hidden', readOnly);
  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'preset'; b.textContent = p.label;
    b.onclick = () => { const { cats, levels } = p.apply(); setCfg(defaultConfig(levels, cats)); sfx.tap(); };
    el.append(b);
  }
}
const cfgSummary = (cfg) => `${enabledCats(cfg).length} من ${CAT_IDS.length} تصنيفات`;

/* =============================== timer ============================= */
const timer = {
  raf: 0, deadline: 0, total: 1, onEnd: null, lastSec: -1,
  start(deadline, totalMs, onEnd) {
    this.stop(); this.deadline = deadline; this.total = totalMs; this.onEnd = onEnd; this.lastSec = -1;
    $('timer').classList.remove('hidden');
    const C = 2 * Math.PI * 44;
    const arc = $('timerArc'); arc.style.strokeDasharray = C;
    const loop = () => {
      const left = Math.max(0, this.deadline - Date.now());
      const sec = Math.ceil(left / 1000);
      arc.style.strokeDashoffset = C * (1 - left / this.total);
      if (sec !== this.lastSec) {
        this.lastSec = sec; $('timerNum').textContent = sec;
        $('timer').classList.toggle('urgent', sec <= 3);
        if (sec > 0 && sec <= 5) sfx.tick();
      }
      if (left <= 0) { const cb = this.onEnd; this.stop(); cb?.(); return; }
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  },
  freeze() { cancelAnimationFrame(this.raf); this.raf = 0; },
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; this.onEnd = null; $('timer').classList.remove('urgent'); },
};

/* ============================ question view ======================== */
const view = { q: null, picks: new Set(), locked: false, hidden: new Set() };

function renderQuestion(q, { round, total }) {
  view.q = q; view.picks = new Set(); view.locked = false; view.hidden = new Set();
  $('roundBadge').textContent = total ? `${round} من ${total}` : `سؤال ${round}`;
  const c = CAT_BY_ID[q.cat];
  $('catBadge').innerHTML = `${c?.icon || '❓'} ${esc(q.cat)}${q.src === 'ai' ? ' <i class="spark" title="مولّد بالذكاء الاصطناعي">✨</i>' : ''}`;
  $('lvlBadge').outerHTML = `<span class="chip lvl-chip lv ${LEVEL_META[q.level]?.key || 'l2'} on" id="lvlBadge">${LEVEL_META[q.level]?.icon || ''} ${esc(q.level)}</span>`;
  $('qText').textContent = q.text ?? q.q;
  $('qBox').classList.remove('pop'); void $('qBox').offsetWidth; $('qBox').classList.add('pop');
  $('helperBox').classList.add('hidden');
  const box = $('answers');
  box.innerHTML = '';
  box.dataset.n = q.options.length;
  q.options.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ans'; b.dataset.i = i;
    b.style.animationDelay = `${i * 45}ms`;
    b.innerHTML = `<span class="letter">${LETTERS[i]}</span><span class="txt">${esc(t)}</span>`;
    b.onclick = () => onAnswerClick(i);
    box.append(b);
  });
}
function ansBtn(i) { return $('answers').querySelector(`.ans[data-i="${i}"]`); }
function setAnsState(i, cls) { const b = ansBtn(i); if (b) b.classList.add(cls); }
function lockAnswers(lock = true) { view.locked = lock; $('answers').classList.toggle('locked', lock); }

function onAnswerClick(i) {
  if (view.locked || view.hidden.has(i)) return;
  if (mode === 'solo') solo.answer(i);
  else if (mode === 'room') roomAnswer(i);
}

function renderScoreboard(players, { locked = [], winner = null } = {}) {
  const el = $('scoreboard');
  if (!players) { el.innerHTML = ''; el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  const sorted = [...players].sort((a, b) => b.score - a.score);
  el.innerHTML = sorted.map((p) => `
    <div class="sb ${p.id === prefs.id ? 'me' : ''} ${locked.includes(p.id) ? 'locked' : ''} ${winner === p.id ? 'winner' : ''} ${p.online === false ? 'offline' : ''}">
      <span class="av">${esc(p.avatar)}</span><span class="nm">${esc(p.name)}</span><b class="sc">${p.score}</b>
    </div>`).join('');
}

/* ================================ solo ============================= */
let mode = null; // 'solo' | 'room'

const solo = {
  i: 0, slots: [], q: null, used: {}, busy: false, cfg: null,
  plan(cfg) {
    const cats = enabledCats(cfg);
    const slots = []; let order = [];
    for (let i = 0; i < 15; i++) {
      if (!order.length) order = shuffle(cats);
      const cat = order.shift();
      const lv = LEVELS.filter((l) => cfg[cat].levels.includes(l));
      slots.push({ cat, level: lv[Math.min(lv.length - 1, Math.floor((i * lv.length) / 15))], allowed: lv });
    }
    return slots;
  },
  async start() {
    mode = 'solo';
    this.cfg = normalizeConfig(prefs.soloCfg);
    this.i = 0; this.used = {}; this.slots = this.plan(this.cfg);
    engine.setChoices(prefs.soloChoices); engine.newMatch();
    engine.retarget(enabledCats(this.cfg));
    engine.prefetch(this.slots.slice(0, 4));
    show('viewGame');
    $('soloBar').classList.remove('hidden'); $('reactionBar').classList.add('hidden'); $('btnFinish').classList.add('hidden');
    renderScoreboard(null);
    ['ll5050', 'llAudience', 'llFriend', 'llSwitch'].forEach((id) => { $(id).disabled = false; $(id).classList.remove('used'); });
    if (prefs.soloChoices <= 2) $('ll5050').disabled = true;
    renderLadder();
    await countdown(3);
    this.next();
  },
  async next(sameSlot = false) {
    if (mode !== 'solo') return;
    this.busy = true; timer.stop(); lockAnswers(true);
    const slot = this.slots[this.i];
    $('qText').textContent = 'جاري تجهيز السؤال…'; $('answers').innerHTML = '<div class="loader"></div>';
    banner(this.i === 0 && !sameSlot ? 'بالتوفيق! 🍀' : `السؤال ${this.i + 1} على <b>${fmtMoney(PRIZES[this.i])}</b>`);
    const q = await engine.take(slot.cat, slot.level, slot.allowed);
    if (mode !== 'solo') return;
    engine.prefetch(this.slots.slice(this.i + 1, this.i + 4));
    this.q = q; this.busy = false;
    renderQuestion(q, { round: this.i + 1, total: 15 });
    $('prizeNow').textContent = fmtMoney(PRIZES[this.i]);
    renderLadder();
    lockAnswers(false);
    const ms = prefs.soloTime * 1000;
    timer.start(Date.now() + ms, ms, () => this.lose('timeout'));
  },
  async answer(i) {
    if (this.busy || view.locked) return;
    this.busy = true; timer.freeze(); lockAnswers(true);
    setAnsState(i, 'picked'); sfx.tap();
    await sleep(1100);
    const ok = i === this.q.answer;
    setAnsState(this.q.answer, 'correct');
    if (!ok) setAnsState(i, 'wrong');
    if (ok) {
      sfx.correct(); vibrate(30); stats.correct++; saveStats();
      banner(`✅ إجابة صحيحة! ربحت <b>${fmtMoney(PRIZES[this.i])}</b>`, 'ok');
      await sleep(1600);
      this.i++;
      if (this.i >= 15) return this.finish(PRIZES[14], true);
      this.next();
    } else {
      sfx.wrong(); vibrate([80, 40, 80]);
      await sleep(1600);
      this.lose('wrong');
    }
  },
  safeAmount() { let s = 0; for (const st of SAFE_STEPS) if (st < this.i) s = PRIZES[st]; return s; },
  lose(reason) {
    if (mode !== 'solo') return;
    timer.stop(); lockAnswers(true);
    if (reason === 'timeout') { setAnsState(this.q.answer, 'correct'); sfx.wrong(); }
    this.finish(this.safeAmount(), false, reason);
  },
  walk() {
    if (this.busy) return;
    timer.stop();
    this.finish(this.i > 0 ? PRIZES[this.i - 1] : 0, false, 'walk');
  },
  finish(amount, won, reason) {
    mode = null; timer.stop();
    if (amount > stats.best) { stats.best = amount; saveStats(); }
    const t = won ? '🎉 مبروك! ربحت المليون' : reason === 'walk' ? 'انسحاب ذكي 👏' : reason === 'timeout' ? '⏱️ انتهى الوقت' : 'إجابة خاطئة 💔';
    showResults({ title: t, sub: `رصيدك النهائي: ${fmtMoney(amount)} — وصلت للسؤال ${this.i + (won ? 0 : 1)} من 15`, trophy: won ? '🏆' : amount > 0 ? '💰' : '😢', solo: true });
  },
  async lifeline(kind) {
    if (this.busy || view.locked || !this.q || this.used[kind]) return;
    this.used[kind] = true;
    const btn = { '5050': 'll5050', aud: 'llAudience', friend: 'llFriend', switch: 'llSwitch' }[kind];
    $(btn).disabled = true; $(btn).classList.add('used'); sfx.tap();
    const q = this.q; const n = q.options.length;
    const visible = q.options.map((_, i) => i).filter((i) => !view.hidden.has(i));
    const lvl = LEVELS.indexOf(q.level);
    if (kind === '5050') {
      const wrong = shuffle(visible.filter((i) => i !== q.answer));
      wrong.slice(0, Math.floor(visible.length / 2)).forEach((i) => { view.hidden.add(i); setAnsState(i, 'gone'); });
    } else if (kind === 'aud') {
      const right = Math.random() < [0.95, 0.85, 0.72, 0.6, 0.5][lvl];
      const top = right ? q.answer : pick(visible.filter((i) => i !== q.answer));
      const weights = visible.map((i) => (i === top ? 2.2 + Math.random() * (4 - lvl * 0.6) : Math.random() + 0.3));
      const sum = weights.reduce((a, b) => a + b, 0);
      const pct = weights.map((w) => Math.round((w / sum) * 100));
      $('helperBox').innerHTML = `<b>📊 رأي الجمهور</b><div class="aud">${visible.map((i, k) => `<div class="aud-row"><span>${LETTERS[i]}</span><div class="bar"><i style="width:${pct[k]}%"></i></div><b>${pct[k]}%</b></div>`).join('')}</div>`;
      $('helperBox').classList.remove('hidden');
    } else if (kind === 'friend') {
      const right = Math.random() < [0.92, 0.8, 0.66, 0.52, 0.42][lvl];
      const g = right ? q.answer : pick(visible.filter((i) => i !== q.answer));
      const sure = right && lvl < 2 ? 'أنا متأكد تقريباً إنها' : lvl >= 3 ? 'صعبة بصراحة… بس هراهن على' : 'أظن إنها';
      $('helperBox').innerHTML = `<b>📞 صديقك بيقول:</b> «${sure} <u>${esc(q.options[g])}</u>»`;
      $('helperBox').classList.remove('hidden');
    } else if (kind === 'switch') {
      timer.stop();
      this.next(true);
    }
    void n;
  },
};

function renderLadder() {
  $('ladderList').innerHTML = PRIZES.map((p, i) => `<li class="${i === solo.i ? 'cur' : ''} ${i < solo.i ? 'done' : ''} ${SAFE_STEPS.has(i) ? 'safe' : ''}"><span>${i + 1}</span><b>${fmtMoney(p)}</b></li>`).reverse().join('');
}

async function countdown(n) {
  const o = $('countdown'); o.classList.remove('hidden');
  for (let i = n; i > 0; i--) { $('countdownNum').textContent = i; sfx.tone(440 + (n - i) * 120, 0.15); await sleep(800); }
  sfx.start(); o.classList.add('hidden');
}

/* ================================ rooms ============================ */
const room = { link: null, code: '', isHost: false, state: null, host: null, curQ: null, deadline: 0, prevLocked: [], hb: 0, countedResult: false };

class HostGame {
  constructor(code) {
    this.answer = -1; this.timer = 0; this.upcoming = []; this.order = []; this.lastSeen = {};
    this.s = {
      v: 2, phase: 'lobby', code, hostId: prefs.id, hostName: prefs.name, seq: 0,
      settings: { rounds: prefs.rounds, time: prefs.roomTime, choices: prefs.roomChoices, cfg: normalizeConfig(prefs.roomCfg) },
      players: [{ id: prefs.id, name: prefs.name, avatar: prefs.avatar, score: 0, online: true }],
      round: 0, q: null, endsIn: 0, locked: [], wrong: {}, reveal: null,
    };
    this.presence = setInterval(() => this.checkPresence(), 4000);
    engine.setChoices(this.s.settings.choices);
    this.replan();
  }
  get cfg() { return this.s.settings.cfg; }
  slot() {
    const cats = enabledCats(this.cfg);
    if (!this.order.length) this.order = shuffle(cats);
    const cat = this.order.shift();
    const allowed = LEVELS.filter((l) => this.cfg[cat].levels.includes(l));
    return { cat, level: pick(allowed), allowed };
  }
  replan() {
    this.order = []; this.upcoming = [this.slot(), this.slot(), this.slot()];
    engine.retarget(enabledCats(this.cfg));
    engine.prefetch(this.upcoming);
  }
  publish() {
    this.s.seq++;
    this.s.endsIn = this.endsAt ? Math.max(0, this.endsAt - Date.now()) : 0;
    room.link?.publishState(this.s);
    onRoomState(structuredClone(this.s), true);
  }
  updateSettings(patch) {
    if (this.s.phase !== 'lobby' && this.s.phase !== 'results') return;
    Object.assign(this.s.settings, patch);
    if (patch.choices) engine.setChoices(patch.choices);
    if (patch.cfg || patch.choices) this.replan();
    this.publish();
  }
  onCommand(m) {
    if (!m || !m.id) return;
    this.lastSeen[m.id] = Date.now();
    const p = this.s.players.find((x) => x.id === m.id);
    if (m.t === 'join' && m.p) {
      if (p) Object.assign(p, { name: m.p.name, avatar: m.p.avatar, online: true });
      else this.s.players.push({ id: m.id, name: String(m.p.name).slice(0, 18), avatar: m.p.avatar, score: 0, online: true });
      this.publish();
    } else if (m.t === 'hb') {
      if (p && !p.online) { p.online = true; this.publish(); } else if (!p) room.link?.publishState(this.s);
    } else if (m.t === 'leave') {
      if (p && m.id !== this.s.hostId) { p.online = false; this.publish(); this.checkAllWrong(); }
    } else if (m.t === 'ans') {
      this.onAnswer(m.id, m.qid, Number(m.idx));
    }
  }
  checkPresence() {
    const now = Date.now(); let changed = false;
    for (const p of this.s.players) {
      if (p.id === this.s.hostId) continue;
      const on = now - (this.lastSeen[p.id] || 0) < 16000;
      if (p.online !== on) { p.online = on; changed = true; }
    }
    if (changed) { this.publish(); this.checkAllWrong(); }
  }
  async start() {
    for (const p of this.s.players) p.score = 0;
    this.s.round = 0; this.s.reveal = null; this.s.q = null;
    engine.newMatch();
    this.s.phase = 'countdown'; this.endsAt = Date.now() + 3000; this.publish();
    await sleep(3000);
    this.next();
  }
  async next() {
    clearTimeout(this.timer);
    const { rounds, time } = this.s.settings;
    if (rounds && this.s.round >= rounds) return this.finish();
    this.s.round++;
    this.s.phase = 'loading'; this.s.locked = []; this.s.wrong = {}; this.s.reveal = null; this.endsAt = 0;
    this.publish();
    const slot = this.upcoming.shift() || this.slot();
    this.upcoming.push(this.slot());
    const q = await engine.take(slot.cat, slot.level, slot.allowed);
    if (this.s.phase !== 'loading') return;
    engine.prefetch(this.upcoming);
    this.answer = q.answer;
    this.s.q = { id: q.id, cat: q.cat, level: q.level, text: q.q, options: q.options, src: q.src };
    this.s.phase = 'question';
    this.endsAt = Date.now() + time * 1000;
    this.publish();
    this.timer = setTimeout(() => this.reveal({ reason: 'timeout' }), time * 1000 + 250);
  }
  onAnswer(pid, qid, idx) {
    if (this.s.phase !== 'question' || !this.s.q || qid !== this.s.q.id) return;
    const p = this.s.players.find((x) => x.id === pid);
    if (!p || this.s.locked.includes(pid)) return;
    if (idx === this.answer) {
      p.score += 1;
      this.reveal({ reason: 'win', winner: pid, pick: idx });
    } else {
      p.score -= 1;
      this.s.locked.push(pid); this.s.wrong[pid] = idx;
      this.publish();
      this.checkAllWrong();
    }
  }
  checkAllWrong() {
    if (this.s.phase !== 'question') return;
    const active = this.s.players.filter((p) => p.online !== false);
    if (active.length && active.every((p) => this.s.locked.includes(p.id))) this.reveal({ reason: 'allWrong' });
  }
  reveal(r) {
    if (this.s.phase !== 'question') return;
    clearTimeout(this.timer);
    this.s.phase = 'reveal'; this.endsAt = 0;
    this.s.reveal = { ...r, answer: this.answer };
    this.publish();
    this.timer = setTimeout(() => this.next(), r.reason === 'win' ? 2600 : 2900);
  }
  finish() {
    clearTimeout(this.timer);
    this.s.phase = 'results'; this.endsAt = 0; this.s.q = null;
    this.publish();
  }
  backToLobby() {
    clearTimeout(this.timer);
    for (const p of this.s.players) p.score = 0;
    this.s.phase = 'lobby'; this.s.round = 0; this.s.q = null; this.s.reveal = null; this.endsAt = 0;
    this.replan();
    this.publish();
  }
  destroy() { clearTimeout(this.timer); clearInterval(this.presence); }
}

function profileOk() {
  const name = $('inName').value.trim();
  if (!name) { toast('اكتب اسمك الأول ✍️', 'warn'); $('inName').focus(); return false; }
  prefs.name = name; savePrefs();
  return true;
}

async function createRoom() {
  if (!profileOk()) return;
  const btn = $('btnCreate'); btn.disabled = true; btn.textContent = 'جاري الإنشاء…';
  try {
    for (const broker of ['emqx', 'hivemq']) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const code = newCode(broker);
        const link = new RoomLink({ code, isHost: true, playerId: prefs.id, onCommand: (m) => room.host?.onCommand(m), onReaction, onConn: setConn });
        try {
          await link.connect();
          const existing = await link.waitForState(1200);
          if (existing && existing.phase && existing.phase !== 'closed') { link.closed = true; link.client.end(true); continue; }
          link.onState = () => {};
          Object.assign(room, { link, code, isHost: true, state: null, curQ: null, countedResult: false });
          room.host = new HostGame(code);
          mode = 'room';
          setUrlRoom(code);
          room.host.publish();
          return;
        } catch { try { link.client?.end(true); } catch { /* */ } break; }
      }
    }
    toast('تعذّر الاتصال بخادم الغرف، جرّب مرة أخرى', 'err');
  } finally { btn.disabled = false; btn.textContent = '✨ إنشاء غرفة'; }
}

async function joinRoom(codeArg) {
  if (!profileOk()) return;
  const code = String(codeArg || $('inCode').value).replace(/\D/g, '');
  if (code.length !== 5) return toast('الكود 5 أرقام', 'warn');
  const btn = $('btnJoin'); btn.disabled = true; btn.textContent = '…';
  const link = new RoomLink({ code, isHost: false, playerId: prefs.id, onState: (s) => onRoomState(s), onReaction, onConn: setConn });
  try {
    await link.connect();
    const s = await link.waitForState(5000);
    if (!s || s.phase === 'closed' || !s.v) throw new Error('notfound');
    Object.assign(room, { link, code, isHost: false, host: null, curQ: null, countedResult: false });
    mode = 'room';
    setUrlRoom(code);
    const hello = () => link.send({ t: 'join', id: prefs.id, p: { name: prefs.name, avatar: prefs.avatar } });
    hello();
    clearInterval(room.hb);
    room.hb = setInterval(() => {
      link.send({ t: 'hb', id: prefs.id });
      if (room.state && !room.state.players?.some((p) => p.id === prefs.id)) hello();
    }, 5000);
  } catch (e) {
    try { link.client?.end(true); } catch { /* */ }
    toast(e.message === 'notfound' ? 'الغرفة غير موجودة أو انتهت' : 'تعذّر الاتصال، تأكد من الإنترنت', 'err');
  } finally { btn.disabled = false; btn.textContent = 'انضمام'; }
}

function leaveRoom(silent = false) {
  clearInterval(room.hb); timer.stop();
  room.host?.destroy(); room.link?.close();
  Object.assign(room, { link: null, host: null, state: null, curQ: null, code: '' });
  mode = null;
  setUrlRoom('');
  $('countdown').classList.add('hidden');
  if (!silent) show('viewHome');
}
function setUrlRoom(code) {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code); else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}
function setConn(st) {
  const b = $('connBadge');
  b.className = `conn ${st}`;
  b.textContent = st === 'online' ? '🟢 متصل' : st === 'reconnecting' ? '🟡 إعادة الاتصال…' : '🔴 غير متصل';
}
function onReaction(m) { if (m?.e) floatEmoji(m.e, m.n); }

function roomAnswer(i) {
  const s = room.state;
  if (!s || s.phase !== 'question' || !s.q || s.locked?.includes(prefs.id) || view.picks.size) return;
  view.picks.add(i);
  lockAnswers(true);
  setAnsState(i, 'picked'); sfx.tap(); vibrate(15);
  room.link.send({ t: 'ans', id: prefs.id, qid: s.q.id, idx: i });
}

const nameOf = (s, id) => s.players.find((p) => p.id === id)?.name || '؟';

function onRoomState(s, fromHost = false) {
  if (!room.link) return;
  if (room.isHost && !fromHost) return;
  if (s.phase === 'closed') { toast('المضيف أغلق الغرفة', 'warn'); leaveRoom(); return; }
  if (!s.v) return;
  if (room.state && s.seq < room.state.seq && s.hostId === room.state.hostId) return;
  const prev = room.state; room.state = s;

  if (s.phase === 'lobby') return renderLobby(s);
  if (s.phase === 'results') return renderRoomResults(s);

  if (document.body.dataset.view !== 'viewGame') {
    show('viewGame');
    $('soloBar').classList.add('hidden'); $('reactionBar').classList.remove('hidden');
    $('btnFinish').classList.toggle('hidden', !room.isHost);
    $('helperBox').classList.add('hidden');
  }
  const total = s.settings.rounds;

  if (s.phase === 'countdown') {
    if (prev?.phase !== 'countdown') countdown(3);
    renderScoreboard(s.players); return;
  }
  $('countdown').classList.add('hidden');
  if (s.phase === 'loading') {
    timer.stop(); room.curQ = null;
    $('qText').textContent = 'جاري تجهيز السؤال…';
    $('answers').innerHTML = '<div class="loader"></div>';
    $('roundBadge').textContent = total ? `${s.round} من ${total}` : `سؤال ${s.round}`;
    banner('');
    renderScoreboard(s.players); return;
  }

  const q = s.q;
  if (q && room.curQ !== q.id) {
    room.curQ = q.id; room.prevLocked = [];
    renderQuestion(q, { round: s.round, total });
    banner('أسرع إجابة صحيحة تكسب ⚡');
    if (s.phase === 'question') {
      const ms = s.settings.time * 1000;
      timer.start(Date.now() + Math.max(0, s.endsIn - (fromHost ? 0 : 150)), ms, () => {});
    }
  }

  // Wrong answers so far: show who missed, cross the option out for everyone.
  for (const pid of s.locked || []) {
    if (!room.prevLocked.includes(pid)) {
      const idx = s.wrong?.[pid];
      if (idx != null) setAnsState(idx, pid === prefs.id ? 'wrong' : 'crossed');
      if (pid === prefs.id) { sfx.wrong(); vibrate([80, 40, 80]); banner('❌ إجابة خاطئة −1 — استنى الباقيين', 'err'); }
      else { banner(`❌ ${esc(nameOf(s, pid))} جاوب غلط −1 — الفرصة لسه معاك!`, 'err'); }
    }
  }
  room.prevLocked = [...(s.locked || [])];
  if (s.locked?.includes(prefs.id)) lockAnswers(true);
  else if (s.phase === 'question' && !view.picks.size) lockAnswers(false);

  if (s.phase === 'reveal' && s.reveal && prev?.phase !== 'reveal') {
    timer.stop(); lockAnswers(true);
    const r = s.reveal;
    setAnsState(r.answer, 'correct');
    if (r.reason === 'win') {
      const me = r.winner === prefs.id;
      banner(me ? '⚡ أسرع إجابة صحيحة! +1' : `⚡ ${esc(nameOf(s, r.winner))} خطف النقطة +1`, 'ok');
      if (me) { sfx.correct(); vibrate(30); stats.correct++; saveStats(); } else sfx.tone(520, 0.2, 'triangle');
    } else if (r.reason === 'allWrong') { banner('🔄 الكل جاوب غلط — سؤال جديد', 'err'); sfx.wrong(); }
    else { banner('⏱️ انتهى الوقت', 'warn'); }
  }
  renderScoreboard(s.players, { locked: s.locked || [], winner: s.phase === 'reveal' ? s.reveal?.winner : null });
}

function renderLobby(s) {
  timer.stop(); room.curQ = null; room.countedResult = false;
  if (document.body.dataset.view !== 'viewLobby') show('viewLobby');
  $('codeTiles').innerHTML = [...s.code].map((d) => `<span>${d}</span>`).join('');
  const host = room.isHost;
  $('playerCount').textContent = s.players.filter((p) => p.online !== false).length;
  $('lobbyPlayers').innerHTML = s.players.map((p) => `<li class="${p.online === false ? 'offline' : ''}"><span class="av">${esc(p.avatar)}</span><span>${esc(p.name)}</span>${p.id === s.hostId ? '<em>المضيف 👑</em>' : ''}${p.id === prefs.id ? '<em>أنت</em>' : ''}</li>`).join('');
  const st = s.settings;
  const upd = (patch) => room.host?.updateSettings(patch);
  seg($('roomRounds'), ROUND_OPTIONS, st.rounds, (v) => { prefs.rounds = v; savePrefs(); upd({ rounds: v }); }, (v) => (v ? `${v}` : '∞ مفتوح'), !host);
  seg($('roomTime'), TIME_OPTIONS, st.time, (v) => { prefs.roomTime = v; savePrefs(); upd({ time: v }); }, fmtTime, !host);
  seg($('roomChoices'), CHOICE_OPTIONS, st.choices, (v) => { prefs.roomChoices = v; savePrefs(); upd({ choices: v }); }, String, !host);
  const cfg = normalizeConfig(st.cfg);
  const setCfg = (c) => { prefs.roomCfg = c; savePrefs(); upd({ cfg: c }); };
  renderPresets($('roomPresets'), () => cfg, setCfg, !host);
  renderMatrix($('roomMatrix'), cfg, (c) => setCfg(structuredClone(c)), !host);
  $('settingsNote').textContent = host ? '' : '(المضيف يتحكم فيها)';
  $('btnStartRoom').classList.toggle('hidden', !host);
  $('guestWaiting').classList.toggle('hidden', host);
  $('hostName').textContent = s.hostName || '';
}

function renderRoomResults(s) {
  timer.stop(); $('countdown').classList.add('hidden');
  const sorted = [...s.players].sort((a, b) => b.score - a.score);
  const me = sorted.findIndex((p) => p.id === prefs.id);
  if (!room.countedResult && me === 0 && sorted.length > 1 && sorted[0].score > (sorted[1]?.score ?? 0)) { stats.wins++; saveStats(); }
  room.countedResult = true;
  showResults({
    title: me === 0 ? '🏆 أنت البطل!' : 'انتهت المسابقة',
    sub: `${s.round} سؤال • ${s.players.length} لاعبين`,
    trophy: me === 0 ? '🏆' : '🎖️', players: sorted, room: true,
  });
}

function showResults({ title, sub, trophy, players, solo: isSolo, room: isRoom }) {
  show('viewResults');
  $('resTitle').textContent = title; $('resSub').textContent = sub; $('resTrophy').textContent = trophy;
  if (players) {
    const top = players.slice(0, 3);
    const order = [1, 0, 2].filter((i) => top[i]);
    $('podium').innerHTML = order.map((i) => `<div class="pod p${i + 1}"><span class="av">${esc(top[i].avatar)}</span><b>${esc(top[i].name)}</b><div class="col">${top[i].score}</div></div>`).join('');
    $('finalList').innerHTML = players.map((p, i) => `<li class="${p.id === prefs.id ? 'me' : ''}"><span>${i + 1}</span><span class="av">${esc(p.avatar)}</span><span>${esc(p.name)}</span><b>${p.score}</b></li>`).join('');
  } else { $('podium').innerHTML = ''; $('finalList').innerHTML = ''; }
  $('btnAgain').classList.toggle('hidden', isRoom && !room.isHost);
  $('btnAgain').dataset.mode = isSolo ? 'solo' : 'room';
  if (!isSolo && !room.isHost) $('resSub').textContent += ' — بانتظار المضيف لجولة جديدة';
}

/* ============================== settings =========================== */
function openSettings() {
  $('settingsModal').classList.remove('hidden');
  const own = localStorage.getItem('mm2_key');
  $('keyStatus').textContent = own ? '🔑 تستخدم مفتاحك الخاص على هذا الجهاز.' : BUILT_IN_KEY ? '✅ مفتاح الذكاء الاصطناعي المدمج مفعّل لكل اللاعبين.' : '⚠️ لا يوجد مفتاح مدمج — الأسئلة من البنك الاحتياطي فقط.';
  $('inKey').value = own || '';
  $('seenCount').textContent = engine.seen.count;
  $('testOut').classList.add('hidden');
}

/* =============================== wiring ============================ */
function initHome() {
  $('inName').value = prefs.name;
  $('avatarPreview').textContent = prefs.avatar;
  $('avatarStrip').innerHTML = AVATARS.map((a) => `<button type="button" class="${a === prefs.avatar ? 'on' : ''}">${a}</button>`).join('');
  $('avatarStrip').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    prefs.avatar = b.textContent; savePrefs(); sfx.tap();
    $('avatarPreview').textContent = prefs.avatar;
    [...$('avatarStrip').children].forEach((x) => x.classList.toggle('on', x === b));
  };
  $('inName').onchange = () => { prefs.name = $('inName').value.trim(); savePrefs(); };
  seg($('soloTime'), TIME_OPTIONS, prefs.soloTime, (v) => { prefs.soloTime = v; savePrefs(); }, fmtTime);
  seg($('soloChoices'), CHOICE_OPTIONS, prefs.soloChoices, (v) => { prefs.soloChoices = v; savePrefs(); });
  const setSolo = (c) => { prefs.soloCfg = normalizeConfig(c); savePrefs(); renderSoloCfg(); };
  const renderSoloCfg = () => {
    renderPresets($('soloPresets'), () => prefs.soloCfg, setSolo);
    renderMatrix($('soloMatrix'), prefs.soloCfg, () => { savePrefs(); $('soloCfgSummary').textContent = cfgSummary(prefs.soloCfg); });
    $('soloCfgSummary').textContent = cfgSummary(prefs.soloCfg);
  };
  renderSoloCfg();
}

function wire() {
  $('btnHome').onclick = () => { if (mode === 'room') { if (confirm('تغادر الغرفة؟')) leaveRoom(); } else if (mode === 'solo') { if (confirm('تنهي الرحلة؟')) { mode = null; timer.stop(); show('viewHome'); } } else show('viewHome'); };
  $('btnCreate').onclick = createRoom;
  $('btnJoin').onclick = () => joinRoom();
  $('inCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
  $('inCode').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); });
  $('btnSolo').onclick = () => { if (profileOk()) solo.start(); };
  $('btnLeaveLobby').onclick = () => leaveRoom();
  $('btnStartRoom').onclick = () => room.host?.start();
  $('btnFinish').onclick = () => { if (confirm('تنهي المسابقة وتعلن النتيجة؟')) room.host?.finish(); };
  $('btnQuit').onclick = () => {
    if (mode === 'solo') { if (confirm('تنسحب وتاخد رصيدك الحالي؟')) solo.walk(); }
    else if (mode === 'room') { if (confirm(room.isHost ? 'خروجك هيقفل الغرفة للكل. متأكد؟' : 'تغادر الغرفة؟')) leaveRoom(); }
    else show('viewHome');
  };
  $('btnWalk').onclick = () => { if (confirm('تنسحب وتاخد رصيدك الحالي؟')) solo.walk(); };
  $('ll5050').onclick = () => solo.lifeline('5050');
  $('llAudience').onclick = () => solo.lifeline('aud');
  $('llFriend').onclick = () => solo.lifeline('friend');
  $('llSwitch').onclick = () => solo.lifeline('switch');
  $('prizeChip').onclick = () => $('ladder').classList.toggle('hidden');
  $('btnCloseLadder').onclick = () => $('ladder').classList.add('hidden');

  const inviteUrl = () => `${location.origin}${location.pathname}?room=${room.code}`;
  $('btnCopyCode').onclick = async () => { try { await navigator.clipboard.writeText(room.code); toast('تم نسخ الكود ✓'); } catch { toast(room.code); } };
  $('btnShare').onclick = async () => {
    const data = { title: 'من سيربح المليون', text: `ادخل غرفتي بالكود ${room.code}`, url: inviteUrl() };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); toast('تم نسخ الرابط ✓'); } } catch { /* */ }
  };
  $('btnWhats').onclick = () => window.open(`https://wa.me/?text=${encodeURIComponent(`تعالى نلعب من سيربح المليون 🏆 كود الغرفة: ${room.code}\n${inviteUrl()}`)}`, '_blank');

  $('reactionBar').innerHTML = REACTIONS.map((e) => `<button type="button">${e}</button>`).join('');
  $('reactionBar').onclick = (e) => { const b = e.target.closest('button'); if (b && room.link) { room.link.react(b.textContent, prefs.name); } };

  $('btnAgain').onclick = () => { if ($('btnAgain').dataset.mode === 'solo') solo.start(); else room.host?.backToLobby(); };
  $('btnResHome').onclick = () => { if (mode === 'room') leaveRoom(); else show('viewHome'); };
  $('btnShareRes').onclick = async () => {
    const text = `${$('resTitle').textContent} — ${$('resSub').textContent}\n${location.origin}${location.pathname}`;
    try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('تم النسخ ✓'); } } catch { /* */ }
  };

  $('btnSettings').onclick = openSettings;
  $('btnCloseSettings').onclick = () => $('settingsModal').classList.add('hidden');
  $('settingsModal').onclick = (e) => { if (e.target.id === 'settingsModal') $('settingsModal').classList.add('hidden'); };
  $('btnSaveKey').onclick = () => {
    const v = $('inKey').value.trim();
    if (v) localStorage.setItem('mm2_key', v); else localStorage.removeItem('mm2_key');
    engine.reset(); updateAiPill(); openSettings(); toast('تم الحفظ ✓');
  };
  $('btnTestAi').onclick = async () => {
    const out = $('testOut'); out.classList.remove('hidden'); out.textContent = 'جاري الاختبار…';
    const r = await engine.test();
    out.textContent = r.ok ? `✅ يعمل (${r.model})\n${r.sample ? `${r.sample.q}\n✔ ${r.sample.correct}` : ''}` : `❌ ${r.error}`;
  };
  $('btnClearSeen').onclick = () => { if (confirm('مسح سجل الأسئلة؟ ممكن تتكرر أسئلة قديمة.')) { engine.seen.clear(); $('seenCount').textContent = 0; } };

  const applyTheme = (t) => {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('mm2_theme', t);
    $('btnTheme').textContent = t === 'dark' ? '☀️' : '🌙';
    $('metaTheme').content = t === 'dark' ? '#0b1033' : '#f4f1ea';
  };
  applyTheme(document.documentElement.dataset.theme || 'dark');
  $('btnTheme').onclick = () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  const applySound = () => { $('btnSound').textContent = prefs.muted ? '🔇' : '🔊'; };
  applySound();
  $('btnSound').onclick = () => { prefs.muted = !prefs.muted; savePrefs(); applySound(); };

  let deferred = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; $('btnInstall').classList.remove('hidden'); });
  $('btnInstall').onclick = async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; $('btnInstall').classList.add('hidden'); };
  window.addEventListener('pagehide', () => { if (room.link) room.link.close(); });
}

initHome();
wire();
updateAiPill();
show('viewHome');
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
const roomParam = new URLSearchParams(location.search).get('room') || (location.hash.match(/room=(\d{5})/) || [])[1];
if (roomParam) { $('inCode').value = roomParam; if (prefs.name) joinRoom(roomParam); else { toast('اكتب اسمك واضغط انضمام'); $('inName').focus(); } }

// Expose for debugging/tests.
window.__mm = { engine, room, solo, prefs };
void brokerFor;
