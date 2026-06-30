let issueId        = null;
let currentProfile = null;
let issue          = null;
let profiles       = [];
let allLabels      = [];   // 全ラベル一覧
let issueLabels    = [];   // この課題に付いているラベル
let prevReadAt     = null; // 前回の既読時刻（コメント未読判定に使用）

async function init() {
  const session = await requireAuth();
  if (!session) return;

  issueId = getParam('id');
  if (!issueId) { window.location.href = '/dashboard.html'; return; }

  currentProfile = await getCurrentProfile();
  if (currentProfile) {
    applyTheme(currentProfile.theme_color);
    document.getElementById('user-name-sidebar').textContent = currentProfile.name;
    updateSidebarAvatar(currentProfile);
    setupProfileModal(currentProfile);
    injectNotificationBell();
    setupNotificationBell(currentProfile.id);
  }

  await loadStatuses();

  // profiles と labels は loadComments/ラベル表示より先に取得
  await Promise.all([loadProfiles(), loadAllLabels()]);

  // コメント未読判定のため、既読マーク前に前回の閲覧時刻を取得
  if (currentProfile) {
    const { data: readData } = await supabaseClient
      .from('issue_reads').select('read_at')
      .eq('issue_id', issueId).eq('user_id', currentProfile.id).single();
    prevReadAt = readData?.read_at || null;
  }

  await Promise.all([
    loadIssue(),
    loadSidebarProjects(),
    loadComments(),
    loadAttachments(),
    loadLikes(),
    loadIssueLabels(),
    loadSubIssues(),
  ]);

  // コメント一覧表示後に既読更新（次回以降は今回のコメントが既読になる）
  markIssueAsRead();

  setupTitleEdit();
  setupDescEdit();
  setupMetaSave();
  setupCreateSubIssue();
  setupParentSearch();
  setupCommentSubmit();
  setupFileUpload();
  setupDragDrop();
  setupDelete();
  setupCopyIssue();
  setupLabelPicker();
  injectGlobalSearch();
}

async function loadIssue() {
  const { data, error } = await supabaseClient
    .from('issues')
    .select(`*, project:projects(id,name,code), assignee:profiles!assignee_id(id,name), mentor:profiles!mentor_id(id,name), reporter:profiles!reporter_id(name), parent:issues!parent_id(id,title)`)
    .eq('id', issueId)
    .single();

  if (error || !data) { window.location.href = '/dashboard.html'; return; }

  issue = data;
  document.title = `${data.title} - WANHub`;

  const projLink = document.getElementById('breadcrumb-project');
  projLink.textContent = data.project?.name || '-';
  projLink.href = `/project.html?id=${data.project?.id}`;

  const backBtn = document.getElementById('back-btn');
  if (backBtn) backBtn.href = `/project.html?id=${data.project?.id}`;

  // 課題番号を表示
  if (data.issue_number || data.parent_id) {
    const prefix = data.project?.code ? `${data.project.code}-` : '#';
    let numStr;

    if (data.parent_id) {
      // サブタスク: 親の番号を取得して PARENT_NUM-SUB_NUM 形式に
      const [{ data: parentIssue }, { data: siblings }] = await Promise.all([
        supabaseClient.from('issues').select('issue_number').eq('id', data.parent_id).single(),
        supabaseClient.from('issues').select('id, issue_number')
          .eq('parent_id', data.parent_id).order('issue_number', { ascending: true }),
      ]);
      const parentNum = parentIssue?.issue_number;
      const subIdx   = (siblings || []).findIndex(s => s.id === data.id) + 1;
      if (parentNum) {
        numStr = `${prefix}${String(parentNum).padStart(3, '0')}-${String(subIdx).padStart(2, '0')}`;
      } else if (data.issue_number) {
        numStr = `${prefix}${String(data.issue_number).padStart(3, '0')}`;
      }
    } else {
      numStr = `${prefix}${String(data.issue_number).padStart(3, '0')}`;
    }

    if (numStr) {
      document.getElementById('issue-num-display').innerHTML =
        `<span class="issue-num">${escapeHtml(numStr)}</span>`;
    }
  }

  document.getElementById('issue-title-text').textContent = data.title;
  document.getElementById('title-input').value            = data.title;
  document.getElementById('desc-display').textContent     = data.description || '詳細なし';
  document.getElementById('desc-input').value             = data.description || '';

  document.getElementById('meta-status').innerHTML = statusOptions(data.status);
  document.getElementById('meta-priority').value   = data.priority;
  document.getElementById('meta-start-date').value = data.start_date || '';
  document.getElementById('meta-due-date').value   = data.due_date   || '';
  document.getElementById('meta-planned-hours').value = data.planned_hours ?? '';
  document.getElementById('meta-actual-hours').value  = data.actual_hours  ?? '';
  document.getElementById('meta-reporter').textContent = data.reporter?.name || '-';
  document.getElementById('meta-created').textContent  = formatDate(data.created_at);
  document.getElementById('meta-updated').textContent  = formatDate(data.updated_at);

  document.getElementById('meta-assignee').value = data.assignee_id || '';
  document.getElementById('meta-mentor').value   = data.mentor_id   || '';
  renderParentIssue(data.parent);
}

// profiles を先読みし、担当者セレクトを構築する（loadComments より先に呼ぶ）
async function loadProfiles() {
  const { data } = await supabaseClient.from('profiles').select('*').order('name');
  profiles = data || [];
  const assigneeSel = document.getElementById('meta-assignee');
  const mentorSel   = document.getElementById('meta-mentor');
  profiles.forEach(p => {
    [assigneeSel, mentorSel].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      sel.appendChild(opt);
    });
  });
}

async function loadSidebarProjects() {
  const { data: allProjects } = await supabaseClient
    .from('projects').select('id,name').eq('status','active').order('created_at',{ascending:false});
  const el = document.getElementById('sidebar-projects');
  if (!allProjects) return;

  let projects = allProjects;
  const isAdmin = currentProfile?.is_admin || ['owner','admin'].includes(currentProfile?.role);
  if (!isAdmin && currentProfile) {
    const { data: members } = await supabaseClient
      .from('project_members').select('project_id, user_id');
    const projectsWithMembers = new Set((members || []).map(m => m.project_id));
    const myMemberships       = new Set((members || []).filter(m => m.user_id === currentProfile.id).map(m => m.project_id));
    projects = allProjects.filter(p => !projectsWithMembers.has(p.id) || myMemberships.has(p.id));
  }

  el.innerHTML = projects.map(p => `
    <a href="/project.html?id=${p.id}" class="sidebar-link">
      <i class="bi bi-folder2"></i>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
    </a>
  `).join('');
}

async function loadLikes() {
  const { data } = await supabaseClient
    .from('likes').select('user_id, user:profiles(name)').eq('issue_id', issueId);

  const likes   = data || [];
  const myLike  = likes.find(l => l.user_id === currentProfile?.id);
  const btn     = document.getElementById('like-btn');
  const countEl = document.getElementById('like-count');

  countEl.textContent = likes.length;
  btn.classList.toggle('liked', !!myLike);
  btn.querySelector('i').className = myLike ? 'bi bi-heart-fill' : 'bi bi-heart';
  if (likes.length > 0) btn.title = likes.map(l => l.user?.name || '-').join(', ');

  btn.onclick = async () => {
    if (myLike) {
      await supabaseClient.from('likes').delete().eq('issue_id', issueId).eq('user_id', currentProfile.id);
    } else {
      await supabaseClient.from('likes').insert({ issue_id: issueId, user_id: currentProfile.id });
    }
    await loadLikes();
  };
}

async function loadComments() {
  const { data, error } = await supabaseClient
    .from('comments')
    .select('*, user:profiles(id,name,avatar_url)')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true });

  const el = document.getElementById('comments-list');
  if (error) { el.innerHTML = '<p class="text-danger" style="font-size:13.5px">読み込み失敗</p>'; return; }

  if (!data || data.length === 0) {
    el.innerHTML = '<p class="text-center text-muted py-3" style="font-size:13.5px">コメントはまだありません</p>';
    return;
  }

  el.innerHTML = data.map(c => {
    // 自分以外のコメントで、前回閲覧後に投稿されたものは未読
    const isNew = prevReadAt
      && c.created_at > prevReadAt
      && c.user?.id !== currentProfile?.id;

    return `
      <div class="comment-item ${isNew ? 'comment-unread' : ''}">
        <div class="comment-header">
          ${avatarHtml(c.user, 28, 12)}
          <span class="comment-author">${escapeHtml(c.user?.name || '-')}</span>
          <span class="comment-date">${formatDate(c.created_at)}</span>
          ${isNew ? '<span class="badge ms-auto" style="background:var(--primary);font-size:9px;padding:3px 7px">NEW</span>' : ''}
        </div>
        <div class="comment-content-wrap">
          <div class="comment-content">${highlightMentions(c.content)}</div>
        </div>
      </div>
    `;
  }).join('');

  applyCommentCollapse(el);
}

// 4行超えるコメントを折りたたむ
function applyCommentCollapse(container) {
  container.querySelectorAll('.comment-content-wrap').forEach(wrapEl => {
    const contentEl  = wrapEl.querySelector('.comment-content');
    const lineHeight = parseFloat(getComputedStyle(contentEl).lineHeight) || 22;
    if (contentEl.scrollHeight <= lineHeight * 4.8) return; // 4行以内はそのまま

    wrapEl.classList.add('collapsed');

    const btn = document.createElement('button');
    btn.className = 'comment-toggle-btn';
    btn.innerHTML = 'もっと見る <i class="bi bi-chevron-down" style="font-size:10px"></i>';
    btn.addEventListener('click', () => {
      const nowCollapsed = wrapEl.classList.toggle('collapsed');
      btn.innerHTML = nowCollapsed
        ? 'もっと見る <i class="bi bi-chevron-down" style="font-size:10px"></i>'
        : '折りたたむ <i class="bi bi-chevron-up" style="font-size:10px"></i>';
    });
    wrapEl.after(btn);
  });
}

// @名前 をハイライト（プロフィール名と完全一致でマッチ → スペース含む名前も対応）
function highlightMentions(text) {
  let result = escapeHtml(text);
  // 長い名前を先にマッチさせる（部分一致を防ぐ）
  const sorted = [...profiles].sort((a, b) => b.name.length - a.name.length);
  for (const p of sorted) {
    const escaped = escapeHtml(p.name);
    const cls = p.id === currentProfile?.id ? 'mention-self' : 'mention';
    result = result.split(`@${escaped}`).join(`<span class="${cls}">@${escaped}</span>`);
  }
  return result;
}

async function loadAttachments() {
  const { data, error } = await supabaseClient
    .from('attachments')
    .select('*, user:profiles(name)')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: false });

  const el = document.getElementById('attachments-list');
  if (error) { el.innerHTML = '<p class="text-danger" style="font-size:13.5px">読み込み失敗</p>'; return; }

  if (!data || data.length === 0) {
    el.innerHTML = '<p class="text-center text-muted py-2" style="font-size:13.5px">添付ファイルなし</p>';
    return;
  }

  el.innerHTML = data.map(a => `
    <div class="d-flex align-items-center justify-content-between py-2 border-bottom" id="attachment-${a.id}">
      <div class="d-flex align-items-center gap-2" style="min-width:0">
        <i class="bi ${fileIcon(a.file_type)} text-muted" style="font-size:18px;flex-shrink:0"></i>
        <div style="min-width:0">
          <a href="${getFileUrl(a.file_path)}" target="_blank" class="d-block text-truncate" style="font-size:13.5px;max-width:280px">
            ${escapeHtml(a.file_name)}
          </a>
          <span style="font-size:11px;color:var(--text-muted)">${formatFileSize(a.file_size)} · ${escapeHtml(a.user?.name||'-')} · ${formatDate(a.created_at)}</span>
        </div>
      </div>
      <button class="btn btn-sm btn-outline-danger ms-2 flex-shrink-0"
              data-attachment-id="${a.id}" data-file-path="${escapeHtml(a.file_path)}">
        <i class="bi bi-trash3"></i>
      </button>
    </div>
  `).join('');

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-attachment-id]');
    if (!btn || !confirm('この添付ファイルを削除しますか？')) return;
    await supabaseClient.storage.from('attachments').remove([btn.dataset.filePath]);
    await supabaseClient.from('attachments').delete().eq('id', btn.dataset.attachmentId);
    document.getElementById(`attachment-${btn.dataset.attachmentId}`)?.remove();
    if (!el.querySelector('[id^="attachment-"]')) {
      el.innerHTML = '<p class="text-center text-muted py-2" style="font-size:13.5px">添付ファイルなし</p>';
    }
  });
}

async function uploadFiles(files) {
  const MAX_SIZE = 10 * 1024 * 1024;
  const oversized = Array.from(files).filter(f => f.size > MAX_SIZE);
  if (oversized.length > 0) {
    showError(`10MB以上のファイルはアップロードできません：${oversized.map(f=>f.name).join(', ')}`);
    return;
  }

  const statusEl     = document.getElementById('upload-status');
  const statusTextEl = document.getElementById('upload-status-text');
  statusEl.style.display = 'block';

  for (const file of files) {
    statusTextEl.textContent = `アップロード中：${file.name}`;
    const filePath = `${issueId}/${Date.now()}_${file.name}`;
    const { error } = await supabaseClient.storage.from('attachments').upload(filePath, file);
    if (error) { showError(`アップロード失敗：${file.name}`); continue; }
    await supabaseClient.from('attachments').insert({
      issue_id: issueId, user_id: currentProfile?.id,
      file_name: file.name, file_path: filePath,
      file_size: file.size, file_type: file.type,
    });
  }

  statusEl.style.display = 'none';
  await loadAttachments();
}

function setupFileUpload() {
  document.getElementById('file-input').addEventListener('change', async (e) => {
    if (e.target.files.length === 0) return;
    await uploadFiles(e.target.files);
    e.target.value = '';
  });
}

function setupDragDrop() {
  const card = document.getElementById('attachments-card');
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('dragover'); });
  card.addEventListener('dragleave', (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove('dragover'); });
  card.addEventListener('drop', async (e) => {
    e.preventDefault(); card.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) await uploadFiles(e.dataTransfer.files);
  });
}

function setupCommentSubmit() {
  const textarea = document.getElementById('comment-input');

  setupMentionAutocomplete(textarea);

  // 画像ペースト
  textarea.addEventListener('paste', async (e) => {
    const imgItem = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
    if (!imgItem) return;
    e.preventDefault();
    const file     = imgItem.getAsFile();
    const filePath = `${issueId}/${Date.now()}_pasted_image.png`;
    const statusEl = document.getElementById('upload-status');
    document.getElementById('upload-status-text').textContent = '画像をアップロード中...';
    statusEl.style.display = 'block';
    const { error } = await supabaseClient.storage.from('attachments').upload(filePath, file);
    statusEl.style.display = 'none';
    if (error) { showError('画像のアップロードに失敗しました'); return; }
    await supabaseClient.from('attachments').insert({
      issue_id: issueId, user_id: currentProfile?.id,
      file_name: 'pasted_image.png', file_path: filePath,
      file_size: file.size, file_type: file.type,
    });
    const url = getFileUrl(filePath);
    const pos = textarea.selectionStart;
    textarea.value = textarea.value.slice(0, pos) + `[画像: ${url}]` + textarea.value.slice(pos);
    await loadAttachments();
  });

  document.getElementById('add-comment-btn').addEventListener('click', async () => {
    const content = textarea.value.trim();
    if (!content) return;
    const btn = document.getElementById('add-comment-btn');
    btn.disabled = true;
    const { error } = await supabaseClient.from('comments')
      .insert({ issue_id: issueId, user_id: currentProfile?.id, content });
    btn.disabled = false;
    if (!error) {
      // 投稿直後は全コメントを既読として表示（自分が送ったので）
      prevReadAt = new Date().toISOString();
      textarea.value = '';
      await loadComments();
      await markIssueAsRead();
      parseMentionsAndNotify(content);
    }
  });
}

// メンション自動補完（スペース含む名前に対応）
function setupMentionAutocomplete(textarea) {
  const wrapper = textarea.parentNode;
  wrapper.style.position = 'relative';

  const dropdown = document.createElement('div');
  dropdown.className = 'mention-dropdown';
  dropdown.style.display = 'none';
  wrapper.appendChild(dropdown);

  let activeIdx = -1;

  function getQuery() {
    const before = textarea.value.slice(0, textarea.selectionStart);
    // @以降の文字列を取得（@や改行以外すべて）
    const match = before.match(/@([^@\n]*)$/);
    if (!match) return null;
    const raw = match[1];
    // 連続スペースで終わる場合はメンション終了
    if (/\s{2}$/.test(raw)) return null;
    return { query: raw.trimEnd(), atStart: textarea.selectionStart - match[0].length };
  }

  function renderDropdown(query) {
    const filtered = profiles
      .filter(p => p.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 6);

    if (filtered.length === 0) { dropdown.style.display = 'none'; return; }

    dropdown.style.top  = `${textarea.offsetTop + textarea.offsetHeight + 2}px`;
    dropdown.style.left = `${textarea.offsetLeft}px`;
    activeIdx = -1;

    dropdown.innerHTML = filtered.map(p => `
      <div class="mention-item" data-name="${escapeHtml(p.name)}">
        ${avatarHtml(p, 22, 10)}
        <span>${escapeHtml(p.name)}</span>
      </div>
    `).join('');
    dropdown.style.display = 'block';

    dropdown.querySelectorAll('.mention-item').forEach(item => {
      item.addEventListener('mousedown', (e) => { e.preventDefault(); insertMention(item.dataset.name); });
    });
  }

  function insertMention(name) {
    const result = getQuery();
    if (!result) return;
    const before = textarea.value.slice(0, result.atStart);
    const after  = textarea.value.slice(textarea.selectionStart);
    textarea.value = `${before}@${name} ${after}`;
    const pos = result.atStart + name.length + 2;
    textarea.setSelectionRange(pos, pos);
    dropdown.style.display = 'none';
    activeIdx = -1;
    textarea.focus();
  }

  textarea.addEventListener('input', () => {
    const result = getQuery();
    if (result !== null) renderDropdown(result.query);
    else dropdown.style.display = 'none';
  });

  textarea.addEventListener('keydown', (e) => {
    if (dropdown.style.display === 'none') return;
    const items = [...dropdown.querySelectorAll('.mention-item')];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = Math.min(activeIdx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = Math.max(activeIdx - 1, 0);
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      insertMention(items[activeIdx].dataset.name);
      return;
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none'; return;
    } else { return; }
    items.forEach((item, i) => item.classList.toggle('active', i === activeIdx));
  });

  textarea.addEventListener('blur', () => { setTimeout(() => { dropdown.style.display = 'none'; }, 150); });
}

// プロフィール名と完全一致でメンション検出（スペース含む名前も対応）
async function parseMentionsAndNotify(content) {
  if (!currentProfile || !issue) return;
  const mentioned = new Set();
  for (const p of profiles) {
    if (p.id === currentProfile.id) continue;
    if (content.includes(`@${p.name}`)) mentioned.add(p);
  }
  for (const target of mentioned) {
    await supabaseClient.from('notifications').insert({
      user_id:  target.id,
      issue_id: issueId,
      actor_id: currentProfile.id,
      message:  `${currentProfile.name}さんがあなたをメンションしました`,
    });
  }
}

async function markIssueAsRead() {
  if (!currentProfile) return;
  await supabaseClient.from('issue_reads').upsert(
    { issue_id: issueId, user_id: currentProfile.id, read_at: new Date().toISOString() },
    { onConflict: 'issue_id,user_id' }
  );
}

function setupTitleEdit() {
  const titleDisplay = document.getElementById('title-display');
  const titleEdit    = document.getElementById('title-edit');
  const editBtn      = document.getElementById('edit-title-btn');

  editBtn.addEventListener('click', () => {
    titleDisplay.style.display = 'none'; titleEdit.style.display = 'block'; editBtn.style.display = 'none';
  });
  document.getElementById('cancel-title-btn').addEventListener('click', () => {
    titleDisplay.style.display = 'block'; titleEdit.style.display = 'none'; editBtn.style.display = 'block';
    document.getElementById('title-input').value = issue?.title || '';
  });
  document.getElementById('save-title-btn').addEventListener('click', async () => {
    const title = document.getElementById('title-input').value.trim();
    if (!title) return;
    const { error } = await supabaseClient.from('issues').update({ title }).eq('id', issueId);
    if (!error) {
      document.getElementById('issue-title-text').textContent = title;
      document.title = `${title} - WANHub`;
      issue.title = title;
      titleDisplay.style.display = 'block'; titleEdit.style.display = 'none'; editBtn.style.display = 'block';
    }
  });
}

function setupDescEdit() {
  const descDisplay = document.getElementById('desc-display');
  const descEdit    = document.getElementById('desc-edit');
  const editBtn     = document.getElementById('edit-desc-btn');

  editBtn.addEventListener('click', () => {
    descDisplay.style.display = 'none'; descEdit.style.display = 'block'; editBtn.style.display = 'none';
  });
  document.getElementById('cancel-desc-btn').addEventListener('click', () => {
    descDisplay.style.display = 'block'; descEdit.style.display = 'none'; editBtn.style.display = 'block';
  });
  document.getElementById('save-desc-btn').addEventListener('click', async () => {
    const desc = document.getElementById('desc-input').value.trim();
    const { error } = await supabaseClient.from('issues').update({ description: desc }).eq('id', issueId);
    if (!error) {
      descDisplay.textContent = desc || '詳細なし'; issue.description = desc;
      descDisplay.style.display = 'block'; descEdit.style.display = 'none'; editBtn.style.display = 'block';
    }
  });
}

function setupMetaSave() {
  document.getElementById('save-meta-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-meta-btn');
    btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>保存中...';
    const rawPlanned = document.getElementById('meta-planned-hours').value;
    const rawActual  = document.getElementById('meta-actual-hours').value;
    const { error } = await supabaseClient.from('issues').update({
      status:        document.getElementById('meta-status').value,
      priority:      document.getElementById('meta-priority').value,
      assignee_id:   document.getElementById('meta-assignee').value    || null,
      mentor_id:     document.getElementById('meta-mentor').value      || null,
      start_date:    document.getElementById('meta-start-date').value  || null,
      due_date:      document.getElementById('meta-due-date').value    || null,
      planned_hours: rawPlanned !== '' ? parseFloat(rawPlanned) : null,
      actual_hours:  rawActual  !== '' ? parseFloat(rawActual)  : null,
    }).eq('id', issueId);
    btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2 me-1"></i>変更を保存';
    if (!error) {
      document.getElementById('meta-updated').textContent = formatDate(new Date().toISOString());
      showSuccess('保存しました');
    } else { showError('保存に失敗しました'); }
  });
}

function setupDelete() {
  document.getElementById('delete-issue-btn').addEventListener('click', async () => {
    if (!confirm('この課題を削除しますか？\nこの操作は元に戻せません。')) return;
    const projectId = issue?.project?.id;
    const { error } = await supabaseClient.from('issues').delete().eq('id', issueId);
    if (!error) {
      window.location.href = projectId ? `/project.html?id=${projectId}` : '/dashboard.html';
    } else { showError('削除に失敗しました'); }
  });
}

// 全ラベルを取得
async function loadAllLabels() {
  const { data } = await supabaseClient.from('labels').select('*').order('name');
  allLabels = data || [];
}

// この課題のラベルを取得・表示
async function loadIssueLabels() {
  const { data } = await supabaseClient
    .from('issue_labels').select('label:labels(id,name,color)').eq('issue_id', issueId);
  issueLabels = (data || []).map(d => d.label);
  renderLabelDisplay();
}

function renderLabelDisplay() {
  const el = document.getElementById('label-display');
  el.innerHTML = issueLabels.length > 0
    ? issueLabels.map(l => labelBadgeHtml(l)).join(' ')
    : '<span style="font-size:12px;color:var(--text-muted)">なし</span>';
}

// ラベルピッカーのセットアップ
function setupLabelPicker() {
  const toggleBtn  = document.getElementById('toggle-label-picker');
  const pickerEl   = document.getElementById('label-picker');

  renderLabelPicker(pickerEl);

  toggleBtn.addEventListener('click', () => {
    const isOpen = pickerEl.style.display !== 'none';
    pickerEl.style.display = isOpen ? 'none' : 'flex';
    toggleBtn.innerHTML = isOpen
      ? '<i class="bi bi-tag me-1"></i>ラベルを編集'
      : '<i class="bi bi-check2 me-1"></i>完了';
  });
}

function renderLabelPicker(pickerEl) {
  if (allLabels.length === 0) {
    pickerEl.innerHTML = '<span style="font-size:12px;color:var(--text-muted)">ラベルが未登録です（管理画面から追加できます）</span>';
    return;
  }

  pickerEl.innerHTML = allLabels.map(l => {
    const selected = issueLabels.some(il => il.id === l.id);
    const bg       = hexToRgba(l.color, 0.14);
    const bdr      = hexToRgba(l.color, 0.35);
    return `
      <span class="label-picker-item ${selected ? 'selected' : ''}"
            data-label-id="${l.id}"
            style="background:${bg};color:${l.color};border-color:${selected ? l.color : 'transparent'}">
        ${selected ? '<i class="bi bi-check2"></i>' : ''} ${escapeHtml(l.name)}
      </span>
    `;
  }).join('');

  pickerEl.querySelectorAll('.label-picker-item').forEach(item => {
    item.addEventListener('click', async () => {
      const labelId  = item.dataset.labelId;
      const selected = item.classList.contains('selected');

      if (selected) {
        await supabaseClient.from('issue_labels').delete()
          .eq('issue_id', issueId).eq('label_id', labelId);
        issueLabels = issueLabels.filter(l => l.id !== labelId);
      } else {
        await supabaseClient.from('issue_labels').insert({ issue_id: issueId, label_id: labelId });
        const label = allLabels.find(l => l.id === labelId);
        if (label) issueLabels = [...issueLabels, label];
      }

      renderLabelDisplay();
      renderLabelPicker(pickerEl);
    });
  });
}

// 課題コピー
function setupCopyIssue() {
  document.getElementById('copy-issue-btn').addEventListener('click', async () => {
    if (!issue) return;
    if (!confirm(`「${issue.title}」をコピーして新しい課題を作成しますか？`)) return;

    const { data, error } = await supabaseClient.from('issues').insert({
      project_id:  issue.project?.id,
      reporter_id: currentProfile?.id,
      title:       `${issue.title}（コピー）`,
      description: issue.description || null,
      status:      window.statusList[0]?.name || 'open',
      priority:    issue.priority,
      assignee_id: issue.assignee_id || null,
    }).select().single();

    if (!error && data) {
      window.location.href = `/issue.html?id=${data.id}`;
    } else {
      showError('コピーに失敗しました');
    }
  });
}

// ===== 親課題 =====

function renderParentIssue(parent) {
  const el = document.getElementById('parent-display');
  if (!el) return;
  if (parent) {
    el.innerHTML = `
      <div class="d-flex align-items-center gap-1 flex-wrap">
        <a href="/issue.html?id=${parent.id}" class="subtask-link" style="font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(parent.title)}">${escapeHtml(parent.title)}</a>
        <button class="btn btn-link btn-sm p-0" id="change-parent-btn" style="font-size:11px;color:var(--text-muted);white-space:nowrap">変更</button>
        <button class="btn btn-link btn-sm p-0" id="remove-parent-btn" style="font-size:11px;color:#DC3545;white-space:nowrap">解除</button>
      </div>
    `;
    document.getElementById('change-parent-btn').addEventListener('click', openParentSearch);
    document.getElementById('remove-parent-btn').addEventListener('click', async () => {
      await supabaseClient.from('issues').update({ parent_id: null }).eq('id', issueId);
      issue.parent_id = null;
      renderParentIssue(null);
    });
  } else {
    el.innerHTML = `<button class="btn btn-link btn-sm p-0" id="set-parent-btn" style="font-size:12px"><i class="bi bi-plus-circle me-1"></i>親課題を設定</button>`;
    document.getElementById('set-parent-btn').addEventListener('click', openParentSearch);
  }
}

function setupParentSearch() {
  const input      = document.getElementById('parent-search-input');
  const resultsEl  = document.getElementById('parent-search-results');
  const cancelBtn  = document.getElementById('cancel-parent-btn');
  let projectIssues = [];

  cancelBtn.addEventListener('click', closeParentSearch);

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const filtered = (input._issues || []).filter(i =>
      i.title.toLowerCase().includes(q)
    ).slice(0, 8);

    if (filtered.length === 0) {
      resultsEl.innerHTML = '<div class="parent-search-item" style="color:var(--text-muted)">該当なし</div>';
    } else {
      resultsEl.innerHTML = filtered.map(i => `
        <div class="parent-search-item" data-id="${i.id}" data-title="${escapeHtml(i.title)}">
          ${escapeHtml(i.title)}
        </div>
      `).join('');
      resultsEl.querySelectorAll('.parent-search-item[data-id]').forEach(item => {
        item.addEventListener('click', async () => {
          await supabaseClient.from('issues').update({ parent_id: item.dataset.id }).eq('id', issueId);
          closeParentSearch();
          renderParentIssue({ id: item.dataset.id, title: item.dataset.title });
        });
      });
    }
    resultsEl.style.display = 'block';
  });
}

async function openParentSearch() {
  const searchEl = document.getElementById('parent-search');
  const input    = document.getElementById('parent-search-input');
  searchEl.style.display = 'block';
  input.value = '';
  document.getElementById('parent-search-results').style.display = 'none';
  input.focus();

  const { data } = await supabaseClient
    .from('issues').select('id,title')
    .eq('project_id', issue.project?.id)
    .neq('id', issueId)
    .order('created_at', { ascending: false });

  input._issues = data || [];
  input.dispatchEvent(new Event('input'));
}

function closeParentSearch() {
  document.getElementById('parent-search').style.display = 'none';
  document.getElementById('parent-search-results').style.display = 'none';
}

// ===== サブタスク =====

async function loadSubIssues() {
  const { data } = await supabaseClient
    .from('issues').select('id,title,status')
    .eq('parent_id', issueId)
    .order('created_at', { ascending: true });

  const el = document.getElementById('subtasks-list');
  if (!data || data.length === 0) {
    el.innerHTML = '<p class="text-center text-muted py-2 mb-0" style="font-size:13.5px">サブタスクなし</p>';
    return;
  }
  el.innerHTML = data.map(i => `
    <div class="subtask-item">
      <a href="/issue.html?id=${i.id}" class="subtask-link">${escapeHtml(i.title)}</a>
      ${statusBadge(i.status)}
    </div>
  `).join('');
}

function setupCreateSubIssue() {
  const form     = document.getElementById('subtask-form');
  const titleEl  = document.getElementById('subtask-title-input');

  document.getElementById('add-subtask-btn').addEventListener('click', () => {
    form.style.display = 'block';
    titleEl.focus();
  });

  document.getElementById('cancel-subtask-btn').addEventListener('click', () => {
    form.style.display = 'none';
    titleEl.value = '';
  });

  document.getElementById('save-subtask-btn').addEventListener('click', async () => {
    const title = titleEl.value.trim();
    if (!title) return;
    const btn = document.getElementById('save-subtask-btn');
    btn.disabled = true;

    const { error } = await supabaseClient.from('issues').insert({
      project_id:  issue.project?.id,
      reporter_id: currentProfile?.id,
      title,
      status:      window.statusList[0]?.name || 'open',
      priority:    'medium',
      parent_id:   issueId,
    });

    btn.disabled = false;
    if (!error) {
      form.style.display = 'none';
      titleEl.value = '';
      await loadSubIssues();
    }
  });

  // Enter キーで追加
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('save-subtask-btn').click();
    if (e.key === 'Escape') document.getElementById('cancel-subtask-btn').click();
  });
}

function getFileUrl(filePath) {
  const { data } = supabaseClient.storage.from('attachments').getPublicUrl(filePath);
  return data.publicUrl;
}

function fileIcon(mimeType) {
  if (!mimeType)                                                       return 'bi-file-earmark';
  if (mimeType.startsWith('image/'))                                   return 'bi-file-image';
  if (mimeType === 'application/pdf')                                  return 'bi-file-pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'bi-file-excel';
  if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) return 'bi-file-word';
  if (mimeType.includes('zip') || mimeType.includes('compressed'))    return 'bi-file-zip';
  if (mimeType.startsWith('video/'))                                   return 'bi-file-play';
  return 'bi-file-earmark';
}

init();
