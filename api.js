function call(fnName, args, onSuccess, onError) {
  var handleError = onError || function (e) { alert(e); };

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ fn: fnName, args: args || [] }),
  })
    .then(function (response) { return response.text(); })
    .then(function (text) {
      var res;
      try {
        res = JSON.parse(text);
      } catch (e) {
        handleError('The server sent back something unexpected. Check that API_URL in config.js is correct.');
        return;
      }
      if (res && res.ok === false) {
        handleError(res.error);
        return;
      }
      onSuccess(res && res.data !== undefined ? res.data : res);
    })
    .catch(function (err) {
      handleError('Could not reach the server (' + err.message + '). Check your internet connection and that API_URL in config.js is correct.');
    });
}
