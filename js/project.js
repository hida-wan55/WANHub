let projectId = null;
let currentProfile = null;
let allIssues = [];

async function init() {
  const session = await requireAuth();
  if (!session) return;

  projectId = getParam('id');
  if (!projectId) { window.location.href = '/dashboard.html'; return; }

  currentProfile = await getCurrentProfile();
  if (currentProfile) {
    document.getElementById('user-name-sidebar').textContent = currentProfile.name;
    document.getElementById('user-avatar-sidebar').textContent = currentProfile.name.charAt(0).toUpperCase();
  }

  await Promise.all([
    loadProject(),
    loadSidebarProjects(),
    loadProfilesForFilter(),
  ]);

  await loadIssues();
  setupFilters();
  setupCreateIssue();
}

async function loadProject() {
  const { data, error } = await supabaseClient
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single();

  if (error || !data) { window.location.href = '/dashboard.html'; return; }

  document.title = `${data.name} - WANHub`;
  document.getElementById('project-name').textContent = data.name;
  document.getElementById('project-desc').textContent = data.description || '';
  document.getElementById('breadcrumb-project').textContent = data.name;
  document.getElementById('edit-project-name').value = data.name;
  document.getElementById('edit-project-desc').value = data.description || '';

  document.getElementById('update-project-btn').addEventListener('click', async () => {
    const name = document.getElementById('edit-project-name').value.trim();
    if (!name) return;
    const { error } = await supabaseClient
      .from('projects')
      .update({ name, description: document.getElementById('edit-project-desc').value.trim() })
      .eq('id', projectId);
    if (!error) {
      document.getElementById('project-name').textContent = name;
      document.getElementById('project-desc').textContent = document.getElementById('edit-project-desc').value.trim();
      document.getElementById('breadcrumb-project').textContent = name;
      document.title = `${name} - WANHub`;
      bootstrap.Modal.getInstance(document.getElementById('editProjectModal')).hide();
    }
  });
}

async function loadSidebarProjects() {
  const { data } = await supabaseClient
    .from('projects')
    .select('id, name')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  const el = document.getElementById('sidebar-projects');
  if (!data || data.length === 0) { el.innerHTML = ''; return; }

  el.innerHTML = data.map(p => `
    <a href="/project.html?id=${p.id}" class="sidebar-link ${p.id === projectId ? 'active' : ''}">
      <i class="bi bi-folder2"></i>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
    </a>
  `).join('');
}

async function loadProfilesForFilter() {
  const { data } = await supabaseClient.from('profiles').select('*').order('name');
  const profiles = data || [];

  const filterAssignee = document.getElementById('filter-assignee');
  const issueAssignee  = document.getElementById('issue-assignee');

  profiles.forEach(p => {
    [filterAssignee, issueAssignee].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
  });
}

async function loadIssues() {
  const { data, error } = await supabaseClient
    .from('issues')
    .select('*, assignee:profiles!assignee_id(name)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) { showError('課題の読み込みに失敗しました'); return; }

  allIssues = data || [];
  renderIssues(allIssues);
}

function renderIssues(issues) {
  const tbody = document.getElementById('issues-tbody');
  document.getElementById('issue-count').textContent = `${issues.length}件の課題を表示中`;

  if (issues.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="6">
        <div class="empty-state">
          <i class="bi bi-clipboard2-x"></i>
          <p>課題がありません。上のボタンから追加してください。</p>
        </div>
      </td></tr>
    `;
    return;
  }

  tbody.innerHTML = issues.map(issue => `
    <tr>
      <td>
        <a href="/issue.html?id=${issue.id}" class="issue-title-link">
          ${escapeHtml(issue.title)}
        </a>
      </td>
      <td>${statusBadge(issue.status)}</td>
      <td>${priorityBadge(issue.priority)}</td>
      <td>${escapeHtml(issue.assignee?.name || '-')}</td>
      <td>${formatDate(issue.due_date)}</td>
      <td>${formatDate(issue.created_at)}</td>
    </tr>
  `).join('');
}

function setupFilters() {
  const search         = document.getElementById('search-input');
  const statusFilter   = document.getElementById('filter-status');
  const priorityFilter = document.getElementById('filter-priority');
  const assigneeFilter = document.getElementById('filter-assignee');
  const clearBtn       = document.getElementById('clear-filters');

  function applyFilters() {
    let filtered = [...allIssues];
    const q = search.value.toLowerCase();
    if (q)                    filtered = filtered.filter(i => i.title.toLowerCase().includes(q));
    if (statusFilter.value)   filtered = filtered.filter(i => i.status === statusFilter.value);
    if (priorityFilter.value) filtered = filtered.filter(i => i.priority === priorityFilter.value);
    if (assigneeFilter.value) filtered = filtered.filter(i => i.assignee_id === assigneeFilter.value);
    renderIssues(filtered);
  }

  [search, statusFilter, priorityFilter, assigneeFilter].forEach(el => el.addEventListener('change', applyFilters));
  search.addEventListener('input', applyFilters);

  clearBtn.addEventListener('click', () => {
    search.value = '';
    statusFilter.value = '';
    priorityFilter.value = '';
    assigneeFilter.value = '';
    renderIssues(allIssues);
  });
}

function setupCreateIssue() {
  document.getElementById('create-issue-btn').addEventListener('click', async () => {
    const title = document.getElementById('issue-title').value.trim();
    if (!title) {
      document.getElementById('modal-error').innerHTML = '<div class="alert alert-danger">タイトルを入力してください</div>';
      document.getElementById('modal-error').style.display = 'block';
      return;
    }

    const btn = document.getElementById('create-issue-btn');
    btn.disabled = true;
    btn.textContent = '追加中...';

    const assigneeVal   = document.getElementById('issue-assignee').value;
    const dueDateVal    = document.getElementById('issue-due-date').value;
    const startDateVal  = document.getElementById('issue-start-date').value;

    const { data, error } = await supabaseClient
      .from('issues')
      .insert({
        project_id:  projectId,
        title,
        description: document.getElementById('issue-desc').value.trim(),
        status:      document.getElementById('issue-status').value,
        priority:    document.getElementById('issue-priority').value,
        assignee_id: assigneeVal   || null,
        reporter_id: currentProfile?.id,
        due_date:    dueDateVal    || null,
        start_date:  startDateVal  || null,
      })
      .select('*, assignee:profiles!assignee_id(name)')
      .single();

    btn.disabled = false;
    btn.textContent = '追加';

    if (error) {
      document.getElementById('modal-error').innerHTML = '<div class="alert alert-danger">追加に失敗しました</div>';
      document.getElementById('modal-error').style.display = 'block';
      return;
    }

    bootstrap.Modal.getInstance(document.getElementById('createIssueModal')).hide();

    // フォームリセット
    ['issue-title', 'issue-desc', 'issue-due-date', 'issue-start-date'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('issue-status').value   = 'open';
    document.getElementById('issue-priority').value = 'medium';
    document.getElementById('issue-assignee').value = '';
    document.getElementById('modal-error').style.display = 'none';

    allIssues.unshift(data);
    renderIssues(allIssues);
  });
}

init();
