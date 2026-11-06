/*
 * Every page: pictures scale as pixels only while they are being enlarged.
 *
 * image-rendering: pixelated keeps 8-bit pixels square when a picture is stretched, but it
 * also refuses to average when the picture is shrunk: each screen pixel takes one pixel of
 * the source and the rest are dropped. A screenshot made of one-pixel stripes, drawn at half
 * its width, keeps only every other column — and when those are the black ones, the tile is
 * black, while a 2x display drawing the same tile at full size shows it intact. CSS cannot
 * compare a picture's own size with the size it is drawn at, so this script does: an image
 * drawn larger than its pixels gets .upscaled, and everything else is left to the browser's
 * smooth filter. Without the script every picture is smooth — soft at worst, never lost.
 */
(function () {
  'use strict';

  // Device pixels per source pixel, as object-fit lays the picture into its box.
  function scale(img) {
    if (!img.naturalWidth || !img.naturalHeight) return 0;
    var x = img.clientWidth / img.naturalWidth;
    var y = img.clientHeight / img.naturalHeight;
    // cover fills the box and crops, contain fits inside it; anything else (fill stretches
    // each axis on its own) counts as enlarged only when both axes are
    var fit = window.getComputedStyle(img).objectFit === 'cover' ? Math.max(x, y) : Math.min(x, y);
    return fit * window.devicePixelRatio;
  }

  function update(img) {
    img.classList.toggle('upscaled', scale(img) > 1);
  }

  function updateAll() {
    Array.prototype.forEach.call(document.images, update);
  }

  // The box changes with the window, the zoom and the layout. observe() itself reports each
  // image once, which makes it the first pass as well.
  var observer = new ResizeObserver(function (entries) {
    entries.forEach(function (entry) { update(entry.target); });
  });
  Array.prototype.forEach.call(document.images, function (img) { observer.observe(img); });

  // A lazy image gets its own size only when it arrives; load does not bubble, but it is captured.
  document.addEventListener('load', function (event) {
    if (event.target instanceof HTMLImageElement) update(event.target);
  }, true);

  // A window moved to a screen of another density keeps its CSS sizes, so no resize is reported.
  function watchDensity() {
    var query = window.matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)');
    query.addEventListener('change', function () {
      updateAll();
      watchDensity();
    }, { once: true });
  }
  watchDensity();
})();
