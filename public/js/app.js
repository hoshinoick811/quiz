/* 运维题库 · app —— 事件绑定与启动
 * 依赖：以上全部（必须最后加载）
 * 约定：每个文件自己是个 IIFE，读写共享状态一律走 window.Q；
 *      从 Q 上解构来的都是「别的文件定义的东西」，改名字时两边一起改。
 */
(function () {
  const Q = (window.Q = window.Q || {});
  const { $$, show, renderBrowse, renderStats, refreshSettings, renderHome, $, startSession, state, stopTimer, abandonChoice, reveal, advance, chooseOption, grade, currentItem, record, toast, startChapter, renderHomeChapters, bindSettings, trySync, escapeHtml, loadSettings, applyTheme, loadBank, recompute, loadPhoneUrl, dbAll, renderQuestion } = Q;

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

    $('#chapterList').addEventListener('click', (e) => {
      const row = e.target && e.target.closest ? e.target.closest('[data-ch]') : null;
      if (!row) return;
      startChapter(Number(row.dataset.ch));
    });

    const allBtn = $('#btnAllChapters');
    if (allBtn) {
      allBtn.addEventListener('click', () => {
        state.chaptersExpanded = !state.chaptersExpanded;
        renderHomeChapters();
      });
    }

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
      await loadBank();
    } catch (err) {
      bootError(err);
      return;
    }

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
      startChapter,
      renderHomeChapters,
      renderBrowse,
      applyTheme
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  Object.assign(Q, { bind, bootError, showBuild, init });
})();
