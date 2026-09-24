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
  });
})();
