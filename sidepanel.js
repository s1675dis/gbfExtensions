const elements = {
  onlineUpdateStatus: document.querySelector('#online-update-status'),
  checkOnlineUpdate: document.querySelector('#check-online-update'),
  openOnlineUpdate: document.querySelector('#open-online-update'),
  totalDamage: document.querySelector('#total-damage'),
  participantCount: document.querySelector('#participant-count'),
  participationId: document.querySelector('#participation-id'),
  copyId: document.querySelector('#copy-id'),
  statsTurn: document.querySelector('#stats-turn'),
  currentHit: document.querySelector('#current-hit'),
  currentAbility: document.querySelector('#current-ability'),
  currentSpecial: document.querySelector('#current-special'),
  currentTotal: document.querySelector('#current-total'),
  previousHit: document.querySelector('#previous-hit'),
  previousAbility: document.querySelector('#previous-ability'),
  previousSpecial: document.querySelector('#previous-special'),
  previousTotal: document.querySelector('#previous-total'),
  characters: document.querySelector('#characters'),
  guidebookCount: document.querySelector('#guidebook-count'),
  guidebookStatus: document.querySelector('#guidebook-status'),
  guidebookToastLayer: document.querySelector('#guidebook-toast-layer'),
  copyGuidebookDiagnostics: document.querySelector('#copy-guidebook-diagnostics'),
  guidebookDiagnosticsStatus: document.querySelector('#guidebook-diagnostics-status'),
  guidebookFilter: document.querySelector('#guidebook-filter'),
  guidebookStateFilter: document.querySelector('#guidebook-state-filter'),
  guidebookList: document.querySelector('#guidebook-list'),
  guidebookCalculatorStatus: document.querySelector('#guidebook-calculator-status'),
  guidebookPercentSummary: document.querySelector('#guidebook-percent-summary'),
  guidebookCountSummary: document.querySelector('#guidebook-count-summary'),
  guidebookFlagSummary: document.querySelector('#guidebook-flag-summary'),
  captureGuidebookEffects: document.querySelector('#capture-guidebook-effects'),
  inspectGuidebookStorage: document.querySelector('#inspect-guidebook-storage'),
  refreshGuidebookEffects: document.querySelector('#refresh-guidebook-effects'),
  copyGuidebookEffects: document.querySelector('#copy-guidebook-effects'),
  exportGuidebookEffects: document.querySelector('#export-guidebook-effects'),
  importGuidebookEffects: document.querySelector('#import-guidebook-effects'),
  importGuidebookFile: document.querySelector('#import-guidebook-file'),
  captureGameNodes: document.querySelector('#capture-game-nodes'),
  copyGameNodes: document.querySelector('#copy-game-nodes'),
  saveGameNodes: document.querySelector('#save-game-nodes'),
  nodeInspectorStatus: document.querySelector('#node-inspector-status'),
  nodeInspectorOutput: document.querySelector('#node-inspector-output'),
  captureMiasmaAnalysis: document.querySelector('#capture-miasma-analysis'),
  copyMiasmaAnalysis: document.querySelector('#copy-miasma-analysis'),
  saveMiasmaAnalysis: document.querySelector('#save-miasma-analysis'),
  miasmaAnalysisStatus: document.querySelector('#miasma-analysis-status'),
  miasmaAnalysisOutput: document.querySelector('#miasma-analysis-output'),
  startAjaxTrace: document.querySelector('#start-ajax-trace'),
  stopAjaxTrace: document.querySelector('#stop-ajax-trace'),
  refreshAjaxTrace: document.querySelector('#refresh-ajax-trace'),
  clearAjaxTrace: document.querySelector('#clear-ajax-trace'),
  copyAjaxTrace: document.querySelector('#copy-ajax-trace'),
  saveAjaxTrace: document.querySelector('#save-ajax-trace'),
  ajaxTraceStatus: document.querySelector('#ajax-trace-status'),
  ajaxTraceCandidates: document.querySelector('#ajax-trace-candidates'),
  ajaxTraceHistory: document.querySelector('#ajax-trace-history'),
  refreshAjaxArchives: document.querySelector('#refresh-ajax-archives'),
  clearAjaxArchives: document.querySelector('#clear-ajax-archives'),
  ajaxArchiveStatus: document.querySelector('#ajax-archive-status'),
  ajaxArchiveList: document.querySelector('#ajax-archive-list'),
  refreshRoutePlan: document.querySelector('#refresh-route-plan'),
  routeMapRadius: document.querySelector('#route-map-radius'),
  routeStateSummary: document.querySelector('#route-state-summary'),
  routePlanStatus: document.querySelector('#route-plan-status'),
  routeMap: document.querySelector('#route-map'),
  routePlanMode: document.querySelector('#route-plan-mode'),
  routePlanSteps: document.querySelector('#route-plan-steps'),
  copyRoutePlanReport: document.querySelector('#copy-route-plan-report'),
  routeObservationCount: document.querySelector('#route-observation-count'),
  copyCurrentRouteEvent: document.querySelector('#copy-current-route-event'),
  routeObservationList: document.querySelector('#route-observation-list'),
  routeExperimentStatus: document.querySelector('#route-experiment-status'),
  routeExperimentMetrics: document.querySelector('#route-experiment-metrics'),
  routeExperimentMap: document.querySelector('#route-experiment-map'),
  copyRouteExperimentReport: document.querySelector('#copy-route-experiment-report'),
  ranking: document.querySelector('#ranking'),
  status: document.querySelector('#status'),
};

let currentTabId = null;
let currentParticipationId = '';
let currentNodeInspectionJson = '';
let currentMiasmaAnalysisJson = '';
let currentAjaxTrace = null;
let currentAjaxTraceJson = '';
let ajaxTraceRefreshTimer = null;
let routePlanRefreshTimer = null;
const ROUTE_SPECIAL_EVENT_OBSERVATIONS_KEY = 'route-special-event-observations';
const ROUTE_MAP_RADIUS_KEY = 'route-map-radius';
const DEFAULT_ROUTE_MAP_RADIUS = 600;
let currentRouteObservations = [];
let currentEnteredSpecialEvent = null;
let currentRoutePlanReport = '';
let currentRouteExperimentReport = '';
let currentGuidebookEffects = [];
let currentGuidebookEffectValues = [];
let guidebookHighlightTimer = null;
const GUIDEBOOK_HIGHLIGHT_DURATION_MS = 60_000;
const GUIDEBOOK_TOAST_DURATION_MS = 7_000;
const shownGuidebookCaptureBatchIds = [];
let onlineUpdateReleaseUrl = '';

function resetRouteOptimizationView(routeSessionId = '') {
  clearTimeout(routePlanRefreshTimer);
  routePlanRefreshTimer = null;
  currentRoutePlanReport = '';
  currentRouteExperimentReport = '';
  currentMiasmaAnalysisJson = '';
  currentEnteredSpecialEvent = null;
  elements.copyRoutePlanReport.disabled = true;
  elements.copyRouteExperimentReport.disabled = true;
  elements.copyCurrentRouteEvent.disabled = true;
  elements.copyMiasmaAnalysis.disabled = true;
  elements.saveMiasmaAnalysis.disabled = true;
  elements.routeMap.replaceChildren?.();
  elements.routeExperimentMap.replaceChildren?.();
  elements.routePlanSteps.replaceChildren?.();
  elements.routeExperimentMetrics.replaceChildren?.();
  elements.routeStateSummary.replaceChildren?.();
  elements.miasmaAnalysisOutput.textContent = '';
  elements.routePlanMode.textContent = '新規探索';
  elements.routePlanStatus.classList.remove?.('warning');
  elements.routePlanStatus.textContent = '新しい探索のMAP初期状態を待っています…';
  elements.routeExperimentStatus.textContent = '収縮情報待ち';
  elements.miasmaAnalysisStatus.textContent = '新しい探索の収縮情報を待っています';
  elements.routeMap.dataset.routeSessionId = routeSessionId;
}

function renderOnlineUpdateState(state) {
  if (!state)
    return;
  onlineUpdateReleaseUrl = state.releaseUrl || '';
  elements.openOnlineUpdate.hidden = !state.updateAvailable;
  if (state.error) {
    elements.onlineUpdateStatus.textContent =
      `v${state.currentVersion || '-'} / 更新確認失敗`;
    elements.onlineUpdateStatus.title = state.error;
    return;
  }
  const dataText = Array.isArray(state.dataUpdates) && state.dataUpdates.length
    ? ` / ${state.dataUpdates.join('・')}` : '';
  elements.onlineUpdateStatus.textContent = state.updateAvailable
    ? `v${state.latestVersion} を利用できます${dataText}`
    : `v${state.currentVersion} / 最新${dataText}`;
  elements.onlineUpdateStatus.title = state.notes || '';
}

async function loadOnlineUpdateState(checkNow = false) {
  elements.checkOnlineUpdate.disabled = true;
  if (checkNow)
    elements.onlineUpdateStatus.textContent = 'オンライン更新を確認中…';
  try {
    const response = await chrome.runtime.sendMessage({
      type: checkNow ? 'GBF_CHECK_ONLINE_UPDATE' : 'GBF_GET_ONLINE_UPDATE_STATE',
    });
    if (response?.error)
      throw new Error(response.error);
    renderOnlineUpdateState(response?.state);
  }
  catch (error) {
    elements.onlineUpdateStatus.textContent = '更新情報を取得できません';
    elements.onlineUpdateStatus.title = String(error?.message || error);
  }
  finally {
    elements.checkOnlineUpdate.disabled = false;
  }
}

async function openOnlineUpdatePage() {
  if (onlineUpdateReleaseUrl)
    await chrome.tabs.create({ url: onlineUpdateReleaseUrl });
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ja-JP') : '0';
}

function formatContribution(value) {
  const number = Number(value);
  if (!Number.isFinite(number))
    return '0';
  if (Math.abs(number) >= 100000000)
    return `${(number / 100000000).toFixed(1)}億`;
  if (Math.abs(number) >= 10000)
    return `${(number / 10000).toFixed(1)}万`;
  return number.toLocaleString('ja-JP');
}

function createCharacterMetricRow(className, values, formatter = value => value) {
  const row = document.createElement('div');
  row.className = className;
  for (const value of values) {
    const item = document.createElement(className.endsWith('values') ? 'strong' : 'span');
    item.textContent = formatter(value);
    if (className.endsWith('values'))
      item.title = formatNumber(value);
    row.appendChild(item);
  }
  return row;
}

function createCharacterTableRow(character, name) {
  const row = document.createElement('article');
  row.className = 'character-table-row';
  const nameElement = document.createElement('div');
  nameElement.className = `character-name${name ? '' : ' placeholder'}`;
  nameElement.textContent = name || '—';
  if (name)
    nameElement.title = name;
  const labels = createCharacterMetricRow(
    'character-table-labels',
    ['hit', 'アビ', '奥義'],
  );
  const values = createCharacterMetricRow(
    'character-table-values',
    [character?.hit, character?.ability, character?.special],
    formatContribution,
  );
  row.append(nameElement, labels, values);
  return row;
}

function createCharacterTurnColumn(title, className, indexes, currentMap, previousMap) {
  const column = document.createElement('section');
  column.className = `character-turn-column ${className}`;
  const heading = document.createElement('h2');
  heading.textContent = title;
  const list = document.createElement('div');
  list.className = 'character-turn-list';
  for (const index of indexes) {
    const identity = currentMap.get(index) || previousMap.get(index);
    const stats = className === 'current' ? currentMap.get(index) : previousMap.get(index);
    const name = className === 'current'
      ? (identity?.name || `キャラ${index + 1}`)
      : '';
    list.appendChild(createCharacterTableRow(stats, name));
  }
  column.append(heading, list);
  return column;
}

function createCharacterStatsMap(characters) {
  return new Map((characters || []).map((character, position) => {
    const index = Number(character?.index);
    return [Number.isInteger(index) && index >= 0 ? index : position, character];
  }));
}

function getVisibleCharacterIndexes(characters, previousCharacters, formation) {
  const availableIndexes = new Set([
    ...createCharacterStatsMap(characters).keys(),
    ...createCharacterStatsMap(previousCharacters).keys(),
  ]);
  const seen = new Set();
  return (Array.isArray(formation) ? formation : [])
    .map(Number)
    .filter((index) => {
      if (!Number.isInteger(index) || !availableIndexes.has(index) || seen.has(index))
        return false;
      seen.add(index);
      return true;
    });
}

function renderCharacters(characters, previousCharacters, formation) {
  elements.characters.replaceChildren();
  const currentMap = createCharacterStatsMap(characters);
  const previousMap = createCharacterStatsMap(previousCharacters);
  const indexes = getVisibleCharacterIndexes(characters, previousCharacters, formation);
  if (indexes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-message';
    empty.textContent = Array.isArray(formation) && formation.length > 0
      ? 'フロントキャラクター情報なし'
      : 'フロント情報取得中';
    elements.characters.appendChild(empty);
    return;
  }
  const currentColumn = createCharacterTurnColumn(
    '現在ターン', 'current', indexes, currentMap, previousMap,
  );
  const previousColumn = createCharacterTurnColumn(
    '前ターン', 'previous', indexes, currentMap, previousMap,
  );
  elements.characters.append(currentColumn, previousColumn);
}

function normalizeGuidebookText(value) {
  return String(value || '').replace(/@@/g, '\n').trim();
}

function guidebookExportData(effects = currentGuidebookEffects) {
  return {
    schema: 'gbf-guidebook-effects-v1',
    exportedAt: new Date().toISOString(),
    extensionVersion: globalThis.chrome?.runtime?.getManifest?.()?.version || null,
    effects: (effects || [])
      .filter(effect => !effect?.isPlaceholder
        || normalizeGuidebookText(effect?.name)
        || Number(effect?.acquisitionCount) > 0
        || (effect?.sourceTypes || []).length > 0)
      .map(effect => ({
        ...effect,
        name: normalizeGuidebookText(effect.name),
      })),
  };
}

function parseGuidebookImportText(text) {
  if (String(text || '').length > 8 * 1024 * 1024)
    throw new Error('導本JSONが8MBを超えています');
  let payload;
  try {
    payload = JSON.parse(String(text || ''));
  }
  catch {
    throw new Error('導本JSONを解析できません');
  }
  if (payload?.schema !== 'gbf-guidebook-effects-v1' || !Array.isArray(payload?.effects))
    throw new Error('対応していない導本JSONです');
  return payload;
}

function latestGuidebookCandidateBatchId(effects, now = Date.now()) {
  return (effects || [])
    .filter(effect => effect?.lastCandidateBatchId && effect?.lastCandidateSeenAt
      && now - Date.parse(effect.lastCandidateSeenAt) < GUIDEBOOK_HIGHLIGHT_DURATION_MS)
    .sort((a, b) => String(b.lastCandidateBatchId)
      .localeCompare(String(a.lastCandidateBatchId)))[0]
    ?.lastCandidateBatchId || null;
}

function latestGuidebookAcquisitionBatchId(effects, now = Date.now()) {
  return (effects || [])
    .filter(effect => effect?.lastAcquisitionBatchId && effect?.lastAcquiredAt
      && now - Date.parse(effect.lastAcquiredAt) < GUIDEBOOK_HIGHLIGHT_DURATION_MS)
    .sort((a, b) => String(b.lastAcquiredAt).localeCompare(String(a.lastAcquiredAt)))[0]
    ?.lastAcquisitionBatchId || null;
}

function guidebookEffectDisplayState(effect) {
  const hasId = effect?.id !== null && effect?.id !== undefined
    && Number.isInteger(Number(effect.id));
  if (!hasId)
    return 'unknown-id';
  return effect?.isPlaceholder || !normalizeGuidebookText(effect?.name)
    ? 'missing' : 'known';
}

function guidebookRarityClass(effect) {
  if (effect?.isCursed === true
    || String(effect?.bookCategory || '').toLowerCase() === 'cursed'
    || Number(effect?.rarity) === 99
    || Number(effect?.iconCategory) === 4)
    return 'rarity-cursed';
  const storedRarity = Number(effect?.rarity);
  const shopGrade = Number(effect?.shopBookGrade);
  const rarity = Number.isFinite(storedRarity) && storedRarity > 0
    ? storedRarity
    : (Number.isFinite(shopGrade) && shopGrade > 0 ? shopGrade : null);
  if (rarity >= 3)
    return 'rarity-gold';
  if (rarity === 2)
    return 'rarity-white';
  if (rarity === 1)
    return 'rarity-bronze';
  return 'rarity-unknown';
}

function guidebookCaptureToastName(effect) {
  const name = normalizeGuidebookText(effect?.name);
  if (name)
    return name;
  const id = Number(effect?.id);
  return Number.isInteger(id) ? `ID ${id}（効果名取得待ち）` : '効果名取得待ち';
}

function createGuidebookCaptureToast(effect) {
  const toast = document.createElement('section');
  toast.className = 'guidebook-capture-toast';
  const id = document.createElement('span');
  id.className = 'guidebook-capture-toast-id';
  id.textContent = Number.isInteger(Number(effect?.id))
    ? `ID ${Number(effect.id)}`
    : 'ID未取得';
  const name = document.createElement('div');
  name.className = `guidebook-capture-toast-effect ${guidebookRarityClass(effect)}`;
  name.textContent = guidebookCaptureToastName(effect);
  toast.append(id, name);
  setTimeout(() => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 220);
  }, GUIDEBOOK_TOAST_DURATION_MS);
  return toast;
}

function showGuidebookCaptureToast(batchId, effects) {
  if (!batchId || shownGuidebookCaptureBatchIds.includes(batchId)
    || !elements.guidebookToastLayer)
    return false;
  const captured = Array.isArray(effects) ? effects : [];
  if (!captured.length)
    return false;
  shownGuidebookCaptureBatchIds.push(batchId);
  if (shownGuidebookCaptureBatchIds.length > 100)
    shownGuidebookCaptureBatchIds.shift();
  elements.guidebookToastLayer.append(
    ...captured.map(createGuidebookCaptureToast),
  );
  return true;
}

function guidebookShopPriceLabel(effect) {
  if (!(effect?.sourceTypes || []).includes('shop_page')
    || !Number.isFinite(Number(effect?.shopPrice)))
    return null;
  const currentPrice = Number(effect.shopPrice);
  const basePrice = Number(effect.shopBasePrice);
  if ((effect.shopDiscounted === true || effect.shopPremium === true)
    && Number.isFinite(basePrice))
    return `${currentPrice}コイン（通常${basePrice}）`;
  return `${currentPrice}コイン`;
}

function formatGuidebookPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number))
    return '0%';
  return `${Number.isInteger(number) ? number : Number(number.toFixed(2))}%`;
}

const GUIDEBOOK_PERCENT_STAT_ORDER = [
  ['enhance', 'エンハンス'],
  ['attack', '攻撃力'],
  ['elementAttack', '自属性攻撃'],
  ['normalSupplemental', '通常与ダメ'],
  ['multiattack', '連撃率'],
  ['abilityDamage', 'アビダメ'],
  ['abilitySupplemental', 'アビ与ダメ'],
  ['abilityCap', 'アビ上限'],
  ['ougiDamage', '奥義ダメ'],
  ['ougiCap', '奥義上限'],
  ['ougiSpecialCap', '奥義特殊上限'],
  ['ougiSupplemental', '奥義与ダメ'],
  ['ougiGaugeGain', '奥義ゲージ上昇量'],
  ['uplift', '高揚'],
  ['chainDamage', 'CBダメ'],
  ['chainCap', 'CB上限'],
  ['chainSupplemental', 'CB与ダメ'],
  ['damageCap', 'ダメ上限'],
  ['critical', 'クリ確率'],
  ['maxHp', '最大HP'],
  ['defense', '防御力'],
  ['damageReduction', '被ダメ軽減'],
  ['healing', '回復性能'],
  ['coinGain', 'コイン獲得量'],
  ['miasmaReduction', '瘴気ダメ軽減'],
  ['accuracy', '命中率'],
];

const GUIDEBOOK_COUNT_STAT_ORDER = [
  ['flatDamageReduction', '被ダメージ減少', 'flat'],
  ['regeneration', '再生', 'flat'],
  ['staminaBooks', '渾身', 'book'],
  ['enmityBooks', '背水', 'book'],
  ['summonCount', '1ターン中の召喚可能回数', 'times'],
  ['normalHitCount', '通常攻撃のヒット数', 'times'],
];

const GUIDEBOOK_CHASE_KEYS = new Set([
  'elementChase',
  'elementOugiChase',
  'elementAbilityChase',
  'weaknessChase',
  'weaknessOugiChase',
]);

function guidebookStatDisplayValue(value, unit) {
  if (unit === 'percent')
    return formatGuidebookPercent(value);
  const number = Number(value) || 0;
  if (unit === 'book')
    return `+${number}`;
  if (unit === 'times')
    return `+${number}回`;
  return formatNumber(number);
}

function createGuidebookStatRow(stat) {
  const row = document.createElement('div');
  if (Number(stat.value) < 0)
    row.className = 'guidebook-stat-negative';
  const name = document.createElement('span');
  name.className = 'guidebook-stat-name';
  name.textContent = stat.label;
  if (stat.slotKey) {
    const slot = document.createElement('small');
    slot.className = 'guidebook-stat-slot';
    slot.textContent = stat.slotKey;
    name.appendChild(slot);
  }
  const value = document.createElement('strong');
  value.textContent = guidebookStatDisplayValue(stat.value, stat.unit);
  row.append(name, value);
  return row;
}

function createGuidebookCalculatorEmpty(message = '有効な効果なし') {
  const empty = document.createElement('span');
  empty.className = 'guidebook-calculator-empty';
  empty.textContent = message;
  return empty;
}

function renderGuidebookR1Summary(records = currentGuidebookEffectValues) {
  currentGuidebookEffectValues = Array.isArray(records) ? records : [];
  const totals = new Map();
  const labels = new Map();
  for (const record of currentGuidebookEffectValues) {
    for (const stat of record?.stats || []) {
      const aggregationKey = GUIDEBOOK_CHASE_KEYS.has(stat?.key)
        ? `${stat.key}:${stat.slotKey || record.key}` : stat?.key;
      totals.set(aggregationKey, (totals.get(aggregationKey) || 0)
        + (Number(stat.totalValue) || 0));
      labels.set(aggregationKey, {
        key: stat.key,
        label: stat.label,
        unit: stat.unit,
        slotKey: stat.slotKey || null,
      });
    }
  }
  const percentRows = GUIDEBOOK_PERCENT_STAT_ORDER
    .filter(([key]) => (totals.get(key) || 0) !== 0)
    .map(([key, label]) => createGuidebookStatRow({
      key, label, unit: 'percent', value: totals.get(key),
    }));
  const chaseRows = [...labels.entries()]
    .filter(([aggregationKey, stat]) => GUIDEBOOK_CHASE_KEYS.has(stat.key)
      && (totals.get(aggregationKey) || 0) !== 0)
    .sort(([a], [b]) => a.localeCompare(b, 'ja'))
    .map(([aggregationKey, stat]) => createGuidebookStatRow({
      ...stat,
      value: totals.get(aggregationKey) || 0,
    }));
  const activePercentRows = [...percentRows, ...chaseRows];
  elements.guidebookPercentSummary.replaceChildren(
    ...(activePercentRows.length
      ? activePercentRows : [createGuidebookCalculatorEmpty()]),
  );
  const countRows = GUIDEBOOK_COUNT_STAT_ORDER
    .filter(([key]) => (totals.get(key) || 0) !== 0)
    .map(([key, label, unit]) => createGuidebookStatRow({
      key, label, unit, value: totals.get(key),
    }));
  elements.guidebookCountSummary.replaceChildren(
    ...(countRows.length ? countRows : [createGuidebookCalculatorEmpty()]),
  );
  const flags = [...labels.entries()]
    .filter(([, stat]) => stat.unit === 'flag' && (totals.get(stat.key) || 0) > 0)
    .map(([, stat]) => {
      const flag = document.createElement('strong');
      flag.textContent = stat.label;
      return flag;
    });
  if (!flags.length) {
    flags.push(createGuidebookCalculatorEmpty());
  }
  elements.guidebookFlagSummary.replaceChildren(...flags);
  const known = currentGuidebookEffectValues.filter(record => record.ownedCountKnown);
  const unknown = currentGuidebookEffectValues.length - known.length;
  const activeRecordCount = currentGuidebookEffectValues.filter(record => (
    record.ownedCountKnown && Number(record.ownedCount) > 0
    && (record.stats || []).some(stat => Number(stat.totalValue) !== 0)
  )).length;
  elements.guidebookCalculatorStatus.textContent = `有効 ${activeRecordCount}種`
    + (unknown ? ` / 所持数未確認 ${unknown}種` : '');
  return Object.fromEntries(totals);
}

function renderGuidebookEffects(
  effects = currentGuidebookEffects,
  effectValues = currentGuidebookEffectValues,
) {
  renderGuidebookR1Summary(effectValues);
  currentGuidebookEffects = Array.isArray(effects)
    ? [...effects].sort((a, b) => {
      const aHasId = a?.id !== null && a?.id !== undefined
        && Number.isInteger(Number(a.id));
      const bHasId = b?.id !== null && b?.id !== undefined
        && Number.isInteger(Number(b.id));
      if (aHasId !== bHasId)
        return aHasId ? -1 : 1;
      return aHasId
        ? Number(a.id) - Number(b.id)
        : normalizeGuidebookText(a?.name).localeCompare(
          normalizeGuidebookText(b?.name), 'ja',
        );
    })
    : [];
  const filter = String(elements.guidebookFilter.value || '').trim().toLowerCase();
  const stateFilter = String(elements.guidebookStateFilter?.value || 'all');
  const visible = currentGuidebookEffects.filter((effect) => {
    if (stateFilter !== 'all' && guidebookEffectDisplayState(effect) !== stateFilter)
      return false;
    if (!filter)
      return true;
    return [
      effect.id,
      normalizeGuidebookText(effect.name),
    ].some(value => String(value || '').toLowerCase().includes(filter));
  });
  elements.guidebookCount.textContent = filter || stateFilter !== 'all'
    ? `${visible.length} / 全${currentGuidebookEffects.length}件`
    : `${currentGuidebookEffects.length}件`;
  elements.copyGuidebookEffects.disabled = currentGuidebookEffects.length === 0;
  elements.exportGuidebookEffects.disabled = guidebookExportData(
    currentGuidebookEffects,
  ).effects.length === 0;
  const latestCandidateBatchId = latestGuidebookCandidateBatchId(currentGuidebookEffects);
  const latestCandidateCount = currentGuidebookEffects.filter(
    effect => effect.lastCandidateBatchId === latestCandidateBatchId,
  ).length;
  const latestAcquisitionBatchId = latestGuidebookAcquisitionBatchId(
    currentGuidebookEffects,
  );
  const latestAcquisitionCount = currentGuidebookEffects.filter(
    effect => effect.lastAcquisitionBatchId === latestAcquisitionBatchId,
  ).length;
  if (guidebookHighlightTimer !== null) {
    clearTimeout(guidebookHighlightTimer);
    guidebookHighlightTimer = null;
  }
  const highlightExpirations = [
    ...(latestCandidateBatchId ? currentGuidebookEffects
      .filter(effect => effect.lastCandidateBatchId === latestCandidateBatchId)
      .map(effect => Date.parse(effect.lastCandidateSeenAt)
        + GUIDEBOOK_HIGHLIGHT_DURATION_MS) : []),
    ...(latestAcquisitionBatchId ? currentGuidebookEffects
      .filter(effect => effect.lastAcquisitionBatchId === latestAcquisitionBatchId)
      .map(effect => Date.parse(effect.lastAcquiredAt)
        + GUIDEBOOK_HIGHLIGHT_DURATION_MS) : []),
  ].filter(Number.isFinite);
  if (highlightExpirations.length) {
    guidebookHighlightTimer = setTimeout(
      () => renderGuidebookEffects(),
      Math.max(25, Math.min(...highlightExpirations) - Date.now() + 25),
    );
  }
  const rows = visible.map((effect) => {
    const row = document.createElement('article');
    row.className = `guidebook-effect ${guidebookRarityClass(effect)}`;
    const isLatestCandidate = latestCandidateBatchId
      && effect.lastCandidateBatchId === latestCandidateBatchId;
    if (isLatestCandidate)
      row.classList.add('latest-candidate');
    const isLatestAcquisition = latestAcquisitionBatchId
      && effect.lastAcquisitionBatchId === latestAcquisitionBatchId;
    if (isLatestAcquisition)
      row.classList.add('latest-acquisition');
    if (guidebookEffectDisplayState(effect) === 'missing')
      row.classList.add('missing-effect');
    const heading = document.createElement('div');
    heading.className = 'guidebook-effect-heading';
    const id = document.createElement('span');
    id.className = 'guidebook-effect-id';
    id.textContent = effect.id !== null && effect.id !== undefined
      ? `ID ${effect.id}`
      : 'ID未取得';
    const name = document.createElement('div');
    name.className = 'guidebook-effect-name';
    name.textContent = normalizeGuidebookText(effect.name) || '名称未取得';
    const meta = document.createElement('span');
    meta.className = 'guidebook-effect-meta';
    meta.textContent = [
      effect.rarity !== null && effect.rarity !== undefined
        && Number.isFinite(Number(effect.rarity)) ? `R${effect.rarity}` : null,
      typeof effect.isDuplicationPossible === 'boolean'
        ? (effect.isDuplicationPossible ? '重複可' : '重複不可') : null,
      (effect.sourceTypes || []).includes('battle_reward') ? '戦闘報酬' : null,
      (effect.sourceTypes || []).includes('event_reward') ? 'イベント獲得' : null,
      (effect.sourceTypes || []).includes('shop_page') ? 'ショップ' : null,
      guidebookShopPriceLabel(effect),
      effect.shopDiscounted === true ? '割引' : null,
      effect.shopPremium === true ? '割増' : null,
      effect.shopSoldOut === true ? '売切' : null,
      (effect.sourceTypes || []).includes('effect_confirmation') ? '効果確認' : null,
      effect.isCursed ? '呪われた導本' : null,
      isLatestCandidate ? '直近の選択肢' : null,
      isLatestAcquisition ? '直近の獲得' : null,
      guidebookEffectDisplayState(effect) === 'missing' ? '未獲得' : null,
    ].filter(Boolean).join(' / ');
    heading.append(id, name, meta);
    const observed = document.createElement('small');
    observed.className = 'guidebook-effect-observed';
    observed.textContent = guidebookEffectDisplayState(effect) === 'missing'
      ? '効果情報未取得'
      : (effect.lastSeenAt
      ? `観測 ${Math.max(1, Number(effect.observationCount) || 1)}回 / 最終 ${new Date(effect.lastSeenAt).toLocaleString('ja-JP')}`
      : '観測時刻不明');
    observed.title = effect.firstSeenAt
      ? `初回観測 ${new Date(effect.firstSeenAt).toLocaleString('ja-JP')}`
      : '';
    row.append(heading, observed);
    return row;
  });
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-message';
    empty.textContent = currentGuidebookEffects.length
      ? '検索条件に一致する導本効果はありません'
      : '導本効果の候補画面を表示すると自動的に追加されます';
    rows.push(empty);
  }
  elements.guidebookList.replaceChildren(...rows);
  if (latestAcquisitionCount > 0) {
    elements.guidebookStatus.classList.add?.('updated');
    elements.guidebookStatus.textContent = `直近の獲得 ${latestAcquisitionCount}件をハイライト`;
  }
  else if (latestCandidateCount > 0) {
    elements.guidebookStatus.classList.add?.('updated');
    elements.guidebookStatus.textContent = `直近の選択肢 ${latestCandidateCount}件をハイライト`;
  }
  else {
    elements.guidebookStatus.classList.toggle?.(
      'updated', currentGuidebookEffects.length > 0,
    );
    elements.guidebookStatus.textContent = currentGuidebookEffects.length
      ? `Ajaxで観測済み / ${currentGuidebookEffects.length}件`
      : '候補の表示待ち';
  }
  return { latestCandidateCount, latestAcquisitionCount };
}

async function loadGuidebookEffects() {
  elements.refreshGuidebookEffects.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GBF_GET_GUIDEBOOK_EFFECTS' });
    if (response?.error)
      throw new Error(response.error);
    const { latestCandidateCount, latestAcquisitionCount } = renderGuidebookEffects(
      response?.effects || [],
      response?.effectValues || [],
    );
    elements.guidebookStatus.classList.toggle?.('updated', currentGuidebookEffects.length > 0);
    if (latestCandidateCount === 0 && latestAcquisitionCount === 0) {
      elements.guidebookStatus.textContent = currentGuidebookEffects.length
        ? `Ajaxで観測済み / ${currentGuidebookEffects.length}件`
        : '候補の表示待ち';
    }
  }
  finally {
    elements.refreshGuidebookEffects.disabled = false;
  }
}

async function captureGuidebookEffects() {
  const tabId = await ensureCurrentTabId();
  elements.captureGuidebookEffects.disabled = true;
  elements.guidebookStatus.textContent = '現在画面の導本情報を探索中…';
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GBF_CAPTURE_GUIDEBOOK_EFFECTS',
      tabId,
    });
    if (response?.error)
      throw new Error(response.error);
    renderGuidebookEffects(response?.effects || [], response?.effectValues || []);
    const eventCount = Math.max(0, Number(response?.eventCandidateCount) || 0);
    const viewEffectCount = Math.max(0, Number(response?.viewEffectCount) || 0);
    const rewardCount = Math.max(0, Number(response?.rewardCount) || 0);
    const capturedCount = eventCount + viewEffectCount + rewardCount;
    elements.guidebookStatus.classList.toggle?.('updated', capturedCount > 0);
    elements.guidebookStatus.textContent = capturedCount > 0
      ? `現在画面から取得: 選択肢 ${eventCount}件 / ショップ・効果確認 ${viewEffectCount}件 / 戦闘報酬 ${rewardCount}件`
      : '現在のGame.viewに残っている導本情報は見つかりませんでした';
  }
  catch (error) {
    elements.guidebookStatus.classList.remove?.('updated');
    elements.guidebookStatus.textContent = `手動取得失敗: ${String(error?.message || error)}`;
    throw error;
  }
  finally {
    elements.captureGuidebookEffects.disabled = false;
  }
}

async function requestGuidebookStorageDiagnostics(tabId) {
  const response = await chrome.runtime.sendMessage({
    type: 'GBF_INSPECT_GUIDEBOOK_STORAGE',
    tabId,
  });
  if (response?.error)
    throw new Error(response.error);
  if (!response?.diagnostics)
    throw new Error('調査結果がありません');
  return response.diagnostics;
}

async function inspectGuidebookStorage() {
  const tabId = await ensureCurrentTabId();
  elements.inspectGuidebookStorage.disabled = true;
  elements.guidebookStatus.textContent = '導本データの格納場所を調査中…';
  try {
    const diagnostics = await requestGuidebookStorageDiagnostics(tabId);
    const json = JSON.stringify(diagnostics, null, 2);
    downloadTextFile(
      json,
      `gbf-guidebook-storage-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
      'application/json',
    );
    const matchCount = Math.max(0, Number(diagnostics.matchCount) || 0);
    elements.guidebookStatus.classList.add?.('updated');
    elements.guidebookStatus.textContent = `格納場所の調査JSONを保存しました / 候補パス ${matchCount}件`;
  }
  catch (error) {
    elements.guidebookStatus.classList.remove?.('updated');
    elements.guidebookStatus.textContent = `格納場所の調査失敗: ${String(error?.message || error)}`;
    throw error;
  }
  finally {
    elements.inspectGuidebookStorage.disabled = false;
  }
}

async function copyGuidebookCaptureFailureReport() {
  const tabId = await ensureCurrentTabId();
  elements.copyGuidebookDiagnostics.disabled = true;
  elements.guidebookDiagnosticsStatus.classList.remove?.('updated', 'error');
  elements.guidebookDiagnosticsStatus.textContent = '表示中の画面を調査中…（最大45秒）';
  try {
    const diagnostics = await requestGuidebookStorageDiagnostics(tabId);
    const [guidebookResponse, traceResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'GBF_GET_GUIDEBOOK_EFFECTS' }),
      chrome.runtime.sendMessage({ type: 'GBF_GET_AJAX_TRACE', tabId }),
    ]);
    const report = {
      schema: 'gbf-guidebook-capture-failure-v1',
      purpose: '画面に表示された導本効果を辞書へ取得できなかった状態の調査',
      capturedAt: new Date().toISOString(),
      extensionVersion: globalThis.chrome?.runtime?.getManifest?.()?.version || null,
      tabId,
      knownGuidebookEffects: guidebookExportData(
        guidebookResponse?.effects || currentGuidebookEffects,
      ).effects,
      ajaxTrace: traceResponse?.trace || null,
      diagnostics,
    };
    const json = JSON.stringify(report, null, 2);
    await navigator.clipboard.writeText(json);
    const matchCount = Math.max(0, Number(diagnostics.matchCount) || 0);
    elements.guidebookDiagnosticsStatus.classList.add?.('updated');
    elements.guidebookDiagnosticsStatus.textContent = `コピー完了 / 候補パス ${matchCount}件 / ${json.length.toLocaleString('ja-JP')}文字`;
  }
  catch (error) {
    elements.guidebookDiagnosticsStatus.classList.add?.('error');
    elements.guidebookDiagnosticsStatus.textContent = `コピー失敗: ${String(error?.message || error)}`;
    throw error;
  }
  finally {
    elements.copyGuidebookDiagnostics.disabled = false;
  }
}

async function copyGuidebookEffects() {
  await navigator.clipboard.writeText(JSON.stringify(guidebookExportData(), null, 2));
  elements.guidebookStatus.textContent = `導本効果${currentGuidebookEffects.length}件をコピーしました`;
}

function exportGuidebookEffects() {
  const payload = guidebookExportData();
  downloadTextFile(
    JSON.stringify(payload, null, 2),
    `gbf-guidebook-effects-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    'application/json',
  );
  elements.guidebookStatus.textContent = `導本効果${payload.effects.length}件をJSON保存しました`;
}

async function importGuidebookEffectsFile(file) {
  if (!file)
    return;
  elements.importGuidebookEffects.disabled = true;
  elements.guidebookStatus.textContent = '導本JSONを読み込み中…';
  try {
    if (Number(file.size) > 8 * 1024 * 1024)
      throw new Error('導本JSONが8MBを超えています');
    const payload = parseGuidebookImportText(await file.text());
    const response = await chrome.runtime.sendMessage({
      type: 'GBF_IMPORT_GUIDEBOOK_EFFECTS',
      payload,
    });
    if (response?.error)
      throw new Error(response.error);
    renderGuidebookEffects(response?.effects || [], response?.effectValues || []);
    elements.guidebookStatus.classList.add?.('updated');
    elements.guidebookStatus.textContent = `インポート完了: 追加 ${response.added || 0}件 / 統合 ${response.merged || 0}件 / 除外 ${response.skipped || 0}件`;
  }
  catch (error) {
    elements.guidebookStatus.classList.remove?.('updated');
    elements.guidebookStatus.textContent = `インポート失敗: ${String(error?.message || error)}`;
    throw error;
  }
  finally {
    elements.importGuidebookEffects.disabled = false;
    elements.importGuidebookFile.value = '';
  }
}

function renderRanking(members) {
  elements.ranking.replaceChildren();
  const ranked = (members || [])
    .filter(member => Number(member.rank) > 0)
    .sort((a, b) => Number(a.rank) - Number(b.rank))
    .slice(0, 6);
  for (let index = 0; index < 6; index += 1) {
    const member = ranked[index];
    const entry = document.createElement('div');
    entry.className = 'rank-entry';
    if (!member) {
      entry.classList.add('empty');
      const badge = document.createElement('div');
      badge.className = 'rank-badge empty';
      badge.textContent = '–';
      const emptyText = document.createElement('div');
      emptyText.className = 'rank-empty-text';
      emptyText.textContent = '参戦者情報なし';
      entry.append(badge, emptyText);
    }
    else {
      const badge = document.createElement('div');
      badge.className = `rank-badge rank-${member.rank}`;
      const rankNumber = document.createElement('strong');
      rankNumber.textContent = String(member.rank);
      const rankUnit = document.createElement('span');
      rankUnit.textContent = '位';
      badge.append(rankNumber, rankUnit);
      const nameLine = document.createElement('div');
      nameLine.className = 'rank-name';
      nameLine.textContent = member.nickname || member.userId || '不明';
      nameLine.title = nameLine.textContent;
      const detail = document.createElement('div');
      detail.className = 'rank-detail';
      const pointLine = document.createElement('div');
      pointLine.className = 'rank-point';
      const pointLabel = document.createElement('span');
      pointLabel.textContent = '貢献度';
      const pointValue = document.createElement('strong');
      pointValue.textContent = formatContribution(member.point);
      pointLine.title = formatNumber(member.point);
      pointLine.append(pointLabel, pointValue);
      detail.append(nameLine, pointLine);
      entry.append(badge, detail);
    }
    elements.ranking.appendChild(entry);
  }
}

function setTurnElements(prefix, stats) {
  elements[`${prefix}Hit`].textContent = formatNumber(stats?.hit);
  elements[`${prefix}Ability`].textContent = formatNumber(stats?.ability);
  elements[`${prefix}Special`].textContent = formatNumber(stats?.special);
  elements[`${prefix}Total`].textContent = formatNumber(stats?.total);
}

function render(state) {
  elements.totalDamage.textContent = formatNumber(state?.totalDamage);
  elements.participantCount.textContent = `${state?.participantCount || 0}/${state?.participantLimit || 0}`;
  currentParticipationId = String(state?.participationId || '');
  elements.participationId.textContent = currentParticipationId || '---';
  elements.copyId.disabled = !currentParticipationId;
  elements.statsTurn.textContent = state?.statsTurn ? `TURN ${state.statsTurn}` : '';
  setTurnElements('current', state?.currentTurn || state?.lastTurn || {});
  setTurnElements('previous', state?.previousTurn || {});
  const frontFormation = state?.frontFormation || [];
  renderCharacters(state?.characterStats, state?.previousCharacterStats, frontFormation);
  renderRanking(state?.members);
  elements.status.textContent = state?.active
    ? `戦闘情報を更新中${state.battleId ? ` / raid ${state.battleId}` : ''}`
    : '戦闘開始を待っています';
}

async function loadActiveTabState() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined)
    return;
  currentTabId = tab.id;
  const response = await chrome.runtime.sendMessage({ type: 'GBF_GET_BATTLE_STATE', tabId: currentTabId });
  render(response?.state);
}

async function copyParticipationId() {
  if (!currentParticipationId)
    return;
  await navigator.clipboard.writeText(currentParticipationId);
  elements.copyId.textContent = 'コピー済み';
  elements.copyId.classList.add('copy-success');
  setTimeout(() => {
    elements.copyId.textContent = 'コピー';
    elements.copyId.classList.remove('copy-success');
  }, 1200);
}

async function captureGameViewNodes() {
  if (currentTabId === null)
    await loadActiveTabState();
  if (currentTabId === null)
    throw new Error('対象のGBFタブを取得できません');
  elements.captureGameNodes.disabled = true;
  elements.nodeInspectorStatus.textContent = '取得中…';
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'GBF_INSPECT_GAME_VIEW_NODES',
      tabId: currentTabId,
    });
    if (response?.error)
      throw new Error(response.error);
    if (!response?.inspection)
      throw new Error('取得結果がありません');
    currentNodeInspectionJson = JSON.stringify(response.inspection, null, 2);
    elements.nodeInspectorOutput.textContent = currentNodeInspectionJson;
    elements.copyGameNodes.disabled = false;
    elements.saveGameNodes.disabled = false;
    elements.nodeInspectorStatus.textContent = `取得完了: ${response.inspection.capturedAt || ''}`;
  }
  catch (error) {
    currentNodeInspectionJson = '';
    elements.nodeInspectorOutput.textContent = '';
    elements.copyGameNodes.disabled = true;
    elements.saveGameNodes.disabled = true;
    elements.nodeInspectorStatus.textContent = `取得失敗: ${String(error?.message || error)}`;
    throw error;
  }
  finally {
    elements.captureGameNodes.disabled = false;
  }
}

async function copyGameViewNodes() {
  if (!currentNodeInspectionJson)
    return;
  await navigator.clipboard.writeText(currentNodeInspectionJson);
  elements.nodeInspectorStatus.textContent = 'JSONをコピーしました';
}

function saveGameViewNodes() {
  if (!currentNodeInspectionJson)
    return;
  const blob = new Blob([currentNodeInspectionJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `gbf-game-view-nodes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  elements.nodeInspectorStatus.textContent = 'JSONファイルを保存しました';
}

async function captureMiasmaAnalysis() {
  const tabId = await ensureCurrentTabId();
  elements.captureMiasmaAnalysis.disabled = true;
  elements.miasmaAnalysisStatus.textContent = '取得中…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GBF_GET_MIASMA_ANALYSIS', tabId });
    if (response?.error)
      throw new Error(response.error);
    if (!response?.analysis)
      throw new Error('取得結果がありません');
    currentMiasmaAnalysisJson = JSON.stringify(response.analysis, null, 2);
    elements.miasmaAnalysisOutput.textContent = currentMiasmaAnalysisJson;
    elements.copyMiasmaAnalysis.disabled = false;
    elements.saveMiasmaAnalysis.disabled = false;
    const bounds = response.analysis.latestDerived?.radiusBounds || response.analysis.radiusBounds || {};
    const complete = response.analysis.latestDerived?.firstShrinkComplete
      ?? response.analysis.phase?.firstShrinkComplete;
    const boundText = Number.isFinite(bounds.safeNodeMaximumDistance)
      && Number.isFinite(bounds.shrinkingNodeMinimumDistance)
      ? ` / 半径 ${bounds.safeNodeMaximumDistance.toFixed(2)}～${bounds.shrinkingNodeMinimumDistance.toFixed(2)}`
      : '';
    elements.miasmaAnalysisStatus.textContent = `${complete ? '第一次収縮完了データ' : '途中データ'}を取得${boundText}`;
  }
  catch (error) {
    currentMiasmaAnalysisJson = '';
    elements.miasmaAnalysisOutput.textContent = '';
    elements.copyMiasmaAnalysis.disabled = true;
    elements.saveMiasmaAnalysis.disabled = true;
    elements.miasmaAnalysisStatus.textContent = `取得失敗: ${String(error?.message || error)}`;
    throw error;
  }
  finally {
    elements.captureMiasmaAnalysis.disabled = false;
  }
}

async function copyMiasmaAnalysis() {
  if (!currentMiasmaAnalysisJson)
    return;
  await navigator.clipboard.writeText(currentMiasmaAnalysisJson);
  elements.miasmaAnalysisStatus.textContent = '解析JSONをコピーしました';
}

function saveMiasmaAnalysis() {
  if (!currentMiasmaAnalysisJson)
    return;
  downloadTextFile(currentMiasmaAnalysisJson,
    `gbf-first-shrink-radius-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    'application/json');
  elements.miasmaAnalysisStatus.textContent = '解析JSONを保存しました';
}

async function ensureCurrentTabId() {
  if (currentTabId === null)
    await loadActiveTabState();
  if (currentTabId === null)
    throw new Error('対象のGBFタブを取得できません');
  return currentTabId;
}

function createAjaxTraceExport(trace) {
  return {
    exportedAt: new Date().toISOString(),
    source: 'GBF Ajax trace',
    tabId: currentTabId,
    ...trace,
  };
}

function renderAjaxTrace(trace) {
  currentAjaxTrace = trace || { enabled: false, entries: [] };
  const entries = Array.isArray(currentAjaxTrace.entries) ? currentAjaxTrace.entries : [];
  currentAjaxTraceJson = entries.length > 0
    ? JSON.stringify(createAjaxTraceExport(currentAjaxTrace), null, 2)
    : '';
  elements.startAjaxTrace.disabled = Boolean(currentAjaxTrace.enabled);
  elements.stopAjaxTrace.disabled = !currentAjaxTrace.enabled;
  elements.copyAjaxTrace.disabled = entries.length === 0;
  elements.saveAjaxTrace.disabled = entries.length === 0;
  elements.ajaxTraceStatus.classList.toggle?.('recording', Boolean(currentAjaxTrace.enabled));
  elements.ajaxTraceStatus.textContent = `${currentAjaxTrace.enabled ? '記録中' : '停止中'} / ${entries.length}件`
    + (currentAjaxTrace.updatedAt ? ` / ${currentAjaxTrace.updatedAt}` : '')
    + (currentAjaxTrace.archiveError ? ` / 永続化失敗: ${currentAjaxTrace.archiveError}` : '');

  const categoryLabels = {
    currentNode: '現在地',
    previousNode: '移動元',
    elapsedTurn: 'ターン',
    currency: '通貨',
    visitedNode: '訪問済み',
    shrinkingNode: '収縮対象',
    miasma: '収縮・瘴気',
  };
  const candidateNodes = [];
  for (let index = entries.length - 1; index >= 0 && candidateNodes.length < 30; index -= 1) {
    const entry = entries[index];
    for (const candidate of entry.candidates || []) {
      if (candidateNodes.length >= 30)
        break;
      const row = document.createElement('div');
      row.className = 'ajax-trace-candidate';
      const label = document.createElement('span');
      label.textContent = categoryLabels[candidate.category] || candidate.category;
      const value = document.createElement('code');
      const renderedValue = typeof candidate.value === 'string'
        ? candidate.value
        : JSON.stringify(candidate.value);
      value.textContent = `${renderedValue}  ${candidate.path}`;
      value.title = `${entry.url}\n${candidate.path}`;
      row.append(label, value);
      candidateNodes.push(row);
    }
    if (candidateNodes.length > 0)
      break;
  }
  if (candidateNodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ajax-trace-empty';
    empty.textContent = entries.length > 0 ? '状態候補を含むレスポンスはまだありません' : 'Ajax履歴はありません';
    candidateNodes.push(empty);
  }
  elements.ajaxTraceCandidates.replaceChildren(...candidateNodes);

  const historyNodes = entries.slice().reverse().map((entry) => {
    const details = document.createElement('details');
    details.className = `ajax-trace-entry${entry.candidates?.length ? ' has-candidates' : ''}`;
    const summary = document.createElement('summary');
    const time = entry.capturedAt ? new Date(entry.capturedAt).toLocaleTimeString('ja-JP') : '--:--:--';
    summary.textContent = `${time}  候補${entry.candidates?.length || 0}件  ${entry.truncated ? '[一部省略] ' : ''}${entry.url || '(URLなし)'}`;
    summary.title = entry.url || '';
    const output = document.createElement('pre');
    output.textContent = JSON.stringify(entry, null, 2);
    details.append(summary, output);
    return details;
  });
  if (historyNodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ajax-trace-empty';
    empty.textContent = '「記録開始」後にゲーム内で操作してください';
    historyNodes.push(empty);
  }
  elements.ajaxTraceHistory.replaceChildren(...historyNodes);
}

async function loadAjaxTrace() {
  const tabId = await ensureCurrentTabId();
  const response = await chrome.runtime.sendMessage({ type: 'GBF_GET_AJAX_TRACE', tabId });
  if (response?.error)
    throw new Error(response.error);
  renderAjaxTrace(response?.trace);
}

async function controlAjaxTrace(action) {
  const tabId = await ensureCurrentTabId();
  const response = await chrome.runtime.sendMessage({
    type: 'GBF_CONTROL_AJAX_TRACE',
    tabId,
    action,
  });
  if (response?.error)
    throw new Error(response.error);
  renderAjaxTrace(response?.trace);
  loadAjaxArchives().catch(() => {});
}

async function copyAjaxTrace() {
  if (!currentAjaxTraceJson)
    return;
  await navigator.clipboard.writeText(currentAjaxTraceJson);
  elements.ajaxTraceStatus.textContent = 'Ajax履歴JSONをコピーしました';
}

function saveAjaxTrace() {
  if (!currentAjaxTraceJson)
    return;
  const blob = new Blob([currentAjaxTraceJson], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `gbf-ajax-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  elements.ajaxTraceStatus.textContent = 'Ajax履歴JSONを保存しました';
}

function scheduleAjaxTraceRefresh() {
  clearTimeout(ajaxTraceRefreshTimer);
  ajaxTraceRefreshTimer = setTimeout(() => loadAjaxTrace().catch(() => {}), 250);
}

function formatFileSize(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024)
    return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function downloadTextFile(text, name, type = 'application/x-ndjson') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function renderAjaxArchives(files) {
  const list = Array.isArray(files) ? files : [];
  elements.ajaxArchiveStatus.textContent = `${list.length}ファイル / 件数上限なし / 約5MBごとに分割`;
  const rows = list.map((file) => {
    const row = document.createElement('div');
    row.className = 'ajax-archive-row';
    const detail = document.createElement('div');
    detail.className = 'ajax-archive-detail';
    const name = document.createElement('div');
    name.className = 'ajax-archive-name';
    name.textContent = file.name;
    name.title = file.name;
    const meta = document.createElement('div');
    meta.className = 'ajax-archive-meta';
    meta.textContent = `${formatFileSize(file.size)} / ${new Date(file.lastModified).toLocaleString('ja-JP')}`;
    detail.append(name, meta);
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = '保存';
    save.addEventListener('click', () => downloadAjaxArchive(file.name, save).catch((error) => {
      elements.ajaxArchiveStatus.textContent = `保存失敗: ${String(error?.message || error)}`;
    }));
    row.append(detail, save);
    return row;
  });
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ajax-trace-empty';
    empty.textContent = '永続ログはまだありません';
    rows.push(empty);
  }
  elements.ajaxArchiveList.replaceChildren(...rows);
}

async function loadAjaxArchives() {
  const response = await chrome.runtime.sendMessage({ type: 'GBF_LIST_AJAX_ARCHIVES' });
  if (response?.error)
    throw new Error(response.error);
  renderAjaxArchives(response?.files);
}

async function downloadAjaxArchive(name, button) {
  button.disabled = true;
  try {
    elements.ajaxArchiveStatus.textContent = `${name} を読出し中…`;
    const response = await chrome.runtime.sendMessage({ type: 'GBF_READ_AJAX_ARCHIVE', name });
    if (response?.error)
      throw new Error(response.error);
    if (!response?.file?.text)
      throw new Error('永続ログの内容がありません');
    downloadTextFile(response.file.text, response.file.name);
    elements.ajaxArchiveStatus.textContent = `${response.file.name} を保存しました`;
  }
  finally {
    button.disabled = false;
  }
}

async function clearAjaxArchives() {
  if (!globalThis.confirm('保存済みのAjax永続ログをすべて削除します。元に戻せません。'))
    return;
  const response = await chrome.runtime.sendMessage({ type: 'GBF_CLEAR_AJAX_ARCHIVES' });
  if (response?.error)
    throw new Error(response.error);
  elements.ajaxArchiveStatus.textContent = `${response.removed || 0}ファイルを削除しました`;
  await loadAjaxArchives();
}

function createRouteStateChip(label, value) {
  const chip = document.createElement('div');
  chip.className = 'route-state-chip';
  const caption = document.createElement('span');
  caption.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  chip.append(caption, strong);
  return chip;
}

function specialEventObservationKey(record) {
  return [record.x ?? 'x', record.y ?? 'y'].join('|');
}

function specialEventAppearance(routeState, node) {
  return {
    mapId: routeState.mapId ?? null,
    basePatternId: routeState.miasma?.basePatternId ?? null,
    patternId: routeState.miasma?.patternId ?? null,
    phase: node.appearancePhase
      || (routeState.dayOneBossDefeated
        ? 'post-day1-boss'
        : 'initial-map'),
    nodeId: node.nodeId ?? node.id ?? null,
    firstSeenAt: routeState.capturedAt || new Date().toISOString(),
    lastSeenAt: routeState.capturedAt || new Date().toISOString(),
  };
}

function mergeSpecialEventAppearances(...groups) {
  const merged = new Map();
  for (const item of groups.flat().filter(Boolean)) {
    const key = [
      item.mapId ?? 'unknown',
      item.basePatternId ?? 'unknown',
      item.patternId ?? 'unknown',
      item.phase ?? 'unknown',
    ].join('|');
    const old = merged.get(key);
    merged.set(key, {
      ...old,
      ...item,
      firstSeenAt: old?.firstSeenAt || item.firstSeenAt,
      nodeIds: [...new Set([
        ...(old?.nodeIds || []),
        ...(item.nodeIds || []),
        item.nodeId,
      ].filter(value => value !== null && value !== undefined))],
    });
  }
  return [...merged.values()];
}

function routeSpecialEventRecord(node, routeState, allNodes = []) {
  const visual = globalThis.GbfRoutePlanner.nodeVisual(node);
  const eventId = node.specialIncidentId ?? node.specialType ?? null;
  return {
    key: specialEventObservationKey({ x: node.x, y: node.y }),
    firstSeenAt: routeState.capturedAt || new Date().toISOString(),
    lastSeenAt: routeState.capturedAt || new Date().toISOString(),
    mapId: routeState.mapId ?? null,
    nodeId: node.id,
    x: node.x ?? null,
    y: node.y ?? null,
    specialType: node.specialType ?? null,
    eventId,
    label: visual.label,
    visited: Boolean(node.isVisited),
    endpoint: null,
    signals: null,
    isDisconnectedSpecial: Boolean(
      globalThis.GbfRoutePlanner?.isFloatingCastleBodyNode?.(node, allNodes),
    ),
    appearances: [specialEventAppearance(routeState, node)],
  };
}

function isRegisteredSpecialEventRecord(record) {
  if (!record || !globalThis.GbfRoutePlanner?.confirmedFixedSpecialEvent)
    return false;
  const x = Number(record.x);
  const y = Number(record.y);
  const eventId = record.eventId ?? record.specialIncidentId ?? record.specialType ?? null;
  return Boolean(globalThis.GbfRoutePlanner.confirmedFixedSpecialEvent({
    type: 10,
    x: Number.isFinite(x) ? x : null,
    y: Number.isFinite(y) ? y : null,
    specialIncidentId: eventId,
    specialType: eventId,
  }, record.mapId ?? null));
}

function isRegisteredSpecialEventNode(node, routeState = {}) {
  if (Number(node?.type) !== 10)
    return false;
  return isRegisteredSpecialEventRecord({
    x: node.x ?? null,
    y: node.y ?? null,
    eventId: node.specialIncidentId ?? node.specialType ?? null,
    specialIncidentId: node.specialIncidentId ?? null,
    specialType: node.specialType ?? null,
    mapId: routeState.mapId ?? null,
  });
}

function isFloatingCastleSpecialEventRecord(record) {
  const specialType = Number(
    record?.specialType ?? record?.specialIncidentId ?? record?.eventId,
  );
  const knownFloatingCastleBody = specialType === 4
    && Number(record?.x) === 346
    && Number(record?.y) === 292;
  const disconnectedFloatingCastleBody = Boolean(record?.isDisconnectedSpecial);
  const randomCombatSpecial = [1, 2, 3].includes(specialType);
  return knownFloatingCastleBody || disconnectedFloatingCastleBody
    || randomCombatSpecial || [5, 6, 7, 8].includes(specialType);
}

function renderRouteObservations(records, currentEvent = null) {
  const unregisteredRecords = records.filter(record => (
    !isRegisteredSpecialEventRecord(record)
    && !isFloatingCastleSpecialEventRecord(record)
  ));
  const unregisteredCurrentEvent = isRegisteredSpecialEventRecord(currentEvent)
    || isFloatingCastleSpecialEventRecord(currentEvent)
    ? null
    : currentEvent;
  currentRouteObservations = unregisteredRecords;
  currentEnteredSpecialEvent = unregisteredCurrentEvent;
  elements.routeObservationCount.textContent = unregisteredCurrentEvent
    ? `現在 event ${unregisteredCurrentEvent.eventId ?? '－'} / 未登録 ${unregisteredRecords.length}件`
    : `${unregisteredRecords.length}件 / 未登録イベント進入待ち`;
  elements.copyCurrentRouteEvent.disabled = !unregisteredCurrentEvent;
  const rows = unregisteredRecords.slice()
    .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)))
    .slice(0, 100).map((record) => {
      const row = document.createElement('div');
      row.className = 'route-observation-row';
      const title = document.createElement('strong');
      title.textContent = `${record.label || '特殊イベント'} / event ${record.eventId ?? '—'}`;
      const detail = document.createElement('small');
      const appearanceMaps = [...new Set((record.appearances || []).map(item => item.mapId)
        .filter(value => value !== null && value !== undefined))];
      detail.textContent = `XY ${record.x ?? '—'}, ${record.y ?? '—'} / 出現map ${appearanceMaps.join(', ') || '—'}`
        + (record.visited ? ' / 訪問済み' : ' / 未訪問');
      row.append(title, detail);
      return row;
    });
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'ajax-trace-empty';
    empty.textContent = '未登録の特殊イベント座標はありません';
    rows.push(empty);
  }
  elements.routeObservationList.replaceChildren(...rows);
}

async function collectRouteSpecialEventObservations(routeState) {
  const stored = await chrome.storage.local.get(ROUTE_SPECIAL_EVENT_OBSERVATIONS_KEY);
  const existing = Array.isArray(stored[ROUTE_SPECIAL_EVENT_OBSERVATIONS_KEY])
    ? stored[ROUTE_SPECIAL_EVENT_OBSERVATIONS_KEY]
    : [];
  const normalizedState = globalThis.GbfRoutePlanner.normalizeState(routeState || {});
  const isDisconnectedRecordedSpecial = record => {
    const matchingNode = normalizedState.nodes.find(node => (
      Number(node.type) === 10
      && Number(node.x) === Number(record?.x)
      && Number(node.y) === Number(record?.y)
    ));
    return Boolean(matchingNode && globalThis.GbfRoutePlanner.isFloatingCastleBodyNode(
      matchingNode, normalizedState.nodes,
    ));
  };
  const merged = new Map();
  for (const storedRecord of existing) {
    if (isFloatingCastleSpecialEventRecord({
      ...storedRecord,
      isDisconnectedSpecial: isDisconnectedRecordedSpecial(storedRecord),
    }))
      continue;
    const key = specialEventObservationKey(storedRecord);
    const old = merged.get(key);
    const legacyAppearance = storedRecord.appearances?.length ? [] : [{
      mapId: storedRecord.mapId ?? null,
      basePatternId: null,
      patternId: null,
      phase: 'unknown',
      nodeId: storedRecord.nodeId ?? null,
      firstSeenAt: storedRecord.firstSeenAt,
      lastSeenAt: storedRecord.lastSeenAt,
    }];
    merged.set(key, {
      ...old,
      ...storedRecord,
      key,
      firstSeenAt: old?.firstSeenAt || storedRecord.firstSeenAt,
      visited: Boolean(old?.visited || storedRecord.visited),
      appearances: mergeSpecialEventAppearances(
        old?.appearances || [],
        storedRecord.appearances || [],
        legacyAppearance,
      ),
    });
  }
  const observationState = { ...routeState, ...normalizedState };
  for (const node of normalizedState.nodes) {
    const nodeRecord = routeSpecialEventRecord(node, observationState, normalizedState.nodes);
    if (Number(node.type) !== 10 || isFloatingCastleSpecialEventRecord(nodeRecord))
      continue;
    const record = nodeRecord;
    const old = merged.get(record.key);
    merged.set(record.key, {
      ...old,
      ...record,
      firstSeenAt: old?.firstSeenAt || record.firstSeenAt,
      visited: Boolean(old?.visited || record.visited),
      endpoint: old?.endpoint || record.endpoint,
      signals: old?.signals || record.signals,
      appearances: mergeSpecialEventAppearances(old?.appearances || [], record.appearances || []),
    });
  }
  const currentNode = normalizedState.nodes.find(node => node.id === normalizedState.currentNodeId);
  const observedCandidate = routeState?.specialEventObservation
    || (currentNode?.type === 10
      ? routeSpecialEventRecord(currentNode, observationState, normalizedState.nodes)
      : null);
  const observed = isFloatingCastleSpecialEventRecord({
    ...observedCandidate,
    isDisconnectedSpecial: isDisconnectedRecordedSpecial(observedCandidate),
  })
    ? null
    : observedCandidate;
  if (observed) {
    const key = specialEventObservationKey(observed);
    const old = merged.get(key) || {};
    merged.set(key, {
      ...old,
      ...observed,
      key,
      firstSeenAt: old.firstSeenAt || observed.capturedAt,
      lastSeenAt: observed.capturedAt || new Date().toISOString(),
      visited: true,
      label: old.label || '特殊イベント',
      appearances: mergeSpecialEventAppearances(
        old.appearances || [],
        observed.appearances || [],
        specialEventAppearance(observationState, observed),
      ),
    });
  }
  const records = [...merged.values()];
  await chrome.storage.local.set({ [ROUTE_SPECIAL_EVENT_OBSERVATIONS_KEY]: records });
  renderRouteObservations(records, observed || null);
}

function formatCurrentSpecialEvent(record) {
  if (!record)
    return '';
  const visual = globalThis.GbfRoutePlanner.nodeVisual({
    type: 10,
    specialType: record.specialType ?? record.eventId,
    specialIncidentId: record.eventId,
  });
  return `${visual.label} / event ${record.eventId ?? '－'}\n`
    + `map ${record.mapId ?? '－'} / XY ${record.x ?? '－'}, ${record.y ?? '－'} / node ${record.nodeId ?? '－'} / 進入直後`;
}

async function copyCurrentRouteEvent() {
  const text = formatCurrentSpecialEvent(currentEnteredSpecialEvent);
  if (!text)
    return;
  await navigator.clipboard.writeText(text);
  elements.routeObservationCount.textContent = `event ${currentEnteredSpecialEvent.eventId ?? '－'} / コピー済み`;
}

function routeNodePositions(plan, localNodes) {
  const positioned = localNodes.filter(node => node.x !== null && node.y !== null);
  if (positioned.length === localNodes.length && localNodes.length > 0) {
    const current = positioned.find(node => node.id === plan.state.currentNodeId) || positioned[0];
    const centroid = {
      x: positioned.reduce((sum, node) => sum + node.x, 0) / positioned.length,
      y: positioned.reduce((sum, node) => sum + node.y, 0) / positioned.length,
    };
    const fitScale = origin => Math.min(
      250 / Math.max(1, ...positioned.map(node => Math.abs(node.x - origin.x))),
      150 / Math.max(1, ...positioned.map(node => Math.abs(node.y - origin.y))),
    );
    const currentScale = fitScale(current);
    const centroidScale = fitScale(centroid);
    // 現在地中央で利用可能面積が25%以上失われる場合だけ、重心中央を優先する。
    const origin = currentScale >= centroidScale * 0.75 ? current : centroid;
    const scale = origin === current ? currentScale : centroidScale;
    return new Map(positioned.map(node => [node.id, {
      x: 300 + (node.x - origin.x) * scale,
      y: 200 + (node.y - origin.y) * scale,
    }]));
  }
  const groups = new Map();
  for (const node of localNodes) {
    const hop = (plan.localHops || plan.localDistances).get(node.id) || 0;
    if (!groups.has(hop))
      groups.set(hop, []);
    groups.get(hop).push(node);
  }
  const positions = new Map();
  for (const [hop, nodes] of groups) {
    nodes.forEach((node, index) => {
      const angle = nodes.length === 1 ? 0 : (Math.PI * 2 * index / nodes.length) - Math.PI / 2;
      const radius = hop * 42;
      positions.set(node.id, { x: 300 + Math.cos(angle) * radius, y: 200 + Math.sin(angle) * radius });
    });
  }
  return positions;
}

function routeEdgeContinuationSegment(plan, positions, fromId, toId, previousId = null) {
  const nodeGraph = plan.displayGraph || plan.graph;
  const from = positions.get(fromId);
  if (!from)
    return null;
  const fromNode = nodeGraph.byId.get(fromId);
  const toNode = nodeGraph.byId.get(toId);
  const hasDirectionCoords = fromNode?.x !== null && fromNode?.y !== null
    && toNode?.x !== null && toNode?.y !== null;
  let dx = hasDirectionCoords ? Number(toNode.x) - Number(fromNode.x) : NaN;
  let dy = hasDirectionCoords ? Number(toNode.y) - Number(fromNode.y) : NaN;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    const previous = positions.get(previousId);
    dx = previous ? from.x - previous.x : from.x - 300;
    dy = previous ? from.y - previous.y : from.y - 200;
  }
  if (dx === 0 && dy === 0)
    dx = 1;
  const candidates = [];
  if (dx > 0) candidates.push((590 - from.x) / dx);
  if (dx < 0) candidates.push((10 - from.x) / dx);
  if (dy > 0) candidates.push((390 - from.y) / dy);
  if (dy < 0) candidates.push((10 - from.y) / dy);
  const boundaryScale = Math.min(...candidates.filter(value => Number.isFinite(value) && value > 0));
  const directionLength = Math.hypot(dx, dy);
  const shortScale = directionLength > 0 ? 60 / directionLength : Infinity;
  const scale = Math.min(boundaryScale, shortScale);
  if (!Number.isFinite(scale))
    return null;
  return { fromId, toId, x1: from.x, y1: from.y, x2: from.x + dx * scale, y2: from.y + dy * scale };
}

function routeOffRadiusContinuationSegments(plan, localIds, positions) {
  const displayGraph = plan.displayGraph || plan.graph;
  const segments = [];
  for (const fromId of localIds) {
    for (const toId of displayGraph.adjacency.get(fromId) || []) {
      if (localIds.has(toId))
        continue;
      const segment = routeEdgeContinuationSegment(plan, positions, fromId, toId);
      if (segment)
        segments.push(segment);
    }
  }
  return segments;
}

function routeContinuationSegment(plan, localIds, positions, visiblePath) {
  let boundary = null;
  for (let index = 1; index < visiblePath.length; index += 1) {
    const fromId = visiblePath[index - 1];
    const toId = visiblePath[index];
    if (!localIds.has(fromId) || localIds.has(toId))
      continue;
    const fromNode = (plan.displayGraph || plan.graph).byId.get(fromId);
    const toNode = (plan.displayGraph || plan.graph).byId.get(toId);
    if (fromNode?.type === 9 && toNode?.type === 9)
      return null;
    boundary = { fromId, toId, pathIndex: index };
    break;
  }
  if (!boundary) {
    const displayAdjacency = (plan.displayGraph || plan.graph).adjacency || new Map();
    for (let index = visiblePath.length - 1; index >= 0; index -= 1) {
      const fromId = visiblePath[index];
      if (!localIds.has(fromId))
        continue;
      const outsideNeighbors = [...(displayAdjacency.get(fromId) || [])]
        .filter(id => !localIds.has(id));
      if (!outsideNeighbors.length)
        break;
      const previousNode = plan.graph.byId.get(visiblePath[index - 1]);
      const fromNode = plan.graph.byId.get(fromId);
      const incomingX = Number(fromNode?.x) - Number(previousNode?.x);
      const incomingY = Number(fromNode?.y) - Number(previousNode?.y);
      outsideNeighbors.sort((a, b) => {
        const nodeA = plan.graph.byId.get(a);
        const nodeB = plan.graph.byId.get(b);
        const score = node => (Number(node?.x) - Number(fromNode?.x)) * incomingX
          + (Number(node?.y) - Number(fromNode?.y)) * incomingY;
        return score(nodeB) - score(nodeA);
      });
      boundary = { fromId, toId: outsideNeighbors[0], pathIndex: index + 1 };
      break;
    }
  }
  if (boundary) {
    const { fromId, toId, pathIndex } = boundary;
    return routeEdgeContinuationSegment(
      plan, positions, fromId, toId, visiblePath[pathIndex - 2],
    );
  }
  return null;
}

function renderRouteMap(plan) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 600 400');
  const localIds = new Set(plan.localDistances.keys());
  const localNodes = plan.state.nodes.filter(node => localIds.has(node.id));
  const positions = routeNodePositions(plan, localNodes);
  const routeEdges = new Set();
  const visiblePath = plan.displayPath || plan.path;
  for (let index = 1; index < visiblePath.length; index += 1) {
    routeEdges.add(`${visiblePath[index - 1]}:${visiblePath[index]}`);
    routeEdges.add(`${visiblePath[index]}:${visiblePath[index - 1]}`);
  }
  const renderedEdges = new Set();
  for (const node of localNodes) {
    for (const adjacentId of (plan.displayGraph || plan.graph).adjacency.get(node.id) || []) {
      if (!localIds.has(adjacentId))
        continue;
      const key = [node.id, adjacentId].sort((a, b) => a - b).join(':');
      if (renderedEdges.has(key))
        continue;
      renderedEdges.add(key);
      const from = positions.get(node.id);
      const to = positions.get(adjacentId);
      if (!from || !to)
        continue;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', from.x);
      line.setAttribute('y1', from.y);
      line.setAttribute('x2', to.x);
      line.setAttribute('y2', to.y);
      line.setAttribute('class', `route-edge${routeEdges.has(`${node.id}:${adjacentId}`) ? ' recommended' : ''}`);
      svg.appendChild(line);
    }
  }
  for (const segment of routeOffRadiusContinuationSegments(plan, localIds, positions)) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', segment.x1);
    line.setAttribute('y1', segment.y1);
    line.setAttribute('x2', segment.x2);
    line.setAttribute('y2', segment.y2);
    line.setAttribute('class', 'route-edge continuation');
    line.setAttribute('data-next-node-id', segment.toId);
    svg.appendChild(line);
  }
  const continuation = routeContinuationSegment(plan, localIds, positions, visiblePath);
  if (continuation) {
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', continuation.x1);
    line.setAttribute('y1', continuation.y1);
    line.setAttribute('x2', continuation.x2);
    line.setAttribute('y2', continuation.y2);
    line.setAttribute('class', 'route-edge recommended continuation');
    line.setAttribute('data-next-node-id', continuation.toId);
    svg.appendChild(line);
  }
  const routeIds = new Set(visiblePath);
  let currentPinOverlay = null;
  const recordedEventBadges = [];
  for (const node of localNodes) {
    const point = positions.get(node.id);
    if (!point)
      continue;
    const isCurrent = node.id === plan.state.currentNodeId;
    const visual = globalThis.GbfRoutePlanner.nodeVisual(node);
    const displayVisual = isCurrent
      ? globalThis.GbfRoutePlanner.nodeVisual({ type: 0 })
      : visual;
    const group = document.createElementNS(ns, 'g');
    const classes = ['route-node', `route-kind-${displayVisual.key}`];
    if ([3, 4, 11].includes(node.type)) classes.push('danger');
    if (node.isVisited) classes.push('visited');
    if (node.isShrinking) classes.push('miasma');
    if (plan.bossIds.includes(node.id) || node.type === 1) classes.push('boss');
    if (routeIds.has(node.id) && node.id !== plan.state.currentNodeId) classes.push('recommended');
    if (node.id === plan.state.currentNodeId) classes.push('current');
    group.setAttribute('class', classes.join(' '));
    const shape = document.createElementNS(ns, 'circle');
    shape.setAttribute('class', 'route-node-shape');
    shape.setAttribute('cx', point.x);
    shape.setAttribute('cy', point.y);
    shape.setAttribute('r', 16);
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', point.x);
    label.setAttribute('y', point.y);
    label.textContent = displayVisual.icon;
    let miasmaOverlay = null;
    if (node.isShrinking) {
      miasmaOverlay = document.createElementNS(ns, 'circle');
      miasmaOverlay.setAttribute('class', 'route-node-miasma-overlay');
      miasmaOverlay.setAttribute('cx', point.x);
      miasmaOverlay.setAttribute('cy', point.y);
      miasmaOverlay.setAttribute('r', 15.5);
    }
    let currentPin = null;
    let currentPinCenter = null;
    if (isCurrent) {
      const pinCenterY = point.y - 17;
      const pinTipY = point.y;
      currentPin = document.createElementNS(ns, 'path');
      currentPin.setAttribute('class', 'route-current-pin');
      currentPin.setAttribute('d', [
        `M ${point.x} ${pinTipY}`,
        `C ${point.x - 3} ${pinTipY - 5}, ${point.x - 14} ${pinCenterY + 8}, ${point.x - 14} ${pinCenterY}`,
        `A 14 14 0 1 1 ${point.x + 14} ${pinCenterY}`,
        `C ${point.x + 14} ${pinCenterY + 8}, ${point.x + 3} ${pinTipY - 5}, ${point.x} ${pinTipY}`,
        'Z',
      ].join(' '));
      currentPinCenter = document.createElementNS(ns, 'circle');
      currentPinCenter.setAttribute('class', 'route-current-pin-center');
      currentPinCenter.setAttribute('cx', point.x);
      currentPinCenter.setAttribute('cy', pinCenterY);
      currentPinCenter.setAttribute('r', 5);
      currentPinOverlay = document.createElementNS(ns, 'g');
      currentPinOverlay.setAttribute('class', 'route-current-pin-overlay');
      currentPinOverlay.append(currentPin, currentPinCenter);
    }
    const title = document.createElementNS(ns, 'title');
    const deadline = plan.deadlines.get(node.id);
    const eventId = node.specialIncidentId ?? node.specialType;
    const isRecordedSpecialEvent = isRegisteredSpecialEventNode(node, plan.state);
    title.textContent = `${visual.label} / node ${node.id} / XY ${node.x ?? '—'}, ${node.y ?? '—'}`
      + (eventId !== null && eventId !== undefined ? ` / event ${eventId}` : '')
      + (Number.isFinite(deadline) ? ` / 安全期限T${deadline}` : '')
      + (node.isShrinking ? ' / 瘴気内' : '')
      + (isRecordedSpecialEvent ? ' / 記録済み' : '');
    group.append(shape, label);
    if (miasmaOverlay)
      group.append(miasmaOverlay);
    group.append(title);
    svg.appendChild(group);
    if (isRecordedSpecialEvent) {
      const badge = document.createElementNS(ns, 'g');
      badge.setAttribute('class', 'route-node-recorded-badge');
      const badgeShape = document.createElementNS(ns, 'circle');
      badgeShape.setAttribute('cx', point.x + 12);
      badgeShape.setAttribute('cy', point.y - 12);
      badgeShape.setAttribute('r', 7);
      const badgeText = document.createElementNS(ns, 'text');
      badgeText.setAttribute('x', point.x + 12);
      badgeText.setAttribute('y', point.y - 12);
      badgeText.textContent = '済';
      const badgeTitle = document.createElementNS(ns, 'title');
      badgeTitle.textContent = '特殊イベント記録済み';
      badge.append(badgeShape, badgeText, badgeTitle);
      recordedEventBadges.push(badge);
    }
  }
  for (const badge of recordedEventBadges)
    svg.appendChild(badge);
  if (currentPinOverlay)
    svg.appendChild(currentPinOverlay);
  elements.routeMap.replaceChildren(svg);
}

function createRouteExperimentMetric(label, value) {
  const metric = document.createElement('div');
  metric.className = 'route-experiment-metric';
  const caption = document.createElement('span');
  caption.textContent = label;
  const strong = document.createElement('strong');
  strong.textContent = value;
  metric.append(caption, strong);
  return metric;
}

function routeExperimentSimulationState(plan) {
  if (plan?.secondShrinkSimulation) {
    const simulation = plan.secondShrinkSimulation || null;
    const totalTurn = Number(plan?.state?.totalTurn) || 0;
    const miasmaIds = new Set(simulation?.alreadyMiasmaNodeIds || []);
    for (const [rawId, deadline] of Object.entries(simulation?.nodeDeadlines || {})) {
      if (deadline !== null && Number(deadline) <= totalTurn)
        miasmaIds.add(Number(rawId));
    }
    return {
      kind: 'second',
      simulation,
      miasmaIds,
      center: simulation?.currentCenter || simulation?.center || null,
      currentRadius: simulation?.currentRadius ?? null,
      finalCenter: simulation?.finalCenter || null,
      finalRadius: simulation?.finalRadius ?? 0,
    };
  }
  const simulation = plan?.firstShrinkSimulation || null;
  return {
    kind: 'first',
    simulation,
    miasmaIds: new Set(simulation?.simulatedMiasmaIds || []),
    center: simulation?.currentCenter || null,
    currentRadius: simulation?.currentRadius ?? null,
    finalCenter: simulation?.finalCenter || null,
    finalRadius: simulation?.finalRadius ?? null,
  };
}

function createRouteExperimentReport(plan) {
  const nodes = plan?.state?.nodes?.filter(node => node.x !== null && node.y !== null) || [];
  if (!nodes.length)
    return '';
  const experiment = routeExperimentSimulationState(plan);
  const simulation = experiment.simulation;
  const simulatedMiasmaIds = experiment.miasmaIds;
  const isSecond = experiment.kind === 'second';
  const gameStateShrinkingNodeIds = nodes.filter(node => node.isShrinking).map(node => node.id);
  const gameStateShrinkingIdSet = new Set(gameStateShrinkingNodeIds);
  const payload = {
    schema: isSecond
      ? 'gbf-second-shrink-simulation-report-v1'
      : 'gbf-first-shrink-simulation-report-v1',
    generatedAt: new Date().toISOString(),
    extensionVersion: globalThis.chrome?.runtime?.getManifest?.()?.version || null,
    state: {
      mapId: plan.state.mapId,
      currentNodeId: plan.state.currentNodeId,
      totalTurn: plan.state.totalTurn,
      capturedAt: plan.state.capturedAt || null,
      miasma: { ...plan.state.miasma },
    },
    simulation: simulation ? (isSecond ? {
      source: simulation.source || null,
      startCircleSource: simulation.startCircleSource || null,
      firstShrinkCircleCapturedAt: simulation.firstShrinkCircleCapturedAt || null,
      firstShrinkCircleModelKey: simulation.firstShrinkCircleModelKey || null,
      anchorBossId: simulation.anchorBossId,
      startCenter: simulation.startCenter || null,
      currentCenter: simulation.currentCenter || simulation.center || null,
      finalCenter: simulation.finalCenter || null,
      center: simulation.currentCenter || simulation.center || null,
      remainTurn: simulation.remainTurn,
      progress: simulation.progress,
      progressSource: simulation.progressSource || null,
      durationTurns: simulation.durationTurns ?? null,
      remainingScale: simulation.remainingScale,
      startRadius: simulation.startRadius,
      currentRadius: simulation.currentRadius,
      finalRadius: simulation.finalRadius,
      bossRadiusPosition: simulation.bossRadiusPosition,
      inferredCircle: simulation.inferredCircle || null,
      nodeDeadlines: simulation.nodeDeadlines || {},
      predictedShrinkOrder: simulation.predictedShrinkOrder || [],
      alreadyMiasmaNodeIds: simulation.alreadyMiasmaNodeIds || [],
      simulatedMiasmaIds: [...simulatedMiasmaIds],
    } : {
      source: simulation.source || null,
      sourceLog: simulation.sourceLog || null,
      modelKey: simulation.modelKey || null,
      step: simulation.step,
      progress: simulation.progress,
      startCenter: simulation.startCenter || null,
      currentCenter: simulation.currentCenter,
      finalCenter: simulation.finalCenter,
      startRadius: simulation.startRadius,
      currentRadius: simulation.currentRadius,
      finalRadius: simulation.finalRadius,
      simulatedMiasmaCount: simulation.simulatedMiasmaCount,
      simulatedSafeCount: simulation.simulatedSafeCount,
      simulatedMiasmaIds: [...simulatedMiasmaIds],
    }) : null,
    comparison: {
      note: 'gameStateは取得データ上のisShrinkingであり、画面を見た実測結果ではありません。',
      gameStateShrinkingNodeIds,
      gameStateOnlyShrinkingNodeIds: gameStateShrinkingNodeIds
        .filter(id => !simulatedMiasmaIds.has(id)),
      simulationOnlyMiasmaNodeIds: [...simulatedMiasmaIds]
        .filter(id => !gameStateShrinkingIdSet.has(id)),
    },
    nodes: nodes.map(node => ({
      id: node.id,
      x: node.x,
      y: node.y,
      type: node.type ?? null,
      specialType: node.specialType ?? null,
      adjacentIds: node.adjacentIds || [],
      isVisited: Boolean(node.isVisited),
      gameStateIsShrinking: Boolean(node.isShrinking),
      simulationIsMiasma: simulatedMiasmaIds.has(node.id),
      simulationDeadline: isSecond
        ? (simulation?.nodeDeadlines?.[node.id] ?? null)
        : null,
    })),
  };
  return [
    `${isSecond ? '第二次' : '第一次'}収縮シミュレーション Codex報告`,
    '',
    '視認情報（コピー後、ゲーム画面を見て追記してください）:',
    '- 実際の円内（安全）: node ',
    '- 実際の円外（瘴気）: node ',
    '- 境界がずれている箇所: ',
    '- 補足（例: 実際はnode nとnode mが円内に入るように収縮している）: ',
    '',
    '自動取得情報:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

async function copyRouteExperimentReport() {
  if (!currentRouteExperimentReport)
    throw new Error('コピーできる収縮シミュレーション情報がありません');
  await navigator.clipboard.writeText(currentRouteExperimentReport);
  elements.copyRouteExperimentReport.textContent = 'コピー済み';
  setTimeout(() => {
    elements.copyRouteExperimentReport.textContent = 'Codex報告をコピー';
  }, 1500);
}

function createRoutePlanReport(plan) {
  if (!plan?.state?.nodes?.length)
    return '';
  const effectiveAdjacency = plan.graph?.adjacency || new Map();
  const displayAdjacency = plan.displayGraph?.adjacency || new Map();
  const pathCounts = new Map();
  for (const id of plan.path || [])
    pathCounts.set(id, (pathCounts.get(id) || 0) + 1);
  const turnbacks = [];
  for (let index = 2; index < (plan.path || []).length; index += 1) {
    if (plan.path[index] === plan.path[index - 2]) {
      turnbacks.push({
        fromNodeId: plan.path[index - 2],
        viaNodeId: plan.path[index - 1],
        returnNodeId: plan.path[index],
        routeStep: index,
      });
    }
  }
  const routeSteps = (plan.routeTimeline || []).map((step) => {
    const node = plan.graph.byId.get(step.nodeId) || plan.displayGraph?.byId.get(step.nodeId);
    const visual = globalThis.GbfRoutePlanner.nodeVisual(node);
    return {
      ...step,
      type: node?.type ?? null,
      label: visual.label,
      specialType: node?.specialType ?? null,
      specialIncidentId: node?.specialIncidentId ?? null,
      x: node?.x ?? null,
      y: node?.y ?? null,
      isVisited: Boolean(node?.isVisited),
      isShrinking: Boolean(node?.isShrinking),
    };
  });
  const { nodes, ...stateWithoutNodes } = plan.state;
  const payload = {
    schema: 'gbf-route-plan-report-v1',
    generatedAt: new Date().toISOString(),
    extensionVersion: globalThis.chrome?.runtime?.getManifest?.()?.version || null,
    state: stateWithoutNodes,
    planner: {
      mode: plan.mode,
      phase: plan.phase,
      warning: plan.warning || null,
      fallbackReason: plan.fallbackReason || null,
      localRadius: plan.localRadius,
      estimatedRouteTurns: plan.estimatedRouteTurns,
      firstShrinkSafeArrivalBufferTurns: plan.firstShrinkSafeArrivalBufferTurns,
      secondShrinkBossArrivalBufferTurns: plan.secondShrinkBossArrivalBufferTurns,
      bossArrivalRemainingTurns: plan.bossArrivalRemainingTurns,
      secondShrinkSimulation: plan.secondShrinkSimulation || null,
      miasmaTraversalAllowed: plan.miasmaTraversalAllowed,
      miasmaHealthBudgetPercent: plan.miasmaHealthBudgetPercent,
      miasmaDamagePercent: plan.miasmaDamagePercent,
      miasmaExposureCount: plan.miasmaExposureCount,
      bossIds: plan.bossIds,
    },
    recommendation: {
      path: plan.path,
      displayPath: plan.displayPath,
      routeSteps,
      missedDeadlineSteps: routeSteps.filter(step => !step.completesBeforeDeadline),
      repeatedNodeIds: [...pathCounts.entries()]
        .filter(([, count]) => count > 1)
        .map(([nodeId, count]) => ({ nodeId, count })),
      immediateTurnbacks: turnbacks,
    },
    nodes: nodes.map((node) => {
      const visual = globalThis.GbfRoutePlanner.nodeVisual(node);
      const deadline = plan.deadlines.get(node.id) ?? Infinity;
      return {
        id: node.id,
        type: node.type,
        label: visual.label,
        specialType: node.specialType ?? null,
        specialIncidentId: node.specialIncidentId ?? null,
        x: node.x,
        y: node.y,
        isVisited: Boolean(node.isVisited),
        isPassedDanger: Boolean(node.isPassedDanger),
        isShrinking: Boolean(node.isShrinking),
        deadline: Number.isFinite(deadline) ? deadline : null,
        physicalAdjacentIds: [...(displayAdjacency.get(node.id) || node.adjacentIds || [])],
        effectiveAdjacentIds: [...(effectiveAdjacency.get(node.id) || [])],
      };
    }),
  };
  return [
    '最適ルート Codex報告',
    '',
    '視認・操作情報（コピー後に追記してください）:',
    '- 問題がある手順番号: ',
    '- 実際に期待する経路: ',
    '- 画面上で確認した収縮・ボス状態: ',
    '- その他の補足: ',
    '',
    '自動取得情報:',
    JSON.stringify(payload, null, 2),
  ].join('\n');
}

async function copyRoutePlanReport() {
  if (!currentRoutePlanReport)
    throw new Error('コピーできる推奨ルート情報がありません');
  await navigator.clipboard.writeText(currentRoutePlanReport);
  elements.copyRoutePlanReport.textContent = 'コピー済み';
  setTimeout(() => {
    elements.copyRoutePlanReport.textContent = 'Codex報告をコピー';
  }, 1500);
}

function renderRouteExperiment(plan) {
  const ns = 'http://www.w3.org/2000/svg';
  const nodes = plan.state.nodes.filter(node => node.x !== null && node.y !== null);
  currentRouteExperimentReport = createRouteExperimentReport(plan);
  elements.copyRouteExperimentReport.disabled = !currentRouteExperimentReport;
  if (!nodes.length) {
    elements.routeExperimentStatus.textContent = '全体MAP用のノード座標を取得できません';
    elements.routeExperimentMetrics.replaceChildren();
    elements.routeExperimentMap.replaceChildren();
    return;
  }
  const width = 600;
  const height = 400;
  const padding = 24;
  const xs = nodes.map(node => node.x);
  const ys = nodes.map(node => node.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const scale = Math.min(
    (width - padding * 2) / Math.max(1, maxX - minX),
    (height - padding * 2) / Math.max(1, maxY - minY),
  );
  const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
  const offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale;
  const point = (x, y) => ({ x: x * scale + offsetX, y: y * scale + offsetY });
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const experiment = routeExperimentSimulationState(plan);
  const simulation = experiment.simulation;
  const isSecond = experiment.kind === 'second';
  svg.setAttribute('aria-label', `全${nodes.length}ノードの${isSecond ? '第二次' : '第一次'}収縮座標シミュレーション`);
  const simulatedMiasmaIds = experiment.miasmaIds;
  if (simulation && experiment.center && Number.isFinite(Number(experiment.currentRadius))) {
    const currentCenter = point(experiment.center.x, experiment.center.y);
    const currentRadius = Math.max(0, experiment.currentRadius * scale);
    const miasmaArea = document.createElementNS(ns, 'path');
    miasmaArea.setAttribute('class', 'route-experiment-simulated-area');
    miasmaArea.setAttribute('fill-rule', 'evenodd');
    miasmaArea.setAttribute('d', `M 0 0 H ${width} V ${height} H 0 Z `
      + `M ${currentCenter.x - currentRadius} ${currentCenter.y} `
      + `A ${currentRadius} ${currentRadius} 0 1 0 ${currentCenter.x + currentRadius} ${currentCenter.y} `
      + `A ${currentRadius} ${currentRadius} 0 1 0 ${currentCenter.x - currentRadius} ${currentCenter.y} Z`);
    svg.appendChild(miasmaArea);
    if (isSecond && simulation.startCenter
      && Number.isFinite(Number(simulation.startRadius))) {
      const startCenter = point(simulation.startCenter.x, simulation.startCenter.y);
      const startArea = document.createElementNS(ns, 'circle');
      startArea.setAttribute('class', 'route-experiment-start-area');
      startArea.setAttribute('cx', startCenter.x);
      startArea.setAttribute('cy', startCenter.y);
      startArea.setAttribute('r', Math.max(0, simulation.startRadius * scale));
      svg.appendChild(startArea);
      const anchorGuide = document.createElementNS(ns, 'line');
      const anchorPoint = point(experiment.finalCenter.x, experiment.finalCenter.y);
      anchorGuide.setAttribute('class', 'route-experiment-anchor-guide');
      anchorGuide.setAttribute('x1', startCenter.x);
      anchorGuide.setAttribute('y1', startCenter.y);
      anchorGuide.setAttribute('x2', anchorPoint.x);
      anchorGuide.setAttribute('y2', anchorPoint.y);
      svg.appendChild(anchorGuide);
    }
    const currentArea = document.createElementNS(ns, 'circle');
    currentArea.setAttribute('class', 'route-experiment-current-area');
    currentArea.setAttribute('cx', currentCenter.x);
    currentArea.setAttribute('cy', currentCenter.y);
    currentArea.setAttribute('r', currentRadius);
    svg.appendChild(currentArea);
    const finalCenter = point(experiment.finalCenter.x, experiment.finalCenter.y);
    const finalArea = document.createElementNS(ns, 'circle');
    finalArea.setAttribute('class', 'route-experiment-final-area');
    finalArea.setAttribute('cx', finalCenter.x);
    finalArea.setAttribute('cy', finalCenter.y);
    finalArea.setAttribute('r', isSecond
      ? 8
      : Math.max(0, experiment.finalRadius * scale));
    svg.appendChild(finalArea);
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  for (const node of nodes) {
    const from = point(node.x, node.y);
    for (const adjacentId of node.adjacentIds || []) {
      if (adjacentId <= node.id || !byId.has(adjacentId))
        continue;
      const adjacent = byId.get(adjacentId);
      const to = point(adjacent.x, adjacent.y);
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('class', 'route-experiment-edge');
      line.setAttribute('x1', from.x);
      line.setAttribute('y1', from.y);
      line.setAttribute('x2', to.x);
      line.setAttribute('y2', to.y);
      svg.appendChild(line);
    }
  }
  for (const node of nodes) {
    const position = point(node.x, node.y);
    const circle = document.createElementNS(ns, 'circle');
    const classes = ['route-experiment-node'];
    const isBoss = node.id === simulation?.anchorBossId
      || (node.type === 1 && !node.isVisited);
    if (simulatedMiasmaIds.has(node.id)) classes.push('simulated-miasma');
    if (node.id === plan.state.currentNodeId) classes.push('current');
    if (isBoss) {
      classes.push('boss');
      const halo = document.createElementNS(ns, 'circle');
      halo.setAttribute('class', 'route-experiment-boss-halo');
      halo.setAttribute('cx', position.x);
      halo.setAttribute('cy', position.y);
      halo.setAttribute('r', 11);
      svg.appendChild(halo);
    }
    circle.setAttribute('class', classes.join(' '));
    circle.setAttribute('cx', position.x);
    circle.setAttribute('cy', position.y);
    circle.setAttribute('r', isBoss ? 7 : (node.id === plan.state.currentNodeId ? 6 : 3.5));
    const title = document.createElementNS(ns, 'title');
    title.textContent = `node ${node.id} / XY ${node.x}, ${node.y}`
      + (isBoss ? ' / ボス（収縮アンカー）' : '')
      + ` / シミュレート:${simulatedMiasmaIds.has(node.id) ? '瘴気' : '安全'}`
      + (isSecond && simulation?.nodeDeadlines?.[node.id] !== undefined
        ? ` / 安全期限:${simulation.nodeDeadlines[node.id] ?? '最終安全点'}` : '');
    circle.appendChild(title);
    svg.appendChild(circle);
    if (isBoss) {
      const bossLabel = document.createElementNS(ns, 'text');
      bossLabel.setAttribute('class', 'route-experiment-boss-label');
      bossLabel.setAttribute('x', position.x);
      bossLabel.setAttribute('y', position.y - 13);
      bossLabel.textContent = '🐉';
      svg.appendChild(bossLabel);
    }
  }
  elements.routeExperimentMap.replaceChildren(svg);
  if (!simulation) {
    elements.routeExperimentStatus.classList.add('warning');
    elements.routeExperimentStatus.textContent = isSecond
      ? `全${nodes.length}ノード表示 / 第2収縮のボスアンカーまたは初期円を取得できません`
      : `全${nodes.length}ノード表示 / このmap・patternの実測モデルは未登録です`;
    elements.routeExperimentMetrics.replaceChildren(
      createRouteExperimentMetric('map', String(plan.state.mapId ?? '—')),
      createRouteExperimentMetric('pattern', `${plan.state.miasma.basePatternId ?? '—'}:${plan.state.miasma.patternId ?? '—'}`),
    );
    return;
  }
  elements.routeExperimentStatus.classList.remove('warning');
  if (isSecond) {
    elements.routeExperimentStatus.textContent = `第2収縮・ボスアンカー相似縮小 / ${(simulation.progress * 100).toFixed(0)}% / 残${simulation.remainTurn}T / 全${nodes.length}ノード`;
    elements.routeExperimentMetrics.replaceChildren(
      createRouteExperimentMetric('現在安全 半径 / 円中心',
        `${Number(simulation.currentRadius).toFixed(1)} / ${simulation.currentCenter
          ? `${simulation.currentCenter.x.toFixed(1)}, ${simulation.currentCenter.y.toFixed(1)}`
          : '座標なし（接続距離）'}`),
      createRouteExperimentMetric('固定アンカー / 円内位置',
        `boss node ${simulation.anchorBossId} / ${Number.isFinite(simulation.bossRadiusPosition)
          ? `${(simulation.bossRadiusPosition * 100).toFixed(1)}%` : '接続距離'}`),
      createRouteExperimentMetric('現在瘴気 / 安全ノード',
        `${simulatedMiasmaIds.size} / ${Math.max(0, nodes.length - simulatedMiasmaIds.size)}`),
      createRouteExperimentMetric('計算元', simulation.source),
      ...(simulation.inferredCircle
        ? [createRouteExperimentMetric(
            '円復元',
            `安全${simulation.inferredCircle.safeNodeCount} / 瘴気${simulation.inferredCircle.miasmaNodeCount}`
              + ` / 誤差${simulation.inferredCircle.mismatches}`,
          )]
        : []),
    );
  }
  else {
    const modelLabel = simulation.source === 'learned-node-boundary-model'
      ? `自己学習モデル（観測${simulation.observationCount || 1}回）`
      : (simulation.source === 'limit-circle-estimate'
        ? '初期推定モデル'
        : '登録済み実測モデル');
    elements.routeExperimentStatus.textContent = `${modelLabel} / step ${simulation.step} / 全${nodes.length}ノード`;
    elements.routeExperimentMetrics.replaceChildren(
      createRouteExperimentMetric('現在シミュレート 半径 / 中心',
        `${simulation.currentRadius.toFixed(1)} / ${simulation.currentCenter.x.toFixed(1)}, ${simulation.currentCenter.y.toFixed(1)}`),
      createRouteExperimentMetric('第一次最終 半径 / 中心',
        `${simulation.finalRadius.toFixed(1)} / ${simulation.finalCenter.x.toFixed(1)}, ${simulation.finalCenter.y.toFixed(1)}`),
      createRouteExperimentMetric('シミュレート 瘴気 / 安全ノード',
        `${simulation.simulatedMiasmaCount} / ${simulation.simulatedSafeCount}`),
      createRouteExperimentMetric('計算元', `${modelLabel} ${simulation.modelKey}`),
    );
  }
}

function renderRoutePlan(routeState) {
  if (!globalThis.GbfRoutePlanner)
    throw new Error('ルート計算モジュールを読み込めません');
  const configuredRadius = Number(elements.routeMapRadius?.value);
  const localRadius = Number.isFinite(configuredRadius) && configuredRadius > 0
    ? Math.min(1600, Math.max(200, configuredRadius))
    : DEFAULT_ROUTE_MAP_RADIUS;
  const plan = globalThis.GbfRoutePlanner.planRoute(routeState, { localRadius, fallbackHops: 4 });
  currentRoutePlanReport = createRoutePlanReport(plan);
  elements.copyRoutePlanReport.disabled = !currentRoutePlanReport;
  if (!plan.state.nodes.length)
    throw new Error('nodeListを取得できません');
  if (plan.state.currentNodeId === null)
    throw new Error('現在地を取得できません');
  const miasma = plan.state.miasma;
  const miasmaText = !miasma.active
    ? '未発生'
    : `Lv${miasma.level ?? '?'} ${miasma.step ?? 0}% / 残${miasma.remainTurn ?? '—'}T`;
  const phaseText = plan.phase === 'day-two-shrink'
    ? '2日目・収縮中'
    : (plan.phase === 'day-two-early' ? '2日目前半' : '1日目');
  elements.routeStateSummary.replaceChildren(
    createRouteStateChip('現在地', `node ${plan.state.currentNodeId}`),
    createRouteStateChip('ターン', String(plan.state.totalTurn)),
    createRouteStateChip('フェーズ', phaseText),
    createRouteStateChip('通貨', formatNumber(plan.state.currency)),
    createRouteStateChip('収縮', miasmaText),
    createRouteStateChip('瘴気通過', !miasma.active
      ? '対象外'
      : (plan.miasmaTraversalAllowed
        ? (plan.state.partyMembers.length
          ? `許容 ${plan.miasmaHealthBudgetPercent.toFixed(1)}%`
          : 'HP未取得')
        : '禁止')),
    createRouteStateChip('瘴気予定', `${plan.miasmaDamagePercent}% / ${plan.miasmaExposureCount}回`),
    ...(plan.bossArrivalRemainingTurns !== null
      ? [createRouteStateChip(
        'ボス到着余力',
        `${Math.max(0, plan.bossArrivalRemainingTurns)}T / 目標${plan.secondShrinkBossArrivalBufferTurns}T`,
      )]
      : []),
    ...(plan.secondShrinkSimulation
      ? [createRouteStateChip(
        '第2収縮アンカー',
        `boss node ${plan.secondShrinkSimulation.anchorBossId} / ${
          plan.secondShrinkSimulation.startCircleSource ? 'saved circle' : 'hop fallback'
        }`,
      )]
      : []),
  );
  renderRouteMap(plan);
  const modeText = plan.mode === 'boss'
    ? 'ボス到達優先'
    : (plan.mode === 'boss-detour'
      ? 'ボス到達前の安全な寄り道'
      : (plan.mode === 'first-shrink-outer'
        ? '第一次収縮・安置外回収優先'
        : (plan.mode === 'fallback'
          ? '安全優先の暫定ルート'
          : (plan.mode === 'blocked' ? '安全な移動先なし' : '価値ノード回収'))));
  const transferText = plan.transferDecision?.action === 'transfer'
    ? ' / 転送する'
    : '';
  elements.routePlanMode.textContent = `${modeText}${transferText}`;
  const visiblePath = plan.displayPath || plan.path;
  let visibleMiasmaDamage = 0;
  const stayingAtWarp = plan.transferDecision?.action === 'stay';
  const stepEntries = [
    ...(stayingAtWarp && visiblePath.length
      ? [{ id: visiblePath[0], timelineIndex: null, stayAtWarp: true }]
      : []),
    ...visiblePath.slice(1).map((id, index) => ({
      id, timelineIndex: index, stayAtWarp: false,
    })),
  ];
  const steps = stepEntries.map((entry, index) => {
    const { id, timelineIndex, stayAtWarp } = entry;
    const node = plan.graph.byId.get(id);
    const visual = globalThis.GbfRoutePlanner.nodeVisual(node);
    const row = document.createElement('div');
    row.className = `route-step route-kind-${visual.key}${stayAtWarp ? ' stay-at-warp' : ''}`;
    const number = document.createElement('div');
    number.className = 'route-step-number';
    number.textContent = String(index + 1);
    const main = document.createElement('div');
    main.className = 'route-step-main';
    const title = document.createElement('strong');
    title.textContent = stayAtWarp
      ? '🚫転移（転移しない）'
      : `${visual.icon} ${visual.label}`;
    const detail = document.createElement('small');
    const eventId = node?.specialIncidentId ?? node?.specialType;
    detail.textContent = [
      `node ${id}`,
      `XY ${node?.x ?? '—'}, ${node?.y ?? '—'}`,
      eventId !== null && eventId !== undefined ? `event ${eventId}` : null,
      stayAtWarp
        ? '現在地・転移を拒否'
        : (node?.isVisited ? '訪問済みを通過' : '未訪問'),
    ].filter(Boolean).join(' / ');
    main.append(title, detail);
    const deadline = document.createElement('div');
    deadline.className = 'route-step-deadline';
    const unsafeAt = plan.deadlines.get(id);
    const timeline = timelineIndex === null ? null : plan.routeTimeline?.[timelineIndex];
    if (timeline?.miasmaExposures > 0) {
      visibleMiasmaDamage += timeline.miasmaDamagePercent;
      deadline.textContent = `到着 T${timeline.arrivalTurn} / 瘴気 -${timeline.miasmaDamagePercent}% / 累計 ${visibleMiasmaDamage}%`;
    }
    else {
      const timing = timeline
        ? `到着 T${timeline.arrivalTurn}${timeline.processingTurns ? ` / 処理後 T${timeline.departureTurn}` : ''}`
        : '';
      const limit = Number.isFinite(unsafeAt) ? `期限 T${unsafeAt}` : '';
      deadline.textContent = [timing, limit].filter(Boolean).join(' / ');
    }
    row.append(number, main, deadline);
    return row;
  });
  if (plan.transferDecision?.action === 'transfer') {
    const row = document.createElement('div');
    row.className = 'route-step transfer-decision';
    const number = document.createElement('div');
    number.className = 'route-step-number';
    number.textContent = '↯';
    const main = document.createElement('div');
    main.className = 'route-step-main';
    const title = document.createElement('strong');
    title.textContent = '💎 転送する';
    const detail = document.createElement('small');
    detail.textContent = '転送後のエリアは移動完了後に表示';
    main.append(title, detail);
    row.append(number, main);
    steps.push(row);
  }
  if (!steps.length) {
    const empty = document.createElement('div');
    empty.className = 'ajax-trace-empty';
    empty.textContent = plan.warning || '現在地で待機、または回収対象がありません';
    steps.push(empty);
  }
  elements.routePlanSteps.replaceChildren(...steps);
  elements.routePlanStatus.classList.toggle('warning', Boolean(plan.warning));
  elements.routePlanStatus.textContent = plan.warning
    || `半径${plan.localRadius} / ${plan.localDistances.size}ノード表示 / ${visiblePath.length ? visiblePath.length - 1 : 0}手を表示 / ${routeState.capturedAt || ''}`;
  renderRouteExperiment(plan);
}

async function restoreRouteMapRadius() {
  const stored = await chrome.storage.local.get(ROUTE_MAP_RADIUS_KEY);
  const radius = Number(stored?.[ROUTE_MAP_RADIUS_KEY]);
  if (Number.isFinite(radius) && elements.routeMapRadius)
    elements.routeMapRadius.value = String(Math.min(1600, Math.max(200, radius)));
}

async function saveRouteMapRadius() {
  const radius = Math.min(1600, Math.max(200, Number(elements.routeMapRadius?.value) || DEFAULT_ROUTE_MAP_RADIUS));
  elements.routeMapRadius.value = String(radius);
  await chrome.storage.local.set({ [ROUTE_MAP_RADIUS_KEY]: radius });
  await loadRoutePlan();
}

function routeFirstShrinkCircleMatchesState(routeState) {
  const state = globalThis.GbfRoutePlanner?.normalizeState(routeState);
  const circle = state?.firstShrinkFinalCircle;
  if (!circle)
    return false;
  const registeredSimulation = globalThis.GbfRoutePlanner?.simulateFirstShrinkArea(routeState);
  if (registeredSimulation
    && String(circle.source || '').startsWith('saved-native-image:'))
    return false;
  if (registeredSimulation?.modelKey && circle.modelKey
    && registeredSimulation.modelKey !== circle.modelKey)
    return false;
  if (registeredSimulation?.source === 'learned-node-boundary-model'
    && circle.source !== 'saved-first-shrink-learned-model')
    return false;
  const dayIndex = state.dayOneBossDefeated ? 2 : 1;
  return [
    [circle.mapId, state.mapId],
    [circle.basePatternId, state.miasma.basePatternId],
    [circle.patternId, state.miasma.patternId],
    [circle.dayIndex, dayIndex],
  ].every(([saved, current]) => saved === null || current === null || saved === current);
}

async function ensureFirstShrinkCircleSnapshot(routeState, tabId) {
  if (!routeState || routeFirstShrinkCircleMatchesState(routeState))
    return routeState;
  const normalized = globalThis.GbfRoutePlanner?.normalizeState(routeState);
  const secondShrinkActive = normalized?.miasma.active
    && (Number(normalized.miasma.level) >= 2 || Number(normalized.miasma.status) >= 3);
  // Never reconstruct the first circle after the second contraction has begun.
  // Without a saved snapshot the planner intentionally uses its conservative
  // graph-distance fallback instead of creating a different coordinate circle.
  if (secondShrinkActive)
    return routeState;
  const circle = globalThis.GbfRoutePlanner?.createFirstShrinkCircleSnapshot(routeState);
  if (!circle)
    return routeState;
  const response = await chrome.runtime.sendMessage({
    type: 'GBF_SAVE_FIRST_SHRINK_CIRCLE',
    tabId,
    circle,
  });
  if (response?.error)
    throw new Error(response.error);
  routeState.firstShrinkFinalCircle = response?.circle || circle;
  return routeState;
}

async function loadRoutePlan() {
  const tabId = await ensureCurrentTabId();
  elements.refreshRoutePlan.disabled = true;
  elements.routePlanStatus.classList.remove('warning');
  elements.routePlanStatus.textContent = 'ページと最新Ajaxから状態を取得中…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GBF_GET_ROUTE_STATE', tabId });
    if (response?.error)
      throw new Error(response.error);
    if (response?.routeSessionStarting) {
      resetRouteOptimizationView(response.routeSessionId || '');
      return;
    }
    const routeState = await ensureFirstShrinkCircleSnapshot(response?.routeState, tabId);
    await collectRouteSpecialEventObservations(routeState);
    renderRoutePlan(routeState);
  }
  catch (error) {
    elements.routePlanStatus.classList.add('warning');
    elements.routePlanStatus.textContent = `取得失敗: ${String(error?.message || error)}`;
    throw error;
  }
  finally {
    elements.refreshRoutePlan.disabled = false;
  }
}

function scheduleRoutePlanRefresh() {
  clearTimeout(routePlanRefreshTimer);
  routePlanRefreshTimer = setTimeout(() => {
    const active = document.querySelector('.view-tab.active')?.dataset.view === 'route-plan';
    if (active)
      loadRoutePlan().catch(() => {});
  }, 300);
}

elements.copyId.addEventListener('click', () => copyParticipationId().catch(() => {
  elements.status.textContent = '参戦IDをコピーできませんでした';
}));
elements.checkOnlineUpdate.addEventListener('click', () => loadOnlineUpdateState(true));
elements.openOnlineUpdate.addEventListener('click', () => openOnlineUpdatePage().catch(() => {}));
elements.refreshGuidebookEffects.addEventListener('click', () => loadGuidebookEffects().catch((error) => {
  elements.guidebookStatus.textContent = `更新失敗: ${String(error?.message || error)}`;
}));
elements.captureGuidebookEffects.addEventListener('click', () => captureGuidebookEffects().catch(() => {}));
elements.inspectGuidebookStorage.addEventListener('click', () => inspectGuidebookStorage().catch(() => {}));
elements.copyGuidebookDiagnostics.addEventListener('click', () => {
  copyGuidebookCaptureFailureReport().catch(() => {});
});
elements.copyGuidebookEffects.addEventListener('click', () => copyGuidebookEffects().catch(() => {
  elements.guidebookStatus.textContent = '導本効果一覧をコピーできませんでした';
}));
elements.exportGuidebookEffects.addEventListener('click', exportGuidebookEffects);
elements.importGuidebookEffects.addEventListener('click', () => elements.importGuidebookFile.click());
elements.importGuidebookFile.addEventListener('change', () => {
  importGuidebookEffectsFile(elements.importGuidebookFile.files?.[0]).catch(() => {});
});
elements.guidebookFilter.addEventListener('input', () => renderGuidebookEffects());
elements.guidebookStateFilter.addEventListener('change', () => renderGuidebookEffects());
elements.captureGameNodes.addEventListener('click', () => captureGameViewNodes().catch(() => {}));
elements.copyGameNodes.addEventListener('click', () => copyGameViewNodes().catch(() => {
  elements.nodeInspectorStatus.textContent = 'JSONをコピーできませんでした';
}));
elements.saveGameNodes.addEventListener('click', saveGameViewNodes);
elements.captureMiasmaAnalysis.addEventListener('click', () => captureMiasmaAnalysis().catch(() => {}));
elements.copyMiasmaAnalysis.addEventListener('click', () => copyMiasmaAnalysis().catch(() => {
  elements.miasmaAnalysisStatus.textContent = '解析JSONをコピーできませんでした';
}));
elements.saveMiasmaAnalysis.addEventListener('click', saveMiasmaAnalysis);
elements.startAjaxTrace.addEventListener('click', () => controlAjaxTrace('start').catch((error) => {
  elements.ajaxTraceStatus.textContent = `記録開始失敗: ${String(error?.message || error)}`;
}));
elements.stopAjaxTrace.addEventListener('click', () => controlAjaxTrace('stop').catch((error) => {
  elements.ajaxTraceStatus.textContent = `停止失敗: ${String(error?.message || error)}`;
}));
elements.refreshAjaxTrace.addEventListener('click', () => loadAjaxTrace().catch((error) => {
  elements.ajaxTraceStatus.textContent = `更新失敗: ${String(error?.message || error)}`;
}));
elements.clearAjaxTrace.addEventListener('click', () => controlAjaxTrace('clear').catch((error) => {
  elements.ajaxTraceStatus.textContent = `クリア失敗: ${String(error?.message || error)}`;
}));
elements.copyAjaxTrace.addEventListener('click', () => copyAjaxTrace().catch(() => {
  elements.ajaxTraceStatus.textContent = 'Ajax履歴JSONをコピーできませんでした';
}));
elements.saveAjaxTrace.addEventListener('click', saveAjaxTrace);
elements.refreshAjaxArchives.addEventListener('click', () => loadAjaxArchives().catch((error) => {
  elements.ajaxArchiveStatus.textContent = `一覧更新失敗: ${String(error?.message || error)}`;
}));
elements.clearAjaxArchives.addEventListener('click', () => clearAjaxArchives().catch((error) => {
  elements.ajaxArchiveStatus.textContent = `削除失敗: ${String(error?.message || error)}`;
}));
elements.refreshRoutePlan.addEventListener('click', () => loadRoutePlan().catch(() => {}));
elements.routeMapRadius.addEventListener('change', () => saveRouteMapRadius().catch(() => {}));
elements.copyRoutePlanReport.addEventListener('click', () => copyRoutePlanReport().catch((error) => {
  elements.routePlanStatus.textContent = `報告コピー失敗: ${String(error?.message || error)}`;
}));
elements.copyRouteExperimentReport.addEventListener('click', () => copyRouteExperimentReport().catch((error) => {
  elements.routeExperimentStatus.textContent = `報告コピー失敗: ${String(error?.message || error)}`;
}));
elements.copyCurrentRouteEvent.addEventListener('click', () => copyCurrentRouteEvent().catch(() => {
  elements.routeObservationCount.textContent = 'コピー失敗';
}));
for (const tab of document.querySelectorAll?.('.view-tab') || []) {
  tab.addEventListener('click', () => {
    for (const item of document.querySelectorAll('.view-tab'))
      item.classList.toggle('active', item === tab);
    for (const panel of document.querySelectorAll('.view-panel'))
      panel.classList.toggle('active', panel.dataset.panel === tab.dataset.view);
    if (tab.dataset.view === 'feature-test') {
      loadAjaxTrace().catch(() => {});
      loadAjaxArchives().catch((error) => {
        elements.ajaxArchiveStatus.textContent = `永続ログ取得失敗: ${String(error?.message || error)}`;
      });
      if (!currentNodeInspectionJson)
        captureGameViewNodes().catch(() => {});
    }
    if (tab.dataset.view === 'guidebook')
      loadGuidebookEffects().catch(() => {});
    if (tab.dataset.view === 'route-plan')
      loadRoutePlan().catch(() => {});
  });
}
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'GBF_ONLINE_UPDATE_STATE_UPDATED')
    renderOnlineUpdateState(message.state);
  if (message?.type === 'GBF_BATTLE_STATE_UPDATED' && message.tabId === currentTabId)
    render(message.state);
  if (message?.type === 'GBF_AJAX_TRACE_UPDATED' && message.tabId === currentTabId)
    scheduleAjaxTraceRefresh();
  if (message?.type === 'GBF_ROUTE_SESSION_STARTED' && message.tabId === currentTabId)
    resetRouteOptimizationView(message.routeSessionId || '');
  if (message?.type === 'GBF_ROUTE_STATE_UPDATED' && message.tabId === currentTabId)
    scheduleRoutePlanRefresh();
  if (message?.type === 'GBF_GUIDEBOOK_EFFECTS_UPDATED') {
    const { latestCandidateCount, latestAcquisitionCount } = renderGuidebookEffects(
      message.effects || [],
      message.effectValues || [],
    );
    showGuidebookCaptureToast(
      message.captureBatchId,
      message.capturedEffects || [],
    );
    elements.guidebookStatus.classList.add?.('updated');
    if (latestCandidateCount === 0 && latestAcquisitionCount === 0)
      elements.guidebookStatus.textContent = `候補をリアルタイム記録 / ${currentGuidebookEffects.length}件`;
  }
});
chrome.tabs.onActivated.addListener(() => loadActiveTabState().catch(() => {}));
chrome.windows.onFocusChanged.addListener(() => loadActiveTabState().catch(() => {}));
restoreRouteMapRadius().catch(() => {});
loadOnlineUpdateState().catch(() => {});
loadGuidebookEffects().catch(() => {});
loadActiveTabState().catch(() => {
  elements.status.textContent = '対象タブの情報を取得できませんでした';
});
