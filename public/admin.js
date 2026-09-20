/* Admin helpers: save through fetch, upload files with a progress indicator. */
(function () {
  'use strict';

  var form = document.querySelector('[data-editor]');
  var status = document.querySelector('[data-status]');

  function say(message, isError) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle('error', Boolean(isError));
  }

  function putFile(url, file, onProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.upload.addEventListener('progress', function (e) {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', function () {
        var body = {};
        try { body = JSON.parse(xhr.responseText); } catch (e) { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new Error(body.error || 'ошибка загрузки (' + xhr.status + ')'));
      });
      xhr.addEventListener('error', function () { reject(new Error('сеть недоступна')); });
      xhr.send(file);
    });
  }

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var isNew = !form.querySelector('input[name="id"]').value;
      say('Сохраняю…');

      fetch('/admin/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(new FormData(form)),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) throw new Error(body.error || 'не сохранилось');
            return body;
          });
        })
        .then(function (saved) {
          var uploads = [];
          form.querySelectorAll('[data-upload]').forEach(function (input) {
            if (!input.files || !input.files[0]) return;
            var file = input.files[0];
            var kind = input.getAttribute('data-upload');
            var url = '/admin/upload/' + saved.id + '/' + kind +
              (kind === 'file' ? '?name=' + encodeURIComponent(file.name) : '');
            uploads.push(function () {
              return putFile(url, file, function (percent) {
                say((kind === 'screenshot' ? 'Скриншот' : 'Файл') + ': ' + percent + '%');
              });
            });
          });

          return uploads
            .reduce(function (chain, next) { return chain.then(next); }, Promise.resolve())
            .then(function () { return { id: saved.id, uploaded: uploads.length > 0 }; });
        })
        .then(function (result) {
          // A new record or a fresh upload changes what the page shows — reopen it.
          if (isNew || result.uploaded) {
            window.location.href = '/admin/edit/' + result.id;
            return;
          }
          say('Сохранено.');
        })
        .catch(function (err) {
          say(err.message, true);
        });
    });
  }

  document.querySelectorAll('[data-clear]').forEach(function (button) {
    button.addEventListener('click', function () {
      var what = button.getAttribute('data-clear');
      if (!window.confirm(what === 'screenshot' ? 'Удалить скриншот?' : 'Удалить файл программы?')) return;
      fetch('/admin/clear/' + button.getAttribute('data-id') + '/' + what, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      })
        .then(function (res) {
          if (!res.ok) throw new Error('не получилось удалить');
          window.location.reload();
        })
        .catch(function (err) { say(err.message, true); });
    });
  });

  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (event) {
      if (!window.confirm(f.getAttribute('data-confirm'))) event.preventDefault();
    });
  });
})();
