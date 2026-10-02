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
  pronunciationSpeed: 1,
  basicWords: [],
  basicBlockSize: 50,
  basicRunId: 0};

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
    stopSpeakingPracticeTimers_();
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
  setupChipGroup('statsViewChips', function (val) {
    document.getElementById('statsBody').style.display = (val === 'numbers') ? '' : 'none';
    document.getElementById('statsGraphBody').style.display = (val === 'graph') ? '' : 'none';
  });
  setupHomeTabs();

  document.getElementById('startBtn').addEventListener('click', startSession);
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

  document.getElementById('aiCoachBtn').addEventListener('click', onAiCoachClick_);
  document.getElementById('startMockExamBtn').addEventListener('click', startMockExam);

  document.getElementById('writingPracticeBtn').addEventListener('click', function () { startPractice('Writing'); });
  document.getElementById('speakingPracticeBtn').addEventListener('click', function () { startPractice('Speaking'); });
  document.getElementById('quitPracticeBtn').addEventListener('click', function () {
    stopSpeakingPracticeTimers_();
    stopSpeech_();
    showScreen('screen-home');
    loadStats();
  });

  document.getElementById('pronunciationBtn').addEventListener('click', startPronunciation);
  document.getElementById('pronunciationRepeatBtn').addEventListener('click', function () { playCurrentPronunciationWord_(); });
  document.getElementById('pronunciationNextBtn').addEventListener('click', nextPronunciationWord);
  setupChipGroup('pronunciationSpeedChips', function (val) { state.pronunciationSpeed = Number(val) || 1; });
  document.getElementById('quitPronunciationBtn').addEventListener('click', function () {
    stopSpeech_();
    showScreen('screen-home');
    loadStats();
  });

  document.getElementById('basicPlayAllBtn').addEventListener('click', function () { startBasicPlayback_(null); });
  document.getElementById('quitBasicBtn').addEventListener('click', function () {
    stopBasicPlayback_();
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
  if (saved) switchHomeTab(saved);
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
    loadBasicWords_();
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
    const skillScores = res.stats.skillScores || [];
    skillBody.innerHTML = renderSkillScores(skillScores);
    document.getElementById('statsGraphBody').innerHTML = renderSkillRadarChart_(skillScores);
  }).catch(function () {
    body.textContent = '通信に失敗しました。';
    skillBody.textContent = '通信に失敗しました。';
  });
  loadPausePeriods();
  loadExamInfo();
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

  // 背景のグリッド線(25/50/75/100%の目安の五角形)
  const gridLevels = [0.25, 0.5, 0.75, 1];
  const gridPolygons = gridLevels.map(function (ratio) {
    const pts = points.map(function (_, i) { const c = coordAt(i, ratio); return c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' ');
    return '<polygon points="' + pts + '" fill="none" stroke="#dde3dd" stroke-width="1"></polygon>';
  }).join('');

  // 中心から各軸への線
  const axisLines = points.map(function (_, i) {
    const c = coordAt(i, 1);
    return '<line x1="' + center + '" y1="' + center + '" x2="' + c.x.toFixed(1) + '" y2="' + c.y.toFixed(1) + '" stroke="#dde3dd" stroke-width="1"></line>';
  }).join('');

  // 実際の値を結ぶ五角形
  const valuePts = points.map(function (p, i) { const c = coordAt(i, p.value / 100); return c.x.toFixed(1) + ',' + c.y.toFixed(1); }).join(' ');

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
    gridPolygons + axisLines +
    '<polygon points="' + valuePts + '" fill="rgba(45,106,79,0.25)" stroke="#2d6a4f" stroke-width="2" stroke-linejoin="round"></polygon>' +
    labels +
    '</svg>' +
    '<p class="graph-caption">今いちばん伸びしろがあるのは「' + weakest.label + '」です</p>';
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

  card.innerHTML =
    '<p class="reading-label">' + escapeHtml_(prompt.skill + '・' + prompt.promptType) + '</p>' +

    '<p class="practice-step-label">① 課題に取り組む</p>' +
    '<p class="practice-instruction">' + escapeHtml_(prompt.instruction || '課題に取り組んでください。') + '</p>' +
    '<div class="reading-passage">' + escapeHtml_(prompt.task).replace(/\n/g, '<br>') + '</div>' +
    '<textarea id="answerInput" class="answer-textarea" placeholder="ここに解答を書いてください(Speakingの場合は話した内容を書き起こしてください)" rows="6"></textarea>' +

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

// ---- スピーキング補完練習 (機能B: 本番形式タイマー・回答テンプレート・自己録音・シャドーイング) ----
// 正誤判定・採点は行わない自己練習ツール。①課題に取り組む欄と②AIコーチ相談欄の間に、
// 任意で使える練習ブロックとして表示する(Speakingのみ)。
let speakingCountdownTimer_ = null;
let speakingMediaRecorder_ = null;

function stopSpeakingPracticeTimers_() {
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
      playBtn.addEventListener('click', function () { speakText_(t, 1.0); });
      row.appendChild(textEl);
      row.appendChild(playBtn);
      listEl.appendChild(row);
    });
  }

  const shadowBtn = document.getElementById('speakingShadowBtn');
  if (shadowBtn) {
    shadowBtn.addEventListener('click', function () { speakText_(prompt.task, 1.0); });
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
function startPronunciation() {
  showScreen('screen-pronunciation');
  document.getElementById('pronunciationProgress').textContent = '読み込み中...';
  document.getElementById('pronunciationEnglish').textContent = '';
  document.getElementById('pronunciationKatakana').textContent = '';
  document.getElementById('pronunciationJapanese').textContent = '';

  callApi('getPronunciationWords', { token: state.token }).then(function (res) {
    if (!res.ok || !res.words || res.words.length === 0) {
      document.getElementById('pronunciationProgress').textContent = '0 / 0';
      document.getElementById('pronunciationEnglish').textContent = '単語データがありません';
      return;
    }
    state.pronunciationWords = res.words;
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
  document.getElementById('pronunciationEnglish').textContent = word.english;
  document.getElementById('pronunciationKatakana').textContent = word.katakana || '';
  document.getElementById('pronunciationJapanese').textContent = word.japanese;
}

// 発音の再生自体を1回の「聴取」として記録する(「繰り返し」ボタンも、次の語への
// 自動再生も、どちらも聴取回数としてカウントする仕様のため)
function playCurrentPronunciationWord_() {
  const word = state.pronunciationWords[state.pronunciationIndex];
  if (!word) return;
  speakText_(word.english, state.pronunciationSpeed);
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

// ---- 基礎語の流し聞き ----
// 1語を標準速度で2回(1回目と2回目の間は2秒)読み上げて次の語へ進む。50語ずつの番号ボタンで
// ブロック単位に聞け、聞き終えたブロックのボタンは色が反転する。全ブロックを聞き終えたら元の色に戻す。
const BASIC_REPEAT_COUNT = 2;
const BASIC_GAP_BETWEEN_REPEATS_MS = 2000;
const BASIC_GAP_BETWEEN_WORDS_MS = 800;

function basicPlayedKey_() {
  return 'basicPlayed_' + ((state.user && state.user.userId) || 'unknown');
}

function loadBasicPlayed_() {
  try {
    const raw = safeGetLocalStorage(basicPlayedKey_());
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

function saveBasicPlayed_(arr) {
  try { localStorage.setItem(basicPlayedKey_(), JSON.stringify(arr)); } catch (e) { /* ignore */ }
}

function basicBlockCount_() {
  return Math.ceil(state.basicWords.length / state.basicBlockSize);
}

function loadBasicWords_() {
  callApi('getBasicWords', { token: state.token }).then(function (res) {
    if (!res.ok || !res.words || res.words.length === 0) return;
    state.basicWords = res.words;
    state.basicBlockSize = Number(res.blockSize) || 50;
    document.getElementById('basicPlayAllBtn').disabled = false;
    renderBasicBlockButtons_();
  }).catch(function () { /* 基礎語が読めなくても他の機能は使えるようにする */ });
}

function renderBasicBlockButtons_() {
  const grid = document.getElementById('basicBlockGrid');
  const played = loadBasicPlayed_();
  grid.innerHTML = '';
  for (let b = 1; b <= basicBlockCount_(); b++) {
    const btn = document.createElement('button');
    btn.className = 'basic-block-btn' + (played.indexOf(b) >= 0 ? ' played' : '');
    btn.textContent = String(b);
    btn.addEventListener('click', function () { startBasicPlayback_(b); });
    grid.appendChild(btn);
  }
}

function markBasicBlockPlayed_(block) {
  const played = loadBasicPlayed_();
  if (played.indexOf(block) < 0) played.push(block);
  // 全ブロックを聞き終えたら、番号ボタンの色を全部元に戻す
  saveBasicPlayed_(played.length >= basicBlockCount_() ? [] : played);
  renderBasicBlockButtons_();
}

function stopBasicPlayback_() {
  state.basicRunId++;
  stopSpeech_();
}

// 読み上げが終わるまで待つ。onendが来ない環境でも止まらないよう、文字数に応じた時間で打ち切る。
function speakAndWait_(text, rate, runId, done) {
  if (runId !== state.basicRunId) return;
  let finished = false;
  const finish = function () {
    if (finished) return;
    finished = true;
    done();
  };
  try {
    if (!window.speechSynthesis) { setTimeout(finish, 1500); return; }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = rate || 1.0;
    utterance.onend = finish;
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
    setTimeout(finish, Math.max(4000, text.length * 400));
  } catch (e) {
    setTimeout(finish, 1500);
  }
}

// block が null なら1番から最後まで通しで流す。番号が指定されたらそのブロックだけ流す。
function startBasicPlayback_(block) {
  if (state.basicWords.length === 0) return;
  stopBasicPlayback_();
  const runId = state.basicRunId;
  const blocks = (block === null) ? Array.from({ length: basicBlockCount_() }, function (_, i) { return i + 1; }) : [block];
  showScreen('screen-basic');
  playBasicBlocks_(blocks, 0, runId);
}

function playBasicBlocks_(blocks, blockIdx, runId) {
  if (runId !== state.basicRunId) return;
  if (blockIdx >= blocks.length) {
    showScreen('screen-home');
    loadStats();
    return;
  }
  const block = blocks[blockIdx];
  const start = (block - 1) * state.basicBlockSize;
  const words = state.basicWords.slice(start, start + state.basicBlockSize);
  playBasicWords_(block, words, 0, runId, function () {
    markBasicBlockPlayed_(block);
    playBasicBlocks_(blocks, blockIdx + 1, runId);
  });
}

function playBasicWords_(block, words, idx, runId, onBlockDone) {
  if (runId !== state.basicRunId) return;
  if (idx >= words.length) { onBlockDone(); return; }
  const word = words[idx];
  document.getElementById('basicProgress').textContent = (idx + 1) + ' / ' + words.length;
  document.getElementById('basicBlockLabel').textContent = '基礎語 ' + block + ' / ' + basicBlockCount_();
  document.getElementById('basicEnglish').textContent = word.english;
  document.getElementById('basicKatakana').textContent = word.katakana || '';
  document.getElementById('basicJapanese').textContent = word.japanese;

  let pass = 0;
  const playPass = function () {
    if (runId !== state.basicRunId) return;
    pass++;
    document.getElementById('basicPass').textContent = pass + '回目';
    speakAndWait_(word.english, 1.0, runId, function () {
      if (runId !== state.basicRunId) return;
      if (pass < BASIC_REPEAT_COUNT) {
        setTimeout(playPass, BASIC_GAP_BETWEEN_REPEATS_MS);
      } else {
        setTimeout(function () { playBasicWords_(block, words, idx + 1, runId, onBlockDone); }, BASIC_GAP_BETWEEN_WORDS_MS);
      }
    });
  };
  playPass();
}
