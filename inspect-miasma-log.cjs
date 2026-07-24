const fs = require('fs');
const readline = require('readline');

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node inspect-miasma-log.cjs <trace.jsonl|trace.json> [...]');
  process.exit(1);
}

async function *recordsFrom(file) {
  if (/\.json$/i.test(file)) {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const record of (Array.isArray(value) ? value : value.entries || [])) yield record;
    return;
  }
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim()) yield JSON.parse(line);
  }
}

function walk(value, visitor, path = '$', seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  visitor(value, path);
  if (Array.isArray(value)) {
    value.forEach((child, index) => walk(child, visitor, `${path}[${index}]`, seen));
  } else {
    Object.entries(value).forEach(([key, child]) => walk(child, visitor, `${path}.${key}`, seen));
  }
}

function scalarEntries(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) =>
    value === null || ['string', 'number', 'boolean'].includes(typeof value)
  ));
}

async function inspect(file) {
  const relevantFields = new Map();
  const miasmaObjects = new Map();
  const value63 = new Map();
  const node63 = new Map();
  let recordNumber = 0;

  for await (const record of recordsFrom(file)) {
    recordNumber += 1;
    walk(record, (object, path) => {
      const keys = Object.keys(object);
      if (/miasma/i.test(path) || keys.some((key) => /miasma/i.test(key))) {
        const summary = { keys, scalars: scalarEntries(object) };
        miasmaObjects.set(`${path}|${JSON.stringify(summary)}`, { record: recordNumber, path, ...summary });
      }
      for (const [key, value] of Object.entries(object)) {
        if (/(miasma|shrink|circle|radius|center|safe.?area|limit.?area|range)/i.test(key)) {
          const fieldPath = `${path}.${key}`;
          const rendered = value && typeof value === 'object'
            ? Array.isArray(value) ? `[array:${value.length}]` : `{${Object.keys(value).join(',')}}`
            : value;
          if (!relevantFields.has(fieldPath)) relevantFields.set(fieldPath, new Set());
          const values = relevantFields.get(fieldPath);
          if (values.size < 12) values.add(JSON.stringify(rendered));
        }
        if ((value === 63 || value === '63') && !path.includes('.node_list[')) {
          value63.set(`${path}.${key}`, { record: recordNumber, path: `${path}.${key}`, object: scalarEntries(object) });
        }
      }
      const id = object.node_id ?? object.nodeId ?? object.id;
      if ((id === 63 || id === '63') && /(node_list|nodes)/i.test(path)) {
        node63.set(path, { record: recordNumber, path, object: scalarEntries(object) });
      }
    });
  }

  return {
    file,
    recordCount: recordNumber,
    node63: [...node63.values()],
    nonNodeValue63: [...value63.values()],
    relevantFields: Object.fromEntries([...relevantFields].map(([path, values]) => [
      path, [...values].map((value) => JSON.parse(value)),
    ])),
    miasmaObjects: [...miasmaObjects.values()],
  };
}

(async () => {
  for (const file of files) console.log(JSON.stringify(await inspect(file), null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
