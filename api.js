(function injectSharedStyles_() {
  var style = document.createElement('style');
  style.textContent =
    '.api-spinner { display:inline-block; width:14px; height:14px; border:2px solid rgba(255,255,255,0.4);' +
    ' border-top-color:#fff; border-radius:50%; animation:api-spin 0.6s linear infinite; vertical-align:-2px; margin-right:6px; }' +
    '.api-btn-loading { opacity:0.85; cursor:not-allowed; pointer-events:none; }' +
    '@keyframes api-spin { to { transform:rotate(360deg); } }' +
    '.api-toast-container { position:fixed; top:18px; left:50%; transform:translateX(-50%); z-index:9999;' +
    ' display:flex; flex-direction:column; gap:8px; align-items:center; pointer-events:none; }' +
    '.api-toast { pointer-events:auto; padding:11px 18px; border-radius:6px; font-family:inherit; font-size:0.9rem;' +
    ' box-shadow:0 2px 10px rgba(0,0,0,0.18); color:#fff; opacity:0; transform:translateY(-8px);' +
    ' transition:opacity 0.2s ease, transform 0.2s ease; max-width:90vw; }' +
    '.api-toast.api-toast-visible { opacity:1; transform:translateY(0); }' +
    '.api-toast-error { background:#A3402F; } .api-toast-success { background:#2E5B3E; }';
  document.head.appendChild(style);
})();

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

function beginButtonLoading_(button) {
  if (!button || button.tagName !== 'BUTTON') return function () {};
  var originalHtml = button.innerHTML;
  var originalDisabled = button.disabled;
  button.disabled = true;
  button.classList.add('api-btn-loading');
  button.innerHTML = '<span class="api-spinner"></span>' + originalHtml;
  return function restore() {
    button.innerHTML = originalHtml;
    button.disabled = originalDisabled;
    button.classList.remove('api-btn-loading');
  };
}

function call(fnName, args, onSuccess, onError) {
  var handleError = onError || function (e) { showToast(e, 'error'); };
  var triggerButton = document.activeElement;
  var restoreButton = beginButtonLoading_(triggerButton);

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn: fnName, args: args || [] }),
  })
    .then(function (response) { return response.text(); })
    .then(function (text) {
      restoreButton();
      var res;
      try {
        res = JSON.parse(text);
      } catch (e) {
        handleError('The server sent back something unexpected.');
        return;
      }
      if (res && res.ok === false) {
        handleError(res.error);
        return;
      }
      onSuccess(res && res.data !== undefined ? res.data : res);
    })
    .catch(function (err) {
      restoreButton();
      handleError('Could not reach the server (' + err.message + '). Check your internet connection.');
    });
}
