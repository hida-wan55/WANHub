let currentProfile = null;

async function init() {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();
  if (currentProfile) {
    document.getElementById('user-name-sidebar').textContent = currentProfile.name;
    document.getElementById('user-avatar-sidebar').textContent = currentProfile.name.charAt(0).toUpperCase();
    if (currentProfile.is_admin) {
      document.getElementById('admin-btn').style.display = 'inline-block';
    }
  }

  await Promise.all([loadProjects(), loadStats()]);
  setupCreateProject();
}

async function loadProjects() {
  const { data: projects, error } = await supabaseClient
    .from('projects')
    .select('id, name, description, created_at, status')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) { showError('プロジェクトの読み込みに失敗しました'); return; }

  document.getElementById('stat-projects').textContent = projects.length;

  // サイドバー
  const sidebarEl = document.getElementById('sidebar-projects');
  if (projects.length === 0) {
    sidebarEl.innerHTML = '<div class="px-3 py-2" style="font-size:12px;color:rgba(201,214,227,0.4)">プロジェクトなし</div>';
  } else {
    sidebarEl.innerHTML = projects.map(p => `
      <a href="/project.html?id=${p.id}" class="sidebar-link">
        <i class="bi bi-folder2"></i>
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name)}</span>
      </a>
    `).join('');
  }

  // プロジェクトグリッド
  const gridEl = document.getElementById('projects-grid');
  if (projects.length === 0) {
    gridEl.innerHTML = `
      <div class="col-12">
        <div class="empty-state">
          <i class="bi bi-folder-plus"></i>
          <p>プロジェクトがありません。右上のボタンから作成してください。</p>
        </div>
      </div>
    `;
    return;
  }

  // 課題数を一括取得
  const ids = projects.map(p => p.id);
  const { data: counts } = await supabaseClient
    .from('issues')
    .select('project_id')
    .in('project_id', ids);

  const countMap = {};
  (counts || []).forEach(i => { countMap[i.project_id] = (countMap[i.project_id] || 0) + 1; });

  gridEl.innerHTML = projects.map(p => `
    <div class="col-12 col-md-6 col-xl-4">
      <a href="/project.html?id=${p.id}" class="project-card">
        <div class="project-card-name">
          <i class="bi bi-folder2 me-2"></i>${escapeHtml(p.name)}
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
  const { data: issues } = await supabaseClient
    .from('issues')
    .select('status, assignee_id');
  if (!issues) return;

  document.getElementById('stat-open').textContent        = issues.filter(i => i.status === 'open').length;
  document.getElementById('stat-in-progress').textContent = issues.filter(i => i.status === 'in_progress').length;
  document.getElementById('stat-my-issues').textContent   = issues.filter(i => i.assignee_id === currentProfile?.id && i.status !== 'closed').length;
}

function setupCreateProject() {
  document.getElementById('create-project-btn').addEventListener('click', async () => {
    const name = document.getElementById('project-name').value.trim();
    if (!name) {
      document.getElementById('modal-error').innerHTML = '<div class="alert alert-danger">プロジェクト名を入力してください</div>';
      document.getElementById('modal-error').style.display = 'block';
      return;
    }

    const btn = document.getElementById('create-project-btn');
    btn.disabled = true;
    btn.textContent = '作成中...';

    const { data, error } = await supabaseClient
      .from('projects')
      .insert({
        name,
        description: document.getElementById('project-desc').value.trim(),
        created_by:  currentProfile?.id,
      })
      .select()
      .single();

    btn.disabled = false;
    btn.textContent = '作成';

    if (error) {
      document.getElementById('modal-error').innerHTML = '<div class="alert alert-danger">作成に失敗しました</div>';
      document.getElementById('modal-error').style.display = 'block';
      return;
    }

    bootstrap.Modal.getInstance(document.getElementById('createProjectModal')).hide();
    document.getElementById('project-name').value = '';
    document.getElementById('project-desc').value = '';
    document.getElementById('modal-error').style.display = 'none';

    window.location.href = `/project.html?id=${data.id}`;
  });
}

init();
