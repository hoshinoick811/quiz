/* 运维题库 · quiz —— 答题：队列、选择题、计时、评分、结算
 * 依赖：core、store、home
 * 约定：每个文件自己是个 IIFE，读写共享状态一律走 window.Q；
 *      从 Q 上解构来的都是「别的文件定义的东西」，改名字时两边一起改。
 */
(function () {
  const Q = (window.Q = window.Q || {});
  const { state, show, toast, chapName, $, KIND_LABEL, escapeHtml, $$, record, renderHome, queuePreview } = Q;

  /* ================= 答题 ================= */

  let timerHandle = null;

  function beginSession(queueItems, mode) {
    state.session = {
      queue: queueItems.map((it) => it.id),
      index: 0,
      results: { good: 0, half: 0, again: 0 },
      repeats: {},
      mode: mode || 'normal',
      started: Date.now()
    };
    show('quiz');
    renderQuestion();
  }

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
    beginSession(q, mode || 'normal');
  }

  /* 只练一章：不占用每天的新题额度 */
  function startChapter(ch) {
    const q = SRS.buildQueue(state.items, state.states, {
      chapter: ch,
      maxPerSession: state.settings.maxPerSession,
      mode: 'chapter'
    });
    if (!q.length) {
      toast(chapName(ch) + ' 已经全部毕业了');
      return;
    }
    beginSession(q, 'chapter');
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

    state.quiz = { useMC: false, answered: false, mc: null };
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

  Object.assign(Q, { timerHandle, beginSession, startSession, startChapter, currentItem, renderQuestion, hashStr, shuffleSeeded, setupChoices, markChoiceResult, showNextButton, chooseOption, abandonChoice, commit, advance, startTimer, stopTimer, reveal, grade, finishSession });
})();
