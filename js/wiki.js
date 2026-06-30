let projectId     = null;
let currentProfile = null;
let pages          = [];
let currentPageId  = null;
let editingPageId  = null; // null = 新規、uuid = 既存編集

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

  await Promise.all([loadProject(), loadSidebarProjects()]);
  await loadPages();
  setupButtons();
}

async function loadProject() {
  const { data } = await supabaseClient.from('projects').select('id,name').eq('id', projectId).single();
  if (!data) { window.location.href = '/dashboard.html'; return; }

  document.title = `Wiki - ${data.name} - WANHub`;
  document.getElementById('breadcrumb-project').textContent = data.name;
  document.getElementById('breadcrumb-project').href        = `/project.html?id=${projectId}`;
  document.getElementById('back-btn').href                  = `/project.html?id=${projectId}`;
  document.getElementById('tab-list').href                  = `/project.html?id=${projectId}`;
  document.getElementById('tab-board').href                 = `/board.html?id=${projectId}`;
  document.getElementById('tab-wiki').href                  = `/wiki.html?id=${projectId}`;
  document.getElementById('tab-gantt').href                 = `/gantt.html?id=${projectId}`;
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

async function loadPages() {
  const { data, error } = await supabaseClient
    .from('wiki_pages')
    .select('id, title, updated_at')
    .eq('project_id', projectId)
    .order('updated_at', { ascending: false });

  if (error) { showError('Wikiの読み込みに失敗しました'); return; }
  pages = data || [];
  renderPageList();
}

function renderPageList() {
  const el = document.getElementById('wiki-page-list');
  if (pages.length === 0) {
    el.innerHTML = '<div class="wiki-no-pages"><i class="bi bi-journal-plus"></i><p>ページなし</p></div>';
    return;
  }
  el.innerHTML = pages.map(p => `
    <div class="wiki-page-item ${p.id === currentPageId ? 'active' : ''}" data-page-id="${p.id}">
      <i class="bi bi-file-text me-2" style="flex-shrink:0;font-size:13px"></i>
      <span class="wiki-page-item-title">${escapeHtml(p.title)}</span>
    </div>
  `).join('');

  el.querySelectorAll('.wiki-page-item').forEach(item => {
    item.addEventListener('click', () => selectPage(item.dataset.pageId));
  });
}

async function selectPage(pageId) {
  currentPageId = pageId;
  renderPageList();

  const { data, error } = await supabaseClient
    .from('wiki_pages')
    .select('*, updater:profiles!updated_by(name), creator:profiles!created_by(name)')
    .eq('id', pageId)
    .single();

  if (error || !data) { showError('ページの読み込みに失敗しました'); return; }

  showView('view');
  document.getElementById('wiki-page-title').textContent   = data.title;
  document.getElementById('wiki-page-content').textContent = data.content || '（内容なし）';
  document.getElementById('wiki-page-meta').innerHTML = [
    `更新: ${formatDate(data.updated_at)}`,
    data.updater  ? `by ${escapeHtml(data.updater.name)}`  : '',
    `　作成: ${formatDate(data.created_at)}`,
    data.creator  ? `by ${escapeHtml(data.creator.name)}`  : '',
  ].filter(Boolean).join(' ');
}

function startEdit(page) {
  editingPageId = page?.id || null;
  showView('editor');
  document.getElementById('editor-title').value   = page?.title   || '';
  document.getElementById('editor-content').value = page?.content || '';
  document.getElementById('editor-title').focus();
}

async function savePage() {
  const title   = document.getElementById('editor-title').value.trim();
  const content = document.getElementById('editor-content').value;

  if (!title) {
    showError('タイトルを入力してください');
    return;
  }

  const btn = document.getElementById('save-page-btn');
  btn.disabled = true;

  let error, savedId = editingPageId;

  if (editingPageId) {
    ({ error } = await supabaseClient.from('wiki_pages').update({
      title, content,
      updated_at: new Date().toISOString(),
      updated_by: currentProfile?.id,
    }).eq('id', editingPageId));
  } else {
    const result = await supabaseClient.from('wiki_pages').insert({
      project_id: projectId, title, content,
      created_by: currentProfile?.id,
      updated_by: currentProfile?.id,
    }).select('id').single();
    error   = result.error;
    savedId = result.data?.id;
  }

  btn.disabled = false;

  if (error) { showError('保存に失敗しました'); return; }

  const errEl = document.getElementById('error-container');
  errEl.style.display = 'none';
  await loadPages();
  if (savedId) {
    currentPageId = savedId;
    await selectPage(savedId);
  }
}

async function deletePage() {
  if (!currentPageId) return;
  const page = pages.find(p => p.id === currentPageId);
  if (!confirm(`「${page?.title || 'このページ'}」を削除しますか？`)) return;

  const { error } = await supabaseClient.from('wiki_pages').delete().eq('id', currentPageId);
  if (error) { showError('削除に失敗しました'); return; }

  currentPageId = null;
  showView('empty');
  await loadPages();
}

function showView(mode) {
  document.getElementById('wiki-empty').style.display  = mode === 'empty'  ? 'flex' : 'none';
  document.getElementById('wiki-view').style.display   = mode === 'view'   ? 'block' : 'none';
  document.getElementById('wiki-editor').style.display = mode === 'editor' ? 'block' : 'none';
}

function setupButtons() {
  document.getElementById('new-page-btn').addEventListener('click', () => startEdit(null));

  document.getElementById('edit-page-btn').addEventListener('click', async () => {
    if (!currentPageId) return;
    const { data } = await supabaseClient.from('wiki_pages').select('*').eq('id', currentPageId).single();
    if (data) startEdit(data);
  });

  document.getElementById('delete-page-btn').addEventListener('click', deletePage);
  document.getElementById('save-page-btn').addEventListener('click', savePage);

  document.getElementById('cancel-edit-btn').addEventListener('click', () => {
    if (currentPageId) {
      selectPage(currentPageId);
    } else {
      showView('empty');
    }
  });

  // Ctrl+S で保存
  document.getElementById('editor-content').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      savePage();
    }
  });
}

init();
