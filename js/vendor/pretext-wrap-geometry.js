/* Geometrie-Hilfsfunktionen für Textumfluss - portiert aus dem offiziellen
   Pretext-Demo-Code (pages/demos/wrap-geometry.ts, MIT-lizenziert, siehe
   js/vendor/pretext/LICENSE) nach reinem JS ohne TypeScript-Typen, damit es
   ohne Build-Schritt direkt im Browser läuft.

   Enthält:
   - getPolygonIntervalForBand: welcher horizontale Bereich ist in einem
     Zeilen-Band durch ein Vieleck (z.B. eine gezeichnete Form) blockiert.
   - getRectIntervalsForBand: dasselbe für rechteckige Hindernisse (z.B. die
     Bounding-Box eines Fotos).
   - carveTextLineSlots: schneidet aus einem freien Zeilenbereich die
     blockierten Bereiche heraus, liefert die verbleibenden freien Spalten.
   - getWrapHull: extrahiert die tatsächliche Silhouette eines Bildes per
     Alphakanal (OffscreenCanvas), damit Text auch um ein freigestelltes
     Foto herum fließen kann statt nur um dessen rechteckige Box. */
(function (global) {
  'use strict';

  function transformWrapPoints(points, rect, angle) {
    if (!angle) {
      return points.map(function (p) { return { x: rect.x + p.x * rect.width, y: rect.y + p.y * rect.height }; });
    }
    var centerX = rect.x + rect.width / 2, centerY = rect.y + rect.height / 2;
    var cos = Math.cos(angle), sin = Math.sin(angle);
    return points.map(function (p) {
      var localX = (p.x - 0.5) * rect.width, localY = (p.y - 0.5) * rect.height;
      return { x: centerX + localX * cos - localY * sin, y: centerY + localX * sin + localY * cos };
    });
  }

  function getPolygonXsAtY(points, y) {
    var xs = [];
    var a = points[points.length - 1];
    if (!a) { return xs; }
    for (var i = 0; i < points.length; i++) {
      var b = points[i];
      if ((a.y <= y && y < b.y) || (b.y <= y && y < a.y)) {
        xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
      a = b;
    }
    xs.sort(function (x1, x2) { return x1 - x2; });
    return xs;
  }

  function getPolygonIntervalForBand(points, bandTop, bandBottom, horizontalPadding, verticalPadding) {
    var sampleTop = bandTop - verticalPadding, sampleBottom = bandBottom + verticalPadding;
    var startY = Math.floor(sampleTop), endY = Math.ceil(sampleBottom);
    var left = Infinity, right = -Infinity;
    for (var y = startY; y <= endY; y++) {
      var xs = getPolygonXsAtY(points, y + 0.5);
      for (var i = 0; i + 1 < xs.length; i += 2) {
        if (xs[i] < left) { left = xs[i]; }
        if (xs[i + 1] > right) { right = xs[i + 1]; }
      }
    }
    if (!isFinite(left) || !isFinite(right)) { return null; }
    return { left: left - horizontalPadding, right: right + horizontalPadding };
  }

  function getRectIntervalsForBand(rects, bandTop, bandBottom, horizontalPadding, verticalPadding) {
    var intervals = [];
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      if (bandBottom <= r.y - verticalPadding || bandTop >= r.y + r.height + verticalPadding) { continue; }
      intervals.push({ left: r.x - horizontalPadding, right: r.x + r.width + horizontalPadding });
    }
    return intervals;
  }

  function carveTextLineSlots(base, blocked) {
    var slots = [base];
    for (var b = 0; b < blocked.length; b++) {
      var interval = blocked[b];
      var next = [];
      for (var s = 0; s < slots.length; s++) {
        var slot = slots[s];
        if (interval.right <= slot.left || interval.left >= slot.right) { next.push(slot); continue; }
        if (interval.left > slot.left) { next.push({ left: slot.left, right: interval.left }); }
        if (interval.right < slot.right) { next.push({ left: interval.right, right: slot.right }); }
      }
      slots = next;
    }
    return slots.filter(function (slot) { return slot.right - slot.left >= 24; });
  }

  // Silhouette eines Bildes per Alphakanal - liefert normalisierte (0..1)
  // Randpunkte, mit denen sich Text auch um die TATSÄCHLICHE Form eines
  // freigestellten Fotos (nicht nur seine rechteckige Box) legen lässt.
  function getWrapHull(src, options) {
    return new Promise(function (resolve, reject) {
      var image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = function () {
        try {
          var maxDimension = 320;
          var aspect = image.naturalWidth / image.naturalHeight;
          var width = aspect >= 1 ? maxDimension : Math.max(64, Math.round(maxDimension * aspect));
          var height = aspect >= 1 ? Math.max(64, Math.round(maxDimension / aspect)) : maxDimension;
          var canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          var ctx = canvas.getContext('2d');
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(image, 0, 0, width, height);
          var data = ctx.getImageData(0, 0, width, height).data;
          var lefts = new Array(height).fill(null), rights = new Array(height).fill(null);
          var alphaThreshold = 12;
          for (var y = 0; y < height; y++) {
            var left = -1, right = -1;
            for (var x = 0; x < width; x++) {
              var alpha = data[(y * width + x) * 4 + 3];
              if (alpha < alphaThreshold) { continue; }
              if (left === -1) { left = x; }
              right = x;
            }
            if (left !== -1 && right !== -1) { lefts[y] = left; rights[y] = right + 1; }
          }
          var validRows = [];
          for (var yy = 0; yy < height; yy++) { if (lefts[yy] !== null && rights[yy] !== null) { validRows.push(yy); } }
          if (!validRows.length) { reject(new Error('Keine sichtbaren Pixel in ' + src)); return; }
          var boundLeft = Infinity, boundRight = -Infinity;
          var boundTop = validRows[0], boundBottom = validRows[validRows.length - 1];
          validRows.forEach(function (yv) {
            if (lefts[yv] < boundLeft) { boundLeft = lefts[yv]; }
            if (rights[yv] > boundRight) { boundRight = rights[yv]; }
          });
          var boundWidth = Math.max(1, boundRight - boundLeft), boundHeight = Math.max(1, boundBottom - boundTop);
          var smoothedLefts = new Array(height).fill(0), smoothedRights = new Array(height).fill(0);
          var smoothRadius = options.smoothRadius;
          validRows.forEach(function (yv) {
            var leftSum = 0, rightSum = 0, count = 0, leftEdge = Infinity, rightEdge = -Infinity;
            for (var off = -smoothRadius; off <= smoothRadius; off++) {
              var si = yv + off;
              if (si < 0 || si >= height || lefts[si] == null) { continue; }
              leftSum += lefts[si]; rightSum += rights[si];
              if (lefts[si] < leftEdge) { leftEdge = lefts[si]; }
              if (rights[si] > rightEdge) { rightEdge = rights[si]; }
              count++;
            }
            if (!count) { smoothedLefts[yv] = 0; smoothedRights[yv] = width; return; }
            if (options.mode === 'envelope') { smoothedLefts[yv] = leftEdge; smoothedRights[yv] = rightEdge; }
            else { smoothedLefts[yv] = leftSum / count; smoothedRights[yv] = rightSum / count; }
          });
          var step = Math.max(1, Math.floor(validRows.length / 52));
          var sampledRows = [];
          for (var si2 = 0; si2 < validRows.length; si2 += step) { sampledRows.push(validRows[si2]); }
          var lastRow = validRows[validRows.length - 1];
          if (sampledRows[sampledRows.length - 1] !== lastRow) { sampledRows.push(lastRow); }
          var points = [];
          sampledRows.forEach(function (yv) {
            points.push({ x: (smoothedLefts[yv] - boundLeft) / boundWidth, y: ((yv + 0.5) - boundTop) / boundHeight });
          });
          for (var k = sampledRows.length - 1; k >= 0; k--) {
            var yv2 = sampledRows[k];
            points.push({ x: (smoothedRights[yv2] - boundLeft) / boundWidth, y: ((yv2 + 0.5) - boundTop) / boundHeight });
          }
          resolve(points);
        } catch (e) { reject(e); }
      };
      image.onerror = function () { reject(new Error('Bild konnte nicht geladen werden: ' + src)); };
      image.src = src;
    });
  }

  global.PretextWrapGeometry = {
    transformWrapPoints: transformWrapPoints,
    getPolygonIntervalForBand: getPolygonIntervalForBand,
    getRectIntervalsForBand: getRectIntervalsForBand,
    carveTextLineSlots: carveTextLineSlots,
    getWrapHull: getWrapHull
  };
})(window);
