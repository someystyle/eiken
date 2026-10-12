// 英検2級 家族合格システム - フロントエンド (MVP)
// 設計書V2 3章・6章 に対応

// ★ GASをウェブアプリとしてデプロイした後、発行されたURLをここに設定してください。
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbxnQQdJqVCD23KNfoA6Pr5HYB1YFJoW0Im39TK7k9-AjLXZu3y-0vtth9eZNrOh8vAySw/exec';

const LS_TOKEN_KEY = 'eiken_family_token';

const state = {
  token: null,
  user: null,
  minutes: null,
  condition: null,
  debugMode: 'auto', // 確認用アカウント限定。'auto' | 'memorize' | 'quiz' | 'reading' | 'listening'
  questions: [],
  currentIndex: 0,
  correctCount: 0,
  questionStartTime: null,
  listeningReplayCount: 0, // 現在の設問で「もう一度聞く」を押した回数
  currentPractice: null, // Writing/Speaking練習中の課題データ
  practiceStartTime: null,
  examResult: null, // 受験結果フォームで選択中の合格/不合格
  currentTargetExamDate: null, // 現在登録されている目標試験日(結果記録フォームの表示判定に使う)
  isMockExam: false, // 5-3節: 月次模試を受験中かどうか
  mockTally: null, // 技能別の正解数/問題数 { Vocabulary: {correct,total}, Reading: {...}, Listening: {...} }
  pronunciationWords: [], // 発音再生機能の今回のバッチ(10語)
  pronunciationIndex: 0,
  radarMax: 'auto', // レーダーチャートの目盛り: 'auto' または 100 / 50 / 25 / 10(点)
  lastSkillScores: []
};

// ---- 画面切替 ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function (el) { el.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
}

// ---- API呼び出し (GETのクエリパラメータのみ。CORSプリフライトを避けるため) ----
function callApi(action, params) {
  try {
    const url = new URL(GAS_API_URL);
    url.searchParams.set('action', action);
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] !== undefined && params[k] !== null) url.searchParams.set(k, params[k]);
    });
    return fetch(url.toString()).then(function (res) { return res.json(); });
  } catch (err) {
    // GAS_API_URL が未設定/不正な場合など、fetch前の同期エラーもPromiseの失敗として扱う
    return Promise.reject(err);
  }
}

// ---- 初期化 ----
// 画面に表示する版。index.html の ?v= と同じ値にして、どのファイルが読み込まれているか確認できるようにする。
const APP_VERSION = '2026-10-12e';

window.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.app-version').forEach(function (el) { el.textContent = '版: ' + APP_VERSION; });
  const saved = safeGetLocalStorage(LS_TOKEN_KEY);
  if (saved) {
    state.token = saved;
    autoLogin_(saved, 1);
  } else {
    showScreen('screen-login');
  }

  document.getElementById('autoLoginRetryBtn').addEventListener('click', function () {
    autoLogin_(safeGetLocalStorage(LS_TOKEN_KEY) || state.token, 1);
  });
  document.getElementById('autoLoginOtherBtn').addEventListener('click', showManualLogin_);

  document.getElementById('loginBtn').addEventListener('click', function () {
    const val = document.getElementById('tokenInput').value.trim();
    if (!val) return;
    doLogin(val);
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    stopSpeakingPracticeTimers_();
    stopSpeech_();
    safeRemoveLocalStorage(LS_TOKEN_KEY);
    state.token = null;
    state.user = null;
    state.debugMode = 'auto';
    document.getElementById('tokenInput').value = '';
    document.getElementById('debugModeCard').style.display = 'none';
    showManualLogin_();
  });

  setupChipGroup('minutesChips', function (val) { state.minutes = val; updateStartBtn(); });
  setupChipGroup('conditionChips', function (val) { state.condition = val; updateStartBtn(); });
  setupChipGroup('debugModeChips', function (val) { state.debugMode = val; });
  setupChipGroup('statsViewChips', function (val) {
    document.getElementById('statsBody').style.display = (val === 'numbers') ? '' : 'none';
    document.getElementById('statsNote').style.display = (val === 'numbers') ? '' : 'none';
    document.getElementById('statsIntro').style.display = (val === 'numbers') ? '' : 'none';
    document.getElementById('statsTitle').textContent = (val === 'numbers') ? '全単語の進捗' : '5技能のバランス';
    document.getElementById('statsGraphBody').style.display = (val === 'graph') ? '' : 'none';
    document.getElementById('radarZoomBox').style.display = (val === 'graph') ? '' : 'none';
  });
  setupChipGroup('radarZoomChips', function (val) {
    state.radarMax = val;
    document.getElementById('statsGraphBody').innerHTML = renderSkillRadarChart_(state.lastSkillScores || []);
  });
  setupHomeTabs();

  document.getElementById('startBtn').addEventListener('click', startSession);
  document.getElementById('listeningStartBtn').addEventListener('click', function () {
    const v = document.getElementById('listeningRoundSelect').value.split('|');
    startListeningSet_(document.getElementById('listeningGradeSelect').value, v[0] || '', v[1] || '');
  });
  document.getElementById('listeningGradeSelect').addEventListener('change', function () {
    state.listeningGrade = this.value;
    renderListeningMenu_();
  });
  document.getElementById('listeningRoundSelect').addEventListener('change', updateListeningThroughBtn_);
  document.getElementById('listeningThroughBtn').addEventListener('click', function () {
    const v = document.getElementById('listeningRoundSelect').value.split('|');
    if (v.length === 2) startListeningThrough_(document.getElementById('listeningGradeSelect').value, v[0], v[1]);
  });
  document.getElementById('quitQuizBtn').addEventListener('click', function () {
    stopSpeech_(); // Listening再生中に中断した場合、音声を止め忘れないように
    state.isMockExam = false; // 模試を中断した場合、結果は記録せず状態だけリセットする
    showScreen('screen-home');
    loadStats();
  });
  document.getElementById('backHomeBtn').addEventListener('click', function () {
    stopSpeech_();
    showScreen('screen-home');
    loadStats();
  });

  document.getElementById('startMockExamBtn').addEventListener('click', startMockExam);

  document.getElementById('writingPracticeBtn').addEventListener('click', function () { startPractice('Writing'); });
  document.getElementById('speakingPracticeBtn').addEventListener('click', function () { startPractice('Speaking'); });
  document.getElementById('quitPracticeBtn').addEventListener('click', function () {
    stopSpeakingPracticeTimers_();
    stopSpeech_();
    showScreen('screen-home');
    loadStats();
  });

  document.getElementById('pronunciationBtn').addEventListener('click', function () {
    const v = parseInt(document.getElementById('pronStartInput').value, 10);
    startPronunciation(isNaN(v) || v < 1 ? null : v);
  });
  document.getElementById('pronunciationRepeatBtn').addEventListener('click', function () { playCurrentPronunciationWord_(true); });
  document.getElementById('pronunciationNextBtn').addEventListener('click', nextPronunciationWord);
  document.getElementById('quitPronunciationBtn').addEventListener('click', function () {
    stopSpeech_();
    showScreen('screen-home');
    loadStats();
  });

  setupVocab_();

  document.getElementById('togglePauseFormBtn').addEventListener('click', function () {
    const form = document.getElementById('pauseForm');
    form.style.display = (form.style.display === 'none') ? '' : 'none';
  });
  document.getElementById('submitPauseBtn').addEventListener('click', submitPausePeriod);

  document.getElementById('toggleExamFormBtn').addEventListener('click', function () {
    const form = document.getElementById('examForm');
    form.style.display = (form.style.display === 'none') ? '' : 'none';
  });
  document.getElementById('submitExamBtn').addEventListener('click', submitExamDate);

  renderExamResultScoreInputs();
  document.getElementById('toggleExamResultFormBtn').addEventListener('click', function () {
    const form = document.getElementById('examResultForm');
    form.style.display = (form.style.display === 'none') ? '' : 'none';
  });
  setupChipGroup('examResultChips', function (val) { state.examResult = val; });
  document.getElementById('submitExamResultBtn').addEventListener('click', submitExamResult);
});

function stopSpeech_() {
  if (typeof vocabCancelSpeakTimer_ === 'function') vocabCancelSpeakTimer_();
  stopListeningAudio_();
  try {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  } catch (e) { /* ignore */ }
}

function safeGetLocalStorage(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function safeSetLocalStorage(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
}
function safeRemoveLocalStorage(key) {
  try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
}

function setupChipGroup(containerId, onSelect) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      container.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('selected'); });
      chip.classList.add('selected');
      onSelect(chip.dataset.value);
    });
  });
}

// ---- ホーム画面のタブ切替(Study/Data/Setting。縦に長くなりすぎたホーム画面を分割) ----
const LS_HOME_TAB_KEY = 'eiken_family_home_tab';

function switchHomeTab(tab) {
  document.querySelectorAll('.home-tab').forEach(function (btn) {
    btn.classList.toggle('selected', btn.dataset.tab === tab);
  });
  document.querySelectorAll('.home-tab-panel').forEach(function (panel) {
    panel.classList.toggle('active', panel.dataset.tabPanel === tab);
  });
  safeSetLocalStorage(LS_HOME_TAB_KEY, tab);
}

function setupHomeTabs() {
  document.querySelectorAll('.home-tab').forEach(function (btn) {
    btn.addEventListener('click', function () { switchHomeTab(btn.dataset.tab); });
  });
  const saved = safeGetLocalStorage(LS_HOME_TAB_KEY);
  // 初めて開いた人(どのタブも開いたことがない)には「はじめに」を見せる
  switchHomeTab(saved || 'intro');
}

function updateStartBtn() {
  document.getElementById('startBtn').disabled = !(state.minutes && state.condition);
}

// ---- ログイン (3-3節: 初回のみトークン入力、以降はlocalStorageで自動ログイン) ----
// 保存済みトークンでの自動ログインは、通信の失敗や応答の遅れ(GASの起動待ち)では入力画面に戻さず、
// 自動で再試行する。トークンを消すのは、サーバーが「無効なトークン」と返したときだけ。
const AUTO_LOGIN_MAX_ATTEMPTS = 3;

function showManualLogin_() {
  document.getElementById('autoLoginBox').style.display = 'none';
  document.getElementById('manualLoginBox').style.display = '';
  showScreen('screen-login');
}

function showAutoLogin_(message, canRetry) {
  document.getElementById('manualLoginBox').style.display = 'none';
  document.getElementById('autoLoginBox').style.display = '';
  document.getElementById('autoLoginMsg').textContent = message;
  document.getElementById('autoLoginRetryBtn').style.display = canRetry ? '' : 'none';
  showScreen('screen-login');
}

function finishLogin_(token, res) {
  state.token = token;
  state.user = res.user;
  safeSetLocalStorage(LS_TOKEN_KEY, token);
  document.getElementById('userNameLabel').textContent = res.user.name + ' さん';
  // 保護者確認用アカウントだけ、出題形式を任意に指定できるデバッグ欄を出す
  document.getElementById('debugModeCard').style.display = (res.user.role === '保護者確認用') ? '' : 'none';
  showScreen('screen-home');
  loadStats();
  // 利用者が変わった場合に備え、単語の設定は新しいログインのたびに読み込み直す
  vstate.settingsLoaded = false;
  vstate.dirty = false;
  vstate.settings = null;
  loadVocabHome_();
}

function autoLogin_(token, attempt) {
  showAutoLogin_(attempt > 1 ? 'ログイン中...(再試行 ' + attempt + '/' + AUTO_LOGIN_MAX_ATTEMPTS + ')' : 'ログイン中...', false);
  const retryOrGiveUp = function () {
    if (attempt < AUTO_LOGIN_MAX_ATTEMPTS) {
      setTimeout(function () { autoLogin_(token, attempt + 1); }, 1500 * attempt);
    } else {
      showAutoLogin_('通信できませんでした。電波の状態を確認して、もう一度お試しください。', true);
    }
  };
  callApi('login', { token: token }).then(function (res) {
    if (res.ok) { finishLogin_(token, res); return; }
    if (/無効なトークン/.test(String(res.error || ''))) {
      safeRemoveLocalStorage(LS_TOKEN_KEY);
      showManualLogin_();
      document.getElementById('loginError').textContent = '保存されていたトークンが無効です。もう一度入力してください。';
      return;
    }
    retryOrGiveUp();
  }).catch(retryOrGiveUp);
}

function doLogin(token) {
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  callApi('login', { token: token }).then(function (res) {
    if (!res.ok) {
      errEl.textContent = 'トークンが正しくありません。';
      return;
    }
    finishLogin_(token, res);
  }).catch(function () {
    errEl.textContent = '通信に失敗しました。GAS_API_URLの設定を確認してください。';
  });
}

// ---- 進捗表示 (5-2節: 表示用スコアは下がらない) ----
function loadStats() {
  const body = document.getElementById('statsBody');
  const skillBody = document.getElementById('skillScoreBody');
  body.textContent = '読み込み中...';
  skillBody.textContent = '読み込み中...';
  callApi('getStats', { token: state.token }).then(function (res) {
    if (!res.ok) { body.textContent = '取得に失敗しました。'; skillBody.textContent = '取得に失敗しました。'; return; }
    body.innerHTML = renderStatsGrid(res.stats);
    const skillScores = res.stats.skillScores || [];
    state.lastSkillScores = skillScores;
    skillBody.innerHTML = renderSkillScores(skillScores);
    document.getElementById('statsGraphBody').innerHTML = renderSkillRadarChart_(skillScores);
  }).catch(function () {
    body.textContent = '通信に失敗しました。';
    skillBody.textContent = '通信に失敗しました。';
  });
  loadPausePeriods();
  loadExamInfo();
  loadStudyPlan_();
  loadListeningMenu_();
}

// ---- リスニング(過去問)を解く: 級と回(部)を選んで、リスニングだけを解く ----
function loadListeningMenu_() {
  if (!document.getElementById('listeningBox')) return;
  callApi('getListeningMenu', { token: state.token }).then(function (res) {
    if (!res.ok) { document.getElementById('listeningInfo').textContent = '取得に失敗しました。'; return; }
    state.listeningMenu = res;
    renderListeningMenu_();
  }).catch(function () { document.getElementById('listeningInfo').textContent = '通信に失敗しました。'; });
}

function renderListeningMenu_() {
  const m = state.listeningMenu;
  const info = document.getElementById('listeningInfo');
  if (!m || !m.grades || m.grades.length === 0) { info.textContent = 'リスニングの問題がまだ登録されていません。'; return; }
  const g = m.grades.find(function (x) { return x.grade === (state.listeningGrade || m.defaultGrade); }) || m.grades[0];
  const gsel = document.getElementById('listeningGradeSelect');
  gsel.innerHTML = '';
  m.grades.forEach(function (x) { const o = document.createElement('option'); o.value = x.grade; o.textContent = x.grade + 'の過去問'; gsel.appendChild(o); });
  gsel.value = g.grade;
  gsel.style.display = m.grades.length > 1 ? '' : 'none';
  const sel = document.getElementById('listeningRoundSelect');
  const keep = sel.value;
  sel.innerHTML = '';
  const add = function (value, text) { const o = document.createElement('option'); o.value = value; o.textContent = text; sel.appendChild(o); };
  add('', 'おまかせ5問(まだ解いていない問題から)');
  g.rounds.forEach(function (r) {
    r.parts.forEach(function (p) {
      const mark = p.audio === p.n ? '🎧' : (p.audio > 0 ? '🎧一部' : '🗣️');
      add(r.round + '|' + p.part, mark + ' ' + r.round + ' ' + p.part + '(No.' + p.from + '〜' + p.to + '・' + p.n + '問)');
    });
  });
  if (keep && [].some.call(sel.options, function (o) { return o.value === keep; })) sel.value = keep;
  info.textContent = '全' + g.total + '問(' + g.grade + ')・解いた問題 ' + g.answered + '問';
  state.listeningPartAudio = {};
  g.rounds.forEach(function (r) { r.parts.forEach(function (p) { state.listeningPartAudio[r.round + '|' + p.part] = p.n > 0 && p.audio === p.n; }); });
  updateListeningThroughBtn_();
}

// 本番形式の通し聞きは、回と部を選び、その部の全問に本番の音声があるときだけ使える
function updateListeningThroughBtn_() {
  const v = document.getElementById('listeningRoundSelect').value;
  const ok = !!v && !!(state.listeningPartAudio && state.listeningPartAudio[v]);
  document.getElementById('listeningThroughBtn').disabled = !ok;
  document.getElementById('listeningThroughNote').textContent = !v
    ? '回と部を選ぶと使えます。日本語の説明から最後まで、本番と同じ流れで続けて流れます(速さは本番どおり)。'
    : (ok ? '日本語の説明から最後まで、本番と同じ流れで続けて流れます(速さは本番どおり)。各問題の解答時間に答えを選んでください。'
      : 'この部は本番の音声が使えないため、通し聞きはできません。');
}

// ---- 本番形式の通し聞き: 部の音声ファイルを最初から最後まで流し、問題を順に切り替える ----
// 各問題の範囲(音声開始秒〜音声終了秒)と、その後の10秒の解答時間に答えを選ぶ。答えは最後にまとめて記録する。
function startListeningThrough_(grade, round, part) {
  showScreen('screen-quiz');
  const card = document.getElementById('quizCard');
  card.innerHTML = '<p class="quiz-word">準備中...</p>';
  document.getElementById('quizProgress').textContent = '';
  callApi('getListeningSet', { token: state.token, grade: grade, round: round, part: part, ordered: '1' }).then(function (res) {
    const qs = (res && res.ok && res.questions) || [];
    if (qs.length === 0 || qs.some(function (q) { return !q.audio; })) {
      card.innerHTML = '<p class="quiz-word">この部は本番の音声が使えません</p>';
      return;
    }
    const t = state.through = {
      grade: grade, round: round, part: part, questions: qs, answers: {}, current: -1,
      url: qs[0].audio.url, objUrl: null, started: false, finished: false
    };
    renderThroughFrame_();
    loadListeningBlob_(t.url).then(function (objUrl) {
      if (state.through !== t) return;
      t.objUrl = objUrl;
      const btn = document.getElementById('throughPlayBtn');
      if (btn) { btn.disabled = false; btn.textContent = '▶ 再生を始める'; }
      document.getElementById('throughStatus').textContent = '準備ができました。「再生を始める」を押してください。';
    }).catch(function () {
      if (state.through !== t) return;
      document.getElementById('throughStatus').textContent = '音声を読み込めませんでした。通信状態を確かめて、もう一度お試しください。';
    });
  }).catch(function () { card.innerHTML = '<p class="quiz-word">通信に失敗しました</p>'; });
}

function renderThroughFrame_() {
  const t = state.through;
  const card = document.getElementById('quizCard');
  card.innerHTML =
    '<p class="reading-label">Listening ' + escapeHtml_(t.part) + ' 本番形式(通し)</p>' +
    '<p class="listening-speed-label">' + escapeHtml_(t.grade + ' ' + t.round) + '・全' + t.questions.length + '問・速さは本番どおり</p>' +
    '<button id="throughPlayBtn" class="btn-primary listening-play-btn" disabled>音声を読み込み中…</button>' +
    '<p id="throughStatus" class="quiz-instruction reading-instruction">音声を読み込んでいます(はじめの1回だけ、少し時間がかかります)</p>' +
    '<div id="throughQuestion"></div>';
  document.getElementById('throughPlayBtn').addEventListener('click', onThroughPlayBtn_);
}

function onThroughPlayBtn_() {
  const t = state.through;
  if (!t || !t.objUrl) return;
  const audio = listeningAudioEl_();
  const btn = document.getElementById('throughPlayBtn');
  if (!t.started) {
    t.started = true;
    stopListeningAudio_();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    audio.dataset.url = t.objUrl;
    audio.muted = false;
    audio.src = t.objUrl;
    audio.playbackRate = 1.0;
    const token = listeningAudioToken_;
    listeningAudioStop_ = function () { if (token === listeningAudioToken_) onThroughTime_(audio.currentTime); };
    audio.addEventListener('timeupdate', listeningAudioStop_);
    audio.addEventListener('ended', function () { if (token === listeningAudioToken_) finishThrough_(); }, { once: true });
    const p = audio.play();
    if (p && p.catch) p.catch(function () {
      t.started = false;
      document.getElementById('throughStatus').textContent = '再生できませんでした。もう一度「再生を始める」を押してください。';
    });
    btn.textContent = '⏸ 一時停止';
    document.getElementById('throughStatus').textContent = '日本語の説明が流れています。そのまま聞いてください。';
    return;
  }
  if (audio.paused) { audio.play(); btn.textContent = '⏸ 一時停止'; }
  else { audio.pause(); btn.textContent = '▶ 続きから再生'; }
}

// 再生位置から、今どの問題か(放送中か解答時間か)を決めて、画面を切り替える
function onThroughTime_(sec) {
  const t = state.through;
  if (!t || t.finished) return;
  const qs = t.questions;
  let k = -1;
  for (let i = 0; i < qs.length; i++) { if (sec >= qs[i].audio.start) k = i; }
  if (k !== t.current) { t.current = k; if (k >= 0) renderThroughQuestion_(k); }
  if (k >= 0) {
    const q = qs[k];
    const answering = sec >= q.audio.end;
    document.getElementById('throughStatus').textContent = 'No.' + q.number + (answering ? ' 解答時間です。答えを選んでください' : ' を放送中');
    // 最後の問題の解答時間(10秒)が終わったら結果へ(その後は終了のアナウンスだけ)
    if (k === qs.length - 1 && sec >= q.audio.end + 10.5) finishThrough_();
  }
}

function renderThroughQuestion_(k) {
  const t = state.through;
  const q = t.questions[k];
  document.getElementById('quizProgress').textContent = (k + 1) + ' / ' + t.questions.length;
  // 本番の冊子と同じく、質問文は見せず選択肢だけを出す(準2級の第1部は選択肢も放送のみなので番号だけ)
  const numbersOnly = q.grade === '準2級' && q.sectionType === '第1部';
  const box = document.getElementById('throughQuestion');
  box.innerHTML = '<p class="through-no">No.' + q.number + '</p><div class="choice-list" id="throughChoices"></div>';
  const list = document.getElementById('throughChoices');
  q.choices.forEach(function (c, i) {
    const b = document.createElement('button');
    b.className = 'choice-btn' + (t.answers[k] === c ? ' selected' : '');
    b.textContent = (i + 1) + (numbersOnly ? '' : '  ' + c);
    b.addEventListener('click', function () {
      if (t.current !== k || t.finished) return;
      t.answers[k] = c;
      list.querySelectorAll('.choice-btn').forEach(function (x) { x.classList.remove('selected'); });
      b.classList.add('selected');
    });
    list.appendChild(b);
  });
}

// 終わったら、全問の答えを記録して結果を出す(答えなかった問題は不正解として記録)
function finishThrough_() {
  const t = state.through;
  if (!t || t.finished) return;
  t.finished = true;
  stopListeningAudio_();
  const card = document.getElementById('quizCard');
  card.innerHTML = '<p class="quiz-word">答え合わせ中...</p>';
  const answers = {};
  t.questions.forEach(function (q, k) { answers[q.questionId] = t.answers[k] || ''; });
  callApi('submitListeningBatch', { token: state.token, answers: JSON.stringify(answers) }).then(function (res) {
    const byId = (res && res.ok && res.results) || {};
    let correct = 0;
    let html = '';
    t.questions.forEach(function (q, k) {
      const r = byId[q.questionId] ? Object.assign({ ok: true }, byId[q.questionId]) : null;
      const ok = !!(r && r.correct);
      if (ok) correct++;
      const mine = t.answers[k];
      const mineNo = mine ? (q.choices.indexOf(mine) + 1) : 0;
      const ansNo = r && r.ok ? (q.choices.indexOf(r.answer) + 1) : 0;
      html += '<details class="through-result ' + (ok ? 'ok' : 'ng') + '"><summary>' + (ok ? '○' : '×') + ' No.' + q.number +
        ' あなた: ' + (mineNo ? mineNo : '未回答') + ' / 正解: ' + (ansNo || '?') + '</summary>' +
        (q.questionText && /[A-Za-z]/.test(q.questionText) ? '<p class="through-q">' + escapeHtml_(q.questionText) + '</p>' : '') +
        '<ol class="through-choices">' + q.choices.map(function (c) { return '<li>' + escapeHtml_(c) + '</li>'; }).join('') + '</ol>' +
        '<div class="reading-passage listening-script">' + escapeHtml_(q.script).replace(/\n/g, '<br>') + '</div></details>';
    });
    card.innerHTML = '<p class="reading-label">Listening ' + escapeHtml_(t.part) + ' 本番形式(通し)の結果</p>' +
      '<p class="quiz-word" style="font-size:24px;">' + correct + ' / ' + t.questions.length + ' 問正解</p>' +
      '<p class="memorize-note">各問題を押すと、質問・選択肢・原稿が見られます。</p>' + html +
      '<button id="throughHomeBtn" class="btn-primary">ホームに戻る</button>';
    document.getElementById('throughHomeBtn').addEventListener('click', function () {
      state.through = null;
      showScreen('screen-home');
      loadStats();
    });
  }).catch(function () {
    card.innerHTML = '<p class="quiz-word">答えを記録できませんでした(通信エラー)</p>';
  });
}

function startListeningSet_(grade, round, part) {
  showScreen('screen-quiz');
  document.getElementById('quizCard').innerHTML = '<p class="quiz-word">出題中...</p>';
  callApi('getListeningSet', { token: state.token, grade: grade, round: round, part: part, count: 5 }).then(function (res) {
    if (!res.ok || !res.questions || res.questions.length === 0) {
      document.getElementById('quizCard').innerHTML = '<p class="quiz-word">出題できる問題がありません</p>';
      return;
    }
    state.questions = res.questions;
    state.currentIndex = 0;
    state.correctCount = 0;
    state.rehabMode = false;
    renderQuestion();
  }).catch(function () { document.getElementById('quizCard').innerHTML = '<p class="quiz-word">通信に失敗しました</p>'; });
}

// ---- 学習計画: 試験日から逆算した「今日の目安」 ----
function loadStudyPlan_() {
  const body = document.getElementById('studyPlanBody');
  if (!body) return;
  callApi('getStudyPlan', { token: state.token }).then(function (res) {
    if (!res.ok) { body.textContent = '取得に失敗しました。'; return; }
    body.innerHTML = renderStudyPlan_(res);
    const goBtn = document.getElementById('studyPlanGoSetting');
    if (goBtn) goBtn.addEventListener('click', function () { switchHomeTab('setting'); });
  }).catch(function () { body.textContent = '通信に失敗しました。'; });
}

function renderStudyPlan_(res) {
  if (!res.hasTarget) {
    return '<p class="memorize-note">目標の試験日を登録すると、試験日から逆算して「今日はどれだけやればよいか」の目安を出します。</p>' +
      '<button id="studyPlanGoSetting" class="btn-link">⚙️ Settingで試験日を登録する</button>';
  }
  let html = '<p class="quiz-instruction reading-instruction">試験日 ' + escapeHtml_(res.examDate) + ' まで あと<b>' + res.daysLeft + '日</b></p>';
  html += res.finalReview
    ? '<p class="memorize-note">試験まで4週間を切りました。新しい内容は残りの半分の日数で終え、その後は復習・間違えた問題の解き直しにあてましょう。</p>'
    : '<p class="memorize-note">新しい内容(まだ見ていない単語・まだ解いていない過去問)を ' + escapeHtml_(res.finishDate) +
      ' までに終える計画です。最後の2週間は総復習にあてます。目安は毎日「残りの量÷残りの日数」で計算し直すので、休んだ日があっても少しずつ取り戻せます。</p>';
  html += '<div class="plan-list">';
  res.items.forEach(function (it) {
    if (it.key !== 'vocabReview' && !it.total) return; // その級の問題がまだ無い項目は出さない
    let right;
    if (it.reviewOnly) {
      right = it.remaining > 0 ? '残り <b>' + it.remaining + '</b>' + it.unit : '<span class="plan-done">今日復習する語はありません</span>';
    } else if (it.target === 0) {
      right = '<span class="plan-done">✅ 全部終わりました</span>';
    } else {
      const done = Math.min(it.done, it.target);
      const ok = it.done >= it.target;
      right = it.period + ' <b>' + it.done + '</b> / ' + it.target + it.unit + (ok ? ' <span class="plan-done">✅</span>' : '');
      right += '<div class="plan-bar"><div class="plan-bar-fill' + (ok ? ' ok' : '') + '" style="width:' + Math.round(done / it.target * 100) + '%"></div></div>';
    }
    let sub = '';
    if (!it.reviewOnly && it.total) sub = '残り ' + it.remaining + ' / 全' + it.total + it.unit;
    if (it.status === 'behind') sub += ' <span class="plan-behind">予定より' + it.diff + it.unit + '遅れ</span>';
    else if (it.status === 'ahead') sub += ' <span class="plan-ahead">予定より' + it.diff + it.unit + '先行</span>';
    html += '<div class="plan-row"><div class="plan-label">' + escapeHtml_(it.label) +
      (sub ? '<div class="plan-sub">' + sub + '</div>' : '') + '</div><div class="plan-right">' + right + '</div></div>';
  });
  html += '</div>';
  if (res.vocabOverMax) html += '<p class="memorize-note">単語の目安が多めです。T1900見出し語を優先し、余力があれば他の語に進みましょう。</p>';
  if (res.lags && res.lags.length) html += '<p class="plan-lag">⚠ 予定より遅れている項目があります(赤字)。今日の目安は遅れの分も含めて計算し直しているので、目安どおりに進めれば少しずつ追いつけます。</p>';
  else if (res.tracking) html += '<p class="memorize-note">計画を始めた日(' + escapeHtml_(res.planStart) + ')の予定どおりに進んでいます。</p>';
  return html;
}

// ---- 5技能バランスのレーダーチャート(何が不得意か一目で分かる用途) ----
// 軸ラベルは長い正式名称(リーディング等)だとSVGのviewBox外にはみ出て欠けてしまうため、
// 短縮表記を使い、text-anchorも常にmiddleに統一して幅を左右対称に抑える。
const SKILL_SHORT_LABELS = {
  Vocabulary: '語彙',
  Reading: '読解',
  Listening: '聴解',
  Writing: '英作文',
  Speaking: '面接'
};

function renderSkillRadarChart_(skillScores) {
  const order = ['Vocabulary', 'Reading', 'Listening', 'Writing', 'Speaking'];
  const byName = {};
  skillScores.forEach(function (s) { byName[s.skill] = s; });
  const points = order.map(function (name) {
    const s = byName[name];
    return {
      label: SKILL_LABELS[name] || name,
      shortLabel: SKILL_SHORT_LABELS[name] || name,
      value: s ? Math.max(0, Math.min(100, s.displayScore)) : 0
    };
  });

  // 目盛り(外側の線が何点か)。点数が低い時期は、自動または手動で拡大して見やすくする。
  const topValue = points.reduce(function (m, p) { return Math.max(m, p.value); }, 0);
  const steps = [10, 20, 30, 50, 75, 100];
  let scaleMax = 100;
  if (state.radarMax === 'auto') {
    scaleMax = steps.filter(function (s) { return s >= topValue * 1.2; })[0] || 100;
  } else {
    scaleMax = Number(state.radarMax) || 100;
  }

  const size = 300, center = size / 2, maxRadius = 78;
  const angleStep = (Math.PI * 2) / points.length;
  const axisStart = -Math.PI / 2;

  function coordAt(i, ratio) {
    const angle = axisStart + angleStep * i;
    return {
      x: center + Math.cos(angle) * maxRadius * ratio,
      y: center + Math.sin(angle) * maxRadius * ratio
    };
  }

  // 背景のグリッド線(目盛りの25/50/75/100%の五角形)
  const gridLevels = [0.25, 0.5, 0.75, 1];
  const gridPolygons = gridLevels.map(function (ratio) {
    const pts = points.map(function (_, i) { const c = coordAt(i, ratio); return c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' ');
    return '<polygon points="' + pts + '" fill="none" stroke="#dde3dd" stroke-width="1"></polygon>';
  }).join('');
  // 各線が何点かを、上の軸に沿って小さく表示する
  const ringLabels = gridLevels.map(function (ratio) {
    const c = coordAt(0, ratio);
    const v = Math.round(scaleMax * ratio * 10) / 10;
    return '<text x="' + (c.x + 3).toFixed(1) + '" y="' + (c.y + 3).toFixed(1) + '" font-size="8" fill="#889">' + v + '</text>';
  }).join('');

  // 中心から各軸への線
  const axisLines = points.map(function (_, i) {
    const c = coordAt(i, 1);
    return '<line x1="' + center + '" y1="' + center + '" x2="' + c.x.toFixed(1) + '" y2="' + c.y.toFixed(1) + '" stroke="#dde3dd" stroke-width="1"></line>';
  }).join('');

  // 実際の値を結ぶ五角形(目盛りを超える値は外周で止める)
  const valuePts = points.map(function (p, i) { const c = coordAt(i, Math.min(1, p.value / scaleMax)); return c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' ');

  // 軸ラベル(短縮技能名+点数を2行で。常にmiddle揃えなので左右にはみ出さない)
  const labels = points.map(function (p, i) {
    const c = coordAt(i, 1.32);
    return '<text x="' + c.x.toFixed(1) + '" y="' + c.y.toFixed(1) + '" font-size="12" text-anchor="middle" fill="#334">' +
      '<tspan x="' + c.x.toFixed(1) + '" dy="0">' + p.shortLabel + '</tspan>' +
      '<tspan x="' + c.x.toFixed(1) + '" dy="14" font-size="10" fill="#2d6a4f">' + p.value + '点</tspan>' +
      '</text>';
  }).join('');

  const weakest = points.slice().sort(function (a, b) { return a.value - b.value; })[0];

  return '<svg viewBox="0 0 ' + size + ' ' + size + '" class="radar-chart" style="overflow:visible;">' +
    gridPolygons + axisLines + ringLabels +
    '<polygon points="' + valuePts + '" fill="rgba(45,106,79,0.25)" stroke="#2d6a4f" stroke-width="2" stroke-linejoin="round"></polygon>' +
    labels +
    '</svg>' +
    '<p class="graph-caption">外側の線 = ' + scaleMax + '点(目盛りは上のボタンで拡大・縮小できます)<br>今いちばん伸びしろがあるのは「' + weakest.label + '」です</p>';
}

// ---- 休止期間 ----
function loadPausePeriods() {
  const listEl = document.getElementById('pauseList');
  listEl.textContent = '読み込み中...';
  callApi('getPausePeriods', { token: state.token }).then(function (res) {
    if (!res.ok) { listEl.textContent = '取得に失敗しました。'; return; }
    const periods = res.pausePeriods || [];
    if (periods.length === 0) {
      listEl.innerHTML = '<p class="memorize-note">登録されている休止期間はありません。</p>';
      return;
    }
    listEl.innerHTML = periods.map(function (p) {
      return '<div class="pause-item">' +
        '<span class="pause-item-dates">' + p.startDate + ' 〜 ' + p.endDate + '</span>' +
        (p.reason ? '<span class="pause-item-reason">' + escapeHtml_(p.reason) + '</span>' : '') +
        '</div>';
    }).join('');
  }).catch(function () { listEl.textContent = '通信に失敗しました。'; });
}

function submitPausePeriod() {
  const startDate = document.getElementById('pauseStartInput').value;
  const endDate = document.getElementById('pauseEndInput').value;
  const reason = document.getElementById('pauseReasonInput').value;
  const errEl = document.getElementById('pauseError');
  errEl.textContent = '';

  if (!startDate || !endDate) {
    errEl.textContent = '開始日と終了日を入力してください。';
    return;
  }
  // 一部ブラウザ/端末では年が4桁を超えて入力できてしまうことがあるため、念のため形式を検証する
  const dateFormat = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateFormat.test(startDate) || !dateFormat.test(endDate)) {
    errEl.textContent = '日付の形式が正しくありません(年は4桁で入力してください)。';
    return;
  }
  if (endDate < startDate) {
    errEl.textContent = '終了日は開始日より後にしてください。';
    return;
  }

  const btn = document.getElementById('submitPauseBtn');
  btn.disabled = true;
  callApi('registerPause', { token: state.token, startDate: startDate, endDate: endDate, reason: reason }).then(function (res) {
    btn.disabled = false;
    if (!res.ok) { errEl.textContent = '登録に失敗しました。'; return; }
    document.getElementById('pauseStartInput').value = '';
    document.getElementById('pauseEndInput').value = '';
    document.getElementById('pauseReasonInput').value = '';
    document.getElementById('pauseForm').style.display = 'none';
    loadPausePeriods();
  }).catch(function () {
    btn.disabled = false;
    errEl.textContent = '通信に失敗しました。';
  });
}

// ---- 目標試験日とペース診断 (13章) ----
function loadExamInfo() {
  const body = document.getElementById('paceDiagnosisBody');
  body.textContent = '読み込み中...';
  callApi('getPaceDiagnosis', { token: state.token }).then(function (res) {
    if (!res.ok) { body.textContent = '取得に失敗しました。'; return; }
    body.innerHTML = renderPaceDiagnosis(res);
  }).catch(function () { body.textContent = '通信に失敗しました。'; });

  callApi('getExamDates', { token: state.token }).then(function (res) {
    if (!res.ok) return;
    state.currentTargetExamDate = res.currentTargetDate;
    const resultToggleBtn = document.getElementById('toggleExamResultFormBtn');
    resultToggleBtn.style.display = res.currentTargetDate ? '' : 'none';

    const historyEl = document.getElementById('examHistory');
    const finished = (res.examDates || []).filter(function (d) { return d.result !== '未受験'; });
    if (finished.length === 0) {
      historyEl.innerHTML = '';
      return;
    }
    historyEl.innerHTML = '<p class="section-label">受験履歴</p>' + finished.map(function (d) {
      return '<div class="pause-item">' +
        '<span class="pause-item-dates">' + d.examDate + '</span>' +
        '<span class="pause-item-reason">' + escapeHtml_(d.result) + '</span>' +
        '</div>';
    }).join('');
  });
}

function renderPaceDiagnosis(res) {
  if (!res.hasTarget) {
    return '<p class="memorize-note">目標試験日がまだ登録されていません。下のボタンから登録してください。</p>';
  }
  const phaseNote = {
    '基礎固め期': '残り期間はまだ余裕があります。大まかなペースを確認しつつ、焦らず基礎を固めましょう。',
    '標準管理期': '合格ラインまでの差と残り週数から、必要な伸びを計算しています。',
    '直前仕上げ期': '直前期です。新しい語彙より、弱点の総復習や過去問演習を優先しましょう。'
  }[res.phase] || '';

  let html = '<p class="quiz-instruction reading-instruction">目標試験日: ' + escapeHtml_(res.examDate) +
    '(あと' + res.daysLeft + '日) — <strong>' + escapeHtml_(res.phase) + '</strong></p>' +
    '<p class="memorize-note">' + phaseNote + '</p>';

  html += '<div class="pace-skill-list">';
  res.skillDiagnoses.forEach(function (d) {
    const label = SKILL_LABELS[d.skill] || d.skill;
    let statusText = 'データ収集中(まだ判定できません)';
    let statusClass = '';
    if (d.onTrack === true) { statusText = '順調なペースです'; statusClass = 'pace-ok'; }
    else if (d.onTrack === false) {
      statusText = 'このペースだと届きにくいかもしれません' +
        (d.extraMinutesPerWeek > 0 ? '(目安: あと週' + d.extraMinutesPerWeek + '分)' : '');
      statusClass = 'pace-behind';
    }
    html += '<div class="pace-skill-row ' + statusClass + '">' +
      '<span class="pace-skill-name">' + escapeHtml_(label) + (d.skill === res.bottleneck ? ' ⚠' : '') + '</span>' +
      '<span class="pace-skill-status">' + statusText + '</span>' +
      '</div>';
  });
  html += '</div>';
  return html;
}

function submitExamDate() {
  const examDate = document.getElementById('examDateInput').value;
  const errEl = document.getElementById('examError');
  errEl.textContent = '';
  if (!examDate) { errEl.textContent = '試験日を入力してください。'; return; }

  const btn = document.getElementById('submitExamBtn');
  btn.disabled = true;
  callApi('registerExamDate', { token: state.token, examDate: examDate }).then(function (res) {
    btn.disabled = false;
    if (!res.ok) { errEl.textContent = '登録に失敗しました。'; return; }
    document.getElementById('examDateInput').value = '';
    document.getElementById('examForm').style.display = 'none';
    loadExamInfo();
  }).catch(function () {
    btn.disabled = false;
    errEl.textContent = '通信に失敗しました。';
  });
}

function renderExamResultScoreInputs() {
  const container = document.getElementById('examResultScoreInputs');
  container.innerHTML = SKILLS_FOR_EXAM.map(function (skill) {
    const label = SKILL_LABELS[skill] || skill;
    return '<div class="exam-score-row">' +
      '<span class="exam-score-label">' + escapeHtml_(label) + '</span>' +
      '<input type="number" min="0" max="100" class="exam-score-input" data-skill="' + skill + '" placeholder="0〜100">' +
      '</div>';
  }).join('');
}

function submitExamResult() {
  const errEl = document.getElementById('examResultError');
  errEl.textContent = '';
  if (!state.currentTargetExamDate) { errEl.textContent = '目標試験日が登録されていません。'; return; }
  if (!state.examResult) { errEl.textContent = '結果(合格/不合格)を選んでください。'; return; }

  const scores = {};
  document.querySelectorAll('.exam-score-input').forEach(function (input) {
    if (input.value !== '') scores[input.dataset.skill] = Number(input.value);
  });

  const btn = document.getElementById('submitExamResultBtn');
  btn.disabled = true;
  callApi('submitExamResult', {
    token: state.token,
    examDate: state.currentTargetExamDate,
    result: state.examResult,
    scores: JSON.stringify(scores)
  }).then(function (res) {
    btn.disabled = false;
    if (!res.ok) { errEl.textContent = '記録に失敗しました。'; return; }
    document.getElementById('examResultForm').style.display = 'none';
    state.examResult = null;
    document.querySelectorAll('#examResultChips .chip').forEach(function (c) { c.classList.remove('selected'); });
    loadExamInfo();
    loadStats();
  }).catch(function () {
    btn.disabled = false;
    errEl.textContent = '通信に失敗しました。';
  });
}

function renderStatsGrid(stats) {
  const accuracyPct = Math.round((stats.accuracy || 0) * 100);
  return [
    statItem(stats.totalLearned, '累計学習語数'),
    statItem(stats.masteredCount, '克服した語'),
    statItem(stats.weakCount, '弱点語'),
    statItem(accuracyPct + '%', '通算正答率')
  ].join('');
}

function statItem(value, label) {
  return '<div class="stat-item"><div class="stat-value">' + value + '</div><div class="stat-label">' + label + '</div></div>';
}

// ---- 技能別実力スコア (5章) ----
const SKILL_LABELS = {
  Vocabulary: 'ボキャブラリー（単語）',
  Reading: 'リーディング',
  Listening: 'リスニング',
  Writing: 'ライティング',
  Speaking: 'スピーキング'
};
const SKILLS_FOR_EXAM = ['Vocabulary', 'Reading', 'Listening', 'Writing', 'Speaking'];

function renderSkillScores(skillScores) {
  return skillScores.map(function (s) {
    const baseLabel = SKILL_LABELS[s.skill] || s.skill;
    const shortLabel = SKILL_SHORT_LABELS[s.skill];
    const label = (shortLabel && s.skill !== 'Vocabulary') ? (baseLabel + '(' + shortLabel + ')') : baseLabel;
    if (!s.implemented) {
      return (
        '<div class="skill-row skill-row-disabled">' +
        '<div class="skill-row-head"><span>' + label + '</span><span class="skill-badge">未実装</span></div>' +
        '<div class="skill-bar-track"><div class="skill-bar-fill" style="width:0%"></div></div>' +
        '</div>'
      );
    }
    const pct = Math.max(0, Math.min(100, s.displayScore));
    // 13章: Reading/Listening/Writingは今挑戦中の級バッジを併記し、立ち位置が一目でわかるようにする
    const levelBadge = s.level ? '<span class="skill-level-badge">' + s.level + '</span>' : '';
    return (
      '<div class="skill-row">' +
      '<div class="skill-row-head"><span>' + label + levelBadge + '</span><span>' + pct + '点</span></div>' +
      '<div class="skill-bar-track"><div class="skill-bar-fill" style="width:' + pct + '%"></div></div>' +
      '</div>'
    );
  }).join('');
}

// ---- セッション開始 (6-1節) ----
// ---- 月次模試 (5-3節) ----
function startMockExam() {
  showScreen('screen-quiz');
  document.getElementById('quizCard').innerHTML = '<p class="quiz-word">出題中...(61問あります)</p>';
  callApi('startMockExam', { token: state.token }).then(function (res) {
    if (!res.ok || !res.questions || res.questions.length === 0) {
      document.getElementById('quizCard').innerHTML = '<p class="quiz-word">出題できる問題がありません</p>';
      return;
    }
    state.questions = res.questions;
    state.currentIndex = 0;
    state.correctCount = 0;
    state.isMockExam = true;
    state.mockTally = {
      Vocabulary: { correct: 0, total: 0 },
      Reading: { correct: 0, total: 0 },
      Listening: { correct: 0, total: 0 }
    };
    renderQuestion();
  });
}

function tallyMock_(skill, correct) {
  if (!state.mockTally || !state.mockTally[skill]) return;
  state.mockTally[skill].total++;
  if (correct) state.mockTally[skill].correct++;
}

function finishMockExam() {
  const tally = state.mockTally;
  const params = { token: state.token };
  ['Vocabulary', 'Reading', 'Listening'].forEach(function (skill) {
    params[skill + 'Correct'] = tally[skill].correct;
    params[skill + 'Total'] = tally[skill].total;
  });

  showScreen('screen-result');
  document.getElementById('resultBody').innerHTML = '<p class="memorize-note">結果を記録しています...</p>';

  callApi('submitMockExamResult', params).then(function (res) {
    state.isMockExam = false;
    const body = document.getElementById('resultBody');
    if (!res.ok) { body.innerHTML = '<p class="memorize-note">記録に失敗しました。</p>'; return; }
    body.innerHTML = ['Vocabulary', 'Reading', 'Listening'].map(function (skill) {
      const label = SKILL_LABELS[skill] || skill;
      const pct = res.result[skill];
      return statItem(pct === null ? '-' : pct + '%', label);
    }).join('') +
      '<p class="memorize-note">この結果をもとに、各技能の実力スコアの精度を補正しました。</p>';
  }).catch(function () {
    state.isMockExam = false;
    document.getElementById('resultBody').innerHTML = '<p class="memorize-note">通信に失敗しました。</p>';
  });
}

function startSession() {
  showScreen('screen-quiz');
  document.getElementById('quizCard').innerHTML = '<p class="quiz-word">出題中...</p>';
  const params = { token: state.token, minutes: state.minutes, condition: state.condition };
  // 保護者確認用アカウントが「自動」以外を選んだ場合のみ、出題形式を強制指定する
  if (state.user && state.user.role === '保護者確認用' && state.debugMode !== 'auto') {
    params.mode = state.debugMode;
  }
  callApi('getQuiz', params).then(function (res) {
    if (!res.ok) {
      document.getElementById('quizCard').innerHTML = '<p class="quiz-word">取得に失敗しました</p>';
      return;
    }
    // 12章: 休止期間中はセッション自体が発生しない
    if (res.paused) {
      document.getElementById('quizCard').innerHTML =
        '<p class="reading-label">休止期間中</p>' +
        '<p class="quiz-word" style="font-size:20px;">現在、休止期間として登録されている期間です。</p>' +
        '<p class="memorize-note">ゆっくり休んでください。休止期間が終わると自動的に元通り学習を再開できます。</p>';
      return;
    }
    if (!res.questions || res.questions.length === 0) {
      document.getElementById('quizCard').innerHTML = '<p class="quiz-word">出題できる問題がありません</p>';
      return;
    }
    state.questions = res.questions;
    state.currentIndex = 0;
    state.correctCount = 0;
    state.rehabMode = !!res.rehabMode;
    renderQuestion();
  });
}

function renderQuestion() {
  const q = state.questions[state.currentIndex];
  document.getElementById('quizProgress').textContent = (state.currentIndex + 1) + ' / ' + state.questions.length;
  if (q.type === 'memorize') {
    renderMemorizeCard(q);
  } else if (q.type === 'reading') {
    renderReadingCard(q);
  } else if (q.type === 'listening') {
    renderListeningCard(q);
  } else {
    renderQuizCard(q);
  }
  // 12-3節: 休止明け直後のリハビリモードであることを、最初の問題でだけ知らせる
  if (state.rehabMode && state.currentIndex === 0) {
    const card = document.getElementById('quizCard');
    const banner = document.createElement('p');
    banner.className = 'rehab-banner';
    banner.textContent = '休み明けなので、今日は復習だけの軽めメニューです。';
    card.insertBefore(banner, card.firstChild);
  }
  state.questionStartTime = Date.now();
}

// ---- 新規暗記カード (6-2節「Vocabulary新規暗記」: 初めて見る単語をまず覚える) ----
function renderMemorizeCard(q) {
  const card = document.getElementById('quizCard');
  const phoneticLine = q.phonetic ? (q.phonetic + (q.katakana ? '　' + q.katakana : '')) : (q.katakana || '');
  const uncertainNote = q.phoneticUncertain
    ? '<p class="memorize-note">※品詞によって発音が変わる語です。正確な発音はTTS音声などで確認してください。</p>'
    : '';
  card.innerHTML =
    '<p class="memorize-label">はじめて見る単語</p>' +
    '<p class="quiz-word">' + escapeHtml_(q.english) + '</p>' +
    (phoneticLine ? '<p class="memorize-phonetic">' + escapeHtml_(phoneticLine) + '</p>' : '') +
    '<p class="memorize-meaning">' + escapeHtml_(q.japanese) + '</p>' +
    uncertainNote +
    '<button id="memorizeNextBtn" class="btn-primary">覚えた → 次へ</button>';

  document.getElementById('memorizeNextBtn').addEventListener('click', function () {
    onMemorized(q);
  });
}

function onMemorized(q) {
  const btn = document.getElementById('memorizeNextBtn');
  btn.disabled = true;
  btn.textContent = '記録中...';
  const elapsedSec = Math.round((Date.now() - state.questionStartTime) / 1000);
  callApi('markLearned', { token: state.token, vocabId: q.vocabId, elapsedSec: elapsedSec })
    .then(function () { nextQuestion(); })
    .catch(function () {
      btn.disabled = false;
      btn.textContent = '覚えた → 次へ(もう一度お試しください)';
    });
}

// ---- 4択クイズカード ----
function renderQuizCard(q) {
  const card = document.getElementById('quizCard');
  card.innerHTML =
    '<p class="quiz-word">' + escapeHtml_(q.english) + '</p>' +
    '<p class="quiz-instruction">意味として正しいものを選んでください</p>' +
    '<div id="quizChoices" class="choice-list"></div>' +
    '<p id="quizFeedback" class="feedback-text"></p>';

  const choicesEl = document.getElementById('quizChoices');
  q.choices.forEach(function (choice) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choice;
    btn.addEventListener('click', function () { onChoose(choice, btn); });
    choicesEl.appendChild(btn);
  });
}

function escapeHtml_(str) {
  const div = document.createElement('div');
  div.textContent = str === undefined || str === null ? '' : String(str);
  return div.innerHTML;
}

// ---- Reading過去問カード (4-2節・6-3節) ----
function renderReadingCard(q) {
  const card = document.getElementById('quizCard');
  const isConv = q.sectionType === '会話文完成';
  const isBlank = q.sectionType === '空所補充' || isConv;
  // 会話文完成の古いデータは空所に番号が無い「(     )」のことがある
  const numbered = !!q.blankNumber && new RegExp('\\(\\s*' + q.blankNumber + '\\s*\\)').test(q.passage || '');
  const instruction = isBlank
    ? ((isConv ? '会話文中の網掛けの' : '英文中の網掛けの') + (numbered ? '( ' + q.blankNumber + ' )' : '( )') +
      'に入れるのに最も適切なものを選んでください')
    : (q.questionText ? escapeHtml_(q.questionText) : '内容に最も合うものを選んでください');

  let passageHtml = escapeHtml_(q.passage);
  if (isBlank) {
    // 同じパッセージに複数の空所番号があるため、「今どの番号を答えているか」を
    // 網掛け表示で示す(付けないと(18)(19)(20)のどれに回答しているか分からなくなるため)
    const pattern = numbered ? new RegExp('\\(\\s*' + q.blankNumber + '\\s*\\)') : /\(\s+\)/;
    passageHtml = passageHtml.replace(pattern, function (match) {
      return '<mark class="reading-blank">' + match + '</mark>';
    });
  }
  passageHtml = passageHtml.replace(/\n/g, '<br>');

  card.innerHTML =
    '<p class="reading-label">Reading</p>' +
    '<div class="reading-passage">' + passageHtml + '</div>' +
    '<p class="quiz-instruction reading-instruction">' + instruction + '</p>' +
    '<div id="quizChoices" class="choice-list"></div>' +
    '<p id="quizFeedback" class="feedback-text"></p>';

  const choicesEl = document.getElementById('quizChoices');
  q.choices.forEach(function (choice) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choice;
    btn.addEventListener('click', function () { onChooseReading(choice, btn); });
    choicesEl.appendChild(btn);
  });

  if (isBlank && q.blankNumber) {
    const markEl = card.querySelector('.reading-blank');
    if (markEl) markEl.scrollIntoView({ block: 'center' });
  }
}

function onChooseReading(choice, btnEl) {
  const q = state.questions[state.currentIndex];
  const elapsedSec = Math.round((Date.now() - state.questionStartTime) / 1000);

  document.querySelectorAll('.choice-btn').forEach(function (b) { b.disabled = true; });
  btnEl.classList.add('pending', 'selected');

  callApi('submitReadingAnswer', {
    token: state.token,
    questionId: q.questionId,
    selected: choice,
    elapsedSec: elapsedSec
  }).then(function (res) {
    btnEl.classList.remove('pending');
    const feedbackEl = document.getElementById('quizFeedback');
    let delayMs = 1600;
    if (res.ok && res.correct) {
      state.correctCount++;
      btnEl.classList.add('correct');
      feedbackEl.textContent = '正解！';
      feedbackEl.classList.add('correct');
    } else {
      btnEl.classList.add('incorrect');
      feedbackEl.textContent = res.ok ? ('不正解… 正解は「' + res.answer + '」') : 'エラーが発生しました';
      feedbackEl.classList.add('incorrect');
      if (res.ok) {
        document.querySelectorAll('.choice-btn').forEach(function (b) {
          if (b.textContent === res.answer) b.classList.add('correct');
        });
      }
      delayMs = 2600;
    }
    if (state.isMockExam) tallyMock_('Reading', !!(res.ok && res.correct));
    setTimeout(nextQuestion, delayMs);
  }).catch(function () {
    btnEl.classList.remove('pending');
    const feedbackEl = document.getElementById('quizFeedback');
    feedbackEl.textContent = '通信に失敗しました。もう一度お試しください。';
    feedbackEl.classList.add('incorrect');
    document.querySelectorAll('.choice-btn').forEach(function (b) { b.disabled = false; });
    btnEl.classList.remove('selected');
  });
}

// ---- Listening過去問カード (4-2節・6-3節) ----
// 音声ファイルは使わず、端末のTTS(読み上げ機能)で原稿を読み上げる(3-2節の無料運用方針)。
// 実際の英検と同様、選択肢は文字で読めるが原稿本文は再生ボタンを押すまで隠しておく。
function ttsCleanScript_(script) {
  // 台本中の話者記号(★☆☆☆)はTTSでは不要なので取り除く
  return String(script || '').replace(/☆☆|★|☆/g, ' ').replace(/\s+/g, ' ').trim();
}

// 端末の読み上げ音声の一覧(声の選択に使う。読み込みが遅れる端末があるので、変化のたびに取り直す)
let ttsVoices_ = [];
function refreshTtsVoices_() {
  try { ttsVoices_ = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; } catch (e) { ttsVoices_ = []; }
}
if (window.speechSynthesis) {
  refreshTtsVoices_();
  try { window.speechSynthesis.addEventListener('voiceschanged', function () { refreshTtsVoices_(); if (typeof renderVoiceSelect_ === 'function') renderVoiceSelect_(); }); } catch (e) { /* ignore */ }
}

// 速度と声は、Settingの設定(vstate.settings)に統一する。rateを渡したときだけ、その速度を使う
// (リスニング過去問は、正答率に応じた自動調整の速度を使うため)。
function speakText_(text, rate) {
  try {
    if (!window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const s = (typeof vstate !== 'undefined' && vstate.settings) ? vstate.settings : null;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = rate || (s && s.speed) || 1.0;
    if (s && s.voice) {
      const v = ttsVoices_.find(function (x) { return x.name === s.voice; });
      if (v) {
        try { utterance.voice = v; utterance.lang = v.lang; } catch (e2) { /* 声を指定できなくても、標準の声で読み上げる */ }
      }
    }
    window.speechSynthesis.speak(utterance);
    return true;
  } catch (e) {
    return false;
  }
}

// 再生速度(0.65〜1.00)を「標準に対する差」のレベル表示に変換する(例: 0.85→レベル-3)
function speedLevelLabel_(rate) {
  const level = Math.round((rate - 1.0) / 0.05);
  const pct = Math.round(rate * 100);
  return level === 0 ? ('標準速度(' + pct + '%)') : ('標準速度のレベル' + level + '(' + pct + '%)');
}

function renderListeningCard(q) {
  const card = document.getElementById('quizCard');
  const partLabel = q.sectionType ? ('Listening ' + q.sectionType) : 'Listening';
  const speedRate = q.speedRate || 1.0;
  state.listeningReplayCount = 0;

  card.innerHTML =
    '<p class="reading-label">' + escapeHtml_(partLabel) + '</p>' +
    '<p class="listening-speed-label">再生速度: ' + escapeHtml_(speedLevelLabel_(speedRate)) +
    '(正答率が上がると自動で速くなります)</p>' +
    '<p class="listening-source-label" id="listeningSource">' + (q.audio ? '🎧 本番の音声' : '🗣️ 読み上げ音声(本番の音声が無い問題)') + '</p>' +
    '<button id="listeningPlayBtn" class="btn-primary listening-play-btn">🔊 音声を再生</button>' +
    '<p class="quiz-instruction reading-instruction">' + escapeHtml_(q.questionText || '内容に最も合うものを選んでください') + '</p>' +
    '<div id="quizChoices" class="choice-list"></div>' +
    '<p id="quizFeedback" class="feedback-text"></p>' +
    '<div id="listeningScript" class="reading-passage listening-script" style="display:none;"></div>';

  let plays = 0; // 1回目は「聞いた」、2回目以降を聞き直し(リピート回数)として記録する
  document.getElementById('listeningPlayBtn').addEventListener('click', function () {
    plays++;
    state.listeningReplayCount = plays - 1;
    const ok = playListening_(q, speedRate);
    const btn = document.getElementById('listeningPlayBtn');
    if (!ok) {
      btn.textContent = 'この端末では読み上げに対応していません';
    } else {
      btn.textContent = '🔁 もう一度聞く' + (plays > 1 ? '(聞き直し' + (plays - 1) + '回目)' : '');
    }
  });

  const choicesEl = document.getElementById('quizChoices');
  q.choices.forEach(function (choice) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choice;
    btn.addEventListener('click', function () { onChooseListening(choice, btn); });
    choicesEl.appendChild(btn);
  });

  // 自動では流さない(「音声を再生」を押したときだけ流す)
}

// ---- リスニングの再生: 本番の音声(Googleドライブの音声ファイルの、その問題の部分)を優先し、
// 無い問題・再生できないときは端末の読み上げ(TTS)にする ----
// 音声ファイルは、アプリが通常の通信で端末に取り込んでから再生する(iPhoneの音声プレーヤーは、
// 読み込み時にアプリのアドレスをGoogleへ伝えないことがあり、APIキーの制限で弾かれるため)。
// 1つの部の音声ファイルを1回取り込めば、同じ部の問題はそれを使い回す(最近の2ファイルまで保持)。
let listeningAudio_ = null;      // 再生に使う <audio>(1つを使い回す)
let listeningAudioStop_ = null;  // 問題の終わりで止めるための監視
let listeningAudioToken_ = 0;    // 新しく再生を始めたら、前の待ち(読み込み中など)を無効にする
const listeningBlobCache_ = {};  // 音声ファイルURL → 取り込んだ音声(object URL)の Promise
const LISTENING_BLOB_KEEP = 2;

function listeningAudioEl_() {
  if (!listeningAudio_) { listeningAudio_ = new Audio(); listeningAudio_.preload = 'auto'; }
  return listeningAudio_;
}

// iPhoneでは、画面を押した瞬間に一度再生した <audio> でないと、後から再生できない。
// 最初に画面を押したときに、無音を一度鳴らしておく。
const LISTENING_SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';
let listeningAudioUnlocked_ = false;
function unlockListeningAudio_() {
  if (listeningAudioUnlocked_) return;
  listeningAudioUnlocked_ = true;
  const a = listeningAudioEl_();
  if (!a.src) a.src = LISTENING_SILENT_WAV;
  try {
    const p = a.play();
    if (p && p.then) p.then(function () { if (a.src === LISTENING_SILENT_WAV) a.pause(); }).catch(function () { listeningAudioUnlocked_ = false; });
  } catch (e) { listeningAudioUnlocked_ = false; }
}
document.addEventListener('touchend', unlockListeningAudio_, true);
document.addEventListener('click', unlockListeningAudio_, true);

function loadListeningBlob_(url) {
  if (!listeningBlobCache_[url]) {
    const keys = Object.keys(listeningBlobCache_);
    if (keys.length >= LISTENING_BLOB_KEEP) { // 古いものを捨てる
      const old = keys[0];
      listeningBlobCache_[old].then(function (u) { URL.revokeObjectURL(u); }).catch(function () { /* ignore */ });
      delete listeningBlobCache_[old];
    }
    const p = fetch(url).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.blob();
    }).then(function (b) { return URL.createObjectURL(b); });
    listeningBlobCache_[url] = p;
    p.catch(function () { if (listeningBlobCache_[url] === p) delete listeningBlobCache_[url]; });
  }
  return listeningBlobCache_[url];
}

function stopListeningAudio_() {
  listeningAudioToken_++;
  if (listeningAudioStop_ && listeningAudio_) listeningAudio_.removeEventListener('timeupdate', listeningAudioStop_);
  listeningAudioStop_ = null;
  if (listeningAudio_) { try { listeningAudio_.pause(); listeningAudio_.muted = false; } catch (e) { /* ignore */ } }
}

// 読み上げ用の文: 原稿の後に、英語の質問文があれば続けて読む(本番も質問が読まれるため)
function listeningTtsText_(q) {
  const qText = String(q.questionText || '');
  const english = /[A-Za-z]/.test(qText) && !/[ぁ-んァ-ヶ一-龠]/.test(qText);
  return ttsCleanScript_(q.script) + (english ? ' Question. ' + qText : '');
}

function playListeningTts_(q, speedRate) {
  const label = document.getElementById('listeningSource');
  if (label && q.audio) {
    label.textContent = '🗣️ 本番の音声を読み込めなかったので、読み上げ音声で再生しています';
    showListeningAudioDiagnosis_(q, label);
  }
  return speakText_(listeningTtsText_(q), speedRate);
}

// 本番の音声を読み込めなかった理由を、メッセージの下に小さく出す(設定の確認用。1問につき1回だけ調べる)
function showListeningAudioDiagnosis_(q, label) {
  if (q.audioDiagnosed) return;
  q.audioDiagnosed = true;
  const url = q.audio.url;
  const note = document.createElement('span');
  note.className = 'listening-audio-why';
  label.appendChild(note);
  if (url.indexOf('googleapis.com') < 0) {
    note.textContent = '(理由: アプリのサーバー(Code.gs)が古い版のままです。新しいCode.gsを貼り付けて、新しいバージョンでデプロイしてください)';
    return;
  }
  fetch(url, { headers: { Range: 'bytes=0-1' } }).then(function (res) {
    if (res.ok) {
      note.textContent = '(確認: 音声ファイル自体は読めました(' + res.status + ')。端末の音声再生側の問題の可能性があります)';
      return null;
    }
    return res.text().then(function (t) {
      let msg = '';
      try { msg = JSON.parse(t).error.message; } catch (e) { msg = t.slice(0, 120); }
      note.textContent = '(理由: ' + res.status + ' ' + msg + ')';
    });
  }).catch(function (e) {
    note.textContent = '(理由: 通信できませんでした ' + (e && e.message ? e.message : '') + ')';
  });
}

function playListening_(q, speedRate) {
  stopListeningAudio_();
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  const a = q.audio;
  if (!a || !a.url || q.audioFailed) return playListeningTts_(q, speedRate);

  const token = listeningAudioToken_;
  const label = document.getElementById('listeningSource');
  const fail = function () {
    if (token !== listeningAudioToken_) return; // 別の問題に移った・止めた
    stopListeningAudio_();
    q.audioFailed = true; // この問題は以後、読み上げで再生する
    playListeningTts_(q, speedRate);
  };
  let loaded = false;
  if (label) label.textContent = '🎧 本番の音声(読み込み中…)';
  const timer = setTimeout(function () { if (!loaded) fail(); }, 60000); // 60秒たっても取り込めなければ読み上げにする

  loadListeningBlob_(a.url).then(function (objUrl) {
    loaded = true; clearTimeout(timer);
    if (token !== listeningAudioToken_) return;
    if (label) label.textContent = '🎧 本番の音声';
    const audio = listeningAudioEl_();
    audio.playbackRate = speedRate || 1.0;
    if ('preservesPitch' in audio) audio.preservesPitch = true;
    listeningAudioStop_ = function () { if (audio.currentTime >= a.end) stopListeningAudio_(); };
    audio.addEventListener('timeupdate', listeningAudioStop_);
    const onPlayError = function (err) {
      if (token !== listeningAudioToken_) return;
      if (err && err.name === 'NotAllowedError') { // 自動再生が止められた: 再生ボタンを押せば流れる
        stopListeningAudio_();
        if (label) label.textContent = '🎧 本番の音声(「音声を再生」を押すと流れます)';
        return;
      }
      fail();
    };
    if (audio.dataset.url === objUrl && audio.readyState >= 1) {
      audio.currentTime = a.start;
      const p = audio.play();
      if (p && p.catch) p.catch(onPlayError);
      return;
    }
    // 新しい音声ファイル: 消音で再生を始め、長さが分かったら問題の位置へ移ってから音を出す
    // (iPhoneは再生を始めるまで読み込まないため、先に play() を呼ぶ)
    audio.dataset.url = objUrl;
    audio.muted = true;
    audio.src = objUrl;
    audio.addEventListener('loadedmetadata', function () {
      if (token !== listeningAudioToken_) return;
      audio.currentTime = a.start;
      audio.addEventListener('seeked', function () { if (token === listeningAudioToken_) audio.muted = false; }, { once: true });
    }, { once: true });
    audio.addEventListener('error', function () { fail(); }, { once: true });
    const p = audio.play();
    if (p && p.catch) p.catch(onPlayError);
  }).catch(function () {
    loaded = true; clearTimeout(timer);
    fail();
  });
  return true;
}

function onChooseListening(choice, btnEl) {
  const q = state.questions[state.currentIndex];
  const elapsedSec = Math.round((Date.now() - state.questionStartTime) / 1000);

  if (window.speechSynthesis) window.speechSynthesis.cancel();
  stopListeningAudio_();
  document.querySelectorAll('.choice-btn').forEach(function (b) { b.disabled = true; });
  btnEl.classList.add('pending', 'selected');

  callApi('submitListeningAnswer', {
    token: state.token,
    questionId: q.questionId,
    selected: choice,
    elapsedSec: elapsedSec,
    replayCount: state.listeningReplayCount || 0
  }).then(function (res) {
    btnEl.classList.remove('pending');
    const feedbackEl = document.getElementById('quizFeedback');
    let delayMs = 1800;
    if (res.ok && res.correct) {
      state.correctCount++;
      btnEl.classList.add('correct');
      feedbackEl.textContent = '正解！';
      feedbackEl.classList.add('correct');
    } else {
      btnEl.classList.add('incorrect');
      feedbackEl.textContent = res.ok ? ('不正解… 正解は「' + res.answer + '」') : 'エラーが発生しました';
      feedbackEl.classList.add('incorrect');
      if (res.ok) {
        document.querySelectorAll('.choice-btn').forEach(function (b) {
          if (b.textContent === res.answer) b.classList.add('correct');
        });
      }
      delayMs = 3200;
    }
    // 復習用に原稿(スクリプト)を表示する
    const scriptEl = document.getElementById('listeningScript');
    if (scriptEl) {
      scriptEl.textContent = q.script;
      scriptEl.style.display = '';
    }
    if (state.isMockExam) tallyMock_('Listening', !!(res.ok && res.correct));
    setTimeout(nextQuestion, delayMs);
  }).catch(function () {
    btnEl.classList.remove('pending');
    const feedbackEl = document.getElementById('quizFeedback');
    feedbackEl.textContent = '通信に失敗しました。もう一度お試しください。';
    feedbackEl.classList.add('incorrect');
    document.querySelectorAll('.choice-btn').forEach(function (b) { b.disabled = false; });
    btnEl.classList.remove('selected');
  });
}

function onChoose(choice, btnEl) {
  const q = state.questions[state.currentIndex];
  const elapsedSec = Math.round((Date.now() - state.questionStartTime) / 1000);

  document.querySelectorAll('.choice-btn').forEach(function (b) { b.disabled = true; });

  // クリックした瞬間に、通信の結果を待たず「選んだ」ことがすぐ分かる色を付ける
  // (GASとの通信には3-4節の通り1〜2秒程度かかることがあるため、待ち時間中も無反応に見えないようにする)
  btnEl.classList.add('pending', 'selected');

  callApi('submitAnswer', {
    token: state.token,
    vocabId: q.vocabId,
    selected: choice,
    elapsedSec: elapsedSec
  }).then(function (res) {
    btnEl.classList.remove('pending');
    const feedbackEl = document.getElementById('quizFeedback');
    let delayMs = 1600; // 正解表示をしっかり確認できるよう長めに待つ
    if (res.ok && res.correct) {
      state.correctCount++;
      btnEl.classList.add('correct');
      feedbackEl.textContent = '正解！';
      feedbackEl.classList.add('correct');
    } else {
      // 選んだ選択肢には「不正解(選択した)」の色を、正解の選択肢には「正解」の色を、
      // 次の問題に進むまでの間ずっと表示し続ける。
      btnEl.classList.add('incorrect');
      feedbackEl.textContent = res.ok ? ('不正解… 正解は「' + res.answer + '」') : 'エラーが発生しました';
      feedbackEl.classList.add('incorrect');
      document.querySelectorAll('.choice-btn').forEach(function (b) {
        if (res.ok && b.textContent === res.answer) b.classList.add('correct');
      });
      delayMs = 2600; // 不正解時は正解を確認する時間をさらに長くする
    }
    if (state.isMockExam) tallyMock_('Vocabulary', !!(res.ok && res.correct));
    setTimeout(nextQuestion, delayMs);
  }).catch(function () {
    btnEl.classList.remove('pending');
    const feedbackEl = document.getElementById('quizFeedback');
    feedbackEl.textContent = '通信に失敗しました。もう一度お試しください。';
    feedbackEl.classList.add('incorrect');
    document.querySelectorAll('.choice-btn').forEach(function (b) { b.disabled = false; });
    btnEl.classList.remove('selected');
  });
}

function nextQuestion() {
  state.currentIndex++;
  if (state.currentIndex >= state.questions.length) {
    if (state.isMockExam) { finishMockExam(); return; }
    showResult();
    return;
  }
  renderQuestion();
}

function showResult() {
  showScreen('screen-result');
  const body = document.getElementById('resultBody');
  body.innerHTML = [
    statItem(state.questions.length, '取り組んだ問題数'),
    statItem(state.correctCount, '正解数')
  ].join('');
}

// ---- Writing/Speaking練習 (8-5節・10章) ----
// 自動採点はせず、NotebookLM(AIコーチ)に課題を貼り付けてフィードバックをもらい、
// 一番弱かった項目を自己申告してもらう。
function startPractice(skill) {
  document.getElementById('practiceTitle').textContent = skill === 'Speaking' ? 'Speaking練習' : 'Writing練習';
  const card = document.getElementById('practiceCard');
  card.innerHTML = '<p class="quiz-word">出題中...</p>';
  showScreen('screen-practice');

  callApi('getPracticePrompt', { token: state.token, skill: skill }).then(function (res) {
    if (!res.ok) { card.innerHTML = '<p class="quiz-word">取得に失敗しました</p>'; return; }
    if (!res.prompt) { card.innerHTML = '<p class="quiz-word">出題できる課題がありません</p>'; return; }
    state.currentPractice = res.prompt;
    renderPracticeCard(res.prompt);
  }).catch(function () {
    card.innerHTML = '<p class="quiz-word">通信に失敗しました</p>';
  });
}

function renderPracticeCard(prompt) {
  const card = document.getElementById('practiceCard');
  const hasUrl = !!prompt.notebooklmUrl;
  const isWriting = prompt.skill === 'Writing';

  card.innerHTML =
    '<p class="reading-label">' + escapeHtml_(prompt.skill + '・' + prompt.promptType) + '</p>' +

    '<p class="practice-step-label">① 課題に取り組む</p>' +
    '<p class="practice-instruction">' + escapeHtml_(prompt.instruction || '課題に取り組んでください。') + '</p>' +
    '<div class="reading-passage">' + escapeHtml_(prompt.task).replace(/\n/g, '<br>') + '</div>' +
    (isWriting ? renderWritingHelpHtml_(prompt) : '') +
    '<textarea id="answerInput" class="answer-textarea" placeholder="ここに解答を書いてください(Speakingの場合は話した内容を書き起こしてください)" rows="6"></textarea>' +
    (isWriting ? '<p id="answerWordCount" class="word-count"></p>' + renderWritingChecklistHtml_(prompt) : '') +

    (prompt.skill === 'Speaking' ? renderSpeakingPracticeBoxHtml_(prompt) : '') +

    '<p class="practice-step-label">② AIコーチに相談する</p>' +
    (hasUrl
      ? '<button id="notebookBtn" class="btn-primary listening-play-btn">📋 コピーしてAIコーチに相談する</button>' +
        '<p class="memorize-note">タップすると、①に書いた解答と課題、「ルーブリックで採点して」という依頼文をまとめてコピーし、NotebookLMを開きます。チャット欄に貼り付けて送信するだけでOKです。</p>'
      : '<p class="memorize-note">NotebookLM URLが未設定です(usersシートのnotebooklm_url列に登録してください)。①の解答と課題文を自分でコピーして、いつも使っているNotebookLMに貼り付けてください。</p>') +

    '<p class="practice-step-label">③ NotebookLMが付けた点数を入力する</p>' +
    '<p class="quiz-instruction reading-instruction" id="axisInstruction">' +
    (hasUrl ? '先に②のボタンでAIコーチに相談してください' : 'NotebookLMからのフィードバックで、各項目が何点だったか入力してください(0〜4点)') +
    '</p>' +
    '<div id="axisScoreForm" class="axis-score-form"></div>' +
    (isWriting ? renderWritingRewriteHtml_(prompt, hasUrl) : '') +
    '<button id="submitPracticeBtn" class="btn-primary" disabled>記録する</button>' +
    '<p id="practiceFeedback" class="feedback-text"></p>';

  const axisScores = {}; // { 軸名: 選択された点数 }
  const formEl = document.getElementById('axisScoreForm');
  prompt.axes.forEach(function (axis) {
    const row = document.createElement('div');
    row.className = 'axis-score-row';
    const label = document.createElement('div');
    label.className = 'axis-score-label';
    label.textContent = axis;
    row.appendChild(label);

    const chipGroup = document.createElement('div');
    chipGroup.className = 'axis-score-chips';
    [0, 1, 2, 3, 4].forEach(function (n) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'score-chip';
      chip.textContent = String(n);
      chip.disabled = hasUrl; // ②のボタンを押すまでは選べないようにする(順番を明確にするため)
      chip.addEventListener('click', function () {
        axisScores[axis] = n;
        chipGroup.querySelectorAll('.score-chip').forEach(function (c) { c.classList.remove('selected'); });
        chip.classList.add('selected');
        updateSubmitPracticeBtn_(prompt.axes, axisScores);
      });
      chipGroup.appendChild(chip);
    });
    row.appendChild(chipGroup);
    formEl.appendChild(row);
  });

  document.getElementById('submitPracticeBtn').addEventListener('click', function () {
    onSubmitPractice(axisScores);
  });

  if (prompt.skill === 'Speaking') {
    setupSpeakingPracticeBox_(prompt);
  }
  if (isWriting) {
    setupWritingHelp_(prompt);
  }

  if (hasUrl) {
    document.getElementById('notebookBtn').addEventListener('click', function () {
      // 10-3節・8-5節: タップ削減のため、「ルーブリックで採点して」という依頼文+課題+
      // ①でアプリ内に書いた解答をセットにした文章をクリップボードにコピーしつつNotebookLMを開く。
      // 本人はチャット欄に貼り付けて送信するだけでよい。
      const answerText = (document.getElementById('answerInput').value || '').trim();
      const placeholder = /\(ここに自分の解答をそのまま貼り付けてください\)|\(実際に声に出して答えた内容を、思い出しながらここに書いてください\)/;
      let message = prompt.notebooklmMessage || prompt.task;
      if (answerText) {
        message = message.replace(placeholder, answerText);
      }
      copyToClipboard_(message);
      window.open(prompt.notebooklmUrl, '_blank');
      if (isWriting) stopWritingStopwatch_(); // 書き終えた時点の時間を残す
      // AIコーチに相談したら、点数入力欄を使えるようにする
      document.querySelectorAll('#axisScoreForm .score-chip').forEach(function (b) { b.disabled = false; });
      document.getElementById('axisInstruction').textContent = 'NotebookLMからのフィードバックで、各項目が何点だったか入力してください(0〜4点)';
    });
  }

  state.practiceStartTime = Date.now();
}

// ---- Writing補助: 書く型・語数カウンター・ストップウォッチ・自己チェック・模範解答・書き直し ----
let writingStopwatchTimer_ = null;

// 英検の数え方に近い語数(I'm, well-known は1語。数字も1語)
function countEnglishWords_(text) {
  const m = String(text || '').match(/[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*/g);
  return m ? m.length : 0;
}

function wordCountHtml_(n, range) {
  if (!range) return '語数: ' + n + '語';
  let cls = 'ok', note = '目安の範囲内';
  if (n < range[0]) { cls = 'under'; note = 'あと' + (range[0] - n) + '語'; }
  else if (n > range[1]) { cls = 'over'; note = range[1] + '語を' + (n - range[1]) + '語こえています'; }
  if (n === 0) { cls = ''; note = ''; }
  return '語数: <span class="wc-' + cls + '">' + n + '語</span>(目安 ' + range[0] + '〜' + range[1] + '語)' +
    (note ? ' <span class="wc-' + cls + '">' + note + '</span>' : '');
}

function renderWritingHelpHtml_(prompt) {
  const tpl = prompt.template || [];
  return '<div class="writing-help">' +
    '<p id="writingStopwatch" class="writing-stopwatch">⏱ 経過 0:00</p>' +
    (tpl.length > 0
      ? '<details class="writing-details"><summary>📋 書く型(迷ったらこの順に書く)</summary><ol class="writing-list">' +
        tpl.map(function (t) { return '<li>' + escapeHtml_(t) + '</li>'; }).join('') + '</ol></details>'
      : '') +
    '</div>';
}

function renderWritingChecklistHtml_(prompt) {
  const items = prompt.checklist || [];
  if (items.length === 0) return '';
  return '<details class="writing-details"><summary>✅ 書き終えたら自己チェック</summary><div class="writing-checklist">' +
    items.map(function (t) { return '<label><input type="checkbox"> ' + escapeHtml_(t) + '</label>'; }).join('') +
    '</div></details>';
}

function renderWritingRewriteHtml_(prompt, hasUrl) {
  return '<p class="practice-step-label">④ 模範解答と比べて書き直す(任意)</p>' +
    (prompt.modelAnswer
      ? '<button id="modelAnswerBtn" type="button" class="btn-primary listening-play-btn">📖 模範解答を見る</button>' +
        '<div id="modelAnswerBox" class="model-answer" style="display:none;"></div>'
      : '<p class="memorize-note">この課題の模範解答は登録されていません。</p>') +
    '<p class="memorize-note">AIコーチのアドバイスと模範解答を参考に、①の解答を書き直してみましょう。</p>' +
    '<button id="rewriteCopyBtn" type="button" class="btn-link">①の解答をコピーして書き始める</button>' +
    '<textarea id="rewriteInput" class="answer-textarea" placeholder="書き直した解答" rows="6"></textarea>' +
    '<p id="rewriteWordCount" class="word-count"></p>' +
    (hasUrl
      ? '<button id="rewriteNotebookBtn" type="button" class="btn-primary listening-play-btn">📋 書き直しをAIコーチに見てもらう</button>' +
        '<p class="memorize-note">課題・1回目の解答・書き直した解答をまとめてコピーし、NotebookLMを開きます。</p>'
      : '');
}

function stopWritingStopwatch_() {
  if (writingStopwatchTimer_) { clearInterval(writingStopwatchTimer_); writingStopwatchTimer_ = null; }
}

function setupWritingHelp_(prompt) {
  const range = prompt.wordRange || null;
  const answerEl = document.getElementById('answerInput');
  const countEl = document.getElementById('answerWordCount');
  const rewriteEl = document.getElementById('rewriteInput');
  const rewriteCountEl = document.getElementById('rewriteWordCount');
  const updateCount = function () { countEl.innerHTML = wordCountHtml_(countEnglishWords_(answerEl.value), range); };
  const updateRewriteCount = function () { rewriteCountEl.innerHTML = wordCountHtml_(countEnglishWords_(rewriteEl.value), range); };
  answerEl.addEventListener('input', updateCount);
  rewriteEl.addEventListener('input', updateRewriteCount);
  updateCount();
  updateRewriteCount();

  // ストップウォッチ(本番は筆記全体で時間が決まっているので、1題にかかる時間を意識する)
  stopWritingStopwatch_();
  const swEl = document.getElementById('writingStopwatch');
  const start = Date.now();
  writingStopwatchTimer_ = setInterval(function () {
    if (!document.body.contains(swEl)) { stopWritingStopwatch_(); return; }
    const sec = Math.floor((Date.now() - start) / 1000);
    swEl.textContent = '⏱ 経過 ' + Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }, 1000);

  const modelBtn = document.getElementById('modelAnswerBtn');
  if (modelBtn) {
    modelBtn.addEventListener('click', function () {
      if (!answerEl.value.trim() && !confirm('まだ①の解答が書かれていません。先に自分で書いてから見るのがおすすめです。模範解答を表示しますか？')) return;
      const box = document.getElementById('modelAnswerBox');
      box.innerHTML = '<p class="section-label">模範解答(英検の解答例・' + countEnglishWords_(prompt.modelAnswer) + '語)</p>' +
        '<p>' + escapeHtml_(prompt.modelAnswer).replace(/\n/g, '<br>') + '</p>';
      box.style.display = '';
      modelBtn.style.display = 'none';
    });
  }

  document.getElementById('rewriteCopyBtn').addEventListener('click', function () {
    if (!rewriteEl.value.trim() || confirm('書き直し欄の内容を、①の解答で置き換えますか？')) {
      rewriteEl.value = answerEl.value;
      updateRewriteCount();
      rewriteEl.focus();
    }
  });

  const reBtn = document.getElementById('rewriteNotebookBtn');
  if (reBtn) {
    reBtn.addEventListener('click', function () {
      const first = answerEl.value.trim() || '(1回目の解答なし)';
      const second = rewriteEl.value.trim() || '(書き直した解答なし)';
      const message = '登録してあるWriting評価ルーブリックを使って、書き直した解答を' + (prompt.axes || []).join('・') +
        'の観点ごとに採点してください。1回目と比べて良くなった点と、まだ直した方がよい点も教えてください。\n\n' +
        '【課題】\n' + prompt.task + '\n\n【1回目の解答】\n' + first + '\n\n【書き直した解答】\n' + second;
      copyToClipboard_(message);
      window.open(prompt.notebooklmUrl, '_blank');
    });
  }
}

// ---- スピーキング補完練習 (機能B: 本番形式タイマー・回答テンプレート・自己録音・シャドーイング) ----
// 正誤判定・採点は行わない自己練習ツール。①課題に取り組む欄と②AIコーチ相談欄の間に、
// 任意で使える練習ブロックとして表示する(Speakingのみ)。
let speakingCountdownTimer_ = null;
let speakingMediaRecorder_ = null;

function stopSpeakingPracticeTimers_() {
  stopWritingStopwatch_();
  if (speakingCountdownTimer_) { clearInterval(speakingCountdownTimer_); speakingCountdownTimer_ = null; }
  if (speakingMediaRecorder_ && speakingMediaRecorder_.state !== 'inactive') {
    try { speakingMediaRecorder_.stop(); } catch (e) { /* ignore */ }
  }
  speakingMediaRecorder_ = null;
}

function renderSpeakingPracticeBoxHtml_(prompt) {
  const templates = prompt.speakingTemplates || [];
  return (
    '<div id="speakingPracticeBox" class="speaking-practice-box">' +
    '<p class="practice-step-label">🎯 本番形式で練習する(任意)</p>' +
    '<p class="memorize-note">考慮時間→発話時間を本番と同じ感覚で練習できます。発話時間中は自動で録音されるので、後で自分の話し方を聞き直せます(採点はしません)。マイクを使えない場合も、タイマーだけで練習できます。</p>' +
    '<div id="speakingTimerDisplay" class="speaking-timer-display">準備中...</div>' +
    '<button id="speakingTimerStartBtn" class="btn-primary listening-play-btn">▶ タイマー練習を始める</button>' +
    '<div id="speakingRecordingPlayback" style="display:none;"></div>' +
    (templates.length > 0
      ? '<p class="practice-step-label" style="margin-top:16px;">📋 回答テンプレート(型)</p>' +
        '<p class="memorize-note">内容の独創性より「型」を持っているかが得点になりやすい形式です。声に出して練習しましょう。</p>' +
        '<div id="speakingTemplateList" class="speaking-template-list"></div>'
      : '') +
    (prompt.promptType === '音読'
      ? '<p class="practice-step-label" style="margin-top:16px;">🗣️ シャドーイング</p>' +
        '<button id="speakingShadowBtn" class="btn-primary listening-play-btn">🔁 模範音声を再生(続けて声に出してみましょう)</button>'
      : '') +
    '</div>'
  );
}

function setupSpeakingPracticeBox_(prompt) {
  const timer = prompt.speakingTimer || { prepSec: 20, speakSec: 40 };
  const templates = prompt.speakingTemplates || [];
  const startBtn = document.getElementById('speakingTimerStartBtn');
  const display = document.getElementById('speakingTimerDisplay');
  const playbackEl = document.getElementById('speakingRecordingPlayback');

  function runCountdown(seconds, label, onDone) {
    let remaining = seconds;
    display.textContent = label + ': 残り' + remaining + '秒';
    if (speakingCountdownTimer_) clearInterval(speakingCountdownTimer_);
    speakingCountdownTimer_ = setInterval(function () {
      remaining--;
      if (remaining <= 0) {
        clearInterval(speakingCountdownTimer_);
        speakingCountdownTimer_ = null;
        onDone();
      } else {
        display.textContent = label + ': 残り' + remaining + '秒';
      }
    }, 1000);
  }

  function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) return;
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      const recordedChunks = [];
      let recorder;
      try {
        recorder = new MediaRecorder(stream);
      } catch (e) {
        stream.getTracks().forEach(function (t) { t.stop(); });
        return;
      }
      speakingMediaRecorder_ = recorder;
      recorder.ondataavailable = function (ev) { if (ev.data && ev.data.size > 0) recordedChunks.push(ev.data); };
      recorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        if (recordedChunks.length > 0) {
          const blob = new Blob(recordedChunks, { type: 'audio/webm' });
          const url = URL.createObjectURL(blob);
          playbackEl.innerHTML = '<p class="section-label">自分の発話(聞き直せます)</p><audio controls src="' + url + '"></audio>';
          playbackEl.style.display = '';
        }
      };
      recorder.start();
    }).catch(function () {
      display.textContent = 'マイクを使用できませんでした(タイマーだけで練習を続けられます)';
    });
  }

  function stopRecording() {
    if (speakingMediaRecorder_ && speakingMediaRecorder_.state !== 'inactive') {
      try { speakingMediaRecorder_.stop(); } catch (e) { /* ignore */ }
    }
  }

  startBtn.addEventListener('click', function () {
    startBtn.disabled = true;
    playbackEl.style.display = 'none';
    runCountdown(timer.prepSec, '考慮時間', function () {
      startRecording();
      runCountdown(timer.speakSec, '発話時間(録音中)', function () {
        stopRecording();
        display.textContent = '練習おつかれさまでした！';
        startBtn.disabled = false;
        callApi('logSpeakingPractice', {
          token: state.token, promptId: prompt.promptId, elapsedSec: timer.speakSec
        }).catch(function () { /* ignore */ });
      });
    });
  });

  if (templates.length > 0) {
    const listEl = document.getElementById('speakingTemplateList');
    templates.forEach(function (t) {
      const row = document.createElement('div');
      row.className = 'speaking-template-row';
      const textEl = document.createElement('p');
      textEl.className = 'speaking-template-text';
      textEl.textContent = t;
      const playBtn = document.createElement('button');
      playBtn.type = 'button';
      playBtn.className = 'btn-link';
      playBtn.textContent = '🔊 読み上げ';
      playBtn.addEventListener('click', function () { speakText_(t); });
      row.appendChild(textEl);
      row.appendChild(playBtn);
      listEl.appendChild(row);
    });
  }

  const shadowBtn = document.getElementById('speakingShadowBtn');
  if (shadowBtn) {
    shadowBtn.addEventListener('click', function () { speakText_(prompt.task); });
  }
}

function copyToClipboard_(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    }
  } catch (e) { /* ignore */ }
}

// 全軸に点数が入力されるまで「記録する」ボタンを押せないようにする
function updateSubmitPracticeBtn_(axes, axisScores) {
  const allFilled = axes.every(function (axis) { return axisScores[axis] !== undefined; });
  document.getElementById('submitPracticeBtn').disabled = !allFilled;
}

function onSubmitPractice(axisScores) {
  const prompt = state.currentPractice;
  const elapsedSec = Math.round((Date.now() - (state.practiceStartTime || Date.now())) / 1000);
  const btnEl = document.getElementById('submitPracticeBtn');

  document.querySelectorAll('.score-chip').forEach(function (b) { b.disabled = true; });
  btnEl.disabled = true;
  btnEl.textContent = '記録中...';

  callApi('submitPracticeAnswer', {
    token: state.token,
    skill: prompt.skill,
    promptId: prompt.promptId,
    axisScores: JSON.stringify(axisScores),
    elapsedSec: elapsedSec
  }).then(function (res) {
    const feedbackEl = document.getElementById('practiceFeedback');
    if (res.ok) {
      btnEl.textContent = '記録しました';
      feedbackEl.textContent = '記録しました。お疲れさまでした！' +
        (res.weakAxis ? ('(今回の弱点: ' + res.weakAxis + ')') : '');
      feedbackEl.classList.add('correct');
    } else {
      feedbackEl.textContent = 'エラーが発生しました';
      feedbackEl.classList.add('incorrect');
    }
    setTimeout(function () {
      stopSpeakingPracticeTimers_();
      showScreen('screen-home');
      loadStats();
    }, 1800);
  }).catch(function () {
    document.querySelectorAll('.score-chip').forEach(function (b) { b.disabled = false; });
    btnEl.disabled = false;
    btnEl.textContent = '記録する';
    const feedbackEl = document.getElementById('practiceFeedback');
    feedbackEl.textContent = '通信に失敗しました。もう一度お試しください。';
    feedbackEl.classList.add('incorrect');
  });
}

// ---- 単語発音再生機能 ----
// 正誤判定・採点は行わない。1画面1単語で、「繰り返し」「次へ」の2ボタンのみ。
// グループ(T1900見出し語・派生語・過去問…)を選んで、10語ずつ聞く。startを指定するとその位置から、
// 指定しなければ、そのグループで前回聞いた語の続きから始まる。
function startPronunciation(startPos) {
  showScreen('screen-pronunciation');
  document.getElementById('pronunciationProgress').textContent = '読み込み中...';
  document.getElementById('pronunciationRange').textContent = '';
  document.getElementById('pronunciationNo').textContent = '';
  document.getElementById('pronunciationEnglish').textContent = '';
  document.getElementById('pronunciationKatakana').textContent = '';
  document.getElementById('pronunciationJapanese').textContent = '';

  const params = { token: state.token, group: state.pronGroup || 't1900' };
  if (startPos) params.start = startPos;
  callApi('getPronunciationWords', params).then(function (res) {
    if (!res.ok || !res.words || res.words.length === 0) {
      document.getElementById('pronunciationProgress').textContent = '0 / 0';
      document.getElementById('pronunciationEnglish').textContent = res.disabled ? 'このグループはSettingでオフになっています' : '単語データがありません';
      return;
    }
    state.pronunciationWords = res.words;
    state.pronunciationMeta = res;
    state.pronunciationIndex = 0;
    renderPronunciationWord_();
    playCurrentPronunciationWord_();
  }).catch(function () {
    document.getElementById('pronunciationProgress').textContent = '0 / 0';
    document.getElementById('pronunciationEnglish').textContent = '通信に失敗しました';
  });
}

function renderPronunciationWord_() {
  const word = state.pronunciationWords[state.pronunciationIndex];
  if (!word) return;
  document.getElementById('pronunciationProgress').textContent =
    (state.pronunciationIndex + 1) + ' / ' + state.pronunciationWords.length;
  const meta = state.pronunciationMeta;
  if (meta) {
    const total = Number(meta.total).toLocaleString();
    document.getElementById('pronunciationRange').textContent = meta.isT1900
      ? meta.groupLabel + ' ' + meta.from + '〜' + meta.to + '番(全' + total + '語)を聞いています'
      : meta.groupLabel + ' ' + total + '語中 ' + meta.from + '〜' + meta.to + '番目を聞いています';
    document.getElementById('pronunciationNo').textContent = meta.isT1900 ? ('出る順 ' + word.no + '番') : (word.no + ' / ' + total + '番目');
  }
  document.getElementById('pronunciationEnglish').textContent = word.english;
  document.getElementById('pronunciationKatakana').textContent = word.katakana || '';
  document.getElementById('pronunciationJapanese').textContent = word.japanese;
}

// 発音の再生自体を1回の「聴取」として記録する(「繰り返し」ボタンも、次の語への
// 自動再生も、どちらも聴取回数としてカウントする仕様のため)
function playCurrentPronunciationWord_(immediate) {
  const word = state.pronunciationWords[state.pronunciationIndex];
  if (!word) return;
  if (immediate) vocabSpeak_(word.english); else vocabSpeakDelayed_(word.english);
  callApi('logPronunciationPlay', { token: state.token, vocabId: word.vocabId }).catch(function () { /* ignore */ });
}

function nextPronunciationWord() {
  if (state.pronunciationIndex >= state.pronunciationWords.length - 1) {
    // このバッチの最後まで聞き終えたら、続きのバッチを取得して再開する
    startPronunciation();
    return;
  }
  state.pronunciationIndex++;
  renderPronunciationWord_();
  playCurrentPronunciationWord_();
}
