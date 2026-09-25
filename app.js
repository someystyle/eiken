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
  questions: [],
  currentIndex: 0,
  correctCount: 0,
  questionStartTime: null
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
    safeRemoveLocalStorage(LS_TOKEN_KEY);
    state.token = null;
    state.user = null;
    document.getElementById('tokenInput').value = '';
    showScreen('screen-login');
  });

  setupChipGroup('minutesChips', function (val) { state.minutes = val; updateStartBtn(); });
  setupChipGroup('conditionChips', function (val) { state.condition = val; updateStartBtn(); });

  document.getElementById('startBtn').addEventListener('click', startSession);
  document.getElementById('quitQuizBtn').addEventListener('click', function () {
    showScreen('screen-home');
    loadStats();
  });
  document.getElementById('backHomeBtn').addEventListener('click', function () {
    showScreen('screen-home');
    loadStats();
  });
});

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
    showScreen('screen-home');
    loadStats();
  }).catch(function () {
    if (!silent) errEl.textContent = '通信に失敗しました。GAS_API_URLの設定を確認してください。';
  });
}

// ---- 進捗表示 (5-2節: 表示用スコアは下がらない) ----
function loadStats() {
  const body = document.getElementById('statsBody');
  body.textContent = '読み込み中...';
  callApi('getStats', { token: state.token }).then(function (res) {
    if (!res.ok) { body.textContent = '取得に失敗しました。'; return; }
    body.innerHTML = renderStatsGrid(res.stats);
  }).catch(function () { body.textContent = '通信に失敗しました。'; });
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

// ---- セッション開始 (6-1節) ----
function startSession() {
  showScreen('screen-quiz');
  document.getElementById('quizWord').textContent = '出題中...';
  document.getElementById('quizChoices').innerHTML = '';
  callApi('getQuiz', { token: state.token, minutes: state.minutes, condition: state.condition }).then(function (res) {
    if (!res.ok || !res.questions || res.questions.length === 0) {
      document.getElementById('quizWord').textContent = '出題できる問題がありません';
      return;
    }
    state.questions = res.questions;
    state.currentIndex = 0;
    state.correctCount = 0;
    renderQuestion();
  });
}

function renderQuestion() {
  const q = state.questions[state.currentIndex];
  document.getElementById('quizProgress').textContent = (state.currentIndex + 1) + ' / ' + state.questions.length;
  document.getElementById('quizWord').textContent = q.english;
  document.getElementById('quizFeedback').textContent = '';
  document.getElementById('quizFeedback').className = 'feedback-text';

  const choicesEl = document.getElementById('quizChoices');
  choicesEl.innerHTML = '';
  q.choices.forEach(function (choice) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.textContent = choice;
    btn.addEventListener('click', function () { onChoose(choice, btn); });
    choicesEl.appendChild(btn);
  });

  state.questionStartTime = Date.now();
}

function onChoose(choice, btnEl) {
  const q = state.questions[state.currentIndex];
  const elapsedSec = Math.round((Date.now() - state.questionStartTime) / 1000);

  document.querySelectorAll('.choice-btn').forEach(function (b) { b.disabled = true; });

  callApi('submitAnswer', {
    token: state.token,
    vocabId: q.vocabId,
    selected: choice,
    elapsedSec: elapsedSec
  }).then(function (res) {
    const feedbackEl = document.getElementById('quizFeedback');
    let delayMs = 1600; // 正解表示をしっかり確認できるよう長めに待つ
    if (res.ok && res.correct) {
      state.correctCount++;
      btnEl.classList.add('correct', 'selected');
      feedbackEl.textContent = '正解！';
      feedbackEl.classList.add('correct');
    } else {
      // 選んだ選択肢には「不正解(選択した)」の色を、正解の選択肢には「正解」の色を、
      // 次の問題に進むまでの間ずっと表示し続ける。
      btnEl.classList.add('incorrect', 'selected');
      feedbackEl.textContent = res.ok ? ('不正解… 正解は「' + res.answer + '」') : 'エラーが発生しました';
      feedbackEl.classList.add('incorrect');
      document.querySelectorAll('.choice-btn').forEach(function (b) {
        if (res.ok && b.textContent === res.answer) b.classList.add('correct');
      });
      delayMs = 2600; // 不正解時は正解を確認する時間をさらに長くする
    }
    setTimeout(nextQuestion, delayMs);
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
