/* Runs before the game module, even if its download or WebGL initialization fails.
 * Local diagnostics only: no telemetry, storage changes or automatic reload loop. */
(() => {
  let phase = 'chargement du module';
  const history = [];
  let failure = null;
  let ready = false;
  const snapshot = () => ({
    phase, ready, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio,
    visibility: document.visibilityState, userAgent: navigator.userAgent,
    history: history.slice(), failure,
  });
  const note = (name, detail) => {
    phase = name;
    history.push({ phase, detail, ms: Math.round(performance.now()) });
    if (history.length > 16) history.shift();
  };
  const paint = () => {
    if (!document.body || !failure) return;
    document.getElementById('loading')?.classList.add('hidden');
    let panel = document.getElementById('renderFailure');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'renderFailure';
      panel.setAttribute('role', 'alert');
      panel.style.cssText = 'position:fixed;inset:auto 12px 12px;z-index:10000;max-height:65vh;overflow:auto;background:#142137;color:#fff;border:2px solid #75d9ed;border-radius:12px;padding:18px;font:15px system-ui;user-select:text;touch-action:pan-y';
      const title = document.createElement('strong');
      title.textContent = 'Le rendu 3D a été interrompu';
      const message = document.createElement('p'); message.id = 'renderFailureMessage';
      const hint = document.createElement('p');
      hint.textContent = 'Vos achats sauvegardés sont conservés. Si le problème revient, transmettez les détails ci-dessous.';
      const retry = document.createElement('button'); retry.id = 'retryRendering';
      retry.textContent = 'Réessayer le chargement';
      retry.style.cssText = 'margin:12px 0;padding:12px;color:#071422;background:#75d9ed;border:0;border-radius:8px';
      retry.onclick = () => location.reload();
      const details = document.createElement('details'), summary = document.createElement('summary'), pre = document.createElement('pre');
      summary.textContent = 'Détails techniques à transmettre'; pre.id = 'renderFailureDetails';
      pre.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;margin-top:12px';
      details.append(summary, pre); panel.append(title, message, hint, retry, details); document.body.append(panel);
    }
    const message = /creating WebGL context/i.test(failure.message)
      ? 'Chrome n’a pas pu initialiser WebGL. Réessayez le chargement ; si cela persiste, transmettez les détails techniques ci-dessous.'
      : /^Shader /.test(failure.message)
        ? 'Le pilote graphique n’a pas pu compiler un effet 3D. Transmettez les détails techniques ci-dessous.'
        : failure.message;
    document.getElementById('renderFailureMessage').textContent = message;
    document.getElementById('renderFailureDetails').textContent = JSON.stringify(snapshot(), null, 2);
  };
  const fail = (error, at = phase) => {
    const message = String(error?.message || error || 'Erreur graphique inconnue').slice(0, 3000);
    failure = { phase: at, message };
    note(at, message); paint();
  };
  const timeout = setTimeout(() => {
    if (!ready) fail('Le démarrage ne s’est pas terminé. Vérifiez la connexion et transmettez les détails techniques si cela persiste.');
  }, 20000);
  window.__tkaBoot = {
    note, fail, snapshot,
    finish() { ready = true; clearTimeout(timeout); document.getElementById('loading')?.classList.add('hidden'); },
    recover(at) { if (failure?.phase === at) { failure = null; document.getElementById('renderFailure')?.remove(); } },
  };
  window.addEventListener('error', event => {
    if (event instanceof ErrorEvent) fail(event.error || event.message);
    else if (event.target?.tagName === 'SCRIPT') fail('Le module du jeu n’a pas pu être chargé. Vérifiez la connexion.', 'chargement du module');
  }, true);
  window.addEventListener('unhandledrejection', event => fail(event.reason));
  document.addEventListener('DOMContentLoaded', paint);
  note(phase);
})();
