/* Admin helpers: save through fetch, uploads with progress, drag-and-drop ordering. */
(function () {
  'use strict';

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

  /** /admin/upload/<entity>/<id>/<kind>, plus ?name= for plain files. */
  function uploadUrl(entity, id, kind, file) {
    var url = '/admin/upload/' + entity + '/' + id + '/' + kind;
    return kind === 'file' ? url + '?name=' + encodeURIComponent(file.name) : url;
  }

  function label(kind) {
    if (kind === 'screenshot') return 'Скриншот';
    if (kind === 'image') return 'Картинка';
    return 'Файл';
  }

  // ------------------------------------------------ program editor: save, then upload

  var editor = document.querySelector('form[data-editor]');
  if (editor) {
    editor.addEventListener('submit', function (event) {
      event.preventDefault();
      var entity = editor.getAttribute('data-entity');
      say('Сохраняю…');

      fetch(editor.getAttribute('action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams(new FormData(editor)),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok) throw new Error(body.error || 'не сохранилось');
            return body;
          });
        })
        .then(function (saved) {
          var uploads = [];
          editor.querySelectorAll('[data-upload]').forEach(function (input) {
            if (!input.files || !input.files[0]) return;
            var file = input.files[0];
            var kind = input.getAttribute('data-upload');
            uploads.push(function () {
              return putFile(uploadUrl(entity, saved.id, kind, file), file, function (percent) {
                say(label(kind) + ': ' + percent + '%');
              });
            });
          });

          return uploads
            .reduce(function (chain, next) { return chain.then(next); }, Promise.resolve())
            .then(function () { return saved; });
        })
        .then(function (saved) {
          // Saved and uploaded: back to the family's list.
          window.location.href = '/admin?family=' + saved.family_id;
        })
        .catch(function (err) { say(err.message, true); });
    });
  }

  // --------------------------------- reference forms: upload as soon as a file is picked

  document.querySelectorAll('form[data-entity][data-id]:not([data-editor])').forEach(function (form) {
    var entity = form.getAttribute('data-entity');
    var id = form.getAttribute('data-id');
    form.querySelectorAll('[data-upload]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!input.files || !input.files[0]) return;
        var file = input.files[0];
        var kind = input.getAttribute('data-upload');
        say(label(kind) + ': 0%');
        putFile(uploadUrl(entity, id, kind, file), file, function (percent) {
          say(label(kind) + ': ' + percent + '%');
        })
          .then(function () { window.location.reload(); })
          .catch(function (err) { say(err.message, true); });
      });
    });
  });

  // ---------------------------- emulator slots: upload as soon as a file is picked

  document.querySelectorAll('[data-upload-emu]').forEach(function (input) {
    var form = input.closest('form[data-id]');
    if (!form) return;
    input.addEventListener('change', function () {
      if (!input.files || !input.files[0]) return;
      var file = input.files[0];
      var url = '/admin/upload/program/' + form.getAttribute('data-id') + '/emu/' +
        input.getAttribute('data-upload-emu') + '?name=' + encodeURIComponent(file.name);
      say('Файл: 0%');
      putFile(url, file, function (percent) { say('Файл: ' + percent + '%'); })
        .then(function () { window.location.reload(); })
        .catch(function (err) { say(err.message, true); });
    });
  });

  // ------------------------------------------------- markdown editor: text / preview

  document.querySelectorAll('[data-md]').forEach(function (editorBox) {
    var source = editorBox.querySelector('[data-md-source]');
    var preview = editorBox.querySelector('[data-md-preview]');
    var tabs = editorBox.querySelectorAll('[data-md-tab]');
    if (!source || !preview) return;
    var timer = null;
    var lastText = null;

    function render() {
      var text = source.value;
      if (text === lastText) return;
      lastText = text;
      fetch('/admin/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ text: text }),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            // An error must not masquerade as an empty description.
            if (!res.ok) throw new Error(body.error || 'ошибка ' + res.status);
            return body;
          });
        })
        // The server produced this HTML with the same renderer the public page uses.
        .then(function (body) { preview.innerHTML = body.html || '<p class="muted">Пусто.</p>'; })
        .catch(function (err) {
          lastText = null; // let the next attempt retry instead of trusting the cache
          preview.textContent = 'Предпросмотр недоступен: ' + err.message;
        });
    }

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var wantPreview = tab.getAttribute('data-md-tab') === 'preview';
        tabs.forEach(function (other) { other.classList.toggle('active', other === tab); });
        source.hidden = wantPreview;
        preview.hidden = !wantPreview;
        if (wantPreview) render();
      });
    });

    source.addEventListener('input', function () {
      if (preview.hidden) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(render, 300);
    });
  });

  // ------------------------------------------------------------ copy an external URL

  document.querySelectorAll('[data-copy]').forEach(function (button) {
    button.addEventListener('click', function () {
      var field = button.parentNode.querySelector('[data-copy-source]');
      if (!field) return;
      field.select();
      var done = function () { button.textContent = 'скопировано'; };
      if (navigator.clipboard) navigator.clipboard.writeText(field.value).then(done, function () {});
      else done();
    });
  });

  // ------------------------------------------------------------------- clear buttons

  document.querySelectorAll('[data-clear]').forEach(function (button) {
    button.addEventListener('click', function () {
      if (!window.confirm('Удалить загруженный файл?')) return;
      fetch('/admin/clear/' + button.getAttribute('data-clear'), {
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

  // ---------------------------------------------------------------- drag-and-drop order

  document.querySelectorAll('table[data-reorder]').forEach(function (table) {
    var tableName = table.getAttribute('data-reorder');
    var tbody = table.querySelector('tbody');
    if (!tbody) return;
    var dragged = null;

    function persist() {
      var order = Array.prototype.map.call(tbody.rows, function (row) { return row.getAttribute('data-id'); });
      fetch('/admin/reorder/' + tableName, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ order: order.join(',') }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('порядок не сохранился');
          say('Порядок сохранён.');
        })
        .catch(function (err) { say(err.message, true); });
    }

    tbody.addEventListener('dragstart', function (event) {
      dragged = event.target.closest('tr');
      if (!dragged) return;
      event.dataTransfer.effectAllowed = 'move';
      // Firefox refuses to start a drag without a payload.
      event.dataTransfer.setData('text/plain', dragged.getAttribute('data-id') || '');
      dragged.classList.add('dragging');
    });

    tbody.addEventListener('dragover', function (event) {
      if (!dragged) return;
      event.preventDefault();
      var over = event.target.closest('tr');
      if (!over || over === dragged) return;
      var box = over.getBoundingClientRect();
      var before = event.clientY < box.top + box.height / 2;
      tbody.insertBefore(dragged, before ? over : over.nextSibling);
    });

    tbody.addEventListener('drop', function (event) { event.preventDefault(); });

    tbody.addEventListener('dragend', function () {
      if (!dragged) return;
      dragged.classList.remove('dragging');
      dragged = null;
      persist();
    });

    // Keyboard and touch fallback: HTML5 drag events serve neither.
    tbody.addEventListener('click', function (event) {
      var button = event.target.closest('[data-move]');
      if (!button) return;
      var row = button.closest('tr');
      var sibling = button.getAttribute('data-move') === 'up'
        ? row.previousElementSibling
        : row.nextElementSibling;
      if (!sibling) return;
      if (button.getAttribute('data-move') === 'up') tbody.insertBefore(row, sibling);
      else tbody.insertBefore(sibling, row);
      persist();
    });
  });

  // ------------------------------------------- show only the models of the chosen family

  var familySelect = document.querySelector('[data-family-select]');
  var modelGroups = document.querySelector('[data-model-groups]');
  if (familySelect && modelGroups) {
    var syncGroups = function () {
      modelGroups.querySelectorAll('.model-group').forEach(function (group) {
        group.hidden = group.getAttribute('data-family') !== familySelect.value;
      });
    };
    familySelect.addEventListener('change', syncGroups);
    syncGroups();
  }

  // ------------------------------------------------------------------ confirmations

  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      if (!window.confirm(form.getAttribute('data-confirm'))) event.preventDefault();
    });
  });
})();
