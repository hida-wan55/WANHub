window.statusList = [];

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

// ステータス一覧をDBから取得（全ページで使用）
async function loadStatuses() {
  const { data } = await supabaseClient
    .from('statuses')
    .select('*')
    .order('sort_order');
  window.statusList = data && data.length > 0 ? data : [
    { name: 'open',        label: '未対応',  color: '#6C757D' },
    { name: 'in_progress', label: '処理中',  color: '#1565C0' },
    { name: 'resolved',    label: '処理済み', color: '#E65100' },
    { name: 'closed',      label: '完了',    color: '#2E7D32' },
  ];
  return window.statusList;
}

// テーマカラーをCSS変数として適用（サイドバー背景も連動）
function applyTheme(color) {
  if (!color || !/^#[0-9A-Fa-f]{6}$/.test(color)) return;
  document.documentElement.style.setProperty('--primary', color);
  document.documentElement.style.setProperty('--primary-dark', darkenHex(color, 20));
  document.documentElement.style.setProperty('--sidebar-active-bg', hexToRgba(color, 0.25));
  document.documentElement.style.setProperty('--sidebar-bg', sidebarBg(color));
}

// テーマカラーからサイドバー用の暗い背景色を生成
function sidebarBg(hex) {
  const r = Math.min(Math.round(parseInt(hex.slice(1,3), 16) * 0.2 + 8),  55);
  const g = Math.min(Math.round(parseInt(hex.slice(3,5), 16) * 0.2 + 8),  55);
  const b = Math.min(Math.round(parseInt(hex.slice(5,7), 16) * 0.2 + 12), 75);
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

// 色を暗くする
function darkenHex(hex, amount) {
  const r = Math.max(0, parseInt(hex.slice(1,3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3,5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5,7), 16) - amount);
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

// hex → rgba変換
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
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
  return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
}

// HTMLエスケープ（XSS対策）
function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ステータスバッジ（DBから動的に取得した色を使用）
function statusBadge(statusName) {
  const status = window.statusList.find(s => s.name === statusName);
  const label  = status?.label || statusName;
  const color  = status?.color || '#6C757D';
  const bg     = hexToRgba(color, 0.14);
  return `<span class="badge" style="background:${bg};color:${color};border:1px solid ${hexToRgba(color,0.25)}">${escapeHtml(label)}</span>`;
}

// ステータスのoption要素を生成
function statusOptions(current) {
  return window.statusList.map(s =>
    `<option value="${escapeHtml(s.name)}" ${s.name === current ? 'selected' : ''}>${escapeHtml(s.label)}</option>`
  ).join('');
}

// 優先度バッジ
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

// アバターHTML（画像があれば画像、なければ頭文字）
function avatarHtml(profile, size = 32, fontSize = 13) {
  if (profile?.avatar_url) {
    return `<img src="${escapeHtml(profile.avatar_url)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;flex-shrink:0" alt="">`;
  }
  const initial = (profile?.name || '?').charAt(0).toUpperCase();
  return `<div class="user-avatar" style="width:${size}px;height:${size}px;font-size:${fontSize}px;flex-shrink:0">${initial}</div>`;
}

// サイドバーのアバターを更新
function updateSidebarAvatar(profile) {
  const el = document.getElementById('user-avatar-sidebar');
  if (!el) return;
  if (profile?.avatar_url) {
    el.innerHTML = `<img src="${escapeHtml(profile.avatar_url)}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`;
    el.style.background = 'transparent';
    el.style.padding    = '0';
    el.style.overflow   = 'hidden';
  } else {
    el.innerHTML        = '';
    el.textContent      = (profile?.name || '?').charAt(0).toUpperCase();
    el.style.background = '';
    el.style.padding    = '';
    el.style.overflow   = '';
  }
}

// プロフィールモーダルのセットアップ
async function setupProfileModal(profile) {
  if (!profile) return;

  // ---- 氏名・パスワード変更フィールドを注入（1ページ1回だけ）----
  if (!document.getElementById('profile-last-name')) {
    const modalBody = document.querySelector('#profileModal .modal-body');
    if (modalBody) {
      // 氏名フィールド（先頭に挿入）
      const nameDiv = document.createElement('div');
      nameDiv.className = 'mb-4';
      nameDiv.innerHTML = `
        <label class="form-label fw-semibold"
               style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted)">
          表示名
        </label>
        <div class="row g-2">
          <div class="col-6">
            <input type="text" id="profile-last-name" class="form-control form-control-sm" placeholder="姓">
          </div>
          <div class="col-6">
            <input type="text" id="profile-first-name" class="form-control form-control-sm" placeholder="名">
          </div>
        </div>

      `;
      modalBody.insertBefore(nameDiv, modalBody.firstChild);

      // パスワード変更フィールド（末尾に追加）
      const pwDiv = document.createElement('div');
      pwDiv.className = 'mt-4 pt-3';
      pwDiv.style.borderTop = '1px solid var(--border)';
      pwDiv.innerHTML = `
        <label class="form-label fw-semibold"
               style="font-size:12px;text-transform:uppercase;letter-spacing:0.6px;color:var(--text-muted)">
          パスワード変更
        </label>
        <div id="profile-pw-error" class="alert alert-danger py-1 mb-2"
             style="display:none;font-size:13px"></div>
        <input type="password" id="profile-new-password" class="form-control form-control-sm mb-2"
               placeholder="新しいパスワード（6文字以上）" autocomplete="new-password">
        <input type="password" id="profile-confirm-password" class="form-control form-control-sm"
               placeholder="確認のためもう一度入力" autocomplete="new-password">
      `;
      modalBody.appendChild(pwDiv);
    }

    // 保存ボタンをフッターに追加
    const footer = document.querySelector('#profileModal .modal-footer');
    if (footer) {
      const saveBtn = document.createElement('button');
      saveBtn.type      = 'button';
      saveBtn.className = 'btn btn-primary';
      saveBtn.id        = 'profile-save-btn';
      saveBtn.innerHTML = '<i class="bi bi-check2 me-1"></i>保存';
      footer.insertBefore(saveBtn, footer.firstChild);
      saveBtn.addEventListener('click', () => saveProfileChanges(profile));
    }
  }

  // 既存の氏名をプリフィル
  const lastEl  = document.getElementById('profile-last-name');
  const firstEl = document.getElementById('profile-first-name');
  if (profile.name && lastEl && firstEl) {
    const parts   = profile.name.trim().split(' ');
    lastEl.value  = parts[0] || '';
    firstEl.value = parts.slice(1).join(' ') || '';
  }

  // テーマカラーピッカー
  const pickerEl    = document.getElementById('theme-color-picker');
  const currentColor = profile.theme_color || '#1F6FEB';
  if (pickerEl) {
    if (!pickerEl.querySelector('input[type="color"]')) {
      pickerEl.innerHTML = `
        <div class="d-flex gap-2 align-items-center">
          <input type="color" id="theme-color-input" class="form-control form-control-color"
                 value="${currentColor}" style="width:44px;height:36px;padding:2px 4px;cursor:pointer">
          <span id="theme-color-preview" class="px-3 py-1 rounded fw-semibold"
                style="background:${currentColor};color:#fff;font-size:13px">プレビュー</span>
        </div>
      `;
      const colorInput = document.getElementById('theme-color-input');
      const previewEl  = document.getElementById('theme-color-preview');
      colorInput.addEventListener('input', (e) => {
        applyTheme(e.target.value);
        previewEl.style.background = e.target.value;
      });
      colorInput.addEventListener('change', async (e) => {
        const color = e.target.value;
        profile.theme_color = color;
        await supabaseClient.from('profiles').update({ theme_color: color }).eq('id', profile.id);
      });
    } else {
      const colorInput = document.getElementById('theme-color-input');
      const previewEl  = document.getElementById('theme-color-preview');
      if (colorInput) colorInput.value = currentColor;
      if (previewEl)  previewEl.style.background = currentColor;
    }
  }

  // アバタープレビュー更新
  updateAvatarPreview(profile);

  // アバターアップロード
  const avatarInput = document.getElementById('avatar-file-input');
  if (avatarInput) {
    avatarInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        alert('アバター画像は2MB以下にしてください');
        return;
      }

      const ext       = file.name.split('.').pop();
      const filePath  = `${profile.id}/avatar.${ext}`;

      const { error } = await supabaseClient.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (error) { alert('アップロードに失敗しました'); return; }

      const { data: { publicUrl } } = supabaseClient.storage
        .from('avatars')
        .getPublicUrl(filePath);

      const avatarUrl = `${publicUrl}?t=${Date.now()}`;
      await supabaseClient.from('profiles').update({ avatar_url: avatarUrl }).eq('id', profile.id);
      profile.avatar_url = avatarUrl;

      updateAvatarPreview(profile);
      updateSidebarAvatar(profile);
      avatarInput.value = '';
    });
  }
}

function updateAvatarPreview(profile) {
  const el = document.getElementById('profile-avatar-preview');
  if (!el) return;
  if (profile?.avatar_url) {
    el.innerHTML        = `<img src="${escapeHtml(profile.avatar_url)}" style="width:100%;height:100%;object-fit:cover" alt="">`;
    el.style.background = 'transparent';
  } else {
    el.innerHTML        = '';
    el.textContent      = (profile?.name || '?').charAt(0).toUpperCase();
    el.style.background = 'var(--primary)';
  }
}

// ファイルサイズフォーマット
function formatFileSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024)         return `${bytes} B`;
  if (bytes < 1024 * 1024)  return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 通知ベルをヘッダーに注入
function injectNotificationBell() {
  if (document.getElementById('bell-btn')) return;
  const header = document.querySelector('.top-header');
  if (!header) return;

  const el = document.createElement('div');
  el.className = 'notification-bell';
  el.innerHTML = `
    <button class="bell-btn" id="bell-btn" title="通知">
      <i class="bi bi-bell"></i>
      <span class="bell-badge" id="bell-badge" style="display:none">0</span>
    </button>
    <div class="bell-dropdown" id="bell-dropdown" style="display:none">
      <div class="bell-header">通知</div>
      <div id="notifications-list" style="max-height:300px;overflow-y:auto"></div>
      <div class="bell-footer">
        <button class="btn btn-sm btn-link text-muted p-0" id="mark-all-read-btn">すべて既読にする</button>
      </div>
    </div>
  `;

  const children = [...header.children];
  if (children.length > 1) {
    children[children.length - 1].before(el);
  } else {
    header.appendChild(el);
  }
}

// 通知ベルのイベントセットアップ
async function setupNotificationBell(userId) {
  const bellBtn  = document.getElementById('bell-btn');
  const dropdown = document.getElementById('bell-dropdown');
  if (!bellBtn || !dropdown) return;

  await refreshNotificationCount(userId);

  bellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const isOpen = dropdown.style.display !== 'none';
    dropdown.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) await loadNotificationList(userId);
  });

  document.addEventListener('click', () => { dropdown.style.display = 'none'; });
  dropdown.addEventListener('click', (e) => e.stopPropagation());

  document.getElementById('mark-all-read-btn')?.addEventListener('click', async () => {
    await supabaseClient.from('notifications')
      .update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
    await refreshNotificationCount(userId);
    await loadNotificationList(userId);
  });
}

// 未読件数バッジを更新
async function refreshNotificationCount(userId) {
  const { count } = await supabaseClient
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId).eq('is_read', false);

  const badge = document.getElementById('bell-badge');
  if (!badge) return;
  if (count && count > 0) {
    badge.textContent    = count > 99 ? '99+' : count;
    badge.style.display  = 'inline';
  } else {
    badge.style.display  = 'none';
  }
}

// 通知リストを表示
async function loadNotificationList(userId) {
  const listEl = document.getElementById('notifications-list');
  if (!listEl) return;

  const { data } = await supabaseClient
    .from('notifications')
    .select('*, issue:issues(id,title), actor:profiles!actor_id(name)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (!data || data.length === 0) {
    listEl.innerHTML = '<div class="text-center text-muted py-4" style="font-size:13px">通知はありません</div>';
    return;
  }

  listEl.innerHTML = data.map(n => `
    <a href="/issue.html?id=${n.issue_id}"
       class="notification-item ${n.is_read ? '' : 'unread'}"
       data-notif-id="${n.id}">
      ${!n.is_read ? '<div class="notif-dot"></div>' : '<div style="width:7px;flex-shrink:0"></div>'}
      <div>
        <div class="notif-text">${escapeHtml(n.message)}</div>
        <div class="notif-meta">${escapeHtml(n.issue?.title || '')} · ${formatDate(n.created_at)}</div>
      </div>
    </a>
  `).join('');

  listEl.addEventListener('click', async (e) => {
    const item = e.target.closest('[data-notif-id]');
    if (!item) return;
    supabaseClient.from('notifications').update({ is_read: true }).eq('id', item.dataset.notifId);
    item.classList.remove('unread');
    item.querySelector('.notif-dot')?.remove();
    await refreshNotificationCount(userId);
  });
}

// ラベルバッジHTML生成
function labelBadgeHtml(label) {
  const bg  = hexToRgba(label.color, 0.14);
  const bdr = hexToRgba(label.color, 0.35);
  return `<span class="label-badge" style="background:${bg};color:${label.color};border-color:${bdr}">${escapeHtml(label.name)}</span>`;
}

// debounce（連続呼び出しの制御）
function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

// グローバル検索ボタン＋モーダルを注入
function injectGlobalSearch() {
  if (document.getElementById('global-search-trigger')) return;

  // ボタン
  const btn = document.createElement('button');
  btn.id        = 'global-search-trigger';
  btn.className = 'search-trigger-btn';
  btn.title     = '全体検索';
  btn.innerHTML = '<i class="bi bi-search"></i>';

  const bell = document.getElementById('bell-btn')?.closest('.notification-bell');
  if (bell) bell.before(btn);
  else document.querySelector('.top-header')?.appendChild(btn);

  // モーダルHTML
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="modal fade" id="globalSearchModal" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header pb-2">
            <div class="input-group">
              <span class="input-group-text bg-transparent border-0"><i class="bi bi-search text-muted"></i></span>
              <input type="text" id="global-search-input" class="form-control border-0 shadow-none ps-1"
                     placeholder="課題を検索..." style="font-size:15px" autocomplete="off">
            </div>
            <button type="button" class="btn-close ms-2" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-0" id="global-search-results" style="min-height:200px">
            <div class="text-center text-muted py-5" style="font-size:13px">キーワードを入力してください</div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild);

  btn.addEventListener('click', () => {
    const m = new bootstrap.Modal(document.getElementById('globalSearchModal'));
    m.show();
    setTimeout(() => document.getElementById('global-search-input')?.focus(), 300);
  });

  document.getElementById('global-search-input').addEventListener('input', debounce(async (e) => {
    const q       = e.target.value.trim();
    const results = document.getElementById('global-search-results');
    if (q.length < 2) {
      results.innerHTML = '<div class="text-center text-muted py-5" style="font-size:13px">2文字以上入力してください</div>';
      return;
    }
    results.innerHTML = '<div class="text-center text-muted py-5"><span class="spinner-border spinner-border-sm"></span></div>';

    const { data, error } = await supabaseClient
      .from('issues')
      .select('id, title, status, project:projects(id,name)')
      .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
      .order('updated_at', { ascending: false })
      .limit(20);

    if (error || !data || data.length === 0) {
      results.innerHTML = '<div class="text-center text-muted py-5" style="font-size:13px">該当する課題が見つかりません</div>';
      return;
    }

    results.innerHTML = data.map(i => `
      <a href="/issue.html?id=${i.id}" class="search-result-item" data-bs-dismiss="modal">
        <div class="search-result-project">
          <i class="bi bi-folder2 me-1"></i>${escapeHtml(i.project?.name || '-')}
        </div>
        <div class="d-flex align-items-center gap-2">
          <span class="search-result-title">${escapeHtml(i.title)}</span>
          ${statusBadge(i.status)}
        </div>
      </a>
    `).join('');
  }, 300));
}

// プロフィール保存（氏名 + パスワード）
async function saveProfileChanges(profile) {
  const lastName  = document.getElementById('profile-last-name')?.value.trim()  || '';
  const firstName = document.getElementById('profile-first-name')?.value.trim() || '';
  const newPw     = document.getElementById('profile-new-password')?.value      || '';
  const confirmPw = document.getElementById('profile-confirm-password')?.value  || '';
  const pwErrEl   = document.getElementById('profile-pw-error');
  const saveBtn   = document.getElementById('profile-save-btn');

  if (pwErrEl) pwErrEl.style.display = 'none';

  let changed = false;

  // ---- 氏名の更新 ----
  const fullName = [lastName, firstName].filter(Boolean).join(' ');
  if (fullName && fullName !== profile.name) {
    const { error } = await supabaseClient
      .from('profiles').update({ name: fullName }).eq('id', profile.id);
    if (!error) {
      profile.name = fullName;
      changed = true;
      const nameEl = document.getElementById('user-name-sidebar');
      if (nameEl) nameEl.textContent = fullName;
      updateAvatarPreview(profile);
      updateSidebarAvatar(profile);
    }
  }

  // ---- パスワードの更新 ----
  if (newPw) {
    if (newPw.length < 6) {
      if (pwErrEl) { pwErrEl.textContent = 'パスワードは6文字以上で設定してください'; pwErrEl.style.display = 'block'; }
      return;
    }
    if (newPw !== confirmPw) {
      if (pwErrEl) { pwErrEl.textContent = 'パスワードが一致しません'; pwErrEl.style.display = 'block'; }
      return;
    }
    const { error } = await supabaseClient.auth.updateUser({ password: newPw });
    if (error) {
      console.error('[updateUser]', error.message);
      if (pwErrEl) { pwErrEl.textContent = 'パスワードの変更に失敗しました。'; pwErrEl.style.display = 'block'; }
      return;
    }
    changed = true;
    const pwEl  = document.getElementById('profile-new-password');
    const cfmEl = document.getElementById('profile-confirm-password');
    if (pwEl)  pwEl.value  = '';
    if (cfmEl) cfmEl.value = '';
  }

  if (changed && saveBtn) {
    saveBtn.innerHTML  = '<i class="bi bi-check2 me-1"></i>保存しました';
    saveBtn.classList.replace('btn-primary', 'btn-success');
    setTimeout(() => {
      saveBtn.innerHTML = '<i class="bi bi-check2 me-1"></i>保存';
      saveBtn.classList.replace('btn-success', 'btn-primary');
    }, 2000);
  }
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
