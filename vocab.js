// ==== 単語機能 v9(T1900を主軸に、Settingで対象の語を選ぶ) ====
// app.js の state / callApi / showScreen / speakText_ / escapeHtml_ に依存する。

const vstate = {
  settings: null,
  overview: null,
  scope: 't1900', // 't1900' | 'kakomon' | 'ss' | 'jun1' | 'teap' | 'v8' | 'v8opt'
  mode: 'learn', // 'learn' | 'test'
  cards: [],
  cardIndex: 0,
  cardKind: 't1900',
  test: null,
  saveTimer: null
};

const VOCAB_SCOPES = [
  { key: 't1900', label: 'T1900', visible: function () { return true; } },
  { key: 'derived', label: 'T1900派生語', visible: function (s) { return s.derived; } },
  { key: 'kakomon', label: '過去問', visible: function (s) { return s.kakomon; } },
  { key: 'ss', label: 'SS', visible: function (s) { return s.ss || s.v8; } },
  { key: 'v8', label: 'S・A・B', visible: function (s) { return s.v8; } },
  { key: 'v8opt', label: 'B3・D', visible: function (s) { return s.v8 && s.v8opt; } },
  { key: 'jun1', label: 'T1900準1級', visible: function (s) { return s.jun1; } },
  { key: 'teap', label: 'T1900TEAP', visible: function (s) { return s.teap; } }
];

const VOCAB_TEST_FORMS = [
  { key: 'mix', label: 'ミックス' },
  { key: 'en2ja', label: '英語→意味' },
  { key: 'ja2en', label: '意味→英語' },
  { key: 'audio2ja', label: '音声→意味' }
];

const VOCAB_SETTING_TOGGLES = [
  { key: 'derived', label: 'T1900派生語を含む' },
  { key: 'kakomon', label: '過去問の語を含む' },
  { key: 'ss', label: '外部ソースSSランクを含む' },
  { key: 'jun1', label: 'T1900英検準1級を含む' },
  { key: 'teap', label: 'T1900TEAPを含む' },
  { key: 'v8', label: '外部ソースSS・S・A・Bランク(v8語彙)を含む' },
  { key: 'v8opt', label: 'v8語彙(任意:B3・D)を含む(v8オンのときのみ)' },
  { key: 'basic', label: '基礎語(音声のみ・流し聞き)' },
  { key: 'sound', label: '音声(電車モードとは同時にオンにできません)' },
  { key: 'trainMode', label: '電車モード(音声ボタン・自動再生なし)' }
];

function vocabUserKey_(name) {
  return name + '_' + ((state.user && state.user.userId) || 'unknown');
}

function vocabSoundOn_() {
  return !!vstate.settings && vstate.settings.sound && !vstate.settings.trainMode;
}

function vocabSpeak_(text) {
  speakText_(text, (vstate.settings && vstate.settings.speed) || 1.0);
}

// ---- 初期化・再読み込み ----
function setupVocab_() {
  document.getElementById('vocabScopeChips').addEventListener('click', function (ev) {
    const btn = ev.target.closest('.chip');
    if (!btn) return;
    vstate.scope = btn.dataset.value;
    renderVocabScope_();
  });
  document.getElementById('vocabModeChips').addEventListener('click', function (ev) {
    const btn = ev.target.closest('.chip');
    if (!btn) return;
    vstate.mode = btn.dataset.value;
    renderVocabScope_();
  });
  document.getElementById('vocabStartBtn').addEventListener('click', startVocabFromScope_);
  document.getElementById('vocabSpeedInput').addEventListener('input', onVocabSettingChanged_);
  document.getElementById('vocabT1900AutoTestBtn').addEventListener('click', function () {
    startVocabTest_({ kind: 't1900', tOnly: '1', onlyKnown: '1', includeDerived: vstate.settings && vstate.settings.derived ? '1' : '0' }, true);
  });
  document.getElementById('vocabT1900RangeTestBtn').addEventListener('click', function () {
    const r = readT1900Range_();
    startVocabTest_({ kind: 't1900', tOnly: '1', from: r.from, to: r.to, includeDerived: vstate.settings && vstate.settings.derived ? '1' : '0' }, true);
  });
  document.getElementById('vocabReviewCardsBtn').addEventListener('click', function () {
    startVocabCards_({ kind: 't1900', from: 1, to: 1900, reviewOnly: '1' });
  });
  document.getElementById('vocabNoticeTestBtn').addEventListener('click', function () {
    startVocabTest_({ kind: 't1900', tOnly: '1', onlyKnown: '1', includeDerived: vstate.settings && vstate.settings.derived ? '1' : '0' }, true);
  });
  ['vocabRangeFrom', 'vocabRangeTo'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', saveVocabRange_);
  });

  document.getElementById('vcardKnownBtn').addEventListener('click', function () { markVocabCard_(true); });
  document.getElementById('vcardUnknownBtn').addEventListener('click', function () { markVocabCard_(false); });
  document.getElementById('vcardPrevBtn').addEventListener('click', function () { moveVocabCard_(-1); });
  document.getElementById('vcardNextBtn').addEventListener('click', function () { moveVocabCard_(1); });
  document.getElementById('quitVcardBtn').addEventListener('click', function () { stopSpeech_(); leaveVocabScreen_(); });
  document.getElementById('quitVtestBtn').addEventListener('click', function () { stopSpeech_(); leaveVocabScreen_(); });
  document.getElementById('vresultHomeBtn').addEventListener('click', leaveVocabScreen_);
  document.getElementById('vresultRetryBtn').addEventListener('click', function () {
    if (vstate.test && vstate.test.params) startVocabTest_(vstate.test.params, vstate.test.isT1900);
  });
  setupVcardSwipe_();
}

function leaveVocabScreen_() {
  showScreen('screen-home');
  loadVocabHome_();
  loadStats();
}

function loadVocabHome_() {
  return callApi('getVocabOverview', { token: state.token }).then(function (res) {
    if (!res.ok) return;
    vstate.overview = res;
    vstate.settings = res.settings;
    renderVocabSettings_();
    renderVocabScope_();
    renderVocabOverview_();
    loadBasicWords_();
  }).catch(function () { /* 単語以外の機能は使えるようにする */ });
}

// ---- Setting ----
function renderVocabSettings_() {
  const s = vstate.settings;
  const box = document.getElementById('vocabSettingsBody');
  box.innerHTML = '';
  VOCAB_SETTING_TOGGLES.forEach(function (t) {
    const label = document.createElement('label');
    label.className = 'vocab-toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!s[t.key];
    cb.dataset.key = t.key;
    if (t.key === 'v8opt' && !s.v8) cb.disabled = true;
    cb.addEventListener('change', function () {
      if (cb.checked && (t.key === 'sound' || t.key === 'trainMode')) {
        const other = document.querySelector('#vocabSettingsBody input[data-key="' + (t.key === 'sound' ? 'trainMode' : 'sound') + '"]');
        if (other) other.checked = false;
      }
      onVocabSettingChanged_();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode(' ' + t.label));
    box.appendChild(label);
  });
  const fixed = document.createElement('p');
  fixed.className = 'memorize-note';
  fixed.textContent = 'T1900見出し語(1,900語)は常に対象です。';
  box.appendChild(fixed);
  document.getElementById('vocabSpeedInput').value = s.speed;
  const tf = document.getElementById('vocabTestFormChips');
  tf.innerHTML = '';
  VOCAB_TEST_FORMS.forEach(function (f) {
    const b = document.createElement('button');
    b.className = 'chip' + (f.key === s.testForm ? ' selected' : '');
    b.dataset.value = f.key;
    b.textContent = f.label;
    b.addEventListener('click', function () {
      tf.querySelectorAll('.chip').forEach(function (x) { x.classList.toggle('selected', x === b); });
      onVocabSettingChanged_();
    });
    tf.appendChild(b);
  });
  document.getElementById('vocabSpeedLabel').textContent = Number(s.speed).toFixed(2) + '倍';
}

function collectVocabSettings_() {
  const out = {};
  document.querySelectorAll('#vocabSettingsBody input[type=checkbox]').forEach(function (cb) { out[cb.dataset.key] = cb.checked; });
  out.speed = Number(document.getElementById('vocabSpeedInput').value) || 1.0;
  const tfSel = document.querySelector('#vocabTestFormChips .chip.selected');
  out.testForm = tfSel ? tfSel.dataset.value : 'mix';
  if (!out.v8) out.v8opt = false;
  return out;
}

function onVocabSettingChanged_() {
  const s = collectVocabSettings_();
  vstate.settings = s;
  document.getElementById('vocabSpeedLabel').textContent = Number(s.speed).toFixed(2) + '倍';
  const v8opt = document.querySelector('#vocabSettingsBody input[data-key="v8opt"]');
  if (v8opt) { v8opt.disabled = !s.v8; if (!s.v8) v8opt.checked = false; }
  renderVocabScope_();
  clearTimeout(vstate.saveTimer);
  vstate.saveTimer = setTimeout(function () {
    callApi('saveVocabSettings', { token: state.token, settings: JSON.stringify(s) }).then(function () {
      loadVocabHome_();
    }).catch(function () { /* 保存に失敗しても画面操作は続けられる */ });
  }, 600);
}

// ---- Study: 範囲とモード ----
function readT1900Range_() {
  const from = Math.min(1900, Math.max(1, parseInt(document.getElementById('vocabRangeFrom').value, 10) || 1));
  let to = parseInt(document.getElementById('vocabRangeTo').value, 10) || Math.min(from + 99, 1900);
  to = Math.min(1900, Math.max(from, to));
  return { from: from, to: to };
}

function saveVocabRange_() {
  try {
    localStorage.setItem(vocabUserKey_('vocab_range'), JSON.stringify({
      scope: vstate.scope, from: document.getElementById('vocabRangeFrom').value, to: document.getElementById('vocabRangeTo').value
    }));
  } catch (e) { /* ignore */ }
}

function renderVocabScope_() {
  const s = vstate.settings;
  if (!s) return;
  const chips = document.getElementById('vocabScopeChips');
  chips.innerHTML = '';
  VOCAB_SCOPES.forEach(function (sc) {
    if (!sc.visible(s)) return;
    const b = document.createElement('button');
    b.className = 'chip' + (sc.key === vstate.scope ? ' selected' : '');
    b.dataset.value = sc.key;
    b.textContent = sc.label;
    chips.appendChild(b);
  });
  if (!chips.querySelector('.selected')) { // オフにされたグループが選択中だった場合はT1900へ戻す
    vstate.scope = 't1900';
    chips.querySelector('.chip').classList.add('selected');
  }
  document.querySelectorAll('#vocabModeChips .chip').forEach(function (c) { c.classList.toggle('selected', c.dataset.value === vstate.mode); });

  const fromEl = document.getElementById('vocabRangeFrom'), toEl = document.getElementById('vocabRangeTo');
  const isT = vstate.scope === 't1900';
  document.getElementById('vocabRangeLabel').textContent = isT ? '出る順番号(1〜1900)' : 'グループ内の位置';
  if (!fromEl.dataset.init) {
    fromEl.dataset.init = '1';
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(vocabUserKey_('vocab_range'))); } catch (e) { saved = null; }
    fromEl.value = (saved && saved.from) || 1;
    toEl.value = (saved && saved.to) || 100;
    if (saved && saved.scope && chips.querySelector('[data-value="' + saved.scope + '"]')) {
      vstate.scope = saved.scope;
      renderVocabScope_();
      return;
    }
  }
  fromEl.max = isT ? 1900 : 9999;
  toEl.max = isT ? 1900 : 9999;
  document.getElementById('vocabStartBtn').textContent = vstate.mode === 'learn' ? '覚える' : 'テストする';
  document.getElementById('vocabTargetCount').textContent =
    vstate.overview ? ('対象の語: ' + vstate.overview.targetCount + '語') : '';
}

function startVocabFromScope_() {
  saveVocabRange_();
  const from = parseInt(document.getElementById('vocabRangeFrom').value, 10) || 1;
  const to = parseInt(document.getElementById('vocabRangeTo').value, 10) || from + 99;
  if (vstate.scope === 't1900') {
    const r = readT1900Range_();
    if (vstate.mode === 'learn') startVocabCards_({ kind: 't1900', from: r.from, to: r.to });
    else startVocabTest_({ kind: 't1900', from: r.from, to: r.to, includeDerived: vstate.settings.derived ? '1' : '0' }, false);
  } else {
    const p = { kind: 'group', group: vstate.scope, from: from, to: Math.max(from, to) };
    if (vstate.mode === 'learn') startVocabCards_(p); else startVocabTest_(p, false);
  }
}

// ---- 覚えるカード ----
function startVocabCards_(params) {
  showScreen('screen-vcards');
  document.getElementById('vcardBody').innerHTML = '<p class="memorize-note">読み込み中...</p>';
  document.getElementById('vcardProgress').textContent = '';
  callApi('getVocabCards', Object.assign({ token: state.token }, params)).then(function (res) {
    if (!res.ok || !res.cards || res.cards.length === 0) {
      document.getElementById('vcardBody').innerHTML = '<p class="memorize-note">' +
        (res.disabled ? 'このグループはSettingでオフになっています。' : '該当する語がありません。') + '</p>';
      return;
    }
    vstate.cards = res.cards;
    vstate.cardIndex = 0;
    vstate.cardKind = res.kind;
    renderVocabCard_();
  }).catch(function () {
    document.getElementById('vcardBody').innerHTML = '<p class="memorize-note">通信に失敗しました。</p>';
  });
}

function vocabWordHtml_(w, big) {
  const speaker = vocabSoundOn_() ? ' <button class="vspeak-btn" data-say="' + escapeHtml_(w.english) + '" aria-label="発音を聞く">🔊</button>' : '';
  return '<div class="vword' + (big ? ' vword-big' : '') + '">' +
    '<div class="vword-en">' + escapeHtml_(w.english) + speaker + '</div>' +
    (w.phonetic ? '<div class="vword-ph">' + escapeHtml_(w.phonetic) + '</div>' : '') +
    (w.katakana ? '<div class="vword-ka">' + escapeHtml_(w.katakana) + '</div>' : '') +
    '<div class="vword-ja">' + escapeHtml_(w.meaning) + (w.pos ? ' <span class="vword-pos">(' + escapeHtml_(w.pos) + ')</span>' : '') + '</div>' +
    '</div>';
}

function bindSpeakButtons_(root) {
  root.querySelectorAll('.vspeak-btn').forEach(function (b) {
    b.addEventListener('click', function () { vocabSpeak_(b.dataset.say); });
  });
}

function renderVocabCard_() {
  const card = vstate.cards[vstate.cardIndex];
  const total = vstate.cards.length;
  document.getElementById('vcardProgress').textContent = (vstate.cardIndex + 1) + ' / ' + total;
  let html = '';
  const w = card.word;
  const label = vstate.cardKind === 't1900' ? ('出る順 ' + card.number) : ('No.' + card.number);
  html += '<p class="section-label">' + label + (w.review ? ' <span class="vtag vtag-review">要復習</span>' : '') +
    (w.status === '覚えた' ? ' <span class="vtag vtag-known">覚えた</span>' : '') + '</p>';
  html += vocabWordHtml_(w, true);
  if (card.derived && card.derived.length > 0) {
    html += '<p class="section-label vsub">派生語</p>';
    card.derived.forEach(function (d) { html += vocabWordHtml_(d, false); });
  }
  if (w.antonym) {
    html += '<p class="section-label vsub">対義語' + (w.antonym.confirmed ? '' : '(候補)') + '</p>' +
      '<div class="vword"><div class="vword-en">' + escapeHtml_(w.antonym.english) + '</div>' +
      (w.antonym.meaning ? '<div class="vword-ja">' + escapeHtml_(w.antonym.meaning) + '</div>' : '') + '</div>';
  }
  const body = document.getElementById('vcardBody');
  body.innerHTML = html;
  bindSpeakButtons_(body);
  if (vocabSoundOn_()) vocabSpeak_(w.english);
}

function moveVocabCard_(delta) {
  const n = vstate.cardIndex + delta;
  if (n < 0) return;
  if (n >= vstate.cards.length) { stopSpeech_(); leaveVocabScreen_(); return; }
  vstate.cardIndex = n;
  renderVocabCard_();
}

function markVocabCard_(known) {
  const card = vstate.cards[vstate.cardIndex];
  if (!card) return;
  card.word.status = known ? '覚えた' : '学習中';
  callApi('markVocabCard', { token: state.token, vocabId: card.word.id, known: known ? '1' : '0' }).catch(function () { /* ignore */ });
  moveVocabCard_(1);
}

function setupVcardSwipe_() {
  const el = document.getElementById('vcardBody');
  let sx = null, sy = null;
  el.addEventListener('touchstart', function (ev) { sx = ev.touches[0].clientX; sy = ev.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', function (ev) {
    if (sx === null) return;
    const dx = ev.changedTouches[0].clientX - sx, dy = ev.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    markVocabCard_(dx > 0); // 右へ=覚えた / 左へ=まだ
  }, { passive: true });
}

// ---- テスト ----
function startVocabTest_(params, isT1900) {
  showScreen('screen-vtest');
  const body = document.getElementById('vtestBody');
  body.innerHTML = '<p class="memorize-note">出題中...</p>';
  document.getElementById('vtestProgress').textContent = '';
  const p = Object.assign({ count: 20 }, params);
  callApi('getVocabTest', Object.assign({ token: state.token }, p)).then(function (res) {
    if (!res.ok || !res.questions || res.questions.length === 0) {
      body.innerHTML = '<p class="memorize-note">' + (res.disabled ? 'このグループはSettingでオフになっています。' : (res.noKnown ? '「覚えた」を押した単語がまだありません。先にカードで「覚えた」を押してください。' : '出題できる語がありません。')) + '</p>';
      return;
    }
    vstate.test = {
      params: params, isT1900: !!isT1900, queue: res.questions.slice(), index: 0,
      total: res.questions.length, firstTry: {}, wrong: [], retried: {}, answered: false
    };
    renderVocabQuestion_();
  }).catch(function () { body.innerHTML = '<p class="memorize-note">通信に失敗しました。</p>'; });
}

function renderVocabQuestion_() {
  const t = vstate.test;
  const q = t.queue[t.index];
  t.answered = false;
  t.shownAt = Date.now();
  document.getElementById('vtestProgress').textContent = (t.index + 1) + ' / ' + t.queue.length;
  let html = '';
  if (q.form === 'en2ja') {
    html += '<div class="vword vword-big"><div class="vword-en">' + escapeHtml_(q.prompt) +
      (vocabSoundOn_() ? ' <button class="vspeak-btn" data-say="' + escapeHtml_(q.english) + '" aria-label="発音を聞く">🔊</button>' : '') + '</div>' +
      (q.phonetic ? '<div class="vword-ph">' + escapeHtml_(q.phonetic) + '</div>' : '') +
      (q.katakana ? '<div class="vword-ka">' + escapeHtml_(q.katakana) + '</div>' : '') + '</div>' +
      '<p class="quiz-instruction">意味を選んでください</p>';
  } else if (q.form === 'ja2en') {
    html += '<div class="vword vword-big"><div class="vword-ja vword-ja-big">' + escapeHtml_(q.prompt) + '</div></div>' +
      '<p class="quiz-instruction">英語を選んでください</p>';
  } else {
    html += '<div class="vword vword-big"><button class="btn-primary vspeak-big" data-say="' + escapeHtml_(q.english) + '">🔊 もう一度聞く</button></div>' +
      '<p class="quiz-instruction">聞こえた単語の意味を選んでください</p>';
  }
  html += '<div class="choice-list" id="vtestChoices"></div><div id="vtestFeedback" class="vtest-feedback"></div>' +
    '<button id="vtestNextBtn" class="btn-primary" style="display:none;">次へ ▶</button>';
  const body = document.getElementById('vtestBody');
  body.innerHTML = html;
  bindSpeakButtons_(body);
  body.querySelectorAll('.vspeak-big').forEach(function (b) { b.addEventListener('click', function () { vocabSpeak_(b.dataset.say); }); });
  const list = document.getElementById('vtestChoices');
  q.choices.forEach(function (c) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = c.text;
    btn.addEventListener('click', function () { onVocabChoose_(q, c, btn); });
    list.appendChild(btn);
  });
  document.getElementById('vtestNextBtn').addEventListener('click', nextVocabQuestion_);
  if (q.form === 'audio2ja' && vocabSoundOn_()) vocabSpeak_(q.english);
}

function onVocabChoose_(q, choice, btn) {
  const t = vstate.test;
  if (t.answered) return;
  t.answered = true;
  document.querySelectorAll('#vtestChoices .choice-btn').forEach(function (b) { b.disabled = true; });
  const elapsed = Math.round((Date.now() - t.shownAt) / 1000);
  callApi('submitVocabAnswer', {
    token: state.token, vocabId: q.vocabId, selectedId: choice.id, form: q.form,
    kind: t.isT1900 ? 't1900' : 'normal', elapsedSec: elapsed
  }).then(function (res) {
    if (!res.ok) { document.getElementById('vtestFeedback').textContent = '記録に失敗しました。'; showVocabNext_(); return; }
    const correctChoiceId = res.answer.id;
    document.querySelectorAll('#vtestChoices .choice-btn').forEach(function (b, i) {
      if (String(q.choices[i].id) === String(correctChoiceId)) b.classList.add('correct');
    });
    const firstTime = !(q.vocabId in t.firstTry);
    if (firstTime) t.firstTry[q.vocabId] = res.correct;
    const fb = document.getElementById('vtestFeedback');
    if (res.correct) {
      fb.textContent = '正解!';
      fb.className = 'vtest-feedback correct';
      setTimeout(nextVocabQuestion_, 700);
    } else {
      btn.classList.add('incorrect');
      fb.className = 'vtest-feedback incorrect';
      fb.innerHTML = '正解: <b>' + escapeHtml_(res.answer.english) + '</b>(' + escapeHtml_(res.answer.meaning) + ')';
      if (firstTime) t.wrong.push({ english: res.answer.english, meaning: res.answer.meaning });
      if (!t.retried[q.vocabId]) { // 間違えた語は同じ回の最後に1回だけ再出題する
        t.retried[q.vocabId] = true;
        t.queue.push(q);
        document.getElementById('vtestProgress').textContent = (t.index + 1) + ' / ' + t.queue.length;
      }
      if (vocabSoundOn_()) vocabSpeak_(res.answer.english);
      showVocabNext_();
    }
  }).catch(function () {
    document.getElementById('vtestFeedback').textContent = '通信に失敗しました。';
    showVocabNext_();
  });
}

function showVocabNext_() {
  const b = document.getElementById('vtestNextBtn');
  if (b) b.style.display = '';
}

function nextVocabQuestion_() {
  const t = vstate.test;
  if (!t || !t.answered) return;
  t.index++;
  if (t.index >= t.queue.length) { showVocabResult_(); return; }
  renderVocabQuestion_();
}

function showVocabResult_() {
  const t = vstate.test;
  const ids = Object.keys(t.firstTry);
  const correct = ids.filter(function (id) { return t.firstTry[id]; }).length;
  const pct = ids.length > 0 ? Math.round(correct / ids.length * 100) : 0;
  let html = '<p class="result-score">' + pct + '%</p><p class="memorize-note">' + correct + ' / ' + ids.length + ' 問正解(最初の回答で判定)</p>';
  if (t.wrong.length > 0) {
    html += '<p class="section-label">間違えた語</p><ul class="vwrong-list">' +
      t.wrong.map(function (w) { return '<li><b>' + escapeHtml_(w.english) + '</b> ' + escapeHtml_(w.meaning) + '</li>'; }).join('') + '</ul>';
  }
  document.getElementById('vresultBody').innerHTML = html;
  showScreen('screen-vresult');
}

// ---- Data: 進捗の表示 ----
function renderVocabOverview_() {
  const o = vstate.overview;
  const notice = document.getElementById('vocabNotice');
  notice.style.display = o.needT1900Check ? '' : 'none';

  let html = '<p class="section-label">段階は上から順に進みます。前の段階の累計習得率が' + o.gateRate + '%になると次が解放されます(目標は' + o.goalRate + '%)。' +
    (o.examNear ? '試験日が近いため、現在はすべて解放されています。' : '') + '</p><div class="vstage-grid">';
  o.stages.forEach(function (s) {
    if (s.enabled && s.total === 0) return; // 該当する語がない段階は出さない
    html += '<div class="vstage"><div class="vstage-label">' + escapeHtml_(s.label) + '</div>';
    if (!s.started) {
      html += '<div class="vstage-pct vstage-off">未開始(Settingでオフ)</div>';
    } else {
      html += '<div class="vbar"><div class="vbar-fill" style="width:' + s.percent + '%"></div>' +
        '<div class="vbar-goal" style="left:' + o.goalRate + '%" title="目標' + o.goalRate + '%"></div></div>' +
        '<div class="vstage-pct">習得 ' + s.percent + '%(' + s.mastered + ' / ' + s.total + ')' +
        (s.stage === 'X' ? '' : ' ・ 累計 ' + s.cumPercent + '%') + '</div>';
      if (!s.open) {
        html += '<div class="vstage-lock">🔒 ロック中(' + escapeHtml_(s.prevLabel || '前の段階') + 'の累計習得が' + o.gateRate + '%で解放。いま ' + (s.prevCumPercent === null ? 0 : s.prevCumPercent) + '%)</div>';
      }
    }
    html += '</div>';
  });
  html += '</div>';
  html += '<p class="section-label">全体カバー率(対象の語のうち習得した割合): <b>' + o.coverage + '%</b></p>';
  html += '<p class="section-label">T1900の到達番号(連続して習得できている最大の番号): <b>' + o.t1900.reach + '</b> / 1900</p>';
  html += '<p class="section-label">T1900(100番ごと)  <span class="vlegend vl-m">習得</span><span class="vlegend vl-l">学習中</span><span class="vlegend vl-x">期限切れ</span><span class="vlegend vl-n">未</span></p>';
  html += '<div class="vblocks">';
  o.t1900.blocks.forEach(function (b) {
    const n = b.to - b.from + 1;
    html += '<div class="vblock" title="' + b.from + '〜' + b.to + '"><div class="vblock-bar">' +
      '<span class="vl-m" style="width:' + (b.mastered / n * 100) + '%"></span>' +
      '<span class="vl-l" style="width:' + (b.learning / n * 100) + '%"></span>' +
      '<span class="vl-x" style="width:' + (b.expired / n * 100) + '%"></span>' +
      '<span class="vl-n" style="width:' + (b.none / n * 100) + '%"></span></div><div class="vblock-no">' + b.from + '</div></div>';
  });
  html += '</div>';
  html += '<p class="section-label">今週のテスト数: <b>' + o.weekTests + '</b> 問 / 連続学習日数: <b>' + o.streakDays + '</b> 日</p>';
  if (o.weakWords.length > 0) {
    html += '<p class="section-label">弱点語(誤答が多い語)</p><ul class="vwrong-list">' +
      o.weakWords.map(function (w) { return '<li><b>' + escapeHtml_(w.english) + '</b> ' + escapeHtml_(w.meaning) + '(×' + w.wrong + ')</li>'; }).join('') + '</ul>';
  }
  document.getElementById('vocabOverviewBody').innerHTML = html;
}
