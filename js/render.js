'use strict';
// render.js — 从 index.html 按域拆分（plain script，共享全局词法作用域）
// ---------- 渲染 ----------
// 卡面立绘窗：种族/个体色系径向渐变底 + 居中大号符号
function artBg(def) {
  const art = def.art || { icon: '❔', hue: 200 };
  const sat = def.race === '墓园' ? 22 : 45;
  return 'radial-gradient(circle at 35% 28%, hsla(' + art.hue + ',' + sat + '%,62%,.95), hsl(' + art.hue + ',' + sat + '%,20%))';
}
function artHtml(def) {
  const art = def.art || { icon: '❔', hue: 200 };
  return '<div class="art" aria-hidden="true" style="background:' + artBg(def) + '">' + art.icon + '</div>';
}

function traitsHtml(traits) {
  return traits.map(t => '<span class="trait-badge" title="' + traitText(t) + '" aria-label="' + t + '：' + traitText(t) + '">' + t + '</span>').join('');
}

// 种族底色类：race0=人族(灰白) race1=精灵族(绿) race2=魔物族(红褐) race3=不死族(黑)
function raceClass(def) {
  return 'race' + Math.max(0, RACES.indexOf(def.race));
}

// ghost=true：死亡动画幽灵卡（先晃动再消失），不可交互
function minionHtml(m, isEnemy, ghost) {
  const classes = ['minion'];
  const def = findDef(m.name);
  classes.push(def ? raceClass(def) : 'race9'); // 卡面底色按种族；敌我靠上下区域区分（打码的翻面卡无 def 用中立色）
  // 攻击动画：攻击者突进、受伤者晃动；士气特效：高涨金光/低落灰暗
  if (state.anims && !ghost) {
    if (state.anims.attacker === m.uid) classes.push('lunge');
    if (state.anims.shaken.indexOf(m.uid) >= 0) classes.push('shake');
  }
  if (!ghost && state.moraleFx && state.moraleFx.uid === m.uid) {
    classes.push(state.moraleFx.kind === 'up' ? 'morale-up' : 'morale-down');
  }
  // 法术命中高亮（按系别色发光）
  let spellHitStyle = '';
  if (!ghost && state.spellFx && state.spellFx.uids.indexOf(m.uid) >= 0) {
    classes.push('spell-hit');
    spellHitStyle = 'box-shadow:0 0 16px ' + state.spellFx.color + ', 0 0 6px ' + state.spellFx.color + ';';
  }
  // 战术预览目标高亮
  if (!ghost && tacPreview && tacPreview.hl && tacPreview.hl[m.uid]) classes.push('tac-hl');
  const draggable = !ghost && !isEnemy && state.phase === 'deploy' && !state.gameOver;
  // 本轮刚打出且无入场效果的随从可单击收回：青色虚线描边提示（已用法术的不再提示）
  const recallable = !ghost && !isEnemy && state.phase === 'deploy' && !state.gameOver &&
    m.recallable && m.playedRound === state.round && !(m.actSpell && m._usedSpell);
  if (recallable) classes.push('recallable');
  // 法术选目标模式：高亮合法目标（法术卡或单位法术 祝福/冰箭）
  if (!ghost && !m.faceDown && state.spellTargetMode) {
    const mode = state.spellTargetMode;
    if (mode.unitSpell) {
      const mySideT = state.player.board.indexOf(m) >= 0 ? 'player' : 'enemy';
      const asT = activeSide();
      const want = (mode.key === 'bless' || mode.key === 'repair') ? (mySideT === asT && !m.isSpellShell && (mode.key !== 'repair' || m.traits.includes('机械'))) : (mySideT !== asT && !m.isSpellShell);
      if (want) classes.push('targetable');
    } else if (mode.def && legalSpellTargets(activeSide(), mode.def).indexOf(m) >= 0) {
      classes.push('targetable');
    }
  }
  if (ghost) classes.push('dying');
  if (m.defense) classes.push('defense'); // 守备表示：卡面横向加宽（宽度×2）
  if (isFlying(m)) classes.push('flying'); // 飞行：视觉上漂浮（不参与战场宽度）
  const actionable = !ghost && !m.faceDown && !m.defense && m.canAttack && m.atk > 0 &&
    !m.blind && !(m.petrified > 0) && awake(m);
  if (actionable && state.phase === 'combat') classes.push('can-attack');
  if (!ghost && !isEnemy && state.phase === 'deploy' && !state.gameOver) classes.push('deploy-ready');
  const spell = m.spell ? '<div class="m-spell">' + SPELL_TEXT[m.spell] + '</div>' : '<div class="m-spell"></div>';
  const poisonBadge = m.poison > 0
    ? '<span class="trait-badge poison" title="中毒：每轮部署阶段开始时受到 ' + m.poison + ' 点伤害">中毒' + m.poison + '</span>' : '';
  const chargeBadge = m.pendingTransform
    ? '<span class="trait-badge" style="background:#7a5a2a;color:#ffe8b0;" title="下一轮准备阶段开始时变形为【绿龙】">蓄力中</span>' : '';
  const defBadge = m.defense
    ? '<span class="trait-badge" style="background:#2a4a7a;color:#b0d0ff;" title="守备表示：不主动攻击；无限次反击且反击同时结算；被随机选取概率×2">守备</span>' : '';
  const landBadge = m.grounded
    ? '<span class="trait-badge" style="background:#4a5a3a;color:#c8e0a0;" title="落地：暂时失去飞行效果，参与地面阵型；可再起飞">落地</span>' : '';
  const petrifiedBadge = (m.petrified || 0) > 0
    ? '<span class="trait-badge" style="background:#4a4a4a;color:#c0c0c0;" title="石化：无法行动/反击，护甲 +3，剩余 ' + m.petrified + ' 回合">石化' + m.petrified + '</span>' : '';
  const awakenBadge = !awake(m)
    ? '<span class="trait-badge" style="background:#4a4a2a;color:#e8d8a0;" title="觉醒：需被攻击 ' + traitLv(m, '觉醒') + ' 次后才能攻击/反击/切换守备表示">觉醒' + (m._awaken || 0) + '/' + traitLv(m, '觉醒') + '</span>' : '';
  const boonBadge = m.boonOfLife
    ? '<span class="trait-badge" style="background:#4a5e2a;color:#d0e8a0;" title="生还的宝礼：在场时，我方每次从墓地召唤卡牌进入手牌或战场，摸一张牌">宝礼</span>' : '';
  const blindBadge = (m.blind || 0) > 0
    ? '<span class="trait-badge" style="background:#3a3a4e;color:#b0b0e0;" title="失明：无法攻击/反击/施放法术/切换形态，剩余 ' + m.blind + ' 回合">失明' + m.blind + '</span>' : '';
  const moraleBadge = (m.morale || 0) !== 0
    ? '<span class="trait-badge" style="background:' + (m.morale > 0 ? '#2a5e2a' : '#6e2a2a') + ';color:' + (m.morale > 0 ? '#a0e8a0' : '#f0a0a0') + ';" title="士气：正值每点 = 10% 概率额外行动一次；负值每点 = 10% 概率无法行动/反击失败">士' + (m.morale > 0 ? '+' : '') + m.morale + '</span>' : '';
  const hpClass = m.maxHp > (def ? def.hp : m.maxHp) ? 'stat-hp buffed' : 'stat-hp';
  const action = ghost ? '' : ' data-action="' + (isEnemy ? 'attack-minion' : 'select-minion') + '" data-uid="' + m.uid + '"';
  const mySide = state.player.board.indexOf(m) >= 0 ? 'player' : 'enemy';
  // 翻面表示：渲染为卡背（对手不可见卡面）；所有者部署阶段可翻开、可拖拽布阵、可切守备/进攻表示
  if (m.faceDown) {
    let flipBtn = '', fdCorners = '';
    if (!ghost && !isEnemy && state.phase === 'deploy' && !state.gameOver && NET.role !== 'spectator' && localDeployAllowed(mySide)) {
      flipBtn = '<button class="def-btn" data-action="flip-unit" data-uid="' + m.uid + '" title="翻开：转为正面表示并结算战吼">翻开</button>' +
        '<button class="def-btn" data-action="toggle-defense" data-uid="' + m.uid + '"' +
        ' title="守备表示：不主动攻击，但无限次反击且反击同时结算；被随机选取概率×2">' +
        (m.defense ? '→ 攻击表示' : '→ 守备表示') + '</button>';
      // 旋转把手：按住拖动旋转卡牌，转过 90° 即翻开
      fdCorners = '<div class="corner c-r rot-handle" data-uid="' + m.uid + '" title="按住拖动旋转卡牌：转过 90° 翻开">↻</div>';
    }
    return '<div class="' + classes.join(' ') + ' face-down" draggable="' + draggable + '"' +
      (!isEnemy ? ' data-drag="1" data-uid="' + m.uid + '"' : '') + '>' +
      '<div class="fd-back">🂠</div><div class="fd-label">翻面表示' + (m.defense ? '·守备' : '') + '</div>' + flipBtn + fdCorners + '</div>';
  }
  // 单位法术：法力显示 + 施放按钮（部署阶段、下方半场=当前部署方可操作；直接执行不走单击延时）
  let castRow = '';
  if (!ghost && (m.actSpell || m.actSpells || m.spellManaMax > 0)) {
    const foe = state[otherSide(mySide)];
    const condOf = key => !unitSpellBoardCond(m, key, mySide) ? false
      : key === 'bless' ? state[mySide].board.some(x => isTargetable(x))
      : key === 'iceBolt' ? foe.board.some(x => isTargetable(x))
      : key === 'repair' ? state[mySide].board.some(x => isTargetable(x) && x.traits.includes('机械'))
      : key === 'genieBless' ? state[mySide].board.some(x => isTargetable(x))
      : true; // 研读/收获等无条件
    const labelOf = UNIT_SPELL_LABEL;
    const entries = unitSpellEntries(m);
    const canAct = !isEnemy && state.phase === 'deploy' && !state.gameOver && NET.role !== 'spectator';
    castRow = '<div class="m-cast-row"><span class="m-mana">法 ' + m.spellMana + '/' + m.spellManaMax + '</span>' +
      (canAct
        ? entries.map(e =>
            '<button class="cast-btn" data-action="cast-spell" data-uid="' + m.uid + '" data-key="' + e.key + '"' +
            (localDeployAllowed(mySide) && !m.blind && m.spellMana >= e.cost && condOf(e.key) ? '' : ' disabled') +
            ' title="' + UNIT_SPELL_TEXT[e.key] + '">✦' + labelOf[e.key] + '（' + e.cost + '）</button>').join('')
        : '') + '</div>';
  }
  // 守备表示切换按钮（部署阶段、当前部署方可操作）
  let defBtn = '';
  let corners = '';
  if (!ghost && !isEnemy && state.phase === 'deploy' && !state.gameOver && NET.role !== 'spectator' && localDeployAllowed(mySide)) {
    defBtn = '<div class="m-cast-row">' +
      (gameConfig.allowDefense
        ? '<button class="def-btn" data-action="toggle-defense" data-uid="' + m.uid + '"' +
          ' title="守备表示：不主动攻击，但无限次反击且反击同时结算；被随机选取概率×2">' +
          (m.defense ? '→ 攻击表示' : '→ 守备表示') + '</button>'
        : '') +
      (m.traits.includes('飞行') && !m.faceDown
        ? '<button class="def-btn" data-action="toggle-land" data-uid="' + m.uid + '"' +
          ' title="落地：暂时失去飞行效果、移到地面阵型；可再起飞">' + (m.grounded ? '↑ 起飞' : '✈ 落地') + '</button>'
        : '') + '</div>';
    // 旋转把手：按住拖动旋转卡牌（90° 步进），松手切换姿态
    corners = '<div class="corner c-r rot-handle" data-uid="' + m.uid + '" title="按住拖动旋转卡牌：90°=守备表示，回正=攻击表示">↻</div>';
  }
  if (!ghost && state.epicUid === m.uid) classes.push('epic-in'); // 高费单位入场发光
  const a11y = ghost ? '' : ' role="button" tabindex="0" aria-label="' + m.name + '，攻 ' + m.atk + '，甲 ' + effArmor(m) + '，血 ' + Math.max(0, m.curHp) + '，' + (m.defense ? '守备表示' : (actionable ? '可行动' : '攻击表示')) + '；Shift+Enter 查看详情"';
  return '<div class="' + classes.join(' ') + '" draggable="' + draggable + '"' + (recallable ? ' title="单击收回手牌（双击查看详情）"' : '') + a11y +
    (spellHitStyle ? ' style="' + spellHitStyle + '"' : '') + action + '>' +
    '<div class="m-name">' + m.name + '</div>' +
    (def ? artHtml(def) : '') +
    '<div class="m-traits">' + traitsHtml(m.traits) + poisonBadge + blindBadge + boonBadge + awakenBadge + petrifiedBadge + chargeBadge + defBadge + landBadge + moraleBadge + '</div>' +
    castRow +
    defBtn +
    spell +
    '<div class="m-stats"><span class="stat-atk">攻' + m.atk + '</span><span class="stat-arm">甲' + effArmor(m) + '</span><span class="' + hpClass + '">血' + Math.max(0, m.curHp) + '</span></div>' +
    corners +
  '</div>';
}

function handCardHtml(def, i, side) {
  const cost = effCost(side, def);
  // 可打出：费用够 + 部署阶段 + pvp 下是该侧的部署回合
  const canAct = state.phase === 'deploy' && !state.gameOver &&
    (state.mode !== 'pvp' || state.deploySide === side);
  const afford = state[side].mana >= cost && canAct;
  const availability = afford ? '可打出' : (state.phase !== 'deploy' ? '等待部署阶段' : '法力不足或等待部署方');
  const a11y = ' role="button" tabindex="0" aria-label="' + def.name + '，费用 ' + cost + '，' + availability + '；Enter 出牌，Shift+Enter 查看详情" title="单击出牌 · 双击或 Shift+Enter 查看详情"';
  // 法术卡牌：系别徽标 + 法术标签；禁止拖拽落位（盖放走「盖放」按钮）
  if (def.type === 'spell') {
    const sch = SCHOOL_INFO[def.school] || { label: '?', color: '#888' };
    const sel = state.spellTargetMode && state.spellTargetMode.def === def ? ' selected' : '';
    const setBtn = afford && NET.role !== 'spectator' && gameConfig.allowSet
      ? '<button class="set-btn" data-action="set-hand" data-idx="' + i + '" title="盖放这张法术卡：翻开时立即结算（需要目标的随机选合法目标）">盖放</button>' : '';
    return '<div class="hand-card spell-card ' + raceClass(def) + sel + (afford ? ' playable' : ' unaffordable') + '" draggable="false" data-action="play-hand" data-idx="' + i + '"' + a11y +
      ' style="border-color:' + sch.color + ';box-shadow:0 0 10px ' + sch.color + '44;background:linear-gradient(160deg,' + sch.color + '26,#151713 55%)">' +
      '<div class="c-cost">' + cost + '</div>' +
      '<div class="school-badge" style="background:' + sch.color + '" title="' + sch.label + '系法术">' + sch.label + '</div>' +
      '<div class="c-name">' + (def.legend ? '★' : '') + def.name + '</div>' +
      artHtml(def) +
      '<div class="spell-label">法术 · ' + sch.label + '系</div>' +
      '<div class="c-spell">' + SPELL_FX_TEXT[def.spellEffect] + '</div>' +
      setBtn +
    '</div>';
  }
  const spellText = def.spell ? SPELL_TEXT[def.spell]
    : (def.actSpell ? '法术·' + UNIT_SPELL_TEXT[def.actSpell] : '');
  const spell = spellText ? '<div class="c-spell">' + spellText + '</div>' : '<div class="c-spell"></div>';
  const setBtn = afford && NET.role !== 'spectator' && gameConfig.allowSet
    ? '<button class="set-btn" data-action="set-hand" data-idx="' + i + '" title="翻面表示盖放（默认守备表示）：不触发战吼；不会成为攻击目标、不主动攻击；仍可回蓝、吃 buff；之后可翻开">盖放</button>' : '';
  const hCorners = afford && NET.role !== 'spectator'
    ? '<div class="corner c-r rot-handle" data-idx="' + i + '" title="按住拖动旋转卡牌：90°=守备入场，180°=盖放，回正=攻击入场">↻</div>' : '';
  return '<div class="hand-card ' + raceClass(def) + (afford ? ' playable' : ' unaffordable') + '" draggable="' + afford + '" data-action="play-hand" data-idx="' + i + '"' + a11y + '>' +
    '<div class="c-cost">' + cost + '</div>' +
    '<div class="c-name">' + (def.legend ? '★' : '') + def.name + '</div>' +
    artHtml(def) +
    '<div class="c-traits">' + traitsHtml(def.traits) + '</div>' +
    spell +
    cardStatsHtml(def) +
    setBtn +
    hCorners +
  '</div>';
}

function heroHtml(side) {
  const p = state[side];
  const isPvp = state.mode === 'pvp';
  const name = isPvp ? sideName(side) : (side === 'enemy' ? '敌方英雄' : '你的英雄');
  const burned = p.burned > 0 ? ' <span class="burned-tag">下轮法力 −' + p.burned + '</span>' : '';
  const hpPct = Math.max(0, Math.min(100, p.maxHp ? p.hp / p.maxHp * 100 : 0));
  const manaPct = Math.max(0, Math.min(100, p.maxMana ? p.mana / p.maxMana * 100 : 0));
  const tactic = tacticKeyFor(side);
  const tacticBadge = tactic ? '<span class="hero-tactic tactic-' + tactic + '">' + UI_TACTICS[tactic].label + ' · 本轮</span>' : '';
  return '<div class="portrait" aria-hidden="true">' + (side === 'enemy' ? '👿' : '🧙') + '</div>' +
    '<div class="hero-content"><div class="hero-name-row"><div class="name">' + name + '</div>' + tacticBadge + '</div>' +
    '<div class="vital-line"><span class="hp">生命 <strong>' + Math.max(0, p.hp) + '</strong><small> / ' + p.maxHp + '</small></span><span class="mana-info">法力 <strong>' + p.mana + '</strong><small> / ' + p.maxMana + '</small>' + burned + '</span></div>' +
    '<div class="hero-meters" aria-hidden="true"><span class="hp-meter"><i style="width:' + hpPct + '%"></i></span><span class="mana-meter"><i style="width:' + manaPct + '%"></i></span></div></div>';
}

const UI_TACTICS = Object.freeze({
  assault: { label: '猛攻', effect: '攻击 +1' },
  guard: { label: '坚守', effect: '有效护甲 +1' },
  rally: { label: '集结', effect: '士气 +2' },
});
function tacticKeyFor(side) {
  if (!state || !state.tactics) return null;
  const value = state.tactics[side];
  const key = typeof value === 'string' ? value : value && (value.key || value.tactic);
  return UI_TACTICS[key] ? key : null;
}
function updateBattleCommandUi() {
  const as = activeSide();
  const chosen = tacticKeyFor(as);
  const tacticApiReady = typeof setTactic === 'function';
  const canChoose = tacticApiReady && state.phase === 'deploy' && !state.gameOver &&
    NET.role !== 'spectator' && localDeployAllowed(as);
  document.querySelectorAll('[data-action="set-tactic"]').forEach(btn => {
    const key = btn.dataset.tactic;
    const selected = key === chosen;
    btn.disabled = !canChoose;
    btn.classList.toggle('selected', selected);
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    btn.title = UI_TACTICS[key].label + '：本轮己方单位' + UI_TACTICS[key].effect +
      (selected ? '；再次点击取消' : '；开战前可更改');
  });
  const tacticStatus = document.getElementById('tactic-status');
  if (tacticStatus) tacticStatus.textContent = !tacticApiReady ? '战术模块准备中' :
    (chosen ? sideName(as) + ' · ' + UI_TACTICS[chosen].label : (canChoose ? '本轮未选择' : '部署阶段可选'));
  const speed = [1, 2, 4].includes(Number(state.battleSpeed)) ? Number(state.battleSpeed) : 1;
  const speedApiReady = typeof setBattleSpeed === 'function' && NET.role !== 'spectator';
  document.querySelectorAll('[data-action="battle-speed"]').forEach(btn => {
    const selected = Number(btn.dataset.speed) === speed;
    btn.disabled = !speedApiReady;
    btn.classList.toggle('active', selected);
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
  });
  const summaryEl = document.getElementById('round-summary');
  if (!summaryEl) return;
  const summary = state.roundSummary;
  if (!summary) { summaryEl.textContent = ''; summaryEl.removeAttribute('title'); return; }
  const damage = summary.heroDamage || {};
  const lost = summary.unitsLost || {};
  const outcome = summary.outcome && summary.outcome !== 'ongoing'
    ? ' · ' + (summary.outcome === 'draw' ? '同归于尽' : sideName(summary.outcome) + '获胜') : '';
  summaryEl.textContent = '第 ' + summary.round + ' 轮' + (summary.completed ? '战报' : '交战') +
    ' · ' + sideName('player') + '伤 ' + (damage.player || 0) + ' · ' + sideName('enemy') + '伤 ' + (damage.enemy || 0) +
    ' · 阵亡 ' + ((lost.player || []).length) + ' / ' + ((lost.enemy || []).length) + outcome;
  summaryEl.title = (summary.keyResults || []).join('\n');
}

// 一方场上渲染为三排；上方半场从上到下为 后/中/前，下方半场从上到下为 前/中/后（前排相对峙）。
// isTop=true 表示渲染在上方半场（当前视角的对方）
function boardHtml(side, isTop) {
  const order = isTop ? [2, 1, 0] : [0, 1, 2];
  const p = state[side];
  const dying = (state.anims && state.anims.dying) || [];
  const rowHints = ['接触 · 护卫', '策应 · 转移', '远程 · 支援'];
  const rowHtml = r => {
    const ms = p.board.filter(m => m.row === r).map(m => ({ m: m, ghost: false }));
    // 死亡动画：把幽灵卡插回死亡时的排内位置（先晃动再消失，由动画清理统一移除）
    dying.filter(g => g.side === side && g.row === r).forEach(g => {
      ms.splice(Math.min(g.idx, ms.length), 0, { m: g.m, ghost: true });
    });
    const inner = ms.length ? ms.map(x => minionHtml(x.m, isTop, x.ghost)).join('') :
      '<div class="empty-hint">' + (isTop ? '暂无单位' : '拖拽单位到此排') + '</div>';
    const rowName = ROW_NAMES[r];
    const rowHint = r === AIR_ROW ? '飞行 · 奇袭' : rowHints[r];
    return '<div class="board-row' + (isTop ? '' : ' own-row') + (r === AIR_ROW ? ' air-row' : '') + '" data-row="' + r + '" role="group" aria-label="' + (isTop ? '敌方' : '己方') + rowName + '，' + ms.length + '个单位">' +
      '<div class="row-label"><strong>' + rowName + '</strong><small>' + rowHint + '</small></div>' +
      '<div class="row-minions">' + inner + '</div></div>';
  };
  const ground = order.map(rowHtml).join('');
  // 空中行仅在有飞行单位（或正在播放的死亡动画）时显示，避免空行占位
  const hasAir = p.board.some(m => m.row === AIR_ROW) || dying.some(g => g.side === side && g.row === AIR_ROW);
  const air = hasAir ? rowHtml(AIR_ROW) : '';
  // 空中区域悬浮在战场上方（靠近中线一侧）：上方半场放在最下，下方半场放在最上
  return isTop ? ground + air : air + ground;
}

// 墓地选取浮层：召唤骷髅兵单选 / 聚灵奇术多选（带预算）
function renderGravePickBody(mode) {
  const as = activeSide();
  const multi = !!mode.multi;
  const sel = mode.sel || {};
  let total = 0;
  Object.keys(sel).forEach(k => { total += sel[k]; });
  const sides = mode.onlySide ? [mode.onlySide] : ['player', 'enemy'];
  let html = '<h3>' + (mode.title ||
    ('【' + mode.def.name + '】' + (multi ? '：选择要召唤的墓园单位（总费用 ≤ ' + mode.budget + '）' : '：选择一个墓地单位除外'))) + '</h3>';
  sides.forEach(sd => {
    const units = state[sd].graveyard.map((g, i) => ({ g: g, i: i })).filter(x => {
      if (x.g._isSpell) return false;
      if (multi) { const gd = findDef(x.g.name); return gd && gd.race === '墓园'; }
      return true;
    });
    html += '<div class="gp-side">' + (sd === as ? '我方墓地' : '敌方墓地') + '（' + units.length + '）</div>';
    if (units.length === 0) html += '<div class="gp-empty">（空）</div>';
    units.forEach(x => {
      if (multi) {
        const key = sd + ':' + x.i;
        const on = !!sel[key];
        html += '<button class="gp-entry' + (on ? ' gp-on' : '') + '" data-action="grave-multi-toggle" data-key="' + key + '" data-cost="' + (x.g.cost || 0) + '">' +
          (on ? '✔ ' : '') + '【' + x.g.name + '】费用 ' + (x.g.cost || 0) + '</button>';
      } else {
        html += '<button class="gp-entry" data-action="grave-pick" data-gside="' + sd + '" data-gidx="' + x.i + '">' +
          '【' + x.g.name + '】费用 ' + (x.g.cost || 0) + (mode.unitSpell ? '' : ' → ' + (Math.ceil((x.g.cost || 0) / 2) + 1) + ' 个骷髅兵') + '</button>';
      }
    });
  });
  if (multi) {
    html += '<div class="gp-side">已选总费用 ' + total + ' / ' + mode.budget + '（需再消耗 ' + Math.ceil(total / 2) + ' 点法力）</div>' +
      '<button class="gp-cancel" data-action="grave-multi-confirm"' + (total === 0 ? ' disabled' : '') + '>确认召唤</button>';
  }
  html += '<button class="gp-cancel" data-action="grave-cancel">取消</button>';
  document.getElementById('grave-pick-body').innerHTML = html;
}

// 墓地选取浮层（召唤骷髅兵）：展示双方墓地的单位供选择
function showGravePick(mode) {
  if (mode.multi && !mode.sel) mode.sel = {};
  state.spellTargetMode = mode;
  renderGravePickBody(mode);
  document.getElementById('grave-pick').classList.add('show');
}

// 通用选牌浮层：entries = [{ html, data }]，点击调用 onPick(entry)；cancelable 显示取消按钮
function showCardPick(mode) {
  state.cardPick = mode;
  document.getElementById('card-pick-body').innerHTML =
    '<h3>' + mode.title + '</h3>' +
    mode.entries.map((en, i) =>
      '<button class="gp-entry" data-action="card-pick" data-idx="' + i + '">' + en.html + '</button>').join('') +
    (mode.cancelable ? '<button class="gp-cancel" data-action="card-pick-cancel">取消</button>' : '');
  document.getElementById('card-pick').classList.add('show');
}
function hideCardPick() {
  const cp = document.getElementById('card-pick');
  if (cp) cp.classList.remove('show');
  if (state) state.cardPick = null;
}
// 谦逊之壶：保留 drawn[idx] 入手（满则烧毁），其余洗入卡组随机位置
function keepHumblePick(side, drawn, idx) {
  const p = state[side];
  const keep = drawn[idx];
  drawn.forEach((d2, i2) => {
    if (i2 !== idx) p.deck.splice(Math.floor(Math.random() * (p.deck.length + 1)), 0, d2);
  });
  if (p.hand.length < HAND_LIMIT) {
    p.hand.push(keep);
    log('【谦逊之壶】：保留了【' + keep.name + '】，其余洗入卡组');
  } else {
    log('【谦逊之壶】：手牌已满，【' + keep.name + '】被烧毁，其余洗入卡组');
  }
  render();
}
// 生还的宝礼：我方每次从墓地召唤卡牌进入手牌/战场，摸一张牌（多个宝礼不叠加）
function lifeBoonProc(side, n) {
  const p = state[side];
  if (!p || n <= 0 || !p.board.some(m => m.boonOfLife)) return;
  for (let i = 0; i < n; i++) drawCard(side);
  log('【生还的宝礼】触发：' + sideName(side) + '摸 ' + n + ' 张牌');
}

function hideGravePick() {
  const gp = document.getElementById('grave-pick');
  if (gp) gp.classList.remove('show');
  if (state) state.spellTargetMode = null;
}

// ---------- 高费单位降临动画 ----------
// 7 费以上（或三围总和 ≥20 的巨型 token）单位入场时：卡面巨像 zoom-in + 色相光环 + 卡位发光
function epicSummonFx(def, m) {
  const el = document.getElementById('epic-fx');
  if (el && def && def.art) {
    el.innerHTML = '<div class="epic-icon">' + def.art.icon + '</div><div class="epic-name">【' + def.name + '】降临！</div>';
    el.style.setProperty('--epic-color', 'hsl(' + def.art.hue + ',75%,62%)');
    el.classList.remove('show');
    void el.offsetWidth; // 重启动画
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 950);
  }
  sfx('epic');
  if (state && m) {
    state.epicUid = m.uid;
    setTimeout(() => { if (!state) return; if (state.epicUid === m.uid) state.epicUid = null; render(); }, 950);
  }
}
function isEpicUnit(def) { return def && (def.cost >= 7 || (def.atk + def.arm + def.hp) >= 20); }

// 牌库 / 墓地小区域
function pileHtml(side, kind) {
  const p = state[side];
  if (kind === 'deck') {
    return '<div class="pile-card deck-back">🂠</div>' +
      '<div class="pile-n">' + p.deck.length + ' 张</div><div class="pile-label">牌库</div>';
  }
  return '<div class="pile-card grave-card">🪦</div>' +
    '<div class="pile-n">' + p.graveyard.length + ' 张</div><div class="pile-label">墓地</div>';
}

function render() {
  netBroadcast(); // 联机房主：每次状态渲染后向 guest/观战广播个性化快照
  if (globalThis.__noRender) return; // 测试 hook：无头 harness 可关闭渲染（不影响游戏逻辑）
  // 视角翻转：双人部署阶段当前部署方在下方半场；其余情况玩家1 在下方
  const vs = viewSide();
  const top = otherSide(vs), bot = vs;
  const enemyBoard = document.getElementById('enemy-board');
  const playerBoard = document.getElementById('player-board');
  enemyBoard.innerHTML = boardHtml(top, true);
  playerBoard.innerHTML = boardHtml(bot, false);
  enemyBoard.setAttribute('aria-label', sideName(top) + '的战场，后中前三排');
  playerBoard.setAttribute('aria-label', sideName(bot) + '的战场，前中后三排');

  const piles = [
    ['enemy-deck', top, '牌库'], ['enemy-grave', top, '墓地'],
    ['player-deck', bot, '牌库'], ['player-grave', bot, '墓地'],
  ];
  piles.forEach(entry => {
    const el = document.getElementById(entry[0]);
    const p = state[entry[1]];
    el.innerHTML = pileHtml(entry[1], entry[2] === '牌库' ? 'deck' : 'grave');
    const count = entry[2] === '牌库' ? p.deck.length : p.graveyard.length;
    el.setAttribute('aria-label', '查看' + sideName(entry[1]) + '的' + entry[2] + '，' + count + ' 张');
  });

  // 上方手牌恒为卡背；下方手牌：人机模式或部署阶段显示真牌，双人进攻阶段也盖卡背（全员观战）
  document.getElementById('enemy-hand').innerHTML =
    '<span class="hand-count">' + sideName(top) + '手牌 <strong>' + state[top].hand.length + '</strong> 张</span>' +
    state[top].hand.map(() => '<div class="card-back" aria-hidden="true"></div>').join('');
  const showHand = state.mode === 'ai' || state.phase === 'deploy';
  // 联机瘦客户端：未 reveal 的手牌是 null 占位，此时盖卡背
  const botHandReal = showHand && state[bot].hand.every(c => !!c);
  // 手牌按费用排序展示（直接排序手牌数组，保证渲染下标与出牌下标一致；null 占位不排）
  if (state[bot].hand.every(c => !!c)) state[bot].hand.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
  document.getElementById('player-hand').innerHTML = botHandReal
    ? state[bot].hand.map((c, i) => handCardHtml(c, i, bot)).join('')
    : ('<span class="hand-count">' + sideName(bot) + '手牌 <strong>' + state[bot].hand.length + '</strong> 张</span>' +
       state[bot].hand.map(() => '<div class="card-back" aria-hidden="true"></div>').join(''));

  const enemyHero = document.getElementById('enemy-hero');
  const playerHero = document.getElementById('player-hero');
  enemyHero.innerHTML = heroHtml(top);
  playerHero.innerHTML = heroHtml(bot);
  enemyHero.setAttribute('aria-label', sideName(top) + '英雄，生命 ' + Math.max(0, state[top].hp) + '/' + state[top].maxHp + '，法力 ' + state[top].mana + '/' + state[top].maxMana);
  playerHero.setAttribute('aria-label', sideName(bot) + '英雄，生命 ' + Math.max(0, state[bot].hp) + '/' + state[bot].maxHp + '，法力 ' + state[bot].mana + '/' + state[bot].maxMana);
  // 英雄被直击时晃动
  const heroHit = state.anims && state.anims.heroHit;
  enemyHero.classList.toggle('shake', heroHit === top);
  playerHero.classList.toggle('shake', heroHit === bot);
  // 治疗选目标模式：己方英雄高亮可点
  playerHero.classList.toggle('targetable',
    !!(state.spellTargetMode && state.spellTargetMode.def && state.spellTargetMode.def.spellEffect === 'heal'));

  // 区域标签
  document.getElementById('enemy-label').textContent = state.mode === 'pvp' ? sideName(top) + ' · 敌方半场' : '敌方半场';
  document.getElementById('hand-label').textContent =
    state.mode === 'pvp' && state.phase !== 'deploy' ? '进攻阶段 · 双方观战'
    : (state.mode === 'pvp' ? sideName(bot) + '的手牌' : '你的手牌') + ' · 单击出牌 / 拖拽布阵 / 双击查看详情';

  let phaseText = state.phase === 'deploy' ? '部署阶段' : '自动战斗';
  if (state.mode === 'pvp' && state.phase === 'deploy') phaseText += ' · ' + sideName(state.deploySide);
  // 联机：非己方部署时明确提示等待
  if (NET.role && NET.role !== 'spectator' && state.phase === 'deploy' && !state.gameOver &&
      state.deploySide !== netLocalSide()) phaseText = '等待 ' + sideName(state.deploySide) + ' 部署…';
  document.getElementById('turn-indicator').textContent = state.gameOver ? '游戏结束' : ('第 ' + state.round + ' 轮 · ' + phaseText);
  const btn = document.getElementById('end-turn');
  if (NET.role === 'spectator') {
    btn.textContent = '观战中';
    btn.disabled = true;
  } else if (NET.role === 'guest') {
    const myTurn = !state.gameOver && state.phase === 'deploy' && state.deploySide === 'enemy';
    btn.textContent = state.phase !== 'deploy' ? '战斗中…' : (myTurn ? '完成部署' : '等待对方部署…');
    btn.disabled = !myTurn;
  } else if (NET.role === 'host') {
    const myTurn = !state.gameOver && state.phase === 'deploy' && state.deploySide === 'player';
    btn.textContent = state.phase !== 'deploy' ? '战斗中…' : (myTurn ? '完成部署' : '等待对方部署…');
    btn.disabled = state.phase !== 'deploy' || state.gameOver || !myTurn;
  } else {
    btn.textContent = state.phase !== 'deploy' ? '战斗中…'
      : (state.mode === 'pvp' && state.deploySide === 'player' ? '完成部署' : '开始战斗');
    btn.disabled = state.phase !== 'deploy' || state.gameOver;
  }
  btn.setAttribute('aria-label', btn.textContent);
  updateBattleCommandUi();
  updateGuideVisibility();
  // 战术预览面板随渲染刷新
  renderTacPreview();
}

// ---------- 组牌 ----------
function selCount() {
  return Object.keys(curSel).reduce((s, k) => s + curSel[k], 0);
}

// 加一张入牌组：不超过可携带数量 min(MAX_COPIES, 拥有数)、总数不超过 DECK_MAX
function tryAddCard(name) {
  const def = findDef(name);
  if (!def) return false;
  if ((curSel[name] || 0) >= maxCopiesOf(def) || selCount() >= DECK_MAX) return false;
  curSel[name] = (curSel[name] || 0) + 1;
  return true;
}

// 合法牌组：20 ≤ 总数 ≤ 60，且收藏总量足够（不足请先开卡包）
function canStartBattle() {
  const t = selCount();
  return t >= DECK_MIN && t <= DECK_MAX && ownedTotal() >= DECK_MIN;
}

// 收藏变化后过滤不合法的选择（clamp 到可携带数量）
function sanitizeSel(sel) {
  Object.keys(sel).forEach(k => {
    const def = findDef(k);
    if (!def) { delete sel[k]; return; }
    const max = maxCopiesOf(def);
    if (sel[k] > max) sel[k] = max;
  });
}

// 牌组统计：法力曲线（0..6、7+ 八桶，按张数）+ 各阵营种数/总张数
function deckStats() {
  const curve = [0, 0, 0, 0, 0, 0, 0, 0];
  const races = {};
  RACES.forEach(r => { races[r] = { kinds: 0, total: 0 }; });
  const spells = { kinds: 0, total: 0 };
  CARD_DEFS.forEach(d => {
    const n = curSel[d.name] || 0;
    if (n === 0) return;
    curve[Math.min(d.cost, 7)] += n;
    // 法术卡单独统计，不计入阵营（中立只统计单位卡）
    if (d.type === 'spell') { spells.kinds++; spells.total += n; return; }
    races[d.race].kinds++;
    races[d.race].total += n;
  });
  return { curve: curve, races: races, spells: spells };
}

// 随机生成一副 20–30 张的合法牌组（纯函数，不动组牌界面状态）。
// pool 为 [{def, max}]；缺省为全卡池（AI 用，不受收藏限制）。
function randomDeckDefs(pool) {
  if (!pool) pool = CARD_DEFS.map(d => ({ def: d, max: MAX_COPIES }));
  if (pool.length === 0) return [];
  const kinds = Math.min(pool.length, 10 + Math.floor(Math.random() * 6));
  const picked = shuffle(pool.slice()).slice(0, kinds);
  const counts = {};
  let total = 0;
  picked.forEach(x => { const n = 1 + Math.floor(Math.random() * x.max); counts[x.def.name] = n; total += n; });
  const pickedAvail = picked.reduce((s, x) => s + x.max, 0);
  const target = Math.min(DECK_MIN, pickedAvail);
  let guard = 0;
  while (total < target && guard++ < 1000) {
    const x = picked[Math.floor(Math.random() * picked.length)];
    if (counts[x.def.name] < x.max) { counts[x.def.name]++; total++; }
  }
  guard = 0;
  while (total > 30 && guard++ < 1000) {
    const x = picked[Math.floor(Math.random() * picked.length)];
    if (counts[x.def.name] > 1) { counts[x.def.name]--; total--; }
  }
  const deck = [];
  picked.forEach(x => { for (let i = 0; i < counts[x.def.name]; i++) deck.push(x.def); });
  return deck;
}

// 随机牌组：从已拥有卡中生成，填入组牌界面并返回
function buildRandomDeck() {
  const defs = randomDeckDefs(ownedDefs().map(d => ({ def: d, max: maxCopiesOf(d) })));
  Object.keys(curSel).forEach(k => { curSel[k] = 0; });
  defs.forEach(d => { curSel[d.name] = (curSel[d.name] || 0) + 1; });
  return defs;
}

// 从指定选择对象生成牌组数组
function deckFrom(sel) {
  const deck = [];
  CARD_DEFS.forEach(d => {
    for (let i = 0; i < (sel[d.name] || 0); i++) deck.push(d);
  });
  return deck;
}

function selectedDeck() {
  return deckFrom(curSel);
}

// 卡面缓存：复用 3D 检视的卡面生成器（window.__drawCardFace 由 holo 模块暴露）
const faceCache = {};
function faceUrlOf(def) {
  if (def.name in faceCache) return faceCache[def.name];
  let url = '';
  if (window.__drawCardFace) {
    try { url = window.__drawCardFace(def, CARD_DEFS.indexOf(def)).toDataURL('image/jpeg', 0.85); } catch (e) { url = ''; }
  }
  if (url) faceCache[def.name] = url; // 失败不缓存，等模块就绪后重试
  return url;
}

// 阵营色渐变（沿用 3D 卡牌配色：深色纵向渐变）
function raceShade(race, l) {
  const hex = RACE_DOT[RACES.indexOf(race)] || '#888888';
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const li = (mx + mn) / 2;
  let h = 0, sat = 0;
  if (mx !== mn) {
    const d = mx - mn;
    sat = li > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return 'hsl(' + Math.round(h) + ',' + Math.round(sat * 100) + '%,' + l + '%)';
}
function dbCardBg(def) {
  const schC = def.type === 'spell' ? (SCHOOL_INFO[def.school] || {}).color : null;
  if (schC) return 'background:linear-gradient(160deg,' + schC + '30,#141713 58%)';
  return 'background:linear-gradient(180deg,' + raceShade(def.race, 24) + ',' + raceShade(def.race, 13) + ' 58%, #10130f)';
}

function dbCardHtml(def) {
  const n = curSel[def.name] || 0;
  const max = maxCopiesOf(def);
  const a11y = ' role="button" tabindex="0" aria-label="将' + def.name + '加入牌组，费用 ' + def.cost + '，已选 ' + n + ' 张，最多 ' + max + ' 张；Shift+Enter 查看详情" title="单击加入牌组 · 双击或 Shift+Enter 查看详情"';
  const badges = '<div class="c-cost" aria-label="费用 ' + def.cost + '">' + def.cost + '</div>' +
    '<div class="picked-badge">' + (n ? '已选 ' + n + '/' + max : '可带 ' + max) + '</div>' +
    '<div class="rating-badge" title="战斗力评分 ' + def.rating + '">' + def.rating + '</div>';
  // 法术卡牌：系别徽标 + 法术标签，不显示三维
  if (def.type === 'spell') {
    const sch = SCHOOL_INFO[def.school] || { label: '?', color: '#888' };
    return '<div class="db-card spell-card ' + raceClass(def) + (n >= max ? ' maxed' : '') + (n ? ' in-deck' : '') + '" data-action="add-card" data-name="' + def.name + '"' + a11y +
      ' style="border-color:' + sch.color + ';box-shadow:0 0 10px ' + sch.color + '38;' + dbCardBg(def) + '">' + badges +
      '<div class="school-badge" style="background:' + sch.color + '" title="' + sch.label + '系法术">' + sch.label + '</div>' +
      '<div class="c-name">' + (def.legend ? '★' : '') + def.name + '</div>' +
      '<div class="c-own">拥有 ×' + ownedOf(def.name) + '</div>' +
      artHtml(def) +
      '<div class="spell-label">法术 · ' + sch.label + '系</div>' +
      '<div class="c-spell">' + SPELL_FX_TEXT[def.spellEffect] + '</div>' +
    '</div>';
  }
  const spellText = def.spell ? SPELL_TEXT[def.spell]
    : (def.actSpell ? '法术·' + UNIT_SPELL_TEXT[def.actSpell] : '');
  const spell = spellText ? '<div class="c-spell">' + spellText + '</div>' : '<div class="c-spell"></div>';
  return '<div class="db-card ' + raceClass(def) + (n >= max ? ' maxed' : '') + (n ? ' in-deck' : '') + '" data-action="add-card" data-name="' + def.name + '"' + a11y +
    ' style="' + dbCardBg(def) + '">' + badges +
    '<div class="c-name">' + (def.legend ? '★' : '') + def.name + '</div>' +
    '<div class="c-own">拥有 ×' + ownedOf(def.name) + '</div>' +
    artHtml(def) +
    '<div class="c-traits">' + traitsHtml(def.traits || []) + '</div>' +
    spell +
    cardStatsHtml(def) +
  '</div>';
}

// ---------- 预设卡组 ----------
const PRESET_DECKS = [
  {
    name: '帕斯卡 · 海精灵',
    cards: {
      '帕斯卡': 1, '泉水精灵': 2, '海洋精灵': 2, '水手': 2, '海员': 2, '海贼': 2,
      '皇家海盗': 2, '暴风鸟': 2, '暴风雕': 2, '海洋女巫': 2, '海洋术士': 2,
      '鱼人': 1, '大王乌贼': 1, '治疗': 2, '冰箭': 2, '镜像术': 1, '旋涡': 2,
    },
  },
  {
    name: '艾达 · 学者',
    cards: {
      '艾达': 1, '法师': 2, '大法师': 2, '僧侣': 2, '大祭司': 2, '魔女': 2, '精灵法师': 2,
      '祭司': 1, '石像鬼': 2, '钻石人': 1, '泰坦': 1, '冰箭': 2, '闪电箭': 2, '火球术': 2,
      '连锁闪电': 1, '祝福': 1, '驱散': 1, '镜像术': 1, '治疗': 1, '龙卷风': 1,
    },
  },
];

// ---------- 13 套阵营默认卡组（代码生成） ----------
// 召唤类法术（召唤物会破坏同阵营士气纯度，默认卡组不带）
const SUMMON_FX = ['summonAir', 'summonEarth', 'summonWater', 'summonFire', 'summonThunder',
  'raiseSkeletons', 'slimeSwarm', 'mirror', 'revive', 'animateDead'];
// 通用型法术（伤害/治疗/增益类，用于默认卡组法术位）
const GENERIC_FX = ['sear', 'iceBolt', 'fireballSpell', 'lightningBolt', 'thunderBolt', 'meteor',
  'inspireAll', 'dreadAll',
  'earthSpikes', 'deathRipple', 'doom', 'hellfire', 'meteorShower', 'vortex', 'chainLightning',
  'heal', 'healingWave', 'bless', 'bloodlust', 'holyShield', 'fireShield', 'stoneSkin',
  'inspire', 'frenzy', 'airShield'];

// 生成一套正好 30 张的阵营默认卡组：
// 纯阵营单位按 rating 降序、费用分档携带（1–3费 4张 / 4–5费 3张 / 6–7费 2张 / 8费+ 1张）；
// 超额从最高费（同费取 rating 最低）开始删；不足则低费卡（同费取 rating 高）补到满 4；
// 法术位至多 6 张：通用型、排除召唤类，按 rating 降序。
function buildRacePreset(race) {
  const cards = {};
  // 法术（至多 6 张）
  const spells = CARD_DEFS.filter(d => d.type === 'spell' && GENERIC_FX.indexOf(d.spellEffect) >= 0)
    .sort((a, b) => b.rating - a.rating || a.cost - b.cost);
  let spellTotal = 0;
  for (let i = 0; i < spells.length && spellTotal < 6; i++) {
    const n = Math.min(4, 6 - spellTotal);
    cards[spells[i].name] = n;
    spellTotal += n;
  }
  // 纯阵营单位
  const units = CARD_DEFS.filter(d => d.type !== 'spell' && d.race === race)
    .sort((a, b) => b.rating - a.rating || a.cost - b.cost || (a.name < b.name ? -1 : 1));
  const band = c => (c <= 3 ? 4 : c <= 5 ? 3 : c <= 7 ? 2 : 1);
  units.forEach(d => { cards[d.name] = (cards[d.name] || 0) + band(d.cost); });
  let total = Object.keys(cards).reduce((s, k) => s + cards[k], 0);
  // 超过 30：从最高费开始删
  const trimList = units.slice().sort((a, b) => b.cost - a.cost || a.rating - b.rating);
  while (total > 30) {
    const d = trimList.find(x => (cards[x.name] || 0) > 0);
    if (!d) break;
    cards[d.name]--;
    if (cards[d.name] === 0) delete cards[d.name]; // 删到 0 直接移除，不留 ×0 占位
    total--;
  }
  // 不够 30：低费卡补到满 4
  const fillList = units.slice().sort((a, b) => a.cost - b.cost || b.rating - a.rating);
  while (total < 30) {
    const d = fillList.find(x => (cards[x.name] || 0) < 4);
    if (!d) break;
    cards[d.name] = (cards[d.name] || 0) + 1; total++;
  }
  return { name: race + ' · 标准', cards: cards };
}
RACES.forEach(r => PRESET_DECKS.push(buildRacePreset(r)));
// 墓园预设定制：骷髅海全满编 + 主题法术（替换通用法术位）
(function () {
  const necro = PRESET_DECKS.find(d => d.name === '墓园 · 标准');
  if (necro) necro.cards = {
    '骷髅': 4, '骷髅勇士': 4, '骷髅弓手': 4, '吸血蝙蝠': 4, '僵尸': 4, '行尸': 4,
    '召唤骷髅兵': 2, '聚灵奇术': 2, '死亡波纹': 2,
  };
})();
function applyPresetDeck(preset) {
  Object.keys(curSel).forEach(k => { curSel[k] = 0; });
  Object.keys(preset.cards).forEach(name => {
    if (!findDef(name)) return;
    for (let i = 0; i < preset.cards[name]; i++) {
      if (!tryAddCard(name)) break;
    }
  });
  renderBuilder();
}

// ---------- 组牌筛选 ----------
// off 集合：默认全部显示，点击 chip 把该项加入 off（隐藏）
let builderKw = ''; // 组牌关键字检索（名称 + 全部描述文字）
function cardSearchText(d) {
  const bits = [d.name, d.race, String(d.cost)];
  (d.traits || []).forEach(t => { bits.push(t, traitText(t) || ''); });
  if (d.spell) bits.push(SPELL_TEXT[d.spell] || '');
  if (d.actSpell) bits.push(UNIT_SPELL_TEXT[d.actSpell] || '');
  (d.actSpells || []).forEach(s => bits.push(UNIT_SPELL_TEXT[s.key] || ''));
  if (d.type === 'spell') bits.push(SPELL_FX_TEXT[d.spellEffect] || '', (d.school || '') + '系');
  return bits.join(' ');
}
function isVanilla(d) { // 白板：没有任何特性（词条/战吼/亡语/法术）的单位
  return d.type !== 'spell' && (d.traits || []).length === 0 && !d.spell && !d.actSpell && !d.actSpells;
}
const builderFilter = { races: {}, costs: {}, types: {}, schools: {}, traits: {} };
const FILTER_GROUPS = [
  { key: 'races', label: '阵营', vals: () => RACES.map(r => ({ v: r, t: r })) },
  { key: 'costs', label: '费用', vals: () => [0, 1, 2, 3, 4, 5, 6, 7].map(c => ({ v: c, t: c === 7 ? '7+' : String(c) })) },
  { key: 'types', label: '类型', vals: () => [{ v: 'unit', t: '单位' }, { v: 'spell', t: '法术' }] },
  { key: 'schools', label: '派系', vals: () => ['土', '水', '火', '气'].map(s => ({ v: s, t: s + '系' })) },
  // 词条：选中即包含（只显示带选中特性的单位；不选=全部显示）
  { key: 'traits', label: '词条', include: true, vals: () => {
    const set = {};
    CARD_DEFS.forEach(d => (d.traits || []).forEach(t => { set[t] = true; }));
    return [{ v: '__vanilla__', t: '白板' }].concat(Object.keys(set).sort().map(t => ({ v: t, t: t })));
  } },
];

function costBucket(cost) { return cost >= 7 ? 7 : cost; }

function matchBuilderFilter(d) {
  if (builderKw && cardSearchText(d).toLocaleLowerCase().indexOf(builderKw.toLocaleLowerCase()) < 0) return false;
  if (builderFilter.races[d.race]) return false;
  if (builderFilter.costs[costBucket(d.cost)]) return false;
  const ty = d.type === 'spell' ? 'spell' : 'unit';
  if (builderFilter.types[ty]) return false;
  if (ty === 'spell' && builderFilter.schools[d.school]) return false;
  // 词条（选中即包含）：有选中词条时，单位卡必须带至少一个选中特性
  const selTraits = Object.keys(builderFilter.traits);
  if (selTraits.length > 0 && ty === 'unit' &&
      !(d.traits || []).some(t => builderFilter.traits[t]) &&
      !(builderFilter.traits['__vanilla__'] && isVanilla(d))) return false; // 白板 = 没有任何特性的单位
  return true;
}

let builderSort = 'race';
const BUILDER_SORTS = [
  { value: 'race', label: '按阵营分区' },
  { value: 'cost', label: '费用：从低到高' },
  { value: 'costDesc', label: '费用：从高到低' },
  { value: 'rating', label: '战斗力：从高到低' },
  { value: 'name', label: '名称：拼音顺序' },
];
function compareBuilderCards(a, b) {
  if (builderSort === 'costDesc') return b.cost - a.cost || a.name.localeCompare(b.name, 'zh-CN');
  if (builderSort === 'rating') return (b.rating || 0) - (a.rating || 0) || a.cost - b.cost || a.name.localeCompare(b.name, 'zh-CN');
  if (builderSort === 'name') return a.name.localeCompare(b.name, 'zh-CN');
  return a.cost - b.cost || a.name.localeCompare(b.name, 'zh-CN');
}

function renderPoolFilter() {
  const previous = document.getElementById('builder-filter-details');
  const narrowScreen = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 800px)').matches;
  const filtersOpen = previous ? previous.open : !narrowScreen;
  const activeCount = Object.keys(builderFilter).reduce((n, key) => n + Object.keys(builderFilter[key]).length, 0);
  const groups = FILTER_GROUPS.map(g => {
    const include = !!g.include;
    const anyOff = include ? false : g.vals().some(x => builderFilter[g.key][x.v]);
    const anyOn = include && g.vals().some(x => builderFilter[g.key][x.v]);
    return '<div class="filter-row"><span class="filter-label">' + g.label + '</span><div class="filter-values">' +
      g.vals().map(x => {
        const on = include ? !!builderFilter[g.key][x.v] : !builderFilter[g.key][x.v];
        return '<button type="button" class="filter-chip' + (on ? '' : ' off') + '" data-action="filter-chip" data-group="' + g.key + '" data-val="' + x.v + '" aria-pressed="' + on + '"' +
          (include ? ' title="' + (x.v === '__vanilla__' ? '没有任何特性（词条/战吼/亡语/法术）的单位' : (traitText(x.v) || x.v)) + '"' : '') + '>' + x.t + '</button>';
      }).join('') +
      '<button type="button" class="filter-chip filter-toggle-all" data-action="filter-toggle-all" data-group="' + g.key + '">' +
        (include ? (anyOn ? '清除' : '全选') : (anyOff ? '全选' : '全不选')) + '</button></div></div>';
  }).join('');
  const sortOptions = BUILDER_SORTS.map(o => '<option value="' + o.value + '"' + (builderSort === o.value ? ' selected' : '') + '>' + o.label + '</option>').join('');
  document.getElementById('pool-filter').innerHTML =
    '<div class="library-toolbar">' +
      '<label class="search-box" for="pool-kw"><span aria-hidden="true">⌕</span><input id="pool-kw" class="filter-kw" type="search" placeholder="搜索名称、阵营、词条或效果…" autocomplete="off" spellcheck="false" value="' + builderKw.replace(/"/g, '&quot;') + '"></label>' +
      '<label class="sort-control" for="pool-sort"><span>排序</span><select id="pool-sort" class="btn">' + sortOptions + '</select></label>' +
      '<button type="button" class="btn btn-ghost filter-reset" data-action="filter-reset">重置</button>' +
    '</div>' +
    '<details id="builder-filter-details" class="filter-details"' + (filtersOpen ? ' open' : '') + '><summary><span>精细筛选</span><small>' + (activeCount ? activeCount + ' 项已调整' : '阵营 / 费用 / 类型 / 派系 / 词条') + '</small></summary><div class="filter-groups">' + groups + '</div></details>';
}

// ---------- 对局规则配置 UI ----------
function renderGameRules() {
  const chips = (vals, cur, action) => vals.map(v =>
    '<button type="button" class="filter-chip' + (cur === v ? '' : ' off') + '" data-action="' + action + '" data-val="' + v + '" aria-pressed="' + (cur === v) + '">' + v + '</button>'
  ).join('');
  const toggle = (on, action, label) =>
    '<button type="button" class="filter-chip' + (on ? '' : ' off') + '" data-action="' + action + '" aria-pressed="' + on + '">' + label + '：' + (on ? '允许' : '禁用') + '</button>';
  document.getElementById('game-rules').innerHTML =
    '<div class="filter-row"><span class="filter-label">生命值</span><div class="filter-values">' + chips([10, 15, 20, 25, 30], gameConfig.heroHp, 'rule-hp') + '</div></div>' +
    '<div class="filter-row"><span class="filter-label">法力上限</span><div class="filter-values">' + chips([5, 8, 10, 12, 15], gameConfig.maxMana, 'rule-mana') + '</div></div>' +
    '<div class="filter-row"><span class="filter-label">部署</span><div class="filter-values">' + toggle(gameConfig.allowSet, 'rule-toggle-set', '盖牌') +
    toggle(gameConfig.allowDefense, 'rule-toggle-defense', '守备表示') + '</div></div>';
}

function renderBuilder() {
  renderPoolFilter();
  renderGameRules();
  const allOwned = ownedDefs();
  const owned = allOwned.filter(matchBuilderFilter);
  const libraryCount = document.getElementById('library-count');
  libraryCount.innerHTML = '<strong>' + owned.length + '</strong><span> / ' + allOwned.length + ' 种</span><small>收藏共 ' + ownedTotal() + ' 张</small>';
  let poolHtml = '';
  if (builderSort === 'race') {
    // 单位卡按阵营分区；法术卡单独一个「法术」大分区（按系别分组、组内按费用排序）
    poolHtml = RACES.map(race => {
      const cards = owned.filter(d => d.race === race && d.type !== 'spell').sort(compareBuilderCards);
      if (cards.length === 0) return '';
      return '<section class="race-section"><h2><span>' + race + '</span><small>' + cards.length + ' 种</small></h2><div class="race-cards">' +
        cards.map(dbCardHtml).join('') + '</div></section>';
    }).join('');
    const spellCards = owned.filter(d => d.type === 'spell');
    poolHtml += spellCards.length
      ? '<section class="race-section spell-section"><h2><span>法术</span><small>' + spellCards.length + ' 种</small></h2>' +
        ['土', '水', '火', '气'].map(sch => {
          const cards = spellCards.filter(d => d.school === sch).sort(compareBuilderCards);
          if (cards.length === 0) return '';
          const color = (SCHOOL_INFO[sch] || {}).color || '#888';
          return '<div class="school-group"><h3><span class="race-dot" style="background:' + color + '"></span>' + sch + '系 <small>' + cards.length + ' 种</small></h3>' +
            '<div class="race-cards">' + cards.map(dbCardHtml).join('') + '</div></div>';
        }).join('') + '</section>'
      : '';
  } else {
    const sorted = owned.slice().sort(compareBuilderCards);
    poolHtml = '<section class="race-section sorted-results"><h2><span>全部卡牌</span><small>' + sorted.length + ' 种</small></h2><div class="race-cards">' + sorted.map(dbCardHtml).join('') + '</div></section>';
  }
  document.getElementById('card-pool').innerHTML = poolHtml ||
    '<div class="deck-empty library-empty"><strong>' + (allOwned.length ? '没有符合条件的卡牌' : '收藏为空，请先开卡包') + '</strong><span>' + (allOwned.length ? '试试清除搜索词或重置筛选。' : '从顶部导航选择卡包或阵营商店。') + '</span>' +
    (allOwned.length ? '<button class="btn" data-action="filter-reset">重置筛选</button>' : '') + '</div>';
  updateGoldUi();

  // 双人模式：步骤指示（玩家1/玩家2 组牌中）
  document.getElementById('deck-title').textContent =
    builderMode === 'pvp' ? ('玩家 ' + builderStep + ' 的牌组') : '我的牌组';

  const total = selCount();
  const ready = canStartBattle();
  const cnt = document.getElementById('deck-count');
  cnt.innerHTML = '<strong>' + total + '</strong><span> / ' + DECK_MAX + ' 张</span>';
  cnt.classList.toggle('ready', ready);
  const progress = document.getElementById('deck-progress');
  progress.setAttribute('aria-valuemax', DECK_MAX);
  progress.setAttribute('aria-valuenow', total);
  progress.setAttribute('aria-valuetext', total + ' 张，' + (ready ? '可以开战' : '至少需要 ' + DECK_MIN + ' 张'));
  document.getElementById('deck-progress-fill').style.width = Math.min(100, total / DECK_MAX * 100) + '%';
  progress.querySelector('i').style.left = (DECK_MIN / DECK_MAX * 100) + '%';
  const readiness = document.getElementById('deck-readiness');
  readiness.classList.toggle('ready', ready);
  readiness.textContent = ownedTotal() < DECK_MIN ? '收藏不足 ' + DECK_MIN + ' 张，请先开卡包' :
    (total < DECK_MIN ? '还需 ' + (DECK_MIN - total) + ' 张即可开战' : (ready ? '牌组已就绪，可以开战' : '牌组尚未就绪'));

  const picked = CARD_DEFS.filter(d => (curSel[d.name] || 0) > 0)
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name, 'zh-CN'));
  document.getElementById('deck-list').innerHTML = picked.length
    ? picked.map(d =>
        '<button type="button" class="deck-item" data-action="remove-card" data-name="' + d.name + '" title="单击移除一张 · 双击查看详情" aria-label="从牌组移除一张' + d.name + '，当前 ' + curSel[d.name] + ' 张">' +
        '<span><span class="d-cost">' + d.cost + '</span><span class="d-name">' + d.name + '</span></span>' +
        '<span class="d-n">×' + curSel[d.name] + '</span></button>'
      ).join('')
    : '<div class="deck-empty"><strong>牌组还是空的</strong><span>从预设开始，或单击卡库卡牌加入；每种最多 ' + MAX_COPIES + ' 张。</span></div>';

  // 法力曲线 + 阵营统计，随牌组增删实时刷新
  const st = deckStats();
  const maxC = Math.max(1, Math.max.apply(null, st.curve));
  document.getElementById('mana-curve').innerHTML = st.curve.map((n, i) =>
    '<div class="bar-col" role="img" aria-label="费用 ' + CURVE_LABELS[i] + '：' + n + ' 张" title="费用 ' + CURVE_LABELS[i] + '：' + n + ' 张">' +
    '<div class="bar-n">' + (n || '–') + '</div>' +
    '<div class="bar-track"><div class="bar" style="height:' + Math.round(n / maxC * 62) + 'px"></div></div>' +
    '<div class="bar-x">' + CURVE_LABELS[i] + '</div></div>'
  ).join('');
  const raceRows = RACES.map((r, i) => ({ race: r, color: RACE_DOT[i], stats: st.races[r] }))
    .filter(x => x.stats.total > 0).sort((a, b) => b.stats.total - a.stats.total);
  const raceHtml = raceRows.map(x =>
    '<div class="race-stat"><span class="race-stat-name"><span class="race-dot" style="background:' + x.color + '"></span>' + x.race + '</span>' +
    '<strong>' + x.stats.total + '<small> 张</small></strong><small>' + x.stats.kinds + ' 种</small></div>').join('');
  const spellRow = st.spells.total ? '<div class="race-stat spell-stat"><span class="race-stat-name"><span class="race-dot"></span>法术</span><strong>' + st.spells.total + '<small> 张</small></strong><small>' + st.spells.kinds + ' 种</small></div>' : '';
  document.getElementById('race-stats').innerHTML = (raceHtml + spellRow) || '<div class="deck-empty">加入卡牌后显示阵营与法术构成。</div>';

  // 预设卡组：一键填充当前牌组选择
  document.getElementById('preset-decks').innerHTML = PRESET_DECKS.map((p, i) => {
    const parts = p.name.split(' · ');
    const count = Object.keys(p.cards).reduce((n, key) => n + p.cards[key], 0);
    return '<button class="btn preset-card" data-action="preset-deck" data-idx="' + i + '" aria-label="应用预设牌组' + p.name + '，' + count + ' 张">' +
      '<span><strong>' + parts[0] + '</strong><small>' + (parts.slice(1).join(' · ') || '主题牌组') + '</small></span><span class="preset-count">' + count + ' 张</span></button>';
  }).join('');

  const sb = document.getElementById('start-battle');
  if (ownedTotal() < DECK_MIN) {
    sb.textContent = '收藏不足 20 张，请先开卡包';
    sb.disabled = true;
  } else if (builderMode === 'net') {
    // 联机：房主=开始战斗（需 guest 已提交牌组）；guest=提交牌组；未连接不可用
    sb.textContent = NET.role === 'guest' ? '提交牌组' : '开始战斗';
    sb.disabled = !canStartBattle() || (NET.role !== 'host' && NET.role !== 'guest');
  } else {
    sb.textContent = builderMode === 'pvp' && builderStep === 1 ? '确认并交给玩家2' : '开始战斗';
    sb.disabled = !canStartBattle();
  }
  sb.setAttribute('aria-label', sb.textContent);
  updateGuideVisibility();
}

// ---------- 集卡册浮层 ----------
let albumRace = null;


// ---------- 牌库 / 墓地查看浮层 ----------
function openViewer(side, kind) {
  const p = state[side];
  const who = state.mode === 'pvp' ? sideName(side) + '的' : (side === 'player' ? '我的' : '敌方');
  // 牌库内容可见性：人机模式只有玩家能看自己的；双人/联机仅部署阶段的当前部署方能看自己的；
  // 末尾条件：联机瘦客户端未 reveal 的牌库是 null 占位，不可见
  const canSeeDeck = (state.mode === 'ai' ? (side === 'player')
    : (state.phase === 'deploy' && side === state.deploySide)) && p.deck.every(c => !!c);
  let title, list;
  if (kind === 'deck') {
    title = who + '牌库（剩余 ' + p.deck.length + ' 张）';
    if (!canSeeDeck) {
      list = '<div class="v-empty">牌库内容不可见</div>';
    } else {
      // 按费用排序、同名合并数量，不暴露抽牌顺序
      const groups = {};
      p.deck.forEach(d => {
        if (!groups[d.name]) groups[d.name] = { def: d, n: 0 };
        groups[d.name].n++;
      });
      const rows = Object.keys(groups).map(k => groups[k])
        .sort((a, b) => a.def.cost - b.def.cost || (a.def.name < b.def.name ? -1 : 1));
      list = rows.length ? rows.map(g =>
        '<div class="v-row" data-card-name="' + g.def.name + '" title="双击查看详情"><span><span class="v-cost">' + g.def.cost + '</span>' + g.def.name +
        ' <span class="v-stats">×' + g.n + '</span></span>' +
        '<span class="v-stats">攻' + g.def.atk + ' / 甲' + g.def.arm + ' / 血' + g.def.hp + '</span></div>'
      ).join('') : '<div class="v-empty">（空）</div>';
    }
  } else {
    title = who + '墓地（' + p.graveyard.length + ' 张）';
    // 按进入顺序列出，显示死亡时的最终攻/甲/血上限
    list = p.graveyard.length ? p.graveyard.map((m, i) =>
      '<div class="v-row" data-card-name="' + m.name + '" data-g-side="' + side + '" data-g-idx="' + i + '" title="双击查看详情"><span>' + m.name + '</span>' +
      '<span class="v-stats">攻' + m.atk + ' / 甲' + m.arm + ' / 血' + m.maxHp + '</span></div>'
    ).join('') : '<div class="v-empty">（空）</div>';
  }
  document.getElementById('viewer-title').textContent = title;
  document.getElementById('viewer-list').innerHTML = list;
  document.getElementById('viewer').classList.add('show');
}

function closeViewer() {
  document.getElementById('viewer').classList.remove('show');
}

// ---------- 卡牌详情浮层（双击打开） ----------
// 战斗力评分明细：血+攻+甲×3 + 词条/法术分值（飞行/远程 3，再生/法术护盾 1，拒马 0.5，其它每项 2）；法术卡本身计 1 个法术
function ratingTraitW(t) { return MTCG_RATING.traitW(t); } // 公式唯一数据源：tools/rating.js
function ratingBreakdownHtml(def) {
  if (!def || def.rating == null) return '';
  const parts = [];
  if (def.type === 'spell') {
    parts.push('法术 2');
  } else {
    parts.push('血 ' + def.hp, '攻 ' + def.atk);
    if (def.arm) parts.push('甲 ' + def.arm + '×3');
    (def.traits || []).forEach(t => parts.push(t + ' ' + ratingTraitW(t)));
    if (def.spell) parts.push('卡牌特效 2');
    if (def.actSpell) parts.push((UNIT_SPELL_LABEL[def.actSpell] || '单位法术') + ' 2');
    (def.actSpells || []).forEach(s => parts.push((UNIT_SPELL_LABEL[s.key] || s.key) + ' 2'));
  }
  return '<div class="d-trait" style="color:#b09a6a">战斗力 ' + def.rating + '</div>' +
    parts.map(pt => '<div class="d-trait" style="color:#8a7a5a;padding-left:12px">+ ' + pt + '</div>').join('');
}
// def 为卡牌定义；m 为可选的随从对象（场上/墓地），传入时显示当前状态并注明基础值
function showCardDetail(def, m) {
  if (!def) return;
  window._detailDefName = def.name; // 供「3D 检视」按钮联动
  const art = def.art || { icon: '❔', hue: 200 };
  document.getElementById('detail-panel').className = 'panel ' + raceClass(def); // 描边随种族
  // 法术卡牌：显示系别与效果，不显示三维/特性
  if (def.type === 'spell') {
    const sch = SCHOOL_INFO[def.school] || { label: '?', color: '#888' };
    document.getElementById('detail-body').innerHTML =
      '<div class="d-name">' + def.name + '</div>' +
      '<div class="art art-big" style="background:' + artBg(def) + '">' + art.icon + '</div>' +
      '<div class="d-sub">' + def.race + ' · 法术 · ' + sch.label + '系 · 费用 ' + def.cost +
        (def.rating != null ? ' · 评分 ' + def.rating : '') + ' · 拥有 ×' + ownedOf(def.name) + '</div>' +
      ratingBreakdownHtml(def) +
      '<div class="d-spell">' + SPELL_FX_TEXT[def.spellEffect] + '</div>' +
      '<div class="d-trait" style="color:#8a8a9a">' +
        (def.target === 'none' ? '（无需目标；也可盖放，翻开立即结算）' : '（需要选择' + (def.target === 'enemyUnit' ? '敌方' : '友方') + '随从为目标）') + '</div>';
    document.getElementById('detail').classList.add('show');
    return;
  }
  const traits = def.traits.length
    ? def.traits.map(t => '<div class="d-trait"><span class="trait-badge">' + t + '</span> ' + traitText(t) + '</div>').join('')
    : '<div class="d-trait" style="color:#4a4a60">（无特性）</div>';
  const spell = def.spell ? '<div class="d-spell">' + SPELL_TEXT[def.spell] + '</div>' : '';
  const unitSpell = def.actSpell
    ? '<div class="d-spell">单位法术：' + UNIT_SPELL_TEXT[def.actSpell] +
      '（初始法力 ' + def.spellMana0 + ' / 上限 ' + def.spellManaMax + (m ? '，当前 ' + m.spellMana : '') + '）</div>' : '';
  let cur = '';
  if (m) {
    const bits = [];
    bits.push('攻 ' + m.atk + '（基础 ' + m.baseAtk + '）');
    bits.push('甲 ' + effArmor(m) + '（基础 ' + m.arm + '）');
    bits.push('血 ' + Math.max(0, m.curHp) + '/' + m.maxHp + '（基础 ' + m.baseMaxHp + '）');
    if (m.row != null) bits.push(ROW_NAMES[m.row]);
    bits.push('剩余反击机会 ' + m.counterLeft);
    if (m.poison > 0) bits.push('中毒 Lv' + m.poison);
    if ((m.blind || 0) > 0) bits.push('失明 ' + m.blind + ' 回合');
    cur = '<div class="d-cur">当前状态：' + bits.join(' · ') + '</div>';
  }
  document.getElementById('detail-body').innerHTML =
    '<div class="d-name">' + def.name + '</div>' +
    '<div class="art art-big" style="background:' + artBg(def) + '">' + art.icon + '</div>' +
    '<div class="d-sub">' + def.race + ' · 费用 ' + def.cost + (def.rating != null ? ' · 评分 ' + def.rating : '') + ' · 拥有 ×' + ownedOf(def.name) + '</div>' +
    ratingBreakdownHtml(def) +
    '<div class="d-base">攻 ' + def.atk + ' / 甲 ' + def.arm + ' / 血 ' + def.hp + '</div>' +
    '<div class="d-traits">' + traits + '</div>' +
    spell + unitSpell + cur;
  document.getElementById('detail').classList.add('show');
}

function closeDetail() {
  document.getElementById('detail').classList.remove('show');
}

// ---------- 单击 / 双击冲突处理 ----------
// 单击动作延时 220ms 执行：双击到来时取消；点击另一张卡时立即 flush 前一个动作
let pendingClick = null; // { key, timer, run }
function flushPendingClick() {
  if (!pendingClick) return;
  const p = pendingClick;
  pendingClick = null;
  clearTimeout(p.timer);
  p.run();
}
function cancelPendingClick() {
  if (!pendingClick) return;
  clearTimeout(pendingClick.timer);
  pendingClick = null;
}
function scheduleClickAction(key, run) {
  if (pendingClick && pendingClick.key !== key) flushPendingClick();
  if (pendingClick) clearTimeout(pendingClick.timer);
  const timer = setTimeout(() => {
    if (pendingClick && pendingClick.timer === timer) { pendingClick = null; run(); }
  }, 220);
  pendingClick = { key: key, timer: timer, run: run };
}

const GUIDE_STORAGE_KEY = 'mtcg-guide-v1';
function readGuideState() {
  try {
    const saved = JSON.parse(storage.getItem(GUIDE_STORAGE_KEY) || '{}');
    return { builderDone: !!saved.builderDone, battleDone: !!saved.battleDone };
  } catch (e) { return { builderDone: false, battleDone: false }; }
}
function completeGuide(kind) {
  const guide = readGuideState();
  guide[kind] = true;
  try { storage.setItem(GUIDE_STORAGE_KEY, JSON.stringify(guide)); } catch (e) {}
  updateGuideVisibility();
}
function updateGuideVisibility() {
  const guide = readGuideState();
  const builderGuide = document.getElementById('first-run-guide');
  const battleGuide = document.getElementById('battle-guide');
  if (builderGuide) builderGuide.style.display = guide.builderDone ? 'none' : 'flex';
  if (battleGuide) battleGuide.style.display = !guide.battleDone && state && state.round <= 1 ? 'flex' : 'none';
}

function showBuilder() {
  netLeave(); // 联机：返回组牌即离开房间（host 会广播 closed）
  closeViewer();
  closeDetail();
  document.getElementById('pass-screen').classList.remove('show');
  passContinue = null;
  document.getElementById('overlay').classList.remove('show');
  document.getElementById('roguelike').style.display = 'none';
  document.getElementById('game').style.display = 'none';
  document.getElementById('deckbuilder').style.display = 'block';
  document.body.dataset.screen = 'builder';
  // 双人模式回到玩家1 组牌（两方上次选择都保留）
  builderStep = 1;
  curSel = builderSel;
  renderBuilder();
}

// 模式切换
function setBuilderMode(mode) {
  builderMode = mode;
  builderStep = 1;
  curSel = builderSel;
  ['ai', 'pvp', 'net'].forEach(key => {
    const btn = document.getElementById('mode-' + key);
    btn.classList.toggle('active', mode === key);
    btn.setAttribute('aria-pressed', mode === key ? 'true' : 'false');
  });
  const descriptions = {
    ai: '与战术 AI 练习组牌、阵型与指令。',
    pvp: '两位玩家依次组牌与部署，隐私屏保护手牌。',
    net: '通过房间码邀请好友，或作为观战者加入。',
  };
  document.getElementById('mode-description').textContent = descriptions[mode] || descriptions.ai;
  document.getElementById('net-panel').style.display = mode === 'net' ? 'block' : 'none';
  if (mode === 'net' && !netAvailable()) netStatus('联机组件不可用（PeerJS CDN 加载失败），本地模式不受影响');
  renderBuilder();
}

function showGame() {
  document.getElementById('deckbuilder').style.display = 'none';
  document.getElementById('game').style.display = 'flex'; // flex 布局（左侧战斗记录边栏）
  document.body.dataset.screen = 'battle';
}

// ---------- 交互 ----------
document.addEventListener('click', e => {
  ensureAudio(); // 首次用户交互时创建 / resume AudioContext
  const el = e.target.closest('[data-action]');
  if (!el) {
    // 法术选目标模式下点击空白处：取消选目标
    if (state && state.spellTargetMode) { state.spellTargetMode = null; render(); }
    return;
  }
  const action = el.dataset.action;

  // 战术预览：单击同一卡切换视图；点击空白关闭
  if (tacPreview) {
    const cardEl = e.target.closest('.minion');
    const tacUid = cardEl ? parseInt(cardEl.dataset.uid, 10) : NaN;
    if (tacUid === tacPreview.uid) {
      tacPreview.mode = tacPreview.mode === 'attack' ? 'defense' : 'attack';
      if (typeof cancelPendingClick === 'function') cancelPendingClick();
      renderTacPreview();
      render();
      return;
    }
    closeTacPreview();
  }

  // 组牌界面（单击延时执行，双击打开详情并取消单击动作）
  if (action === 'filter-chip') {
    const g = el.dataset.group, v = el.dataset.val;
    const key = g === 'costs' ? parseInt(v, 10) : v;
    if (builderFilter[g][key]) delete builderFilter[g][key];
    else builderFilter[g][key] = true;
    renderBuilder();
    return;
  }
  if (action === 'filter-reset') {
    Object.keys(builderFilter).forEach(k => { builderFilter[k] = {}; });
    builderKw = '';
    builderSort = 'race';
    renderBuilder();
    return;
  }
  // 对局规则配置
  if (action === 'rule-hp') { gameConfig.heroHp = parseInt(el.dataset.val, 10); saveConfig(); renderBuilder(); return; }
  if (action === 'rule-mana') { gameConfig.maxMana = parseInt(el.dataset.val, 10); saveConfig(); renderBuilder(); return; }
  if (action === 'rule-toggle-set') { gameConfig.allowSet = !gameConfig.allowSet; saveConfig(); renderBuilder(); return; }
  if (action === 'rule-toggle-defense') { gameConfig.allowDefense = !gameConfig.allowDefense; saveConfig(); renderBuilder(); return; }
  if (action === 'filter-toggle-all') {
    const g = el.dataset.group;
    const grp = FILTER_GROUPS.find(x => x.key === g);
    const vals = grp.vals();
    if (grp.include) {
      // 词条：有选中 → 清除；无选中 → 全选
      const anyOn = vals.some(x => builderFilter[g][x.v]);
      builderFilter[g] = {};
      if (!anyOn) vals.forEach(x => { builderFilter[g][x.v] = true; });
    } else {
      const anyOff = vals.some(x => builderFilter[g][x.v]);
      builderFilter[g] = {};
      if (!anyOff) vals.forEach(x => { builderFilter[g][x.v] = true; }); // 全不选
    }
    renderBuilder();
    return;
  }
  if (action === 'pack-reveal') { revealPack(parseInt(el.dataset.idx, 10)); return; }
  if (action === 'preset-deck') {
    applyPresetDeck(PRESET_DECKS[parseInt(el.dataset.idx, 10)]);
    return;
  }
  if (action === 'add-card') {
    const name = el.dataset.name;
    scheduleClickAction('add:' + name, () => {
      if (tryAddCard(name)) renderBuilder();
    });
    return;
  }
  if (action === 'remove-card') {
    const name = el.dataset.name;
    scheduleClickAction('rm:' + name, () => {
      if (curSel[name] > 0) curSel[name]--;
      renderBuilder();
    });
    return;
  }

  // 通用选牌浮层：点击结算 onPick，取消仅关闭
  if (action === 'card-pick') {
    const mode = state && state.cardPick;
    const i = parseInt(el.dataset.idx, 10);
    document.getElementById('card-pick').classList.remove('show');
    if (state) state.cardPick = null;
    if (mode && mode.entries[i]) mode.onPick(mode.entries[i]);
    render();
    return;
  }
  if (action === 'card-pick-cancel') {
    hideCardPick();
    render();
    return;
  }

  // 对战界面
  if (!state) return;

  // 查看牌库 / 墓地（任何阶段、含结算后都可看）；dataset.side 为位置（enemy=上方/player=下方），按当前视角映射
  if (action === 'view-deck' || action === 'view-grave') {
    const posSide = el.dataset.side === 'enemy' ? otherSide(viewSide()) : viewSide();
    openViewer(posSide, action === 'view-deck' ? 'deck' : 'grave');
    return;
  }

  if (action === 'battle-speed') {
    const speed = parseInt(el.dataset.speed, 10);
    if ([1, 2, 4].includes(speed) && typeof setBattleSpeed === 'function') setBattleSpeed(speed);
    render();
    return;
  }
  if (action === 'set-tactic') {
    if (state.gameOver || NET.role === 'spectator' || state.phase !== 'deploy' || typeof setTactic !== 'function') return;
    const side = activeSide();
    if (!localDeployAllowed(side)) return;
    const key = el.dataset.tactic;
    if (!UI_TACTICS[key]) return;
    const next = tacticKeyFor(side) === key ? null : key;
    if (setTactic(side, next) !== false) render();
    return;
  }

  if (state.gameOver) return;
  if (NET.role === 'spectator') return; // 观战只读

  const as = activeSide(); // 本机玩家操作所用 side（ai=player；离线 pvp=部署方；联机=本机侧）
  // 墓地选取浮层的两个动作
  if (action === 'grave-pick') {
    const mode = state.spellTargetMode;
    const payload = { graveSide: el.dataset.gside, graveIndex: parseInt(el.dataset.gidx, 10) };
    document.getElementById('grave-pick').classList.remove('show');
    state.spellTargetMode = null;
    if (!mode) { render(); return; }
    // 单位法术（召唤恶鬼）：执行施放而非出牌
    if (mode.unitSpell) {
      if (netAct({ kind: 'cast', uid: mode.minionUid, graveSide: payload.graveSide, graveIndex: payload.graveIndex })) { render(); return; }
      castUnitSpell(as, mode.minionUid, payload);
      return;
    }
    if (netAct({ kind: 'play', name: mode.def.name, graveSide: payload.graveSide, graveIndex: payload.graveIndex })) { render(); return; }
    const gi = state[as].hand.indexOf(mode.def);
    if (gi >= 0 && playCard(as, gi, null, null, false, payload)) render();
    else render();
    return;
  }
  if (action === 'grave-cancel') {
    hideGravePick();
    render();
    return;
  }
  if (action === 'grave-multi-toggle') {
    const mode = state.spellTargetMode;
    if (!mode || !mode.multi) return;
    const key = el.dataset.key, cost = parseInt(el.dataset.cost, 10);
    mode.sel = mode.sel || {};
    if (mode.sel[key]) delete mode.sel[key];
    else {
      let total = 0;
      Object.keys(mode.sel).forEach(k => { total += mode.sel[k]; });
      if (total + cost > mode.budget) { log('费用总和不能超过 ' + mode.budget); return; }
      mode.sel[key] = cost;
    }
    renderGravePickBody(mode);
    return;
  }
  if (action === 'grave-multi-confirm') {
    const mode = state.spellTargetMode;
    if (!mode || !mode.multi || !mode.sel || Object.keys(mode.sel).length === 0) return;
    const picks = Object.keys(mode.sel).map(k => {
      const parts = k.split(':');
      return { graveSide: parts[0], graveIndex: parseInt(parts[1], 10) };
    });
    document.getElementById('grave-pick').classList.remove('show');
    state.spellTargetMode = null;
    if (netAct({ kind: 'play', name: mode.def.name, picks: picks })) { render(); return; }
    const gi = state[as].hand.indexOf(mode.def);
    if (gi >= 0) playCard(as, gi, null, null, false, { picks: picks });
    render();
    return;
  }
  // 法术选目标模式：点击合法目标结算，点击其他随从不动作（保持选目标模式）
  if (state.spellTargetMode) {
    const mode = state.spellTargetMode;
    // 治疗：允许直接点击己方英雄治疗英雄
    if (mode.def && mode.def.spellEffect === 'heal' && e.target.closest('#player-hero')) {
      state.spellTargetMode = null;
      if (netAct({ kind: 'play', name: mode.def.name, healHero: true })) return;
      const hi = state[as].hand.indexOf(mode.def);
      if (hi >= 0) playCard(as, hi, null, null, false, { hero: true });
      render();
      return;
    }
  }
  if (state.spellTargetMode && (action === 'select-minion' || action === 'attack-minion')) {
    const mode = state.spellTargetMode;
    const u = parseInt(el.dataset.uid, 10);
    // 单位法术（祝福/冰箭）选目标结算
    if (mode.unitSpell) {
      const mySideT = state.player.board.find(m => m.uid === u) ? 'player' : 'enemy';
      const want = (mode.key === 'bless' || mode.key === 'repair') ? mySideT === as : mySideT !== as;
      const target = state[mySideT].board.find(m => m.uid === u && isTargetable(m));
      state.spellTargetMode = null;
      if (target && want) {
        if (netAct({ kind: 'cast', uid: mode.minionUid, key: mode.key, targetUid: u })) return;
        castUnitSpell(as, mode.minionUid, { key: mode.key, targetUid: u });
      }
      render();
      return;
    }
    const t = legalSpellTargets(as, mode.def).find(m => m.uid === u);
    state.spellTargetMode = null;
    if (t) {
      if (NET.role === 'guest') { clientSend({ t: 'act', kind: 'play', name: mode.def.name, targetUid: u }); }
      else {
        const i = state[as].hand.indexOf(mode.def);
        if (i >= 0) playCard(as, i, null, null, false, u);
      }
    }
    render();
    return;
  }
  if (action === 'cast-spell') {
    const u = parseInt(el.dataset.uid, 10);
    const m = state[as].board.find(x => x.uid === u);
    if (!m) return;
    const key = el.dataset.key || m.actSpell;
    // 祝福/冰箭：进入选目标模式（祝福点友方、冰箭点敌方）
    if (key === 'bless' || key === 'iceBolt' || key === 'repair') {
      const entry = unitSpellEntry(m, key);
      if (m.spellMana < entry.cost) { log('法力不足，无法施放'); return; }
      const poolSide = key === 'bless' ? state[as] : state[otherSide(as)];
      if (!poolSide.board.some(x => isTargetable(x))) { log('没有合法目标'); return; }
      state.spellTargetMode = { unitSpell: true, minionUid: u, key: key };
      render();
      return;
    }
    // 召唤恶鬼：需要选择己方墓地单位卡——打开墓地选取浮层（仅己方）
    if (key === 'summonDemon') {
      const sdEntry = unitSpellEntry(m, key);
      if (m.spellMana < sdEntry.cost) { log('法力不足，无法施放'); return; }
      if (state[as].board.length >= BOARD_CAP) { log('场上使魔已达上限（' + BOARD_CAP + '）'); return; }
      if (!state[as].graveyard.some(g => !g._isSpell)) { log('己方墓地没有单位卡，无法召唤恶鬼'); return; }
      showGravePick({
        def: { name: '召唤恶鬼' }, minionUid: u, unitSpell: true, onlySide: as,
        title: '【' + m.name + '】召唤恶鬼：选择己方墓地一张单位卡除外',
      });
      return;
    }
    if (netAct({ kind: 'cast', uid: u, key: key })) return; // guest 动作发给房主
    castUnitSpell(as, u, { key: key }); // 直接执行，不走单击延时
    return;
  }
  if (action === 'toggle-defense') {
    const u = parseInt(el.dataset.uid, 10);
    if (netAct({ kind: 'defense', uid: u })) return; // guest 动作发给房主
    toggleDefense(as, u);
    return;
  }
  if (action === 'toggle-land') {
    const u = parseInt(el.dataset.uid, 10);
    if (netAct({ kind: 'land', uid: u })) return;
    toggleLand(as, u);
    return;
  }
  // 旋转热区：设置式切换姿态（非 toggle）
  if (action === 'rot-attack' || action === 'rot-defense') {
    const u = parseInt(el.dataset.uid, 10);
    const val = action === 'rot-defense';
    if (netAct({ kind: 'defense', uid: u, value: val })) return;
    toggleDefense(as, u, val);
    return;
  }
  // 旋转热区（手牌）：上=攻击表示打出，右=守备表示打出
  if (action === 'rot-play' || action === 'rot-play-defense') {
    if (state.phase !== 'deploy') return;
    const idx = parseInt(el.dataset.idx, 10);
    const def = state[as].hand[idx];
    if (!def) return;
    if (effCost(as, def) > state[as].mana) { log('法力不足，无法打出【' + def.name + '】'); return; }
    const withDef = action === 'rot-play-defense';
    if (netAct({ kind: 'play', name: def.name, defense: withDef })) return;
    const m = playCard(as, idx);
    if (m && withDef) { m.defense = true; log('【' + m.name + '】以守备表示入场'); }
    if (m) render();
    return;
  }
  if (action === 'flip-unit') {
    const u = parseInt(el.dataset.uid, 10);
    if (netAct({ kind: 'flip', uid: u })) return;
    flipUnit(as, u);
    return;
  }
  if (action === 'set-hand') {
    if (state.phase !== 'deploy') return;
    const idx = parseInt(el.dataset.idx, 10);
    const def = state[as].hand[idx];
    if (!def) return;
    if (effCost(as, def) > state[as].mana) { log('法力不足，无法盖放【' + def.name + '】'); return; }
    if (netAct({ kind: 'set', name: def.name })) return;
    if (playCard(as, idx, null, null, true)) render(); // 盖放：默认落位（近战前排/远程后排），直接执行需手动重绘
    return;
  }
  if (action === 'play-hand') {
    if (state.phase !== 'deploy') return; // 进攻阶段禁止出牌
    const idx = parseInt(el.dataset.idx, 10);
    const def = state[as].hand[idx];
    if (!def) return;
    if (effCost(as, def) > state[as].mana) { log('法力不足，无法打出【' + def.name + '】'); return; }
    // 法术卡牌：无目标的走单击延时直接结算；需要目标的进入选目标模式（再点一次取消）
    if (def.type === 'spell') {
      if (def.spellEffect === 'animateDead') { // 聚灵奇术：多选墓地浮层（预算 = 剩余法力 ×2）
        const hasNecro = state.player.graveyard.concat(state.enemy.graveyard)
          .some(g => { const gd = !g._isSpell && findDef(g.name); return gd && gd.race === '墓园'; });
        if (!hasNecro) { log('【聚灵奇术】：双方墓地都没有墓园单位'); return; }
        const budget = Math.max(0, state[as].mana - effCost(as, def)) * 2;
        if (budget <= 0) { log('【聚灵奇术】：剩余法力不足，预算为 0'); return; }
        showGravePick({ idx: idx, def: def, multi: true, budget: budget });
        return;
      }
      if (def.spellEffect === 'darkSacrifice') { // 恶魔的祭品：选己方一张手牌/场上卡消灭，摸两张
        const p2 = state[as];
        const entries = [];
        p2.hand.forEach((c, i2) => { if (i2 !== idx) entries.push({ html: '手牌【' + c.name + '】费用 ' + c.cost, data: { sacHand: i2 } }); });
        p2.board.forEach(u => { if (!u.isSpellShell) entries.push({ html: '场上【' + u.name + '】攻' + u.atk + '/血' + Math.max(0, u.curHp), data: { sacUid: u.uid } }); });
        if (entries.length === 0) { log('【恶魔的祭品】：没有可献祭的卡牌'); return; }
        showCardPick({
          title: '【恶魔的祭品】：选择一张己方卡牌消灭（随后摸两张牌）',
          entries: entries, cancelable: true,
          onPick: en => {
            if (netAct(Object.assign({ kind: 'play', name: def.name }, en.data))) return;
            const sd = activeSide();
            const i3 = state[sd].hand.indexOf(def);
            if (i3 >= 0) playCard(sd, i3, null, null, false, en.data);
          },
        });
        return;
      }
      if (def.target === 'graveUnit') { // 墓地选目标（召唤骷髅兵）：打开墓地选取浮层
        if (legalSpellTargets(as, def).length === 0) { log('【' + def.name + '】双方墓地都没有单位'); return; }
        showGravePick({ idx: idx, def: def });
        return;
      }
      if (def.target !== 'none') {
        if (state.spellTargetMode && state.spellTargetMode.def === def) state.spellTargetMode = null; // 再点取消
        else {
          if (legalSpellTargets(as, def).length === 0) { log('【' + def.name + '】没有合法目标'); return; }
          state.spellTargetMode = { idx: idx, def: def };
        }
        render();
        return;
      }
      state.spellTargetMode = null;
      scheduleClickAction('hand:' + idx, () => {
        if (!state || state.phase !== 'deploy' || state.gameOver) return;
        if (netAct({ kind: 'play', name: def.name })) return;
        const sd = activeSide();
        const i = state[sd].hand.indexOf(def);
        if (i >= 0 && playCard(sd, i)) render();
      });
      return;
    }
    // 单击延时执行（给双击留窗口）；执行时按 def 引用重新定位下标，避免手牌变动错位
    scheduleClickAction('hand:' + idx, () => {
      if (!state || state.phase !== 'deploy' || state.gameOver) return;
      if (netAct({ kind: 'play', name: def.name })) return; // guest 出牌发给房主（按卡名定位）
      const sd = activeSide();
      const i = state[sd].hand.indexOf(def);
      if (i < 0) return;
      if (effCost(sd, def) > state[sd].mana) { log('法力不足，无法打出【' + def.name + '】'); return; }
      if (playCard(sd, i)) render();
    });
    return;
  }
  if (action === 'select-minion') {
    if (state.phase !== 'deploy') return; // 仅部署阶段可收回
    const u = parseInt(el.dataset.uid, 10);
    // 单击延时执行收回（双击取消收回并打开详情）
    scheduleClickAction('recall:' + u, () => {
      if (!state || state.phase !== 'deploy' || state.gameOver) return;
      if (netAct({ kind: 'recall', uid: u })) return; // guest 收回发给房主
      const sd = activeSide();
      const m = state[sd].board.find(x => x.uid === u);
      if (!m) return;
      if (m.recallable && m.playedRound === state.round) { recallMinion(u, sd); return; }
      if (m.playedRound === state.round && !m.recallable) log('【' + m.name + '】的入场效果已触发，无法收回');
      // 其他情况（上一轮就在场上 / 召唤物 / token）保持安静
    });
  }
});

// ---------- 双击查看卡牌详情 ----------
document.addEventListener('dblclick', e => {
  const el = e.target.closest('.hand-card, .minion, .db-card, .deck-item, [data-card-name]');
  if (!el) return;
  cancelPendingClick(); // 双击：取消未执行的单击动作
  let def = null, mn = null;
  if (el.classList.contains('hand-card')) {
    if (!state) return;
    def = state[viewSide()].hand[parseInt(el.dataset.idx, 10)]; // 下方手牌（当前视角方）
  } else if (el.classList.contains('minion')) {
    if (!state) return;
    const u = parseInt(el.dataset.uid, 10);
    mn = state.player.board.find(x => x.uid === u) || state.enemy.board.find(x => x.uid === u);
    if (mn) def = findDef(mn.name);
  } else if (el.dataset.cardName) { // 牌库/墓地查看浮层里的条目
    def = findDef(el.dataset.cardName);
    if (state && el.dataset.gSide) mn = state[el.dataset.gSide].graveyard[parseInt(el.dataset.gIdx, 10)] || null;
  } else if (el.dataset.name) { // 组牌牌池卡 / 牌组列表项
    def = findDef(el.dataset.name);
  }
  if (def) {
    if (window.__holo) { window.__holo.open(def.name, mn || null); return; } // 统一使用 3D 检视
    showCardDetail(def, mn); // 3D 不可用时回退 2D 详情
  }
});

// 键盘操作：Enter/Space 激活，Shift+Enter 查看卡牌，Esc 关闭浮层，Tab 限制在最上层对话框内。
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (window.__holo) window.__holo.close();
    closeDetail();
    closeViewer();
    const grave = document.getElementById('grave-pick');
    if (grave.classList.contains('show')) { hideGravePick(); if (state) render(); }
    return;
  }
  if (e.key === 'Tab') {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'))
      .filter(el => el.getClientRects().length > 0)
      .sort((a, b) => (parseInt(getComputedStyle(b).zIndex, 10) || 0) - (parseInt(getComputedStyle(a).zIndex, 10) || 0));
    const dialog = dialogs[0];
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      .filter(el => el.getClientRects().length > 0);
    if (!focusable.length) { e.preventDefault(); dialog.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    return;
  }
  const card = e.target.closest('.hand-card, .minion, .db-card, .deck-item, [data-card-name]');
  if (card && e.target === card && e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    return;
  }
  const actionable = e.target.closest('[role="button"][data-action], #net-room-code[role="button"]');
  if (actionable && e.target === actionable && actionable.tagName !== 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    actionable.click();
  }
});

// ---------- 拖拽（仅部署阶段：己方随从布阵 + 手牌拖拽落位出牌） ----------
let dragUid = null;     // 拖拽中的场上随从 uid
let dragHandIdx = null; // 拖拽中的手牌下标
document.addEventListener('dragstart', e => {
  if (!state || state.phase !== 'deploy' || state.gameOver || NET.role === 'spectator') { e.preventDefault(); return; }
  const as = activeSide();
  if (state.mode === 'pvp' && state.deploySide !== as) { e.preventDefault(); return; } // 非本机部署回合不给拖
  // 手牌拖拽出牌：法力不足不给拖
  const hc = e.target.closest('.hand-card');
  if (hc) {
    const idx = parseInt(hc.dataset.idx, 10);
    const def = state[as].hand[idx];
    if (!def || effCost(as, def) > state[as].mana) { e.preventDefault(); return; }
    dragHandIdx = idx;
    e.dataTransfer.setData('text/plain', 'hand:' + idx);
    e.dataTransfer.effectAllowed = 'move';
    document.getElementById('player-board').classList.add('dragging');
    return;
  }
  // 场上随从拖拽布阵（下方半场 = 当前部署方）；翻面卡用 data-drag 标记同样可拖
  const el = e.target.closest('.minion');
  if (!el || (el.dataset.action !== 'select-minion' && el.dataset.drag !== '1')) { e.preventDefault(); return; }
  const u = parseInt(el.dataset.uid, 10);
  if (!state[as].board.find(x => x.uid === u)) { e.preventDefault(); return; }
  dragUid = u;
  e.dataTransfer.setData('text/plain', String(u));
  e.dataTransfer.effectAllowed = 'move';
  document.getElementById('player-board').classList.add('dragging');
});
document.addEventListener('dragend', () => {
  dragUid = null;
  dragHandIdx = null;
  document.getElementById('player-board').classList.remove('dragging');
});

// ---------- 拖动旋转切换姿态 ----------
// 悬停卡牌出现旋转把手，按住拖动实时旋转（90° 步进吸附预览），松手按角度切换姿态：
// 手牌：0°=攻击入场 90°/270°=守备入场 180°=盖放；场上正面卡：0°=攻击 90°/270°=守备（180° 不可盖回，忽略）；
// 盖牌：转过 90° 即翻开。
let rotGesture = null;

function rotHintText(kind, snapped, faceDown, isFlyer, grounded) {
  if (faceDown) return snapped === 0 ? '回正（不翻开）' : '翻开！';
  if (kind === 'hand') {
    if (snapped === 0) return '攻击表示入场';
    if (snapped === 180) return gameConfig.allowSet ? '盖放（翻面守备）' : '（盖放已禁用）';
    return gameConfig.allowDefense ? '守备表示入场' : '（守备已禁用）';
  }
  if (snapped === 0) return '攻击表示';
  if (snapped === 180) return isFlyer ? (grounded ? '起飞（恢复飞行）' : '落地（失去飞行）') : '（已在场不能盖回）';
  return gameConfig.allowDefense ? '守备表示' : '（守备已禁用）';
}

function applyRotation(g, snapped) {
  const as = activeSide();
  if (g.kind === 'hand') {
    if (state.phase !== 'deploy') return;
    const def = state[as].hand[g.idx];
    if (!def) return;
    if (effCost(as, def) > state[as].mana) { log('法力不足，无法打出【' + def.name + '】'); return; }
    if (snapped === 180) { // 盖放
      if (netAct({ kind: 'set', name: def.name })) return;
      if (playCard(as, g.idx, null, null, true)) render();
      return;
    }
    const withDef = snapped !== 0 && gameConfig.allowDefense; // 守备禁用时 90° 按攻击入场
    if (netAct({ kind: 'play', name: def.name, defense: withDef })) return;
    const m = playCard(as, g.idx);
    if (m && withDef) { m.defense = true; log('【' + m.name + '】以守备表示入场'); }
    if (m) render();
    return;
  }
  // 场上随从
  const m = state[as].board.find(x => x.uid === g.uid);
  if (!m) return;
  if (m.faceDown) {
    if (snapped === 0) return; // 没转够 90°，不翻开
    if (netAct({ kind: 'flip', uid: g.uid })) return;
    flipUnit(as, g.uid);
    return;
  }
  const wantDef = snapped === 90 || snapped === 270;
  // 飞行单位转 180°：切换 落地/起飞
  if (snapped === 180 && m.traits.includes('飞行')) {
    if (netAct({ kind: 'land', uid: g.uid, value: !m.grounded })) return;
    toggleLand(as, g.uid, !m.grounded);
    return;
  }
  if (NET.role === 'guest') {
    if (wantDef !== m.defense) clientSend({ t: 'act', kind: 'defense', uid: g.uid, value: wantDef });
    return;
  }
  toggleDefense(as, g.uid, wantDef);
}

document.addEventListener('mousedown', e => {
  const h = e.target.closest('.rot-handle');
  if (!h || !state || state.phase !== 'deploy' || state.gameOver || NET.role === 'spectator') return;
  const card = h.closest('.minion') || h.closest('.hand-card');
  if (!card) return;
  e.preventDefault(); // 阻止触发 HTML5 拖拽布阵
  e.stopPropagation();
  const r = card.getBoundingClientRect();
  rotGesture = {
    card: card,
    uid: h.dataset.uid != null ? parseInt(h.dataset.uid, 10) : null,
    idx: h.dataset.idx != null ? parseInt(h.dataset.idx, 10) : null,
    kind: card.classList.contains('hand-card') ? 'hand' : 'minion',
    faceDown: card.classList.contains('face-down'),
    minion: card.classList.contains('minion') && state ? state[activeSide()].board.find(x => x.uid === (h.dataset.uid != null ? parseInt(h.dataset.uid, 10) : null)) : null,
    cx: r.left + r.width / 2, cy: r.top + r.height / 2,
    a0: Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)),
    angle: 0, snapped: 0, hint: null,
  };
  card.style.zIndex = 20;
  const hint = document.createElement('div');
  hint.className = 'rot-hint';
  hint.textContent = rotHintText(rotGesture.kind, 0, rotGesture.faceDown, !!(rotGesture.minion && rotGesture.minion.traits.includes('飞行')), !!(rotGesture.minion && rotGesture.minion.grounded));
  card.appendChild(hint);
  rotGesture.hint = hint;
});

// 长按卡牌打开战术预览
document.addEventListener('mousedown', e => {
  if (e.target.closest('.rot-handle') || e.target.closest('button')) return;
  const card = e.target.closest('.minion');
  if (!card || !state || state.gameOver) return;
  const uid = parseInt(card.dataset.uid, 10);
  if (isNaN(uid)) return;
  const sx = e.clientX, sy = e.clientY;
  clearTimeout(tacPressTimer);
  tacPressTimer = setTimeout(() => { openTacPreview(uid); }, 420);
  document.addEventListener('mousemove', function cancel(ev) {
    if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 10) clearTimeout(tacPressTimer);
  }, { once: true });
  document.addEventListener('mouseup', function up() { clearTimeout(tacPressTimer); }, { once: true });
  document.addEventListener('dragstart', function up2() { clearTimeout(tacPressTimer); }, { once: true });
});

document.addEventListener('mousemove', e => {
  if (!rotGesture) return;
  const g = rotGesture;
  const a = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
  let deg = (a - g.a0) * 180 / Math.PI;
  deg = ((deg % 360) + 360) % 360;
  g.angle = deg;
  const snapped = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  g.snapped = snapped;
  g.card.style.transform = 'rotate(' + snapped + 'deg) scale(.94)'; // 90° 步进吸附预览
  g.hint.textContent = rotHintText(g.kind, snapped, g.faceDown, !!(g.minion && g.minion.traits.includes('飞行')), !!(g.minion && g.minion.grounded));
});

document.addEventListener('mouseup', () => {
  if (!rotGesture) return;
  const g = rotGesture;
  rotGesture = null;
  g.card.style.transform = '';
  g.card.style.zIndex = '';
  if (g.hint && g.hint.parentNode) g.hint.parentNode.removeChild(g.hint);
  applyRotation(g, g.snapped);
});
document.addEventListener('dragover', e => {
  if (dragUid == null && dragHandIdx == null) return;
  const row = e.target.closest('.board-row.own-row');
  if (row) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
});
document.addEventListener('drop', e => {
  if (dragUid == null && dragHandIdx == null) return;
  const row = e.target.closest('.board-row.own-row');
  if (!row) return;
  e.preventDefault();
  const r = parseInt(row.dataset.row, 10);
  // 落点按目标卡的中心结算：拖过目标卡中点（右半边）插到它后面，否则插到它前面——左右拖动判定一致
  const targetEl = e.target.closest('.minion');
  let beforeUid = null;
  if (targetEl) {
    const rect = targetEl.getBoundingClientRect();
    if (e.clientX <= rect.left + rect.width / 2) {
      beforeUid = parseInt(targetEl.dataset.uid, 10);
    } else {
      const next = targetEl.nextElementSibling;
      const nu = next ? parseInt(next.dataset.uid, 10) : NaN;
      beforeUid = isNaN(nu) ? null : nu; // 目标已是排尾（或下一个不是随从）→ 追加到排尾
    }
  }
  const as = activeSide();
  if (dragHandIdx != null) {
    // 手牌拖拽落位出牌：拖到排内空白放排尾，拖到某随从卡上插入其前
    const def = state[as].hand[dragHandIdx];
    if (!def) { /* 手牌已变化，忽略 */ }
    else if (NET.role === 'guest') clientSend({ t: 'act', kind: 'play', name: def.name, row: r, beforeUid: beforeUid }); // guest 拖牌落位发给房主
    else if (effCost(as, def) > state[as].mana) log('法力不足，无法打出【' + def.name + '】');
    else playCard(as, dragHandIdx, r, beforeUid);
  } else if (beforeUid !== dragUid) {
    if (NET.role === 'guest') clientSend({ t: 'act', kind: 'move', uid: dragUid, row: r, beforeUid: beforeUid }); // guest 布阵发给房主
    else moveMinion(dragUid, r, beforeUid, as);
  }
  dragUid = null;
  dragHandIdx = null;
  document.getElementById('player-board').classList.remove('dragging');
  render();
});

// 组牌关键字搜索：输入即过滤（重渲染后恢复焦点与光标）
document.addEventListener('input', e => {
  if (!e.target || e.target.id !== 'pool-kw') return;
  builderKw = e.target.value.trim();
  const pos = e.target.selectionStart;
  renderBuilder();
  const kw = document.getElementById('pool-kw');
  if (kw) { kw.focus(); kw.setSelectionRange(pos, pos); }
});
document.addEventListener('change', e => {
  if (!e.target || e.target.id !== 'pool-sort') return;
  builderSort = BUILDER_SORTS.some(o => o.value === e.target.value) ? e.target.value : 'race';
  renderBuilder();
  const sort = document.getElementById('pool-sort');
  if (sort) sort.focus();
});
document.getElementById('guide-close').addEventListener('click', () => completeGuide('builderDone'));
document.getElementById('battle-guide-close').addEventListener('click', () => completeGuide('battleDone'));
document.getElementById('end-turn').addEventListener('click', onActionButton);
// 日志展开/收起
document.getElementById('log-expand').addEventListener('click', () => {
  const el = document.getElementById('log');
  const expanded = el.classList.toggle('expanded');
  document.getElementById('log-expand').setAttribute('aria-expanded', expanded ? 'true' : 'false');
  el.scrollTop = el.scrollHeight;
});
document.getElementById('pass-continue').addEventListener('click', confirmPass);
document.getElementById('mode-ai').addEventListener('click', () => setBuilderMode('ai'));
document.getElementById('mode-pvp').addEventListener('click', () => setBuilderMode('pvp'));
document.getElementById('viewer-close').addEventListener('click', closeViewer);
document.getElementById('open-album').addEventListener('click', () => { if (window.__holo) window.__holo.openAlbum(); });

// 开发者模式：localStorage 持久化开关；开启后显示刷钱按钮
let devMode = storage.getItem('mtcg-dev') === '1';
function updateDevUi() {
  document.getElementById('dev-gold').style.display = devMode ? '' : 'none';
  document.getElementById('dev-toggle').classList.toggle('active', devMode);
  document.getElementById('dev-toggle').setAttribute('aria-pressed', devMode ? 'true' : 'false');
}
document.getElementById('dev-toggle').addEventListener('click', () => {
  devMode = !devMode;
  try { storage.setItem('mtcg-dev', devMode ? '1' : '0'); } catch (e) {}
  updateDevUi();
});
document.getElementById('dev-gold').addEventListener('click', () => {
  gold += 1000;
  saveEconomy();
  updateGoldUi();
  log('开发者模式：金币 +1000（当前 ' + gold + '）');
});
updateDevUi();

document.getElementById('viewer').addEventListener('click', e => {
  if (e.target === document.getElementById('viewer')) closeViewer(); // 点击遮罩关闭
});
document.getElementById('detail-holo').addEventListener('click', () => {
  closeDetail();
  if (window.__holo) window.__holo.open(window._detailDefName || null);
});
document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('open-holo').addEventListener('click', () => {
  if (window.__holo) window.__holo.open(null);
});
document.getElementById('detail').addEventListener('click', e => {
  if (e.target === document.getElementById('detail')) closeDetail(); // 点击遮罩关闭
});
document.getElementById('sfx-toggle').addEventListener('click', () => {
  muted = !muted;
  try { localStorage.setItem('sfx-muted', muted ? '1' : '0'); } catch (e) {}
  updateMuteBtn();
});
document.getElementById('back-builder').addEventListener('click', showBuilder);
document.getElementById('back-builder2').addEventListener('click', showBuilder);
document.getElementById('clear-deck').addEventListener('click', () => {
  Object.keys(curSel).forEach(k => { curSel[k] = 0; });
  renderBuilder();
});
document.getElementById('random-deck').addEventListener('click', () => {
  buildRandomDeck();
  renderBuilder();
});
document.getElementById('start-battle').addEventListener('click', () => {
  flushPendingClick(); // 先结算未执行的单击加牌
  sanitizeSel(builderSel); // 收藏变化后过滤不合法选择
  if (builderMode === 'pvp') sanitizeSel(builderSel2);
  if (!canStartBattle()) { renderBuilder(); return; }
  // 联机：guest 提交牌组给房主；房主在 guest 牌组就绪后开局
  if (builderMode === 'net') {
    if (NET.role === 'guest') {
      clientSend({ t: 'deck', deck: deckFrom(builderSel).map(d => d.name) });
      netStatus('牌组已提交，等待房主开始…');
      return;
    }
    if (NET.role === 'host') {
      if (!netHostStartGame()) netStatus('等待玩家 2 提交牌组…');
      return;
    }
    netStatus('请先开房间或加入房间');
    return;
  }
  if (builderMode === 'pvp' && builderStep === 1) {
    // 玩家1 组牌完成 → 交机给玩家2（复用同一组牌界面，玩家2 的选择独立保存）
    showPassScreen('玩家 1 已完成组牌 · 请把设备交给玩家 2', () => {
      builderStep = 2;
      curSel = builderSel2;
      renderBuilder();
    });
    return;
  }
  if (builderMode === 'pvp' && deckFrom(builderSel).length < DECK_MIN) {
    builderStep = 1; // 玩家1 牌组在过滤后不足，退回重组
    curSel = builderSel;
    renderBuilder();
    return;
  }
  showGame();
  if (builderMode === 'pvp') initGame(deckFrom(builderSel), 'pvp', deckFrom(builderSel2));
  else initGame(selectedDeck(), 'ai');
});
document.getElementById('open-pack').addEventListener('click', () => { if (!buyPack3D()) buyPack(); });
document.getElementById('buy-fpack').addEventListener('click', () => buyFactionPack(document.getElementById('shop-race').value));
document.getElementById('buy-fbox').addEventListener('click', () => buyFactionBox(document.getElementById('shop-race').value));
document.getElementById('pack-reveal-all').addEventListener('click', revealAll);
document.getElementById('pack-commit').addEventListener('click', commitPack);
document.getElementById('pack-done').addEventListener('click', closePack);

// ---------- 联机入口（PeerJS 网络层；协议处理均在上方可注入函数里） ----------
document.getElementById('mode-net').addEventListener('click', () => setBuilderMode('net'));

document.getElementById('net-host').addEventListener('click', () => {
  if (!netAvailable()) { netStatus('联机组件不可用（PeerJS CDN 加载失败）'); return; }
  const pwd = document.getElementById('net-pwd').value || '';
  const name = document.getElementById('net-name').value || '玩家1';
  netHostInit(pwd, name);
  netStatus('正在创建房间…');
  NET.peer = new Peer('mtcg-' + NET.roomCode);
  NET.peer.on('open', () => {
    document.getElementById('net-room-code').textContent = NET.roomCode;
    netStatus('房间已创建，等待玩家加入…');
  });
  NET.peer.on('connection', conn => {
    conn.on('data', msg => hostHandleData(conn, msg));
    conn.on('close', () => hostConnClosed(conn));
  });
  NET.peer.on('error', err => netStatus('连接错误：' + err.type + '（公共 P2P 网络不保证可达，可重试）'));
});

function netJoinCommon(spectate) {
  if (!netAvailable()) { netStatus('联机组件不可用（PeerJS CDN 加载失败）'); return; }
  const code = (document.getElementById('net-code-input').value || '').trim().toUpperCase();
  if (!code) { netStatus('请输入房间码'); return; }
  NET.pwd = document.getElementById('net-pwd').value || '';
  const name = document.getElementById('net-name').value || (spectate ? '观战者' : '玩家2');
  netStatus('正在连接房间 ' + code + '…');
  NET.peer = new Peer();
  NET.peer.on('error', err => netStatus('连接失败：' + err.type + '（房间不存在或网络不可达）'));
  NET.peer.on('open', () => {
    const conn = NET.peer.connect('mtcg-' + code);
    NET.conn = conn;
    conn.on('open', () => conn.send({ t: 'join', pwd: NET.pwd, name: name, spectate: spectate }));
    conn.on('data', clientHandleData);
    conn.on('close', clientConnClosed);
  });
}
document.getElementById('net-join').addEventListener('click', () => netJoinCommon(false));
document.getElementById('net-watch').addEventListener('click', () => netJoinCommon(true));
document.getElementById('net-room-code').addEventListener('click', () => {
  // 复制房间码（剪贴板不可用时静默）
  try {
    if (NET.roomCode && navigator.clipboard) navigator.clipboard.writeText(NET.roomCode);
    netStatus('房间码 ' + NET.roomCode + ' 已复制');
  } catch (e) {}
});
