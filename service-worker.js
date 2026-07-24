importScripts('route-planner.js', 'background.js');

// 所有者を特定できない追加ダメージを先頭キャラクターへ誤帰属させない版。
calculateCharacterStats = function calculateCharacterStatsSafe(scenario, characters) {
  const result = new Map();
  const getCharacter = (index) => {
    if (index === null || index === undefined)
      return null;
    const number = Number(index);
    if (!Number.isInteger(number) || number < 0)
      return null;
    if (!result.has(number))
      result.set(number, { index: number, hit: 0, debuff: 0, ability: 0, special: 0 });
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
};
