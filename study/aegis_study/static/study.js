/* Starts the AEGIS SDK on study pages. Telemetry is sent every 15 s while the page
 * is visible and once more when it is left, so each page view yields a growing
 * series of snapshots (useful for "how early can a bot be detected"). */
(function () {
  'use strict';
  var config = document.body.dataset;
  // One id per page view, shared by the SDK telemetry stream and the raw recorder,
  // so both can be joined exactly in the dataset
  var pageView = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  window.__aegisStudyPageView = pageView;
  if (window.Aegis && config.siteKey) {
    var client = new window.Aegis.AegisClient({ siteKey: config.siteKey, beaconOnExit: true, autoIntercept: false,
      streamId: pageView });
    var send = function () {
      if (document.visibilityState === 'visible') client.submit().catch(function () {});
    };
    setTimeout(send, 3000);
    setInterval(send, 15000);
  }
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.dataset.confirm)) e.preventDefault();
    });
  });
})();
