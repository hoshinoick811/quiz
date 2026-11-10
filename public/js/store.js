/* 运维题库 · store —— 事件存储（IndexedDB / localStorage）、题库加载、两端同步
 * 依赖：core
 * 约定：每个文件自己是个 IIFE，读写共享状态一律走 window.Q；
 *      从 Q 上解构来的都是「别的文件定义的东西」，改名字时两边一起改。
 */
(function () {
  const Q = (window.Q = window.Q || {});
  const { state, $, toast, uid, deviceName, fetchWithTimeout } = Q;

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


  /* ================= 数据刷新 ================= */

  function recompute() {
    state.states = SRS.statesFromEvents(state.events, state.items);
  }

  async function fetchJSON(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('题库加载失败 ' + res.status + '  ' + url);
    return res.json();
  }

  // 题库按章拆在 data/ 下：index.json 是清单，每章一个文件（题目 + 该章的选项）。
  // 拆分是为了单个文件别大到没人愿意整份读完；加载方式对页面是无感的。
  async function loadBank() {
    // 单文件离线版把整份题库内联成 window.__QUIZ_BANK__
    if (window.__QUIZ_BANK__) { applyBank(window.__QUIZ_BANK__); return; }

    const idx = await fetchJSON('./data/index.json');
    const chapters = idx.chapters || [];
    if (!chapters.length) throw new Error('题库清单是空的');
    const parts = await Promise.all(chapters.map((c) => fetchJSON('./data/' + c.file)));
    applyBank({
      chapters: chapters.map((c) => ({ id: c.id, title: c.title })),
      items: [].concat(...parts.map((p) => p.items || [])),
      mc: Object.assign({}, ...parts.map((p) => p.mc || {}))
    });
  }

  function applyBank(data) {
    state.items = data.items || [];
    state.byId = {};
    for (const it of state.items) state.byId[it.id] = it;
    state.chapters = data.chapters || [];
    state.mc = data.mc || {};
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
        Q.renderHome();
        Q.renderBrowse();
      }
      setSync('on');
      if (manual) {
        toast(add.length ? `同步完成，新增 ${add.length} 条记录` : '同步完成，已是最新');
      }
      Q.refreshSettings();
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

  async function record(itemId, kind) {
    const ev = {
      id: uid(),
      item: itemId,
      ts: Date.now(),
      k: kind,
      dev: deviceName()
    };
    await dbPut(ev);
    state.events.push(ev);
    recompute();
    scheduleSync();
    return ev;
  }

  Object.assign(Q, { DB_NAME, DB_VER, STORE, dbPromise, storageMode, withTimeout, lsAll, lsSave, openDB, dbAll, dbPut, dbPutMany, dbClear, recompute, fetchJSON, loadBank, applyBank, setSync, apiBase, syncAvailable, trySync, syncTimer, scheduleSync, record });
})();
