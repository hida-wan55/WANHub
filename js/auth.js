// 認証チェック（未ログインならログイン画面へ）
async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = '/index.html';
    return null;
  }
  return session;
}

// 現在のユーザープロフィールを取得
async function getCurrentProfile() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) return null;

  const { data } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();
  return data;
}

// ログアウト
async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = '/index.html';
}

// URLパラメータを取得
function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// 日付フォーマット（YYYY/MM/DD）
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

// HTMLエスケープ（XSS対策）
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ステータスバッジHTML
function statusBadge(status) {
  const map = {
    open:        ['未対応',  'badge-status-open'],
    in_progress: ['処理中',  'badge-status-in-progress'],
    resolved:    ['処理済み', 'badge-status-resolved'],
    closed:      ['完了',    'badge-status-closed'],
  };
  const [label, cls] = map[status] || ['不明', ''];
  return `<span class="badge ${cls}">${label}</span>`;
}

// 優先度バッジHTML
function priorityBadge(priority) {
  const map = {
    urgent: ['緊急', 'badge-priority-urgent'],
    high:   ['高',   'badge-priority-high'],
    medium: ['中',   'badge-priority-medium'],
    low:    ['低',   'badge-priority-low'],
  };
  const [label, cls] = map[priority] || ['中', ''];
  return `<span class="badge ${cls}">${label}</span>`;
}

// エラーメッセージ表示
function showError(message, containerId = 'error-container') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-danger">${escapeHtml(message)}</div>`;
  el.style.display = 'block';
}

// 成功メッセージ表示（3秒で消える）
function showSuccess(message, containerId = 'error-container') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-success">${escapeHtml(message)}</div>`;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 3000);
}
