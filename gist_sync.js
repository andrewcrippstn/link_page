/*
  gist_sync.js  --  OPTIONAL GitHub Gist sync for local_link_page.html
  ====================================================================
  Put this file in the same folder as local_link_page.html. If it is there, the page gains a cloud button (☁︎) in the header
  that keeps your tiles in a private gist in your GitHub account. If the file is not there, the page simply works without sync.

  This file only talks to the page through window.LinkPage (see "optional plugins" in local_link_page.html). It adds its own
  button, dialogs and styles, so nothing in the page needs to know about gists.

  Needs a GitHub token with the "gist" scope ("Create gists"). The token and gist ID are kept in this browser's localStorage
  and in the address bar as  ?gist=<id>&token=<token>  so the page address can be bookmarked / opened on your other devices.

  Whenever this file is changed, update the BUILD constant below (the page shows it when you hover over its footer).
*/
(function () {
'use strict';
const BUILD = '2026-11-10 11:23:00';
const LP = window.LinkPage;
if (!LP || !document.getElementById('hdrActions')) { console.warn('gist_sync.js: page not recognised, sync not loaded'); return; }
if (LP.addBuild) LP.addBuild('gist_sync.js', BUILD);
const { loadCsvData, saveCsvData, setData, render, parseCsv, showToast, copyToClipboard, pushUndo, currentPage } = LP;
const DEFAULT_HEADERS = LP.defaultHeaders;
const $ = id => document.getElementById(id);

/* ---------- add the sync button, dialogs and styles to the page ---------- */
const styleEl = document.createElement('style');
styleEl.textContent = `
    /* sync button (sits in the header's button group, like the other header buttons) */
    .sync-btn{position:absolute;top:0;width:40px;height:40px;background:white;border:2px solid #e0e0e0;border-radius:8px;
              display:none;align-items:center;justify-content:center;cursor:pointer;transition:.2s;color:#667eea;font-size:20px;font-weight:bold}
    .sync-btn:hover{border-color:#667eea;background:#f8f8ff}
    .sync-btn.show{display:flex}
    .sync-btn.synced{color:#aaa;opacity:.6}
    .sync-btn.err{border-color:#f87171}
    @media (max-width:720px){ header .hdr-actions > .sync-btn.synced{opacity:1} }
    #syncDialog,#conflictDialog{margin:auto;border:0;border-radius:10px;padding:0;width:min(520px,94vw);box-shadow:0 12px 40px rgba(0,0,0,.35)}
    #syncDialog::backdrop,#conflictDialog::backdrop{background:rgba(0,0,0,.45)}
    #syInfo{font-size:.8rem;color:#445;background:#eef0ff;border:1px solid #c9ceff;border-radius:4px;padding:6px 8px}
    #syMsg{font-size:.82rem;color:#c0392b;background:#fdecea;border:1px solid #e08a8a;border-radius:4px;padding:6px 8px;white-space:pre-line}
    #syMsg:empty{display:none}
    .gl-list{border:1px solid #ddd;border-radius:4px;max-height:220px;overflow:auto;font-size:.8rem}
    .gl-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #eee;flex-wrap:wrap}
    .gl-row:last-child{border-bottom:0}
    .gl-row.other{color:#999}
    .gl-row.current{background:#eef7f1}
    .gl-info{flex:1 1 160px;min-width:0}
    .gl-info b{display:block;font-weight:600;overflow-wrap:anywhere}
    .gl-info small{display:block;color:#888;overflow-wrap:anywhere}
    .gl-row .tbtn{padding:3px 8px;font-size:.75rem}
    .tile-fields label.gl-check{flex-direction:row;align-items:center;gap:6px;font-weight:400}
`;
document.head.appendChild(styleEl);
const syncBtnEl = document.createElement('button');
syncBtnEl.className = 'sync-btn'; syncBtnEl.id = 'syncBtn'; syncBtnEl.type = 'button'; syncBtnEl.title = 'Sync (not set up)'; syncBtnEl.textContent = '☁︎';
document.getElementById('hdrActions').insertAdjacentElement('afterbegin', syncBtnEl);
document.body.insertAdjacentHTML('beforeend', `
<dialog id="syncDialog">
    <div class="dlg tile-dlg">
        <div class="dlg-head"><span>Sync (GitHub Gist)</span></div>
        <div class="tile-fields">
            <div id="syInfo" style="white-space:pre-line"></div>
            <div id="syMsg"></div>
            <div id="syOff">
                <div>1. <a href="https://github.com/settings/tokens/new" target="_blank" rel="noopener">Create a GitHub token ↗</a> — tick only <b>“Create gists”</b> (the <code>gist</code> scope) and nothing else, then click Generate token and copy it.</div>
                <label style="margin-top:12px">2. Paste your token<input id="syId" type="password" spellcheck="false" autocomplete="off"></label>
                <label style="margin-top:6px">Gist ID or URL <small>(optional – leave blank to find or create it automatically)</small><input id="syGist" type="text" spellcheck="false" autocomplete="off"></label>
                <label class="gl-check"><input id="syNew" type="checkbox"> Create a <b>new</b> gist (don’t reuse an existing one)</label>
                <label>Name for a new gist <small>(optional – used when a gist is created; you can rename gists in the list)</small><input id="syName" type="text" spellcheck="false" autocomplete="off" placeholder="Homepage tiles (sync)"></label>
            </div>
            <div id="syOn" style="display:none">
                <label>Your sync link <small>(open it on any of your devices to use the same tiles)</small><input id="syLink" type="text" readonly></label>
            </div>
            <div><button class="tbtn" id="syList" type="button">List my gists</button></div>
            <div id="syGists" class="gl-list" style="display:none"></div>
        </div>
        <div class="dlg-foot">
            <button class="tbtn danger" id="syStop" type="button" style="display:none">Stop syncing</button>
            <span class="spacer"></span>
            <button class="tbtn" id="syCopy" type="button" style="display:none">Copy link</button>
            <button class="tbtn" id="syClose" type="button">Close</button>
            <button class="tbtn primary" id="syGo" type="button">Connect</button>
        </div>
    </div>
</dialog>
<dialog id="conflictDialog">
    <div class="dlg tile-dlg">
        <div class="dlg-head"><span>Sync conflict</span></div>
        <div class="tile-fields">
            <div id="cfInfo" style="white-space:pre-line"></div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="tbtn" id="cfCopyMine" type="button">Copy this device’s CSV</button>
                <button class="tbtn" id="cfCopyOnline" type="button">Copy online CSV</button>
            </div>
        </div>
        <div class="dlg-foot" style="flex-wrap:wrap">
            <button class="tbtn" id="cfLater" type="button">Decide later</button>
            <span class="spacer"></span>
            <button class="tbtn" id="cfOnline" type="button">Use online</button>
            <button class="tbtn danger" id="cfKeep" type="button">Keep this device</button>
        </div>
    </div>
</dialog>
`);

/* ======================= Sync (private GitHub Gist) ======================= */
// Tiles live in one secret gist in YOUR GitHub account: tiles.csv (the data) + meta.json (last-change timestamp).
// Needs a GitHub token with the "gist" scope ("Create gists"). Token and gist ID are kept in this browser's localStorage
// AND in the address bar as  ?gist=<gist id>&token=<token>  so the page URL can be bookmarked / opened on your other devices.
// When the page is opened with those variables, they are recognised, saved, and the tiles are synced straight away.
const GIST_API = 'https://api.github.com';
const GIST_DESC = 'Homepage tiles (sync)';
const GIST_CSV = 'tiles.csv', GIST_META = 'meta.json';
const GIST_ID_RE = /^[0-9a-f]{20,40}$/i;
let syncId = null, syncToken = null, syncTimer = null;       // syncId = gist ID
let syncFromUrl = false, syncTokenOnly = false, pendingGist = null;
(function readSyncCredentials() {
    let uId = null, uTok = null, sId = null, sTok = null;
    try { const q = new URLSearchParams(location.search); uId = q.get('gist'); uTok = q.get('token'); } catch (e) {}
    try { sId = localStorage.getItem('gistId'); sTok = localStorage.getItem('gistToken'); } catch (e) {}
    if (uId && !GIST_ID_RE.test(uId)) uId = null;
    if (sId && !GIST_ID_RE.test(sId)) sId = null;
    if (uId && uId !== sId) { try { localStorage.removeItem('gistBase'); localStorage.removeItem('gistName'); localStorage.removeItem('gistPending'); } catch (e) {} }
    if (uTok && !uId && uTok !== sTok) {                  // a new token on its own: forget the old gist rather than pair them
        sId = null;
        try { ['gistId', 'gistBase', 'gistName', 'gistPending'].forEach(k => localStorage.removeItem(k)); } catch (e) {}
    }
    const id = uId || sId, tok = uTok || sTok;
    if (id && tok) {
        syncId = id; syncToken = tok; syncFromUrl = !!(uId || uTok);
        try { localStorage.setItem('gistId', id); localStorage.setItem('gistToken', tok); } catch (e) {}
    } else if (uTok) {                                        // token only: remember it, the gist is found on Connect
        syncTokenOnly = true;
        try { localStorage.setItem('gistToken', uTok); } catch (e) {}
    } else if (uId) {                                         // gist ID only: prefill it, a token is still needed
        pendingGist = uId;
    }
})();
const syncDialog = document.getElementById('syncDialog');
const syncErr = e => e instanceof TypeError ? 'could not reach api.github.com (offline, or the browser blocked the request)' : e.message;
const storedToken = () => { try { return localStorage.getItem('gistToken') || ''; } catch (e) { return ''; } };
// --- gist name (shown as "Home - name"), last-synced version (for conflict checks) and unsynced-change flag ---
let syncName = '';
try { syncName = localStorage.getItem('gistName') || ''; } catch (e) {}
function homeTitle() { return syncId && syncName && syncName !== GIST_DESC ? 'Home - ' + syncName : 'Home'; }
function applyTitle() {
    if (currentPage() !== 'home') return;
    $('pageTitle').textContent = $('pageHeader').textContent = homeTitle();
}
function setSyncName(n) {
    syncName = n || '';
    try { if (syncName) localStorage.setItem('gistName', syncName); else localStorage.removeItem('gistName'); } catch (e) {}
    applyTitle();
}
// When the tiles were last changed on this device (used to tell "tiles of our own" from "nothing here yet").
let memStamp = 0, applying = false;
function localStamp() { try { return +localStorage.getItem('csvUpdated') || 0; } catch (e) { return memStamp; } }
function stampWrite(n) { memStamp = n; try { if (n) localStorage.setItem('csvUpdated', String(n)); else localStorage.removeItem('csvUpdated'); } catch (e) {} }
function saveLocal(csv, stamp) {                // write tiles that came from the gist: not a local edit, so nothing is uploaded
    applying = true;
    try { saveCsvData(csv); } finally { applying = false; }
    stampWrite(stamp || Date.now());
}
const gistVersion = g => (g && g.history && g.history[0] && g.history[0].version) || (g && g.updated_at) || null;
// The local tiles are one data set, so only ONE gist can be "in sync" with it: this slot remembers which gist (id) and which
// version of it (v) the local tiles were last identical to, and whether they have changes the gist hasn't got yet (pending).
// For any other gist the slot reads as "unknown", and nothing is uploaded over that gist without asking.
let memSlot = null;
function slotRead() { try { return JSON.parse(localStorage.getItem('gistSlot') || 'null'); } catch (e) { return memSlot; } }
function slotWrite(o) { memSlot = o; try { if (o) localStorage.setItem('gistSlot', JSON.stringify(o)); else localStorage.removeItem('gistSlot'); } catch (e) {} }
function slotInfo() { return slotRead(); }                                   // {id, v, p} or null
// Each gist gets its own local copy of the tiles. Switching gists puts the current tiles away (with their sync record) and brings
// back the copy kept for the new gist, so tiles from one gist are never mixed into, or uploaded over, another.
const stashKey = id => 'gistLocal:' + id;
function stashRead(id) { try { return JSON.parse(localStorage.getItem(stashKey(id)) || 'null'); } catch (e) { return null; } }
function adoptLocalFor(id) {                       // returns true if the local tiles were swapped
    if (!id) return false;
    const slot = slotRead();
    if (!slot || slot.id === id) return false;      // already this gist's (or tiles of our own that were never synced: those are asked about)
    try { localStorage.setItem(stashKey(slot.id), JSON.stringify({ csv: loadCsvData(), stamp: localStamp(), v: slot.v, p: !!slot.p })); }
    catch (e) { slotWrite(null); return false; }    // could not put them away: treat them as unsynced tiles (the conflict dialog will ask)
    LP.resetData(); stampWrite(0);
    slotWrite(null);
    const st = stashRead(id);
    if (st && typeof st.csv === 'string' && st.csv) { saveLocal(st.csv, st.stamp || Date.now()); slotWrite({ id, v: st.v, p: !!st.p }); }
    setData(loadCsvData());
    LP.clearUndo();
    LP.dropEdit();
    render();
    return true;
}
function getBase() { const o = slotRead(); return o && o.id === syncId ? o.v : null; }
function setBase(v) { if (!v || !syncId) { slotWrite(null); return; } const o = slotRead(); slotWrite({ id: syncId, v, p: !!(o && o.id === syncId && o.p) }); }
function getPending() { const o = slotRead(); return !!(o && o.id === syncId && o.p); }
function setPending(b) { const o = slotRead(); if (o && o.id === syncId) { o.p = !!b; slotWrite(o); } }
function syncMsg(text) { $('syMsg').textContent = text || ''; }       // error line inside the dialog (toasts sit behind an open dialog)

async function gh(path, opts, token) {
    opts = opts || {};
    const headers = { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + (token || syncToken) };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const r = await fetch(GIST_API + path, { method: opts.method || 'GET', headers, body: opts.body, cache: 'no-store' });
    if (r.status === 401) throw new Error('GitHub rejected the token (HTTP 401) – check it is correct and has not expired.');
    if (r.status === 403 || r.status === 429) throw new Error('GitHub refused the request (HTTP ' + r.status + ') – the token needs the “Create gists” (gist) scope, or a rate limit was hit.');
    if (r.status === 404) throw new Error('Gist not found (HTTP 404) – check the gist ID, and that the token belongs to the account that owns the gist.');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
}
function gistFiles() {
    return {
        [GIST_CSV]: { content: loadCsvData() || DEFAULT_HEADERS.join(',') + '\n' },
        [GIST_META]: { content: JSON.stringify({ updated: localStamp() || Date.now() }) }
    };
}
async function fileText(f) {
    if (!f) return null;
    if (f.truncated && f.raw_url) { const r = await fetch(f.raw_url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); }
    return f.content;
}
async function readGist(id, token) {
    const g = await gh('/gists/' + id, null, token);
    const csv = await fileText(g.files && g.files[GIST_CSV]);
    const meta = await fileText(g.files && g.files[GIST_META]);
    let updated = 0; try { updated = +JSON.parse(meta || '{}').updated || 0; } catch (e) {}
    return { csv, updated, version: gistVersion(g), name: g.description || '' };
}
async function findGist(token) {                                   // look for an existing tiles gist in the account
    for (let p = 1; p <= 5; p++) {
        const list = await gh('/gists?per_page=100&page=' + p, null, token);
        const hit = list.find(g => g.files && g.files[GIST_CSV] && g.files[GIST_META]);
        if (hit) return hit.id;
        if (list.length < 100) break;
    }
    return null;
}
async function createGist(token, name) {
    const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: name || GIST_DESC, public: false, files: gistFiles() }) }, token);
    return g;
}

async function listGists(token) {                                  // every gist in the account (up to 1000)
    const out = [];
    for (let p = 1; p <= 10; p++) {
        const list = await gh('/gists?per_page=100&page=' + p, null, token);
        out.push(...list);
        if (list.length < 100) break;
    }
    return out;
}
async function showGistList() {
    const box = $('syGists'), btn = $('syList');
    syncMsg('');
    const token = syncToken || $('syId').value.trim() || storedToken();
    if (!token) { syncMsg('Paste your GitHub token first.'); $('syId').focus(); return; }
    btn.disabled = true; btn.textContent = 'Loading…';
    try {
        const gists = await listGists(token);
        box.textContent = '';
        box.style.display = 'block';
        if (!gists.length) { box.textContent = 'No gists found in this account.'; return; }
        gists.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
        gists.forEach(g => {
            const names = Object.keys(g.files || {});
            const isTiles = !!(g.files && g.files[GIST_CSV] && g.files[GIST_META]);
            const isCur = g.id === syncId;
            const row = document.createElement('div');
            row.className = 'gl-row' + (isTiles ? '' : ' other') + (isCur ? ' current' : '');
            const info = document.createElement('div'); info.className = 'gl-info';
            const t = document.createElement('b');
            t.textContent = (g.description || names[0] || '(no description)') + (isTiles ? '  · tiles' : '');
            const d = document.createElement('small');
            d.textContent = g.id + ' · ' + (g.public ? 'public' : 'secret') + ' · ' + (g.updated_at || '').slice(0, 10) + ' · ' + names.length + ' file' + (names.length === 1 ? '' : 's');
            info.append(t, d); row.append(info);
            if (isCur) {
                const s = document.createElement('small'); s.textContent = 'in use'; row.append(s);
            } else if (isTiles) {
                const u = document.createElement('button'); u.type = 'button'; u.className = 'tbtn'; u.textContent = 'Use';
                u.addEventListener('click', () => useListedGist(g.id, token));
                row.append(u);
            }
            if (isTiles) {
                const rn = document.createElement('button'); rn.type = 'button'; rn.className = 'tbtn'; rn.textContent = 'Rename';
                rn.addEventListener('click', async () => {
                    const cur = g.description || '';
                    const name = prompt('Name for this gist:', cur);
                    if (name === null || !name.trim() || name.trim() === cur) return;
                    rn.disabled = true; rn.textContent = '…'; syncMsg('');
                    try {
                        await gh('/gists/' + g.id, { method: 'PATCH', body: JSON.stringify({ description: name.trim() }) }, token);
                        g.description = name.trim();
                        t.textContent = g.description + '  · tiles';
                        if (g.id === syncId) setSyncName(g.description);
                    } catch (e) { syncMsg(syncErr(e)); }
                    rn.disabled = false; rn.textContent = 'Rename';
                });
                row.append(rn);
            }
            const a = document.createElement('a'); a.href = g.html_url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '↗';
            a.title = 'Open on GitHub'; row.append(a);
            box.append(row);
        });
    } catch (e) {
        box.style.display = 'none';
        syncMsg(syncErr(e));
    } finally {
        btn.disabled = false; btn.textContent = 'List my gists';
    }
}
async function useListedGist(id, token) {
    if (!syncId) {                                                      // not connected: just pick it for Connect
        $('syGist').value = id; $('syNew').checked = false; $('syGist').disabled = false;
        syncMsg(''); return;
    }
    if (!confirm('Switch syncing to this gist?\nThis device keeps a separate copy of the tiles for each gist, so the current ones are kept and come back if you switch back.')) return;
    const prev = { id: syncId, token: syncToken };
    try {
        await readGist(id, token);                                      // verify access first
        setSyncCreds(id, token);
        const r = await pullSync(false, true, true);
        if (!r || r === 'paused') { setSyncCreds(prev.id, prev.token); if (r === 'paused') syncMsg('Not switched: that gist and this device’s copy differ.'); return; }
        syncDialog.close();
        showToast('Switched to the selected gist ✓', true, 'ok');
    } catch (e) {
        setSyncCreds(prev.id, prev.token);
        syncMsg(syncErr(e));
    }
}

function setSyncUi(state) {                    // 'off' | 'ok' | 'busy' | 'err'
    const b = $('syncBtn');
    b.classList.toggle('synced', !!syncId && state === 'ok');
    b.classList.toggle('err', !!syncId && (state === 'err' || state === 'conflict'));
    b.title = !syncId ? 'Sync (not set up)' : state === 'conflict' ? 'Sync paused – online copy differs. Click, then “Sync now” to resolve' : state === 'err' ? 'Sync problem – click for details' : state === 'busy' ? 'Syncing…' : 'Synced';
}
function syncLink() {                          // the page address with the gist ID and token as variables
    return location.href.split(/[?#]/)[0] + '?gist=' + encodeURIComponent(syncId) + '&token=' + encodeURIComponent(syncToken);
}
function setSyncUrl(id, token) {               // keep gist + token in the address bar (and remove them when sync stops)
    try {
        const u = new URL(location.href);
        if (id && token) { u.searchParams.set('gist', id); u.searchParams.set('token', token); }
        else { u.searchParams.delete('gist'); u.searchParams.delete('token'); }
        history.replaceState(null, '', u.pathname + u.search + location.hash);
    } catch (e) { console.warn('Could not update the address bar', e); }
}
function setSyncCreds(id, token) {
    if (!id) slotWrite(null);                                                      // stopping sync: forget what the tiles were synced with
    else adoptLocalFor(id);                                                        // swap in this gist's own local copy
    if ((id || null) !== syncId) { syncName = ''; try { localStorage.removeItem('gistName'); } catch (e) {} }
    syncId = id || null; syncToken = id ? token : null;
    try {
        if (id) { localStorage.setItem('gistId', id); localStorage.setItem('gistToken', token); }
        else { localStorage.removeItem('gistId'); localStorage.removeItem('gistToken'); }
    } catch (e) {}
    setSyncUrl(syncId, syncToken);
    setSyncUi(id ? 'ok' : 'off');
    applyTitle();
    refreshSyncDialog();
}
function refreshSyncDialog() {
    const on = !!syncId;
    $('syOff').style.display = on ? 'none' : 'block';
    $('syOn').style.display = on ? 'block' : 'none';
    $('syStop').style.display = on ? 'inline-block' : 'none';
    $('syCopy').style.display = on ? 'inline-block' : 'none';
    $('syGo').textContent = on ? 'Sync now' : 'Connect';
    $('syGists').style.display = 'none'; $('syGists').textContent = '';
    $('syLink').value = on ? syncLink() : '';
    $('syId').placeholder = storedToken() ? '(token saved – leave blank to use it)' : '';
    if (!on && pendingGist && !$('syGist').value) $('syGist').value = pendingGist;
    $('syInfo').textContent = on
        ? 'Gist in use: ' + (syncName ? syncName + ' · ' : '') + syncId + '\n\nSyncing is on. Changes upload automatically, and your other devices pick them up when they open or return to this page. The newest change wins.\n⚠ The sync link contains your GitHub token: anyone with it can read and change your gists. Only open or bookmark it on your own devices.'
        : 'Keep your tiles in step across browsers and devices using a private GitHub Gist in your account.\nYour token stays in this browser (and in the address bar once connected).';
}
function scheduleSync() {
    if (!syncId) return;
    setPending(true);                           // local change not yet in the gist
    setSyncUi('busy');                          // change is waiting to upload: not greyed yet
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => pushSync(), 1500);
}
let conflictOpen = false;
// Asks what to do when this device's tiles and the gist differ and it isn't safe to pick one automatically.
// Resolves 'keep' (overwrite the gist) | 'online' (take the gist) | 'later'.
function askConflict(remote) {
    if (conflictOpen) return Promise.resolve('later');
    conflictOpen = true;
    const dlg = $('conflictDialog'), mineCsv = loadCsvData() || '', slot = slotInfo();
    const count = t => { try { return parseCsv(t).items.length; } catch (e) { return '?'; } };
    const when = ts => ts ? new Date(ts).toLocaleString() : 'unknown time';
    const short = v => v ? String(v).slice(0, 8) : 'none';
    const sameGist = !!(slot && slot.id === syncId);
    $('cfInfo').textContent =
        (sameGist ? 'The online copy was changed (probably from another device) since this device last synced.'
                  : !slot ? 'This device already has tiles of its own that were never synced with this gist.'
                  : 'This device’s tiles were last synced with a different gist.') + '\n\n' +
        'ONLINE (server) gist\n  ID: ' + syncId + (syncName ? '\n  Name: ' + syncName : '') + '\n  Version: ' + short(remote.version) +
        '\n  ' + count(remote.csv) + ' rows · changed ' + when(remote.updated) + '\n\n' +
        'THIS DEVICE (local)\n  Last synced with gist ID: ' + (slot ? slot.id : 'none – never synced') +
        (slot ? '\n  Version: ' + short(slot.v) : '') + (sameGist ? '' : '   ⚠ different gist') +
        '\n  ' + count(mineCsv) + ' rows · changed ' + when(localStamp()) + '\n\n' +
        'Keep this device = overwrite the online gist with the tiles here.\n' +
        'Use online = replace the tiles here with the online ones (you can undo this).\n' +
        'Copy either CSV first if you want to merge them by hand.';
    return new Promise(resolve => {
        let choice = 'later';
        const copyBtn = (id, label, text) => {
            const btn = $(id); btn.textContent = label;
            btn.onclick = () => copyToClipboard(text).then(() => 'Copied ✓', () => 'Copy failed')
                .then(msg => { btn.textContent = msg; setTimeout(() => { btn.textContent = label; }, 1400); });
        };
        copyBtn('cfCopyMine', 'Copy this device’s CSV', mineCsv);
        copyBtn('cfCopyOnline', 'Copy online CSV', remote.csv);
        $('cfKeep').onclick = () => { choice = 'keep'; dlg.close(); };
        $('cfOnline').onclick = () => { choice = 'online'; dlg.close(); };
        $('cfLater').onclick = () => { choice = 'later'; dlg.close(); };
        dlg.addEventListener('close', () => { conflictOpen = false; resolve(choice); }, { once: true });
        dlg.showModal();
    });
}
function applyRemote(remote) {                    // replace the local tiles with the online copy
    pushUndo();
    saveLocal(remote.csv, remote.updated || Date.now());
    setData(remote.csv);
    LP.dropEdit();
    render();
    setBase(remote.version);
    setPending(false);
}
// Uploads the local tiles. Before overwriting a gist it asks if (a) the gist changed since this device last synced with it, or
// (b) the local tiles were never confirmed to belong to THIS gist (e.g. after switching gists). skipCheck = the user already chose.
// `known` = a gist read the caller already has. Returns 'pushed' | 'updated' (online copy taken instead) | 'paused' | false.
async function pushSync(throwOnError, known, skipCheck) {
    if (!syncId) return false;
    const sl = slotRead();
    if (sl && sl.id !== syncId) return 'paused';                  // the local tiles now belong to another gist (another tab): wait until this tab is shown again
    try {
        setSyncUi('busy');
        const remote = known || await readGist(syncId);
        const base = getBase(), mine = loadCsvData();
        const remoteHas = typeof remote.csv === 'string' && remote.csv.trim() !== '';
        if (!skipCheck && remoteHas && remote.csv !== mine && (!base || (remote.version && remote.version !== base))) {
            const choice = await askConflict(remote);
            if (choice === 'online') { applyRemote(remote); setSyncUi('ok'); return 'updated'; }
            if (choice !== 'keep') { setSyncUi('conflict'); return 'paused'; }
        }
        const g = await gh('/gists/' + syncId, { method: 'PATCH', body: JSON.stringify({ files: gistFiles() }) });
        setBase(gistVersion(g)); setPending(false);
        if (g.description) setSyncName(g.description);
        setSyncUi('ok');
        return 'pushed';
    } catch (e) {
        console.warn('Sync upload failed', e);
        setSyncUi('err');
        if (throwOnError) throw e;
        showToast('Sync failed: ' + syncErr(e), true, 'err');
        return false;
    }
}
// force is no longer used (kept so callers stay the same); interactive = report errors inside the sync dialog;
// quiet = no "updated" toast (the caller reports the result). Returns 'updated' | 'pushed' | 'same' | 'paused', or false on failure/cancel.
async function pullSync(force, interactive, quiet) {
    if (!syncId) return false;
    try {
        setSyncUi('busy');
        const remote = await readGist(syncId);
        if (remote.name) setSyncName(remote.name);
        if (typeof remote.csv !== 'string' || !remote.csv.trim()) return await pushSync(true, remote);   // empty: start it with our tiles
        const mine = loadCsvData(), mineStamp = localStamp();
        if (remote.csv === mine) { setBase(remote.version); setPending(false); setSyncUi('ok'); return 'same'; }
        if (mineStamp === 0 && !getPending()) {                                          // nothing of our own for this gist: just take it
            applyRemote(remote);
            if (!quiet) showToast('Updated from sync');
            setSyncUi('ok');
            return 'updated';
        }
        const base = getBase();
        if (!base || getPending()) return await pushSync(true, remote);                  // unverified or changed here: upload (asks if unsafe)
        if (remote.version === base) return await pushSync(true, remote);                // gist unchanged since last sync, so the difference is ours
        const busy = LP.isBusy() || (!interactive && document.querySelector('dialog[open]'));
        if (busy) { setSyncUi('ok'); return 'same'; }                                    // gist changed elsewhere; don't disturb work in progress
        applyRemote(remote);
        if (!quiet) showToast('Updated from sync');
        setSyncUi('ok');
        return 'updated';
    } catch (e) {
        console.warn('Sync download failed', e);
        setSyncUi('err');
        if (interactive) syncMsg(syncErr(e)); else showToast('Sync failed: ' + syncErr(e), true, 'err');
        return false;
    }
}
$('syncBtn').addEventListener('click', () => { syncMsg(''); refreshSyncDialog(); syncDialog.showModal(); });
$('syClose').addEventListener('click', () => syncDialog.close());
$('syLink').addEventListener('focus', e => e.target.select());
$('syList').addEventListener('click', showGistList);
$('syNew').addEventListener('change', e => { $('syGist').disabled = e.target.checked; if (e.target.checked) $('syGist').value = ''; });
$('syCopy').addEventListener('click', () => {
    const b = $('syCopy');
    copyToClipboard($('syLink').value).then(() => { b.textContent = 'Copied ✓'; }, () => { b.textContent = 'Copy failed'; })
        .then(() => setTimeout(() => { b.textContent = 'Copy link'; }, 1200));
});
$('syGo').addEventListener('click', async () => {
    syncMsg('');
    const btn = $('syGo'), wasOn = !!syncId;
    btn.disabled = true; btn.textContent = wasOn ? 'Syncing…' : 'Connecting…';
    try {
        if (wasOn) {                                                                      // "Sync now"
            const r = await pullSync(false, true, true);
            if (!r) return;                                                               // error is shown in the dialog
            syncDialog.close();
            if (r === 'paused') { showToast('Sync paused – the online copy differs from this device', true, 'err'); return; }
            showToast(r === 'updated' ? 'Synced ✓ – tiles updated from your gist' : r === 'pushed' ? 'Synced ✓ – your tiles were uploaded' : 'Synced ✓ – already up to date', true, 'ok');
            return;
        }
        const token = $('syId').value.trim() || storedToken();
        if (!token) { syncMsg('Paste your GitHub token first.'); $('syId').focus(); return; }
        const given = $('syGist').value.trim(), forceNew = $('syNew').checked;
        let id = null;
        if (forceNew) {
            id = null;                                                                    // always make a brand-new gist
        } else if (given) {
            const m = given.match(/([0-9a-f]{20,40})\/?(?:[?#].*)?$/i);
            if (!m) { syncMsg('That does not look like a gist ID or URL.'); return; }
            id = m[1];
        } else {
            id = await findGist(token);                                                   // reuse an existing tiles gist
        }
        let msg;
        if (id) {
            await readGist(id, token);                                                    // verify access before saving anything
            setSyncCreds(id, token);
            const r = await pullSync(false, true, true);
            if (r === 'paused') { setSyncCreds(null); syncMsg('Not connected: this device and that gist have different tiles.'); return; }
            if (!r) { setSyncCreds(null); return; }                                       // error is shown in the dialog
            msg = r === 'updated' ? 'Connected ✓ – tiles loaded from your gist' : 'Connected ✓ – tiles synced';
        } else {
            const g = await createGist(token, $('syName').value.trim());                  // first device: create it from the local tiles
            id = g.id;
            slotWrite(null);                                                              // the tiles here were just uploaded as this gist: they are its copy
            setSyncCreds(id, token);
            setBase(gistVersion(g)); setSyncName(g.description); setPending(false);
            msg = 'Connected ✓ – private gist created and tiles uploaded';
        }
        $('syId').value = ''; $('syGist').value = ''; $('syNew').checked = false; $('syGist').disabled = false; $('syName').value = ''; pendingGist = null;
        syncDialog.close();                                                               // done: close the dialog …
        showToast(msg + '. Sync link saved in the address bar.', true, 'ok');             // … and tell the user
    } catch (e) {
        console.warn('Sync connect failed', e);
        if (!wasOn) setSyncCreds(null);
        syncMsg(syncErr(e));                                                              // dialog stays open so the token can be fixed
    } finally {
        btn.disabled = false; refreshSyncDialog();
    }
});
$('syStop').addEventListener('click', () => {
    if (!confirm('Stop syncing on this device? Your tiles stay here and in the gist, and the token is removed from this browser and the address bar.')) return;
    setSyncCreds(null);
    syncDialog.close();
    showToast('Syncing stopped', true);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && syncId) { adoptLocalFor(syncId); pullSync(); } });

/* ---------- connect to the page ---------- */
LP.on('save', () => { if (applying) return; stampWrite(Date.now()); scheduleSync(); });      // a local edit: upload it shortly (no-op when sync is off)
LP.on('render', info => { $('syncBtn').classList.toggle('show', !info.editing); applyTitle(); });
// tiles saved before this plugin existed have no timestamp: mark them as this device's own so they are never mistaken for "empty"
try { if (!localStamp() && localStorage.getItem('csvData')) stampWrite(Date.now()); } catch (e) {}
render();                                                      // the page was drawn before this file loaded: redraw so the button and title appear



setSyncUi(syncId ? 'busy' : 'off');
if (syncId) {
    setSyncUrl(syncId, syncToken);             // keep ?gist=…&token=… in the address bar
    adoptLocalFor(syncId);                     // if the tiles here belong to another gist, put them away and use this gist's own copy
    pullSync(false, false, true).then(r => {
        if (!r) return;                        // a failure toast was already shown
        if (r === 'paused') { showToast('Sync paused – open ☁ and press Sync now to resolve', true, 'err'); return; }
        if (syncFromUrl) showToast('Sync link recognised ✓ – ' + (r === 'updated' ? 'tiles loaded from your gist' : 'tiles are in sync'), true, 'ok');
        else if (r === 'updated') showToast('Updated from sync');
    });
} else if (syncTokenOnly) {
    showToast('Token recognised and saved – open ☁ to connect', true, 'ok');
} else if (pendingGist) {
    showToast('Gist ID recognised – open ☁ and add your token to connect', true);
}
})();
