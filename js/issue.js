let issueId = null;
let currentProfile = null;
let issue = null;

async function init() {
  const session = await requireAuth();
  if (!session) return;

  issueId = getParam('id');
  if (!issueId) { window.location.href = '/dashboard.html'; return; }

  currentProfile = await getCurrentProfile();
  if (currentProfile) {
    document.getElementById('user-name-sidebar').textContent = currentProfile.name;
    document.getElementById('user-avatar-sidebar').textContent = currentProfile.name.charAt(0).toUpperCase();
  }

  await Promise.all([
    loadIssue(),
    loadSidebarProjects(),
    loadComments(),
    loadAttachments(),
  ]);

  setupTitleEdit();
  setupDescEdit();
  setupFileUpload();
  setupMetaSave();
  setupCommentSubmit();
  setupDelete();
}

async function loadIssue() {
  const { data, error } = await supabaseClient
    .from('issues')
    .select(`
      *,
      project:projects(id, name),
      assignee:profiles!assignee_id(id, name),
      reporter:profiles!reporter_id(name)
    `)
    .eq('id', issueId)
    .single();

  if (error || !data) { window.location.href = '/dashboard.html'; return; }

  issue = data;
  document.title = `${data.title} - WANHub`;

  const projLink = document.getElementById('breadcrumb-project');
  projLink.textContent = data.project?.name || '-';
  projLink.href = `/project.html?id=${data.project?.id}`;

  document.getElementById('issue-title-text').textContent = data.title;
  document.getElementById('title-input').value            = data.title;
  document.getElementById('desc-display').textContent     = data.description || '詳細なし';
  document.getElementById('desc-input').value             = data.description || '';

  document.getElementById('meta-status').value     = data.status;
  document.getElementById('meta-priority').value   = data.priority;
  document.getElementById('meta-start-date').value = data.start_date || '';
  document.getElementById('meta-due-date').value   = data.due_date   || '';
  document.getElementById('meta-reporter').textContent = data.reporter?.name || '-';
  document.getElementById('meta-created').textContent  = formatDate(data.created_at);
  document.getElementById('meta-updated').textContent  = formatDate(data.updated_at);

  await loadProfiles(data.assignee_id);
}

async function loadProfiles(currentAssigneeId) {
  const { data } = await supabaseClient.from('profiles').select('*').order('name');
  const profiles = data || [];

  const sel = document.getElementById('meta-assignee');
  profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  });
  sel.value = currentAssigneeId || '';
}

async function loadSidebarProjects() {
  const { data } = await supabaseClient
    .from('projects')
    .select('id, name')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  const el = document.getElementById('sidebar-projects');
  if (!data) return;

  el.innerHTML = data.map(p => `
    <a href="/project.html?id=${p.id}" class="sidebar-link">
      <i class="bi bi-folder2"></i>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
    </a>
  `).join('');
}

async function loadComments() {
  const { data, error } = await supabaseClient
    .from('comments')
    .select('*, user:profiles(name)')
    .eq('issue_id', issueId)
    .order('created_at', { ascending: true });

  const el = document.getElementById('comments-list');
  if (error) { el.innerHTML = '<p class="text-danger" style="font-size:13.5px">コメントの読み込みに失敗しました</p>'; return; }

  if (!data || data.length === 0) {
    el.innerHTML = '<p class="text-center text-muted py-3" style="font-size:13.5px">コメントはまだありません</p>';
    return;
  }

  el.innerHTML = data.map(c => `
    <div class="comment-item">
      <div class="comment-header">
        <div class="user-avatar" style="width:28px;height:28px;font-size:12px">
          ${escapeHtml((c.user?.name || '?').charAt(0).toUpperCase())}
        </div>
        <span class="comment-author">${escapeHtml(c.user?.name || '-')}</span>
        <span class="comment-date">${formatDate(c.created_at)}</span>
      </div>
      <div class="comment-content">${escapeHtml(c.content)}</div>
    </div>
  `).join('');
}

function setupTitleEdit() {
  const titleDisplay = document.getElementById('title-display');
  const titleEdit    = document.getElementById('title-edit');
  const editBtn      = document.getElementById('edit-title-btn');

  editBtn.addEventListener('click', () => {
    titleDisplay.style.display = 'none';
    titleEdit.style.display    = 'block';
    editBtn.style.display      = 'none';
  });

  document.getElementById('cancel-title-btn').addEventListener('click', () => {
    titleDisplay.style.display = 'block';
    titleEdit.style.display    = 'none';
    editBtn.style.display      = 'block';
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
      titleDisplay.style.display = 'block';
      titleEdit.style.display    = 'none';
      editBtn.style.display      = 'block';
    }
  });
}

function setupDescEdit() {
  const descDisplay = document.getElementById('desc-display');
  const descEdit    = document.getElementById('desc-edit');
  const editBtn     = document.getElementById('edit-desc-btn');

  editBtn.addEventListener('click', () => {
    descDisplay.style.display = 'none';
    descEdit.style.display    = 'block';
    editBtn.style.display     = 'none';
  });

  document.getElementById('cancel-desc-btn').addEventListener('click', () => {
    descDisplay.style.display = 'block';
    descEdit.style.display    = 'none';
    editBtn.style.display     = 'block';
  });

  document.getElementById('save-desc-btn').addEventListener('click', async () => {
    const desc = document.getElementById('desc-input').value.trim();
    const { error } = await supabaseClient.from('issues').update({ description: desc }).eq('id', issueId);
    if (!error) {
      descDisplay.textContent   = desc || '詳細なし';
      issue.description         = desc;
      descDisplay.style.display = 'block';
      descEdit.style.display    = 'none';
      editBtn.style.display     = 'block';
    }
  });
}

function setupMetaSave() {
  document.getElementById('save-meta-btn').addEventListener('click', async () => {
    const btn = document.getElementById('save-meta-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>保存中...';

    const { error } = await supabaseClient
      .from('issues')
      .update({
        status:      document.getElementById('meta-status').value,
        priority:    document.getElementById('meta-priority').value,
        assignee_id: document.getElementById('meta-assignee').value    || null,
        start_date:  document.getElementById('meta-start-date').value  || null,
        due_date:    document.getElementById('meta-due-date').value    || null,
      })
      .eq('id', issueId);

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i>変更を保存';

    if (!error) {
      document.getElementById('meta-updated').textContent = formatDate(new Date().toISOString());
      showSuccess('保存しました');
    } else {
      showError('保存に失敗しました');
    }
  });
}

function setupCommentSubmit() {
  document.getElementById('add-comment-btn').addEventListener('click', async () => {
    const content = document.getElementById('comment-input').value.trim();
    if (!content) return;

    const btn = document.getElementById('add-comment-btn');
    btn.disabled = true;

    const { error } = await supabaseClient
      .from('comments')
      .insert({ issue_id: issueId, user_id: currentProfile?.id, content });

    btn.disabled = false;

    if (!error) {
      document.getElementById('comment-input').value = '';
      await loadComments();
    }
  });
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
          <span style="font-size:11px;color:var(--text-muted)">${formatFileSize(a.file_size)} · ${escapeHtml(a.user?.name || '-')} · ${formatDate(a.created_at)}</span>
        </div>
      </div>
      <button class="btn btn-sm btn-outline-danger ms-2 flex-shrink-0" data-attachment-id="${a.id}" data-file-path="${escapeHtml(a.file_path)}">
        <i class="bi bi-trash3"></i>
      </button>
    </div>
  `).join('');

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-attachment-id]');
    if (!btn) return;
    if (!confirm('この添付ファイルを削除しますか？')) return;

    const attachmentId = btn.dataset.attachmentId;
    const filePath     = btn.dataset.filePath;

    await supabaseClient.storage.from('attachments').remove([filePath]);
    await supabaseClient.from('attachments').delete().eq('id', attachmentId);
    document.getElementById(`attachment-${attachmentId}`)?.remove();

    const remaining = el.querySelectorAll('[id^="attachment-"]');
    if (remaining.length === 0) {
      el.innerHTML = '<p class="text-center text-muted py-2" style="font-size:13.5px">添付ファイルなし</p>';
    }
  }, { once: true });
}

function setupFileUpload() {
  document.getElementById('file-input').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    const oversized = files.filter(f => f.size > MAX_SIZE);
    if (oversized.length > 0) {
      showError(`10MB以上のファイルはアップロードできません：${oversized.map(f => f.name).join(', ')}`);
      e.target.value = '';
      return;
    }

    const statusEl     = document.getElementById('upload-status');
    const statusTextEl = document.getElementById('upload-status-text');
    statusEl.style.display = 'block';

    for (const file of files) {
      statusTextEl.textContent = `アップロード中：${file.name}`;
      const filePath = `${issueId}/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabaseClient.storage
        .from('attachments')
        .upload(filePath, file);

      if (uploadError) { showError(`アップロード失敗：${file.name}`); continue; }

      await supabaseClient.from('attachments').insert({
        issue_id:  issueId,
        user_id:   currentProfile?.id,
        file_name: file.name,
        file_path: filePath,
        file_size: file.size,
        file_type: file.type,
      });
    }

    statusEl.style.display = 'none';
    e.target.value = '';
    await loadAttachments();
  });
}

function getFileUrl(filePath) {
  const { data } = supabaseClient.storage.from('attachments').getPublicUrl(filePath);
  return data.publicUrl;
}

function fileIcon(mimeType) {
  if (!mimeType) return 'bi-file-earmark';
  if (mimeType.startsWith('image/'))                      return 'bi-file-image';
  if (mimeType === 'application/pdf')                     return 'bi-file-pdf';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'bi-file-excel';
  if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) return 'bi-file-word';
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return 'bi-file-zip';
  if (mimeType.startsWith('video/'))                      return 'bi-file-play';
  return 'bi-file-earmark';
}

function formatFileSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setupDelete() {
  document.getElementById('delete-issue-btn').addEventListener('click', async () => {
    if (!confirm('この課題を削除しますか？\nこの操作は元に戻せません。')) return;

    const projectId = issue?.project?.id;
    const { error } = await supabaseClient.from('issues').delete().eq('id', issueId);

    if (!error) {
      window.location.href = projectId ? `/project.html?id=${projectId}` : '/dashboard.html';
    } else {
      showError('削除に失敗しました');
    }
  });
}

init();
