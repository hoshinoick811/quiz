/* 自测脚本：题库完整性 + 前端引用一致性 + 间隔重复逻辑 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let fail = 0;
const ok = (name, cond, extra) => {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); fail++; }
};

/* ---------- 1. 题库 ---------- */
console.log('\n[1] 题库 public/data/（index.json + 每章一个文件）');
const DATA = path.join(ROOT, 'public/data');
const idx = JSON.parse(fs.readFileSync(path.join(DATA, 'index.json'), 'utf8'));
const parts = idx.chapters.map((c) => {
  const f = JSON.parse(fs.readFileSync(path.join(DATA, c.file), 'utf8'));
  return { items: f.items || [], mc: f.mc || {} };
});
const bank = {
  chapters: idx.chapters.map((c) => ({ id: c.id, title: c.title })),
  items: [].concat(...parts.map((p) => p.items)),
  mc: Object.assign({}, ...parts.map((p) => p.mc))
};
const KINDS = new Set(['concept', 'scenario', 'code', 'acceptance']);
const SRC = new Set(['doc', 'edited', 'written']);
const ids = new Set();
let bad = [];
for (const it of bank.items) {
  if (ids.has(it.id)) bad.push(it.id + ' 重复');
  ids.add(it.id);
  if (!it.id || !it.q || !Array.isArray(it.a) || it.a.length === 0) bad.push((it.id || '?') + ' 缺字段');
  if (!KINDS.has(it.kind)) bad.push(it.id + ' kind 非法');
  if (!SRC.has(it.src)) bad.push(it.id + ' src 非法');
  if (!(it.level >= 1 && it.level <= 5)) bad.push(it.id + ' level 越界');
  if (!it.ch) bad.push(it.id + ' 缺 ch');
  if (it.tag && !Array.isArray(it.tag)) bad.push(it.id + ' tag 非数组');
}
/* 每章题量：加章/加题时改这张表，比只盯一个总数更容易看出少的是哪一章 */
const CHAPTER_EXPECT = { 1: 33, 2: 25, 3: 18, 4: 18, 5: 37 };
const perCh = {};
bank.items.forEach(i => perCh[i.ch] = (perCh[i.ch] || 0) + 1);
const chBad = Object.entries(CHAPTER_EXPECT)
  .filter(([ch, n]) => perCh[ch] !== n)
  .map(([ch, n]) => '第' + ch + '章 ' + (perCh[ch] || 0) + '/' + n);
ok('题目总数 ' + bank.items.length,
   bank.items.length === Object.values(CHAPTER_EXPECT).reduce((a, b) => a + b, 0));
ok('每章题量与预期一致', chBad.length === 0, chBad.join('; '));

// 拆分成「一章一文件」之后，最容易出的事故就是把题放进了别的章的文件里
const homeBad = [];
idx.chapters.forEach((c, i) => {
  for (const it of parts[i].items) {
    if (it.ch !== c.id) homeBad.push(it.id + ' 属于第 ' + it.ch + ' 章，却放在 ' + c.file);
  }
  const want = 'c' + String(c.id).padStart(2, '0') + '-';
  for (const id of Object.keys(parts[i].mc)) {
    if (!id.startsWith(want)) homeBad.push(id + ' 的选项放在了 ' + c.file);
  }
});
ok('每章文件的题目和选项都归属本章', homeBad.length === 0, homeBad.slice(0, 3).join('; '));
ok('id 唯一且字段完整', bad.length === 0, bad.slice(0, 5).join('; '));
const byKind = {};
bank.items.forEach(i => byKind[i.kind] = (byKind[i.kind] || 0) + 1);
console.log('        分布：' + JSON.stringify(byKind));
ok('有验收大题', (byKind.acceptance || 0) >= 3);
ok('代码/命令题标记了需实机验证', bank.items.filter(i => i.kind === 'code').every(i => i.verify === true));

/* ---------- 2. 前端引用 vs HTML ---------- */
console.log('\n[2] app.js 引用的 DOM id 是否都存在于 index.html');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');
const htmlIds = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const refs = new Set([...app.matchAll(/\$\$?\('#([A-Za-z0-9_-]+)/g)].map(m => m[1]));
const missing = [...refs].filter(r => !htmlIds.has(r));
ok(`引用了 ${refs.size} 个 id`, missing.length === 0, '缺：' + missing.join(', '));

/* ---------- 3. srs.js 逻辑 ---------- */
console.log('\n[3] 间隔重复逻辑');
const srsCode = fs.readFileSync(path.join(ROOT, 'public/srs.js'), 'utf8');
const win = {};
vm.runInNewContext(srsCode, { window: win, Date, Math, console });
const SRS = win.SRS;

const D = 86400000;
const T0 = new Date('2026-10-01T09:00:00+08:00').getTime();
const concept = { id: 'x1', verify: false };
const code = { id: 'x2', verify: true };

// 连着三次「会」→ 毕业
let ev = [
  { item: 'x1', ts: T0, k: 'good' },
  { item: 'x1', ts: T0 + 1 * D, k: 'good' },
  { item: 'x1', ts: T0 + 4 * D, k: 'good' }
];
let st = SRS.deriveState(ev, concept);
ok('三连「会」毕业', st.graduated === true, JSON.stringify(st));
ok('间隔按 1→3→7 递增', st.ivl === 7, 'ivl=' + st.ivl);

// 「不会」清零
st = SRS.deriveState([{ item: 'x1', ts: T0, k: 'good' }, { item: 'x1', ts: T0 + D, k: 'again' }], concept);
ok('「不会」把连击清零', st.streak === 0 && st.lapses === 1);

// 代码题：三连「会」但没验证 → 不毕业
st = SRS.deriveState([
  { item: 'x2', ts: T0, k: 'good' },
  { item: 'x2', ts: T0 + D, k: 'good' },
  { item: 'x2', ts: T0 + 4 * D, k: 'good' }
], code);
ok('代码题未实机验证不毕业', st.graduated === false && st.streak === 3);

st = SRS.deriveState([
  { item: 'x2', ts: T0, k: 'good' },
  { item: 'x2', ts: T0 + D, k: 'good' },
  { item: 'x2', ts: T0 + 4 * D, k: 'good' },
  { item: 'x2', ts: T0 + 5 * D, k: 'verify' }
], code);
ok('补一条 verify 后毕业', st.graduated === true);

// 半对：间隔回到 1 天，连击不清零
st = SRS.deriveState([{ item: 'x1', ts: T0, k: 'good' }, { item: 'x1', ts: T0 + D, k: 'half' }], concept);
ok('「半对」间隔回到 1 天', st.ivl === 1, 'ivl=' + st.ivl);
ok('「半对」不清零连击', st.streak === 1, 'streak=' + st.streak);

// 到期时间
st = SRS.deriveState([{ item: 'x1', ts: T0, k: 'good' }], concept);
ok('到期时间 = 上次 + 1 天', st.due === T0 + 1 * D);

/* ---------- 4. 队列 ---------- */
console.log('\n[4] 队列生成');
const items = bank.items;
const emptyStates = {};
items.forEach(i => emptyStates[i.id] = SRS.deriveState([], i));
let q = SRS.buildQueue(items, emptyStates, { newPerDay: 5, maxPerSession: 12 });
ok('冷启动只给 5 道新题', q.length === 5, 'len=' + q.length);
q = SRS.buildQueue(items, emptyStates, { newPerDay: 5, maxPerSession: 3 });
ok('受单次上限约束', q.length === 3, 'len=' + q.length);

// 全部到期
const allDue = {};
items.forEach(i => allDue[i.id] = SRS.deriveState([{ item: i.id, ts: T0, k: 'good' }], i));
q = SRS.buildQueue(items, allDue, { newPerDay: 5, maxPerSession: 12, now: T0 + 10 * D });
ok('到期题填满队列且不超过上限', q.length === 12, 'len=' + q.length);

/* ---------- 5. 连续天数 ---------- */
console.log('\n[5] 连续天数');
ok('没有记录时为 0', SRS.streakDays([], T0) === 0);
ok('今天做了是 1 天', SRS.streakDays([{ ts: T0, k: 'good' }], T0 + 3600000) === 1);
const three = [
  { ts: T0, k: 'good' },
  { ts: T0 + D, k: 'good' },
  { ts: T0 + 2 * D, k: 'good' }
];
ok('连续三天 = 3', SRS.streakDays(three, T0 + 2 * D + 60000) === 3);
ok('中间断一天就断', SRS.streakDays([{ ts: T0, k: 'good' }, { ts: T0 + 3 * D, k: 'good' }], T0 + 3 * D + 60000) === 1);

/* ---------- 5.1 按章节练题 ---------- */
console.log('\n[5.1] 按章节练题');
const chItems = bank.items;
const freshStates = {};
chItems.forEach((i) => { freshStates[i.id] = SRS.deriveState([], i); });

let qc = SRS.buildQueue(chItems, freshStates, { chapter: 2, maxPerSession: 12, mode: 'chapter' });
ok('单章只出本章题', qc.length > 0 && qc.every((i) => i.ch === 2), 'ids=' + qc.map((i) => i.id).join(','));
ok('单章不吃每天 5 题额度（最多 12 道）', qc.length === 12, 'len=' + qc.length);

qc = SRS.buildQueue(chItems, freshStates, { chapter: 1, maxPerSession: 12, mode: 'chapter' });
ok('另一章也只出本章题', qc.every((i) => i.ch === 1));
ok('单章遵守单次上限', qc.length === 12, 'len=' + qc.length);

const gradStates = {};
chItems.forEach((i) => {
  gradStates[i.id] = i.ch === 2
    ? { seen: true, graduated: true, due: Infinity }
    : SRS.deriveState([], i);
});
qc = SRS.buildQueue(chItems, gradStates, { chapter: 2, maxPerSession: 12, mode: 'chapter' });
ok('整章毕业后队列为 0', qc.length === 0, 'len=' + qc.length);

qc = SRS.buildQueue(chItems, gradStates, { maxPerSession: 12, mode: 'normal' });
ok('日常队列不受单章毕业影响', qc.some((i) => i.ch === 1));

/* 首页「剩 N 题」和点进去实际出的题必须同一口径，否则那一行就是在骗人 */
const nowTs = Date.now();
const dueStates = {};
chItems.forEach((i) => {
  dueStates[i.id] = i.ch === 2
    ? SRS.deriveState([{ item: i.id, ts: nowTs - 1000, k: 'again' }], i)
    : SRS.deriveState([], i);
});
const mismatch = [];
for (const [name, st] of [['全新', freshStates], ['整章毕业', gradStates], ['整章到期', dueStates]]) {
  const rows = SRS.chapterProgress(chItems, st, { now: nowTs, maxSession: 12 });
  for (const r of rows) {
    const n = SRS.buildQueue(chItems, st, { chapter: r.ch, now: nowTs, maxPerSession: 12, mode: 'chapter' }).length;
    if (r.left !== n) mismatch.push(name + ' ch' + r.ch + ' left=' + r.left + ' queue=' + n);
  }
}
ok('章节行「剩 N 题」= 点进去实际出的题数', mismatch.length === 0, mismatch.join('; '));

/* ---------- 6. 选择题选项 ---------- */
console.log('\n[6] 选择题选项（跟着章节文件走）');
const mc = bank.mc;
const idsAll = new Set(bank.items.map(i => i.id));
const mcBad = [];
for (const [id, v] of Object.entries(mc)) {
  if (!idsAll.has(id)) mcBad.push(id + ' 在题库里不存在');
  if (!Array.isArray(v.options) || v.options.length !== 4) mcBad.push(id + ' 选项数不是 4');
  if (!(v.answer >= 0 && v.answer < (v.options || []).length)) mcBad.push(id + ' answer 越界');
  const set = new Set((v.options || []).map(o => o.trim()));
  if (set.size !== (v.options || []).length) mcBad.push(id + ' 选项有重复');
  if ((v.options || []).some(o => !o || !o.trim())) mcBad.push(id + ' 有空选项');
}
ok('选项表结构正确（' + Object.keys(mc).length + ' 题）', mcBad.length === 0, mcBad.slice(0, 4).join('; '));

const withOptions = bank.items.filter(i => mc[i.id]);
const conceptCode = bank.items.filter(i => i.kind === 'concept' || i.kind === 'code');
const mcMissing = conceptCode.filter(i => !mc[i.id]).map(i => i.id);
ok('所有知识点/命令题都有选项', mcMissing.length === 0, '缺：' + mcMissing.join(', '));
ok('场景题与验收大题不出选项',
   bank.items.filter(i => i.kind === 'scenario' || i.kind === 'acceptance').every(i => !mc[i.id]));
console.log('        覆盖：' + withOptions.length + ' 题有选项；场景+验收 ' +
  bank.items.filter(i => i.kind === 'scenario' || i.kind === 'acceptance').length + ' 题保持口述');

/* ---------- 结果 ---------- */
console.log('\n' + (fail === 0 ? '全部通过 ✓' : `有 ${fail} 项失败 ✗`));
process.exit(fail === 0 ? 0 : 1);
