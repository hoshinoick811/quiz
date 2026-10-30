/* 运维题库 · 前端逻辑 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const KIND_LABEL = {
    concept: '知识点',
    scenario: '场景题',
    code: '命令题',
    acceptance: '验收大题'
  };

  const DEFAULT_SETTINGS = { newPerDay: 5, maxPerSession: 12, timerSec: 45, mode: 'blend', theme: 'dark' };

  const state = {
    items: [],
    byId: {},
    events: [],
    states: {},
    mc: {},
    quiz: null,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    session: null,
    sync: 'idle',          // idle | on | off | busy
    browseFilter: 'all'
  };

  /* ================= IndexedDB ================= */

  const DB_NAME = 'quiz-db';
  const DB_VER = 1;
  const STORE = 'events';
  let dbPromise = null;
  let storageMode = 'idb';   // idb | ls（IndexedDB 不可用时降级到 localStorage）

  function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(label + ' timeout')), ms);
      promise.then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); }
      );
    });
  }

  function lsAll() {
    try {
      const raw = localStorage.getItem('quiz.events');
      return raw ? JSON.parse(raw) : [];
    } catch (_) { return []; }
  }

  function lsSave(list) {
    try { localStorage.setItem('quiz.events', JSON.stringify(list)); } catch (_) {}
  }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function dbAll() {
    if (storageMode === 'ls') return lsAll();
    try {
      const list = await withTimeout((async () => {
        const db = await openDB();
        return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
        });
      })(), 2000, 'idb-read');
      return list;
    } catch (err) {
      storageMode = 'ls';
      return lsAll();
    }
  }

  async function dbPut(ev) {
    if (storageMode === 'ls') {
      const all = lsAll().filter((e) => e.id !== ev.id);
      all.push(ev);
      lsSave(all);
      return;
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(ev);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbPutMany(list) {
    if (!list.length) return;
    if (storageMode === 'ls') {
      const byId = new Map(lsAll().map((e) => [e.id, e]));
      for (const e of list) byId.set(e.id, e);
      lsSave([...byId.values()]);
      return;
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const e of list) store.put(e);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbClear() {
    lsSave([]);
    if (storageMode === 'ls') return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /* ================= 工具 ================= */

  function uid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'e-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function deviceName() {
    return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'phone' : 'pc';
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem('quiz.settings');
      if (raw) Object.assign(state.settings, JSON.parse(raw));
    } catch (_) {}
  }

  function saveSettings() {
    try { localStorage.setItem('quiz.settings', JSON.stringify(state.settings)); } catch (_) {}
  }

  /* ---------- 主题 ---------- */

  function resolvedTheme() {
    const t = state.settings.theme || 'dark';
    if (t === 'system') {
      const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      return mq && mq.matches ? 'dark' : 'light';
    }
    return t === 'light' ? 'light' : 'dark';
  }

  function applyTheme() {
    const t = resolvedTheme();
    document.documentElement.setAttribute('data-theme', t);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#0f1115' : '#f4f5f9');
    $$('#themeSeg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === (state.settings.theme || 'dark'));
    });
  }

  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:96px', 'transform:translateX(-50%)',
      'background:rgba(23,25,34,.92)', 'color:#fff', 'padding:10px 16px',
      'border-radius:10px', 'font-size:13px', 'z-index:99', 'max-width:80vw',
      'text-align:center', 'transition:opacity .3s', 'pointer-events:none'
    ].join(';');
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 1600);
    setTimeout(() => el.remove(), 2000);
  }

  function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms || 3000);
    return fetch(url, Object.assign({}, opts, { signal: ctrl.signal }))
      .finally(() => clearTimeout(timer));
  }

  /* ================= 数据刷新 ================= */

  function recompute() {
    state.states = SRS.statesFromEvents(state.events, state.items);
  }

  async function loadQuestions() {
    // 单文件离线版会把题库直接内联进来
    if (window.__QUIZ_EMBEDDED__ && Array.isArray(window.__QUIZ_EMBEDDED__.items)) {
      applyBank(window.__QUIZ_EMBEDDED__);
      return;
    }
    const res = await fetch('./data/questions.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('题库加载失败 ' + res.status);
    applyBank(await res.json());
  }

  function applyBank(data) {
    state.items = data.items || [];
    state.byId = {};
    for (const it of state.items) state.byId[it.id] = it;
    state.chapters = data.chapters || [];
  }

  async function loadChoices() {
    if (window.__QUIZ_MC__ && window.__QUIZ_MC__.items) {
      state.mc = window.__QUIZ_MC__.items;
      return;
    }
    try {
      const res = await fetch('./data/mc.json', { cache: 'no-cache' });
      if (!res.ok) { state.mc = {}; return; }
      const data = await res.json();
      state.mc = data.items || {};
    } catch (_) {
      state.mc = {};
    }
  }

  /* ================= 同步 ================= */

  function setSync(v) {
    state.sync = v;
    const chip = $('#syncChip');
    const label = $('#srvState');
    if (v === 'on') {
      chip.hidden = true;
      if (label) label.textContent = '已连接';
      if (label) label.style.color = '#16a34a';
    } else if (v === 'off') {
      chip.hidden = true;
      if (label) label.textContent = '未连接（本机离线）';
      if (label) label.style.color = '#6b7280';
    } else if (v === 'busy') {
      chip.hidden = false;
      chip.textContent = '同步中';
    }
    const addr = $('#srvAddr');
    if (addr) addr.textContent = apiBase() || (location.protocol.startsWith('http') ? location.origin : '未设置（本机离线）');
  }

  function apiBase() {
    // 1) 设置里手工填的同步地址（离线单文件版用）
    const s = (state.settings.server || '').trim();
    if (s) return s.replace(/\/+$/, '');
    // 2) 从本机服务打开的页面，同源即可
    if (location.protocol.startsWith('http')) return '';
    return '';
  }

  function syncAvailable() {
    return !!apiBase() || location.protocol.startsWith('http');
  }

  async function trySync(manual) {
    if (!syncAvailable()) {
      setSync('off');
      if (manual) toast('还没设同步地址：先在设置里填电脑的 http://IP:8765');
      return;
    }
    const base = apiBase();
    try {
      setSync('busy');
      const ping = await fetchWithTimeout(base + '/api/ping', { cache: 'no-store' }, 2500);
      if (!ping.ok) throw new Error('ping failed');
      await ping.json();

      const r = await fetchWithTimeout(base + '/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: state.events })
      }, 15000);
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || 'sync failed');

      const known = new Set(state.events.map((e) => e.id));
      const add = (data.events || []).filter((e) => !known.has(e.id));
      if (add.length) {
        await dbPutMany(add);
        state.events = state.events.concat(add);
        recompute();
        renderHome();
        renderBrowse();
      }
      setSync('on');
      if (manual) {
        toast(add.length ? `同步完成，新增 ${add.length} 条记录` : '同步完成，已是最新');
      }
      refreshSettings();
    } catch (err) {
      setSync('off');
      if (manual) toast('连不上服务，数据已存本地');
    }
  }

  let syncTimer = null;
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => trySync(false), 4000);
  }

  /* ================= 记录事件 ================= */

  async function record(itemId, kind, note) {
    const ev = {
      id: uid(),
      item: itemId,
      ts: Date.now(),
      k: kind,
      dev: deviceName(),
      note: note || ''
    };
    await dbPut(ev);
    state.events.push(ev);
    recompute();
    scheduleSync();
    return ev;
  }

  /* ================= 视图切换 ================= */

  function show(view) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $('#tabbar').style.display = (view === 'quiz' || view === 'done') ? 'none' : 'flex';
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  /* ================= 首页 ================= */

  function queuePreview() {
    return SRS.buildQueue(state.items, state.states, {
      newPerDay: state.settings.newPerDay,
      maxPerSession: state.settings.maxPerSession
    });
  }

  function renderHome() {
    const now = Date.now();
    const total = state.items.length;
    let grad = 0, learned = 0, wrong = 0, fresh = 0;
    for (const it of state.items) {
      const st = state.states[it.id];
      if (st.graduated) grad += 1;
      if (st.seen) learned += 1;
      if (st.seen && !st.graduated) wrong += 1;
      if (!st.seen) fresh += 1;
    }
    const dueCount = state.items.filter((it) => {
      const st = state.states[it.id];
      return st.seen && !st.graduated && st.due <= now;
    }).length;

    const q = queuePreview();
    $('#queueCount').innerHTML = q.length + '<span>题</span>';
    $('#queueBreakdown').textContent =
      `到期 ${dueCount} 题 · 新题 ${Math.min(fresh, state.settings.newPerDay)} 题` +
      (fresh > 0 && dueCount === 0 ? '（今天先开个头）' : '');

    $('#statGrad').textContent = grad;
    $('#statLearned').textContent = learned;
    $('#statWrong').textContent = wrong;

    const pct = total ? Math.round((grad / total) * 100) : 0;
    $('#ringFg').style.strokeDashoffset = String(188.5 * (1 - pct / 100));
    $('#ringLabel').textContent = pct + '%';

    $('#streakNum').textContent = SRS.streakDays(state.events);
    $('#todayLabel').textContent = q.length ? '今天的队列' : '今天没有待练的题';

    const btn = $('#btnStart');
    btn.disabled = q.length === 0;
    btn.textContent = q.length === 0
      ? (fresh === 0 && wrong === 0 ? '这一章已经全部毕业 🎉' : '今天已完成，明天再来')
      : `开始今天 ${q.length} 题`;

    renderChapters('#chapterList', false);
  }

  function renderChapters(sel, withStats) {
    const rows = SRS.chapterProgress(state.items, state.states);
    const chapName = (ch) => {
      const c = (state.chapters || []).find((x) => x.id === ch);
      return c ? c.title : '第 ' + ch + ' 章';
    };
    $(sel).innerHTML = rows.map((r) => {
      const pct = r.total ? Math.round((r.grad / r.total) * 100) : 0;
      return `<div class="chap-row">
        <div class="chap-top">
          <span class="chap-name">${chapName(r.ch)}</span>
          <span class="chap-num">${r.grad}/${r.total} 毕业 · ${pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill warm" style="width:${pct}%"></div></div>
      </div>`;
    }).join('') || '<p class="hint">还没有内容</p>';
  }

  /* ================= 答题 ================= */

  let timerHandle = null;

  function startSession(mode) {
    const q = SRS.buildQueue(state.items, state.states, {
      newPerDay: state.settings.newPerDay,
      maxPerSession: state.settings.maxPerSession,
      mode: mode || 'normal'
    });
    if (!q.length) {
      toast('没有要练的题了');
      return;
    }
    state.session = {
      queue: q.map((it) => it.id),
      index: 0,
      results: { good: 0, half: 0, again: 0 },
      repeats: {},
      mode: mode || 'normal',
      started: Date.now()
    };
    show('quiz');
    renderQuestion();
  }

  function currentItem() {
    const s = state.session;
    if (!s) return null;
    return state.byId[s.queue[s.index]] || null;
  }

  function renderQuestion() {
    const s = state.session;
    const it = currentItem();
    if (!it) return finishSession();

    $('#qCounter').textContent = `${s.index + 1}/${s.queue.length}`;
    $('#qProgress').style.width = ((s.index) / s.queue.length) * 100 + '%';

    $('#qKind').textContent = KIND_LABEL[it.kind] || '题目';
    $('#qLevel').textContent = '难度 ' + it.level;
    $('#qTag').textContent = (it.tag || [])[0] || '';

    $('#qText').textContent = it.q;

    const box = $('#answerBox');
    box.hidden = true;
    $('#answerList').innerHTML = (it.a || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('');

    const follow = it.follow || [];
    $('#followBox').hidden = follow.length === 0;
    $('#followList').innerHTML = follow.map((x) => `<li>${escapeHtml(x)}</li>`).join('');

    $('#gradeBar').hidden = true;
    $('#btnReveal').hidden = false;
    $('#btnReveal').disabled = false;
    $('#btnNext').hidden = true;

    state.quiz = { useMC: false, answered: false, mc: null, order: null };
    setupChoices(it);

    const st = state.states[it.id] || {};
    const verifyLine = $('#verifyLine');
    if (it.verify && !state.quiz.useMC) {
      verifyLine.hidden = false;
      $('#verifyCheck').checked = !!st.verified;
    } else {
      verifyLine.hidden = true;
      $('#verifyCheck').checked = false;
    }

    startTimer(state.settings.timerSec, state.quiz.useMC ? function () {} : null);
  }

  /* ---------- 选择题 ---------- */

  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function shuffleSeeded(list, seed) {
    const a = list.slice();
    let s = seed >>> 0;
    for (let i = a.length - 1; i > 0; i--) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const j = s % (i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function setupChoices(it) {
    const box = $('#optionsBox');
    const mc = state.mc && state.mc[it.id];
    const mode = state.settings.mode || 'blend';
    const eligible = !!mc && Array.isArray(mc.options) && mc.options.length >= 2;
    const useMC = eligible && mode !== 'oral' && (mode === 'choice' || it.kind === 'concept');

    state.quiz.useMC = useMC;
    state.quiz.mc = eligible ? mc : null;

    if (!useMC) {
      box.hidden = true;
      box.innerHTML = '';
      $('#qHint').textContent = '先自己说出来，说完再点下面的按钮。说不全没关系，卡住的地方才是要记的。';
      $('#btnReveal').textContent = '看答案';
      $('#btnReveal').classList.remove('ghost');
      return;
    }

    const order = shuffleSeeded(mc.options.map((_, i) => i), hashStr(it.id));
    state.quiz.order = order;
    box.innerHTML = order.map((orig, pos) =>
      '<button type="button" class="opt" data-orig="' + orig + '">'
      + '<span class="mark">' + 'ABCD'[pos] + '</span>'
      + '<span class="otext">' + escapeHtml(mc.options[orig]) + '</span>'
      + '</button>').join('');
    box.hidden = false;
    $('#qHint').textContent = '先在心里答一遍，再点选项。选完立刻给正确答案和完整要点。';
    $('#btnReveal').textContent = '不会，直接看答案（记为不会）';
    $('#btnReveal').classList.add('ghost');
  }

  function markChoiceResult(orig) {
    const mc = state.quiz.mc;
    $$('#optionsBox .opt').forEach((btn) => {
      const o = Number(btn.dataset.orig);
      btn.classList.add('done');
      btn.disabled = true;
      if (o === mc.answer) btn.classList.add('correct');
      else if (o === orig) btn.classList.add('wrong');
      else btn.classList.add('muted');
    });
    const box = $('#timerBox');
    if (box) box.style.display = 'none';
  }

  function showNextButton() {
    const s = state.session;
    $('#answerBox').hidden = false;
    $('#btnReveal').hidden = true;
    $('#btnNext').hidden = false;
    $('#btnNext').textContent = (s && s.index + 1 >= s.queue.length) ? '看结算' : '下一题';
  }

  async function chooseOption(orig) {
    const q = state.quiz;
    const it = currentItem();
    if (!q || !q.useMC || q.answered || !it) return;

    q.answered = true;
    stopTimer();
    markChoiceResult(orig);
    showNextButton();

    const correct = Number(orig) === Number(q.mc.answer);
    if (it.verify && correct) {
      $('#verifyLine').hidden = false;
      $('#verifyCheck').checked = !!(state.states[it.id] || {}).verified;
    }

    await commit(correct ? 'good' : 'again', it);
  }

  async function abandonChoice() {
    const q = state.quiz;
    const it = currentItem();
    if (!q || !q.useMC || q.answered || !it) return;

    q.answered = true;
    stopTimer();
    markChoiceResult(-1);
    showNextButton();
    await commit('again', it);
  }

  async function commit(kind, it) {
    const s = state.session;
    s.results[kind] = (s.results[kind] || 0) + 1;
    await record(it.id, kind);
    if (kind === 'again') {
      const times = s.repeats[it.id] || 0;
      if (times < 2) {
        s.repeats[it.id] = times + 1;
        s.queue.push(it.id);
      }
    }
  }

  function advance() {
    const s = state.session;
    if (!s) return;
    s.index += 1;
    if (s.index >= s.queue.length) return finishSession();
    renderQuestion();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function startTimer(sec, onEnd) {
    stopTimer();
    const box = $('#timerBox');
    const fill = $('#timerFill');
    const text = $('#timerText');
    box.classList.remove('done');

    if (!sec || sec <= 0) {
      box.style.display = 'none';
      return;
    }
    box.style.display = 'flex';
    let left = sec;
    fill.style.transition = 'none';
    fill.style.width = '100%';
    text.textContent = left + 's';

    timerHandle = setInterval(() => {
      left -= 1;
      const pct = Math.max(0, left / sec) * 100;
      fill.style.width = pct + '%';
      text.textContent = Math.max(0, left) + 's';
      if (left <= 0) {
        stopTimer();
        box.classList.add('done');
        text.textContent = '时间到';
        if (typeof onEnd === 'function') onEnd();
        else reveal(true);
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) {
      clearInterval(timerHandle);
      timerHandle = null;
    }
  }

  function reveal(auto) {
    stopTimer();
    const box = $('#timerBox');
    if (auto) {
      box.classList.add('done');
      $('#timerText').textContent = '时间到';
    } else if (box.style.display !== 'none') {
      // 自己主动点「看答案」时，计时条没有意义了，收起来免得误读成报错
      box.style.display = 'none';
    }
    $('#answerBox').hidden = false;
    $('#btnReveal').hidden = true;
    $('#gradeBar').hidden = false;
    $('#answerBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function grade(k) {
    const it = currentItem();
    if (!it) return;
    stopTimer();
    await commit(k, it);
    advance();
  }

  function finishSession() {
    stopTimer();
    const s = state.session;
    const done = s ? s.index : 0;
    const r = s ? s.results : { good: 0, half: 0, again: 0 };

    const colors = ['✓', '●', '○'];
    $('#doneEmoji').textContent = r.again > r.good ? '💪' : '✓';
    $('#doneTitle').textContent = done ? '这一轮跑完了' : '没有题目';
    $('#doneSub').textContent = done
      ? `做了 ${done} 题 · 用时 ${Math.max(1, Math.round((Date.now() - s.started) / 60000))} 分钟`
      : '';

    $('#doneGrid').innerHTML = `
      <div><b>${r.good}</b>会</div>
      <div><b>${r.half}</b>半对</div>
      <div><b>${r.again}</b>不会</div>`;

    state.session = null;
    renderHome();
    show('done');

    const hasMore = queuePreview().length > 0;
    $('#btnAgain').style.display = hasMore ? 'block' : 'none';
  }

  /* ================= 题库浏览 ================= */

  function stateChip(st) {
    if (!st.seen) return '<span class="state unseen">没做过</span>';
    if (st.graduated) return '<span class="state grad">已毕业</span>';
    if (st.streak > 0) return '<span class="state learn">在推进</span>';
    return '<span class="state wrong">待攻克</span>';
  }

  function renderBrowse() {
    const f = state.browseFilter;
    const list = state.items.filter((it) => {
      const st = state.states[it.id];
      if (f === 'wrong') return st.seen && !st.graduated;
      if (f === 'grad') return st.graduated;
      if (f === 'unseen') return !st.seen;
      return true;
    });

    $('#browseList').innerHTML = list.map((it) => {
      const st = state.states[it.id];
      return `<div class="brow-item" data-id="${it.id}">
        <div class="brow-q">${escapeHtml(it.q)}</div>
        <div class="brow-meta">
          ${stateChip(st)}
          <span>${KIND_LABEL[it.kind] || ''}</span>
          <span>难度 ${it.level}</span>
          ${it.verify ? '<span>需实机验证</span>' : ''}
        </div>
        <div class="brow-body"><ol>${(it.a || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('')}</ol></div>
      </div>`;
    }).join('') || '<p class="hint">这个分类下没有题目。</p>';
  }

  /* ================= 统计 ================= */

  function renderStats() {
    const days = SRS.dayCounts(state.events, 14);
    const max = Math.max(1, ...days.map((d) => d.count));
    $('#dayBars').innerHTML = days.map((d) => {
      const h = Math.round((d.count / max) * 100);
      // 手机上 14 根柱子，标签只写「日」，完整日期放 title
      const label = String(Number(d.key.slice(8)));
      return `<div class="bar-col" title="${d.key}：${d.count} 题">
        <div class="b ${d.count ? 'on' : ''}" style="height:${Math.max(3, h)}%"></div>
        <div class="l">${label}</div>
      </div>`;
    }).join('');

    const range = $('#rangeLabel');
    if (range) {
      const first = days[0].key.slice(5).replace('-', '/');
      const last = days[days.length - 1].key.slice(5).replace('-', '/');
      range.textContent = `${first} – ${last}`;
    }

    renderChapters('#chapterStats', true);

    $('#evCount').textContent = state.events.length;
    const sorted = state.events.slice().sort((a, b) => a.ts - b.ts);
    $('#evFirst').textContent = sorted.length ? fmtDate(sorted[0].ts) : '—';
    $('#evLast').textContent = sorted.length ? fmtDate(sorted[sorted.length - 1].ts) : '—';
  }

  /* ================= 设置 ================= */

  async function loadPhoneUrl() {
    const el = $('#phoneUrl');
    if (!el) return;
    const localHosts = ['localhost', '127.0.0.1', '0.0.0.0', ''];
    const fromServer = location.protocol.startsWith('http');

    // 已经用局域网地址打开（手机端），直接显示当前地址
    if (fromServer && !localHosts.includes(location.hostname)) {
      el.textContent = location.origin;
      return;
    }
    if (!fromServer) {
      el.textContent = '看电脑上控制台打印的地址';
      return;
    }
    // 电脑端：问服务端要「手机该用的那个网卡地址」
    try {
      const r = await fetchWithTimeout('./api/info', { cache: 'no-store' }, 3000);
      const d = await r.json();
      el.textContent = d.primary || (d.urls && d.urls[0]) || '未检测到局域网地址';
    } catch (_) {
      el.textContent = '未检测到局域网地址';
    }
  }

  function refreshSettings() {
    $('#setNew').value = state.settings.newPerDay;
    $('#setMax').value = state.settings.maxPerSession;
    $('#setTimer').value = state.settings.timerSec;
    const srv = $('#setServer');
    if (srv) srv.value = state.settings.server || '';
    $$('#modeSeg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === (state.settings.mode || 'blend'));
    });
    $$('#themeSeg .seg-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.theme === (state.settings.theme || 'dark'));
    });
    setSync(state.sync === 'idle' ? 'off' : state.sync);
  }

  function bindSettings() {
    const apply = (key, el, min, max) => {
      el.addEventListener('change', () => {
        let v = parseInt(el.value, 10);
        if (!Number.isFinite(v)) v = DEFAULT_SETTINGS[key];
        v = Math.max(min, Math.min(max, v));
        el.value = v;
        state.settings[key] = v;
        saveSettings();
        renderHome();
      });
    };
    apply('newPerDay', $('#setNew'), 1, 20);
    apply('maxPerSession', $('#setMax'), 3, 30);
    apply('timerSec', $('#setTimer'), 0, 300);

    const srvInput = $('#setServer');
    if (srvInput) {
      srvInput.addEventListener('change', () => {
        state.settings.server = String(srvInput.value || '').trim();
        saveSettings();
        trySync(true);
      });
    }

    $('#btnSyncNow').addEventListener('click', () => trySync(true));

    const modeSeg = $('#modeSeg');
    if (modeSeg) {
      modeSeg.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('.seg-btn') : null;
        if (!b || !b.dataset.mode) return;
        state.settings.mode = b.dataset.mode;
        saveSettings();
        refreshSettings();
        toast('答题形态已切换');
      });
    }

    const themeSeg = $('#themeSeg');
    if (themeSeg) {
      themeSeg.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('.seg-btn') : null;
        if (!b || !b.dataset.theme) return;
        state.settings.theme = b.dataset.theme;
        saveSettings();
        applyTheme();
      });
    }

    $('#btnExport').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), events: state.events }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `quiz-events-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast('已导出');
    });

    $('#btnImport').addEventListener('click', () => $('#fileImport').click());
    $('#fileImport').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data : (data.events || []);
        const known = new Set(state.events.map((x) => x.id));
        const add = list.filter((x) => x && x.id && !known.has(x.id));
        await dbPutMany(add);
        state.events = state.events.concat(add);
        recompute();
        renderHome(); renderBrowse(); renderStats();
        toast(`导入 ${add.length} 条记录`);
      } catch (err) {
        toast('导入失败：文件格式不对');
      }
      e.target.value = '';
    });

    $('#btnReset').addEventListener('click', async () => {
      if (!confirm('清空本机所有答题记录？这个操作不可撤销，建议先导出。')) return;
      await dbClear();
      state.events = [];
      recompute();
      renderHome(); renderBrowse(); renderStats();
      toast('已清空');
    });
  }

  /* ================= 事件绑定 ================= */

  function bind() {
    $$('.tab').forEach((t) => t.addEventListener('click', () => {
      const v = t.dataset.view;
      show(v);
      if (v === 'browse') renderBrowse();
      if (v === 'stats') renderStats();
      if (v === 'settings') refreshSettings();
      if (v === 'home') renderHome();
    }));

    $('#btnStart').addEventListener('click', () => startSession('normal'));
    $('#btnQuit').addEventListener('click', () => {
      if (state.session && state.session.index > 0) {
        if (!confirm('这一轮还没跑完，确定退出？已做的题都已保存。')) return;
      }
      stopTimer();
      state.session = null;
      renderHome();
      show('home');
    });

    $('#btnReveal').addEventListener('click', () => {
      if (state.quiz && state.quiz.useMC && !state.quiz.answered) return abandonChoice();
      reveal(false);
    });

    $('#btnNext').addEventListener('click', () => advance());

    $('#optionsBox').addEventListener('click', (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('.opt') : null;
      if (!btn || btn.disabled) return;
      chooseOption(btn.dataset.orig);
    });

    $$('.grade').forEach((b) => b.addEventListener('click', () => grade(b.dataset.k)));

    $('#verifyCheck').addEventListener('change', async (e) => {
      const it = currentItem();
      if (!it) return;
      if (e.target.checked) {
        await record(it.id, 'verify');
        toast('已标记为实机验证');
      } else {
        toast('撤销需要在设置里清空该题记录（暂不支持单独撤销）');
        const st = state.states[it.id];
        e.target.checked = !!st.verified;
      }
    });

    $('#btnDoneHome').addEventListener('click', () => { renderHome(); show('home'); });
    $('#btnAgain').addEventListener('click', () => startSession('normal'));

    $('#browseSeg').addEventListener('click', (e) => {
      const b = e.target.closest('.seg-btn');
      if (!b) return;
      $$('#browseSeg .seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      state.browseFilter = b.dataset.filter;
      renderBrowse();
    });

    $('#browseList').addEventListener('click', (e) => {
      const card = e.target.closest('.brow-item');
      if (!card) return;
      card.classList.toggle('open');
    });

    bindSettings();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') trySync(false);
    });
    window.addEventListener('online', () => trySync(false));
  }

  /* ================= 启动 ================= */

  function bootError(err) {
    const box = document.querySelector('#view-home');
    const msg = String((err && (err.stack || err.message)) || err);
    if (box) {
      box.innerHTML = '<div class="card"><h2>页面启动失败</h2><p class="hint">'
        + escapeHtml(msg) + '</p><p class="hint">把这段信息发给我就能定位。</p></div>';
      box.classList.add('active');
    }
    const bar = document.querySelector('#tabbar');
    if (bar) bar.style.display = 'flex';
  }

  function showBuild() {
    const el = $('#footLine');
    const meta = document.querySelector('meta[name="build"]');
    if (!el || !meta) return;
    el.textContent += ' · 构建 ' + meta.getAttribute('content');
  }

  async function init() {
    loadSettings();
    applyTheme();
    bind();
    showBuild();

    try {
      await loadQuestions();
    } catch (err) {
      bootError(err);
      return;
    }

    await loadChoices();

    // 先把界面顶上去（此时答题记录还没读出来），读完再刷一次，
    // 避免某些浏览器 IndexedDB 卡住时首页一片空白、按钮点了没反应。
    recompute();
    renderHome();
    const startView = ['browse', 'stats', 'settings'].indexOf((location.hash || '').slice(1)) >= 0
      ? (location.hash || '').slice(1)
      : 'home';
    show(startView);
    if (startView === 'browse') renderBrowse();
    if (startView === 'stats') renderStats();
    refreshSettings();
    loadPhoneUrl();

    try {
      state.events = await dbAll();
    } catch (_) {
      state.events = [];
    }

    recompute();
    renderHome();
    renderBrowse();

    // Service Worker 只在安全上下文可用；http://局域网IP 属于不安全上下文，注册会失败
    if (location.protocol === 'https:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1') {
      if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
      }
    }

    trySync(false);

    // 跟随系统时，系统切换深色要实时跟上
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      if (mq && typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', () => {
          if ((state.settings.theme || 'dark') === 'system') applyTheme();
        });
      }
    }
  }

  window.addEventListener('error', (e) => {
    if (!state.items.length) bootError(e.error || e.message);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (!state.items.length) bootError(e.reason);
  });

  // 调试/测试用钩子，正常使用不会触发
  if (window.__QUIZ_DEBUG__) {
    window.QUIZ = {
      state,
      chooseOption,
      abandonChoice,
      advance,
      renderQuestion,
      startSession,
      applyTheme
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
