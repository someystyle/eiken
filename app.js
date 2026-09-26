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
  currentTargetExamDate: null // 現在登録されている目標試験日(結果記録フォームの表示判定に使う)
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
window.addEventListener('DOMContentLoaded', function () {
  const saved = safeGetLocalStorage(LS_TOKEN_KEY);
  if (saved) {
    state.token = saved;
    doLogin(saved, true);
  } else {
    showScreen('screen-login');
  }

  document.getElementById('loginBtn').addEventListener('click', function () {
    const val = document.getElementById('tokenInput').value.trim();
    if (!val) return;
    doLogin(val, false);
  });

  document.getElementById('logoutBtn').addEventListener('click', function () {
    stopSpeech_();
    safeRemoveLocalStorage(LS_TOKEN_KEY);
    state.token = null;
    state.user = null;
    state.debugMode = 'auto';
    document.getElementById('tokenInput').value = '';
    document.getElementById('debugModeCard').style.display = 'none';
    showScreen('screen-login');
  });

  setupChipGroup('minutesChips', function (val) { state.minutes = val; updateStartBtn(); });
  setupChipGroup('conditionChips', function (val) { state.condition = val; updateStartBtn(); });
  setupChipGroup('debugModeChips', function (val) { state.debugMode = val; });

  document.getElementById('startBtn').addEventListener('click', startSession);
  document.getElementById('quitQuizBtn').addEventListener('click', function () {
    stopSpeech_(); // Listening再生中に中断した場合、音声を止め忘れないように
    showScreen('screen-home');
    loadStats();
  });
  document.getElementById('backHomeBtn').addEventListener('click', function () {
    stopSpeech_();
    showScreen('screen-home');
    loadStats();
  });

  document.getElementById('aiCoachBtn').addEventListener('click', onAiCoachClick_);

  document.getElementById('writingPracticeBtn').addEventListener('click', function () { startPractice('Writing'); });
  document.getElementById('speakingPracticeBtn').addEventListener('click', function () { startPractice('Speaking'); });
  document.getElementById('quitPracticeBtn').addEventListener('click', function () {
    showScreen('screen-home');
    loadStats();
  });

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

function updateStartBtn() {
  document.getElementById('startBtn').disabled = !(state.minutes && state.condition);
}

// ---- ログイン (3-3節: 初回のみトークン入力、以降はlocalStorageで自動ログイン) ----
function doLogin(token, silent) {
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  callApi('login', { token: token }).then(function (res) {
    if (!res.ok) {
      if (!silent) errEl.textContent = 'トークンが正しくありません。';
      showScreen('screen-login');
      return;
    }
    state.token = token;
    state.user = res.user;
    safeSetLocalStorage(LS_TOKEN_KEY, token);
    document.getElementById('userNameLabel').textContent = res.user.name + ' さん';
    // 保護者確認用アカウントだけ、出題形式を任意に指定できるデバッグ欄を出す
    document.getElementById('debugModeCard').style.display = (res.user.role === '保護者確認用') ? '' : 'none';
    // 10-3節: 「AIコーチに相談」ボタンを常設し、週次更新直後は未読バッジを出す
    updateAiCoachButton_(res.user);
    showScreen('screen-home');
    loadStats();
  }).catch(function () {
    if (!silent) errEl.textContent = '通信に失敗しました。GAS_API_URLの設定を確認してください。';
  });
}

// ---- 進捗表示 (5-2節: 表示用スコアは下がらない) ----
// ---- AIコーチ(NotebookLM)ボタン (10-3節) ----
function updateAiCoachButton_(user) {
  const btn = document.getElementById('aiCoachBtn');
  const badge = document.getElementById('aiCoachBadge');
  const note = document.getElementById('aiCoachNote');
  if (!user.notebooklmUrl) {
    btn.style.display = 'none';
    note.style.display = 'none';
    return;
  }
  btn.style.display = '';
  const unconfirmed = !!user.notebooklmUnconfirmed;
  badge.style.display = unconfirmed ? '' : 'none';
  note.style.display = unconfirmed ? '' : 'none';
}

function onAiCoachClick_() {
  if (!state.user || !state.user.notebooklmUrl) return;
  window.open(state.user.notebooklmUrl, '_blank');
  if (state.user.notebooklmUnconfirmed) {
    state.user.notebooklmUnconfirmed = false;
    updateAiCoachButton_(state.user);
    callApi('markNotebookSeen', { token: state.token }).catch(function () { /* ignore */ });
  }
}

function loadStats() {
  const body = document.getElementById('statsBody');
  const skillBody = document.getElementById('skillScoreBody');
  body.textContent = '読み込み中...';
  skillBody.textContent = '読み込み中...';
  callApi('getStats', { token: state.token }).then(function (res) {
    if (!res.ok) { body.textContent = '取得に失敗しました。'; skillBody.textContent = '取得に失敗しました。'; return; }
    body.innerHTML = renderStatsGrid(res.stats);
    skillBody.innerHTML = renderSkillScores(res.stats.skillScores || []);
  }).catch(function () {
    body.textContent = '通信に失敗しました。';
    skillBody.textContent = '通信に失敗しました。';
  });
  loadPausePeriods();
  loadExamInfo();
}

// ---- 休止期間 (12章) ----
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
  Vocabulary: '語彙',
  Reading: 'リーディング',
  Listening: 'リスニング',
  Writing: 'ライティング',
  Speaking: 'スピーキング'
};
const SKILLS_FOR_EXAM = ['Vocabulary', 'Reading', 'Listening', 'Writing', 'Speaking'];

function renderSkillScores(skillScores) {
  return skillScores.map(function (s) {
    const label = SKILL_LABELS[s.skill] || s.skill;
    if (!s.implemented) {
      return (
        '<div class="skill-row skill-row-disabled">' +
        '<div class="skill-row-head"><span>' + label + '</span><span class="skill-badge">未実装</span></div>' +
        '<div class="skill-bar-track"><div class="skill-bar-fill" style="width:0%"></div></div>' +
        '</div>'
      );
    }
    const pct = Math.max(0, Math.min(100, s.displayScore));
    return (
      '<div class="skill-row">' +
      '<div class="skill-row-head"><span>' + label + '</span><span>' + pct + '点</span></div>' +
      '<div class="skill-bar-track"><div class="skill-bar-fill" style="width:' + pct + '%"></div></div>' +
      '</div>'
    );
  }).join('');
}

// ---- セッション開始 (6-1節) ----
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
  const isBlank = q.sectionType === '空所補充';
  const instruction = isBlank
    ? ('英文中の網掛けの( ' + q.blankNumber + ' )に入れるのに最も適切なものを選んでください')
    : (q.questionText ? escapeHtml_(q.questionText) : '内容に最も合うものを選んでください');

  let passageHtml = escapeHtml_(q.passage);
  if (isBlank && q.blankNumber) {
    // 同じパッセージに複数の空所番号があるため、「今どの番号を答えているか」を
    // 網掛け表示で示す(付けないと(18)(19)(20)のどれに回答しているか分からなくなるため)
    const pattern = new RegExp('\\(\\s*' + q.blankNumber + '\\s*\\)');
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

function speakText_(text, rate) {
  try {
    if (!window.speechSynthesis) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = rate || 1.0;
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
    '<button id="listeningPlayBtn" class="btn-primary listening-play-btn">🔊 音声を再生</button>' +
    '<p class="quiz-instruction reading-instruction">' + escapeHtml_(q.questionText || '内容に最も合うものを選んでください') + '</p>' +
    '<div id="quizChoices" class="choice-list"></div>' +
    '<p id="quizFeedback" class="feedback-text"></p>' +
    '<div id="listeningScript" class="reading-passage listening-script" style="display:none;"></div>';

  document.getElementById('listeningPlayBtn').addEventListener('click', function () {
    state.listeningReplayCount++;
    const ok = speakText_(ttsCleanScript_(q.script), speedRate);
    const btn = document.getElementById('listeningPlayBtn');
    if (!ok) {
      btn.textContent = 'この端末では読み上げに対応していません';
    } else {
      btn.textContent = '🔁 もう一度聞く(' + state.listeningReplayCount + '回目)';
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

  // 出題中は自動で1回再生しておく(再生ボタンの押し忘れ対策。リピート回数にはカウントしない)
  speakText_(ttsCleanScript_(q.script), speedRate);
}

function onChooseListening(choice, btnEl) {
  const q = state.questions[state.currentIndex];
  const elapsedSec = Math.round((Date.now() - state.questionStartTime) / 1000);

  if (window.speechSynthesis) window.speechSynthesis.cancel();
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

  card.innerHTML =
    '<p class="reading-label">' + escapeHtml_(prompt.skill + '・' + prompt.promptType) + '</p>' +

    '<p class="practice-step-label">① 課題に取り組む</p>' +
    '<p class="practice-instruction">' + escapeHtml_(prompt.instruction || '課題に取り組んでください。') + '</p>' +
    '<div class="reading-passage">' + escapeHtml_(prompt.task).replace(/\n/g, '<br>') + '</div>' +
    '<textarea id="answerInput" class="answer-textarea" placeholder="ここに解答を書いてください(Speakingの場合は話した内容を書き起こしてください)" rows="6"></textarea>' +

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
      // AIコーチに相談したら、点数入力欄を使えるようにする
      document.querySelectorAll('#axisScoreForm .score-chip').forEach(function (b) { b.disabled = false; });
      document.getElementById('axisInstruction').textContent = 'NotebookLMからのフィードバックで、各項目が何点だったか入力してください(0〜4点)';
    });
  }

  state.practiceStartTime = Date.now();
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
