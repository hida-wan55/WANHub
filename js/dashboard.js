let currentProfile = null;
let allIssuesFull  = [];
let myProjectIds   = null; // null=管理者(全PJ), 配列=非管理者の参加PJ一覧

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
      document.getElementById('admin-btn').style.display      = 'inline-block';
      // ゲストにはPJ作成ボタンを表示しない
      if (currentProfile.role !== 'guest') {
        document.getElementById('new-project-btn').style.display = 'inline-block';
      }
      myProjectIds = null; // 全PJ表示
    } else {
      // 参加しているPJのIDを取得
      const { data: memberOf } = await supabaseClient
        .from('project_members').select('project_id').eq('user_id', currentProfile.id);
      myProjectIds = (memberOf || []).map(m => m.project_id);
    }

    injectNotificationBell();
    setupNotificationBell(currentProfile.id);
    injectGlobalSearch();
  }

  await loadStatuses();
  await Promise.all([loadProjects(), loadStats()]);
  setupCreateProject();
  setupStatCards();
}

async function loadProjects() {
  // 表示対象プロジェクトを取得
  // 管理者: 全PJ / 非管理者: (メンバー未設定のPJ) + (自分がメンバーのPJ)
  const { data: allProjects, error } = await supabaseClient
    .from('projects')
    .select('id,name,code,description,created_at,status')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) { showError('プロジェクトの読み込みに失敗しました'); return; }

  let projects = allProjects || [];

  if (myProjectIds !== null) {
    // メンバーが設定されているPJを特定し、自分が含まれるものだけ表示
    const { data: allMembers } = await supabaseClient
      .from('project_members').select('project_id, user_id');
    const projectsWithMembers = new Set((allMembers || []).map(m => m.project_id));
    const myMemberSet         = new Set(myProjectIds);
    projects = projects.filter(p =>
      !projectsWithMembers.has(p.id) || myMemberSet.has(p.id)
    );
  }

  document.getElementById('stat-projects').textContent = projects.length;

  const sidebarEl = document.getElementById('sidebar-projects');
  sidebarEl.innerHTML = projects.length === 0
    ? '<div class="px-3 py-2" style="font-size:12px;color:rgba(201,214,227,0.4)">プロジェクトなし</div>'
    : projects.map(p => `
        <a href="/project.html?id=${p.id}" class="sidebar-link">
          <i class="bi bi-folder2"></i>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
        </a>
      `).join('');

  const gridEl = document.getElementById('projects-grid');
  if (projects.length === 0) {
    gridEl.innerHTML = `
      <div class="col-12">
        <div class="empty-state">
          <i class="bi bi-folder-plus"></i>
          <p>${myProjectIds !== null ? '参加しているプロジェクトがありません。' : 'プロジェクトがありません。右上のボタンから作成してください。'}</p>
        </div>
      </div>`;
    return;
  }

  const ids = projects.map(p => p.id);
  const { data: counts } = await supabaseClient.from('issues').select('project_id').in('project_id', ids);
  const countMap = {};
  (counts || []).forEach(i => { countMap[i.project_id] = (countMap[i.project_id] || 0) + 1; });

  gridEl.innerHTML = projects.map(p => `
    <div class="col-12 col-md-6 col-xl-4">
      <a href="/project.html?id=${p.id}" class="project-card">
        <div class="project-card-name">
          <i class="bi bi-folder2 me-2"></i>${escapeHtml(p.name)}
          ${p.code ? `<span class="ms-1" style="font-size:11px;color:var(--text-muted)">[${escapeHtml(p.code)}]</span>` : ''}
        </div>
        <div class="project-card-desc">${escapeHtml(p.description || '説明なし')}</div>
        <div class="project-card-meta">
          <span><i class="bi bi-list-check me-1"></i>${countMap[p.id] || 0}件の課題</span>
          <span><i class="bi bi-calendar3 me-1"></i>${formatDate(p.created_at)}</span>
        </div>
      </a>
    </div>
  `).join('');
}

async function loadStats() {
  let issueQuery = supabaseClient
    .from('issues')
    .select('id, title, status, priority, assignee_id, due_date, updated_at, parent_id, assignee:profiles!assignee_id(name), project:projects(id,name)')
    .order('updated_at', { ascending: false });

  // 非管理者はメンバーPJの課題のみ
  if (myProjectIds !== null) {
    if (myProjectIds.length === 0) {
      allIssuesFull = [];
      ['stat-open','stat-in-progress','stat-my-issues','stat-overdue'].forEach(id => {
        document.getElementById(id).textContent = '0';
      });
      return;
    }
    // メンバー未設定PJも含める
    const { data: allMembers } = await supabaseClient
      .from('project_members').select('project_id, user_id');
    const projectsWithMembers = new Set((allMembers || []).map(m => m.project_id));
    const myMemberSet         = new Set(myProjectIds);
    // ここでは全課題取得後フィルタ（課題数が少ない前提）
    issueQuery = issueQuery.or(
      [...myMemberSet].map(id => `project_id.eq.${id}`).join(',')
    );
  }

  const { data: issues } = await issueQuery;
  if (!issues) return;
  allIssuesFull = issues;

  const overdue = issues.filter(i => i.due_date && i.due_date < today && !['closed', 'resolved'].includes(i.status));

  document.getElementById('stat-open').textContent        = issues.filter(i => i.status === 'open').length;
  document.getElementById('stat-in-progress').textContent = issues.filter(i => i.status === 'in_progress').length;
  document.getElementById('stat-my-issues').textContent   = issues.filter(i => i.assignee_id === currentProfile?.id && i.status !== 'closed').length;
  document.getElementById('stat-overdue').textContent     = overdue.length;
}

function setupStatCards() {
  const labelMap = {
    open:        '未対応の課題',
    in_progress: '処理中の課題',
    mine:        '自分の担当課題',
    overdue:     '期限切れの課題',
  };

  document.querySelectorAll('.stat-card.clickable').forEach(card => {
    card.addEventListener('click', () => {
      const filter = card.dataset.filter;
      const title  = labelMap[filter] || '課題一覧';
      const issues = filterIssues(filter);

      document.getElementById('issue-list-modal-title').textContent = `${title}（${issues.length}件）`;

      if (issues.length === 0) {
        document.getElementById('issue-list-modal-body').innerHTML =
          '<div class="text-center text-muted py-5" style="font-size:13px">該当する課題はありません</div>';
      } else {
        // 全課題マップ（サブタスクの親タイトル参照用）
        const allIssueMap = {};
        allIssuesFull.forEach(i => { allIssueMap[i.id] = i; });

        // 表示順を構築: 親課題 → その直下にサブタスク（インデント）
        const issueIdSet  = new Set(issues.map(i => i.id));
        const subByParent = {};
        issues.filter(i => i.parent_id).forEach(i => {
          if (!subByParent[i.parent_id]) subByParent[i.parent_id] = [];
          subByParent[i.parent_id].push(i);
        });

        const rendered   = new Set();
        const orderedItems = [];

        // まず親課題（parent_idなし）を追加し、その直後にサブタスク
        issues.filter(i => !i.parent_id).forEach(p => {
          orderedItems.push({ issue: p, isSubTask: false });
          rendered.add(p.id);
          (subByParent[p.id] || []).forEach(s => {
            orderedItems.push({ issue: s, isSubTask: true });
            rendered.add(s.id);
          });
        });

        // 親がこのリストにないサブタスク（親が別フィルタ結果にある場合など）
        issues.filter(i => i.parent_id && !rendered.has(i.id)).forEach(i => {
          orderedItems.push({ issue: i, isSubTask: true });
          rendered.add(i.id);
        });

        document.getElementById('issue-list-modal-body').innerHTML =
          `<div class="px-3 py-1">${orderedItems.map(({ issue: i, isSubTask }) => {
            const overdueMark = i.due_date && i.due_date < today && !['closed','resolved'].includes(i.status)
              ? '<span class="overdue-badge">期限切れ</span>' : '';
            const indentStyle = isSubTask ? 'padding-left:20px;' : '';
            const subPrefix   = isSubTask
              ? '<span style="color:var(--text-muted);font-size:11px;margin-right:3px">↳</span>' : '';
            const parentName  = isSubTask && !issueIdSet.has(i.parent_id)
              ? allIssueMap[i.parent_id]?.title : null;
            return `
              <div class="dash-issue-row" style="${indentStyle}">
                <div class="dash-issue-title-wrap">
                  <div>${subPrefix}<a href="/issue.html?id=${i.id}" class="dash-issue-link">${escapeHtml(i.title)}${overdueMark}</a></div>
                  <div class="dash-issue-project">
                    <i class="bi bi-folder2 me-1"></i>${escapeHtml(i.project?.name || '-')}
                    ${parentName ? `<span class="ms-2" style="color:var(--text-muted)">▸ ${escapeHtml(parentName)}</span>` : ''}
                  </div>
                </div>
                ${statusBadge(i.status)}
                <span style="font-size:12px;color:var(--text-muted);white-space:nowrap">${i.assignee?.name ? escapeHtml(i.assignee.name) : '-'}</span>
                <span style="font-size:12px;color:var(--text-muted);white-space:nowrap">${formatDate(i.due_date)}</span>
              </div>
            `;
          }).join('')}</div>`;
      }

      new bootstrap.Modal(document.getElementById('issueListModal')).show();
    });
  });
}

function filterIssues(filter) {
  switch (filter) {
    case 'open':        return allIssuesFull.filter(i => i.status === 'open');
    case 'in_progress': return allIssuesFull.filter(i => i.status === 'in_progress');
    case 'mine':        return allIssuesFull.filter(i => i.assignee_id === currentProfile?.id && i.status !== 'closed');
    case 'overdue':     return allIssuesFull.filter(i => i.due_date && i.due_date < today && !['closed','resolved'].includes(i.status));
    default:            return allIssuesFull;
  }
}

function setupCreateProject() {
  document.getElementById('create-project-btn').addEventListener('click', async () => {
    const name = document.getElementById('project-name').value.trim();
    const code = document.getElementById('project-code').value.trim().toUpperCase();
    const errEl = document.getElementById('modal-error');

    if (!code) {
      errEl.innerHTML = '<div class="alert alert-danger">PJコードを入力してください</div>';
      errEl.style.display = 'block';
      return;
    }
    if (!name) {
      errEl.innerHTML = '<div class="alert alert-danger">プロジェクト名を入力してください</div>';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('create-project-btn');
    btn.disabled = true; btn.textContent = '作成中...';

    const { data, error } = await supabaseClient.from('projects')
      .insert({ name, code, description: document.getElementById('project-desc').value.trim() || null, created_by: currentProfile?.id })
      .select().single();

    btn.disabled = false; btn.textContent = '作成';

    if (error) {
      const isDup = error.code === '23505' || error.message?.includes('duplicate');
      errEl.innerHTML = `<div class="alert alert-danger">${isDup ? 'PJコードが既に使用されています' : '作成に失敗しました'}</div>`;
      errEl.style.display = 'block';
      return;
    }

    // 作成者をPJメンバーに追加
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

  // モーダルを閉じたらフォームをリセット
  document.getElementById('createProjectModal').addEventListener('hidden.bs.modal', () => {
    document.getElementById('project-name').value = '';
    document.getElementById('project-code').value = '';
    document.getElementById('project-desc').value = '';
    document.getElementById('modal-error').style.display = 'none';
  });
}

init();
