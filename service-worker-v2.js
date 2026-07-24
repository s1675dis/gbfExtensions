importScripts('service-worker.js');

const getStateV1 = getState;

function normalizeTurnState(state) {
  if (!state.currentTurn)
    state.currentTurn = state.lastTurn ? { ...state.lastTurn } : emptyTurnStats();
  if (!state.previousTurn)
    state.previousTurn = emptyTurnStats();
  state.currentTurn.debuff = asNumber(state.currentTurn.debuff);
  state.previousTurn.debuff = asNumber(state.previousTurn.debuff);
  state.characterStats = normalizeCharacterStatsList(state.characterStats);
  state.previousCharacterStats = normalizeCharacterStatsList(state.previousCharacterStats);
  if (!Array.isArray(state.bossDebuffKeys)) {
    state.bossDebuffKeys = [];
    state.bossDebuffStateInitialized = false;
  }
  if (!Array.isArray(state.bossDebuffs))
    state.bossDebuffs = [];
  if (typeof state.bossDebuffStateInitialized !== 'boolean')
    state.bossDebuffStateInitialized = false;
  if (!Array.isArray(state.frontFormation))
    state.frontFormation = Array.isArray(state.gameSnapshot?.formation)
      ? state.gameSnapshot.formation.map(Number).filter(Number.isInteger)
      : [];
  delete state.gameSnapshot;
  delete state.preAttackSnapshot;
  delete state.hitPrediction;
  delete state.hitPredictionRecords;
  return state;
}

function normalizeCharacterStatsList(characters) {
  if (!Array.isArray(characters))
    return [];
  return characters.map((character, position) => {
    const index = Number(character?.index);
    return {
      ...character,
      index: Number.isInteger(index) && index >= 0 ? index : position,
      hit: asNumber(character?.hit),
      debuff: asNumber(character?.debuff),
      ability: asNumber(character?.ability),
      special: asNumber(character?.special),
    };
  });
}

createEmptyState = function createEmptyStateV2() {
  return {
    active: false,
    battleId: '',
    participationId: '',
    totalDamage: 0,
    participantCount: 0,
    participantLimit: 0,
    statsTurn: 0,
    currentTurn: emptyTurnStats(),
    previousTurn: emptyTurnStats(),
    characterStats: [],
    previousCharacterStats: [],
    bossDebuffKeys: [],
    bossDebuffs: [],
    bossDebuffStateInitialized: false,
    frontFormation: [],
    members: [],
    updatedAt: 0,
  };
};

getState = async function getStateV2(tabId) {
  return normalizeTurnState(await getStateV1(tabId));
};

function advanceTurn(state, nextTurn) {
  state.previousTurn = { ...state.currentTurn };
  state.previousCharacterStats = normalizeCharacterStatsList(state.characterStats);
  state.currentTurn = emptyTurnStats();
  resetCharacterStats(state.characterStats);
  state.statsTurn = nextTurn;
}

function resolveDebuffCharacter(conditionIndex, scenario, characters) {
  for (let index = conditionIndex - 1; index >= 0; index -= 1) {
    const action = scenario[index];
    if (!action || action.cmd === 'wait' || (action.cmd === 'turn' && action.mode === 'boss'))
      break;
    if (['ability', 'special', 'special_npc'].includes(action.cmd) && action.to !== 'boss') {
      const owner = Number(action.num);
      return Number.isInteger(owner) && owner >= 0 ? owner : null;
    }
    if (action.cmd === 'windoweffect' && action.kind) {
      const pid = String(action.kind).split('_')[2];
      const character = characters.find(item => item.pid === pid);
      if (character)
        return character.index;
    }
  }
  return null;
}

updateTurnStats = function updateTurnStatsV2(state, resultType, data) {
  normalizeTurnState(state);
  const responseTurn = asNumber(data.status?.turn);
  const resultStats = calculateTurnStats(data.scenario);
  const characterAdditions = calculateCharacterStats(data.scenario, state.characterStats);
  const bossDied = Array.isArray(data.scenario)
    && data.scenario.some(action => action?.cmd === 'die' && action.to === 'boss');

  if (resultType === 'normal_attack') {
    const actionTurn = responseTurn > 0 && !bossDied
      ? Math.max(1, responseTurn - 1)
      : responseTurn || state.statsTurn;

    if (actionTurn && state.statsTurn && actionTurn !== state.statsTurn)
      advanceTurn(state, actionTurn);
    else if (actionTurn && !state.statsTurn)
      state.statsTurn = actionTurn;

    addTurnStats(state.currentTurn, resultStats);
    mergeCharacterStats(state, characterAdditions);

    if (!bossDied && responseTurn > actionTurn)
      advanceTurn(state, responseTurn);
    return;
  }

  if (responseTurn && responseTurn !== state.statsTurn)
    advanceTurn(state, responseTurn);
  else if (responseTurn && !state.statsTurn)
    state.statsTurn = responseTurn;

  addTurnStats(state.currentTurn, resultStats);
  mergeCharacterStats(state, characterAdditions);
};

handleAjax = function handleAjaxV2(state, payload) {
  normalizeTurnState(state);
  const url = String(payload.url || '');
  const data = normalizeResponseData(payload.responseData);
  if (!data)
    return false;

  if (/\/rest\/(?:raid|multiraid)\/start\.json/.test(url)) {
    const battleId = String(data.raid_id || '');
    const isNewBattle = !state.battleId || state.battleId !== battleId;

    if (isNewBattle) {
      Object.assign(state, createEmptyState(), {
        active: true,
        battleId,
        participationId: String(data.twitter?.battle_id || data.raid_id || ''),
        participantLimit: asNumber(data.limit_number) || 1,
        statsTurn: asNumber(data.turn),
      });
      setInitialMembers(state, data.multi_raid_member_info);
      setInitialCharacters(state, data.player?.param);
      state.totalDamage += sumScenarioDamage(data.scenario);
    }
    else {
      state.active = true;
      state.participationId ||= String(data.twitter?.battle_id || data.raid_id || '');
      state.participantLimit = asNumber(data.limit_number) || state.participantLimit || 1;
      state.participantCount = Math.max(
        state.participantCount,
        data.multi_raid_member_info?.length || 1,
      );
      if (state.characterStats.length === 0)
        setInitialCharacters(state, data.player?.param);
    }
    return true;
  }

  const resultMatch = url.match(/\/rest\/(?:raid|multiraid)\/(normal_attack|summon|fatal_chain|ability|group_gauge_action)_result\.json/);
  if (!resultMatch || !state.active)
    return false;

  // 戦闘全体の累計。ターン更新処理から完全に分離する。
  state.totalDamage += sumScenarioDamage(data.scenario);
  updateTurnStats(state, resultMatch[1], data);
  if (data.status?.fellow !== undefined)
    state.participantCount = asNumber(data.status.fellow);
  return true;
};
