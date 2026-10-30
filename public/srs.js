/* 间隔重复 + 队列生成（纯函数，方便以后改规则重放历史）
 * 状态不落库：所有状态都由「答题事件」重放算出。
 */
(function (global) {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const STEPS = [1, 3, 7, 14, 30];   // streak 1..5 对应的间隔（天）
  const GRAD_STREAK = 3;             // 连续 3 次「会」毕业

  function localDateKey(ts) {
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  }

  /** 把某个题目的事件重放成当前状态 */
  function deriveState(events, item) {
    const list = (events || []).slice().sort((a, b) => a.ts - b.ts);
    let streak = 0, ivl = 0, lapses = 0, lastTs = 0, verified = false, total = 0;
    let lastKind = '';

    for (const e of list) {
      if (!e || !e.k) continue;
      total += 1;
      lastTs = e.ts;
      lastKind = e.k;
      if (e.k === 'again') {
        streak = 0;
        ivl = 0;
        lapses += 1;
      } else if (e.k === 'half') {
        ivl = 1;               // 重新从 1 天起步，但不抹掉已有连击
      } else if (e.k === 'good') {
        streak += 1;
        ivl = STEPS[Math.min(streak, STEPS.length) - 1];
      } else if (e.k === 'verify') {
        verified = true;
      }
      // skip 不改变任何状态
    }

    const seen = total > 0 || list.length > 0;
    const needsVerify = !!item.verify;
    const graduated = streak >= GRAD_STREAK && (!needsVerify || verified);

    let due = 0;
    if (!seen) due = 0;
    else if (graduated) due = Infinity;
    else due = lastTs + ivl * DAY;   // ivl=0 → 立刻到期

    return { seen, streak, ivl, lapses, verified, graduated, due, lastTs, lastKind, total };
  }

  function statesFromEvents(events, items) {
    const byItem = new Map();
    for (const e of events) {
      if (!byItem.has(e.item)) byItem.set(e.item, []);
      byItem.get(e.item).push(e);
    }
    const out = {};
    for (const it of items) {
      out[it.id] = deriveState(byItem.get(it.id) || [], it);
    }
    return out;
  }

  /** 生成一次练习队列 */
  function buildQueue(items, states, opts) {
    opts = opts || {};
    const now = opts.now || Date.now();
    const newPerDay = opts.newPerDay != null ? opts.newPerDay : 5;
    const maxSession = opts.maxPerSession || 12;
    const mode = opts.mode || 'normal';     // normal | wrong | extra

    const due = [];
    const fresh = [];

    for (const it of items) {
      const st = states[it.id];
      if (!st) continue;
      if (st.graduated) continue;
      if (!st.seen) {
        fresh.push(it);
      } else if (st.due <= now) {
        due.push(it);
      }
    }

    due.sort((a, b) => states[a.id].due - states[b.id].due);
    fresh.sort((a, b) => (a.level - b.level) || a.id.localeCompare(b.id));

    if (mode === 'wrong') {
      // 只刷「做过但还没毕业」的题，不受新题额度和上限约束太多
      const wrong = due.slice(0, maxSession);
      return wrong;
    }

    const newLimit = mode === 'extra'
      ? Math.min(newPerDay, fresh.length)
      : Math.min(newPerDay, fresh.length, maxSession);

    const picked = [];
    const n = fresh.slice(0, newLimit);

    // 交替穿插：到期题和新题混着来，避免一上来全是生题
    let di = 0, ni = 0;
    while (di < due.length || ni < n.length) {
      if (di < due.length) picked.push(due[di++]);
      if (ni < n.length && di % 2 === 0) picked.push(n[ni++]);
      if (picked.length >= maxSession) break;
    }
    // 补满（如果交替没塞满）
    while (picked.length < maxSession && ni < n.length) picked.push(n[ni++]);

    return picked.slice(0, maxSession);
  }

  /** 连续学习天数 */
  function streakDays(events, nowTs) {
    if (!events.length) return 0;
    const days = new Set(events.map((e) => localDateKey(e.ts)));
    const today = new Date(nowTs || Date.now());
    today.setHours(0, 0, 0, 0);
    let cursor = today.getTime();
    // 今天还没做，就从昨天开始算（不打断连击）
    if (!days.has(localDateKey(cursor))) {
      cursor -= DAY;
      if (!days.has(localDateKey(cursor))) return 0;
    }
    let count = 0;
    while (days.has(localDateKey(cursor))) {
      count += 1;
      cursor -= DAY;
      if (count > 3650) break;
    }
    return count;
  }

  /** 最近 n 天每天的做题数 */
  function dayCounts(events, n, nowTs) {
    const out = [];
    const today = new Date(nowTs || Date.now());
    today.setHours(0, 0, 0, 0);
    for (let i = n - 1; i >= 0; i--) {
      const start = today.getTime() - i * DAY;
      const end = start + DAY;
      const c = events.filter((e) => e.ts >= start && e.ts < end && e.k !== 'verify').length;
      out.push({ key: localDateKey(start), count: c, start });
    }
    return out;
  }

  /** 每章进度 */
  function chapterProgress(items, states) {
    const map = new Map();
    for (const it of items) {
      if (!map.has(it.ch)) map.set(it.ch, { ch: it.ch, total: 0, grad: 0, learned: 0, wrong: 0 });
      const row = map.get(it.ch);
      const st = states[it.id];
      row.total += 1;
      if (st.graduated) row.grad += 1;
      if (st.seen) row.learned += 1;
      if (st.seen && !st.graduated) row.wrong += 1;
    }
    return [...map.values()].sort((a, b) => a.ch - b.ch);
  }

  global.SRS = {
    DAY, STEPS, GRAD_STREAK,
    localDateKey, deriveState, statesFromEvents, buildQueue,
    streakDays, dayCounts, chapterProgress
  };
})(window);
