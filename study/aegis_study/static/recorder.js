/*
 * Raw event recorder of the AEGIS study (loaded only for participants who
 * agreed to the optional raw-timing item of the consent form).
 *
 * Records WHEN and WHERE input happens, never WHAT is typed:
 *   - keys: a category only (character, space, backspace, ...) and a
 *     press number that pairs each keydown with its keyup; no key codes;
 *   - input fields: their form name (e.g. "username"), never their value;
 *   - pointer positions in CSS pixels of the viewport.
 *
 * Event format: [type, t, ...] with t = milliseconds since the page's
 * performance.timeOrigin (sent with every batch). Types (data dictionary §3):
 *   m move       [m, t, x, y, pointerType, pressure, width, height]
 *   d down       [d, t, x, y, pointerType, button, target]
 *   u up         [u, t, x, y, pointerType, button]
 *   c click      [c, t, x, y, target, left, top, width, height]
 *   w wheel      [w, t, deltaX, deltaY, deltaMode]
 *   s scroll     [s, t, scrollX, scrollY]
 *   k keydown    [k, t, category, press, field, repeat]
 *   K keyup      [K, t, category, press]
 *   i input      [i, t, inputType, field]
 *   p paste      [p, t, field]
 *   f focus      [f, t, field]          b blur [b, t, field]
 *   v visibility [v, t, visible 0|1]
 *   r viewport   [r, t, innerWidth, innerHeight, devicePixelRatio, screenWidth, screenHeight]
 *   n page start [n, t, pageWidth, pageHeight]
 *   e page end   [e, t]
 * pointerType: 0 mouse, 1 pen, 2 touch. Batches go to POST /study/raw every
 * 5 s (or 1500 events) and on page exit with navigator.sendBeacon.
 */
(function () {
  'use strict';
  if (window.__aegisStudyRecorder) return;
  window.__aegisStudyRecorder = true;

  var ENDPOINT = '/study/raw';
  var FLUSH_MS = 5000;
  var MAX_BATCH = 1500;
  // Same id as the page's SDK telemetry stream (set by study.js), so the dataset can join them
  var pageView = window.__aegisStudyPageView || (Math.random().toString(36).slice(2, 12) + Date.now().toString(36));
  var seq = 0;
  var buffer = [];
  var pressNo = 0;
  var held = {};          // event.code -> press number, only while the key is down
  var POINTER = { mouse: 0, pen: 1, touch: 2 };

  function r1(v) { return Math.round(v * 10) / 10; }
  function now(e) { return r1(e && e.timeStamp ? e.timeStamp : performance.now()); }
  function push(ev) {
    buffer.push(ev);
    if (buffer.length >= MAX_BATCH) flush(false);
  }

  function field(el) {
    if (!el || !el.getAttribute) return null;
    var name = el.getAttribute('name') || el.getAttribute('data-study') || el.id || null;
    return name ? String(name).slice(0, 24) : (el.tagName ? el.tagName.toLowerCase() : null);
  }

  function target(el) {
    // Nearest interactive element, labelled by its role in the page (never its text)
    var node = el;
    for (var i = 0; node && i < 4; i++, node = node.parentElement) {
      if (!node.tagName) break;
      var tag = node.tagName.toLowerCase();
      if (tag === 'a' || tag === 'button' || tag === 'input' || tag === 'select' || tag === 'textarea' ||
          tag === 'label' || node.getAttribute('data-study')) {
        var label = node.getAttribute('data-study') || node.getAttribute('name');
        return { node: node, label: (tag + (label ? ':' + label : '')).slice(0, 24) };
      }
    }
    return { node: el && el.tagName ? el : null, label: el && el.tagName ? el.tagName.toLowerCase() : 'none' };
  }

  function keyCategory(e) {
    var k = e.key || '';
    if (k === 'Backspace') return 'b';
    if (k === 'Delete') return 'd';
    if (k === 'Enter') return 'e';
    if (k === 'Tab') return 't';
    if (k === ' ' || k === 'Spacebar') return 's';
    if (k === 'Shift') return 'h';
    if (k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'AltGraph' || k === 'CapsLock') return 'm';
    if (k.indexOf('Arrow') === 0 || k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown') return 'a';
    if (k === 'Process' || k === 'Unidentified' || e.isComposing) return 'i';  // IME (e.g. Bangla keyboards)
    if (k.length === 1) return 'c';
    return 'o';
  }

  function onMove(e) {
    var list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (!list || !list.length) list = [e];
    var pt = POINTER[e.pointerType] !== undefined ? POINTER[e.pointerType] : 0;
    for (var i = 0; i < list.length; i++) {
      var ev = list[i];
      var row = ['m', now(ev), r1(ev.clientX), r1(ev.clientY), pt];
      if (pt !== 0) row.push(r1(ev.pressure || 0), r1(ev.width || 0), r1(ev.height || 0));
      push(row);
    }
  }

  function onDown(e) {
    push(['d', now(e), r1(e.clientX), r1(e.clientY), POINTER[e.pointerType] || 0, e.button, target(e.target).label]);
  }

  function onUp(e) {
    push(['u', now(e), r1(e.clientX), r1(e.clientY), POINTER[e.pointerType] || 0, e.button]);
  }

  function onClick(e) {
    var t = target(e.target);
    var row = ['c', now(e), r1(e.clientX), r1(e.clientY), t.label];
    if (t.node && t.node.getBoundingClientRect) {
      var b = t.node.getBoundingClientRect();
      row.push(r1(b.left), r1(b.top), r1(b.width), r1(b.height));
    }
    push(row);
  }

  function onKeyDown(e) {
    var id;
    if (e.repeat && held[e.code] !== undefined) {
      id = held[e.code];
    } else {
      id = ++pressNo;
      held[e.code || ('_' + id)] = id;
    }
    push(['k', now(e), keyCategory(e), id, field(e.target), e.repeat ? 1 : 0]);
  }

  function onKeyUp(e) {
    var id = held[e.code];
    if (id !== undefined) delete held[e.code];
    push(['K', now(e), keyCategory(e), id === undefined ? null : id]);
  }

  function onInput(e) {
    if (e.inputType) push(['i', now(e), String(e.inputType).slice(0, 24), field(e.target)]);
  }

  function viewport(e) {
    push(['r', now(e), window.innerWidth, window.innerHeight, r1(window.devicePixelRatio || 1),
      screen.width, screen.height]);
  }

  var lastScroll = 0;
  function onScroll(e) {
    var t = now(e);
    if (t - lastScroll < 16) return; // one sample per frame is enough
    lastScroll = t;
    push(['s', t, Math.round(window.scrollX), Math.round(window.scrollY)]);
  }

  function payload() {
    if (!buffer.length) return null;
    var body = JSON.stringify({ pv: pageView, s: seq++, o: r1(performance.timeOrigin || 0),
      p: location.pathname, e: buffer });
    buffer = [];
    return body;
  }

  function flush(final) {
    var body = payload();
    if (!body) return;
    if (final && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
      return;
    }
    try {
      fetch(ENDPOINT, { method: 'POST', body: body, credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
    } catch (err) { /* recording must never break the page */ }
  }

  var opts = { passive: true, capture: true };
  if (window.PointerEvent) {
    document.addEventListener('pointermove', onMove, opts);
    document.addEventListener('pointerdown', onDown, opts);
    document.addEventListener('pointerup', onUp, opts);
  }
  document.addEventListener('click', onClick, opts);
  document.addEventListener('wheel', function (e) {
    push(['w', now(e), r1(e.deltaX), r1(e.deltaY), e.deltaMode]);
  }, opts);
  window.addEventListener('scroll', onScroll, opts);
  document.addEventListener('keydown', onKeyDown, opts);
  document.addEventListener('keyup', onKeyUp, opts);
  document.addEventListener('input', onInput, opts);
  document.addEventListener('paste', function (e) { push(['p', now(e), field(e.target)]); }, opts);
  document.addEventListener('focusin', function (e) { push(['f', now(e), field(e.target)]); }, opts);
  document.addEventListener('focusout', function (e) { push(['b', now(e), field(e.target)]); }, opts);
  document.addEventListener('visibilitychange', function () {
    push(['v', now(), document.visibilityState === 'visible' ? 1 : 0]);
    if (document.visibilityState === 'hidden') flush(true);
  });
  window.addEventListener('resize', viewport, { passive: true });
  window.addEventListener('pagehide', function () { push(['e', now()]); flush(true); });

  viewport();
  push(['n', now(), document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
  setInterval(function () { flush(false); }, FLUSH_MS);
})();
