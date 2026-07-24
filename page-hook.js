(() => {
  const eventName = document.currentScript?.dataset.eventName;
  const requestEventName = document.currentScript?.dataset.requestEventName;
  if (!eventName || !requestEventName)
    return;

  const emit = payload => document.dispatchEvent(new CustomEvent(eventName, {
    detail: JSON.stringify(payload),
  }));

  function valueType(value) {
    try {
      return value?.constructor?.name || Object.prototype.toString.call(value).slice(8, -1) || 'Object';
    }
    catch {
      return typeof value;
    }
  }

  function inspectDomNode(node) {
    const result = {
      $type: valueType(node),
      nodeType: node.nodeType,
      nodeName: node.nodeName,
    };
    if (node.id)
      result.id = node.id;
    if (typeof node.className === 'string' && node.className)
      result.className = node.className;
    if (typeof node.outerHTML === 'string')
      result.outerHTML = node.outerHTML;
    else if (node.nodeValue !== null && node.nodeValue !== undefined)
      result.nodeValue = String(node.nodeValue);
    return result;
  }

  function inspectGameValue(value, depth, maxDepth, path, seen) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
      return value;
    if (typeof value === 'number')
      return Number.isFinite(value) ? value : { $type: 'number', value: String(value) };
    if (typeof value === 'undefined')
      return { $type: 'undefined' };
    if (typeof value === 'bigint')
      return { $type: 'bigint', value: String(value) };
    if (typeof value === 'symbol')
      return { $type: 'symbol', value: String(value) };
    if (typeof value === 'function')
      return { $type: 'function', name: value.name || '', length: value.length };
    if (typeof Node !== 'undefined' && value instanceof Node)
      return inspectDomNode(value);
    if (value instanceof Date)
      return { $type: 'Date', value: Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString() };
    if (value instanceof RegExp)
      return { $type: 'RegExp', value: String(value) };
    if (seen.has(value))
      return { $ref: seen.get(value) };

    const type = valueType(value);
    if (depth >= maxDepth)
      return { $type: type, $depthLimit: true };
    seen.set(value, path);

    if (value instanceof Map) {
      return {
        $type: 'Map',
        entries: [...value.entries()].map(([key, item], index) => ([
          inspectGameValue(key, depth + 1, maxDepth, `${path}.entries[${index}].key`, seen),
          inspectGameValue(item, depth + 1, maxDepth, `${path}.entries[${index}].value`, seen),
        ])),
      };
    }
    if (value instanceof Set) {
      return {
        $type: 'Set',
        values: [...value.values()].map((item, index) => (
          inspectGameValue(item, depth + 1, maxDepth, `${path}.values[${index}]`, seen)
        )),
      };
    }

    const result = Object.create(null);
    result.$type = type;
    let keys;
    try {
      keys = Reflect.ownKeys(value);
    }
    catch (error) {
      result.$error = String(error);
      return result;
    }
    for (const rawKey of keys) {
      const key = typeof rawKey === 'symbol' ? `[${String(rawKey)}]` : rawKey;
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, rawKey);
        if (!descriptor) {
          result[key] = { $type: 'unavailable' };
        }
        else if ('value' in descriptor) {
          result[key] = inspectGameValue(
            descriptor.value,
            depth + 1,
            maxDepth,
            `${path}.${String(key)}`,
            seen,
          );
        }
        else {
          result[key] = {
            $type: 'accessor',
            get: typeof descriptor.get === 'function',
            set: typeof descriptor.set === 'function',
          };
        }
      }
      catch (error) {
        result[key] = { $error: String(error) };
      }
    }
    return result;
  }

  function captureGameViewNodes() {
    const data = window.Game?.view?.data;
    return {
      capturedAt: new Date().toISOString(),
      source: 'window.Game.view.data',
      captureMode: 'all-own-descendants',
      data: inspectGameValue(data, 0, Infinity, 'data', new WeakMap()),
    };
  }

  function arrayLikeValues(value) {
    if (Array.isArray(value))
      return value;
    if (!value || typeof value !== 'object')
      return [];
    const length = Number(value.length);
    if (Number.isInteger(length) && length >= 0)
      return Array.from({ length }, (_, index) => value[index]).filter(item => item !== undefined);
    return Object.keys(value)
      .filter(key => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
      .map(key => value[key]);
  }

  function routeNumber(value) {
    if (value === null || value === undefined || value === '')
      return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  const MIASMA_CIRCLE_IMAGE_GEOMETRY = {
    'miasma_circle_1.png': { width: 1340, height: 1340 },
  };

  function miasmaCircleImageGeometry(image) {
    const filename = String(image || '').split(/[\\/]/).pop().split(/[?#]/)[0].toLowerCase();
    return filename && MIASMA_CIRCLE_IMAGE_GEOMETRY[filename]
      ? { filename, ...MIASMA_CIRCLE_IMAGE_GEOMETRY[filename] }
      : null;
  }

  let lastCircleDisplayCapture = null;
  let lastCircleDisplayCaptureAt = 0;
  function captureMiasmaCircleDisplay() {
    if (lastCircleDisplayCapture && Date.now() - lastCircleDisplayCaptureAt < 1000)
      return lastCircleDisplayCapture;
    const root = window.Game?.view;
    if (!root || typeof root !== 'object')
      return null;
    const queue = [{ value: root, path: 'Game.view', depth: 0 }];
    const safeRead = (value, key) => {
      try {
        return value?.[key];
      }
      catch {
        return null;
      }
    };
    const seen = new WeakSet();
    const candidates = [];
    let inspected = 0;
    while (queue.length && inspected < 10000) {
      const current = queue.shift();
      const value = current.value;
      if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value))
        continue;
      seen.add(value);
      inspected += 1;
      let imageSource = '';
      let imageWidth = null;
      let imageHeight = null;
      try {
        const image = value.image;
        imageSource = String(
          typeof image === 'string' ? image : (image?.currentSrc || image?.src || value.src || ''),
        );
        imageWidth = routeNumber(image?.naturalWidth ?? image?.width);
        imageHeight = routeNumber(image?.naturalHeight ?? image?.height);
      }
      catch {
        imageSource = '';
      }
      const identity = `${current.path} ${String(safeRead(value, 'name') || '')}`
        + ` ${String(safeRead(value, 'id') || '')} ${imageSource}`;
      if (/miasma[_-]?circle|limit[_-]?circle/i.test(identity)) {
        let bounds = null;
        let transformedBounds = null;
        try {
          const result = typeof value.getBounds === 'function' ? value.getBounds() : null;
          if (result)
            bounds = { x: routeNumber(result.x), y: routeNumber(result.y),
              width: routeNumber(result.width), height: routeNumber(result.height) };
        }
        catch {}
        try {
          const result = typeof value.getTransformedBounds === 'function'
            ? value.getTransformedBounds()
            : null;
          if (result)
            transformedBounds = { x: routeNumber(result.x), y: routeNumber(result.y),
              width: routeNumber(result.width), height: routeNumber(result.height) };
        }
        catch {}
        const scaleX = routeNumber(safeRead(value, 'scaleX'));
        const scaleY = routeNumber(safeRead(value, 'scaleY'));
        const renderedWidth = transformedBounds?.width
          ?? (imageWidth !== null && scaleX !== null ? Math.abs(imageWidth * scaleX) : null)
          ?? (bounds?.width !== null && scaleX !== null ? Math.abs(bounds.width * scaleX) : null);
        const renderedHeight = transformedBounds?.height
          ?? (imageHeight !== null && scaleY !== null ? Math.abs(imageHeight * scaleY) : null)
          ?? (bounds?.height !== null && scaleY !== null ? Math.abs(bounds.height * scaleY) : null);
        candidates.push({
          path: current.path,
          type: valueType(value),
          imageSource: imageSource || null,
          imageWidth,
          imageHeight,
          x: routeNumber(safeRead(value, 'x')),
          y: routeNumber(safeRead(value, 'y')),
          scaleX,
          scaleY,
          regX: routeNumber(safeRead(value, 'regX')),
          regY: routeNumber(safeRead(value, 'regY')),
          bounds,
          transformedBounds,
          renderedWidth,
          renderedHeight,
        });
      }
      if (typeof Node !== 'undefined' && value instanceof Node)
        continue;
      if (current.depth >= 10)
        continue;
      let keys = [];
      try {
        keys = Reflect.ownKeys(value);
      }
      catch {
        continue;
      }
      for (const key of keys) {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          const child = descriptor && 'value' in descriptor ? descriptor.value : null;
          if (child && (typeof child === 'object' || typeof child === 'function'))
            queue.push({ value: child, path: `${current.path}.${String(key)}`, depth: current.depth + 1 });
        }
        catch {}
      }
    }
    const usable = candidates.find((candidate) => {
      const width = routeNumber(candidate.renderedWidth);
      const height = routeNumber(candidate.renderedHeight);
      return width !== null && height !== null && width > 0 && height > 0
        && Math.abs(width - height) <= Math.max(2, Math.max(width, height) * 0.02);
    });
    lastCircleDisplayCapture = {
      inspectedObjects: inspected,
      selected: usable || null,
      candidates: candidates.slice(0, 20),
    };
    lastCircleDisplayCaptureAt = Date.now();
    return lastCircleDisplayCapture;
  }

  function captureRoutePlanningState() {
    const data = window.Game?.view?.data || {};
    const dungeon = data?.__rawResponseData?.option?.dungeon || {};
    const rawNodes = dungeon.node_list || data.nodeList;
    const nodes = arrayLikeValues(rawNodes).map((node) => ({
      id: routeNumber(node?.node_id ?? node?.nodeId ?? node?.id),
      x: routeNumber(node?.position_x ?? node?.positionX ?? node?.x),
      y: routeNumber(node?.position_y ?? node?.positionY ?? node?.y),
      type: routeNumber(node?.node_type ?? node?.nodeType ?? node?.type),
      specialType: routeNumber(node?.special_node_type ?? node?.specialNodeType)
        ?? routeNumber(node?.special_incident_id ?? node?.specialIncidentId),
      adjacentIds: arrayLikeValues(node?.adjacent_node_ids ?? node?.adjacentIds)
        .map(Number).filter(Number.isFinite),
      isShrinking: Boolean(node?.is_shrinking ?? node?.isShrinking),
      isVisited: Boolean(node?.is_visited ?? node?.isVisited),
      isQuestCheck: Boolean(node?.is_quest_check ?? node?.isQuestCheck),
      specialIncidentId: node?.special_incident_id ?? node?.specialIncidentId ?? null,
    })).filter(node => node.id !== null);
    const rawMiasma = dungeon.miasma_info || {};
    const after = rawMiasma.after || rawMiasma;
    const viewMiasma = data.miasmaEffectInfo || {};
    const limitCircle = viewMiasma.limitCircle || {};
    const limitCirclePosition = limitCircle.position || {};
    const centerX = routeNumber(after.center_position_x);
    const centerY = routeNumber(after.center_position_y);
    const circlePositionX = routeNumber(limitCirclePosition.x);
    const circlePositionY = routeNumber(limitCirclePosition.y);
    const circleImage = typeof limitCircle.image === 'string' ? limitCircle.image : null;
    const nativeCircleGeometry = miasmaCircleImageGeometry(circleImage);
    const circleDisplay = captureMiasmaCircleDisplay();
    const renderedWidth = routeNumber(circleDisplay?.selected?.renderedWidth);
    const renderedHeight = routeNumber(circleDisplay?.selected?.renderedHeight);
    const renderedCircleRadius = renderedWidth !== null && renderedHeight !== null
      && renderedWidth > 0 && renderedHeight > 0
      && Math.abs(renderedWidth - renderedHeight) <= Math.max(2, Math.max(renderedWidth, renderedHeight) * 0.02)
      ? (renderedWidth + renderedHeight) / 4
      : null;
    const nativeRadius = nativeCircleGeometry
      && nativeCircleGeometry.width === nativeCircleGeometry.height
      ? nativeCircleGeometry.width / 2
      : null;
    const nativeGeometryConfirmed = nativeRadius !== null
      && centerX !== null && centerY !== null
      && circlePositionX !== null && circlePositionY !== null
      && Math.abs((centerX - circlePositionX) - nativeRadius) <= 3
      && Math.abs((centerY - circlePositionY) - nativeRadius) <= 3;
    const circleRadius = nativeGeometryConfirmed ? nativeRadius : renderedCircleRadius;
    const circleCenterX = circleRadius !== null && circlePositionX !== null
      ? circlePositionX + circleRadius : null;
    const circleCenterY = circleRadius !== null && circlePositionY !== null
      ? circlePositionY + circleRadius : null;
    return {
      capturedAt: new Date().toISOString(),
      source: 'window.Game.view.data',
      mapId: routeNumber(dungeon.map_id ?? data.mapId),
      currentNodeId: routeNumber(dungeon.current_node_id ?? data.pieceNodeId),
      totalTurn: routeNumber(dungeon.total_turn ?? data.elapsedTurn),
      currency: routeNumber(dungeon.possession_arcarum3_dungeon_point ?? data.dungeonShopPoint),
      dungeonStatus: routeNumber(dungeon.dungeon_status ?? data.dungeonStatus),
      nodes,
      miasma: {
        active: Boolean(after.is_miasmic ?? viewMiasma.isActive),
        level: routeNumber(after.level),
        status: routeNumber(after.status),
        step: routeNumber(after.step ?? viewMiasma.effectCjsOption?.miasmaarea_end),
        remainTurn: routeNumber(after.miasma_stop_countdown ?? viewMiasma.remainTurn),
        patternId: routeNumber(after.pattern_id),
        basePatternId: routeNumber(after.base_pattern_id),
        centerX,
        centerY,
        circlePositionX,
        circlePositionY,
        circleCenterX,
        circleCenterY,
        circleRadius,
        circleGeometrySource: nativeGeometryConfirmed
          ? `native-image:${nativeCircleGeometry.filename}`
          : (renderedCircleRadius !== null ? 'createjs-rendered-bounds' : null),
        circleDisplay,
        circleImage,
        bossNodeId: routeNumber(viewMiasma.appearBoss?.targetNodeId),
        shrinkNodeIds: arrayLikeValues(rawMiasma.shrink_node_ids).map(Number).filter(Number.isFinite),
      },
    };
  }

  function captureMiasmaAnalysis() {
    const data = window.Game?.view?.data || {};
    const dungeon = data?.__rawResponseData?.option?.dungeon || {};
    const rawMiasma = dungeon.miasma_info || {};
    const viewMiasma = data.miasmaEffectInfo || {};
    const routeState = captureRoutePlanningState();
    const centerX = routeState.miasma.centerX;
    const centerY = routeState.miasma.centerY;
    const nodes = routeState.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      isShrinking: node.isShrinking,
      distanceFromCenter: centerX !== null && centerY !== null && node.x !== null && node.y !== null
        ? Math.hypot(node.x - centerX, node.y - centerY)
        : null,
    }));
    const measured = nodes.filter(node => Number.isFinite(node.distanceFromCenter));
    const safeDistances = measured.filter(node => !node.isShrinking).map(node => node.distanceFromCenter);
    const shrinkingDistances = measured.filter(node => node.isShrinking).map(node => node.distanceFromCenter);
    const lowerBound = safeDistances.length ? Math.max(...safeDistances) : null;
    const upperBound = shrinkingDistances.length ? Math.min(...shrinkingDistances) : null;
    const phaseComplete = routeState.miasma.level === 1
      && (routeState.miasma.status === 2 || routeState.miasma.step === 100);
    return {
      capturedAt: new Date().toISOString(),
      source: 'window.Game.view.data miasma analysis',
      instructions: '第一次収縮完了時（level 1 / status 2 または step 100）のJSONを解析に使用する',
      identifiers: {
        mapId: routeState.mapId,
        totalTurn: routeState.totalTurn,
        currentNodeId: routeState.currentNodeId,
        patternId: routeState.miasma.patternId,
        basePatternId: routeState.miasma.basePatternId,
      },
      phase: {
        active: routeState.miasma.active,
        level: routeState.miasma.level,
        status: routeState.miasma.status,
        step: routeState.miasma.step,
        remainTurn: routeState.miasma.remainTurn,
        firstShrinkComplete: phaseComplete,
      },
      center: { x: centerX, y: centerY },
      radiusBounds: {
        usableAtFirstShrinkCompletion: phaseComplete && lowerBound !== null && upperBound !== null,
        safeNodeMaximumDistance: lowerBound,
        shrinkingNodeMinimumDistance: upperBound,
        midpointEstimate: lowerBound !== null && upperBound !== null ? (lowerBound + upperBound) / 2 : null,
      },
      counts: {
        totalNodes: nodes.length,
        measuredNodes: measured.length,
        safeNodes: nodes.filter(node => !node.isShrinking).length,
        shrinkingNodes: nodes.filter(node => node.isShrinking).length,
      },
      nodes,
      routeState,
      raw: {
        miasmaEffectInfo: inspectGameValue(viewMiasma, 0, Infinity, 'miasmaEffectInfo', new WeakMap()),
        dungeonMiasmaInfo: inspectGameValue(rawMiasma, 0, Infinity, 'miasma_info', new WeakMap()),
      },
    };
  }

  function captureMiasmaVisualState(ajaxResponseData = null) {
    const data = window.Game?.view?.data || {};
    const viewMiasma = data.miasmaEffectInfo;
    if (!viewMiasma || typeof viewMiasma !== 'object' || !Reflect.ownKeys(viewMiasma).length)
      return null;
    const routeState = captureRoutePlanningState();
    let normalizedAjax = ajaxResponseData;
    if (typeof normalizedAjax === 'string') {
      try {
        normalizedAjax = JSON.parse(normalizedAjax);
      }
      catch {
        normalizedAjax = null;
      }
    }
    const ajaxDungeon = normalizedAjax?.option?.dungeon || normalizedAjax || {};
    const ajaxMiasma = ajaxDungeon.miasma_info || {};
    const ajaxAfter = ajaxMiasma.after || ajaxMiasma;
    const visualStep = routeNumber(viewMiasma.effectCjsOption?.miasmaarea_end);
    const center = {
      x: routeNumber(ajaxAfter.center_position_x) ?? routeState.miasma.centerX,
      y: routeNumber(ajaxAfter.center_position_y) ?? routeState.miasma.centerY,
    };
    return {
      capturedAt: new Date().toISOString(),
      source: 'window.Game.view.data miasma visual snapshot',
      identifiers: {
        mapId: routeNumber(ajaxDungeon.map_id) ?? routeState.mapId,
        totalTurn: routeNumber(ajaxDungeon.total_turn) ?? routeState.totalTurn,
        level: routeNumber(ajaxAfter.level) ?? routeState.miasma.level,
        status: routeNumber(ajaxAfter.status) ?? routeState.miasma.status,
        step: routeNumber(ajaxAfter.step) ?? visualStep ?? routeState.miasma.step,
        basePatternId: routeNumber(ajaxAfter.base_pattern_id) ?? routeState.miasma.basePatternId,
        patternId: routeNumber(ajaxAfter.pattern_id) ?? routeState.miasma.patternId,
      },
      serverCenter: center,
      limitCircle: {
        positionX: routeState.miasma.circlePositionX,
        positionY: routeState.miasma.circlePositionY,
        radius: routeState.miasma.circleRadius,
        image: routeState.miasma.circleImage,
      },
      circleDisplay: routeState.miasma.circleDisplay,
      miasmaEffectInfo: inspectGameValue(viewMiasma, 0, Infinity, 'miasmaEffectInfo', new WeakMap()),
    };
  }

  let lastMiasmaVisualSignature = '';
  function emitMiasmaVisualSnapshot(url, ajaxResponseData) {
    const snapshot = captureMiasmaVisualState(ajaxResponseData);
    if (!snapshot) return;
    const signature = JSON.stringify({
      identifiers: snapshot.identifiers,
      serverCenter: snapshot.serverCenter,
      effectCjsOption: snapshot.miasmaEffectInfo?.effectCjsOption,
      limitCircle: snapshot.limitCircle,
    });
    if (signature === lastMiasmaVisualSignature) return;
    lastMiasmaVisualSignature = signature;
    emit({ kind: 'miasma_visual', url: String(url || ''), snapshot });
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

  function guidebookRewardText(reward) {
    const fields = [
      reward?.comment,
      reward?.name,
      reward?.effectName,
      reward?.effect_name,
      reward?.description,
      reward?.detail,
      reward?.text,
    ];
    for (const value of fields) {
      const text = guidebookTextFromValue(value);
      if (text)
        return text;
    }
    return '';
  }

  function guidebookRewardDetailEntries(reward) {
    const details = Array.isArray(reward?.detail)
      ? reward.detail
      : (reward?.detail && typeof reward.detail === 'object' ? [reward.detail] : []);
    return details.filter(detail => (
      detail && typeof detail === 'object' && guidebookTextFromValue(detail)
    ));
  }

  function isGuidebookRewardEntry(reward) {
    const assetText = `${String(reward?.image || '')} ${String(
      reward?.bookEffetIcon || reward?.bookEffectIcon || '',
    )}`;
    return Number(reward?.rewardType ?? reward?.reward_type) === 4
      || /(?:sephirabook|book_effect)/i.test(assetText);
  }

  function serializeGuidebookReward(reward, detail = null) {
    const effectText = guidebookTextFromValue(detail) || guidebookRewardText(reward);
    const rawRewardType = reward?.rewardType ?? reward?.reward_type;
    const rawStatusId = detail?.status_id ?? detail?.statusId
      ?? reward?.status_id ?? reward?.statusId;
    const rawIconType = detail?.icon_type ?? detail?.iconType
      ?? reward?.icon_type ?? reward?.iconType;
    return {
      rewardType: Number.isFinite(Number(rawRewardType))
        ? Number(rawRewardType) : null,
      status_id: Number.isInteger(Number(rawStatusId)) ? Number(rawStatusId) : null,
      icon_type: Number.isInteger(Number(rawIconType)) ? Number(rawIconType) : null,
      name: typeof reward?.name === 'string' ? reward.name : null,
      comment: effectText,
      effectName: reward?.effectName ?? reward?.effect_name ?? null,
      description: typeof reward?.description === 'string'
        ? reward.description : (typeof reward?.text === 'string' ? reward.text : null),
      image: String(reward?.image || ''),
      bookEffetIcon: String(reward?.bookEffetIcon || reward?.bookEffectIcon || ''),
      count: reward?.count ?? null,
      canShowDetail: Boolean(reward?.canShowDetail),
    };
  }

  function serializeGuidebookRewards(reward) {
    const details = guidebookRewardDetailEntries(reward);
    return details.length
      ? details.map(detail => serializeGuidebookReward(reward, detail))
      : [serializeGuidebookReward(reward)];
  }

  function getArcarum3RewardLists(view = window.Game?.view) {
    const candidates = [
      view?.arcarum3RewardList,
      view?.constructor?.arcarum3RewardList,
      view?.content_model?.attributes?.option?.result_data?.arcarum3?.reward_list,
    ];
    return candidates.filter((candidate, index) => (
      Array.isArray(candidate) && candidates.indexOf(candidate) === index
    ));
  }

  function dedupeSerializedGuidebookRewards(rewards) {
    const byName = new Map();
    for (const reward of rewards) {
      const key = String(reward?.comment || '').replace(/\s+/g, ' ').trim();
      if (!key)
        continue;
      const current = byName.get(key);
      if (!current) {
        byName.set(key, reward);
        continue;
      }
      byName.set(key, {
        ...current,
        status_id: reward.status_id ?? current.status_id,
        icon_type: reward.icon_type ?? current.icon_type,
        image: current.image || reward.image,
        bookEffetIcon: current.bookEffetIcon || reward.bookEffetIcon,
        canShowDetail: current.canShowDetail || reward.canShowDetail,
      });
    }
    return [...byName.values()];
  }

  function captureGuidebookEffectsFromView() {
    const view = window.Game?.view;
    const eventCandidates = [];
    const viewEffects = [];
    const rewards = [];
    const eventStatusObjects = new WeakSet();
    const seen = new WeakSet();
    const queue = [{ value: view, depth: 0, path: 'Game.view' }];
    let inspectedObjects = 0;
    const guidebookPathPattern = /(?:sephira.?book|guide.?book|book.?effect|arcarum3.*(?:effect|status)|dungeon.?shop)/i;
    const shopPathPattern = /(?:shop|exchange)/i;
    const effectFromValue = (value, path) => {
      const rawId = value?.status_id ?? value?.statusId
        ?? value?.book_effect_id ?? value?.bookEffectId
        ?? value?.effect_id ?? value?.effectId ?? value?.id;
      const id = Number(rawId);
      const name = String(value?.name ?? value?.comment
        ?? value?.effect_name ?? value?.effectName ?? '').trim();
      if (!name)
        return null;
      return {
        status_id: Number.isInteger(id) && id >= 0 ? id : null,
        name,
        rarity: value?.rarity ?? null,
        icon_category: value?.icon_category ?? value?.iconCategory ?? null,
        icon_type: value?.icon_type ?? value?.iconType ?? null,
        is_duplication_possible: value?.is_duplication_possible
          ?? value?.isDuplicationPossible ?? null,
        deck_condition: value?.deck_condition ?? value?.deckCondition ?? null,
        target_type: value?.target_type ?? value?.targetType ?? null,
        target_param: value?.target_param ?? value?.targetParam ?? null,
        display_ailment_id: value?.display_ailment_id
          ?? value?.displayAilmentId ?? null,
        image: String(value?.image || ''),
        bookEffetIcon: String(value?.bookEffetIcon || value?.bookEffectIcon || ''),
        source_type: shopPathPattern.test(path) ? 'shop_page' : 'effect_confirmation',
        capture_context: path,
      };
    };
    const looksLikeGuidebookViewEffect = (value, path) => {
      if (!value || typeof value !== 'object')
        return false;
      if (eventStatusObjects.has(value) || Number(value?.rewardType) === 4)
        return false;
      const name = String(value?.name ?? value?.comment
        ?? value?.effect_name ?? value?.effectName ?? '').trim();
      if (!name)
        return false;
      const imageText = `${String(value?.image || '')} ${String(
        value?.bookEffetIcon || value?.bookEffectIcon || '',
      )}`;
      const hasBookImage = /(?:sephirabook|book_effect)/i.test(imageText);
      const hasStrongMetadata = value?.rarity !== undefined
        || value?.is_duplication_possible !== undefined
        || value?.isDuplicationPossible !== undefined
        || value?.deck_condition !== undefined
        || value?.deckCondition !== undefined;
      const hasEffectId = value?.status_id !== undefined
        || value?.statusId !== undefined
        || value?.book_effect_id !== undefined
        || value?.bookEffectId !== undefined
        || value?.effect_id !== undefined
        || value?.effectId !== undefined;
      return hasBookImage
        || (guidebookPathPattern.test(path) && (hasEffectId || hasStrongMetadata))
        || (guidebookPathPattern.test(path) && hasStrongMetadata);
    };
    const looksLikeGuidebookStatus = (status) => {
      if (!status || typeof status !== 'object'
        || !String(status?.name || '').trim())
        return false;
      const rawId = status?.status_id ?? status?.statusId;
      if (!Number.isInteger(Number(rawId)) || Number(rawId) < 0)
        return false;
      const metadataCount = [
        status?.rarity,
        status?.icon_category ?? status?.iconCategory,
        status?.icon_type ?? status?.iconType,
        status?.is_duplication_possible ?? status?.isDuplicationPossible,
        status?.deck_condition ?? status?.deckCondition,
      ].filter(item => item !== null && item !== undefined).length;
      return metadataCount >= 2;
    };
    while (queue.length && inspectedObjects < 10000) {
      const { value, depth, path } = queue.pop();
      if (!value || (typeof value !== 'object' && typeof value !== 'function')
        || seen.has(value))
        continue;
      if (typeof Node !== 'undefined' && value instanceof Node)
        continue;
      seen.add(value);
      inspectedObjects += 1;
      try {
        const statuses = value.status_list ?? value.statusList;
        const explicitGuidebookScenario = Number(
          value.action_type ?? value.actionType,
        ) === 401;
        if (Array.isArray(statuses)
          && (explicitGuidebookScenario || statuses.some(looksLikeGuidebookStatus))) {
          for (const status of statuses) {
            if (explicitGuidebookScenario || looksLikeGuidebookStatus(status)) {
              if (status && typeof status === 'object')
                eventStatusObjects.add(status);
              eventCandidates.push({
                status_id: status?.status_id ?? status?.statusId,
                name: String(status?.name || ''),
                rarity: status?.rarity ?? null,
                icon_category: status?.icon_category ?? status?.iconCategory ?? null,
                icon_type: status?.icon_type ?? status?.iconType ?? null,
                is_duplication_possible: status?.is_duplication_possible
                  ?? status?.isDuplicationPossible ?? null,
                deck_condition: status?.deck_condition ?? status?.deckCondition ?? null,
                target_type: status?.target_type ?? status?.targetType ?? null,
                target_param: status?.target_param ?? status?.targetParam ?? null,
                display_ailment_id: status?.display_ailment_id
                  ?? status?.displayAilmentId ?? null,
                candidate_num: value.candidate_num ?? value.candidateNum ?? null,
                select_num_min: value.select_num_min ?? value.selectNumMin ?? null,
                select_num_max: value.select_num_max ?? value.selectNumMax ?? null,
              });
            }
          }
        }
        if (isGuidebookRewardEntry(value) && guidebookRewardText(value))
          rewards.push(...serializeGuidebookRewards(value));
        if (looksLikeGuidebookViewEffect(value, path)) {
          const effect = effectFromValue(value, path);
          if (effect)
            viewEffects.push(effect);
        }
        if (depth >= 10)
          continue;
        for (const key of Reflect.ownKeys(value)) {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          if (!descriptor || !('value' in descriptor))
            continue;
          const child = descriptor.value;
          if (child && (typeof child === 'object' || typeof child === 'function'))
            queue.push({
              value: child,
              depth: depth + 1,
              path: `${path}.${typeof key === 'symbol' ? key.description || 'symbol' : key}`,
            });
        }
      }
      catch {
        // 読み取れない枝だけを飛ばし、残りのGame.viewを探索する。
      }
    }
    const uniqueCandidates = [...new Map(eventCandidates
      .filter(status => status.status_id !== null && status.status_id !== undefined && status.name)
      .map(status => [`${status.status_id}:${status.name}`, status])).values()];
    for (const rewardList of getArcarum3RewardLists(view)) {
      for (const reward of rewardList) {
        if (isGuidebookRewardEntry(reward) && guidebookRewardText(reward))
          rewards.push(...serializeGuidebookRewards(reward));
      }
    }
    if (/#arcarum3\/book(?:$|[/?#])/.test(String(location.href))) {
      const activeBookTabImage = [...document.querySelectorAll(
        'img[src*="/arcarum3/book/tab/btn_"][src*="_on.png"]',
      )].find(image => /btn_(?:unique|rare|normal|cursed)_on\.png(?:$|\?)/.test(
        String(image.currentSrc || image.src || ''),
      ));
      const bookCategory = String(
        activeBookTabImage?.currentSrc || activeBookTabImage?.src || '',
      ).match(/btn_(unique|rare|normal|cursed)_on\.png(?:$|\?)/)?.[1] || null;
      for (const image of document.querySelectorAll(
        'img[src*="/arcarum3/assets/icon_book_effect/"]',
      )) {
        const row = image.parentElement;
        if (!row)
          continue;
        const effectTextElement = [...row.children].find(element => (
          element !== image && element.tagName === 'DIV'
          && String(element.textContent || '').trim()
        ));
        const name = String(effectTextElement?.textContent || '').trim();
        if (!name)
          continue;
        const countMatch = String(row.textContent || '')
          .replace(name, '')
          .match(/×\s*(\d+)/);
        const iconType = String(image.currentSrc || image.src || '')
          .match(/book_effect_(\d+)\.png(?:$|\?)/)?.[1];
        viewEffects.push({
          status_id: null,
          name,
          rarity: null,
          icon_category: null,
          icon_type: iconType === undefined ? null : Number(iconType),
          is_duplication_possible: null,
          deck_condition: null,
          target_type: null,
          target_param: null,
          display_ailment_id: null,
          image: '',
          bookEffetIcon: String(image.currentSrc || image.src || ''),
          count: countMatch ? Number(countMatch[1]) : null,
          book_category: bookCategory,
          is_cursed: bookCategory === 'cursed',
          source_type: 'effect_confirmation',
          capture_context: `DOM:#arcarum3/book:${bookCategory || 'unknown'} img[book_effect_*]`,
        });
      }
    }
    if (/#arcarum3\/dungeon_shop(?:$|[/?#])/.test(String(location.href))) {
      for (const image of document.querySelectorAll(
        '#js-prt-dungeon-shop-content-list '
        + 'img[src*="/arcarum3/assets/icon_book_effect/book_effect_"]',
      )) {
        const row = image.parentElement;
        if (!row)
          continue;
        const effectTextElement = [...row.children].find(element => (
          element !== image && element.tagName === 'DIV'
          && !element.querySelector('img[src*="/dungeon_shop/icon_coin.png"]')
          && String(element.textContent || '').trim()
        ));
        const name = String(effectTextElement?.textContent || '').trim();
        if (!name)
          continue;
        const coinImage = row.querySelector('img[src*="/dungeon_shop/icon_coin.png"]');
        const priceMatch = String(coinImage?.parentElement?.textContent || '')
          .match(/必要セフィラコイン\s*(\d+)/);
        const baseImage = row.querySelector('img[src*="/dungeon_shop/base_book_"]');
        const gradeMatch = String(baseImage?.currentSrc || baseImage?.src || '')
          .match(/base_book_(\d+)\.png(?:$|\?)/);
        const shopPrice = priceMatch ? Number(priceMatch[1]) : null;
        const shopBookGrade = gradeMatch ? Number(gradeMatch[1]) : null;
        const shopBasePrice = shopBookGrade === 1 ? 50 : null;
        viewEffects.push({
          status_id: null,
          name,
          rarity: null,
          icon_category: null,
          icon_type: null,
          is_duplication_possible: null,
          deck_condition: null,
          target_type: null,
          target_param: null,
          display_ailment_id: null,
          image: String(baseImage?.currentSrc || baseImage?.src || ''),
          bookEffetIcon: String(image.currentSrc || image.src || ''),
          count: null,
          shop_price: shopPrice,
          shop_base_price: shopBasePrice,
          shop_discounted: shopPrice !== null && shopBasePrice !== null
            ? shopPrice < shopBasePrice : null,
          shop_premium: shopPrice !== null && shopBasePrice !== null
            ? shopPrice > shopBasePrice : null,
          shop_sold_out: Boolean(
            row.querySelector('img[src*="/dungeon_shop/badge_soldout.png"]'),
          ),
          shop_book_grade: shopBookGrade,
          source_type: 'shop_page',
          capture_context: 'DOM:#arcarum3/dungeon_shop #js-prt-dungeon-shop-content-list',
        });
      }
    }
    const uniqueViewEffects = [...new Map(viewEffects.map(effect => [
      `${effect.status_id ?? ''}:${effect.name}`, effect,
    ])).values()];
    const uniqueRewards = dedupeSerializedGuidebookRewards(rewards);
    return {
      capturedAt: new Date().toISOString(),
      eventCandidates: uniqueCandidates,
      viewEffects: uniqueViewEffects,
      rewards: uniqueRewards,
      inspectedObjects,
    };
  }

  let lastGuidebookPageCaptureSignature = '';
  function emitGuidebookPageCapture() {
    if (!/#arcarum3\/(?:dungeon_shop|book)(?:$|[/?#])/.test(String(location.href)))
      return;
    const capture = captureGuidebookEffectsFromView();
    const payload = {
      kind: 'guidebook_page_capture',
      viewEffects: capture.viewEffects,
      rewards: capture.rewards,
    };
    const signature = JSON.stringify(payload);
    if (signature === lastGuidebookPageCaptureSignature)
      return;
    lastGuidebookPageCaptureSignature = signature;
    if (payload.viewEffects.length || payload.rewards.length)
      emit(payload);
  }

  function inspectOwnPropertyContainer(value, path, maxDepth = 10) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function'))
      return null;
    const result = {
      $type: valueType(value),
      $path: path,
      properties: Object.create(null),
    };
    const seen = new WeakMap();
    seen.set(value, path);
    try {
      for (const rawKey of Reflect.ownKeys(value)) {
        const key = typeof rawKey === 'symbol' ? `[${String(rawKey)}]` : String(rawKey);
        const descriptor = Object.getOwnPropertyDescriptor(value, rawKey);
        if (!descriptor)
          continue;
        if ('value' in descriptor) {
          result.properties[key] = inspectGameValue(
            descriptor.value,
            1,
            maxDepth,
            `${path}.${key}`,
            seen,
          );
        }
        else {
          result.properties[key] = {
            $type: 'accessor',
            get: typeof descriptor.get === 'function',
            set: typeof descriptor.set === 'function',
          };
        }
      }
    }
    catch (error) {
      result.$error = String(error);
    }
    return result;
  }

  function captureGuidebookStorageDiagnostics() {
    const view = window.Game?.view;
    const viewConstructor = view?.constructor;
    const viewPrototype = viewConstructor?.prototype
      || (view ? Object.getPrototypeOf(view) : null);
    const matches = [];
    const seen = new WeakSet();
    const queue = [
      { value: view, path: 'Game.view', depth: 0 },
      { value: viewConstructor, path: 'Game.view.constructor', depth: 0 },
      { value: viewPrototype, path: 'Game.view.constructor.prototype', depth: 0 },
    ];
    const pathPattern = /(?:sephira|book|guide|status|effect|reward|shop|exchange|item|candidate|option|arcarum)/i;
    const textPattern = /(?:導本|自属性|攻撃UP|防御UP|ダメージ|上限|奥義|アビリティ|弱体|回復|sephirabook|book_effect)/i;
    const schemaKeyPattern = /^(?:name|comment|description|text|image|rarity|rewardType|status_id|statusId|effect_id|effectId|book_effect_id|bookEffectId|icon_category|iconCategory|icon_type|iconType)$/;
    let inspectedObjects = 0;
    const addMatch = (path, reason, value, keys = []) => {
      if (matches.length >= 2000)
        return;
      let preview;
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value))
        preview = value;
      else if (value && typeof value === 'object'
        && !(typeof Node !== 'undefined' && value instanceof Node))
        preview = inspectGameValue(value, 0, 4, path, new WeakMap());
      matches.push({
        path,
        reason,
        type: valueType(value),
        keys: keys.slice(0, 80),
        preview,
      });
    };
    while (queue.length && inspectedObjects < 30000) {
      const { value, path, depth } = queue.pop();
      if (!value || (typeof value !== 'object' && typeof value !== 'function')
        || seen.has(value))
        continue;
      if (typeof Node !== 'undefined' && value instanceof Node)
        continue;
      seen.add(value);
      inspectedObjects += 1;
      let rawKeys;
      try {
        rawKeys = Reflect.ownKeys(value);
      }
      catch {
        continue;
      }
      const keys = rawKeys.map(key => (
        typeof key === 'symbol' ? `[${String(key)}]` : String(key)
      ));
      const schemaKeys = keys.filter(key => schemaKeyPattern.test(key));
      if (pathPattern.test(path))
        addMatch(path, 'path-keyword', value, keys);
      else if (schemaKeys.length >= 2)
        addMatch(path, `guidebook-like-schema:${schemaKeys.join(',')}`, value, keys);
      if (depth >= 14)
        continue;
      for (let index = 0; index < rawKeys.length; index += 1) {
        const rawKey = rawKeys[index];
        const key = keys[index];
        let descriptor;
        try {
          descriptor = Object.getOwnPropertyDescriptor(value, rawKey);
        }
        catch {
          continue;
        }
        const childPath = `${path}.${key}`;
        if (!descriptor || !('value' in descriptor)) {
          if (pathPattern.test(childPath))
            addMatch(childPath, 'keyword-accessor', null);
          continue;
        }
        const child = descriptor.value;
        if (typeof child === 'string' && textPattern.test(child))
          addMatch(childPath, 'effect-like-text', child);
        else if (pathPattern.test(key)
          && (child === null || !['object', 'function'].includes(typeof child)))
          addMatch(childPath, 'keyword-property', child);
        if (child && (typeof child === 'object' || typeof child === 'function')) {
          queue.push({
            value: child,
            path: childPath,
            depth: depth + 1,
          });
        }
      }
    }
    const pageHtml = String(document.documentElement?.outerHTML || '');
    const htmlLimit = 1000000;
    const describeElement = (element, index) => {
      const images = [...element.querySelectorAll('img')].map(image => ({
        src: String(image.currentSrc || image.src || ''),
        className: String(image.className || ''),
      }));
      const ancestry = [];
      let parent = element;
      for (let depth = 0; parent && depth < 8; depth += 1, parent = parent.parentElement) {
        ancestry.push({
          tagName: String(parent.tagName || ''),
          id: String(parent.id || ''),
          className: String(parent.className || ''),
        });
      }
      const outerHTML = String(element.outerHTML || '');
      return {
        index,
        text: String(element.textContent || '').replace(/\s+/g, ' ').trim(),
        className: String(element.className || ''),
        images,
        ancestry,
        outerHTML: outerHTML.slice(0, 12000),
        outerHTMLLength: outerHTML.length,
        outerHTMLTruncated: outerHTML.length > 12000,
      };
    };
    const guidebookListItems = [...document.querySelectorAll('#root li')]
      .slice(0, 5000)
      .map(describeElement);
    const guidebookImages = [...document.querySelectorAll('img')]
      .filter(image => /(?:arcarum3\/book|icon_book_effect|curse|cursed)/i.test(
        String(image.currentSrc || image.src || ''),
      ))
      .slice(0, 5000)
      .map((image, index) => ({
        index,
        src: String(image.currentSrc || image.src || ''),
        className: String(image.className || ''),
        parentText: String(image.parentElement?.textContent || '')
          .replace(/\s+/g, ' ').trim().slice(0, 3000),
        parentHTML: String(image.parentElement?.outerHTML || '').slice(0, 12000),
      }));
    return {
      capturedAt: new Date().toISOString(),
      source: 'window.Game.view + constructor/prototype + current page DOM',
      page: {
        url: String(location.href),
        title: String(document.title || ''),
        html: pageHtml.slice(0, htmlLimit),
        htmlLength: pageHtml.length,
        htmlTruncated: pageHtml.length > htmlLimit,
      },
      limits: {
        snapshotDepth: 12,
        pathIndexDepth: 14,
        inspectedObjectLimit: 30000,
        matchLimit: 2000,
        htmlCharacterLimit: htmlLimit,
      },
      inspectedObjects,
      matchCount: matches.length,
      matches,
      guidebookDomInventory: {
        listItemCount: guidebookListItems.length,
        listItems: guidebookListItems,
        imageCount: guidebookImages.length,
        images: guidebookImages,
      },
      snapshots: {
        view: inspectGameValue(view, 0, 12, 'Game.view', new WeakMap()),
        viewConstructor: inspectOwnPropertyContainer(
          viewConstructor,
          'Game.view.constructor',
          10,
        ),
        viewPrototype: inspectOwnPropertyContainer(
          viewPrototype,
          'Game.view.constructor.prototype',
          8,
        ),
      },
    };
  }

  document.addEventListener(requestEventName, (event) => {
    if (!(event instanceof CustomEvent) || typeof event.detail !== 'string')
      return;
    let request;
    try {
      request = JSON.parse(event.detail);
    }
    catch {
      return;
    }
    if (request?.kind !== 'inspect_game_view_nodes'
      && request?.kind !== 'capture_route_state'
      && request?.kind !== 'capture_miasma_analysis'
      && request?.kind !== 'capture_guidebook_effects'
      && request?.kind !== 'inspect_guidebook_storage')
      return;
    try {
      if (request.kind === 'inspect_guidebook_storage') {
        emit({
          kind: 'guidebook_diagnostics',
          requestId: request.requestId,
          diagnostics: captureGuidebookStorageDiagnostics(),
        });
        return;
      }
      if (request.kind === 'capture_guidebook_effects') {
        emit({
          kind: 'guidebook_capture',
          requestId: request.requestId,
          capture: captureGuidebookEffectsFromView(),
        });
        return;
      }
      if (request.kind === 'capture_miasma_analysis') {
        emit({
          kind: 'miasma_analysis',
          requestId: request.requestId,
          analysis: captureMiasmaAnalysis(),
        });
        return;
      }
      if (request.kind === 'capture_route_state') {
        emit({
          kind: 'route_state',
          requestId: request.requestId,
          routeState: captureRoutePlanningState(),
        });
        return;
      }
      emit({
        kind: 'node_inspection',
        requestId: request.requestId,
        inspection: captureGameViewNodes(),
      });
    }
    catch (error) {
      emit({
        kind: request.kind === 'capture_route_state'
          ? 'route_state'
          : (request.kind === 'capture_miasma_analysis'
            ? 'miasma_analysis'
            : (request.kind === 'capture_guidebook_effects'
              ? 'guidebook_capture'
              : (request.kind === 'inspect_guidebook_storage'
                ? 'guidebook_diagnostics' : 'node_inspection'))),
        requestId: request.requestId,
        error: String(error),
      });
    }
  });

  function readFrontFormation() {
    const data = window.Game?.view?.setupView?.pJsnData;
    const params = data?.player?.param;
    if (!Array.isArray(params))
      return null;
    const rawFormation = Array.isArray(data.formation)
      ? data.formation
      : Object.values(data.formation || {});
    const formation = rawFormation
      .map(Number)
      .filter(index => Number.isInteger(index) && index >= 0 && index < params.length);
    if (formation.length === 0)
      return null;
    return formation;
  }

  function emitFrontFormation() {
    const formation = readFrontFormation();
    if (formation)
      emit({ kind: 'front_formation', formation });
  }

  let lastRewardListSignature = '';
  function emitArcarum3GuidebookRewards() {
    const rewardLists = getArcarum3RewardLists();
    if (!rewardLists.length)
      return;
    const rewards = rewardLists.flat();
    const signature = JSON.stringify(rewards.map(reward => ([
      reward?.rewardType ?? reward?.reward_type,
      reward?.comment,
      reward?.name,
      reward?.effectName,
      reward?.effect_name,
      reward?.description,
      reward?.detail,
      reward?.text,
      reward?.image,
      reward?.bookEffetIcon,
      reward?.bookEffectIcon,
      reward?.count,
    ])));
    if (signature === lastRewardListSignature)
      return;
    lastRewardListSignature = signature;
    const guidebookRewards = dedupeSerializedGuidebookRewards(rewards.flatMap(reward => (
      isGuidebookRewardEntry(reward) && guidebookRewardText(reward)
        ? serializeGuidebookRewards(reward) : []
    )));
    if (guidebookRewards.length)
      emit({ kind: 'guidebook_rewards', rewards: guidebookRewards });
  }

  function safelyEmitArcarum3GuidebookRewards() {
    try {
      emitArcarum3GuidebookRewards();
    }
    catch {
      // リザルト画面の切替途中でGame.viewが変化した場合は次回監視で再試行する。
    }
  }

  let lastRouteFieldResyncSignature = '';
  function emitRouteFieldResync() {
    if (!/#arcarum3\/dungeon(?:\/|$)/.test(String(location.href)))
      return;
    const routeState = captureRoutePlanningState();
    if (!routeState.nodes.length || routeState.currentNodeId === null)
      return;
    const nodeStateSignature = routeState.nodes.map(node => [
      node.id,
      node.type,
      node.specialType,
      Boolean(node.isVisited),
      Boolean(node.isShrinking),
    ]);
    const signature = JSON.stringify([
      routeState.mapId,
      routeState.currentNodeId,
      routeState.totalTurn,
      nodeStateSignature,
      routeState.miasma.active,
      routeState.miasma.level,
      routeState.miasma.status,
      routeState.miasma.step,
      routeState.miasma.remainTurn,
      routeState.miasma.basePatternId,
      routeState.miasma.patternId,
      routeState.miasma.centerX,
      routeState.miasma.centerY,
      routeState.miasma.circlePositionX,
      routeState.miasma.circlePositionY,
      routeState.miasma.circleRadius,
    ]);
    if (signature === lastRouteFieldResyncSignature)
      return;
    lastRouteFieldResyncSignature = signature;
    emit({
      kind: 'route_field_resync',
      capturedAt: routeState.capturedAt,
      routeState,
    });
  }

  function safelyEmitRouteFieldResync() {
    try {
      emitRouteFieldResync();
    }
    catch {
      // Game.view is replaced while leaving battle/result views. Retry on the next poll.
    }
  }

  // リザルトの描画完了はAjax完了から700ms以上遅れる場合がある。
  // 同一配列・同一内容はemit側で除外するため、常時監視して時間窓による取得漏れを防ぐ。
  setInterval(safelyEmitArcarum3GuidebookRewards, 250);
  setInterval(safelyEmitRouteFieldResync, 250);
  window.addEventListener('pageshow', safelyEmitArcarum3GuidebookRewards);
  window.addEventListener('pageshow', safelyEmitRouteFieldResync);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      safelyEmitArcarum3GuidebookRewards();
      safelyEmitRouteFieldResync();
    }
  });

  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket && !window.__gbfBattleMonitorWebSocketHooked) {
    window.__gbfBattleMonitorWebSocketHooked = true;
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, args, newTarget) {
        const socket = Reflect.construct(target, args, newTarget);
        socket.addEventListener('message', (event) => {
          if (typeof event.data !== 'string' || !event.data.startsWith('42'))
            return;
          try {
            const packet = JSON.parse(event.data.slice(2));
            if (Array.isArray(packet) && packet[1])
              emit({ kind: 'websocket', responseData: packet[1] });
          }
          catch {
            // 対象外のSocket.IOフレームは無視する。
          }
        });
        return socket;
      },
    });
  }

  let attempts = 0;
  const timer = setInterval(() => {
    try {
      const jq = window.jQuery || window.$;
      if (typeof jq === 'function' && typeof jq(document).ajaxSuccess === 'function') {
        clearInterval(timer);
        jq(document).ajaxSuccess((_event, _xhr, settings, data) => {
          emit({
            kind: 'ajax',
            url: settings?.url || '',
            requestData: settings?.data,
            responseData: data,
          });
          setTimeout(() => {
            emitFrontFormation();
            emitMiasmaVisualSnapshot(settings?.url || '', data);
          }, 0);
          safelyEmitArcarum3GuidebookRewards();
          for (const delay of [0, 100, 300, 700])
            setTimeout(safelyEmitArcarum3GuidebookRewards, delay);
          if (/#arcarum3\/(?:dungeon_shop|book)(?:$|[/?#])/.test(String(location.href))) {
            for (const delay of [0, 250, 750])
              setTimeout(emitGuidebookPageCapture, delay);
          }
        });
        emitFrontFormation();
        safelyEmitArcarum3GuidebookRewards();
        return;
      }
    }
    catch {
      // jQueryの初期化完了まで再試行する。
    }
    attempts += 1;
    if (attempts > 200)
      clearInterval(timer);
  }, 50);
})();
