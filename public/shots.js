/* Program page: arrow keys for a strip of screenshots. Without this script the strip still scrolls. */
(function () {
  'use strict';

  document.querySelectorAll('[data-shots]').forEach(function (strip) {
    var box = strip.parentNode;
    var prev = box.querySelector('[data-shots-prev]');
    var next = box.querySelector('[data-shots-next]');
    if (!prev || !next) return;

    // The arrows replace the scrollbar; style.css hides it only once they exist.
    strip.classList.add('shots-js');

    // An arrow is there only while there is somewhere to go in its direction.
    function sync() {
      var max = strip.scrollWidth - strip.clientWidth;
      prev.hidden = strip.scrollLeft <= 1;
      next.hidden = strip.scrollLeft >= max - 1;
    }

    // One frame is exactly the strip's width; the jump is instant, like switching a channel.
    function step(direction) {
      strip.scrollBy({ left: direction * strip.clientWidth, behavior: 'auto' });
      // Scroll events ride on rendering frames; the jump is already done, so do not wait for one.
      sync();
    }

    prev.addEventListener('click', function () { step(-1); });
    next.addEventListener('click', function () { step(1); });
    strip.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    });
    strip.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    // Lazy pictures change the strip's width as they arrive.
    strip.addEventListener('load', sync, true);
    sync();
  });
})();
