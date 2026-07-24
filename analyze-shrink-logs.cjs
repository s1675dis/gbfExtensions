const fs = require('fs');
const readline = require('readline');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node analyze-shrink-logs.cjs <trace.jsonl> [...]');
  process.exit(1);
}

function walk(value, visitor, path = '$', seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, visitor, `${path}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      walk(child, visitor, `${path}.${key}`, seen);
    }
  }
}

function firstDefined(object, keys) {
  for (const key of keys) {
    if (object[key] !== undefined && object[key] !== null) return object[key];
  }
  return null;
}

function summarizeMiasma(object) {
  const looksRelevant = [
    'is_miasmic', 'miasma_level', 'miasma_status', 'miasma_step',
    'base_pattern_id', 'pattern_id', 'center_position_x',
    'center_position_y', 'shrink_node_ids', 'remain_turn'
  ].some((key) => Object.hasOwn(object, key));
  if (!looksRelevant) return null;

  return {
    active: firstDefined(object, ['is_miasmic', 'active']),
    level: firstDefined(object, ['miasma_level', 'level']),
    status: firstDefined(object, ['miasma_status', 'status']),
    step: firstDefined(object, ['miasma_step', 'step']),
    remain: firstDefined(object, ['remain_turn', 'remain']),
    basePatternId: firstDefined(object, ['base_pattern_id']),
    patternId: firstDefined(object, ['pattern_id']),
    centerX: firstDefined(object, ['center_position_x']),
    centerY: firstDefined(object, ['center_position_y']),
    centerNodeId: firstDefined(object, ['center_node_id']),
    shrinkNodeIds: Array.isArray(object.shrink_node_ids) ? object.shrink_node_ids : null,
  };
}

async function analyze(file) {
  let lines;
  if (/\.json$/i.test(file)) {
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    lines = (Array.isArray(exported) ? exported : exported.entries || []).map((record) => JSON.stringify(record));
  } else {
    const input = fs.createReadStream(file, { encoding: 'utf8' });
    lines = readline.createInterface({ input, crlfDelay: Infinity });
  }
  const result = {
    file,
    lineCount: 0,
    parseErrors: 0,
    urls: new Map(),
    mapIds: new Set(),
    specialPaths: new Map(),
    interestingScalars: new Map(),
    snapshots: [],
    miasma: [],
  };

  for await (const line of lines) {
    result.lineCount += 1;
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      result.parseErrors += 1;
      continue;
    }

    if (record.url) result.urls.set(record.url, (result.urls.get(record.url) || 0) + 1);
    const stamp = record.capturedAt || null;
    const foundMiasma = [];
    const recordSnapshots = [];

    walk(record.responseData, (object, path) => {
      if (!path.includes('.node_list[')) {
        for (const [key, value] of Object.entries(object)) {
          if ((typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
            && /(scale|width|height|offset|center|position|circle|effect|map)/i.test(key)) {
            const scalarPath = `${path}.${key}`;
            if (!result.interestingScalars.has(scalarPath)) result.interestingScalars.set(scalarPath, new Set());
            const values = result.interestingScalars.get(scalarPath);
            if (values.size < 8) values.add(value);
          }
        }
      }
      for (const key of ['effectCjsOption', 'effect_cjs_option', 'limitCircle', 'limit_circle']) {
        if (Object.hasOwn(object, key)) result.specialPaths.set(`${path}.${key}`, typeof object[key]);
      }
      for (const key of ['map_id', 'mapId']) {
        if (Object.hasOwn(object, key) && object[key] !== null) result.mapIds.add(String(object[key]));
      }

      if (Array.isArray(object.node_list) && object.node_list.length) {
        const nodes = object.node_list.map((node) => ({
          id: firstDefined(node, ['node_id', 'id']),
          x: Number(firstDefined(node, ['position_x', 'x'])),
          y: Number(firstDefined(node, ['position_y', 'y'])),
          shrinking: Boolean(firstDefined(node, ['is_shrinking', 'shrinking'])),
          eventId: firstDefined(node, ['event_id', 'eventId']),
          type: firstDefined(node, ['node_type', 'type']),
        })).filter((node) => Number.isFinite(node.x) && Number.isFinite(node.y));
        if (nodes.length) {
          recordSnapshots.push({
            line: result.lineCount,
            stamp,
            path: `${path}.node_list`,
            nodes,
            totalTurn: firstDefined(object, ['total_turn', 'totalTurn']),
          });
        }
      }

      const miasma = summarizeMiasma(object);
      if (miasma) foundMiasma.push({ path, ...miasma });
    });

    const unique = new Map();
    for (const item of foundMiasma) {
      const key = JSON.stringify([
        item.active, item.level, item.status, item.step, item.remain,
        item.basePatternId, item.patternId, item.centerX, item.centerY,
        item.centerNodeId, item.shrinkNodeIds,
      ]);
      if (!unique.has(key)) unique.set(key, item);
    }
    for (const item of unique.values()) {
      result.miasma.push({ line: result.lineCount, stamp, ...item });
    }
    const phase = [...unique.values()].find((item) => item.step !== null && item.level !== null) || null;
    for (const snapshot of recordSnapshots) {
      result.snapshots.push({ ...snapshot, phase });
    }
  }

  const snapshots = result.snapshots.map((snapshot) => {
    const xs = snapshot.nodes.map((node) => node.x);
    const ys = snapshot.nodes.map((node) => node.y);
    return {
      line: snapshot.line,
      stamp: snapshot.stamp,
      path: snapshot.path,
      totalTurn: snapshot.totalTurn,
      nodeCount: snapshot.nodes.length,
      shrinkingCount: snapshot.nodes.filter((node) => node.shrinking).length,
      phase: snapshot.phase ? {
        active: snapshot.phase.active,
        level: snapshot.phase.level,
        status: snapshot.phase.status,
        step: snapshot.phase.step,
        basePatternId: snapshot.phase.basePatternId,
        patternId: snapshot.phase.patternId,
        centerX: snapshot.phase.centerX,
        centerY: snapshot.phase.centerY,
      } : null,
      bounds: {
        minX: Math.min(...xs), maxX: Math.max(...xs),
        minY: Math.min(...ys), maxY: Math.max(...ys),
      },
    };
  });

  const miasma = result.miasma.filter((item) =>
    item.basePatternId !== null || item.patternId !== null || item.step !== null ||
    item.level !== null || item.shrinkNodeIds !== null
  ).map((item) => ({
    line: item.line,
    stamp: item.stamp,
    path: item.path,
    active: item.active,
    level: item.level,
    status: item.status,
    step: item.step,
    remain: item.remain,
    basePatternId: item.basePatternId,
    patternId: item.patternId,
    centerX: item.centerX,
    centerY: item.centerY,
    centerNodeId: item.centerNodeId,
    shrinkNodeCount: item.shrinkNodeIds?.length ?? null,
    shrinkNodeIds: item.shrinkNodeIds,
  }));

  const output = {
    file: result.file,
    lineCount: result.lineCount,
    parseErrors: result.parseErrors,
    mapIds: [...result.mapIds],
    specialPaths: Object.fromEntries(result.specialPaths),
    interestingScalars: Object.fromEntries([...result.interestingScalars].map(([key, values]) => [key, [...values]])),
    urls: Object.fromEntries([...result.urls].sort((a, b) => b[1] - a[1])),
    snapshots,
    miasma,
  };
  Object.defineProperty(output, '_rawSnapshots', { value: result.snapshots, enumerable: false });
  return output;
}

function compact(result) {
  const phases = result.miasma.filter((item) =>
    item.step !== null && item.level !== null && item.basePatternId !== null
  );
  const phaseKeys = [...new Map(phases.map((item) => [
    [item.level, item.basePatternId, item.patternId, item.centerX, item.centerY].join(':'),
    {
      level: item.level,
      basePatternId: item.basePatternId,
      patternId: item.patternId,
      centerX: item.centerX,
      centerY: item.centerY,
      minStep: item.step,
      maxStep: item.step,
      statuses: new Set([item.status]),
    }
  ])).values()];
  for (const phase of phases) {
    const target = phaseKeys.find((item) =>
      item.level === phase.level && item.basePatternId === phase.basePatternId &&
      item.patternId === phase.patternId && item.centerX === phase.centerX && item.centerY === phase.centerY
    );
    target.minStep = Math.min(target.minStep, phase.step);
    target.maxStep = Math.max(target.maxStep, phase.step);
    target.statuses.add(phase.status);
  }

  const deltas = result.miasma.filter((item) => item.shrinkNodeCount > 0).map((item) => {
    const before = phases.filter((phase) => phase.line === item.line && phase.path.endsWith('.before'))[0];
    const after = phases.filter((phase) => phase.line === item.line && phase.path.endsWith('.after'))[0];
    return {
      line: item.line,
      fromStep: before?.step ?? null,
      toStep: after?.step ?? null,
      level: after?.level ?? before?.level ?? null,
      count: item.shrinkNodeCount,
      ids: item.shrinkNodeIds,
    };
  });

  return {
    file: result.file,
    lineCount: result.lineCount,
    parseErrors: result.parseErrors,
    mapIds: result.mapIds,
    specialPaths: result.specialPaths,
    interestingScalars: result.interestingScalars,
    phases: phaseKeys.map((item) => ({ ...item, statuses: [...item.statuses] })),
    snapshots: result.snapshots,
    deltas,
  };
}

function buildObservations(result) {
  const rawSnapshots = result._rawSnapshots || [];
  const snapshot = rawSnapshots.find((item) => item.nodes?.length);
  if (!snapshot) return null;
  const nodes = snapshot.nodes;
  const deltas = result.miasma.filter((item) => item.shrinkNodeCount > 0).map((item) => {
    const before = result.miasma.find((phase) => phase.line === item.line && phase.path.endsWith('.before'));
    const after = result.miasma.find((phase) => phase.line === item.line && phase.path.endsWith('.after'));
    return { step: after?.step ?? before?.step ?? null, ids: item.shrinkNodeIds || [] };
  }).filter((item) => Number.isFinite(item.step)).sort((a, b) => a.step - b.step);
  const phase = result.miasma.find((item) => item.basePatternId !== null && item.centerX !== null);
  if (!phase) return null;

  const observations = [];
  const shrinking = new Set();
  for (const delta of deltas) {
    delta.ids.forEach((id) => shrinking.add(String(id)));
    observations.push({ step: delta.step, shrinking: new Set(shrinking) });
  }
  for (const full of rawSnapshots) {
    if (!Number.isFinite(full.phase?.step)) continue;
    observations.push({
      step: full.phase.step,
      shrinking: new Set(full.nodes.filter((node) => node.shrinking).map((node) => String(node.id))),
    });
  }
  const byStep = new Map();
  observations.forEach((item) => byStep.set(item.step, item));
  const xs = nodes.map((node) => node.x);
  const ys = nodes.map((node) => node.y);
  return {
    file: result.file,
    mapId: result.mapIds[0] || null,
    basePatternId: phase.basePatternId,
    patternId: phase.patternId,
    serverCenter: { x: Number(phase.centerX), y: Number(phase.centerY) },
    startCenter: {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: (Math.min(...ys) + Math.max(...ys)) / 2,
    },
    nodes,
    observations: [...byStep.values()].sort((a, b) => a.step - b.step),
  };
}

function classify(dataset, model) {
  let mismatches = 0;
  let comparisons = 0;
  let loss = 0;
  const byStep = [];
  for (const observation of dataset.observations) {
    const progress = observation.step / 100;
    const cx = dataset.startCenter.x
      + (dataset.serverCenter.x + model.offsetX - dataset.startCenter.x) * progress;
    const cy = dataset.startCenter.y
      + (dataset.serverCenter.y + model.offsetY - dataset.startCenter.y) * progress;
    const radius = observation.step >= 100 && Number.isFinite(model.completedRadius)
      ? model.completedRadius
      : model.radius0 + (model.radius100 - model.radius0) * progress;
    let stepMismatch = 0;
    for (const node of dataset.nodes) {
      const actualOutside = observation.shrinking.has(String(node.id));
      const signed = Math.hypot(node.x - cx, node.y - cy) - radius;
      const expectedSign = actualOutside ? 1 : -1;
      const margin = expectedSign * signed;
      const scaled = Math.max(-50, Math.min(50, -margin / 8));
      loss += Math.log1p(Math.exp(scaled));
      const predictedOutside = signed > 0;
      if (predictedOutside !== actualOutside) {
        mismatches += 1;
        stepMismatch += 1;
      }
      comparisons += 1;
    }
    byStep.push({ step: observation.step, mismatches: stepMismatch, total: dataset.nodes.length });
  }
  return { mismatches, comparisons, accuracy: 1 - mismatches / comparisons, loss, byStep };
}

function fitModel(datasets, seed) {
  const totalScore = (model) => datasets.reduce((sum, dataset) => sum + classify(dataset, model).loss, 0);
  let best = { ...seed };
  let bestScore = totalScore(best);
  const dimensions = ['offsetX', 'offsetY', 'radius0', 'radius100'];
  for (const amount of [160, 80, 40, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const key of dimensions) {
        for (const direction of [-1, 1]) {
          const candidate = { ...best, [key]: best[key] + amount * direction };
          const score = totalScore(candidate);
          if (score + 1e-9 < bestScore) {
            best = candidate;
            bestScore = score;
            improved = true;
          }
        }
      }
    }
  }
  return { model: best, loss: bestScore };
}

function fitReport(results) {
  const datasets = results.map(buildObservations).filter(Boolean);
  const existing = {
    offsetX: -36.1,
    offsetY: -81.5,
    radius0: 1655.9043615035487,
    radius100: 666.1150223412039,
  };
  const fitted = fitModel(datasets, existing);
  const candidates = {
    implemented111: { offsetX: -50, offsetY: -100, radius0: 1600, radius100: 675, completedRadius: 650 },
    canonical650: { offsetX: -50, offsetY: -100, radius0: 1600, radius100: 650 },
    canonical1650: { offsetX: -50, offsetY: -100, radius0: 1650, radius100: 650 },
    canonical1700: { offsetX: -50, offsetY: -100, radius0: 1700, radius100: 650 },
    canonical675: { offsetX: -50, offsetY: -100, radius0: 1600, radius100: 675 },
    observed675: { offsetX: -50, offsetY: -100, radius0: 1575, radius100: 675 },
  };
  return {
    datasets: datasets.map((dataset) => ({
      file: dataset.file,
      mapId: dataset.mapId,
      key: `${dataset.mapId}:${dataset.basePatternId}:${dataset.patternId}`,
      nodeCount: dataset.nodes.length,
      startCenter: dataset.startCenter,
      serverCenter: dataset.serverCenter,
      steps: dataset.observations.map((item) => item.step),
      existing: classify(dataset, existing),
      candidates: Object.fromEntries(Object.entries(candidates).map(([key, model]) => [key, classify(dataset, model)])),
      jointlyFitted: classify(dataset, fitted.model),
      individuallyFitted: (() => {
        const fit = fitModel([dataset], existing);
        return { model: fit.model, classification: classify(dataset, fit.model) };
      })(),
    })),
    existing,
    jointlyFitted: {
      model: fitted.model,
      datasets: datasets.map((dataset) => ({
        key: `${dataset.mapId}:${dataset.basePatternId}:${dataset.patternId}`,
        classification: classify(dataset, fitted.model),
      })),
    },
  };
}

function fitSeparatingCircle(dataset, observation, seedModel) {
  const progress = observation.step / 100;
  const seed = {
    x: dataset.startCenter.x
      + (dataset.serverCenter.x + seedModel.offsetX - dataset.startCenter.x) * progress,
    y: dataset.startCenter.y
      + (dataset.serverCenter.y + seedModel.offsetY - dataset.startCenter.y) * progress,
  };
  const measure = (center) => {
    let safeMax = -Infinity;
    let outsideMin = Infinity;
    for (const node of dataset.nodes) {
      const distance = Math.hypot(node.x - center.x, node.y - center.y);
      if (observation.shrinking.has(String(node.id))) outsideMin = Math.min(outsideMin, distance);
      else safeMax = Math.max(safeMax, distance);
    }
    return { safeMax, outsideMin, gap: outsideMin - safeMax };
  };
  let center = seed;
  let bounds = measure(center);
  for (const amount of [320, 160, 80, 40, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1]) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const [dx, dy] of [[-amount, 0], [amount, 0], [0, -amount], [0, amount],
        [-amount, -amount], [-amount, amount], [amount, -amount], [amount, amount]]) {
        const candidate = { x: center.x + dx, y: center.y + dy };
        const next = measure(candidate);
        if (next.gap > bounds.gap + 1e-9) {
          center = candidate;
          bounds = next;
          improved = true;
        }
      }
    }
  }
  return { step: observation.step, center, ...bounds, radius: (bounds.safeMax + bounds.outsideMin) / 2 };
}

function circleReport(results) {
  const seed = { offsetX: -51.2, offsetY: -95.2, radius0: 1578.9, radius100: 674.0 };
  return results.map(buildObservations).filter(Boolean).map((dataset) => ({
    key: `${dataset.mapId}:${dataset.basePatternId}:${dataset.patternId}`,
    startCenter: dataset.startCenter,
    serverCenter: dataset.serverCenter,
    circles: dataset.observations.map((observation) => fitSeparatingCircle(dataset, observation, seed)),
  }));
}

(async () => {
  const compactOutput = process.argv.includes('--compact');
  const fitOutput = process.argv.includes('--fit');
  const circlesOutput = process.argv.includes('--circles');
  const results = [];
  for (const file of files) {
    if (file.startsWith('--')) continue;
    const result = await analyze(file);
    results.push(result);
    if (!fitOutput && !circlesOutput) console.log(JSON.stringify(compactOutput ? compact(result) : result, null, 2));
  }
  if (fitOutput) console.log(JSON.stringify(fitReport(results), null, 2));
  if (circlesOutput) console.log(JSON.stringify(circleReport(results), null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
