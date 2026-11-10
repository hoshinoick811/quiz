/* 前端集成测试：用最小 DOM 沙盒真正跑一遍 app.js 的启动与答题流程 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const SRS_CODE = fs.readFileSync(path.join(ROOT, 'public/srs.js'), 'utf8');
const DATA = path.join(ROOT, 'public/data');
// 题库按章拆分，fetch 桩直接把 URL 里的文件名映射到磁盘
const readData = (name) => JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));

const OFFLINE = process.argv.includes('--offline');
let SRC = [];
if (OFFLINE) {
  const off = fs.readFileSync(path.join(ROOT, 'public/quiz-offline.html'), 'utf8');
  SRC = [...off.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m, i) => ({
    name: 'offline-inline-' + i, code: m[1]
  }));
} else {
  SRC = [{ name: 'srs.js', code: SRS_CODE }, { name: 'app.js', code: APP }];
}

let fail = 0;
const ok = (n, c, extra) => {
  console.log((c ? '  PASS  ' : '  FAIL  ') + n + (!c && extra ? '  → ' + extra : ''));
  if (!c) fail++;
};

/* ---------- 最小 DOM ---------- */

function makeEl(id, tag) {
  const el = {
    id: id || '', tagName: tag || 'div',
    _cls: new Set(), _listeners: {},
    style: {}, dataset: {}, hidden: false, disabled: false, value: '',
    textContent: '', innerHTML: '', checked: false,
    classList: {
      add(c) { el._cls.add(c); },
      remove(c) { el._cls.delete(c); },
      toggle(c, on) {
        if (on === undefined) { el._cls.has(c) ? el._cls.delete(c) : el._cls.add(c); }
        else if (on) el._cls.add(c); else el._cls.delete(c);
      },
      contains(c) { return el._cls.has(c); }
    },
    addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
    dispatch(type, ev) { (el._listeners[type] || []).forEach((f) => f(ev || {})); },
    scrollIntoView() {}, closest() { return null; }, click() {}, remove() {},
    appendChild() {}, focus() {}
  };
  return el;
}

const ids = [...HTML.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const byId = {};
for (const id of ids) byId[id] = makeEl(id);

// 「隐藏视图」的 active 类
const views = ids.filter((i) => i.startsWith('view-')).map((i) => byId[i]);
const tabs = [];
['home', 'browse', 'stats', 'settings'].forEach((v) => {
  const t = makeEl('', 'button');
  t.dataset.view = v;
  tabs.push(t);
});
if (byId['tabbar']) byId['tabbar'].style = {};

const segBtns = ['all', 'wrong', 'grad', 'unseen'].map((f) => {
  const b = makeEl('', 'button');
  b.dataset.filter = f;
  return b;
});

const gradeBtns = ['again', 'half', 'good'].map((k) => {
  const b = makeEl('', 'button');
  b.dataset.k = k;
  return b;
});

const created = [];

const document = {
  readyState: 'complete',
  documentElement: {
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k]; }
  },
  body: { appendChild(el) { created.push(el); } },
  querySelector(sel) {
    const m = sel.match(/^#([\w-]+)$/);
    if (m) return byId[m[1]] || null;
    return null;
  },
  querySelectorAll(sel) {
    if (sel === '.view') return views;
    if (sel === '.tab') return tabs;
    if (sel === '.grade') return gradeBtns;
    if (sel.includes('.seg-btn')) return segBtns;
    return [];
  },
  createElement(tag) { const e = makeEl('', tag); return e; },
  addEventListener() {}
};

const storage = new Map();
const localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

storage.set('quiz.settings', JSON.stringify({ mode: 'oral', newPerDay: 5, maxPerSession: 12, timerSec: 45 }));

const fetched = [];
const fetchStub = async (url) => {
  fetched.push(url);
  if (OFFLINE) throw new Error('offline: 离线版不该联网');
  const m = /data\/([A-Za-z0-9_.-]+\.json)/.exec(url);
  if (m) {
    return { ok: true, status: 200, json: async () => readData(m[1]) };
  }
  throw new Error('offline');   // api/ping 一律失败，走离线分支
};

const timers = [];
const sandbox = {
  console,
  Date, Math, JSON, Promise, Object, Array, String, Number, Boolean, Error, Map, Set, RegExp,
  setTimeout: (fn, ms) => { const h = setTimeout(fn, Math.min(ms, 1)); timers.push(h); return h; },
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (fn, ms) => { const h = setInterval(fn, ms); timers.push(h); return h; },
  clearInterval: (h) => clearInterval(h),
  crypto: require('node:crypto').webcrypto,
  fetch: fetchStub,
  document,
  localStorage,
  navigator: { userAgent: 'node-test', serviceWorker: undefined },
  location: OFFLINE
    ? { protocol: 'file:', origin: 'null', search: '', hostname: '' }
    : { protocol: 'http:', origin: 'http://127.0.0.1:8765', search: '', hostname: '127.0.0.1' },
  confirm: () => true,
  alert: () => {},
  indexedDB: undefined,
  Blob: function () {},
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
  AbortController
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.__QUIZ_DEBUG__ = true;
sandbox.window.addEventListener = (type, fn) => {
  (sandbox.__winListeners = sandbox.__winListeners || {})[type] = fn;
};
sandbox.window.scrollTo = () => {};
sandbox.window.matchMedia = () => ({ matches: false });

/* ---------- 运行 ---------- */

(async () => {
  console.log('\n[1] 启动 app.js' + (OFFLINE ? '（离线单文件版）' : '（服务版）'));
  vm.createContext(sandbox);
  for (const s of SRC) {
    vm.runInContext(s.code, sandbox, { filename: s.name });
  }
  ok('脚本已注入（' + SRC.length + ' 段）', SRC.length >= 2);
  if (!OFFLINE) ok('srs.js 挂到 window.SRS', typeof sandbox.SRS === 'object');

  // init() 是异步的：等它跑完
  await new Promise((r) => setTimeout(r, 80));

  if (OFFLINE) {
    ok('离线版没有发起任何网络请求', fetched.length === 0, JSON.stringify(fetched));
  } else {
    ok('题库已加载',
       fetched.some((u) => u.includes('index.json')) && fetched.some((u) => /ch\d+\.json/.test(u)),
       JSON.stringify(fetched));
  }
  ok('首页被激活', byId['view-home']._cls.has('active'),
     'classList=' + [...byId['view-home']._cls].join(','));
  ok('首页没有报错', !String(byId['view-home'].innerHTML).includes('页面启动失败'),
     String(byId['view-home'].innerHTML).slice(0, 200));
  ok('队列数 = 5（默认每天 5 道新题）', String(byId['queueCount'].innerHTML).startsWith('5'),
     'got=' + byId['queueCount'].innerHTML);
  ok('章节进度渲染出来了', String(byId['chapterList'].innerHTML).includes('Linux'),
     String(byId['chapterList'].innerHTML).slice(0, 120));
  ok('开始按钮可用', byId['btnStart'].disabled === false);
  ok('底栏 4 个 tab', tabs.length === 4);

  console.log('\n[2] 走完一题');
  byId['btnStart'].dispatch('click');
  ok('切到答题视图', byId['view-quiz']._cls.has('active'));
  const qText = byId['qText'].textContent;
  ok('题干已填充', typeof qText === 'string' && qText.length > 4, 'q=' + qText);
  ok('答案是隐藏的（先答后看）', byId['answerBox'].hidden === true);
  ok('评分条一开始隐藏', byId['gradeBar'].hidden === true);
  ok('计数器显示 1/N', /^1\//.test(byId['qCounter'].textContent), byId['qCounter'].textContent);

  byId['btnReveal'].dispatch('click');
  ok('点「看答案」后答案出现', byId['answerBox'].hidden === false);
  ok('评分条出现', byId['gradeBar'].hidden === false);
  ok('答案要点非空', String(byId['answerList'].innerHTML).includes('<li>'));

  const before = byId['qCounter'].textContent;
  gradeBtns[2].dispatch('click');   // 「会」
  await new Promise((r) => setTimeout(r, 30));
  ok('评分后进入下一题', byId['qCounter'].textContent !== before,
     before + ' → ' + byId['qCounter'].textContent);

  const stored = JSON.parse(storage.get('quiz.events') || '[]');
  ok('记录写进本地存储（IndexedDB 不可用时降级）', stored.length === 1 && stored[0].k === 'good',
     JSON.stringify(stored));

  console.log('\n[3] 一键刷完剩余题目');
  let guard = 0;
  while (byId['view-quiz']._cls.has('active') && guard++ < 40) {
    if (byId['btnReveal'].hidden === false) byId['btnReveal'].dispatch('click');
    gradeBtns[2].dispatch('click');
    await new Promise((r) => setTimeout(r, 15));
  }
  ok('最终进入结算页', byId['view-done']._cls.has('active'),
     'guard=' + guard + ' quizActive=' + byId['view-quiz']._cls.has('active'));
  ok('结算页显示题数', String(byId['doneGrid'].innerHTML).includes('<b>'));

  const finalEvents = JSON.parse(storage.get('quiz.events') || '[]');
  ok('共记录 5 题', finalEvents.length >= 5, 'n=' + finalEvents.length);

  console.log('\n[4] 首页状态已刷新');
  ok('已毕业/学过计数更新', byId['statLearned'].textContent === 5 || byId['statLearned'].textContent === '5',
     'learned=' + byId['statLearned'].textContent);

  console.log('\n[5] 选择题');
  const Q = sandbox.window.QUIZ;
  ok('调试钩子可用', !!Q);
  if (Q) {
    Q.state.session = {
      queue: ['c01-q06'], index: 0,
      results: { good: 0, half: 0, again: 0 },
      repeats: {}, mode: 'normal', started: Date.now()
    };
    Q.state.settings.mode = 'blend';
    Q.renderQuestion();
    ok('知识点题进入选择题模式', Q.state.quiz.useMC === true);
    ok('选项已渲染', String(byId['optionsBox'].innerHTML).includes('class="opt"'),
       String(byId['optionsBox'].innerHTML).slice(0, 80));
    ok('有选项时评分条仍隐藏', byId['gradeBar'].hidden === true);

    const n0 = JSON.parse(storage.get('quiz.events') || '[]').length;
    await Q.chooseOption(Q.state.quiz.mc.answer);
    const evs = JSON.parse(storage.get('quiz.events') || '[]');
    ok('答对记录为 good', evs.length === n0 + 1 && evs[evs.length - 1].k === 'good',
       JSON.stringify(evs[evs.length - 1]));

    Q.state.session.index = 0;
    Q.state.session.queue = ['c01-q06'];
    Q.renderQuestion();
    const wrongIdx = (Number(Q.state.quiz.mc.answer) + 1) % Q.state.quiz.mc.options.length;
    await Q.chooseOption(wrongIdx);
    const evs2 = JSON.parse(storage.get('quiz.events') || '[]');
    ok('答错记录为 again', evs2[evs2.length - 1].k === 'again',
       JSON.stringify(evs2[evs2.length - 1]));

    // 场景题不应该出选项
    Q.state.session.queue = ['c01-q22'];
    Q.state.session.index = 0;
    Q.renderQuestion();
    ok('场景题保持口述（不出选项）', Q.state.quiz.useMC === false);

    ok('默认深色', document.documentElement.getAttribute('data-theme') === 'dark',
       'theme=' + document.documentElement.getAttribute('data-theme'));
    Q.state.settings.theme = 'light';
    Q.applyTheme();
    ok('切到浅色生效', document.documentElement.getAttribute('data-theme') === 'light');
    Q.state.settings.theme = 'dark';
    Q.applyTheme();
    ok('切回深色生效', document.documentElement.getAttribute('data-theme') === 'dark');
  }

  console.log('\n[7] 统计页窄屏');
  tabs[2].dispatch('click');
  const barsHtml = String(byId['dayBars'].innerHTML);
  const barCount = (barsHtml.match(/bar-col/g) || []).length;
  ok('渲染出 14 根柱子', barCount === 14, 'n=' + barCount);
  ok('日期标签只写日（不会撑爆窄屏）', !/\d\/\d\d/.test(barsHtml), barsHtml.slice(0, 120));
  ok('区间标签已写入', String(byId['rangeLabel'].textContent).includes('–'),
     String(byId['rangeLabel'].textContent));

  console.log('\n[8] 章节分类');
  const Q2 = sandbox.window.QUIZ;
  Q2.renderHomeChapters();
  const chapHtml = String(byId['chapterList'].innerHTML);
  ok('首页渲染出章节行', chapHtml.includes('data-ch="1"') && chapHtml.includes('data-ch="2"'),
     chapHtml.slice(0, 120));
  ok('章节行显示剩余题数或已毕业', /剩 \d+ 题|已毕业/.test(chapHtml));
  const chapN = Q2.state.chapters.length;
  ok('章节 ' + chapN + ' 章时「全部章节」按钮状态正确',
     byId['btnAllChapters'].hidden === (chapN <= 3), 'hidden=' + byId['btnAllChapters'].hidden);

  Q2.startChapter(2);
  const q2 = Q2.state.session ? Q2.state.session.queue.slice() : [];
  ok('点第 2 章只出第 2 章的题',
     q2.length > 0 && q2.every((id) => id.startsWith('c02-')), q2.slice(0, 3).join(','));
  ok('单章队列不超过 12 道', q2.length <= 12, 'len=' + q2.length);
  ok('进入答题视图', byId['view-quiz']._cls.has('active'));

  Q2.state.browseFilter = 'all';
  Q2.renderBrowse();
  const bHtml = String(byId['browseList'].innerHTML);
  const drawerN = (bHtml.match(/<details class="chap-drawer"/g) || []).length;
  ok('题库页按章分成 ' + Q2.state.chapters.length + ' 个抽屉',
     drawerN === Q2.state.chapters.length, 'drawers=' + drawerN);
  ok('抽屉默认全部收起', !/<details[^>]*\sopen[=\s>]/.test(bHtml));
  ok('抽屉标题带进度信息', bHtml.includes('待攻克'));
  const lastTitle = Q2.state.chapters[Q2.state.chapters.length - 1].title;
  ok('题库页出现最新一章「' + lastTitle + '」', bHtml.includes(lastTitle),
     Q2.state.chapters.map((c) => c.title).join(' / '));

  // 模拟章节变多（再加 2 章），验证「只露 3 行 + 全部章节」
  // 章号用 90/91：题库真实章号会一直往后长，用 5/6 早晚撞上已有的题
  [90, 91].forEach((ch) => {
    Q2.state.items.push({
      id: 'c' + ch + '-q01', ch: ch, kind: 'concept', level: 1,
      q: '测试题' + ch, a: ['x'], tag: ['t'], src: 'written', follow: []
    });
  });
  Q2.state.states = sandbox.SRS.statesFromEvents(Q2.state.events, Q2.state.items);
  Q2.state.chaptersExpanded = false;
  Q2.renderHomeChapters();
  const rowsShown = (String(byId['chapterList'].innerHTML).match(/data-ch=/g) || []).length;
  ok('章节超过 3 时首页只露 3 行', rowsShown === 3, 'rows=' + rowsShown);
  ok('章节超过 3 时出现「全部章节」', byId['btnAllChapters'].hidden === false);
  Q2.state.chaptersExpanded = true;
  Q2.renderHomeChapters();
  const rowsAll = (String(byId['chapterList'].innerHTML).match(/data-ch=/g) || []).length;
  ok('展开后显示全部 ' + (chapN + 2) + ' 章', rowsAll === chapN + 2, 'rows=' + rowsAll);

  timers.forEach((h) => { clearTimeout(h); clearInterval(h); });

  console.log('\n' + (fail === 0 ? '全部通过 ✓' : `有 ${fail} 项失败 ✗`));
  process.exit(fail === 0 ? 0 : 1);
})();
