(() => {
  if (globalThis.__gbfBattleMonitorContentLoaded)
    return;
  globalThis.__gbfBattleMonitorContentLoaded = true;

  const eventName = `__gbf_battle_monitor_${chrome.runtime.id}`;
  const requestEventName = `${eventName}_request`;
  const pendingInspections = new Map();

  document.addEventListener(eventName, (event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== 'string')
      return;
    try {
      const payload = JSON.parse(event.detail);
      if ((payload?.kind === 'node_inspection' || payload?.kind === 'route_state'
        || payload?.kind === 'miasma_analysis' || payload?.kind === 'guidebook_capture'
        || payload?.kind === 'guidebook_diagnostics')
        && pendingInspections.has(payload.requestId)) {
        const pending = pendingInspections.get(payload.requestId);
        pendingInspections.delete(payload.requestId);
        clearTimeout(pending.timer);
        pending.sendResponse(payload);
        return;
      }
      chrome.runtime.sendMessage({
        type: 'GBF_BATTLE_EVENT',
        payload,
      }).catch(() => {});
    }
    catch {
      // 対象外、または壊れたページイベントは無視する。
    }
  });

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('page-hook.js');
  script.dataset.eventName = eventName;
  script.dataset.requestEventName = requestEventName;
  script.async = false;
  script.addEventListener('load', () => script.remove(), { once: true });

  const inject = () => {
    const target = document.head || document.documentElement;
    if (target)
      target.appendChild(script);
    else
      setTimeout(inject, 0);
  };
  inject();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'GBF_INSPECT_GAME_VIEW_NODES'
      && message?.type !== 'GBF_CAPTURE_ROUTE_STATE'
      && message?.type !== 'GBF_CAPTURE_MIASMA_ANALYSIS'
      && message?.type !== 'GBF_CAPTURE_GUIDEBOOK_EFFECTS'
      && message?.type !== 'GBF_INSPECT_GUIDEBOOK_STORAGE')
      return false;
    const requestKind = message.type === 'GBF_CAPTURE_ROUTE_STATE'
      ? 'capture_route_state'
      : (message.type === 'GBF_CAPTURE_MIASMA_ANALYSIS'
        ? 'capture_miasma_analysis'
        : (message.type === 'GBF_CAPTURE_GUIDEBOOK_EFFECTS'
          ? 'capture_guidebook_effects'
          : (message.type === 'GBF_INSPECT_GUIDEBOOK_STORAGE'
            ? 'inspect_guidebook_storage' : 'inspect_game_view_nodes')));
    const requestId = typeof crypto?.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    const timeoutMs = requestKind === 'inspect_guidebook_storage' ? 45000 : 15000;
    const timer = setTimeout(() => {
      if (!pendingInspections.has(requestId))
        return;
      pendingInspections.delete(requestId);
      const responseKind = requestKind === 'capture_route_state'
        ? 'route_state'
        : (requestKind === 'capture_miasma_analysis'
          ? 'miasma_analysis'
          : (requestKind === 'capture_guidebook_effects'
            ? 'guidebook_capture'
            : (requestKind === 'inspect_guidebook_storage'
              ? 'guidebook_diagnostics' : 'node_inspection')));
      sendResponse({ kind: responseKind, requestId, error: '取得がタイムアウトしました' });
    }, timeoutMs);
    pendingInspections.set(requestId, { sendResponse, timer });
    document.dispatchEvent(new CustomEvent(requestEventName, {
      detail: JSON.stringify({ kind: requestKind, requestId }),
    }));
    return true;
  });
})();
