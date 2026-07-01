let currentProfile  = null;
let myProjectIds    = null;   // null=管理者(全PJ), 配列=非管理者の参加PJ
let myAssignedIssues = [];
let myReportedIssues = [];
let allActivityItems = [];    // フィード用（コメント＋ファイル統合済み）

let activeTab = 'assigned';   // 'assigned' | 'reported'
let activeDue = 'all';        // 'all' | '4days' | 'today' | 'overdue'

const today = new Date().toISOString().split('T')[0];

function isCurrentUserAdmin() {
  return currentProfile?.is_admin || ['owner', 'admin'].includes(currentProfile?.role);
}

async function init() {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();
  applyGuestMode(currentProfile);
  if (currentProfile) {
    applyTheme(currentProfile.theme_color);
    document.getElementById('user-name-sidebar').textContent = currentProfile.name;
    updateSidebarAvatar(currentProfile);
    setupProfileModal(currentProfile);

    if (isCurrentUserAdmin()) {
      document.getElementById('admin-btn').style.display = 'inline-block';
      if (currentProfile.role !== 'guest') {
        document.getElementById('new-project-btn').style.display = 'inline-flex';
      }
      myProjectIds = null;
    } else {
      const { data: memberOf } = await supabaseClient
        .from('project_members').select('project_id').eq('user_id', currentProfile.id);
      myProjectIds = (memberOf || []).map(m => m.project_id);
    }

    injectNotificationBell();
    setupNotificationBell(currentProfile.id);
    injectGlobalSearch();
  }

  await loadStatuses();
  await Promise.all([loadProjects(), loadMyIssues(), loadActivityFeed()]);
  setupCreateProject();
  setupMyIssueFilters();
  setupActivityFilter();
}

// ===== プロジェクト一覧（リスト形式） =====

async function loadProjects() {
  const { data: allProjects, error } = await supabaseClient
    .from('projects')
    .select('id,name,code,description')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) { showError('プロジェクトの読み込みに失敗しました'); return; }

  let projects = allProjects || [];

  if (myProjectIds !== null) {
    const { data: allMembers } = await supabaseClient
      .from('project_members').select('project_id, user_id');
    const projectsWithMembers = new Set((allMembers || []).map(m => m.project_id));
    const myMemberSet         = new Set(myProjectIds);
    projects = projects.filter(p => !projectsWithMembers.has(p.id) || myMemberSet.has(p.id));
  }

  // サイドバー更新
  const sidebarEl = document.getElementById('sidebar-projects');
  sidebarEl.innerHTML = projects.length === 0
    ? '<div class="px-3 py-2" style="font-size:12px;color:rgba(201,214,227,0.4)">プロジェクトなし</div>'
    : projects.map(p => `
        <a href="/project.html?id=${p.id}" class="sidebar-link">
          <i class="bi bi-folder2"></i>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
        </a>
      `).join('');

  // プロジェクトリスト（Backlog風）
  const listEl = document.getElementById('projects-list');
  if (projects.length === 0) {
    listEl.innerHTML = '<div class="my-issue-empty">プロジェクトがありません</div>';
    return;
  }

  listEl.innerHTML = projects.map(p => {
    const initials = (p.code || p.name).slice(0, 4).toUpperCase();
    return `
      <a href="/project.html?id=${p.id}" class="dash-project-row">
        <div class="dash-project-icon">${escapeHtml(initials)}</div>
        <div style="min-width:0">
          <div class="dash-project-name">${escapeHtml(p.name)}</div>
          ${p.code ? `<div class="dash-project-code">${escapeHtml(p.code)}</div>` : ''}
        </div>
        <i class="bi bi-chevron-right ms-auto" style="color:var(--text-muted);font-size:12px;flex-shrink:0"></i>
      </a>
    `;
  }).join('');
}

// ===== 自分の課題 =====

async function loadMyIssues() {
  if (!currentProfile) return;

  const base = supabaseClient
    .from('issues')
    .select('id,title,status,priority,due_date,issue_number,parent_id, project:projects(id,name,code)')
    .neq('status', 'closed');

  const [{ data: assigned }, { data: reported }] = await Promise.all([
    base.eq('assignee_id', currentProfile.id).order('due_date', { ascending: true, nullsFirst: false }),
    supabaseClient
      .from('issues')
      .select('id,title,status,priority,due_date,issue_number,parent_id, project:projects(id,name,code)')
      .eq('reporter_id', currentProfile.id)
      .neq('status', 'closed')
      .order('due_date', { ascending: true, nullsFirst: false }),
  ]);

  myAssignedIssues = assigned || [];
  myReportedIssues = reported || [];

  document.getElementById('assigned-count').textContent = myAssignedIssues.length;
  document.getElementById('reported-count').textContent = myReportedIssues.length;

  updateDueCounts();
  renderMyIssues();
}

function updateDueCounts() {
  const issues = activeTab === 'assigned' ? myAssignedIssues : myReportedIssues;
  const in4days = new Date(); in4days.setDate(in4days.getDate() + 4);
  const in4daysStr = in4days.toISOString().split('T')[0];

  document.getElementById('due-4days-count').textContent  = issues.filter(i => i.due_date && i.due_date <= in4daysStr && i.due_date >= today).length;
  document.getElementById('due-today-count').textContent  = issues.filter(i => i.due_date && i.due_date <= today).length;
  document.getElementById('due-overdue-count').textContent = issues.filter(i => i.due_date && i.due_date < today).length;
}

function filterByDue(issues) {
  if (activeDue === 'all') return issues;
  const in4days = new Date(); in4days.setDate(in4days.getDate() + 4);
  const in4daysStr = in4days.toISOString().split('T')[0];
  if (activeDue === '4days')  return issues.filter(i => i.due_date && i.due_date <= in4daysStr && i.due_date >= today);
  if (activeDue === 'today')  return issues.filter(i => i.due_date && i.due_date <= today);
  if (activeDue === 'overdue') return issues.filter(i => i.due_date && i.due_date < today);
  return issues;
}

function issueKey(issue) {
  if (!issue.project?.code) return issue.issue_number ? `#${String(issue.issue_number).padStart(3,'0')}` : '-';
  if (!issue.issue_number) return '-';
  return `${issue.project.code}-${String(issue.issue_number).padStart(3,'0')}`;
}

function renderMyIssues() {
  const base    = activeTab === 'assigned' ? myAssignedIssues : myReportedIssues;
  const issues  = filterByDue(base);
  const el      = document.getElementById('my-issues-table');

  if (issues.length === 0) {
    el.innerHTML = '<div class="my-issue-empty">該当する課題はありません</div>';
    return;
  }

  el.innerHTML = `
    <table class="my-issue-table">
      <thead>
        <tr>
          <th>キー</th>
          <th>件名</th>
          <th>優先度</th>
          <th>状態</th>
          <th>期限日</th>
        </tr>
      </thead>
      <tbody>
        ${issues.map(i => {
          const overdue = i.due_date && i.due_date < today;
          return `
            <tr>
              <td><span class="issue-num">${escapeHtml(issueKey(i))}</span></td>
              <td>
                <a href="/issue.html?id=${i.id}" class="issue-title-link" style="font-size:12.5px">${escapeHtml(i.title)}</a>
                <div style="font-size:10.5px;color:var(--text-muted)">${escapeHtml(i.project?.name || '')}</div>
              </td>
              <td>${priorityBadge(i.priority)}</td>
              <td>${statusBadge(i.status)}</td>
              <td style="font-size:12px;color:${overdue ? '#DC3545' : 'var(--text-muted)'}">
                ${i.due_date ? formatDate(i.due_date) : '-'}
                ${overdue ? '<span class="overdue-badge">期限切れ</span>' : ''}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function setupMyIssueFilters() {
  document.getElementById('tab-assigned').addEventListener('click', () => {
    activeTab = 'assigned';
    document.getElementById('tab-assigned').classList.add('active');
    document.getElementById('tab-reported').classList.remove('active');
    updateDueCounts();
    renderMyIssues();
  });
  document.getElementById('tab-reported').addEventListener('click', () => {
    activeTab = 'reported';
    document.getElementById('tab-reported').classList.add('active');
    document.getElementById('tab-assigned').classList.remove('active');
    updateDueCounts();
    renderMyIssues();
  });

  document.querySelectorAll('.dash-due-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeDue = btn.dataset.due;
      document.querySelectorAll('.dash-due-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMyIssues();
    });
  });
}

// ===== アクティビティフィード =====

async function loadActivityFeed() {
  const [{ data: comments }, { data: files }] = await Promise.all([
    supabaseClient
      .from('comments')
      .select('id,content,is_activity,created_at, user:profiles!user_id(id,name,avatar_url), issue:issues!issue_id(id,title,issue_number,project:projects(id,name,code))')
      .order('created_at', { ascending: false })
      .limit(60),
    supabaseClient
      .from('attachments')
      .select('id,file_name,created_at, user:profiles(id,name,avatar_url), issue:issues(id,title,issue_number,project:projects(id,name,code))')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  const commentItems = (comments || []).map(c => ({
    type:       c.is_activity ? 'update' : 'comment',
    created_at: c.created_at,
    user:       c.user,
    issue:      c.issue,
    content:    c.content,
  }));

  const fileItems = (files || []).map(f => ({
    type:       'file',
    created_at: f.created_at,
    user:       f.user,
    issue:      f.issue,
    content:    f.file_name,
  }));

  allActivityItems = [...commentItems, ...fileItems]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  renderActivityFeed(allActivityItems);
}

function renderActivityFeed(items) {
  const el = document.getElementById('activity-feed');

  if (items.length === 0) {
    el.innerHTML = '<div class="my-issue-empty">更新履歴がありません</div>';
    return;
  }

  // 日付でグループ化
  const groups = {};
  items.forEach(item => {
    const d = item.created_at.slice(0, 10);
    if (!groups[d]) groups[d] = [];
    groups[d].push(item);
  });

  el.innerHTML = Object.entries(groups).map(([date, groupItems]) => {
    const label = formatDateGroupLabel(date);
    return `
      <div class="feed-date-label">${label}</div>
      ${groupItems.map(item => renderFeedItem(item)).join('')}
    `;
  }).join('');
}

function renderFeedItem(item) {
  const badgeClass = item.type;
  const badgeLabel = item.type === 'comment' ? 'コメント' : item.type === 'update' ? '更新' : 'ファイル';
  const userName   = escapeHtml(item.user?.name || '-');
  const issueTitle = escapeHtml(item.issue?.title || '-');
  const issueKey2  = item.issue ? issueKey(item.issue) : '';
  const issueId    = item.issue?.id;
  const projName   = escapeHtml(item.issue?.project?.name || '');
  const timeLabel  = timeAgo(item.created_at);

  let contentHtml = '';
  if (item.type === 'comment' && item.content) {
    contentHtml = `<div class="feed-content">${escapeHtml(item.content.slice(0, 120))}</div>`;
  } else if (item.type === 'file') {
    contentHtml = `<div class="feed-content"><i class="bi bi-paperclip me-1"></i>${escapeHtml(item.content)}</div>`;
  }

  return `
    <div class="feed-item">
      <div style="flex-shrink:0">${avatarHtml(item.user, 34, 13)}</div>
      <div style="flex:1;min-width:0">
        <div class="feed-meta">
          <span style="font-weight:600">${userName}</span>
          <span style="color:var(--text-muted)">さんが課題に</span>
          <span class="feed-badge ${badgeClass}">${badgeLabel}</span>
          <span class="feed-time">${timeLabel}</span>
        </div>
        ${issueId ? `<a href="/issue.html?id=${issueId}" class="feed-issue-link">${issueKey2 ? `<span class="issue-num me-1">${escapeHtml(issueKey2)}</span>` : ''}${issueTitle}</a>` : `<div class="feed-issue-link" style="color:var(--text-muted)">${issueTitle}</div>`}
        ${projName ? `<div class="feed-project-name"><i class="bi bi-folder2 me-1"></i>${projName}</div>` : ''}
        ${contentHtml}
      </div>
    </div>
  `;
}

function formatDateGroupLabel(dateStr) {
  const d    = new Date(dateStr);
  const days = ['日','月','火','水','木','金','土'];
  const y    = d.getFullYear();
  const m    = d.getMonth() + 1;
  const day  = d.getDate();
  const dow  = days[d.getDay()];
  const todayD = new Date(today);
  const diff   = Math.floor((todayD - d) / 86400000);
  const prefix = diff === 0 ? '今日・' : diff === 1 ? '昨日・' : '';
  return `${prefix}${y}年${m}月${day}日（${dow}）`;
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m    = Math.floor(diff / 60000);
  if (m < 1)   return 'たった今';
  if (m < 60)  return `${m}分前`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `約${h}時間前`;
  const d = Math.floor(h / 24);
  return `${d}日前`;
}

function setupActivityFilter() {
  document.getElementById('activity-filter').addEventListener('change', (e) => {
    const val = e.target.value;
    const filtered = val === 'all'
      ? allActivityItems
      : allActivityItems.filter(i => i.type === val);
    renderActivityFeed(filtered);
  });
}

// ===== プロジェクト作成 =====

function setupCreateProject() {
  document.getElementById('create-project-btn').addEventListener('click', async () => {
    const name  = document.getElementById('project-name').value.trim();
    const code  = document.getElementById('project-code').value.trim().toUpperCase();
    const errEl = document.getElementById('modal-error');

    if (!code) {
      errEl.innerHTML = '<div class="alert alert-danger">PJコードを入力してください</div>';
      errEl.style.display = 'block'; return;
    }
    if (!name) {
      errEl.innerHTML = '<div class="alert alert-danger">プロジェクト名を入力してください</div>';
      errEl.style.display = 'block'; return;
    }

    const btn = document.getElementById('create-project-btn');
    btn.disabled = true; btn.textContent = '作成中...';

    // 同名・同コードのPJが既に存在しないか確認（アーカイブ済みを除く）
    const { data: dupCheck } = await supabaseClient
      .from('projects').select('id,name,code')
      .or(`name.ilike.${name},code.ilike.${code}`)
      .neq('status', 'archived');
    if (dupCheck && dupCheck.length > 0) {
      const nameConflict = dupCheck.some(p => p.name?.toLowerCase() === name.toLowerCase());
      const codeConflict = dupCheck.some(p => p.code?.toLowerCase() === code.toLowerCase());
      const msg = nameConflict && codeConflict
        ? '同じ名前・PJコードのプロジェクトが既に存在します'
        : nameConflict ? '同じ名前のプロジェクトが既に存在します'
        : 'このPJコードは既に使用されています';
      errEl.innerHTML = `<div class="alert alert-danger">${msg}</div>`;
      errEl.style.display = 'block';
      btn.disabled = false; btn.textContent = '作成';
      return;
    }

    const { data, error } = await supabaseClient.from('projects')
      .insert({ name, code, description: document.getElementById('project-desc').value.trim() || null, created_by: currentProfile?.id })
      .select().single();

    btn.disabled = false; btn.textContent = '作成';

    if (error) {
      const isDup = error.code === '23505' || error.message?.includes('duplicate');
      errEl.innerHTML = `<div class="alert alert-danger">${isDup ? 'PJコードが既に使用されています' : '作成に失敗しました'}</div>`;
      errEl.style.display = 'block'; return;
    }

    if (currentProfile?.id) {
      await supabaseClient.from('project_members').insert({ project_id: data.id, user_id: currentProfile.id });
    }

    bootstrap.Modal.getInstance(document.getElementById('createProjectModal')).hide();
    document.getElementById('project-name').value = '';
    document.getElementById('project-code').value = '';
    document.getElementById('project-desc').value = '';
    errEl.style.display = 'none';
    window.location.href = `/project.html?id=${data.id}`;
  });

  document.getElementById('createProjectModal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('project-name').value = '';
    document.getElementById('project-code').value = '';
    document.getElementById('project-desc').value = '';
    document.getElementById('modal-error').style.display = 'none';
  });
}

init();
