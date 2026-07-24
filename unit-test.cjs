const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const noop = () => {};
const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  chrome: {
    storage: {
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
      local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    runtime: { sendMessage: () => Promise.resolve(), onMessage: { addListener: noop } },
    action: { onClicked: { addListener: noop } },
    tabs: { onRemoved: { addListener: noop } },
    sidePanel: { open: async () => {} },
  },
});
context.importScripts = (...files) => {
  for (const file of files)
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
};
vm.runInContext(fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8'), context, { filename: 'service-worker.js' });

const state = context.createEmptyState();
const ajax = (endpoint, responseData) => context.handleAjax(state, {
  url: `/rest/raid/${endpoint}.json`,
  responseData,
});
const expect = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(label, { actual, expected });
    process.exit(1);
  }
};

ajax('start', {
  raid_id: 123,
  twitter: { battle_id: 'ABCD1234' },
  turn: 1,
  limit_number: 6,
  player: { param: [{ pid: '100_0', name: 'Alice' }, { pid: '200_0', name: 'Bob' }] },
  multi_raid_member_info: [],
});

ajax('ability_result', {
  status: { turn: 1 },
  scenario: [
    { cmd: 'ability', num: 0, to: 'player' },
    { cmd: 'damage', to: 'boss', list: [{ value: 100 }, { value: 200 }] },
  ],
});
expect('first ability', state.lastTurn, { hit: 2, debuff: 0, ability: 300, special: 0, total: 300 });
expect('Alice ability', state.characterStats[0], {
  index: 0, pid: '100', name: 'Alice', hit: 2, debuff: 0, ability: 300, special: 0,
});

ajax('ability_result', {
  status: { turn: 1 },
  scenario: [
    { cmd: 'ability', num: 1, to: 'player' },
    { cmd: 'loop_damage', to: 'boss', list: [[{ value: 10 }, { value: 20 }], [{ value: 30 }]] },
  ],
});
expect('second ability accumulates', state.lastTurn, { hit: 5, debuff: 0, ability: 360, special: 0, total: 360 });

ajax('ability_result', {
  status: { turn: 1 },
  scenario: [
    { cmd: 'special', num: 1, total: [{ split: ['1'] }, { split: ['1'] }], list: [{ damage: [{ value: 500 }, { value: 600 }] }] },
  ],
});
expect('special accumulates', state.lastTurn, { hit: 7, debuff: 0, ability: 360, special: 1100, total: 1460 });
expect('Bob accumulated', state.characterStats[1], {
  index: 1, pid: '200', name: 'Bob', hit: 5, debuff: 0, ability: 60, special: 1100,
});

ajax('normal_attack_result', {
  status: { turn: 2 },
  scenario: [
    { cmd: 'attack', from: 'player', num: 0, damage: { 0: [{ value: 50 }, { value: 50 }] } },
    { cmd: 'turn', mode: 'boss' },
  ],
});
expect('normal attack remains turn 1', { turn: state.statsTurn, stats: state.lastTurn }, {
  turn: 1,
  stats: { hit: 9, debuff: 0, ability: 360, special: 1100, total: 1560 },
});

ajax('ability_result', {
  status: { turn: 2 },
  scenario: [
    { cmd: 'ability', num: 1, to: 'player' },
    { cmd: 'damage', to: 'boss', list: [{ value: 70 }] },
  ],
});
expect('first action resets turn 2', { turn: state.statsTurn, stats: state.lastTurn }, {
  turn: 2,
  stats: { hit: 1, debuff: 0, ability: 70, special: 0, total: 70 },
});
expect('character reset', state.characterStats.map(({ hit, ability, special }) => ({ hit, ability, special })), [
  { hit: 0, ability: 0, special: 0 },
  { hit: 1, ability: 70, special: 0 },
]);

ajax('ability_result', {
  status: { turn: 2 },
  scenario: [{ cmd: 'damage', to: 'boss', list: [{ value: 5 }] }],
});
expect('unknown owner is not assigned to Alice', state.characterStats[0], {
  index: 0, pid: '100', name: 'Alice', hit: 0, debuff: 0, ability: 0, special: 0,
});

console.log(JSON.stringify({
  passed: true,
  turn: state.statsTurn,
  turnStats: state.lastTurn,
  characters: state.characterStats,
  totalDamage: state.totalDamage,
}, null, 2));
