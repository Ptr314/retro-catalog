/* Filter forms apply a dropdown choice at once; the search text goes along as a normal field. */
(function () {
  'use strict';

  document.querySelectorAll('form[data-autosubmit]').forEach(function (form) {
    var model = form.querySelector('select[name="model"]');
    form.addEventListener('change', function (e) {
      var target = e.target;
      if (!(target instanceof HTMLSelectElement)) return;
      // Another family has other models: a model left over from the old one would match nothing.
      if (target.name === 'family' && model) model.value = '';
      form.requestSubmit();
    });

    // Build the address by hand so empty filters stay out of it: ?q=x, not ?q=x&family=&model=…
    form.addEventListener('submit', function (e) {
      var params = new URLSearchParams();
      new FormData(form).forEach(function (value, name) {
        if (typeof value === 'string' && value.trim() !== '') params.append(name, value);
      });
      e.preventDefault();
      var query = params.toString();
      location.assign(form.action + (query ? '?' + query : ''));
    });
  });
})();
