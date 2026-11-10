/* 运维题库 · core —— 常量、状态、工具、主题、视图切换
 * 依赖：无（必须第一个加载）
 * 约定：每个文件自己是个 IIFE，读写共享状态一律走 window.Q；
 *      从 Q 上解构来的都是「别的文件定义的东西」，改名字时两边一起改。
 */
(function () {
  const Q = (window.Q = window.Q || {});

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
    chapters: [],
    events: [],
    states: {},
    mc: {},
    quiz: null,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    session: null,
    sync: 'idle',          // idle | on | off | busy
    browseFilter: 'all',
    chaptersExpanded: false
  };


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


  /* ================= 视图切换 ================= */

  function show(view) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $('#tabbar').style.display = (view === 'quiz' || view === 'done') ? 'none' : 'flex';
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }


  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  Object.assign(Q, { $, $$, KIND_LABEL, DEFAULT_SETTINGS, state, uid, deviceName, loadSettings, saveSettings, resolvedTheme, applyTheme, fmtDate, toast, fetchWithTimeout, show, escapeHtml });
})();
