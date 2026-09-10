/* ===========================================================================
   DGSS Live Tracking dashboard
   Reads guard positions from Supabase and keeps a map in sync in real time.
   =========================================================================== */

const CFG = window.DGSS_CONFIG;

const els = {
  login: document.getElementById('login'),
  loginForm: document.getElementById('loginForm'),
  loginBtn: document.getElementById('loginBtn'),
  loginError: document.getElementById('loginError'),
  email: document.getElementById('email'),
  password: document.getElementById('password'),
  shell: document.getElementById('shell'),
  list: document.getElementById('list'),
  filter: document.getElementById('filter'),
  signOut: document.getElementById('signOut'),
  cLive: document.getElementById('cLive'),
  cStale: document.getElementById('cStale'),
  cOff: document.getElementById('cOff'),
  btnLive: document.getElementById('btnLive'),
  btnHist: document.getElementById('btnHist'),
  histDate: document.getElementById('histDate'),
  tabGuards: document.getElementById('tabGuards'),
  tabScans: document.getElementById('tabScans'),
  scanList: document.getElementById('scanList'),
  manageBtn: document.getElementById('manageBtn'),
  manage: document.getElementById('manage'),
  manageClose: document.getElementById('manageClose'),
  guardForm: document.getElementById('guardForm'),
  gEditing: document.getElementById('gEditing'),
  gUser: document.getElementById('gUser'),
  gPass: document.getElementById('gPass'),
  gName: document.getElementById('gName'),
  gBadge: document.getElementById('gBadge'),
  gSite: document.getElementById('gSite'),
  gPhone: document.getElementById('gPhone'),
  gSave: document.getElementById('gSave'),
  gCancel: document.getElementById('gCancel'),
  gError: document.getElementById('gError'),
  gOk: document.getElementById('gOk'),
  gHint: document.getElementById('gHint'),
  gBody: document.getElementById('gBody')
};

let sb = null;
let map = null;
let markers = new Map();      // guard_id -> L.Marker
let guards = new Map();       // guard_id -> row from v_guard_status
let selectedId = null;
let historyLayer = null;
let realtimeChannel = null;
let scanChannel = null;
let tickTimer = null;
let scans = [];
let scanMarker = null;
let activeTab = 'guards';
let roster = [];

/* ---------------------------------------------------------------- helpers */

function fail(message) {
  els.loginError.textContent = message;
  els.loginError.style.display = 'block';
}

function secondsAgo(iso) {
  if (!iso) return Infinity;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
}

function statusOf(row) {
  const age = secondsAgo(row.recorded_at);
  if (age === Infinity) return 'off';
  if (age <= CFG.FRESH_SECONDS) return 'ok';
  if (age <= CFG.STALE_SECONDS) return 'warn';
  return 'off';
}

function ago(iso) {
  const s = secondsAgo(iso);
  if (s === Infinity) return 'never reported';
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ login */

async function boot() {
  if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('YOUR-PROJECT')) {
    fail('config.js still has placeholder values. Add your Supabase URL and anon key.');
    els.loginBtn.disabled = true;
    return;
  }

  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  const { data: { session } } = await sb.auth.getSession();
  if (session) await enterDashboard();
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  els.loginError.style.display = 'none';
  els.loginBtn.disabled = true;
  els.loginBtn.textContent = 'Signing in...';

  // Supervisors log in with a short username too. Anything without an "@"
  // gets the hidden domain appended, matching what the phone app does.
  const typed = els.email.value.trim().toLowerCase();
  const email = typed.includes('@') ? typed : `${typed}@dgss.local`;

  const { error } = await sb.auth.signInWithPassword({
    email,
    password: els.password.value
  });

  if (error) {
    fail(error.message === 'Invalid login credentials'
      ? 'Incorrect username or password.' : error.message);
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = 'Sign in';
    return;
  }

  // Being able to sign in is not the same as being allowed to see guards.
  // Row Level Security decides that, and it keys off the admins table.
  const { data: { user } } = await sb.auth.getUser();
  const { data: adminRow } = await sb.from('admins').select('id').eq('id', user.id).maybeSingle();

  if (!adminRow) {
    await sb.auth.signOut();
    fail('This account is not a supervisor account. Ask for admin access.');
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = 'Sign in';
    return;
  }

  await enterDashboard();
});

els.signOut.addEventListener('click', async () => {
  if (realtimeChannel) await sb.removeChannel(realtimeChannel);
  if (scanChannel) await sb.removeChannel(scanChannel);
  if (tickTimer) clearInterval(tickTimer);
  await sb.auth.signOut();
  location.reload();
});

/* -------------------------------------------------------------- dashboard */

async function enterDashboard() {
  els.login.style.display = 'none';
  els.shell.classList.add('live');

  els.histDate.value = new Date().toISOString().slice(0, 10);

  initMap();
  await loadGuards();
  await loadScans();
  subscribeRealtime();
  subscribeScans();

  // Re-render once a minute so the "3m ago" labels stay honest even when
  // nothing new arrives.
  tickTimer = setInterval(() => { renderList(); renderScans(); }, 30000);
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView(CFG.DEFAULT_CENTER, CFG.DEFAULT_ZOOM);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);
}

async function loadGuards() {
  const { data, error } = await sb
    .from('v_guard_status')
    .select('*')
    .eq('active', true);

  if (error) {
    console.error(error);
    els.list.innerHTML = '<div class="empty">Could not load guards. ' + esc(error.message) + '</div>';
    return;
  }

  guards.clear();
  data.forEach(row => guards.set(row.guard_id, row));
  renderAll();
  fitToGuards();
}

async function loadScans() {
  // The last 24 hours is what a supervisor actually acts on. Older scans are
  // still in the database and reachable through a guard's daily track.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data, error } = await sb
    .from('v_scan_feed')
    .select('*')
    .gte('scanned_at', since)
    .order('scanned_at', { ascending: false })
    .limit(500);

  if (error) {
    console.error(error);
    els.scanList.innerHTML = '<div class="empty">Could not load scans. ' + esc(error.message) + '</div>';
    return;
  }
  scans = data || [];
  renderScans();
}

function subscribeScans() {
  scanChannel = sb
    .channel('scan_feed')
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'checkpoint_scans' },
      async () => {
        // The row that arrives is the raw table, not the joined view, so
        // reload the feed to pick up the guard and checkpoint names.
        await loadScans();
      })
    .subscribe();
}

function subscribeRealtime() {
  realtimeChannel = sb
    .channel('last_known_changes')
    .on('postgres_changes',
      { event: '*', schema: 'public', table: 'last_known' },
      payload => {
        const row = payload.new;
        if (!row || !guards.has(row.guard_id)) return;

        // Merge the live fix into the guard record we already hold.
        const g = guards.get(row.guard_id);
        Object.assign(g, {
          lat: row.lat, lng: row.lng, accuracy: row.accuracy,
          speed: row.speed, bearing: row.bearing,
          battery: row.battery, is_charging: row.is_charging,
          is_mock: row.is_mock, recorded_at: row.recorded_at
        });
        renderAll();
      })
    .subscribe();
}

/* ------------------------------------------------------------- rendering */

function renderAll() {
  renderList();
  renderMarkers();
}

function visibleGuards() {
  const q = els.filter.value.trim().toLowerCase();
  let rows = Array.from(guards.values());
  if (q) {
    rows = rows.filter(g =>
      (g.full_name || '').toLowerCase().includes(q) ||
      (g.badge_no || '').toLowerCase().includes(q) ||
      (g.site || '').toLowerCase().includes(q));
  }
  // Live first, then most recently heard from.
  const rank = { ok: 0, warn: 1, off: 2 };
  return rows.sort((a, b) => {
    const d = rank[statusOf(a)] - rank[statusOf(b)];
    return d !== 0 ? d : secondsAgo(a.recorded_at) - secondsAgo(b.recorded_at);
  });
}

function renderList() {
  const rows = visibleGuards();

  let live = 0, stale = 0, off = 0;
  guards.forEach(g => {
    const s = statusOf(g);
    if (s === 'ok') live++; else if (s === 'warn') stale++; else off++;
  });
  els.cLive.textContent = live;
  els.cStale.textContent = stale;
  els.cOff.textContent = off;

  if (!rows.length) {
    els.list.innerHTML = '<div class="empty">No guards match.</div>';
    return;
  }

  els.list.innerHTML = rows.map(g => {
    const st = statusOf(g);
    const batt = (g.battery === null || g.battery === undefined || g.battery < 0)
      ? '' : g.battery + '%';
    const lowBatt = g.battery >= 0 && g.battery <= 20 ? ' low' : '';
    return `
      <div class="guard${g.guard_id === selectedId ? ' sel' : ''}" data-id="${esc(g.guard_id)}">
        <span class="dot ${st}"></span>
        <div class="who">
          <div class="nm">${esc(g.full_name)}</div>
          <div class="meta">${esc(g.badge_no || '')}${g.site ? ' &middot; ' + esc(g.site) : ''}</div>
          <div class="meta">${esc(ago(g.recorded_at))}</div>
          ${g.is_mock ? '<span class="flag">FAKE LOCATION</span>' : ''}
        </div>
        <div class="batt${lowBatt}">${batt}</div>
      </div>`;
  }).join('');

  els.list.querySelectorAll('.guard').forEach(el => {
    el.addEventListener('click', () => selectGuard(el.dataset.id));
  });
}

function iconFor(status) {
  const color = status === 'ok' ? '#27a567' : status === 'warn' ? '#d9a017' : '#6b7885';
  return L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};
           border:2.5px solid #0f1419;box-shadow:0 0 0 2px ${color}66"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });
}

function renderMarkers() {
  guards.forEach((g, id) => {
    if (g.lat === null || g.lat === undefined) return;
    const pos = [g.lat, g.lng];
    const st = statusOf(g);

    let m = markers.get(id);
    if (!m) {
      m = L.marker(pos, { icon: iconFor(st) }).addTo(map);
      m.on('click', () => selectGuard(id));
      markers.set(id, m);
    } else {
      m.setLatLng(pos);
      m.setIcon(iconFor(st));
    }

    const acc = g.accuracy ? `&plusmn;${Math.round(g.accuracy)} m` : 'unknown accuracy';
    const batt = (g.battery >= 0) ? `${g.battery}%${g.is_charging ? ' charging' : ''}` : 'unknown';
    m.bindPopup(`
      <b>${esc(g.full_name)}</b><br>
      ${esc(g.badge_no || '')}${g.site ? ' &middot; ' + esc(g.site) : ''}<br>
      Last fix ${esc(ago(g.recorded_at))}<br>
      Accuracy ${acc}<br>
      Battery ${batt}
      ${g.is_mock ? '<br><b style="color:#e05650">Reported a fake location</b>' : ''}
    `);
  });

  // Drop markers for guards no longer in the set.
  markers.forEach((m, id) => {
    if (!guards.has(id)) { map.removeLayer(m); markers.delete(id); }
  });
}

function scanReasons(s) {
  const why = [];
  if (s.is_mock) why.push('fake GPS');
  if (s.within_fence === false) why.push(`${s.distance_m} m from the checkpoint`);
  const drift = Math.abs((new Date(s.created_at) - new Date(s.scanned_at)) / 1000);
  if (drift > 900) why.push('phone clock is wrong');
  return why;
}

function renderScans() {
  const q = els.filter.value.trim().toLowerCase();
  const rows = q
    ? scans.filter(s =>
        (s.guard_name || '').toLowerCase().includes(q) ||
        (s.badge_no || '').toLowerCase().includes(q) ||
        (s.checkpoint_name || '').toLowerCase().includes(q) ||
        (s.site || '').toLowerCase().includes(q))
    : scans;

  const bad = scans.filter(s => s.suspicious).length;
  els.tabScans.innerHTML = 'Checkpoint scans' +
    (bad ? ` <span class="badge">${bad}</span>` : '');

  if (!rows.length) {
    els.scanList.innerHTML = '<div class="empty">No checkpoint scans in the last 24 hours.</div>';
    return;
  }

  els.scanList.innerHTML = rows.map(s => {
    const why = scanReasons(s);
    const time = new Date(s.scanned_at).toLocaleString([], {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const smsLine = (s.sms_sent + s.sms_failed) === 0
      ? 'No message sent'
      : s.sms_failed === 0
        ? `Message sent to ${s.sms_sent}`
        : `Message sent to ${s.sms_sent}, failed for ${s.sms_failed}`;
    return `
      <div class="scan${s.suspicious ? ' bad' : ''}" data-id="${s.id}">
        <div class="top">
          <span class="cp">${esc(s.checkpoint_name || s.raw_code)}</span>
          <span class="tm">${esc(time)}</span>
        </div>
        <div class="by">${esc(s.guard_name)}${s.badge_no ? ' &middot; ' + esc(s.badge_no) : ''}${s.site ? ' &middot; ' + esc(s.site) : ''}</div>
        ${why.length ? `<div class="why">${esc(why.join(' &middot; ').replace(/&amp;middot;/g, '&middot;'))}</div>` : ''}
        <div class="sms">${esc(smsLine)}</div>
      </div>`;
  }).join('');

  els.scanList.querySelectorAll('.scan').forEach(el => {
    el.addEventListener('click', () => showScanOnMap(Number(el.dataset.id)));
  });
}

/** Drops a pin where a scan was actually taken, so an off-site one is obvious. */
function showScanOnMap(id) {
  const s = scans.find(x => x.id === id);
  if (!s) return;
  if (s.lat === null || s.lat === undefined) {
    alert('That scan carried no GPS position, so it cannot be placed on the map.');
    return;
  }
  if (scanMarker) map.removeLayer(scanMarker);
  const color = s.suspicious ? '#e05650' : '#27a567';
  scanMarker = L.circleMarker([s.lat, s.lng], {
    radius: 10, color, fillColor: color, fillOpacity: 0.55, weight: 3
  }).addTo(map);
  const why = scanReasons(s);
  scanMarker.bindPopup(
    `<b>${esc(s.checkpoint_name || s.raw_code)}</b><br>` +
    `${esc(s.guard_name)}<br>` +
    `${new Date(s.scanned_at).toLocaleString()}` +
    (why.length ? `<br><b style="color:#e05650">${esc(why.join(', '))}</b>` : '')
  ).openPopup();
  map.setView([s.lat, s.lng], 17, { animate: true });
}

function fitToGuards() {
  const pts = Array.from(guards.values())
    .filter(g => g.lat !== null && g.lat !== undefined)
    .map(g => [g.lat, g.lng]);
  if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 16 });
}

function selectGuard(id) {
  selectedId = id;
  renderList();
  const g = guards.get(id);
  if (g && g.lat !== null && g.lat !== undefined) {
    map.setView([g.lat, g.lng], Math.max(map.getZoom(), 17), { animate: true });
    markers.get(id)?.openPopup();
  }
}

/* --------------------------------------------------------------- history */

els.btnHist.addEventListener('click', async () => {
  if (!selectedId) {
    alert('Choose a guard in the list first, then show their track.');
    return;
  }
  await showHistory(selectedId, els.histDate.value);
});

els.btnLive.addEventListener('click', () => {
  if (historyLayer) { map.removeLayer(historyLayer); historyLayer = null; }
  els.btnLive.classList.add('on');
  els.btnHist.classList.remove('on');
  fitToGuards();
});

async function showHistory(guardId, dateStr) {
  if (historyLayer) { map.removeLayer(historyLayer); historyLayer = null; }

  const from = new Date(dateStr + 'T00:00:00');
  const to = new Date(dateStr + 'T23:59:59.999');

  const { data, error } = await sb
    .from('locations')
    .select('lat,lng,recorded_at,accuracy')
    .eq('guard_id', guardId)
    .gte('recorded_at', from.toISOString())
    .lte('recorded_at', to.toISOString())
    .order('recorded_at', { ascending: true })
    .limit(5000);

  if (error) { alert('Could not load the track: ' + error.message); return; }
  if (!data.length) { alert('No positions recorded for that day.'); return; }

  const pts = data.map(r => [r.lat, r.lng]);
  historyLayer = L.layerGroup([
    L.polyline(pts, { color: '#2f7de1', weight: 3, opacity: 0.85 }),
    L.circleMarker(pts[0], { radius: 7, color: '#27a567', fillColor: '#27a567', fillOpacity: 1 })
      .bindPopup('Start ' + new Date(data[0].recorded_at).toLocaleTimeString()),
    L.circleMarker(pts[pts.length - 1], { radius: 7, color: '#e05650', fillColor: '#e05650', fillOpacity: 1 })
      .bindPopup('End ' + new Date(data[data.length - 1].recorded_at).toLocaleTimeString())
  ]).addTo(map);

  map.fitBounds(L.latLngBounds(pts).pad(0.2));
  els.btnHist.classList.add('on');
  els.btnLive.classList.remove('on');
}

function switchTab(tab) {
  activeTab = tab;
  const guards = tab === 'guards';
  els.tabGuards.classList.toggle('on', guards);
  els.tabScans.classList.toggle('on', !guards);
  els.list.hidden = !guards;
  els.scanList.hidden = guards;
  els.filter.placeholder = guards
    ? 'Search name, badge or site'
    : 'Search guard, checkpoint or site';
}

els.tabGuards.addEventListener('click', () => switchTab('guards'));
els.tabScans.addEventListener('click', () => switchTab('scans'));

els.filter.addEventListener('input', () => {
  if (activeTab === 'guards') renderList(); else renderScans();
});


/* ==========================================================================
   Guard management. Every call below is refused by the database unless the
   signed-in account is a supervisor, so this UI is a convenience rather than
   the thing enforcing the rule.
   ========================================================================== */

function gMessage(el, text) {
  el.textContent = text;
  el.style.display = text ? 'block' : 'none';
}

function clearGuardForm() {
  els.gEditing.value = '';
  els.guardForm.reset();
  els.gUser.disabled = false;
  els.gSave.textContent = 'Add guard';
  els.gCancel.hidden = true;
  els.gHint.textContent =
    'The guard types the username and password into the app. Nothing else.';
  gMessage(els.gError, '');
  gMessage(els.gOk, '');
}

async function openManage() {
  els.manage.hidden = false;
  clearGuardForm();
  await loadRoster();
}

async function loadRoster() {
  const { data, error } = await sb.rpc('list_guards');
  if (error) {
    els.gBody.innerHTML =
      `<tr><td colspan="7">Could not load guards. ${esc(error.message)}</td></tr>`;
    return;
  }
  roster = data || [];
  renderRoster();
}

function renderRoster() {
  if (!roster.length) {
    els.gBody.innerHTML = '<tr><td colspan="7">No guards yet. Add one above.</td></tr>';
    return;
  }
  els.gBody.innerHTML = roster.map(g => `
    <tr class="${g.active ? '' : 'off'}">
      <td><span class="uname">${esc(g.username)}</span></td>
      <td>${esc(g.full_name)}</td>
      <td>${esc(g.badge_no || '')}</td>
      <td>${esc(g.site || '')}</td>
      <td class="num">${g.positions}</td>
      <td><span class="tag ${g.active ? 'on' : 'off'}">${g.active ? 'Active' : 'Retired'}</span></td>
      <td style="text-align:right">
        <button class="rowbtn" data-act="edit" data-u="${esc(g.username)}">Edit</button>
        <button class="rowbtn" data-act="toggle" data-u="${esc(g.username)}">${g.active ? 'Retire' : 'Restore'}</button>
        <button class="rowbtn danger" data-act="delete" data-u="${esc(g.username)}">Delete</button>
      </td>
    </tr>`).join('');

  els.gBody.querySelectorAll('.rowbtn').forEach(btn => {
    btn.addEventListener('click', () => rowAction(btn.dataset.act, btn.dataset.u));
  });
}

async function rowAction(act, username) {
  const g = roster.find(x => x.username === username);
  if (!g) return;

  if (act === 'edit') {
    els.gEditing.value = username;
    els.gUser.value = username;
    els.gUser.disabled = true;          // the username is the identity, so it is fixed
    els.gName.value = g.full_name || '';
    els.gBadge.value = g.badge_no || '';
    els.gSite.value = g.site || '';
    els.gPhone.value = g.phone || '';
    els.gPass.value = '';
    els.gSave.textContent = 'Save changes';
    els.gCancel.hidden = false;
    els.gHint.textContent =
      'Leave the password blank to keep the current one. Type a new one to reset it.';
    gMessage(els.gError, '');
    gMessage(els.gOk, '');
    els.gName.focus();
    return;
  }

  if (act === 'toggle') {
    const fn = g.active ? 'retire_guard' : 'reinstate_guard';
    const { error } = await sb.rpc(fn, { username });
    if (error) { alert(error.message); return; }
    await loadRoster();
    await loadGuards();
    return;
  }

  if (act === 'delete') {
    const warn =
      `Delete guard "${username}" (${g.full_name})?\n\n` +
      `This also deletes ${g.positions} recorded positions and ${g.scans} checkpoint scans. ` +
      `It cannot be undone.\n\n` +
      `To keep their history instead, choose Retire.`;
    if (!confirm(warn)) return;
    if (prompt(`Type the username "${username}" to confirm deletion:`) !== username) return;

    const { data, error } = await sb.rpc('delete_guard', { username });
    if (error) { alert(error.message); return; }
    await loadRoster();
    await loadGuards();
    alert(data);
  }
}

els.guardForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  gMessage(els.gError, '');
  gMessage(els.gOk, '');

  const editing = els.gEditing.value;
  const username = els.gUser.value.trim();
  const password = els.gPass.value.trim();
  const name = els.gName.value.trim();

  if (!username || !name) {
    gMessage(els.gError, 'Username and full name are required.');
    return;
  }
  if (!editing && !password) {
    gMessage(els.gError, 'A password is required for a new guard.');
    return;
  }
  if (/[@\s]/.test(username)) {
    gMessage(els.gError, 'Username cannot contain spaces or an @ sign.');
    return;
  }

  els.gSave.disabled = true;

  // add_guard both creates and updates, but it always resets the password.
  // When editing without a new password, keep the existing one by reusing it
  // is impossible, so the details are updated through the guards table instead.
  let error = null;
  if (editing && !password) {
    ({ error } = await sb.from('guards').update({
      full_name: name,
      badge_no: els.gBadge.value.trim() || null,
      site: els.gSite.value.trim() || null,
      phone: els.gPhone.value.trim() || null
    }).eq('id', roster.find(x => x.username === editing).guard_id));
  } else {
    ({ error } = await sb.rpc('add_guard', {
      username,
      password,
      full_name: name,
      badge_no: els.gBadge.value.trim() || null,
      site: els.gSite.value.trim() || null,
      phone: els.gPhone.value.trim() || null
    }));
  }

  els.gSave.disabled = false;

  if (error) {
    gMessage(els.gError, error.message);
    return;
  }

  gMessage(els.gOk, editing
    ? `Saved changes for "${username}".`
    : `Guard "${username}" can now sign in with password "${password}".`);

  const keep = els.gOk.textContent;
  clearGuardForm();
  gMessage(els.gOk, keep);

  await loadRoster();
  await loadGuards();
});

els.gCancel.addEventListener('click', clearGuardForm);
els.manageBtn.addEventListener('click', openManage);
els.manageClose.addEventListener('click', () => { els.manage.hidden = true; });
els.manage.addEventListener('click', (e) => {
  if (e.target === els.manage) els.manage.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.manage.hidden) els.manage.hidden = true;
});


boot();
