let projectId        = null;
let currentProfile   = null;
let currentProject   = null;
let projectMemberIds = []; // このPJのメンバーuser_id一覧
let allIssues        = [];
let allProfiles      = []; // 全プロフィール（メンバー管理用）
let profiles         = []; // 担当者選択肢
let labels           = [];
let readMap          = {};
let issueLabelMap    = {};
let issueNumberMap   = {}; // id → issue_number（サブタスク番号計算用）
let subNumberMap     = {}; // id → 親内のサブ連番

const today = new Date().toISOString().split('T')[0];

function isCurrentUserAdmin() {
  return currentProfile?.is_admin || ['owner', 'admin'].includes(currentProfile?.role);
}

async function init() {
  const session = await requireAuth();
  if (!session) return;

  projectId = getParam('id');
  if (!projectId) { window.location.href = '/dashboard.html'; return; }

  currentProfile = await getCurrentProfile();
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

  const filterStatus = document.getElementById('filter-status');
  window.statusList.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.name; opt.textContent = s.label;
    filterStatus.appendChild(opt);
  });
  document.getElementById('issue-status').innerHTML = statusOptions('open');

  // loadProject を先に実行（メンバーチェック・currentProject の確定が必要）
  const projectOk = await loadProject();
  if (!projectOk) return;

  await Promise.all([loadProfiles(), loadLabels(), loadSidebarProjects(), loadAllProfiles()]);
  await loadIssues();
  setupFilters();
  setupCreateIssue();
  setupEditProject();
  setupMemberManagement();
}

// 戻り値: false=アクセス不可（リダイレクト済み）
async function loadProject() {
  const { data } = await supabaseClient.from('projects').select('*').eq('id', projectId).single();
  if (!data) { window.location.href = '/dashboard.html'; return false; }
  currentProject = data;

  // このPJのメンバーリストを取得（プロフィール情報も含む）
  const { data: members } = await supabaseClient
    .from('project_members')
    .select('user_id, profile:profiles(id,name,avatar_url)')
    .eq('project_id', projectId);
  projectMemberIds = (members || []).map(m => m.user_id);

  // 非管理者のアクセスチェック（メンバーが設定されている場合のみ制限）
  if (projectMemberIds.length > 0 && !isCurrentUserAdmin()) {
    if (!projectMemberIds.includes(currentProfile?.id)) {
      window.location.href = '/dashboard.html';
      return false;
    }
  }

  // メンバー一覧を表示
  renderMemberList(members || []);

  document.title = `${data.name} - WANHub`;
  document.getElementById('project-name').textContent        = data.name;
  document.getElementById('project-code-display').textContent = data.code ? `[${data.code}]` : '';
  document.getElementById('project-desc').textContent        = data.description || '';
  document.getElementById('breadcrumb-project').textContent  = data.name;
  document.getElementById('edit-project-name').value         = data.name;
  document.getElementById('edit-project-desc').value         = data.description || '';
  document.getElementById('edit-project-code').value         = data.code || '';
  document.getElementById('tab-board').href = `/board.html?id=${projectId}`;
  document.getElementById('tab-wiki').href  = `/wiki.html?id=${projectId}`;
  document.getElementById('tab-gantt').href = `/gantt.html?id=${projectId}`;

  // 管理者のみメンバー管理ボタンを表示
  if (isCurrentUserAdmin()) {
    document.getElementById('manage-members-btn').style.display = 'inline-block';
  } else {
    // 非管理者はPJコード入力欄を無効化
    const codeInput = document.getElementById('edit-project-code');
    if (codeInput) { codeInput.disabled = true; codeInput.title = '管理者のみ変更できます'; }
  }

  return true;
}

function renderMemberList(members) {
  const el = document.getElementById('project-members-display');
  if (!el) return;
  if (members.length === 0) {
    el.innerHTML = '<span style="font-size:11.5px;color:var(--text-muted)"><i class="bi bi-people me-1"></i>メンバー未設定（全員参加）</span>';
    return;
  }
  const avatars = members.map(m =>
    `<span title="${escapeHtml(m.profile?.name || '')}">${avatarHtml(m.profile, 22, 9)}</span>`
  ).join('');
  el.innerHTML = `<i class="bi bi-people" style="font-size:12px;color:var(--text-muted)"></i>${avatars}<span style="font-size:11.5px;color:var(--text-muted)">${members.length}名</span>`;
}

// 全プロフィール（メンバー管理モーダル用）
async function loadAllProfiles() {
  const { data } = await supabaseClient.from('profiles').select('*').order('name');
  allProfiles = data || [];
}

async function loadProfiles() {
  // PJメンバーが設定されている場合はそのメンバーのみ担当者候補にする
  let query = supabaseClient.from('profiles').select('*').order('name');
  if (projectMemberIds.length > 0) {
    query = query.in('id', projectMemberIds);
  }
  const { data } = await query;
  profiles = data || [];

  const assigneeSel = document.getElementById('issue-assignee');
  const filterSel   = document.getElementById('filter-assignee');
  const mentorSel   = document.getElementById('issue-mentor');
  profiles.forEach(p => {
    [assigneeSel, filterSel, mentorSel].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.name;
      sel.appendChild(opt);
    });
  });
}

async function loadLabels() {
  const { data } = await supabaseClient.from('labels').select('*').order('name');
  labels = data || [];
  const filterSel = document.getElementById('filter-label');
  labels.forEach(l => {
    const opt = document.createElement('option');
    opt.value = l.id; opt.textContent = l.name;
    filterSel.appendChild(opt);
  });
}

async function loadSidebarProjects() {
  const { data: allProjects } = await supabaseClient
    .from('projects').select('id,name').eq('status','active').order('created_at',{ascending:false});
  if (!allProjects) return;

  let projects = allProjects;
  if (!isCurrentUserAdmin() && currentProfile) {
    const { data: members } = await supabaseClient
      .from('project_members').select('project_id, user_id');
    const projectsWithMembers = new Set((members || []).map(m => m.project_id));
    const myMemberships       = new Set((members || []).filter(m => m.user_id === currentProfile.id).map(m => m.project_id));
    projects = allProjects.filter(p => !projectsWithMembers.has(p.id) || myMemberships.has(p.id));
  }

  const el = document.getElementById('sidebar-projects');
  el.innerHTML = projects.map(p => `
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
    .order('issue_number', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (error) { showError('課題の読み込みに失敗しました'); return; }
  allIssues = data || [];

  // 課題番号マップとサブタスク連番を構築
  issueNumberMap = {};
  allIssues.forEach(i => { issueNumberMap[i.id] = i.issue_number; });

  const subByParent = {};
  allIssues.filter(i => i.parent_id).forEach(i => {
    if (!subByParent[i.parent_id]) subByParent[i.parent_id] = [];
    subByParent[i.parent_id].push(i);
  });
  subNumberMap = {};
  Object.values(subByParent).forEach(subs => {
    subs.sort((a, b) => (a.issue_number || 0) - (b.issue_number || 0))
        .forEach((issue, idx) => { subNumberMap[issue.id] = idx + 1; });
  });

  if (currentProfile && allIssues.length > 0) {
    const ids = allIssues.map(i => i.id);
    const { data: reads } = await supabaseClient
      .from('issue_reads').select('issue_id,read_at')
      .eq('user_id', currentProfile.id).in('issue_id', ids);
    readMap = {};
    (reads || []).forEach(r => { readMap[r.issue_id] = r.read_at; });

    const { data: ilData } = await supabaseClient
      .from('issue_labels').select('issue_id, label:labels(id,name,color)').in('issue_id', ids);
    issueLabelMap = {};
    (ilData || []).forEach(il => {
      if (!issueLabelMap[il.issue_id]) issueLabelMap[il.issue_id] = [];
      issueLabelMap[il.issue_id].push(il.label);
    });
  }

  renderIssues(allIssues);
}

function isUnread(issue) {
  const lastRead = readMap[issue.id];
  if (!lastRead) return true;
  return issue.updated_at > lastRead;
}

function isOverdue(issue) {
  return issue.due_date && issue.due_date < today && !['closed', 'resolved'].includes(issue.status);
}

function issueNumLabel(issue) {
  const prefix = currentProject?.code ? `${currentProject.code}-` : '#';

  if (issue.parent_id) {
    // サブタスク: PARENT_NUM(3桁)-SUB_NUM(2桁)
    const parentNum = issueNumberMap[issue.parent_id];
    const subNum    = subNumberMap[issue.id] || 1;
    if (parentNum) {
      return `${prefix}${String(parentNum).padStart(3, '0')}-${String(subNum).padStart(2, '0')}`;
    }
  }

  if (!issue.issue_number) return '';
  return `${prefix}${String(issue.issue_number).padStart(3, '0')}`;
}

function renderIssues(issues) {
  const tbody = document.getElementById('issues-tbody');
  document.getElementById('issue-count').textContent = `${issues.length} 件`;

  if (issues.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="bi bi-clipboard2-x"></i><p>課題がありません</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = issues.map(issue => {
    const lbls      = issueLabelMap[issue.id] || [];
    const overdue   = isOverdue(issue);
    const labelHtml = lbls.map(l => labelBadgeHtml(l)).join(' ');
    const numLabel  = issueNumLabel(issue);

    return `
      <tr class="${overdue ? 'overdue-row' : ''}">
        <td>
          ${numLabel ? `<span class="issue-num">${escapeHtml(numLabel)}</span>` : ''}
        </td>
        <td>
          <div class="d-flex align-items-center gap-1 flex-wrap">
            <a href="/issue.html?id=${issue.id}" class="issue-title-link">${escapeHtml(issue.title)}</a>
            ${overdue ? '<span class="overdue-badge">期限切れ</span>' : ''}
            ${isUnread(issue) ? '<span class="unread-dot" title="未読"></span>' : ''}
          </div>
          ${labelHtml ? `<div class="d-flex flex-wrap gap-1 mt-1">${labelHtml}</div>` : ''}
        </td>
        <td>${statusBadge(issue.status)}</td>
        <td>${priorityBadge(issue.priority)}</td>
        <td>
          <div class="d-flex align-items-center gap-1" style="font-size:12px">
            ${issue.assignee ? avatarHtml(issue.assignee, 20, 9) : ''}
            ${issue.assignee ? escapeHtml(issue.assignee.name) : '<span class="text-muted">-</span>'}
          </div>
        </td>
        <td>
          <div class="d-flex align-items-center gap-1" style="font-size:12px">
            ${issue.mentor ? avatarHtml(issue.mentor, 20, 9) : ''}
            ${issue.mentor ? escapeHtml(issue.mentor.name) : '<span class="text-muted">-</span>'}
          </div>
        </td>
        <td style="font-size:13px;color:${overdue ? '#DC3545' : 'var(--text-muted)'}">${formatDate(issue.due_date)}</td>
        <td style="font-size:13px;color:var(--text-muted)">${formatDate(issue.created_at)}</td>
      </tr>
    `;
  }).join('');
}

function setupFilters() {
  const applyFilters = () => {
    const search      = document.getElementById('search-input').value.toLowerCase();
    const status      = document.getElementById('filter-status').value;
    const priority    = document.getElementById('filter-priority').value;
    const assignee    = document.getElementById('filter-assignee').value;
    const labelId     = document.getElementById('filter-label').value;
    const overdueOnly = document.getElementById('filter-overdue').value === 'overdue';

    renderIssues(allIssues.filter(i => {
      if (search      && !i.title.toLowerCase().includes(search))                        return false;
      if (status      && i.status      !== status)                                        return false;
      if (priority    && i.priority    !== priority)                                      return false;
      if (assignee    && i.assignee_id !== assignee)                                     return false;
      if (labelId     && !(issueLabelMap[i.id] || []).some(l => l.id === labelId))      return false;
      if (overdueOnly && !isOverdue(i))                                                   return false;
      return true;
    }));
  };

  ['search-input','filter-status','filter-priority','filter-assignee','filter-label','filter-overdue']
    .forEach(id => document.getElementById(id).addEventListener('input', applyFilters));

  document.getElementById('clear-filters').addEventListener('click', () => {
    ['search-input','filter-status','filter-priority','filter-assignee','filter-label','filter-overdue']
      .forEach(id => { document.getElementById(id).value = ''; });
    renderIssues(allIssues);
  });
}

function setupCreateIssue() {
  document.getElementById('create-issue-btn').addEventListener('click', async () => {
    const title = document.getElementById('issue-title').value.trim();
    if (!title) {
      document.getElementById('modal-error').innerHTML = '<div class="alert alert-danger">タイトルは必須です</div>';
      document.getElementById('modal-error').style.display = 'block';
      return;
    }

    const btn = document.getElementById('create-issue-btn');
    btn.disabled = true; btn.textContent = '追加中...';

    // PJ内の最大issue_numberを取得して+1で採番
    const { data: maxData } = await supabaseClient
      .from('issues').select('issue_number')
      .eq('project_id', projectId)
      .order('issue_number', { ascending: false })
      .limit(1);
    const nextNumber = ((maxData?.[0]?.issue_number) || 0) + 1;

    const rawHours    = document.getElementById('issue-planned-hours').value;
    const plannedHours = rawHours !== '' ? parseFloat(rawHours) : null;

    const { error } = await supabaseClient.from('issues').insert({
      project_id:    projectId,
      reporter_id:   currentProfile?.id,
      issue_number:  nextNumber,
      title,
      description:   document.getElementById('issue-desc').value.trim() || null,
      status:        document.getElementById('issue-status').value,
      priority:      document.getElementById('issue-priority').value,
      assignee_id:   document.getElementById('issue-assignee').value   || null,
      mentor_id:     document.getElementById('issue-mentor').value     || null,
      start_date:    document.getElementById('issue-start-date').value || null,
      due_date:      document.getElementById('issue-due-date').value   || null,
      planned_hours: (plannedHours !== null && !isNaN(plannedHours)) ? plannedHours : null,
    });

    btn.disabled = false; btn.textContent = '追加';

    if (error) {
      document.getElementById('modal-error').innerHTML = '<div class="alert alert-danger">追加に失敗しました</div>';
      document.getElementById('modal-error').style.display = 'block';
      return;
    }

    bootstrap.Modal.getInstance(document.getElementById('createIssueModal')).hide();
    ['issue-title','issue-desc','issue-start-date','issue-due-date','issue-planned-hours']
      .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('issue-status').value   = window.statusList[0]?.name || 'open';
    document.getElementById('issue-priority').value = 'medium';
    document.getElementById('issue-assignee').value = '';
    document.getElementById('issue-mentor').value   = '';
    document.getElementById('modal-error').style.display = 'none';
    await loadIssues();
  });
}

function setupEditProject() {
  document.getElementById('update-project-btn').addEventListener('click', async () => {
    const name = document.getElementById('edit-project-name').value.trim();
    const code = document.getElementById('edit-project-code').value.trim().toUpperCase();
    if (!name) return;

    const { error } = await supabaseClient.from('projects').update({
      name,
      code:        code || null,
      description: document.getElementById('edit-project-desc').value.trim() || null,
    }).eq('id', projectId);

    if (!error) {
      currentProject = { ...currentProject, name, code: code || null };
      document.getElementById('project-name').textContent        = name;
      document.getElementById('project-code-display').textContent = code ? `[${code}]` : '';
      document.getElementById('breadcrumb-project').textContent  = name;
      document.title = `${name} - WANHub`;
      bootstrap.Modal.getInstance(document.getElementById('editProjectModal')).hide();
    }
  });
}

// ========== メンバー管理 ==========

function setupMemberManagement() {
  document.getElementById('manage-members-btn').addEventListener('click', () => {
    renderMemberModal();
    new bootstrap.Modal(document.getElementById('manageMembersModal')).show();
  });

  document.getElementById('save-members-btn').addEventListener('click', saveMemberChanges);
}

async function renderMemberModal() {
  const listEl = document.getElementById('member-checkbox-list');
  listEl.innerHTML = '<div class="text-center py-2" style="font-size:13px;color:var(--text-muted)">読み込み中...</div>';

  const { data: members } = await supabaseClient
    .from('project_members').select('user_id').eq('project_id', projectId);
  projectMemberIds = (members || []).map(m => m.user_id);
  const memberSet  = new Set(projectMemberIds);

  if (allProfiles.length === 0) {
    listEl.innerHTML = '<div class="text-center py-2" style="font-size:13px;color:var(--text-muted)">メンバーが存在しません</div>';
    return;
  }

  listEl.innerHTML = allProfiles.map(p => `
    <div class="d-flex align-items-center gap-2 py-2 border-bottom" style="padding-left:4px">
      <input class="form-check-input flex-shrink-0" type="checkbox"
             id="member-chk-${p.id}" value="${p.id}"
             ${memberSet.has(p.id) ? 'checked' : ''}>
      <label class="d-flex align-items-center gap-2 mb-0" for="member-chk-${p.id}" style="cursor:pointer;flex:1">
        ${avatarHtml(p, 28, 11)}
        <span style="font-size:13.5px">${escapeHtml(p.name)}</span>
      </label>
    </div>
  `).join('');
}

async function saveMemberChanges() {
  const btn = document.getElementById('save-members-btn');
  btn.disabled = true; btn.textContent = '保存中...';

  const checkedIds  = [...document.querySelectorAll('#member-checkbox-list input[type=checkbox]:checked')].map(el => el.value);
  const checkedSet  = new Set(checkedIds);
  const currentSet  = new Set(projectMemberIds);

  const toAdd    = checkedIds.filter(id => !currentSet.has(id));
  const toRemove = projectMemberIds.filter(id => !checkedSet.has(id));

  if (toAdd.length > 0) {
    const { error } = await supabaseClient.from('project_members')
      .insert(toAdd.map(user_id => ({ project_id: projectId, user_id })));
    if (error) { alert('追加に失敗しました: ' + error.message); btn.disabled = false; btn.textContent = '保存'; return; }
  }

  for (const userId of toRemove) {
    await supabaseClient.from('project_members').delete()
      .eq('project_id', projectId).eq('user_id', userId);
  }

  projectMemberIds = checkedIds;
  btn.disabled = false; btn.textContent = '保存';
  bootstrap.Modal.getInstance(document.getElementById('manageMembersModal')).hide();

  // カードのメンバー表示を更新
  const { data: updatedMembers } = await supabaseClient
    .from('project_members')
    .select('user_id, profile:profiles(id,name,avatar_url)')
    .eq('project_id', projectId);
  renderMemberList(updatedMembers || []);
}

init();
