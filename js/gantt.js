const DAY_WIDTH   = 28;   // px / 日
const DAYS_SHOW   = 91;   // 表示日数（約3ヶ月）
const LEFT_WIDTH  = 240;  // 左列幅 px
const MONTH_NAMES = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];

let projectId      = null;
let currentProfile = null;
let allIssues      = [];
let rangeStartDate = null; // Date（月初 00:00:00 ローカル）

function initRange() {
  const now = new Date();
  // 前月1日からスタート
  rangeStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
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

  initRange();
  await loadStatuses();
  await Promise.all([loadProject(), loadSidebarProjects()]);
  await loadIssues();
  setupNavigation();
}

async function loadProject() {
  const { data } = await supabaseClient.from('projects').select('id,name').eq('id', projectId).single();
  if (!data) { window.location.href = '/dashboard.html'; return; }

  document.title = `ガント - ${data.name} - WANHub`;
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

async function loadIssues() {
  const { data, error } = await supabaseClient
    .from('issues')
    .select('id, title, status, priority, start_date, due_date, assignee:profiles!assignee_id(id,name,avatar_url)')
    .eq('project_id', projectId)
    .order('start_date', { ascending: true, nullsLast: true });

  if (error) { showError('課題の読み込みに失敗しました'); return; }
  allIssues = data || [];
  renderGantt();
  scrollToToday();
}

// ---- レンダリング ----

function renderGantt() {
  const container  = document.getElementById('gantt-container');
  const todayStr   = new Date().toISOString().split('T')[0];
  const dates      = buildDateStrings(rangeStartDate, DAYS_SHOW);
  const totalWidth = DAYS_SHOW * DAY_WIDTH;
  const innerWidth = LEFT_WIDTH + totalWidth;

  document.getElementById('gantt-range-label').textContent = buildRangeLabel(dates);

  const withDates    = allIssues.filter(i => i.start_date || i.due_date);
  const withoutDates = allIssues.filter(i => !i.start_date && !i.due_date);
  document.getElementById('gantt-issue-count').textContent = `${allIssues.length} 件`;

  const monthGroups = buildMonthGroups(dates);
  const todayOffset = daysBetween(dates[0], todayStr);
  const todayX      = todayOffset * DAY_WIDTH; // 範囲外なら負数 or > totalWidth

  container.innerHTML = `
    <div class="gantt-inner" style="width:${innerWidth}px">
      ${renderMonthRow(monthGroups, totalWidth, todayX)}
      ${renderDayRow(dates, todayX, totalWidth, todayStr)}
      ${withDates.length === 0 && withoutDates.length === 0 ? renderEmptyState(totalWidth) : ''}
      ${withDates.map(i => renderIssueRow(i, dates, todayX, totalWidth, todayStr)).join('')}
      ${withoutDates.length > 0 ? renderNoDatesSection(withoutDates, totalWidth) : ''}
    </div>
  `;
}

function buildDateStrings(startDate, count) {
  const result = [];
  const d = new Date(startDate.getTime());
  for (let i = 0; i < count; i++) {
    result.push(d.toISOString().split('T')[0]);
    d.setDate(d.getDate() + 1);
  }
  return result;
}

function daysBetween(strA, strB) {
  const a = new Date(strA + 'T00:00:00');
  const b = new Date(strB + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function buildRangeLabel(dates) {
  const s = new Date(dates[0] + 'T00:00:00');
  const e = new Date(dates[dates.length - 1] + 'T00:00:00');
  return `${s.getFullYear()}年${MONTH_NAMES[s.getMonth()]} 〜 ${e.getFullYear()}年${MONTH_NAMES[e.getMonth()]}`;
}

function buildMonthGroups(dates) {
  const groups = [];
  dates.forEach(d => {
    const dt    = new Date(d + 'T00:00:00');
    const year  = dt.getFullYear();
    const month = dt.getMonth();
    const last  = groups[groups.length - 1];
    if (last && last.year === year && last.month === month) {
      last.count++;
    } else {
      groups.push({ year, month, count: 1 });
    }
  });
  return groups;
}

function todayColHtml(todayX, totalWidth) {
  if (todayX < 0 || todayX >= totalWidth) return '';
  return `<div class="gantt-today-col" style="left:${todayX}px;width:${DAY_WIDTH}px"></div>`;
}

function renderMonthRow(groups, totalWidth, todayX) {
  return `
    <div class="gantt-row gantt-header-row gantt-month-row">
      <div class="gantt-cell-left gantt-header-label">
        <i class="bi bi-bar-chart-steps me-1"></i>ガント
      </div>
      <div class="gantt-cell-right" style="width:${totalWidth}px;display:flex;position:relative">
        ${todayColHtml(todayX, totalWidth)}
        ${groups.map(g => `
          <div class="gantt-month-cell" style="width:${g.count * DAY_WIDTH}px">
            ${g.year}年${MONTH_NAMES[g.month]}
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderDayRow(dates, todayX, totalWidth, todayStr) {
  return `
    <div class="gantt-row gantt-header-row gantt-day-row">
      <div class="gantt-cell-left gantt-header-label" style="font-size:11.5px;font-weight:600;color:var(--text-muted)">課題</div>
      <div class="gantt-cell-right" style="width:${totalWidth}px;display:flex;position:relative">
        ${todayColHtml(todayX, totalWidth)}
        ${dates.map(d => {
          const dt  = new Date(d + 'T00:00:00');
          const dow = dt.getDay();
          const cls = [
            'gantt-day-cell',
            (dow === 0 || dow === 6) ? 'weekend' : '',
            d === todayStr ? 'today' : '',
          ].filter(Boolean).join(' ');
          return `<div class="${cls}">${dt.getDate()}</div>`;
        }).join('')}
      </div>
    </div>
  `;
}

function renderIssueRow(issue, dates, todayX, totalWidth, todayStr) {
  const bar       = calcBar(issue, dates);
  const statusObj = (window.statusList || []).find(s => s.name === issue.status);
  const barColor  = statusObj?.color || '#6C757D';
  const overdue   = issue.due_date && issue.due_date < todayStr &&
                    !['closed', 'resolved'].includes(issue.status);

  return `
    <div class="gantt-row gantt-data-row">
      <div class="gantt-cell-left">
        <div class="gantt-issue-info">
          <div class="d-flex align-items-center gap-1" style="min-width:0">
            ${priorityBadge(issue.priority)}
            <a href="/issue.html?id=${issue.id}"
               class="gantt-issue-title${overdue ? ' overdue-text' : ''}">
              ${escapeHtml(issue.title)}
            </a>
          </div>
          ${issue.assignee
            ? `<div class="gantt-issue-assignee">${avatarHtml(issue.assignee, 14, 7)} ${escapeHtml(issue.assignee.name)}</div>`
            : ''}
        </div>
      </div>
      <div class="gantt-cell-right" style="width:${totalWidth}px;position:relative">
        ${todayColHtml(todayX, totalWidth)}
        ${bar ? `
          <div class="gantt-bar" style="left:${bar.left}px;width:${bar.width}px;background:${barColor}"
               title="${escapeHtml(issue.title)}">
            ${bar.width >= 48 ? `<span class="gantt-bar-label">${escapeHtml(issue.title)}</span>` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function calcBar(issue, dates) {
  const rangeStart = dates[0];
  const rangeEnd   = dates[dates.length - 1];

  const startStr = issue.start_date || null;
  const endStr   = issue.due_date   || null;
  const effStart = startStr || endStr;
  const effEnd   = endStr   || startStr;

  if (!effStart) return null;
  if (effEnd < rangeStart || effStart > rangeEnd) return null;

  const clampedStart = effStart < rangeStart ? rangeStart : effStart;
  const clampedEnd   = effEnd   > rangeEnd   ? rangeEnd   : effEnd;

  const left  = daysBetween(rangeStart, clampedStart) * DAY_WIDTH;
  const width = Math.max(DAY_WIDTH, (daysBetween(clampedStart, clampedEnd) + 1) * DAY_WIDTH);
  return { left, width };
}

function renderNoDatesSection(issues, totalWidth) {
  return `
    <div class="gantt-no-dates-divider">
      日付未設定の課題（${issues.length}件）
    </div>
    ${issues.map(i => `
      <div class="gantt-row gantt-data-row gantt-no-dates-row">
        <div class="gantt-cell-left">
          <div class="gantt-issue-info">
            <div class="d-flex align-items-center gap-1" style="min-width:0;opacity:0.5">
              ${priorityBadge(i.priority)}
              <a href="/issue.html?id=${i.id}" class="gantt-issue-title">${escapeHtml(i.title)}</a>
            </div>
          </div>
        </div>
        <div class="gantt-cell-right gantt-no-dates-bg" style="width:${totalWidth}px"></div>
      </div>
    `).join('')}
  `;
}

function renderEmptyState(totalWidth) {
  return `
    <div class="gantt-row" style="border-bottom:none">
      <div class="gantt-cell-left" style="min-height:160px;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--text-muted)">
        <i class="bi bi-calendar-x" style="font-size:28px;opacity:0.25"></i>
        <span style="font-size:13px">課題がありません</span>
      </div>
      <div class="gantt-cell-right" style="width:${totalWidth}px"></div>
    </div>
  `;
}

function scrollToToday() {
  const container   = document.getElementById('gantt-container');
  const todayStr    = new Date().toISOString().split('T')[0];
  const dates       = buildDateStrings(rangeStartDate, DAYS_SHOW);
  const todayOffset = daysBetween(dates[0], todayStr);
  const todayX      = todayOffset * DAY_WIDTH;
  // 今日の2日前から表示（今日が左端近くに来る）
  container.scrollLeft = Math.max(0, todayX - DAY_WIDTH * 2);
}

function setupNavigation() {
  document.getElementById('btn-prev').addEventListener('click', () => {
    rangeStartDate = new Date(rangeStartDate.getFullYear(), rangeStartDate.getMonth() - 1, 1);
    renderGantt();
  });
  document.getElementById('btn-next').addEventListener('click', () => {
    rangeStartDate = new Date(rangeStartDate.getFullYear(), rangeStartDate.getMonth() + 1, 1);
    renderGantt();
  });
  document.getElementById('btn-today').addEventListener('click', () => {
    initRange();
    renderGantt();
    scrollToToday();
  });
}

init();
