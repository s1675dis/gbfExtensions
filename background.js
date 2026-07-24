const STATE_PREFIX = 'battle-state:';
const LATEST_STATE_KEY = `${STATE_PREFIX}latest`;
const GUIDEBOOK_EFFECTS_KEY = 'guidebook-effects:v1';
const GUIDEBOOK_EFFECT_VALUES_KEY = 'guidebook-effect-values:v1';
const GUIDEBOOK_SORTIE_STATE_PREFIX = 'guidebook-sortie-state:v1:';
const AJAX_TRACE_PREFIX = 'ajax-trace:';
const ROUTE_FIRST_SHRINK_CIRCLE_PREFIX = 'route-first-shrink-circle:';
const ROUTE_FIRST_SHRINK_MODELS_KEY = 'route-first-shrink-models:v1';
const ONLINE_UPDATE_STATE_KEY = 'online-update-state:v1';
const ONLINE_UPDATE_ALARM = 'gbf-extension-online-update';
const ONLINE_UPDATE_INTERVAL_MINUTES = 360;
const ONLINE_UPDATE_CHANNEL_URL =
  'https://raw.githubusercontent.com/s1675dis/gbfExtensions/main/update/channel.json';
const ONLINE_GUIDEBOOK_DATA_URL =
  'https://raw.githubusercontent.com/s1675dis/gbfExtensions/main/data/guidebook-effects.json';
const ONLINE_FIRST_SHRINK_DATA_URL =
  'https://raw.githubusercontent.com/s1675dis/gbfExtensions/main/data/first-shrink-models.json';
const ONLINE_RELEASE_URL = 'https://github.com/s1675dis/gbfExtensions/releases/latest';
const MAX_AJAX_TRACE_ENTRIES = 60;
const MAX_AJAX_TRACE_ENTRY_CHARS = 160000;
const MAX_AJAX_TRACE_TOTAL_CHARS = 4000000;
const AJAX_ARCHIVE_DIRECTORY = 'gbf-ajax-traces';
const AJAX_ARCHIVE_PART_BYTES = 5 * 1024 * 1024;
const stateCache = new Map();
const updateQueues = new Map();
const ajaxTraceCache = new Map();
const ajaxTraceQueues = new Map();
let guidebookEffectsQueue = Promise.resolve();
let guidebookCandidateBatchSequence = 0;
const guidebookSortieQueues = new Map();
const routeRuntimeCache = new Map();
const routeFirstShrinkLearningQueues = new Map();
const routeFirstShrinkLearningSignatures = new Map();
const ROUTE_CONSUMED_ON_DEPARTURE_TYPES = new Set([2, 5, 6, 7]);
const ROUTE_PASSED_DANGER_TYPES = new Set([3, 4, 11]);
const ROUTE_NON_COORDINATE_SPECIAL_TYPES = new Set([1, 2, 3, 5, 6, 7, 8]);

function emptyTurnStats() {
  return { hit: 0, debuff: 0, ability: 0, special: 0, total: 0 };
}

function createEmptyState() {
  return {
    active: false,
    battleId: '',
    participationId: '',
    totalDamage: 0,
    participantCount: 0,
    participantLimit: 0,
    statsTurn: 0,
    lastTurn: emptyTurnStats(),
    characterStats: [],
    previousCharacterStats: [],
    bossDebuffKeys: [],
    bossDebuffs: [],
    bossDebuffStateInitialized: false,
    frontFormation: [],
    members: [],
    updatedAt: 0,
  };
}

function storageKey(tabId) {
  return `${STATE_PREFIX}${tabId}`;
}

function ajaxTraceStorageKey(tabId) {
  return `${AJAX_TRACE_PREFIX}${tabId}`;
}

function routeFirstShrinkCircleStorageKey(tabId) {
  return `${ROUTE_FIRST_SHRINK_CIRCLE_PREFIX}${tabId}`;
}

function normalizeRouteFirstShrinkCircle(circle) {
  const centerX = routeNumber(circle?.center?.x ?? circle?.centerX);
  const centerY = routeNumber(circle?.center?.y ?? circle?.centerY);
  const radius = routeNumber(circle?.radius);
  if (centerX === null || centerY === null || radius === null || radius <= 0)
    return null;
  return {
    center: { x: centerX, y: centerY },
    radius,
    capturedAt: circle?.capturedAt || new Date().toISOString(),
    source: circle?.source || 'saved-first-shrink-circle',
    modelKey: circle?.modelKey || null,
    mapId: routeNumber(circle?.mapId),
    basePatternId: routeNumber(circle?.basePatternId),
    patternId: routeNumber(circle?.patternId),
    dayIndex: routeNumber(circle?.dayIndex),
  };
}

async function saveRouteFirstShrinkCircle(tabId, circle) {
  const normalized = normalizeRouteFirstShrinkCircle(circle);
  if (!normalized)
    throw new Error('Invalid first-shrink circle snapshot');
  const previous = routeRuntimeCache.get(tabId) || { nodes: [], miasma: {} };
  routeRuntimeCache.set(tabId, {
    ...previous,
    firstShrinkFinalCircle: normalized,
  });
  await chrome.storage.session.set({
    [routeFirstShrinkCircleStorageKey(tabId)]: normalized,
  });
  return normalized;
}

async function readRouteFirstShrinkCircle(tabId) {
  const cached = normalizeRouteFirstShrinkCircle(
    routeRuntimeCache.get(tabId)?.firstShrinkFinalCircle,
  );
  if (cached)
    return cached;
  const key = routeFirstShrinkCircleStorageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  return normalizeRouteFirstShrinkCircle(stored?.[key]);
}

function normalizeRouteFirstShrinkLearnedModel(model) {
  const centerX = routeNumber(model?.finalCenter?.x ?? model?.center?.x);
  const centerY = routeNumber(model?.finalCenter?.y ?? model?.center?.y);
  const finalRadius = routeNumber(model?.finalRadius ?? model?.radius);
  const radiusIntercept = routeNumber(model?.radiusIntercept ?? model?.startRadius);
  if (centerX === null || centerY === null || finalRadius === null || finalRadius <= 0)
    return null;
  const mapId = routeNumber(model?.mapId);
  const basePatternId = routeNumber(model?.basePatternId);
  const patternId = routeNumber(model?.patternId);
  const dayIndex = routeNumber(model?.dayIndex);
  const key = String(model?.key
    || `${mapId ?? '*'}:${basePatternId ?? '*'}:${patternId ?? '*'}:${dayIndex ?? '*'}`);
  const samples = (Array.isArray(model?.samples) ? model.samples : [])
    .map(sample => ({
      centerX: routeNumber(sample?.centerX ?? sample?.finalCenter?.x),
      centerY: routeNumber(sample?.centerY ?? sample?.finalCenter?.y),
      finalRadius: routeNumber(sample?.finalRadius ?? sample?.radius),
      radiusIntercept: routeNumber(sample?.radiusIntercept),
      mismatches: Math.max(0, Number(sample?.mismatches) || 0),
      safeNodeCount: Math.max(0, Number(sample?.safeNodeCount) || 0),
      miasmaNodeCount: Math.max(0, Number(sample?.miasmaNodeCount) || 0),
      capturedAt: sample?.capturedAt || null,
    }))
    .filter(sample => sample.centerX !== null && sample.centerY !== null
      && sample.finalRadius !== null && sample.finalRadius > 0)
    .slice(-20);
  return {
    key,
    mapId,
    basePatternId,
    patternId,
    dayIndex,
    finalCenter: { x: centerX, y: centerY },
    finalRadius,
    radiusIntercept: radiusIntercept !== null && radiusIntercept > 0
      ? radiusIntercept : null,
    radiusPerStep: routeNumber(model?.radiusPerStep),
    observationCount: Math.max(samples.length, Number(model?.observationCount) || 0),
    samples,
    firstObservedAt: model?.firstObservedAt || null,
    lastObservedAt: model?.lastObservedAt || model?.updatedAt || null,
    updatedAt: model?.updatedAt || model?.lastObservedAt || null,
  };
}

async function readRouteFirstShrinkLearnedModels() {
  const stored = await chrome.storage.local.get(ROUTE_FIRST_SHRINK_MODELS_KEY);
  return (Array.isArray(stored?.[ROUTE_FIRST_SHRINK_MODELS_KEY])
    ? stored[ROUTE_FIRST_SHRINK_MODELS_KEY] : [])
    .map(normalizeRouteFirstShrinkLearnedModel)
    .filter(Boolean);
}

function compareExtensionVersions(left, right) {
  const a = String(left || '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const b = String(right || '').split('.').map(part => Number.parseInt(part, 10) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0)
      return difference < 0 ? -1 : 1;
  }
  return 0;
}

function validateOnlineUpdateChannel(payload) {
  if (payload?.schema !== 'gbf-extension-update-v1')
    throw new Error('オンライン更新情報の形式が不正です');
  if (!/^\d+(?:\.\d+){2,3}$/.test(String(payload?.version || '')))
    throw new Error('オンライン更新情報のバージョンが不正です');
  return {
    version: String(payload.version),
    publishedAt: payload.publishedAt || null,
    notes: String(payload.notes || '').slice(0, 1000),
    guidebookRevision: Math.max(0, Number(payload?.data?.guidebookRevision) || 0),
    firstShrinkModelRevision:
      Math.max(0, Number(payload?.data?.firstShrinkModelRevision) || 0),
  };
}

async function fetchOnlineJson(url) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'follow',
  });
  if (!response.ok)
    throw new Error(`オンライン更新の取得に失敗しました (${response.status})`);
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024)
    throw new Error('オンライン更新データが大きすぎます');
  return JSON.parse(text);
}

async function importRouteFirstShrinkModelsData(payload) {
  if (payload?.schema !== 'gbf-first-shrink-models-v1'
    || !Array.isArray(payload?.models))
    throw new Error('対応していない収縮モデルJSONです');
  if (payload.models.length > 1000)
    throw new Error('収縮モデルJSONの件数が多すぎます');
  const localModels = await readRouteFirstShrinkLearnedModels();
  const byKey = new Map(localModels.map(model => [model.key, model]));
  let added = 0;
  let merged = 0;
  for (const rawModel of payload.models) {
    const incoming = normalizeRouteFirstShrinkLearnedModel(rawModel);
    if (!incoming)
      continue;
    const local = byKey.get(incoming.key);
    if (!local) {
      byKey.set(incoming.key, incoming);
      added += 1;
      continue;
    }
    const samples = [...(local.samples || [])];
    const signatures = new Set(samples.map(sample => JSON.stringify([
      sample.centerX, sample.centerY, sample.finalRadius, sample.radiusIntercept,
      sample.capturedAt,
    ])));
    for (const sample of incoming.samples || []) {
      const signature = JSON.stringify([
        sample.centerX, sample.centerY, sample.finalRadius, sample.radiusIntercept,
        sample.capturedAt,
      ]);
      if (!signatures.has(signature)) {
        samples.push(sample);
        signatures.add(signature);
      }
    }
    const retainedSamples = samples.slice(-20);
    const combined = normalizeRouteFirstShrinkLearnedModel({
      ...incoming,
      ...local,
      samples: retainedSamples,
      finalCenter: {
        x: routeMedian(retainedSamples.map(sample => sample.centerX))
          ?? local.finalCenter.x,
        y: routeMedian(retainedSamples.map(sample => sample.centerY))
          ?? local.finalCenter.y,
      },
      finalRadius: routeMedian(retainedSamples.map(sample => sample.finalRadius))
        ?? local.finalRadius,
      radiusIntercept:
        routeMedian(retainedSamples.map(sample => sample.radiusIntercept))
          ?? local.radiusIntercept ?? incoming.radiusIntercept,
      observationCount: Math.max(
        Number(local.observationCount) || 0,
        Number(incoming.observationCount) || 0,
        retainedSamples.length,
      ),
      firstObservedAt: local.firstObservedAt || incoming.firstObservedAt,
      lastObservedAt: local.lastObservedAt || incoming.lastObservedAt,
      updatedAt: new Date().toISOString(),
    });
    if (combined)
      byKey.set(incoming.key, combined);
    merged += 1;
  }
  const models = [...byKey.values()];
  await chrome.storage.local.set({ [ROUTE_FIRST_SHRINK_MODELS_KEY]: models });
  for (const runtime of routeRuntimeCache.values())
    runtime.firstShrinkLearnedModels = models;
  return { added, merged, stored: models.length };
}

async function readOnlineUpdateState() {
  const stored = await chrome.storage.local.get(ONLINE_UPDATE_STATE_KEY);
  const currentVersion = chrome.runtime.getManifest().version;
  return {
    currentVersion,
    latestVersion: currentVersion,
    updateAvailable: false,
    releaseUrl: ONLINE_RELEASE_URL,
    checkedAt: null,
    error: '',
    appliedGuidebookRevision: 0,
    appliedFirstShrinkModelRevision: 0,
    ...(stored?.[ONLINE_UPDATE_STATE_KEY] || {}),
    currentVersion,
    releaseUrl: ONLINE_RELEASE_URL,
  };
}

async function saveOnlineUpdateState(state) {
  await chrome.storage.local.set({ [ONLINE_UPDATE_STATE_KEY]: state });
  chrome.runtime.sendMessage({
    type: 'GBF_ONLINE_UPDATE_STATE_UPDATED',
    state,
  }).catch(() => {});
  return state;
}

async function checkOnlineUpdates() {
  const previous = await readOnlineUpdateState();
  try {
    const channel = validateOnlineUpdateChannel(
      await fetchOnlineJson(ONLINE_UPDATE_CHANNEL_URL),
    );
    let appliedGuidebookRevision = Number(previous.appliedGuidebookRevision) || 0;
    let appliedFirstShrinkModelRevision =
      Number(previous.appliedFirstShrinkModelRevision) || 0;
    const dataUpdates = [];
    if (channel.guidebookRevision > appliedGuidebookRevision) {
      const result = await importGuidebookEffectsData(
        await fetchOnlineJson(ONLINE_GUIDEBOOK_DATA_URL),
      );
      appliedGuidebookRevision = channel.guidebookRevision;
      dataUpdates.push(`導本 ${result.added || 0}件追加`);
    }
    if (channel.firstShrinkModelRevision > appliedFirstShrinkModelRevision) {
      const result = await importRouteFirstShrinkModelsData(
        await fetchOnlineJson(ONLINE_FIRST_SHRINK_DATA_URL),
      );
      appliedFirstShrinkModelRevision = channel.firstShrinkModelRevision;
      dataUpdates.push(`収縮モデル ${result.added || 0}件追加`);
    }
    return saveOnlineUpdateState({
      currentVersion: previous.currentVersion,
      latestVersion: channel.version,
      updateAvailable:
        compareExtensionVersions(previous.currentVersion, channel.version) < 0,
      releaseUrl: ONLINE_RELEASE_URL,
      publishedAt: channel.publishedAt,
      notes: channel.notes,
      checkedAt: new Date().toISOString(),
      error: '',
      appliedGuidebookRevision,
      appliedFirstShrinkModelRevision,
      dataUpdates,
    });
  }
  catch (error) {
    return saveOnlineUpdateState({
      ...previous,
      checkedAt: new Date().toISOString(),
      error: String(error?.message || error),
    });
  }
}

function scheduleOnlineUpdateChecks() {
  if (!chrome.alarms?.create)
    return;
  chrome.alarms.create(ONLINE_UPDATE_ALARM, {
    delayInMinutes: 1,
    periodInMinutes: ONLINE_UPDATE_INTERVAL_MINUTES,
  });
}

function routeMedian(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length)
    return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mergeRouteFirstShrinkLearningObservation(previous, observation) {
  const sample = {
    centerX: Number(observation.finalCenter.x),
    centerY: Number(observation.finalCenter.y),
    finalRadius: Number(observation.finalRadius),
    radiusIntercept: Number(observation.radiusIntercept),
    mismatches: Math.max(0, Number(observation.mismatches) || 0),
    safeNodeCount: Math.max(0, Number(observation.safeNodeCount) || 0),
    miasmaNodeCount: Math.max(0, Number(observation.miasmaNodeCount) || 0),
    capturedAt: observation.capturedAt || new Date().toISOString(),
  };
  const samples = [...(previous?.samples || []), sample].slice(-20);
  const finalCenter = {
    x: routeMedian(samples.map(item => item.centerX)),
    y: routeMedian(samples.map(item => item.centerY)),
  };
  const finalRadius = routeMedian(samples.map(item => item.finalRadius));
  const radiusIntercept = routeMedian(samples.map(item => item.radiusIntercept));
  return normalizeRouteFirstShrinkLearnedModel({
    key: observation.key,
    mapId: observation.mapId,
    basePatternId: observation.basePatternId,
    patternId: observation.patternId,
    dayIndex: observation.dayIndex,
    finalCenter,
    finalRadius,
    radiusIntercept,
    radiusPerStep: (finalRadius - radiusIntercept) / 100,
    observationCount: (Number(previous?.observationCount) || 0) + 1,
    samples,
    firstObservedAt: previous?.firstObservedAt || sample.capturedAt,
    lastObservedAt: sample.capturedAt,
    updatedAt: new Date().toISOString(),
  });
}

async function learnRouteFirstShrinkModel(tabId, routeState) {
  const observation = globalThis.GbfRoutePlanner
    ?.createFirstShrinkLearningObservation(routeState);
  if (!observation)
    return null;
  const signature = JSON.stringify([
    observation.key,
    Math.round(Number(observation.finalCenter.x) * 10) / 10,
    Math.round(Number(observation.finalCenter.y) * 10) / 10,
    Math.round(Number(observation.finalRadius) * 10) / 10,
    observation.safeNodeCount,
    observation.miasmaNodeCount,
  ]);
  const previousSignature = routeFirstShrinkLearningSignatures.get(tabId);
  if (previousSignature?.signature === signature
    && Date.now() - previousSignature.capturedAt < 30000)
    return null;
  routeFirstShrinkLearningSignatures.set(tabId, {
    signature,
    capturedAt: Date.now(),
  });
  const models = await readRouteFirstShrinkLearnedModels();
  const index = models.findIndex(model => model.key === observation.key);
  const learned = mergeRouteFirstShrinkLearningObservation(
    index >= 0 ? models[index] : null,
    observation,
  );
  if (!learned)
    return null;
  if (index >= 0)
    models[index] = learned;
  else
    models.push(learned);
  await chrome.storage.local.set({ [ROUTE_FIRST_SHRINK_MODELS_KEY]: models });
  const circle = await saveRouteFirstShrinkCircle(tabId, {
    center: learned.finalCenter,
    radius: learned.finalRadius,
    capturedAt: learned.updatedAt,
    source: 'saved-first-shrink-learned-model',
    modelKey: learned.key,
    mapId: learned.mapId,
    basePatternId: learned.basePatternId,
    patternId: learned.patternId,
    dayIndex: learned.dayIndex,
  });
  const runtime = routeRuntimeCache.get(tabId);
  if (runtime) {
    runtime.firstShrinkLearnedModels = models;
    runtime.firstShrinkFinalCircle = circle;
  }
  chrome.runtime.sendMessage({ type: 'GBF_ROUTE_STATE_UPDATED', tabId }).catch(() => {});
  return learned;
}

function scheduleRouteFirstShrinkLearning(tabId, routeState) {
  const previous = routeFirstShrinkLearningQueues.get(tabId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => learnRouteFirstShrinkModel(tabId, routeState))
    .catch(() => null);
  routeFirstShrinkLearningQueues.set(tabId, next);
}

function guidebookSortieStateStorageKey(tabId) {
  return `${GUIDEBOOK_SORTIE_STATE_PREFIX}${tabId}`;
}

function guidebookSortieMarker(routeState) {
  const nodes = Array.isArray(routeState?.nodes) ? routeState.nodes : [];
  return {
    mapId: routeNumber(routeState?.mapId),
    totalTurn: routeNumber(routeState?.totalTurn),
    currentNodeId: routeNumber(routeState?.currentNodeId),
    visitedNodeIds: nodes
      .filter(node => Boolean(node?.isVisited))
      .map(node => routeNumber(node?.id))
      .filter(id => id !== null)
      .sort((a, b) => a - b),
    nodeCount: nodes.length,
    observedAt: new Date().toISOString(),
  };
}

function isNewGuidebookSortie(previous, current) {
  if (!previous || !current || !(Number(current.nodeCount) > 1))
    return false;
  const previousTurn = routeNumber(previous.totalTurn);
  const currentTurn = routeNumber(current.totalTurn);
  if (currentTurn === null || currentTurn > 1)
    return false;
  const previousVisited = Array.isArray(previous.visitedNodeIds)
    ? previous.visitedNodeIds.length : 0;
  const currentVisited = Array.isArray(current.visitedNodeIds)
    ? current.visitedNodeIds.length : 0;
  const turnReset = previousTurn !== null && previousTurn > currentTurn;
  const exploredMapReset = previousVisited >= 2
    && currentVisited <= 1
    && (previous.currentNodeId !== current.currentNodeId
      || previousVisited > currentVisited);
  return turnReset || exploredMapReset;
}

function observeGuidebookSortieState(tabId, routeState) {
  if (!Number.isInteger(tabId) || !Array.isArray(routeState?.nodes)
    || routeState.nodes.length <= 1)
    return;
  const marker = guidebookSortieMarker(routeState);
  const storageKey = guidebookSortieStateStorageKey(tabId);
  const previousQueue = guidebookSortieQueues.get(tabId) || Promise.resolve();
  const nextQueue = previousQueue
    .catch(() => {})
    .then(async () => {
      const stored = await chrome.storage.local.get(storageKey);
      const previous = stored?.[storageKey] || null;
      if (isNewGuidebookSortie(previous, marker))
        await resetGuidebookCurrentOwnership('new-sortie');
      await chrome.storage.local.set({ [storageKey]: marker });
    })
    .catch(() => {});
  guidebookSortieQueues.set(tabId, nextQueue);
}

function createEmptyAjaxTrace() {
  return {
    enabled: false,
    startedAt: null,
    updatedAt: null,
    entries: [],
    archiveSessionId: null,
    archivePart: 0,
    archivePartBytes: 0,
    archiveError: '',
  };
}

async function getAjaxArchiveDirectory() {
  if (!navigator?.storage?.getDirectory)
    throw new Error('このChrome環境では永続ファイル領域を利用できません');
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(AJAX_ARCHIVE_DIRECTORY, { create: true });
}

function ajaxArchiveFileName(trace) {
  const part = String(Math.max(1, Number(trace.archivePart) || 1)).padStart(4, '0');
  return `${trace.archiveSessionId}-part-${part}.jsonl`;
}

async function appendAjaxArchiveRecord(trace, record) {
  if (!trace.archiveSessionId)
    return;
  const directory = await getAjaxArchiveDirectory();
  let line = `${JSON.stringify(record)}\n`;
  const lineBytes = new TextEncoder().encode(line).byteLength;
  trace.archivePart = Math.max(1, Number(trace.archivePart) || 1);
  trace.archivePartBytes = Math.max(0, Number(trace.archivePartBytes) || 0);
  if (trace.archivePartBytes > 0 && trace.archivePartBytes + lineBytes > AJAX_ARCHIVE_PART_BYTES) {
    trace.archivePart += 1;
    trace.archivePartBytes = 0;
  }
  const handle = await directory.getFileHandle(ajaxArchiveFileName(trace), { create: true });
  const file = await handle.getFile();
  const writable = await handle.createWritable({ keepExistingData: true });
  await writable.seek(file.size);
  await writable.write(line);
  await writable.close();
  trace.archivePartBytes = file.size + lineBytes;
}

async function appendPersistentAjaxArchive(trace, payload) {
  if (payload.kind === 'miasma_visual') {
    await appendAjaxArchiveRecord(trace, {
      kind: 'miasma_visual',
      capturedAt: new Date().toISOString(),
      url: String(payload.url || ''),
      snapshot: payload.snapshot ?? null,
    });
    return;
  }
  const normalized = normalizeResponseData(payload.responseData) ?? payload.responseData;
  await appendAjaxArchiveRecord(trace, {
    kind: 'ajax',
    capturedAt: new Date().toISOString(),
    url: String(payload.url || ''),
    requestData: payload.requestData ?? null,
    responseData: normalized ?? null,
    candidates: extractAjaxStateCandidates(payload.responseData),
  });
}

async function listAjaxArchiveFiles() {
  const directory = await getAjaxArchiveDirectory();
  const files = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file' || !/^gbf-ajax-trace-.*\.jsonl$/.test(name))
      continue;
    const file = await handle.getFile();
    files.push({ name, size: file.size, lastModified: file.lastModified });
  }
  return files.sort((a, b) => b.lastModified - a.lastModified);
}

async function readAjaxArchiveFile(name) {
  if (!/^gbf-ajax-trace-[A-Za-z0-9_-]+-part-\d{4}\.jsonl$/.test(String(name || '')))
    throw new Error('不正な永続ログ名です');
  const directory = await getAjaxArchiveDirectory();
  const handle = await directory.getFileHandle(name);
  const file = await handle.getFile();
  return { name, size: file.size, text: await file.text() };
}

async function clearAjaxArchiveFiles() {
  const directory = await getAjaxArchiveDirectory();
  let removed = 0;
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file' || !/^gbf-ajax-trace-.*\.jsonl$/.test(name))
      continue;
    await directory.removeEntry(name);
    removed += 1;
  }
  return removed;
}

async function getAjaxTrace(tabId) {
  if (ajaxTraceCache.has(tabId))
    return ajaxTraceCache.get(tabId);
  const key = ajaxTraceStorageKey(tabId);
  const stored = await chrome.storage.session.get(key);
  const trace = stored[key] || createEmptyAjaxTrace();
  if (!Array.isArray(trace.entries))
    trace.entries = [];
  ajaxTraceCache.set(tabId, trace);
  return trace;
}

async function saveAjaxTrace(tabId, trace) {
  trace.updatedAt = new Date().toISOString();
  while (trace.entries.length > MAX_AJAX_TRACE_ENTRIES)
    trace.entries.shift();
  while (trace.entries.length > 1 && JSON.stringify(trace).length > MAX_AJAX_TRACE_TOTAL_CHARS)
    trace.entries.shift();
  ajaxTraceCache.set(tabId, trace);
  await chrome.storage.session.set({ [ajaxTraceStorageKey(tabId)]: trace });
  chrome.runtime.sendMessage({
    type: 'GBF_AJAX_TRACE_UPDATED',
    tabId,
    enabled: trace.enabled,
    count: trace.entries.length,
    updatedAt: trace.updatedAt,
  }).catch(() => {});
}

function traceValueSummary(value) {
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value))
    return value;
  if (Array.isArray(value)) {
    if (value.length <= 30 && value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item)))
      return value;
    return `[Array(${value.length})]`;
  }
  if (typeof value === 'object')
    return `{${Object.keys(value).slice(0, 20).join(', ')}}`;
  return String(value);
}

function extractAjaxStateCandidates(responseData) {
  const root = normalizeResponseData(responseData);
  if (!root || typeof root !== 'object')
    return [];
  const candidates = [];
  const seen = new WeakSet();
  const locationKeys = new Set([
    'pieceNodeId', 'piece_node_id', 'currentNodeId', 'current_node_id', 'after_current_node_id',
  ]);
  const previousLocationKeys = new Set(['before_current_node_id']);
  const turnKeys = new Set(['elapsedTurn', 'elapsed_turn', 'totalTurn', 'total_turn']);
  const currencyKeys = new Set([
    'dungeonShopPoint', 'dungeon_shop_point', 'possession_arcarum3_dungeon_point',
    'shopPoint', 'shop_point',
  ]);
  const visitedKeys = new Set(['isVisited', 'is_visited']);
  const miasmaKeyPattern = /(?:miasma|shrinking|shrink_|remainTurn|remain_turn|limitCircle|limit_circle|appearBoss|appear_boss)/i;

  const add = (category, path, key, value, parent) => {
    if (candidates.length >= 240)
      return;
    const candidate = { category, path, key, value: traceValueSummary(value) };
    const relatedNodeId = parent?.node_id ?? parent?.nodeId ?? parent?.id;
    if (relatedNodeId !== undefined)
      candidate.nodeId = relatedNodeId;
    candidates.push(candidate);
  };
  const visit = (value, path, depth, miasmaContext = false) => {
    if (!value || typeof value !== 'object' || depth > 24 || seen.has(value))
      return;
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      const childPath = Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`;
      const inMiasma = miasmaContext || miasmaKeyPattern.test(key);
      if (locationKeys.has(key))
        add('currentNode', childPath, key, child, value);
      if (previousLocationKeys.has(key))
        add('previousNode', childPath, key, child, value);
      if (turnKeys.has(key))
        add('elapsedTurn', childPath, key, child, value);
      if (currencyKeys.has(key))
        add('currency', childPath, key, child, value);
      const isDungeonItem = key === 'dungeon_item_id'
        || (key === 'item_id' && /^dungeon_item_/i.test(String(value?.image_id || value?.imageId || '')));
      if (isDungeonItem)
        add('dungeonItem', childPath, key, child, value);
      if ((visitedKeys.has(key) || key === 'is_visited_node') && child === true)
        add('visitedNode', childPath, key, child, value);
      if (key === 'is_shrinking') {
        if (child === true)
          add('shrinkingNode', childPath, key, child, value);
      }
      else if (inMiasma && !/^\d+$/.test(key)
        && (child === null || Array.isArray(child) || ['string', 'number', 'boolean'].includes(typeof child)))
        add('miasma', childPath, key, child, value);
      if (child && typeof child === 'object')
        visit(child, childPath, depth + 1, inMiasma);
    }
  };
  visit(root, '$', 0);
  return candidates;
}

function createTraceSafeValue(value, maxChars = MAX_AJAX_TRACE_ENTRY_CHARS) {
  const seen = new WeakSet();
  let used = 0;
  let truncated = false;
  const copy = (item, depth) => {
    if (item === null || item === undefined || typeof item === 'number' || typeof item === 'boolean')
      return item ?? null;
    if (typeof item === 'string') {
      const remaining = Math.max(0, maxChars - used);
      const text = item.length > remaining ? `${item.slice(0, remaining)}…[truncated]` : item;
      used += text.length;
      if (text.length !== item.length)
        truncated = true;
      return text;
    }
    if (typeof item !== 'object')
      return String(item);
    if (depth > 24 || used >= maxChars) {
      truncated = true;
      return '[truncated]';
    }
    if (seen.has(item))
      return '[circular]';
    seen.add(item);
    const output = Array.isArray(item) ? [] : {};
    for (const [key, child] of Object.entries(item)) {
      used += key.length + 4;
      if (used >= maxChars) {
        truncated = true;
        if (!Array.isArray(output))
          output.$truncated = true;
        break;
      }
      output[key] = copy(child, depth + 1);
    }
    return output;
  };
  return { value: copy(value, 0), truncated };
}

async function appendAjaxTrace(tabId, payload) {
  const trace = await getAjaxTrace(tabId);
  if (!trace.enabled)
    return false;
  const isMiasmaVisual = payload.kind === 'miasma_visual';
  const normalized = normalizeResponseData(payload.responseData) ?? payload.responseData;
  const safePayload = createTraceSafeValue(isMiasmaVisual
    ? { snapshot: payload.snapshot ?? null }
    : {
      requestData: payload.requestData ?? null,
      responseData: normalized ?? null,
    });
  if (!isMiasmaVisual) {
    trace.entries.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      capturedAt: new Date().toISOString(),
      url: String(payload.url || ''),
      kind: 'ajax',
      candidates: extractAjaxStateCandidates(payload.responseData),
      truncated: safePayload.truncated,
      ...safePayload.value,
    });
  }
  try {
    await appendPersistentAjaxArchive(trace, payload);
    trace.archiveError = '';
  }
  catch (error) {
    trace.archiveError = String(error?.message || error);
  }
  await saveAjaxTrace(tabId, trace);
  return true;
}

function enqueueAjaxTrace(tabId, payload) {
  const previous = ajaxTraceQueues.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => appendAjaxTrace(tabId, payload));
  ajaxTraceQueues.set(tabId, next);
  next.finally(() => {
    if (ajaxTraceQueues.get(tabId) === next)
      ajaxTraceQueues.delete(tabId);
  });
  return next;
}

async function controlAjaxTrace(tabId, action) {
  const pending = ajaxTraceQueues.get(tabId);
  if (pending)
    await pending.catch(() => {});
  const trace = await getAjaxTrace(tabId);
  if (action === 'start') {
    trace.enabled = true;
    trace.startedAt = new Date().toISOString();
    trace.entries = [];
    trace.archiveSessionId = `gbf-ajax-trace-${trace.startedAt.replace(/[:.]/g, '-')}`;
    trace.archivePart = 1;
    trace.archivePartBytes = 0;
    trace.archiveError = '';
    try {
      await appendAjaxArchiveRecord(trace, {
        kind: 'session_start',
        capturedAt: trace.startedAt,
        tabId,
      });
    }
    catch (error) {
      trace.archiveError = String(error?.message || error);
    }
  }
  else if (action === 'stop') {
    try {
      await appendAjaxArchiveRecord(trace, {
        kind: 'session_end',
        capturedAt: new Date().toISOString(),
        tabId,
      });
    }
    catch (error) {
      trace.archiveError = String(error?.message || error);
    }
    trace.enabled = false;
  }
  else if (action === 'clear') {
    trace.entries = [];
  }
  else {
    throw new Error(`不明なAjax履歴操作: ${action}`);
  }
  await saveAjaxTrace(tabId, trace);
  return trace;
}

async function getState(tabId) {
  if (stateCache.has(tabId))
    return stateCache.get(tabId);
  const key = storageKey(tabId);
  const [localStored, sessionStored] = await Promise.all([
    chrome.storage.local.get(key),
    chrome.storage.session.get(key),
  ]);
  const state = localStored[key] || sessionStored[key] || createEmptyState();
  stateCache.set(tabId, state);
  return state;
}

async function saveState(tabId, state) {
  state.updatedAt = Date.now();
  stateCache.set(tabId, state);
  const stored = { [storageKey(tabId)]: state };
  if (state.battleId)
    stored[LATEST_STATE_KEY] = state;
  await Promise.all([
    chrome.storage.local.set(stored),
    chrome.storage.session.set({ [storageKey(tabId)]: state }),
  ]);
  chrome.runtime.sendMessage({
    type: 'GBF_BATTLE_STATE_UPDATED',
    tabId,
    state,
  }).catch(() => {});
}

function guidebookOptionalNumber(value) {
  if (value === null || value === undefined || value === '')
    return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function describeGuidebookDynamicEffectName(value) {
  const rawName = String(value || '');
  const normalizedName = normalizeGuidebookEffectName(rawName);
  const pattern = /([（(])([＋+\-−]?)(\d+(?:\.\d+)?)([%％]?)([／/])最大([＋+\-−]?)(\d+(?:\.\d+)?)([%％]?)([）)])|([（(])(\d+(?:\.\d+)?)([%％]?)([／/])(\d+(?:\.\d+)?)([%％]?)(回|個|段階|段|枚|ターン|T|Lv|レベル)([）)])|([（(])残り(\d+(?:\.\d+)?)([%％]?)([／/])(\d+(?:\.\d+)?)([%％]?)(回|個|段階|段|枚|ターン|T|Lv|レベル)([）)])/g;
  const matches = [...normalizedName.matchAll(pattern)];
  if (!matches.length) {
    return {
      name: rawName,
      effectTemplate: null,
      effectVariables: [],
      lastObservedVariableValues: {},
      observedName: rawName,
    };
  }
  const initialParts = [];
  const templateParts = [];
  const effectVariables = [];
  const lastObservedVariableValues = {};
  let cursor = 0;
  for (const match of matches) {
    initialParts.push(normalizedName.slice(cursor, match.index));
    templateParts.push(normalizedName.slice(cursor, match.index));
    const key = `value${effectVariables.length + 1}`;
    if (match[1]) {
      const [, open, sign, current, currentUnit, slash,
        maximumSign, maximum, maximumUnit, close] = match;
      initialParts.push(
        `${open}${sign}0${currentUnit}${slash}最大${maximumSign}${maximum}${maximumUnit}${close}`,
      );
      templateParts.push(
        `${open}${sign}{{${key}}}${currentUnit}${slash}最大${maximumSign}${maximum}${maximumUnit}${close}`,
      );
      effectVariables.push({
        key,
        initialValue: 0,
        maximumValue: Number(maximum),
        unit: currentUnit || maximumUnit || '',
        format: 'current-of-maximum',
      });
      lastObservedVariableValues[key] = Number(current);
    }
    else if (match[10]) {
      const open = match[10];
      const current = match[11];
      const currentUnit = match[12];
      const slash = match[13];
      const maximum = match[14];
      const maximumUnit = match[15];
      const countUnit = match[16];
      const close = match[17];
      initialParts.push(`${open}0${currentUnit}${slash}${maximum}${maximumUnit}${countUnit}${close}`);
      templateParts.push(
        `${open}{{${key}}}${currentUnit}${slash}${maximum}${maximumUnit}${countUnit}${close}`,
      );
      effectVariables.push({
        key,
        initialValue: 0,
        maximumValue: Number(maximum),
        unit: currentUnit || maximumUnit || countUnit || '',
        format: 'progress-count',
      });
      lastObservedVariableValues[key] = Number(current);
    }
    else {
      const open = match[18];
      const current = match[19];
      const currentUnit = match[20];
      const slash = match[21];
      const maximum = match[22];
      const maximumUnit = match[23];
      const countUnit = match[24];
      const close = match[25];
      initialParts.push(
        `${open}残り${maximum}${currentUnit}${slash}${maximum}${maximumUnit}${countUnit}${close}`,
      );
      templateParts.push(
        `${open}残り{{${key}}}${currentUnit}${slash}${maximum}${maximumUnit}${countUnit}${close}`,
      );
      effectVariables.push({
        key,
        initialValue: Number(maximum),
        maximumValue: Number(maximum),
        unit: currentUnit || maximumUnit || countUnit || '',
        format: 'remaining-count',
      });
      lastObservedVariableValues[key] = Number(current);
    }
    cursor = match.index + match[0].length;
  }
  initialParts.push(normalizedName.slice(cursor));
  templateParts.push(normalizedName.slice(cursor));
  return {
    name: initialParts.join(''),
    effectTemplate: templateParts.join(''),
    effectVariables,
    lastObservedVariableValues,
    observedName: rawName,
  };
}

function guidebookEffectFromStatus(status, scenario = {}) {
  const rawId = status?.status_id ?? status?.statusId;
  const dynamicName = describeGuidebookDynamicEffectName(status?.name);
  const actionType = guidebookOptionalNumber(scenario?.action_type ?? scenario?.actionType);
  const isImmediateEventReward = actionType === 400;
  const iconCategory = guidebookOptionalNumber(
    status?.icon_category ?? status?.iconCategory,
  );
  const rarity = guidebookOptionalNumber(status?.rarity);
  return {
    id: Number(rawId),
    key: `id:${Number(rawId)}`,
    name: dynamicName.name,
    observedName: dynamicName.observedName,
    ...(dynamicName.effectTemplate ? {
      effectTemplate: dynamicName.effectTemplate,
      effectVariables: dynamicName.effectVariables,
      lastObservedVariableValues: dynamicName.lastObservedVariableValues,
    } : {}),
    sourceTypes: [isImmediateEventReward ? 'event_reward' : 'event_candidate'],
    rarity,
    iconCategory,
    iconType: guidebookOptionalNumber(status?.icon_type ?? status?.iconType),
    isDuplicationPossible: (status?.is_duplication_possible
      ?? status?.isDuplicationPossible) === null
      || (status?.is_duplication_possible ?? status?.isDuplicationPossible) === undefined
      ? null : Boolean(Number(
        status?.is_duplication_possible ?? status?.isDuplicationPossible,
      )),
    deckCondition: guidebookOptionalNumber(status?.deck_condition ?? status?.deckCondition),
    targetType: status?.target_type ?? status?.targetType ?? null,
    targetParam: status?.target_param ?? status?.targetParam ?? null,
    displayAilmentId: status?.display_ailment_id ?? status?.displayAilmentId ?? null,
    spacebookRewardId: guidebookOptionalNumber(
      scenario?.spacebook_reward_id ?? scenario?.spacebookRewardId,
    ),
    isCursed: isImmediateEventReward && (rarity === 99 || iconCategory === 4),
    candidateCount: Number.isFinite(Number(scenario.candidate_num ?? scenario.candidateNum))
      ? Number(scenario.candidate_num ?? scenario.candidateNum) : null,
    selectMin: Number.isFinite(Number(scenario.select_num_min ?? scenario.selectNumMin))
      ? Number(scenario.select_num_min ?? scenario.selectNumMin) : null,
    selectMax: Number.isFinite(Number(scenario.select_num_max ?? scenario.selectNumMax))
      ? Number(scenario.select_num_max ?? scenario.selectNumMax) : null,
  };
}

function looksLikeGuidebookStatus(status) {
  if (!status || typeof status !== 'object' || !String(status?.name || '').trim())
    return false;
  const rawId = status?.status_id ?? status?.statusId;
  if (!Number.isInteger(Number(rawId)) || Number(rawId) < 0)
    return false;
  return [
    status?.rarity,
    status?.icon_category ?? status?.iconCategory,
    status?.icon_type ?? status?.iconType,
    status?.is_duplication_possible ?? status?.isDuplicationPossible,
    status?.deck_condition ?? status?.deckCondition,
  ].filter(item => item !== null && item !== undefined).length >= 2;
}

function guidebookCandidatesFromPayload(payload) {
  if (payload?.kind === 'guidebook_manual_capture') {
    return (Array.isArray(payload.eventCandidates) ? payload.eventCandidates : [])
      .map(status => guidebookEffectFromStatus(status, status))
      .filter(effect => Number.isInteger(effect.id) && effect.id >= 0 && effect.name);
  }
  const url = String(payload?.url || '');
  if (!/\/rest\/arcarum3\//.test(url))
    return [];
  const data = normalizeResponseData(payload.responseData);
  if (!data || typeof data !== 'object')
    return [];
  const effects = [];
  const seen = new WeakSet();
  const visit = (value, depth) => {
    if (!value || typeof value !== 'object' || seen.has(value) || depth > 24)
      return;
    seen.add(value);
    const statuses = value.status_list ?? value.statusList;
    const scenarioActionType = Number(value.action_type ?? value.actionType);
    const explicitGuidebookScenario = scenarioActionType === 400
      || scenarioActionType === 401;
    if (Array.isArray(statuses)
      && (explicitGuidebookScenario || statuses.some(looksLikeGuidebookStatus))) {
      for (const status of statuses) {
        if (explicitGuidebookScenario || looksLikeGuidebookStatus(status))
          effects.push(guidebookEffectFromStatus(status, value));
      }
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === 'object')
        visit(child, depth + 1);
    }
  };
  visit(data, 0);
  return [...new Map(effects
    .filter(effect => Number.isInteger(effect.id) && effect.id >= 0 && effect.name)
    .map(effect => [`${effect.id}:${effect.name}`, effect])).values()];
}

function normalizeGuidebookEffectName(value) {
  return String(value || '').replace(/@@/g, '\n').replace(/\s+/g, ' ').trim();
}

const GUIDEBOOK_EFFECT_VALUE_DEFINITIONS = [
  ['enhance', 'エンハンス', 'percent',
    /自属性スキルエンハンス[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['attack', '攻撃力', 'percent',
    /攻撃力(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['elementAttack', '自属性攻撃', 'percent',
    /自属性攻撃(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['normalSupplemental', '通常与ダメ', 'percent',
    /通常攻撃の与ダメージ(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['multiattack', '連撃率', 'percent',
    /(?:連続攻撃確率|連続攻撃|連撃率)(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['abilityDamage', 'アビダメ', 'percent',
    /(?:アビリティ|アビ)(?:ダメージ|ダメ)(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['abilitySupplemental', 'アビ与ダメ', 'percent',
    /(?:アビリティ|アビ)(?:与ダメージ|与ダメ)(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['abilityCap', 'アビ上限', 'percent',
    /(?:アビリティ|アビ)(?:ダメージ|ダメ)?上限(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['ougiDamage', '奥義ダメ', 'percent',
    /奥義ダメージ(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['ougiSpecialCap', '奥義特殊上限', 'percent',
    /奥義ダメージ特殊上限(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['ougiCap', '奥義上限', 'percent',
    /奥義ダメージ上限(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['ougiSupplemental', '奥義与ダメ', 'percent',
    /奥義与ダメージ(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['ougiGaugeGain', '奥義ゲージ上昇量', 'percent',
    /奥義ゲージ上昇量(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['uplift', '高揚', 'percent',
    /高揚[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['chainDamage', 'CBダメ', 'percent',
    /チェインバーストダメージ(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['chainCap', 'CB上限', 'percent',
    /チェインバーストダメージ上限(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['chainSupplemental', 'CB与ダメ', 'percent',
    /チェイン(?:バースト)?与ダメージ(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['damageCap', 'ダメ上限', 'percent',
    /(?:^|[/／、]\s*)ダメージ上限(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['critical', 'クリ確率', 'percent',
    /クリティカル確率(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['maxHp', '最大HP', 'percent',
    /最大HP(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['defense', '防御力', 'percent',
    /防御力(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['damageReduction', '被ダメ軽減', 'percent',
    /被ダメージ(?:を)?(?:軽減|軽減効果)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['healing', '回復性能', 'percent',
    /回復性能(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['coinGain', 'コイン獲得量', 'percent',
    /セフィラコインの獲得量(?:UP|上昇)[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['miasmaReduction', '瘴気ダメ軽減', 'percent',
    /瘴気ダメージ軽減[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['flatDamageReduction', '被ダメージ減少', 'flat',
    /被ダメージ減少[(（]\s*[+＋]?([\d,.]+)\s*[)）]/i],
  ['regeneration', '再生', 'flat',
    /再生[(（]\s*[+＋]?([\d,.]+)\s*回復[)）]/i],
  ['summonCount', '1ターン中の召喚可能回数', 'times',
    /1ターン中の召喚可能回数(?:増加)?[(（]\s*[+＋]?([\d,.]+)\s*回[)）]/i],
  ['normalHitCount', '通常攻撃のヒット数', 'times',
    /通常攻撃のヒット数増加[(（]\s*[+＋]?([\d,.]+)(?:\s*\/[^)）]+)?[)）]/i],
];

const GUIDEBOOK_EFFECT_FLAG_DEFINITIONS = [
  ['keenEye', '慧眼効果', /敵の属性に関わらず弱点をつく/],
  ['allWeaponTypes', '全武器種化', /得意武器に全ての武器種を追加する/],
  ['allRaces', '全種族化', /種族に全ての種族を追加する/],
  ['elementConversion', '自属性変転', /被ダメージを有利属性に変換する/],
];

const GUIDEBOOK_CHASE_DEFINITIONS = [
  ['elementOugiChase', '自属性奥義追撃', /自属性奥義追撃効果[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['elementAbilityChase', '自属性アビ追撃', /自属性冴手効果[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['elementChase', '自属性追撃', /自属性追撃効果[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['weaknessOugiChase', '弱点属性奥義追撃', /弱点属性奥義追撃効果[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
  ['weaknessChase', '弱点属性追撃', /弱点属性追撃効果[(（]\s*[+＋]?([\d,.]+)\s*[%％]/i],
];

function guidebookRarity(effect) {
  const stored = Number(effect?.rarity);
  if (Number.isFinite(stored) && stored > 0)
    return stored;
  const shopGrade = Number(effect?.shopBookGrade);
  return Number.isFinite(shopGrade) && shopGrade > 0 ? shopGrade : null;
}

function guidebookNumericValue(match) {
  if (!match)
    return null;
  const value = Number(String(match[1] || '').replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function guidebookChaseConditionPrefix(name) {
  if (/族/.test(name))
    return '種族';
  if (/得意武器/.test(name))
    return '得意武器';
  if (/最大HP/.test(name))
    return 'HP条件';
  if (/地帯/.test(name))
    return '地帯';
  if (/攻撃行動/.test(name))
    return '攻撃回数条件';
  return '';
}

function parseGuidebookEffectValues(effect) {
  if (!guidebookRarity(effect) || effect?.isCursed)
    return [];
  const name = normalizeGuidebookEffectName(effect?.name);
  if (!name)
    return [];
  const stats = GUIDEBOOK_EFFECT_VALUE_DEFINITIONS.flatMap(([
    key, label, unit, pattern,
  ]) => {
    if ((key === 'damageReduction' || key === 'flatDamageReduction')
      && /変化/.test(name))
      return [];
    const value = guidebookNumericValue(name.match(pattern));
    return value !== null ? [{
      key,
      label,
      unit,
      value,
    }] : [];
  });
  const chasePrefix = guidebookChaseConditionPrefix(name);
  for (const [key, label, pattern] of GUIDEBOOK_CHASE_DEFINITIONS) {
    const value = guidebookNumericValue(name.match(pattern));
    if (value === null)
      continue;
    stats.push({
      key,
      label: `${chasePrefix}${label}`,
      unit: 'percent',
      value,
      slotKey: `id:${guidebookEffectHasId(effect) ? Number(effect.id) : guidebookEffectStorageKey(effect)}`,
    });
  }
  if (/^渾身(?:$|[（(])/.test(name))
    stats.push({ key: 'staminaBooks', label: '渾身', unit: 'book', value: 1 });
  if (/^背水(?:$|[（(])/.test(name))
    stats.push({ key: 'enmityBooks', label: '背水', unit: 'book', value: 1 });
  for (const [key, label, pattern] of GUIDEBOOK_EFFECT_FLAG_DEFINITIONS) {
    if (pattern.test(name))
      stats.push({ key, label, unit: 'flag', value: 1 });
  }
  if (Number(effect?.id) === 62
    || /命中しないことがあるが、攻撃力UP\(100%\).*ダメージ上限UP\(50%\)/.test(name)) {
    stats.push({
      key: 'accuracy',
      label: '命中率',
      unit: 'percent',
      value: -25,
    });
  }
  return stats;
}

function parseGuidebookR1StatValues(effect) {
  return guidebookRarity(effect) === 1 ? parseGuidebookEffectValues(effect) : [];
}

function guidebookOwnedCount(effect) {
  const hasConfirmationCount = (effect?.sourceTypes || []).includes('effect_confirmation')
    && effect?.count !== null && effect?.count !== undefined && effect?.count !== '';
  const confirmationCount = hasConfirmationCount ? Number(effect.count) : NaN;
  const observedCount = Number.isFinite(confirmationCount) && confirmationCount >= 0
    ? confirmationCount : 0;
  const duplicationForbidden = effect?.isDuplicationPossible === false
    || /重複不可/.test(normalizeGuidebookEffectName(effect?.name));
  return duplicationForbidden ? Math.min(1, observedCount) : observedCount;
}

function buildGuidebookEffectValueRecords(effects) {
  return (effects || []).flatMap((effect) => {
    const stats = parseGuidebookEffectValues(effect);
    if (!stats.length)
      return [];
    const ownedCount = guidebookOwnedCount(effect);
    const ownedCountKnown = (effect?.sourceTypes || []).includes('effect_confirmation')
      && effect?.count !== null && effect?.count !== undefined && effect?.count !== ''
      && Number.isFinite(Number(effect.count)) && Number(effect.count) >= 0;
    return [{
      id: guidebookEffectHasId(effect) ? Number(effect.id) : null,
      key: guidebookEffectStorageKey(effect),
      rarity: guidebookRarity(effect),
      name: normalizeGuidebookEffectName(effect.name),
      isDuplicationPossible: effect?.isDuplicationPossible ?? null,
      ownedCount,
      ownedCountKnown,
      stats: stats.map(stat => ({
        ...stat,
        totalValue: stat.value * ownedCount,
      })),
      updatedAt: effect.lastSeenAt || effect.lastAcquiredAt || null,
    }];
  }).sort((a, b) => {
    if (a.id !== null && b.id !== null)
      return a.id - b.id;
    if (a.id !== null)
      return -1;
    if (b.id !== null)
      return 1;
    return a.name.localeCompare(b.name, 'ja');
  });
}

async function saveGuidebookEffectsAndValues(effects) {
  const effectValues = buildGuidebookEffectValueRecords(effects);
  await chrome.storage.local.set({
    [GUIDEBOOK_EFFECTS_KEY]: effects,
    [GUIDEBOOK_EFFECT_VALUES_KEY]: effectValues,
  });
  return effectValues;
}

async function resetGuidebookCurrentOwnership(reason = 'new-sortie') {
  return enqueueGuidebookEffectsUpdate(async (effects) => {
    const resetAt = new Date().toISOString();
    let changed = false;
    const next = effects.map(effect => {
      const hasCurrentOwnership = (effect?.sourceTypes || []).includes('effect_confirmation')
        || (effect?.count !== null && effect?.count !== undefined && effect?.count !== '');
      if (!hasCurrentOwnership || Number(effect.count) === 0)
        return effect;
      changed = true;
      return {
        ...effect,
        count: 0,
        currentOwnershipResetAt: resetAt,
        currentOwnershipResetReason: reason,
      };
    });
    if (!changed)
      return effects;
    const sorted = sortGuidebookEffects(next);
    const effectValues = await saveGuidebookEffectsAndValues(sorted);
    chrome.runtime.sendMessage({
      type: 'GBF_GUIDEBOOK_EFFECTS_UPDATED',
      effects: guidebookEffectsWithIdPlaceholders(sorted),
      effectValues,
      ownershipReset: true,
    }).catch(() => {});
    return sorted;
  });
}

function isGuidebookInstructionText(value) {
  const identity = normalizeGuidebookEffectName(value)
    .replace(/<br\s*\/?\s*>/gi, '')
    .replace(/\s+/g, '');
  return /^探索画面に戻ることで.*導本効果を獲得できます[。.．]?$/.test(identity);
}

function guidebookEffectIdentityName(value) {
  return normalizeGuidebookEffectName(describeGuidebookDynamicEffectName(value).name)
    .replace(/<br\s*\/?\s*>/gi, '')
    .replace(/\s+/g, '');
}

function guidebookTextFromValue(value, depth = 0, seen = new WeakSet()) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text || text === '[object Object]'
      || /^(?:https?:|\/?assets\/|sephirabook_|book_effect_)/i.test(text))
      return '';
    return text;
  }
  if (!value || typeof value !== 'object' || depth > 8 || seen.has(value))
    return '';
  seen.add(value);
  const priorityKeys = [
    'text', 'name', 'comment', 'effectName', 'effect_name',
    'description', 'detail', 'message', 'value', 'label', 'ja',
  ];
  for (const key of priorityKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key))
      continue;
    const text = guidebookTextFromValue(value[key], depth + 1, seen);
    if (text)
      return text;
  }
  for (const child of Object.values(value)) {
    const text = guidebookTextFromValue(child, depth + 1, seen);
    if (text)
      return text;
  }
  return '';
}

function guidebookRewardsFromPayload(payload) {
  if (!['guidebook_rewards', 'guidebook_manual_capture', 'guidebook_page_capture']
    .includes(payload?.kind)
    || !Array.isArray(payload.rewards))
    return [];
  return payload.rewards
    .filter((reward) => {
      const assetText = `${String(reward?.image || '')} ${String(
        reward?.bookEffetIcon || reward?.bookEffectIcon || '',
      )}`;
      return Number(reward?.rewardType ?? reward?.reward_type) === 4
        || /(?:sephirabook|book_effect)/i.test(assetText);
    })
    .flatMap((reward) => {
      const detailEntries = Array.isArray(reward?.detail)
        ? reward.detail.filter(detail => detail && typeof detail === 'object')
        : (reward?.detail && typeof reward.detail === 'object' ? [reward.detail] : []);
      const variants = detailEntries.length ? detailEntries : [null];
      return variants.map((detail) => {
        const fields = [
          detail?.name,
          detail?.comment,
          reward?.comment,
          reward?.name,
          reward?.effectName,
          reward?.effect_name,
          reward?.description,
          reward?.detail,
          reward?.text,
        ];
        const name = fields.map(value => guidebookTextFromValue(value)).find(Boolean) || '';
        const dynamicName = describeGuidebookDynamicEffectName(name);
        const normalizedName = normalizeGuidebookEffectName(dynamicName.name);
        const rawId = detail?.status_id ?? detail?.statusId
          ?? reward?.status_id ?? reward?.statusId;
        const id = Number(rawId);
        const hasId = Number.isInteger(id) && id >= 0;
        const rawIconType = detail?.icon_type ?? detail?.iconType
          ?? reward?.icon_type ?? reward?.iconType;
        const iconType = Number(rawIconType);
        return {
          id: hasId ? id : null,
          key: hasId ? `id:${id}` : (normalizedName ? `name:${normalizedName}` : ''),
          name: dynamicName.name,
          observedName: dynamicName.observedName,
          ...(dynamicName.effectTemplate ? {
            effectTemplate: dynamicName.effectTemplate,
            effectVariables: dynamicName.effectVariables,
            lastObservedVariableValues: dynamicName.lastObservedVariableValues,
          } : {}),
          rewardType: 4,
          image: String(reward?.image || ''),
          bookEffectIcon: String(reward?.bookEffetIcon || reward?.bookEffectIcon || ''),
          ...(Number.isInteger(iconType) ? { iconType } : {}),
          canShowDetail: Boolean(reward?.canShowDetail),
          sourceTypes: ['battle_reward'],
        };
      });
    })
    .filter(effect => effect.key && effect.name && !isGuidebookInstructionText(effect.name));
}

function guidebookViewEffectsFromPayload(payload) {
  if (!['guidebook_manual_capture', 'guidebook_page_capture'].includes(payload?.kind)
    || !Array.isArray(payload.viewEffects))
    return [];
  return payload.viewEffects.map((status) => {
    const rawId = status?.status_id ?? status?.statusId;
    const id = Number(rawId);
    const observedName = String(status?.name || status?.comment || '').trim();
    const dynamicName = describeGuidebookDynamicEffectName(observedName);
    const name = dynamicName.name;
    const normalizedName = normalizeGuidebookEffectName(name);
    const sourceType = status?.source_type === 'shop_page'
      ? 'shop_page' : 'effect_confirmation';
    return {
      id: Number.isInteger(id) && id >= 0 ? id : null,
      key: Number.isInteger(id) && id >= 0
        ? `id:${id}` : (normalizedName ? `name:${normalizedName}` : ''),
      name,
      observedName: dynamicName.observedName,
      ...(dynamicName.effectTemplate ? {
        effectTemplate: dynamicName.effectTemplate,
        effectVariables: dynamicName.effectVariables,
        lastObservedVariableValues: dynamicName.lastObservedVariableValues,
      } : {}),
      sourceTypes: [sourceType],
      rarity: guidebookOptionalNumber(status?.rarity),
      iconCategory: guidebookOptionalNumber(status?.icon_category),
      iconType: guidebookOptionalNumber(status?.icon_type),
      isDuplicationPossible: status?.is_duplication_possible === null
        || status?.is_duplication_possible === undefined
        ? null : Boolean(Number(status.is_duplication_possible)),
      deckCondition: guidebookOptionalNumber(status?.deck_condition),
      targetType: status?.target_type ?? null,
      targetParam: status?.target_param ?? null,
      displayAilmentId: status?.display_ailment_id ?? null,
      image: String(status?.image || ''),
      bookEffectIcon: String(status?.bookEffetIcon || status?.bookEffectIcon || ''),
      count: guidebookOptionalNumber(status?.count),
      shopPrice: guidebookOptionalNumber(status?.shop_price),
      shopSoldOut: status?.shop_sold_out === null
        || status?.shop_sold_out === undefined
        ? null : Boolean(status.shop_sold_out),
      shopBookGrade: guidebookOptionalNumber(status?.shop_book_grade),
      shopBasePrice: guidebookOptionalNumber(status?.shop_base_price),
      shopDiscounted: status?.shop_discounted === null
        || status?.shop_discounted === undefined
        ? null : Boolean(status.shop_discounted),
      shopPremium: status?.shop_premium === null
        || status?.shop_premium === undefined
        ? null : Boolean(status.shop_premium),
      bookCategory: status?.book_category ? String(status.book_category) : null,
      isCursed: Boolean(status?.is_cursed),
      captureContexts: status?.capture_context ? [String(status.capture_context)] : [],
    };
  }).filter(effect => effect.key && effect.name && !isGuidebookInstructionText(effect.name));
}

function guidebookEffectStorageKey(effect) {
  if (isGuidebookInstructionText(effect?.name))
    return '';
  const id = effect?.id;
  if (id !== null && id !== undefined && id !== '' && Number.isInteger(Number(id)))
    return `id:${Number(id)}`;
  const name = guidebookEffectIdentityName(effect?.name);
  return name ? `name:${name}` : String(effect?.key || '');
}

function reconcileGuidebookEffectDuplicates(effects) {
  const groups = new Map();
  for (const effect of effects || []) {
    const identity = guidebookEffectIdentityName(effect?.name);
    if (!identity)
      continue;
    const group = groups.get(identity) || [];
    group.push(effect);
    groups.set(identity, group);
  }
  const merged = [];
  for (const group of groups.values()) {
    const idRecords = group.filter(effect => (
      effect?.id !== null && effect?.id !== undefined && effect?.id !== ''
      && Number.isInteger(Number(effect.id))
    ));
    const distinctIds = [...new Set(idRecords.map(effect => Number(effect.id)))];
    if (group.length === 1 || distinctIds.length > 1) {
      merged.push(...group);
      continue;
    }
    const primary = idRecords[0] || group[0];
    const ordered = [primary, ...group.filter(effect => effect !== primary)];
    const latestCandidate = [...ordered]
      .filter(effect => effect.lastCandidateSeenAt)
      .sort((a, b) => String(b.lastCandidateSeenAt)
        .localeCompare(String(a.lastCandidateSeenAt)))[0];
    const latestAcquisition = [...ordered]
      .filter(effect => effect.lastAcquiredAt)
      .sort((a, b) => String(b.lastAcquiredAt)
        .localeCompare(String(a.lastAcquiredAt)))[0];
    const latestDynamicObservation = [...ordered]
      .filter(effect => effect.lastObservedVariableValues)
      .sort((a, b) => String(b.lastSeenAt || '')
        .localeCompare(String(a.lastSeenAt || '')))[0];
    const primaryValues = Object.fromEntries(Object.entries(primary).filter(([, value]) => (
      value !== null && value !== undefined && value !== ''
    )));
    const reconciled = {
      ...ordered.slice(1).reverse().reduce((result, effect) => ({
        ...result,
        ...Object.fromEntries(Object.entries(effect).filter(([, value]) => (
          value !== null && value !== undefined && value !== ''
        ))),
      }), {}),
      ...primaryValues,
      id: distinctIds.length === 1 ? distinctIds[0] : (primary.id ?? null),
      name: primary.name || ordered.find(effect => effect.name)?.name || '',
      sourceTypes: [...new Set(ordered.flatMap(
        effect => Array.isArray(effect.sourceTypes) ? effect.sourceTypes : [],
      ))],
      captureContexts: [...new Set(ordered.flatMap(
        effect => Array.isArray(effect.captureContexts) ? effect.captureContexts : [],
      ))],
      observedNames: [...new Set(ordered.flatMap(effect => [
        ...(Array.isArray(effect.observedNames) ? effect.observedNames : []),
        ...(effect.effectTemplate ? [] : [effect.name]),
      ]).filter(Boolean))],
      observedShopPrices: [...new Set(ordered.flatMap(
        effect => Array.isArray(effect.observedShopPrices)
          ? effect.observedShopPrices : [],
      ).map(Number).filter(Number.isFinite))],
      firstSeenAt: [...ordered].map(effect => effect.firstSeenAt)
        .filter(Boolean).sort()[0] || null,
      lastSeenAt: [...ordered].map(effect => effect.lastSeenAt)
        .filter(Boolean).sort().at(-1) || null,
      observationCount: ordered.reduce(
        (total, effect) => total + Math.max(0, Number(effect.observationCount) || 0), 0,
      ),
      acquisitionCount: Math.max(...ordered.map(
        effect => Math.max(0, Number(effect.acquisitionCount) || 0),
      )),
      ...(latestCandidate ? {
        lastCandidateBatchId: latestCandidate.lastCandidateBatchId,
        lastCandidateSeenAt: latestCandidate.lastCandidateSeenAt,
      } : {}),
      ...(latestAcquisition ? {
        lastAcquisitionBatchId: latestAcquisition.lastAcquisitionBatchId,
        lastAcquiredAt: latestAcquisition.lastAcquiredAt,
        lastAcquisitionSource: latestAcquisition.lastAcquisitionSource,
      } : {}),
      ...(latestDynamicObservation ? {
        effectTemplate: latestDynamicObservation.effectTemplate,
        effectVariables: latestDynamicObservation.effectVariables,
        lastObservedVariableValues: latestDynamicObservation.lastObservedVariableValues,
      } : {}),
    };
    reconciled.key = guidebookEffectStorageKey(reconciled);
    merged.push(reconciled);
  }
  return sortGuidebookEffects(merged);
}

function compareGuidebookEffects(a, b) {
  const aHasId = a?.id !== null && a?.id !== undefined && Number.isInteger(Number(a.id));
  const bHasId = b?.id !== null && b?.id !== undefined && Number.isInteger(Number(b.id));
  if (aHasId !== bHasId)
    return aHasId ? -1 : 1;
  if (aHasId)
    return Number(a.id) - Number(b.id);
  return normalizeGuidebookEffectName(a?.name)
    .localeCompare(normalizeGuidebookEffectName(b?.name), 'ja');
}

function sortGuidebookEffects(effects) {
  return effects.sort(compareGuidebookEffects);
}

function guidebookEffectsWithIdPlaceholders(effects, maximumId = 100) {
  const byId = new Map((effects || [])
    .filter(effect => Number.isInteger(Number(effect?.id)))
    .map(effect => [Number(effect.id), effect]));
  const placeholders = Array.from({ length: maximumId }, (_, index) => {
    const id = index + 1;
    return byId.get(id) || {
      id,
      key: `id:${id}`,
      name: '',
      isPlaceholder: true,
      sourceTypes: [],
    };
  });
  const knownAboveRange = (effects || []).filter(effect => (
    Number.isInteger(Number(effect?.id)) && Number(effect.id) > maximumId
  ));
  const unknownId = (effects || []).filter(effect => (
    effect?.id === null || effect?.id === undefined
      || !Number.isInteger(Number(effect.id))
  ));
  return sortGuidebookEffects([...placeholders, ...knownAboveRange, ...unknownId]);
}

function guidebookAcquisitionRequest(payload) {
  if (payload?.kind !== 'ajax')
    return { ids: [], source: null };
  const url = String(payload?.url || '').toLowerCase();
  const isEventAcquisition = /spacebook_status_add|book_status_add/.test(url);
  const isShopAcquisition = /dungeon_shop/.test(url)
    && /(?:buy|purchase|exchange|status_add)/.test(url);
  if (!isEventAcquisition && !isShopAcquisition)
    return { ids: [], source: null };
  let request = payload?.requestData;
  if (typeof request === 'string') {
    try {
      request = JSON.parse(request);
    }
    catch {
      request = {};
    }
  }
  if (!request || typeof request !== 'object')
    request = {};
  const values = request.status_ids ?? request.statusIds
    ?? request.book_effect_ids ?? request.bookEffectIds
    ?? request.status_id ?? request.statusId
    ?? request.book_effect_id ?? request.bookEffectId;
  const ids = (Array.isArray(values) ? values : [values])
    .map(Number)
    .filter(id => Number.isInteger(id) && id >= 0);
  return {
    ids: [...new Set(ids)],
    source: isShopAcquisition ? 'shop_purchase' : 'event_reward',
  };
}

function normalizeStoredGuidebookEffect(effect) {
  if (!effect || typeof effect !== 'object'
    || !guidebookEffectStorageKey(effect)
    || normalizeGuidebookEffectName(effect?.name) === '[object Object]')
    return null;
  const { description, editedAt, ...current } = effect;
  const dynamicName = describeGuidebookDynamicEffectName(current.name);
  const storedNameIsCanonical = normalizeGuidebookEffectName(current.name)
    === normalizeGuidebookEffectName(dynamicName.name);
  const idNumber = guidebookOptionalNumber(current.id);
  const normalized = {
    ...current,
    id: Number.isInteger(idNumber) && idNumber >= 0 ? idNumber : null,
    name: dynamicName.name,
    ...(dynamicName.effectTemplate ? {
      effectTemplate: dynamicName.effectTemplate,
      effectVariables: dynamicName.effectVariables,
      lastObservedVariableValues: storedNameIsCanonical
        ? {
          ...dynamicName.lastObservedVariableValues,
          ...(current.lastObservedVariableValues || {}),
        }
        : {
          ...(current.lastObservedVariableValues || {}),
          ...dynamicName.lastObservedVariableValues,
        },
    } : {}),
    observedNames: [...new Set([
      ...(Array.isArray(current.observedNames) ? current.observedNames : []),
      ...(storedNameIsCanonical && dynamicName.effectTemplate
        ? [] : [dynamicName.observedName]),
    ].filter(name => (
      normalizeGuidebookEffectName(name) !== '[object Object]'
    )))],
  };
  normalized.key = guidebookEffectStorageKey(normalized);
  return normalized.key ? normalized : null;
}

function isMeaningfulGuidebookImportRecord(effect) {
  return Boolean(normalizeGuidebookEffectName(effect?.name))
    || Math.max(0, Number(effect?.acquisitionCount) || 0) > 0
    || Boolean(effect?.lastAcquiredAt)
    || (Array.isArray(effect?.sourceTypes) && effect.sourceTypes.length > 0);
}

function guidebookEffectHasId(effect) {
  return effect?.id !== null && effect?.id !== undefined && effect?.id !== ''
    && Number.isInteger(Number(effect.id)) && Number(effect.id) >= 0;
}

function mergeImportedGuidebookEffect(previous, incoming) {
  const latestRecord = String(incoming.lastSeenAt || '') >= String(previous.lastSeenAt || '')
    ? incoming : previous;
  const merged = {
    ...previous,
    ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => (
      value !== null && value !== undefined && value !== ''
    ))),
    id: guidebookEffectHasId(incoming)
      ? Number(incoming.id)
      : (guidebookEffectHasId(previous) ? Number(previous.id) : null),
    name: (guidebookEffectHasId(incoming) && !guidebookEffectHasId(previous) && incoming.name)
      ? incoming.name : (previous.name || incoming.name || ''),
    isPlaceholder: false,
    sourceTypes: [...new Set([
      ...(Array.isArray(previous.sourceTypes) ? previous.sourceTypes : []),
      ...(Array.isArray(incoming.sourceTypes) ? incoming.sourceTypes : []),
    ])],
    captureContexts: [...new Set([
      ...(Array.isArray(previous.captureContexts) ? previous.captureContexts : []),
      ...(Array.isArray(incoming.captureContexts) ? incoming.captureContexts : []),
    ])],
    observedNames: [...new Set([
      ...(Array.isArray(previous.observedNames) ? previous.observedNames : []),
      ...(Array.isArray(incoming.observedNames) ? incoming.observedNames : []),
    ])],
    observedShopPrices: [...new Set([
      ...(Array.isArray(previous.observedShopPrices) ? previous.observedShopPrices : []),
      ...(Array.isArray(incoming.observedShopPrices) ? incoming.observedShopPrices : []),
    ].map(Number).filter(Number.isFinite))],
    observationCount: Math.max(
      Math.max(0, Number(previous.observationCount) || 0),
      Math.max(0, Number(incoming.observationCount) || 0),
    ),
    acquisitionCount: Math.max(
      Math.max(0, Number(previous.acquisitionCount) || 0),
      Math.max(0, Number(incoming.acquisitionCount) || 0),
    ),
    firstSeenAt: [previous.firstSeenAt, incoming.firstSeenAt]
      .filter(Boolean).sort()[0] || null,
    lastSeenAt: [previous.lastSeenAt, incoming.lastSeenAt]
      .filter(Boolean).sort().at(-1) || null,
    ...(latestRecord.effectTemplate ? {
      effectTemplate: latestRecord.effectTemplate,
      effectVariables: latestRecord.effectVariables,
      lastObservedVariableValues: latestRecord.lastObservedVariableValues,
    } : {}),
  };
  for (const field of [
    'rarity', 'iconCategory', 'iconType', 'isDuplicationPossible', 'deckCondition',
    'targetType', 'targetParam', 'displayAilmentId', 'image', 'bookEffectIcon',
    'bookCategory', 'isCursed', 'count', 'shopPrice', 'shopSoldOut',
    'shopBookGrade', 'shopBasePrice', 'shopDiscounted', 'shopPremium',
  ]) {
    const localValue = previous[field];
    if (localValue !== null && localValue !== undefined && localValue !== '')
      merged[field] = localValue;
  }
  for (const prefix of ['Candidate', 'Acquisition']) {
    const timeField = prefix === 'Candidate' ? 'lastCandidateSeenAt' : 'lastAcquiredAt';
    const latest = [previous, incoming]
      .filter(item => item?.[timeField])
      .sort((a, b) => String(b[timeField]).localeCompare(String(a[timeField])))[0];
    if (!latest)
      continue;
    for (const [key, value] of Object.entries(latest)) {
      if (key.startsWith(`last${prefix}`) || key === timeField)
        merged[key] = value;
    }
  }
  merged.key = guidebookEffectStorageKey(merged);
  return merged;
}

async function importGuidebookEffectsData(payload) {
  if (payload?.schema !== 'gbf-guidebook-effects-v1' || !Array.isArray(payload?.effects))
    throw new Error('対応していない導本JSONです');
  if (payload.effects.length > 10000)
    throw new Error('導本JSONの件数が多すぎます');
  return enqueueGuidebookEffectsUpdate(async (effects) => {
    const byKey = new Map(effects.map(effect => [guidebookEffectStorageKey(effect), effect]));
    let added = 0;
    let mergedCount = 0;
    let skipped = 0;
    for (const rawEffect of payload.effects) {
      if (!isMeaningfulGuidebookImportRecord(rawEffect)) {
        skipped += 1;
        continue;
      }
      const incoming = normalizeStoredGuidebookEffect(rawEffect);
      if (!incoming) {
        skipped += 1;
        continue;
      }
      const naturalKey = guidebookEffectStorageKey(incoming);
      const identity = guidebookEffectIdentityName(incoming.name);
      const matchingEntries = [...byKey.entries()].filter(([, effect]) => (
        identity && guidebookEffectIdentityName(effect.name) === identity
      ));
      const incomingHasId = guidebookEffectHasId(incoming);
      const matchingEntry = matchingEntries.find(([, effect]) => (
        !incomingHasId
        || !guidebookEffectHasId(effect)
        || Number(effect.id) === Number(incoming.id)
      ));
      const matchedKey = byKey.has(naturalKey) ? naturalKey : matchingEntry?.[0];
      const previous = matchedKey ? byKey.get(matchedKey) : null;
      const targetKey = incomingHasId ? naturalKey : (matchedKey || naturalKey);
      if (matchedKey && matchedKey !== targetKey)
        byKey.delete(matchedKey);
      if (previous) {
        byKey.set(targetKey, mergeImportedGuidebookEffect(previous, incoming));
        mergedCount += 1;
      }
      else {
        byKey.set(targetKey, { ...incoming, key: targetKey, isPlaceholder: false });
        added += 1;
      }
    }
    const next = sortGuidebookEffects([...byKey.values()]);
    const effectValues = await saveGuidebookEffectsAndValues(next);
    const displayed = guidebookEffectsWithIdPlaceholders(next);
    chrome.runtime.sendMessage({
      type: 'GBF_GUIDEBOOK_EFFECTS_UPDATED',
      effects: displayed,
      effectValues,
    }).catch(() => {});
    return {
      effects: displayed,
      effectValues,
      added,
      merged: mergedCount,
      skipped,
      stored: next.length,
    };
  });
}

async function readGuidebookEffects() {
  const stored = await chrome.storage.local.get([
    GUIDEBOOK_EFFECTS_KEY,
    GUIDEBOOK_EFFECT_VALUES_KEY,
  ]);
  const effects = Array.isArray(stored?.[GUIDEBOOK_EFFECTS_KEY])
    ? stored[GUIDEBOOK_EFFECTS_KEY]
    : [];
  const normalizedEffects = reconcileGuidebookEffectDuplicates(
    effects.map(normalizeStoredGuidebookEffect).filter(Boolean),
  );
  const effectValues = buildGuidebookEffectValueRecords(normalizedEffects);
  if (JSON.stringify(normalizedEffects) !== JSON.stringify(effects)
    || JSON.stringify(effectValues) !== JSON.stringify(
      stored?.[GUIDEBOOK_EFFECT_VALUES_KEY] || [],
    ))
    await saveGuidebookEffectsAndValues(normalizedEffects);
  return normalizedEffects.sort(compareGuidebookEffects);
}

function enqueueGuidebookEffectsUpdate(update) {
  const run = async () => update(await readGuidebookEffects());
  guidebookEffectsQueue = guidebookEffectsQueue.then(run, run);
  return guidebookEffectsQueue;
}

async function recordGuidebookCandidates(payload) {
  const eventCandidates = guidebookCandidatesFromPayload(payload);
  const rewardCandidates = guidebookRewardsFromPayload(payload);
  const viewCandidates = guidebookViewEffectsFromPayload(payload);
  const candidates = [...eventCandidates, ...viewCandidates, ...rewardCandidates];
  const acquisitionRequest = guidebookAcquisitionRequest(payload);
  if (!candidates.length && !acquisitionRequest.ids.length)
    return false;
  await enqueueGuidebookEffectsUpdate(async (effects) => {
    const byKey = new Map(effects.map(effect => [guidebookEffectStorageKey(effect), effect]));
    const observedAt = new Date().toISOString();
    const captureBatchId = `${observedAt}:captured:${String(
      guidebookCandidateBatchSequence += 1,
    ).padStart(8, '0')}`;
    const capturedKeys = new Set();
    const displayedEventCandidates = eventCandidates.filter(
      effect => effect.sourceTypes?.includes('event_candidate'),
    );
    const candidateBatchId = displayedEventCandidates.length
      ? `${observedAt}:${String(guidebookCandidateBatchSequence += 1).padStart(8, '0')}`
      : null;
    let acquisitionBatchId = null;
    const markAcquired = (entry, source) => {
      acquisitionBatchId ||= `${observedAt}:acquired:${String(
        guidebookCandidateBatchSequence += 1,
      ).padStart(8, '0')}`;
      return {
        ...entry,
        lastAcquisitionBatchId: acquisitionBatchId,
        lastAcquiredAt: observedAt,
        lastAcquisitionSource: source,
        acquisitionCount: Math.max(0, Number(entry?.acquisitionCount) || 0) + 1,
      };
    };
    for (const candidate of candidates) {
      const naturalKey = guidebookEffectStorageKey(candidate);
      const normalizedCandidateName = guidebookEffectIdentityName(candidate.name);
      const matchingEntry = [...byKey.entries()].find(([, effect]) => (
        guidebookEffectIdentityName(effect?.name) === normalizedCandidateName
        || (effect?.observedNames || []).some(name => (
          guidebookEffectIdentityName(name) === normalizedCandidateName
        ))
      ));
      const matchedKey = byKey.has(naturalKey) ? naturalKey : matchingEntry?.[0];
      const previous = matchedKey ? byKey.get(matchedKey) : null;
      const targetKey = candidate.id !== null && candidate.id !== undefined
        ? naturalKey
        : (matchedKey || naturalKey);
      if (matchedKey && matchedKey !== targetKey)
        byKey.delete(matchedKey);
      const observedNames = [...new Set([
        ...(Array.isArray(previous?.observedNames) ? previous.observedNames : []),
        previous?.effectTemplate ? null : previous?.name,
        candidate.observedName || candidate.name,
      ].map(name => String(name || '')).filter(Boolean))];
      const metadataFields = [
        'rarity',
        'iconCategory',
        'iconType',
        'isDuplicationPossible',
        'deckCondition',
        'targetType',
        'targetParam',
        'displayAilmentId',
        'image',
        'bookEffectIcon',
        'bookCategory',
        'isCursed',
        'spacebookRewardId',
      ];
      const mergedMetadata = Object.fromEntries(metadataFields.map((field) => {
        const incoming = candidate[field];
        const hasIncoming = incoming !== null && incoming !== undefined && incoming !== '';
        return [field, hasIncoming ? incoming : (previous?.[field] ?? null)];
      }));
      let nextEntry = {
        ...(previous || {}),
        ...candidate,
        ...mergedMetadata,
        isPlaceholder: false,
        id: candidate.id ?? previous?.id ?? null,
        key: targetKey,
        sourceTypes: [...new Set([
          ...(Array.isArray(previous?.sourceTypes) ? previous.sourceTypes : []),
          ...(Array.isArray(candidate.sourceTypes) ? candidate.sourceTypes : []),
        ])],
        ...((Array.isArray(previous?.captureContexts) && previous.captureContexts.length)
          || (Array.isArray(candidate.captureContexts) && candidate.captureContexts.length) ? {
            captureContexts: [...new Set([
              ...(Array.isArray(previous?.captureContexts) ? previous.captureContexts : []),
              ...(Array.isArray(candidate.captureContexts) ? candidate.captureContexts : []),
            ])],
          } : {}),
        ...((candidate.count !== null && candidate.count !== undefined)
          || (previous?.count !== null && previous?.count !== undefined) ? {
            count: candidate.count ?? previous?.count,
          } : {}),
        ...((candidate.shopPrice !== null && candidate.shopPrice !== undefined)
          || (previous?.shopPrice !== null && previous?.shopPrice !== undefined) ? {
            shopPrice: candidate.shopPrice ?? previous?.shopPrice,
          } : {}),
        ...((candidate.shopSoldOut !== null && candidate.shopSoldOut !== undefined)
          || (previous?.shopSoldOut !== null && previous?.shopSoldOut !== undefined) ? {
            shopSoldOut: candidate.shopSoldOut ?? previous?.shopSoldOut,
          } : {}),
        ...((candidate.shopBookGrade !== null && candidate.shopBookGrade !== undefined)
          || (previous?.shopBookGrade !== null && previous?.shopBookGrade !== undefined) ? {
            shopBookGrade: candidate.shopBookGrade ?? previous?.shopBookGrade,
          } : {}),
        ...((candidate.shopBasePrice !== null && candidate.shopBasePrice !== undefined)
          || (previous?.shopBasePrice !== null && previous?.shopBasePrice !== undefined) ? {
            shopBasePrice: candidate.shopBasePrice ?? previous?.shopBasePrice,
          } : {}),
        ...((candidate.shopDiscounted !== null && candidate.shopDiscounted !== undefined)
          || (previous?.shopDiscounted !== null && previous?.shopDiscounted !== undefined) ? {
            shopDiscounted: candidate.shopDiscounted ?? previous?.shopDiscounted,
          } : {}),
        ...((candidate.shopPremium !== null && candidate.shopPremium !== undefined)
          || (previous?.shopPremium !== null && previous?.shopPremium !== undefined) ? {
            shopPremium: candidate.shopPremium ?? previous?.shopPremium,
          } : {}),
        observedShopPrices: [...new Set([
          ...(Array.isArray(previous?.observedShopPrices)
            ? previous.observedShopPrices : []),
          candidate.shopPrice,
        ].filter(value => value !== null && value !== undefined)
          .map(Number).filter(Number.isFinite))],
        observedNames,
        firstSeenAt: previous?.firstSeenAt || observedAt,
        lastSeenAt: observedAt,
        observationCount: Math.max(0, Number(previous?.observationCount) || 0) + 1,
        ...(candidate.sourceTypes?.includes('event_candidate') ? {
          lastCandidateBatchId: candidateBatchId,
          lastCandidateSeenAt: observedAt,
        } : {}),
      };
      delete nextEntry.observedName;
      const acquiredFromBattle = candidate.sourceTypes?.includes('battle_reward');
      const acquiredFromImmediateEvent = candidate.sourceTypes?.includes('event_reward');
      const acquiredFromShop = candidate.sourceTypes?.includes('shop_page')
        && previous?.shopSoldOut === false && candidate.shopSoldOut === true;
      const previousCount = Number(previous?.count);
      const candidateCount = Number(candidate?.count);
      const acquiredFromCount = candidate.sourceTypes?.includes('effect_confirmation')
        && Number.isFinite(previousCount) && Number.isFinite(candidateCount)
        && candidateCount > previousCount;
      if (acquiredFromBattle)
        nextEntry = markAcquired(nextEntry, 'battle_reward');
      else if (acquiredFromImmediateEvent)
        nextEntry = markAcquired(nextEntry, 'event_reward');
      else if (acquiredFromShop)
        nextEntry = markAcquired(nextEntry, 'shop_purchase');
      else if (acquiredFromCount)
        nextEntry = markAcquired(nextEntry, 'effect_confirmation');
      byKey.set(targetKey, nextEntry);
      capturedKeys.add(targetKey);
    }
    for (const id of acquisitionRequest.ids) {
      const key = `id:${id}`;
      const previous = byKey.get(key) || {
        id,
        key,
        name: '',
        sourceTypes: [],
      };
      byKey.set(key, markAcquired({
        ...previous,
        isPlaceholder: !normalizeGuidebookEffectName(previous.name),
        sourceTypes: [...new Set([
          ...(Array.isArray(previous.sourceTypes) ? previous.sourceTypes : []),
          acquisitionRequest.source,
        ])],
      }, acquisitionRequest.source));
      capturedKeys.add(key);
    }
    const next = sortGuidebookEffects([...byKey.values()]);
    const effectValues = await saveGuidebookEffectsAndValues(next);
    const capturedEffects = next.filter(
      effect => capturedKeys.has(guidebookEffectStorageKey(effect)),
    );
    chrome.runtime.sendMessage({
      type: 'GBF_GUIDEBOOK_EFFECTS_UPDATED',
      effects: guidebookEffectsWithIdPlaceholders(next),
      effectValues,
      captureBatchId,
      capturedEffects,
    }).catch(() => {});
    return next;
  });
  return true;
}

function handleFrontFormation(state, formation) {
  if (!Array.isArray(formation))
    return false;
  const normalized = formation
    .map(Number)
    .filter(index => Number.isInteger(index) && index >= 0);
  if (!normalized.length)
    return false;
  state.frontFormation = normalized;
  return true;
}

async function restoreMatchingBattleState(state, payload) {
  const url = String(payload?.url || '');
  if (!/\/rest\/(?:raid|multiraid)\/start\.json/.test(url))
    return;
  const data = normalizeResponseData(payload.responseData);
  const battleId = String(data?.raid_id || '');
  if (!battleId || state.battleId === battleId)
    return;
  const stored = await chrome.storage.local.get(LATEST_STATE_KEY);
  const latest = stored[LATEST_STATE_KEY];
  if (latest?.battleId === battleId)
    Object.assign(state, latest);
}

function enqueueUpdate(tabId, update) {
  const previous = updateQueues.get(tabId) || Promise.resolve();
  const next = previous
    .then(async () => {
      const state = await getState(tabId);
      if (await update(state))
        await saveState(tabId, state);
    })
    .catch(error => console.warn('GBF Battle Side Panel:', error));
  updateQueues.set(tabId, next);
  next.finally(() => {
    if (updateQueues.get(tabId) === next)
      updateQueues.delete(tabId);
  });
  return next;
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sumDamageList(list) {
  if (!Array.isArray(list))
    return 0;
  return list.reduce((total, item) => total + asNumber(item?.value), 0);
}

function sumNestedDamage(damage) {
  if (!damage || typeof damage !== 'object')
    return 0;
  return Object.values(damage).reduce(
    (total, list) => total + sumDamageList(list),
    0,
  );
}

function sumScenarioDamage(scenario) {
  if (!Array.isArray(scenario))
    return 0;
  let total = 0;
  for (const action of scenario) {
    if (action?.cmd === 'attack' && action.from === 'player')
      total += sumNestedDamage(action.damage);
    if (action?.cmd === 'special' || action?.cmd === 'special_npc') {
      for (const detail of action.list || [])
        total += sumDamageList(detail?.damage);
    }
    if (action?.cmd === 'damage' && action.to === 'boss')
      total += sumDamageList(action.list);
    if (action?.cmd === 'loop_damage' && action.to === 'boss') {
      for (const list of action.list || [])
        total += sumDamageList(list);
    }
    if (action?.cmd === 'summon') {
      for (const detail of action.list || [])
        total += sumDamageList(detail?.damage);
    }
  }
  return total;
}

function isAbilityDamageAction(index, scenario) {
  const relatedCommands = ['special', 'special_npc', 'ability'];
  let isAbility = true;
  for (let offset = 1; offset <= 4; offset += 1) {
    const previous = scenario[index - offset];
    if (previous?.cmd === 'wait') {
      isAbility = false;
      break;
    }
    if (previous && relatedCommands.includes(previous.cmd) && previous.to !== 'boss')
      break;
    if (previous?.cmd === 'chain_cutin') {
      isAbility = false;
      break;
    }
  }
  return isAbility;
}

function calculateTurnStats(scenario) {
  const result = emptyTurnStats();
  if (!Array.isArray(scenario))
    return result;
  for (let index = 0; index < scenario.length; index += 1) {
    const action = scenario[index];
    if (action?.cmd === 'attack' && action.from === 'player') {
      for (const damageList of Object.values(action.damage || {})) {
        for (const damage of damageList || []) {
          const value = asNumber(damage?.value);
          if (value !== 0) {
            result.hit += 1;
            result.total += value;
          }
        }
      }
    }
    if (action?.cmd === 'special' || action?.cmd === 'special_npc') {
      if (Array.isArray(action.total))
        result.hit += action.total.filter(item => item?.split?.[0] !== '0').length;
      for (const detail of action.list || []) {
        for (const damage of detail?.damage || []) {
          const value = asNumber(damage?.value);
          result.total += value;
          result.special += value;
        }
      }
    }
    if (action?.cmd === 'damage' && action.to === 'boss') {
      for (const damage of action.list || []) {
        const value = asNumber(damage?.value);
        if (value !== 0) {
          result.hit += 1;
          result.total += value;
          if (isAbilityDamageAction(index, scenario))
            result.ability += value;
        }
      }
    }
    if (action?.cmd === 'loop_damage' && action.to === 'boss') {
      for (const damageList of action.list || []) {
        for (const damage of damageList || []) {
          const value = asNumber(damage?.value);
          if (value !== 0) {
            result.hit += 1;
            result.total += value;
            if (isAbilityDamageAction(index, scenario))
              result.ability += value;
          }
        }
      }
    }
    if (action?.cmd === 'turn' && action.mode === 'boss')
      break;
  }
  return result;
}

function addTurnStats(target, addition) {
  target.hit += addition.hit;
  target.debuff = asNumber(target.debuff) + asNumber(addition.debuff);
  target.ability += addition.ability;
  target.special += addition.special;
  target.total += addition.total;
}

function getBossDebuffKey(item) {
    const status = String(item?.status ?? '');
    const personalUserId = String(item?.personal_debuff_user_id ?? '');
    return status ? `${status}:${personalUserId}` : null;
}

function isCountableBossDebuff(item) {
  if (!item || !getBossDebuffKey(item))
    return false;
  if (item.is_debuff_count === false || item.is_count === false || item.countable === false)
    return false;
  if (item.is_treasure || item.treasure || item.is_bounty)
    return false;
  const text = Object.values(item)
    .filter(value => typeof value === 'string')
    .join(' ');
  return !/(?:treasure|bounty|トレハン|アイテムドロップ)/i.test(text);
}

function getBossDebuffs(condition) {
  const debuffs = Array.isArray(condition?.debuff) ? condition.debuff : [];
  const unique = new Map();
  for (const item of debuffs) {
    const key = getBossDebuffKey(item);
    if (key)
      unique.set(key, { ...item });
  }
  return [...unique.values()];
}

function getBossDebuffKeys(condition) {
  return getBossDebuffs(condition).map(getBossDebuffKey);
}

function findLastBossCondition(scenario) {
  if (!Array.isArray(scenario))
    return null;
  for (let index = scenario.length - 1; index >= 0; index -= 1) {
    const action = scenario[index];
    if (action?.cmd === 'condition' && action.to === 'boss' && Number(action.pos) === 0)
      return action.condition || null;
  }
  return null;
}

function initializeBossDebuffs(state, data, preserveWhenMissing = false) {
  const condition = findLastBossCondition(data?.scenario)
    || data?.boss?.param?.[0]?.condition
    || null;
  if (!condition && preserveWhenMissing)
    return;
  state.bossDebuffs = getBossDebuffs(condition);
  state.bossDebuffKeys = getBossDebuffKeys(condition);
  state.bossDebuffStateInitialized = true;
}

function isPlayerCharacterScenario(state, scenario) {
  if (!Array.isArray(scenario))
    return false;
  return scenario.some((action) => {
    if (action?.cmd === 'attack' && action.from === 'player')
      return Number.isInteger(Number(action.num));
    if (['ability', 'special', 'special_npc'].includes(action?.cmd))
      return Number.isInteger(Number(action.num)) && action.to !== 'boss';
    if (action?.cmd === 'windoweffect' && action.kind) {
      const pid = String(action.kind).split('_')[2];
      return state.characterStats.some(character => character.pid === pid);
    }
    return false;
  });
}

function debuffWasRenewed(previous, next) {
  const fields = [
    'personal_debuff_end_turn',
    'debuff_end_turn',
    'end_turn',
    'remain',
    'remaining',
    'duration',
    'level',
    'stack',
    'count',
  ];
  return fields.some((field) => {
    const before = Number(previous?.[field]);
    const after = Number(next?.[field]);
    return Number.isFinite(before) && Number.isFinite(after) && after > before;
  });
}

function syncBossDebuffs(state, condition) {
  if (!condition)
    return false;
  state.bossDebuffs = getBossDebuffs(condition);
  state.bossDebuffKeys = state.bossDebuffs.map(getBossDebuffKey);
  state.bossDebuffStateInitialized = true;
  return true;
}

function countNewBossDebuffs(state, scenario) {
  const conditionIndex = Array.isArray(scenario)
    ? scenario.findLastIndex(action => action?.cmd === 'condition' && action.to === 'boss' && Number(action.pos) === 0)
    : -1;
  const condition = conditionIndex >= 0 ? scenario[conditionIndex].condition : null;
  if (!condition)
    return { count: 0, characterIndex: null };
  const nextDebuffs = getBossDebuffs(condition);
  if (!state.bossDebuffStateInitialized) {
    syncBossDebuffs(state, condition);
    return { count: 0, characterIndex: null };
  }
  const previousDebuffs = new Map((state.bossDebuffs || []).map(item => [getBossDebuffKey(item), item]));
  let count = 0;
  if (isPlayerCharacterScenario(state, scenario)) {
    for (const debuff of nextDebuffs) {
      if (!isCountableBossDebuff(debuff))
        continue;
      const previous = previousDebuffs.get(getBossDebuffKey(debuff));
      if (!previous || debuffWasRenewed(previous, debuff))
        count += 1;
    }
  }
  syncBossDebuffs(state, condition);
  return {
    count,
    characterIndex: count > 0
      ? resolveDebuffCharacter(conditionIndex, scenario, state.characterStats)
      : null,
  };
}

function setInitialCharacters(state, players) {
  state.characterStats = (players || []).map((player, index) => ({
    index,
    pid: String(player.pid || '').split('_')[0],
    name: String(player.name || player.nickname || player.player_name || `キャラ${index + 1}`),
    hit: 0,
    debuff: 0,
    ability: 0,
    special: 0,
  }));
}

function resetCharacterStats(characters) {
  for (const character of characters) {
    character.hit = 0;
    character.debuff = 0;
    character.ability = 0;
    character.special = 0;
  }
}

function resolveDamageCharacter(index, scenario, characters) {
  const ownerCommands = ['special', 'special_npc', 'ability'];
  for (let offset = 1; offset <= 4; offset += 1) {
    const previous = scenario[index - offset];
    if (!previous || previous.cmd === 'wait')
      break;
    if (ownerCommands.includes(previous.cmd) && previous.to !== 'boss') {
      const owner = Number(previous.num);
      return Number.isInteger(owner) ? owner : null;
    }
    if (previous.cmd === 'windoweffect' && previous.kind) {
      const pid = String(previous.kind).split('_')[2];
      const character = characters.find(item => item.pid === pid);
      if (character)
        return character.index;
    }
    if (previous.cmd === 'chain_cutin')
      return null;
  }
  return null;
}

function calculateCharacterStats(scenario, characters) {
  const result = new Map();
  const getCharacter = (index) => {
    const number = Number(index);
    if (!Number.isInteger(number) || number < 0)
      return null;
    if (!result.has(number))
      result.set(number, { index: number, hit: 0, ability: 0, special: 0 });
    return result.get(number);
  };
  if (!Array.isArray(scenario))
    return [];
  for (let index = 0; index < scenario.length; index += 1) {
    const action = scenario[index];
    if (action?.cmd === 'attack' && action.from === 'player') {
      const character = getCharacter(action.num);
      if (character) {
        for (const list of Object.values(action.damage || {})) {
          for (const damage of list || []) {
            if (asNumber(damage?.value) !== 0)
              character.hit += 1;
          }
        }
      }
    }
    if (action?.cmd === 'special' || action?.cmd === 'special_npc') {
      const character = getCharacter(action.num);
      if (character) {
        if (Array.isArray(action.total))
          character.hit += action.total.filter(item => item?.split?.[0] !== '0').length;
        for (const detail of action.list || [])
          character.special += sumDamageList(detail?.damage);
      }
    }
    if (action?.cmd === 'damage' && action.to === 'boss') {
      const character = getCharacter(resolveDamageCharacter(index, scenario, characters));
      if (character) {
        for (const damage of action.list || []) {
          const value = asNumber(damage?.value);
          if (value !== 0) {
            character.hit += 1;
            if (isAbilityDamageAction(index, scenario))
              character.ability += value;
          }
        }
      }
    }
    if (action?.cmd === 'loop_damage' && action.to === 'boss') {
      const character = getCharacter(resolveDamageCharacter(index, scenario, characters));
      if (character) {
        for (const list of action.list || []) {
          for (const damage of list || []) {
            const value = asNumber(damage?.value);
            if (value !== 0) {
              character.hit += 1;
              if (isAbilityDamageAction(index, scenario))
                character.ability += value;
            }
          }
        }
      }
    }
    if (action?.cmd === 'turn' && action.mode === 'boss')
      break;
  }
  return [...result.values()];
}

function mergeCharacterStats(state, additions) {
  for (const addition of additions) {
    let character = state.characterStats.find(item => item.index === addition.index);
    if (!character) {
      character = {
        index: addition.index,
        pid: '',
        name: `キャラ${addition.index + 1}`,
        hit: 0,
        debuff: 0,
        ability: 0,
        special: 0,
      };
      state.characterStats.push(character);
    }
    character.hit += addition.hit;
    character.debuff = asNumber(character.debuff) + asNumber(addition.debuff);
    character.ability += addition.ability;
    character.special += addition.special;
  }
}

function updateTurnStats(state, resultType, data) {
  const responseTurn = asNumber(data.status?.turn);
  const bossDied = Array.isArray(data.scenario)
    && data.scenario.some(action => action?.cmd === 'die' && action.to === 'boss');
  const actionTurn = resultType === 'normal_attack' && responseTurn > 0 && !bossDied
    ? Math.max(1, responseTurn - 1)
    : responseTurn || state.statsTurn;
  if (actionTurn && actionTurn !== state.statsTurn) {
    state.statsTurn = actionTurn;
    state.lastTurn = emptyTurnStats();
    resetCharacterStats(state.characterStats);
  }
  addTurnStats(state.lastTurn, calculateTurnStats(data.scenario));
  mergeCharacterStats(state, calculateCharacterStats(data.scenario, state.characterStats));
}

function normalizeResponseData(responseData) {
  if (typeof responseData !== 'string')
    return responseData;
  try {
    return JSON.parse(responseData);
  }
  catch {
    return null;
  }
}

function setInitialMembers(state, rawMembers) {
  state.members = (rawMembers || []).map(member => ({
    userId: String(member.user_id || ''),
    nickname: String(member.nickname || ''),
    level: String(member.level ?? ''),
    attribute: String(member.pc_attribute ?? ''),
    point: null,
    rank: null,
  }));
  state.participantCount = state.members.length || 1;
}

function addJoinedMember(state, member) {
  if (!member)
    return;
  const userId = String(member.user_id || '');
  if (!state.members.some(item => item.userId === userId)) {
    state.members.push({
      userId,
      nickname: String(member.nickname || ''),
      level: String(member.level ?? ''),
      attribute: String(member.pc_attribute ?? ''),
      point: null,
      rank: null,
    });
  }
  state.participantCount = Math.max(state.participantCount, state.members.length);
}

function applyMvpList(state, mvpList) {
  if (!Array.isArray(mvpList))
    return;
  for (const member of state.members) {
    member.point = null;
    member.rank = null;
  }
  for (const mvp of mvpList) {
    const userId = String(mvp.user_id || '');
    let member = state.members.find(item => item.userId === userId);
    if (!member) {
      member = {
        userId,
        nickname: String(mvp.nickname || mvp.user_name || ''),
        level: String(mvp.level ?? ''),
        attribute: String(mvp.pc_attribute ?? ''),
        point: null,
        rank: null,
      };
      state.members.push(member);
    }
    member.point = asNumber(mvp.point);
    member.rank = asNumber(mvp.rank) || null;
  }
  state.participantCount = Math.max(state.participantCount, state.members.length);
}

function handleAjax(state, payload) {
  const url = String(payload.url || '');
  const data = normalizeResponseData(payload.responseData);
  if (!data)
    return false;
  if (/\/rest\/(?:raid|multiraid)\/start\.json/.test(url)) {
    Object.assign(state, createEmptyState(), {
      active: true,
      battleId: String(data.raid_id || ''),
      participationId: String(data.twitter?.battle_id || data.raid_id || ''),
      participantLimit: asNumber(data.limit_number) || 1,
      statsTurn: asNumber(data.turn),
    });
    setInitialMembers(state, data.multi_raid_member_info);
    setInitialCharacters(state, data.player?.param);
    state.totalDamage += sumScenarioDamage(data.scenario);
    return true;
  }
  const resultMatch = url.match(/\/rest\/(?:raid|multiraid)\/(normal_attack|summon|fatal_chain|ability|group_gauge_action)_result\.json/);
  if (!resultMatch || !state.active)
    return false;
  state.totalDamage += sumScenarioDamage(data.scenario);
  updateTurnStats(state, resultMatch[1], data);
  if (data.status?.fellow !== undefined)
    state.participantCount = asNumber(data.status.fellow);
  return true;
}

function handleWebSocket(state, data) {
  if (!data || !state.active)
    return false;
  let changed = false;
  if (data.memberJoin) {
    addJoinedMember(state, data.memberJoin.member);
    applyMvpList(state, data.memberJoin.mvpList);
    changed = true;
  }
  if (data.mvpUpdate) {
    applyMvpList(state, data.mvpUpdate.mvpList);
    changed = true;
  }
  if (data.battleFinish) {
    state.active = false;
    changed = true;
  }
  return changed;
}

function routeNumber(value) {
  if (value === null || value === undefined || value === '')
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRouteNode(node) {
  const id = routeNumber(node?.node_id ?? node?.nodeId ?? node?.id);
  if (id === null)
    return null;
  const adjacent = node?.adjacent_node_ids ?? node?.adjacentIds ?? [];
  const specialIncidentId = routeNumber(node?.special_incident_id ?? node?.specialIncidentId);
  return {
    id,
    x: routeNumber(node?.position_x ?? node?.positionX ?? node?.x),
    y: routeNumber(node?.position_y ?? node?.positionY ?? node?.y),
    type: routeNumber(node?.node_type ?? node?.nodeType ?? node?.type),
    // Live node_list responses classify special nodes with special_incident_id.
    specialType: routeNumber(node?.special_node_type ?? node?.specialNodeType) ?? specialIncidentId,
    adjacentIds: (Array.isArray(adjacent) ? adjacent : []).map(Number).filter(Number.isFinite),
    isShrinking: Boolean(node?.is_shrinking ?? node?.isShrinking),
    isVisited: Boolean(node?.is_visited ?? node?.isVisited),
    isQuestCheck: Boolean(node?.is_quest_check ?? node?.isQuestCheck),
    isPassedDanger: Boolean(node?.is_passed_danger ?? node?.isPassedDanger),
    specialIncidentId,
  };
}

function isFloatingCastleBodyRouteNode(node, nodes = []) {
  if (Number(node?.type) !== 10)
    return false;
  const knownPosition = Number(node?.specialType) === 4
    && Number(node?.x) === 346
    && Number(node?.y) === 292;
  if (knownPosition)
    return true;
  const ownConnections = Array.isArray(node?.adjacentIds) ? node.adjacentIds : [];
  const inboundConnection = (Array.isArray(nodes) ? nodes : []).some(other => (
    Number(other?.id) !== Number(node?.id)
    && Array.isArray(other?.adjacentIds)
    && other.adjacentIds.includes(node.id)
  ));
  return ownConnections.length === 0 && !inboundConnection;
}

function normalizeRoutePartyMembers(value) {
  if (!Array.isArray(value))
    return [];
  return value.map((member, index) => ({
    index,
    hp: routeNumber(member?.hp),
    maxHp: routeNumber(member?.max_hp ?? member?.maxHp),
    isPc: Boolean(member?.is_pc ?? member?.isPc),
    imageId: member?.image_id ?? member?.imageId ?? null,
    userNpcId: member?.user_npc_id ?? member?.userNpcId ?? null,
  })).filter(member => member.hp !== null && member.maxHp !== null && member.maxHp > 0);
}

function extractRoutePartyMembers(response, dungeon, url) {
  if (url.includes('/dungeon/party_status') && Array.isArray(response))
    return normalizeRoutePartyMembers(response);
  const scenarios = Array.isArray(dungeon?.action_scenario_list)
    ? dungeon.action_scenario_list
    : [];
  for (let index = scenarios.length - 1; index >= 0; index -= 1) {
    const party = scenarios[index]?.after_party_status || scenarios[index]?.before_party_status;
    const normalized = normalizeRoutePartyMembers(party);
    if (normalized.length)
      return normalized;
  }
  return [];
}

function extractObservedMiasmaDamage(dungeon) {
  const scenarios = Array.isArray(dungeon?.action_scenario_list)
    ? dungeon.action_scenario_list
    : [];
  const scenario = scenarios.find(item => Number(item?.action_type) === 301
    && Array.isArray(item?.before_party_status) && Array.isArray(item?.after_party_status));
  if (!scenario)
    return null;
  const rates = scenario.after_party_status.map((after, index) => {
    const before = scenario.before_party_status[index];
    const maxHp = routeNumber(after?.max_hp ?? before?.max_hp);
    const beforeHp = routeNumber(before?.hp);
    const afterHp = routeNumber(after?.hp);
    return maxHp && beforeHp !== null && afterHp !== null
      ? (beforeHp - afterHp) / maxHp * 100
      : null;
  }).filter(rate => Number.isFinite(rate) && rate > 0);
  if (!rates.length)
    return null;
  rates.sort((a, b) => a - b);
  const phase = dungeon?.miasma_info?.before || dungeon?.miasma_info?.after || {};
  const level = Math.max(1, routeNumber(phase.level) || 1);
  const status = routeNumber(phase.status) || 1;
  const completedShrinks = Math.max(0, level - 1) + (status >= 2 ? 1 : 0);
  return {
    completedShrinks,
    ratePercent: Math.round(rates[Math.floor(rates.length / 2)]),
  };
}

function inferConsumedRouteNode(next, nodeId, sourceNodes = null) {
  const id = routeNumber(nodeId);
  if (id === null)
    return;
  const node = next.nodes?.find(item => item.id === id);
  const sourceNode = sourceNodes?.find?.(item => item.id === id);
  const departedType = sourceNode?.originalType ?? sourceNode?.type
    ?? node?.originalType ?? node?.type;
  if (!node || !ROUTE_CONSUMED_ON_DEPARTURE_TYPES.has(departedType))
    return;
  node.originalType ??= departedType;
  next.inferredConsumedNodeIds = [...new Set([...(next.inferredConsumedNodeIds || []), id])];
}

function applyInferredConsumedRouteNodes(next) {
  const consumedIds = new Set(next.inferredConsumedNodeIds || []);
  const retainedIds = new Set();
  for (const node of next.nodes || []) {
    if (!consumedIds.has(node.id))
      continue;
    // A later authoritative response may reclassify an ID. Never hide special,
    // strong-enemy, boss, shop, or warp nodes based only on movement.
    if (node.type !== 0 && !ROUTE_CONSUMED_ON_DEPARTURE_TYPES.has(node.type))
      continue;
    retainedIds.add(node.id);
    node.originalType ??= node.type;
    node.type = 0;
    node.isVisited = true;
    node.inferredEmpty = true;
  }
  next.inferredConsumedNodeIds = [...retainedIds];
}

function markPassedDangerRouteNode(next, nodeId) {
  const id = routeNumber(nodeId);
  if (id === null)
    return;
  const node = next.nodes?.find(item => item.id === id);
  if (!node || !ROUTE_PASSED_DANGER_TYPES.has(node.type))
    return;
  next.passedDangerNodeIds = [...new Set([...(next.passedDangerNodeIds || []), id])];
}

function applyPassedDangerRouteNodes(next) {
  const passedIds = new Set(next.passedDangerNodeIds || []);
  const retainedIds = new Set();
  for (const node of next.nodes || []) {
    if (!passedIds.has(node.id))
      continue;
    if (node.type !== 0 && !ROUTE_PASSED_DANGER_TYPES.has(node.type))
      continue;
    retainedIds.add(node.id);
    node.isPassedDanger = true;
    node.isVisited = true;
  }
  next.passedDangerNodeIds = [...retainedIds];
}

function routeRequestData(payload) {
  const value = payload?.requestData;
  if (value && typeof value === 'object')
    return value;
  if (typeof value !== 'string' || !value)
    return {};
  try {
    return JSON.parse(value);
  }
  catch {
    return {};
  }
}

function extractSpecialEventSignals(value, maxItems = 80) {
  const results = [];
  const seen = new WeakSet();
  const keyPattern = /(?:^|_)(?:id|type|name|title|text|message|scenario|command|cmd)(?:$|_)/i;
  const visit = (item, path, depth) => {
    if (results.length >= maxItems || item === null || item === undefined || depth > 8)
      return;
    if (typeof item !== 'object')
      return;
    if (seen.has(item))
      return;
    seen.add(item);
    for (const [key, child] of Object.entries(item)) {
      if (results.length >= maxItems)
        break;
      const childPath = `${path}.${key}`;
      if ((typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean')
        && keyPattern.test(key)) {
        results.push({ path: childPath, key, value: typeof child === 'string' ? child.slice(0, 300) : child });
      }
      else if (child && typeof child === 'object') {
        visit(child, childPath, depth + 1);
      }
    }
  };
  visit(value, 'action_scenario_list', 0);
  return results;
}

function normalizeRouteDungeonItem(item, previousItem = null) {
  if (!item || typeof item !== 'object')
    return null;
  const id = routeNumber(item.item_id ?? item.dungeon_item_id ?? item.itemId ?? item.dungeonItemId);
  if (id === null)
    return null;
  const observedCount = routeNumber(item.num ?? item.count);
  const previousCount = routeNumber(previousItem?.count);
  return {
    id,
    count: observedCount !== null
      ? Math.max(1, observedCount)
      : (previousCount !== null ? Math.max(1, previousCount) : 1),
    name: String(item.name ?? previousItem?.name ?? ''),
    text: String(item.text ?? previousItem?.text ?? ''),
    imageId: String(item.image_id ?? item.imageId ?? previousItem?.imageId ?? ''),
  };
}

function extractRouteDungeonItemUpdate(response, dungeon, url, previousItems = []) {
  const previousById = new Map(
    (previousItems || []).map(item => [routeNumber(item?.id), item]).filter(([id]) => id !== null),
  );
  if (url.includes('/dungeon_item_list') && Array.isArray(response?.dungeon_item_list)) {
    return {
      authoritative: true,
      items: response.dungeon_item_list
        .map(item => normalizeRouteDungeonItem(item, previousById.get(routeNumber(item?.item_id))))
        .filter(Boolean),
    };
  }
  const scenarios = [
    ...(Array.isArray(dungeon?.action_scenario_list) ? dungeon.action_scenario_list : []),
    ...(dungeon !== response && Array.isArray(response?.action_scenario_list)
      ? response.action_scenario_list
      : []),
  ];
  const acquiredItems = scenarios
    .filter(scenario => Number(scenario?.action_type ?? scenario?.actionType) === 600)
    .flatMap(scenario => scenario?.dungeon_item_list ?? scenario?.dungeonItemList ?? [])
    .map(item => normalizeRouteDungeonItem(item, previousById.get(routeNumber(
      item?.dungeon_item_id ?? item?.item_id ?? item?.dungeonItemId ?? item?.itemId,
    ))))
    .filter(Boolean);
  return { authoritative: false, items: acquiredItems };
}

function applyRouteDungeonItemUpdate(next, update) {
  if (!update)
    return;
  if (update.authoritative) {
    next.dungeonItems = update.items;
  }
  else if (update.items.length) {
    const byId = new Map((next.dungeonItems || []).map(item => [item.id, { ...item }]));
    for (const item of update.items) {
      const previous = byId.get(item.id);
      byId.set(item.id, {
        ...previous,
        ...item,
        // Event items appear to be unique. Taking the maximum also makes duplicate
        // delivery of one Ajax response idempotent.
        count: Math.max(Number(previous?.count) || 0, Number(item.count) || 1),
      });
    }
    next.dungeonItems = [...byId.values()].sort((a, b) => a.id - b.id);
  }
  const prisonKey = (next.dungeonItems || []).find(item => item.id === 4);
  next.prisonKeyCount = prisonKey ? Math.max(1, Number(prisonKey.count) || 1) : 0;
}

function updateRouteRuntimeState(tabId, payload) {
  const response = payload?.responseData;
  const url = String(payload?.url || '');
  const isBattleStart = /\/rest\/(?:raid|multiraid)\/start\.json/.test(url);
  if (isBattleStart) {
    const previous = routeRuntimeCache.get(tabId);
    if (!previous)
      return;
    const next = {
      ...previous,
      nodes: (previous.nodes || []).map(node => ({ ...node })),
      partyMembers: (previous.partyMembers || []).map(member => ({ ...member })),
      dungeonItems: (previous.dungeonItems || []).map(item => ({ ...item })),
      miasmaDamageRates: { ...(previous.miasmaDamageRates || {}) },
      inferredConsumedNodeIds: [...(previous.inferredConsumedNodeIds || [])],
      passedDangerNodeIds: [...(previous.passedDangerNodeIds || [])],
      miasma: { ...(previous.miasma || {}) },
      updatedAt: new Date().toISOString(),
    };
    const activeNode = next.nodes.find(node => node.id === next.currentNodeId);
    if (activeNode?.type === 2)
      inferConsumedRouteNode(next, next.currentNodeId);
    applyInferredConsumedRouteNodes(next);
    applyPassedDangerRouteNodes(next);
    routeRuntimeCache.set(tabId, next);
    chrome.runtime.sendMessage({ type: 'GBF_ROUTE_STATE_UPDATED', tabId }).catch(() => {});
    return;
  }
  if (!response || !url.includes('/arcarum3/'))
    return;
  const dungeon = response?.option?.dungeon || response;
  const previous = routeRuntimeCache.get(tabId) || { nodes: [], miasma: {} };
  const next = {
    ...previous,
    nodes: (previous.nodes || []).map(node => ({ ...node })),
    partyMembers: (previous.partyMembers || []).map(member => ({ ...member })),
    dungeonItems: (previous.dungeonItems || []).map(item => ({ ...item })),
    miasmaDamageRates: { ...(previous.miasmaDamageRates || {}) },
    inferredConsumedNodeIds: [...(previous.inferredConsumedNodeIds || [])],
    passedDangerNodeIds: [...(previous.passedDangerNodeIds || [])],
    miasma: { ...(previous.miasma || {}) },
    updatedAt: new Date().toISOString(),
  };
  const request = routeRequestData(payload);
  applyRouteDungeonItemUpdate(
    next,
    extractRouteDungeonItemUpdate(response, dungeon, url, previous.dungeonItems),
  );
  const isWarpSelection = url.includes('/proceed_node_event_select_warp');
  const isNodeMovement = url.includes('/move_node');
  const partyMembers = extractRoutePartyMembers(response, dungeon, url);
  if (partyMembers.length)
    next.partyMembers = partyMembers;
  const observedMiasmaDamage = extractObservedMiasmaDamage(dungeon);
  if (observedMiasmaDamage)
    next.miasmaDamageRates[observedMiasmaDamage.completedShrinks] = observedMiasmaDamage.ratePercent;
  const incomingMapId = routeNumber(dungeon.map_id);
  if (incomingMapId !== null && routeNumber(previous.mapId) !== null && incomingMapId !== previous.mapId) {
    next.inferredConsumedNodeIds = [];
    next.passedDangerNodeIds = [];
    next.specialEventObservation = null;
    next.dayOneBossDefeated = false;
    next.firstShrinkFinalCircle = null;
    chrome.storage.session.remove(routeFirstShrinkCircleStorageKey(tabId)).catch(() => {});
  }
  if (routeNumber(dungeon.total_turn) !== null && routeNumber(previous.totalTurn) !== null
    && Number(dungeon.total_turn) < Number(previous.totalTurn))
    next.dayOneBossDefeated = false;
  const incomingNodes = Array.isArray(dungeon.node_list)
    ? dungeon.node_list.map(normalizeRouteNode).filter(Boolean)
    : null;
  const transientFloatingCastleNodeList = incomingNodes?.length === 1
    && isFloatingCastleBodyRouteNode(incomingNodes[0], incomingNodes)
    && (previous.nodes || []).length > 1;
  const nodes = transientFloatingCastleNodeList ? null : incomingNodes;
  if (nodes?.length)
    next.nodes = nodes;
  if (nodes?.length)
    next.shrinkingNodeIds = nodes.filter(node => node.isShrinking).map(node => node.id);
  const currentNodeId = routeNumber(
    dungeon.after_current_node_id ?? dungeon.current_node_id
      ?? (isNodeMovement ? request.node_id ?? request.nodeId : null),
  );
  if (currentNodeId !== null) {
    const reportedNode = incomingNodes?.find(node => node.id === currentNodeId)
      || next.nodes?.find(node => node.id === currentNodeId);
    if (isFloatingCastleBodyRouteNode(reportedNode, incomingNodes?.length ? incomingNodes : next.nodes)) {
      const returnNodeId = routeNumber(dungeon.before_current_node_id)
        ?? routeNumber(previous.floatingCastleReturnNodeId)
        ?? routeNumber(previous.currentNodeId);
      next.actualCurrentNodeId = currentNodeId;
      next.floatingCastleReturnNodeId = returnNodeId;
      if (returnNodeId !== null)
        next.currentNodeId = returnNodeId;
    }
    else {
      next.actualCurrentNodeId = currentNodeId;
      next.currentNodeId = currentNodeId;
      next.floatingCastleReturnNodeId = null;
      if (!isWarpSelection && next.warpDeclinedAtNodeId !== currentNodeId)
        next.warpDeclinedAtNodeId = null;
    }
  }
  const finishedNodeEvent = url.includes('/finish_node_event')
    && Boolean(dungeon.is_visited_node ?? response?.is_visited_node);
  if (finishedNodeEvent) {
    const completedNode = next.nodes?.find(node => node.id === next.currentNodeId);
    if (completedNode) {
      completedNode.isVisited = true;
      if (completedNode.type === 1 && Number(dungeon.total_turn ?? next.totalTurn) < 88)
        next.dayOneBossDefeated = true;
    }
  }
  const reportedCurrentNode = incomingNodes?.find(node => node.id === currentNodeId)
    || next.nodes?.find(node => node.id === currentNodeId);
  const atFloatingCastleBody = isFloatingCastleBodyRouteNode(
    reportedCurrentNode,
    incomingNodes?.length ? incomingNodes : next.nodes,
  );
  const departedNodeId = routeNumber(dungeon.before_current_node_id)
    ?? routeNumber(previous.currentNodeId);
  if (isNodeMovement && currentNodeId !== null && departedNodeId !== null
    && departedNodeId !== currentNodeId && !atFloatingCastleBody) {
    inferConsumedRouteNode(next, departedNodeId, previous.nodes);
  }
  if (isNodeMovement && currentNodeId !== null && !atFloatingCastleBody) {
    if (departedNodeId !== currentNodeId) {
      markPassedDangerRouteNode(next, departedNodeId);
    }
    const arrivedNode = next.nodes?.find(node => node.id === currentNodeId);
    if (arrivedNode?.type === 2)
      inferConsumedRouteNode(next, currentNodeId);
  }
  if (isWarpSelection) {
    const selection = routeNumber(request.select);
    if (selection === 0 && routeNumber(next.currentNodeId) !== null) {
      next.warpDeclinedAtNodeId = next.currentNodeId;
    }
    else if (selection === 1 && routeNumber(next.currentNodeId) !== null) {
      const warps = (next.nodes || []).filter(node => node.type === 9);
      if (warps.length === 2) {
        const destination = warps.find(node => node.id !== next.currentNodeId);
        if (destination) {
          next.currentNodeId = destination.id;
          destination.isVisited = true;
        }
      }
      next.warpDeclinedAtNodeId = null;
    }
  }
  const activeNode = (next.nodes || []).find(node => node.id === next.currentNodeId);
  const enteredSpecialEvent = activeNode?.type === 10
    && (isNodeMovement || (nodes?.length && currentNodeId !== null));
  const activeNonCoordinateSpecial = atFloatingCastleBody || (activeNode?.type === 10
    && ROUTE_NON_COORDINATE_SPECIAL_TYPES.has(Number(activeNode.specialType)));
  if (activeNonCoordinateSpecial
    && (enteredSpecialEvent || dungeon.action_scenario_list))
    next.specialEventObservation = null;
  else if (enteredSpecialEvent || (activeNode?.type === 10 && dungeon.action_scenario_list)) {
    const oldObservation = next.specialEventObservation?.nodeId === activeNode.id
      ? next.specialEventObservation
      : {};
    next.specialEventObservation = {
      ...oldObservation,
      capturedAt: payload.capturedAt || new Date().toISOString(),
      mapId: incomingMapId ?? next.mapId ?? null,
      nodeId: activeNode.id,
      x: activeNode.x,
      y: activeNode.y,
      specialType: activeNode.specialType,
      eventId: activeNode.specialIncidentId ?? activeNode.specialType ?? null,
      appearancePhase: next.dayOneBossDefeated
        ? 'post-day1-boss'
        : 'initial-map',
      endpoint: payload.url,
      signals: dungeon.action_scenario_list
        ? extractSpecialEventSignals(dungeon.action_scenario_list)
        : (oldObservation.signals || null),
    };
  }
  for (const [target, value] of [
    ['totalTurn', dungeon.total_turn],
    ['currency', dungeon.possession_arcarum3_dungeon_point],
    ['mapId', dungeon.map_id],
    ['dungeonStatus', dungeon.dungeon_status],
  ]) {
    const number = routeNumber(value);
    if (number !== null)
      next[target] = number;
  }
  const rawMiasma = dungeon.miasma_info;
  if (rawMiasma) {
    const after = rawMiasma.after || rawMiasma;
    next.miasma = {
      ...next.miasma,
      active: Boolean(after.is_miasmic),
      level: routeNumber(after.level),
      status: routeNumber(after.status),
      step: routeNumber(after.step),
      remainTurn: routeNumber(after.miasma_stop_countdown),
      patternId: routeNumber(after.pattern_id),
      basePatternId: routeNumber(after.base_pattern_id),
      centerX: routeNumber(after.center_position_x),
      centerY: routeNumber(after.center_position_y),
    };
    if (!next.miasma.active) {
      next.shrinkingNodeIds = [];
      for (const node of next.nodes || [])
        node.isShrinking = false;
    }
    else {
      const shrinkIds = Array.isArray(rawMiasma.shrink_node_ids)
        ? new Set(rawMiasma.shrink_node_ids.map(Number))
        : new Set();
      next.shrinkingNodeIds = [...new Set([...(next.shrinkingNodeIds || []), ...shrinkIds])];
      for (const node of next.nodes || []) {
        if (shrinkIds.has(node.id))
          node.isShrinking = true;
      }
    }
  }
  applyPassedDangerRouteNodes(next);
  applyInferredConsumedRouteNodes(next);
  routeRuntimeCache.set(tabId, next);
  observeGuidebookSortieState(tabId, next);
  scheduleRouteFirstShrinkLearning(tabId, next);
  chrome.runtime.sendMessage({ type: 'GBF_ROUTE_STATE_UPDATED', tabId }).catch(() => {});
}

function mergeRouteStates(pageState, runtimeState) {
  const page = pageState || {};
  const runtime = runtimeState || {};
  const shrinkingIds = new Set(runtime.shrinkingNodeIds || []);
  const nodes = (runtime.nodes?.length ? runtime.nodes : (page.nodes || [])).map(node => ({
    ...node,
    isVisited: Boolean(node.isVisited || node.id === runtime.currentNodeId),
    isShrinking: runtime.miasma?.active === false
      ? false
      : Boolean(node.isShrinking || shrinkingIds.has(node.id)),
  }));
  const miasma = { ...(page.miasma || {}), ...(runtime.miasma || {}) };
  return {
    ...page,
    ...runtime,
    capturedAt: runtime.updatedAt || page.capturedAt || new Date().toISOString(),
    nodes,
    miasma,
  };
}

function updateRouteRuntimeFromFieldCapture(tabId, routeState) {
  if (!routeState || !Array.isArray(routeState.nodes) || !routeState.nodes.length)
    return null;
  const previous = routeRuntimeCache.get(tabId) || {};
  // The field capture is newer than the battle-time runtime. Pass it as the
  // authoritative side of the merge so stale pre-battle miasma fields cannot
  // overwrite the newly visible contraction stage, coordinates, or turn.
  const next = mergeRouteStates(previous, routeState);
  next.updatedAt = routeState.capturedAt || new Date().toISOString();
  routeRuntimeCache.set(tabId, next);
  observeGuidebookSortieState(tabId, next);
  scheduleRouteFirstShrinkLearning(tabId, next);
  chrome.runtime.sendMessage({ type: 'GBF_ROUTE_STATE_UPDATED', tabId }).catch(() => {});
  return next;
}

async function requestPageCapture(tabId, type) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type });
  }
  catch (error) {
    const message = String(error?.message || error);
    if (!message.includes('Receiving end does not exist')
      && !message.includes('Could not establish connection'))
      throw error;
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    return chrome.tabs.sendMessage(tabId, { type });
  }
}

async function requestGameViewNodeInspection(tabId) {
  return requestPageCapture(tabId, 'GBF_INSPECT_GAME_VIEW_NODES');
}

async function requestRoutePlanningState(tabId) {
  const response = await requestPageCapture(tabId, 'GBF_CAPTURE_ROUTE_STATE');
  const savedFirstShrinkCircle = await readRouteFirstShrinkCircle(tabId);
  const learnedModels = await readRouteFirstShrinkLearnedModels();
  const runtimeState = routeRuntimeCache.get(tabId) || {};
  if (savedFirstShrinkCircle)
    runtimeState.firstShrinkFinalCircle = savedFirstShrinkCircle;
  runtimeState.firstShrinkLearnedModels = learnedModels;
  if (response?.error && runtimeState?.nodes?.length)
    return { routeState: mergeRouteStates(null, runtimeState) };
  if (response?.error)
    return response;
  return { routeState: mergeRouteStates(response?.routeState, runtimeState) };
}

async function requestMiasmaAnalysis(tabId) {
  const response = await requestPageCapture(tabId, 'GBF_CAPTURE_MIASMA_ANALYSIS');
  if (response?.error)
    return response;
  const runtimeState = routeRuntimeCache.get(tabId);
  const latestRouteState = mergeRouteStates(response?.analysis?.routeState, runtimeState);
  const centerX = routeNumber(latestRouteState?.miasma?.centerX);
  const centerY = routeNumber(latestRouteState?.miasma?.centerY);
  const nodes = (latestRouteState?.nodes || []).map(node => ({
    id: node.id,
    x: node.x,
    y: node.y,
    isShrinking: Boolean(node.isShrinking),
    distanceFromCenter: centerX !== null && centerY !== null
      && routeNumber(node.x) !== null && routeNumber(node.y) !== null
      ? Math.hypot(Number(node.x) - centerX, Number(node.y) - centerY)
      : null,
  }));
  const safeDistances = nodes.filter(node => !node.isShrinking && Number.isFinite(node.distanceFromCenter))
    .map(node => node.distanceFromCenter);
  const shrinkingDistances = nodes.filter(node => node.isShrinking && Number.isFinite(node.distanceFromCenter))
    .map(node => node.distanceFromCenter);
  const lowerBound = safeDistances.length ? Math.max(...safeDistances) : null;
  const upperBound = shrinkingDistances.length ? Math.min(...shrinkingDistances) : null;
  const firstShrinkComplete = routeNumber(latestRouteState?.miasma?.level) === 1
    && (routeNumber(latestRouteState?.miasma?.status) === 2
      || routeNumber(latestRouteState?.miasma?.step) === 100);
  return {
    analysis: {
      ...(response?.analysis || {}),
      latestDerived: {
        firstShrinkComplete,
        center: { x: centerX, y: centerY },
        radiusBounds: {
          usableAtFirstShrinkCompletion: firstShrinkComplete && lowerBound !== null && upperBound !== null,
          safeNodeMaximumDistance: lowerBound,
          shrinkingNodeMinimumDistance: upperBound,
          midpointEstimate: lowerBound !== null && upperBound !== null ? (lowerBound + upperBound) / 2 : null,
        },
        nodes,
      },
      latestRouteState,
    },
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GBF_BATTLE_EVENT' && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const payload = message.payload || {};
    if (payload.kind === 'ajax') {
      updateRouteRuntimeState(tabId, payload);
      enqueueAjaxTrace(tabId, payload).catch(() => {});
    }
    else if (payload.kind === 'route_field_resync') {
      updateRouteRuntimeFromFieldCapture(tabId, payload.routeState);
    }
    if (payload.kind === 'ajax' || payload.kind === 'guidebook_rewards'
      || payload.kind === 'guidebook_page_capture')
      recordGuidebookCandidates(payload).catch(() => {});
    else if (payload.kind === 'miasma_visual') {
      enqueueAjaxTrace(tabId, payload).catch(() => {});
    }
    enqueueUpdate(tabId, async (state) => {
      if (payload.kind === 'ajax') {
        await restoreMatchingBattleState(state, payload);
        return handleAjax(state, payload);
      }
      if (payload.kind === 'front_formation')
        return handleFrontFormation(state, payload.formation);
      if (payload.kind === 'websocket')
        return handleWebSocket(state, payload.responseData);
      return false;
    }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'GBF_GET_AJAX_TRACE' && Number.isInteger(message.tabId)) {
    getAjaxTrace(message.tabId)
      .then(trace => sendResponse({ trace }))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_GET_GUIDEBOOK_EFFECTS') {
    readGuidebookEffects()
      .then(effects => sendResponse({
        effects: guidebookEffectsWithIdPlaceholders(effects),
        effectValues: buildGuidebookEffectValueRecords(effects),
      }))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_IMPORT_GUIDEBOOK_EFFECTS') {
    importGuidebookEffectsData(message.payload)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_GET_ONLINE_UPDATE_STATE') {
    readOnlineUpdateState()
      .then(state => sendResponse({ state }))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_CHECK_ONLINE_UPDATE') {
    checkOnlineUpdates()
      .then(state => sendResponse({ state }))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_INSPECT_GUIDEBOOK_STORAGE' && Number.isInteger(message.tabId)) {
    requestPageCapture(message.tabId, 'GBF_INSPECT_GUIDEBOOK_STORAGE')
      .then((response) => {
        if (response?.error)
          throw new Error(response.error);
        if (!response?.diagnostics)
          throw new Error('導本格納場所の調査結果を取得できませんでした');
        sendResponse({ diagnostics: response.diagnostics });
      })
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_CAPTURE_GUIDEBOOK_EFFECTS' && Number.isInteger(message.tabId)) {
    requestPageCapture(message.tabId, 'GBF_CAPTURE_GUIDEBOOK_EFFECTS')
      .then(async (response) => {
        if (response?.error)
          throw new Error(response.error);
        const capture = response?.capture;
        if (!capture)
          throw new Error('現在画面から導本情報を取得できませんでした');
        const eventCandidates = Array.isArray(capture.eventCandidates)
          ? capture.eventCandidates : [];
        const viewEffects = Array.isArray(capture.viewEffects) ? capture.viewEffects : [];
        const rewards = Array.isArray(capture.rewards) ? capture.rewards : [];
        await recordGuidebookCandidates({
          kind: 'guidebook_manual_capture',
          eventCandidates,
          viewEffects,
          rewards,
        });
        const effects = guidebookEffectsWithIdPlaceholders(
          await readGuidebookEffects(),
        );
        sendResponse({
          effects,
          effectValues: buildGuidebookEffectValueRecords(effects),
          capturedAt: capture.capturedAt || new Date().toISOString(),
          eventCandidateCount: eventCandidates.length,
          viewEffectCount: viewEffects.length,
          rewardCount: rewards.length,
          inspectedObjects: Number(capture.inspectedObjects) || 0,
        });
      })
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_CONTROL_AJAX_TRACE' && Number.isInteger(message.tabId)) {
    controlAjaxTrace(message.tabId, message.action)
      .then(trace => sendResponse({ trace }))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_LIST_AJAX_ARCHIVES') {
    listAjaxArchiveFiles()
      .then(files => sendResponse({ files }))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_READ_AJAX_ARCHIVE') {
    readAjaxArchiveFile(message.name)
      .then(file => sendResponse({ file }))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_CLEAR_AJAX_ARCHIVES') {
    clearAjaxArchiveFiles()
      .then(removed => sendResponse({ removed }))
      .catch(error => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_GET_BATTLE_STATE') {
    getState(message.tabId)
      .then(state => sendResponse({ state }))
      .catch(error => sendResponse({ error: String(error) }));
    return true;
  }
  if (message?.type === 'GBF_INSPECT_GAME_VIEW_NODES' && Number.isInteger(message.tabId)) {
    requestGameViewNodeInspection(message.tabId)
      .then(sendResponse)
      .catch((error) => {
        const detail = String(error?.message || error);
        const guidance = detail.includes('Cannot access contents of url')
          ? 'GBFの戦闘ページをアクティブにしてから再取得してください'
          : detail;
        sendResponse({ error: guidance });
      });
    return true;
  }
  if (message?.type === 'GBF_GET_ROUTE_STATE' && Number.isInteger(message.tabId)) {
    requestRoutePlanningState(message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_SAVE_FIRST_SHRINK_CIRCLE' && Number.isInteger(message.tabId)) {
    saveRouteFirstShrinkCircle(message.tabId, message.circle)
      .then(circle => sendResponse({ circle }))
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  if (message?.type === 'GBF_GET_MIASMA_ANALYSIS' && Number.isInteger(message.tabId)) {
    requestMiasmaAnalysis(message.tabId)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: String(error?.message || error) }));
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id !== undefined)
    await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.runtime.onInstalled?.addListener(() => {
  scheduleOnlineUpdateChecks();
  checkOnlineUpdates().catch(() => {});
});

chrome.runtime.onStartup?.addListener(() => {
  scheduleOnlineUpdateChecks();
  checkOnlineUpdates().catch(() => {});
});

chrome.alarms?.onAlarm?.addListener((alarm) => {
  if (alarm?.name === ONLINE_UPDATE_ALARM)
    checkOnlineUpdates().catch(() => {});
});

scheduleOnlineUpdateChecks();

chrome.tabs.onRemoved.addListener((tabId) => {
  stateCache.delete(tabId);
  updateQueues.delete(tabId);
  ajaxTraceCache.delete(tabId);
  ajaxTraceQueues.delete(tabId);
  routeRuntimeCache.delete(tabId);
  chrome.storage.session.remove(storageKey(tabId));
  chrome.storage.session.remove(ajaxTraceStorageKey(tabId));
  chrome.storage.session.remove(routeFirstShrinkCircleStorageKey(tabId));
  chrome.storage.local.remove(storageKey(tabId));
});

// hit予測機能の廃止に伴い、独立保存されていた旧学習履歴を削除する。
chrome.storage.local.remove([
  'hit-prediction-records:v3',
  'hit-prediction-records:v4',
]).catch(() => {});
