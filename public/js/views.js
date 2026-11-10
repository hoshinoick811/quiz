/* 运维题库 · views —— 题库浏览、统计、设置
 * 依赖：core、store、home、quiz
 * 约定：每个文件自己是个 IIFE，读写共享状态一律走 window.Q；
 *      从 Q 上解构来的都是「别的文件定义的东西」，改名字时两边一起改。
 */
(function () {
  const Q = (window.Q = window.Q || {});
  const { state, $, escapeHtml, KIND_LABEL, chapterRows, groupItems, chapName, renderChapters, fmtDate, fetchWithTimeout, $$, setSync, DEFAULT_SETTINGS, saveSettings, renderHome, trySync, toast, applyTheme, dbPutMany, recompute, dbClear } = Q;

  /* ================= 题库浏览 ================= */

  function stateChip(st) {
    if (!st.seen) return '<span class="state unseen">没做过</span>';
    if (st.graduated) return '<span class="state grad">已毕业</span>';
    if (st.streak > 0) return '<span class="state learn">在推进</span>';
    return '<span class="state wrong">待攻克</span>';
  }

  function browseMatch(it, f) {
    const st = state.states[it.id];
    if (f === 'wrong') return st.seen && !st.graduated;
    if (f === 'grad') return st.graduated;
    if (f === 'unseen') return !st.seen;
    return true;
  }

  function browItemHtml(it) {
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
  }

  /* 题库页：按章折叠，默认全收起，筛选作用在所有章上 */
  function renderBrowse() {
    const f = state.browseFilter;
    const progress = new Map(chapterRows().map((r) => [r.ch, r]));
    const html = groupItems(state.items, 'ch').map(([ch, items]) => {
      const list = items.filter((it) => browseMatch(it, f));
      if (!list.length) return '';
      const row = progress.get(ch) || { total: items.length, grad: 0, wrong: 0 };
      return `<details class="chap-drawer" data-ch="${ch}">
        <summary>
          <span class="chap-name">${escapeHtml(chapName(ch))}</span>
          <span class="chap-meta">${row.grad}/${row.total} 毕业 · 待攻克 ${row.wrong}</span>
        </summary>
        <div class="drawer-body">${list.map(browItemHtml).join('')}</div>
      </details>`;
    }).join('');

    $('#browseList').innerHTML = html || '<p class="hint">这个分类下没有题目。</p>';
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

    renderChapters('#chapterStats');

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

  Object.assign(Q, { stateChip, browseMatch, browItemHtml, renderBrowse, renderStats, loadPhoneUrl, refreshSettings, bindSettings });
})();
