let currentProfile = null;

async function init() {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();

  if (!currentProfile?.is_admin) {
    window.location.href = '/dashboard.html';
    return;
  }

  document.getElementById('user-name-sidebar').textContent = currentProfile.name;
  document.getElementById('user-avatar-sidebar').textContent = currentProfile.name.charAt(0).toUpperCase();

  await Promise.all([loadMembers(), loadProjectsAdmin(), loadSidebarProjects()]);
  setupSaveMember();
}

async function loadMembers() {
  const { data, error } = await supabaseClient.from('profiles').select('*').order('name');
  const el = document.getElementById('members-list');

  if (error || !data) { el.innerHTML = '<p class="text-danger">読み込み失敗</p>'; return; }

  if (data.length === 0) { el.innerHTML = '<p class="text-muted text-center py-3" style="font-size:13.5px">メンバーなし</p>'; return; }

  el.innerHTML = data.map(p => `
    <div class="d-flex align-items-center justify-content-between py-2 border-bottom">
      <div class="d-flex align-items-center gap-2">
        <div class="user-avatar" style="width:32px;height:32px;font-size:13px;${p.is_admin ? '' : 'background:#6C757D'}">
          ${escapeHtml(p.name.charAt(0).toUpperCase())}
        </div>
        <div>
          <div style="font-size:13.5px;font-weight:500">${escapeHtml(p.name)}</div>
          ${p.is_admin ? '<span class="badge bg-primary" style="font-size:10px">管理者</span>' : ''}
        </div>
      </div>
      <button class="btn btn-sm btn-outline-secondary"
              data-member-id="${p.id}"
              data-member-name="${escapeHtml(p.name)}"
              data-member-admin="${p.is_admin}">
        <i class="bi bi-pencil"></i>
      </button>
    </div>
  `).join('');

  document.getElementById('members-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-member-id]');
    if (!btn) return;
    document.getElementById('edit-member-id').value     = btn.dataset.memberId;
    document.getElementById('edit-member-name').value   = btn.dataset.memberName;
    document.getElementById('edit-member-admin').checked = btn.dataset.memberAdmin === 'true';
    new bootstrap.Modal(document.getElementById('editMemberModal')).show();
  }, { once: true });
}

function setupSaveMember() {
  document.getElementById('save-member-btn').addEventListener('click', async () => {
    const id      = document.getElementById('edit-member-id').value;
    const name    = document.getElementById('edit-member-name').value.trim();
    const isAdmin = document.getElementById('edit-member-admin').checked;
    if (!name) return;

    const { error } = await supabaseClient
      .from('profiles')
      .update({ name, is_admin: isAdmin })
      .eq('id', id);

    if (!error) {
      bootstrap.Modal.getInstance(document.getElementById('editMemberModal')).hide();
      await loadMembers();
    }
  });
}

async function loadProjectsAdmin() {
  const { data, error } = await supabaseClient
    .from('projects')
    .select('id, name, status, created_at')
    .order('created_at', { ascending: false });

  const el = document.getElementById('projects-admin-list');
  if (error || !data) { el.innerHTML = '<p class="text-danger">読み込み失敗</p>'; return; }

  // 課題数を一括取得
  const { data: issueCounts } = await supabaseClient
    .from('issues')
    .select('project_id');
  const countMap = {};
  (issueCounts || []).forEach(i => { countMap[i.project_id] = (countMap[i.project_id] || 0) + 1; });

  el.innerHTML = data.map(p => `
    <div class="d-flex align-items-center justify-content-between py-2 border-bottom">
      <div>
        <div style="font-size:13.5px;font-weight:500">${escapeHtml(p.name)}</div>
        <div style="font-size:12px;color:var(--text-muted)">${countMap[p.id] || 0}件の課題</div>
      </div>
      <div class="d-flex gap-2 align-items-center">
        <span class="badge ${p.status === 'active' ? 'bg-success' : 'bg-secondary'}" style="font-size:10px">
          ${p.status === 'active' ? 'アクティブ' : 'アーカイブ'}
        </span>
        <button class="btn btn-sm btn-outline-secondary"
                data-project-id="${p.id}"
                data-project-status="${p.status}">
          ${p.status === 'active' ? 'アーカイブ' : '復元'}
        </button>
      </div>
    </div>
  `).join('');

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-project-id]');
    if (!btn) return;
    const newStatus = btn.dataset.projectStatus === 'active' ? 'archived' : 'active';
    await supabaseClient.from('projects').update({ status: newStatus }).eq('id', btn.dataset.projectId);
    await loadProjectsAdmin();
  });
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

init();
