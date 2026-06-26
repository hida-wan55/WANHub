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
  ]);

  setupTitleEdit();
  setupDescEdit();
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
  document.title = `${data.title} - WorkBoard`;

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
      document.title = `${title} - WorkBoard`;
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
