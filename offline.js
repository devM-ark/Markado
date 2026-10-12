// Offline support for the teacher app.
//
//  - Everything the app reads is also kept on the device (IndexedDB), so screens open instantly from the saved copy
//    while fresh data loads, and still open with no connection.
//  - Grades typed with no connection are saved on the device and sent to the server, in order, once it is reachable.
//    Nothing else is queued: publishing, importing an E-CR, editing the roster / classes / Home details and logging in
//    need the internet and say so.
//  - The license rule is the same as online: once it expires, editing is locked. There is no grace period.
//
// Hooks into api.js through window.apiHooks_. If IndexedDB isn't available the app simply behaves as it always did.

var Offline = (function () {
  'use strict';

  var DB_NAME = 'markado-offline';
  var OWNER_KEY = 'markado_owner';        // { token, email } -- whose data is on this device
  var LICENSE_KEY = 'markado_license';    // the last license the server told us about
  var LASTTIME_KEY = 'markado_lasttime';  // the latest moment this device has ever seen (see now())
  var PACK_KEY = 'markado_packs';         // { workspaceId: ms } when each class was last downloaded
  var PACK_MAX_AGE_MS = 6 * 3600 * 1000;
  var SYNC_BATCH = 50;
  var PROBE_MS = 30000;

  // Reads kept on the device. Everything else (license requests, the school logo -- which has its own copy -- ...) is online-only.
  var PERSISTED = {
    clientGetWorkspaceBundle_: true, clientListWorkspaces_: true, clientListRoster_: true, clientListClassSubjects_: true,
    clientGetClassRecordGrades_: true, clientGetClassReportCards_: true, clientGetSchoolProfile_: true,
    clientGetMyProfile_: true, clientGetLicenseStatus_: true,
  };
  // Reads shown straight from the saved copy while the fresh one loads. Not the grade sheet: refreshing it under a
  // teacher who has started typing would wipe their keystrokes.
  var SWR = {
    clientGetWorkspaceBundle_: true, clientListWorkspaces_: true, clientListRoster_: true, clientListClassSubjects_: true,
    clientGetClassReportCards_: true,
  };

  var cfg = { getToken: function () { return null; }, onChange: function () {}, onSynced: function () {} };
  var enabled = false;
  var owner = '';
  var netDown = false;
  var syncing = false;
  var counts = { pending: 0, issues: 0 };
  var lastSyncAt = 0;
  var probeTimer = null, pendingTimer = null, syncDebounce = null;
  var ready = null; // resolves once the device storage is open and we know whose data is on it
  function whenReady_() { return ready || Promise.resolve(); }


  // ---------- IndexedDB ----------

  var dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        db.createObjectStore('cache', { keyPath: 'key' });
        db.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('issues', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  /** Runs fn(objectStore) in one transaction; resolves with the request fn returned (if any) once the transaction commits. */
  function run(storeName, mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, mode);
        var request;
        try { request = fn(tx.objectStore(storeName)); } catch (e) { reject(e); return; }
        tx.oncomplete = function () { resolve(request && 'result' in request ? request.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('Transaction aborted')); };
      });
    });
  }


  // ---------- Keys, owner ----------

  function norm(a) { return a !== null && typeof a === 'object' ? JSON.stringify(a) : String(a); }

  /** The saved copy of a read: same call with the same arguments (the session token left out, since it changes at every login). */
  function readKey(fn, args) {
    if (fn === 'clientGetWorkspaceBundle_') return fn; // always "the latest bundle", whichever class it was asked about
    return fn + '|' + args.slice(1).map(norm).join('|');
  }
  function fullKey(fn, args) { return owner + '\u0001' + readKey(fn, args); }

  function readStoredOwner() {
    try {
      var rec = JSON.parse(localStorage.getItem(OWNER_KEY) || 'null');
      return rec && rec.token && rec.token === cfg.getToken() ? rec.email : '';
    } catch (e) { return ''; }
  }

  /** Tells the layer whose data this is. Anyone else's saved copies are removed from the device. */
  function setOwner(email) {
    email = String(email || '').trim().toLowerCase();
    if (!email || !enabled) return;
    try { localStorage.setItem(OWNER_KEY, JSON.stringify({ token: cfg.getToken(), email: email })); } catch (e) { /* ignore */ }
    if (email === owner) return;
    owner = email;
    purgeOtherOwners_();
    refreshCounts();
  }

  function purgeOtherOwners_() {
    var prefix = owner + '\u0001';
    run('cache', 'readwrite', function (s) {
      var cursorReq = s.openCursor();
      cursorReq.onsuccess = function () {
        var cur = cursorReq.result;
        if (!cur) return;
        if (cur.key.indexOf(prefix) !== 0) cur.delete();
        cur.continue();
      };
      return cursorReq;
    }).catch(function () { /* best effort */ });
  }


  // ---------- Time and the license: the same lock offline as online ----------

  /**
   * "Now", for deciding whether the license has run out. A phone's clock can be set back to dodge an expiry, so time can
   * never go backwards here: it is the latest moment this device has ever seen, from its own clock or from the server.
   */
  function now() {
    var t = Date.now();
    var last = Number(localStorage.getItem(LASTTIME_KEY) || 0);
    if (t < last) return last;
    if (t - last > 1000) { try { localStorage.setItem(LASTTIME_KEY, String(t)); } catch (e) { /* ignore */ } }
    return t;
  }

  function noteServerTime(iso) {
    var ms = new Date(iso).getTime();
    var last = Number(localStorage.getItem(LASTTIME_KEY) || 0);
    if (isFinite(ms) && ms > last) { try { localStorage.setItem(LASTTIME_KEY, String(ms)); } catch (e) { /* ignore */ } }
  }

  function setLicense(license) {
    try { localStorage.setItem(LICENSE_KEY, JSON.stringify(license || null)); } catch (e) { /* ignore */ }
  }
  function getLicense() {
    try { return JSON.parse(localStorage.getItem(LICENSE_KEY) || 'null'); } catch (e) { return null; }
  }

  /** Whether grades may be edited right now, from what the device last knew about the license. */
  function canEdit() {
    var lic = getLicense();
    if (!lic) return { ok: true }; // nothing known: the server decides when the change is sent
    if (lic.status === 'SUSPENDED') return { ok: false, message: 'Your account has been suspended. Contact support for details.' };
    var expired = lic.status === 'EXPIRED' || lic.status === 'NONE' ||
      (!lic.noExpiry && lic.expirationDate && now() > new Date(lic.expirationDate).getTime());
    if (expired) return { ok: false, message: 'Your trial or license has expired, so editing is locked. Renew it when you are back online.' };
    return { ok: true };
  }


  // ---------- Saved copies of reads ----------

  function persistable(fn) { return enabled && !!PERSISTED[fn]; }

  function onReadSuccess(fn, args, data) {
    if (!enabled || !PERSISTED[fn]) return;
    whenReady_().then(function () {
      if (fn === 'clientGetWorkspaceBundle_' && data) {
        if (data.profile && data.profile.email) setOwner(data.profile.email);
        if (data.profile && data.profile.license) setLicense(data.profile.license);
        if (data.serverNow) noteServerTime(data.serverNow);
      }
      if (fn === 'clientGetLicenseStatus_' && data) setLicense(data);
      if (fn === 'clientGetMyProfile_' && data && data.license) setLicense(data.license);
      if (!owner) return;
      return run('cache', 'readwrite', function (s) {
        return s.put({ key: fullKey(fn, args), owner: owner, fn: fn, data: data, savedAt: Date.now() });
      });
    }).catch(function () { /* storage full or blocked: saving a copy is best-effort */ });
  }

  function getStale(fn, args) {
    if (!enabled || !PERSISTED[fn]) return Promise.resolve(null);
    return whenReady_().then(function () {
      if (!owner) return null;
      return run('cache', 'readonly', function (s) { return s.get(fullKey(fn, args)); })
        .then(function (rec) { return rec ? { data: rec.data, savedAt: rec.savedAt } : null; });
    }).catch(function () { return null; });
  }

  function putRaw_(fn, args, data) {
    if (!enabled) return Promise.resolve();
    return run('cache', 'readwrite', function (s) {
      return s.put({ key: fullKey(fn, args), owner: owner, fn: fn, data: data, savedAt: Date.now() });
    });
  }

  function sheetArgs_(classSubjectId, term) { return [null, String(classSubjectId), Number(term)]; }


  // ---------- Grades typed offline ----------

  function descriptorFor_(scale, grade) {
    var band = (scale || []).filter(function (b) { return grade >= b.min && grade <= b.max; })[0];
    return band ? band.label : '';
  }

  /** Writes typed grades into a saved grade sheet the way the server would, and returns what the server would have replied. */
  function patchSheet_(sheet, entries) {
    var byId = {};
    sheet.rows.forEach(function (r) { byId[r.enrollmentId] = r; });
    var comps = sheet.components || [];
    var results = [];
    var touched = [], seen = {};

    entries.forEach(function (e) {
      var row = byId[e.enrollmentId];
      if (!row || row.locked) return;
      if (comps.length > 0 && e.componentId) {
        row.components = row.components || {};
        row.components[e.componentId] = e.grade;
        if (!seen[e.enrollmentId]) { seen[e.enrollmentId] = true; touched.push(row); }
      } else if (comps.length === 0) {
        row.termGrade = e.grade;
        row.descriptor = descriptorFor_(sheet.scale, e.grade);
        row.publicationState = 'DRAFT';
        row.source = 'manual';
        results.push({ enrollmentId: row.enrollmentId, termGrade: e.grade, descriptor: row.descriptor });
      }
    });

    // A subject with components (MAPEH): its grade is the average once every component has one -- the same rounding as the server.
    touched.forEach(function (row) {
      var total = 0, complete = true;
      comps.forEach(function (c) {
        var v = row.components ? row.components[c.classSubjectId] : '';
        var n = v === '' || v === null || v === undefined ? NaN : Number(v);
        if (!isFinite(n)) complete = false; else total += n;
      });
      if (!complete) return;
      var avg = Math.round(total / comps.length);
      row.termGrade = avg;
      row.descriptor = descriptorFor_(sheet.scale, avg);
      row.publicationState = 'DRAFT';
      row.source = 'computed';
      results.push({ enrollmentId: row.enrollmentId, termGrade: avg, descriptor: row.descriptor });
    });
    return results;
  }

  function validateEntries_(sheet, entries) {
    var names = {};
    if (sheet) sheet.rows.forEach(function (r) { names[r.enrollmentId] = r.fullName; });
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (sheet && !Object.prototype.hasOwnProperty.call(names, e.enrollmentId)) return 'One of the learners is not in this class.';
      var g = e.grade;
      if (g === '' || g === null || g === undefined) continue;
      var n = typeof g === 'string' ? Number(g.trim()) : g;
      if (typeof n !== 'number' || !isFinite(n) || Math.floor(n) !== n || n < 60 || n > 100) {
        return (names[e.enrollmentId] || 'A learner') + ': the grade must be a whole number from 60 to 100.';
      }
    }
    return '';
  }

  function uuid_() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2);
  }

  /** Stands in for the server when it can't be reached: only a grade save can wait. Returns a reply shaped like the server's. */
  function tryQueue(fn, args) {
    if (!enabled || fn !== 'clientSaveManualGrades_') return Promise.resolve(null);
    return whenReady_().then(function () { return queueGrades_(args); });
  }

  function queueGrades_(args) {
    if (!owner) return Promise.resolve({ ok: false, kind: 'offline', error: 'This needs an internet connection the first time. Connect once, then it works offline.' });
    var guard = canEdit();
    if (!guard.ok) return Promise.resolve({ ok: false, kind: 'app', error: guard.message });

    var classSubjectId = String(args[1]), term = Number(args[2]), entries = args[3] || [];
    return getStale('clientGetClassRecordGrades_', sheetArgs_(classSubjectId, term)).then(function (hit) {
      var sheet = hit ? hit.data : null;
      var problem = validateEntries_(sheet, entries);
      if (problem) return { ok: false, kind: 'app', error: problem };

      var results;
      if (sheet) results = patchSheet_(sheet, entries);
      else results = entries.every(function (e) { return !e.componentId; })
        ? entries.filter(function (e) { return e.grade !== '' && e.grade !== null && e.grade !== undefined; })
            .map(function (e) { return { enrollmentId: e.enrollmentId, termGrade: Number(e.grade), descriptor: '' }; })
        : [];

      var label = (sheet ? sheet.subjectName : 'Grades') + ' \u2022 Term ' + term + ' \u2022 ' + entries.length + ' grade' + (entries.length === 1 ? '' : 's');
      var item = {
        owner: owner, opId: uuid_(), classSubjectId: classSubjectId, term: term, entries: entries,
        clientTimeIso: new Date(now()).toISOString(), label: label, createdAt: Date.now(),
      };
      var steps = [run('outbox', 'readwrite', function (s) { return s.add(item); })];
      if (sheet) steps.push(putRaw_('clientGetClassRecordGrades_', sheetArgs_(classSubjectId, term), sheet));
      return Promise.all(steps).then(function () {
        return refreshCounts().then(function () {
          scheduleSync_(false);
          return { ok: true, data: { saved: entries.length, results: results, queued: true } };
        });
      });
    }).catch(function () {
      return { ok: false, kind: 'app', error: 'Could not save this on the device. Check that the browser allows site storage, then try again.' };
    });
  }

  /** While changes are still waiting to be sent, a freshly fetched grade sheet is shown with them applied -- so a teacher never sees their typing "undone". */
  function needsOverlay(fn) { return enabled && fn === 'clientGetClassRecordGrades_' && counts.pending > 0; }

  function overlayPending(fn, args, data) {
    var csId = String(args[1]), term = Number(args[2]);
    return listOutbox_().then(function (items) {
      var mine = items.filter(function (it) { return it.classSubjectId === csId && it.term === term; });
      if (mine.length === 0) return data;
      var copy = JSON.parse(JSON.stringify(data));
      mine.forEach(function (it) { patchSheet_(copy, it.entries); });
      return copy;
    }).catch(function () { return data; });
  }


  // ---------- The outbox, problems, counts ----------

  function listOutbox_() {
    return run('outbox', 'readonly', function (s) { return s.getAll(); }).then(function (rows) {
      return (rows || []).filter(function (r) { return r.owner === owner; }).sort(function (a, b) { return a.id - b.id; });
    });
  }
  function listIssues() {
    return run('issues', 'readonly', function (s) { return s.getAll(); }).then(function (rows) {
      return (rows || []).filter(function (r) { return r.owner === owner; });
    }).catch(function () { return []; });
  }
  function dismissIssue(id) {
    return run('issues', 'readwrite', function (s) { return s.delete(id); }).then(refreshCounts);
  }
  function dismissAllIssues() {
    return listIssues().then(function (rows) {
      return Promise.all(rows.map(function (r) { return run('issues', 'readwrite', function (s) { return s.delete(r.id); }); }));
    }).then(refreshCounts);
  }

  function refreshCounts() {
    if (!enabled || !owner) { counts = { pending: 0, issues: 0 }; emit(); return Promise.resolve(); }
    return Promise.all([listOutbox_(), listIssues()]).then(function (r) {
      counts = { pending: r[0].length, issues: r[1].length };
      emit();
    }).catch(function () { /* ignore */ });
  }

  function status() {
    return {
      online: isOnline(), pending: counts.pending, issues: counts.issues, syncing: syncing, lastSyncAt: lastSyncAt,
      enabled: enabled,
    };
  }
  function emit() { try { cfg.onChange(status()); } catch (e) { console.error(e); } }

  function isOnline() { return (typeof navigator === 'undefined' || navigator.onLine !== false) && !netDown; }


  // ---------- Connection ----------

  /** api.js reports every request's outcome: a failure means the server can't be reached; the next success means it can. */
  function noteNetwork(ok) {
    if (!enabled) return;
    if (ok) {
      var wasDown = netDown;
      netDown = false;
      stopProbe_();
      if (wasDown) emit();
      if (counts.pending > 0) scheduleSync_(true);
    } else if (!netDown) {
      netDown = true;
      emit();
      startProbe_();
    }
  }

  function startProbe_() {
    if (probeTimer) return;
    probeTimer = setInterval(function () {
      if (navigator.onLine === false) return;
      call('clientPing_', [], function () { /* the success path in api.js calls noteNetwork(true) */ }, function () {}, { silent: true });
    }, PROBE_MS);
  }
  function stopProbe_() { if (probeTimer) { clearInterval(probeTimer); probeTimer = null; } }


  // ---------- Sync ----------

  function scheduleSync_(immediate) {
    if (syncDebounce) clearTimeout(syncDebounce);
    syncDebounce = setTimeout(function () { sync(); }, immediate ? 400 : 3000);
  }

  function callP_(fn, args, options) {
    return new Promise(function (resolve) {
      call(fn, args, function (data) { resolve({ ok: true, data: data }); },
        function (err, res) { resolve({ ok: false, error: err, kind: res && res.kind }); }, options || { silent: true });
    });
  }

  /** Sends everything waiting, in the order it was typed. Returns { applied, failed }. */
  function sync() {
    return whenReady_().then(runSync_);
  }

  function runSync_() {
    if (!enabled || !owner || syncing || !isOnline() || !cfg.getToken()) return Promise.resolve({ applied: 0, failed: 0 });
    syncing = true;
    emit();
    var applied = 0, failed = 0, stop = false;

    var finish = function () {
      syncing = false;
      if (applied > 0 || failed > 0) lastSyncAt = Date.now();
      return refreshCounts().then(function () {
        if (applied > 0 || failed > 0) { try { cfg.onSynced({ applied: applied, failed: failed }); } catch (e) { console.error(e); } }
        if (applied > 0) refreshAllPacks_(true);
        return { applied: applied, failed: failed };
      });
    };

    var nextBatch = function () {
      if (stop) return Promise.resolve();
      return listOutbox_().then(function (items) {
        if (items.length === 0) return;
        var batch = items.slice(0, SYNC_BATCH);
        var wire = batch.map(function (it) {
          return { opId: it.opId, classSubjectId: it.classSubjectId, term: it.term, entries: it.entries, clientTimeIso: it.clientTimeIso };
        });
        return callP_('clientSyncOfflineGrades_', [cfg.getToken(), wire]).then(function (res) {
          if (!res.ok) { stop = true; return; } // can't reach the server (or the session ended): keep everything for next time
          if (res.data && res.data.serverNow) noteServerTime(res.data.serverNow);
          var outcome = {};
          ((res.data && res.data.results) || []).forEach(function (r) { outcome[r.opId] = r; });
          var ops = batch.map(function (it) {
            var r = outcome[it.opId];
            if (!r) { stop = true; return Promise.resolve(); } // the server didn't answer for this one: leave it queued
            var removeIt = run('outbox', 'readwrite', function (s) { return s.delete(it.id); });
            if (r.ok) {
              applied++;
              return removeIt.then(function () {
                return run('cache', 'readwrite', function (s) { return s.delete(fullKey('clientGetClassRecordGrades_', sheetArgs_(it.classSubjectId, it.term))); });
              });
            }
            failed++;
            return removeIt.then(function () {
              return run('issues', 'readwrite', function (s) {
                return s.add({ owner: owner, label: it.label, error: r.error || 'It could not be saved.', licenseProblem: !!r.licenseProblem, entries: it.entries, term: it.term, classSubjectId: it.classSubjectId, failedAt: Date.now() });
              });
            });
          });
          return Promise.all(ops).then(function () { return stop ? undefined : nextBatch(); });
        });
      });
    };

    return nextBatch().then(finish, finish);
  }


  // ---------- Downloading classes for offline use ----------

  function readPacks_() { try { return JSON.parse(localStorage.getItem(PACK_KEY) || '{}'); } catch (e) { return {}; } }
  function writePack_(wsId) { var p = readPacks_(); p[wsId] = Date.now(); try { localStorage.setItem(PACK_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } }
  function lastDownload(wsId) { return readPacks_()[wsId] || 0; }

  function storePack_(pack) {
    var ws = pack.workspaceId;
    var puts = [
      putRaw_('clientListClassSubjects_', [null, ws], pack.subjects),
      putRaw_('clientListRoster_', [null, ws], pack.roster),
      putRaw_('clientGetClassReportCards_', [null, ws], pack.reportCards),
    ];
    // grade sheets: apply anything still waiting to be sent, so a refresh never undoes typing that hasn't synced yet
    var pendingP = listOutbox_().catch(function () { return []; });
    return pendingP.then(function (pending) {
      (pack.sheets || []).forEach(function (sh) {
        var data = sh.data;
        pending.filter(function (it) { return it.classSubjectId === String(sh.classSubjectId) && it.term === Number(sh.term); })
          .forEach(function (it) { patchSheet_(data, it.entries); });
        puts.push(putRaw_('clientGetClassRecordGrades_', sheetArgs_(sh.classSubjectId, sh.term), data));
      });
      return Promise.all(puts);
    }).then(function () {
      if (pack.serverNow) noteServerTime(pack.serverNow);
      writePack_(ws);
    });
  }

  function downloadClass(wsId) {
    if (!enabled || !owner || !isOnline()) return Promise.resolve(false);
    return callP_('clientGetOfflinePack_', [cfg.getToken(), wsId]).then(function (res) {
      if (!res.ok) return false;
      return storePack_(res.data).then(function () { emit(); return true; }, function () { return false; }); // emit: lets the Settings panel redraw ("Data last downloaded on ...")
    });
  }

  /** Downloads each class one after the other. onProgress(done, total). */
  function downloadAll(workspaceIds, onProgress) {
    var done = 0, okCount = 0;
    var total = workspaceIds.length;
    if (onProgress) onProgress(0, total);
    return workspaceIds.reduce(function (chain, id) {
      return chain.then(function () {
        return downloadClass(id).then(function (ok) { done++; if (ok) okCount++; if (onProgress) onProgress(done, total); });
      });
    }, Promise.resolve()).then(function () { return { ok: okCount, total: total }; });
  }

  var knownWorkspaceIds_ = [];
  function setWorkspaces(ids) { knownWorkspaceIds_ = ids.slice(); }

  /** Quietly keeps every class's offline copy from going stale: only the classes not downloaded in the last few hours. */
  function refreshAllPacks_(force) {
    if (!enabled || !isOnline()) return Promise.resolve();
    var due = knownWorkspaceIds_.filter(function (id) { return force || Date.now() - lastDownload(id) > PACK_MAX_AGE_MS; });
    return due.reduce(function (chain, id) {
      return chain.then(function () { return new Promise(function (r) { setTimeout(r, 1500); }).then(function () { return downloadClass(id); }); });
    }, Promise.resolve());
  }
  function autoRefresh() { return refreshAllPacks_(false); }


  // ---------- Leaving ----------

  /** On log out / session end: the saved copies of the teacher's data go. Changes still waiting to be sent stay, so they aren't lost. */
  function clearForLogout() {
    // Stop first: a request still in flight when the session ends must not put the old teacher's data back after the wipe.
    enabled = false;
    var wipe = openDb().then(function () { return run('cache', 'readwrite', function (s) { return s.clear(); }); }).catch(function () {});
    try { localStorage.removeItem(OWNER_KEY); localStorage.removeItem(PACK_KEY); } catch (e) { /* ignore */ }
    owner = '';
    return wipe;
  }


  // ---------- Setup ----------

  function init(options) {
    cfg = Object.assign(cfg, options || {});
    enabled = typeof indexedDB !== 'undefined';
    if (!enabled) return;
    ready = openDb().then(function () {
      owner = readStoredOwner();
      return refreshCounts();
    }).then(function () {
      if (owner && counts.pending > 0) scheduleSync_(true);
    }).catch(function () { enabled = false; });

    window.addEventListener('online', function () { netDown = false; emit(); scheduleSync_(true); });
    window.addEventListener('offline', function () { emit(); });
    pendingTimer = setInterval(function () { if (counts.pending > 0 && isOnline()) sync(); }, 45000);
  }

  window.apiHooks_ = {
    persistable: persistable,
    swr: function (fn) { return enabled && !!SWR[fn]; },
    onReadSuccess: onReadSuccess,
    getStale: getStale,
    queueable: function (fn) { return enabled && fn === 'clientSaveManualGrades_'; },
    tryQueue: tryQueue,
    needsOverlay: needsOverlay,
    overlayPending: overlayPending,
    noteNetwork: noteNetwork,
  };

  return {
    init: init, setOwner: setOwner, setLicense: setLicense, canEdit: canEdit, now: now,
    status: status, sync: sync, listIssues: listIssues, dismissIssue: dismissIssue, dismissAllIssues: dismissAllIssues,
    downloadClass: downloadClass, downloadAll: downloadAll, setWorkspaces: setWorkspaces, autoRefresh: autoRefresh, lastDownload: lastDownload,
    clearForLogout: clearForLogout, refreshCounts: refreshCounts,
    // exposed for tests
    _patchSheet: patchSheet_, _validate: validateEntries_,
  };
})();
