/* 运维题库 · home —— 首页：今天的队列、章节进度
 * 依赖：core
 * 约定：每个文件自己是个 IIFE，读写共享状态一律走 window.Q；
 *      从 Q 上解构来的都是「别的文件定义的东西」，改名字时两边一起改。
 */
(function () {
  const Q = (window.Q = window.Q || {});
  const { state, $, escapeHtml } = Q;

  /* ================= 首页 ================= */

  function queuePreview() {
    return SRS.buildQueue(state.items, state.states, {
      newPerDay: state.settings.newPerDay,
      maxPerSession: state.settings.maxPerSession
    });
  }

  function renderHome() {
    const total = state.items.length;
    // 首页这四个数字不自己算：章节行是唯一统计来源，求和即可
    const rows = chapterRows();
    const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
    const grad = sum('grad');
    const learned = sum('learned');
    const wrong = sum('wrong');
    const fresh = sum('fresh');
    const dueCount = sum('due');

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

    renderHomeChapters(rows);
  }

  /* ---------- 章节 ---------- */

  /* 通用分组：现在按 ch 分，以后想按标签/难度分组换个 key 就行 */
  function groupItems(items, key) {
    const map = new Map();
    for (const it of items) {
      const k = it[key];
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    }
    return [...map.entries()].sort((a, b) => {
      if (typeof a[0] === 'number' && typeof b[0] === 'number') return a[0] - b[0];
      return String(a[0]).localeCompare(String(b[0]));
    });
  }

  function chapName(ch) {
    const c = (state.chapters || []).find((x) => x.id === ch);
    return c ? c.title : '第 ' + ch + ' 章';
  }

  /* 各章进度行：首页数字、章节行、题库页标题都从这一份数据取 */
  function chapterRows() {
    return SRS.chapterProgress(state.items, state.states, {
      maxSession: state.settings.maxPerSession
    });
  }

  /* 每章最近一次答题时间，用来把「最近在学的」排前面 */
  function chapterLastActive() {
    const map = {};
    for (const e of state.events) {
      const it = state.byId[e.item];
      if (!it) continue;
      if (!map[it.ch] || e.ts > map[it.ch]) map[it.ch] = e.ts;
    }
    return map;
  }

  function renderHomeChapters(rows) {
    rows = (rows || chapterRows()).slice();
    const last = chapterLastActive();
    rows.sort((a, b) => {
      const la = last[a.ch] || 0;
      const lb = last[b.ch] || 0;
      if (la !== lb) return lb - la;
      return a.ch - b.ch;
    });

    const showAll = state.chaptersExpanded || rows.length <= 3;
    const shown = showAll ? rows : rows.slice(0, 3);

    $('#chapterList').innerHTML = shown.map((r) => {
      const pct = r.total ? Math.round((r.grad / r.total) * 100) : 0;
      const left = r.left;
      const tail = left ? '剩 ' + left + ' 题' : '已毕业';
      return `<button type="button" class="chap-row clickable" data-ch="${r.ch}">
        <div class="chap-top">
          <span class="chap-name">${escapeHtml(chapName(r.ch))}</span>
          <span class="chap-num">${r.grad}/${r.total} 毕业 · ${tail}<span class="chev">›</span></span>
        </div>
        <div class="bar-track"><div class="bar-fill warm" style="width:${pct}%"></div></div>
      </button>`;
    }).join('') || '<p class="hint">还没有内容</p>';

    const btn = $('#btnAllChapters');
    if (btn) {
      btn.hidden = rows.length <= 3;
      btn.textContent = state.chaptersExpanded ? '收起 ▴' : '全部章节 ▾';
    }
    const hint = $('#chapterHint');
    if (hint) {
      hint.textContent = `点章节只练这一章 · 共 ${rows.length} 章 ${state.items.length} 题`;
    }
  }

  function renderChapters(sel) {
    const rows = chapterRows();
    $(sel).innerHTML = rows.map((r) => {
      const pct = r.total ? Math.round((r.grad / r.total) * 100) : 0;
      return `<div class="chap-row">
        <div class="chap-top">
          <span class="chap-name">${escapeHtml(chapName(r.ch))}</span>
          <span class="chap-num">${r.grad}/${r.total} 毕业 · ${pct}%</span>
        </div>
        <div class="bar-track"><div class="bar-fill warm" style="width:${pct}%"></div></div>
      </div>`;
    }).join('') || '<p class="hint">还没有内容</p>';
  }

  Object.assign(Q, { queuePreview, renderHome, groupItems, chapName, chapterRows, chapterLastActive, renderHomeChapters, renderChapters });
})();
