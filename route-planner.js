(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports)
    module.exports = api;
  root.GbfRoutePlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const TYPE_LABELS = {
    0: '空白', 1: 'ボス', 2: '戦闘', 3: '強敵', 4: '君臨者', 5: 'イベント',
    6: '宝箱', 7: '回復', 8: 'ショップ', 9: '転移', 10: '特殊', 11: '超強敵',
  };
  const DANGER_TYPES = new Set([3, 4, 11]);
  const FIRST_SHRINK_DAMAGE_PERCENT = 5;
  const FIRST_SHRINK_COMPLETE_DAMAGE_PERCENT = 15;
  const SECOND_SHRINK_HP_RESERVE_PERCENT = 85;
  const SECOND_SHRINK_MIN_ABSOLUTE_HP = 60000;
  const SECOND_SHRINK_BOSS_ARRIVAL_BUFFER_TURNS = 5;
  const SECOND_SHRINK_DURATION_TURNS = 20;
  const FIRST_SHRINK_SAFE_ARRIVAL_BUFFER_TURNS = 5;
  const MAX_LEADING_VALUE_TURNS = 4;
  const FIRST_SHRINK_FALLBACK_RADIUS = 670;
  const FIRST_SHRINK_PATTERN_MODELS = [
    {
      mapId: 4,
      basePatternId: 3,
      patternId: 1,
      finalCenter: { x: 867.9, y: 1000.5 },
      radiusIntercept: 1655.9043615,
      radiusPerStep: -9.89789339,
      sourceLog: '2026-07-22T14-38-44-345Z',
    },
    {
      mapId: null,
      basePatternId: 1,
      patternId: 1,
      finalCenter: { x: 843, y: 629 },
      radiusIntercept: 1600,
      radiusPerStep: -9.25,
      finalRadius: 650,
      sourceLog: 'map-1-and-map-3-shared-1-1',
    },
  ];
  const CONFIRMED_FIXED_SPECIAL_EVENTS = [
    {
      x: 989, y: 648, eventId: 9,
      key: 'four-zero-turn-battles', priority: 'day-two-very-high', value: 2,
      firstDayValue: 0,
      battleEquivalent: 4,
      processingTurnOptions: [0],
    },
    {
      x: 813, y: 332, eventId: 10,
      key: 'full-recovery-and-fixed-guidebook', priority: 'high', value: 1,
      processingTurnOptions: [0],
    },
    {
      x: 1832, y: 350, eventId: 11,
      key: 'prison-key-reward', priority: 'conditional', value: 0,
      condition: { stateField: 'prisonKeyCount', minimum: 1 },
      conditionMetPriority: 'very-high',
      conditionMetValue: 2,
      currencyEquivalent: 500,
      conditionUnknownValue: 0,
      conditionMetRewards: ['currency-equivalent-500', 'highest-rarity-guidebook-effect'],
      conditionNotMetOutcome: 'probability-or-defeat-strong-enemy',
      processingTurnOptions: null,
    },
    {
      x: 2052, y: 617, eventId: 13,
      key: 'currency-or-guidebook-exchange', priority: 'very-high', value: 2,
      // Choice 1 consumes three turns for 600 currency. Choice 2 is the
      // zero-stated-turn high-value fallback used for route feasibility.
      processingTurnOptions: [3, 0],
    },
    {
      x: 910, y: 1419, eventId: 14,
      key: 'strong-enemy-companion-or-guidebook',
      priority: 'day-two-very-high',
      value: 2,
      firstDayValue: 0,
      treatAsDanger: true,
      battleEquivalent: 1,
      minimumProcessingTurns: 1,
      currencyEquivalent: 300,
      rewardOptions: ['companion-currency-equivalent-300', 'highest-rarity-guidebook-effect'],
      outcome: 'defeat-strong-enemy-then-select-reward',
      processingTurnOptions: null,
    },
    {
      x: 1597, y: 1062, eventId: 16,
      key: 'multi-turn-cave-exploration', priority: 'day-two-high', value: 1,
      firstDayValue: 0,
      treatAsDanger: true,
      condition: { stateField: 'event16ItemCount', minimum: 1 },
      conditionMetValue: 1,
      conditionUnknownValue: 1,
      minimumProcessingTurns: 2,
      risk: 'possible-consecutive-strong-enemy-battles',
      withoutItemOutcome: 'repeat-battles-on-one-node',
      withItemOutcome: 'forced-item-use-with-random-battle-skip-and-more-currency',
      processingTurnOptions: null,
    },
    {
      x: 1543, y: 1331, eventId: 17,
      key: 'three-strong-enemy-battles',
      priority: 'day-two-higher-than-danger',
      value: 3,
      firstDayValue: 0,
      treatAsDanger: true,
      battleEquivalent: 3,
      minimumProcessingTurns: 3,
      outcome: 'defeat-three-strong-enemies',
      processingTurnOptions: null,
    },
    {
      x: 2396, y: 1466, eventId: 18,
      key: 'strong-enemy-discount-shop', priority: 'currency-conditional', value: 0,
      firstDayValue: 0,
      treatAsDanger: true,
      battleEquivalent: 1,
      minimumProcessingTurns: 1,
      shopDiscountPercent: 20,
      currencyValueFormula: { minimum: 500, base: 2, interval: 500 },
      outcome: 'defeat-strong-enemy-then-open-discount-shop',
      processingTurnOptions: null,
    },
  ];
  const NODE_VISUALS = {
    0: { key: 'empty', icon: '·', label: '空白' },
    1: { key: 'boss', icon: '🐉', label: 'ボス' },
    2: { key: 'battle', icon: '⚔️', label: '戦闘' },
    3: { key: 'strong', icon: '🐺', label: '強敵' },
    4: { key: 'ruler', icon: '🐉', label: '君臨者' },
    5: { key: 'event', icon: '❓', label: 'イベント' },
    6: { key: 'treasure', icon: '🧰', label: '宝箱' },
    7: { key: 'heal', icon: '💊', label: '回復' },
    8: { key: 'shop', icon: '💰', label: 'ショップ' },
    9: { key: 'warp', icon: '💎', label: '転移' },
    11: { key: 'super-strong', icon: '🦁', label: '超強敵' },
  };
  const SPECIAL_VISUALS = {
    1: { key: 'cult-leader', icon: '👹', label: '邪教祖' },
    2: { key: 'fanatic', icon: '🎭', label: '狂信者' },
    3: { key: 'fanatic', icon: '🎭', label: '狂信者' },
    4: { key: 'floating-castle-body', icon: '🏰', label: '浮遊城本体' },
    5: { key: 'floating-castle', icon: '🏰', label: '浮遊城への転移' },
    6: { key: 'floating-castle', icon: '🏰', label: '浮遊城への転移' },
    7: { key: 'floating-castle', icon: '🏰', label: '浮遊城への転移' },
    8: { key: 'researcher', icon: '📄', label: '浮遊城の研究者' },
  };

  const numberOrNull = value => value === null || value === undefined || value === ''
    ? null
    : (Number.isFinite(Number(value)) ? Number(value) : null);
  const pick = (value, ...keys) => {
    for (const key of keys) {
      if (value?.[key] !== undefined && value[key] !== null)
        return value[key];
    }
    return null;
  };

  function normalizeNode(node) {
    const id = numberOrNull(pick(node, 'id', 'nodeId', 'node_id'));
    if (id === null)
      return null;
    const adjacent = pick(node, 'adjacentIds', 'adjacentNodeIds', 'adjacent_node_ids');
    const specialIncidentId = numberOrNull(pick(node, 'specialIncidentId', 'special_incident_id'));
    return {
      id,
      x: numberOrNull(pick(node, 'x', 'positionX', 'position_x')),
      y: numberOrNull(pick(node, 'y', 'positionY', 'position_y')),
      type: numberOrNull(pick(node, 'type', 'nodeType', 'node_type')) ?? 0,
      specialType: numberOrNull(pick(node, 'specialType', 'specialNodeType', 'special_node_type'))
        ?? specialIncidentId,
      adjacentIds: (Array.isArray(adjacent) ? adjacent : [])
        .map(Number).filter(Number.isFinite),
      isVisited: Boolean(pick(node, 'isVisited', 'is_visited')),
      isShrinking: Boolean(pick(node, 'isShrinking', 'is_shrinking')),
      isQuestCheck: Boolean(pick(node, 'isQuestCheck', 'is_quest_check')),
      isPassedDanger: Boolean(pick(node, 'isPassedDanger', 'is_passed_danger')),
      specialIncidentId,
    };
  }

  function normalizeState(input) {
    const nodes = (Array.isArray(input?.nodes) ? input.nodes : [])
      .map(normalizeNode).filter(Boolean);
    const miasma = input?.miasma || {};
    const rawFirstShrinkCircle = input?.firstShrinkFinalCircle
      || miasma.firstShrinkFinalCircle
      || null;
    const rawFirstShrinkCenter = rawFirstShrinkCircle?.center || {};
    const firstShrinkCenterX = numberOrNull(
      pick(rawFirstShrinkCenter, 'x') ?? pick(rawFirstShrinkCircle, 'centerX', 'center_x'),
    );
    const firstShrinkCenterY = numberOrNull(
      pick(rawFirstShrinkCenter, 'y') ?? pick(rawFirstShrinkCircle, 'centerY', 'center_y'),
    );
    const firstShrinkRadius = numberOrNull(pick(rawFirstShrinkCircle, 'radius'));
    const firstShrinkFinalCircle = firstShrinkCenterX !== null
      && firstShrinkCenterY !== null
      && firstShrinkRadius !== null
      && firstShrinkRadius > 0
      ? {
          center: { x: firstShrinkCenterX, y: firstShrinkCenterY },
          radius: firstShrinkRadius,
          capturedAt: rawFirstShrinkCircle?.capturedAt || null,
          source: rawFirstShrinkCircle?.source || 'saved-first-shrink-circle',
          modelKey: rawFirstShrinkCircle?.modelKey || null,
          mapId: numberOrNull(rawFirstShrinkCircle?.mapId),
          basePatternId: numberOrNull(rawFirstShrinkCircle?.basePatternId),
          patternId: numberOrNull(rawFirstShrinkCircle?.patternId),
          dayIndex: numberOrNull(rawFirstShrinkCircle?.dayIndex),
        }
      : null;
    const prisonKeyCountValue = pick(
      input, 'prisonKeyCount', 'prison_key_count', 'jailKeyCount', 'jail_key_count',
    );
    const hasPrisonKeyValue = pick(input, 'hasPrisonKey', 'has_prison_key');
    const prisonKeyCount = numberOrNull(prisonKeyCountValue)
      ?? (hasPrisonKeyValue === null ? null : (Boolean(hasPrisonKeyValue) ? 1 : 0));
    const event16ItemCountValue = pick(
      input, 'event16ItemCount', 'event_16_item_count', 'caveEventItemCount',
      'cave_event_item_count',
    );
    const hasEvent16ItemValue = pick(input, 'hasEvent16Item', 'has_event_16_item');
    const event16ItemCount = numberOrNull(event16ItemCountValue)
      ?? (hasEvent16ItemValue === null ? null : (Boolean(hasEvent16ItemValue) ? 1 : 0));
    const firstShrinkLearnedModels = (Array.isArray(input?.firstShrinkLearnedModels)
      ? input.firstShrinkLearnedModels : [])
      .map(model => {
        const centerX = numberOrNull(model?.finalCenter?.x ?? model?.center?.x);
        const centerY = numberOrNull(model?.finalCenter?.y ?? model?.center?.y);
        const finalRadius = numberOrNull(model?.finalRadius ?? model?.radius);
        const radiusIntercept = numberOrNull(model?.radiusIntercept ?? model?.startRadius);
        if (centerX === null || centerY === null || finalRadius === null || finalRadius <= 0)
          return null;
        return {
          key: String(model?.key || ''),
          mapId: numberOrNull(model?.mapId),
          basePatternId: numberOrNull(model?.basePatternId),
          patternId: numberOrNull(model?.patternId),
          dayIndex: numberOrNull(model?.dayIndex),
          finalCenter: { x: centerX, y: centerY },
          finalRadius,
          radiusIntercept: radiusIntercept !== null && radiusIntercept > 0
            ? radiusIntercept : null,
          radiusPerStep: numberOrNull(model?.radiusPerStep),
          observationCount: Math.max(0, Number(model?.observationCount) || 0),
          updatedAt: model?.updatedAt || model?.lastObservedAt || null,
        };
      })
      .filter(Boolean);
    return {
      capturedAt: input?.capturedAt || null,
      currentNodeId: numberOrNull(pick(input, 'currentNodeId', 'current_node_id', 'pieceNodeId')),
      totalTurn: numberOrNull(pick(input, 'totalTurn', 'total_turn', 'elapsedTurn')) ?? 0,
      currency: numberOrNull(pick(input, 'currency', 'possession_arcarum3_dungeon_point', 'dungeonShopPoint')) ?? 0,
      mapId: numberOrNull(pick(input, 'mapId', 'map_id')),
      dungeonStatus: numberOrNull(pick(input, 'dungeonStatus', 'dungeon_status')),
      dayOneBossDefeated: Boolean(pick(input, 'dayOneBossDefeated', 'day_one_boss_defeated')),
      prisonKeyCount,
      event16ItemCount,
      warpDeclinedAtNodeId: numberOrNull(pick(input, 'warpDeclinedAtNodeId')),
      firstShrinkFinalCircle,
      firstShrinkLearnedModels,
      partyMembers: (Array.isArray(input?.partyMembers) ? input.partyMembers : [])
        .map((member, index) => ({
          index,
          hp: numberOrNull(pick(member, 'hp')),
          maxHp: numberOrNull(pick(member, 'maxHp', 'max_hp')),
          isPc: Boolean(pick(member, 'isPc', 'is_pc')),
          imageId: pick(member, 'imageId', 'image_id'),
          userNpcId: pick(member, 'userNpcId', 'user_npc_id'),
        }))
        .filter(member => member.hp !== null && member.maxHp !== null && member.maxHp > 0),
      miasmaDamageRates: Object.fromEntries(Object.entries(input?.miasmaDamageRates || {})
        .map(([stage, rate]) => [stage, numberOrNull(rate)])
        .filter(([, rate]) => rate !== null && rate > 0)),
      nodes,
      miasma: {
        active: Boolean(pick(miasma, 'active', 'isActive', 'is_miasmic')),
        level: numberOrNull(pick(miasma, 'level')),
        status: numberOrNull(pick(miasma, 'status')),
        step: numberOrNull(pick(miasma, 'step')),
        remainTurn: numberOrNull(pick(miasma, 'remainTurn', 'miasma_stop_countdown')),
        patternId: numberOrNull(pick(miasma, 'patternId', 'pattern_id')),
        basePatternId: numberOrNull(pick(miasma, 'basePatternId', 'base_pattern_id')),
        centerX: numberOrNull(pick(miasma, 'centerX', 'center_position_x')),
        centerY: numberOrNull(pick(miasma, 'centerY', 'center_position_y')),
        circlePositionX: numberOrNull(pick(miasma, 'circlePositionX', 'circle_position_x')),
        circlePositionY: numberOrNull(pick(miasma, 'circlePositionY', 'circle_position_y')),
        circleCenterX: numberOrNull(pick(miasma, 'circleCenterX', 'circle_center_x')),
        circleCenterY: numberOrNull(pick(miasma, 'circleCenterY', 'circle_center_y')),
        circleRadius: numberOrNull(pick(miasma, 'circleRadius', 'circle_radius')),
        circleGeometrySource: pick(miasma, 'circleGeometrySource', 'circle_geometry_source') || null,
        circleImage: pick(miasma, 'circleImage', 'circle_image') || null,
        bossNodeId: numberOrNull(pick(miasma, 'bossNodeId', 'targetNodeId')),
      },
    };
  }

  function nodeVisual(node) {
    if (node?.type === 10)
      return SPECIAL_VISUALS[node.specialType]
        || { key: 'special-event', icon: '❓', label: '特殊イベント' };
    return NODE_VISUALS[node?.type]
      || { key: 'unknown', icon: '·', label: TYPE_LABELS[node?.type] || '不明' };
  }

  function confirmedFixedSpecialEvent(node, mapId) {
    if (node?.type !== 10)
      return null;
    const eventId = numberOrNull(node.specialIncidentId ?? node.specialType);
    return CONFIRMED_FIXED_SPECIAL_EVENTS.find(event => (
      node.x === event.x
      && node.y === event.y
      && (eventId === null || eventId === event.eventId)
    )) || null;
  }

  function fixedSpecialEventValue(event, state) {
    if (!event)
      return 0;
    if (dangerPhase(state) === 'first-day' && event.firstDayValue !== undefined)
      return Number(event.firstDayValue) || 0;
    const condition = event.condition;
    let value;
    if (!condition)
      value = event.value ?? 1;
    else {
      const observed = numberOrNull(state?.[condition.stateField]);
      if (observed === null)
        value = event.conditionUnknownValue ?? event.value ?? 0;
      else {
        value = observed >= Number(condition.minimum ?? 1)
          ? (event.conditionMetValue ?? event.value ?? 1)
          : (event.value ?? 0);
      }
    }
    const currency = Math.max(0, Number(state?.currency) || 0);
    const formula = event.currencyValueFormula;
    const formulaMinimum = Number(formula?.minimum);
    const formulaBase = Number(formula?.base);
    const formulaInterval = Number(formula?.interval);
    const currencyBonus = formula
      && Number.isFinite(formulaMinimum)
      && Number.isFinite(formulaBase) && formulaBase > 0
      && Number.isFinite(formulaInterval) && formulaInterval > 0
      && currency >= formulaMinimum
      ? formulaBase ** ((currency - formulaMinimum) / formulaInterval)
      : 0;
    return value + currencyBonus;
  }

  function isFanaticNode(node) {
    return node?.type === 10 && (node.specialType === 2 || node.specialType === 3);
  }

  function isCultLeaderNode(node) {
    return node?.type === 10 && node.specialType === 1;
  }

  function isFloatingCastleTransferNode(node) {
    return node?.type === 10 && [5, 6, 7].includes(node.specialType);
  }

  function isFloatingCastleBodyNode(node, nodes = []) {
    if (node?.type !== 10)
      return false;
    const knownPosition = Number(node.specialType) === 4
      && Number(node.x) === 346
      && Number(node.y) === 292;
    if (knownPosition)
      return true;
    const ownConnections = Array.isArray(node.adjacentIds) ? node.adjacentIds : [];
    const inboundConnection = (Array.isArray(nodes) ? nodes : []).some(other => (
      other?.id !== node.id
      && Array.isArray(other?.adjacentIds)
      && other.adjacentIds.includes(node.id)
    ));
    return ownConnections.length === 0 && !inboundConnection;
  }

  function isFloatingCastleResearcherNode(node) {
    return node?.type === 10 && node.specialType === 8;
  }

  function isFloatingCastleTransferRisky(state) {
    if (!state?.miasma?.active)
      return false;
    const level = Number(state.miasma.level);
    const status = Number(state.miasma.status);
    const remainTurn = Number(state.miasma.remainTurn);
    const firstShrinkClosing = level === 1 && status === 1
      && Number.isFinite(remainTurn) && remainTurn <= 10;
    const secondShrink = level >= 2 || status >= 3;
    return firstShrinkClosing || secondShrink;
  }

  function hasPostCultLeaderValueRoute(graph, leaderId, previousId, visited) {
    const seen = new Set();
    const queue = [...(graph.adjacency.get(leaderId) || [])]
      .filter(id => id !== previousId)
      .map(id => ({ id, consecutiveBlanks: 0 }));
    while (queue.length) {
      const current = queue.shift();
      const node = graph.byId.get(current.id);
      if (!node)
        continue;
      const consecutiveBlanks = node.type === 0 ? current.consecutiveBlanks + 1 : 0;
      if (consecutiveBlanks > 2)
        continue;
      const stateKey = `${current.id}:${consecutiveBlanks}`;
      if (seen.has(stateKey))
        continue;
      seen.add(stateKey);
      if (!visited.has(current.id) && node.type !== 0)
        return true;
      for (const next of graph.adjacency.get(current.id) || []) {
        if (next !== leaderId && next !== previousId)
          queue.push({ id: next, consecutiveBlanks });
      }
    }
    return false;
  }

  function isBridgeEdge(graph, fromId, toId) {
    const queue = [toId];
    const seen = new Set([toId]);
    while (queue.length) {
      const id = queue.shift();
      for (const next of graph.adjacency.get(id) || []) {
        if ((id === fromId && next === toId) || (id === toId && next === fromId))
          continue;
        if (next === fromId)
          return false;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return true;
  }

  function simulateFirstShrinkArea(input) {
    const state = normalizeState(input);
    const positioned = (state.nodes || []).filter(node => node.x !== null && node.y !== null);
    if (!positioned.length)
      return null;
    const dayIndex = state.dayOneBossDefeated ? 2 : 1;
    const learnedModel = state.firstShrinkLearnedModels.find(item => (
      (item.mapId === null || item.mapId === state.mapId)
      && (item.basePatternId === null || item.basePatternId === state.miasma.basePatternId)
      && (item.patternId === null || item.patternId === state.miasma.patternId)
      && (item.dayIndex === null || item.dayIndex === dayIndex)
    ));
    const registeredModel = FIRST_SHRINK_PATTERN_MODELS.find(item => (
      item.mapId === state.mapId
      && item.basePatternId === state.miasma.basePatternId
      && item.patternId === state.miasma.patternId
    )) || FIRST_SHRINK_PATTERN_MODELS.find(item => (
      item.mapId === null
      && item.basePatternId === state.miasma.basePatternId
      && item.patternId === state.miasma.patternId
    ));
    const xs = positioned.map(node => node.x);
    const ys = positioned.map(node => node.y);
    const startCenter = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    const estimatedModel = learnedModel || registeredModel
      ? null : estimatedFirstShrinkModel(state, positioned, startCenter);
    const model = learnedModel || registeredModel || estimatedModel;
    if (!model)
      return null;
    const finalCenter = {
      x: model.finalCenter.x,
      y: model.finalCenter.y,
    };
    const maximumStartDistance = Math.max(...positioned.map(node => (
      Math.hypot(node.x - startCenter.x, node.y - startCenter.y)
    )));
    const startRadius = Number(model.radiusIntercept) > 0
      ? Number(model.radiusIntercept)
      : Math.max(Number(model.finalRadius) || FIRST_SHRINK_FALLBACK_RADIUS,
        maximumStartDistance + 50);
    const step = Math.min(100, Math.max(0, Number(state.miasma.step) || 0));
    const progress = step / 100;
    const currentCenter = {
      x: startCenter.x + (finalCenter.x - startCenter.x) * progress,
      y: startCenter.y + (finalCenter.y - startCenter.y) * progress,
    };
    const completedFirstShrink = step >= 100
      || (state.miasma.level === 1 && state.miasma.status === 2);
    const finalRadius = model.finalRadius
      ?? (startRadius + model.radiusPerStep * 100);
    const radiusPerStep = numberOrNull(model.radiusPerStep)
      ?? ((finalRadius - startRadius) / 100);
    const currentRadius = completedFirstShrink
      ? finalRadius
      : startRadius + radiusPerStep * step;
    const simulatedMiasmaIds = [];
    for (const node of positioned) {
      if (Math.hypot(node.x - currentCenter.x, node.y - currentCenter.y) > currentRadius)
        simulatedMiasmaIds.push(node.id);
    }
    return {
      source: learnedModel
        ? 'learned-node-boundary-model'
        : (registeredModel ? 'registered-log-model' : 'limit-circle-estimate'),
      sourceLog: model.sourceLog || null,
      modelKey: learnedModel?.key
        || (registeredModel
          ? `${model.mapId ?? '*'}:${model.basePatternId}:${model.patternId}`
          : model.key),
      observationCount: learnedModel?.observationCount || 0,
      step,
      progress,
      startCenter,
      currentCenter,
      finalCenter,
      startRadius,
      currentRadius,
      finalRadius,
      simulatedMiasmaIds,
      simulatedMiasmaCount: simulatedMiasmaIds.length,
      simulatedSafeCount: positioned.length - simulatedMiasmaIds.length,
      nodeCount: positioned.length,
    };
  }

  function estimatedFirstShrinkModel(state, positioned, startCenter) {
    const explicitRadius = numberOrNull(state.miasma.circleRadius);
    const radius = explicitRadius !== null && explicitRadius > 0
      ? explicitRadius : FIRST_SHRINK_FALLBACK_RADIUS;
    const positionX = numberOrNull(state.miasma.circlePositionX);
    const positionY = numberOrNull(state.miasma.circlePositionY);
    const capturedCenterX = numberOrNull(state.miasma.circleCenterX);
    const capturedCenterY = numberOrNull(state.miasma.circleCenterY);
    const serverCenterX = numberOrNull(state.miasma.centerX);
    const serverCenterY = numberOrNull(state.miasma.centerY);
    const finalCenter = positionX !== null && positionY !== null
      ? { x: positionX + radius, y: positionY + radius }
      : (capturedCenterX !== null && capturedCenterY !== null
        ? { x: capturedCenterX, y: capturedCenterY }
        : (serverCenterX !== null && serverCenterY !== null
          ? { x: serverCenterX, y: serverCenterY }
          : { ...startCenter }));
    const maximumStartDistance = Math.max(...positioned.map(node => (
      Math.hypot(node.x - startCenter.x, node.y - startCenter.y)
    )));
    const radiusIntercept = Math.max(radius, maximumStartDistance + 50);
    return {
      key: `estimate:${state.mapId ?? '*'}:${state.miasma.basePatternId ?? '*'}:${state.miasma.patternId ?? '*'}:${state.dayOneBossDefeated ? 2 : 1}`,
      finalCenter,
      finalRadius: radius,
      radiusIntercept,
      radiusPerStep: (radius - radiusIntercept) / 100,
      sourceLog: state.miasma.circleImage || 'limitCircle-position-or-server-center',
    };
  }

  const predictFirstShrinkArea = simulateFirstShrinkArea;

  function capturedFirstShrinkCircleGeometry(state) {
    const radius = numberOrNull(state.miasma.circleRadius);
    const centerX = numberOrNull(state.miasma.circleCenterX);
    const centerY = numberOrNull(state.miasma.circleCenterY);
    const source = state.miasma.circleGeometrySource;
    if (radius === null || radius <= 0 || centerX === null || centerY === null || !source)
      return null;
    const serverCenterX = numberOrNull(state.miasma.centerX);
    const serverCenterY = numberOrNull(state.miasma.centerY);
    if (serverCenterX !== null && Math.abs(serverCenterX - centerX) > 3)
      return null;
    if (serverCenterY !== null && Math.abs(serverCenterY - centerY) > 3)
      return null;
    return {
      center: { x: centerX, y: centerY },
      radius,
      source,
    };
  }

  function createFirstShrinkCircleSnapshot(input) {
    const state = normalizeState(input);
    const capturedGeometry = capturedFirstShrinkCircleGeometry(state);
    const simulation = simulateFirstShrinkArea(state);
    const authoritativeSimulation = simulation?.source !== 'limit-circle-estimate'
      ? simulation : null;
    const finalCenter = authoritativeSimulation?.finalCenter
      || capturedGeometry?.center || simulation?.finalCenter;
    const finalRadius = authoritativeSimulation?.finalRadius
      ?? capturedGeometry?.radius ?? simulation?.finalRadius;
    if (!finalCenter || !(Number(finalRadius) > 0))
      return null;
    const usesSimulation = Boolean(authoritativeSimulation || (!capturedGeometry && simulation));
    const selectedSimulation = authoritativeSimulation || simulation;
    const snapshotSource = selectedSimulation?.source === 'learned-node-boundary-model'
      ? 'saved-first-shrink-learned-model'
      : (selectedSimulation?.source === 'limit-circle-estimate'
        ? 'saved-first-shrink-estimate'
        : 'saved-first-shrink-simulation');
    return {
      center: {
        x: Number(finalCenter.x),
        y: Number(finalCenter.y),
      },
      radius: Number(finalRadius),
      capturedAt: new Date().toISOString(),
      source: usesSimulation
        ? snapshotSource
        : `saved-${capturedGeometry.source}`,
      modelKey: usesSimulation
        ? selectedSimulation.modelKey
        : `limitCircle:${String(state.miasma.circleImage || 'captured')}`,
      mapId: state.mapId,
      basePatternId: state.miasma.basePatternId,
      patternId: state.miasma.patternId,
      dayIndex: state.dayOneBossDefeated ? 2 : 1,
    };
  }

  function savedFirstShrinkCircleForState(state) {
    const circle = state.firstShrinkFinalCircle;
    if (!circle)
      return null;
    const dayIndex = state.dayOneBossDefeated ? 2 : 1;
    for (const [saved, current] of [
      [circle.mapId, state.mapId],
      [circle.basePatternId, state.miasma.basePatternId],
      [circle.patternId, state.miasma.patternId],
      [circle.dayIndex, dayIndex],
    ]) {
      if (saved !== null && current !== null && saved !== current)
        return null;
    }
    return circle;
  }

  function secondShrinkBossAnchor(state, graph = null) {
    const byId = graph?.byId || new Map((state.nodes || []).map(node => [node.id, node]));
    const explicit = byId.get(state.miasma?.bossNodeId);
    if (explicit && !explicit.isVisited)
      return explicit;
    return (state.nodes || []).find(node => node.type === 1 && !node.isVisited)
      || null;
  }

  function inferCircleFromObservedMiasma(state) {
    const positioned = state.nodes.filter(node => node.x !== null && node.y !== null);
    const safeNodes = positioned.filter(node => !node.isShrinking);
    const miasmaNodes = positioned.filter(node => node.isShrinking);
    if (!safeNodes.length || !miasmaNodes.length)
      return null;

    const classifyAt = (center) => {
      const safeDistances = safeNodes.map(node => Math.hypot(node.x - center.x, node.y - center.y));
      const miasmaDistances = miasmaNodes.map(node => Math.hypot(node.x - center.x, node.y - center.y));
      const distances = [
        ...safeDistances.map(distance => ({ distance, safe: true })),
        ...miasmaDistances.map(distance => ({ distance, safe: false })),
      ].sort((a, b) => a.distance - b.distance);
      const thresholds = [0];
      for (let index = 0; index < distances.length - 1; index += 1)
        thresholds.push((distances[index].distance + distances[index + 1].distance) / 2);
      thresholds.push(distances.at(-1).distance + 1);
      let best = null;
      for (const radius of thresholds) {
        const safeOutside = safeDistances.filter(distance => distance > radius).length;
        const miasmaInside = miasmaDistances.filter(distance => distance <= radius).length;
        const mismatches = safeOutside + miasmaInside;
        const safeBoundary = Math.max(...safeDistances.filter(distance => distance <= radius), 0);
        const miasmaBoundary = Math.min(
          ...miasmaDistances.filter(distance => distance > radius),
          Infinity,
        );
        const margin = Number.isFinite(miasmaBoundary)
          ? Math.max(0, miasmaBoundary - safeBoundary)
          : 0;
        const fittedRadius = mismatches === 0 && Number.isFinite(miasmaBoundary)
          ? (safeBoundary + miasmaBoundary) / 2
          : radius;
        const score = mismatches * 1e9 - margin;
        if (!best || score < best.score)
          best = { center: { ...center }, radius: fittedRadius, mismatches, margin, score };
      }
      return best;
    };

    const serverCenterX = numberOrNull(state.miasma.centerX);
    const serverCenterY = numberOrNull(state.miasma.centerY);
    if (serverCenterX !== null && serverCenterY !== null) {
      const serverFit = classifyAt({ x: serverCenterX, y: serverCenterY });
      if (serverFit?.mismatches === 0) {
        return {
          ...serverFit,
          source: 'observed-node-boundary-server-center',
          safeNodeCount: safeNodes.length,
          miasmaNodeCount: miasmaNodes.length,
        };
      }
    }

    const xs = positioned.map(node => node.x);
    const ys = positioned.map(node => node.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    let best = null;
    const consider = (center) => {
      const fit = classifyAt(center);
      if (!best || fit.score < best.score)
        best = fit;
    };
    if (serverCenterX !== null && serverCenterY !== null)
      consider({ x: serverCenterX, y: serverCenterY });
    consider({
      x: safeNodes.reduce((sum, node) => sum + node.x, 0) / safeNodes.length,
      y: safeNodes.reduce((sum, node) => sum + node.y, 0) / safeNodes.length,
    });
    for (let xIndex = 0; xIndex <= 12; xIndex += 1) {
      for (let yIndex = 0; yIndex <= 12; yIndex += 1) {
        consider({
          x: minX - spanX * 0.2 + spanX * 1.4 * xIndex / 12,
          y: minY - spanY * 0.2 + spanY * 1.4 * yIndex / 12,
        });
      }
    }
    let stepX = spanX / 12;
    let stepY = spanY / 12;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const origin = { ...best.center };
      for (const dx of [-stepX, 0, stepX]) {
        for (const dy of [-stepY, 0, stepY])
          consider({ x: origin.x + dx, y: origin.y + dy });
      }
      stepX /= 2;
      stepY /= 2;
    }
    return best ? {
      ...best,
      source: 'observed-node-boundary-fitted-center',
      safeNodeCount: safeNodes.length,
      miasmaNodeCount: miasmaNodes.length,
    } : null;
  }

  function createFirstShrinkLearningObservation(input) {
    const state = normalizeState(input);
    const completed = state.miasma.active
      && Number(state.miasma.level) === 1
      && (Number(state.miasma.status) === 2 || Number(state.miasma.step) >= 100);
    if (!completed)
      return null;
    const positioned = state.nodes.filter(node => node.x !== null && node.y !== null);
    const safeNodeCount = positioned.filter(node => !node.isShrinking).length;
    const miasmaNodeCount = positioned.filter(node => node.isShrinking).length;
    if (safeNodeCount < 2 || miasmaNodeCount < 2)
      return null;
    const fitted = inferCircleFromObservedMiasma(state);
    if (!fitted || fitted.mismatches > Math.max(2, Math.floor(positioned.length * 0.08)))
      return null;
    if (state.mapId === null || state.miasma.basePatternId === null
      || state.miasma.patternId === null)
      return null;
    const xs = positioned.map(node => node.x);
    const ys = positioned.map(node => node.y);
    const startCenter = {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    };
    const radiusIntercept = Math.max(...positioned.map(node => (
      Math.hypot(node.x - startCenter.x, node.y - startCenter.y)
    ))) + 50;
    const dayIndex = state.dayOneBossDefeated ? 2 : 1;
    return {
      key: `${state.mapId ?? '*'}:${state.miasma.basePatternId ?? '*'}:${state.miasma.patternId ?? '*'}:${dayIndex}`,
      mapId: state.mapId,
      basePatternId: state.miasma.basePatternId,
      patternId: state.miasma.patternId,
      dayIndex,
      finalCenter: { ...fitted.center },
      finalRadius: fitted.radius,
      radiusIntercept,
      radiusPerStep: (fitted.radius - radiusIntercept) / 100,
      mismatches: fitted.mismatches,
      margin: fitted.margin,
      safeNodeCount,
      miasmaNodeCount,
      capturedAt: state.capturedAt || new Date().toISOString(),
      source: fitted.source,
    };
  }

  function simulateSecondShrinkArea(input, inputGraph = null) {
    const state = normalizeState(input);
    const secondShrinkActive = state.miasma.active
      && (Number(state.miasma.level) >= 2 || Number(state.miasma.status) >= 3);
    const graph = inputGraph || buildGraph(state.nodes);
    const anchor = secondShrinkBossAnchor(state, graph);
    if (!anchor)
      return null;
    const observedBoss = state.miasma.bossNodeId !== null || anchor.type === 1;
    if (!secondShrinkActive && !observedBoss)
      return null;
    const observedRemainTurn = numberOrNull(state.miasma.remainTurn);
    const remainTurn = observedRemainTurn !== null && observedRemainTurn > 0
      ? observedRemainTurn
      : SECOND_SHRINK_DURATION_TURNS;
    const positioned = state.nodes.filter(node => node.x !== null && node.y !== null);
    const savedFirstShrinkCircle = savedFirstShrinkCircleForState(state);
    const observedCircle = savedFirstShrinkCircle
      ? null
      : inferCircleFromObservedMiasma(state);
    const useCoordinates = anchor.x !== null
      && anchor.y !== null
      && positioned.length > 1
      && Boolean(savedFirstShrinkCircle || observedCircle);
    if (!useCoordinates) {
      const hopDistances = distancesToTargets(graph, [anchor.id]);
      const candidates = state.nodes
        .filter(node => !node.isShrinking && node.id !== anchor.id)
        .map(node => ({
          id: node.id,
          distance: Number.isFinite(hopDistances.get(node.id))
            ? Number(hopDistances.get(node.id)) : null,
        }))
        .filter(node => node.distance !== null);
      const currentRadius = Math.max(0, ...candidates.map(node => node.distance));
      const nodeDeadlines = {};
      const predictedOrder = candidates
        .slice()
        .sort((a, b) => b.distance - a.distance || a.id - b.id);
      for (const node of predictedOrder) {
        const normalizedDistance = currentRadius > 0 ? node.distance / currentRadius : 0;
        const offset = Math.max(
          1,
          Math.ceil(remainTurn * Math.max(0, 1 - normalizedDistance)),
        );
        nodeDeadlines[node.id] = state.totalTurn + offset;
      }
      nodeDeadlines[anchor.id] = null;
      return {
        source: 'boss-anchor-hop-contraction',
        anchorBossId: anchor.id,
        startCenter: null,
        currentCenter: null,
        finalCenter: null,
        center: null,
        remainTurn,
        progress: null,
        startRadius: currentRadius,
        currentRadius,
        finalRadius: 0,
        centerShiftRatio: null,
        bossRadiusPosition: null,
        nodeDeadlines,
        predictedShrinkOrder: predictedOrder.map(node => node.id),
        finalSafeNodeIds: [anchor.id],
        alreadyMiasmaNodeIds: state.nodes
          .filter(node => node.isShrinking)
          .map(node => node.id),
      };
    }

    const resumedFromObservedBoundary = !savedFirstShrinkCircle && Boolean(observedCircle);
    const startCenter = resumedFromObservedBoundary
      ? { ...observedCircle.center }
      : { ...savedFirstShrinkCircle.center };
    const startRadius = resumedFromObservedBoundary
      ? observedCircle.radius
      : savedFirstShrinkCircle.radius;
    const bossRadiusPosition = startRadius > 0
      ? Math.hypot(anchor.x - startCenter.x, anchor.y - startCenter.y) / startRadius
      : null;
    const finalCenter = { x: anchor.x, y: anchor.y };
    const finalRadius = 0;
    // `step` belongs to the first contraction and may remain at 100 after the
    // boss appears. The second contraction advances with its own countdown.
    // Using the retained step collapsed the circle onto the boss immediately,
    // or left it at the initial circle when step was absent.
    const progress = resumedFromObservedBoundary
      ? 0
      : Math.min(1, Math.max(
          0,
          (SECOND_SHRINK_DURATION_TURNS - remainTurn) / SECOND_SHRINK_DURATION_TURNS,
        ));
    const progressSource = resumedFromObservedBoundary
      ? 'observed-node-boundary-resume'
      : (observedRemainTurn === null ? 'boss-observed-default-duration' : 'remain-turn');
    const remainingScale = 1 - progress;
    const currentCenter = {
      x: anchor.x + (startCenter.x - anchor.x) * remainingScale,
      y: anchor.y + (startCenter.y - anchor.y) * remainingScale,
    };
    const currentRadius = startRadius * remainingScale;
    const circleAt = (circleProgress) => ({
      center: {
        x: anchor.x + (startCenter.x - anchor.x) * (1 - circleProgress),
        y: anchor.y + (startCenter.y - anchor.y) * (1 - circleProgress),
      },
      radius: startRadius * (1 - circleProgress),
    });
    const isOutsideAt = (node, circleProgress) => {
      const circle = circleAt(circleProgress);
      return Math.hypot(
        node.x - circle.center.x,
        node.y - circle.center.y,
      ) > circle.radius;
    };
    const nodeDeadlines = {};
    const expiryProgressById = new Map();
    for (const node of positioned) {
      if (node.id === anchor.id)
        continue;
      if (node.isShrinking || isOutsideAt(node, progress)) {
        nodeDeadlines[node.id] = state.totalTurn;
        expiryProgressById.set(node.id, progress);
        continue;
      }
      if (!isOutsideAt(node, 1)) {
        nodeDeadlines[node.id] = null;
        expiryProgressById.set(node.id, Infinity);
        continue;
      }
      let lower = progress;
      let upper = 1;
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const middle = (lower + upper) / 2;
        if (isOutsideAt(node, middle))
          upper = middle;
        else
          lower = middle;
      }
      const remainingProgress = Math.max(1e-9, 1 - progress);
      const offset = Math.max(
        1,
        Math.ceil(remainTurn * (upper - progress) / remainingProgress),
      );
      nodeDeadlines[node.id] = state.totalTurn + offset;
      expiryProgressById.set(node.id, upper);
    }
    nodeDeadlines[anchor.id] = null;
    const predictedOrder = positioned
      .filter(node => node.id !== anchor.id)
      .slice()
      .sort((a, b) => (
        (expiryProgressById.get(a.id) ?? Infinity)
          - (expiryProgressById.get(b.id) ?? Infinity)
        || a.id - b.id
      ));
    return {
      source: resumedFromObservedBoundary
        ? 'boss-anchor-observed-boundary-resume'
        : 'boss-anchor-scaled-circle-contraction',
      startCircleSource: resumedFromObservedBoundary
        ? observedCircle.source
        : savedFirstShrinkCircle.source,
      firstShrinkCircleCapturedAt: savedFirstShrinkCircle?.capturedAt || null,
      firstShrinkCircleModelKey: savedFirstShrinkCircle?.modelKey || null,
      inferredCircle: resumedFromObservedBoundary ? {
        center: observedCircle.center,
        radius: observedCircle.radius,
        mismatches: observedCircle.mismatches,
        margin: observedCircle.margin,
        safeNodeCount: observedCircle.safeNodeCount,
        miasmaNodeCount: observedCircle.miasmaNodeCount,
      } : null,
      anchorBossId: anchor.id,
      startCenter,
      currentCenter,
      finalCenter,
      center: currentCenter,
      remainTurn,
      progress,
      progressSource,
      durationTurns: SECOND_SHRINK_DURATION_TURNS,
      remainingScale,
      startRadius,
      currentRadius,
      finalRadius,
      bossRadiusPosition,
      nodeDeadlines,
      predictedShrinkOrder: predictedOrder.map(node => node.id),
      finalSafeNodeIds: positioned
        .filter(node => !isOutsideAt(node, 1))
        .map(node => node.id),
      alreadyMiasmaNodeIds: state.nodes
        .filter(node => node.isShrinking)
        .map(node => node.id),
    };
  }

  function addWarpEdges(nodes, adjacency, disabledWarpNodeId = null) {
    const warps = nodes.filter(node => node.type === 9);
    if (warps.length !== 2)
      return;
    if (warps.some(node => node.id === disabledWarpNodeId))
      return;
    adjacency.get(warps[0].id)?.add(warps[1].id);
    adjacency.get(warps[1].id)?.add(warps[0].id);
  }

  function buildGraph(nodes, options = {}) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const adjacency = new Map(nodes.map(node => [node.id, new Set()]));
    for (const node of nodes) {
      for (const adjacentId of node.adjacentIds) {
        if (!byId.has(adjacentId))
          continue;
        adjacency.get(node.id).add(adjacentId);
        adjacency.get(adjacentId).add(node.id);
      }
    }
    if (options.includeWarp !== false)
      addWarpEdges(nodes, adjacency, numberOrNull(options.disabledWarpNodeId));
    return { byId, adjacency };
  }

  function findWarpTransition(path, graph) {
    for (let index = 1; index < path.length; index += 1) {
      const from = graph.byId.get(path[index - 1]);
      const to = graph.byId.get(path[index]);
      if (from?.type === 9 && to?.type === 9)
        return { index: index - 1, fromId: from.id, toId: to.id };
    }
    return null;
  }

  function collectLocalNodeIds(adjacency, startId, maxHops = 4) {
    if (!adjacency.has(startId))
      return new Map();
    const distance = new Map([[startId, 0]]);
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
      const nextDistance = distance.get(id) + 1;
      if (nextDistance > maxHops)
        continue;
      for (const next of adjacency.get(id) || []) {
        if (distance.has(next))
          continue;
        distance.set(next, nextDistance);
        queue.push(next);
      }
    }
    return distance;
  }

  function collectLocalNodeIdsByRadius(nodes, adjacency, startId, radius = 600, fallbackHops = 4) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const current = byId.get(startId);
    const limit = Number(radius);
    if (!current || current.x === null || current.y === null || !Number.isFinite(limit) || limit <= 0)
      return collectLocalNodeIds(adjacency, startId, fallbackHops);
    const radiusDistances = new Map();
    for (const node of nodes) {
      if (node.x === null || node.y === null)
        continue;
      const distance = Math.hypot(node.x - current.x, node.y - current.y);
      if (distance <= limit)
        radiusDistances.set(node.id, distance);
    }
    radiusDistances.set(startId, 0);
    const reachableDistances = new Map([[startId, 0]]);
    const queue = [startId];
    while (queue.length) {
      const id = queue.shift();
      for (const nextId of adjacency.get(id) || []) {
        if (!radiusDistances.has(nextId) || reachableDistances.has(nextId))
          continue;
        reachableDistances.set(nextId, radiusDistances.get(nextId));
        queue.push(nextId);
      }
    }
    return reachableDistances;
  }

  function estimateUnsafeTurns(state, graph) {
    const deadlines = new Map();
    for (const node of state.nodes) {
      if (node.isShrinking)
        deadlines.set(node.id, state.totalTurn);
      else
        deadlines.set(node.id, Infinity);
    }
    const miasma = state.miasma;
    const secondShrinkSimulation = simulateSecondShrinkArea(state, graph);
    if (secondShrinkSimulation) {
      for (const [rawId, deadline] of Object.entries(secondShrinkSimulation.nodeDeadlines)) {
        const id = Number(rawId);
        if (deadline !== null && !state.nodes.find(node => node.id === id)?.isShrinking)
          deadlines.set(id, deadline);
      }
      deadlines.set(secondShrinkSimulation.anchorBossId, Infinity);
      return deadlines;
    }
    if (!miasma.active || miasma.level !== 1 || miasma.status !== 1 || !miasma.remainTurn)
      return deadlines;
    if (miasma.centerX === null || miasma.centerY === null)
      return deadlines;
    const safe = state.nodes
      .filter(node => !node.isShrinking && node.x !== null && node.y !== null)
      .map(node => ({
        id: node.id,
        radius: Math.hypot(node.x - miasma.centerX, node.y - miasma.centerY),
      }))
      .sort((a, b) => b.radius - a.radius);
    const measuredFinalRadius = numberOrNull(miasma.circleRadius);
    const expiring = measuredFinalRadius !== null && measuredFinalRadius > 0
      ? safe.filter(node => node.radius > measuredFinalRadius)
      // 実表示半径が取れない場合だけ、従来の外側62%へ保守的に期限を付ける。
      : safe.slice(0, Math.max(0, Math.ceil(safe.length * 0.62)));
    for (let index = 0; index < expiring.length; index += 1) {
      const offset = 1 + Math.floor((index / Math.max(1, expiring.length)) * miasma.remainTurn);
      deadlines.set(expiring[index].id, state.totalTurn + offset);
    }
    return deadlines;
  }

  function distancesToTargets(graph, targetIds) {
    const distances = new Map();
    const queue = [];
    for (const id of targetIds) {
      if (!graph.byId.has(id))
        continue;
      distances.set(id, 0);
      queue.push(id);
    }
    while (queue.length) {
      const id = queue.shift();
      const distance = distances.get(id);
      for (const next of graph.adjacency.get(id) || []) {
        if (distances.has(next))
          continue;
        distances.set(next, distance + 1);
        queue.push(next);
      }
    }
    return distances;
  }

  function isSafeAt(deadlines, id, turn, margin = 1) {
    const deadline = deadlines.get(id) ?? Infinity;
    return turn + margin < deadline;
  }

  function miasmaExposureAt(deadlines, id, turn) {
    const deadline = deadlines.get(id) ?? Infinity;
    return Number.isFinite(deadline) && turn >= deadline ? 1 : 0;
  }

  function completedShrinkCountAt(state, turn) {
    if (!state?.miasma?.active)
      return 0;
    const level = Math.max(1, Number(state.miasma.level) || 1);
    const status = Number(state.miasma.status) || 1;
    let completed = Math.max(0, level - 1);
    const elapsed = Math.max(0, Number(turn) - Number(state.totalTurn || 0));
    const remainTurn = Number(state.miasma.remainTurn);
    if (status >= 2 || (status === 1 && Number.isFinite(remainTurn) && elapsed >= remainTurn))
      completed += 1;
    return completed;
  }

  function miasmaDamageRateAt(state, turn) {
    const completed = completedShrinkCountAt(state, turn);
    const observed = numberOrNull(state?.miasmaDamageRates?.[completed]);
    if (observed !== null)
      return observed;
    if (completed <= 0)
      return FIRST_SHRINK_DAMAGE_PERCENT;
    return FIRST_SHRINK_COMPLETE_DAMAGE_PERCENT;
  }

  function miasmaDamageAt(state, deadlines, id, turn) {
    return miasmaExposureAt(deadlines, id, turn) ? miasmaDamageRateAt(state, turn) : 0;
  }

  function estimatedNodeProcessingTurns(node) {
    if (!node || node.isVisited || node.isPassedDanger)
      return 0;
    const fixedSpecial = confirmedFixedSpecialEvent(node, null);
    const fixedMinimum = numberOrNull(fixedSpecial?.minimumProcessingTurns);
    if (fixedMinimum !== null)
      return Math.max(0, fixedMinimum);
    if ([2, 3, 4, 5, 11].includes(node.type))
      return 1;
    if (node.type === 10 && (isFanaticNode(node) || isCultLeaderNode(node)))
      return 1;
    return 0;
  }

  function nodeTurnMiasmaCost(state, deadlines, id, firstTurn, occupiedTurns) {
    let exposures = 0;
    let damagePercent = 0;
    for (let offset = 0; offset < occupiedTurns; offset += 1) {
      const turn = firstTurn + offset;
      exposures += miasmaExposureAt(deadlines, id, turn);
      damagePercent += miasmaDamageAt(state, deadlines, id, turn);
    }
    return { exposures, damagePercent };
  }

  function assessPathTurnsAndMiasma(
    path, graph, state, deadlines, startTurn, skipDestinationProcessing = false,
    processedIds = new Set(),
  ) {
    const processed = new Set(processedIds);
    let elapsedTurns = 0;
    let exposures = 0;
    let damagePercent = 0;
    for (let index = 1; index < path.length; index += 1) {
      const nodeId = path[index];
      const processingTurns = (skipDestinationProcessing && index === path.length - 1)
        || processed.has(nodeId)
        ? 0
        : estimatedNodeProcessingTurns(graph.byId.get(nodeId));
      const arrivalTurn = startTurn + elapsedTurns + 1;
      const cost = nodeTurnMiasmaCost(
        state, deadlines, nodeId, arrivalTurn, 1 + processingTurns,
      );
      elapsedTurns += 1 + processingTurns;
      exposures += cost.exposures;
      damagePercent += cost.damagePercent;
      processed.add(nodeId);
    }
    return { elapsedTurns, exposures, damagePercent };
  }

  function miasmaHealthBudgetPercent(state) {
    const firstShrinkActive = Boolean(state?.miasma?.active)
      && Number(state.miasma.level) === 1
      && Number(state.miasma.status) === 1;
    if (!firstShrinkActive)
      return 0;
    const living = (state?.partyMembers || []).filter(member => member.hp > 0 && member.maxHp > 0);
    if (!living.length)
      return 0;
    // Reserve enough integer HP for per-hit ceil rounding across the planned horizon.
    const hpPercent = Math.min(...living.map(member => (
      Math.max(0, member.hp - 12) / member.maxHp * 100
    )));
    return Math.max(0, hpPercent);
  }

  function shortestPath(
    graph, startId, targetId, deadlines, startTurn, state, initialDamagePercent = 0,
    processedIds = new Set(), skipTargetProcessing = true,
  ) {
    const damageBudget = miasmaHealthBudgetPercent(state);
    const queue = [{
      id: startId, path: [startId], elapsedTurns: 0, exposures: 0, damagePercent: 0,
    }];
    const bestArrival = new Map([[`${startId}:0`, 0]]);
    while (queue.length) {
      queue.sort((a, b) => a.damagePercent - b.damagePercent || a.elapsedTurns - b.elapsedTurns);
      const { id, path, elapsedTurns, exposures, damagePercent } = queue.shift();
      if (id === targetId)
        return path;
      for (const next of graph.adjacency.get(id) || []) {
        if (path.includes(next))
          continue;
        const arrivalTurn = startTurn + elapsedTurns + 1;
        const processingTurns = (next === targetId && skipTargetProcessing) || processedIds.has(next)
          ? 0
          : estimatedNodeProcessingTurns(graph.byId.get(next));
        const cost = nodeTurnMiasmaCost(
          state, deadlines, next, arrivalTurn, 1 + processingTurns,
        );
        const nextExposures = exposures + cost.exposures;
        const nextDamagePercent = damagePercent + cost.damagePercent;
        const nextElapsedTurns = elapsedTurns + 1 + processingTurns;
        const key = `${next}:${nextDamagePercent}`;
        if (initialDamagePercent + nextDamagePercent > damageBudget
          || nextElapsedTurns >= (bestArrival.get(key) ?? Infinity))
          continue;
        bestArrival.set(key, nextElapsedTurns);
        queue.push({
          id: next,
          path: [...path, next],
          elapsedTurns: nextElapsedTurns,
          exposures: nextExposures,
          damagePercent: nextDamagePercent,
        });
      }
    }
    return [];
  }

  function canReachPermanentSafe(
    graph, startId, deadlines, startTurn, state, initialDamagePercent = 0,
    processedIds = new Set(),
  ) {
    if (!Number.isFinite(deadlines.get(startId) ?? Infinity))
      return true;
    const damageBudget = miasmaHealthBudgetPercent(state);
    const queue = [{ id: startId, elapsedTurns: 0, damagePercent: 0 }];
    const bestArrival = new Map([[`${startId}:0`, 0]]);
    while (queue.length) {
      queue.sort((a, b) => a.damagePercent - b.damagePercent || a.elapsedTurns - b.elapsedTurns);
      const { id, elapsedTurns, damagePercent } = queue.shift();
      if (!Number.isFinite(deadlines.get(id) ?? Infinity))
        return true;
      for (const next of graph.adjacency.get(id) || []) {
        const arrivalTurn = startTurn + elapsedTurns + 1;
        const processingTurns = Number.isFinite(deadlines.get(next) ?? Infinity)
          && !processedIds.has(next)
          ? estimatedNodeProcessingTurns(graph.byId.get(next))
          : 0;
        const cost = nodeTurnMiasmaCost(
          state, deadlines, next, arrivalTurn, 1 + processingTurns,
        );
        const nextDamagePercent = damagePercent + cost.damagePercent;
        const nextElapsedTurns = elapsedTurns + 1 + processingTurns;
        const key = `${next}:${nextDamagePercent}`;
        if (initialDamagePercent + nextDamagePercent > damageBudget
          || nextElapsedTurns >= (bestArrival.get(key) ?? Infinity))
          continue;
        bestArrival.set(key, nextElapsedTurns);
        queue.push({ id: next, elapsedTurns: nextElapsedTurns, damagePercent: nextDamagePercent });
      }
    }
    return false;
  }

  function estimateCoreNodeIds(state, graph, deadlines) {
    const eligibleCoreNode = node => (
      graph.byId.has(node.id)
      && (dangerPhase(state) !== 'first-day'
        || !DANGER_TYPES.has(node.type)
        || node.isVisited
        || node.isPassedDanger)
    );
    if (state.miasma.active) {
      const permanentNodes = state.nodes
        .filter(node => !Number.isFinite(deadlines.get(node.id) ?? Infinity));
      const permanent = new Set(permanentNodes
        .filter(eligibleCoreNode)
        .map(node => node.id));
      if (permanentNodes.length)
        return permanent;
    }
    const eligibleNodes = state.nodes.filter(eligibleCoreNode);
    const positioned = eligibleNodes.filter(node => node.x !== null && node.y !== null);
    if (positioned.length) {
      const xs = positioned.map(node => node.x);
      const ys = positioned.map(node => node.y);
      const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
      const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
      const count = Math.max(1, Math.ceil(positioned.length * 0.35));
      return new Set(positioned
        .map(node => ({ id: node.id, distance: Math.hypot(node.x - centerX, node.y - centerY) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, count)
        .map(item => item.id));
    }
    const degreeOrder = eligibleNodes.slice()
      .sort((a, b) => (graph.adjacency.get(b.id)?.size || 0) - (graph.adjacency.get(a.id)?.size || 0));
    return new Set(degreeOrder.slice(0, Math.max(1, Math.ceil(degreeOrder.length * 0.35))).map(node => node.id));
  }

  function evacuationAssessment(
    graph, startId, deadlines, startTurn, coreIds, outboundPath = [],
    state = null, initialDamagePercent = 0, processedIds = new Set(),
    avoidUnvisitedFirstDayDanger = false,
  ) {
    const damageBudget = miasmaHealthBudgetPercent(state);
    const outboundEdges = new Set();
    for (let index = 1; index < outboundPath.length; index += 1)
      outboundEdges.add([outboundPath[index - 1], outboundPath[index]].sort((a, b) => a - b).join(':'));
    const queue = [{
      id: startId, path: [startId], elapsedTurns: 0, exposures: 0, damagePercent: 0,
    }];
    const bestArrival = new Map([[`${startId}:0`, 0]]);
    while (queue.length) {
      queue.sort((a, b) => a.damagePercent - b.damagePercent || a.elapsedTurns - b.elapsedTurns);
      const {
        id, path, elapsedTurns, exposures, damagePercent,
      } = queue.shift();
      if (coreIds.has(id)) {
        let retrace = 0;
        for (let index = 1; index < path.length; index += 1) {
          const edge = [path[index - 1], path[index]].sort((a, b) => a - b).join(':');
          if (outboundEdges.has(edge))
            retrace += 1;
        }
        const previousId = outboundPath.length > 1 ? outboundPath[outboundPath.length - 2] : null;
        const escapeOptions = [...(graph.adjacency.get(startId) || [])]
          .filter((next) => {
            if (next === previousId)
              return false;
            const processingTurns = coreIds.has(next) || processedIds.has(next)
              ? 0
              : estimatedNodeProcessingTurns(graph.byId.get(next));
            const cost = nodeTurnMiasmaCost(
              state, deadlines, next, startTurn + 1, 1 + processingTurns,
            );
            return initialDamagePercent + cost.damagePercent <= damageBudget;
          }).length;
        return {
          distance: elapsedTurns, retrace, escapeOptions,
          miasmaExposures: exposures, miasmaDamagePercent: damagePercent, path,
        };
      }
      const neighbors = [...(graph.adjacency.get(id) || [])]
        .map((next) => {
          if (path.includes(next))
            return null;
          const node = graph.byId.get(next);
          if (avoidUnvisitedFirstDayDanger
            && dangerPhase(state) === 'first-day'
            && DANGER_TYPES.has(node?.type)
            && !node?.isVisited
            && !node?.isPassedDanger)
            return null;
          const processingTurns = coreIds.has(next) || processedIds.has(next)
            ? 0
            : estimatedNodeProcessingTurns(node);
          const arrivalTurn = startTurn + elapsedTurns + 1;
          const cost = nodeTurnMiasmaCost(
            state, deadlines, next, arrivalTurn, 1 + processingTurns,
          );
          return {
            id: next,
            elapsedTurns: elapsedTurns + 1 + processingTurns,
            exposures: exposures + cost.exposures,
            damagePercent: damagePercent + cost.damagePercent,
          };
        })
        .filter(Boolean)
        .filter((next) => {
          if (initialDamagePercent + next.damagePercent > damageBudget)
            return false;
          const key = `${next.id}:${next.damagePercent}`;
          const previousArrival = bestArrival.get(key);
          if (previousArrival !== undefined && previousArrival <= next.elapsedTurns)
            return false;
          bestArrival.set(key, next.elapsedTurns);
          return true;
        })
        .sort((a, b) => {
          if (a.damagePercent !== b.damagePercent)
            return a.damagePercent - b.damagePercent;
          const aEdge = [id, a.id].sort((x, y) => x - y).join(':');
          const bEdge = [id, b.id].sort((x, y) => x - y).join(':');
          return Number(outboundEdges.has(aEdge)) - Number(outboundEdges.has(bEdge));
        });
      for (const next of neighbors) {
        queue.push({
          id: next.id, path: [...path, next.id],
          elapsedTurns: next.elapsedTurns,
          exposures: next.exposures, damagePercent: next.damagePercent,
        });
      }
    }
    return {
      distance: Infinity, retrace: Infinity, escapeOptions: 0,
      miasmaExposures: Infinity, miasmaDamagePercent: Infinity, path: [],
    };
  }

  function preferredFirstDayEvacuation(
    graph, startId, deadlines, startTurn, coreIds, outboundPath = [],
    state = null, initialDamagePercent = 0, processedIds = new Set(),
  ) {
    const ordinary = evacuationAssessment(
      graph, startId, deadlines, startTurn, coreIds, outboundPath,
      state, initialDamagePercent, processedIds, false,
    );
    if (dangerPhase(state) !== 'first-day')
      return ordinary;
    const dangerFree = evacuationAssessment(
      graph, startId, deadlines, startTurn, coreIds, outboundPath,
      state, initialDamagePercent, processedIds, true,
    );
    if (!Number.isFinite(dangerFree.distance))
      return ordinary;
    const firstShrinkActive = Boolean(state?.miasma?.active)
      && Number(state.miasma.level) === 1
      && Number(state.miasma.status) === 1;
    if (!firstShrinkActive)
      return ordinary;
    const remainTurn = numberOrNull(state?.miasma?.remainTurn);
    // 5ターン余裕を確保できない段階でも、収縮完了までに到達できるなら、
    // 倒せない強敵系を踏む短路より非強敵経路を優先する。
    if (remainTurn !== null && dangerFree.distance <= remainTurn)
      return dangerFree;
    return ordinary;
  }

  function dangerPhase(state) {
    const dayTwo = Boolean(state?.dayOneBossDefeated);
    if (!dayTwo)
      return 'first-day';
    const shrinkStarted = state?.miasma?.active
      && (Number(state.miasma.level) >= 1 || Number(state.miasma.status) >= 1);
    return shrinkStarted ? 'day-two-shrink' : 'day-two-early';
  }

  function dangerNodeValue(node, state) {
    if (!DANGER_TYPES.has(node?.type))
      return 0;
    return dangerPhaseValue(state);
  }

  function dangerPhaseValue(state) {
    const phase = dangerPhase(state);
    if (phase === 'first-day')
      return 0;
    return phase === 'day-two-shrink' ? 3 : 1;
  }

  function expectedCurrencyGain(node, state) {
    if (node?.type === 2)
      return 60;
    const confirmedSpecial = confirmedFixedSpecialEvent(node, state?.mapId ?? null);
    const dangerEquivalent = DANGER_TYPES.has(node?.type) || confirmedSpecial?.treatAsDanger;
    return dangerEquivalent && dangerPhase(state) !== 'first-day' ? 60 : 0;
  }

  function nodeGain(node, visited, currency, shops, state) {
    const mapId = state?.mapId ?? null;
    if (isFloatingCastleBodyNode(node, state?.nodes)) {
      return {
        treasure: 0, fanatic: 0, cultLeader: 0, floatingCastle: 0,
        activity: 0, special: 0, dangerValue: 0, dangerTier: 0,
        urgency: 0, shop: 0, danger: 0, empty: 0, revisit: 0,
      };
    }
    if (visited.has(node.id))
      return {
        treasure: 0, fanatic: 0, cultLeader: 0, floatingCastle: 0,
        activity: 0, special: 0, dangerValue: 0, dangerTier: 0,
        urgency: 0, shop: 0, danger: 0,
        empty: node.type === 0 || node.isPassedDanger ? 1 : 0,
        revisit: 1,
      };
    const shopAllowed = node.type === 8
      && ((shops === 0 && currency >= 500) || currency >= 1000);
    const unaffordableShop = node.type === 8 && !shopAllowed;
    const confirmedSpecial = confirmedFixedSpecialEvent(node, mapId);
    const dangerEquivalent = DANGER_TYPES.has(node.type) || confirmedSpecial?.treatAsDanger;
    const dangerValue = Math.max(
      dangerNodeValue(node, state),
      confirmedSpecial?.treatAsDanger ? dangerPhaseValue(state) : 0,
    );
    const dangerTier = dangerValue >= 3 ? 3 : (dangerValue > 0 ? 1 : 0);
    const firstDayDanger = dangerEquivalent && dangerValue === 0;
    const confirmedSpecialValue = fixedSpecialEventValue(confirmedSpecial, state);
    const fanatic = isFanaticNode(node);
    const cultLeader = isCultLeaderNode(node);
    const floatingCastle = isFloatingCastleTransferNode(node)
      && !isFloatingCastleTransferRisky(state);
    const dayTwoSpecial = node.type === 10 && dangerPhase(state) !== 'first-day';
    return {
      treasure: node.type === 6 ? 1 : 0,
      // Random combat specials are ordinary battles plus a small reward bonus.
      fanatic: fanatic ? 0.25 : 0,
      cultLeader: cultLeader ? 0.25 : 0,
      floatingCastle: floatingCastle ? 1 / 3 : 0,
      activity: node.type === 2 || node.type === 5 || dayTwoSpecial
        || confirmedSpecialValue > 0 || fanatic || cultLeader ? 1 : 0,
      special: confirmedSpecialValue,
      dangerValue,
      dangerTier,
      urgency: 0,
      shop: shopAllowed ? 1 : 0,
      // 1日目の強敵系は戦闘価値0（必ず撤退）なので空白と同じ評価。
      danger: 0,
      empty: node.type === 0 || firstDayDanger || unaffordableShop ? 1 : 0,
      revisit: 0,
    };
  }

  function compareCandidates(a, b) {
    const aExposure = a.miasmaExposures + a.evacuationMiasmaExposures;
    const bExposure = b.miasmaExposures + b.evacuationMiasmaExposures;
    const aMiasmaDamage = a.miasmaDamagePercent + a.evacuationMiasmaDamagePercent;
    const bMiasmaDamage = b.miasmaDamagePercent + b.evacuationMiasmaDamagePercent;
    const aStrictDamage = a.strictMiasmaAvoidance ? aMiasmaDamage : 0;
    const bStrictDamage = b.strictMiasmaAvoidance ? bMiasmaDamage : 0;
    // evacuationDistance already contains every return edge. Adding retrace
    // again made a short out-and-back look more expensive than a long loop.
    // Keep retrace as a later tie-breaker, but do not double-count movement.
    const aCost = Math.max(1, a.path.length - 1 + a.evacuationDistance + aMiasmaDamage / 2);
    const bCost = Math.max(1, b.path.length - 1 + b.evacuationDistance + bMiasmaDamage / 2);
    const aEfficiency = (a.treasure * 6 + a.cultLeader * 4 + a.fanatic * 3
      + a.special * 3 + a.dangerValue + a.activity * 2 + a.shop * 5 + a.floatingCastle) / aCost;
    const bEfficiency = (b.treasure * 6 + b.cultLeader * 4 + b.fanatic * 3
      + b.special * 3 + b.dangerValue + b.activity * 2 + b.shop * 5 + b.floatingCastle) / bCost;
    // Entering a bridge branch commits both the outward and return movement,
    // so it is worse than crossing one ordinary blank on a continuing route.
    // Include the exhausted gap after the last collected reward. Without this,
    // a lone shop inside an already-cleared loop beats a nearby reward cluster
    // because the comparison stops at the shop and ignores the empty exit.
    const aEffectiveEmpty = a.empty + a.trappedBranch * 2
      + (Number(a.continuationGap) || 0);
    const bEffectiveEmpty = b.empty + b.trappedBranch * 2
      + (Number(b.continuationGap) || 0);
    const aPostLeaderProgress = a.cultLeader > 0 ? a.activity : 0;
    const bPostLeaderProgress = b.cultLeader > 0 ? b.activity : 0;
    const aPhaseCombatTier = a.dangerTier >= 3 ? 3 : (a.activity > 0 ? 2 : (a.dangerTier > 0 ? 1 : 0));
    const bPhaseCombatTier = b.dangerTier >= 3 ? 3 : (b.activity > 0 ? 2 : (b.dangerTier > 0 ? 1 : 0));
    const aExpiringDistance = Number.isFinite(a.expiringTargetDistance) ? a.expiringTargetDistance : 1000000;
    const bExpiringDistance = Number.isFinite(b.expiringTargetDistance) ? b.expiringTargetDistance : 1000000;
    const aFirstExpiringArrival = Number.isFinite(a.firstExpiringArrival) ? a.firstExpiringArrival : 1000000;
    const bFirstExpiringArrival = Number.isFinite(b.firstExpiringArrival) ? b.firstExpiringArrival : 1000000;
    const aFirstValueArrival = Number.isFinite(a.firstValueArrival) ? a.firstValueArrival : 1000000;
    const bFirstValueArrival = Number.isFinite(b.firstValueArrival) ? b.firstValueArrival : 1000000;
    const aLeadingValueDelay = Math.max(0, aFirstValueArrival - MAX_LEADING_VALUE_TURNS);
    const bLeadingValueDelay = Math.max(0, bFirstValueArrival - MAX_LEADING_VALUE_TURNS);
    const sameCollectedValue = [
      'treasure', 'cultLeader', 'fanatic', 'special', 'dangerValue',
      'activity', 'shop', 'floatingCastle',
    ].every(key => Number(a[key] || 0) === Number(b[key] || 0));
    if (sameCollectedValue && aStrictDamage === bStrictDamage
      && aMiasmaDamage === bMiasmaDamage && aExposure === bExposure
      && aEffectiveEmpty === bEffectiveEmpty
      && a.turnbackPenalty === b.turnbackPenalty
      && Number(a.outerSweepDistance || 0) !== Number(b.outerSweepDistance || 0))
      return Number(b.outerSweepDistance || 0) - Number(a.outerSweepDistance || 0);
    if (a.latePhase && b.latePhase) {
      const aLate = [-aStrictDamage, a.expiringValue, -a.lateExpiringValue,
        a.expiringUrgency, -a.expiringDeadlineRisk,
        -aFirstExpiringArrival, -aExpiringDistance,
        aPhaseCombatTier, aEfficiency, a.treasure, a.cultLeader, a.fanatic, a.special, aPostLeaderProgress,
        -aEffectiveEmpty, -a.turnbackPenalty, a.dangerValue, a.activity,
        -a.trappedBranch, -aMiasmaDamage, -aExposure, a.urgency, a.shop,
        -a.retrace, -a.evacuationDistance, a.escapeOptions, -a.revisit, -a.danger, -a.path.length];
      const bLate = [-bStrictDamage, b.expiringValue, -b.lateExpiringValue,
        b.expiringUrgency, -b.expiringDeadlineRisk,
        -bFirstExpiringArrival, -bExpiringDistance,
        bPhaseCombatTier, bEfficiency, b.treasure, b.cultLeader, b.fanatic, b.special, bPostLeaderProgress,
        -bEffectiveEmpty, -b.turnbackPenalty, b.dangerValue, b.activity,
        -b.trappedBranch, -bMiasmaDamage, -bExposure, b.urgency, b.shop,
        -b.retrace, -b.evacuationDistance, b.escapeOptions, -b.revisit, -b.danger, -b.path.length];
      for (let index = 0; index < aLate.length; index += 1) {
        if (aLate[index] !== bLate[index])
          return bLate[index] - aLate[index];
      }
      return 0;
    }
    const av = [-aStrictDamage, -aLeadingValueDelay,
      a.expiringValue, -a.lateExpiringValue,
      a.expiringUrgency, -a.expiringDeadlineRisk,
      -aFirstExpiringArrival, -aExpiringDistance,
      -aEffectiveEmpty, -a.turnbackPenalty,
      a.treasure, a.cultLeader, a.fanatic, a.special, aPostLeaderProgress,
      aEfficiency, a.dangerValue, a.activity,
      -a.trappedBranch, -aMiasmaDamage, -aExposure, a.urgency, a.shop,
      -a.retrace, -a.evacuationDistance, a.escapeOptions, -a.revisit, -a.danger, -a.path.length];
    const bv = [-bStrictDamage, -bLeadingValueDelay,
      b.expiringValue, -b.lateExpiringValue,
      b.expiringUrgency, -b.expiringDeadlineRisk,
      -bFirstExpiringArrival, -bExpiringDistance,
      -bEffectiveEmpty, -b.turnbackPenalty,
      b.treasure, b.cultLeader, b.fanatic, b.special, bPostLeaderProgress,
      bEfficiency, b.dangerValue, b.activity,
      -b.trappedBranch, -bMiasmaDamage, -bExposure, b.urgency, b.shop,
      -b.retrace, -b.evacuationDistance, b.escapeOptions, -b.revisit, -b.danger, -b.path.length];
    for (let index = 0; index < 15; index += 1) {
      if (av[index] !== bv[index])
        return bv[index] - av[index];
    }
    // Apply the phase category only when both routes actually contain a
    // combat/activity target. It must not make an optional event detour beat
    // a shorter treasure-only route.
    if (aPhaseCombatTier > 0 && bPhaseCombatTier > 0
      && aPhaseCombatTier !== bPhaseCombatTier)
      return bPhaseCombatTier - aPhaseCombatTier;
    for (let index = 15; index < av.length; index += 1) {
      if (av[index] !== bv[index])
        return bv[index] - av[index];
    }
    return 0;
  }

  function candidateHasValue(candidate) {
    return candidate.treasure > 0 || candidate.cultLeader > 0 || candidate.fanatic > 0
      || candidate.special > 0 || candidate.dangerValue > 0
      || candidate.activity > 0 || candidate.shop > 0
      || candidate.floatingCastle > 0;
  }

  function hasContinuousValueAfterCombatSpecial(
    graph, startId, previousId, visited, currency, shops, state,
  ) {
    const queue = [...(graph.adjacency.get(startId) || [])]
      .filter(id => id !== previousId)
      .map(id => ({ id, combatDepth: 0 }));
    const seen = new Set([startId]);
    while (queue.length) {
      const current = queue.shift();
      if (seen.has(current.id))
        continue;
      seen.add(current.id);
      const node = graph.byId.get(current.id);
      if (!node || visited.has(node.id))
        continue;
      if (isFanaticNode(node) || isCultLeaderNode(node)) {
        if (current.combatDepth >= 2)
          continue;
        for (const nextId of graph.adjacency.get(node.id) || []) {
          if (!seen.has(nextId))
            queue.push({ id: nextId, combatDepth: current.combatDepth + 1 });
        }
        continue;
      }
      return candidateHasValue(nodeGain(node, visited, currency, shops, state));
    }
    return false;
  }

  function continuationValueGap(graph, startId, visited, currency, shops, state) {
    const queue = [{ id: startId, emptyCost: 0 }];
    const bestCost = new Map([[startId, 0]]);
    while (queue.length) {
      queue.sort((a, b) => a.emptyCost - b.emptyCost);
      const current = queue.shift();
      if (current.emptyCost !== bestCost.get(current.id))
        continue;
      if (current.id !== startId) {
        const node = graph.byId.get(current.id);
        if (node && !visited.has(node.id)
          && candidateHasValue(nodeGain(node, visited, currency, shops, state)))
          return current.emptyCost;
      }
      for (const adjacentId of graph.adjacency.get(current.id) || []) {
        const adjacent = graph.byId.get(adjacentId);
        if (!adjacent)
          continue;
        const isFutureValue = !visited.has(adjacentId)
          && candidateHasValue(nodeGain(adjacent, visited, currency, shops, state));
        const emptyCost = current.emptyCost + (isFutureValue ? 0
          : (visited.has(adjacentId) || adjacent.type === 0 || adjacent.isPassedDanger ? 1 : 0));
        if (emptyCost >= (bestCost.get(adjacentId) ?? Infinity))
          continue;
        bestCost.set(adjacentId, emptyCost);
        queue.push({ id: adjacentId, emptyCost });
      }
    }
    // Collecting the final remaining reward must not create a phantom penalty.
    return 0;
  }

  function completedFirstShrinkOuterSweepDistance(state, graph, fromId, node) {
    const firstShrinkCompleted = state?.miasma?.active
      && Number(state.miasma.level) === 1
      && (Number(state.miasma.status) === 2 || Number(state.miasma.step) >= 100);
    if (!firstShrinkCompleted || !node
      || !Number.isFinite(Number(node.x)) || !Number.isFinite(Number(node.y)))
      return 0;
    const centerX = numberOrNull(
      state.miasma.circleCenterX ?? state.miasma.centerX
        ?? state.firstShrinkFinalCircle?.center?.x,
    );
    const centerY = numberOrNull(
      state.miasma.circleCenterY ?? state.miasma.centerY
        ?? state.firstShrinkFinalCircle?.center?.y,
    );
    if (centerX === null || centerY === null)
      return 0;
    const exits = [...(graph.adjacency.get(node.id) || [])]
      .filter(id => id !== fromId);
    // A true dead end still requires an immediate return. The outer-first
    // preference is only for a continuing cycle/corridor that can be swept
    // from the boundary toward the interior without retracing.
    if (!exits.length || isBridgeEdge(graph, fromId, node.id))
      return 0;
    return Math.hypot(Number(node.x) - centerX, Number(node.y) - centerY);
  }

  function collectFutureExpiringValueNodeIds(state, deadlines, visited = new Set()) {
    if (!state.miasma.active || state.miasma.level !== 1 || state.miasma.status !== 1)
      return new Set();
    return new Set(state.nodes.filter((node) => {
      const deadline = deadlines.get(node.id) ?? Infinity;
      if (!Number.isFinite(deadline) || deadline <= state.totalTurn || visited.has(node.id))
        return false;
      const gain = nodeGain(node, visited, state.currency, 0, state);
      return candidateHasValue(gain);
    }).map(node => node.id));
  }

  function gainUtility(gain) {
    return gain.treasure * 6 + gain.cultLeader * 4 + gain.fanatic * 3
      + gain.special * 3 + gain.dangerValue + gain.activity * 2
      + gain.shop * 5 + gain.floatingCastle;
  }

  function searchConservativeFallbackRoute(state, graph, deadlines) {
    const currentId = state.currentNodeId;
    if (!graph.byId.has(currentId))
      return { path: [currentId], reason: 'current-node-missing' };
    const initialVisited = new Set(
      state.nodes.filter(node => node.isVisited || node.isPassedDanger).map(node => node.id),
    );
    const firstShrinkActive = state.miasma.active
      && state.miasma.level === 1 && state.miasma.status === 1;
    const coreIds = estimateCoreNodeIds(state, graph, deadlines);
    if (firstShrinkActive && !coreIds.has(currentId)) {
      const evacuation = preferredFirstDayEvacuation(
        graph, currentId, deadlines, state.totalTurn, coreIds, [currentId],
        state, 0, initialVisited,
      );
      if (evacuation.path.length > 1)
        return { path: evacuation.path, reason: 'first-shrink-evacuation' };
    }

    const strictMiasmaAvoidance = Number(state.miasma.level) >= 2
      || Number(state.miasma.status) >= 3;
    const targets = [];
    for (const node of state.nodes) {
      if (node.id === currentId || initialVisited.has(node.id)
        || !graph.byId.has(node.id) || isFloatingCastleResearcherNode(node))
        continue;
      if (firstShrinkActive && Number.isFinite(deadlines.get(node.id) ?? Infinity))
        continue;
      const combatSpecial = isFanaticNode(node) || isCultLeaderNode(node);
      const optionalFloatingCastle = isFloatingCastleTransferNode(node);
      if (node.type === 10 && dangerPhase(state) === 'first-day'
        && !confirmedFixedSpecialEvent(node, state.mapId)
        && !combatSpecial && !optionalFloatingCastle)
        continue;
      if (combatSpecial && !hasContinuousValueAfterCombatSpecial(
        graph, node.id, null, new Set([...initialVisited, node.id]),
        state.currency, 0, state,
      ))
        continue;
      const gain = nodeGain(node, initialVisited, state.currency, 0, state);
      const utility = gainUtility(gain);
      if (utility <= 0)
        continue;
      const path = shortestPath(
        graph, currentId, node.id, deadlines, state.totalTurn, state, 0,
        initialVisited, false,
      );
      if (path.length <= 1)
        continue;
      if (firstShrinkActive
        && path.slice(1).some(id => Number.isFinite(deadlines.get(id) ?? Infinity)))
        continue;
      const cost = assessPathTurnsAndMiasma(
        path, graph, state, deadlines, state.totalTurn, false, initialVisited,
      );
      const emptyCount = path.slice(1).filter((id) => {
        const pathNode = graph.byId.get(id);
        return pathNode?.type === 0 || pathNode?.isVisited || pathNode?.isPassedDanger;
      }).length;
      targets.push({
        path,
        utility,
        efficiency: utility / Math.max(1, cost.elapsedTurns + cost.damagePercent / 2),
        emptyCount,
        ...cost,
      });
    }
    targets.sort((a, b) => (
      (strictMiasmaAvoidance ? a.damagePercent - b.damagePercent : 0)
      || b.efficiency - a.efficiency
      || b.utility - a.utility
      || a.emptyCount - b.emptyCount
      || a.elapsedTurns - b.elapsedTurns
    ));
    if (targets.length)
      return { path: targets[0].path, reason: 'nearest-reachable-value' };

    const evacuation = preferredFirstDayEvacuation(
      graph, currentId, deadlines, state.totalTurn, coreIds, [currentId],
      state, 0, initialVisited,
    );
    if (evacuation.path.length > 1)
      return { path: evacuation.path, reason: 'safe-core-evacuation' };

    const damageBudget = miasmaHealthBudgetPercent(state);
    const neighborChoices = [...(graph.adjacency.get(currentId) || [])].map((id) => {
      const node = graph.byId.get(id);
      if (!node)
        return null;
      if (dangerPhase(state) === 'first-day' && DANGER_TYPES.has(node.type))
        return null;
      if (node.type === 8 && Number(state.currency) < 500)
        return null;
      if (firstShrinkActive && Number.isFinite(deadlines.get(id) ?? Infinity))
        return null;
      const processingTurns = initialVisited.has(id) ? 0 : estimatedNodeProcessingTurns(node);
      const cost = nodeTurnMiasmaCost(
        state, deadlines, id, state.totalTurn + 1, 1 + processingTurns,
      );
      if (cost.damagePercent > damageBudget)
        return null;
      return {
        id,
        damagePercent: cost.damagePercent,
        unvisited: initialVisited.has(id) ? 0 : 1,
        nonEmpty: node.type === 0 ? 0 : 1,
        exits: graph.adjacency.get(id)?.size || 0,
      };
    }).filter(Boolean).sort((a, b) => (
      a.damagePercent - b.damagePercent
      || b.unvisited - a.unvisited
      || b.nonEmpty - a.nonEmpty
      || b.exits - a.exits
      || a.id - b.id
    ));
    if (neighborChoices.length)
      return { path: [currentId, neighborChoices[0].id], reason: 'safe-adjacent-step' };
    return { path: [currentId], reason: 'no-safe-adjacent-node' };
  }

  function pathMiasmaExposures(path, deadlines, startTurn) {
    let count = 0;
    for (let index = 1; index < path.length; index += 1)
      count += miasmaExposureAt(deadlines, path[index], startTurn + index);
    return count;
  }

  function pathMiasmaDamage(path, state, deadlines, startTurn) {
    let damagePercent = 0;
    for (let index = 1; index < path.length; index += 1)
      damagePercent += miasmaDamageAt(state, deadlines, path[index], startTurn + index);
    return damagePercent;
  }

  function compareBossDetourCandidates(a, b) {
    const av = [-a.totalMiasmaDamagePercent, a.treasure, a.cultLeader, a.fanatic, a.special, a.dangerValue, a.activity, a.shop,
      a.floatingCastle, -a.empty, -a.revisit, -a.totalSteps];
    const bv = [-b.totalMiasmaDamagePercent, b.treasure, b.cultLeader, b.fanatic, b.special, b.dangerValue, b.activity, b.shop,
      b.floatingCastle, -b.empty, -b.revisit, -b.totalSteps];
    for (let index = 0; index < av.length; index += 1) {
      if (av[index] !== bv[index])
        return bv[index] - av[index];
    }
    return 0;
  }

  function searchBossRouteWithDetours(
    state, graph, deadlines, bossIds, maxDetourSteps = 8, beamWidth = 80,
  ) {
    const miasmaDamageBudget = miasmaHealthBudgetPercent(state);
    const initialVisited = new Set(state.nodes.filter(node => node.isVisited).map(node => node.id));
    const directPaths = bossIds.map(id => shortestPath(
      graph, state.currentNodeId, id, deadlines, state.totalTurn, state, 0, initialVisited,
    )).filter(path => path.length > 0).sort((a, b) => {
      const aCost = assessPathTurnsAndMiasma(
        a, graph, state, deadlines, state.totalTurn, true, initialVisited,
      );
      const bCost = assessPathTurnsAndMiasma(
        b, graph, state, deadlines, state.totalTurn, true, initialVisited,
      );
      return aCost.damagePercent - bCost.damagePercent
        || aCost.elapsedTurns - bCost.elapsedTurns;
    });
    const directPath = directPaths[0] || [];
    const directCost = assessPathTurnsAndMiasma(
      directPath, graph, state, deadlines, state.totalTurn, true, initialVisited,
    );
    const remainTurn = Number(state.miasma.remainTurn);
    if (!directPath.length || !Number.isFinite(remainTurn))
      return { path: directPath, detour: false };
    // Reach the boss with enough countdown left to absorb a multi-turn fight.
    // This is intentionally independent of
    // ordinary turnback penalties: second-shrink side trips may go out and back.
    const stepBudget = Math.max(
      0,
      Math.floor(remainTurn) - SECOND_SHRINK_BOSS_ARRIVAL_BUFFER_TURNS,
    );
    if (directCost.elapsedTurns >= stepBudget)
      return { path: directPath, detour: false };
    let beam = [{
      id: state.currentNodeId,
      path: [state.currentNodeId],
      visited: initialVisited,
      treasure: 0, cultLeader: 0, fanatic: 0, special: 0, activity: 0,
      dangerValue: 0, dangerTier: 0,
      shop: 0, floatingCastle: 0, empty: 0, revisit: 0,
      currency: state.currency, shops: 0, miasmaExposures: 0, miasmaDamagePercent: 0,
      elapsedTurns: 0,
    }];
    let best = null;
    const bossIdSet = new Set(bossIds);
    const depthLimit = Math.min(maxDetourSteps, stepBudget);
    for (let depth = 0; depth < depthLimit; depth += 1) {
      const nextBeam = [];
      for (const candidate of beam) {
        for (const nextId of graph.adjacency.get(candidate.id) || []) {
          if (candidate.path.filter(id => id === nextId).length >= 2)
            continue;
          const node = graph.byId.get(nextId);
          if (!node)
            continue;
          const combatSpecial = isFanaticNode(node) || isCultLeaderNode(node);
          const optionalFloatingCastle = isFloatingCastleTransferNode(node);
          if (node.type === 10 && dangerPhase(state) === 'first-day'
            && !confirmedFixedSpecialEvent(node, state.mapId)
            && !combatSpecial && !optionalFloatingCastle)
            continue;
          if (combatSpecial && !hasContinuousValueAfterCombatSpecial(
            graph, node.id, candidate.id, new Set([...candidate.visited, node.id]),
            candidate.currency, candidate.shops, state,
          ))
            continue;
          const arrivalTurn = state.totalTurn + candidate.elapsedTurns + 1;
          const processingTurns = bossIdSet.has(nextId)
            ? 0
            : estimatedNodeProcessingTurns(node);
          const occupiedCost = nodeTurnMiasmaCost(
            state, deadlines, nextId, arrivalTurn, 1 + processingTurns,
          );
          const elapsedTurns = candidate.elapsedTurns + 1 + processingTurns;
          const departureTurn = state.totalTurn + elapsedTurns;
          const miasmaExposures = candidate.miasmaExposures + occupiedCost.exposures;
          const miasmaDamagePercent = candidate.miasmaDamagePercent
            + occupiedCost.damagePercent;
          if (miasmaDamagePercent > miasmaDamageBudget)
            continue;
          const gain = bossIdSet.has(nextId)
            ? {
              treasure: 0, cultLeader: 0, fanatic: 0, special: 0, activity: 0,
              dangerValue: 0, dangerTier: 0,
              shop: 0, floatingCastle: 0, empty: 0, revisit: 0,
            }
            : nodeGain(node, candidate.visited, candidate.currency, candidate.shops, state);
          const visited = new Set(candidate.visited);
          visited.add(nextId);
          const nextPath = [...candidate.path, nextId];
          const item = {
            id: nextId,
            path: nextPath,
            visited,
            treasure: candidate.treasure + gain.treasure,
            cultLeader: candidate.cultLeader + gain.cultLeader,
            fanatic: candidate.fanatic + gain.fanatic,
            special: candidate.special + gain.special,
            dangerValue: candidate.dangerValue + gain.dangerValue,
            dangerTier: Math.max(candidate.dangerTier, gain.dangerTier),
            activity: candidate.activity + gain.activity,
            shop: candidate.shop + gain.shop,
            floatingCastle: candidate.floatingCastle + gain.floatingCastle,
            empty: candidate.empty + gain.empty,
            revisit: candidate.revisit + gain.revisit,
            currency: candidate.currency + expectedCurrencyGain(node, state),
            shops: candidate.shops + gain.shop,
            miasmaExposures,
            miasmaDamagePercent,
            elapsedTurns,
          };
          const bossPaths = bossIds.map(id => shortestPath(
            graph, nextId, id, deadlines, departureTurn, state, miasmaDamagePercent,
            visited,
          )).filter(path => path.length > 0).sort((a, b) => {
            const aCost = assessPathTurnsAndMiasma(
              a, graph, state, deadlines, departureTurn, true, visited,
            );
            const bCost = assessPathTurnsAndMiasma(
              b, graph, state, deadlines, departureTurn, true, visited,
            );
            return aCost.damagePercent - bCost.damagePercent
              || aCost.elapsedTurns - bCost.elapsedTurns;
          });
          const bossPath = bossPaths[0] || [];
          if (bossPath.length) {
            const combinedPath = [...nextPath, ...bossPath.slice(1)];
            const bossPathCost = assessPathTurnsAndMiasma(
              bossPath, graph, state, deadlines, departureTurn, true, visited,
            );
            const totalSteps = elapsedTurns + bossPathCost.elapsedTurns;
            const totalMiasmaExposures = miasmaExposures + bossPathCost.exposures;
            const totalMiasmaDamagePercent = miasmaDamagePercent
              + bossPathCost.damagePercent;
            const completed = {
              ...item, combinedPath, totalSteps, totalMiasmaExposures, totalMiasmaDamagePercent,
            };
            if (totalSteps <= stepBudget
              && totalMiasmaDamagePercent <= miasmaDamageBudget
              && candidateHasValue(completed)
              && (!best || compareBossDetourCandidates(completed, best) < 0))
              best = completed;
          }
          if (!bossIdSet.has(nextId))
            nextBeam.push(item);
        }
      }
      if (!nextBeam.length)
        break;
      nextBeam.sort((a, b) => {
        const aPartial = {
          ...a, totalSteps: a.elapsedTurns,
          totalMiasmaExposures: a.miasmaExposures,
          totalMiasmaDamagePercent: a.miasmaDamagePercent,
        };
        const bPartial = {
          ...b, totalSteps: b.elapsedTurns,
          totalMiasmaExposures: b.miasmaExposures,
          totalMiasmaDamagePercent: b.miasmaDamagePercent,
        };
        return compareBossDetourCandidates(aPartial, bPartial);
      });
      beam = nextBeam.slice(0, beamWidth);
    }
    if (!best)
      return { path: directPath, detour: false };
    const detour = best.combinedPath.length !== directPath.length
      || best.combinedPath.some((id, index) => id !== directPath[index]);
    return { path: best.combinedPath, detour };
  }

  function searchValueRoute(state, graph, deadlines, maxSteps = 10, beamWidth = 80) {
    const miasmaDamageBudget = miasmaHealthBudgetPercent(state);
    const firstShrinkActive = state.miasma.active
      && state.miasma.level === 1 && state.miasma.status === 1;
    const firstShrinkSafeArrivalDeadline = firstShrinkActive
      && Number.isFinite(Number(state.miasma.remainTurn))
      ? state.totalTurn + Number(state.miasma.remainTurn)
        - FIRST_SHRINK_SAFE_ARRIVAL_BUFFER_TURNS
      : Infinity;
    const initialVisited = new Set(state.nodes.filter(node => node.isVisited).map(node => node.id));
    const expiringValueNodeIds = collectFutureExpiringValueNodeIds(
      state, deadlines, initialVisited,
    );
    const expiringTargetDistances = distancesToTargets(graph, expiringValueNodeIds);
    const coreIds = estimateCoreNodeIds(state, graph, deadlines);
    const initialEvacuation = preferredFirstDayEvacuation(
      graph, state.currentNodeId, deadlines, state.totalTurn, coreIds, [state.currentNodeId],
      state, 0, initialVisited,
    );
    let beam = [{
      id: state.currentNodeId, path: [state.currentNodeId], visited: initialVisited,
      treasure: 0, fanatic: 0, cultLeader: 0, floatingCastle: 0,
      activity: 0, special: 0, urgency: 0, shop: 0, revisit: 0, danger: 0, empty: 0,
      dangerValue: 0, dangerTier: 0,
      evacuationDistance: initialEvacuation.distance,
      elapsedTurns: 0,
      miasmaExposures: 0,
      miasmaDamagePercent: 0,
      evacuationMiasmaExposures: initialEvacuation.miasmaExposures,
      evacuationMiasmaDamagePercent: initialEvacuation.miasmaDamagePercent,
      strictMiasmaAvoidance: Number(state.miasma.level) >= 2 || Number(state.miasma.status) >= 3,
      retrace: initialEvacuation.retrace,
      escapeOptions: initialEvacuation.escapeOptions,
      currency: state.currency, shops: 0, turnbackPenalty: 0, trappedBranch: 0,
      continuationGap: 0, valueNodeCount: 0,
      expiringValue: 0,
      lateExpiringValue: 0,
      expiringUrgency: 0,
      expiringDeadlineRisk: 0,
      expiringTargetDistance: expiringTargetDistances.get(state.currentNodeId) ?? Infinity,
      firstExpiringArrival: Infinity,
      firstValueArrival: Infinity,
      outerSweepDistance: 0,
      latePhase: dangerPhase(state) !== 'first-day',
    }];
    let best = null;
    let bestFallback = null;
    for (let depth = 0; depth < maxSteps; depth += 1) {
      const nextBeam = [];
      for (const candidate of beam) {
        for (const nextId of graph.adjacency.get(candidate.id) || []) {
          if (candidate.path.filter(id => id === nextId).length >= 2)
            continue;
          const node = graph.byId.get(nextId);
          const processingTurns = estimatedNodeProcessingTurns(node);
          const arrivalTurn = state.totalTurn + candidate.elapsedTurns + 1;
          const occupiedCost = nodeTurnMiasmaCost(
            state, deadlines, nextId, arrivalTurn, 1 + processingTurns,
          );
          const elapsedTurns = candidate.elapsedTurns + 1 + processingTurns;
          const departureTurn = state.totalTurn + elapsedTurns;
          const miasmaExposures = candidate.miasmaExposures + occupiedCost.exposures;
          const miasmaDamagePercent = candidate.miasmaDamagePercent
            + occupiedCost.damagePercent;
          if (miasmaDamagePercent > miasmaDamageBudget)
            continue;
          if (firstShrinkActive
            && !canReachPermanentSafe(
              graph, nextId, deadlines, departureTurn, state, miasmaDamagePercent,
              new Set([...candidate.visited, nextId]),
            ))
            continue;
          const combatSpecial = isFanaticNode(node) || isCultLeaderNode(node);
          const optionalFloatingCastle = isFloatingCastleTransferNode(node);
          // 固定特殊イベントは2日目向け。1日目は戦力不足を前提に経路候補から外す。
          if (node.type === 10 && dangerPhase(state) === 'first-day'
            && !confirmedFixedSpecialEvent(node, state.mapId)
            && !combatSpecial && !optionalFloatingCastle)
            continue;
          if (combatSpecial && !hasContinuousValueAfterCombatSpecial(
            graph, node.id, candidate.id, new Set([...candidate.visited, node.id]),
            candidate.currency, candidate.shops, state,
          ))
            continue;
          const gain = nodeGain(node, candidate.visited, candidate.currency, candidate.shops, state);
          const gainedValueNode = candidateHasValue(gain);
          const expiringGain = expiringValueNodeIds.has(nextId)
            ? gain.treasure * 6 + gain.cultLeader * 4 + gain.fanatic * 3
              + gain.special * 3 + gain.activity * 2 + gain.shop * 5 + gain.floatingCastle
              + gain.dangerValue
            : 0;
          const deadline = deadlines.get(nextId) ?? Infinity;
          const timelyExpiringGain = expiringGain > 0
            && Number.isFinite(deadline) && departureTurn < deadline
            ? expiringGain
            : 0;
          const lateExpiringGain = expiringGain - timelyExpiringGain;
          const deadlineWindow = Number.isFinite(deadline)
            ? Math.max(1, deadline - state.totalTurn)
            : Infinity;
          const deadlineRisk = timelyExpiringGain > 0
            ? elapsedTurns / deadlineWindow
            : (lateExpiringGain > 0
              ? 1 + Math.max(0, departureTurn - deadline) / deadlineWindow
              : 0);
          const urgency = Number.isFinite(deadline) && (node.type === 2 || node.type === 5 || node.type === 6)
            ? Math.max(0, 4 - (deadline - departureTurn))
            : 0;
          const visited = new Set(candidate.visited);
          visited.add(nextId);
          const nextPath = [...candidate.path, nextId];
          const previousId = candidate.path.at(-2);
          const immediateTurnback = previousId === nextId;
          const hasForwardExit = [...(graph.adjacency.get(nextId) || [])]
            .some(id => id !== candidate.id
              && miasmaDamagePercent + miasmaDamageAt(state, deadlines, id, departureTurn + 1)
                <= miasmaDamageBudget);
          const hasAlternativeAtDeparture = [...(graph.adjacency.get(candidate.id) || [])]
            .some(id => id !== nextId && id !== previousId
              && candidate.miasmaDamagePercent
                + miasmaDamageAt(state, deadlines, id, arrivalTurn) <= miasmaDamageBudget);
          const forcedReturnRisk = !hasForwardExit
            && hasAlternativeAtDeparture
            && graph.adjacency.get(nextId)?.has(candidate.id);
          const evacuation = evacuationAssessment(
            graph, nextId, deadlines, departureTurn, coreIds, nextPath,
            state, miasmaDamagePercent, visited,
          );
          if (!Number.isFinite(evacuation.distance))
            continue;
          if (firstShrinkActive
            && departureTurn + evacuation.distance > firstShrinkSafeArrivalDeadline)
            continue;
          const item = {
            id: nextId,
            path: nextPath,
            visited,
            treasure: candidate.treasure + gain.treasure,
            fanatic: candidate.fanatic + gain.fanatic,
            cultLeader: candidate.cultLeader + gain.cultLeader,
            floatingCastle: candidate.floatingCastle + gain.floatingCastle,
            activity: candidate.activity + gain.activity,
            special: candidate.special + gain.special,
            dangerValue: candidate.dangerValue + gain.dangerValue,
            dangerTier: Math.max(candidate.dangerTier, gain.dangerTier),
            urgency: candidate.urgency + urgency,
            shop: candidate.shop + gain.shop,
            revisit: candidate.revisit + gain.revisit,
            danger: candidate.danger + gain.danger,
            empty: candidate.empty + gain.empty,
            evacuationDistance: evacuation.distance,
            elapsedTurns,
            miasmaExposures,
            miasmaDamagePercent,
            evacuationMiasmaExposures: evacuation.miasmaExposures,
            evacuationMiasmaDamagePercent: evacuation.miasmaDamagePercent,
            strictMiasmaAvoidance: candidate.strictMiasmaAvoidance,
            retrace: evacuation.retrace,
            escapeOptions: evacuation.escapeOptions,
            currency: candidate.currency + expectedCurrencyGain(node, state),
            shops: candidate.shops + gain.shop,
            trappedBranch: candidate.path.length === 1
              && (graph.adjacency.get(state.currentNodeId)?.size || 0) > 1
              && node.type !== 9
              && isBridgeEdge(graph, state.currentNodeId, nextId) ? 1 : candidate.trappedBranch,
            turnbackPenalty: candidate.turnbackPenalty
              + (immediateTurnback ? 2 : 0)
              + (forcedReturnRisk ? 1 : 0),
            // 安置外回収価値は、そのノードが瘴気化する前に処理を完了できた場合だけ
            // 「期限付き価値」として加算する。期限後の回収を同価値で扱うと、
            // 締切の遅い寄り道を先に選び、早い締切へ間に合わなくなる。
            expiringValue: candidate.expiringValue + timelyExpiringGain,
            lateExpiringValue: candidate.lateExpiringValue + lateExpiringGain,
            expiringUrgency: candidate.expiringUrgency
              + (timelyExpiringGain > 0 ? timelyExpiringGain / deadlineWindow : 0),
            // 同じ期限付き価値を回収できる案では、利用可能時間に対する完了時刻の
            // 最大比率を最小化し、早い締切を後回しにする経路を抑制する。
            expiringDeadlineRisk: Math.max(candidate.expiringDeadlineRisk, deadlineRisk),
            expiringTargetDistance: expiringTargetDistances.get(nextId) ?? Infinity,
            firstExpiringArrival: Number.isFinite(candidate.firstExpiringArrival)
              ? candidate.firstExpiringArrival
              : (expiringGain > 0 ? elapsedTurns : Infinity),
            firstValueArrival: Number.isFinite(candidate.firstValueArrival)
              ? candidate.firstValueArrival
              : (gainedValueNode ? elapsedTurns : Infinity),
            outerSweepDistance: Number(candidate.outerSweepDistance) > 0
              ? candidate.outerSweepDistance
              : (gainedValueNode
                ? completedFirstShrinkOuterSweepDistance(
                  state, graph, candidate.id, node,
                )
                : 0),
            latePhase: candidate.latePhase,
          };
          item.valueNodeCount = candidate.valueNodeCount + (gainedValueNode ? 1 : 0);
          item.continuationGap = gainedValueNode && item.valueNodeCount === 1
            ? continuationValueGap(
              graph, nextId, visited, item.currency, item.shops, state,
            )
            : (item.valueNodeCount > 1 ? 0 : candidate.continuationGap);
          nextBeam.push(item);
          const harmlessFallback = item.empty === 0 && item.danger === 0 && item.revisit === 0;
          if (harmlessFallback && (!bestFallback || compareCandidates(item, bestFallback) < 0))
            bestFallback = item;
          // A short empty prefix is not a completed recommendation while a
          // reachable route that actually collects value exists.
          if (candidateHasValue(item) && (!best || compareCandidates(item, best) < 0))
            best = item;
        }
      }
      if (!nextBeam.length)
        break;
      nextBeam.sort(compareCandidates);
      beam = nextBeam.slice(0, beamWidth);
    }
    return best?.path
      || (firstShrinkActive && initialEvacuation.path.length > 1
        ? initialEvacuation.path
        : null)
      || bestFallback?.path
      || [state.currentNodeId];
  }

  function buildRouteTimeline(path, graph, state, deadlines) {
    const timeline = [];
    let elapsedTurns = 0;
    const processedNodeIds = new Set(
      state.nodes.filter(node => node.isVisited || node.isPassedDanger).map(node => node.id),
    );
    for (let index = 1; index < path.length; index += 1) {
      const nodeId = path[index];
      const node = graph.byId.get(nodeId);
      const arrivalTurn = state.totalTurn + elapsedTurns + 1;
      const processingTurns = processedNodeIds.has(nodeId)
        ? 0
        : estimatedNodeProcessingTurns(node);
      const occupiedTurns = 1 + processingTurns;
      const cost = nodeTurnMiasmaCost(
        state, deadlines, nodeId, arrivalTurn, occupiedTurns,
      );
      elapsedTurns += occupiedTurns;
      const departureTurn = state.totalTurn + elapsedTurns;
      const deadline = deadlines.get(nodeId) ?? Infinity;
      timeline.push({
        step: index,
        nodeId,
        arrivalTurn,
        processingTurns,
        departureTurn,
        deadline: Number.isFinite(deadline) ? deadline : null,
        completesBeforeDeadline: !Number.isFinite(deadline) || departureTurn < deadline,
        miasmaExposures: cost.exposures,
        miasmaDamagePercent: cost.damagePercent,
      });
      processedNodeIds.add(nodeId);
    }
    return timeline;
  }

  function planRoute(input, options = {}) {
    const state = normalizeState(input);
    const riskyFloatingCastleTransfer = isFloatingCastleTransferRisky(state);
    const routeNodes = state.nodes.filter(node => (
      !isFloatingCastleBodyNode(node, state.nodes)
      && !isFloatingCastleResearcherNode(node)
      && (!riskyFloatingCastleTransfer
        || !isFloatingCastleTransferNode(node)
        || node.id === state.currentNodeId)
    ));
    const graph = buildGraph(routeNodes, { disabledWarpNodeId: state.warpDeclinedAtNodeId });
    const displayGraph = buildGraph(state.nodes, { includeWarp: false });
    const localHops = collectLocalNodeIds(displayGraph.adjacency, state.currentNodeId, options.fallbackHops ?? 4);
    const localDistances = collectLocalNodeIdsByRadius(
      state.nodes, displayGraph.adjacency, state.currentNodeId, options.localRadius ?? 600,
      options.fallbackHops ?? 4,
    );
    const deadlines = estimateUnsafeTurns(state, graph);
    const firstShrinkSimulation = simulateFirstShrinkArea(state);
    const secondShrinkSimulation = simulateSecondShrinkArea(state, graph);
    // The miasma payload can retain the first-day boss target after the battle.
    // Once that node is visited, leave boss mode and resume value-route planning
    // instead of routing back through the consumed approach path.
    const bossIds = state.nodes
      .filter(node => node.type === 1 && !node.isVisited)
      .map(node => node.id);
    const miasmaBossNode = graph.byId.get(state.miasma.bossNodeId);
    if (state.miasma.bossNodeId !== null && graph.byId.has(state.miasma.bossNodeId)
      && !miasmaBossNode?.isVisited
      && !bossIds.includes(state.miasma.bossNodeId))
      bossIds.push(state.miasma.bossNodeId);
    const bossMode = bossIds.length > 0 && Boolean(secondShrinkSimulation);
    let path = [];
    let mode = 'value';
    let fallbackReason = null;
    if (bossMode) {
      const bossRoute = searchBossRouteWithDetours(
        state, graph, deadlines, bossIds,
        options.maxBossDetourSteps ?? 8, options.beamWidth ?? 80,
      );
      mode = bossRoute.detour ? 'boss-detour' : 'boss';
      path = bossRoute.path;
    }
    else {
      path = searchValueRoute(state, graph, deadlines, options.maxSteps ?? 10, options.beamWidth ?? 80);
      const expiringValueNodeIds = collectFutureExpiringValueNodeIds(
        state, deadlines, new Set(state.nodes.filter(node => node.isVisited).map(node => node.id)),
      );
      if (path.some(id => expiringValueNodeIds.has(id)))
        mode = 'first-shrink-outer';
    }
    if (path.length <= 1) {
      const fallback = searchConservativeFallbackRoute(state, graph, deadlines);
      path = fallback.path;
      fallbackReason = fallback.reason;
      mode = path.length > 1 ? 'fallback' : 'blocked';
    }
    const warpTransition = findWarpTransition(path, graph);
    const routeTimeline = buildRouteTimeline(path, graph, state, deadlines);
    const miasmaExposureCount = routeTimeline
      .reduce((sum, step) => sum + step.miasmaExposures, 0);
    const miasmaDamagePercent = routeTimeline
      .reduce((sum, step) => sum + step.miasmaDamagePercent, 0);
    const miasmaExposureNodeIds = routeTimeline
      .filter(step => step.miasmaExposures > 0)
      .map(step => step.nodeId);
    const elapsedRouteTurns = routeTimeline.at(-1)?.departureTurn - state.totalTurn || 0;
    const currentIsWarp = graph.byId.get(state.currentNodeId)?.type === 9;
    const displayPath = warpTransition ? path.slice(0, warpTransition.index + 1) : path;
    const transferDecision = warpTransition
      ? { action: 'transfer', fromId: warpTransition.fromId }
      : (currentIsWarp ? { action: 'stay', fromId: state.currentNodeId } : null);
    const bossArrivalRemainingTurns = bossMode
      && Number.isFinite(Number(state.miasma.remainTurn))
      ? Number(state.miasma.remainTurn) - elapsedRouteTurns
      : null;
    const warning = fallbackReason === 'no-safe-adjacent-node'
      ? '既知の安全・価値制約を満たす移動先がありません'
      : (bossArrivalRemainingTurns !== null
        && bossArrivalRemainingTurns < SECOND_SHRINK_BOSS_ARRIVAL_BUFFER_TURNS
        ? `最短経路でもボス到着時の収縮余力は${Math.max(0, bossArrivalRemainingTurns)}ターンです`
        : '');
    return {
      state,
      graph,
      displayGraph,
      localDistances,
      localHops,
      localRadius: options.localRadius ?? 600,
      deadlines,
      path,
      displayPath,
      routeTimeline,
      transferDecision,
      mode,
      phase: dangerPhase(state),
      miasmaTraversalAllowed: state.miasma.active
        && Number(state.miasma.level) === 1
        && Number(state.miasma.status) === 1,
      fallbackReason,
      estimatedRouteTurns: elapsedRouteTurns,
      firstShrinkSafeArrivalBufferTurns: FIRST_SHRINK_SAFE_ARRIVAL_BUFFER_TURNS,
      secondShrinkBossArrivalBufferTurns: SECOND_SHRINK_BOSS_ARRIVAL_BUFFER_TURNS,
      bossArrivalRemainingTurns,
      bossIds,
      firstShrinkSimulation,
      secondShrinkSimulation,
      miasmaHealthBudgetPercent: miasmaHealthBudgetPercent(state),
      miasmaHpReservePercent: (Number(state.miasma.level) >= 2 || Number(state.miasma.status) >= 3)
        ? SECOND_SHRINK_HP_RESERVE_PERCENT
        : 0,
      miasmaMinAbsoluteHp: (Number(state.miasma.level) >= 2 || Number(state.miasma.status) >= 3)
        ? SECOND_SHRINK_MIN_ABSOLUTE_HP
        : 0,
      miasmaDamagePercent,
      miasmaExposureCount,
      miasmaExposureNodeIds,
      typeLabels: TYPE_LABELS,
      warning,
    };
  }

  return {
    TYPE_LABELS,
    FIRST_SHRINK_DAMAGE_PERCENT,
    FIRST_SHRINK_COMPLETE_DAMAGE_PERCENT,
    FIRST_SHRINK_PATTERN_MODELS,
    FIRST_SHRINK_FALLBACK_RADIUS,
    SECOND_SHRINK_HP_RESERVE_PERCENT,
    SECOND_SHRINK_MIN_ABSOLUTE_HP,
    SECOND_SHRINK_BOSS_ARRIVAL_BUFFER_TURNS,
    SECOND_SHRINK_DURATION_TURNS,
    CONFIRMED_FIXED_SPECIAL_EVENTS,
    NODE_VISUALS,
    SPECIAL_VISUALS,
    nodeVisual,
    confirmedFixedSpecialEvent,
    fixedSpecialEventValue,
    estimatedNodeProcessingTurns,
    dangerPhase,
    isFanaticNode,
    isCultLeaderNode,
    isFloatingCastleTransferNode,
    isFloatingCastleBodyNode,
    isFloatingCastleResearcherNode,
    isFloatingCastleTransferRisky,
    hasPostCultLeaderValueRoute,
    isBridgeEdge,
    candidateHasValue,
    searchConservativeFallbackRoute,
    pathMiasmaExposures,
    pathMiasmaDamage,
    searchBossRouteWithDetours,
    simulateFirstShrinkArea,
    predictFirstShrinkArea,
    createFirstShrinkCircleSnapshot,
    createFirstShrinkLearningObservation,
    inferCircleFromObservedMiasma,
    simulateSecondShrinkArea,
    normalizeNode,
    normalizeState,
    buildGraph,
    findWarpTransition,
    collectLocalNodeIds,
    collectLocalNodeIdsByRadius,
    estimateUnsafeTurns,
    miasmaExposureAt,
    completedShrinkCountAt,
    miasmaDamageRateAt,
    miasmaDamageAt,
    miasmaHealthBudgetPercent,
    shortestPath,
    canReachPermanentSafe,
    estimateCoreNodeIds,
    evacuationAssessment,
    preferredFirstDayEvacuation,
    buildRouteTimeline,
    planRoute,
  };
});
