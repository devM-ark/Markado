(function injectSharedStyles_() {
  var style = document.createElement('style');
  style.textContent =
    '.api-spinner { display:inline-block; width:14px; height:14px; border:2px solid currentColor;' +
    ' border-right-color:transparent; border-radius:50%; animation:api-spin 0.6s linear infinite; vertical-align:-2px; margin-right:6px; }' +
    '.api-btn-loading { opacity:0.85; cursor:not-allowed; pointer-events:none; }' +
    '@keyframes api-spin { to { transform:rotate(360deg); } }' +
    '.api-toast-container { position:fixed; top:18px; left:50%; transform:translateX(-50%); z-index:9999;' +
    ' display:flex; flex-direction:column; gap:8px; align-items:center; pointer-events:none; }' +
    '.api-toast { pointer-events:auto; padding:11px 18px; border-radius:6px; font-family:inherit; font-size:0.9rem;' +
    ' box-shadow:0 2px 10px rgba(0,0,0,0.18); color:#fff; opacity:0; transform:translateY(-8px);' +
    ' transition:opacity 0.2s ease, transform 0.2s ease; max-width:90vw; }' +
    '.api-toast.api-toast-visible { opacity:1; transform:translateY(0); }' +
    '.api-toast-error { background:#A3402F; } .api-toast-success { background:#2E5B3E; }' +
    '.api-state { text-align:center; padding:24px 12px; color:#5C6773; font-size:0.9rem; }' +
    '.api-state.api-state-error { color:#A3402F; }' +
    '.api-state .api-retry { margin-top:10px; padding:7px 16px; border:1px solid currentColor; background:transparent;' +
    ' color:inherit; border-radius:6px; font:inherit; cursor:pointer; display:block; margin-left:auto; margin-right:auto; }' +
    '.api-status { position:fixed; left:50%; bottom:18px; transform:translateX(-50%); z-index:9998; background:#2B3440; color:#fff;' +
    ' padding:9px 16px; border-radius:20px; font-size:0.85rem; box-shadow:0 2px 10px rgba(0,0,0,0.25); max-width:90vw; display:none; }' +
    '.api-status.api-status-visible { display:block; }';
  document.head.appendChild(style);
})();

function escapeHtml(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function showToast(message, type) {
  var containerId = 'api-toast-container';
  var container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'api-toast-container';
    document.body.appendChild(container);
  }

  var toast = document.createElement('div');
  toast.className = 'api-toast ' + (type === 'success' ? 'api-toast-success' : 'api-toast-error');
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(function () { toast.classList.add('api-toast-visible'); });

  setTimeout(function () {
    toast.classList.remove('api-toast-visible');
    setTimeout(function () { toast.remove(); }, 250);
  }, 4000);
}


var API_DEFAULT_TIMEOUT_MS_ = 30000;


var API_TIMEOUTS_MS_ = {
  clientLogin_: 60000, clientAdminLogin_: 60000, clientStudentLogin_: 60000, clientRegister_: 60000,
  clientResetPassword_: 60000, clientChangePassword_: 60000, clientRequestPasswordReset_: 60000,
  clientOnboard_: 90000, clientPublish_: 90000, clientUnpublish_: 90000,
  clientPreviewEcrUpload_: 180000, clientConfirmEcrUpload_: 180000, clientSaveManualGrades_: 90000,
  clientGetDashboardStats_: 90000, clientListTeachersForAdmin_: 90000, clientBulkApplyAdminAction_: 120000,
  clientWipeAllDataForTesting_: 120000,
  clientListClassSubjects_: 60000, clientImportStudents_: 90000, clientDeleteWorkspace_: 90000,
};


var API_READ_TTL_MS_ = {
  clientListWorkspaces_: 60000, clientGetLicenseStatus_: 30000, clientListClassSubjects_: 60000,
  clientListRoster_: 60000, clientGetClassRecordGrades_: 30000, clientGetMyGrades_: 60000,
  clientGetDashboardStats_: 30000, clientListTeachersForAdmin_: 30000, clientGetTeacherDetailForAdmin_: 15000,
  clientListAuditLogs_: 0, clientGetSystemSettings_: 60000,
  clientGetLicenseRequestInfo_: 15000, clientListLicenseRequests_: 0, clientGetMyProfile_: 60000,
};

var API_NON_MUTATING_ = { clientPing_: true };
var API_SLOW_NOTICE_MS_ = 7000;

var api_ = {
  generation: 0,
  cache: {},
  inflight: {},
  pending: 0,
  slowTimer: null,
  buttons: typeof WeakMap !== 'undefined' ? new WeakMap() : null,
  gesture: { el: null, t: 0 },
};

function invalidateApiCache() {
  api_.generation++;
  api_.cache = {};
}


(function trackUserGestures_() {
  function remember(el) { api_.gesture = { el: el, t: Date.now() }; }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button, input[type=submit]') : null;
    if (b) remember(b);
  }, true);
  document.addEventListener('submit', function (e) {
    var f = e.target;
    var b = e.submitter || (f && f.querySelector ? f.querySelector('button[type=submit], input[type=submit], button:not([type])') : null);
    if (b) remember(b);
  }, true);
})();

function resolveTriggerButton_(options) {
  if (options.silent || options.button === false) return null;
  if (options.button) return options.button;
  var g = api_.gesture;
  if (g.el && Date.now() - g.t < 1500 && document.contains(g.el) && !g.el.disabled) return g.el;
  return null;
}

function acquireButton_(btn) {
  if (!btn || !api_.buttons || btn.tagName !== 'BUTTON') return function () {};
  var rec = api_.buttons.get(btn);
  if (!rec) {
    var spinner = document.createElement('span');
    spinner.className = 'api-spinner';
    btn.insertBefore(spinner, btn.firstChild);
    rec = { count: 0, wasDisabled: btn.disabled, spinner: spinner };
    btn.disabled = true;
    btn.classList.add('api-btn-loading');
    btn.setAttribute('aria-busy', 'true');
    api_.buttons.set(btn, rec);
  }
  rec.count++;
  var released = false;
  return function release() {
    if (released) return;
    released = true;
    rec.count--;
    if (rec.count > 0) return;
    if (rec.spinner.parentNode) rec.spinner.parentNode.removeChild(rec.spinner);
    btn.disabled = rec.wasDisabled;
    btn.classList.remove('api-btn-loading');
    btn.removeAttribute('aria-busy');
    api_.buttons.delete(btn);
  };
}


function trackPending_(delta) {
  api_.pending = Math.max(0, api_.pending + delta);
  var el = document.getElementById('api-status');
  if (api_.pending > 0) {
    if (!api_.slowTimer) {
      api_.slowTimer = setTimeout(function () {
        var node = document.getElementById('api-status');
        if (!node) {
          node = document.createElement('div');
          node.id = 'api-status';
          node.className = 'api-status';
          node.setAttribute('role', 'status');
          document.body.appendChild(node);
        }
        node.textContent = 'Still working\u2026 the server is taking longer than usual.';
        node.classList.add('api-status-visible');
      }, API_SLOW_NOTICE_MS_);
    }
  } else {
    clearTimeout(api_.slowTimer);
    api_.slowTimer = null;
    if (el) el.classList.remove('api-status-visible');
  }
}


function interpretResponse_(r) {
  var text = (r.text || '').trim();
  if (!r.ok) {
    var msg;
    if (r.status === 401 || r.status === 403) msg = 'The server refused the request (HTTP ' + r.status + '). The web app may not be publicly accessible.';
    else if (r.status === 404) msg = 'The server could not be found (HTTP 404). The web app URL may have changed.';
    else if (r.status === 429) msg = 'Too many requests right now. Please wait a moment and try again.';
    else msg = 'The server had a problem (HTTP ' + r.status + '). Please try again.';
    return { ok: false, kind: 'http', error: msg, retryable: r.status >= 500 };
  }
  if (text.charAt(0) === '<') {
    return { ok: false, kind: 'html', error: 'The server returned an unexpected page instead of data. It may be temporarily unavailable or over its quota \u2014 please try again shortly.', retryable: true };
  }
  var res;
  try {
    res = JSON.parse(text);
  } catch (e) {
    return { ok: false, kind: 'parse', error: 'The server sent back something unexpected.' };
  }
  if (res && res.ok === false) {
    return { ok: false, kind: 'app', error: res.error || 'Something went wrong. Please try again.' };
  }
  return { ok: true, data: res && res.data !== undefined ? res.data : res };
}

function sendRequest_(fnName, args, timeoutMs, isRead) {
  return new Promise(function (resolve) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timedOut = false;
    var timer = setTimeout(function () {
      timedOut = true;
      if (controller) controller.abort();
      resolve({
        ok: false, kind: 'timeout',
        error: isRead
          ? 'The request timed out after ' + Math.round(timeoutMs / 1000) + ' seconds. The server may be busy \u2014 please try again.'
          : 'The request timed out after ' + Math.round(timeoutMs / 1000) + ' seconds. It may still have been processed \u2014 refresh and check before trying again.',
      });
    }, timeoutMs);

    var init = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fnName, args: args || [] }),
    };
    if (controller) init.signal = controller.signal;

    fetch(API_URL, init)
      .then(function (response) {
        return response.text().then(function (text) { return { ok: response.ok, status: response.status, text: text }; });
      })
      .then(function (r) {
        clearTimeout(timer);
        if (!timedOut) resolve(interpretResponse_(r));
      })
      .catch(function (err) {
        clearTimeout(timer);
        if (timedOut) return;
        resolve({
          ok: false, kind: 'network', retryable: true,
          error: 'Could not reach the server (' + (err && err.message ? err.message : 'network error') + '). Check your internet connection.',
        });
      });
  });
}

function execute_(fnName, args, timeoutMs, isRead) {
  return sendRequest_(fnName, args, timeoutMs, isRead).then(function (res) {
    if (isRead && !res.ok && res.retryable) {
      return new Promise(function (r) { setTimeout(r, 700); }).then(function () {
        return sendRequest_(fnName, args, timeoutMs, isRead);
      });
    }
    return res;
  });
}


function safeInvoke_(fn, arg, arg2, isSuccessHandler) {
  try {
    fn(arg, arg2);
  } catch (e) {
    console.error('Handler error:', e);
    if (isSuccessHandler) showToast('Something went wrong while showing the result. Please refresh the page.', 'error');
  }
}

function deliver_(waiter, res) {
  waiter.release();
  if (res.ok) {
    if (waiter.onSuccess) safeInvoke_(waiter.onSuccess, res.data, undefined, true);
    return;
  }
  if (res.kind === 'app' && /session expired/i.test(res.error) && typeof window.onApiSessionExpired === 'function') {
    var handled = false;
    try { handled = window.onApiSessionExpired(res.error) === true; } catch (e) { console.error(e); }
    if (handled) return;
  }
  if (waiter.silent) return;
  var handler = waiter.onError || function (msg) { showToast(msg, 'error'); };
  safeInvoke_(handler, res.error, res, false);
}

function call(fnName, args, onSuccess, onError, options) {
  options = options || {};
  args = args || [];
  var isRead = Object.prototype.hasOwnProperty.call(API_READ_TTL_MS_, fnName);
  var key = fnName + '|' + JSON.stringify(args);
  var waiter = { onSuccess: onSuccess, onError: onError, silent: !!options.silent, release: function () {} };

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    Promise.resolve().then(function () { deliver_(waiter, { ok: false, kind: 'offline', error: 'You appear to be offline. Check your internet connection and try again.' }); });
    return;
  }

  // 1. fresh cached read
  if (isRead && !options.fresh) {
    var hit = api_.cache[key];
    if (hit && hit.expires > Date.now()) {
      Promise.resolve().then(function () { deliver_(waiter, { ok: true, data: hit.data }); });
      return;
    }
  }

  var existing = api_.inflight[key];
  if (existing && existing.generation === api_.generation) {
    if (isRead) {
      // 2. identical read already on the wire: share it
      waiter.release = acquireButton_(resolveTriggerButton_(options));
      existing.waiters.push(waiter);
      return;
    }
    // 3. identical write already on the wire (double click / double Enter): drop the duplicate
    console.warn('Ignoring duplicate in-flight request:', fnName);
    return;
  }

  // 4. new request
  waiter.release = acquireButton_(resolveTriggerButton_(options));
  if (!isRead && !API_NON_MUTATING_[fnName]) invalidateApiCache(); // anything cached before this write is now suspect

  var entry = { generation: api_.generation, waiters: [waiter] };
  api_.inflight[key] = entry;
  var timeoutMs = options.timeoutMs || API_TIMEOUTS_MS_[fnName] || API_DEFAULT_TIMEOUT_MS_;
  if (!options.silent) trackPending_(1);

  execute_(fnName, args, timeoutMs, isRead).then(function (res) {
    if (!options.silent) trackPending_(-1);
    if (api_.inflight[key] === entry) delete api_.inflight[key];

    if (!isRead && !API_NON_MUTATING_[fnName]) {
      invalidateApiCache(); // success or failure: the server state may have changed
    } else if (isRead && res.ok && entry.generation === api_.generation && API_READ_TTL_MS_[fnName] > 0) {
      api_.cache[key] = { data: res.data, expires: Date.now() + API_READ_TTL_MS_[fnName] };
    }
    entry.waiters.forEach(function (w) { deliver_(w, res); });
  });
}


function stateContainer_(el, className) {
  var box = document.createElement('div');
  box.className = 'api-state ' + (className || '');
  if (el && el.tagName === 'TBODY') {
    var table = el.closest ? el.closest('table') : null;
    var headRow = table && table.tHead && table.tHead.rows[0];
    var cols = headRow ? headRow.cells.length : 1;
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = cols;
    td.appendChild(box);
    tr.appendChild(td);
    return { outer: tr, inner: box };
  }
  // A CSS Grid parent (the Male/Female grade columns, a card grid, ...) would otherwise lay this out as just its
  // first cell/track -- a fraction of the width -- which is what made a loading message look off-center instead
  // of centered in the area as a whole. Span every column so it's centered across the full width instead.
  if (el && typeof getComputedStyle === 'function' && getComputedStyle(el).display.indexOf('grid') !== -1) {
    box.style.gridColumn = '1 / -1';
  }
  return { outer: box, inner: box };
}


function setLoading(el, message) {
  if (!el) return;
  var c = stateContainer_(el, '');
  var sp = document.createElement('span');
  sp.className = 'api-spinner';
  c.inner.appendChild(sp);
  c.inner.appendChild(document.createTextNode(message || 'Loading\u2026'));
  el.innerHTML = '';
  el.appendChild(c.outer);
}


function setErrorState(el, message, onRetry) {
  if (!el) return;
  var c = stateContainer_(el, 'api-state-error');
  var p = document.createElement('div');
  p.textContent = message || 'Something went wrong.';
  c.inner.appendChild(p);
  if (onRetry) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'api-retry';
    b.textContent = 'Try again';
    b.addEventListener('click', onRetry);
    c.inner.appendChild(b);
  }
  el.innerHTML = '';
  el.appendChild(c.outer);
}