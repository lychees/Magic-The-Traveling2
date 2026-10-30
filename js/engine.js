'use strict';
// engine.js — 从 index.html 按域拆分（plain script，共享全局词法作用域）
function newSide() {
  return { hp: gameConfig.heroHp, maxHp: gameConfig.heroHp, maxMana: 0, mana: 0, burned: 0, fatigue: 0, deck: [], hand: [], board: [], graveyard: [] };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function findDef(name) {
  if (name === '绿龙') return GREEN_DRAGON;
  return CARD_DEFS.find(d => d.name === name);
}

// AI 牌组：与玩家随机牌组同规则（20–30 张），避免牌组张数差异造成疲劳失衡
function buildAIDeck() {
  return shuffle(randomDeckDefs());
}

function initGame(playerDeckDefs, mode, enemyDeckDefs, runBattle) {
  uid = 0;
  logLines = [];
  state = { player: newSide(), enemy: newSide(), phase: 'deploy', round: 0, gameOver: false,
            mode: mode || 'ai', deploySide: 'player', tactics: { player: null, enemy: null },
            battleSpeed: 1, roundSummary: null, _tacticsActive: false, _runBattle: runBattle === true,
            _relicState: { phoenixFeatherUsed: false },
            anims: { attacker: null, shaken: [], heroHit: null, dying: [] }, moraleFx: null };
  state.player.deck = shuffle(playerDeckDefs.slice());
  // pvp：enemy 为玩家2 的牌组；ai：随机 AI 牌组
  state.enemy.deck = enemyDeckDefs && enemyDeckDefs.length ? shuffle(enemyDeckDefs.slice()) : buildAIDeck(); // 闯关模式透传敌方牌组
  for (let i = 0; i < 5; i++) { drawCard('player', true); drawCard('enemy', true); } // 对称开局，初始 5 张
  if (runRelicActive('arcaneTome', 'player')) {
    drawCard('player', true); drawCard('player', true);
    log('【遗物·奥术典籍】本场战斗开局额外摸 2 张牌');
  }
  log(state.mode === 'pvp' ? '战斗开始！（双人对战）' : '战斗开始！');
  startRound();
}

function inRunBattle() {
  return !!(state && state._runBattle && RUN && RUN.active && RUN.inBattle);
}

function runRelicActive(key, side) {
  return side === 'player' && inRunBattle() &&
    Array.isArray(RUN.relics) && RUN.relics.indexOf(key) >= 0;
}

function battleDelay(ms) {
  const speed = state && state.battleSpeed;
  return ms / (speed === 2 || speed === 4 ? speed : 1);
}

function setBattleSpeed(n) {
  const speed = Number(n);
  if (!state || [1, 2, 4].indexOf(speed) < 0 || NET.role === 'spectator') return false;
  if (NET.role === 'guest') {
    clientSend({ t: 'act', kind: 'battleSpeed', value: speed });
    return true;
  }
  state.battleSpeed = speed;
  render();
  return true;
}

function setTactic(side, key, fromGuest) {
  if (!state || state.phase !== 'deploy' || state.gameOver || NET.role === 'spectator') return false;
  if (side !== 'player' && side !== 'enemy') return false;
  if (key === '') key = null;
  if (key !== null && !TACTIC_INFO[key]) return false;
  if (state.mode === 'ai' && side !== 'player') return false;
  if (state.mode === 'pvp' && side !== state.deploySide) return false;
  if (NET.role === 'host' && side !== 'player' && fromGuest !== true) return false;
  if (NET.role === 'guest') {
    if (side !== 'enemy') return false;
    clientSend({ t: 'act', kind: 'tactic', key: key });
    return true;
  }
  state.tactics[side] = key;
  render();
  return true;
}

function sideName(side) {
  if (state && state.mode === 'pvp') {
    if (NET.role) return side === 'player' ? (NET.hostName || '玩家1') : (NET.guestName || '玩家2');
    return side === 'player' ? '玩家1' : '玩家2';
  }
  return side === 'player' ? '你' : '对手';
}
function otherSide(side) { return side === 'player' ? 'enemy' : 'player'; }
// 本机玩家当前操作所用 side（实际权限由 playCard/castUnitSpell 内的 deploySide 校验兜底）
function activeSide() {
  if (NET.role === 'host') return 'player';
  if (NET.role === 'guest') return 'enemy';
  return state.mode === 'pvp' ? state.deploySide : 'player';
}
// 当前视角（下方半场）所在方：离线双人随部署方翻转；联机房主固定玩家1、guest 固定自己、观战随部署方
function viewSide() {
  if (NET.role === 'host') return 'player';
  if (NET.role === 'guest') return 'enemy';
  if (NET.role === 'spectator') return state.phase === 'deploy' ? state.deploySide : 'player';
  return state.mode === 'pvp' && state.phase === 'deploy' ? state.deploySide : 'player';
}

function log(msg) {
  logLines.push(msg);
  if (logLines.length > 60) logLines.shift();
  const el = document.getElementById('log');
  if (el) { el.innerHTML = logLines.map(l => '<div>' + l + '</div>').join(''); el.scrollTop = el.scrollHeight; }
}

function currentRoundSummary() {
  const summary = state && state.roundSummary;
  return summary && summary.round === state.round && !summary.completed ? summary : null;
}

function recordRoundKey(text) {
  const summary = currentRoundSummary();
  if (!summary) return;
  summary.keyResults.push(text);
  if (summary.keyResults.length > 16) summary.keyResults.shift();
}

function beginRoundSummary() {
  const current = currentRoundSummary();
  if (current) {
    current.tactics = { player: state.tactics.player, enemy: state.tactics.enemy };
    return current;
  }
  state.roundSummary = {
    round: state.round,
    tactics: { player: state.tactics.player, enemy: state.tactics.enemy },
    heroDamage: { player: 0, enemy: 0 },
    unitsLost: { player: [], enemy: [] },
    startingHp: { player: state.player.hp, enemy: state.enemy.hp },
    endingHp: { player: state.player.hp, enemy: state.enemy.hp },
    outcome: 'ongoing', completed: false, keyResults: [],
  };
  return state.roundSummary;
}

function finishRoundSummary(outcome) {
  const summary = currentRoundSummary();
  if (!summary) return;
  ['player', 'enemy'].forEach(side => {
    state[side].board.concat(state[side].graveyard).forEach(m => {
      if (m._tacticRally == null) return;
      const amount = m._tacticRally;
      delete m._tacticRally;
      if (amount > 0 && m.curHp > 0) changeMorale(m, -amount);
    });
  });
  state._tacticsActive = false;
  recalcAuras();
  summary.outcome = outcome || 'ongoing';
  summary.endingHp = { player: state.player.hp, enemy: state.enemy.hp };
  if (summary.outcome !== 'ongoing') recordRoundKey('对局结束：' + (summary.outcome === 'draw' ? '双方同归于尽' : sideName(summary.outcome) + '获胜'));
  summary.completed = true;
  const tacticText = side => TACTIC_INFO[summary.tactics[side]] ? TACTIC_INFO[summary.tactics[side]].name : '无';
  log('【轮次总结】第 ' + summary.round + ' 轮：' + sideName('player') + '方英雄受伤 ' + summary.heroDamage.player +
    '，' + sideName('enemy') + '方英雄受伤 ' + summary.heroDamage.enemy +
    '；单位阵亡 ' + summary.unitsLost.player.length + ' / ' + summary.unitsLost.enemy.length +
    '；指令 ' + tacticText('player') + ' / ' + tacticText('enemy'));
}

function damageHero(side, amount) {
  const value = Number(amount);
  const dmg = Number.isFinite(value) ? Math.max(0, value) : 0;
  state[side].hp -= dmg;
  const summary = currentRoundSummary();
  if (summary && dmg > 0) summary.heroDamage[side] += dmg;
  return dmg;
}

function drawCard(side, silent) {
  const p = state[side];
  if (p.deck.length === 0) {
    p.fatigue++;
    damageHero(side, p.fatigue);
    log(sideName(side) + '牌库已空，受到 ' + p.fatigue + ' 点疲劳伤害');
    checkGameOver();
    return;
  }
  const c = p.deck.pop();
  if (p.hand.length >= HAND_LIMIT) { log(sideName(side) + '手牌已满，' + c.name + ' 被烧毁'); return; }
  p.hand.push(c);
  // 双人模式不写摸牌日志（公共日志会泄露手牌信息给对方）
  if (!silent && state.mode === 'ai' && side === 'player') log('你摸到了 ' + c.name);
}

function traitLv(m, prefix) {
  const t = m.traits.find(x => x.startsWith(prefix));
  return t ? parseInt(t.slice(prefix.length), 10) : 0;
}

// 可作为目标的存活单位：非盖牌壳、正面表示
function isTargetable(x) { return !x.isSpellShell && !x.faceDown; }
function targetableUnits(board) { return board.filter(isTargetable); }

// 有效护甲：石化生命未满时视为 4；石像形态守备表示时护甲 +2
function adjArmBonus(p, m) { // 盾墙协防：同排左右相邻的友方单位护甲 +1（多个可叠加）
  const rowMins = p.board.filter(o => o.row === m.row);
  const i = rowMins.indexOf(m);
  let n = 0;
  [rowMins[i - 1], rowMins[i + 1]].forEach(o => { if (o && o.traits.includes('盾墙协防')) n++; });
  return n;
}
function effArmor(m) {
  const side = state.player.board.indexOf(m) >= 0 ? 'player' : 'enemy';
  const bonus = (state._tacticsActive && state.tactics[side] === 'guard' ? 1 : 0) +
    (runRelicActive('stoneAegis', side) ? 1 : 0);
  if (m.traits.includes('石化') && m.curHp < m.maxHp) return 4 + bonus;
  return m.arm + adjArmBonus(state[side], m) + bonus
    + (m.traits.includes('石像形态') && m.defense ? 2 : 0) + ((m.petrified || 0) > 0 ? 3 : 0)
    + (m.traits.includes('居高临下') && m.row === 0 ? 1 : 0); // 居高临下：前排护甲 +1
}

// 有效飞行：守备表示的飞行单位暂时失去飞行效果（可被任何单位攻击、不再被远程加倍）
// 有效飞行：守备表示或处于「落地」形态的飞行单位暂时失去飞行效果
function isFlying(m) {
  return m.traits.includes('飞行') && !m.defense && !m.grounded;
}

// 攻击伤害 = max(0, 攻 - (目标有效护甲 - 护甲穿透))；远程单位攻击飞行单位时伤害加倍
function attackDamage(attacker, target) {
  const pen = traitLv(attacker, '护甲穿透'); // 护甲穿透X：攻击无视目标 X 点护甲
  let dmg = Math.max(0, attacker.atk - Math.max(0, effArmor(target) - pen));
  if (attacker.traits.includes('远程') && isFlying(target)) dmg *= 2;
  if (attacker.traits.includes('破法') && (target.actSpell || (target.actSpells && target.actSpells.length))) dmg *= 2; // 破法：攻击拥有法术的单位伤害翻倍
  if (attacker.traits.includes('背刺') && target.defense) dmg *= 2; // 背刺：攻击守备表示的单位伤害翻倍
  if (attacker.traits.includes('居高临下') && attacker.row === 2) dmg += 2; // 居高临下：后排攻击 +2
  if (attacker.traits.includes('死战') && attacker.curHp <= attacker.maxHp / 2) dmg += 3; // 死战：生命低于一半攻击 +3
  return dmg;
}

function healHero(side, n) {
  const p = state[side];
  const before = p.hp;
  p.hp = Math.min(p.maxHp, p.hp + n);
  if (p.hp > before) { log(sideName(side) + '的英雄恢复了 ' + (p.hp - before) + ' 点生命'); sfx('heal'); }
}

// 每轮部署阶段开始：双方同时 +1 水晶并回满、摸牌、再生/中毒结算
function startRound() {
  finishRoundSummary();
  state.round++;
  state.phase = 'deploy';
  state.tactics = { player: null, enemy: null };
  state._tacticsActive = false;
  recalcAuras();
  beginRoundSummary();
  log('—— 第 ' + state.round + ' 轮 · 部署阶段 ——');
  sfx('phase');
  ['player', 'enemy'].forEach(side => {
    const p = state[side];
    p.maxMana = Math.min(manaCap(), p.maxMana + 1);
    p.mana = Math.max(0, p.maxMana - p.burned);
    if (p.burned > 0) log(sideName(side) + '受到法力燃烧影响，本轮法力 -' + p.burned);
    p.burned = 0;
    p.board.forEach(m => { m.canAttack = true; });
    // 龙女变形：下一轮准备阶段开始时变身并恢复生命（若活到了那时）
    p.board.forEach(m => {
      if (!m.pendingTransform) return;
      m.pendingTransform = false;
      m.name = '绿龙'; m.baseAtk = 8; m.atk = 8; m.arm = 0;
      m.baseMaxHp = 16; m.maxHp = 16; m.curHp = 16;
      m.traits = []; m.spell = null;
      log('【龙女】在准备阶段变形为【绿龙】（8/0/16）！');
      sfx('summon');
      healHero(side, 4);
    });
    // 结算顺序：再生 → 中毒 → 清理死亡
    p.board.forEach(m => {
      const r = traitLv(m, '再生');
      if (r > 0 && m.curHp < m.maxHp) {
        const before = m.curHp;
        m.curHp = Math.min(m.maxHp, m.curHp + r);
        log('【' + m.name + '】再生：恢复 ' + (m.curHp - before) + ' 点生命');
        sfx('heal');
      }
    });
    p.board.forEach(m => {
      if (m.poison > 0) {
        m.curHp -= m.poison;
        log('【' + m.name + '】中毒发作，受到 ' + m.poison + ' 点伤害');
      }
    });
    // 失明：持续回合 -1，结束时报日志
    p.board.forEach(m => {
      if ((m.blind || 0) > 0) { m.blind--; if (m.blind === 0) log('【' + m.name + '】的失明结束了'); }
      if ((m.petrified || 0) > 0) { m.petrified--; if (m.petrified === 0) log('【' + m.name + '】的石化结束了'); }
    });
    cleanupDead(side);
    // 士气：我方战场所有单位同一阵营时全场 +1（两种无影响，x≥3 种 -(x-2)）；
    // 墓园/元素单位与盖牌不参与计算；战场存在（非盖牌）墓园单位时所有单位额外 -1
    const moraleUnits = p.board.filter(m => !moraleImmune(m) && !m.faceDown);
    const hasNecro = p.board.some(m => !m.faceDown && (() => { const d = findDef(m.name); return d && d.race === '墓园'; })());
    if (hasNecro) moraleUnits.forEach(m => changeMorale(m, -1));
    if (moraleUnits.length > 0) {
      const distinct = new Set(moraleUnits.map(m => { const d = findDef(m.name); return d ? d.race : '?'; })).size;
      // 单一阵营 +1；两种不增不减；x(≥3) 种时 -(x-2)
      const dm = distinct === 1 ? 1 : -(distinct - 2);
      moraleUnits.forEach(m => changeMorale(m, dm));
      log(sideName(side) + '士气：' + (distinct === 1 ? '全军同阵营，全场 +1' : distinct + ' 种阵营混杂，全场 ' + (dm > 0 ? '+' : '') + dm) +
        (hasNecro ? '；墓园单位在场，额外 -1' : ''));
    }
    // 单位法力：每轮准备阶段开始自然恢复 1 点（不超过上限）
    p.board.forEach(m => {
      if ((m.actSpell || m.actSpells || m.spellManaMax > 0) && m.spellMana < m.spellManaMax) m.spellMana++;
    });
    // 骷髅王李奥锐刻：亡语标记的单位在准备阶段从墓地归来（放在回蓝之后：返场当轮不再回蓝；视为从墓地召唤，触发生还的宝礼）
    let leoricBack = 0;
    for (let i = p.graveyard.length - 1; i >= 0; i--) {
      const g = p.graveyard[i];
      if (!g._leoricReturn) continue;
      p.graveyard.splice(i, 1);
      if (p.board.length >= BOARD_CAP) { log('【骷髅王李奥锐刻】场上已达上限，未能归来'); continue; }
      const back = summonMinion(side, findDef('骷髅王李奥锐刻'), g.row);
      if (back) { back.spellMana = 0; leoricBack++; log('【骷髅王李奥锐刻】从墓地归来！'); sfx('summon'); }
    }
    lifeBoonProc(side, leoricBack);
    drawCard(side);
  });
  if (inRunBattle() && RUN.modifier === 'skeletons' && !state.gameOver) { const sk = findDef('骷髅'); if (sk && state.enemy.board.length < BOARD_CAP) { summonMinion('enemy', sk, 0); log('【万籁俱寂】敌方召唤了一个【骷髅】到前排'); } }
  checkGameOver();
  render();
  // 双人对战：每轮部署从玩家1 开始；本地热座亮交机隐私屏，联机房主直接广播等待部署
  if (state.mode === 'pvp' && !state.gameOver) {
    state.deploySide = state.round % 2 === 1 ? 'player' : 'enemy'; // 每回合轮换先手
    state._firstSide = state.deploySide; // 记录本轮先手方
    if (NET.role === 'host') {
      log('—— 等待 ' + sideName(state.deploySide) + ' 部署 ——');
      render(); // 触发快照广播
    } else {
      showPassScreen('第 ' + state.round + ' 轮部署 · 请把设备交给' + sideName(state.deploySide), () => { render(); });
    }
  }
}

function makeMinion(def) {
  return {
    uid: ++uid, name: def.name, cost: def.cost, race: def.race,
    atk: def.atk, arm: def.arm, baseAtk: def.atk, baseArm: def.arm, baseMaxHp: def.hp,
    maxHp: def.hp, curHp: def.hp,
    traits: def.traits.slice(), spell: def.spell || null, spellParam: def.spellParam || 0,
    actSpells: def.actSpells ? def.actSpells.map(e => ({ key: e.key, cost: e.cost })) : null, // 一单位多法术（如海洋女巫/海洋术士）
    // 单位法术：部署阶段主动施放（分裂/火球），法力每轮准备阶段开始恢复 1 点
    actSpell: def.actSpell || null, spellCost: def.spellCost || 0,
    spellMana: def.spellMana0 || 0, spellManaMax: def.spellManaMax || 0,
    row: 0, // 0=前排 1=中排 2=后排
    // 无召唤 sickness：部署当轮即可行动。
    // counterLeft = 本战斗阶段剩余反击次数；战斗阶段开始时由 startCombat 重置为 1，
    // 非战斗阶段开始时才重置的随从（如召唤物）默认为 0。
    poison: 0, canAttack: true, counterLeft: 0, _noDR: false,
    // 守备表示：部署阶段可切换。守备时不主动攻击、无限次反击且反击同时结算、被随机选取概率×2、卡面变宽
    defense: false,
    // 落地：飞行单位正面表示时可在 飞行/落地 两种形态间切换；落地时失去飞行效果、落到地面阵型
    grounded: false,
    // 士气 [-10, 10]：正值每点 = 10% 概率额外行动一次；负值每点 = 10% 概率无法行动/无法反击
    morale: def.morale0 || 0,
    // 翻面表示：盖放部署。不会成为攻击目标、不主动攻击；仍每轮恢复法术、可吃到 buff；
    // 翻开时才触发战吼（pendingBattlecry）
    faceDown: false, pendingBattlecry: false,
    // 收回相关：仅「从手牌打出」的随从由 playCard 填写；召唤物/token 保持默认值（不可收回）
    playedRound: 0, costPaid: 0, recallable: false,
  };
}

// 骨龙：打出时除外己方墓地，每张除外牌费用 -1（最低 0）
function effCost(side, def) {
  if (def.spell === 'boneDragon') return Math.max(0, def.cost - state[side].graveyard.length);
  if (def.type === 'spell') {
    // 艾达「高级学术」：任意法术 -1；帕斯卡「高级水系魔法」：水系法术 -1。同类减费只判一次（最低 0）
    const board = state[side].board;
    if (board.some(m => m.traits.includes('高级学术'))) return Math.max(0, def.cost - 1);
    if (def.school === '水' && board.some(m => m.traits.includes('高级水系魔法'))) return Math.max(0, def.cost - 1);
  }
  return def.cost;
}

// ---------- 法术卡牌引擎 ----------
// 法术的合法目标集合（按 target 类型）
function legalSpellTargets(side, def) {
  if (def.target === 'enemyUnit') return state[otherSide(side)].board.filter(m => isTargetable(m));
  if (def.target === 'friendlyUnit') return state[side].board.filter(m => isTargetable(m));
  if (def.target === 'graveUnit') return state.player.graveyard.concat(state.enemy.graveyard).filter(g => !g._isSpell); // 双方墓地的单位（用于判定有无目标）
  return [];
}

// 卡牌三围行（卡面通用：攻/甲/血）
function cardStatsHtml(d) {
  return '<div class="c-stats"><span class="stat-atk">攻' + d.atk + '</span><span class="stat-arm">甲' + d.arm + '</span><span class="stat-hp">血' + d.hp + '</span></div>';
}

// 法术伤害：吃「法术护盾X」减免；伤害致死走正常 cleanupDead/亡语流程
function dealSpellDamage(def, m, n) {
  // 火系魔法免疫：不受火系法术伤害
  if (def.school === '火' && m.traits.includes('火系魔法免疫')) {
    log('【' + m.name + '】火系魔法免疫，不受【' + def.name + '】影响');
    return 0;
  }
  spellHitQueue.push(m.uid); // 记录命中目标（用于法术动画高亮）
  const shield = traitLv(m, '法术护盾');
  const dmg = Math.max(0, n - shield);
  m.curHp -= dmg;
  log('【' + def.name + '】对【' + m.name + '】造成 ' + dmg + ' 点法术伤害' + (shield ? '（法术护盾-' + shield + '）' : ''));
  return dmg;
}

// 法术结算后进墓地（供骨龙减费）；复活会跳过法术条目
function discardSpellToGraveyard(side, def) {
  state[side].graveyard.push({ _isSpell: true, name: def.name, cost: def.cost, atk: 0, arm: 0, maxHp: 0, row: -1 });
}

function summonBuff(s) { if (!s) return; s.baseAtk += 1; s.atk += 1; s.baseMaxHp += 1; s.maxHp += 1; s.curHp += 1; }
function resolveSpellEffect(side, def, target, costPaid) {
  const p = state[side], foeSide = otherSide(side), foe = state[foeSide];
  const highestAtk = arr => arr.slice().sort((a, b) => b.atk - a.atk)[0] || null;
  switch (def.spellEffect) {
    case 'stoneSkin':
      target.baseArm += 3; target.arm += 3;
      log('【护体石肤】：【' + target.name + '】护甲 +3');
      break;
    case 'slow':
      target.baseAtk = Math.max(0, target.baseAtk - 3);
      log('【迟缓】：【' + target.name + '】攻击 -3');
      break;
    case 'earthSpikes': {
      const fr = frontRowOf(foeSide);
      const targets = foe.board.filter(m => m.row === fr);
      if (targets.length === 0) log('【地刺】：敌方前排没有单位，无效果');
      targets.forEach(m => dealSpellDamage(def, m, 3));
      break;
    }
    case 'deathRipple': {
      const targets = [];
      ['player', 'enemy'].forEach(sd => state[sd].board.forEach(m => { if (m.race !== '墓园') targets.push(m); }));
      if (targets.length === 0) log('【死亡波纹】：场上没有非墓园单位，无效果');
      targets.forEach(m => dealSpellDamage(def, m, 3));
      break;
    }
    case 'magicMissile': { // 魔法飞弹：对随机 3 个敌方单位各造成 2 点伤害
      const pool = foe.board.filter(m => isTargetable(m));
      if (!pool.length) log('【魔法飞弹】：没有合法目标');
      for (let i = 0; i < 3 && pool.length; i++) {
        const t = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        dealSpellDamage(def, t, 2);
      }
      break;
    }
    case 'powerWordKill': { // 律令死亡：消灭生命 ≤ 6 的一个敌方单位
      if (target.curHp <= 6) { log('【律令死亡】：【' + target.name + '】被直接消灭'); dealSpellDamage(def, target, target.curHp); }
      else log('【律令死亡】：【' + target.name + '】生命过高（' + target.curHp + ' > 6），无效果');
      break;
    }
    case 'backRowSpikes': { // 冰锥术：对敌方后排所有单位造成 4 点伤害
      const targets = foe.board.filter(m => m.row === 2);
      if (targets.length === 0) log('【冰锥术】：敌方后排没有单位，无效果');
      targets.forEach(m => dealSpellDamage(def, m, 4));
      break;
    }
    case 'entangle': { // 荆棘缠绕：对目标敌方单位造成 2 点伤害并使其攻击 -2
      dealSpellDamage(def, target, 2);
      if (target.curHp > 0) { target.baseAtk = Math.max(0, target.baseAtk - 2); log('【荆棘缠绕】：【' + target.name + '】攻击 -2'); }
      break;
    }
    case 'gate': { // 异界之门：召唤一个【恶鬼】到己方前排
      const d = findDef('恶鬼');
      if (d) { summonMinion(side, d, 0); log('【异界之门】：【恶鬼】应门而来'); }
      break;
    }
    case 'animalSummon': { // 动物召唤：召唤一个【恐狼】到己方前排
      const d = findDef('恐狼');
      if (d) { summonMinion(side, d, 0); log('【动物召唤】：【恐狼】响应了召唤'); }
      break;
    }
    case 'timeStop': { // 时间停止：敌方所有单位失明 1 回合
      foe.board.forEach(m => { m.blind = 1; });
      log('【时间停止】：敌方所有单位失明 1 回合');
      break;
    }
    case 'wish': { // 祈愿术：摸 3 张牌，英雄恢复 6 点生命
      drawCard(side); drawCard(side); drawCard(side);
      healHero(side, 6);
      log('【祈愿术】：摸 3 张牌，英雄恢复 6 点生命');
      break;
    }
    case 'rally': { // 集结号角：我方前排所有单位士气 +2、恢复 2 点生命
      const fr = frontRowOf(side);
      const targets = p.board.filter(m => m.row === fr);
      if (!targets.length) log('【集结号角】：我方前排没有单位，无效果');
      targets.forEach(m => {
        changeMorale(m, 2);
        const before = m.curHp;
        m.curHp = Math.min(m.maxHp, m.curHp + 2);
        if (m.curHp > before) log('【集结号角】：【' + m.name + '】士气 +2，恢复 2 点生命');
      });
      sfx('heal');
      break;
    }
    case 'feint': { // 调虎离山：将目标敌方单位移到其后排
      target.row = 2;
      log('【调虎离山】：【' + target.name + '】被调到了后排');
      break;
    }
    case 'warShout': { // 破胆怒吼：敌方前排所有单位士气 -3 且攻击 -1
      const fr = frontRowOf(foeSide);
      const targets = foe.board.filter(m => m.row === fr);
      if (!targets.length) log('【破胆怒吼】：敌方前排没有单位，无效果');
      targets.forEach(m => {
        changeMorale(m, -3);
        m.baseAtk = Math.max(0, m.baseAtk - 1);
        log('【破胆怒吼】：【' + m.name + '】士气 -3，攻击 -1');
      });
      break;
    }
    case 'sabotage': { // 釜底抽薪：敌方下轮法力 -2
      foe.burned += 2;
      log('【釜底抽薪】：敌方下轮法力 -2');
      break;
    }
    case 'heal':
      // 治疗：可对友方单位使用，也可治疗英雄
      if (target && target.hero) healHero(side, 7);
      else if (target) {
        const before = target.curHp;
        target.curHp = Math.min(target.maxHp, target.curHp + 7);
        log('【治疗】：【' + target.name + '】恢复 ' + (target.curHp - before) + ' 点生命');
        sfx('heal');
      }
      break;
    case 'iceBolt':
      dealSpellDamage(def, target, 4);
      break;
    case 'bless':
      p.board.forEach(m => { m.baseAtk += 2; });
      log('【祝福】：全场友方单位 +2 攻击');
      break;
    case 'dispel': {
      // 增益全部回到卡牌基础值（祭司祈祷等改 base 的增益也一并移除；当前生命不超过基础上限，不白嫖治疗），并解除中毒
      const d0 = findDef(target.name);
      target.baseAtk = d0.atk; target.atk = d0.atk;
      target.arm = d0.arm; target.baseArm = d0.arm;
      target.maxHp = d0.hp; target.baseMaxHp = d0.hp;
      target.curHp = Math.min(target.curHp, target.maxHp);
      target.poison = 0;
      log('【驱散】：【' + target.name + '】的增益被移除并解除中毒');
      break;
    }
    case 'fireballSpell': {
      const roll = 1 + Math.floor(Math.random() * 6);
      log('【火球术】掷出 ' + roll);
      dealSpellDamage(def, target, roll + 1);
      break;
    }
    case 'bloodlust':
      p.board.forEach(m => { m.baseAtk += 3; });
      log('【嗜血奇术】：全场友方单位 +3 攻击');
      break;
    case 'fireShield':
      if (target.traits.includes('反击2')) log('【烈火神盾】：【' + target.name + '】已有该效果，无效');
      else {
        target.traits.push('反击2');
        target.counterLeft = Math.max(target.counterLeft, 2);
        log('【烈火神盾】：【' + target.name + '】获得「反击2」');
      }
      break;
    case 'forbiddenFlame': {
      // 禁断之炎：消耗全部剩余法力 X（已付 2 费后），全场单位各 2X 伤，双方英雄各 X 伤
      const x = p.mana;
      p.mana = 0;
      log('【禁断之炎】：消耗全部剩余 ' + x + ' 点法力！');
      if (x > 0) {
        ['player', 'enemy'].forEach(sd => state[sd].board.slice().forEach(m => dealSpellDamage(def, m, 2 * x)));
        damageHero(side, x);
        damageHero(foeSide, x);
        log('【禁断之炎】：双方英雄各受到 ' + x + ' 点伤害');
      } else {
        log('【禁断之炎】：没有剩余法力，无事发生');
      }
      break;
    }
    case 'doom':
      ['player', 'enemy'].forEach(sd => state[sd].board.slice().forEach(m => dealSpellDamage(def, m, 6)));
      break;
    case 'lightningBolt':
      dealSpellDamage(def, target, 5);
      break;
    case 'chainLightning': {
      const targets = foe.board.slice().sort((a, b) => b.atk - a.atk).slice(0, 3);
      if (targets.length === 0) log('【连锁闪电】：敌方没有单位，无效果');
      targets.forEach(m => dealSpellDamage(def, m, 4));
      break;
    }
    case 'summonAir': {
      const s = summonMinion(side, findDef('气元素'), aiRowFor(findDef('气元素')));
      summonBuff(s);
      if (s) log('【召唤气元素】：召唤了【气元素】（3/0/4 飞行）');
      else log('【召唤气元素】：场上已达上限，无效果');
      break;
    }
    case 'holyShield':
      p.board.forEach(m => { m.baseArm += 2; m.arm += 2; });
      log('【护体神盾】：全场友方单位护甲 +2');
      break;
    case 'meteor': {
      // 目标及同排左右相邻各 3 伤（与范围攻击的相邻口径一致）
      const rowMins = foe.board.filter(o => o.row === target.row);
      const di = rowMins.indexOf(target);
      [target, rowMins[di - 1], rowMins[di + 1]].forEach(o => { if (o) dealSpellDamage(def, o, 4); });
      break;
    }
    case 'revive': {
      // 复活己方墓地最后死亡的单位卡（跳过法术条目）到其原排，满员无效
      let idx = -1;
      for (let i = p.graveyard.length - 1; i >= 0; i--) { if (!p.graveyard[i]._isSpell) { idx = i; break; } }
      if (idx < 0) { log('【复活术】：墓地为空，无效果'); break; }
      if (p.board.length >= BOARD_CAP) { log('【复活术】：场上已达上限，无效果'); break; }
      const dead = p.graveyard.splice(idx, 1)[0];
      const s = summonMinion(side, findDef(dead.name), dead.row);
      if (s) log('【复活术】：【' + s.name + '】在' + ROW_NAMES[s.row] + '复活归来！');
      lifeBoonProc(side, 1); // 生还的宝礼
      break;
    }
    case 'healingWave':
      p.board.forEach(m => {
        const before = m.curHp;
        m.curHp = Math.min(m.maxHp, m.curHp + 4);
        if (m.curHp > before) log('【治疗波动】：【' + m.name + '】恢复 ' + (m.curHp - before) + ' 点生命');
      });
      break;
    case 'mirror': {
      // 同排召唤目标的复制（当前攻/甲/血/特性/守备姿态），token 化不可收回
      if (p.board.length >= BOARD_CAP) { log('【镜像术】：场上已达上限，无效果'); break; }
      const copy = Object.assign({}, target, { uid: ++uid, recallable: false, playedRound: 0, costPaid: 0 });
      p.board.splice(p.board.indexOf(target) + 1, 0, copy);
      log('【镜像术】：召唤了【' + target.name + '】的镜像（' + copy.atk + '/' + effArmor(copy) + '/' + copy.curHp + '）');
      sfx('summon');
      break;
    }
    case 'teleport': {
      // 目标友方单位收回手牌：不进墓地、不触发亡语、不退法力
      if (p.hand.length >= HAND_LIMIT) { log('【传送】：手牌已满，无效果'); break; }
      p.board = p.board.filter(x => x !== target);
      p.hand.push(findDef(target.name));
      log('【传送】：【' + target.name + '】被送回手牌');
      break;
    }
    case 'sear':
      dealSpellDamage(def, target, 3);
      break;
    case 'hellfire':
      foe.board.slice().forEach(m => dealSpellDamage(def, m, 3));
      break;
    case 'blind': {
      if (target.traits.includes('无目') || mindImmune(target)) { log('【双目失明】：【' + target.name + '】免疫失明'); break; }
      const shield = traitLv(target, '法术护盾');
      const dur = Math.max(0, p.mana + 1 - shield); // p.mana 为施放后剩余法力
      if (dur <= 0) { log('【双目失明】：【' + target.name + '】依靠法术护盾抵挡了失明'); break; }
      target.blind = dur;
      log('【双目失明】：【' + target.name + '】失明 ' + dur + ' 回合（无法攻击/反击/施法/切换形态）');
      break;
    }
    case 'confuse':
      if (mindImmune(target)) { log('【混乱】：【' + target.name + '】免疫心智魔法'); break; }
      target.morale = Math.max(-10, (target.morale || 0) - 6);
      log('【混乱】：【' + target.name + '】士气 -6（当前 ' + target.morale + '）');
      break;
    case 'tornado': {
      const flyers = foe.board.filter(m => isFlying(m));
      if (flyers.length === 0) { log('【龙卷】：敌方没有飞行单位，未能生效'); break; }
      const t = flyers[Math.floor(Math.random() * flyers.length)];
      t.curHp = 0;
      log('【龙卷】：消灭了飞行单位【' + t.name + '】！');
      break;
    }
    case 'darkSacrifice': {
      if (!target || (target.sacHand == null && target.sacUid == null)) {
        // 盖放翻开等无指定载荷：随机献祭一张己方卡牌
        const cands = [];
        p.hand.forEach((c, i2) => cands.push({ sacHand: i2 }));
        p.board.forEach(u => { if (!u.isSpellShell) cands.push({ sacUid: u.uid }); });
        if (cands.length === 0) { log('【恶魔的祭品】：没有可献祭的卡牌'); break; }
        target = cands[Math.floor(Math.random() * cands.length)];
      }
      if (target.sacHand != null) {
        const c = p.hand.splice(target.sacHand, 1)[0];
        if (c) { p.graveyard.push({ name: c.name, cost: c.cost, atk: c.atk || 0, arm: c.arm || 0, maxHp: c.hp || 0, row: -1 }); log('【恶魔的祭品】：将手牌【' + c.name + '】送入墓地'); }
      } else {
        const v = p.board.find(x => x.uid === target.sacUid);
        if (v) { v.curHp = 0; log('【恶魔的祭品】：消灭了己方【' + v.name + '】'); }
      }
      log('【恶魔的祭品】：' + sideName(side) + '摸两张牌');
      sfx('flip');
      drawCard(side);
      drawCard(side);
      break;
    }
    case 'lifeBoon':
      target.boonOfLife = true;
      log('【生还的宝礼】：【' + target.name + '】获得生还的宝礼（在场时，我方每次从墓地召唤卡牌都摸一张牌）');
      sfx('heal');
      break;
    case 'arcaneDraw':
      log('【奥术智慧】：' + sideName(side) + '摸两张牌');
      sfx('flip');
      drawCard(side);
      drawCard(side);
      break;
    case 'inspire':
      p.board.forEach(m => { m.morale = Math.min(10, (m.morale || 0) + 3); });
      log('【鼓舞】：全场友方单位士气 +3');
      break;
    case 'inspireAll':
      p.board.forEach(m => changeMorale(m, 3));
      log('【欢欣鼓舞】：我方全场士气 +3');
      break;
    case 'dreadAll':
      foe.board.forEach(m => { if (mindImmune(m)) log('【' + m.name + '】免疫心智魔法'); else changeMorale(m, -3); });
      log('【悲痛欲绝】：敌方全场士气 -3');
      break;
    case 'summonThunder': {
      const s = summonMinion(side, findDef('雷元素'), AIR_ROW);
      summonBuff(s);
      if (s) log('【召唤雷元素】：在空中召唤了【雷元素】（3/0/5 飞行）');
      else log('【召唤雷元素】：场上已达上限，无效果');
      break;
    }
    case 'thunderBolt':
      dealSpellDamage(def, target, 9);
      break;
    case 'animateDead': {
      // 聚灵奇术：把选中的墓园单位从墓地直接召唤回场（满血新实例，双方墓地均可）
      const picks = (target && target.picks) || [];
      if (picks.length === 0) { log('【聚灵奇术】：没有选择任何单位'); break; }
      const bySide = { player: [], enemy: [] };
      picks.forEach(pk => bySide[pk.graveSide].push(pk.graveIndex));
      let n = 0;
      ['player', 'enemy'].forEach(sd => {
        bySide[sd].sort((a, b) => b - a).forEach(gi => { // 从大到小 splice 防错位
          const g = state[sd].graveyard.splice(gi, 1)[0];
          if (!g) return;
          if (p.board.length >= BOARD_CAP) { state[sd].graveyard.push(g); return; }
          const s = summonMinion(side, findDef(g.name), g.row);
          if (s) n++;
          else state[sd].graveyard.push(g);
        });
      });
      log('【聚灵奇术】：从墓地召唤了 ' + n + ' 个墓园单位回场（共消耗 ' + (costPaid || 0) + ' 点法力）！');
      lifeBoonProc(side, n); // 生还的宝礼：每个从墓地召回的单位摸一张
      break;
    }
    case 'summonEarth': {
      const s = summonMinion(side, findDef('土元素'), aiRowFor(findDef('土元素')));
      summonBuff(s);
      if (s) log('【召唤土元素】：召唤了【土元素】（5/1/7）');
      else log('【召唤土元素】：场上已达上限，无效果');
      break;
    }
    case 'quicksand': {
      const fr = frontRowOf(foeSide);
      const targets = foe.board.filter(m => m.row === fr);
      if (targets.length === 0) { log('【流沙】：敌方前排没有单位，无效果'); break; }
      targets.forEach(m => { m.baseAtk = Math.max(0, m.baseAtk - 2); });
      log('【流沙】：敌方前排 ' + targets.length + ' 个单位攻击 -1');
      break;
    }
    case 'forget': {
      if (mindImmune(target)) { log('【失忆】：【' + target.name + '】免疫心智魔法'); break; }
      const i = target.traits.indexOf('远程');
      if (i < 0) log('【失忆】：【' + target.name + '】没有远程特性，无效');
      else {
        target.traits.splice(i, 1);
        log('【失忆】：【' + target.name + '】失去了「远程」特性');
      }
      break;
    }
    case 'summonWater': {
      const s = summonMinion(side, findDef('水元素'), aiRowFor(findDef('水元素')));
      summonBuff(s);
      if (s) log('【召唤水元素】：召唤了【水元素】（2/0/6）');
      else log('【召唤水元素】：场上已达上限，无效果');
      break;
    }
    case 'meteorShower': {
      // 随机至多 3 个敌方单位各 2 伤；守备表示加权 ×2、不重复选取
      const pool = foe.board.slice();
      const targets = [];
      while (targets.length < 3 && pool.length > 0) {
        const t = weightedPick(pool);
        targets.push(t);
        pool.splice(pool.indexOf(t), 1);
      }
      if (targets.length === 0) log('【流星火雨】：敌方没有单位，无效果');
      targets.forEach(m => dealSpellDamage(def, m, 2));
      break;
    }
    case 'summonFire': {
      const s = summonMinion(side, findDef('火元素'), aiRowFor(findDef('火元素')));
      summonBuff(s);
      if (s) {
        s.traits.push('法术护盾2'); // 火系魔法免疫（近似：法术护盾2）
        log('【召唤火元素】：召唤了【火元素】（5/0/5，火系魔法免疫）');
      } else log('【召唤火元素】：场上已达上限，无效果');
      break;
    }
    case 'frenzy':
      target.baseAtk += 4;
      target.poison = Math.max(target.poison, 1);
      log('【狂暴】：【' + target.name + '】攻击 +3 并中毒 Lv1');
      break;
    case 'twister': {
      // 随机重排敌方阵型：地面单位随机分配到前/中/后三排，飞行单位不动
      const ground = foe.board.filter(m => !isFlying(m) && !m.isSpellShell);
      ground.forEach(m => { m.row = Math.floor(Math.random() * 3); });
      log('【龙卷风】：敌方 ' + ground.length + ' 个地面单位被吹散重排（飞行单位不动）');
      break;
    }
    case 'airShield':
      if (target.traits.includes('法术护盾3')) log('【大气神盾】：【' + target.name + '】已有该效果，无效');
      else {
        target.traits.push('法术护盾3');
        log('【大气神盾】：【' + target.name + '】获得「法术护盾3」');
      }
      break;
    case 'raiseSkeletons': {
      // 除外目标墓地的一个单位，召唤 ceil(其费用/2)+1 个骷髅兵到我方前排
      const g = state[target.graveSide].graveyard;
      const dead = g.splice(target.graveIndex, 1)[0];
      const x = dead.cost || 0;
      const n = Math.ceil(x / 2) + 1;
      let summoned = 0;
      for (let i = 0; i < n && p.board.length < BOARD_CAP; i++) {
        if (summonMinion(side, findDef('骷髅'), 0)) summoned++;
      }
      log('【召唤骷髅兵】：除外了' + (target.graveSide === side ? '我方' : '敌方') + '墓地的【' + dead.name + '】（费用 ' + x + '），召唤 ' + summoned + ' 个骷髅兵到前排');
      break;
    }
    case 'slimeSwarm': {
      // 消耗所有剩余法力（costPaid）：等量史莱姆到前排；>4 时每 4 个换 1 个巨型史莱姆
      const x = costPaid || 0;
      const giants = x > 4 ? Math.floor(x / 4) : 0;
      const slimes = x - giants * 4;
      let nSlime = 0, nGiant = 0;
      for (let i = 0; i < slimes && p.board.length < BOARD_CAP; i++) if (summonMinion(side, findDef('史莱姆'), 0)) nSlime++;
      for (let i = 0; i < giants && p.board.length < BOARD_CAP; i++) if (summonMinion(side, findDef('巨型史莱姆'), 0)) nGiant++;
      log('【召唤史莱姆】：消耗全部 ' + x + ' 点法力，' +
        (nGiant > 0 ? nGiant + ' 个巨型史莱姆' + (nSlime > 0 ? ' 和 ' : '') : '') +
        (nSlime > 0 ? nSlime + ' 个史莱姆' : '') + '涌入前排！');
      break;
    }
    case 'vortex': {
      // 旋涡：随机至多 2 个敌方单位各 3 伤（守备加权、不重复，流星火雨式选取）
      const pool = foe.board.slice();
      const targets = [];
      while (targets.length < 2 && pool.length > 0) {
        const t = weightedPick(pool);
        targets.push(t);
        pool.splice(pool.indexOf(t), 1);
      }
      if (targets.length === 0) log('【旋涡】：敌方没有单位，无效果');
      targets.forEach(m => dealSpellDamage(def, m, 3));
      break;
    }
  }
}

// 盖放的法术卡（场上的盖牌壳，不是单位：不可攻击/不被选为目标；翻开时结算）
function makeSpellShell(side, def, row) {
  return {
    uid: ++uid, name: def.name, cost: def.cost, race: '中立',
    atk: 0, arm: 0, baseAtk: 0, baseMaxHp: 1, maxHp: 1, curHp: 1,
    traits: [], spell: null, spellParam: 0,
    actSpell: null, spellCost: 0, spellMana: 0, spellManaMax: 0,
    row: row == null ? 1 : row, poison: 0, canAttack: false, counterLeft: 0, _noDR: false,
    defense: false, morale: 0, faceDown: true, pendingBattlecry: false,
    playedRound: state.round, costPaid: 0, recallable: false,
    isSpellShell: true, spellDef: def,
  };
}

// 打出法术卡（playCard 的法术分支）：none 直接结算；target 类需合法目标；faceDown 则盖放成壳
function playSpellCard(side, idx, targetUid, faceDown) {
  const p = state[side];
  const def = p.hand[idx];
  let cost = effCost(side, def);
  if (def.spellEffect === 'slimeSwarm') {
    cost = p.mana; // 召唤史莱姆：消耗所有剩余法力
    if (cost < 1) { if (state.mode === 'pvp' || side === 'player') log('【' + def.name + '】没有剩余法力可消耗'); return false; }
  }
  if (cost > p.mana) return false;
  if (faceDown) {
    if (!gameConfig.allowSet) { log('本局已禁用盖放'); return false; }
    if (p.board.length >= BOARD_CAP) { if (state.mode === 'pvp' || side === 'player') log('场上使魔已达上限（' + BOARD_CAP + '）'); return false; }
    p.mana -= cost;
    p.hand.splice(idx, 1);
    const shell = makeSpellShell(side, def, 1);
    p.board.push(shell);
    log(sideName(side) + '盖放了一张法术卡');
    sfx('summon');
    render();
    return shell;
  }
  let target = null;
  if (def.spellEffect === 'animateDead') {
    // 聚灵奇术多选载荷 {picks:[{graveSide, graveIndex}]}：逐项校验墓园单位且总费用 ≤ 剩余法力 ×2
    const budget = Math.max(0, p.mana - cost) * 2;
    const picks = targetUid && targetUid.picks;
    let total = 0, valid = !!picks && picks.length > 0;
    if (valid) picks.forEach(pk => {
      const g = state[pk.graveSide] && state[pk.graveSide].graveyard[pk.graveIndex];
      const gd = g && !g._isSpell && findDef(g.name);
      if (!gd || gd.race !== '墓园') valid = false;
      else total += g.cost || 0;
    });
    if (!valid || total > budget) return false;
    // 选定后再消耗 ⌈所选费用总和/2⌉ 点法力（与预算等价双保险：须付得起）
    const extraCost = Math.ceil(total / 2);
    if (p.mana - cost < extraCost) return false;
    cost = cost + extraCost;
    target = { picks: picks, budget: budget, extraCost: extraCost };
  } else if (def.target === 'graveUnit') {
    // 墓地选目标：targetUid 为 {graveSide, graveIndex} 载荷
    const g = targetUid && state[targetUid.graveSide] && state[targetUid.graveSide].graveyard;
    if (!g || !g[targetUid.graveIndex] || g[targetUid.graveIndex]._isSpell) return false;
    target = targetUid;
  } else if (def.target !== 'none') {
    const pool = legalSpellTargets(side, def);
    if (pool.length === 0 && !(def.spellEffect === 'heal' && targetUid && targetUid.hero)) { if (state.mode === 'pvp' || side === 'player') log('【' + def.name + '】没有合法目标'); return false; }
    if (def.spellEffect === 'heal' && targetUid && targetUid.hero) target = { hero: true }; // 治疗可直接选英雄
    else {
      target = pool.find(m => m.uid === targetUid) || null;
      if (!target) return false;
    }
  }
  if (def.spellEffect === 'darkSacrifice') {
    if (targetUid && targetUid.sacHand != null && targetUid.sacHand > idx) targetUid = { sacHand: targetUid.sacHand - 1 };
    target = targetUid; // 祭品载荷（{sacHand} 或 {sacUid}）
  }
  p.mana -= cost;
  p.hand.splice(idx, 1);
  log(sideName(side) + '施放了法术【' + def.name + '】');
  sfx('spellcast');
  spellHitQueue = [];
  resolveSpellEffect(side, def, target, cost);
  discardSpellToGraveyard(side, def);
  cleanupAllDead();
  recalcAuras();
  checkGameOver();
  // 法术动画：全屏系别色闪光 + 命中目标高亮
  const schColor = (SCHOOL_INFO[def.school] || {}).color || '#c9a0f0';
  const fxTargets = spellHitQueue.slice();
  if (target && target.uid != null && fxTargets.indexOf(target.uid) < 0) fxTargets.push(target.uid);
  spellFx(schColor, def.name, fxTargets);
  render();
  return true;
}

function summonMinion(side, def, row) {
  const p = state[side];
  if (p.board.length >= BOARD_CAP) return null;
  const m = makeMinion(def);
  if (inRunBattle() && side === 'enemy' && RUN.modifier === 'dragon') { m.baseAtk += 1; m.atk += 1; } // Boss 规则：巨龙威压
  m.row = row == null ? 0 : row;
  p.board.push(m);
  if (isEpicUnit(def)) epicSummonFx(def, m); // 高费/巨型单位降临动画
  return m;
}

// AI / 自动布阵启发式：远程 → 后排；血厚(maxHp≥8) → 前排；其余 → 中排
const AIR_ROW = 3; // 空中：飞行单位不涉及前中后排，悬浮在战场上方，可自由拖动排序

function aiRowFor(def) {
  if (def.traits.includes('飞行')) return AIR_ROW;
  if (def.traits.includes('远程')) return 2;
  if (def.hp >= 8) return 0;
  if (def.cost <= 2 || def.hp <= 3) return 0; // 低费/脆皮前置当炮灰，掩护后排
  return 1;
}

const ROW_NAMES = ['前排', '中排', '后排', '空中'];

const SPELL_FX_TEXT = {
  stoneSkin: '目标友方单位护甲 +3（永久）',
  slow: '目标敌方单位攻击 -3（最低 0）',
  earthSpikes: '对敌方前排所有单位造成 3 点伤害',
  deathRipple: '对双方场上所有非墓园单位造成 3 点伤害',
  heal: '恢复 7 点生命：选择一个友方单位治疗，或点击己方英雄治疗英雄',
  iceBolt: '对目标敌方单位造成 4 点伤害',
  bless: '全场友方单位 +2 攻击',
  dispel: '移除目标敌方单位全部增益并解除中毒',
  fireballSpell: '对目标敌方单位造成 2~7 点伤害',
  bloodlust: '全场友方单位 +3 攻击',
  fireShield: '目标友方单位获得「反击2」（重复无效）',
  doom: '对双方场上所有单位造成 6 点伤害',
  forbiddenFlame: '消耗所有剩余法力 X：对双方场上所有单位各造成 2X 点伤害，双方英雄各受到 X 点伤害',
  lightningBolt: '对目标敌方单位造成 5 点伤害',
  chainLightning: '对最多 3 个敌方单位各造成 4 点伤害（从攻击最高者开始）',
  summonAir: '召唤一个【气元素】（4/0/5 飞行）',
  holyShield: '全场友方单位护甲 +2',
  meteor: '对目标及同排左右相邻单位各造成 4 点伤害',
  revive: '从己方墓地复活最后死亡的一张单位卡到其原排',
  healingWave: '全场友方单位恢复 4 点生命',
  mirror: '在同排召唤一个目标友方单位的复制（复制当前数值与姿态）',
  teleport: '将目标友方单位收回手牌（不退法力）',
  sear: '对目标敌方单位造成 3 点伤害',
  hellfire: '对敌方全场造成 3 点伤害',
  confuse: '目标敌方单位士气 -6（最低 -10）',
  blind: '目标敌方单位失明：无法攻击/反击/施放法术/切换形态，持续（施放后剩余法力 +1 − 目标法术护盾）回合',
  arcaneDraw: '摸两张牌',
  darkSacrifice: '将一张手牌或场上的随从送入墓地，摸两张牌',
  lifeBoon: '赋予一个友方单位「生还的宝礼」：其在场时，每当我方从墓地召唤卡牌进入手牌或战场，摸一张牌',
  tornado: '消灭一个随机敌方飞行单位',
  inspire: '全场友方单位士气 +3（最高 10）',
  inspireAll: '我方所有单位士气 +3（欢欣鼓舞）',
  dreadAll: '敌方所有单位士气 -3（悲痛欲绝）',
  summonThunder: '在空中区域召唤一个【雷元素】（4/0/6 飞行）',
  thunderBolt: '对目标敌方单位造成 9 点伤害',
  animateDead: '从双方墓地中至多选择费用总和不超过（剩余法力 ×2）的墓园单位，直接召唤回场上；选定后再消耗（所选费用总和 ÷2 向上取整）点法力',
  summonEarth: '召唤一个【土元素】（5/1/7）',
  quicksand: '敌方前排所有单位攻击 -2（最低 0）',
  forget: '移除目标敌方单位的「远程」特性',
  summonWater: '召唤一个【水元素】（3/0/7）',
  meteorShower: '对随机至多 3 个敌方单位各造成 2 点伤害（守备加权，不重复）',
  summonFire: '召唤一个【火元素】（5/0/5，带火系魔法免疫）',
  frenzy: '目标友方单位攻击 +4 并中毒 Lv1',
  twister: '随机重排敌方阵型：地面单位随机分配到前/中/后三排（飞行单位不动）',
  airShield: '目标友方单位获得「法术护盾3」（重复无效）',
  magicMissile: '对随机 3 个敌方单位各造成 2 点伤害',
  powerWordKill: '消灭生命 ≤ 6 的一个敌方单位',
  backRowSpikes: '对敌方后排所有单位造成 4 点伤害',
  entangle: '对目标敌方单位造成 2 点伤害并使其攻击 -2',
  gate: '召唤一个【恶鬼】到己方前排',
  animalSummon: '召唤一个【恐狼】到己方前排',
  timeStop: '敌方所有单位失明 1 回合（无法攻击/反击/施法/切换形态）',
  wish: '摸 3 张牌，英雄恢复 6 点生命',
  rally: '我方前排所有单位士气 +2、恢复 2 点生命',
  feint: '将目标敌方单位移到其后排',
  warShout: '敌方前排所有单位士气 -3 且攻击 -1',
  sabotage: '敌方下轮法力 -2',
  raiseSkeletons: '选择敌方或我方墓地任意一个单位除外，召唤（其费用÷2 向上取整 + 1）个骷髅兵到我方前排',
  slimeSwarm: '消耗所有剩余法力，召唤等量史莱姆到前排；数量大于 4 时每 4 个史莱姆换成 1 个巨型史莱姆',
  vortex: '对随机至多 2 个敌方单位各造成 3 点伤害（守备加权，不重复）',
};

// 对方「最前排」：有随从的最小 row（盖放的法术壳不占排）
function frontRowOf(side) {
  const b = state[side].board.filter(m => !m.isSpellShell);
  if (b.length === 0) return -1;
  return Math.min.apply(null, b.map(m => m.row));
}

// ---------- 战场宽度（几何遮挡） ----------
// 每排随从从左到右依次占宽：普通卡占 1，守备表示占 2；各排居中对齐（战场宽度 = 各排宽度最大值）。
// 前排会遮挡正后方同宽度的区域；近战单位只能攻击「暴露宽度 > 0」的目标，并按暴露宽度加权随机选取。
function cardWidth(m) { return m.defense ? 2 : 1; }

// 每排每张卡的水平区间 [{m, x0, x1}]（居中对齐）；飞行单位漂浮在空中，不参与宽度计算
function rowSpans(board) {
  const grounded = board.filter(m => !isFlying(m));
  const widths = [0, 1, 2].map(r => grounded.filter(m => m.row === r).reduce((s, m) => s + cardWidth(m), 0));
  const W = Math.max(1, widths[0], widths[1], widths[2]);
  const spans = {};
  [0, 1, 2].forEach(r => {
    const ms = grounded.filter(m => m.row === r);
    let x = (W - widths[r]) / 2;
    spans[r] = ms.map(m => { const s = { m: m, x0: x, x1: x + cardWidth(m) }; x += cardWidth(m); return s; });
  });
  return spans;
}

// 暴露宽度 = 自身宽度 − 被前方各排（row 更小）遮挡的并集宽度
function exposure(m, foeSide) {
  const spans = rowSpans(state[foeSide].board);
  const rowList = spans[m.row];
  if (!rowList) return cardWidth(m); // 不在地面排（如空中区域）：完全暴露
  const mine = rowList.find(s => s.m === m);
  if (!mine) return cardWidth(m);
  const iv = [];
  for (let r = 0; r < m.row; r++) {
    spans[r].forEach(s => {
      const lo = Math.max(mine.x0, s.x0), hi = Math.min(mine.x1, s.x1);
      if (hi > lo) iv.push([lo, hi]);
    });
  }
  iv.sort((a, b) => a[0] - b[0]);
  let covered = 0, cur = null;
  iv.forEach(pair => {
    const lo = pair[0], hi = pair[1];
    if (!cur || lo > cur[1]) { if (cur) covered += cur[1] - cur[0]; cur = [lo, hi]; }
    else cur[1] = Math.max(cur[1], hi);
  });
  if (cur) covered += cur[1] - cur[0];
  return Math.max(0, (mine.x1 - mine.x0) - covered);
}

// 近战目标池：[{t, w=暴露宽度}]，只含暴露宽度 > 0 且飞行/盖牌规则通过的随从；刺客无视遮挡、权重 = 1+排（优先靠后）
function meleeTargets(attacker, foeSide) {
  const foe = state[foeSide];
  return foe.board
    .filter(t => (!t.faceDown || t.defense) && canTarget(attacker, t))
    .map(t => ({ t: t, w: attacker.traits.includes('刺客') ? 1 + t.row : exposure(t, foeSide) })) // 刺客：无视阻挡，权重偏向靠后排
    .filter(x => x.w > 0);
}

// 合法随从目标：飞行限制不变；远程任意排；近战按战场宽度模型（只能打暴露宽度 > 0 的）
function legalMinionTargets(attacker, foeSide) {
  const foe = state[foeSide];
  if (foe.board.length === 0) return [];
  if (attacker.traits.includes('远程')) {
    // 远程无视遮挡：翻面表示的单位仍不可选中，盖牌守备可以（被攻击前会揭示）
    return foe.board.filter(t => (!t.faceDown || t.defense) && canTarget(attacker, t));
  }
  return meleeTargets(attacker, foeSide).map(x => x.t);
}

// 只有对方场上完全无随从时才能攻击英雄
function canHitHero(attacker, foeSide) {
  if (state[foeSide].board.length === 0) return true;
  // 必须打完所有守备表示的单位才能攻击英雄（守备墙；盖牌守备也算——它们可以被攻击了）
  if (state[foeSide].board.some(m => m.defense)) return false;
  // 对面有远程单位时，必须先清掉远程单位才能攻击英雄（远程防线；盖牌非守备的不算）
  if (state[foeSide].board.some(m => m.traits.includes('远程') && (!m.faceDown || m.defense))) return false;
  // 对方场上所有随从都无法成为该攻击者的合法目标时（如对面全是飞行单位而攻击者是近战），
  // 可以直接攻击英雄——够不到的单位不构成对英雄的保护
  return legalMinionTargets(attacker, foeSide).length === 0;
}

// 反击合法性：不考虑战场宽度遮挡（躲在掩体后也会被反击），仅保留飞行限制（地面近战够不到飞行单位）；
// 骑兵：速度翻倍；攻击时若自身速度大于对方两倍则不触发反击——除非防守方有「拒马」（可反击骑兵）；
// 远程单位的攻击不会触发反击。
// 远程单位的攻击不会触发反击；「不受反击」特性的单位攻击同样不会触发反击（包括守备表示的同时结算反击）。
// 觉醒X：需被攻击 X 次后才能攻击/反击/切换守备表示（m._awaken 计数）
function awake(m) {
  const need = traitLv(m, '觉醒');
  return need === 0 || (m._awaken || 0) >= need;
}

function canCounter(defender, attacker, attackerSide) {
  if (defender.blind) return false; // 失明无法反击
  if ((defender.petrified || 0) > 0) return false; // 被石化无法反击
  if (!awake(defender)) return false; // 未觉醒无法反击
  if (attacker.traits.includes('远程') || attacker.traits.includes('不受反击')) return false;
  if (attacker.traits.includes('骑兵') && !defender.traits.includes('拒马') &&
      speedOf(attacker) > 2 * speedOf(defender)) return false; // 速度大于对方两倍：免反击
  return canTarget(defender, attacker); // 反击不考虑战场宽度遮挡，仅保留飞行限制
}

// 拖拽布阵：移动随从到 row 排；beforeUid 非空则插入其前面，否则排到该排末尾。side 默认为当前部署方
function moveMinion(uid, row, beforeUid, side) {
  const p = state[side || activeSide()];
  if (state.mode === 'pvp' && side && side !== state.deploySide) return false; // 联机/热座：非部署方不可动
  const m = p.board.find(x => x.uid === uid);
  if (!m) return false;
  // 飞行单位不涉及前中后排：只能悬浮在空中区域（row=3）；地面单位不能拖入空中
  if (isFlying(m)) row = AIR_ROW;
  else if (row === AIR_ROW) return false;
  m.row = row;
  p.board = p.board.filter(x => x !== m);
  if (beforeUid != null) {
    const i = p.board.findIndex(x => x.uid === beforeUid);
    if (i >= 0) { p.board.splice(i, 0, m); recalcAuras(); return true; }
  }
  p.board.push(m);
  recalcAuras();
  return true;
}

// 收回：部署阶段把「本轮刚从手牌打出且无入场效果」的随从收回手牌，退还实际支付的法力。side 默认为当前部署方
function recallMinion(uid, side) {
  if (!state || state.phase !== 'deploy' || state.gameOver) return false;
  if (state.mode === 'pvp' && side && side !== state.deploySide) return false; // 非部署方不可收回
  const p = state[side || activeSide()];
  const m = p.board.find(x => x.uid === uid);
  if (!m) return false;
  if (!(m.recallable && m.playedRound === state.round)) {
    if (m.playedRound === state.round && !m.recallable) log('【' + m.name + '】的入场效果已触发，无法收回');
    return false;
  }
  // 带单位法术的卡：部署回合若已使用过法术则不可收回
  if (m.actSpell && m._usedSpell) { log('【' + m.name + '】的法术已使用，无法收回'); return false; }
  if (p.hand.length >= HAND_LIMIT) { log('手牌已满，无法收回【' + m.name + '】'); return false; }
  p.board = p.board.filter(x => x !== m);
  p.hand.push(findDef(m.name)); // 不涉及墓地/亡语
  p.mana = Math.min(manaCap(), p.mana + m.costPaid);
  log(sideName(side || activeSide()) + '收回了【' + m.name + '】，退还 ' + m.costPaid + ' 点法力');
  recalcAuras(); // 三姐妹光环等照旧重算
  render();
  return true;
}

// 三姐妹光环：场上每个带三姐妹词条的单位，使其它名称包含「鹰身女妖」的单位 +2攻/+2血（可叠加）
// 恐狼光环：同排左右相邻的友方随从 +1 攻击（多只可叠加）
function adjAtkBonus(p, m) {
  const rowMins = p.board.filter(o => o.row === m.row);
  const i = rowMins.indexOf(m);
  let n = 0;
  [rowMins[i - 1], rowMins[i + 1]].forEach(o => { if (o && o.traits.includes('恐狼光环')) n++; });
  return n;
}

// 英灵感召：全场所有其它参与士气结算的单位都处于正士气时，自身 +1 攻
function inspireBonus(m) {
  if (!m.traits.includes('英灵感召')) return 0;
  const all = state.player.board.concat(state.enemy.board)
    .filter(o => o !== m && !o.faceDown && !moraleImmune(o));
  return all.length > 0 && all.every(o => (o.morale || 0) > 0) ? 1 : 0;
}
function recalcAuras() {
  ['player', 'enemy'].forEach(side => {
    const p = state[side];
    const sisters = p.board.filter(o => o.traits.includes('三姐妹')); // 三姐妹：每个使其它「鹰身女妖」+2攻/+2血
    const koboldLead = p.board.filter(o => o.traits.includes('狗头人领袖')).length; // 狗头人工长：每个使所有狗头人 +1攻（含自身，可叠加）
    p.board.forEach(m => {
      const b = m.name.includes('鹰身女妖') ? 2 * sisters.filter(o => o !== m).length : 0;
      const newMax = m.baseMaxHp + b;
      const delta = newMax - m.maxHp;
      m.maxHp = newMax;
      if (delta !== 0) m.curHp = Math.max(1, m.curHp + delta);
      const tacticAtk = state._tacticsActive && state.tactics[side] === 'assault' ? 1 : 0;
      const relicAtk = (runRelicActive('warDrum', side) ? 1 : 0) +
        (runRelicActive('longBow', side) && m.traits.includes('远程') ? 2 : 0);
      m.atk = Math.max(0, m.baseAtk + b + adjAtkBonus(p, m) + (m.name.startsWith('狗头人') ? koboldLead : 0) + inspireBonus(m) + tacticAtk + relicAtk - (m.traits.includes('石像形态') && m.defense ? 2 : 0)); // 石像形态：守备时攻击 -2
    });
  });
}

// row / beforeUid 仅玩家侧有效：点击出牌不传（近战默认前排 row=0、远程默认后排 row=2），
// 手牌拖拽落位时传入目标排与插入位置；faceDown=true 为翻面表示盖放（不触发战吼，翻开时才触发）
function playCard(side, idx, row, beforeUid, faceDown, targetUid) {
  // 部署阶段外只有人机模式的 AI 部署能出牌；双人模式部署阶段仅当前部署方可出牌
  if (state.phase !== 'deploy' && !(state.mode === 'ai' && side === 'enemy')) return false;
  if (state.mode === 'pvp' && state.phase === 'deploy' && side !== state.deploySide) return false;
  const p = state[side];
  const def = p.hand[idx];
  if (!def) return false;
  // 法术卡牌：走法术分支（不入场、不可收回、结算后进墓地；盖放则成盖牌壳）
  if (def.type === 'spell') return playSpellCard(side, idx, targetUid, faceDown);
  const cost = effCost(side, def);
  if (cost > p.mana) return false;
  if (p.board.length >= BOARD_CAP) { if (state.mode === 'pvp' || side === 'player') log('场上使魔已达上限（' + BOARD_CAP + '）'); return false; }
  p.mana -= cost;
  p.hand.splice(idx, 1);
  if (def.spell === 'boneDragon' && p.graveyard.length > 0) {
    log('【骨龙】除外了墓地中的 ' + p.graveyard.length + ' 张牌，法力消耗 -' + p.graveyard.length);
    p.graveyard = [];
  }
  const m = makeMinion(def);
  // 收回信息：无战吼类入场效果的随从可收回（亡语类打出时没有即时收益，收回无套利风险，允许收回；
  // 骨龙因打出即除外墓地无法回滚，仍排除）。带单位法术（actSpell）的也可收回，
  // 但部署回合使用过法术之后不可（recallMinion 里校验）。
  const DEATHRATTLE_SPELLS = ['skeletonSearch', 'curse', 'draw', 'impBurst', 'foeDraw'];
  m.playedRound = state.round;
  m.costPaid = cost;
  m.recallable = !def.spell || DEATHRATTLE_SPELLS.indexOf(def.spell) >= 0;
  if (state.mode === 'ai' && side === 'enemy') {
    m.row = aiRowFor(def); // AI 按启发式选排
    p.board.push(m);
  } else {
    m.row = row == null ? (def.traits.includes('飞行') ? AIR_ROW : (def.traits.includes('远程') ? 2 : 0)) : (def.traits.includes('飞行') ? AIR_ROW : (row === AIR_ROW ? 0 : row)); // 非飞行单位拖到空中则落到前排
    if (beforeUid != null) {
      const bi = p.board.findIndex(x => x.uid === beforeUid);
      if (bi >= 0) p.board.splice(bi, 0, m); // 插到目标随从前
      else p.board.push(m);
    } else {
      p.board.push(m); // 该排末尾
    }
  }
  if (faceDown) {
    if (!gameConfig.allowSet) { log('本局已禁用盖放'); return false; }
    // 翻面表示盖放：默认守备表示；不触发战吼（pendingBattlecry 待翻开时结算）；日志不公开卡名（对对手保密）
    m.faceDown = true;
    m.defense = true;
    m.pendingBattlecry = !!def.spell;
    log(sideName(side) + '盖放了一张牌到' + ROW_NAMES[m.row]);
  } else {
    log(sideName(side) + '召唤了【' + m.name + '】（' + m.atk + '/' + m.arm + '/' + m.curHp + '）到' + ROW_NAMES[m.row]);
  }
  sfx('summon');
  if (!faceDown && isEpicUnit(def)) epicSummonFx(def, m); // 高费/巨型单位降临动画
  if (!faceDown) battlecry(side, m);
  cleanupAllDead();
  recalcAuras();
  checkGameOver();
  return m; // 返回打出的随从（失败时已在上方 return false）
}

function battlecry(side, m) {
  const p = state[side], foeSide = otherSide(side), foe = state[foeSide];
  // 检索：从牌库把符合条件的卡置入手牌（无差别/同阵营/低费/指定系别）
  const searchDeckToHand = (label, filterFn) => {
    const matches = p.deck.map((d, i) => ({ d, i })).filter(x => filterFn(x.d));
    if (!matches.length || p.hand.length >= HAND_LIMIT) {
      log(label + '：' + (p.hand.length >= HAND_LIMIT ? '手牌已满' : '牌库中没有符合条件的卡') + '，无效果');
      return false;
    }
    const pick = matches[Math.floor(Math.random() * matches.length)];
    p.deck.splice(pick.i, 1);
    p.hand.push(pick.d);
    log(label + '：从牌库检索一张【' + pick.d.name + '】置入手牌');
    return true;
  };
  switch (m.spell) {
    case 'searchAny': searchDeckToHand('【' + m.name + '】战吼·检索', () => true); break;
    case 'searchRace': searchDeckToHand('【' + m.name + '】战吼·检索', d => d.race === m.race); break;
    case 'searchCost': searchDeckToHand('【' + m.name + '】战吼·检索', d => d.cost <= (m.spellParam || 3)); break;
    case 'searchSchool': searchDeckToHand('【' + m.name + '】战吼·检索', d => d.type === 'spell' && d.school === m.spellParam); break;
    case 'prayer': {
      let n = 0;
      p.board.forEach(o => { if (o !== m) { o.baseAtk += 1; o.baseMaxHp += 2; o.atk += 1; o.maxHp += 2; o.curHp += 2; n++; } });
      if (n > 0) { log('【祭司】的祈祷：其他 ' + n + ' 个友方使魔 +1攻/+2血'); sfx('heal'); }
      break;
    }
    case 'wisp':
      p.mana = Math.min(manaCap(), p.mana + 1);
      log('【小精灵】战吼：本轮法力 +1');
      break;
    case 'potOfGreed':
      log('【强欲之壶】战吼：' + sideName(side) + '摸两张牌');
      sfx('flip');
      drawCard(side);
      drawCard(side);
      break;
    case 'songPot':
      log('【北宋之壶】战吼：' + sideName(side) + '摸两张牌');
      sfx('flip');
      drawCard(side);
      drawCard(side);
      break;
    case 'genieCry': {
      // 灯神/神怪战吼：随机一个友方单位 + 随机一个增益魔法
      const allies = p.board.filter(o => isTargetable(o));
      if (!allies.length) { log('【' + m.name + '】战吼：没有可祝福的友方单位'); break; }
      const pool = GENIE_BUFFS.map(n => findDef(n)).filter(Boolean);
      const def2 = pool[Math.floor(Math.random() * pool.length)];
      const t = allies[Math.floor(Math.random() * allies.length)];
      log('【' + m.name + '】战吼：为【' + t.name + '】施放【' + def2.name + '】');
      resolveSpellEffect(side, def2, t, 0);
      break;
    }
    case 'humblePot': {
      // 谦逊之壶：抽三张，保留一张（玩家三选一；AI/联机对方自动留最贵），其余洗入卡组
      const drawn = [];
      for (let i = 0; i < 3 && p.deck.length > 0; i++) drawn.push(p.deck.pop());
      if (drawn.length === 0) { log('【谦逊之壶】战吼：牌库已空，无效果'); break; }
      const auto = side === 'enemy' && (state.mode === 'ai' || NET.role === 'host');
      if (auto || drawn.length === 1) {
        let bi = 0;
        drawn.forEach((d2, i2) => { if (d2.cost > drawn[bi].cost) bi = i2; });
        keepHumblePick(side, drawn, bi);
      } else {
        showCardPick({
          title: '【谦逊之壶】战吼：保留一张，其余两张洗入卡组',
          entries: drawn.map((d2, i2) => ({ html: '【' + d2.name + '】费用 ' + d2.cost, data: i2 })),
          onPick: en => keepHumblePick(side, drawn, en.data),
        });
      }
      break;
    }
    case 'elfHeal':
      p.mana = Math.min(manaCap(), p.mana + 1);
      log('【精灵】战吼：本轮法力 +1');
      healHero(side, 2);
      break;
    case 'heal': // 参数化治疗战吼：spellParam = 恢复量
      healHero(side, m.spellParam || 2);
      break;
    case 'dragoness': {
      // 不立即变身：下一轮准备阶段开始时才变形（startRound 中结算），期间可被击杀
      m.pendingTransform = true;
      log('【龙女】开始蓄力：下一轮准备阶段开始时将变形为【绿龙】并恢复生命');
      break;
    }
    case 'charm': {
      if (foe.board.length === 0) { log('【魅魔】战吼：敌方没有随从，无效果'); break; }
      if (p.board.length >= BOARD_CAP) { log('【魅魔】战吼：我方场上已达上限，无效果'); break; }
      const charmPool = foe.board.filter(o => !mindImmune(o)); // 心智免疫不可夺取
      if (charmPool.length === 0) { log('【魅魔】战吼：可夺取的目标都免疫心智魔法'); break; }
      const t = weightedPick(charmPool); // 守备表示的单位被夺取概率 ×2
      foe.board = foe.board.filter(o => o !== t);
      t.canAttack = true; // 换边后本阶段尚未行动，可正常行动
      p.board.push(t);
      log('【魅魔】战吼：夺取了敌方【' + t.name + '】的控制权！');
      break;
    }
    case 'necro': {
      const s = summonMinion(side, findDef('骷髅'), m.row);
      if (s) log('【死灵法师】招魂术：在' + ROW_NAMES[s.row] + '召唤了一个【骷髅】');
      else log('【死灵法师】招魂术：场上已达上限，无效果');
      break;
    }
    case 'reaper': {
      if (foe.board.length === 0) { log('【死神】战吼：敌方没有随从，无效果'); break; }
      let t = foe.board[0];
      foe.board.forEach(o => { if (o.atk > t.atk) t = o; });
      t.curHp = 0;
      log('【死神】战吼：消灭了攻击力最高的【' + t.name + '】！');
      break;
    }
    case 'resurrect': {
      // 战吼·复活：取己方墓地最后进入的一张随从（跳过法术卡条目），满状态新实例复活到其原排（recallable=false 由 makeMinion 默认）
      let idx = -1;
      for (let i = p.graveyard.length - 1; i >= 0; i--) { if (!p.graveyard[i]._isSpell) { idx = i; break; } }
      if (idx < 0) { log('【大天使】战吼·复活：墓地为空，无效果'); break; }
      if (p.board.length >= BOARD_CAP) { log('【大天使】战吼·复活：场上已达上限，无效果'); break; }
      const dead = p.graveyard.splice(idx, 1)[0];
      const s = summonMinion(side, findDef(dead.name), dead.row);
      if (s) {
        log('【大天使】战吼·复活：【' + s.name + '】在' + ROW_NAMES[s.row] + '复活归来！');
        sfx('summon');
      }
      break;
    }
  }
}

function canTarget(attacker, defender) {
  if (isFlying(defender) &&
      !attacker.traits.includes('远程') && !isFlying(attacker)) return false;
  return true;
}

// 执行一次反击：士气判定 → 复仇累积 → 伤害结算（含石化凝视）。
// isDefense=true 为守备表示的同时结算反击（不耗反击机会；即使守备方被打死也结算）
function executeCounter(target, attacker, attackerSide, shaken, depth, isDefense) {
  if (moraleFail(target)) {
    log('【' + target.name + '】士气低落，未能反击' + (isDefense ? '' : '（反击机会保留）'));
    moraleFx(target, 'down');
    return;
  }
  const vg = traitLv(target, '复仇'); // 复仇X：每次反击前攻击 +X（永久累积）
  if (vg > 0) { target.baseAtk += vg; target.atk += vg; log('【' + target.name + '】复仇：攻击 +' + vg + '（当前 ' + target.atk + '）'); }
  if (!isDefense) target.counterLeft--;
  const back = attackDamage(target, attacker) + traitLv(target, '反扑') +
    (runRelicActive('spikedShield', otherSide(attackerSide)) ? 2 : 0); // 反扑X：反击伤害 +X
  if (back <= 0) {
    log('【' + target.name + '】' + (isDefense ? '（守备）' : '') + '反击【' + attacker.name + '】，伤害被护甲完全抵挡' + (isDefense ? '' : '（本阶段反击机会已用）'));
    return;
  }
  sfx('counter');
  dealAttackDamage(target, otherSide(attackerSide), attacker, back, shaken, depth + 1, isDefense ? 'defcounter' : 'counter');
  if (target.traits.includes('石化凝视') && Math.random() < 0.5) { // 石化凝视：反击后 1/2 概率石化攻击者
    attacker.petrified = 2;
    log('【' + target.name + '】的石化凝视：【' + attacker.name + '】被石化 2 回合（无法行动/反击，护甲 +3）');
  }
}

function applyPoison(src, dst) {
  const lv = traitLv(src, '毒Lv');
  if (lv > 0 && lv > dst.poison) {
    dst.poison = lv;
    log('【' + dst.name + '】中毒了（Lv' + lv + '）');
  }
}

// ---------- 法术施放动画 ----------
// spellFx(color, text, targetUids)：全屏系别色闪光（带法术名）+ 受影响目标按系别色高亮
let spellHitQueue = []; // 本次施放命中的随从 uid（dealSpellDamage 收集，施放方读取后清空）

function spellFx(color, text, targetUids) {
  const el = document.getElementById('spell-flash');
  const txt = document.getElementById('spell-flash-text');
  if (el && txt) {
    el.style.background = 'radial-gradient(circle at 50% 55%, ' + color + '66, #0000 65%)';
    txt.textContent = text;
    txt.style.color = color;
    el.classList.remove('show');
    void el.offsetWidth; // 重启动画
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 750);
  }
  if (state && targetUids && targetUids.length) {
    state.spellFx = { uids: targetUids.slice(), color: color };
    setTimeout(() => { if (!state) return; state.spellFx = null; render(); }, 650);
  }
}

// 单位法术的特效颜色
function actSpellFxColor(actSpell) {
  return { fireball: '#e05a3a', tidalWave: '#4a9ae8', study: '#4a9ae8', harvest: '#5a9a3a', summonDemon: '#b06ae8', split: '#5a9a3a', bless: '#4a9ae8', iceBolt: '#4a9ae8', manaGain: '#4a9ae8', heroHeal: '#5a9a3a', genieBless: '#e8c94a' }[actSpell] || '#c9a0f0';
}

// ---------- 士气系统 ----------
// 每个单位士气 [-10, 10]。正士气 x：每次行动后有 x*10% 概率额外行动一次（每战斗阶段限一次）；
// 负士气 x：|x|*10% 概率本回合无法行动，且（守备/正面）反击也有 |x|*10% 概率失败。
// 流转：造成正面伤害 +1、击杀额外 +1；被攻击/反击且受到伤害 -1；
// 守备方格挡全部伤害时伤害来源 -1、守备方 +1；回合开始时全场同阵营 +1、每多一种阵营 -1。
function changeMorale(m, delta) {
  if (inRunBattle() && RUN.modifier === 'calm') { m.morale = 0; return; } // Boss 规则：心如止水
  if (moraleImmune(m)) return; // 墓园/元素单位不受士气影响
  if (m.faceDown) return; // 盖牌不参与士气结算
  m.morale = Math.max(-10, Math.min(10, (m.morale || 0) + delta));
  recalcAuras(); // 英灵感召等随士气变化的词条需要即时重算
}
// 心智免疫（巨人/泰坦）：免疫心智魔法（双目失明/混乱/失忆/悲痛欲绝/魅魔夺取）
function mindImmune(m) { return m.traits.includes('心智免疫'); }
// 墓园（亡灵）、元素（元素城）单位：不受士气影响，也不参与阵营士气计算
function moraleImmune(m) {
  const d = findDef(m.name);
  return !!d && (d.race === '墓园' || d.race === '元素');
}
function moraleFail(m) { // 负士气导致的失败判定（无法行动/无法反击）
  return m.morale < 0 && Math.random() < -m.morale * 0.1;
}

// 士气特效：触发专属音效 + 卡面动画（600ms 后清除并重绘）
function moraleFx(m, kind) {
  if (!state) return;
  state.moraleFx = { uid: m.uid, kind: kind };
  sfx(kind === 'up' ? 'moraleUp' : 'moraleDown');
  setTimeout(() => {
    if (!state) return;
    if (state.moraleFx && state.moraleFx.uid === m.uid) state.moraleFx = null;
    render();
  }, battleDelay(600));
}

function onAttackKill(attackerSide) {
  if (!runRelicActive('bloodChalice', attackerSide)) return;
  healHero(attackerSide, 2);
  recordRoundKey('【遗物·鲜血圣杯】击杀后英雄恢复 2 点生命');
}

// 对随从造成攻击伤害（来源为 attacker）。日志显示造成的伤害与目标剩余生命（若存活）。
// 受伤者若存活、还有反击机会、攻击力 > 0、且按射程规则能够到伤害来源，则立刻反击并
// 消耗本战斗阶段唯一一次反击机会；够不到或 0 攻则不消耗机会。
// 反击造成的伤害不再触发反击（depth > 0 即为反击）。label 区分 主攻击/溅射/反击 的日志措辞。
function dealAttackDamage(attacker, attackerSide, target, dmg, shaken, depth, label) {
  // 影遁：每战斗阶段第一次被普通攻击时，免疫该次伤害
  if (label == null && depth === 0 && target.traits.includes('影遁') && !target._vanishUsed) {
    target._vanishUsed = true;
    log('【' + target.name + '】影遁：免疫了【' + attacker.name + '】的攻击！');
    return;
  }
  // 觉醒计数：被普通攻击一次（无论是否造成伤害）
  if (depth === 0 && label == null && traitLv(target, '觉醒') > 0) {
    const need = traitLv(target, '觉醒');
    target._awaken = (target._awaken || 0) + 1;
    if (target._awaken === need) log('【' + target.name + '】觉醒了！现在可以攻击、反击和切换形态');
    else if (target._awaken < need) log('【' + target.name + '】被攻击（觉醒 ' + target._awaken + '/' + need + '）');
  }
  if (dmg <= 0) {
    // 伤害被护甲完全抵挡：防守方士气 +1；守备表示格挡时伤害来源额外 -1（士气此消彼长）
    changeMorale(target, 1);
    if (target.defense && depth === 0) {
      changeMorale(attacker, -1);
      log('【' + target.name + '】成功格挡了【' + attacker.name + '】的攻击！（士气此消彼长）');
    } else {
      log('【' + target.name + '】完全抵挡了【' + attacker.name + '】的攻击（士气 +1）');
    }
    return;
  }
  const wasAlive = target.curHp > 0;
  target.curHp -= dmg;
  if (target.curHp <= 0) {
    target._killedBy = attacker; target._killedBySide = attackerSide;
    if (wasAlive) onAttackKill(attackerSide);
  } // 记录致死攻击来源与方位（魔童/北宋之壶亡语等用）
  shaken.push(target.uid);
  // 士气流转：造成正面伤害 +1；被攻击/反击且受到伤害 -1；击杀额外 +1
  changeMorale(attacker, 1);
  changeMorale(target, -1);
  if (target.curHp <= 0) changeMorale(attacker, 1);
  const remain = target.curHp > 0 ? '，【' + target.name + '】剩余 ' + target.curHp + ' 血' : '';
  const antiAir = attacker.traits.includes('远程') && isFlying(target) ? '（远程对飞行伤害加倍）' : '';
  if (label === 'counter') log('【' + attacker.name + '】反击【' + target.name + '】，造成 ' + dmg + ' 点伤害（本阶段反击机会已用）' + antiAir + remain);
  else if (label === 'defcounter') log('【' + attacker.name + '】反击【' + target.name + '】，造成 ' + dmg + ' 点伤害（守备表示·同时结算）' + antiAir + remain);
  else if (label === 'splash') log('【' + attacker.name + '】的溅射对【' + target.name + '】造成 ' + dmg + ' 点伤害' + antiAir + remain);
  else log('【' + attacker.name + '】攻击【' + target.name + '】，造成 ' + dmg + ' 点伤害' + antiAir + remain);
  // 愈挫愈勇：每次受到伤害后攻击 +1（永久累积）
  if (target.traits.includes('愈挫愈勇')) {
    target.baseAtk += 1; target.atk += 1;
    log('【' + target.name + '】愈挫愈勇：攻击 +1（当前 ' + target.atk + '）');
  }
  applyPoison(attacker, target);
  // 吸血：造成的伤害等量恢复自身生命（封顶）
  if (attacker.traits.includes('吸血') && dmg > 0) {
    const healBefore = attacker.curHp;
    attacker.curHp = Math.min(attacker.maxHp, attacker.curHp + dmg);
    if (attacker.curHp > healBefore) log('【' + attacker.name + '】吸血：自身恢复 ' + (attacker.curHp - healBefore) + ' 点生命');
  }
  if (target.curHp <= 0 && attacker.traits.includes('驱魔')) target._noDR = true;
  if (depth === 0 && !target.faceDown && target.atk > 0) {
    if (target.defense && !target.blind && !(target.petrified > 0) && awake(target) && !attacker.traits.includes('远程')) { // 失明/石化/未觉醒的守备单位也无法反击
      // 守备表示：攻击守备单位的同时必然受到反击——无视攻击方的免反击特性（骑兵/不受反击），但无法反击远程单位，
      // 无限次、与对手攻击同时结算（即使被打死反击也生效），不消耗反击机会；负士气可能导致反击失败
      executeCounter(target, attacker, attackerSide, shaken, depth, true);
    } else if (target.curHp > 0 && target.counterLeft > 0 && canCounter(target, attacker, attackerSide)) {
      executeCounter(target, attacker, attackerSide, shaken, depth, false);
    }
  }
  // 穿杨：远程普通攻击时，对目标正后方同列的单位造成一半溅射伤害
  if (label == null && depth === 0 && attacker.traits.includes('穿杨') && attacker.traits.includes('远程')) {
    const foeBoard = state[otherSide(attackerSide)].board;
    const tRow = foeBoard.filter(o => o.row === target.row);
    const bRow = foeBoard.filter(o => o.row === target.row + 1);
    if (tRow.length && bRow.length) {
      const t2 = bRow[Math.min(tRow.indexOf(target), bRow.length - 1)];
      if (t2) dealAttackDamage(attacker, attackerSide, t2, Math.floor(dmg / 2), shaken, depth, 'splash');
    }
  }
  // 尸火：被近战普通攻击时，随机对伤害来源造成 0-2 点闪电/火焰/冰冻伤害（存活才触发）
  if (depth === 0 && label == null && target.curHp > 0 && target.traits.includes('尸火') &&
      !attacker.traits.includes('远程')) {
    const elems = [{ school: '气', elem: '闪电' }, { school: '火', elem: '火焰' }, { school: '水', elem: '冰冻' }];
    const el2 = elems[Math.floor(Math.random() * elems.length)];
    const rd = Math.floor(Math.random() * 3); // 0-2
    if (rd > 0) {
      log('【尸体发火】的尸火：对【' + attacker.name + '】造成 ' + rd + ' 点' + el2.elem + '伤害');
      dealSpellDamage({ name: '尸体发火', school: el2.school }, attacker, rd);
    }
  }
}

// targetUid 为 null 表示攻击英雄；返回是否实际执行了攻击
function doAttack(side, attackerUid, targetUid) {
  if (state.gameOver) return false;
  const me = state[side], foeSide = otherSide(side), foe = state[foeSide];
  const attacker = me.board.find(m => m.uid === attackerUid);
  if (!attacker || !attacker.canAttack) return false;
  const defender = targetUid == null ? null : foe.board.find(m => m.uid === targetUid);
  if (targetUid != null && !defender) return false;
  // 统一目标合法性校验（玩家点击与 AI 共用）
  if (defender) {
    if (!canTarget(attacker, defender)) {
      if (side === 'player') log('【' + defender.name + '】是飞行单位，只有远程或飞行单位能攻击它');
      return false;
    }
    if (!attacker.traits.includes('远程') && !meleeTargets(attacker, foeSide).some(x => x.t === defender)) {
      if (side === 'player') log('【' + defender.name + '】被前方单位遮挡，无法攻击');
      return false;
    }
  } else if (!canHitHero(attacker, foeSide)) {
    if (side === 'player') log('对方场上还有可攻击的随从，无法攻击英雄本体');
    return false;
  }

  attacker.canAttack = false;
  const shaken = []; // 本次攻击中受到伤害的随从 uid（用于晃动动画）
  if (defender) {
    sfx('hit');
    // 威光：与圣龙交战，战斗前士气 -1
    if (defender.traits.includes('威光')) { changeMorale(attacker, -1); log('【' + attacker.name + '】被【' + defender.name + '】的威光震慑，士气 -1'); }
    if (attacker.traits.includes('威光')) { changeMorale(defender, -1); log('【' + defender.name + '】被【' + attacker.name + '】的威光震慑，士气 -1'); }
    // 盖牌守备：被攻击前先揭示（结算盖放时跳过的战吼），再按正面守备单位结算攻击
    if (defender.faceDown) {
      defender.faceDown = false;
      log('【' + defender.name + '】在被攻击前揭示！');
      sfx('flip');
      if (defender.pendingBattlecry) { defender.pendingBattlecry = false; battlecry(foeSide, defender); }
      const dyingR = cleanupAllDead();
      recalcAuras();
      if (defender.curHp <= 0) { // 被自己的揭示效果波及死亡，攻击落空
        checkGameOver();
        state.anims = { attacker: attacker.uid, shaken: shaken, heroHit: null, dying: dyingR };
        setTimeout(() => { if (!state) return; state.anims = { attacker: null, shaken: [], heroHit: null, dying: [] }; render(); }, battleDelay(450));
        render();
        return true;
      }
    }
    // 死亡凝视：25% 概率直接消灭目标随从（无视生命与护甲；凝视未致死则正常结算攻击）
    if (attacker.traits.includes('死亡凝视') && Math.random() < 0.25) {
      defender.curHp = 0;
      onAttackKill(side);
      shaken.push(defender.uid);
      log('【' + attacker.name + '】的死亡凝视发动：【' + defender.name + '】被直接消灭！');
      sfx('death');
    } else {
    // 主目标伤害（受伤者可能立刻反击）
    const mainDmg = attackDamage(attacker, defender);
    if (mainDmg <= 0) log('【' + attacker.name + '】攻击【' + defender.name + '】，伤害被护甲完全抵挡');
    dealAttackDamage(attacker, side, defender, mainDmg, shaken, 0);
    }
    // 范围攻击：只溅射被攻击随从左右两边相邻的随从（同排内按站位取前后各一个；
    // 各自结算护甲；溅射受伤同样会反击）
    if (attacker.traits.includes('范围攻击')) {
      const rowMins = foe.board.filter(o => o.row === defender.row);
      const di = rowMins.indexOf(defender);
      [rowMins[di - 1], rowMins[di + 1]].forEach(o => {
        if (!o || o.curHp <= 0) return;
        const sd = attackDamage(attacker, o);
        dealAttackDamage(attacker, side, o, sd, shaken, 0, 'splash');
      });
    }
    // 连击：第一次攻击（含反击）结算后，对同一目标追加第二次攻击
    // （第二次不触发反击——depth=1；目标已死则落空不转火；攻击者被反击致死则无第二次）
    if (attacker.traits.includes('连击') && attacker.curHp > 0) {
      if (defender.curHp > 0) {
        sfx('hit');
        log('【' + attacker.name + '】连击：发动第二次攻击！');
        const dmg2 = attackDamage(attacker, defender);
        if (dmg2 <= 0) log('【' + attacker.name + '】的第二次攻击被护甲完全抵挡');
        dealAttackDamage(attacker, side, defender, dmg2, shaken, 1);
      } else {
        log('【' + attacker.name + '】连击：目标已被消灭，第二次攻击落空');
      }
    }
  } else {
    const heroDmg = damageHero(foeSide, attacker.atk);
    changeMorale(attacker, 1); // 士气：造成正面伤害 +1（对英雄同样生效）
    log('【' + attacker.name + '】攻击' + sideName(foeSide) + '英雄，造成 ' + heroDmg + ' 点伤害');
    recordRoundKey('【' + attacker.name + '】对' + sideName(foeSide) + '英雄造成 ' + heroDmg + ' 点伤害');
    sfx('hit');
    // 吸血：对英雄造成的伤害等量恢复自身生命（封顶）
    if (attacker.traits.includes('吸血')) {
      const healBefore = attacker.curHp;
      attacker.curHp = Math.min(attacker.maxHp, attacker.curHp + heroDmg);
      if (attacker.curHp > healBefore) log('【' + attacker.name + '】吸血：自身恢复 ' + (attacker.curHp - healBefore) + ' 点生命');
    }
    // 掠夺：攻击敌方英雄时额外获得 5 金币
    if (attacker.traits.includes('掠夺')) {
      gold += 5;
      saveEconomy();
      log('【' + attacker.name + '】掠夺：获得 5 金币（余额 ' + gold + '）');
    }
    const burnLv = traitLv(attacker, '法力燃烧'); // 法力燃烧X：对方下轮法力 -X
    if (burnLv > 0) {
      foe.burned += burnLv;
      log('法力燃烧：' + sideName(foeSide) + '下轮法力 -' + burnLv);
    }
  }
  // 威光：与圣龙交战，战斗后士气 -1
  if (defender && defender.traits.includes('威光')) { changeMorale(attacker, -1); log('【' + attacker.name + '】被【' + defender.name + '】的威光震慑，士气 -1'); }
  if (defender && attacker.traits.includes('威光')) { changeMorale(defender, -1); log('【' + defender.name + '】被【' + attacker.name + '】的威光震慑，士气 -1'); }
  const dying = cleanupAllDead();
  recalcAuras();
  checkGameOver();
  // 记录攻击动画：攻击者突进、受伤随从晃动、死亡随从幽灵卡（先晃动再消失）、英雄被直击晃动；
  // 约 450ms 后清除并重绘
  state.anims = { attacker: attacker.uid, shaken: shaken, heroHit: defender ? null : foeSide, dying: dying };
  setTimeout(() => {
    if (!state) return;
    state.anims = { attacker: null, shaken: [], heroHit: null, dying: [] };
    render();
  }, battleDelay(450));
  return true;
}

function cleanupDead(side) {
  const p = state[side];
  let dead = p.board.filter(m => m.curHp <= 0);
  if (dead.length === 0) return [];
  const relicState = state._relicState || (state._relicState = { phoenixFeatherUsed: false });
  if (runRelicActive('phoenixFeather', side) && !relicState.phoenixFeatherUsed) {
    const saved = dead.shift();
    saved.curHp = 1;
    saved._killedBy = null;
    saved._killedBySide = null;
    relicState.phoenixFeatherUsed = true;
    log('【遗物·凤凰之羽】让【' + saved.name + '】以 1 点生命留在场上');
    recordRoundKey('【凤凰之羽】挽救了【' + saved.name + '】');
    sfx('heal');
    if (dead.length === 0) { recalcAuras(); return []; }
  }
  // 记录死亡时的排内位置（供"先晃动再消失"的死亡动画渲染幽灵卡）
  const dying = dead.map(m => {
    const rowMins = p.board.filter(o => o.row === m.row);
    return { m: m, side: side, row: m.row, idx: rowMins.indexOf(m) };
  });
  p.board = p.board.filter(m => m.curHp > 0);
  dead.forEach(m => {
    const summary = currentRoundSummary();
    if (summary) summary.unitsLost[side].push({ uid: m.uid, name: m.name });
    log('【' + m.name + '】被消灭');
    sfx('death');
    // 壶类：被击败时不进墓地，加入对方卡组（强欲置顶/谦逊洗入；驱魔封印则正常进墓）
    if ((m.spell === 'potOfGreed' || m.spell === 'humblePot') && !m._noDR) {
      const od = state[otherSide(side)].deck;
      if (m.spell === 'potOfGreed') {
        od.push(findDef('强欲之壶'));
        log('【强欲之壶】被击败，加入了' + sideName(otherSide(side)) + '的卡组顶端');
      } else {
        od.splice(Math.floor(Math.random() * (od.length + 1)), 0, findDef('谦逊之壶'));
        log('【谦逊之壶】被击败，洗入了' + sideName(otherSide(side)) + '的卡组');
      }
      return;
    }
    p.graveyard.push(m);
    if (m._noDR) { log('【' + m.name + '】被驱魔效果击杀，亡语未能触发'); return; }
    // 亡语
    if (m.spell === 'draw') {
      log('【' + m.name + '】亡语触发：' + sideName(side) + '摸一张牌');
      drawCard(side);
    } else if (m.spell === 'skeletonSearch') {
      // 检索同名卡置入手牌；没有则按家族备选检索（骷髅↔骷髅勇士互检）
      const FALLBACK = { '骷髅': '骷髅勇士', '骷髅勇士': '骷髅' };
      const want = [m.name, FALLBACK[m.name]].filter(Boolean);
      let found = -1, foundName = null;
      for (let w = 0; w < want.length && found < 0; w++) {
        const i = p.deck.findIndex(d => d.name === want[w]);
        if (i >= 0) { found = i; foundName = want[w]; }
      }
      if (found >= 0 && p.hand.length < HAND_LIMIT) {
        p.deck.splice(found, 1);
        p.hand.push(findDef(foundName));
        log('【' + m.name + '】亡语触发：从牌库检索一张【' + foundName + '】置入手牌');
      } else {
        log('【' + m.name + '】亡语触发：' + (found < 0 ? '牌库中没有可检索的卡' : '手牌已满') + '，无效果');
      }
    } else if (m.spell === 'impBurst') {
      // 魔童：被近战单位杀死时，对伤害来源造成 2 点火系魔法伤害
      const k = m._killedBy;
      if (k && !k.traits.includes('远程') && k.curHp > 0) {
        log('【魔童】亡语触发：烈焰反噬【' + k.name + '】');
        dealSpellDamage({ name: '魔童', school: '火' }, k, 2);
        cleanupAllDead();
      }
    } else if (m.spell === 'songPot') {
      // 北宋之壶：击败它的玩家摸两张牌并获得 5 金币（攻击致死记录方位；法术/毒等未记录时按对方计）
      const killerSide = m._killedBySide || otherSide(side);
      log('【北宋之壶】亡语触发：' + sideName(killerSide) + '摸两张牌，获得 5 金币');
      sfx('flip');
      drawCard(killerSide);
      drawCard(killerSide);
      gold += 5;
      saveEconomy();
    } else if (m.spell === 'foeDraw') {
      // 尸体发火：对手摸一张牌
      log('【' + m.name + '】亡语触发：' + sideName(otherSide(side)) + '摸一张牌');
      drawCard(otherSide(side));
    } else if (m.spell === 'leoric') {
      // 骷髅王李奥锐刻：有 3 点法术时消耗全部法术，下个准备阶段从墓地归来
      if (m.spellMana >= 3) {
        m.spellMana = 0;
        m._leoricReturn = true;
        log('【骷髅王李奥锐刻】亡语：消耗全部 3 点法术，将在下个准备阶段从墓地归来！');
      } else {
        log('【骷髅王李奥锐刻】法术不足（' + m.spellMana + '/3），亡语未能触发');
      }
    } else if (m.spell === 'curse') {
      const foe = state[otherSide(side)];
      let n = 0;
      foe.board.forEach(o => { o.baseAtk = Math.max(0, o.baseAtk - 1); o.atk = Math.max(0, o.atk - 1); n++; });
      if (n > 0) log('【木乃伊】亡语·诅咒：' + n + ' 个敌方随从攻击 -1');
    }
  });
  recalcAuras();
  return dying;
}

// 双方战场一并清理（返回合并的死亡快照，供死亡动画）
function cleanupAllDead() { return cleanupDead('player').concat(cleanupDead('enemy')); }

function checkGameOver() {
  if (state.gameOver) return;
  const pDead = state.player.hp <= 0, eDead = state.enemy.hp <= 0;
  if (!pDead && !eDead) return;
  state.gameOver = true;
  finishRoundSummary(pDead && eDead ? 'draw' : (eDead ? 'player' : 'enemy'));
  if (inRunBattle()) { roguelikeBattleEnd(!pDead || (pDead && eDead)); return; } // 闯关模式：分流到奖励/纪念流程
  let text;
  if (state.mode === 'pvp') {
    if (eDead && !pDead) text = '玩家 1 获胜！';
    else if (pDead && !eDead) text = '玩家 2 获胜！';
    else text = '同归于尽！';
  } else {
    if (eDead && !pDead) text = '胜利！你击败了对手';
    else if (pDead && !eDead) text = '败北……对手获胜';
    else text = '同归于尽！';
  }
  log('—— ' + text + ' ——');
  if (eDead && !pDead) sfx('win'); else sfx('lose');
  // 金币结算：胜 100 / 平 50 / 负 30（双人对战同机发放：有胜者 100、平局 50）
  let reward;
  if (state.mode === 'pvp') reward = (pDead && eDead) ? 50 : 100;
  else reward = (eDead && !pDead) ? 100 : (pDead && !eDead) ? 30 : 50;
  gold += reward;
  saveEconomy();
  document.getElementById('gold-gain').textContent = '+' + reward + ' 金币（余额 ' + gold + '）';
  document.getElementById('result-text').textContent = text;
  document.getElementById('overlay').classList.add('show');
}

// ---------- AI 部署 ----------
// AI 法术决策：返回 true（无目标直接放）/ 目标 uid / null（本轮不放）
function aiSpellDecision(def) {
  const me = state.enemy, foe = state.player;
  const highest = arr => arr.slice().sort((a, b) => b.atk - a.atk)[0] || null;
  const AOE = ['deathRipple', 'doom', 'hellfire', 'earthSpikes', 'meteorShower', 'warShout', 'backRowSpikes'];
  if (AOE.includes(def.spellEffect) && foe.board.filter(x => isTargetable(x)).length < 2) return null; // AoE 至少 2 个目标才放，不浪费
  switch (def.spellEffect) {
    case 'stoneSkin': case 'fireShield': case 'mirror': case 'frenzy': case 'airShield': case 'lifeBoon': // 增益单体 → 自己攻击最高单位
      return me.board.length ? highest(me.board).uid : null;
    case 'bless': case 'bloodlust': // 群体增益：有高攻单位（≥3）才值得放
      return me.board.some(x => x.atk >= 3) ? true : null;
    case 'slow': case 'iceBolt': case 'fireballSpell': case 'lightningBolt': case 'dispel': case 'powerWordKill': case 'entangle': case 'feint':
    case 'sear': case 'meteor': case 'thunderBolt': // 伤害/减益 → 敌方攻击最高单位
      return foe.board.length ? highest(foe.board).uid : null;
    case 'confuse': case 'forget': case 'blind': { // 心智魔法 → 敌方攻击最高的非免疫单位
      const mindPool = foe.board.filter(x => !mindImmune(x) && (def.spellEffect !== 'blind' || !x.traits.includes('无目')));
      return mindPool.length ? highest(mindPool).uid : null;
    }
    case 'heal': // 英雄受伤 ≥6 奶英雄；否则奶最残的友方单位（缺口 ≥6 才用）
      if (me.hp <= me.maxHp - 6) return { hero: true };
      const wounded = me.board.filter(m => m.maxHp - m.curHp >= 6).sort((a, b) => (b.maxHp - b.curHp) - (a.maxHp - a.curHp))[0];
      return wounded ? wounded.uid : null;
    case 'slimeSwarm': // 召唤史莱姆：法力 ≥6 才倾泻
      return me.mana >= 6 ? true : null;
    case 'arcaneDraw': // 奥术智慧：手牌不多时才摸（≤7 张，防爆牌）
      return me.hand.length <= 7 ? true : null;
    case 'darkSacrifice': { // 恶魔的祭品：献祭己方攻击最低的单位换两张牌；无单位可献祭则不用
      if (me.board.filter(x => !x.isSpellShell).length === 0) return null;
      const weakest = me.board.filter(x => !x.isSpellShell).sort((a, b) => a.atk - b.atk || a.curHp - b.curHp)[0];
      return { sacUid: weakest.uid };
    }
    case 'animateDead': { // 聚灵奇术：贪心选双方墓地费用最高的墓园单位（预算 = (法力-3)×2）
      const budget = Math.max(0, me.mana - def.cost) * 2;
      const units = [];
      ['player', 'enemy'].forEach(sd => state[sd].graveyard.forEach((g, i) => {
        const gd = !g._isSpell && findDef(g.name);
        if (gd && gd.race === '墓园') units.push({ graveSide: sd, graveIndex: i, cost: g.cost || 0 });
      }));
      units.sort((a, b) => b.cost - a.cost);
      const picks = [];
      let total = 0;
      units.forEach(u => { if (total + u.cost <= budget) { picks.push({ graveSide: u.graveSide, graveIndex: u.graveIndex }); total += u.cost; } });
      return picks.length ? { picks: picks } : null;
    }
    case 'raiseSkeletons': { // 除外双方墓地中费用最高的单位
      let best = null;
      ['player', 'enemy'].forEach(sd => state[sd].graveyard.forEach((g, i) => {
        if (g._isSpell) return;
        if (!best || (g.cost || 0) > (best.g.cost || 0)) best = { g: g, sd: sd, i: i };
      }));
      return best ? { graveSide: best.sd, graveIndex: best.i } : null;
    }
    case 'doom': // 敌方场上单位多于我方时用
      return foe.board.length > me.board.length ? true : null;
    case 'forbiddenFlame': { // 禁断之炎：剩余法力 ≥3 且敌方单位 ≥2 才倾泻（自伤同样大，劣势搏命）
      const x = me.mana - def.cost;
      return x >= 3 && foe.board.length >= 2 && me.hp > x + 3 ? true : null;
    }
    case 'teleport': // 传送（收回自己单位）AI 不使用
      return null;
    default: // 其余（地刺/死亡波纹/祝福/嗜血/连锁闪电/召唤/复活/治疗波动/地狱烈焰/龙卷/鼓舞/神盾）：有费就用
      return true;
  }
}

function aiPlayStep() {
  const e = state.enemy;
  if (e.board.length >= BOARD_CAP) return false;
  const affordable = e.hand
    .map((c, i) => ({ c, i }))
    .filter(x => effCost('enemy', x.c) <= e.mana)
    .sort((a, b) => (b.c.rating - a.c.rating) || (effCost('enemy', b.c) - effCost('enemy', a.c))); // 评分降序（最强先出），费用降序为并列
  if (affordable.length === 0) return false;
  for (let k = 0; k < affordable.length; k++) {
    const x = affordable[k];
    if (x.c.type === 'spell') {
      const decision = aiSpellDecision(x.c);
      if (decision == null) continue; // 这张法术本轮不放，试下一张
      if (playSpellCard('enemy', x.i, decision === true ? null : decision)) return true;
      continue;
    }
    return playCard('enemy', x.i);
  }
  return false;
}

// ---------- 进攻阶段 ----------
// 行动顺序三围总和：攻击力 + 有效护甲 + 当前生命
function unitPower(m) {
  return m.atk + effArmor(m) + Math.max(0, m.curHp);
}

// 速度 = 行动三围总和；骑兵速度翻倍
function speedOf(m) {
  return unitPower(m) * (m.traits.includes('骑兵') ? 2 : 1);
}

// 从「存活且本阶段尚未行动」的单位里挑速度最高者（并列随机）；守备/翻面表示的单位不主动攻击
function nextActor() {
  const all = state.player.board.concat(state.enemy.board).filter(m => m.canAttack && !m.defense && !m.faceDown && !m.blind && !(m.petrified > 0) && awake(m)); // 失明/石化/未觉醒单位无法行动
  if (all.length === 0) return null;
  let max = -Infinity;
  all.forEach(m => { const pw = speedOf(m); if (pw > max) max = pw; });
  const ties = all.filter(m => speedOf(m) === max);
  return ties[Math.floor(Math.random() * ties.length)];
}

// 目标 t 是否会反击攻击者 m（预估用）：守备=必然反击但打不了远程；普通=需攻>0、有反击机会且够得着
function willBeCountered(t, m, side) {
  return t.atk > 0 && (t.defense ? !m.traits.includes('远程') : (t.counterLeft > 0 && canCounter(t, m, side)));
}

// 自动攻击启发式（双方共用）：远程单位优先攻击飞行目标；合法目标里优先有利交换
// （仅目标还有反击机会、攻>0 且够得着反击时才计入反击伤害），否则打剩余生命最低的
// 合法目标，对方场空则打英雄；0 攻单位跳过行动
// 和平：若攻击某目标会令自己在反击中死亡，则跳过该目标
function suicidalTarget(m, t, side) {
  const dmg = attackDamage(m, t);
  // 守备目标必然反击（无视免反击特性）；普通目标要有反击机会且够得着
  const counters = willBeCountered(t, m, side);
  if (!counters) return false;
  if (dmg >= t.curHp && !t.defense) return false; // 普通目标被直接击杀则无反击；守备目标被杀也反击
  return attackDamage(t, m) >= m.curHp;
}

function autoAttack(side, m) {
  const foeSide = otherSide(side);
  // 近战：战场宽度模型——按暴露宽度加权随机选取目标（和平排除自杀目标）
  if (!m.traits.includes('远程')) {
    let pool = meleeTargets(m, foeSide);
    if (m.traits.includes('和平')) pool = pool.filter(x => !suicidalTarget(m, x.t, side));
    if (pool.length > 0 && m.atk > 0) {
      const total = pool.reduce((s, x) => s + x.w, 0);
      let roll = Math.random() * total;
      let target = pool[pool.length - 1].t;
      for (let i = 0; i < pool.length; i++) { roll -= pool[i].w; if (roll <= 0) { target = pool[i].t; break; } }
      return doAttack(side, m.uid, target.uid);
    }
    if (m.atk > 0 && canHitHero(m, foeSide)) return doAttack(side, m.uid, null);
    m.canAttack = false; // 0 攻或无可打目标，跳过行动
    return false;
  }
  // 远程：无视遮挡，优先打飞行；合法目标里优先有利交换，否则打剩余生命最低的
  let targets = legalMinionTargets(m, foeSide);
  if (m.traits.includes('和平')) targets = targets.filter(t => !suicidalTarget(m, t, side));
  const flying = targets.filter(t => isFlying(t));
  if (flying.length > 0) targets = flying;
  const kill = targets.find(t => {
    const dmg = attackDamage(m, t);
    if (dmg < t.curHp) return false;
    // 守备表示的目标即使被击杀也会反击（必然反击·同时结算）；普通目标只有存活且有反击机会才反击
    const counters = willBeCountered(t, m, side);
    if (!counters) return true;
    return attackDamage(t, m) < m.curHp;
  });
  if (kill) return doAttack(side, m.uid, kill.uid);
  if (m.atk > 0 && canHitHero(m, foeSide)) return doAttack(side, m.uid, null);
  if (targets.length > 0 && m.atk > 0) {
    const t = targets.slice().sort((a, b) => a.curHp - b.curHp)[0];
    return doAttack(side, m.uid, t.uid);
  }
  m.canAttack = false; // 0 攻或无可打目标，跳过行动
  return false;
}

// ---------- 单位法术（部署阶段主动施放） ----------
const UNIT_SPELL_TEXT = {
  split: '分裂：消耗 1 法力，生命为偶数时一分为二（各半血，其它 buff/特效保留）',
  fireball: '火球：消耗 1 法力，对随机一个敌方随从造成 1~6 点法术伤害',
  harvest: '收获：消耗 4 法力，摸一张牌',
  tidalWave: '巨浪：消耗 2 法力，对敌方前排所有单位造成 2 点法术伤害',
  study: '研读：消耗 3 法力，摸一张牌',
  summonDemon: '召唤恶鬼：消耗 4 法力，选择己方墓地中的一张单位卡除外，在场上召唤一个【恶鬼】',
  bless: '祝福：消耗 2 法力，使一个友方单位 +1攻/+2血',
  iceBolt: '冰箭：消耗 2 法力，对一个敌方单位造成 4 点水系伤害',
  repair: '修理：消耗 1 法力，为一个友方机械单位恢复 2 点生命',
  manaGain: '回魔：消耗 1 法力，本回合法力 +1（不超过上限）',
  heroHeal: '治愈：消耗 1 法力，为你的英雄恢复 2 点生命',
  genieBless: '祝福：消耗全部法力 X，随机为一个友方单位施放一个 X 费用的增益法术（护体石肤/治疗/大气神盾/烈火神盾/狂暴/镜像术）',
};

// 单位法术短标签（施放按钮/战斗力明细共用）
const UNIT_SPELL_LABEL = { split: '分裂', fireball: '火球', tidalWave: '巨浪', study: '研读', harvest: '收获', summonDemon: '召唤恶鬼', bless: '祝福', iceBolt: '冰箭', repair: '修理', manaGain: '回魔', heroHeal: '治愈', genieBless: '祝福' };
// 单位法术条目归一化：多法术单位取数组，单法术单位合成单条目
function unitSpellEntries(m) {
  return m.actSpells || (m.actSpell ? [{ key: m.actSpell, cost: m.spellCost }] : []);
}
// 按 key 找法术条目：多法术单位找不到返回 null；单法术单位回退为自身法术
function unitSpellEntry(m, key) {
  return m.actSpells ? (m.actSpells.find(e => e.key === key) || null) : { key: key, cost: m.spellCost };
}
// ---------- 战术预览（长按卡牌：进攻/受击目标分析） ----------
let tacPreview = null; // { uid, mode: 'attack'|'defense', hl: {} }
let tacPressTimer = null;

function tacSideOf(uid) {
  if (state.player.board.find(x => x.uid === uid)) return 'player';
  if (state.enemy.board.find(x => x.uid === uid)) return 'enemy';
  return null;
}

// 复刻 autoAttack 远程分支的确定性选目标逻辑，返回被选中的目标（可能为 'hero' 或 null）
function tacRangedChoice(m, foeSide, mySide) {
  let targets = legalMinionTargets(m, foeSide);
  if (m.traits.includes('和平')) targets = targets.filter(t => !suicidalTarget(m, t, mySide));
  const flying = targets.filter(t => isFlying(t));
  if (flying.length > 0) targets = flying;
  const kill = targets.find(t => {
    const dmg = attackDamage(m, t);
    if (dmg < t.curHp) return false;
    const counters = t.atk > 0 && (t.defense || (t.counterLeft > 0 && canCounter(t, m, mySide)));
    if (!counters) return true;
    return attackDamage(t, m) < m.curHp;
  });
  if (kill) return kill;
  if (m.atk > 0 && canHitHero(m, foeSide)) return 'hero';
  if (targets.length > 0 && m.atk > 0) return targets.slice().sort((a, b) => a.curHp - b.curHp)[0];
  return null;
}

// 进攻预览：该单位在当前位置的备选攻击目标（概率/伤害/可击杀）
function tacAttackRows(m, mySide) {
  const foeSide = otherSide(mySide);
  const rows = [];
  if (m.traits.includes('远程')) {
    const chosen = tacRangedChoice(m, foeSide, mySide);
    if (chosen === 'hero') rows.push({ hero: true, prob: 1, dmg: m.atk, lethal: m.atk >= state[foeSide].hp });
    else if (chosen) rows.push({ t: chosen, prob: 1, dmg: attackDamage(m, chosen), lethal: attackDamage(m, chosen) >= chosen.curHp });
    return rows;
  }
  let pool = meleeTargets(m, foeSide);
  if (m.traits.includes('和平')) pool = pool.filter(x => !suicidalTarget(m, x.t, mySide));
  const total = pool.reduce((s, x) => s + x.w, 0);
  pool.forEach(x => {
    const dmg = attackDamage(m, x.t);
    rows.push({ t: x.t, prob: total > 0 ? x.w / total : 0, dmg: dmg, lethal: dmg >= x.t.curHp });
  });
  rows.sort((a, b) => b.prob - a.prob);
  if (pool.length === 0 && m.atk > 0 && canHitHero(m, foeSide)) {
    rows.push({ hero: true, prob: 1, dmg: m.atk, lethal: m.atk >= state[foeSide].hp });
  }
  return rows;
}

// 受击预览：哪些敌方单位会选中该单位（概率/伤害/我方反击）
function tacDefenseRows(m, mySide) {
  const foeSide = otherSide(mySide);
  const rows = [];
  state[foeSide].board.forEach(e => {
    if (e.faceDown || e.atk <= 0) return;
    let prob = 0;
    if (e.traits.includes('远程')) {
      if (tacRangedChoice(e, mySide, foeSide) === m) prob = 1;
    } else {
      const pool = meleeTargets(e, mySide);
      const total = pool.reduce((s, x) => s + x.w, 0);
      const me = pool.find(x => x.t === m);
      if (me && total > 0) prob = me.w / total;
    }
    if (prob > 0) {
      const dmg = attackDamage(e, m);
      let counter = 0;
      if (!m.faceDown && m.atk > 0 && (m.defense || (m.counterLeft > 0 && canCounter(m, e, foeSide)))) {
        counter = attackDamage(m, e);
      }
      rows.push({ t: e, prob: prob, dmg: dmg, lethal: dmg >= m.curHp, counter: counter, counterLethal: counter > 0 && counter >= e.curHp });
    }
  });
  rows.sort((a, b) => b.prob - a.prob);
  return rows;
}

function openTacPreview(uid) {
  const side = tacSideOf(uid);
  if (!side) return;
  const m = state[side].board.find(x => x.uid === uid);
  if (!m || m.faceDown) return; // 盖牌无预览
  tacPreview = { uid: uid, mode: m.defense ? 'defense' : 'attack', hl: {} }; // 守备表示首次即显示受击
  renderTacPreview();
  render();
}

function closeTacPreview() {
  tacPreview = null;
  const el = document.getElementById('tac-preview');
  if (el) { el.classList.remove('show'); el.innerHTML = ''; }
  render();
}

function renderTacPreview() {
  const el = document.getElementById('tac-preview');
  if (!el) return;
  if (!tacPreview || !state || state.gameOver) { el.classList.remove('show'); el.innerHTML = ''; return; }
  const side = tacSideOf(tacPreview.uid);
  const m = side ? state[side].board.find(x => x.uid === tacPreview.uid) : null;
  if (!m || m.faceDown) { tacPreview = null; el.classList.remove('show'); el.innerHTML = ''; return; }
  const rows = tacPreview.mode === 'attack' ? tacAttackRows(m, side) : tacDefenseRows(m, side);
  tacPreview.hl = {};
  rows.forEach(r => { if (r.t) tacPreview.hl[r.t.uid] = true; });
  const pct = p => Math.round(p * 100) + '%';
  let html = '<div class="tp-title">【' + m.name + '】' + (tacPreview.mode === 'attack' ? '进攻预览' : '受击预览') + '</div>';
  if (rows.length === 0) html += '<div class="tp-empty">（无）</div>';
  rows.forEach(r => {
    const name = r.hero ? '英雄本体' : '【' + r.t.name + '】';
    html += '<div class="tp-row"><span class="tp-prob">' + pct(r.prob) + '</span><span>' + name + '</span>' +
      '<span class="tp-dmg">' + r.dmg + ' 伤</span>' +
      (r.counter > 0 ? '<span class="tp-counter">反击 ' + r.counter + (r.counterLethal ? '（反杀）' : '') + '</span>' : '') +
      (r.lethal ? '<span class="tp-kill">可击杀</span>' : '') + '</div>';
  });
  html += '<div class="tp-hint">单击该卡切换 进攻/受击 · 点击空白关闭</div>';
  el.innerHTML = html;
  // 定位到卡牌右侧（越界则左移/下移）
  const card = document.querySelector('[data-uid="' + tacPreview.uid + '"]');
  if (card) {
    const r = card.getBoundingClientRect();
    el.classList.add('show');
    const pw = el.offsetWidth, ph = el.offsetHeight;
    let x = r.right + 8, y = r.top;
    if (x + pw > window.innerWidth - 8) x = r.left - pw - 8;
    if (x < 8) x = 8;
    if (y + ph > window.innerHeight - 8) y = Math.max(8, window.innerHeight - ph - 8);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  } else {
    el.classList.add('show');
  }
}

// 守备表示的单位被随机选取的概率 ×2（宽度变成两倍）：构建加权池后随机
function weightedPick(arr) {
  const pool = [];
  arr.forEach(m => { pool.push(m); if (m.defense) pool.push(m); });
  return pool[Math.floor(Math.random() * pool.length)];
}

// 施放单位法术：校验阶段/部署方/法力/目标条件 → 扣法力 → 执行 → 日志 + 音效 + render
// 灯神/神怪「祝福」的增益法术池：按消耗法力 X 匹配同费增益法术
const GENIE_BUFFS = ['护体石肤', '治疗', '大气神盾', '烈火神盾', '狂暴', '镜像术'];
function genieBuffPool(x) {
  return GENIE_BUFFS.map(n => CARD_DEFS.find(d => d.name === n)).filter(d => d && d.cost === x);
}
// 单位法术的纯场面条件（施放门控 / AI 跳过 / 按钮置灰 三处共用；选目标与载荷校验留在各调用点）
function unitSpellBoardCond(m, key, side) {
  const p = state[side], foe = state[otherSide(side)];
  if (key === 'split') return m.curHp > 0 && m.curHp % 2 === 0 && p.board.length < BOARD_CAP;
  if (key === 'fireball' || key === 'tidalWave') return foe.board.length > 0;
  if (key === 'summonDemon') return p.board.length < BOARD_CAP && p.graveyard.some(g => !g._isSpell);
  if (key === 'manaGain') return p.mana < manaCap();
  if (key === 'heroHeal') return p.hp < p.maxHp;
  if (key === 'genieBless') return genieBuffPool(m.spellMana).length > 0;
  return true; // 其余（含需选目标的 bless/iceBolt/repair 与无条件法术）在此不判
}
function castUnitSpell(side, minionUid, payload) {
  if (!state || state.gameOver) return false;
  // 与人机 AI 部署同规则：部署阶段外只有 ai 模式的 enemy（AI）可施放；pvp 仅当前部署方
  if (state.phase !== 'deploy' && !(state.mode === 'ai' && side === 'enemy')) return false;
  if (state.mode === 'pvp' && side !== state.deploySide) return false;
  const p = state[side];
  const m = p.board.find(x => x.uid === minionUid);
  if (!m) return false;
  // 确定施放的法术 key 与费用（多法术单位按 payload.key 选，单法术单位用 actSpell）
  const key = (payload && payload.key) || m.actSpell;
  if (m.blind) return false; // 失明无法施放法术
  if (!key) return false;
  const entry = unitSpellEntry(m, key);
  if (!entry) return false;
  if (m.spellMana < entry.cost) return false;
  if (!unitSpellBoardCond(m, key, side)) return false; // 纯场面条件（与按钮置灰/AI 同一套）
  if (key === 'summonDemon') {
    // 召唤恶鬼：需要墓地载荷（由选取浮层提供）
    const g = payload && p.graveyard[payload.graveIndex];
    if (!payload || !g || g._isSpell) return false;
  } else if (key === 'bless') {
    // 祝福：需要指定友方单位目标
    const t = payload && p.board.find(x => x.uid === payload.targetUid && isTargetable(x));
    if (!t) return false;
  } else if (key === 'iceBolt') {
    // 冰箭：需要指定敌方单位目标
    const t = payload && state[otherSide(side)].board.find(x => x.uid === payload.targetUid && isTargetable(x));
    if (!t) return false;
  } else if (key === 'repair') {
    // 修理：需要指定己方机械单位目标
    const t = payload && p.board.find(x => x.uid === payload.targetUid && isTargetable(x) && x.traits.includes('机械'));
    if (!t) return false;
  }
  m.spellMana -= entry.cost;
  m._usedSpell = true; // 标记已使用法术：本回合不可再收回
  spellHitQueue = [];
  if (key === 'split') {
    const half = m.curHp / 2;
    const copy = Object.assign({}, m, { uid: ++uid, recallable: false, spellMana: 0 });
    m.curHp = half;
    copy.curHp = half;
    p.board.splice(p.board.indexOf(m) + 1, 0, copy); // 同一排，紧随其后
    log('【' + m.name + '】施放分裂：一分为二（各 ' + half + ' 血，其它特效不变）');
    sfx('summon');
  } else if (key === 'fireball') {
    const foe = state[otherSide(side)];
    const t = weightedPick(foe.board); // 守备表示的单位被火球选中概率 ×2
    if (t.traits.includes('火系魔法免疫')) {
      log('【' + t.name + '】火系魔法免疫，【' + m.name + '】的火球无效');
      recalcAuras();
      checkGameOver();
      render();
      return true;
    }
    const roll = 1 + Math.floor(Math.random() * 6);
    const shield = traitLv(t, '法术护盾'); // 法术护盾X：法术伤害 -X
    const dmg = Math.max(0, roll - shield);
    t.curHp -= dmg;
    log('【' + m.name + '】施放火球：对【' + t.name + '】造成 ' + dmg + ' 点法术伤害（掷出 ' + roll + (shield ? '，法术护盾-' + shield : '') + '）');
    sfx('hit');
    cleanupAllDead();
  } else if (key === 'harvest') {
    log('【' + m.name + '】施放收获：' + sideName(side) + '摸一张牌');
    sfx('flip');
    drawCard(side);
  } else if (key === 'tidalWave') {
    // 巨浪：对敌方前排所有单位造成 2 点法术伤害（地刺式结算，吃护盾减免）
    const foeSide2 = otherSide(side);
    const fr = frontRowOf(foeSide2);
    const targets = state[foeSide2].board.filter(x => x.row === fr);
    if (targets.length === 0) log('【' + m.name + '】施放巨浪：敌方前排没有单位，无效果');
    targets.forEach(x => dealSpellDamage({ name: '巨浪' }, x, 2));
    sfx('hit');
    cleanupAllDead();
  } else if (key === 'study') {
    // 研读：摸一张牌（收获式结算）
    log('【' + m.name + '】施放研读：' + sideName(side) + '摸一张牌');
    sfx('flip');
    drawCard(side);
  } else if (key === 'summonDemon') {
    // 召唤恶鬼：除外己方墓地一张单位卡，召唤【恶鬼】到同排
    const g = p.graveyard.splice(payload.graveIndex, 1)[0];
    const s = summonMinion(side, findDef('恶鬼'), m.row);
    if (s) {
      log('【' + m.name + '】施放召唤恶鬼：除外了【' + g.name + '】，召唤【恶鬼】在' + ROW_NAMES[s.row] + '入场！');
      sfx('summon');
    } else {
      p.graveyard.push(g); // 召唤失败（满员，理论上前面已校验）则退回墓地并退蓝
      m.spellMana += entry.cost;
      m._usedSpell = false;
      log('【' + m.name + '】场上已达上限，召唤失败');
      return false;
    }
  } else if (key === 'bless') {
    // 祝福：目标友方单位 +1攻/+2血
    const t = p.board.find(x => x.uid === payload.targetUid);
    t.baseAtk += 1; t.baseMaxHp += 2; t.maxHp += 2; t.curHp += 2;
    log('【' + m.name + '】施放祝福：【' + t.name + '】+1攻/+2血');
    sfx('heal');
  } else if (key === 'iceBolt') {
    // 冰箭：对目标敌方单位造成 4 点水系伤害
    const t = state[otherSide(side)].board.find(x => x.uid === payload.targetUid);
    dealSpellDamage({ name: '冰箭', school: '水' }, t, 4);
    sfx('hit');
    cleanupAllDead();
  } else if (key === 'repair') {
    // 修理：目标机械单位恢复 2 点生命
    const t = p.board.find(x => x.uid === payload.targetUid);
    const before = t.curHp;
    t.curHp = Math.min(t.maxHp, t.curHp + 2);
    log('【' + m.name + '】施放修理：【' + t.name + '】恢复 ' + (t.curHp - before) + ' 点生命');
    sfx('heal');
  } else if (key === 'manaGain') {
    p.mana = Math.min(manaCap(), p.mana + 1);
    log('【' + m.name + '】施放回魔：本轮法力 +1');
    sfx('phase');
  } else if (key === 'heroHeal') {
    healHero(side, 2); // healHero 自带日志与音效
  } else if (key === 'genieBless') {
    // 祝福：消耗全部法力 X，随机友方单位 + 随机 X 费用增益法术（复用法术卡结算）
    const x = m.spellMana; m.spellMana = 0;
    const pool = genieBuffPool(x);
    const def2 = pool[Math.floor(Math.random() * pool.length)];
    const allies = p.board.filter(o => isTargetable(o));
    const t = allies[Math.floor(Math.random() * allies.length)];
    log('【' + m.name + '】施放祝福：消耗全部 ' + x + ' 点法力，为【' + t.name + '】施放【' + def2.name + '】');
    resolveSpellEffect(side, def2, t, x);
  }
  recalcAuras();
  checkGameOver();
  // 单位法术动画
  const labelMap = UNIT_SPELL_LABEL;
  spellFx(actSpellFxColor(key), labelMap[key] || key, spellHitQueue);
  render();
  return true;
}

// 翻开翻面表示的单位（仅部署阶段、当前部署方；只能翻开，不能再盖回——盖放只能从手牌进行）。
// 翻开时结算盖放时未触发的战吼。
function flipUnit(side, minionUid) {
  if (!state || state.gameOver) return false;
  if (state.phase !== 'deploy') return false;
  if (state.mode === 'pvp' && side !== state.deploySide) return false;
  const m = state[side].board.find(x => x.uid === minionUid);
  if (!m || !m.faceDown) return false; // 只有翻面表示的单位能翻开
  // 盖放的法术卡：翻开立即结算（需要目标的随机选合法目标，无合法目标则不生效），壳入墓地
  if (m.isSpellShell) {
    const p = state[side];
    const def = m.spellDef;
    p.board = p.board.filter(x => x !== m);
    log('盖放的法术【' + def.name + '】翻开并发动！');
    sfx('spellcast');
    const pool = legalSpellTargets(side, def);
    const target = def.target === 'none' ? null : (pool.length ? pool[Math.floor(Math.random() * pool.length)] : null);
    if (def.target !== 'none' && !target) log('【' + def.name + '】没有合法目标，未能生效');
    else resolveSpellEffect(side, def, target);
    discardSpellToGraveyard(side, def);
    cleanupAllDead();
    recalcAuras();
    checkGameOver();
    render();
    return true;
  }
  m.faceDown = false;
  log('【' + m.name + '】翻开！');
  sfx('flip');
  if (m.pendingBattlecry) { m.pendingBattlecry = false; battlecry(side, m); }
  cleanupAllDead();
  recalcAuras();
  checkGameOver();
  render();
  return true;
}

// 切换飞行单位的 落地/起飞 形态（仅部署阶段、当前部署方、正面表示的飞行单位）。
// 落地：失去飞行效果、移到前排地面阵型；起飞：回到空中区域。
function toggleLand(side, minionUid, setValue) {
  if (!state || state.gameOver) return false;
  if (state.phase !== 'deploy') return false;
  if (state.mode === 'pvp' && side !== state.deploySide) return false;
  const m = state[side].board.find(x => x.uid === minionUid);
  if (!m || !m.traits.includes('飞行') || m.faceDown) return false;
  const target = setValue == null ? !m.grounded : !!setValue;
  if (m.blind) { log('【' + m.name + '】失明中，无法切换形态'); return false; }
  if (target === m.grounded) return false;
  m.grounded = target;
  m.row = target ? 0 : AIR_ROW;
  log('【' + m.name + '】' + (target ? '落地到前排（暂时失去飞行）' : '起飞回到空中'));
  sfx('flip');
  render();
  return true;
}

// 切换攻击/守备表示（仅部署阶段、当前部署方的随从）。
// 守备表示：不主动攻击；无限次反击且反击与对手攻击同时结算；被随机选取概率 ×2；卡面变宽。
function toggleDefense(side, minionUid, setValue) {
  if (!state || state.gameOver) return false;
  if (!gameConfig.allowDefense) { log('本局已禁用守备表示'); return false; }
  if (state.phase !== 'deploy') return false;
  if (state.mode === 'pvp' && side !== state.deploySide) return false;
  const m = state[side].board.find(x => x.uid === minionUid);
  if (!m) return false;
  // 翻面单位也可切换守备表示（但依然不会主动进攻）；守备墙只计算正面的守备单位
  const target = setValue == null ? !m.defense : !!setValue; // setValue 传入时为设置式（旋转热区），否则为切换式
  if (m.blind) { log('【' + m.name + '】失明中，无法切换形态'); return false; }
  if (!awake(m)) { log('【' + m.name + '】尚未觉醒（被攻击 ' + (m._awaken || 0) + '/' + traitLv(m, '觉醒') + ' 次），无法切换形态'); return false; }
  if (target === m.defense) return false;
  m.defense = target;
  // 飞行单位：守备（失去飞行）落到前排队列；恢复攻击表示时回到空中（落地形态除外）
  if (m.traits.includes('飞行')) m.row = m.defense ? 0 : (m.grounded ? 0 : AIR_ROW);
  log('【' + m.name + '】切换为' + (m.defense ? '守备表示（不主动攻击，无限次反击·同时结算）' : '攻击表示'));
  recalcAuras(); // 石像形态等随表示形式变化的词条需要即时重算
  sfx('phase');
  render();
  return true;
}

// AI 施放单位法术：火球/巨浪——敌方有随从且法力够就放；研读/收获——有蓝就放；分裂——偶数血且场上未满就放。
// 每次施放都扣法力，法力有限自然终止（guard 仅兜底）
function aiCastSpells() {
  let guard = 0;
  while (guard++ < 200) {
    const e = state.enemy;
    let found = null;
    for (const m of e.board) {
      const entries = unitSpellEntries(m);
      for (const en of entries) {
        if (m.spellMana < en.cost) continue;
        const key = en.key;
        if (!unitSpellBoardCond(m, key, 'enemy')) continue;
        if (key === 'iceBolt' && state.player.board.length === 0) continue;
        if (key === 'bless' && !e.board.some(x => isTargetable(x))) continue;
        if (key === 'repair' && !e.board.some(x => isTargetable(x) && x.traits.includes('机械') && x.curHp < x.maxHp)) continue;
        found = { m: m, en: en };
        break;
      }
      if (found) break;
    }
    if (!found) return;
    const m = found.m, en = found.en;
    if (en.key === 'summonDemon') {
      // AI 召唤恶鬼：除外己方墓地费用最高的单位卡
      let best = -1;
      e.graveyard.forEach((g, i) => {
        if (g._isSpell) return;
        if (best < 0 || (g.cost || 0) > (e.graveyard[best].cost || 0)) best = i;
      });
      castUnitSpell('enemy', m.uid, { key: en.key, graveIndex: best });
    } else if (en.key === 'bless') {
      const t = e.board.filter(x => isTargetable(x)).sort((a, b) => unitPower(b) - unitPower(a))[0];
      castUnitSpell('enemy', m.uid, { key: en.key, targetUid: t.uid });
    } else if (en.key === 'iceBolt') {
      const t = state.player.board.filter(x => isTargetable(x)).sort((a, b) => b.atk - a.atk)[0];
      castUnitSpell('enemy', m.uid, { key: en.key, targetUid: t.uid });
    } else if (en.key === 'repair') {
      const t = e.board.filter(x => isTargetable(x) && x.traits.includes('机械') && x.curHp < x.maxHp).sort((a, b) => (b.maxHp - b.curHp) - (a.maxHp - a.curHp))[0];
      if (t) castUnitSpell('enemy', m.uid, { key: en.key, targetUid: t.uid });
    } else {
      castUnitSpell('enemy', m.uid, { key: en.key });
    }
  }
}

// AI 守备姿态：攻击力 ≤1 且生命较厚（≥5）的单位转为守备表示（无限反击·同时结算当肉盾），
// 攻击力 ≥2 的确保攻击表示
// 守备姿态策略（游戏 AI 与测试策略共用）：低攻高血天然筑墙；危局（英雄半血以下或场面落后）时大身板转守备托局
function aiSetDefense(side) {
  if (!gameConfig.allowDefense) return;
  side = side || 'enemy';
  const me = state[side], foe = state[otherSide(side)];
  const heroDanger = me.hp <= me.maxHp * 0.5;
  const boardBehind = foe.board.length > me.board.length + 1;
  me.board.forEach(m => {
    if (m.faceDown) return;
    let want;
    if (m.atk <= 1 && m.maxHp >= 5) want = true;                       // 低攻高血天然墙
    else if ((heroDanger || boardBehind) && m.maxHp >= 8) want = true; // 危局大身板筑墙托局
    else if (heroDanger && m.atk <= 2 && m.maxHp >= 6) want = true;    // 危局中坚也筑墙
    else if (m.atk >= 4 && !heroDanger) want = false;                  // 高攻保持进攻
    else if (m.atk >= 3 && !heroDanger && !boardBehind) want = false;  // 中高攻非危局也保持进攻
    else if ((m.morale || 0) < 0) want = true;                         // 负士气单位筑墙（行动不稳，无限反击不亏）
    else want = m.defense;                                              // 其余维持现状
    if (want !== m.defense) {
      m.defense = want;
      if (m.traits.includes('飞行')) m.row = want ? 0 : (m.grounded ? 0 : AIR_ROW); // 飞行守备落地/恢复回空（落地形态除外）
      log('【' + m.name + '】切换为' + (want ? '守备表示' : '攻击表示'));
    }
  });
}

function chooseAITactic() {
  const me = state.enemy, foe = state.player;
  const mine = me.board.filter(m => !m.faceDown && !m.isSpellShell);
  if (!mine.length) return null;
  const visibleFoe = foe.board.filter(m => !m.faceDown && !m.isSpellShell);
  const attackers = mine.filter(m => !m.defense && !m.blind && !(m.petrified > 0) && awake(m) && m.atk > 0);
  const attackPower = attackers.reduce((sum, m) => sum + Math.max(0, m.atk), 0);
  const incoming = visibleFoe.filter(m => !m.defense).reduce((sum, m) => sum + Math.max(0, m.atk), 0);
  const moraleUnits = mine.filter(m => !moraleImmune(m));
  const negative = moraleUnits.filter(m => (m.morale || 0) < 0).length;
  const lethal = foe.board.length === 0 && attackers.length > 0 && foe.hp <= attackPower + attackers.length;
  const scores = {
    assault: attackers.length ? 2 + attackers.length * 1.2 + attackPower * 0.15 + (lethal ? 7 : 0) : -2,
    guard: 1.5 + incoming * 0.18 + (me.hp <= me.maxHp * 0.5 ? 4 : 0) +
      (visibleFoe.length > mine.length ? 2 : 0) + mine.filter(m => m.defense).length,
    rally: moraleUnits.length ? 1 + moraleUnits.length * 1.1 + negative * 2.5 : -Infinity,
  };
  if (inRunBattle() && RUN.modifier === 'calm') scores.rally = -Infinity;
  const keys = ['assault', 'guard', 'rally'];
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(i + state.round + mine.length) % keys.length];
    if (scores[key] > bestScore) { best = key; bestScore = scores[key]; }
  }
  return best;
}

function activateTactics() {
  if (state.mode === 'ai') state.tactics.enemy = chooseAITactic();
  state._tacticsActive = true;
  beginRoundSummary();
  ['player', 'enemy'].forEach(side => {
    const key = state.tactics[side];
    if (!key) return;
    let actual = '';
    if (key === 'rally') {
      let total = 0;
      state[side].board.forEach(m => {
        const before = m.morale || 0;
        changeMorale(m, 2);
        const gained = (m.morale || 0) - before;
        if (gained > 0) m._tacticRally = gained;
        total += gained;
      });
      actual = '（实际共提升 ' + total + ' 点）';
    }
    const text = sideName(side) + '发动战术【' + TACTIC_INFO[key].name + '】：' + TACTIC_INFO[key].desc + actual;
    log(text);
    recordRoundKey(text);
  });
  if (runRelicActive('rallyBanner', 'player') && RUN.modifier !== 'calm') {
    let total = 0;
    state.player.board.forEach(m => {
      const before = m.morale || 0;
      changeMorale(m, 1);
      total += (m.morale || 0) - before;
    });
    log('【遗物·昂扬战旗】己方全军士气 +1（实际共提升 ' + total + ' 点）');
    recordRoundKey('【昂扬战旗】触发，全军士气 +1');
  }
}

function combatTick() {
  if (state.gameOver) { render(); return; }
  const m = nextActor();
  if (!m) { finishRoundSummary(); startRound(); return; } // 全部行动完 → 下一轮部署阶段
  const side = state.player.board.indexOf(m) >= 0 ? 'player' : 'enemy';
  // 负士气：|x|*10% 概率本回合无法行动
  if (moraleFail(m)) {
    m.canAttack = false;
    log('【' + m.name + '】士气低落，本回合无法行动（士气 ' + m.morale + '）');
    moraleFx(m, 'down');
    render();
    if (!state.gameOver) setTimeout(combatTick, battleDelay(650));
    return;
  }
  autoAttack(side, m);
  // 正士气：x*10% 概率额外行动一次（每战斗阶段限一次，同一单位立即连动）
  if (!m._extraUsed && m.morale > 0 && m.curHp > 0 && Math.random() < m.morale * 0.1) {
    m._extraUsed = true;
    m.canAttack = true; // 恢复行动资格以保证连动
    log('【' + m.name + '】士气高涨，获得额外行动机会！（士气 +' + m.morale + '）');
    recordRoundKey('【' + m.name + '】士气高涨，立即额外行动一次');
    moraleFx(m, 'up');
    autoAttack(side, m); // 士气高涨：同一单位立即连续行动
  }
  render();
  if (!state.gameOver) setTimeout(combatTick, battleDelay(650));
}

// 主按钮（开始战斗 / 完成部署）：ai 直接开打；本地热座交机；联机房主/guest 各按部署方行动
function onActionButton() {
  if (NET.role === 'spectator') return;
  if (NET.role === 'guest') {
    // guest 的「完成部署」发消息给房主执行
    if (state && !state.gameOver && state.phase === 'deploy' && state.deploySide === 'enemy') {
      clientSend({ t: 'act', kind: 'endDeploy' });
    }
    return;
  }
  if (!state || state.gameOver || state.phase !== 'deploy') return;
  if (NET.role === 'host') {
    if (state.deploySide === 'player') {
      if (state._firstSide === 'player') {
        state.deploySide = 'enemy';
        log('—— 等待 ' + sideName('enemy') + ' 部署 ——');
        render(); // 触发快照广播，guest 随后开始部署
      } else {
        startCombat(); // 本轮 guest 先手，房主部署完毕直接开战
      }
    }
    return; // deploySide==='enemy' 时等待 guest 的 endDeploy 消息
  }
  if (state.mode === 'ai') { startCombat(); return; }
  if (state.deploySide === state._firstSide) {
    showPassScreen(sideName(state.deploySide) + ' 部署完毕 · 请把设备交给' + sideName(otherSide(state.deploySide)), () => {
      state.deploySide = otherSide(state.deploySide);
      render();
    });
  } else {
    startCombat();
  }
}

// 玩家点「开始战斗」：AI 模式先让 AI 完成部署（连续出牌，记日志），再进入进攻阶段；
// 双人模式双方均已部署，直接演算
function startCombat() {
  if (!state || state.phase !== 'deploy' || state.gameOver) return;
  flushPendingClick(); // 开打前先结算未执行的单击出牌
  state.spellTargetMode = null; // 清除可能残留的法术选目标模式
  const gp = document.getElementById('grave-pick');
  if (gp) gp.classList.remove('show');
  state.phase = 'combat';
  log('—— 进攻阶段 ——');
  sfx('phase');
  while (state.mode === 'ai' && aiPlayStep()) {} // AI 部署（仅人机模式）
  if (state.mode === 'ai') aiCastSpells(); // AI 施放单位法术
  if (state.mode === 'ai') aiSetDefense(); // AI 守备姿态：攻击力 ≤1 的单位转为守备表示
  if (state.gameOver) return;
  activateTactics();
  // 战斗阶段开始前：鼓舞/威吓光环结算（大天使全场 +1，鬼龙敌方全场 -1）
  ['player', 'enemy'].forEach(sd => {
    const me = state[sd], foe = state[otherSide(sd)];
    let inspire = 0, dread = 0;
    me.board.forEach(m => {
      if (m.faceDown) return;
      inspire += traitLv(m, '鼓舞');
      dread += traitLv(m, '威吓');
    });
    if (inspire > 0) { me.board.forEach(m => changeMorale(m, inspire)); log(sideName(sd) + '受到鼓舞：全场士气 +' + inspire); }
    if (dread > 0) { foe.board.forEach(m => changeMorale(m, -dread)); log(sideName(sd) + '施加威吓：敌方全场士气 -' + dread); }
  });
  // 战斗阶段开始：双方所有随从重置反击机会（默认 1 次；反击X 特性为 X 次，如皇家狮鹫反击2）
  ['player', 'enemy'].forEach(s => state[s].board.forEach(m => { m.counterLeft = Math.max(1, traitLv(m, '反击')); m._extraUsed = false; m._vanishUsed = false; }));
  recalcAuras();
  render();
  setTimeout(combatTick, battleDelay(650));
}
