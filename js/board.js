let projectId      = null;
let currentProfile = null;
let allIssues      = [];
let draggingId     = null;

const today = new Date().toISOString().split('T')[0];

async function init() {
  const session = await requireAuth();
  if (!session) return;

  projectId = getParam('id');
  if (!projectId) { window.location.href = '/dashboard.html'; return; }

  currentProfile = await getCurrentProfile();
  applyGuestMode(currentProfile);
  if (currentProfile) {
    applyTheme(currentProfile.theme_color);
    document.getElementById('user-name-sidebar').textContent = currentProfile.name;
    updateSidebarAvatar(currentProfile);
    setupProfileModal(currentProfile);
    injectNotificationBell();
    setupNotificationBell(currentProfile.id);
    injectGlobalSearch();
  }

  await loadStatuses();
  await Promise.all([loadProject(), loadProfiles(), loadSidebarProjects()]);
  await loadIssues();
  setupFilters();
}

async function loadProject() {
  const { data } = await supabaseClient.from('projects').select('id,name').eq('id', projectId).single();
  if (!data) { window.location.href = '/dashboard.html'; return; }

  document.title = `ボード - ${data.name} - WANHub`;
  document.getElementById('breadcrumb-project').textContent = data.name;
  document.getElementById('breadcrumb-project').href = `/project.html?id=${projectId}`;
  document.getElementById('back-btn').href              = `/project.html?id=${projectId}`;
  document.getElementById('tab-list').href              = `/project.html?id=${projectId}`;
  document.getElementById('tab-board').href = `/board.html?id=${projectId}`;
  document.getElementById('tab-wiki').href  = `/wiki.html?id=${projectId}`;
  document.getElementById('tab-gantt').href = `/gantt.html?id=${projectId}`;
}

async function loadProfiles() {
  const { data } = await supabaseClient.from('profiles').select('*').order('name');
  const filterSel = document.getElementById('filter-assignee');
  (data || []).forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id; opt.textContent = p.name;
    filterSel.appendChild(opt);
  });
}

async function loadSidebarProjects() {
  const { data } = await supabaseClient
    .from('projects').select('id,name').eq('status', 'active').order('created_at', { ascending: false });
  const el = document.getElementById('sidebar-projects');
  if (!data) return;
  el.innerHTML = data.map(p => `
    <a href="/project.html?id=${p.id}" class="sidebar-link ${p.id === projectId ? 'active' : ''}">
      <i class="bi bi-folder2"></i>
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
    </a>
  `).join('');
}

async function loadIssues() {
  const { data, error } = await supabaseClient
    .from('issues')
    .select('*, assignee:profiles!assignee_id(id,name,avatar_url), mentor:profiles!mentor_id(id,name,avatar_url)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) { showError('課題の読み込みに失敗しました'); return; }
  allIssues = data || [];
  renderBoard(applyFilters());
}

function renderBoard(issues) {
  const container = document.getElementById('board-container');
  document.getElementById('board-issue-count').textContent = `${issues.length} 件`;

  container.innerHTML = window.statusList.map(status => {
    const statusIssues = issues.filter(i => i.status === status.name);
    return `
      <div class="board-column">
        <div class="board-column-header">
          <span class="board-status-dot" style="background:${status.color}"></span>
          <span>${escapeHtml(status.label)}</span>
          <span class="board-column-count">${statusIssues.length}</span>
        </div>
        <div class="board-column-body" data-status="${escapeHtml(status.name)}">
          ${statusIssues.map(i => cardHtml(i)).join('')}
        </div>
      </div>
    `;
  }).join('');

  if (currentProfile?.role !== 'guest') setupDragDrop();
}

function cardHtml(issue) {
  const overdue = issue.due_date && issue.due_date < today && !['closed', 'resolved'].includes(issue.status);
  return `
    <div class="board-card" draggable="true" data-issue-id="${issue.id}">
      <div class="board-card-title">
        <a href="/issue.html?id=${issue.id}">${escapeHtml(issue.title)}</a>
        ${overdue ? '<span class="overdue-badge ms-1">期限切れ</span>' : ''}
      </div>
      <div class="board-card-meta">
        ${priorityBadge(issue.priority)}
        <div class="d-flex align-items-center gap-1 ms-auto">
          ${issue.assignee ? avatarHtml(issue.assignee, 22, 10) : ''}
          ${issue.due_date ? `<span class="board-card-due ${overdue ? 'overdue' : ''}"><i class="bi bi-calendar3"></i> ${formatDate(issue.due_date)}</span>` : ''}
        </div>
      </div>
    </div>
  `;
}

function setupDragDrop() {
  document.querySelectorAll('.board-card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggingId = card.dataset.issueId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
    });
  });

  document.querySelectorAll('.board-column-body').forEach(col => {
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      col.classList.add('drag-over');
    });
    col.addEventListener('dragleave', (e) => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over');
    });
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drag-over');
      const newStatus = col.dataset.status;
      if (!draggingId || !newStatus) return;

      const issue = allIssues.find(i => i.id === draggingId);
      if (!issue || issue.status === newStatus) return;

      issue.status = newStatus;
      renderBoard(applyFilters());

      await supabaseClient.from('issues').update({ status: newStatus }).eq('id', draggingId);
      draggingId = null;
    });
  });
}

function setupFilters() {
  ['filter-assignee', 'filter-priority'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => renderBoard(applyFilters()));
  });
  document.getElementById('clear-filters').addEventListener('click', () => {
    document.getElementById('filter-assignee').value = '';
    document.getElementById('filter-priority').value = '';
    renderBoard(applyFilters());
  });
}

function applyFilters() {
  const assignee = document.getElementById('filter-assignee').value;
  const priority = document.getElementById('filter-priority').value;
  return allIssues.filter(i => {
    if (assignee && i.assignee_id !== assignee) return false;
    if (priority && i.priority    !== priority)  return false;
    return true;
  });
}

init();
