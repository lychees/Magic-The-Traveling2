'use strict';
// net.js — 从 index.html 按域拆分（plain script，共享全局词法作用域）
// ---------- 联机对战（PeerJS + 房主权威；transport 可注入以便测试） ----------
const NET = {
  role: null,        // null=离线 | 'host' | 'guest' | 'spectator'
  peer: null,
  roomCode: null,
  pwd: '',
  hostName: '', guestName: '',
  guestConn: null,   // host → 玩家2 的连接
  spectators: [],    // host → 观战连接
  conn: null,        // client → 房主的连接
  guestDeck: null,   // host：玩家2 提交的牌组（def 数组）
  started: false,    // host：对局是否已开始
};

function netAvailable() { return typeof Peer !== 'undefined'; }
function netLocalSide() { return NET.role === 'guest' ? 'enemy' : 'player'; }
function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}
function netStatus(msg) {
  const el = document.getElementById('net-status');
  if (el) el.textContent = msg;
}
// 本机玩家在当前状态下能否执行部署动作
function localDeployAllowed(side) {
  if (!state || state.phase !== 'deploy' || state.gameOver) return false;
  if (NET.role === 'spectator') return false;
  if (state.mode === 'pvp') return state.deploySide === side;
  return side === 'player';
}

// 房主初始化（不含 Peer 网络层，便于测试注入）
function netHostInit(pwd, name) {
  netLeave();
  NET.role = 'host';
  NET.pwd = pwd || '';
  NET.hostName = name || '玩家1';
  NET.roomCode = genRoomCode();
  return NET.roomCode;
}

// ---------- 快照（按接收者个性化） ----------
function serializeMinion(m) {
  return {
    uid: m.uid, name: m.name, cost: m.cost, atk: m.atk, arm: m.arm,
    baseAtk: m.baseAtk, baseMaxHp: m.baseMaxHp, maxHp: m.maxHp, curHp: m.curHp,
    traits: m.traits.slice(), spell: m.spell, spellParam: m.spellParam,
    actSpell: m.actSpell, spellCost: m.spellCost, spellMana: m.spellMana, spellManaMax: m.spellManaMax,
    row: m.row, poison: m.poison, canAttack: m.canAttack, counterLeft: m.counterLeft,
    recallable: m.recallable, playedRound: m.playedRound, costPaid: m.costPaid,
    pendingTransform: !!m.pendingTransform, defense: !!m.defense, faceDown: !!m.faceDown,
    grounded: !!m.grounded, morale: m.morale || 0,
  };
}

// 对手/观战视角下的翻面卡打码：只暴露 uid/faceDown/row，不泄露卡名与数值
function maskFaceDown(m) {
  return { uid: m.uid, name: '？？？', cost: 0, atk: 0, arm: 0, baseAtk: 0, baseMaxHp: 1, maxHp: 1, curHp: 1,
    traits: [], spell: null, spellParam: 0, actSpell: null, spellCost: 0, spellMana: 0, spellManaMax: 0,
    row: m.row, poison: 0, canAttack: false, counterLeft: 0,
    recallable: false, playedRound: 0, costPaid: 0,
    pendingTransform: false, defense: false, faceDown: true, grounded: false, morale: 0 };
}

// forSide：接收者所控制的 side（guest='enemy'）；null = 观战者（两边手牌/牌库都不可见）
function makeSnapshot(forSide) {
  const snap = {
    t: 'state', phase: state.phase, round: state.round, deploySide: state.deploySide,
    gameOver: state.gameOver, anims: state.anims, logLines: logLines.slice(),
    tactics: { player: state.tactics.player, enemy: state.tactics.enemy },
    tacticsActive: !!state._tacticsActive, battleSpeed: state.battleSpeed || 1,
    roundSummary: state.roundSummary || null,
    hostName: NET.hostName, guestName: NET.guestName,
    sides: {},
  };
  ['player', 'enemy'].forEach(sd => {
    const p = state[sd];
    const reveal = forSide === sd;
    snap.sides[sd] = {
      hp: p.hp, maxHp: p.maxHp, mana: p.mana, maxMana: p.maxMana,
      burned: p.burned, fatigue: p.fatigue,
      deckCount: p.deck.length, handCount: p.hand.length,
      hand: reveal ? p.hand.map(d => d.name) : null,
      deck: reveal ? p.deck.map(d => d.name) : null,
      board: p.board.map(m => (!reveal && m.faceDown) ? maskFaceDown(m) : serializeMinion(m)),
      graveyard: p.graveyard.map(serializeMinion),
    };
  });
  return snap;
}

function netBroadcast() {
  if (NET.role !== 'host' || !state) return;
  try {
    if (NET.guestConn) NET.guestConn.send(makeSnapshot('enemy'));
    NET.spectators.forEach(c => c.send(makeSnapshot(null)));
  } catch (e) {}
}

// ---------- 房主侧消息处理（join / deck / act） ----------
function hostHandleData(conn, msg) {
  if (!msg || !msg.t) return;
  if (msg.t === 'join') hostHandleJoin(conn, msg);
  else if (msg.t === 'deck') hostHandleDeck(conn, msg);
  else if (msg.t === 'act') hostHandleAct(conn, msg);
}

function hostHandleJoin(conn, msg) {
  if ((msg.pwd || '') !== NET.pwd) { conn.send({ t: 'reject', reason: '密码错误' }); return; }
  if (msg.spectate) {
    NET.spectators.push(conn);
    conn.send({ t: 'accept', role: 'spectator', hostName: NET.hostName, guestName: NET.guestName });
    if (NET.started && state) conn.send(makeSnapshot(null));
    return;
  }
  if (NET.guestConn) { conn.send({ t: 'reject', reason: '房间已满' }); return; }
  if (NET.started) { conn.send({ t: 'reject', reason: '对局已开始' }); return; }
  NET.guestConn = conn;
  NET.guestName = msg.name || '玩家2';
  conn.send({ t: 'accept', role: 'guest', hostName: NET.hostName, guestName: NET.guestName });
  netStatus('玩家 2（' + NET.guestName + '）已加入，等待双方提交牌组');
}

function validateDeckMsg(names) {
  if (!Array.isArray(names) || names.length < DECK_MIN || names.length > DECK_MAX) return null;
  const counts = {};
  const deck = [];
  for (let i = 0; i < names.length; i++) {
    const d = findDef(names[i]);
    if (!d) return null;
    counts[d.name] = (counts[d.name] || 0) + 1;
    if (counts[d.name] > MAX_COPIES) return null;
    deck.push(d);
  }
  return deck;
}

function hostHandleDeck(conn, msg) {
  if (conn !== NET.guestConn || NET.started) return;
  const deck = validateDeckMsg(msg.deck);
  if (!deck) { conn.send({ t: 'deckReject', reason: '牌组不合法（20–60 张、每种 ≤4、卡名有效）' }); return; }
  NET.guestDeck = deck;
  conn.send({ t: 'deckAccept' });
  netStatus('玩家 2 牌组已就绪，可以点击「开始战斗」');
  renderBuilder();
}

// 房主权威：guest 动作校验后执行，非法回 actReject
function hostHandleAct(conn, msg) {
  if (conn !== NET.guestConn || !state) return;
  if (msg.kind === 'battleSpeed') {
    if (!setBattleSpeed(msg.value)) conn.send({ t: 'actReject', reason: '战斗速度无效' });
    netBroadcast();
    return;
  }
  if (state.gameOver) return;
  if (state.phase !== 'deploy' || state.deploySide !== 'enemy') {
    conn.send({ t: 'actReject', reason: '现在不是你的部署阶段' });
    return;
  }
  let ok = true;
  switch (msg.kind) {
    case 'play': {
      // 按卡名定位手牌（避免两端手牌顺序差异）；法术卡带 targetUid 选目标
      const i = state.enemy.hand.findIndex(d => d.name === msg.name);
      if (i < 0) { ok = false; break; }
      const def2 = state.enemy.hand[i];
      if (def2.type === 'spell') {
        // 聚灵奇术多选载荷 picks；墓地单选传 graveSide/graveIndex；治疗可传 healHero；其余按 targetUid
        const t2 = msg.picks ? { picks: msg.picks.map(pk => ({ graveSide: pk.graveSide, graveIndex: pk.graveIndex | 0 })) }
          : msg.graveSide ? { graveSide: msg.graveSide, graveIndex: msg.graveIndex | 0 }
          : msg.sacHand != null ? { sacHand: msg.sacHand | 0 }
          : msg.sacUid != null ? { sacUid: msg.sacUid | 0 }
          : msg.healHero ? { hero: true }
          : (msg.targetUid == null ? null : msg.targetUid | 0);
        ok = !!playCard('enemy', i, null, null, false, t2);
        break;
      }
      const m2 = playCard('enemy', i, msg.row == null ? null : msg.row | 0, msg.beforeUid == null ? null : msg.beforeUid | 0);
      if (m2 && msg.defense) { m2.defense = true; log('【' + m2.name + '】以守备表示入场'); }
      ok = !!m2;
      break;
    }
    case 'move': ok = moveMinion(msg.uid | 0, msg.row | 0, msg.beforeUid == null ? null : msg.beforeUid | 0, 'enemy'); break;
    case 'recall': ok = recallMinion(msg.uid | 0, 'enemy'); break;
    case 'cast': ok = castUnitSpell('enemy', msg.uid | 0,
      msg.key ? { key: msg.key, targetUid: msg.targetUid | 0 }
      : msg.graveIndex != null ? { key: 'summonDemon', graveIndex: msg.graveIndex | 0 }
      : null); break;
    case 'land': ok = toggleLand('enemy', msg.uid | 0, msg.value == null ? null : !!msg.value); break;
    case 'defense': ok = toggleDefense('enemy', msg.uid | 0, msg.value == null ? null : !!msg.value); break;
    case 'flip': ok = flipUnit('enemy', msg.uid | 0); break;
    case 'set': {
      // 盖放：按卡名定位手牌，默认落位
      const i = state.enemy.hand.findIndex(d => d.name === msg.name);
      if (i < 0) { ok = false; break; }
      ok = playCard('enemy', i, null, null, true);
      break;
    }
    case 'tactic': ok = setTactic('enemy', msg.key, true); break;
    case 'endDeploy':
      if (state.deploySide === state._firstSide) {
        state.deploySide = otherSide(state.deploySide);
        log('—— 等待 ' + sideName(state.deploySide) + ' 部署 ——');
      } else {
        startCombat();
      }
      break;
    default: ok = false;
  }
  if (!ok) conn.send({ t: 'actReject', reason: '动作无法执行' });
  netBroadcast(); // 状态变化后广播（render 内部也会广播，这里兜底）
}

// 房主开始游戏（双方牌组就绪后）
function netHostStartGame() {
  if (NET.role !== 'host' || !NET.guestDeck) return false;
  NET.started = true;
  showGame();
  initGame(deckFrom(builderSel), 'pvp', NET.guestDeck);
  return true;
}

function hostConnClosed(conn) {
  if (conn === NET.guestConn) {
    NET.guestConn = null;
    if (NET.started && state && !state.gameOver) {
      state.gameOver = true;
      document.getElementById('result-text').textContent = '对方已断线，对局结束';
      document.getElementById('gold-gain').textContent = '';
      document.getElementById('overlay').classList.add('show');
    } else {
      netStatus('玩家 2 已离开');
      NET.guestDeck = null;
    }
  } else {
    NET.spectators = NET.spectators.filter(c => c !== conn);
  }
}

// ---------- 客户端（guest / spectator）侧 ----------
function clientSend(msg) {
  if (NET.conn) {
    try { NET.conn.send(msg); } catch (e) {}
  }
}

// 联机动作转发：guest 把本地操作发给房主并返回 true（调用点据此 return）；非 guest 返回 false
function netAct(payload) {
  if (NET.role !== 'guest') return false;
  clientSend(Object.assign({ t: 'act' }, payload));
  return true;
}

function clientHandleData(msg) {
  if (!msg || !msg.t) return;
  switch (msg.t) {
    case 'accept':
      NET.role = msg.role;
      NET.hostName = msg.hostName || NET.hostName;
      NET.guestName = msg.guestName || NET.guestName;
      netStatus(msg.role === 'spectator' ? '已加入观战，等待房主开局…' : '已加入房间，请组牌后点击「提交牌组」');
      renderBuilder();
      break;
    case 'reject':
      netStatus('加入被拒：' + msg.reason);
      NET.role = null;
      break;
    case 'deckAccept':
      netStatus('牌组已提交，等待房主开始…');
      break;
    case 'deckReject':
      netStatus('牌组被拒：' + msg.reason);
      break;
    case 'state':
      applySnapshot(msg);
      break;
    case 'actReject':
      netStatus('动作被拒：' + msg.reason);
      break;
    case 'peerLeft':
    case 'closed':
      if (state && !state.gameOver) showNetEndNotice(msg.t === 'closed' ? '房间已关闭' : '对方已断线，对局结束');
      break;
  }
}

function showNetEndNotice(text) {
  if (state) state.gameOver = true;
  document.getElementById('result-text').textContent = text;
  document.getElementById('gold-gain').textContent = '';
  document.getElementById('overlay').classList.add('show');
}

function clientConnClosed() {
  if (state && !state.gameOver) showNetEndNotice('房间已关闭（房主已离开）');
}

// 瘦客户端：快照写入本地 state 再 render（不跑任何游戏逻辑）
function applySnapshot(snap) {
  NET.hostName = snap.hostName || NET.hostName;
  NET.guestName = snap.guestName || NET.guestName;
  const mkSide = sd => {
    const s = snap.sides[sd];
    return {
      hp: s.hp, maxHp: s.maxHp, mana: s.mana, maxMana: s.maxMana,
      burned: s.burned, fatigue: s.fatigue,
      deck: s.deck ? s.deck.map(findDef) : new Array(s.deckCount).fill(null),
      hand: s.hand ? s.hand.map(findDef) : new Array(s.handCount).fill(null),
      board: s.board, graveyard: s.graveyard,
    };
  };
  state = {
    player: mkSide('player'), enemy: mkSide('enemy'),
    mode: 'pvp', phase: snap.phase, round: snap.round, deploySide: snap.deploySide,
    gameOver: snap.gameOver,
    tactics: Object.assign({ player: null, enemy: null }, snap.tactics || {}),
    _tacticsActive: !!snap.tacticsActive,
    battleSpeed: [1, 2, 4].indexOf(snap.battleSpeed) >= 0 ? snap.battleSpeed : 1,
    roundSummary: snap.roundSummary || null,
    anims: snap.anims || { attacker: null, shaken: [], heroHit: null, dying: [] },
  };
  logLines = snap.logLines || [];
  showGame();
  render();
  if (snap.gameOver) {
    const pDead = snap.sides.player.hp <= 0, eDead = snap.sides.enemy.hp <= 0;
    let text;
    if (pDead && eDead) text = '同归于尽！';
    else text = eDead ? sideName('player') + ' 获胜！' : sideName('enemy') + ' 获胜！';
    document.getElementById('result-text').textContent = text;
    document.getElementById('gold-gain').textContent = '';
    document.getElementById('overlay').classList.add('show');
  }
}

function netLeave() {
  try {
    if (NET.role === 'host') {
      if (NET.guestConn) NET.guestConn.send({ t: 'closed' });
      NET.spectators.forEach(c => c.send({ t: 'closed' }));
    }
    if (NET.peer) NET.peer.destroy();
  } catch (e) {}
  NET.role = null; NET.peer = null; NET.conn = null; NET.guestConn = null;
  NET.spectators = []; NET.guestDeck = null; NET.started = false; NET.roomCode = null;
}

let uid = 0;
let state = null;
let logLines = [];
// 组牌选择：name -> 数量（保留上次所选）。builderSel = 人机/玩家1；builderSel2 = 玩家2
const builderSel = {};
const builderSel2 = {};
let curSel = builderSel; // 组牌界面当前编辑的选择
let builderMode = 'ai';  // 组牌界面模式：'ai' | 'pvp'
let builderStep = 1;     // pvp 组牌步骤：1=玩家1 2=玩家2

// ---------- 交机隐私屏 ----------
let passContinue = null;
function showPassScreen(text, onContinue) {
  passContinue = onContinue || null;
  document.getElementById('pass-text').textContent = text;
  document.getElementById('pass-screen').classList.add('show');
}
function confirmPass() {
  document.getElementById('pass-screen').classList.remove('show');
  const fn = passContinue;
  passContinue = null;
  if (fn) fn();
  else if (state) render();
}
