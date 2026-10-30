'use strict';
// roguelike.js — 从 index.html 按域拆分（plain script，共享全局词法作用域）
// ---------- Roguelike 闯关模式 ----------
const RL_RACE_COLOR = { '城堡': '#8b9099', '壁垒': '#5a8a52', '塔楼': '#5a9aba', '地狱': '#8a5a42', '墓园': '#464650', '地下城': '#6a4a8a', '据点': '#a89048', '要塞': '#4a6a4a', '元素': '#7ab8d8', '中立': '#9a9288', '港口': '#2a6a8a', '堡垒': '#7a9ab8', '工厂': '#8a744a' };
const RUN_MODIFIERS = {
  skeletons: { name: '万籁俱寂', desc: '敌方每轮准备阶段召唤一个【骷髅】到前排' },
  calm: { name: '心如止水', desc: '全场所有单位士气锁定为 0' },
  dragon: { name: '巨龙威压', desc: '敌方所有单位攻击力 +1' },
};
const RUN_MAP_POOLS = [
  ['battle'],
  ['battle', 'battle', 'event'],
  ['campfire', 'battle', 'event', 'shop'],
  ['battle', 'elite', 'event'],
  ['campfire', 'shop', 'battle'],
  ['boss'],
  ['battle', 'elite', 'event'],
  ['campfire', 'shop', 'battle'],
  ['elite', 'battle', 'event'],
  ['finalBoss'],
];
// 生成 10 列分支地图：固定列 1 个节点，其余列 2-3 个可选节点
function genRunMap() {
  return RUN_MAP_POOLS.map(pool => {
    const n = pool.length === 1 ? 1 : Math.min(pool.length, 2 + (Math.random() < 0.5 ? 1 : 0));
    return shuffle(pool.slice()).slice(0, n);
  });
}
// 节点间连线约束（杀戮尖塔式）：每个节点只连通下一列最近的 1-2 个节点；
// 单节点列全连出/全汇入；保证下一列每个节点至少一条入边
function genRunEdges(cols) {
  const edges = [];
  for (let i = 0; i < cols.length - 1; i++) {
    const m = cols[i].length, n = cols[i + 1].length;
    const colEdges = [];
    if (m === 1 && n === 1) colEdges.push([0]);
    else if (m === 1) colEdges.push(Array.from({ length: n }, (_, t) => t));
    else {
      for (let k = 0; k < m; k++) {
        const t = Math.round(k * (n - 1) / (m - 1));
        const targets = new Set([t]);
        if (t + 1 < n && Math.random() < 0.6) targets.add(t + 1);
        if (t > 0 && Math.random() < 0.3) targets.add(t - 1);
        colEdges.push([...targets].sort((a, b) => a - b));
      }
      for (let t = 0; t < n; t++) {
        if (!colEdges.some(e => e.indexOf(t) >= 0)) {
          const k = Math.round(t * (m - 1) / (n - 1));
          colEdges[k].push(t);
          colEdges[k].sort((a, b) => a - b);
        }
      }
    }
    edges.push(colEdges);
  }
  return edges;
}
// 当前列中可从上一列所选节点到达的节点下标
function rlReachable() {
  if (RUN.floor === 0) return RUN.map[0].map((_, k) => k);
  return (RUN.edges[RUN.floor - 1] && RUN.edges[RUN.floor - 1][RUN.path[RUN.floor - 1]]) || [];
}
const RUN_NODE_INFO = {
  battle: { icon: '⚔️', name: '战斗' }, elite: { icon: '👹', name: '精英' },
  campfire: { icon: '🔥', name: '篝火' }, shop: { icon: '🛒', name: '商店' },
  event: { icon: '❓', name: '事件' }, boss: { icon: '💀', name: '中Boss' }, finalBoss: { icon: '🐉', name: '最终Boss' },
};
let RUN = null;

function saveRun() { try { storage.setItem('mtcg-run', JSON.stringify(RUN)); } catch (e) {} }
function loadRun() {
  try { RUN = JSON.parse(storage.getItem('mtcg-run') || 'null'); } catch (e) { RUN = null; }
  if (!RUN || !RUN.active || !RUN.map || !RUN.edges) { RUN = null; return; }
  const owned = Array.isArray(RUN.relics) ? RUN.relics : [];
  RUN.relics = Array.from(new Set(owned.filter(id => RUN_RELICS[id])));
  if (!Array.isArray(RUN._relicDraft) || !RUN._relicDraft.some(id => RUN_RELICS[id] && RUN.relics.indexOf(id) < 0)) {
    RUN._relicDraft = null;
    RUN._afterRelic = null;
  } else {
    RUN._relicDraft = Array.from(new Set(RUN._relicDraft.filter(id => RUN_RELICS[id] && RUN.relics.indexOf(id) < 0))).slice(0, 3);
  }
  saveRun();
}
function clearRun() { RUN = null; try { storage.removeItem('mtcg-run'); } catch (e) {} }
function getMemorials() { try { return JSON.parse(storage.getItem('mtcg-memorials') || '[]') || []; } catch (e) { return []; } }
function saveMemorialDef(def) {
  const arr = getMemorials();
  arr.push({ name: def.name, cost: def.cost, atk: def.atk, arm: def.arm, hp: def.hp, race: def.race, traits: def.traits, rating: def.rating, memorial: true, type: 'unit' });
  try { storage.setItem('mtcg-memorials', JSON.stringify(arr.slice(-30))); } catch (e) {}
}

// 初始牌组：阵营预设中最便宜的 15 张
function runStarterDeck(race) {
  const preset = PRESET_DECKS.find(d => d.name === race + ' · 标准');
  const defs = [];
  if (preset) Object.keys(preset.cards).forEach(n => { const d = findDef(n); for (let i = 0; i < preset.cards[n]; i++) if (d) defs.push(d); });
  defs.sort((a, b) => a.cost - b.cost || b.rating - a.rating);
  return defs.slice(0, 15);
}

function startRun(race) {
  RUN = { active: true, race: race, deck: runStarterDeck(race), floor: 0, map: genRunMap(), path: [], curNode: null, edges: null, hp: 25, maxHp: 25, kills: 0, rounds: 0, modifier: null, relics: [], campResult: null, eventText: null, _panel: 'map' };
  RUN.edges = genRunEdges(RUN.map);
  saveRun();
  openRoguelike('map');
  sfx('phase');
}

function rlResumePanel() {
  if (!RUN) return 'raceSelect';
  if (RUN._relicDraft && RUN._relicDraft.length) return 'relic';
  return RUN._panel === 'victory' ? 'victory' : 'map';
}

function openRoguelike(panel) {
  if (!RUN && panel !== 'raceSelect') panel = 'raceSelect';
  if (RUN) RUN.inBattle = false;
  document.getElementById('game').style.display = 'none';
  document.getElementById('deckbuilder').style.display = 'none';
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('roguelike').style.display = 'flex';
  renderRoguelike(panel || 'map');
}

function rlTrackHtml() {
  return RUN.map.map((col, i) => {
    const nodes = col.map((t, k) => {
      const info = RUN_NODE_INFO[t];
      let cls = 'rl-node', pick = '';
      if (i < RUN.floor) cls += RUN.path[i] === k ? ' done' : ' skip';
      else if (i === RUN.floor) {
        if (RUN.curNode == null && RUN._panel === 'map') {
          if (rlReachable().indexOf(k) >= 0) { cls += ' cur'; pick = ' data-rl="pick-node" data-k="' + k + '"'; }
          else cls += ' skip';
        }
        else if (RUN.path[i] === k) cls += ' cur';
      }
      return '<div class="' + cls + '"' + pick + '>' + info.icon + '<span>' + info.name + '</span></div>';
    }).join('');
    return '<div class="rl-col">' + nodes + '</div>';
  }).join('<div class="rl-link"></div>');
}

function rlDeckHtml() {
  const cnt = {};
  RUN.deck.forEach(d => { cnt[d.name] = (cnt[d.name] || 0) + 1; });
  return Object.keys(cnt).sort((a, b) => (findDef(a).cost - findDef(b).cost) || a.localeCompare(b))
    .map(n => findDef(n).cost + '费 ' + n + (cnt[n] > 1 ? ' ×' + cnt[n] : '')).join('<br>');
}

// 阵营卡池（排除纪念卡），抓牌/商店/事件/通关奖励共用
function factionPool(race) { return CARD_DEFS.filter(d => d.race === race && !d.memorial); }

function draftChoices() {
  const faction = factionPool(RUN.race);
  const neutral = CARD_DEFS.filter(d => d.race === '中立' && !d.memorial);
  const pool = faction.concat(faction, neutral); // 阵营权重 x2
  const picks = [];
  while (picks.length < 3 && pool.length) {
    const d = pool[Math.floor(Math.random() * pool.length)];
    if (picks.indexOf(d) < 0) picks.push(d);
  }
  return picks;
}

function enemyDeckFor(node) {
  const noMem = d => !d.memorial;
  if (node === 'elite') return randomDeckDefs(CARD_DEFS.filter(d => noMem(d) && d.cost <= 8).map(d => ({ def: d, max: 3 })));
  if (node === 'boss') {
    const race = RUN.modifier === 'calm' ? '元素' : '墓园';
    return randomDeckDefs(CARD_DEFS.filter(d => noMem(d) && d.race === race).map(d => ({ def: d, max: 4 })));
  }
  if (node === 'finalBoss') return randomDeckDefs(CARD_DEFS.filter(d => noMem(d) && (d.cost >= 6 || d.race === '城堡' || d.race === '地下城')).map(d => ({ def: d, max: 3 })));
  return randomDeckDefs(CARD_DEFS.filter(d => noMem(d) && d.cost <= 5).map(d => ({ def: d, max: 2 })));
}

function relicDraftChoices() {
  const pool = Object.keys(RUN_RELICS).filter(id => RUN.relics.indexOf(id) < 0);
  return shuffle(pool).slice(0, 3);
}

function startNodeBattle() {
  const node = RUN.curNode;
  RUN.modifier = node === 'finalBoss' ? 'dragon' : node === 'boss' ? (Math.random() < 0.5 ? 'skeletons' : 'calm') : null;
  const enemyDefs = enemyDeckFor(node);
  RUN.inBattle = true;
  saveRun();
  document.getElementById('roguelike').style.display = 'none';
  showGame();
  initGame(RUN.deck.slice(), 'ai', enemyDefs, true);
  state.player.hp = state.player.maxHp = RUN.hp;
  if (node === 'boss') state.enemy.hp = state.enemy.maxHp = 25;
  if (node === 'finalBoss') state.enemy.hp = state.enemy.maxHp = 30;
  ['player', 'enemy'].forEach(side => {
    state.roundSummary.startingHp[side] = state[side].hp;
    state.roundSummary.endingHp[side] = state[side].hp;
  });
  if (RUN.modifier) log('Boss 规则：【' + RUN_MODIFIERS[RUN.modifier].name + '】' + RUN_MODIFIERS[RUN.modifier].desc);
  render();
}

// checkGameOver 分流：won 含平局（同归于尽算涉险过关，1 血续命）
function roguelikeBattleEnd(won) {
  const node = RUN.curNode;
  RUN.rounds += state.round;
  RUN.kills += state.enemy.graveyard.length;
  RUN.inBattle = false;
  if (!won) { runDefeat(); return; }
  RUN.hp = Math.max(1, state.player.hp);
  const reward = RUN_REWARDS[node] || RUN_REWARDS.battle;
  gold += reward;
  saveEconomy();
  updateGoldUi();
  sfx('win');
  const afterRelic = node === 'finalBoss' ? 'victory' : 'draft';
  if (node !== 'finalBoss') {
    RUN.curNode = null;
    RUN.floor++;
  }
  if (node === 'elite' || node === 'boss' || node === 'finalBoss') {
    const picks = relicDraftChoices();
    if (picks.length) {
      RUN._relicDraft = picks;
      RUN._afterRelic = afterRelic;
      RUN._panel = 'relic';
      saveRun();
      openRoguelike('relic');
      return;
    }
  }
  saveRun();
  if (afterRelic === 'victory') runVictory();
  else openRoguelike('draft');
}

function runDefeat() {
  const def = { name: '纪念·' + RUN.race + '远征', cost: Math.min(10, Math.ceil(RUN.kills / 2)),
    atk: Math.min(12, RUN.kills), arm: 0, hp: Math.min(15, Math.max(1, RUN.rounds)),
    race: RUN.race, type: 'unit', traits: [], rating: 60, memorial: true };
  saveMemorialDef(def);
  RUN._memorial = def;
  sfx('lose');
  openRoguelike('defeat');
}

function runVictory() {
  const pool = factionPool(RUN.race).filter(d => d.cost >= 7);
  const prize = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  if (prize) { collection[prize.name] = (collection[prize.name] || 0) + 1; saveEconomy(); }
  RUN._prize = prize;
  RUN._panel = 'victory';
  saveRun();
  sfx('win');
  openRoguelike('victory');
}

function rlRelicsHtml() {
  const relics = RUN.relics || [];
  let h = '<div class="rl-sub">当前遗物（' + relics.length + '）</div>';
  if (!relics.length) return h + '<div class="rl-note">尚未获得遗物。击败精英与 Boss 后可三选一。</div>';
  return h + relics.map(id => '<div class="rl-note"><strong>【' + RUN_RELICS[id].name + '】</strong>' + RUN_RELICS[id].desc + '</div>').join('');
}

function rlCardImg(def, cls) {
  return '<img class="' + (cls || 'rl-card') + '" src="' + faceUrlOf(def) + '" alt="' + def.name + '" title="' + def.name + '">';
}

function renderRoguelike(panel) {
  if (RUN) RUN._panel = panel;
  const body = document.getElementById('rl-body');
  let h = '';
  if (panel === 'raceSelect') {
    h += '<div class="rl-title">选择你的远征阵营</div><div class="rl-races">' +
      RACES.map(r => '<button class="btn rl-race" data-rl="race" data-race="' + r + '" style="border-color:' + (RL_RACE_COLOR[r] || '#888') + '">' + r + '</button>').join('') + '</div>';
    const mems = getMemorials();
    if (mems.length) {
      h += '<div class="rl-sub">纪念堂（' + mems.length + '）</div><div class="rl-mem-gallery">' +
        mems.slice(-12).map(d => rlCardImg(d, 'rl-mem')).join('') + '</div>';
    }
    h += '<div style="margin-top:18px"><button class="btn" data-rl="exit">返回组牌</button></div>';
  } else if (panel === 'map') {
    const node = RUN.curNode;
    h += '<div class="rl-status">第 ' + (RUN.floor + 1) + ' / ' + RUN.map.length + ' 层 · ' + RUN.race + ' · ❤️ ' + RUN.hp + '/' + RUN.maxHp + ' · 🪙 ' + gold + ' · 牌组 ' + RUN.deck.length + ' 张</div>';
    h += '<div class="rl-track">' + rlTrackHtml() + '</div>';
    if (RUN.campResult) { h += '<div class="rl-note">' + RUN.campResult + '</div>'; RUN.campResult = null; }
    if (!node) {
      h += '<div class="rl-title">选择道路</div><div class="rl-note">点击上方高亮节点，选择本层要前往的地方。</div>';
    } else if (node === 'campfire') {
      h += '<div class="rl-title">篝火</div><div class="rl-note">休整一下：强化一张牌（70% +1攻/+2血，30% 销毁），或稳妥恢复生命。</div>' +
        '<button class="btn" data-rl="camp-buff">强化一张牌</button> <button class="btn" data-rl="camp-heal">恢复 8 生命</button>';
    } else if (node === 'shop') {
      h += '<div class="rl-title">商店</div><div class="rl-note">可重复购买，离开后继续前进。</div>' +
        '<button class="btn" data-rl="shop-remove">删一张牌（' + SHOP_PRICES.remove + '🪙）</button> <button class="btn" data-rl="shop-buy">随机阵营卡（' + SHOP_PRICES.buyCard + '🪙）</button> ' +
        '<button class="btn" data-rl="shop-heal">恢复 6 生命（' + SHOP_PRICES.heal + '🪙）</button> <button class="btn" data-rl="shop-leave">离开商店</button>';
    } else if (node === 'event') {
      h += '<div class="rl-title">❓ 随机事件</div><div class="rl-note">前方迷雾重重，触发一个随机事件。</div>' +
        '<button class="btn" data-rl="enter-event">触发事件</button>';
    } else {
      const mod = node === 'boss' || node === 'finalBoss' ? '<div class="rl-note">⚠️ Boss 战：将有特殊规则！</div>' : '';
      h += '<div class="rl-title">' + RUN_NODE_INFO[node].icon + ' ' + RUN_NODE_INFO[node].name + '</div>' + mod +
        '<button class="btn btn-primary" data-rl="enter-node">进入战斗</button>';
    }
    h += rlRelicsHtml();
    h += '<div class="rl-sub">牌组（' + RUN.deck.length + '）</div><div class="rl-deck-list">' + rlDeckHtml() + '</div>';
    h += '<div style="margin-top:16px"><button class="btn btn-danger" data-rl="abandon">放弃闯关</button></div>';
  } else if (panel === 'relic') {
    const picks = RUN._relicDraft || [];
    h += '<div class="rl-status">第 ' + RUN.floor + ' / ' + RUN.map.length + ' 层 · ' + RUN.race + ' · ❤️ ' + RUN.hp + '/' + RUN.maxHp + '</div>';
    h += '<div class="rl-title">遗物奖励：选择一件加入本次远征</div><div class="rl-cards">' +
      picks.map((id, i) => '<div class="rl-card" data-rl="relic-pick" data-i="' + i + '"><div class="rl-title">【' + RUN_RELICS[id].name + '】</div><div class="rl-note">' + RUN_RELICS[id].desc + '</div></div>').join('') + '</div>';
    h += rlRelicsHtml();
  } else if (panel === 'draft') {
    const picks = draftChoices();
    RUN._draft = picks;
    h += '<div class="rl-status">第 ' + RUN.floor + ' / ' + RUN.map.length + ' 层 · ' + RUN.race + ' · ❤️ ' + RUN.hp + '/' + RUN.maxHp + ' · 🪙 ' + gold + '</div>';
    h += '<div class="rl-title">战利品：选择一张加入牌组</div><div class="rl-cards">' +
      picks.map((d, i) => '<div data-rl="draft-pick" data-i="' + i + '">' + rlCardImg(d) + '</div>').join('') + '</div>' +
      '<button class="btn" data-rl="draft-skip">跳过</button>';
  } else if (panel === 'camp-pick') {
    h += '<div class="rl-title">选择要强化的牌（70% +1攻/+2血，30% 销毁）</div><div class="rl-deck-pick">' +
      RUN.deck.map((d, i) => '<button class="btn rl-mini" data-rl="camp-pick" data-i="' + i + '">' + d.cost + '费 ' + d.name + '</button>').join('') + '</div>' +
      '<button class="btn" data-rl="camp-cancel">算了</button>';
  } else if (panel === 'shop-remove') {
    h += '<div class="rl-title">选择要移除的牌（' + SHOP_PRICES.remove + '🪙）</div><div class="rl-deck-pick">' +
      RUN.deck.map((d, i) => '<button class="btn rl-mini" data-rl="shop-remove-pick" data-i="' + i + '">' + d.cost + '费 ' + d.name + '</button>').join('') + '</div>' +
      '<button class="btn" data-rl="shop-back">返回商店</button>';
  } else if (panel === 'event') {
    h += '<div class="rl-status">第 ' + RUN.floor + ' / ' + RUN.map.length + ' 层 · ' + RUN.race + ' · ❤️ ' + RUN.hp + '/' + RUN.maxHp + ' · 🪙 ' + gold + '</div>';
    h += '<div class="rl-track">' + rlTrackHtml() + '</div><div class="rl-title">❓ 事件</div><div class="rl-note">' + (RUN.eventText || '') + '</div>' +
      '<button class="btn" data-rl="event-continue">继续前进</button>';
  } else if (panel === 'defeat') {
    const m = RUN._memorial;
    h += '<div class="rl-title">远征终结……</div><div class="rl-note">你在第 ' + (RUN.floor + 1) + ' 层倒下了。总击杀 ' + RUN.kills + '，存活 ' + RUN.rounds + ' 轮。</div>';
    h += '<div class="rl-note">你的远征化作了一张纪念卡：</div><div class="rl-cards">' + rlCardImg(m) + '</div>';
    h += '<button class="btn" data-rl="defeat-continue">收下纪念卡并返回</button>';
  } else if (panel === 'victory') {
    h += '<div class="rl-title">🎉 通关！你完成了' + RUN.race + '远征！</div>';
    h += '<div class="rl-note">总击杀 ' + RUN.kills + ' · 存活 ' + RUN.rounds + ' 轮 · 获得 300🪙' +
      (RUN._prize ? ' · 额外奖励【' + RUN._prize.name + '】已入库' : '') + '</div>';
    if (RUN._prize) h += '<div class="rl-cards">' + rlCardImg(RUN._prize) + '</div>';
    h += '<button class="btn" data-rl="victory-continue">返回组牌</button>';
  }
  body.innerHTML = h;
}

function rlAction(act, ds) {
  if (act === 'race') { startRun(ds.race); return; }
  if (act === 'exit') { showBuilder(); return; }
  if (act === 'abandon') { if (confirm('确定放弃本次闯关？进度将清空。')) { clearRun(); showBuilder(); } return; }
  if (!RUN) return;
  if (act === 'pick-node') {
    if (RUN.curNode != null || RUN._panel !== 'map') return;
    const k = parseInt(ds.k, 10);
    if (rlReachable().indexOf(k) < 0) return; // 未连通的节点不可选
    RUN.curNode = RUN.map[RUN.floor][k];
    RUN.path[RUN.floor] = k;
    saveRun();
    if (RUN.curNode === 'battle' || RUN.curNode === 'elite' || RUN.curNode === 'boss' || RUN.curNode === 'finalBoss') { startNodeBattle(); return; }
    renderRoguelike('map');
    return;
  }
  if (act === 'enter-node') { startNodeBattle(); return; }
  if (act === 'enter-event') { resolveEventNode(); renderRoguelike('event'); return; }
  if (act === 'relic-pick') {
    if (RUN._panel !== 'relic' || !Array.isArray(RUN._relicDraft)) return;
    const id = RUN._relicDraft[parseInt(ds.i, 10)];
    if (!RUN_RELICS[id] || RUN.relics.indexOf(id) >= 0) return;
    RUN.relics.push(id);
    log('【闯关】获得遗物【' + RUN_RELICS[id].name + '】');
    const next = RUN._afterRelic;
    RUN._relicDraft = null;
    RUN._afterRelic = null;
    saveRun();
    if (next === 'victory') runVictory();
    else openRoguelike('draft');
    return;
  }
  if (act === 'draft-pick') {
    const d = RUN._draft[parseInt(ds.i, 10)];
    if (d) { RUN.deck.push(d); log('【闯关】获得【' + d.name + '】'); }
    saveRun();
    openRoguelike('map');
    return;
  }
  if (act === 'draft-skip') { saveRun(); openRoguelike('map'); return; }
  if (act === 'camp-buff') { renderRoguelike('camp-pick'); return; }
  if (act === 'camp-cancel') { renderRoguelike('map'); return; }
  if (act === 'camp-heal') {
    RUN.hp = Math.min(RUN.maxHp, RUN.hp + 8);
    RUN.campResult = '在篝火旁恢复了 8 点生命（' + RUN.hp + '/' + RUN.maxHp + '）';
    RUN.curNode = null;
    RUN.floor++;
    saveRun();
    openRoguelike('map');
    return;
  }
  if (act === 'camp-pick') {
    const i = parseInt(ds.i, 10);
    const d = RUN.deck[i];
    if (!d) return;
    if (Math.random() < 0.7) {
      RUN.deck[i] = Object.assign({}, d, { atk: d.atk + 1, hp: d.hp + 2 });
      RUN.campResult = '【' + d.name + '】获得强化：+1 攻 / +2 血！';
      sfx('heal');
    } else {
      RUN.deck.splice(i, 1);
      RUN.campResult = '【' + d.name + '】被篝火吞噬了……';
      sfx('death');
    }
    RUN.curNode = null;
    RUN.floor++;
    saveRun();
    openRoguelike('map');
    return;
  }
  if (act === 'shop-remove') { if (gold < SHOP_PRICES.remove) { alert('金币不足'); return; } renderRoguelike('shop-remove'); return; }
  if (act === 'shop-back') { renderRoguelike('map'); return; }
  if (act === 'shop-remove-pick') {
    if (gold < SHOP_PRICES.remove) { alert('金币不足'); return; }
    const i = parseInt(ds.i, 10);
    const d = RUN.deck.splice(i, 1)[0];
    gold -= SHOP_PRICES.remove;
    saveEconomy();
    updateGoldUi();
    RUN.campResult = '移除了【' + (d ? d.name : '?') + '】';
    saveRun();
    renderRoguelike('map');
    return;
  }
  if (act === 'shop-buy') {
    if (gold < SHOP_PRICES.buyCard) { alert('金币不足'); return; }
    const pool = factionPool(RUN.race);
    if (!pool.length) return;
    const d = pool[Math.floor(Math.random() * pool.length)];
    gold -= SHOP_PRICES.buyCard;
    RUN.deck.push(d);
    saveEconomy();
    updateGoldUi();
    RUN.campResult = '购入【' + d.name + '】';
    saveRun();
    renderRoguelike('map');
    return;
  }
  if (act === 'shop-heal') {
    if (gold < SHOP_PRICES.heal) { alert('金币不足'); return; }
    gold -= SHOP_PRICES.heal;
    RUN.hp = Math.min(RUN.maxHp, RUN.hp + 6);
    saveEconomy();
    updateGoldUi();
    RUN.campResult = '恢复了 6 点生命（' + RUN.hp + '/' + RUN.maxHp + '）';
    saveRun();
    renderRoguelike('map');
    return;
  }
  if (act === 'shop-leave') { RUN.curNode = null; RUN.floor++; saveRun(); openRoguelike('map'); return; }
  if (act === 'event-continue') { openRoguelike('map'); return; }
  if (act === 'defeat-continue') { clearRun(); showBuilder(); return; }
  if (act === 'victory-continue') { clearRun(); showBuilder(); return; }
}
document.getElementById('rl-body').addEventListener('click', e => {
  const el = e.target.closest('[data-rl]');
  if (el) rlAction(el.dataset.rl, el.dataset);
});

// 事件节点：进入即结算
function resolveEventNode() {
  const r = Math.random();
  if (r < 0.4) {
    gold += 80;
    RUN.eventText = '拾到了 80 金币！';
  } else if (r < 0.7) {
    const pool = factionPool(RUN.race);
    const d = pool[Math.floor(Math.random() * pool.length)];
    RUN.deck.push(d);
    RUN.eventText = '获得卡牌【' + d.name + '】！';
  } else {
    RUN.hp = Math.min(RUN.maxHp, RUN.hp + 10);
    RUN.eventText = '恢复了 10 点生命（' + RUN.hp + '/' + RUN.maxHp + '）';
  }
  RUN.curNode = null;
  RUN.floor++;
  saveEconomy();
  updateGoldUi();
  saveRun();
}

document.getElementById('open-roguelike').addEventListener('click', () => {
  loadRun();
  openRoguelike(RUN ? rlResumePanel() : 'raceSelect');
});
