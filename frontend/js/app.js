/* MivaFix authenticated application: shell, dashboards, requests, admin centre and modals. */
(() => {
  'use strict';

  const { API, api, toast, icon, escapeHtml: esc, validateForm, showServerErrors, liveValidate, setLoading } = window.MivaFix;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const STATUSES = ['submitted', 'assigned', 'in_progress', 'completed', 'cancelled'];
  const STATUS_LABEL = { submitted: 'Submitted', assigned: 'Assigned', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
  const STATUS_HELP = {
    submitted: 'Logged and waiting for an administrator to assign it.',
    assigned: 'An officer owns the job and will start soon.',
    in_progress: 'Work has started on site.',
    completed: 'The fault is fixed and the job is closed.',
    cancelled: 'Closed without work (duplicate or invalid).',
  };
  const ROLE_LABEL = { student_staff: 'Student / Staff', maintenance_officer: 'Maintenance Officer', administrator: 'Administrator' };
  const PAGES = { dashboard: 'index.html', requests: 'requests.html', admin: 'admin.html' };
  const MAX_EVIDENCE = 5 * 1024 * 1024;
  const EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  const state = {
    user: null, view: document.body.dataset.page || 'dashboard', categories: [], officers: null,
    summary: null, filters: {}, page: 1, adminTab: 'requests', users: [],
    liveTimer: null, liveSignature: '', lastFocus: null,
  };

  /* ---------- Formatting helpers ---------- */
  const parseDate = value => value ? new Date(String(value).replace(' ', 'T')) : null;
  const dateLabel = value => { const d = parseDate(value); return d && !isNaN(d) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d) : '—'; };
  const dateTimeLabel = value => { const d = parseDate(value); return d && !isNaN(d) ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(d) : '—'; };
  function timeAgo(value) {
    const d = parseDate(value);
    if (!d || isNaN(d)) return '—';
    const seconds = Math.round((d - Date.now()) / 1000);
    const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
    const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, size] of units) if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
    return 'just now';
  }
  const initials = name => String(name || 'MF').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  const statusPill = status => `<span class="status-pill status-${esc(status)}">${esc(STATUS_LABEL[status] || status)}</span>`;
  const priorityPill = priority => `<span class="priority-pill priority-${esc(priority)}">${esc(priority)}</span>`;
  const person = (name, soft = false) => name ? `<span class="cell-person"><span class="avatar ${soft ? 'tone-soft' : ''}">${esc(initials(name))}</span>${esc(name)}</span>` : '<span class="unassigned">Unassigned</span>';
  const isOfficer = () => state.user.role === 'maintenance_officer';
  const isAdmin = () => state.user.role === 'administrator';
  const canCreate = () => !isOfficer();
  const skeleton = (rows = 4) => `<div class="skeleton-block">${'<span class="skeleton"></span>'.repeat(rows)}</div>`;
  const emptyState = (glyph, title, text, action = '') => `<div class="empty-state"><div class="empty-icon">${icon(glyph, 'icon-lg')}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;
  const debounce = (fn, wait) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); }; };

  /* ---------- Boot & shell ---------- */
  async function boot() {
    try {
      const result = await api('/auth/me');
      if (!result.authenticated) { window.location.href = 'login.html'; return; }
      state.user = result.user;
    } catch (error) {
      document.body.innerHTML = `<div id="toast-region" class="toast-region"></div><div class="page-content">${emptyState('alert', 'MivaFix is unreachable', esc(error.message), '<button class="button button-primary" onclick="location.reload()">Try again</button>')}</div>`;
      return;
    }
    if (state.view === 'admin' && !isAdmin()) { window.location.href = PAGES.dashboard; return; }
    const params = new URLSearchParams(location.search);
    if (params.get('status')) state.filters.status = params.get('status');
    renderShell();
    await loadCategories();
    await renderPage();
    if (params.get('new') === '1' && canCreate()) openNewRequest();
    startLiveRefresh();
  }

  function renderShell() {
    const user = state.user;
    const navItems = [
      { id: 'dashboard', icon: 'home', label: 'Overview' },
      { id: 'requests', icon: 'list', label: isOfficer() ? 'My work' : isAdmin() ? 'All requests' : 'My requests' },
    ];
    if (isAdmin()) navItems.push({ id: 'admin', icon: 'shield', label: 'Admin centre' });
    const pageLabel = navItems.find(item => item.id === state.view)?.label || 'Overview';
    document.title = `${pageLabel} — MivaFix`;
    $('#app-view').innerHTML = `
      <aside class="sidebar" id="sidebar" aria-label="Sidebar">
        <a class="brand-mark" href="${PAGES.dashboard}"><span>✦</span> MivaFix</a>
        <button id="sidebar-close" class="sidebar-close" type="button" aria-label="Close menu">${icon('close')}</button>
        <div class="sidebar-context"><span class="live-dot"></span> Facilities desk</div>
        <nav class="main-nav" aria-label="Main navigation">
          ${navItems.map(item => `<a class="nav-item ${item.id === state.view ? 'active' : ''}" href="${PAGES[item.id]}" ${item.id === state.view ? 'aria-current="page"' : ''}>${icon(item.icon)}${item.label}${item.id === 'requests' ? '<span class="nav-badge hidden" id="nav-open-count"></span>' : ''}</a>`).join('')}
        </nav>
        ${canCreate() ? `<div class="sidebar-cta"><button class="button button-accent" type="button" data-open-new-request>${icon('plus')} New request</button></div>` : ''}
        <div class="sidebar-bottom">
          <button id="logout-button" class="logout-button" type="button">${icon('logout')} Sign out</button>
          <p class="sidebar-foot">MIT 8333 · Miva Open University</p>
        </div>
      </aside>
      <section class="workspace">
        <header class="topbar">
          <button id="mobile-menu" class="mobile-menu" type="button" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button>
          <div class="breadcrumb"><span>MivaFix</span><b>/</b><strong>${pageLabel}</strong></div>
          <div class="topbar-actions">
            <span class="sync-status" id="sync-status" title="Data refreshes automatically every 10 seconds"><span class="live-dot"></span><span>Live</span></span>
            <button id="notification-button" class="icon-button" type="button" aria-label="Notifications">${icon('bell')}<i id="notification-count" class="notification-count hidden">0</i></button>
            <div class="user-chip"><div class="avatar" aria-hidden="true">${esc(initials(user.full_name))}</div><div><strong>${esc(user.full_name)}</strong><small>${esc(ROLE_LABEL[user.role] || user.role)}</small></div></div>
          </div>
        </header>
        <div id="page-content" class="page-content"></div>
      </section>`;
    bindShell();
  }

  function bindShell() {
    const sidebar = $('#sidebar');
    const menuButton = $('#mobile-menu');
    let backdrop = $('.sidebar-backdrop');
    if (!backdrop) { backdrop = document.createElement('div'); backdrop.className = 'sidebar-backdrop'; document.body.append(backdrop); }
    const setSidebar = open => { sidebar.classList.toggle('open', open); backdrop.classList.toggle('visible', open); menuButton.setAttribute('aria-expanded', String(open)); };
    menuButton.addEventListener('click', () => setSidebar(!sidebar.classList.contains('open')));
    $('#sidebar-close').addEventListener('click', () => setSidebar(false));
    backdrop.addEventListener('click', () => setSidebar(false));
    window.addEventListener('resize', () => { if (window.innerWidth > 760) setSidebar(false); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && sidebar.classList.contains('open')) setSidebar(false); });
    $('#logout-button').addEventListener('click', async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch { /* sign out locally regardless */ }
      window.location.href = 'login.html';
    });
    $('#notification-button').addEventListener('click', openNotifications);
    document.addEventListener('click', event => {
      const trigger = event.target.closest('[data-open-new-request]');
      if (trigger) { setSidebar(false); openNewRequest(); }
    });
  }

  async function loadCategories() {
    try { state.categories = (await api('/categories')).categories || []; } catch (error) { toast(error.message, 'error'); }
  }

  async function renderPage() {
    if (state.view === 'requests') return renderRequests();
    if (state.view === 'admin') return renderAdmin();
    return renderDashboard();
  }

  function updateCounters(summary) {
    const unread = Number(summary.unread_notifications || 0);
    const badge = $('#notification-count');
    if (badge) { badge.textContent = unread > 9 ? '9+' : unread; badge.classList.toggle('hidden', !unread); }
    $('#notification-button')?.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
    const b = summary.by_status;
    const open = isOfficer() ? b.assigned + b.in_progress : b.submitted + b.assigned + b.in_progress;
    const nav = $('#nav-open-count');
    if (nav) { nav.textContent = open; nav.classList.toggle('hidden', !open); nav.title = `${open} open`; }
  }

  /* ---------- Dashboard ---------- */
  function metricCards(summary) {
    const b = summary.by_status;
    const total = summary.total || 0;
    const pct = n => total ? Math.round((n / total) * 100) : 0;
    const attention = isOfficer() ? b.assigned : b.submitted + b.assigned;
    const cards = [
      { label: isOfficer() ? 'Assigned to me' : isAdmin() ? 'Total requests' : 'My requests', value: total, sub: isOfficer() ? 'All jobs in your queue' : 'All time', glyph: 'inbox', tone: 'navy', bar: 100, href: PAGES.requests },
      { label: isOfficer() ? 'Not started' : 'Needs attention', value: attention, sub: isOfficer() ? 'Assigned, awaiting work' : isAdmin() ? 'New or awaiting work' : 'Waiting for action', glyph: 'clock', tone: 'amber', bar: pct(attention), href: `${PAGES.requests}?status=${isOfficer() || !b.submitted ? 'assigned' : 'submitted'}` },
      { label: 'In progress', value: b.in_progress, sub: 'Being worked on now', glyph: 'wrench', tone: 'sky', bar: pct(b.in_progress), href: `${PAGES.requests}?status=in_progress` },
      { label: 'Completed', value: b.completed, sub: `${pct(b.completed)}% resolution rate`, glyph: 'checkCircle', tone: 'green', bar: pct(b.completed), href: `${PAGES.requests}?status=completed` },
    ];
    return `<div class="metric-grid">${cards.map(c => `
      <a class="metric-card tone-${c.tone}" href="${c.href}" style="text-decoration:none" aria-label="${c.label}: ${c.value}. View requests">
        <div class="metric-top"><span class="metric-label">${c.label}</span><span class="metric-icon">${icon(c.glyph)}</span></div>
        <span class="metric-value">${c.value}</span>
        <div class="metric-sub">${c.sub}</div>
        <div class="metric-bar"><i style="width:${c.bar}%"></i></div>
      </a>`).join('')}</div>`;
  }

  function breakdown(summary) {
    const b = summary.by_status;
    const max = Math.max(1, ...Object.values(b));
    const colors = { submitted: 'var(--amber)', assigned: 'var(--violet)', in_progress: 'var(--sky)', completed: 'var(--green)', cancelled: '#9aa5b4' };
    return `<div class="breakdown">${STATUSES.map(s => `<div class="breakdown-row" title="${STATUS_HELP[s]}"><span>${STATUS_LABEL[s]}</span><span class="breakdown-track"><i style="width:${(b[s] / max) * 100}%;background:${colors[s]}"></i></span><strong>${b[s]}</strong></div>`).join('')}</div>`;
  }

  function recentTable(requests) {
    if (!requests?.length) {
      return emptyState('inbox', isOfficer() ? 'No jobs assigned yet' : 'No requests yet', isOfficer() ? 'Jobs assigned to you by the facilities administrator will appear here.' : 'When you report a fault it will appear here so you can follow its progress.', canCreate() ? `<button class="button button-primary" data-open-new-request>${icon('plus')} Report a fault</button>` : '');
    }
    return `<div class="table-wrap"><table class="data-table stack-mobile"><thead><tr><th>Request</th><th>Status</th><th>Last update</th><th><span class="sr-only">Action</span></th></tr></thead><tbody>${requests.map(r => `
      <tr data-row-detail="${r.id}">
        <td><span class="ticket">${esc(r.ticket_no)}</span><span class="request-title">${esc(r.title)}</span>${r.location ? `<span class="request-sub">${icon('pin', 'icon-sm')} ${esc(r.location)}</span>` : ''}</td>
        <td>${statusPill(r.status)}</td>
        <td class="muted" data-hide-mobile title="${esc(dateTimeLabel(r.updated_at || r.created_at))}">${esc(timeAgo(r.updated_at || r.created_at))}</td>
        <td><button class="table-action" data-detail="${r.id}">Open ${icon('arrowRight', 'icon-sm')}</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  async function renderDashboard({ silent = false } = {}) {
    const content = $('#page-content');
    if (!silent) content.innerHTML = skeleton(6);
    try {
      const { summary } = await api('/dashboard');
      state.summary = summary;
      updateCounters(summary);
      const hour = new Date().getHours();
      const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
      const first = esc(state.user.full_name.split(' ')[0]);
      const heading = isOfficer() ? 'Your maintenance queue' : isAdmin() ? 'Service desk overview' : 'Your service requests';
      const intro = isOfficer() ? 'Jobs assigned to you, and what needs doing next.' : isAdmin() ? 'Campus-wide maintenance activity at a glance.' : 'Report campus faults and follow them through to a fix.';
      const quick = isOfficer()
        ? `<section class="quick-card"><div><p class="eyebrow">Maintenance queue</p><h3>Keep every job moving.</h3><p>Open a job to mark it in progress or completed, with a short note for the requester.</p></div><a class="button" href="${PAGES.requests}">Open my work ${icon('arrowRight', 'icon-sm')}</a></section>`
        : isAdmin()
          ? `<section class="quick-card"><div><p class="eyebrow">Admin centre</p><h3>${summary.by_status.submitted} request${summary.by_status.submitted === 1 ? '' : 's'} waiting to be assigned.</h3><p>Assign officers, manage people and export reports.</p></div><a class="button" href="${PAGES.admin}">Go to admin centre ${icon('arrowRight', 'icon-sm')}</a></section>`
          : `<section class="quick-card"><div><p class="eyebrow">Need something fixed?</p><h3>Report it in under a minute.</h3><p>Add the location and a photo so the right officer arrives prepared.</p></div><button class="button" data-open-new-request>${icon('plus', 'icon-sm')} New request</button></section>`;
      content.innerHTML = `
        <div class="page-header">
          <div><p class="eyebrow">${greeting}, ${first}</p><h1>${heading}</h1><p>${intro}</p></div>
          <div class="page-header-actions">${canCreate() ? `<button class="button button-primary" data-open-new-request>${icon('plus')} New request</button>` : `<a class="button button-primary" href="${PAGES.requests}">View my work ${icon('arrowRight', 'icon-sm')}</a>`}</div>
        </div>
        ${metricCards(summary)}
        <div class="content-grid">
          <section class="panel">
            <div class="panel-header"><div><h3>${isOfficer() ? 'Latest assigned jobs' : 'Recent requests'}</h3><p>The five most recent, newest first</p></div><a class="link-button" href="${PAGES.requests}">View all ${icon('arrowRight', 'icon-sm')}</a></div>
            ${recentTable(summary.latest)}
          </section>
          <div class="right-stack">
            ${quick}
            <section class="panel"><div class="panel-header"><div><h3>Workload by status</h3><p>Where requests currently sit</p></div></div><div class="panel-body">${breakdown(summary)}</div></section>
          </div>
        </div>`;
      bindDetailLinks(content);
    } catch (error) {
      content.innerHTML = emptyState('alert', 'Could not load your overview', esc(error.message), '<button class="button button-secondary" onclick="location.reload()">Retry</button>');
    }
  }

  /* ---------- Requests list (shared by requests page and admin centre) ---------- */
  function filterToolbar(prefix) {
    const f = state.filters;
    return `<div class="toolbar" role="search">
      <div class="search-box">${icon('search')}<label class="sr-only" for="${prefix}-search">Search requests</label><input id="${prefix}-search" type="search" placeholder="Search by ticket, title or location…" value="${esc(f.q || '')}"></div>
      <label class="sr-only" for="${prefix}-status">Status</label>
      <select id="${prefix}-status"><option value="">All statuses</option>${STATUSES.map(s => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('')}</select>
      <label class="sr-only" for="${prefix}-category">Category</label>
      <select id="${prefix}-category"><option value="">All categories</option>${state.categories.map(c => `<option value="${c.id}" ${String(f.category) === String(c.id) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <button class="button button-ghost button-sm ${f.q || f.status || f.category ? '' : 'hidden'}" id="${prefix}-clear" type="button">${icon('close', 'icon-sm')} Clear filters</button>
    </div><div id="${prefix}-results">${skeleton(5)}</div>`;
  }

  function bindToolbar(prefix, reload) {
    const apply = () => {
      state.page = 1;
      $(`#${prefix}-clear`).classList.toggle('hidden', !(state.filters.q || state.filters.status || state.filters.category));
      const url = new URL(location.href);
      state.filters.status ? url.searchParams.set('status', state.filters.status) : url.searchParams.delete('status');
      history.replaceState(null, '', url);
      reload();
    };
    $(`#${prefix}-search`).addEventListener('input', debounce(event => { state.filters.q = event.target.value.trim(); apply(); }, 300));
    $(`#${prefix}-status`).addEventListener('change', event => { state.filters.status = event.target.value; apply(); });
    $(`#${prefix}-category`).addEventListener('change', event => { state.filters.category = event.target.value; apply(); });
    $(`#${prefix}-clear`).addEventListener('click', () => {
      state.filters = {};
      $(`#${prefix}-search`).value = ''; $(`#${prefix}-status`).value = ''; $(`#${prefix}-category`).value = '';
      apply();
    });
  }

  function pagination(p, onPage) {
    if (!p.total) return '';
    const from = (p.page - 1) * p.limit + 1;
    const to = Math.min(p.total, p.page * p.limit);
    const pages = Math.max(1, p.pages);
    const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter(n => pages <= 7 || n === 1 || n === pages || Math.abs(n - p.page) <= 1);
    let html = ''; let last = 0;
    numbers.forEach(n => { if (n - last > 1) html += '<button disabled>…</button>'; html += `<button data-page="${n}" class="${n === p.page ? 'active' : ''}" ${n === p.page ? 'aria-current="page"' : ''}>${n}</button>`; last = n; });
    setTimeout(() => $$('[data-page]').forEach(b => b.addEventListener('click', () => onPage(Number(b.dataset.page)))));
    return `<nav class="pagination" aria-label="Pagination"><span>Showing <strong>${from}–${to}</strong> of <strong>${p.total}</strong></span><div class="pagination-buttons">
      <button data-page="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''} aria-label="Previous page">${icon('chevronLeft', 'icon-sm')}</button>${html}
      <button data-page="${p.page + 1}" ${p.page >= pages ? 'disabled' : ''} aria-label="Next page">${icon('chevronRight', 'icon-sm')}</button></div></nav>`;
  }

  function requestRows(requests, { admin = false } = {}) {
    const showPeople = isAdmin() || isOfficer();
    return `<div class="table-wrap"><table class="data-table wide stack-mobile"><thead><tr>
      <th>Request</th><th>Category</th>${showPeople ? '<th>Requester</th>' : ''}<th>Priority</th><th>Status</th>${admin ? '<th>Assignee</th>' : '<th>Updated</th>'}<th><span class="sr-only">Action</span></th>
    </tr></thead><tbody>${requests.map(r => `
      <tr data-row-detail="${r.id}">
        <td><span class="ticket">${esc(r.ticket_no)}</span><span class="request-title" title="${esc(r.title)}">${esc(r.title)}</span><span class="request-sub">${icon('pin', 'icon-sm')} ${esc(r.location)}</span></td>
        <td data-hide-mobile class="nowrap">${esc(r.category)}</td>
        ${showPeople ? `<td data-hide-mobile>${person(r.requester, true)}</td>` : ''}
        <td>${priorityPill(r.priority)}</td>
        <td>${statusPill(r.status)}</td>
        ${admin ? `<td data-hide-mobile>${person(r.officer_name)}</td>` : `<td class="muted" data-hide-mobile title="${esc(dateTimeLabel(r.updated_at))}">${esc(timeAgo(r.updated_at || r.created_at))}</td>`}
        <td><button class="table-action" data-detail="${r.id}">${admin ? 'Manage' : 'Open'} ${icon('arrowRight', 'icon-sm')}</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  async function loadRequestList(prefix, { admin = false, limit = 8, silent = false } = {}) {
    const target = $(`#${prefix}-results`);
    if (!target) return;
    if (!silent) target.innerHTML = skeleton(5);
    const query = new URLSearchParams({ page: state.page, limit });
    Object.entries(state.filters).forEach(([k, v]) => { if (v) query.set(k, v); });
    try {
      const result = await api(`/requests?${query}`);
      if (!result.requests.length && result.pagination.total && state.page > 1) { state.page = 1; return loadRequestList(prefix, { admin, limit, silent }); }
      const filtered = state.filters.q || state.filters.status || state.filters.category;
      target.innerHTML = result.requests.length
        ? requestRows(result.requests, { admin }) + pagination(result.pagination, page => { state.page = page; loadRequestList(prefix, { admin, limit }); target.scrollIntoView({ block: 'nearest' }); })
        : filtered
          ? emptyState('search', 'No matching requests', 'Try a different search term or clear the filters.')
          : emptyState('inbox', isOfficer() ? 'Your queue is clear' : 'No requests yet', isOfficer() ? 'New jobs will appear here as soon as they are assigned to you.' : 'Submitted requests will be listed here.', canCreate() ? `<button class="button button-primary" data-open-new-request>${icon('plus')} New request</button>` : '');
      bindDetailLinks(target);
      if (prefix === 'admin') { const c = $('#tab-count-requests'); if (c) c.textContent = result.pagination.total; }
    } catch (error) {
      target.innerHTML = emptyState('alert', 'Could not load requests', esc(error.message));
    }
  }

  async function renderRequests() {
    const heading = isOfficer() ? 'My work' : isAdmin() ? 'All service requests' : 'My requests';
    const intro = isOfficer() ? 'Jobs assigned to you. Open one to record progress.' : isAdmin() ? 'Every request across campus. Open one to see its full history.' : 'Everything you have reported, with live status.';
    $('#page-content').innerHTML = `
      <div class="page-header"><div><p class="eyebrow">Service requests</p><h1>${heading}</h1><p>${intro}</p></div>
        ${canCreate() ? `<div class="page-header-actions"><button class="button button-primary" data-open-new-request>${icon('plus')} New request</button></div>` : ''}</div>
      <section class="panel">${filterToolbar('req')}</section>`;
    bindToolbar('req', () => loadRequestList('req'));
    await loadRequestList('req');
    api('/dashboard').then(({ summary }) => updateCounters(summary)).catch(() => {});
  }

  /* ---------- Admin centre ---------- */
  async function renderAdmin() {
    const content = $('#page-content');
    content.innerHTML = `
      <div class="page-header"><div><p class="eyebrow">Administration</p><h1>Admin centre</h1><p>Assign work, manage people and export reports.</p></div></div>
      <div id="admin-metrics">${skeleton(2)}</div>
      <div class="admin-tabs" role="tablist" aria-label="Admin sections">
        <button class="admin-tab" role="tab" data-admin-tab="requests">${icon('list', 'icon-sm')} Requests <span class="count" id="tab-count-requests">–</span></button>
        <button class="admin-tab" role="tab" data-admin-tab="users">${icon('users', 'icon-sm')} Users <span class="count" id="tab-count-users">–</span></button>
        <button class="admin-tab" role="tab" data-admin-tab="reports">${icon('download', 'icon-sm')} Reports</button>
      </div>
      <section class="panel" data-admin-panel="requests" role="tabpanel">
        <div class="panel-header"><div><h3>Request queue</h3><p>Open a request to assign an officer or change its status.</p></div><button class="button button-secondary button-sm" id="refresh-admin" type="button">${icon('refresh', 'icon-sm')} Refresh</button></div>
        ${filterToolbar('admin')}
      </section>
      <section class="panel" data-admin-panel="users" role="tabpanel">
        <div class="panel-header"><div><h3>People directory</h3><p>Everyone with access to MivaFix and their role.</p></div></div>
        <div class="toolbar"><div class="search-box">${icon('search')}<label class="sr-only" for="user-search">Search users</label><input id="user-search" type="search" placeholder="Search by name or email…"></div>
          <label class="sr-only" for="user-role">Role</label><select id="user-role"><option value="">All roles</option>${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div id="admin-users">${skeleton(4)}</div>
      </section>
      <section class="panel" data-admin-panel="reports" role="tabpanel">
        <div class="panel-header"><div><h3>Export request report</h3><p>Download requests created in a date range. Leave dates empty to export everything.</p></div></div>
        <form class="export-card" id="export-form" novalidate>
          <label>From<input type="date" id="export-from" name="from"></label>
          <label>To<input type="date" id="export-to" name="to"></label>
          <span class="spacer"></span>
          <button class="button button-secondary" type="button" data-export="csv">${icon('download', 'icon-sm')} Download CSV</button>
          <button class="button button-primary" type="button" data-export="pdf">${icon('file', 'icon-sm')} Download PDF</button>
        </form>
        <div class="panel-body" style="border-top:1px solid var(--line)"><p class="muted" style="margin:0;font-size:13px">Developers: the machine-readable OpenAPI description of every endpoint is at <a class="link-button" href="${API}/docs" target="_blank" rel="noopener">/api/docs ${icon('arrowRight', 'icon-sm')}</a></p></div>
      </section>`;

    const showTab = tab => {
      state.adminTab = tab;
      $$('[data-admin-tab]').forEach(t => { const on = t.dataset.adminTab === tab; t.classList.toggle('active', on); t.setAttribute('aria-selected', String(on)); });
      $$('[data-admin-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.adminPanel !== tab));
    };
    $$('[data-admin-tab]').forEach(t => t.addEventListener('click', () => showTab(t.dataset.adminTab)));
    showTab(state.adminTab);
    bindToolbar('admin', () => loadRequestList('admin', { admin: true, limit: 10 }));
    $('#refresh-admin').addEventListener('click', async event => { setLoading(event.currentTarget, true); await refreshAdmin(); setLoading(event.currentTarget, false); toast('Admin data refreshed.', 'info'); });
    $('#user-search').addEventListener('input', debounce(renderUsers, 200));
    $('#user-role').addEventListener('change', renderUsers);
    $$('[data-export]').forEach(button => button.addEventListener('click', () => {
      const from = $('#export-from').value; const to = $('#export-to').value;
      if (from && to && from > to) { MivaFix.setFieldError($('#export-to'), 'End date must be on or after the start date.'); return; }
      MivaFix.setFieldError($('#export-to'), '');
      const query = new URLSearchParams(); if (from) query.set('from', from); if (to) query.set('to', to);
      window.location.href = `${API}/export/requests.${button.dataset.export}${query.toString() ? `?${query}` : ''}`;
      toast(`Preparing your ${button.dataset.export.toUpperCase()} report…`, 'info');
    }));
    await refreshAdmin();
  }

  async function refreshAdmin({ silent = false } = {}) {
    const tasks = [loadRequestList('admin', { admin: true, limit: 10, silent }), api('/dashboard').then(({ summary }) => { state.summary = summary; updateCounters(summary); $('#admin-metrics').innerHTML = metricCards(summary); }).catch(error => toast(error.message, 'error')), api('/users').then(result => { state.users = result.users || []; renderUsers(); }).catch(error => { $('#admin-users').innerHTML = emptyState('alert', 'Could not load users', esc(error.message)); })];
    await Promise.all(tasks);
  }

  function renderUsers() {
    const term = ($('#user-search')?.value || '').toLowerCase();
    const role = $('#user-role')?.value || '';
    const users = state.users.filter(u => (!role || u.role === role) && (!term || `${u.full_name} ${u.email}`.toLowerCase().includes(term)));
    $('#tab-count-users').textContent = state.users.length;
    $('#admin-users').innerHTML = users.length ? `<div class="table-wrap"><table class="data-table wide"><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Joined</th></tr></thead><tbody>${users.map(u => `
      <tr><td>${person(u.full_name, true)}</td><td>${esc(u.email)}</td><td class="muted">${esc(u.phone || '—')}</td><td><span class="role-pill role-${esc(u.role)}">${esc(ROLE_LABEL[u.role] || u.role)}</span></td>
      <td>${Number(u.is_active) ? '<span class="status-pill status-completed">Active</span>' : '<span class="status-pill status-cancelled">Disabled</span>'}</td><td class="muted">${dateLabel(u.created_at)}</td></tr>`).join('')}</tbody></table></div>`
      : emptyState('users', 'No users match', 'Try a different name, email or role.');
  }

  /* ---------- Modal infrastructure ---------- */
  function openModal(html, { wide = false, labelledBy = 'modal-title' } = {}) {
    state.lastFocus = document.activeElement;
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-backdrop" data-backdrop><section class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${labelledBy}">${html}</section></div>`;
    document.body.style.overflow = 'hidden';
    $('[data-backdrop]', root).addEventListener('mousedown', event => { if (event.target.matches('[data-backdrop]')) closeModal(); });
    $$('[data-close-modal]', root).forEach(b => b.addEventListener('click', closeModal));
    setTimeout(() => ($('[autofocus]', root) || $('.modal-close', root))?.focus(), 30);
    return root;
  }

  function closeModal() {
    $('#modal-root').innerHTML = '';
    document.body.style.overflow = '';
    state.lastFocus?.focus?.();
  }

  document.addEventListener('keydown', event => {
    const modal = $('#modal-root .modal');
    if (!modal) return;
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); return; }
    if (event.key === 'Tab') {
      const focusable = $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])', modal).filter(el => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });

  const modalHeader = (eyebrow, title, extra = '') => `<div class="modal-header"><div>${eyebrow ? `<div class="modal-header-meta">${eyebrow}</div>` : ''}<h2 id="modal-title">${title}</h2>${extra}</div><button class="modal-close" type="button" data-close-modal aria-label="Close dialog">${icon('close')}</button></div>`;

  function bindDetailLinks(root) {
    $$('[data-detail]', root).forEach(b => b.addEventListener('click', event => { event.stopPropagation(); openRequest(b.dataset.detail); }));
    $$('[data-row-detail]', root).forEach(row => row.addEventListener('click', event => { if (!event.target.closest('a, button')) openRequest(row.dataset.rowDetail); }));
  }

  /* ---------- New request ---------- */
  function openNewRequest() {
    const root = openModal(`${modalHeader('<p class="eyebrow">New service request</p>', 'What needs fixing?')}
      <div class="modal-body">
        <form id="request-form" class="form-grid" novalidate>
          <label class="field full"><span class="label-row">Issue title <span class="hint" data-count-for="title">0 / 180</span></span>
            <input name="title" data-label="Issue title" placeholder="e.g. Ceiling light not working in Lab 2" required minlength="5" maxlength="180" autofocus></label>
          <label class="field">Category
            <select name="category_id" data-label="Category" required><option value="">Choose a category</option>${state.categories.map(c => `<option value="${c.id}" title="${esc(c.description || '')}">${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field">Priority
            <select name="priority" data-label="Priority"><option value="low">Low — can wait a few days</option><option value="medium" selected>Medium — normal response</option><option value="high">High — disrupting classes or work</option><option value="urgent">Urgent — safety risk</option></select></label>
          <label class="field full">Location
            <input name="location" data-label="Location" placeholder="Building, floor and room — e.g. Hostel Block C, Room 214" required maxlength="180"></label>
          <label class="field full"><span class="label-row">What is happening? <span class="hint" data-count-for="description">0 characters · min 15</span></span>
            <textarea name="description" data-label="Description" placeholder="Describe the fault, when it started and anything the officer should know before arriving…" required minlength="15"></textarea></label>
          <div class="field full"><span class="label-row">Photo evidence <span class="optional">Optional · JPG, PNG, WEBP or GIF up to 5 MB</span></span>
            <label class="dropzone" id="dropzone"><input type="file" name="evidence" accept="${EVIDENCE_TYPES.join(',')}" aria-label="Upload a photo of the fault"><span class="dropzone-icon" id="dropzone-preview">${icon('upload')}</span><span id="dropzone-text"><strong>Add a photo of the fault</strong><small>Click to browse or drag an image here</small></span></label>
            <button type="button" class="button button-ghost button-sm hidden" id="evidence-clear" style="justify-self:start">${icon('close', 'icon-sm')} Remove photo</button>
          </div>
          <div class="full form-actions"><button type="button" class="button button-ghost" data-close-modal>Cancel</button><button class="button button-primary" type="submit">${icon('send', 'icon-sm')} Submit request</button></div>
        </form>
      </div>`, { wide: true });
    const form = $('#request-form', root);
    liveValidate(form);
    const counter = name => { const field = form[name]; const hint = $(`[data-count-for="${name}"]`, form); const n = field.value.trim().length; hint.textContent = name === 'title' ? `${field.value.length} / 180` : `${n} character${n === 1 ? '' : 's'}${n < 15 ? ' · min 15' : ''}`; };
    form.title.addEventListener('input', () => counter('title'));
    form.description.addEventListener('input', () => counter('description'));

    const fileInput = form.evidence;
    const dropzone = $('#dropzone', form);
    const resetEvidence = () => { fileInput.value = ''; $('#dropzone-preview').innerHTML = icon('upload'); $('#dropzone-text').innerHTML = '<strong>Add a photo of the fault</strong><small>Click to browse or drag an image here</small>'; $('#evidence-clear').classList.add('hidden'); MivaFix.setFieldError(fileInput, ''); };
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return resetEvidence();
      if (!EVIDENCE_TYPES.includes(file.type)) { resetEvidence(); MivaFix.setFieldError(fileInput, 'Only JPG, PNG, WEBP or GIF images can be uploaded.'); return; }
      if (file.size > MAX_EVIDENCE) { resetEvidence(); MivaFix.setFieldError(fileInput, `That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is 5 MB.`); return; }
      MivaFix.setFieldError(fileInput, '');
      const url = URL.createObjectURL(file);
      $('#dropzone-preview').innerHTML = `<img src="${url}" alt="Selected evidence preview">`;
      $('#dropzone-text').innerHTML = `<strong>${esc(file.name)}</strong><small>${(file.size / 1024).toFixed(0)} KB · ready to upload</small>`;
      $('#evidence-clear').classList.remove('hidden');
    });
    $('#evidence-clear').addEventListener('click', resetEvidence);
    ['dragenter', 'dragover'].forEach(e => dropzone.addEventListener(e, () => dropzone.classList.add('dragging')));
    ['dragleave', 'drop'].forEach(e => dropzone.addEventListener(e, () => dropzone.classList.remove('dragging')));

    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (!validateForm(form)) return;
      const button = $('[type=submit]', form);
      setLoading(button, true);
      try {
        const result = await api('/requests', { method: 'POST', body: new FormData(form) });
        closeModal();
        toast(`${result.message} You'll be notified as it progresses.`);
        state.liveSignature = '';
        await refreshCurrent();
        if (result.id) openRequest(result.id);
      } catch (error) {
        setLoading(button, false);
        showServerErrors(form, error);
      }
    });
  }

  /* ---------- Request detail ---------- */
  function stepper(status) {
    if (status === 'cancelled') return `<div class="stepper cancelled">${icon('info', 'icon-sm')} This request was cancelled and is closed.</div>`;
    const flow = ['submitted', 'assigned', 'in_progress', 'completed'];
    const at = flow.indexOf(status);
    return `<ol class="stepper" aria-label="Request progress" style="list-style:none">${flow.map((s, i) => `<li class="step ${i < at || status === 'completed' ? 'done' : i === at ? 'current' : ''}" ${i === at ? 'aria-current="step"' : ''}><span class="step-dot">${i < at || status === 'completed' ? icon('check', 'icon-sm') : ''}</span>${STATUS_LABEL[s]}</li>`).join('')}</ol>`;
  }

  async function getOfficers() {
    if (!state.officers) state.officers = (await api('/officers')).officers || [];
    return state.officers;
  }

  async function openRequest(id) {
    const root = openModal(`${modalHeader('<p class="eyebrow">Loading request</p>', '&nbsp;')}<div class="modal-body">${skeleton(6)}</div>`, { wide: true });
    try {
      const [{ request: r }, officers] = await Promise.all([api(`/requests/${id}`), isAdmin() ? getOfficers() : Promise.resolve([])]);
      if (!$('#modal-root .modal')) return; // closed while loading
      const canUpdate = isAdmin() || isOfficer();
      const choices = isAdmin() ? STATUSES : ['assigned', 'in_progress', 'completed'];
      const next = { submitted: isAdmin() ? 'assigned' : 'in_progress', assigned: 'in_progress', in_progress: 'completed' }[r.status] || r.status;
      const closed = ['completed', 'cancelled'].includes(r.status);
      const evidence = r.evidence_path ? `<a class="evidence" href="${API}/requests/${r.id}/evidence" target="_blank" rel="noopener"><img src="${API}/requests/${r.id}/evidence" alt="Evidence photo for ${esc(r.ticket_no)}" loading="lazy"><span><strong>${icon('image', 'icon-sm')} Photo evidence</strong><span>Uploaded by the requester · open full size</span></span></a>` : '';
      const timeline = r.updates?.length
        ? `<div class="timeline">${r.updates.map(u => `<div class="timeline-item"><span class="timeline-dot"></span><div><strong>${esc(STATUS_LABEL[u.status] || u.status)}</strong><p>${esc(u.note)}</p><time datetime="${esc(u.created_at)}" title="${esc(dateTimeLabel(u.created_at))}">${esc(u.actor)} · ${esc(timeAgo(u.created_at))}</time></div></div>`).join('')}</div>`
        : '<p class="muted">No activity recorded yet.</p>';
      const assignCard = isAdmin() ? `<div class="action-card"><h3>${icon('user', 'icon-sm')} ${r.officer_name ? 'Reassign officer' : 'Assign an officer'}</h3><p>${r.officer_name ? `Currently assigned to <strong>${esc(r.officer_name)}</strong>.` : 'Assigning notifies the officer and the requester, and moves the request to “Assigned”.'}</p>
          <form class="action-row" id="assign-form" novalidate><label class="field"><span class="sr-only">Maintenance officer</span><select name="officer_id" data-label="Officer" required ${officers.length ? '' : 'disabled'}>${officers.length ? `<option value="">Choose a maintenance officer</option>${officers.map(o => `<option value="${o.id}" ${o.full_name === r.officer_name ? 'selected' : ''}>${esc(o.full_name)}</option>`).join('')}` : '<option value="">No active maintenance officers</option>'}</select></label>
          <button class="button button-secondary" type="submit" ${officers.length ? '' : 'disabled'}>${r.officer_name ? 'Reassign' : 'Assign'}</button></form></div>` : '';
      const statusCard = canUpdate ? `<div class="action-card"><h3>${icon('refresh', 'icon-sm')} Update progress</h3><p>${closed && !isAdmin() ? 'This job is closed. Contact an administrator to reopen it.' : 'The requester is notified of every status change. Add a note so they know what happened.'}</p>
          <form class="action-stack" id="status-form" novalidate>
            <label class="field"><span class="sr-only">New status</span><select name="status" data-label="Status" ${closed && !isAdmin() ? 'disabled' : ''}>${choices.map(s => `<option value="${s}" ${s === next ? 'selected' : ''}>${STATUS_LABEL[s]}${s === r.status ? ' (current)' : ''}</option>`).join('')}</select></label>
            <label class="field"><span class="sr-only">Note for the requester</span><textarea name="note" data-label="Note" maxlength="500" placeholder="Optional note, e.g. “Replaced the faulty ballast and tested the light.”" ${closed && !isAdmin() ? 'disabled' : ''}></textarea></label>
            <button class="button button-primary" type="submit" ${closed && !isAdmin() ? 'disabled' : ''}>Save update</button>
          </form></div>` : '';

      root.querySelector('.modal').innerHTML = `${modalHeader(`<span class="ticket">${esc(r.ticket_no)}</span>${statusPill(r.status)}${priorityPill(r.priority)}`, esc(r.title))}
        <div class="modal-body">
          ${stepper(r.status)}
          <div class="detail-grid">
            <div><span class="detail-label">Category</span><span class="detail-value">${esc(r.category)}</span></div>
            <div><span class="detail-label">Location</span><span class="detail-value">${esc(r.location)}</span></div>
            <div><span class="detail-label">Requester</span><span class="detail-value">${esc(r.requester)}</span></div>
            <div><span class="detail-label">Assigned officer</span><span class="detail-value">${r.officer_name ? esc(r.officer_name) : '<span class="unassigned">Not yet assigned</span>'}</span></div>
            <div><span class="detail-label">Submitted</span><span class="detail-value">${esc(dateTimeLabel(r.created_at))}</span></div>
            <div><span class="detail-label">Last updated</span><span class="detail-value">${esc(timeAgo(r.updated_at))}</span></div>
          </div>
          <span class="detail-label">Description</span>
          <p class="description-box">${esc(r.description)}</p>
          ${evidence}
          <h3 class="modal-section-title">Activity trail</h3>
          ${timeline}
          ${assignCard}${statusCard}
        </div>`;
      $$('[data-close-modal]', root).forEach(b => b.addEventListener('click', closeModal));
      $('.modal-close', root)?.focus();

      const assignForm = $('#assign-form', root);
      if (assignForm) { liveValidate(assignForm); assignForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!validateForm(assignForm)) return;
        const button = $('[type=submit]', assignForm); setLoading(button, true);
        try {
          const result = await api(`/requests/${id}/assign`, { method: 'POST', body: { officer_id: assignForm.officer_id.value } });
          toast(result.message); await afterChange(id);
        } catch (error) { setLoading(button, false); showServerErrors(assignForm, error); }
      }); }

      const statusForm = $('#status-form', root);
      if (statusForm) statusForm.addEventListener('submit', async event => {
        event.preventDefault();
        const status = statusForm.status.value;
        const note = statusForm.note.value.trim() || `Status changed to ${STATUS_LABEL[status]}.`;
        const button = $('[type=submit]', statusForm); setLoading(button, true);
        try {
          const result = await api(`/requests/${id}/status`, { method: 'POST', body: { status, note } });
          toast(`${result.message} ${r.ticket_no} is now ${STATUS_LABEL[status]}.`); await afterChange(id);
        } catch (error) { setLoading(button, false); showServerErrors(statusForm, error); }
      });
    } catch (error) {
      root.querySelector('.modal').innerHTML = `${modalHeader('', 'Request unavailable')}<div class="modal-body">${emptyState('alert', 'We could not open this request', esc(error.message))}</div>`;
      $$('[data-close-modal]', root).forEach(b => b.addEventListener('click', closeModal));
    }
  }

  async function afterChange(id) {
    state.liveSignature = '';
    await refreshCurrent({ silent: true });
    openRequest(id);
  }

  /* ---------- Notifications ---------- */
  async function openNotifications() {
    const root = openModal(`${modalHeader('<p class="eyebrow">Service desk</p>', 'Notifications')}<div class="modal-body">${skeleton(4)}</div>`);
    try {
      const { notifications = [] } = await api('/notifications');
      const unread = notifications.filter(n => !Number(n.is_read)).length;
      $('.modal-body', root).outerHTML = `<div class="modal-body">${notifications.length ? `<p class="muted" style="margin:0 0 12px;font-size:13px">${unread ? `${unread} new since you last checked.` : 'You are all caught up.'}</p><div class="notification-list">${notifications.map(n => `
          <${n.request_id ? 'button type="button"' : 'div'} class="notification-item ${Number(n.is_read) ? '' : 'unread'}" ${n.request_id ? `data-notification-request="${n.request_id}"` : ''}>
            <span class="notification-icon">${icon('bell', 'icon-sm')}</span>
            <span><p>${esc(n.message)}</p><small>${n.ticket_no ? `${esc(n.ticket_no)} · ` : ''}${esc(timeAgo(n.created_at))}</small></span>
          </${n.request_id ? 'button' : 'div'}>`).join('')}</div>`
        : emptyState('bell', 'No notifications yet', 'Updates about your requests and assignments will appear here.')}</div>`;
      $$('[data-notification-request]', root).forEach(b => b.addEventListener('click', () => openRequest(b.dataset.notificationRequest)));
      if (unread) { await api('/notifications/read', { method: 'POST' }); if (state.summary) { state.summary.unread_notifications = 0; updateCounters(state.summary); } }
    } catch (error) {
      $('.modal-body', root).innerHTML = emptyState('alert', 'Could not load notifications', esc(error.message));
    }
  }

  /* ---------- Live refresh (AJAX polling) ---------- */
  async function refreshCurrent({ silent = true } = {}) {
    if (state.view === 'dashboard') return renderDashboard({ silent });
    if (state.view === 'requests') return loadRequestList('req', { silent });
    if (state.view === 'admin') return refreshAdmin({ silent });
  }

  function startLiveRefresh() {
    clearInterval(state.liveTimer);
    state.liveTimer = setInterval(refreshLiveData, 10000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLiveData(); });
  }

  async function refreshLiveData() {
    if (!state.user || document.hidden) return;
    try {
      const { summary } = await api('/dashboard');
      const previousUnread = Number(state.summary?.unread_notifications || 0);
      state.summary = summary;
      updateCounters(summary);
      if (summary.unread_notifications > previousUnread) toast('You have a new notification.', 'info');
      const sync = $('#sync-status span:last-child');
      if (sync) sync.textContent = `Live · ${new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date())}`;
      const signature = JSON.stringify([summary.total, summary.by_status, summary.latest]);
      if (!state.liveSignature) { state.liveSignature = signature; return; }
      if (signature === state.liveSignature || $('#modal-root').children.length || document.activeElement?.matches('input, select, textarea')) return;
      state.liveSignature = signature;
      await refreshCurrent({ silent: true });
    } catch {
      const sync = $('#sync-status span:last-child');
      if (sync) sync.textContent = 'Reconnecting…';
    }
  }

  boot();
})();
