let currentProfile = null;

async function init() {
  const session = await requireAuth();
  if (!session) return;

  currentProfile = await getCurrentProfile();
  // owner / admin のみ管理画面へアクセス可
  if (!['owner', 'admin'].includes(currentProfile?.role) && !currentProfile?.is_admin) {
    window.location.href = '/dashboard.html';
    return;
  }

  applyTheme(currentProfile.theme_color);
  document.getElementById('user-name-sidebar').textContent = currentProfile.name;
  updateSidebarAvatar(currentProfile);
  setupProfileModal(currentProfile);
  injectNotificationBell();
  setupNotificationBell(currentProfile.id);

  await loadStatuses();
  await Promise.all([loadMembers(), loadProjectsAdmin(), loadSidebarProjects(), loadStatusesList(), loadLabelsList()]);
  setupSaveMember();
  setupAddStatus();
  setupAddLabel();
  injectGlobalSearch();
}

async function loadMembers() {
  const { data, error } = await supabaseClient.from('profiles').select('*').order('name');
  const el = document.getElementById('members-list');
  if (error || !data) { el.innerHTML = '<p class="text-danger">読み込み失敗</p>'; return; }
  if (data.length === 0) {
    el.innerHTML = '<p class="text-muted text-center py-3" style="font-size:13.5px">メンバーなし</p>';
    return;
  }

  const myRole = currentProfile?.role || (currentProfile?.is_admin ? 'admin' : 'member');

  el.innerHTML = data.map(p => {
    const roleName = p.role || (p.is_admin ? 'admin' : 'member');
    const isSelf   = p.id === currentProfile?.id;
    const nameDisp = escapeHtml(p.name || '（名前未設定）');

    const roleBadge = roleName === 'owner'
      ? `<span class="badge" style="font-size:10px;background:rgba(214,158,46,0.18);color:#B45309;border:1px solid rgba(214,158,46,0.35)"><i class="bi bi-shield-fill me-1"></i>オーナー</span>`
      : roleName === 'admin'
        ? `<span class="badge" style="font-size:10px;background:rgba(31,111,235,0.14);color:var(--primary);border:1px solid rgba(31,111,235,0.3)"><i class="bi bi-gear-fill me-1"></i>管理者</span>`
        : `<span class="badge bg-light text-muted border" style="font-size:10px">メンバー</span>`;

    // 削除ボタンはオーナーのみ表示、かつ自分自身は無効
    const deleteBtn = myRole === 'owner'
      ? `<button class="btn btn-sm btn-outline-danger member-delete-btn"
                 data-member-id="${p.id}" data-member-name="${nameDisp}"
                 ${isSelf ? 'disabled' : ''} title="${isSelf ? '自分自身は削除できません' : '削除'}">
           <i class="bi bi-trash3"></i>
         </button>`
      : '';

    return `
      <div class="d-flex align-items-center justify-content-between py-2 border-bottom" id="member-row-${p.id}">
        <div class="d-flex align-items-center gap-2">
          ${avatarHtml(p, 34, 13)}
          <div>
            <div class="d-flex align-items-center gap-1">
              <span style="font-size:13.5px;font-weight:500">${nameDisp}</span>
              ${isSelf ? '<span class="badge bg-secondary" style="font-size:10px">自分</span>' : ''}
            </div>
            ${roleBadge}
          </div>
        </div>
        <div class="d-flex gap-1">
          <button class="btn btn-sm btn-outline-secondary member-edit-btn"
                  data-member-id="${p.id}" data-member-name="${nameDisp}"
                  data-member-role="${roleName}" title="編集">
            <i class="bi bi-pencil"></i>
          </button>
          ${deleteBtn}
        </div>
      </div>
    `;
  }).join('');

  // 編集ボタン
  el.querySelectorAll('.member-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name  = btn.dataset.memberName || '';
      const parts = name.split(' ');
      document.getElementById('edit-member-id').value    = btn.dataset.memberId;
      document.getElementById('edit-member-last').value  = parts[0] || '';
      document.getElementById('edit-member-first').value = parts.slice(1).join(' ') || '';

      // 権限変更はオーナーのみ
      const roleSection  = document.getElementById('edit-member-role-section');
      const roleSelect   = document.getElementById('edit-member-role');
      const targetRole   = btn.dataset.memberRole;
      if (myRole === 'owner') {
        roleSection.style.display = '';
        if (targetRole === 'owner') {
          // オーナーのメンバー編集はオーナーのみ選択可
          roleSelect.innerHTML = `<option value="owner">オーナー — 全権限</option>`;
        } else {
          roleSelect.innerHTML = `
            <option value="admin">管理者 — PJ削除・ステータス・ラベル管理</option>
            <option value="member">メンバー — 通常利用のみ</option>
          `;
        }
        roleSelect.value = targetRole || 'member';
        if (!roleSelect.value) roleSelect.selectedIndex = 0;
      } else {
        roleSection.style.display = 'none';
      }

      new bootstrap.Modal(document.getElementById('editMemberModal')).show();
    });
  });

  // 削除ボタン（オーナーのみ）
  el.querySelectorAll('.member-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.memberName;
      if (!confirm(`「${name}」を削除しますか？\nログインできなくなり、元に戻せません。`)) return;
      btn.disabled = true;
      const { error } = await supabaseClient.rpc('admin_delete_user', {
        target_user_id: btn.dataset.memberId,
      });
      if (error) {
        alert('削除に失敗しました: ' + error.message);
        btn.disabled = false;
      } else {
        document.getElementById(`member-row-${btn.dataset.memberId}`)?.remove();
      }
    });
  });
}

function setupSaveMember() {
  document.getElementById('save-member-btn').addEventListener('click', async () => {
    const id        = document.getElementById('edit-member-id').value;
    const lastName  = document.getElementById('edit-member-last').value.trim();
    const firstName = document.getElementById('edit-member-first').value.trim();
    const role      = document.getElementById('edit-member-role').value;

    const name = [lastName, firstName].filter(Boolean).join(' ');
    if (!name) return;

    const myRole = currentProfile?.role || (currentProfile?.is_admin ? 'admin' : 'member');
    // 権限変更はオーナーのみ
    const updateData = myRole === 'owner'
      ? { name, role, is_admin: role !== 'member' }
      : { name };

    const { error } = await supabaseClient.from('profiles')
      .update(updateData)
      .eq('id', id);

    if (!error) {
      bootstrap.Modal.getInstance(document.getElementById('editMemberModal')).hide();
      await loadMembers();
    }
  });
}

async function loadProjectsAdmin() {
  const { data, error } = await supabaseClient
    .from('projects').select('id,name,status,created_at').order('created_at',{ascending:false});
  const el = document.getElementById('projects-admin-list');
  if (error || !data) { el.innerHTML = '<p class="text-danger">読み込み失敗</p>'; return; }

  const { data: issueCounts } = await supabaseClient.from('issues').select('project_id');
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
        <button class="btn btn-sm btn-outline-secondary project-archive-btn"
                data-project-id="${p.id}" data-project-status="${p.status}">
          ${p.status === 'active' ? 'アーカイブ' : '復元'}
        </button>
        <button class="btn btn-sm btn-outline-danger project-delete-btn"
                data-project-id="${p.id}" data-project-name="${escapeHtml(p.name)}"
                title="完全に削除">
          <i class="bi bi-trash3"></i>
        </button>
      </div>
    </div>
  `).join('');

  // アーカイブ / 復元
  el.querySelectorAll('.project-archive-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newStatus = btn.dataset.projectStatus === 'active' ? 'archived' : 'active';
      await supabaseClient.from('projects').update({ status: newStatus }).eq('id', btn.dataset.projectId);
      await loadProjectsAdmin();
    });
  });

  // 削除（admin以上）
  el.querySelectorAll('.project-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const name = btn.dataset.projectName;
      if (!confirm(`「${name}」を完全に削除しますか？\n課題・Wiki・コメントなどすべてのデータが削除されます。\n元に戻せません。`)) return;
      btn.disabled = true;
      const { error } = await supabaseClient.rpc('admin_delete_project', {
        target_project_id: btn.dataset.projectId,
      });
      if (error) {
        alert('削除に失敗しました: ' + error.message);
        btn.disabled = false;
      } else {
        await loadProjectsAdmin();
      }
    });
  });
}

async function loadStatusesList() {
  const el = document.getElementById('statuses-list');
  const { data, error } = await supabaseClient.from('statuses').select('*').order('sort_order');
  if (error || !data) { el.innerHTML = '<p class="text-danger">読み込み失敗</p>'; return; }

  if (data.length === 0) {
    el.innerHTML = '<p class="text-muted text-center py-3" style="font-size:13.5px">ステータスなし</p>';
    return;
  }

  el.innerHTML = data.map(s => `
    <div class="d-flex align-items-center justify-content-between py-2 border-bottom" id="status-row-${s.id}">
      <div class="d-flex align-items-center gap-3">
        <span class="badge" style="background:${hexToRgba(s.color,0.15)};color:${s.color};border:1px solid ${hexToRgba(s.color,0.3)};font-size:12px;padding:4px 10px">
          ${escapeHtml(s.label)}
        </span>
        <span style="font-size:12px;color:var(--text-muted)">${escapeHtml(s.name)}</span>
      </div>
      <button class="btn btn-sm btn-outline-danger" data-delete-status="${s.id}" data-status-label="${escapeHtml(s.label)}">
        <i class="bi bi-trash3"></i>
      </button>
    </div>
  `).join('');

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-status]');
    if (!btn) return;
    if (!confirm(`「${btn.dataset.statusLabel}」を削除しますか？\nこのステータスが設定された課題は影響を受けます。`)) return;
    const { error } = await supabaseClient.from('statuses').delete().eq('id', btn.dataset.deleteStatus);
    if (!error) {
      document.getElementById(`status-row-${btn.dataset.deleteStatus}`)?.remove();
      await loadStatuses();
    } else {
      alert('削除に失敗しました（課題で使用中の可能性があります）');
    }
  });
}

function setupAddStatus() {
  const labelInput = document.getElementById('new-status-label');
  const nameInput  = document.getElementById('new-status-name');
  const colorInput = document.getElementById('new-status-color');
  const preview    = document.getElementById('status-badge-preview');

  const toSnake = (str) => str
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w_]/g, '')
    .replace(/_+/g, '_');

  labelInput.addEventListener('input', () => {
    nameInput.value = toSnake(labelInput.value);
  });

  const updatePreview = () => {
    const color = colorInput.value;
    preview.textContent = labelInput.value || 'プレビュー';
    preview.style.background = hexToRgba(color, 0.15);
    preview.style.color      = color;
    preview.style.border     = `1px solid ${hexToRgba(color, 0.3)}`;
  };

  labelInput.addEventListener('input', updatePreview);
  colorInput.addEventListener('input', updatePreview);

  document.getElementById('add-status-btn').addEventListener('click', async () => {
    const label = labelInput.value.trim();
    const name  = nameInput.value.trim();
    const color = colorInput.value;
    const errEl = document.getElementById('add-status-error');

    if (!label || !name) {
      errEl.innerHTML = '<div class="alert alert-danger">ラベルと内部名は必須です</div>';
      errEl.style.display = 'block';
      return;
    }
    if (!/^[a-z0-9_]+$/.test(name)) {
      errEl.innerHTML = '<div class="alert alert-danger">内部名は英小文字・数字・アンダースコアのみ使用できます</div>';
      errEl.style.display = 'block';
      return;
    }

    const maxOrder = Math.max(0, ...window.statusList.map(s => s.sort_order || 0));
    const { error } = await supabaseClient.from('statuses').insert({
      name, label, color, sort_order: maxOrder + 1
    });

    if (error) {
      errEl.innerHTML = '<div class="alert alert-danger">追加に失敗しました（内部名が重複している可能性があります）</div>';
      errEl.style.display = 'block';
      return;
    }

    bootstrap.Modal.getInstance(document.getElementById('addStatusModal')).hide();
    labelInput.value = ''; nameInput.value = ''; colorInput.value = '#1F6FEB';
    errEl.style.display = 'none';
    await loadStatuses();
    await loadStatusesList();
  });

  document.getElementById('addStatusModal').addEventListener('hidden.bs.modal', () => {
    labelInput.value = ''; nameInput.value = ''; colorInput.value = '#1F6FEB';
    document.getElementById('add-status-error').style.display = 'none';
  });
}

async function loadLabelsList() {
  const el = document.getElementById('labels-list');
  const { data, error } = await supabaseClient.from('labels').select('*').order('name');
  if (error || !data) { el.innerHTML = '<p class="text-danger">読み込み失敗</p>'; return; }

  if (data.length === 0) {
    el.innerHTML = '<p class="text-muted text-center py-3" style="font-size:13.5px">ラベルなし</p>';
    return;
  }

  el.innerHTML = data.map(l => `
    <div class="d-flex align-items-center justify-content-between py-2 border-bottom" id="label-row-${l.id}">
      ${labelBadgeHtml(l)}
      <button class="btn btn-sm btn-outline-danger" data-delete-label="${l.id}" data-label-name="${escapeHtml(l.name)}">
        <i class="bi bi-trash3"></i>
      </button>
    </div>
  `).join('');

  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete-label]');
    if (!btn) return;
    if (!confirm(`「${btn.dataset.labelName}」を削除しますか？\n課題からも取り除かれます。`)) return;
    const { error } = await supabaseClient.from('labels').delete().eq('id', btn.dataset.deleteLabel);
    if (!error) document.getElementById(`label-row-${btn.dataset.deleteLabel}`)?.remove();
    else alert('削除に失敗しました');
  });
}

function setupAddLabel() {
  const nameInput  = document.getElementById('new-label-name');
  const colorInput = document.getElementById('new-label-color');
  const preview    = document.getElementById('label-badge-preview');

  const updatePreview = () => {
    const color = colorInput.value;
    preview.textContent        = nameInput.value || 'プレビュー';
    preview.style.background   = hexToRgba(color, 0.14);
    preview.style.color        = color;
    preview.style.borderColor  = hexToRgba(color, 0.35);
  };

  nameInput.addEventListener('input', updatePreview);
  colorInput.addEventListener('input', updatePreview);

  document.getElementById('add-label-btn').addEventListener('click', async () => {
    const name  = nameInput.value.trim();
    const color = colorInput.value;
    const errEl = document.getElementById('add-label-error');

    if (!name) {
      errEl.innerHTML = '<div class="alert alert-danger">ラベル名は必須です</div>';
      errEl.style.display = 'block';
      return;
    }

    const { error } = await supabaseClient.from('labels').insert({ name, color });

    if (error) {
      errEl.innerHTML = '<div class="alert alert-danger">追加に失敗しました（重複している可能性があります）</div>';
      errEl.style.display = 'block';
      return;
    }

    bootstrap.Modal.getInstance(document.getElementById('addLabelModal')).hide();
    nameInput.value = ''; colorInput.value = '#1F6FEB'; errEl.style.display = 'none';
    await loadLabelsList();
  });

  document.getElementById('addLabelModal').addEventListener('hidden.bs.modal', () => {
    nameInput.value = ''; colorInput.value = '#1F6FEB';
    document.getElementById('add-label-error').style.display = 'none';
  });
}

async function loadSidebarProjects() {
  const { data } = await supabaseClient
    .from('projects').select('id,name').eq('status','active').order('created_at',{ascending:false});
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
