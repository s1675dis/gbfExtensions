const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const noop = () => {};
const localStorageData = {};
const sidepanelHtml = fs.readFileSync(path.join(root, 'sidepanel.html'), 'utf8');
const sidepanelCss = fs.readFileSync(path.join(root, 'sidepanel.css'), 'utf8');
const pageHookSource = fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8');
const contentSource = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const routePlanner = require('./route-planner.js');
const context = vm.createContext({
  console,
  setTimeout,
  clearTimeout,
  chrome: {
    storage: {
      local: {
        get: async key => Array.isArray(key)
          ? Object.fromEntries(key.map(item => [item, localStorageData[item]]))
          : ({ [key]: localStorageData[key] }),
        set: async values => Object.assign(localStorageData, values),
        remove: async key => delete localStorageData[key],
      },
      session: { get: async () => ({}), set: async () => {}, remove: async () => {} },
    },
    runtime: {
      getManifest: () => manifest,
      sendMessage: () => Promise.resolve(),
      onMessage: { addListener: noop },
    },
    action: { onClicked: { addListener: noop } },
    tabs: { onRemoved: { addListener: noop } },
    sidePanel: { open: async () => {} },
  },
});
context.importScripts = (...files) => {
  for (const file of files)
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
};
vm.runInContext(fs.readFileSync(path.join(root, 'service-worker-v2.js'), 'utf8'), context, { filename: 'service-worker-v2.js' });

const expect = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(label, { actual, expected });
    process.exit(1);
  }
};
expect('online update uses numeric extension-version comparison', [
  context.compareExtensionVersions('1.13.126', '1.13.125'),
  context.compareExtensionVersions('1.13.126', '1.13.126'),
  context.compareExtensionVersions('1.13.9', '1.13.10'),
], [1, 0, -1]);
expect('online update channel accepts only the supported schema', {
  version: context.validateOnlineUpdateChannel({
    schema: 'gbf-extension-update-v1',
    version: '1.13.126',
    data: { guidebookRevision: 3, firstShrinkModelRevision: 4 },
  }).version,
  revisions: [
    context.validateOnlineUpdateChannel({
      schema: 'gbf-extension-update-v1',
      version: '1.13.126',
      data: { guidebookRevision: 3, firstShrinkModelRevision: 4 },
    }).guidebookRevision,
    context.validateOnlineUpdateChannel({
      schema: 'gbf-extension-update-v1',
      version: '1.13.126',
      data: { guidebookRevision: 3, firstShrinkModelRevision: 4 },
    }).firstShrinkModelRevision,
  ],
}, { version: '1.13.126', revisions: [3, 4] });
const state = context.createEmptyState();
const ajax = (endpoint, responseData) => context.handleAjax(state, {
  url: `/rest/raid/${endpoint}.json`,
  responseData,
});
const start = raidId => ajax('start', {
  raid_id: raidId,
  twitter: { battle_id: `ID${raidId}` },
  turn: 1,
  limit_number: 6,
  boss: { param: [{ condition: { debuff: [{ status: 'existing' }] } }] },
  player: { param: [{ pid: '100_0', name: 'Alice' }, { pid: '200_0', name: 'Bob' }] },
  multi_raid_member_info: [],
});

start(123);
ajax('ability_result', {
  status: { turn: 1 },
  scenario: [
    { cmd: 'ability', num: 0, to: 'player' },
    { cmd: 'damage', to: 'boss', list: [{ value: 100 }, { value: 200 }] },
  ],
});
expect('current turn updates immediately', state.currentTurn, { hit: 2, debuff: 0, ability: 300, special: 0, total: 300 });
expect('battle total after first action', state.totalDamage, 300);

// 同じraid_idのstart再受信では戦闘累計・ターン集計をリセットしない。
start(123);
expect('same battle keeps total', state.totalDamage, 300);
expect('same battle keeps current turn', state.currentTurn, { hit: 2, debuff: 0, ability: 300, special: 0, total: 300 });

const restoredState = context.createEmptyState();
Object.assign(restoredState, JSON.parse(JSON.stringify(state)));
context.handleAjax(restoredState, {
  url: '/rest/raid/start.json',
  responseData: {
    raid_id: 123,
    twitter: { battle_id: 'ID123' },
    turn: 1,
    limit_number: 6,
    boss: { param: [{ condition: { debuff: [{ status: 'existing' }] } }] },
    player: { param: [{ pid: '100_0', name: 'Alice' }, { pid: '200_0', name: 'Bob' }] },
    multi_raid_member_info: [],
  },
});
expect('reload start keeps restored state', {
  total: restoredState.totalDamage,
  current: restoredState.currentTurn,
  characters: restoredState.characterStats.map(item => ({ name: item.name, hit: item.hit, ability: item.ability })),
}, {
  total: 300,
  current: { hit: 2, debuff: 0, ability: 300, special: 0, total: 300 },
  characters: [
    { name: 'Alice', hit: 2, ability: 300 },
    { name: 'Bob', hit: 0, ability: 0 },
  ],
});

ajax('ability_result', {
  status: { turn: 1 },
  scenario: [
    { cmd: 'ability', num: 1, to: 'player' },
    { cmd: 'loop_damage', to: 'boss', list: [[{ value: 10 }, { value: 20 }, { value: 30 }]] },
    {
      cmd: 'condition',
      to: 'boss',
      pos: 0,
      condition: {
        debuff: [
          { status: 'existing' },
          { status: 'new-a', personal_debuff_end_turn: 3 },
          { status: 'new-b', personal_debuff_user_id: 'self' },
        ],
      },
    },
  ],
});
expect('debuff counting is omitted', state.currentTurn, { hit: 5, debuff: 0, ability: 360, special: 0, total: 360 });

ajax('ability_result', {
  status: { turn: 1 },
  scenario: [{
    cmd: 'condition',
    to: 'boss',
    pos: 0,
    condition: {
      debuff: [
        { status: 'existing' },
        { status: 'new-a', personal_debuff_end_turn: 3 },
        { status: 'new-b', personal_debuff_user_id: 'self' },
      ],
    },
  }],
});
expect('debuff snapshots remain omitted', state.currentTurn, { hit: 5, debuff: 0, ability: 360, special: 0, total: 360 });

ajax('ability_result', {
  status: { turn: 1 },
  scenario: [
    { cmd: 'ability', num: 0, to: 'player' },
    {
      cmd: 'condition',
      to: 'boss',
      pos: 0,
      condition: {
        debuff: [
          { status: 'existing' },
          { status: 'new-a', personal_debuff_end_turn: 5 },
          { status: 'new-b', personal_debuff_user_id: 'self' },
          { status: 'treasure-4', name: 'トレハンLv4' },
        ],
      },
    },
  ],
});
expect('debuff renewal and treasure are both omitted', state.currentTurn, { hit: 5, debuff: 0, ability: 360, special: 0, total: 360 });

context.handleWebSocket(state, {
  bossUpdate: {
    param: {
      boss1_condition: {
        debuff: [
          { status: 'existing' },
          { status: 'new-a', personal_debuff_end_turn: 5 },
          { status: 'new-b', personal_debuff_user_id: 'self' },
          { status: 'participant-effect' },
        ],
      },
    },
  },
});
ajax('ability_result', {
  status: { turn: 1 },
  scenario: [
    { cmd: 'ability', num: 0, to: 'player' },
    {
      cmd: 'condition',
      to: 'boss',
      pos: 0,
      condition: {
        debuff: [
          { status: 'existing' },
          { status: 'new-a', personal_debuff_end_turn: 5 },
          { status: 'new-b', personal_debuff_user_id: 'self' },
          { status: 'participant-effect' },
        ],
      },
    },
  ],
});
expect('participant websocket debuff is omitted', state.currentTurn, { hit: 5, debuff: 0, ability: 360, special: 0, total: 360 });
expect('character debuffs remain zero while omitted', state.characterStats.map(character => ({
  name: character.name,
  debuff: character.debuff,
})), [
  { name: 'Alice', debuff: 0 },
  { name: 'Bob', debuff: 0 },
]);

ajax('normal_attack_result', {
  status: { turn: 2 },
  scenario: [
    { cmd: 'attack', from: 'player', num: 0, damage: { 0: [{ value: 40 }, { value: 60 }] } },
    { cmd: 'turn', mode: 'boss' },
  ],
});
expect('turn advances', state.statsTurn, 2);
expect('final value moves to previous', state.previousTurn, { hit: 7, debuff: 0, ability: 360, special: 0, total: 460 });
expect('character final values move to previous', state.previousCharacterStats.map(character => ({
  name: character.name,
  hit: character.hit,
  ability: character.ability,
  special: character.special,
})), [
  { name: 'Alice', hit: 4, ability: 300, special: 0 },
  { name: 'Bob', hit: 3, ability: 60, special: 0 },
]);
expect('new current turn resets', state.currentTurn, { hit: 0, debuff: 0, ability: 0, special: 0, total: 0 });
expect('character current values reset independently', state.characterStats.map(character => ({
  name: character.name,
  hit: character.hit,
  ability: character.ability,
  special: character.special,
})), [
  { name: 'Alice', hit: 0, ability: 0, special: 0 },
  { name: 'Bob', hit: 0, ability: 0, special: 0 },
]);
expect('battle total survives turn advance', state.totalDamage, 460);

ajax('ability_result', {
  status: { turn: 2 },
  scenario: [
    { cmd: 'ability', num: 1, to: 'player' },
    { cmd: 'damage', to: 'boss', list: [{ value: 70 }] },
  ],
});
expect('next turn updates current only', {
  current: state.currentTurn,
  previous: state.previousTurn,
  total: state.totalDamage,
}, {
  current: { hit: 1, debuff: 0, ability: 70, special: 0, total: 70 },
  previous: { hit: 7, debuff: 0, ability: 360, special: 0, total: 460 },
  total: 530,
});

start(999);
expect('new battle resets totals', {
  total: state.totalDamage,
  current: state.currentTurn,
  previous: state.previousTurn,
}, {
  total: 0,
  current: { hit: 0, debuff: 0, ability: 0, special: 0, total: 0 },
  previous: { hit: 0, debuff: 0, ability: 0, special: 0, total: 0 },
});

const guidebookPayload = {
  url: '/rest/arcarum3/dungeon/proceed_node_event?_=1',
  responseData: {
    action_scenario_list: [{
      scenario_type: 3,
      action_type: 401,
      candidate_num: 3,
      select_num_min: 1,
      select_num_max: 1,
      status_list: [
        {
          status_id: 19, icon_category: 1, icon_type: 8, rarity: 2,
          is_duplication_possible: 1, deck_condition: 0,
          target_type: null, target_param: '', display_ailment_id: null,
          name: '自属性冴手効果(20%)',
        },
        {
          status_id: 61, icon_category: 3, icon_type: 401, rarity: 2,
          is_duplication_possible: 1, deck_condition: 0,
          name: '弱体アビリティ使用時@@弱体効果を2つ付与',
        },
        {
          status_id: 64, icon_category: 3, icon_type: 401, rarity: 2,
          is_duplication_possible: 1, deck_condition: 0,
          name: '奥義発動時@@通常攻撃とアビリティの与ダメージUP',
        },
      ],
    }],
  },
};
const guidebookCandidates = context.guidebookCandidatesFromPayload(guidebookPayload);
expect('all displayed guidebook candidates are parsed without acquiring one', {
  ids: guidebookCandidates.map(effect => effect.id),
  names: guidebookCandidates.map(effect => effect.name),
  rarity: guidebookCandidates.map(effect => effect.rarity),
  duplication: guidebookCandidates.map(effect => effect.isDuplicationPossible),
  selection: guidebookCandidates.map(effect => [effect.candidateCount, effect.selectMin, effect.selectMax]),
}, {
  ids: [19, 61, 64],
  names: [
    '自属性冴手効果(20%)',
    '弱体アビリティ使用時@@弱体効果を2つ付与',
    '奥義発動時@@通常攻撃とアビリティの与ダメージUP',
  ],
  rarity: [2, 2, 2],
  duplication: [true, true, true],
  selection: [[3, 1, 1], [3, 1, 1], [3, 1, 1]],
});
const dynamicGuidebookCandidates = context.guidebookCandidatesFromPayload({
  url: '/rest/arcarum3/dungeon/proceed_node_event?_=dynamic',
  responseData: {
    action_scenario_list: [{
      action_type: 401,
      status_list: [{
        status_id: 45,
        name: '所持している呪われた導本効果の数に応じて味方全体の通常攻撃のヒット数増加(＋4/最大＋10)',
        rarity: 3,
        icon_category: 3,
        icon_type: 401,
        is_duplication_possible: 0,
      }, {
        status_id: 145,
        name: '条件達成回数に応じて効果上昇(2/3回)',
        rarity: 2,
        icon_category: 3,
        icon_type: 401,
        is_duplication_possible: 0,
      }, {
        status_id: 146,
        name: '進捗に応じて効果上昇(30%/最大100%)',
        rarity: 2,
        icon_category: 3,
        icon_type: 401,
        is_duplication_possible: 0,
      }],
    }],
  },
});
expect('dynamic guidebook counters use a stable zero-state name and variable schema',
  dynamicGuidebookCandidates.map(effect => ({
    id: effect.id,
    name: effect.name,
    template: effect.effectTemplate,
    variables: effect.effectVariables,
    observed: effect.lastObservedVariableValues,
  })), [{
    id: 45,
    name: '所持している呪われた導本効果の数に応じて味方全体の通常攻撃のヒット数増加(＋0/最大＋10)',
    template: '所持している呪われた導本効果の数に応じて味方全体の通常攻撃のヒット数増加(＋{{value1}}/最大＋10)',
    variables: [{
      key: 'value1', initialValue: 0, maximumValue: 10, unit: '',
      format: 'current-of-maximum',
    }],
    observed: { value1: 4 },
  }, {
    id: 145,
    name: '条件達成回数に応じて効果上昇(0/3回)',
    template: '条件達成回数に応じて効果上昇({{value1}}/3回)',
    variables: [{
      key: 'value1', initialValue: 0, maximumValue: 3, unit: '回',
      format: 'progress-count',
    }],
    observed: { value1: 2 },
  }, {
    id: 146,
    name: '進捗に応じて効果上昇(0%/最大100%)',
    template: '進捗に応じて効果上昇({{value1}}%/最大100%)',
    variables: [{
      key: 'value1', initialValue: 0, maximumValue: 100, unit: '%',
      format: 'current-of-maximum',
    }],
    observed: { value1: 30 },
  }]);
expect('remaining-use guidebook counters use the full remaining count as their stable initial state',
  context.describeGuidebookDynamicEffectName(
    '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り1/2回)',
  ), {
    name: '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り2/2回)',
    effectTemplate: '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り{{value1}}/2回)',
    effectVariables: [{
      key: 'value1', initialValue: 2, maximumValue: 2, unit: '回',
      format: 'remaining-count',
    }],
    lastObservedVariableValues: { value1: 1 },
    observedName: '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り1/2回)',
  });
const cursedImmediateRewardPayload = {
  url: '/rest/arcarum3/dungeon/proceed_node_event_unlock_weapon?_=1',
  responseData: {
    action_scenario_list: [{
      scenario_type: 3,
      action_type: 400,
      candidate_num: 0,
      select_num_min: 0,
      select_num_max: 0,
      spacebook_reward_id: 5,
      status_list: [{
        status_id: 118,
        icon_category: 4,
        icon_type: 503,
        rarity: 99,
        is_duplication_possible: 1,
        deck_condition: 0,
        target_type: null,
        target_param: '',
        display_ailment_id: null,
        name: '毎ターンダメージを受ける',
      }],
    }],
  },
};
expect('action type 400 is parsed as an immediate cursed event reward, not a choice', 
  context.guidebookCandidatesFromPayload(cursedImmediateRewardPayload).map(effect => ({
    id: effect.id,
    name: effect.name,
    sourceTypes: effect.sourceTypes,
    rarity: effect.rarity,
    iconCategory: effect.iconCategory,
    iconType: effect.iconType,
    duplication: effect.isDuplicationPossible,
    spacebookRewardId: effect.spacebookRewardId,
    isCursed: effect.isCursed,
  })), [{
    id: 118,
    name: '毎ターンダメージを受ける',
    sourceTypes: ['event_reward'],
    rarity: 99,
    iconCategory: 4,
    iconType: 503,
    duplication: true,
    spacebookRewardId: 5,
    isCursed: true,
  }]);
expect('nested floating-castle guidebook results are found without Ajax trace mode',
  context.guidebookCandidatesFromPayload({
    kind: 'ajax',
    url: '/rest/arcarum3/dungeon/floating_castle_select_result?_=1',
    responseData: {
      result: {
        reward: {
          statusList: [{
            statusId: 812,
            name: '浮遊城で表示された導本効果',
            rarity: 3,
            iconCategory: 3,
            iconType: 401,
            isDuplicationPossible: 0,
            deckCondition: 0,
          }],
          candidateNum: 1,
          selectNumMin: 1,
          selectNumMax: 1,
        },
        unrelatedBattleStatus: {
          status_list: [{
            status_id: 9999,
            name: '通常の戦闘バフ',
            icon_type: 10,
          }],
        },
      },
    },
  }).map(effect => ({
    id: effect.id,
    name: effect.name,
    rarity: effect.rarity,
    iconCategory: effect.iconCategory,
    duplication: effect.isDuplicationPossible,
    selection: [effect.candidateCount, effect.selectMin, effect.selectMax],
  })), [{
    id: 812,
    name: '浮遊城で表示された導本効果',
    rarity: 3,
    iconCategory: 3,
    duplication: false,
    selection: [1, 1, 1],
  }]);
expect('manual Game.view capture reuses the event-candidate parser',
  context.guidebookCandidatesFromPayload({
    kind: 'guidebook_manual_capture',
    eventCandidates: [{
      status_id: 91,
      name: '手動取得した導本効果',
      rarity: 1,
      candidate_num: 2,
      select_num_min: 1,
      select_num_max: 1,
    }],
  }).map(effect => ({
    id: effect.id,
    name: effect.name,
    rarity: effect.rarity,
    selection: [effect.candidateCount, effect.selectMin, effect.selectMax],
  })), [{
    id: 91,
    name: '手動取得した導本効果',
    rarity: 1,
    selection: [2, 1, 1],
  }]);
expect('manual Game.view capture parses shop and effect-confirmation guidebook entries',
  context.guidebookViewEffectsFromPayload({
    kind: 'guidebook_manual_capture',
    viewEffects: [{
      status_id: 111,
      name: 'ショップに表示された導本効果',
      rarity: 3,
      is_duplication_possible: 0,
      source_type: 'shop_page',
      shop_price: 38,
      shop_sold_out: false,
      shop_book_grade: 1,
      shop_base_price: 50,
      shop_discounted: true,
      shop_premium: false,
      capture_context: 'Game.view.data.dungeonShop.status_list.0',
    }, {
      status_id: null,
      name: 'バトル開始時、敵に被ダメージ無効(30回)(重複不可)',
      source_type: 'effect_confirmation',
      bookEffetIcon: 'https://example.invalid/book_effect_501.png',
      icon_type: 501,
      count: null,
      book_category: 'cursed',
      is_cursed: true,
      capture_context: 'DOM:#arcarum3/book:cursed img[book_effect_*]',
    }],
  }).map(effect => ({
    id: effect.id,
    key: effect.key,
    name: effect.name,
    rarity: effect.rarity,
    duplication: effect.isDuplicationPossible,
    sourceTypes: effect.sourceTypes,
    count: effect.count,
    shopPrice: effect.shopPrice,
    shopSoldOut: effect.shopSoldOut,
    shopBookGrade: effect.shopBookGrade,
    shopBasePrice: effect.shopBasePrice,
    shopDiscounted: effect.shopDiscounted,
    shopPremium: effect.shopPremium,
    iconType: effect.iconType,
    isCursed: effect.isCursed,
    bookCategory: effect.bookCategory,
    captureContexts: effect.captureContexts,
  })), [{
    id: 111,
    key: 'id:111',
    name: 'ショップに表示された導本効果',
    rarity: 3,
    duplication: false,
    sourceTypes: ['shop_page'],
    count: null,
    shopPrice: 38,
    shopSoldOut: false,
    shopBookGrade: 1,
    shopBasePrice: 50,
    shopDiscounted: true,
    shopPremium: false,
    iconType: null,
    isCursed: false,
    bookCategory: null,
    captureContexts: ['Game.view.data.dungeonShop.status_list.0'],
  }, {
    id: null,
    key: 'name:バトル開始時、敵に被ダメージ無効(30回)(重複不可)',
    name: 'バトル開始時、敵に被ダメージ無効(30回)(重複不可)',
    rarity: null,
    duplication: null,
    sourceTypes: ['effect_confirmation'],
    count: null,
    shopPrice: null,
    shopSoldOut: null,
    shopBookGrade: null,
    shopBasePrice: null,
    shopDiscounted: null,
    shopPremium: null,
    iconType: 501,
    isCursed: true,
    bookCategory: 'cursed',
    captureContexts: ['DOM:#arcarum3/book:cursed img[book_effect_*]'],
  }]);
const guidebookRewardPayload = {
  kind: 'guidebook_rewards',
  rewards: [{
    rewardType: 4,
    image: 'https://example.invalid/sephirabook_01.jpg',
    name: null,
    comment: '自属性攻撃UP(20%)',
    bookEffetIcon: 'https://example.invalid/book_effect_1.png',
    count: null,
    canShowDetail: true,
  }],
};
expect('battle result guidebook rewards use comment as effect text without inventing an ID',
  context.guidebookRewardsFromPayload(guidebookRewardPayload).map(effect => ({
    id: effect.id,
    key: effect.key,
    name: effect.name,
    sourceTypes: effect.sourceTypes,
  })), [{
    id: null,
    key: 'name:自属性攻撃UP(20%)',
    name: '自属性攻撃UP(20%)',
    sourceTypes: ['battle_reward'],
  }]);
expect('battle-result navigation instructions are not stored as guidebook effects',
  context.guidebookRewardsFromPayload({
    kind: 'guidebook_rewards',
    rewards: [{
      rewardType: 4,
      image: 'https://example.invalid/sephirabook_02_random.jpg',
      comment: '探索画面に戻ることで<br>強力な導本効果を獲得できます。',
      canShowDetail: true,
    }],
  }), []);
expect('low-rarity result effects fall back from an empty comment to alternate fields',
  context.guidebookRewardsFromPayload({
    kind: 'guidebook_rewards',
    rewards: [{
      rewardType: 4,
      comment: '',
      name: '渾身',
      bookEffetIcon: 'https://example.invalid/book_effect_3.png',
    }, {
      rewardType: null,
      comment: null,
      description: '背水',
      bookEffectIcon: 'https://example.invalid/book_effect_4.png',
    }, {
      rewardType: 1,
      comment: '',
      effectName: 'クリティカル確率UP(30%)',
      image: 'https://example.invalid/sephirabook_01.jpg',
    }, {
      rewardType: 1,
      name: '通常アイテム',
      image: 'https://example.invalid/item.jpg',
    }],
  }).map(effect => ({
    name: effect.name,
    key: effect.key,
    sourceTypes: effect.sourceTypes,
  })), [{
    name: '渾身',
    key: 'name:渾身',
    sourceTypes: ['battle_reward'],
  }, {
    name: '背水',
    key: 'name:背水',
    sourceTypes: ['battle_reward'],
  }, {
    name: 'クリティカル確率UP(30%)',
    key: 'name:クリティカル確率UP(30%)',
    sourceTypes: ['battle_reward'],
  }]);
expect('raw sephirabook result detail arrays retain the effect ID and readable name',
  context.guidebookRewardsFromPayload({
    kind: 'guidebook_rewards',
    rewards: [{
      reward_type: 4,
      image: 'sephirabook_02',
      detail: [{
        status_id: 33,
        icon_type: 10,
        name: '通常攻撃のヒット数増加(＋1)',
      }],
    }],
  }).map(effect => ({
    id: effect.id,
    key: effect.key,
    name: effect.name,
    iconType: effect.iconType,
    sourceTypes: effect.sourceTypes,
  })), [{
    id: 33,
    key: 'id:33',
    name: '通常攻撃のヒット数増加(＋1)',
    iconType: 10,
    sourceTypes: ['battle_reward'],
  }]);
expect('invalid object stringification is rejected from battle rewards',
  context.guidebookRewardsFromPayload({
    kind: 'guidebook_rewards',
    rewards: [{
      rewardType: 4,
      image: 'sephirabook_02',
      name: '[object Object]',
    }],
  }), []);
expect('battle result guidebook watcher has no 700ms-only capture window', {
  persistentPolling: pageHookSource.includes(
    'setInterval(safelyEmitArcarum3GuidebookRewards, 250)',
  ),
  pageRestoreCheck: pageHookSource.includes(
    "window.addEventListener('pageshow', safelyEmitArcarum3GuidebookRewards)",
  ),
  visibleTabCheck: pageHookSource.includes("document.addEventListener('visibilitychange'"),
  guardedRead: pageHookSource.includes('function safelyEmitArcarum3GuidebookRewards()'),
  alternateTextFields: pageHookSource.includes('function guidebookRewardText(reward)')
    && pageHookSource.includes('reward?.effectName')
    && pageHookSource.includes('reward?.description'),
  assetFallback: pageHookSource.includes('function isGuidebookRewardEntry(reward)')
    && pageHookSource.includes('sephirabook|book_effect'),
  directViewList: pageHookSource.includes('view?.arcarum3RewardList'),
  rawResultList: pageHookSource.includes(
    'view?.content_model?.attributes?.option?.result_data?.arcarum3?.reward_list',
  ),
  rawDetailSupport: pageHookSource.includes('function guidebookRewardDetailEntries(reward)')
    && pageHookSource.includes('reward?.rewardType ?? reward?.reward_type'),
  displayRawDeduplication: pageHookSource.includes(
    'function dedupeSerializedGuidebookRewards(rewards)',
  ),
}, {
  persistentPolling: true,
  pageRestoreCheck: true,
  visibleTabCheck: true,
  guardedRead: true,
  alternateTextFields: true,
  assetFallback: true,
  directViewList: true,
  rawResultList: true,
  rawDetailSupport: true,
  displayRawDeduplication: true,
});
expect('returning from battle polls the field route state and emits a dedicated resync', {
  fieldPoll: pageHookSource.includes('setInterval(safelyEmitRouteFieldResync, 250)'),
  fieldRouteGuard: pageHookSource.includes('/#arcarum3\\/dungeon(?:\\/|$)/'),
  routeStateCapture: pageHookSource.includes("kind: 'route_field_resync'")
    && pageHookSource.includes('const routeState = captureRoutePlanningState()'),
  nodeTypeRefresh: pageHookSource.includes('const nodeStateSignature = routeState.nodes.map'),
  backgroundMerge: fs.readFileSync(path.join(root, 'background.js'), 'utf8')
    .includes('function updateRouteRuntimeFromFieldCapture'),
}, {
  fieldPoll: true,
  fieldRouteGuard: true,
  routeStateCapture: true,
  nodeTypeRefresh: true,
  backgroundMerge: true,
});
expect('guidebook display fills IDs 1 through 100 without replacing known effects',
  context.guidebookEffectsWithIdPlaceholders([{
    id: 33,
    key: 'id:33',
    name: '通常攻撃のヒット数増加(＋1)',
  }, {
    id: 101,
    key: 'id:101',
    name: '将来追加された効果',
  }, {
    id: null,
    key: 'name:ID不明効果',
    name: 'ID不明効果',
  }]).reduce((result, effect) => {
    result.count += 1;
    if (effect.id === 1)
      result.first = effect;
    if (effect.id === 33)
      result.known = effect;
    if (effect.id === 101)
      result.aboveRange = effect;
    if (effect.id === null)
      result.unknown = effect;
    return result;
  }, {
    count: 0, first: null, known: null, aboveRange: null, unknown: null,
  }), {
    count: 102,
    first: {
      id: 1,
      key: 'id:1',
      name: '',
      isPlaceholder: true,
      sourceTypes: [],
    },
    known: {
      id: 33,
      key: 'id:33',
      name: '通常攻撃のヒット数増加(＋1)',
    },
    aboveRange: {
      id: 101,
      key: 'id:101',
      name: '将来追加された効果',
    },
    unknown: {
      id: null,
      key: 'name:ID不明効果',
      name: 'ID不明効果',
    },
  });
expect('R1 guidebook stat strings use current confirmation counts and duplication rules',
  context.buildGuidebookEffectValueRecords([{
    id: 1, rarity: 1, name: '自属性攻撃UP(20%)',
    acquisitionCount: 2, isDuplicationPossible: true,
  }, {
    id: 2, rarity: 1, name: '連続攻撃確率UP(7.5%)',
    acquisitionCount: 10, count: 3, sourceTypes: ['effect_confirmation'],
  }, {
    id: 3, rarity: 1, name: 'アビリティ与ダメージUP(5%)',
    acquisitionCount: 1,
  }, {
    id: 4, rarity: 1, name: 'アビリティダメージ上限UP(10%)',
    acquisitionCount: 2,
  }, {
    id: 5, rarity: 1, name: 'アビリティダメージUP(15%)(重複不可)',
    acquisitionCount: 4, isDuplicationPossible: false,
  }, {
    id: 6, rarity: 2, name: '未分類効果', acquisitionCount: 1,
  }, {
    id: 7, rarity: 1, name: 'アビダメUP(20%)',
    acquisitionCount: 3, count: 0, sourceTypes: ['effect_confirmation'],
  }]).map(record => [
    record.id,
    record.ownedCount,
    ...record.stats.map(stat => [stat.key, stat.value, stat.totalValue]),
  ]), [
    [1, 0, ['elementAttack', 20, 0]],
    [2, 3, ['multiattack', 7.5, 22.5]],
    [3, 0, ['abilitySupplemental', 5, 0]],
    [4, 0, ['abilityCap', 10, 0]],
    [5, 0, ['abilityDamage', 15, 0]],
    [7, 0, ['abilityDamage', 20, 0]],
  ]);
expect('guidebook calculator splits compound effects, units, flags, and chase slots',
  context.buildGuidebookEffectValueRecords([{
    id: 3, rarity: 1, name: 'アビリティダメージUP(20%)/アビリティダメージ上限UP(10%)',
    count: 2, sourceTypes: ['effect_confirmation'],
  }, {
    id: 9, rarity: 1, name: '渾身',
    count: 3, sourceTypes: ['effect_confirmation'],
  }, {
    id: 17, rarity: 2, name: '自属性追撃効果(20%)',
    count: 2, sourceTypes: ['effect_confirmation'],
  }, {
    id: 18, rarity: 2, name: '自属性奥義追撃効果(20%)',
    count: 1, sourceTypes: ['effect_confirmation'],
  }, {
    id: 25, rarity: 2, name: '被ダメージ減少(500)',
    count: 2, sourceTypes: ['effect_confirmation'],
  }, {
    id: 30, rarity: 2, name: '1ターン中の召喚可能回数増加(1回)',
    count: 2, sourceTypes: ['effect_confirmation'],
  }, {
    id: 31, rarity: 2, name: '敵の属性に関わらず弱点をつく(重複不可)',
    count: 1, sourceTypes: ['effect_confirmation'], isDuplicationPossible: false,
  }, {
    id: 36, rarity: 2,
    name: 'ドラフ族とグラックル族に自属性奥義追撃効果(30%)',
    count: 2, sourceTypes: ['effect_confirmation'],
  }, {
    id: 62, rarity: 2,
    name: '味方全体の通常攻撃とアビリティダメージと奥義が命中しないことがあるが、攻撃力UP(100%)/ダメージ上限UP(50%)',
    count: 1, sourceTypes: ['effect_confirmation'],
  }]).map(record => [
    record.id,
    ...record.stats.map(stat => [
      stat.key, stat.label, stat.unit, stat.totalValue, stat.slotKey || null,
    ]),
  ]), [
    [3,
      ['abilityDamage', 'アビダメ', 'percent', 40, null],
      ['abilityCap', 'アビ上限', 'percent', 20, null]],
    [9, ['staminaBooks', '渾身', 'book', 3, null]],
    [17, ['elementChase', '自属性追撃', 'percent', 40, 'id:17']],
    [18, ['elementOugiChase', '自属性奥義追撃', 'percent', 20, 'id:18']],
    [25, ['flatDamageReduction', '被ダメージ減少', 'flat', 1000, null]],
    [30, ['summonCount', '1ターン中の召喚可能回数', 'times', 2, null]],
    [31, ['keenEye', '慧眼効果', 'flag', 1, null]],
    [36, ['elementOugiChase', '種族自属性奥義追撃', 'percent', 60, 'id:36']],
    [62,
      ['attack', '攻撃力', 'percent', 100, null],
      ['damageCap', 'ダメ上限', 'percent', 50, null],
      ['accuracy', '命中率', 'percent', -25, null]],
  ]);
expect('observed catalog wording maps to the requested percentage metrics',
  [
    [4, '奥義ダメージUP(20%)/奥義ダメージ上限UP(10%)'],
    [5, 'チェインバーストダメージUP(50%)/チェインバーストダメージ上限UP(30%)'],
    [6, '奥義ダメージ特殊上限UP(10%)'],
    [8, '自属性攻撃UP(20%)'],
    [11, 'クリティカル確率UP(30%)'],
    [13, '最大HPUP(30%)'],
    [14, '防御力UP(30%)'],
    [15, '回復性能UP(20%)'],
    [20, '通常攻撃の与ダメージUP(30%)'],
    [21, 'アビリティ与ダメージUP(30%)'],
    [22, '奥義与ダメージUP(30%)'],
    [23, 'チェイン与ダメージUP(100%)'],
    [24, '自属性スキルエンハンス(60%)'],
    [27, '再生(1000回復)'],
    [28, '奥義ゲージ上昇量UP(20%)'],
    [29, '高揚(10%)'],
    [51, 'バトル勝利時のセフィラコインの獲得量UP(30%)'],
    [52, '瘴気ダメージ軽減(20%)'],
  ].map(([id, name]) => [
    id,
    ...context.parseGuidebookEffectValues({ id, rarity: 2, name })
      .map(stat => [stat.key, stat.value, stat.unit]),
  ]), [
    [4, ['ougiDamage', 20, 'percent'], ['ougiCap', 10, 'percent']],
    [5, ['chainDamage', 50, 'percent'], ['chainCap', 30, 'percent']],
    [6, ['ougiSpecialCap', 10, 'percent']],
    [8, ['elementAttack', 20, 'percent']],
    [11, ['critical', 30, 'percent']],
    [13, ['maxHp', 30, 'percent']],
    [14, ['defense', 30, 'percent']],
    [15, ['healing', 20, 'percent']],
    [20, ['normalSupplemental', 30, 'percent']],
    [21, ['abilitySupplemental', 30, 'percent']],
    [22, ['ougiSupplemental', 30, 'percent']],
    [23, ['chainSupplemental', 100, 'percent']],
    [24, ['enhance', 60, 'percent']],
    [27, ['regeneration', 1000, 'flat']],
    [28, ['ougiGaugeGain', 20, 'percent']],
    [29, ['uplift', 10, 'percent']],
    [51, ['coinGain', 30, 'percent']],
    [52, ['miasmaReduction', 20, 'percent']],
  ]);
expect('catalog sentence rewrites produce stable special-effect labels',
  [
    [31, '敵の属性に関わらず弱点をつく(重複不可)'],
    [59, 'パーティメンバーの得意武器に全ての武器種を追加する(重複不可)'],
    [60, 'パーティメンバーの種族に全ての種族を追加する(重複不可)'],
    [80, '被ダメージを有利属性に変換する(重複不可)'],
  ].map(([id, name]) => [
    id,
    ...context.parseGuidebookEffectValues({ id, rarity: 2, name })
      .map(stat => [stat.key, stat.label, stat.unit]),
  ]), [
    [31, ['keenEye', '慧眼効果', 'flag']],
    [59, ['allWeaponTypes', '全武器種化', 'flag']],
    [60, ['allRaces', '全種族化', 'flag']],
    [80, ['elementConversion', '自属性変転', 'flag']],
  ]);
expect('event guidebook acquisition IDs are read from the status-add request', 
  context.guidebookAcquisitionRequest({
    kind: 'ajax',
    url: '/rest/arcarum3/dungeon/proceed_node_event_spacebook_status_add',
    requestData: '{"special_token":null,"status_ids":[19]}',
  }), {
    ids: [19],
    source: 'event_reward',
  });
const formationState = context.createEmptyState();
expect('front formation is retained without hit-prediction snapshots', {
  accepted: context.handleFrontFormation(formationState, ['0', '1', '2', '4']),
  formation: formationState.frontFormation,
  predictionFields: ['gameSnapshot', 'preAttackSnapshot', 'hitPrediction', 'hitPredictionRecords']
    .filter(key => key in formationState),
}, {
  accepted: true,
  formation: [0, 1, 2, 4],
  predictionFields: [],
});

const element = () => ({
  textContent: '',
  disabled: false,
  title: '',
  className: '',
  value: '',
  classList: { add: noop, remove: noop },
  addEventListener: noop,
  replaceChildren: noop,
  appendChild: noop,
  append: noop,
});
const uiContext = vm.createContext({
  console,
  setTimeout,
  GbfRoutePlanner: routePlanner,
  navigator: { clipboard: { writeText: async () => {} } },
  document: {
    querySelector: () => element(),
    createElement: () => element(),
    createTextNode: text => ({ textContent: text }),
  },
  chrome: {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [], onActivated: { addListener: noop } },
    windows: { onFocusChanged: { addListener: noop } },
    runtime: { sendMessage: async () => ({}), onMessage: { addListener: noop } },
  },
});
vm.runInContext(fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8'), uiContext, { filename: 'sidepanel.js' });
expect('compact contribution labels', [9999, 10000, 125000, 100000000, 1230000000].map(uiContext.formatContribution), [
  '9,999', '1.0万', '12.5万', '1.0億', '12.3億',
]);
expect('compact character damage labels', [9999, 10000, 125000, 100000000].map(uiContext.formatContribution), [
  '9,999', '1.0万', '12.5万', '1.0億',
]);
const centeredRoutePositions = uiContext.routeNodePositions({
  state: { currentNodeId: 2 },
  localDistances: new Map([[1, 1], [2, 0], [3, 1]]),
}, [
  { id: 1, x: -100, y: 30 },
  { id: 2, x: 40, y: 80 },
  { id: 3, x: 200, y: 160 },
]);
expect('route canvas keeps the current node at its center', centeredRoutePositions.get(2), { x: 300, y: 200 });
const edgeRoutePositions = uiContext.routeNodePositions({
  state: { currentNodeId: 1 },
  localDistances: new Map([[1, 0], [2, 1], [3, 2]]),
}, [
  { id: 1, x: 0, y: 0 },
  { id: 2, x: 900, y: 0 },
  { id: 3, x: 1000, y: 0 },
]);
expect('route canvas centers the visible centroid when edge centering wastes space', {
  centroidX: Math.round([...edgeRoutePositions.values()].reduce((sum, point) => sum + point.x, 0) / 3),
  currentIsCentered: edgeRoutePositions.get(1).x === 300,
}, { centroidX: 300, currentIsCentered: false });
const continuationSegment = uiContext.routeContinuationSegment({
  graph: { byId: new Map([
    [1, { id: 1, x: 0, y: 0 }],
    [2, { id: 2, x: 100, y: 0 }],
    [3, { id: 3, x: 800, y: 0 }],
  ]) },
}, new Set([1, 2]), new Map([
  [1, { x: 300, y: 200 }],
  [2, { x: 500, y: 200 }],
]), [1, 2, 3]);
expect('recommended routes continue as a line toward an off-radius next node', continuationSegment, {
  fromId: 2, toId: 3, x1: 500, y1: 200, x2: 560, y2: 200,
});
const inferredContinuationSegment = uiContext.routeContinuationSegment({
  graph: {
    byId: new Map([
      [1, { id: 1, x: 0, y: 0 }],
      [2, { id: 2, x: 100, y: 0 }],
      [3, { id: 3, x: 800, y: 0 }],
    ]),
    adjacency: new Map([[1, new Set([2])], [2, new Set([1, 3])], [3, new Set([2])]]),
  },
}, new Set([1, 2]), new Map([
  [1, { x: 300, y: 200 }],
  [2, { x: 500, y: 200 }],
]), [1, 2]);
expect('a recommended endpoint connected outside the radius also emits a continuation line',
  inferredContinuationSegment,
  { fromId: 2, toId: 3, x1: 500, y1: 200, x2: 560, y2: 200 });
const allContinuationSegments = uiContext.routeOffRadiusContinuationSegments({
  displayGraph: {
    byId: new Map([
      [1, { id: 1, x: 0, y: 0 }],
      [2, { id: 2, x: 100, y: 0 }],
      [3, { id: 3, x: 800, y: -200 }],
      [4, { id: 4, x: 800, y: 200 }],
    ]),
    adjacency: new Map([
      [1, new Set([2])], [2, new Set([1, 3, 4])],
      [3, new Set([2])], [4, new Set([2])],
    ]),
  },
}, new Set([1, 2]), new Map([
  [1, { x: 300, y: 200 }],
  [2, { x: 500, y: 200 }],
]));
expect('every visible node shows short lines for all connections continuing outside the radius',
  allContinuationSegments.map(segment => ({ fromId: segment.fromId, toId: segment.toId })),
  [{ fromId: 2, toId: 3 }, { fromId: 2, toId: 4 }]);
expect('no continuation line is emitted when the full recommended route is visible',
  uiContext.routeContinuationSegment({ graph: { byId: new Map() } }, new Set([1, 2]), new Map(), [1, 2]),
  null);
expect('route continuation uses the recommended edge style without rendering the outside node', {
  className: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("'route-edge recommended continuation'"),
  nextNodeMarker: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("'data-next-node-id'"),
}, { className: true, nextNodeMarker: true });
expect('non-recommended off-radius connections use the normal edge style', {
  renderer: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("line.setAttribute('class', 'route-edge continuation')"),
  rounded: sidepanelCss.includes('.route-edge.continuation { stroke-linecap: round; }'),
}, { renderer: true, rounded: true });
expect('the current location keeps its node circle and adds a familiar red map pin above it', {
  baseCircle: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("const shape = document.createElementNS(ns, 'circle')"),
  pinPath: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("currentPin.setAttribute('class', 'route-current-pin')"),
  pinPointsAtNode: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('const pinTipY = point.y;'),
  pinShapePreserved: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('const pinCenterY = point.y - 17;'),
  redPin: sidepanelCss.includes('fill: #e53935; fill-opacity: 1;'),
  whiteCenter: sidepanelCss.includes('fill: #fff; fill-opacity: 1;'),
  currentIsNotRecommended: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('routeIds.has(node.id) && node.id !== plan.state.currentNodeId'),
  currentUsesEmptyBase: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("globalThis.GbfRoutePlanner.nodeVisual({ type: 0 })"),
  pinOverlayLast: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('svg.appendChild(currentPinOverlay)'),
  overlayClass: sidepanelCss.includes('.route-current-pin-overlay { opacity: 1; pointer-events: none; }'),
}, {
  baseCircle: true, pinPath: true, pinPointsAtNode: true, pinShapePreserved: true, redPin: true, whiteCenter: true,
  currentIsNotRecommended: true, currentUsesEmptyBase: true, pinOverlayLast: true, overlayClass: true,
});
expect('Game.view node inspector test tab exists', {
  tab: sidepanelHtml.includes('data-view="feature-test">新機能テスト</button>'),
  panel: sidepanelHtml.includes('data-panel="feature-test"'),
  capture: sidepanelHtml.includes('id="capture-game-nodes"'),
  output: sidepanelHtml.includes('id="node-inspector-output"'),
}, { tab: true, panel: true, capture: true, output: true });
expect('first-shrink radius analysis capture and export controls exist', {
  capture: sidepanelHtml.includes('id="capture-miasma-analysis"'),
  copy: sidepanelHtml.includes('id="copy-miasma-analysis"'),
  save: sidepanelHtml.includes('id="save-miasma-analysis"'),
  output: sidepanelHtml.includes('id="miasma-analysis-output"'),
  pageCapture: fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8')
    .includes('function captureMiasmaAnalysis()'),
  rawViewMiasma: fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8')
    .includes('miasmaEffectInfo: inspectGameValue'),
  radiusBounds: fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8')
    .includes('safeNodeMaximumDistance: lowerBound'),
  nativeCircleGeometry: pageHookSource.includes("'miasma_circle_1.png': { width: 1340, height: 1340 }")
    && pageHookSource.includes('nativeGeometryConfirmed')
    && pageHookSource.includes('circlePositionX + circleRadius'),
  registeredModelUpgrade: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("String(circle.source || '').startsWith('saved-native-image:')"),
  contentBridge: fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .includes('GBF_CAPTURE_MIASMA_ANALYSIS'),
  backgroundBridge: fs.readFileSync(path.join(root, 'background.js'), 'utf8')
    .includes('GBF_GET_MIASMA_ANALYSIS'),
}, {
  capture: true, copy: true, save: true, output: true, pageCapture: true,
  rawViewMiasma: true, radiusBounds: true, nativeCircleGeometry: true, registeredModelUpgrade: true,
  contentBridge: true, backgroundBridge: true,
});
expect('Ajax trace controls exist in feature test tab', {
  start: sidepanelHtml.includes('id="start-ajax-trace"'),
  stop: sidepanelHtml.includes('id="stop-ajax-trace"'),
  history: sidepanelHtml.includes('id="ajax-trace-history"'),
  save: sidepanelHtml.includes('id="save-ajax-trace"'),
}, { start: true, stop: true, history: true, save: true });
expect('optimal route tab and configurable-radius map exist', {
  tab: sidepanelHtml.includes('data-view="route-plan">最適ルート</button>'),
  panel: sidepanelHtml.includes('data-panel="route-plan"'),
  map: sidepanelHtml.includes('id="route-map"'),
  refresh: sidepanelHtml.includes('id="refresh-route-plan"'),
  reportCopy: sidepanelHtml.includes('id="copy-route-plan-report"')
    && sidepanelHtml.includes('Codex報告をコピー'),
  radius: sidepanelHtml.includes('id="route-map-radius"'),
  planner: sidepanelHtml.includes('<script src="route-planner.js"></script>'),
}, {
  tab: true, panel: true, map: true, refresh: true,
  reportCopy: true, radius: true, planner: true,
});
expect('full-map coordinate-only first-shrink simulation exists below the optimal route', {
  section: sidepanelHtml.includes('class="card route-experiment-card"'),
  map: sidepanelHtml.includes('id="route-experiment-map"'),
  status: sidepanelHtml.includes('id="route-experiment-status"'),
  metrics: sidepanelHtml.includes('id="route-experiment-metrics"'),
  reportCopy: sidepanelHtml.includes('id="copy-route-experiment-report"')
    && sidepanelHtml.includes('Codex報告をコピー'),
  renderer: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('function renderRouteExperiment(plan)'),
  allNodes: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('全${nodes.length}ノード'),
  coordinateTitle: sidepanelHtml.includes('収縮・座標シミュレーション'),
  noActualComparison: !sidepanelHtml.includes('実測瘴気') && !sidepanelHtml.includes('予測不一致'),
  restoredModelStatus: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("simulation.source === 'learned-node-boundary-model'")
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes("'初期推定モデル'"),
  noRenderedBoundsRequirement: !fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('収縮円画像の実表示倍率・boundsを取得してください'),
}, {
  section: true,
  map: true,
  status: true,
  metrics: true,
  reportCopy: true,
  renderer: true,
  allNodes: true,
  coordinateTitle: true,
  noActualComparison: true,
  restoredModelStatus: true,
  noRenderedBoundsRequirement: true,
});
expect('hit-prediction tab is replaced by the real-time guidebook effect list', {
  tab: sidepanelHtml.includes('data-view="guidebook">導本リスト</button>'),
  panel: sidepanelHtml.includes('data-panel="guidebook"'),
  list: sidepanelHtml.includes('id="guidebook-list"'),
  filter: sidepanelHtml.includes('id="guidebook-filter"'),
  stateFilter: sidepanelHtml.includes('id="guidebook-state-filter"')
    && ['すべて', '未獲得', '獲得済み', 'ID不明']
      .every(label => sidepanelHtml.includes(`>${label}</option>`)),
  r1Summary: [
    'guidebook-percent-summary',
    'guidebook-count-summary',
    'guidebook-flag-summary',
    'guidebook-calculator-status',
  ].every(id => sidepanelHtml.includes(`id="${id}"`))
    && sidepanelHtml.includes('獲得導本効果')
    && sidepanelCss.includes('.guidebook-r1-grid'),
  activeOnlySummary: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('.filter(([key]) => (totals.get(key) || 0) !== 0)')
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes('record.ownedCountKnown && Number(record.ownedCount) > 0')
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes("createGuidebookCalculatorEmpty(message = '有効な効果なし')"),
  copy: sidepanelHtml.includes('id="copy-guidebook-effects"'),
  manualCapture: sidepanelHtml.includes('id="capture-guidebook-effects"')
    && sidepanelHtml.includes('現在画面から取得'),
  storageDiagnosticsButton: sidepanelHtml.includes('id="inspect-guidebook-storage"')
    && sidepanelHtml.includes('格納場所を調査'),
  manualCaptureRequest: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("type: 'GBF_CAPTURE_GUIDEBOOK_EFFECTS'"),
  pageCapture: pageHookSource.includes('function captureGuidebookEffectsFromView()')
    && pageHookSource.includes("kind: 'guidebook_capture'")
    && pageHookSource.includes('function') === true
    && pageHookSource.includes('looksLikeGuidebookViewEffect')
    && pageHookSource.includes('viewEffects: uniqueViewEffects'),
  bookPageDomCapture: pageHookSource.includes('#arcarum3\\/book')
    && pageHookSource.includes('img[src*="/arcarum3/assets/icon_book_effect/"]')
    && pageHookSource.includes("source_type: 'effect_confirmation'"),
  cursedBookCapture: pageHookSource.includes('btn_(unique|rare|normal|cursed)_on')
    && pageHookSource.includes("is_cursed: bookCategory === 'cursed'")
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes("effect.isCursed ? '呪われた導本' : null"),
  shopPageDomCapture: pageHookSource.includes('#arcarum3\\/dungeon_shop')
    && pageHookSource.includes('#js-prt-dungeon-shop-content-list ')
    && pageHookSource.includes('必要セフィラコイン')
    && pageHookSource.includes("source_type: 'shop_page'"),
  automaticShopRefresh: pageHookSource.includes("kind: 'guidebook_page_capture'")
    && pageHookSource.includes('setTimeout(emitGuidebookPageCapture, delay)'),
  contentRouting: contentSource.includes("message?.type !== 'GBF_CAPTURE_GUIDEBOOK_EFFECTS'")
    && contentSource.includes("'capture_guidebook_effects'"),
  storageDiagnosticsRouting: contentSource.includes("'GBF_INSPECT_GUIDEBOOK_STORAGE'")
    && contentSource.includes("'inspect_guidebook_storage'")
    && contentSource.includes("'guidebook_diagnostics'"),
  storageDiagnosticsCapture: pageHookSource.includes(
    'function captureGuidebookStorageDiagnostics()',
  ) && pageHookSource.includes('Game.view.constructor.prototype')
    && pageHookSource.includes('current page DOM')
    && pageHookSource.includes('matchCount: matches.length')
    && pageHookSource.includes('guidebookDomInventory')
    && pageHookSource.includes("document.querySelectorAll('#root li')"),
  noPredictionPanel: !sidepanelHtml.includes('data-panel="prediction"')
    && !sidepanelHtml.includes('hit予測'),
  noManualInput: !sidepanelHtml.includes('<textarea')
    && !fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes('GBF_UPDATE_GUIDEBOOK_EFFECT'),
  realTime: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('GBF_GUIDEBOOK_EFFECTS_UPDATED'),
  shopAndConfirmationStatus: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('ショップ・効果確認'),
  exportButton: sidepanelHtml.includes('id="export-guidebook-effects"'),
  importButton: sidepanelHtml.includes('id="import-guidebook-effects"'),
  importFile: sidepanelHtml.includes('id="import-guidebook-file"'),
  importMessage: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("type: 'GBF_IMPORT_GUIDEBOOK_EFFECTS'"),
  exportDownload: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('function exportGuidebookEffects()'),
  acquisitionToast: sidepanelHtml.includes('id="guidebook-toast-layer"')
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes('function showGuidebookCaptureToast(')
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes('function createGuidebookCaptureToast(')
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes('...captured.map(createGuidebookCaptureToast)')
    && sidepanelCss.includes('.guidebook-capture-toast'),
  capturePayload: fs.readFileSync(path.join(root, 'background.js'), 'utf8')
    .includes('captureBatchId,')
    && fs.readFileSync(path.join(root, 'background.js'), 'utf8')
      .includes('capturedEffects,'),
  captureFailureCopy: sidepanelHtml.includes('id="copy-guidebook-diagnostics"')
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes('function copyGuidebookCaptureFailureReport()')
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes("schema: 'gbf-guidebook-capture-failure-v1'")
    && sidepanelCss.includes('.guidebook-diagnostics-bar'),
}, {
  tab: true,
  panel: true,
  list: true,
  filter: true,
  stateFilter: true,
  r1Summary: true,
  activeOnlySummary: true,
  copy: true,
  manualCapture: true,
  storageDiagnosticsButton: true,
  manualCaptureRequest: true,
  pageCapture: true,
  bookPageDomCapture: true,
  cursedBookCapture: true,
  shopPageDomCapture: true,
  automaticShopRefresh: true,
  contentRouting: true,
  storageDiagnosticsRouting: true,
  storageDiagnosticsCapture: true,
  noPredictionPanel: true,
  noManualInput: true,
  realTime: true,
  shopAndConfirmationStatus: true,
  exportButton: true,
  importButton: true,
  importFile: true,
  importMessage: true,
  exportDownload: true,
  acquisitionToast: true,
  capturePayload: true,
  captureFailureCopy: true,
});
expect('guidebook import parser accepts only the versioned guidebook JSON schema', {
  accepted: uiContext.parseGuidebookImportText(JSON.stringify({
    schema: 'gbf-guidebook-effects-v1',
    effects: [{ id: 1, name: '攻撃力UP' }],
  })).effects.length,
  invalidSchema: (() => {
    try {
      uiContext.parseGuidebookImportText('{"schema":"unknown","effects":[]}');
      return null;
    }
    catch (error) {
      return error.message;
    }
  })(),
  invalidJson: (() => {
    try {
      uiContext.parseGuidebookImportText('{broken');
      return null;
    }
    catch (error) {
      return error.message;
    }
  })(),
}, {
  accepted: 1,
  invalidSchema: '対応していない導本JSONです',
  invalidJson: '導本JSONを解析できません',
});
expect('guidebook export treats the normalized server name as the effect text',
  uiContext.guidebookExportData([{
    id: 61,
    name: '弱体アビリティ使用時@@弱体効果を2つ付与',
  }]).effects, [{
    id: 61,
    name: '弱体アビリティ使用時\n弱体効果を2つ付与',
  }]);
expect('latest displayed guidebook choice batch is selected for highlighting', {
  latest: uiContext.latestGuidebookCandidateBatchId([
    { lastCandidateBatchId: '2026-01-01T00:00:00.000Z:00000001', lastCandidateSeenAt: '2026-01-01T00:00:00.000Z' },
    { lastCandidateBatchId: '2026-01-01T00:01:00.000Z:00000002', lastCandidateSeenAt: '2026-01-01T00:01:00.000Z' },
    { sourceTypes: ['battle_reward'] },
  ], Date.parse('2026-01-01T00:01:30.000Z')),
  expired: uiContext.latestGuidebookCandidateBatchId([
    { lastCandidateBatchId: 'old-batch', lastCandidateSeenAt: '2026-01-01T00:00:00.000Z' },
  ], Date.parse('2026-01-01T00:01:00.001Z')),
  highlightedStyle: sidepanelCss.includes('.guidebook-effect.latest-candidate'),
  highlightedLabel: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("isLatestCandidate ? '直近の選択肢' : null"),
}, {
  latest: '2026-01-01T00:01:00.000Z:00000002',
  expired: null,
  highlightedStyle: true,
  highlightedLabel: true,
});
expect('latest acquired guidebook batch is highlighted separately from choices', {
  latest: uiContext.latestGuidebookAcquisitionBatchId([
    {
      lastAcquisitionBatchId: 'batch-1',
      lastAcquiredAt: '2026-01-01T00:00:00.000Z',
    },
    {
      lastAcquisitionBatchId: 'batch-2',
      lastAcquiredAt: '2026-01-01T00:01:00.000Z',
    },
    { lastCandidateBatchId: 'candidate-only' },
  ], Date.parse('2026-01-01T00:01:30.000Z')),
  expired: uiContext.latestGuidebookAcquisitionBatchId([
    { lastAcquisitionBatchId: 'old-acquisition', lastAcquiredAt: '2026-01-01T00:00:00.000Z' },
  ], Date.parse('2026-01-01T00:01:00.001Z')),
  states: [
    uiContext.guidebookEffectDisplayState({ id: 1, name: '', isPlaceholder: true }),
    uiContext.guidebookEffectDisplayState({ id: 33, name: '通常攻撃のヒット数増加(＋1)' }),
    uiContext.guidebookEffectDisplayState({ id: null, name: '渾身' }),
  ],
  highlightedStyle: sidepanelCss.includes('.guidebook-effect.latest-acquisition'),
  highlightedLabel: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("isLatestAcquisition ? '直近の獲得' : null"),
}, {
  latest: 'batch-2',
  expired: null,
  states: ['missing', 'known', 'unknown-id'],
  highlightedStyle: true,
  highlightedLabel: true,
});
expect('guidebook rarity colors use bronze white gold and cursed red-purple while highlights use green', {
  classes: [
    uiContext.guidebookRarityClass({ rarity: 1 }),
    uiContext.guidebookRarityClass({ rarity: 2 }),
    uiContext.guidebookRarityClass({ rarity: 3 }),
    uiContext.guidebookRarityClass({ rarity: 0, shopBookGrade: 3 }),
    uiContext.guidebookRarityClass({ rarity: 99, iconCategory: 4, isCursed: true }),
    uiContext.guidebookRarityClass({ bookCategory: 'cursed' }),
    uiContext.guidebookRarityClass({}),
  ],
  bronze: sidepanelCss.includes('.guidebook-effect.rarity-bronze { border-color: #b45309;'),
  white: sidepanelCss.includes('.guidebook-effect.rarity-white { border-color: #e5e7eb;'),
  gold: sidepanelCss.includes('.guidebook-effect.rarity-gold { border-color: #f59e0b;'),
  cursed: sidepanelCss.includes('.guidebook-effect.rarity-cursed { border-color: #db2777;'),
  cursedBadge: sidepanelCss.includes(
    '.guidebook-effect.rarity-cursed .guidebook-effect-id { background: #831843;',
  ),
  candidateGreen: sidepanelCss.includes('box-shadow: inset 3px 0 #4ade80;'),
  acquisitionGreen: sidepanelCss.includes('box-shadow: inset 3px 0 #10b981;'),
}, {
  classes: [
    'rarity-bronze', 'rarity-white', 'rarity-gold', 'rarity-gold',
    'rarity-cursed', 'rarity-cursed', 'rarity-unknown',
  ],
  bronze: true,
  white: true,
  gold: true,
  cursed: true,
  cursedBadge: true,
  candidateGreen: true,
  acquisitionGreen: true,
});
expect('guidebook metadata uses a wrapping row instead of competing with source labels', {
  twoColumnHeading: sidepanelCss.includes(
    '.guidebook-effect-heading { display: grid; grid-template-columns: auto minmax(0, 1fr);',
  ),
  fullWidthMetadata: sidepanelCss.includes(
    '.guidebook-effect-meta { grid-column: 1 / -1;',
  ),
  wrappingMetadata: sidepanelCss.includes('overflow-wrap: anywhere; white-space: normal;'),
}, { twoColumnHeading: true, fullWidthMetadata: true, wrappingMetadata: true });
expect('registered fixed special events receive a small completed badge on the route map', {
  registered: uiContext.isRegisteredSpecialEventNode({
    id: 10,
    type: 10,
    x: 989,
    y: 648,
    specialIncidentId: 9,
  }, { mapId: 1 }),
  unregistered: uiContext.isRegisteredSpecialEventNode({
    id: 99,
    type: 10,
    x: 111,
    y: 222,
    specialIncidentId: 999,
  }, { mapId: 1 }),
  normalNode: uiContext.isRegisteredSpecialEventNode({
    id: 20,
    type: 5,
    x: 989,
    y: 648,
  }, { mapId: 1 }),
  badgeText: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("badgeText.textContent = '済';"),
  badgePosition: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("badgeShape.setAttribute('cx', point.x + 12);")
    && fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
      .includes("badgeShape.setAttribute('cy', point.y - 12);"),
  badgeStyle: sidepanelCss.includes('.route-node-recorded-badge circle { fill: #16a34a;'),
}, {
  registered: true,
  unregistered: false,
  normalNode: false,
  badgeText: true,
  badgePosition: true,
  badgeStyle: true,
});
expect('special event history and current-event copy control exist', {
  list: sidepanelHtml.includes('id="route-observation-list"'),
  currentCopy: sidepanelHtml.includes('id="copy-current-route-event"'),
  oldCopyRemoved: !sidepanelHtml.includes('id="copy-route-observations"'),
  jsonSaveRemoved: !sidepanelHtml.includes('id="save-route-observations"'),
}, { list: true, currentCopy: true, oldCopyRemoved: true, jsonSaveRemoved: true });
expect('special event storage keys are map-independent fixed coordinates', {
  map1: uiContext.specialEventObservationKey({ mapId: 1, x: 813, y: 332, eventId: 10 }),
  map9: uiContext.specialEventObservationKey({ mapId: 9, x: 813, y: 332, eventId: 15 }),
}, { map1: '813|332', map9: '813|332' });
expect('registered fixed special events are excluded from the observation display', {
  event9: uiContext.isRegisteredSpecialEventRecord({
    x: 989, y: 648, eventId: 9, mapId: 1,
  }),
  event10: uiContext.isRegisteredSpecialEventRecord({
    x: 813, y: 332, eventId: 10, mapId: 4,
  }),
  event11: uiContext.isRegisteredSpecialEventRecord({
    x: 1832, y: 350, eventId: 11, mapId: 1,
  }),
  event13: uiContext.isRegisteredSpecialEventRecord({
    x: 2052, y: 617, eventId: 13, mapId: 99,
  }),
  event14: uiContext.isRegisteredSpecialEventRecord({
    x: 910, y: 1419, eventId: 14, mapId: 2,
  }),
  event16: uiContext.isRegisteredSpecialEventRecord({
    x: 1597, y: 1062, eventId: 16, mapId: 1,
  }),
  event18: uiContext.isRegisteredSpecialEventRecord({
    x: 2396, y: 1466, eventId: 18, mapId: 3,
  }),
  unregistered: uiContext.isRegisteredSpecialEventRecord({
    x: 1000, y: 1000, eventId: 99, mapId: 4,
  }),
  floatingTransferExcluded: uiContext.isFloatingCastleSpecialEventRecord({
    specialType: 6, eventId: 6,
  }),
  floatingResearcherExcluded: uiContext.isFloatingCastleSpecialEventRecord({
    specialType: 8, eventId: 8,
  }),
  floatingBodyExcluded: uiContext.isFloatingCastleSpecialEventRecord({
    specialType: 4, eventId: 4, x: 346, y: 292,
  }),
  disconnectedFloatingBodyExcluded: uiContext.isFloatingCastleSpecialEventRecord({
    specialType: 4, eventId: 4, x: 999, y: 999, isDisconnectedSpecial: true,
  }),
  cultLeaderExcluded: uiContext.isFloatingCastleSpecialEventRecord({
    specialType: 1, eventId: 1,
  }),
  fanaticExcluded: uiContext.isFloatingCastleSpecialEventRecord({
    specialType: 2, eventId: 2,
  }),
  otherTypeFourRetained: uiContext.isFloatingCastleSpecialEventRecord({
    specialType: 4, eventId: 4, x: 999, y: 999,
  }),
  ordinarySpecialRetained: uiContext.isFloatingCastleSpecialEventRecord({
    specialType: 16, eventId: 16,
  }),
  displayFilter: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('&& !isFloatingCastleSpecialEventRecord(record)'),
}, {
  event9: true,
  event10: true,
  event11: true,
  event13: true,
  event14: true,
  event16: true,
  event18: true,
  unregistered: false,
  floatingTransferExcluded: true,
  floatingResearcherExcluded: true,
  floatingBodyExcluded: true,
  disconnectedFloatingBodyExcluded: true,
  cultLeaderExcluded: true,
  fanaticExcluded: true,
  otherTypeFourRetained: false,
  ordinarySpecialRetained: false,
  displayFilter: true,
});
expect('special event appearances retain map, pattern, and spawn phase separately',
  uiContext.mergeSpecialEventAppearances(
    [{ mapId: 1, basePatternId: 2, patternId: 1, phase: 'initial-map', nodeId: 9 }],
    [{ mapId: 3, basePatternId: 4, patternId: 2, phase: 'post-day1-boss', nodeId: 88 }],
  ).map(item => [item.mapId, item.basePatternId, item.patternId, item.phase, item.nodeIds]), [
    [1, 2, 1, 'initial-map', [9]],
    [3, 4, 2, 'post-day1-boss', [88]],
  ]);
expect('special event spawn phase can use the observed first-boss completion state', {
  initial: uiContext.specialEventAppearance({ totalTurn: 12, miasma: {} }, { id: 1 }).phase,
  added: uiContext.specialEventAppearance({
    totalTurn: 42, dayOneBossDefeated: true, miasma: {},
  }, { id: 2 }).phase,
}, { initial: 'initial-map', added: 'post-day1-boss' });

const routeFixture = {
  currentNodeId: 1,
  totalTurn: 10,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true, x: 0, y: 0 },
    { id: 2, type: 6, adjacentIds: [1], x: -10, y: 0 },
    { id: 3, type: 5, adjacentIds: [1, 4], x: 10, y: 0 },
    { id: 4, type: 1, adjacentIds: [3, 5], x: 20, y: 0 },
    { id: 5, type: 2, adjacentIds: [4, 6], x: 30, y: 0 },
    { id: 6, type: 2, adjacentIds: [5, 7], x: 40, y: 0 },
    { id: 7, type: 2, adjacentIds: [6], x: 50, y: 0 },
  ],
};
const missingCoordinateSimulation = routePlanner.simulateFirstShrinkArea({
  mapId: 4,
  currentNodeId: 1,
  miasma: { active: true, level: 1, status: 1, step: 50, centerX: 904, centerY: 1082 },
  nodes: [{ id: 1, type: 0, x: 0, y: 0, adjacentIds: [], isShrinking: true }],
});
expect('first-shrink simulation falls back to live coordinates without an exact pattern match', {
  source: missingCoordinateSimulation.source,
  modelKey: missingCoordinateSimulation.modelKey,
  finalCenter: missingCoordinateSimulation.finalCenter,
  finalRadius: missingCoordinateSimulation.finalRadius,
  nodeCount: missingCoordinateSimulation.nodeCount,
}, {
  source: 'limit-circle-estimate',
  modelKey: 'estimate:4:*:*:1',
  finalCenter: { x: 904, y: 1082 },
  finalRadius: 670,
  nodeCount: 1,
});
const leftTopCoordinateSimulation = routePlanner.simulateFirstShrinkArea({
  mapId: 2,
  currentNodeId: 1,
  miasma: {
    active: true, level: 1, status: 1, step: 0,
    basePatternId: 8, patternId: 9,
    circlePositionX: 230, circlePositionY: 60,
    circleImage: 'miasma_circle_1.png',
  },
  nodes: [
    { id: 1, type: 0, x: 0, y: 0, adjacentIds: [] },
    { id: 2, type: 0, x: 2000, y: 2000, adjacentIds: [] },
  ],
});
expect('unobserved first-shrink pattern uses the limitCircle top-left and radius 670', {
  source: leftTopCoordinateSimulation.source,
  finalCenter: leftTopCoordinateSimulation.finalCenter,
  finalRadius: leftTopCoordinateSimulation.finalRadius,
  startRadius: Number(leftTopCoordinateSimulation.startRadius.toFixed(3)),
}, {
  source: 'limit-circle-estimate',
  finalCenter: { x: 900, y: 730 },
  finalRadius: 670,
  startRadius: 1464.214,
});
const learnedBoundaryState = {
  mapId: 2,
  currentNodeId: 2,
  capturedAt: '2026-07-24T12:00:00.000Z',
  miasma: {
    active: true, level: 1, status: 2, step: 100,
    basePatternId: 8, patternId: 9,
    centerX: 1000, centerY: 1000,
  },
  nodes: [
    { id: 1, type: 0, x: 900, y: 1000, adjacentIds: [], isShrinking: false },
    { id: 2, type: 0, x: 1100, y: 1000, adjacentIds: [], isShrinking: false },
    { id: 3, type: 0, x: 0, y: 1000, adjacentIds: [], isShrinking: true },
    { id: 4, type: 0, x: 2000, y: 1000, adjacentIds: [], isShrinking: true },
  ],
};
const learnedBoundaryObservation = routePlanner.createFirstShrinkLearningObservation(
  learnedBoundaryState,
);
const learnedBoundarySimulation = routePlanner.simulateFirstShrinkArea({
  ...learnedBoundaryState,
  miasma: { ...learnedBoundaryState.miasma, status: 1, step: 0 },
  firstShrinkLearnedModels: [{
    ...learnedBoundaryObservation,
    observationCount: 3,
  }],
});
expect('completed node boundary becomes the next run learned first-shrink model', {
  observationKey: learnedBoundaryObservation.key,
  observationCenter: learnedBoundaryObservation.finalCenter,
  observationRadius: learnedBoundaryObservation.finalRadius,
  source: learnedBoundarySimulation.source,
  modelKey: learnedBoundarySimulation.modelKey,
  count: learnedBoundarySimulation.observationCount,
  finalCenter: learnedBoundarySimulation.finalCenter,
  finalRadius: learnedBoundarySimulation.finalRadius,
}, {
  observationKey: '2:8:9:1',
  observationCenter: { x: 1000, y: 1000 },
  observationRadius: 550,
  source: 'learned-node-boundary-model',
  modelKey: '2:8:9:1',
  count: 3,
  finalCenter: { x: 1000, y: 1000 },
  finalRadius: 550,
});
const learnedModelOnce = context.mergeRouteFirstShrinkLearningObservation(
  null,
  learnedBoundaryObservation,
);
const learnedModelTwice = context.mergeRouteFirstShrinkLearningObservation(
  learnedModelOnce,
  {
    ...learnedBoundaryObservation,
    finalCenter: { x: 1020, y: 980 },
    finalRadius: 570,
    radiusIntercept: learnedBoundaryObservation.radiusIntercept + 20,
    capturedAt: '2026-07-24T13:00:00.000Z',
  },
);
expect('learned first-shrink observations are median-merged and persistently wired', {
  center: learnedModelTwice.finalCenter,
  radius: learnedModelTwice.finalRadius,
  observations: learnedModelTwice.observationCount,
  samples: learnedModelTwice.samples.length,
  persistentKey: vm.runInContext('ROUTE_FIRST_SHRINK_MODELS_KEY', context),
  plannerLoadedInWorker: fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8')
    .includes("importScripts('route-planner.js', 'background.js')"),
  automaticFieldLearning: fs.readFileSync(path.join(root, 'background.js'), 'utf8')
    .includes('scheduleRouteFirstShrinkLearning(tabId, next)'),
}, {
  center: { x: 1010, y: 990 },
  radius: 560,
  observations: 2,
  samples: 2,
  persistentKey: 'route-first-shrink-models:v1',
  plannerLoadedInWorker: true,
  automaticFieldLearning: true,
});
const coordinateSimulation = routePlanner.simulateFirstShrinkArea({
  mapId: 4,
  currentNodeId: 1,
  miasma: {
    active: true, level: 1, status: 1, step: 50,
    centerX: 904, centerY: 1082, basePatternId: 3, patternId: 1,
    circleImage: 'miasma_circle_1.png',
  },
  nodes: [
    { id: 1, type: 0, x: 0, y: 0, adjacentIds: [], isShrinking: false },
    { id: 2, type: 0, x: 2000, y: 0, adjacentIds: [], isShrinking: true },
    { id: 3, type: 0, x: 0, y: 2000, adjacentIds: [], isShrinking: false },
    { id: 4, type: 0, x: 2000, y: 2000, adjacentIds: [], isShrinking: true },
    { id: 5, type: 0, x: 1000, y: 1000, adjacentIds: [], isShrinking: false },
  ],
});
expect('first-shrink simulation uses the restored registered OPFS pattern model without rendered bounds', {
  source: coordinateSimulation.source,
  modelKey: coordinateSimulation.modelKey,
  finalRadius: Number(coordinateSimulation.finalRadius.toFixed(3)),
  currentRadius: Number(coordinateSimulation.currentRadius.toFixed(3)),
  finalCenter: coordinateSimulation.finalCenter,
  simulatedMiasmaIds: coordinateSimulation.simulatedMiasmaIds,
  counts: [coordinateSimulation.simulatedMiasmaCount, coordinateSimulation.simulatedSafeCount],
}, {
  source: 'registered-log-model',
  modelKey: '4:3:1',
  finalRadius: 666.115,
  currentRadius: 1161.01,
  finalCenter: { x: 867.9, y: 1000.5 },
  simulatedMiasmaIds: [1, 2, 3, 4],
  counts: [4, 1],
});
const savedCoordinateCircle = routePlanner.createFirstShrinkCircleSnapshot({
  mapId: 4,
  currentNodeId: 1,
  miasma: {
    active: true, level: 1, status: 1, step: 50,
    basePatternId: 3, patternId: 1,
  },
  nodes: [
    { id: 1, type: 0, x: 0, y: 0, adjacentIds: [] },
    { id: 2, type: 0, x: 2000, y: 2000, adjacentIds: [] },
  ],
});
expect('first-shrink final circle can be frozen as a day-scoped snapshot', {
  center: savedCoordinateCircle.center,
  radius: Number(savedCoordinateCircle.radius.toFixed(3)),
  source: savedCoordinateCircle.source,
  modelKey: savedCoordinateCircle.modelKey,
  mapId: savedCoordinateCircle.mapId,
  patterns: [savedCoordinateCircle.basePatternId, savedCoordinateCircle.patternId],
  dayIndex: savedCoordinateCircle.dayIndex,
}, {
  center: { x: 867.9, y: 1000.5 },
  radius: 666.115,
  source: 'saved-first-shrink-simulation',
  modelKey: '4:3:1',
  mapId: 4,
  patterns: [3, 1],
  dayIndex: 1,
});
const imageGeometryCircle = routePlanner.createFirstShrinkCircleSnapshot({
  mapId: 2,
  currentNodeId: 1,
  miasma: {
    active: true, level: 1, status: 2, step: 100,
    basePatternId: 9, patternId: 9,
    centerX: 893, centerY: 729,
    circlePositionX: 223, circlePositionY: 59,
    circleCenterX: 893, circleCenterY: 729,
    circleRadius: 670,
    circleGeometrySource: 'native-image:miasma_circle_1.png',
    circleImage: 'miasma_circle_1.png',
  },
  nodes: [{ id: 1, type: 0, x: 893, y: 729, adjacentIds: [] }],
});
expect('confirmed miasma_circle_1 geometry freezes the limitCircle image instead of a pattern model', {
  center: imageGeometryCircle.center,
  radius: imageGeometryCircle.radius,
  source: imageGeometryCircle.source,
  modelKey: imageGeometryCircle.modelKey,
}, {
  center: { x: 893, y: 729 },
  radius: 670,
  source: 'saved-native-image:miasma_circle_1.png',
  modelKey: 'limitCircle:miasma_circle_1.png',
});
const observedPatternBoundaryState = {
  mapId: 4,
  currentNodeId: 119,
  miasma: {
    active: true, level: 1, status: 2, step: 100,
    basePatternId: 1, patternId: 1,
    centerX: 893, centerY: 729,
    circlePositionX: 223, circlePositionY: 59,
    circleCenterX: 893, circleCenterY: 729,
    circleRadius: 670,
    circleGeometrySource: 'native-image:miasma_circle_1.png',
    circleImage: 'miasma_circle_1.png',
  },
  nodes: [
    { id: 37, type: 0, x: 212, y: 631, adjacentIds: [] },
    { id: 70, type: 0, x: 1550, y: 675, adjacentIds: [] },
    { id: 119, type: 3, x: 1064, y: 1267, adjacentIds: [] },
    { id: 120, type: 5, x: 1180, y: 1216, adjacentIds: [] },
  ],
};
const observedPatternBoundarySimulation = routePlanner.simulateFirstShrinkArea(
  observedPatternBoundaryState,
);
const observedPatternBoundaryCircle = routePlanner.createFirstShrinkCircleSnapshot(
  observedPatternBoundaryState,
);
expect('registered 1:1 coordinates override the native image bounds at the observed safe boundary', {
  finalCenter: observedPatternBoundarySimulation.finalCenter,
  finalRadius: observedPatternBoundarySimulation.finalRadius,
  miasmaIds: observedPatternBoundarySimulation.simulatedMiasmaIds,
  snapshotCenter: observedPatternBoundaryCircle.center,
  snapshotRadius: observedPatternBoundaryCircle.radius,
  snapshotSource: observedPatternBoundaryCircle.source,
  snapshotModelKey: observedPatternBoundaryCircle.modelKey,
}, {
  finalCenter: { x: 843, y: 629 },
  finalRadius: 650,
  miasmaIds: [70, 119, 120],
  snapshotCenter: { x: 843, y: 629 },
  snapshotRadius: 650,
  snapshotSource: 'saved-first-shrink-simulation',
  snapshotModelKey: '*:1:1',
});
const firstShrinkReport = uiContext.createRouteExperimentReport({
  state: {
    mapId: 4,
    currentNodeId: 5,
    totalTurn: 14,
    capturedAt: '2026-07-23T00:00:00.000Z',
    miasma: {
      active: true, level: 1, status: 1, step: 50, remainTurn: 10,
      basePatternId: 3, patternId: 1, centerX: 904, centerY: 1082,
    },
    nodes: [
      { id: 1, type: 0, x: 0, y: 0, adjacentIds: [5], isShrinking: true },
      { id: 5, type: 6, x: 1000, y: 1000, adjacentIds: [1], isVisited: true, isShrinking: false },
    ],
  },
  firstShrinkSimulation: {
    ...coordinateSimulation,
    simulatedMiasmaIds: [1, 5],
    simulatedMiasmaCount: 2,
    simulatedSafeCount: 0,
  },
});
expect('first-shrink Codex report includes editable visual notes, coordinates, and comparison IDs', {
  heading: firstShrinkReport.includes('第一次収縮シミュレーション Codex報告'),
  visualSafe: firstShrinkReport.includes('実際の円内（安全）: node '),
  visualMiasma: firstShrinkReport.includes('実際の円外（瘴気）: node '),
  schema: firstShrinkReport.includes('"schema": "gbf-first-shrink-simulation-report-v1"'),
  model: firstShrinkReport.includes('"modelKey": "4:3:1"'),
  coordinate: firstShrinkReport.includes('"x": 1000') && firstShrinkReport.includes('"y": 1000'),
  gameOnly: firstShrinkReport.includes('"gameStateOnlyShrinkingNodeIds": []'),
  simulationOnly: firstShrinkReport.includes('"simulationOnlyMiasmaNodeIds": [\n      5\n    ]'),
}, {
  heading: true,
  visualSafe: true,
  visualMiasma: true,
  schema: true,
  model: true,
  coordinate: true,
  gameOnly: true,
  simulationOnly: true,
});
const secondShrinkExperimentPlan = {
  state: {
    mapId: 4,
    currentNodeId: 1,
    totalTurn: 40,
    capturedAt: '2026-07-23T00:00:00.000Z',
    miasma: { active: true, level: 2, status: 1, remainTurn: 10 },
    nodes: [
      { id: 1, type: 0, x: 0, y: 0, adjacentIds: [9], isShrinking: false },
      { id: 2, type: 0, x: 300, y: 0, adjacentIds: [9], isShrinking: true },
      { id: 9, type: 1, x: 100, y: 100, adjacentIds: [1, 2], isShrinking: false },
    ],
  },
  secondShrinkSimulation: {
    source: 'boss-anchor-scaled-circle-contraction',
    startCircleSource: 'saved-first-shrink-simulation',
    firstShrinkCircleCapturedAt: '2026-07-23T00:00:00.000Z',
    firstShrinkCircleModelKey: '4:3:1',
    anchorBossId: 9,
    startCenter: { x: 0, y: 0 },
    currentCenter: { x: 50, y: 50 },
    finalCenter: { x: 100, y: 100 },
    center: { x: 50, y: 50 },
    remainTurn: 10,
    progress: 0.5,
    remainingScale: 0.5,
    startRadius: 447.214,
    currentRadius: 223.607,
    finalRadius: 0,
    bossRadiusPosition: 0.316228,
    nodeDeadlines: { 1: 45, 2: 40, 9: null },
    predictedShrinkOrder: [2, 1],
    alreadyMiasmaNodeIds: [2],
  },
};
const secondShrinkExperiment = uiContext.routeExperimentSimulationState(
  secondShrinkExperimentPlan,
);
const secondShrinkReport = uiContext.createRouteExperimentReport(secondShrinkExperimentPlan);
expect('second-shrink experiment uses the boss anchor, node deadlines, and dedicated report schema', {
  kind: secondShrinkExperiment.kind,
  center: secondShrinkExperiment.center,
  miasmaIds: [...secondShrinkExperiment.miasmaIds],
  heading: secondShrinkReport.includes('第二次収縮シミュレーション Codex報告'),
  schema: secondShrinkReport.includes('"schema": "gbf-second-shrink-simulation-report-v1"'),
  anchor: secondShrinkReport.includes('"anchorBossId": 9'),
  savedCircle: secondShrinkReport.includes('"startCircleSource": "saved-first-shrink-simulation"')
    && secondShrinkReport.includes('"firstShrinkCircleModelKey": "4:3:1"'),
  deadline: secondShrinkReport.includes('"simulationDeadline": 45'),
}, {
  kind: 'second',
  center: { x: 50, y: 50 },
  miasmaIds: [2],
  heading: true,
  schema: true,
  anchor: true,
  savedCircle: true,
  deadline: true,
});
const sharedPatternSimulation = routePlanner.simulateFirstShrinkArea({
  mapId: 99,
  miasma: {
    active: true, level: 1, status: 2, step: 100,
    basePatternId: 1, patternId: 1,
  },
  nodes: [
    { id: 1, type: 0, x: 0, y: 0, adjacentIds: [] },
    { id: 2, type: 0, x: 1000, y: 1000, adjacentIds: [] },
  ],
});
expect('base pattern 1 / pattern 1 restores the map-independent shared model', {
  modelKey: sharedPatternSimulation.modelKey,
  finalCenter: sharedPatternSimulation.finalCenter,
  currentRadius: sharedPatternSimulation.currentRadius,
  finalRadius: sharedPatternSimulation.finalRadius,
}, {
  modelKey: '*:1:1',
  finalCenter: { x: 843, y: 629 },
  currentRadius: 650,
  finalRadius: 650,
});
const valuePlan = routePlanner.planRoute(routeFixture, { maxHops: 4, maxSteps: 5 });
const completedFirstShrinkOuterSweepPlan = routePlanner.planRoute({
  currentNodeId: 68,
  totalTurn: 32,
  currency: 304,
  dayOneBossDefeated: false,
  miasma: {
    active: true,
    level: 1,
    status: 2,
    step: 100,
    circleCenterX: 1912,
    circleCenterY: 673,
    circleRadius: 670,
  },
  nodes: [
    { id: 68, type: 0, x: 1428, y: 400, adjacentIds: [69, 58], isVisited: true },
    { id: 58, type: 5, x: 1256, y: 578, adjacentIds: [68, 70] },
    { id: 69, type: 5, x: 1438, y: 543, adjacentIds: [68, 70, 2] },
    { id: 70, type: 8, x: 1362, y: 658, adjacentIds: [58, 59, 69] },
    { id: 59, type: 5, x: 1238, y: 732, adjacentIds: [70, 71] },
    { id: 71, type: 0, x: 1405, y: 783, adjacentIds: [59] },
    { id: 2, type: 0, x: 1604, y: 580, adjacentIds: [69, 73], isVisited: true },
    { id: 73, type: 5, x: 1552, y: 448, adjacentIds: [2] },
  ],
}, { maxSteps: 5 });
expect('completed first shrink sweeps an equal-value cycle from the outer node inward', {
  firstStep: completedFirstShrinkOuterSweepPlan.path[1],
  outerDistance: Math.round(Math.hypot(1256 - 1912, 578 - 673)),
  innerDistance: Math.round(Math.hypot(1438 - 1912, 543 - 673)),
}, {
  firstStep: 58,
  outerDistance: 663,
  innerDistance: 492,
});
expect('route node visuals use requested emoji and semantic color keys', [
  routePlanner.nodeVisual({ type: 2 }),
  routePlanner.nodeVisual({ type: 3 }),
  routePlanner.nodeVisual({ type: 11 }),
  routePlanner.nodeVisual({ type: 4 }),
  routePlanner.nodeVisual({ type: 1 }),
  routePlanner.nodeVisual({ type: 7 }),
  routePlanner.nodeVisual({ type: 8 }),
  routePlanner.nodeVisual({ type: 10, specialType: 2 }),
  routePlanner.nodeVisual({ type: 10, specialType: 1 }),
  routePlanner.nodeVisual({ type: 10, specialType: 8 }),
  routePlanner.nodeVisual({ type: 10, specialType: 6 }),
  routePlanner.nodeVisual({ type: 10, specialType: 14 }),
].map(item => [item.icon, item.key]), [
  ['⚔️', 'battle'], ['🐺', 'strong'], ['🦁', 'super-strong'], ['🐉', 'ruler'],
  ['🐉', 'boss'], ['💊', 'heal'], ['💰', 'shop'], ['🎭', 'fanatic'], ['👹', 'cult-leader'], ['📄', 'researcher'],
  ['🏰', 'floating-castle'], ['❓', 'special-event'],
]);
expect('recommended step number colors follow their route node kinds', {
  semanticClass: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('route-step route-kind-${visual.key}'),
  battle: sidepanelCss.includes('.route-step.route-kind-battle { --route-step-color: #b91c1c; }'),
  shop: sidepanelCss.includes('.route-step.route-kind-shop { --route-step-color: #78350f; }'),
  warp: sidepanelCss.includes('.route-step.route-kind-warp { --route-step-color: #38bdf8;'),
}, { semanticClass: true, battle: true, shop: true, warp: true });
expect('shop nodes use the money-bag emoji without stacked-coin spacing', {
  icon: routePlanner.nodeVisual({ type: 8 }).icon,
  singleIconStyle: sidepanelCss.includes('.route-node.route-kind-shop text { font-size: 14px; }'),
  stackedCoinSpacing: sidepanelCss.includes('letter-spacing: -6px;'),
}, { icon: '💰', singleIconStyle: true, stackedCoinSpacing: false });
expect('declining a warp relabels the warp step instead of appending a separate decision row', {
  inlineLabel: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("'🚫転移（転移しない）'"),
  currentWarpEntry: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("stayAtWarp: true"),
  oldSeparateLabelRemoved: !fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("'💎 転送しない'"),
  oldModeSuffixRemoved: !fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("? ' / 転送しない'"),
  declinedWarpStyle: sidepanelCss.includes(
    '.route-step.route-kind-warp.stay-at-warp { --route-step-color: #ef4444;',
  ),
}, {
  inlineLabel: true,
  currentWarpEntry: true,
  oldSeparateLabelRemoved: true,
  oldModeSuffixRemoved: true,
  declinedWarpStyle: true,
});
expect('recommended route highlights use crisp outlines without glow filters', {
  nodeOutline: sidepanelCss.includes('.route-node.recommended .route-node-shape { stroke: #fbbf24; stroke-width: 5;'),
  edgeOutline: sidepanelCss.includes('.route-edge.recommended { stroke: #fbbf24; stroke-width: 5; }'),
  recommendedGlow: /\.route-node\.recommended[^}]*drop-shadow/.test(sidepanelCss),
  edgeGlow: /\.route-edge\.recommended[^}]*drop-shadow/.test(sidepanelCss),
}, { nodeOutline: true, edgeOutline: true, recommendedGlow: false, edgeGlow: false });
expect('route planner avoids an optional dead-end turnback even when it contains treasure', valuePlan.path[1], 3);
const detourEfficiencyPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 10,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 5, adjacentIds: [1, 5] },
    { id: 3, type: 7, adjacentIds: [1, 4] },
    { id: 4, type: 6, adjacentIds: [3, 7] },
    { id: 5, type: 7, adjacentIds: [2, 6] },
    { id: 6, type: 7, adjacentIds: [5, 7] },
    { id: 7, type: 7, adjacentIds: [6, 4] },
  ],
}, { maxSteps: 6 });
expect('a distant optional event does not justify a long detour to the same treasure',
  detourEfficiencyPlan.path.slice(0, 3), [1, 3, 4]);
const urgentDeadlineNodes = [
  { id: 1, type: 0, x: 0, y: 0, adjacentIds: [2], isVisited: true },
  { id: 2, type: 0, x: 100, y: 0, adjacentIds: [1, 3, 4], isVisited: true },
  { id: 3, type: 5, x: 500, y: 0, adjacentIds: [2] },
  { id: 4, type: 0, x: 600, y: 0, adjacentIds: [2, 5], isVisited: true },
  { id: 5, type: 2, x: 900, y: 0, adjacentIds: [4, 6] },
  { id: 6, type: 5, x: 700, y: 0, adjacentIds: [5] },
  ...Array.from({ length: 4 }, (_, index) => ({
    id: 100 + index,
    type: 0,
    x: 2000 - index * 50,
    y: 1000,
    adjacentIds: [],
    isVisited: true,
  })),
];
const urgentDeadlinePlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 10,
  currency: 0,
  partyMembers: [{ hp: 100000, maxHp: 100000 }],
  miasma: {
    active: true, level: 1, status: 1, remainTurn: 20,
    centerX: 0, centerY: 0, circleRadius: 200,
  },
  nodes: urgentDeadlineNodes,
}, { maxSteps: 10, beamWidth: 80 });
expect('first-shrink route services the earlier expiring battle before a later dead-end event', {
  path: urgentDeadlinePlan.path,
  battleDeadline: urgentDeadlinePlan.deadlines.get(5),
  laterEventDeadline: urgentDeadlinePlan.deadlines.get(3),
  battleCompletion: urgentDeadlinePlan.routeTimeline
    .find(step => step.nodeId === 5)?.departureTurn,
  missedDeadlineSteps: urgentDeadlinePlan.routeTimeline
    .filter(step => !step.completesBeforeDeadline).map(step => step.nodeId),
}, {
  path: [1, 2, 4, 5, 6, 5, 4, 2, 3],
  battleDeadline: 21,
  laterEventDeadline: 28,
  battleCompletion: 14,
  missedDeadlineSteps: [],
});
const leadingBlankShrinkPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 10,
  currency: 0,
  partyMembers: [{ hp: 100000, maxHp: 100000 }],
  miasma: {
    active: true, level: 1, status: 1, step: 5, remainTurn: 19,
    basePatternId: 1, patternId: 1,
    centerX: 843, centerY: 629, circleRadius: 650,
  },
  nodes: [
    { id: 1, type: 0, x: 843, y: 629, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 5, x: 830, y: 620, adjacentIds: [1] },
    { id: 3, type: 0, x: 850, y: 630, adjacentIds: [1, 6], isVisited: true },
    { id: 6, type: 0, x: 900, y: 630, adjacentIds: [3, 7], isVisited: true },
    { id: 7, type: 0, x: 1000, y: 630, adjacentIds: [6, 8], isVisited: true },
    { id: 8, type: 0, x: 1200, y: 630, adjacentIds: [7, 4] },
    { id: 4, type: 5, x: 1570, y: 700, adjacentIds: [8] },
    ...[2100, 2000, 1900, 1800].map((x, index) => ({
      id: 100 + index, type: 0, x, y: 1000, adjacentIds: [], isVisited: true,
    })),
  ],
}, { maxSteps: 5, beamWidth: 80 });
expect('first shrink does not cross four blank steps before collecting an adjacent value node', {
  firstStep: leadingBlankShrinkPlan.path[1],
  firstStepType: leadingBlankShrinkPlan.graph.byId.get(leadingBlankShrinkPlan.path[1])?.type,
  outerEventDeadline: leadingBlankShrinkPlan.deadlines.get(4),
}, {
  firstStep: 2,
  firstStepType: 5,
  outerEventDeadline: 26,
});
const routePlanReport = uiContext.createRoutePlanReport(urgentDeadlinePlan);
expect('route Codex report contains all node connections, selected path, and arrival deadlines', {
  schema: routePlanReport.includes('"schema": "gbf-route-plan-report-v1"'),
  path: routePlanReport.includes('"path": ['),
  timeline: routePlanReport.includes('"arrivalTurn": 13')
    && routePlanReport.includes('"deadline": 21'),
  physicalConnections: routePlanReport.includes('"physicalAdjacentIds": ['),
  effectiveConnections: routePlanReport.includes('"effectiveAdjacentIds": ['),
  repeats: routePlanReport.includes('"repeatedNodeIds": ['),
  turnbacks: routePlanReport.includes('"immediateTurnbacks": ['),
}, {
  schema: true,
  path: true,
  timeline: true,
  physicalConnections: true,
  effectiveConnections: true,
  repeats: true,
  turnbacks: true,
});
const emptyAvoidanceFixture = {
  currentNodeId: 1,
  totalTurn: 10,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 4], isVisited: true },
    { id: 2, type: 0, adjacentIds: [1, 3], isVisited: true },
    { id: 3, type: 5, adjacentIds: [2] },
    { id: 4, type: 5, adjacentIds: [1] },
  ],
};
const emptyAvoidancePlan = routePlanner.planRoute(emptyAvoidanceFixture, { maxSteps: 3 });
expect('empty-node avoidance outranks an otherwise smoother non-turnback path', {
  firstStep: emptyAvoidancePlan.path[1],
  emptyCount: emptyAvoidancePlan.path.slice(1)
    .filter(id => emptyAvoidancePlan.graph.byId.get(id)?.type === 0).length,
}, { firstStep: 4, emptyCount: 0 });
const exhaustedShopLoopPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 73,
  currency: 1070,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 4, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 8, adjacentIds: [1, 4] },
    { id: 3, type: 0, adjacentIds: [1, 4, 5], isVisited: true },
    { id: 4, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 5, type: 6, adjacentIds: [3, 6] },
    { id: 6, type: 2, adjacentIds: [5] },
  ],
}, { maxSteps: 4 });
expect('an isolated shop in a cleared loop loses to a nearby continuing reward cluster', {
  firstStep: exhaustedShopLoopPlan.path[1],
  reachesTreasure: exhaustedShopLoopPlan.path.includes(5),
  entersIsolatedShop: exhaustedShopLoopPlan.path.includes(2),
}, { firstStep: 3, reachesTreasure: true, entersIsolatedShop: false });
const firstDayDangerAsEmptyPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 12,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 4], isVisited: true },
    { id: 2, type: 3, adjacentIds: [1, 3] },
    { id: 3, type: 8, adjacentIds: [2, 7] },
    { id: 4, type: 0, adjacentIds: [1, 5] },
    { id: 5, type: 5, adjacentIds: [4, 6] },
    { id: 6, type: 5, adjacentIds: [5, 7] },
    { id: 7, type: 7, adjacentIds: [3, 6] },
  ],
}, { maxSteps: 3 });
expect('first-day strong enemies equal one blank, allowing a continuous event branch to win',
  firstDayDangerAsEmptyPlan.path.slice(0, 4), [1, 4, 5, 6]);
const dangerPhasePlan = (totalTurn, miasma, dayOneBossDefeated = false) => routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn,
  dayOneBossDefeated,
  currency: 0,
  miasma,
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 3, adjacentIds: [1] },
    { id: 3, type: 2, adjacentIds: [1] },
  ],
}, { maxSteps: 1 }).path[1];
expect('strong-enemy value rises from empty, to below battle, to above battle by phase', {
  firstDay: dangerPhasePlan(20, { active: false }),
  delayedFirstDay: dangerPhasePlan(70, {
    active: true, level: 1, status: 1, remainTurn: 7,
  }),
  dayTwoEarly: dangerPhasePlan(55, { active: false }, true),
  dayTwoShrink: dangerPhasePlan(59, {
    active: true, level: 1, status: 1, remainTurn: 20,
  }, true),
}, {
  firstDay: 3,
  delayedFirstDay: 3,
  dayTwoEarly: 3,
  dayTwoShrink: 2,
});
const firstDayRulerCorePlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 22,
  dayOneBossDefeated: false,
  partyMembers: [{ hp: 100000, maxHp: 100000 }],
  miasma: { active: true, level: 1, status: 1, remainTurn: 10 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 4], isVisited: true, isShrinking: true },
    { id: 2, type: 0, adjacentIds: [1, 3], isShrinking: true },
    { id: 3, type: 4, adjacentIds: [2] },
    { id: 4, type: 0, adjacentIds: [1, 5], isShrinking: true },
    { id: 5, type: 0, adjacentIds: [4, 6], isShrinking: true },
    { id: 6, type: 0, adjacentIds: [5] },
  ],
}, { maxSteps: 3 });
expect('turn-22 first-shrink evacuation never uses an unvisited ruler as its safe endpoint', {
  phase: routePlanner.dangerPhase(firstDayRulerCorePlan.state),
  path: firstDayRulerCorePlan.path,
  endsAtRuler: firstDayRulerCorePlan.graph.byId.get(
    firstDayRulerCorePlan.path.at(-1),
  )?.type === 4,
}, {
  phase: 'first-day',
  path: [1, 4, 5, 6],
  endsAtRuler: false,
});
const zeroCurrencyShopPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 12,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true },
    { id: 2, type: 3, adjacentIds: [1, 3] },
    { id: 3, type: 8, adjacentIds: [2] },
  ],
}, { maxSteps: 3 });
const fundedShopPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 12,
  currency: 500,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true },
    { id: 2, type: 8, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
expect('an unfunded danger-to-shop route stays put while a funded shop has value', {
  zeroCurrencyPath: zeroCurrencyShopPlan.path,
  zeroCurrencyMode: zeroCurrencyShopPlan.mode,
  zeroCurrencyWarning: zeroCurrencyShopPlan.warning,
  fundedShopPath: fundedShopPlan.path,
}, {
  zeroCurrencyPath: [1],
  zeroCurrencyMode: 'blocked',
  zeroCurrencyWarning: '既知の安全・価値制約を満たす移動先がありません',
  fundedShopPath: [1, 2],
});
const expectedCurrencyShop = currency => routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 12,
  currency,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true },
    { id: 2, type: 2, adjacentIds: [1, 3] },
    { id: 3, type: 8, adjacentIds: [2] },
  ],
}, { maxSteps: 2 }).path;
expect('shop value activates from expected battle currency exactly at 500', {
  reaches499: expectedCurrencyShop(439),
  reaches500: expectedCurrencyShop(440),
}, { reaches499: [1, 2], reaches500: [1, 2, 3] });
const cornerTrapPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 50,
  dayOneBossDefeated: true,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 4], isVisited: true },
    { id: 2, type: 5, adjacentIds: [1, 3] },
    { id: 3, type: 2, adjacentIds: [2] },
    { id: 4, type: 0, adjacentIds: [1, 5], isVisited: true },
    { id: 5, type: 5, adjacentIds: [4, 6] },
    { id: 6, type: 2, adjacentIds: [5, 7] },
    { id: 7, type: 0, adjacentIds: [6, 1], isVisited: true },
  ],
}, { maxSteps: 5 });
expect('late-phase value density beats a blank-heavy continuation even when the value branch retraces', {
  entersCorner: cornerTrapPlan.path[1] === 2,
  firstStepIsBlank: cornerTrapPlan.graph.byId.get(cornerTrapPlan.path[1])?.type === 0,
  cornerEdgeIsBridge: routePlanner.isBridgeEdge(cornerTrapPlan.graph, 1, 2),
  continuingEdgeIsBridge: routePlanner.isBridgeEdge(cornerTrapPlan.graph, 1, 4),
}, {
  entersCorner: true, firstStepIsBlank: false,
  cornerEdgeIsBridge: true, continuingEdgeIsBridge: false,
});
const processedReturnState = routePlanner.normalizeState({
  currentNodeId: 3,
  totalTurn: 50,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true },
    { id: 2, type: 5, adjacentIds: [1, 3] },
    { id: 3, type: 2, adjacentIds: [2] },
  ],
});
const processedReturnGraph = routePlanner.buildGraph(processedReturnState.nodes);
const processedReturnAssessment = routePlanner.evacuationAssessment(
  processedReturnGraph,
  3,
  new Map([[1, Infinity], [2, Infinity], [3, Infinity]]),
  50,
  new Set([1]),
  [1, 2, 3],
  processedReturnState,
  0,
  new Set([1, 2, 3]),
);
expect('returning through an already processed event counts movement only', {
  distance: processedReturnAssessment.distance,
  path: processedReturnAssessment.path,
}, { distance: 2, path: [3, 2, 1] });
const oneMiasmaValuePlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 20,
  partyMembers: [{ hp: 100, maxHp: 100 }],
  miasma: { active: true, level: 1, status: 1, remainTurn: 10 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 5, 7], isVisited: true },
    { id: 2, type: 0, adjacentIds: [1, 3], isShrinking: true },
    { id: 3, type: 5, adjacentIds: [2, 4] },
    { id: 4, type: 2, adjacentIds: [3] },
    { id: 5, type: 0, adjacentIds: [1, 6], isVisited: true },
    { id: 6, type: 0, adjacentIds: [5, 7], isVisited: true },
    { id: 7, type: 0, adjacentIds: [6, 1], isVisited: true },
  ],
}, { maxSteps: 4 });
expect('one miasma exposure is accepted when it unlocks several value nodes over an empty escape route', {
  firstStep: oneMiasmaValuePlan.path[1],
  exposureCount: oneMiasmaValuePlan.miasmaExposureCount,
  reachesValues: oneMiasmaValuePlan.path.filter(id => [3, 4].includes(id)).length,
}, { firstStep: 2, exposureCount: 1, reachesValues: 2 });
const firstShrinkOuterPriorityPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 9,
  partyMembers: [{ hp: 100, maxHp: 100 }],
  miasma: {
    active: true, level: 1, status: 1, remainTurn: 20,
    centerX: 0, centerY: 0, circleRadius: 50,
  },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 4], isVisited: true, x: 0, y: 0 },
    { id: 2, type: 5, adjacentIds: [1, 3], x: 100, y: 0 },
    { id: 3, type: 2, adjacentIds: [2, 6], x: 110, y: 0 },
    { id: 4, type: 6, adjacentIds: [1, 5], x: 10, y: 0 },
    { id: 5, type: 2, adjacentIds: [4, 6], x: 20, y: 0 },
    { id: 6, type: 7, adjacentIds: [3, 5], x: 30, y: 0 },
  ],
}, { maxSteps: 5 });
expect('first-shrink start prioritizes future-expiring outer value over an inner value chain', {
  mode: firstShrinkOuterPriorityPlan.mode,
  firstStep: firstShrinkOuterPriorityPlan.path[1],
  outerDeadlineFinite: Number.isFinite(firstShrinkOuterPriorityPlan.deadlines.get(2)),
  innerDeadlineInfinite: firstShrinkOuterPriorityPlan.deadlines.get(4),
}, {
  mode: 'first-shrink-outer',
  firstStep: 2,
  outerDeadlineFinite: true,
  innerDeadlineInfinite: Infinity,
});
const firstShrinkTurnBufferPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 9,
  partyMembers: [{ hp: 100, maxHp: 100 }],
  miasma: { active: true, level: 1, status: 1, remainTurn: 8 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true, isShrinking: true },
    { id: 2, type: 5, adjacentIds: [1, 3, 4], isShrinking: true },
    { id: 3, type: 0, adjacentIds: [1, 2, 4], isVisited: true },
    { id: 4, type: 2, adjacentIds: [2, 3], isShrinking: true },
  ],
}, { maxSteps: 4 });
expect('first-shrink routes include event/combat processing time and preserve five turns for evacuation', {
  firstStep: firstShrinkTurnBufferPlan.path[1],
  entersLateBattle: firstShrinkTurnBufferPlan.path.includes(4),
  eventMoveAndProcessingTurns: firstShrinkTurnBufferPlan.estimatedRouteTurns,
  eventMiasmaExposures: firstShrinkTurnBufferPlan.miasmaExposureCount,
  reserveTurns: firstShrinkTurnBufferPlan.firstShrinkSafeArrivalBufferTurns,
}, {
  firstStep: 2,
  entersLateBattle: false,
  eventMoveAndProcessingTurns: 2,
  eventMiasmaExposures: 2,
  reserveTurns: 5,
});
const healOverEmptyPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 10,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 0, adjacentIds: [1] },
    { id: 3, type: 7, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
expect('healing nodes are not treated as empty nodes', healOverEmptyPlan.path[1], 3);
const radiusFixture = {
  currentNodeId: 1,
  totalTurn: 10,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], x: 0, y: 0 },
    { id: 2, type: 0, adjacentIds: [1, 3], x: 40, y: 0 },
    { id: 3, type: 0, adjacentIds: [2, 4], x: 80, y: 0 },
    { id: 4, type: 0, adjacentIds: [3, 5], x: 80, y: 40 },
    { id: 5, type: 0, adjacentIds: [4, 6], x: 40, y: 40 },
    { id: 6, type: 5, adjacentIds: [5, 7], x: 0, y: 40 },
    { id: 7, type: 5, adjacentIds: [6], x: 300, y: 0 },
  ],
};
const radiusPlan = routePlanner.planRoute(radiusFixture, { localRadius: 120, maxSteps: 2 });
expect('coordinate radius includes dense fifth-hop nodes and excludes physically distant nodes', {
  denseFifthHop: radiusPlan.localDistances.has(6),
  distantSixthHop: radiusPlan.localDistances.has(7),
  radius: radiusPlan.localRadius,
}, { denseFifthHop: true, distantSixthHop: false, radius: 120 });
const disconnectedRadiusPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 10,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 4], x: 0, y: 0 },
    { id: 2, type: 0, adjacentIds: [1, 3], x: 300, y: 0 },
    { id: 3, type: 5, adjacentIds: [2], x: 50, y: 0 },
    { id: 4, type: 5, adjacentIds: [1], x: 0, y: 80 },
  ],
}, { localRadius: 120, maxSteps: 2 });
expect('in-radius nodes reached only through an out-of-radius bridge stay hidden', {
  current: disconnectedRadiusPlan.localDistances.has(1),
  directlyReachable: disconnectedRadiusPlan.localDistances.has(4),
  remoteIsland: disconnectedRadiusPlan.localDistances.has(3),
  outsideBridge: disconnectedRadiusPlan.localDistances.has(2),
}, { current: true, directlyReachable: true, remoteIsland: false, outsideBridge: false });
const bossPlan = routePlanner.planRoute({
  ...routeFixture,
  firstShrinkFinalCircle: {
    center: { x: 20, y: 0 }, radius: 30,
    mapId: null, basePatternId: null, patternId: null, dayIndex: 1,
    source: 'saved-first-shrink-simulation',
  },
  miasma: { active: true, level: 2, status: 3, remainTurn: 20, bossNodeId: 4 },
}, { maxHops: 4 });
expect('spawned boss rejects an outer treasure that the second-shrink simulation consumes first', {
  mode: bossPlan.mode,
  path: bossPlan.path,
}, { mode: 'boss', path: [1, 3, 4] });
expect('second-shrink simulation uses the spawned boss as a fixed scaling anchor', {
  source: bossPlan.secondShrinkSimulation?.source,
  anchor: bossPlan.secondShrinkSimulation?.anchorBossId,
  center: bossPlan.secondShrinkSimulation?.center,
  outerDeadline: bossPlan.deadlines.get(2),
  innerDeadline: bossPlan.deadlines.get(3),
  bossDeadline: bossPlan.deadlines.get(4),
  shrinkOrder: bossPlan.secondShrinkSimulation?.predictedShrinkOrder,
}, {
  source: 'boss-anchor-scaled-circle-contraction',
  anchor: 4,
  center: { x: 20, y: 0 },
  outerDeadline: 11,
  innerDeadline: 24,
  bossDeadline: Infinity,
  shrinkOrder: [2, 7, 1, 6, 3, 5],
});
const offsetBossAnchorSimulation = routePlanner.simulateSecondShrinkArea({
  currentNodeId: 1,
  totalTurn: 10,
  firstShrinkFinalCircle: {
    center: { x: 0, y: 0 }, radius: 50, dayIndex: 1,
    source: 'saved-first-shrink-simulation',
  },
  miasma: {
    active: true, level: 2, status: 3, remainTurn: 10, step: 50,
    bossNodeId: 4, centerX: 999, centerY: 999, circleRadius: 5,
  },
  nodes: [
    { id: 1, type: 0, adjacentIds: [4], x: 0, y: 0 },
    { id: 4, type: 1, adjacentIds: [1, 5], x: 20, y: 0 },
    { id: 5, type: 0, adjacentIds: [4], x: 40, y: 0 },
  ],
});
expect('second-shrink coordinate circle scales about an off-center boss anchor', {
  startCenter: offsetBossAnchorSimulation.startCenter,
  currentCenter: offsetBossAnchorSimulation.currentCenter,
  finalCenter: offsetBossAnchorSimulation.finalCenter,
  radii: [
    offsetBossAnchorSimulation.startRadius,
    offsetBossAnchorSimulation.currentRadius,
    offsetBossAnchorSimulation.finalRadius,
  ],
  progress: offsetBossAnchorSimulation.progress,
  progressSource: offsetBossAnchorSimulation.progressSource,
  durationTurns: offsetBossAnchorSimulation.durationTurns,
  remainingScale: offsetBossAnchorSimulation.remainingScale,
  bossRadiusPosition: offsetBossAnchorSimulation.bossRadiusPosition,
  startCircleSource: offsetBossAnchorSimulation.startCircleSource,
}, {
  startCenter: { x: 0, y: 0 },
  currentCenter: { x: 10, y: 0 },
  finalCenter: { x: 20, y: 0 },
  radii: [50, 25, 0],
  progress: 0.5,
  progressSource: 'remain-turn',
  durationTurns: 20,
  remainingScale: 0.5,
  bossRadiusPosition: 0.4,
  startCircleSource: 'saved-first-shrink-simulation',
});
const retainedFirstShrinkStepSimulation = routePlanner.simulateSecondShrinkArea({
  currentNodeId: 1,
  totalTurn: 10,
  firstShrinkFinalCircle: {
    center: { x: 0, y: 0 }, radius: 80, dayIndex: 1,
    source: 'saved-first-shrink-simulation',
  },
  miasma: {
    active: true, level: 2, status: 3, remainTurn: 15, step: 100,
    bossNodeId: 4, centerX: 0, centerY: 0, circleRadius: 80,
  },
  nodes: [
    { id: 1, type: 0, adjacentIds: [4], x: 0, y: 0 },
    { id: 4, type: 1, adjacentIds: [1, 5], x: 40, y: 0 },
    { id: 5, type: 0, adjacentIds: [4], x: 80, y: 0 },
  ],
});
expect('second-shrink progress ignores the retained first-shrink step and follows countdown', {
  progress: retainedFirstShrinkStepSimulation.progress,
  center: retainedFirstShrinkStepSimulation.currentCenter,
  radius: retainedFirstShrinkStepSimulation.currentRadius,
}, {
  progress: 0.25,
  center: { x: 10, y: 0 },
  radius: 60,
});
const missingSavedCircleSimulation = routePlanner.simulateSecondShrinkArea({
  currentNodeId: 1,
  totalTurn: 10,
  miasma: {
    active: true, level: 2, status: 3, remainTurn: 10,
    bossNodeId: 4, centerX: 0, centerY: 0, circleRadius: 80,
  },
  nodes: [
    { id: 1, type: 0, adjacentIds: [4], x: 0, y: 0 },
    { id: 4, type: 1, adjacentIds: [1, 5], x: 40, y: 0 },
    { id: 5, type: 0, adjacentIds: [4], x: 80, y: 0 },
  ],
});
expect('second shrink never rebuilds a coordinate circle when the saved first circle is missing', {
  source: missingSavedCircleSimulation.source,
  startCenter: missingSavedCircleSimulation.startCenter,
  currentCenter: missingSavedCircleSimulation.currentCenter,
}, {
  source: 'boss-anchor-hop-contraction',
  startCenter: null,
  currentCenter: null,
});
const observedBoundaryResumeSimulation = routePlanner.simulateSecondShrinkArea({
  currentNodeId: 2,
  totalTurn: 30,
  miasma: {
    active: true, level: 2, status: 3, remainTurn: 10,
    bossNodeId: 3, centerX: 0, centerY: 0,
  },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], x: 0, y: 0 },
    { id: 2, type: 0, adjacentIds: [1, 3], x: 20, y: 0 },
    { id: 3, type: 1, adjacentIds: [2, 4], x: 40, y: 0 },
    { id: 4, type: 0, adjacentIds: [3, 5], x: 80, y: 0, isShrinking: true },
    { id: 5, type: 0, adjacentIds: [4], x: 100, y: 0, isShrinking: true },
  ],
});
expect('missing first-shrink circle is reconstructed from safe and miasma nodes', {
  source: observedBoundaryResumeSimulation.source,
  progressSource: observedBoundaryResumeSimulation.progressSource,
  center: observedBoundaryResumeSimulation.currentCenter,
  radius: observedBoundaryResumeSimulation.currentRadius,
  inferred: observedBoundaryResumeSimulation.inferredCircle,
  bossDeadline: observedBoundaryResumeSimulation.nodeDeadlines[3],
}, {
  source: 'boss-anchor-observed-boundary-resume',
  progressSource: 'observed-node-boundary-resume',
  center: { x: 0, y: 0 },
  radius: 60,
  inferred: {
    center: { x: 0, y: 0 },
    radius: 60,
    mismatches: 0,
    margin: 40,
    safeNodeCount: 3,
    miasmaNodeCount: 2,
  },
  bossDeadline: null,
});
const bossObservedBeforeStatusSimulation = routePlanner.simulateSecondShrinkArea({
  currentNodeId: 1,
  totalTurn: 20,
  firstShrinkFinalCircle: {
    center: { x: 0, y: 0 }, radius: 80, dayIndex: 1,
    source: 'saved-first-shrink-simulation',
  },
  miasma: { active: true, level: 1, status: 2, bossNodeId: 4 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [4], x: 0, y: 0 },
    { id: 4, type: 1, adjacentIds: [1], x: 40, y: 0 },
  ],
});
expect('boss coordinates start the simulation before second-shrink status is updated', {
  anchor: bossObservedBeforeStatusSimulation.anchorBossId,
  remainTurn: bossObservedBeforeStatusSimulation.remainTurn,
  progressSource: bossObservedBeforeStatusSimulation.progressSource,
  radius: bossObservedBeforeStatusSimulation.currentRadius,
}, {
  anchor: 4,
  remainTurn: 20,
  progressSource: 'boss-observed-default-duration',
  radius: 80,
});
const secondShrinkDetourFixture = {
  currentNodeId: 1,
  totalTurn: 40,
  miasma: { active: true, level: 2, status: 3, remainTurn: 12, bossNodeId: 6 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 5], isVisited: true },
    { id: 2, type: 5, adjacentIds: [1, 3] },
    { id: 3, type: 2, adjacentIds: [2] },
    { id: 5, type: 0, adjacentIds: [1, 6], isVisited: true },
    { id: 6, type: 1, adjacentIds: [5] },
  ],
};
const secondShrinkDetourPlan = routePlanner.planRoute(secondShrinkDetourFixture, {
  maxBossDetourSteps: 6,
});
expect('second shrink counts event/combat processing turns and limits the out-and-back detour', {
  mode: secondShrinkDetourPlan.mode,
  path: secondShrinkDetourPlan.path,
  revisitsJunction: secondShrinkDetourPlan.path.filter(id => id === 1).length,
  arrivalRemaining: secondShrinkDetourPlan.bossArrivalRemainingTurns,
}, {
  mode: 'boss-detour', path: [1, 2, 1, 5, 6], revisitsJunction: 2,
  arrivalRemaining: 7,
});
expect('second-shrink simulation falls back to graph distance when node coordinates are unavailable', {
  source: secondShrinkDetourPlan.secondShrinkSimulation?.source,
  anchor: secondShrinkDetourPlan.secondShrinkSimulation?.anchorBossId,
  branchDeadline: secondShrinkDetourPlan.deadlines.get(3),
  approachDeadline: secondShrinkDetourPlan.deadlines.get(5),
  bossDeadline: secondShrinkDetourPlan.deadlines.get(6),
}, {
  source: 'boss-anchor-hop-contraction',
  anchor: 6,
  branchDeadline: 41,
  approachDeadline: 49,
  bossDeadline: Infinity,
});
const urgentSecondShrinkPlan = routePlanner.planRoute({
  ...secondShrinkDetourFixture,
  miasma: { ...secondShrinkDetourFixture.miasma, remainTurn: 8 },
}, { maxBossDetourSteps: 6 });
expect('second shrink switches to the direct boss route to preserve five fight turns', {
  mode: urgentSecondShrinkPlan.mode,
  path: urgentSecondShrinkPlan.path,
  arrivalRemaining: urgentSecondShrinkPlan.bossArrivalRemainingTurns,
}, { mode: 'boss', path: [1, 5, 6], arrivalRemaining: 6 });
const lateSecondShrinkPlan = routePlanner.planRoute({
  ...secondShrinkDetourFixture,
  miasma: { ...secondShrinkDetourFixture.miasma, remainTurn: 6 },
}, { maxBossDetourSteps: 6 });
expect('an unavoidable late boss arrival uses the direct route and reports the reduced margin', {
  mode: lateSecondShrinkPlan.mode,
  path: lateSecondShrinkPlan.path,
  arrivalRemaining: lateSecondShrinkPlan.bossArrivalRemainingTurns,
  warning: lateSecondShrinkPlan.warning,
}, {
  mode: 'boss',
  path: [1, 5, 6],
  arrivalRemaining: 4,
  warning: '最短経路でもボス到着時の収縮余力は4ターンです',
});
const defeatedDayOneBossPlan = routePlanner.planRoute({
  currentNodeId: 3,
  totalTurn: 28,
  miasma: { active: true, level: 2, status: 3, remainTurn: 18, bossNodeId: 4 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true },
    { id: 2, type: 0, adjacentIds: [1, 3], isVisited: true },
    { id: 3, type: 0, adjacentIds: [2, 4, 5], isVisited: true },
    { id: 4, type: 1, adjacentIds: [3], isVisited: true },
    { id: 5, type: 5, adjacentIds: [3, 6] },
    { id: 6, type: 2, adjacentIds: [5] },
  ],
}, { maxSteps: 3 });
expect('a completed first-day boss leaves boss mode and avoids its consumed approach route', {
  mode: defeatedDayOneBossPlan.mode,
  firstStep: defeatedDayOneBossPlan.path[1],
  returnsTowardBoss: defeatedDayOneBossPlan.path.includes(4),
  returnsThroughPassedRoute: defeatedDayOneBossPlan.path.includes(2),
}, {
  mode: 'value', firstStep: 5,
  returnsTowardBoss: false, returnsThroughPassedRoute: false,
});
context.updateRouteRuntimeState(82, {
  url: '/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    map_id: 23,
    current_node_id: 4,
    total_turn: 49,
    node_list: [
      { node_id: 3, node_type: 0, adjacent_node_ids: [4, 5], is_visited: true },
      { node_id: 4, node_type: 1, adjacent_node_ids: [3], is_visited: false },
      { node_id: 5, node_type: 5, adjacent_node_ids: [3], is_visited: false },
    ],
    miasma_info: { after: { is_miasmic: true, level: 2, status: 3 } },
  } } },
});
context.updateRouteRuntimeState(82, {
  url: '/rest/arcarum3/dungeon/finish_node_event',
  responseData: { is_visited_node: true, total_turn: 50 },
});
const completedBossRuntime = vm.runInContext('routeRuntimeCache.get(82)', context);
const completedBossRuntimePlan = routePlanner.planRoute({
  ...completedBossRuntime,
  miasma: { ...completedBossRuntime.miasma, active: true, level: 2, status: 3, bossNodeId: 4 },
}, { maxSteps: 3 });
expect('finish_node_event immediately marks the current boss complete before a reload', {
  visited: completedBossRuntime.nodes.find(node => node.id === 4)?.isVisited,
  mode: completedBossRuntimePlan.mode,
  returnsToBoss: completedBossRuntimePlan.path.slice(1).includes(4),
}, { visited: true, mode: 'value', returnsToBoss: false });
const blockedPlan = routePlanner.planRoute({
  ...routeFixture,
  nodes: routeFixture.nodes.map(node => node.id === 2 ? { ...node, isShrinking: true } : node),
}, { maxSteps: 2 });
expect('a safe alternative is preferred over a miasma node', blockedPlan.path.includes(2), false);
expect('miasma nodes use a dark-purple translucent overlay instead of a red dashed outline', {
  overlayElement: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes("miasmaOverlay.setAttribute('class', 'route-node-miasma-overlay')"),
  overlayAboveLabel: fs.readFileSync(path.join(root, 'sidepanel.js'), 'utf8')
    .includes('group.append(miasmaOverlay)'),
  purpleFill: sidepanelCss.includes('fill: #3b0764; fill-opacity: .72;'),
  noRedDashedNode: !sidepanelCss.includes('.route-node.miasma .route-node-shape { stroke: #fb7185;'),
  purpleLegend: sidepanelCss.includes('.route-legend i.miasma { border-color: #7e22ce;'),
}, {
  overlayElement: true, overlayAboveLabel: true, purpleFill: true,
  noRedDashedNode: true, purpleLegend: true,
});
const twoMiasmaPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 10,
  partyMembers: [{ hp: 23, maxHp: 100 }],
  miasma: { active: true, level: 1, status: 1, remainTurn: 20 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true, x: 0, y: 0 },
    { id: 2, type: 0, adjacentIds: [1, 3], isShrinking: true, x: 10, y: 0 },
    { id: 3, type: 0, adjacentIds: [2, 4], isShrinking: true, x: 20, y: 0 },
    { id: 4, type: 6, adjacentIds: [3], x: 30, y: 0 },
  ],
}, { maxSteps: 3 });
expect('miasma traversal is allowed while the lowest-HP member survives', {
  path: twoMiasmaPlan.path,
  count: twoMiasmaPlan.miasmaExposureCount,
  damage: twoMiasmaPlan.miasmaDamagePercent,
  hpBudget: twoMiasmaPlan.miasmaHealthBudgetPercent,
}, { path: [1, 2, 3, 4], count: 2, damage: 10, hpBudget: 11 });
const threeMiasmaPlan = routePlanner.planRoute({
  ...twoMiasmaPlan.state,
  nodes: twoMiasmaPlan.state.nodes.map(node => node.id === 4 ? { ...node, isShrinking: true } : node),
});
expect('a route whose miasma damage would kill the lowest-HP member remains blocked',
  threeMiasmaPlan.path.includes(4), false);
expect('miasma damage strength follows completed shrink stages', {
  firstShrinking: routePlanner.miasmaDamageRateAt(routePlanner.normalizeState({
    totalTurn: 20, miasma: { active: true, level: 1, status: 1, remainTurn: 3 },
  }), 21),
  firstCompletesBeforeArrival: routePlanner.miasmaDamageRateAt(routePlanner.normalizeState({
    totalTurn: 20, miasma: { active: true, level: 1, status: 1, remainTurn: 1 },
  }), 21),
  firstComplete: routePlanner.miasmaDamageRateAt(routePlanner.normalizeState({
    totalTurn: 20, miasma: { active: true, level: 1, status: 2 },
  }), 21),
  secondShrinking: routePlanner.miasmaDamageRateAt(routePlanner.normalizeState({
    totalTurn: 40, miasma: { active: true, level: 2, status: 1, remainTurn: 3 },
  }), 41),
  secondComplete: routePlanner.miasmaDamageRateAt(routePlanner.normalizeState({
    totalTurn: 40, miasma: { active: true, level: 2, status: 2 },
  }), 41),
}, {
  firstShrinking: 5, firstCompletesBeforeArrival: 15, firstComplete: 15,
  secondShrinking: 15, secondComplete: 15,
});
expect('miasma traversal budget is positive only during the first shrink', {
  reserve: routePlanner.SECOND_SHRINK_HP_RESERVE_PERCENT,
  absoluteFloor: routePlanner.SECOND_SHRINK_MIN_ABSOLUTE_HP,
  bossArrivalBuffer: routePlanner.SECOND_SHRINK_BOSS_ARRIVAL_BUFFER_TURNS,
  firstShrinkBudget: routePlanner.miasmaHealthBudgetPercent(routePlanner.normalizeState({
    partyMembers: [{ hp: 100000, maxHp: 100000 }],
    miasma: { active: true, level: 1, status: 1 },
  })),
  firstShrinkCompletedBudget: routePlanner.miasmaHealthBudgetPercent(routePlanner.normalizeState({
    partyMembers: [{ hp: 100000, maxHp: 100000 }],
    miasma: { active: true, level: 1, status: 2 },
  })),
  fullHpDamageBudget: routePlanner.miasmaHealthBudgetPercent(routePlanner.normalizeState({
    partyMembers: [{ hp: 100000, maxHp: 100000 }],
    miasma: { active: true, level: 2, status: 1 },
  })),
  fullLowMaxHpBudget: routePlanner.miasmaHealthBudgetPercent(routePlanner.normalizeState({
    partyMembers: [{ hp: 70000, maxHp: 70000 }],
    miasma: { active: true, level: 2, status: 1 },
  })),
  belowAbsoluteFloorBudget: routePlanner.miasmaHealthBudgetPercent(routePlanner.normalizeState({
    partyMembers: [{ hp: 59999, maxHp: 70000 }],
    miasma: { active: true, level: 2, status: 1 },
  })),
}, {
  reserve: 85,
  absoluteFloor: 60000,
  bossArrivalBuffer: 5,
  firstShrinkBudget: 99.988,
  firstShrinkCompletedBudget: 0,
  fullHpDamageBudget: 0,
  fullLowMaxHpBudget: 0,
  belowAbsoluteFloorBudget: 0,
});
const secondShrinkAbsoluteHpPlan = hp => routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 40,
  partyMembers: [{ hp, maxHp: hp }],
  miasma: { active: true, level: 2, status: 1, remainTurn: 10 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true },
    { id: 2, type: 6, adjacentIds: [1], isShrinking: true },
  ],
}, { maxSteps: 1 });
expect('second-shrink routes never touch miasma regardless of current HP', {
  seventyThousandTouchesMiasma: secondShrinkAbsoluteHpPlan(70000).path.includes(2),
  eightyThousandTouchesMiasma: secondShrinkAbsoluteHpPlan(80000).path.includes(2),
}, {
  seventyThousandTouchesMiasma: false,
  eightyThousandTouchesMiasma: false,
});
const secondShrinkAvoidancePlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 40,
  partyMembers: [{ hp: 100000, maxHp: 100000 }],
  miasma: { active: true, level: 2, status: 1, remainTurn: 10 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 6, adjacentIds: [1], isShrinking: true },
    { id: 3, type: 5, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
expect('second-shrink candidate ordering avoids miasma even when the exposed node has higher reward', {
  firstStep: secondShrinkAvoidancePlan.path[1],
  damage: secondShrinkAvoidancePlan.miasmaDamagePercent,
}, { firstStep: 3, damage: 0 });
const specialEventFixture = {
  currentNodeId: 1,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 10, specialType: 14, adjacentIds: [1] },
    { id: 3, type: 5, adjacentIds: [1] },
  ],
};
const dayOneSpecialPlan = routePlanner.planRoute({ ...specialEventFixture, totalTurn: 20 }, { maxSteps: 2 });
const dayTwoSpecialPlan = routePlanner.planRoute({
  ...specialEventFixture,
  totalTurn: 55,
  dayOneBossDefeated: true,
}, { maxSteps: 2 });
expect('fixed special events are avoided on day one and become eligible on day two', {
  dayOneUsesSpecial: dayOneSpecialPlan.path.includes(2),
  dayTwoFirstStep: dayTwoSpecialPlan.path[1],
}, { dayOneUsesSpecial: false, dayTwoFirstStep: 2 });
const freeRecoverySpecialPlan = routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 4,
  totalTurn: 20,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [9, 3], isVisited: true, x: 800, y: 350 },
    {
      id: 9, type: 10, specialIncidentId: 10, adjacentIds: [1],
      x: 813, y: 332,
    },
    { id: 3, type: 5, adjacentIds: [1], x: 780, y: 350 },
  ],
}, { maxSteps: 2 });
expect('confirmed free recovery event 10 is eligible on day one and outranks a normal event', {
  recognized: routePlanner.confirmedFixedSpecialEvent(freeRecoverySpecialPlan.graph.byId.get(9), 99)?.eventId,
  firstStep: freeRecoverySpecialPlan.path[1],
}, { recognized: 10, firstStep: 9 });
expect('fixed special-event identity is coordinate based and independent of map and node IDs',
  routePlanner.confirmedFixedSpecialEvent({
    id: 77, type: 10, x: 813, y: 332, specialIncidentId: 10,
  }, 123)?.eventId, 10);
const fourBattleSpecialPlan = routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 99,
  totalTurn: 20,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [10, 3], isVisited: true },
    {
      id: 10, type: 10, specialIncidentId: 9, adjacentIds: [1],
      x: 989, y: 648,
    },
    { id: 3, type: 2, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
const fourBattleSpecialDayTwoPlan = routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 99,
  totalTurn: 60,
  currency: 0,
  dayOneBossDefeated: true,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [10, 3], isVisited: true },
    {
      id: 10, type: 10, specialIncidentId: 9, adjacentIds: [1],
      x: 989, y: 648,
    },
    { id: 3, type: 2, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
const fourBattleSpecial = routePlanner.confirmedFixedSpecialEvent(
  fourBattleSpecialPlan.graph.byId.get(10), 999,
);
expect('fixed event 9 is map-independent, deferred on day one, and valued as four battles on day two', {
  eventId: fourBattleSpecial?.eventId,
  priority: fourBattleSpecial?.priority,
  value: fourBattleSpecial?.value,
  firstDayValue: fourBattleSpecial?.firstDayValue,
  battleEquivalent: fourBattleSpecial?.battleEquivalent,
  processingTurnOptions: fourBattleSpecial?.processingTurnOptions,
  firstDayStep: fourBattleSpecialPlan.path[1],
  dayTwoStep: fourBattleSpecialDayTwoPlan.path[1],
}, {
  eventId: 9,
  priority: 'day-two-very-high',
  value: 2,
  firstDayValue: 0,
  battleEquivalent: 4,
  processingTurnOptions: [0],
  firstDayStep: 3,
  dayTwoStep: 10,
});
const prisonKeySpecial = routePlanner.confirmedFixedSpecialEvent({
  id: 12, type: 10, x: 1832, y: 350, specialIncidentId: 11,
}, 999);
expect('fixed event 11 only gains its high reward value when prison-key possession is known', {
  eventId: prisonKeySpecial?.eventId,
  priority: prisonKeySpecial?.priority,
  currencyEquivalent: prisonKeySpecial?.currencyEquivalent,
  unknownValue: routePlanner.fixedSpecialEventValue(
    prisonKeySpecial,
    routePlanner.normalizeState({}),
  ),
  noKeyValue: routePlanner.fixedSpecialEventValue(
    prisonKeySpecial,
    routePlanner.normalizeState({ prisonKeyCount: 0 }),
  ),
  withKeyValue: routePlanner.fixedSpecialEventValue(
    prisonKeySpecial,
    routePlanner.normalizeState({ prisonKeyCount: 1 }),
  ),
  booleanAliasValue: routePlanner.fixedSpecialEventValue(
    prisonKeySpecial,
    routePlanner.normalizeState({ has_prison_key: true }),
  ),
}, {
  eventId: 11,
  priority: 'conditional',
  currencyEquivalent: 500,
  unknownValue: 0,
  noKeyValue: 0,
  withKeyValue: 2,
  booleanAliasValue: 2,
});
const prisonKeySpecialPlan = routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 4,
  totalTurn: 20,
  prisonKeyCount: 1,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [12, 3], isVisited: true },
    {
      id: 12, type: 10, specialIncidentId: 11, adjacentIds: [1],
      x: 1832, y: 350,
    },
    { id: 3, type: 5, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
expect('fixed event 11 outranks a normal event when prison-key possession is known',
  prisonKeySpecialPlan.path[1], 12);
const currencyOrGuidebookSpecialPlan = routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 4,
  totalTurn: 20,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [13, 3], isVisited: true, x: 2000, y: 617 },
    {
      id: 13, type: 10, specialIncidentId: 13, adjacentIds: [1],
      x: 2052, y: 617,
    },
    { id: 3, type: 5, adjacentIds: [1], x: 1950, y: 617 },
  ],
}, { maxSteps: 2 });
const currencyOrGuidebookSpecial = routePlanner.confirmedFixedSpecialEvent(
  currencyOrGuidebookSpecialPlan.graph.byId.get(13), 99,
);
expect('fixed event 13 is map-independent, very high value, and outranks a normal event', {
  eventId: currencyOrGuidebookSpecial?.eventId,
  priority: currencyOrGuidebookSpecial?.priority,
  value: currencyOrGuidebookSpecial?.value,
  processingTurnOptions: currencyOrGuidebookSpecial?.processingTurnOptions,
  firstStep: currencyOrGuidebookSpecialPlan.path[1],
}, {
  eventId: 13,
  priority: 'very-high',
  value: 2,
  processingTurnOptions: [3, 0],
  firstStep: 13,
});
const companionOrGuidebookSpecial = routePlanner.confirmedFixedSpecialEvent({
  id: 15, type: 10, specialIncidentId: 14, x: 910, y: 1419,
}, 999);
const companionOrGuidebookPlan = dayOneBossDefeated => routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 2,
  totalTurn: dayOneBossDefeated ? 60 : 20,
  dayOneBossDefeated,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [15, 3], isVisited: true },
    {
      id: 15, type: 10, specialIncidentId: 14, adjacentIds: [1],
      x: 910, y: 1419,
    },
    { id: 3, type: 2, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
const companionOrGuidebookDayOnePlan = companionOrGuidebookPlan(false);
const companionOrGuidebookDayTwoPlan = companionOrGuidebookPlan(true);
expect('fixed event 14 defers its strong enemy on day one and values either premium reward on day two', {
  eventId: companionOrGuidebookSpecial?.eventId,
  priority: companionOrGuidebookSpecial?.priority,
  value: companionOrGuidebookSpecial?.value,
  firstDayValue: companionOrGuidebookSpecial?.firstDayValue,
  dangerEquivalent: companionOrGuidebookSpecial?.treatAsDanger,
  battleEquivalent: companionOrGuidebookSpecial?.battleEquivalent,
  processingTurns: routePlanner.estimatedNodeProcessingTurns(
    companionOrGuidebookDayTwoPlan.graph.byId.get(15),
  ),
  currencyEquivalent: companionOrGuidebookSpecial?.currencyEquivalent,
  rewardOptions: companionOrGuidebookSpecial?.rewardOptions,
  firstDayStep: companionOrGuidebookDayOnePlan.path[1],
  dayTwoStep: companionOrGuidebookDayTwoPlan.path[1],
}, {
  eventId: 14,
  priority: 'day-two-very-high',
  value: 2,
  firstDayValue: 0,
  dangerEquivalent: true,
  battleEquivalent: 1,
  processingTurns: 1,
  currencyEquivalent: 300,
  rewardOptions: [
    'companion-currency-equivalent-300',
    'highest-rarity-guidebook-effect',
  ],
  firstDayStep: 3,
  dayTwoStep: 15,
});
const caveExplorationSpecialPlan = routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 99,
  totalTurn: 20,
  event16ItemCount: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [17], isVisited: true },
    {
      id: 17, type: 10, specialIncidentId: 16, adjacentIds: [1],
      x: 1597, y: 1062,
    },
  ],
}, { maxSteps: 1 });
const caveExplorationSpecial = routePlanner.confirmedFixedSpecialEvent(
  caveExplorationSpecialPlan.graph.byId.get(17), 123,
);
const caveExplorationPriorityPlan = dayOneBossDefeated => routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 1,
  totalTurn: dayOneBossDefeated ? 60 : 20,
  dayOneBossDefeated,
  event16ItemCount: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [17, 2], isVisited: true },
    {
      id: 17, type: 10, specialIncidentId: 16, adjacentIds: [1],
      x: 1597, y: 1062,
    },
    { id: 2, type: 2, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
const caveExplorationDayOnePlan = caveExplorationPriorityPlan(false);
const caveExplorationDayTwoPlan = caveExplorationPriorityPlan(true);
expect('fixed event 16 avoids possible strong-enemy chains on day one and regains value on day two', {
  eventId: caveExplorationSpecial?.eventId,
  priority: caveExplorationSpecial?.priority,
  value: caveExplorationSpecial?.value,
  firstDayValue: caveExplorationSpecial?.firstDayValue,
  dangerEquivalent: caveExplorationSpecial?.treatAsDanger,
  minimumProcessingTurns: caveExplorationSpecial?.minimumProcessingTurns,
  risk: caveExplorationSpecial?.risk,
  withoutItemOutcome: caveExplorationSpecial?.withoutItemOutcome,
  withItemOutcome: caveExplorationSpecial?.withItemOutcome,
  processingTurns: routePlanner.estimatedNodeProcessingTurns(
    caveExplorationSpecialPlan.graph.byId.get(17),
  ),
  estimatedRouteTurns: caveExplorationSpecialPlan.estimatedRouteTurns,
  normalizedItemCount: routePlanner.normalizeState({ has_event_16_item: true })
    .event16ItemCount,
  firstDayStep: caveExplorationDayOnePlan.path[1],
  dayTwoStep: caveExplorationDayTwoPlan.path[1],
}, {
  eventId: 16,
  priority: 'day-two-high',
  value: 1,
  firstDayValue: 0,
  dangerEquivalent: true,
  minimumProcessingTurns: 2,
  risk: 'possible-consecutive-strong-enemy-battles',
  withoutItemOutcome: 'repeat-battles-on-one-node',
  withItemOutcome: 'forced-item-use-with-random-battle-skip-and-more-currency',
  processingTurns: 2,
  estimatedRouteTurns: 3,
  normalizedItemCount: 1,
  firstDayStep: 2,
  dayTwoStep: 17,
});
const threeStrongBattlesSpecial = routePlanner.confirmedFixedSpecialEvent({
  id: 18, type: 10, specialIncidentId: 17, x: 1543, y: 1331,
}, 4);
const threeStrongBattlesPlan = dayOneBossDefeated => routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 4,
  totalTurn: dayOneBossDefeated ? 60 : 20,
  dayOneBossDefeated,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [18, 2, 3], isVisited: true },
    {
      id: 18, type: 10, specialIncidentId: 17, adjacentIds: [1],
      x: 1543, y: 1331,
    },
    { id: 2, type: 2, adjacentIds: [1] },
    { id: 3, type: 11, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
const threeStrongBattlesDayOnePlan = threeStrongBattlesPlan(false);
const threeStrongBattlesDayTwoPlan = threeStrongBattlesPlan(true);
expect('fixed event 17 equals strong-enemy risk on day one and outranks danger nodes on day two', {
  eventId: threeStrongBattlesSpecial?.eventId,
  priority: threeStrongBattlesSpecial?.priority,
  value: threeStrongBattlesSpecial?.value,
  firstDayValue: threeStrongBattlesSpecial?.firstDayValue,
  dangerEquivalent: threeStrongBattlesSpecial?.treatAsDanger,
  battleEquivalent: threeStrongBattlesSpecial?.battleEquivalent,
  processingTurns: routePlanner.estimatedNodeProcessingTurns(
    threeStrongBattlesDayTwoPlan.graph.byId.get(18),
  ),
  firstDayStep: threeStrongBattlesDayOnePlan.path[1],
  dayTwoStep: threeStrongBattlesDayTwoPlan.path[1],
}, {
  eventId: 17,
  priority: 'day-two-higher-than-danger',
  value: 3,
  firstDayValue: 0,
  dangerEquivalent: true,
  battleEquivalent: 3,
  processingTurns: 3,
  firstDayStep: 2,
  dayTwoStep: 18,
});
const discountShopSpecial = routePlanner.confirmedFixedSpecialEvent({
  id: 19, type: 10, specialIncidentId: 18, x: 2396, y: 1466,
}, 999);
const discountShopPlan = (dayOneBossDefeated, currency) => routePlanner.planRoute({
  currentNodeId: 1,
  mapId: 3,
  totalTurn: dayOneBossDefeated ? 60 : 20,
  dayOneBossDefeated,
  currency,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [19, 3], isVisited: true },
    {
      id: 19, type: 10, specialIncidentId: 18, adjacentIds: [1],
      x: 2396, y: 1466,
    },
    { id: 3, type: 2, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
const discountShopDayOnePlan = discountShopPlan(false, 1000);
const discountShopDayTwoPlan = discountShopPlan(true, 1000);
expect('fixed event 18 is a strong-enemy discount shop whose value rises with day and currency', {
  eventId: discountShopSpecial?.eventId,
  priority: discountShopSpecial?.priority,
  dangerEquivalent: discountShopSpecial?.treatAsDanger,
  discount: discountShopSpecial?.shopDiscountPercent,
  processingTurns: routePlanner.estimatedNodeProcessingTurns(
    discountShopDayTwoPlan.graph.byId.get(19),
  ),
  firstDayValue: routePlanner.fixedSpecialEventValue(
    discountShopSpecial,
    routePlanner.normalizeState({ currency: 1000, dayOneBossDefeated: false }),
  ),
  dayTwoLowCurrencyValue: routePlanner.fixedSpecialEventValue(
    discountShopSpecial,
    routePlanner.normalizeState({ currency: 499, dayOneBossDefeated: true }),
  ),
  dayTwoMediumCurrencyValue: routePlanner.fixedSpecialEventValue(
    discountShopSpecial,
    routePlanner.normalizeState({ currency: 500, dayOneBossDefeated: true }),
  ),
  dayTwoIntermediateCurrencyValue: Number(routePlanner.fixedSpecialEventValue(
    discountShopSpecial,
    routePlanner.normalizeState({ currency: 750, dayOneBossDefeated: true }),
  ).toFixed(6)),
  dayTwoHighCurrencyValue: routePlanner.fixedSpecialEventValue(
    discountShopSpecial,
    routePlanner.normalizeState({ currency: 1000, dayOneBossDefeated: true }),
  ),
  dayTwoVeryHighCurrencyValue: routePlanner.fixedSpecialEventValue(
    discountShopSpecial,
    routePlanner.normalizeState({ currency: 1500, dayOneBossDefeated: true }),
  ),
  firstDayStep: discountShopDayOnePlan.path[1],
  dayTwoStep: discountShopDayTwoPlan.path[1],
  dayTwoEstimatedTurns: discountShopDayTwoPlan.estimatedRouteTurns,
}, {
  eventId: 18,
  priority: 'currency-conditional',
  dangerEquivalent: true,
  discount: 20,
  processingTurns: 1,
  firstDayValue: 0,
  dayTwoLowCurrencyValue: 0,
  dayTwoMediumCurrencyValue: 1,
  dayTwoIntermediateCurrencyValue: 1.414214,
  dayTwoHighCurrencyValue: 2,
  dayTwoVeryHighCurrencyValue: 4,
  firstDayStep: 3,
  dayTwoStep: 19,
  dayTwoEstimatedTurns: 2,
});
const floatingCastleBodyPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 20,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 10, specialType: 4, x: 346, y: 292, adjacentIds: [1] },
    { id: 3, type: 5, adjacentIds: [1] },
    { id: 4, type: 10, specialType: 4, x: 999, y: 999, adjacentIds: [] },
  ],
}, { maxSteps: 2 });
expect('floating-castle body is recognized by its known coordinate or complete graph isolation', {
  recognized: routePlanner.isFloatingCastleBodyNode(
    floatingCastleBodyPlan.state.nodes.find(node => node.id === 2),
  ),
  sameTypeOtherCoordinate: routePlanner.isFloatingCastleBodyNode(
    floatingCastleBodyPlan.state.nodes.find(node => node.id === 4),
  ),
  visual: routePlanner.nodeVisual(
    floatingCastleBodyPlan.state.nodes.find(node => node.id === 2),
  ),
  bodyInRouteGraph: floatingCastleBodyPlan.graph.byId.has(2),
  path: floatingCastleBodyPlan.path,
}, {
  recognized: true,
  sameTypeOtherCoordinate: true,
  visual: { key: 'floating-castle-body', icon: '🏰', label: '浮遊城本体' },
  bodyInRouteGraph: false,
  path: [1, 3],
});
const inboundConnectedSpecialNodes = [
  { id: 1, type: 0, adjacentIds: [2] },
  { id: 2, type: 10, specialType: 4, x: 999, y: 999, adjacentIds: [] },
];
expect('an incoming edge prevents a one-way special node from being mistaken for the floating-castle body',
  routePlanner.isFloatingCastleBodyNode(
    routePlanner.normalizeNode(inboundConnectedSpecialNodes[1]),
    inboundConnectedSpecialNodes.map(routePlanner.normalizeNode),
  ), false);
const floatingCastlePlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 20,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 10, specialIncidentId: 5, adjacentIds: [1, 4] },
    { id: 3, type: 10, specialIncidentId: 8, adjacentIds: [1, 5] },
    { id: 4, type: 0, adjacentIds: [2] },
    { id: 5, type: 6, adjacentIds: [3] },
  ],
}, { maxSteps: 3 });
expect('floating-castle transfers are optional one-third rewards while researchers are impassable', {
  transferRecognized: routePlanner.isFloatingCastleTransferNode(floatingCastlePlan.state.nodes[1]),
  researcherRecognized: routePlanner.isFloatingCastleResearcherNode(floatingCastlePlan.state.nodes[2]),
  transferVisual: routePlanner.nodeVisual(floatingCastlePlan.state.nodes[1]).key,
  researcherVisual: routePlanner.nodeVisual(floatingCastlePlan.state.nodes[2]).key,
  transferInRouteGraph: floatingCastlePlan.graph.byId.has(2),
  researcherInRouteGraph: floatingCastlePlan.graph.byId.has(3),
  path: floatingCastlePlan.path,
}, {
  transferRecognized: true, researcherRecognized: true,
  transferVisual: 'floating-castle', researcherVisual: 'researcher',
  transferInRouteGraph: true, researcherInRouteGraph: false, path: [1, 2],
});
const floatingCastleRiskFixture = remainTurn => routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 20,
  miasma: { active: true, level: 1, status: 1, remainTurn },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 10, specialIncidentId: 5, adjacentIds: [1, 4] },
    { id: 3, type: 5, adjacentIds: [1] },
    { id: 4, type: 6, adjacentIds: [2] },
  ],
}, { maxSteps: 3 });
const floatingCastleElevenTurnsPlan = floatingCastleRiskFixture(11);
const floatingCastleTenTurnsPlan = floatingCastleRiskFixture(10);
const floatingCastleSecondShrinkPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 40,
  miasma: { active: true, level: 2, status: 1, remainTurn: 20 },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 10, specialIncidentId: 6, adjacentIds: [1, 4] },
    { id: 3, type: 5, adjacentIds: [1] },
    { id: 4, type: 6, adjacentIds: [2] },
  ],
}, { maxSteps: 3 });
expect('random floating-castle transfers become impassable at ten first-shrink turns and during second shrink', {
  elevenTurnsRisky: routePlanner.isFloatingCastleTransferRisky(
    floatingCastleElevenTurnsPlan.state,
  ),
  elevenTurnsInGraph: floatingCastleElevenTurnsPlan.graph.byId.has(2),
  tenTurnsRisky: routePlanner.isFloatingCastleTransferRisky(
    floatingCastleTenTurnsPlan.state,
  ),
  tenTurnsInGraph: floatingCastleTenTurnsPlan.graph.byId.has(2),
  tenTurnsUsesTransfer: floatingCastleTenTurnsPlan.path.includes(2),
  secondShrinkRisky: routePlanner.isFloatingCastleTransferRisky(
    floatingCastleSecondShrinkPlan.state,
  ),
  secondShrinkInGraph: floatingCastleSecondShrinkPlan.graph.byId.has(2),
  secondShrinkUsesTransfer: floatingCastleSecondShrinkPlan.path.includes(2),
}, {
  elevenTurnsRisky: false,
  elevenTurnsInGraph: true,
  tenTurnsRisky: true,
  tenTurnsInGraph: false,
  tenTurnsUsesTransfer: false,
  secondShrinkRisky: true,
  secondShrinkInGraph: false,
  secondShrinkUsesTransfer: false,
});
const currentFloatingCastleDuringRiskPlan = routePlanner.planRoute({
  currentNodeId: 2,
  totalTurn: 20,
  miasma: { active: true, level: 1, status: 1, remainTurn: 10 },
  nodes: [
    { id: 1, type: 5, adjacentIds: [2] },
    { id: 2, type: 10, specialIncidentId: 7, adjacentIds: [1], isVisited: true },
  ],
}, { maxSteps: 1 });
expect('a player already standing on a risky floating-castle node can still route away from it', {
  currentRetained: currentFloatingCastleDuringRiskPlan.graph.byId.has(2),
  path: currentFloatingCastleDuringRiskPlan.path,
}, { currentRetained: true, path: [2, 1] });
const fanaticChainFixture = {
  currentNodeId: 1,
  totalTurn: 20,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 6], isVisited: true, x: 0, y: 0 },
    { id: 2, type: 10, specialType: 2, adjacentIds: [1, 3], x: 10, y: 0 },
    { id: 3, type: 10, specialType: 1, adjacentIds: [2, 4], x: 20, y: 0 },
    { id: 4, type: 5, adjacentIds: [3, 5], x: 30, y: 0 },
    { id: 5, type: 0, adjacentIds: [4], x: 40, y: 0 },
    { id: 6, type: 2, adjacentIds: [1], x: 0, y: 10 },
  ],
};
const fanaticChainPlan = routePlanner.planRoute(fanaticChainFixture, { maxSteps: 3 });
expect('random combat specials are used when they continue directly into another value route', {
  path: fanaticChainPlan.path,
  firstIsFanatic: routePlanner.isFanaticNode(fanaticChainPlan.graph.byId.get(fanaticChainPlan.path[1])),
  leaderAfterFanatic: fanaticChainPlan.path.indexOf(3) > fanaticChainPlan.path.indexOf(2),
}, { path: [1, 2, 3, 4], firstIsFanatic: true, leaderAfterFanatic: true });
const unfinishedFanaticPlan = routePlanner.planRoute({
  ...fanaticChainFixture,
  nodes: [
    ...fanaticChainFixture.nodes,
    { id: 7, type: 10, specialType: 3, adjacentIds: [], x: 50, y: 20 },
  ],
}, { maxSteps: 3 });
expect('an unrelated random fanatic does not lock a cult-leader route',
  unfinishedFanaticPlan.path.includes(3), true);
const deadEndRandomCombatPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 20,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 3], isVisited: true },
    { id: 2, type: 10, specialType: 2, adjacentIds: [1] },
    { id: 3, type: 5, adjacentIds: [1] },
  ],
}, { maxSteps: 1 });
expect('a dead-end random combat special is not preferred over a continuing ordinary value node',
  deadEndRandomCombatPlan.path, [1, 3]);
const blankAfterLeaderPlan = routePlanner.planRoute({
  ...fanaticChainFixture,
  nodes: fanaticChainFixture.nodes.map(node => node.id === 4 ? { ...node, type: 0 } : node),
}, { maxSteps: 3 });
expect('the cult leader is rejected when only blank progression remains beyond it',
  blankAfterLeaderPlan.path.includes(3), false);
const twoBlanksAfterLeaderFixture = {
  ...fanaticChainFixture,
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 6], isVisited: true, x: 0, y: 0 },
    { id: 2, type: 10, specialType: 2, adjacentIds: [1, 3], x: 10, y: 0 },
    { id: 3, type: 10, specialType: 1, adjacentIds: [2, 4], x: 20, y: 0 },
    { id: 4, type: 0, adjacentIds: [3, 5], x: 30, y: 0 },
    { id: 5, type: 0, adjacentIds: [4, 8], x: 40, y: 0 },
    { id: 8, type: 5, adjacentIds: [5, 9], x: 50, y: 0 },
    { id: 9, type: 2, adjacentIds: [8], x: 60, y: 0 },
    { id: 6, type: 2, adjacentIds: [1], x: 0, y: 10 },
  ],
};
const twoBlanksAfterLeaderGraph = routePlanner.buildGraph(
  twoBlanksAfterLeaderFixture.nodes.map(routePlanner.normalizeNode),
);
expect('a random cult leader is not selected when its next value requires crossing blanks',
  {
    routeAllowed: routePlanner.hasPostCultLeaderValueRoute(
      twoBlanksAfterLeaderGraph, 3, 2, new Set([1, 2, 3]),
    ),
    planIncludesLeader: routePlanner.planRoute(
      twoBlanksAfterLeaderFixture, { maxSteps: 5 },
    ).path.includes(3),
  }, { routeAllowed: true, planIncludesLeader: false });
const threeBlanksAfterLeaderFixture = {
  ...twoBlanksAfterLeaderFixture,
  nodes: twoBlanksAfterLeaderFixture.nodes.map(node => {
    if (node.id === 5)
      return { ...node, adjacentIds: [4, 7] };
    if (node.id === 8)
      return { ...node, adjacentIds: [7, 9] };
    return node;
  }).concat({ id: 7, type: 0, adjacentIds: [5, 8], x: 45, y: 0 }),
};
const threeBlanksAfterLeaderGraph = routePlanner.buildGraph(
  threeBlanksAfterLeaderFixture.nodes.map(routePlanner.normalizeNode),
);
expect('the cult leader is rejected when its forward value route requires three consecutive blanks',
  {
    routeAllowed: routePlanner.hasPostCultLeaderValueRoute(
      threeBlanksAfterLeaderGraph, 3, 2, new Set([1, 2, 3]),
    ),
    planIncludesLeader: routePlanner.planRoute(
      threeBlanksAfterLeaderFixture, { maxSteps: 6 },
    ).path.includes(3),
  }, { routeAllowed: false, planIncludesLeader: false });
const retreatGraph = routePlanner.buildGraph([
  { id: 1, type: 0, adjacentIds: [2] },
  { id: 2, type: 0, adjacentIds: [1, 3] },
  { id: 3, type: 0, adjacentIds: [2, 4] },
  { id: 4, type: 6, adjacentIds: [3] },
].map(routePlanner.normalizeNode));
const firstDayDangerEvacuationGraph = routePlanner.buildGraph([
  { id: 73, type: 0, adjacentIds: [2, 78], isVisited: true },
  { id: 78, type: 0, adjacentIds: [73, 77] },
  { id: 77, type: 11, adjacentIds: [78, 13] },
  { id: 13, type: 0, adjacentIds: [77] },
  { id: 2, type: 0, adjacentIds: [73, 74], isVisited: true },
  { id: 74, type: 5, adjacentIds: [2, 70] },
  { id: 70, type: 0, adjacentIds: [74, 69] },
  { id: 69, type: 0, adjacentIds: [70, 27] },
  { id: 27, type: 5, adjacentIds: [69] },
].map(routePlanner.normalizeNode));
const firstDayDangerEvacuationDeadlines = new Map([
  [73, 28], [78, 29], [77, Infinity], [13, Infinity],
  [2, 29], [74, 29], [70, 29], [69, 29], [27, Infinity],
]);
const firstDayDangerEvacuationState = {
  dayOneBossDefeated: false,
  totalTurn: 22,
  miasma: { active: true, level: 1, status: 1, remainTurn: 7 },
};
const ordinaryFirstDayDangerEvacuation = routePlanner.evacuationAssessment(
  firstDayDangerEvacuationGraph, 73, firstDayDangerEvacuationDeadlines, 22,
  new Set([13, 27]), [73], firstDayDangerEvacuationState, 0, new Set([73, 2]),
);
const preferredFirstDayDangerEvacuation = routePlanner.preferredFirstDayEvacuation(
  firstDayDangerEvacuationGraph, 73, firstDayDangerEvacuationDeadlines, 22,
  new Set([13, 27]), [73], firstDayDangerEvacuationState, 0, new Set([73, 2]),
);
const forcedDangerEvacuation = routePlanner.preferredFirstDayEvacuation(
  firstDayDangerEvacuationGraph, 73, firstDayDangerEvacuationDeadlines, 22,
  new Set([13, 27]), [73], {
    ...firstDayDangerEvacuationState,
    miasma: { ...firstDayDangerEvacuationState.miasma, remainTurn: 5 },
  }, 0, new Set([73, 2]),
);
expect('first-shrink fallback avoids undefeated danger when a danger-free route reaches safety before completion', {
  ordinaryPath: ordinaryFirstDayDangerEvacuation.path,
  preferredPath: preferredFirstDayDangerEvacuation.path,
  preferredDistance: preferredFirstDayDangerEvacuation.distance,
  forcedPathWhenTooLate: forcedDangerEvacuation.path,
}, {
  ordinaryPath: [73, 78, 77, 13],
  preferredPath: [73, 2, 74, 70, 69, 27],
  preferredDistance: 6,
  forcedPathWhenTooLate: [73, 78, 77, 13],
});
const retreatRisk = routePlanner.evacuationAssessment(
  retreatGraph, 4, new Map([1, 2, 3, 4].map(id => [id, Infinity])), 9, new Set([1]), [1, 2, 3, 4],
);
expect('evacuation assessment detects full dead-end backtracking', {
  distance: retreatRisk.distance,
  retrace: retreatRisk.retrace,
  escapeOptions: retreatRisk.escapeOptions,
}, { distance: 3, retrace: 3, escapeOptions: 0 });
const warpPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 5,
  currency: 0,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true, x: 0, y: 0 },
    { id: 2, type: 9, adjacentIds: [1], x: 10, y: 0 },
    { id: 8, type: 9, adjacentIds: [9], x: 1000, y: 0 },
    { id: 9, type: 6, adjacentIds: [8], x: 1010, y: 0 },
  ],
}, { maxHops: 4, maxSteps: 6 });
expect('warp destination area stays hidden until transfer completes', {
  routeUsesWarp: warpPlan.path.includes(8),
  displayedPath: warpPlan.displayPath,
  destinationVisible: warpPlan.localDistances.has(8),
  decision: warpPlan.transferDecision?.action,
}, { routeUsesWarp: true, displayedPath: [1, 2], destinationVisible: false, decision: 'transfer' });
const declinedWarpPlan = routePlanner.planRoute({
  currentNodeId: 2,
  warpDeclinedAtNodeId: 2,
  totalTurn: 5,
  miasma: { active: false },
  nodes: warpPlan.state.nodes,
}, { maxHops: 4, maxSteps: 4 });
expect('declined warp remains at source and disables the transfer edge', {
  pathUsesDestination: declinedWarpPlan.path.includes(8),
  destinationVisible: declinedWarpPlan.localDistances.has(8),
  decision: declinedWarpPlan.transferDecision?.action,
}, { pathUsesDestination: false, destinationVisible: false, decision: 'stay' });
context.updateRouteRuntimeState(87, {
  url: '/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    current_node_id: 1,
    node_list: [
      { node_id: 1, node_type: 5, adjacent_node_ids: [2] },
      { node_id: 2, node_type: 5, adjacent_node_ids: [1] },
    ],
  } } },
});
context.updateRouteRuntimeState(87, {
  url: '/rest/arcarum3/dungeon/party_status',
  responseData: {
    current_node_id: 2,
    node_list: [
      { node_id: 1, node_type: 5, adjacent_node_ids: [2] },
      { node_id: 2, node_type: 5, adjacent_node_ids: [1] },
    ],
  },
});
const nonMovementCurrentChangeRuntime = vm.runInContext('routeRuntimeCache.get(87)', context);
expect('a transient current-node change outside move_node never consumes unrelated events', {
  current: nonMovementCurrentChangeRuntime.currentNodeId,
  firstType: nonMovementCurrentChangeRuntime.nodes.find(node => node.id === 1)?.type,
  firstVisited: nonMovementCurrentChangeRuntime.nodes.find(node => node.id === 1)?.isVisited,
  inferredIds: nonMovementCurrentChangeRuntime.inferredConsumedNodeIds,
}, {
  current: 2,
  firstType: 5,
  firstVisited: false,
  inferredIds: [],
});
context.updateRouteRuntimeState(77, {
  url: '/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    current_node_id: 2,
    total_turn: 5,
    node_list: [
      { node_id: 1, node_type: 0, adjacent_node_ids: [2] },
      { node_id: 2, node_type: 9, adjacent_node_ids: [1] },
      { node_id: 8, node_type: 9, adjacent_node_ids: [9] },
      { node_id: 9, node_type: 6, adjacent_node_ids: [8] },
    ],
  } } },
});
context.updateRouteRuntimeState(77, {
  url: '/rest/arcarum3/dungeon/proceed_node_event_select_warp',
  requestData: JSON.stringify({ select: 0 }),
  responseData: { node_type: 9, total_turn: 5 },
});
const declinedRuntime = vm.runInContext('routeRuntimeCache.get(77)', context);
expect('select zero keeps current warp node in live route state', {
  current: declinedRuntime.currentNodeId,
  declined: declinedRuntime.warpDeclinedAtNodeId,
}, { current: 2, declined: 2 });
context.updateRouteRuntimeState(77, {
  url: '/rest/arcarum3/dungeon/proceed_node_event_select_warp',
  requestData: JSON.stringify({ select: 1 }),
  responseData: { node_type: 9, total_turn: 5 },
});
const acceptedRuntime = vm.runInContext('routeRuntimeCache.get(77)', context);
expect('select one updates current node to the other warp', {
  current: acceptedRuntime.currentNodeId,
  declined: acceptedRuntime.warpDeclinedAtNodeId,
}, { current: 8, declined: null });
context.updateRouteRuntimeState(84, {
  url: '/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    map_id: 1,
    current_node_id: 2,
    total_turn: 10,
    node_list: [
      { node_id: 1, node_type: 0, adjacent_node_ids: [2] },
      { node_id: 2, node_type: 9, adjacent_node_ids: [1] },
      {
        node_id: 99,
        node_type: 10,
        special_incident_id: 4,
        special_node_type: 4,
        position_x: 346,
        position_y: 292,
        adjacent_node_ids: [],
      },
    ],
  } } },
});
context.updateRouteRuntimeState(84, {
  url: '/rest/arcarum3/dungeon/move_node',
  requestData: JSON.stringify({ node_id: 99 }),
  responseData: {
    before_current_node_id: 2,
    after_current_node_id: 99,
    total_turn: 10,
    node_list: [{
      node_id: 99,
      node_type: 10,
      special_incident_id: 4,
      special_node_type: 4,
      position_x: 346,
      position_y: 292,
      adjacent_node_ids: [],
    }],
  },
});
context.updateRouteRuntimeState(84, {
  url: '/rest/arcarum3/dungeon/floating_castle_select_result',
  requestData: '{}',
  responseData: { action_scenario_list: [], total_turn: 10 },
});
const floatingCastleRuntime = vm.runInContext('routeRuntimeCache.get(84)', context);
expect('floating-castle body keeps the return warp as effective route location and preserves the map', {
  current: floatingCastleRuntime.currentNodeId,
  actual: floatingCastleRuntime.actualCurrentNodeId,
  returnNode: floatingCastleRuntime.floatingCastleReturnNodeId,
  nodeIds: floatingCastleRuntime.nodes.map(node => node.id),
}, {
  current: 2,
  actual: 99,
  returnNode: 2,
  nodeIds: [1, 2, 99],
});
context.updateRouteRuntimeState(85, {
  url: '/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    map_id: 1,
    current_node_id: 6,
    total_turn: 10,
    node_list: [
      { node_id: 6, node_type: 6, adjacent_node_ids: [7] },
      { node_id: 7, node_type: 0, adjacent_node_ids: [6] },
    ],
  } } },
});
context.updateRouteRuntimeState(85, {
  url: '/rest/arcarum3/dungeon/move_node',
  requestData: JSON.stringify({ node_id: 7 }),
  responseData: {
    total_turn: 11,
    node_list: [
      { node_id: 6, node_type: 0, adjacent_node_ids: [7] },
      { node_id: 7, node_type: 0, adjacent_node_ids: [6] },
    ],
  },
});
const consumedTreasureRuntime = vm.runInContext('routeRuntimeCache.get(85)', context);
expect('departed treasure stays consumed when movement response omits current id and reclassifies the node', {
  current: consumedTreasureRuntime.currentNodeId,
  treasure: consumedTreasureRuntime.nodes.find(node => node.id === 6),
  inferred: consumedTreasureRuntime.inferredConsumedNodeIds,
}, {
  current: 7,
  treasure: {
    id: 6, x: null, y: null, type: 0, specialType: null, adjacentIds: [7],
    isShrinking: false, isVisited: true, isQuestCheck: false, isPassedDanger: false,
    specialIncidentId: null, originalType: 6, inferredEmpty: true,
  },
  inferred: [6],
});
context.updateRouteRuntimeState(78, {
  url: '/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    map_id: 10,
    current_node_id: 1,
    node_list: [
      { node_id: 1, node_type: 5, adjacent_node_ids: [2] },
      { node_id: 2, node_type: 0, adjacent_node_ids: [1, 3] },
      { node_id: 3, position_x: 813, position_y: 332, node_type: 10, special_incident_id: 6, adjacent_node_ids: [2, 4] },
      { node_id: 4, node_type: 3, adjacent_node_ids: [3] },
    ],
  } } },
});
context.updateRouteRuntimeState(78, {
  url: '/rest/arcarum3/dungeon/move_node',
  requestData: JSON.stringify({ node_id: 2 }),
  responseData: { before_current_node_id: 1, after_current_node_id: 2, total_turn: 1 },
});
context.updateRouteRuntimeState(78, {
  url: '/rest/arcarum3/dungeon/move_node',
  requestData: JSON.stringify({ node_id: 3 }),
  responseData: { before_current_node_id: 2, after_current_node_id: 3, total_turn: 2 },
});
context.updateRouteRuntimeState(78, {
  url: '/rest/arcarum3/dungeon/move_node',
  requestData: JSON.stringify({ node_id: 4 }),
  responseData: { before_current_node_id: 3, after_current_node_id: 4, total_turn: 3 },
});
const passedSpecialRuntime = vm.runInContext('routeRuntimeCache.get(78)', context);
expect('passing a floating-castle special keeps its node type but creates no special-event candidate', {
  type: passedSpecialRuntime.nodes.find(node => node.id === 3)?.type,
  classifiedSpecialType: passedSpecialRuntime.nodes.find(node => node.id === 3)?.specialType,
  visited: passedSpecialRuntime.nodes.find(node => node.id === 3)?.isVisited,
  inferred: passedSpecialRuntime.inferredConsumedNodeIds.includes(3),
  latestEnteredEvent: passedSpecialRuntime.specialEventObservation,
}, {
  type: 10, classifiedSpecialType: 6, visited: false, inferred: false,
  latestEnteredEvent: null,
});
context.updateRouteRuntimeState(78, {
  url: '/rest/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    map_id: 10,
    current_node_id: 4,
    node_list: [
      { node_id: 1, node_type: 5, adjacent_node_ids: [2] },
      { node_id: 2, node_type: 0, adjacent_node_ids: [1, 3] },
      { node_id: 3, node_type: 10, adjacent_node_ids: [2, 4] },
      { node_id: 4, node_type: 3, adjacent_node_ids: [3] },
    ],
  } } },
});
const inferredRouteRuntime = vm.runInContext('routeRuntimeCache.get(78)', context);
expect('departed normal events stay inferred empty while special and strong nodes remain intact', {
  normalEvent: inferredRouteRuntime.nodes.find(node => node.id === 1),
  specialType: inferredRouteRuntime.nodes.find(node => node.id === 3)?.type,
  strongType: inferredRouteRuntime.nodes.find(node => node.id === 4)?.type,
  inferredIds: inferredRouteRuntime.inferredConsumedNodeIds,
}, {
  normalEvent: {
    id: 1, x: null, y: null, type: 0, specialType: null, adjacentIds: [2], isShrinking: false,
    isVisited: true, isQuestCheck: false, isPassedDanger: false, specialIncidentId: null,
    originalType: 5, inferredEmpty: true,
  },
  specialType: 10,
  strongType: 3,
  inferredIds: [1],
});
context.updateRouteRuntimeState(79, {
  url: '/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    map_id: 20,
    current_node_id: 1,
    node_list: [
      { node_id: 1, node_type: 0, adjacent_node_ids: [2] },
      { node_id: 2, node_type: 2, adjacent_node_ids: [1, 3] },
      { node_id: 3, node_type: 5, adjacent_node_ids: [2] },
    ],
  } } },
});
context.updateRouteRuntimeState(79, {
  url: '/rest/arcarum3/dungeon/move_node',
  requestData: JSON.stringify({ node_id: 2 }),
  responseData: { before_current_node_id: 1, after_current_node_id: 2, total_turn: 1 },
});
const enteredNormalBattleRuntime = vm.runInContext('routeRuntimeCache.get(79)', context);
expect('entering a normal battle immediately advances route planning past that node', {
  current: enteredNormalBattleRuntime.currentNodeId,
  type: enteredNormalBattleRuntime.nodes.find(node => node.id === 2)?.type,
  inferred: enteredNormalBattleRuntime.inferredConsumedNodeIds.includes(2),
}, { current: 2, type: 0, inferred: true });
const fieldResyncedRuntime = context.updateRouteRuntimeFromFieldCapture(79, {
  capturedAt: '2026-07-23T10:00:00.000Z',
  mapId: 20,
  currentNodeId: 2,
  totalTurn: 12,
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], x: 0, y: 0, isVisited: true },
    { id: 2, type: 0, adjacentIds: [1, 3], x: 100, y: 0, isVisited: true },
    { id: 3, type: 5, adjacentIds: [2], x: 200, y: 0 },
  ],
  miasma: {
    active: true, level: 1, status: 1, step: 30, remainTurn: 15,
    basePatternId: 1, patternId: 1, centerX: 843, centerY: 629,
  },
});
const fieldResyncSnapshot = routePlanner.createFirstShrinkCircleSnapshot(fieldResyncedRuntime);
expect('field return replaces stale battle state and can immediately build the first-shrink circle', {
  turn: fieldResyncedRuntime.totalTurn,
  currentNodeId: fieldResyncedRuntime.currentNodeId,
  positionedNodes: fieldResyncedRuntime.nodes.filter(node => node.x !== null && node.y !== null).length,
  miasma: {
    active: fieldResyncedRuntime.miasma.active,
    level: fieldResyncedRuntime.miasma.level,
    step: fieldResyncedRuntime.miasma.step,
    remainTurn: fieldResyncedRuntime.miasma.remainTurn,
  },
  circle: {
    center: fieldResyncSnapshot.center,
    radius: fieldResyncSnapshot.radius,
    modelKey: fieldResyncSnapshot.modelKey,
  },
}, {
  turn: 12,
  currentNodeId: 2,
  positionedNodes: 3,
  miasma: { active: true, level: 1, step: 30, remainTurn: 15 },
  circle: { center: { x: 843, y: 629 }, radius: 650, modelKey: '*:1:1' },
});
context.updateRouteRuntimeState(83, {
  url: '/rest/arcarum3/dungeon/party_status',
  responseData: [
    { hp: 26687, max_hp: 28092, is_pc: true, image_id: 'pc' },
    { hp: 20915, max_hp: 22016, is_pc: false, user_npc_id: 123 },
  ],
});
const partyStatusRuntime = vm.runInContext('routeRuntimeCache.get(83)', context);
expect('dungeon party_status supplies current and maximum HP for miasma survival planning',
  partyStatusRuntime.partyMembers, [
    { index: 0, hp: 26687, maxHp: 28092, isPc: true, imageId: 'pc', userNpcId: null },
    { index: 1, hp: 20915, maxHp: 22016, isPc: false, imageId: null, userNpcId: 123 },
  ]);
context.updateRouteRuntimeState(83, {
  url: '/rest/arcarum3/dungeon/move_node',
  responseData: {
    miasma_info: { before: { is_miasmic: true, level: 1, status: 1, step: 90 } },
    action_scenario_list: [{
      action_type: 301,
      before_party_status: [{ hp: 28092, max_hp: 28092 }],
      after_party_status: [{ hp: 26687, max_hp: 28092 }],
    }],
  },
});
const observedMiasmaRuntime = vm.runInContext('routeRuntimeCache.get(83)', context);
expect('action_type 301 learns the damage rate for its miasma strength stage', {
  rate: observedMiasmaRuntime.miasmaDamageRates[0],
  currentHp: observedMiasmaRuntime.partyMembers[0]?.hp,
}, { rate: 5, currentHp: 26687 });
context.saveRouteFirstShrinkCircle(83, {
  center: { x: 867.9, y: 1000.5 },
  radius: 666.115,
  capturedAt: '2026-07-23T00:00:00.000Z',
  mapId: 4,
  basePatternId: 3,
  patternId: 1,
  dayIndex: 1,
  source: 'saved-first-shrink-simulation',
});
expect('the first-shrink final circle is retained in the tab route runtime',
  vm.runInContext('routeRuntimeCache.get(83).firstShrinkFinalCircle', context), {
    center: { x: 867.9, y: 1000.5 },
    radius: 666.115,
    capturedAt: '2026-07-23T00:00:00.000Z',
    source: 'saved-first-shrink-simulation',
    modelKey: null,
    mapId: 4,
    basePatternId: 3,
    patternId: 1,
    dayIndex: 1,
  });
context.updateRouteRuntimeState(80, {
  url: '/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    map_id: 21,
    current_node_id: 2,
    node_list: [{ node_id: 2, node_type: 2, adjacent_node_ids: [1, 3] }],
  } } },
});
context.updateRouteRuntimeState(80, {
  url: '/rest/raid/start.json',
  responseData: { raid_id: 12345 },
});
const detectedNormalBattleRuntime = vm.runInContext('routeRuntimeCache.get(80)', context);
expect('battle-start detection also advances a still-authoritative normal battle node', {
  type: detectedNormalBattleRuntime.nodes[0].type,
  inferred: detectedNormalBattleRuntime.inferredConsumedNodeIds.includes(2),
}, { type: 0, inferred: true });
expect('battle pages can fall back to the retained runtime route state',
  fs.readFileSync(path.join(root, 'background.js'), 'utf8')
    .includes('response?.error && runtimeState?.nodes?.length'),
  true);
context.updateRouteRuntimeState(81, {
  url: '/arcarum3/dungeon/content/index/0',
  responseData: { option: { dungeon: {
    map_id: 22,
    current_node_id: 3,
    node_list: [
      { node_id: 3, node_type: 3, adjacent_node_ids: [4] },
      { node_id: 4, node_type: 0, adjacent_node_ids: [3] },
    ],
  } } },
});
context.updateRouteRuntimeState(81, {
  url: '/rest/arcarum3/dungeon/move_node',
  requestData: JSON.stringify({ node_id: 4 }),
  responseData: { before_current_node_id: 3, after_current_node_id: 4, total_turn: 1 },
});
const passedDangerRuntime = vm.runInContext('routeRuntimeCache.get(81)', context);
expect('departing an unconsumed strong enemy records it as passed without erasing its type', {
  type: passedDangerRuntime.nodes.find(node => node.id === 3)?.type,
  visited: passedDangerRuntime.nodes.find(node => node.id === 3)?.isVisited,
  passed: passedDangerRuntime.nodes.find(node => node.id === 3)?.isPassedDanger,
  ids: passedDangerRuntime.passedDangerNodeIds,
}, { type: 3, visited: true, passed: true, ids: [3] });
context.updateRouteRuntimeState(86, {
  url: '/rest/arcarum3/dungeon/proceed_node_event',
  responseData: {
    action_scenario_list: [{
      scenario_type: 3,
      action_type: 600,
      candidate_num: 0,
      select_num_min: 0,
      select_num_max: 0,
      dungeon_item_list: [{
        dungeon_item_id: 4,
        num: 1,
        image_id: 'dungeon_item_04',
      }],
    }],
  },
});
context.updateRouteRuntimeState(86, {
  url: '/rest/arcarum3/dungeon/proceed_node_event',
  responseData: {
    action_scenario_list: [{
      action_type: 600,
      dungeon_item_list: [{
        dungeon_item_id: 4,
        num: 1,
        image_id: 'dungeon_item_04',
      }],
    }],
  },
});
const acquiredDungeonItemRuntime = vm.runInContext('routeRuntimeCache.get(86)', context);
expect('action type 600 records an event item immediately and duplicate delivery is idempotent', {
  items: acquiredDungeonItemRuntime.dungeonItems,
  prisonKeyCount: acquiredDungeonItemRuntime.prisonKeyCount,
}, {
  items: [{ id: 4, count: 1, name: '', text: '', imageId: 'dungeon_item_04' }],
  prisonKeyCount: 1,
});
context.updateRouteRuntimeState(86, {
  url: '/rest/arcarum3/dungeon/dungeon_item_list',
  responseData: {
    dungeon_item_list: [
      {
        item_id: 2,
        name: '得体の知れない調合薬',
        text: '怪しい研究者が作り出した寄生植物を取り除くための調合薬。',
        image_id: 'dungeon_item_02',
      },
      {
        item_id: 4,
        name: '監獄の鍵',
        text: '火山地帯に聳える監獄の鍵。',
        image_id: 'dungeon_item_04',
      },
    ],
  },
});
const authoritativeDungeonItemsRuntime = vm.runInContext('routeRuntimeCache.get(86)', context);
expect('dungeon_item_list enriches and authoritatively replaces the owned-item inventory', {
  items: authoritativeDungeonItemsRuntime.dungeonItems,
  prisonKeyCount: authoritativeDungeonItemsRuntime.prisonKeyCount,
}, {
  items: [
    {
      id: 2, count: 1, name: '得体の知れない調合薬',
      text: '怪しい研究者が作り出した寄生植物を取り除くための調合薬。',
      imageId: 'dungeon_item_02',
    },
    {
      id: 4, count: 1, name: '監獄の鍵',
      text: '火山地帯に聳える監獄の鍵。',
      imageId: 'dungeon_item_04',
    },
  ],
  prisonKeyCount: 1,
});
context.updateRouteRuntimeState(86, {
  url: '/rest/arcarum3/dungeon/dungeon_item_list',
  responseData: {
    dungeon_item_list: [{
      item_id: 2,
      name: '得体の知れない調合薬',
      image_id: 'dungeon_item_02',
    }],
  },
});
const consumedPrisonKeyRuntime = vm.runInContext('routeRuntimeCache.get(86)', context);
expect('an authoritative inventory without item 4 clears the prison-key route condition', {
  itemIds: consumedPrisonKeyRuntime.dungeonItems.map(item => item.id),
  prisonKeyCount: consumedPrisonKeyRuntime.prisonKeyCount,
}, { itemIds: [2], prisonKeyCount: 0 });
const passedDangerPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 10,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2, 4], isVisited: true },
    { id: 2, type: 3, adjacentIds: [1, 3], isVisited: true, isPassedDanger: true },
    { id: 3, type: 5, adjacentIds: [2] },
    { id: 4, type: 5, adjacentIds: [1] },
  ],
}, { maxSteps: 3 });
expect('passed strong enemies receive the same route avoidance priority as empty nodes',
  passedDangerPlan.path[1], 4);
expect('unbounded persistent Ajax archive is configured', {
  unlimitedStorage: manifest.permissions.includes('unlimitedStorage'),
  archiveList: sidepanelHtml.includes('id="ajax-archive-list"'),
  archiveRefresh: sidepanelHtml.includes('id="refresh-ajax-archives"'),
  opfs: fs.readFileSync(path.join(root, 'background.js'), 'utf8')
    .includes('navigator.storage.getDirectory()'),
  splitFiles: fs.readFileSync(path.join(root, 'background.js'), 'utf8')
    .includes('AJAX_ARCHIVE_PART_BYTES'),
  miasmaVisualArchive: fs.readFileSync(path.join(root, 'background.js'), 'utf8')
    .includes("kind: 'miasma_visual'"),
  rawMiasmaEffectCapture: fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8')
    .includes("miasmaEffectInfo: inspectGameValue(viewMiasma"),
  renderedCircleBounds: fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8')
    .includes('getTransformedBounds'),
}, {
  unlimitedStorage: true,
  archiveList: true,
  archiveRefresh: true,
  opfs: true,
  splitFiles: true,
  miasmaVisualArchive: true,
  rawMiasmaEffectCapture: true,
  renderedCircleBounds: true,
});
const mergedLimitCircleState = context.mergeRouteStates({
  nodes: [],
  miasma: { circlePositionX: 223, circlePositionY: 59 },
}, {
  nodes: [],
  miasma: { centerX: 893, centerY: 729 },
});
expect('limitCircle top-left is not treated as a radius without rendered scale',
  mergedLimitCircleState.miasma.circleRadius, undefined);
expect('feature test content cannot widen the top tab bar', {
  tabMinWidth: sidepanelCss.includes('.view-tab { overflow: hidden; min-width: 0;'),
  panelMinWidth: sidepanelCss.includes('.view-panel { display: none; min-width: 0; max-width: 100%; }'),
  traceEntryMinWidth: sidepanelCss.includes('.ajax-trace-entry { min-width: 0; max-width: 100%;'),
  preMaxWidth: sidepanelCss.includes('.ajax-trace-entry pre { overflow: auto; width: 100%; min-width: 0; max-width: 100%;'),
}, { tabMinWidth: true, panelMinWidth: true, traceEntryMinWidth: true, preMaxWidth: true });
const ajaxStateCandidates = context.extractAjaxStateCandidates({
  option: {
    dungeon: {
      current_node_id: 64,
      total_turn: 18,
      possession_arcarum3_dungeon_point: 540,
      node_list: [
        { node_id: 64, is_visited: true, is_shrinking: false },
        { node_id: 65, is_visited: false },
      ],
      miasma_info: {
        after: { is_miasmic: true, miasma_stop_countdown: 11, shrink_node_ids: [42, 43] },
      },
    },
  },
});
expect('Ajax trace extracts route-state candidates', ajaxStateCandidates.map(candidate => ({
  category: candidate.category,
  key: candidate.key,
  value: candidate.value,
  nodeId: candidate.nodeId,
})), [
  { category: 'currentNode', key: 'current_node_id', value: 64, nodeId: undefined },
  { category: 'elapsedTurn', key: 'total_turn', value: 18, nodeId: undefined },
  { category: 'currency', key: 'possession_arcarum3_dungeon_point', value: 540, nodeId: undefined },
  { category: 'visitedNode', key: 'is_visited', value: true, nodeId: 64 },
  { category: 'miasma', key: 'is_miasmic', value: true, nodeId: undefined },
  { category: 'miasma', key: 'miasma_stop_countdown', value: 11, nodeId: undefined },
  { category: 'miasma', key: 'shrink_node_ids', value: [42, 43], nodeId: undefined },
]);
const moveStateCandidates = context.extractAjaxStateCandidates({
  before_current_node_id: 63,
  after_current_node_id: 67,
  total_turn: 22,
  miasma_info: {
    before: { miasma_stop_countdown: 8, step: 60 },
    after: { miasma_stop_countdown: 7, step: 65 },
    shrink_node_ids: ['15', '39'],
  },
});
expect('move_node candidates identify previous/current node and miasma transition', moveStateCandidates.map(candidate => ({
  category: candidate.category,
  key: candidate.key,
  value: candidate.value,
})), [
  { category: 'previousNode', key: 'before_current_node_id', value: 63 },
  { category: 'currentNode', key: 'after_current_node_id', value: 67 },
  { category: 'elapsedTurn', key: 'total_turn', value: 22 },
  { category: 'miasma', key: 'miasma_stop_countdown', value: 8 },
  { category: 'miasma', key: 'step', value: 60 },
  { category: 'miasma', key: 'miasma_stop_countdown', value: 7 },
  { category: 'miasma', key: 'step', value: 65 },
  { category: 'miasma', key: 'shrink_node_ids', value: ['15', '39'] },
]);
const dungeonItemCandidates = context.extractAjaxStateCandidates({
  action_scenario_list: [{
    action_type: 600,
    dungeon_item_list: [{
      dungeon_item_id: 4,
      num: 1,
      image_id: 'dungeon_item_04',
    }],
  }],
  dungeon_item_list: [{
    item_id: 2,
    name: '得体の知れない調合薬',
    image_id: 'dungeon_item_02',
  }],
});
expect('Ajax trace identifies event-item acquisition and authoritative inventory IDs',
  dungeonItemCandidates.map(candidate => ({
    category: candidate.category,
    key: candidate.key,
    value: candidate.value,
  })), [
    { category: 'dungeonItem', key: 'dungeon_item_id', value: 4 },
    { category: 'dungeonItem', key: 'item_id', value: 2 },
  ]);
expect('Game.view.data all-descendant inspection is configured', {
  dataSource: fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8')
    .includes("source: 'window.Game.view.data'"),
  captureMode: fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8')
    .includes("captureMode: 'all-own-descendants'"),
  unlimitedDepth: fs.readFileSync(path.join(root, 'page-hook.js'), 'utf8')
    .includes("inspectGameValue(data, 0, Infinity, 'data'"),
}, { dataSource: true, captureMode: true, unlimitedDepth: true });
expect('node inspector can recover a missing content-script receiver', {
  scriptingPermission: manifest.permissions.includes('scripting'),
  contentGuard: fs.readFileSync(path.join(root, 'content.js'), 'utf8')
    .includes('__gbfBattleMonitorContentLoaded'),
  injectionFallback: fs.readFileSync(path.join(root, 'background.js'), 'utf8')
    .includes("files: ['content.js']"),
}, { scriptingPermission: true, contentGuard: true, injectionFallback: true });
expect('character display is limited to front formation order', uiContext.getVisibleCharacterIndexes(
  [0, 1, 2, 3, 4, 5].map(index => ({ index })),
  [{ index: 6 }],
  ['0', '1', '2', '4'],
), [0, 1, 2, 4]);
expect('backline and duplicate formation indexes are omitted', uiContext.getVisibleCharacterIndexes(
  [0, 1, 2, 3, 4].map(index => ({ index })),
  [],
  [4, 0, 4, 99],
), [4, 0]);
expect('restored previous character rows without indexes use their array positions', {
  indexes: [...uiContext.createCharacterStatsMap([
    { name: 'Alice', hit: 4 },
    { name: 'Bob', hit: 3 },
  ]).keys()],
  visible: uiContext.getVisibleCharacterIndexes([], [
    { name: 'Alice', hit: 4 },
    { name: 'Bob', hit: 3 },
  ], [0, 1]),
}, { indexes: [0, 1], visible: [0, 1] });

const missingCircleFallbackPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 14,
  miasma: {
    active: true,
    level: 1,
    status: 1,
    remainTurn: 8,
  },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true },
    { id: 2, type: 0, adjacentIds: [1, 3], isVisited: true },
    { id: 3, type: 0, adjacentIds: [2, 4], isVisited: true },
    { id: 4, type: 6, adjacentIds: [3] },
  ],
}, { maxSteps: 1 });
expect('missing first-shrink circle data still yields a conservative route through blanks to value', {
  mode: missingCircleFallbackPlan.mode,
  path: missingCircleFallbackPlan.path,
  reason: missingCircleFallbackPlan.fallbackReason,
}, {
  mode: 'fallback',
  path: [1, 2, 3, 4],
  reason: 'nearest-reachable-value',
});

const safeAdjacentFallbackPlan = routePlanner.planRoute({
  currentNodeId: 1,
  totalTurn: 7,
  miasma: { active: false },
  nodes: [
    { id: 1, type: 0, adjacentIds: [2], isVisited: true },
    { id: 2, type: 0, adjacentIds: [1], isVisited: true },
  ],
}, { maxSteps: 1 });
expect('a map with no remaining value still recommends a safe adjacent step', {
  mode: safeAdjacentFallbackPlan.mode,
  path: safeAdjacentFallbackPlan.path,
  reason: safeAdjacentFallbackPlan.fallbackReason,
}, {
  mode: 'fallback',
  path: [1, 2],
  reason: 'safe-adjacent-step',
});

const persistedState = JSON.parse(JSON.stringify(restoredState));
localStorageData['battle-state:latest'] = persistedState;
const stateAfterTabReplacement = context.createEmptyState();
context.restoreMatchingBattleState(stateAfterTabReplacement, {
  url: '/rest/raid/start.json',
  responseData: { raid_id: 123 },
}).then(async () => {
  expect('persistent state restores after tab replacement', {
    battleId: stateAfterTabReplacement.battleId,
    total: stateAfterTabReplacement.totalDamage,
    current: stateAfterTabReplacement.currentTurn,
    members: stateAfterTabReplacement.members,
  }, {
    battleId: '123',
    total: 300,
    current: { hit: 2, debuff: 0, ability: 300, special: 0, total: 300 },
    members: [],
  });
  await context.recordGuidebookCandidates(guidebookPayload);
  await context.recordGuidebookCandidates(guidebookPayload);
  const persistedGuidebookEffects = await context.readGuidebookEffects();
  expect('guidebook candidates persist before acquisition with names as effect text', {
    ids: persistedGuidebookEffects.map(effect => effect.id),
    counts: persistedGuidebookEffects.map(effect => effect.observationCount),
    names: persistedGuidebookEffects.map(effect => effect.name),
    latestCandidateBatchCount: new Set(
      persistedGuidebookEffects.map(effect => effect.lastCandidateBatchId),
    ).size,
    observedNames: persistedGuidebookEffects.find(effect => effect.id === 61)?.observedNames,
  }, {
    ids: [19, 61, 64],
    counts: [2, 2, 2],
    names: [
      '自属性冴手効果(20%)',
      '弱体アビリティ使用時@@弱体効果を2つ付与',
      '奥義発動時@@通常攻撃とアビリティの与ダメージUP',
    ],
    latestCandidateBatchCount: 1,
    observedNames: ['弱体アビリティ使用時@@弱体効果を2つ付与'],
  });
  await context.recordGuidebookCandidates(guidebookRewardPayload);
  let rewardMergedEffects = await context.readGuidebookEffects();
  expect('ID-less battle reward is retained beside event candidates', {
    count: rewardMergedEffects.length,
    reward: (() => {
      const reward = rewardMergedEffects.find(effect => effect.name === '自属性攻撃UP(20%)');
      return {
        id: reward?.id,
        key: reward?.key,
        name: reward?.name,
        sourceTypes: reward?.sourceTypes,
        lastAcquisitionSource: reward?.lastAcquisitionSource,
        acquisitionCount: reward?.acquisitionCount,
      };
    })(),
  }, {
    count: 4,
    reward: {
      id: null,
      key: 'name:自属性攻撃UP(20%)',
      name: '自属性攻撃UP(20%)',
      sourceTypes: ['battle_reward'],
      lastAcquisitionSource: 'battle_reward',
      acquisitionCount: 1,
    },
  });
  await context.recordGuidebookCandidates({
    url: '/rest/arcarum3/dungeon/proceed_node_event?_=2',
    responseData: {
      action_scenario_list: [{
        action_type: 401,
        status_list: [{ status_id: 777, name: '自属性攻撃UP(20%)', rarity: 1 }],
      }],
    },
  });
  rewardMergedEffects = await context.readGuidebookEffects();
  const identifiedReward = rewardMergedEffects.find(effect => Number(effect.id) === 777);
  expect('later event candidate ID merges with an equal-name battle reward', {
    count: rewardMergedEffects.length,
    id: identifiedReward?.id,
    key: identifiedReward?.key,
    sourceTypes: identifiedReward?.sourceTypes,
    observations: identifiedReward?.observationCount,
  }, {
    count: 4,
    id: 777,
    key: 'id:777',
    sourceTypes: ['battle_reward', 'event_candidate'],
    observations: 2,
  });
  const persistedR1Value = localStorageData['guidebook-effect-values:v1']
    ?.find(effect => Number(effect.id) === 777);
  expect('parsed R1 values are persisted separately from the guidebook catalog', {
    ownedCount: persistedR1Value?.ownedCount,
    ownedCountKnown: persistedR1Value?.ownedCountKnown,
    stats: persistedR1Value?.stats?.map(stat => [
      stat.key, stat.value, stat.totalValue, stat.unit,
    ]),
  }, {
    ownedCount: 0,
    ownedCountKnown: false,
    stats: [['elementAttack', 20, 0, 'percent']],
  });
  await context.recordGuidebookCandidates({
    kind: 'guidebook_page_capture',
    viewEffects: [{
      status_id: null,
      name: '自属性冴手効果(20%)',
      rarity: null,
      icon_category: null,
      icon_type: 501,
      is_duplication_possible: null,
      source_type: 'effect_confirmation',
      capture_context: 'DOM:#arcarum3/book:cursed img[book_effect_*]',
    }],
  });
  const metadataPreservedEffects = await context.readGuidebookEffects();
  const metadataPreserved = metadataPreservedEffects.find(effect => Number(effect.id) === 19);
  expect('metadata-free reward and confirmation captures do not erase known rank or duplication', {
    rarity: metadataPreserved?.rarity,
    duplication: metadataPreserved?.isDuplicationPossible,
    iconType: metadataPreserved?.iconType,
    sourceTypes: metadataPreserved?.sourceTypes,
  }, {
    rarity: 2,
    duplication: true,
    iconType: 501,
    sourceTypes: ['event_candidate', 'effect_confirmation'],
  });
  await context.recordGuidebookCandidates({
    kind: 'guidebook_page_capture',
    viewEffects: [{
      status_id: null,
      name: 'R1ショップ価格テスト',
      source_type: 'shop_page',
      shop_price: 50,
      shop_base_price: 50,
      shop_discounted: false,
      shop_premium: false,
      shop_book_grade: 1,
      shop_sold_out: false,
    }],
  });
  await context.recordGuidebookCandidates({
    kind: 'guidebook_page_capture',
    viewEffects: [{
      status_id: null,
      name: 'R1ショップ価格テスト',
      source_type: 'shop_page',
      shop_price: 38,
      shop_base_price: 50,
      shop_discounted: true,
      shop_premium: false,
      shop_book_grade: 1,
      shop_sold_out: false,
    }],
  });
  await context.recordGuidebookCandidates({
    kind: 'guidebook_page_capture',
    viewEffects: [{
      status_id: null,
      name: 'R1ショップ価格テスト',
      source_type: 'shop_page',
      shop_price: 75,
      shop_base_price: 50,
      shop_discounted: false,
      shop_premium: true,
      shop_book_grade: 1,
      shop_sold_out: false,
    }],
  });
  const discountedShopEffects = await context.readGuidebookEffects();
  const discountedShop = discountedShopEffects.find(
    effect => effect.name === 'R1ショップ価格テスト',
  );
  expect('R1 shop keeps current discounted price separately from base and history', {
    current: discountedShop?.shopPrice,
    base: discountedShop?.shopBasePrice,
    discounted: discountedShop?.shopDiscounted,
    premium: discountedShop?.shopPremium,
    observed: discountedShop?.observedShopPrices,
    label: uiContext.guidebookShopPriceLabel(discountedShop),
  }, {
    current: 75,
    base: 50,
    discounted: false,
    premium: true,
    observed: [50, 38, 75],
    label: '75コイン（通常50）',
  });
  await context.recordGuidebookCandidates({
    kind: 'ajax',
    url: '/rest/arcarum3/dungeon/proceed_node_event_spacebook_status_add',
    requestData: '{"special_token":null,"status_ids":[19]}',
    responseData: {},
  });
  const eventAcquiredEffects = await context.readGuidebookEffects();
  const eventAcquired = eventAcquiredEffects.find(effect => Number(effect.id) === 19);
  expect('selected event guidebook is marked as the latest acquisition', {
    source: eventAcquired?.lastAcquisitionSource,
    count: eventAcquired?.acquisitionCount,
    batch: Boolean(eventAcquired?.lastAcquisitionBatchId),
    acquiredAt: Boolean(eventAcquired?.lastAcquiredAt),
  }, {
    source: 'event_reward',
    count: 1,
    batch: true,
    acquiredAt: true,
  });
  await context.recordGuidebookCandidates(cursedImmediateRewardPayload);
  const immediateRewardEffects = await context.readGuidebookEffects();
  const immediateCursedReward = immediateRewardEffects.find(
    effect => Number(effect.id) === 118,
  );
  expect('immediate cursed event reward is saved and highlighted as acquired', {
    name: immediateCursedReward?.name,
    sourceTypes: immediateCursedReward?.sourceTypes,
    source: immediateCursedReward?.lastAcquisitionSource,
    acquisitionCount: immediateCursedReward?.acquisitionCount,
    candidateBatch: immediateCursedReward?.lastCandidateBatchId ?? null,
    acquisitionBatch: Boolean(immediateCursedReward?.lastAcquisitionBatchId),
    isCursed: immediateCursedReward?.isCursed,
    spacebookRewardId: immediateCursedReward?.spacebookRewardId,
  }, {
    name: '毎ターンダメージを受ける',
    sourceTypes: ['event_reward'],
    source: 'event_reward',
    acquisitionCount: 1,
    candidateBatch: null,
    acquisitionBatch: true,
    isCursed: true,
    spacebookRewardId: 5,
  });
  localStorageData['guidebook-effects:v1'].push({
    id: 122,
    key: 'id:122',
    name: 'バトル開始時、敵に被ダメージ無効(30回)(重複不\n可)',
    rarity: 99,
    iconCategory: 4,
    sourceTypes: ['event_candidate'],
    observedNames: ['バトル開始時、敵に被ダメージ無効(30回)(重複不\n可)'],
    observationCount: 1,
    firstSeenAt: '2026-07-23T10:00:00.000Z',
    lastSeenAt: '2026-07-23T10:00:00.000Z',
  }, {
    id: null,
    key: 'name:バトル開始時、敵に被ダメージ無効(30回)(重複不可)',
    name: 'バトル開始時、敵に被ダメージ無効(30回)(重複不可)',
    iconType: 501,
    isCursed: true,
    sourceTypes: ['effect_confirmation'],
    observedNames: ['バトル開始時、敵に被ダメージ無効(30回)(重複不可)'],
    observationCount: 2,
    firstSeenAt: '2026-07-23T09:00:00.000Z',
    lastSeenAt: '2026-07-23T11:00:00.000Z',
  });
  const reconciledLineBreakEffects = await context.readGuidebookEffects();
  const reconciledLineBreak = reconciledLineBreakEffects.filter(effect => (
    context.guidebookEffectIdentityName(effect.name)
      === context.guidebookEffectIdentityName(
        'バトル開始時、敵に被ダメージ無効(30回)(重複不可)',
      )
  ));
  expect('ID-less DOM name and ID name with mid-word line breaks reconcile on read', {
    count: reconciledLineBreak.length,
    id: reconciledLineBreak[0]?.id,
    key: reconciledLineBreak[0]?.key,
    iconType: reconciledLineBreak[0]?.iconType,
    isCursed: reconciledLineBreak[0]?.isCursed,
    sources: reconciledLineBreak[0]?.sourceTypes,
    observations: reconciledLineBreak[0]?.observationCount,
    firstSeenAt: reconciledLineBreak[0]?.firstSeenAt,
    lastSeenAt: reconciledLineBreak[0]?.lastSeenAt,
  }, {
    count: 1,
    id: 122,
    key: 'id:122',
    iconType: 501,
    isCursed: true,
    sources: ['event_candidate', 'effect_confirmation'],
    observations: 3,
    firstSeenAt: '2026-07-23T09:00:00.000Z',
    lastSeenAt: '2026-07-23T11:00:00.000Z',
  });
  await context.recordGuidebookCandidates({
    kind: 'guidebook_page_capture',
    viewEffects: [{
      status_id: 45,
      name: '所持している呪われた導本効果の数に応じて味方全体の通常攻撃のヒット数増加(＋2/最大＋10)',
      source_type: 'effect_confirmation',
    }],
  });
  await context.recordGuidebookCandidates({
    kind: 'guidebook_page_capture',
    viewEffects: [{
      status_id: 45,
      name: '所持している呪われた導本効果の数に応じて味方全体の通常攻撃のヒット数増加(＋7/最大＋10)',
      source_type: 'effect_confirmation',
    }],
  });
  const dynamicEffects = await context.readGuidebookEffects();
  const dynamicEffect45 = dynamicEffects.filter(effect => Number(effect.id) === 45);
  expect('changing guidebook progress does not create or rename another catalog entry', {
    count: dynamicEffect45.length,
    name: dynamicEffect45[0]?.name,
    observedNames: dynamicEffect45[0]?.observedNames,
    template: dynamicEffect45[0]?.effectTemplate,
    variables: dynamicEffect45[0]?.effectVariables,
    latestValues: dynamicEffect45[0]?.lastObservedVariableValues,
  }, {
    count: 1,
    name: '所持している呪われた導本効果の数に応じて味方全体の通常攻撃のヒット数増加(＋0/最大＋10)',
    observedNames: [
      '所持している呪われた導本効果の数に応じて味方全体の通常攻撃のヒット数増加(＋2/最大＋10)',
      '所持している呪われた導本効果の数に応じて味方全体の通常攻撃のヒット数増加(＋7/最大＋10)',
    ],
    template: '所持している呪われた導本効果の数に応じて味方全体の通常攻撃のヒット数増加(＋{{value1}}/最大＋10)',
    variables: [{
      key: 'value1', initialValue: 0, maximumValue: 10, unit: '',
      format: 'current-of-maximum',
    }],
    latestValues: { value1: 7 },
  });
  localStorageData['guidebook-effects:v1'].push({
    id: null,
    key: 'name:[object Object]',
    name: '[object Object]',
    observedNames: ['[object Object]'],
  });
  const cleanedGuidebookEffects = await context.readGuidebookEffects();
  expect('invalid object-string guidebook records are removed from persisted data', {
    returned: cleanedGuidebookEffects.some(effect => effect.name === '[object Object]'),
    persisted: localStorageData['guidebook-effects:v1']
      .some(effect => effect.name === '[object Object]'),
    nestedName: localStorageData['guidebook-effects:v1']
      .some(effect => (effect.observedNames || []).includes('[object Object]')),
  }, {
    returned: false,
    persisted: false,
    nestedName: false,
  });
  localStorageData['guidebook-effects:v1'].push({
    id: null,
    key: 'name:探索画面に戻ることで強力な導本効果を獲得できます。',
    name: '探索画面に戻ることで<br>強力な導本効果を獲得できます。',
    sourceTypes: ['battle_reward'],
    observationCount: 38,
  }, {
    id: 57,
    key: 'id:57',
    name: '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り2/2回)',
    sourceTypes: ['event_candidate'],
    observedNames: [
      '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り2/2回)',
    ],
    observationCount: 21,
    firstSeenAt: '2026-07-23T09:00:00.000Z',
    lastSeenAt: '2026-07-23T10:38:11.503Z',
  }, {
    id: null,
    key: 'name:remaining-zero',
    name: '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り0/2回)',
    sourceTypes: ['effect_confirmation'],
    observedNames: [
      '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り0/2回)',
    ],
    observationCount: 1,
    firstSeenAt: '2026-07-23T10:38:11.503Z',
    lastSeenAt: '2026-07-23T10:38:11.503Z',
  }, {
    id: null,
    key: 'name:remaining-one',
    name: '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り1/2回)',
    sourceTypes: ['effect_confirmation'],
    observedNames: [
      '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り1/2回)',
    ],
    observationCount: 4,
    firstSeenAt: '2026-07-23T10:25:05.868Z',
    lastSeenAt: '2026-07-23T10:38:11.503Z',
  });
  const cleanedResultEffects = await context.readGuidebookEffects();
  const remainingUseEffects = cleanedResultEffects.filter(effect => (
    context.guidebookEffectIdentityName(effect.name)
      === context.guidebookEffectIdentityName(
        '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り2/2回)',
      )
  ));
  expect('read migration removes result instructions and merges remaining-use variants into ID 57', {
    instructionExists: cleanedResultEffects.some(effect => (
      String(effect.name).includes('探索画面に戻ることで')
    )),
    count: remainingUseEffects.length,
    id: remainingUseEffects[0]?.id,
    name: remainingUseEffects[0]?.name,
    observations: remainingUseEffects[0]?.observationCount,
    observedNames: remainingUseEffects[0]?.observedNames,
    variables: remainingUseEffects[0]?.effectVariables,
  }, {
    instructionExists: false,
    count: 1,
    id: 57,
    name: '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り2/2回)',
    observations: 26,
    observedNames: [
      '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り2/2回)',
      '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り0/2回)',
      '宝箱マスから導本効果を獲得した時、導本効果を追加で1つ獲得する(残り1/2回)',
    ],
    variables: [{
      key: 'value1', initialValue: 2, maximumValue: 2, unit: '回',
      format: 'remaining-count',
    }],
  });
  const portableGuidebookPayload = {
    schema: 'gbf-guidebook-effects-v1',
    exportedAt: '2026-07-23T12:00:00.000Z',
    effects: [{
      id: 901,
      key: 'id:901',
      name: '別PCから引き継ぐ導本効果',
      rarity: 3,
      sourceTypes: ['event_candidate'],
      observedNames: ['別PCから引き継ぐ導本効果'],
      observationCount: 2,
      firstSeenAt: '2026-07-23T10:00:00.000Z',
      lastSeenAt: '2026-07-23T10:30:00.000Z',
    }, {
      id: null,
      key: 'name:別PCから引き継ぐ導本効果',
      name: '別PCから引き継ぐ導本効果',
      iconType: 501,
      sourceTypes: ['effect_confirmation'],
      observedNames: ['別PCから引き継ぐ導本効果'],
      observationCount: 5,
      firstSeenAt: '2026-07-23T09:00:00.000Z',
      lastSeenAt: '2026-07-23T11:00:00.000Z',
    }, {
      id: 1,
      key: 'id:1',
      name: '',
      isPlaceholder: true,
      sourceTypes: [],
    }, {
      id: null,
      name: '探索画面に戻ることで強力な導本効果を獲得できます。',
      sourceTypes: ['battle_reward'],
    }],
  };
  const firstImportResult = await context.importGuidebookEffectsData(portableGuidebookPayload);
  const firstImportedEffects = await context.readGuidebookEffects();
  const portableEffect = firstImportedEffects.filter(effect => Number(effect.id) === 901);
  expect('guidebook JSON import adds, reconciles, and filters records without erasing metadata', {
    result: {
      added: firstImportResult.added,
      merged: firstImportResult.merged,
      skipped: firstImportResult.skipped,
    },
    count: portableEffect.length,
    id: portableEffect[0]?.id,
    name: portableEffect[0]?.name,
    rarity: portableEffect[0]?.rarity,
    iconType: portableEffect[0]?.iconType,
    sources: portableEffect[0]?.sourceTypes,
    observations: portableEffect[0]?.observationCount,
    firstSeenAt: portableEffect[0]?.firstSeenAt,
    lastSeenAt: portableEffect[0]?.lastSeenAt,
  }, {
    result: { added: 1, merged: 1, skipped: 2 },
    count: 1,
    id: 901,
    name: '別PCから引き継ぐ導本効果',
    rarity: 3,
    iconType: 501,
    sources: ['event_candidate', 'effect_confirmation'],
    observations: 5,
    firstSeenAt: '2026-07-23T09:00:00.000Z',
    lastSeenAt: '2026-07-23T11:00:00.000Z',
  });
  await context.importGuidebookEffectsData(portableGuidebookPayload);
  const repeatedImportEffects = await context.readGuidebookEffects();
  const repeatedPortable = repeatedImportEffects.filter(effect => Number(effect.id) === 901);
  expect('reimporting the same guidebook JSON is idempotent', {
    count: repeatedPortable.length,
    observations: repeatedPortable[0]?.observationCount,
    sources: repeatedPortable[0]?.sourceTypes,
  }, {
    count: 1,
    observations: 5,
    sources: ['event_candidate', 'effect_confirmation'],
  });
  const sortieNodesBeforeRetreat = [
    { id: 1, isVisited: true },
    { id: 2, isVisited: true },
    { id: 3, isVisited: true },
  ];
  context.observeGuidebookSortieState(501, {
    mapId: 4,
    totalTurn: 18,
    currentNodeId: 3,
    nodes: sortieNodesBeforeRetreat,
  });
  await vm.runInContext('guidebookSortieQueues.get(501)', context);
  await context.recordGuidebookCandidates({
    kind: 'guidebook_page_capture',
    viewEffects: [{
      status_id: 777,
      name: '自属性攻撃UP(20%)',
      rarity: 1,
      count: 2,
      source_type: 'effect_confirmation',
    }],
  });
  context.observeGuidebookSortieState(501, {
    mapId: 4,
    totalTurn: 18,
    currentNodeId: 3,
    nodes: sortieNodesBeforeRetreat,
  });
  await vm.runInContext('guidebookSortieQueues.get(501)', context);
  const sameSortieEffects = await context.readGuidebookEffects();
  expect('same-sortie reload does not reset current guidebook ownership',
    sameSortieEffects.find(effect => Number(effect.id) === 777)?.count, 2);
  context.observeGuidebookSortieState(501, {
    mapId: 2,
    totalTurn: 0,
    currentNodeId: 9,
    nodes: [
      { id: 9, isVisited: true },
      { id: 10, isVisited: false },
      { id: 11, isVisited: false },
    ],
  });
  await vm.runInContext('guidebookSortieQueues.get(501)', context);
  const resetSortieEffects = await context.readGuidebookEffects();
  const resetSortieEffect = resetSortieEffects.find(effect => Number(effect.id) === 777);
  const resetSortieValue = localStorageData['guidebook-effect-values:v1']
    .find(effect => Number(effect.id) === 777);
  expect('retreat then new sortie resets only current guidebook ownership', {
    count: resetSortieEffect?.count,
    name: resetSortieEffect?.name,
    rarity: resetSortieEffect?.rarity,
    sources: resetSortieEffect?.sourceTypes,
    acquisitionCount: resetSortieEffect?.acquisitionCount,
    resetReason: resetSortieEffect?.currentOwnershipResetReason,
    ownedCount: resetSortieValue?.ownedCount,
    ownedCountKnown: resetSortieValue?.ownedCountKnown,
    total: resetSortieValue?.stats?.[0]?.totalValue,
  }, {
    count: 0,
    name: '自属性攻撃UP(20%)',
    rarity: 1,
    sources: ['battle_reward', 'event_candidate', 'effect_confirmation'],
    acquisitionCount: 1,
    resetReason: 'new-sortie',
    ownedCount: 0,
    ownedCountKnown: true,
    total: 0,
  });
  console.log(JSON.stringify({
    passed: true,
    checked: [
      'same-battle cumulative preservation',
      'reload/tab-replacement persistent state restoration',
      'current/previous turn transition',
      'current/previous character turn transition',
      'live action accumulation',
      'debuff counting omitted from current version',
      'real-time event-candidate and battle-result guidebook capture using effect names, ID reconciliation, and hit-prediction removal',
      'manual current-Game.view guidebook capture and storage diagnostics for shop/confirmation effects',
      'new-battle reset',
      'compact contribution/character 万/億 formatting',
      'Game.view node inspector test tab',
      'Ajax history recording and route-state candidate extraction',
      'unbounded OPFS Ajax archive with split-file export',
      'feature-test intrinsic-width containment for top tabs',
      'optimal-route connected-radius map with off-radius continuation, strict empty-node avoidance, turnback penalty, HP-based miasma allowance, and boss routing',
      'combat/event processing-turn estimates and five-turn first-shrink evacuation reserve',
      'first-shrink danger-free evacuation fallback when it still reaches permanent safety before completion',
      'completed first-shrink outer-to-inner equal-value sweep without bridge preference',
      'explicit day phase and turn-22 first-day ruler evacuation-endpoint exclusion',
    'late-phase value-density routing, processed-node return timing, and fixed events 9/11/13/14/16/17/18',
      'random floating-castle transfer risk near first-shrink completion and during second shrink',
      'floating-castle body exclusion by known coordinate or complete graph isolation',
      'first-shrink-only miasma traversal and five-turn boss-arrival reserve',
      'registered fixed-special-event observation display filtering',
      'floating-castle and random fanatic/cult exclusion from special-event observations',
      'restored OPFS first-shrink pattern simulation without rendered image bounds',
      'first-shrink live-coordinate fallback and persistent median self-learning from completed node boundaries',
      'route fallback with missing shrink coordinates and no remaining value',
      'normal-battle look-ahead, passed-danger avoidance, and special-event preservation',
      'Game.view.data all-own-descendant inspection',
      'missing content-script receiver reinjection fallback',
      'front-formation-only character display',
      'restored previous-character index normalization',
      'stable zero-state guidebook names with dynamic variable schemas',
      'registered special-event completed badges on the route map',
      'boss-anchored second-shrink node deadline simulation',
      'battle-result instruction filtering and remaining-use guidebook reconciliation',
      'portable idempotent guidebook JSON export and import',
      'guidebook multi-unit parsing, separate value persistence, compound effects, flags, ID-scoped chase totals, and active-only display',
      'new-sortie current guidebook ownership reset without catalog loss',
    ],
  }, null, 2));
}).catch(error => {
  console.error(error);
  process.exit(1);
});
