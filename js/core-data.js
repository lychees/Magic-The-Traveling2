'use strict';
// core-data.js — 从 index.html 按域拆分（plain script，共享全局词法作用域）
// ---------- 卡牌数据（JSON 驱动：数据源 cards.json，经 tools/sync-cards.js 注入内嵌块） ----------
function loadCardData() {
  const el = document.getElementById('cards-json');
  if (!el) throw new Error('未找到内嵌卡牌数据（#cards-json 缺失，请运行 node tools/sync-cards.js）');
  return JSON.parse(el.textContent);
}
const CARD_DATA = loadCardData();
const CARD_DEFS = CARD_DATA.cards;
const GREEN_DRAGON = CARD_DATA.tokens.find(t => t.name === '绿龙');
if (!GREEN_DRAGON) throw new Error('cards.json 缺少绿龙 token');
const RACES = CARD_DATA.races;
const SCHOOL_INFO = CARD_DATA.schools;
// 阵营代表色（与卡面底色一致：灰白/绿/红褐/黑）
const RACE_DOT = ['#8b9099', '#5a8a52', '#5a9aba', '#8a5a42', '#464650', '#6a4a8a', '#a89048', '#4a6a4a', '#7ab8d8', '#9a9288', '#2a6a8a', '#7a9ab8', '#8a744a'];
const CURVE_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7+'];

const SPELL_TEXT = {
  draw: '亡语：摸一张牌',
  prayer: '战吼·祈祷：其他友方使魔 +1攻/+2血',
  wisp: '战吼：本轮法力 +1',
  elfHeal: '战吼：本轮法力 +1，英雄恢复 2 点生命',
  dragoness: '下一轮准备阶段开始时变形为【绿龙】(8/0/16)并恢复 4 点生命（期间可被击杀）',
  charm: '战吼：随机获得一个敌方随从的控制权',
  skeletonSearch: '亡语：从牌库检索一张同名卡置入手牌；没有则检索其家族卡（骷髅↔骷髅勇士）',
  impBurst: '亡语：被近战单位杀死时，对伤害来源造成 2 点火系魔法伤害',
  foeDraw: '亡语：对手摸一张牌',
  leoric: '亡语：若有 3 点法术，消耗全部法术，下个准备阶段从墓地重新被召唤（法力每轮准备阶段 +1，上限 3）',
  potOfGreed: '战吼：摸两张牌。亡语：被击败时，加入对方的卡组顶端',
  songPot: '战吼：摸两张牌。亡语：击杀这张卡牌的玩家摸两张牌，并获得 5 金币',
  humblePot: '战吼：抽三张牌，保留一张，其余两张洗入卡组。亡语：洗入对手的牌组',
  genieCry: '战吼：随机为一个友方单位施放一个随机增益魔法（护体石肤/治疗/大气神盾/烈火神盾/狂暴/镜像术）',
  curse: '亡语·诅咒：所有敌方随从攻击 -1',
  necro: '战吼·招魂术：召唤一个【骷髅】',
  reaper: '战吼：消灭攻击力最高的敌方随从',
  boneDragon: '打出时除外己方墓地，每张除外牌使费用 -1',
  resurrect: '战吼·复活：将墓地中最后死亡的一张随从满状态复活到其原排',
  heal: '战吼：己方英雄恢复 3 点生命',
};
const TRAIT_TEXT = {
  '远程': '可攻击对方任意一排；优先攻击飞行单位且对其伤害加倍；攻击不触发普通反击（守备表示的反击除外）',
  '不受反击': '攻击不触发普通反击（守备表示的同时结算反击除外）',
  '火系魔法免疫': '不受火系法术影响（火球术、地狱烈焰、末日审判、魔女火球等）',
  '复仇': '每次反击前攻击 +X（X=等级，永久累积）',
  '机械': '机械单位（可被工程师修理）',
  '鼓舞': '战斗阶段开始前，我方所有单位士气 +X（X=等级）',
  '威吓': '战斗阶段开始前，敌方所有单位士气 -X（X=等级）',
  '威光': '与携带者交战的单位，战斗前后士气各 -1',
  '飞行': '只能被远程或飞行单位攻击；被远程单位攻击时受到的伤害加倍',
  '骑兵': '速度翻倍（行动顺序按三围总和×2）；攻击时若速度大于对方两倍，不会触发反击',
  '掠夺': '攻击敌方英雄时获得 5 金币',
  '高级水系魔法': '你施放的水系法术卡费用 -1（最低 0）',
  '高级学术': '你施放的法术卡费用 -1（最低 0）',
  '连击': '攻击时连续攻击 2 次（第二次不触发反击）',
  '反击': '每战斗阶段可反击 X 次（X=等级，默认 1 次）',
  '拒马': '可以对骑兵进行反击（无视骑兵的速度免反击）',
  '恐狼光环': '同排左右相邻的友方随从 +1 攻击（多只可叠加）',
  '和平': '不会发起可能令自己死亡的攻击（若反击致死则跳过该攻击）',
  '死亡凝视': '攻击时 25% 概率直接消灭目标随从（无视生命与护甲）',
  '护甲穿透': '攻击无视目标 X 点护甲（X=等级）',
  '法力燃烧': '攻击英雄时对手下一轮法力 -X（X=等级）',
  '法力燃烧2': '攻击英雄时对手下一轮法力 -2',
  '驱魔': '被该单位击杀的使魔不触发亡语',
  '再生': '每轮部署阶段开始时恢复 X 点生命（X=等级）',
  '再生1': '每轮部署阶段开始时恢复 1 点生命',
  '再生2': '每轮部署阶段开始时恢复 2 点生命',
  '毒Lv': '攻击造成伤害使目标中毒，目标在每轮部署阶段开始时受 X 点伤害（X=等级，重复中毒取最高）',
  '毒Lv1': '攻击造成伤害使目标中毒，目标在每轮部署阶段开始时受 1 点伤害',
  '毒Lv3': '攻击造成伤害使目标中毒，目标在每轮部署阶段开始时受 3 点伤害',
  '三姐妹': '场上每个其它名称包含「鹰身女妖」的单位 +2攻/+2血（可叠加）',
  '范围攻击': '攻击随从时，对被攻击随从左右两边相邻的随从造成等量溅射伤害（各自结算护甲，溅射受伤也会触发反击）',
  '石化': '生命未满时护甲视为 4',
  '石像形态': '守备表示时护甲 +2、攻击 -2',
  '破法': '攻击拥有法术（可施放单位法术）的单位时，造成伤害翻倍',
  '无目': '免疫双目失明',
  '心智免疫': '免疫心智魔法（双目失明/混乱/失忆/悲痛欲绝/魅魔夺取）',
  '尸火': '被近战攻击时，随机对伤害来源造成 0-2 点闪电/火焰/冰冻伤害',
  '觉醒': '觉醒X：需被攻击 X 次后才能攻击/反击/切换守备表示',
  '石化凝视': '此单位反击时，1/2 概率使被反击者石化 2 回合（无法行动/反击，护甲 +3）',
  '刺客': '优先攻击相对更靠后的单位，无视阻挡',
  '狗头人领袖': '所有狗头人 +1 攻击（含自身，多个可叠加）',
  '英灵感召': '当全场所有其它单位（盖牌与墓园/元素除外）都处于正士气时，自身 +1 攻击',
  '吸血': '造成的伤害等量恢复自身生命',
  '法术护盾': '受到的法术伤害 -X（X=等级）',
  '法术护盾2': '受到的法术伤害 -2',
};
// 带等级的特性说明：精确匹配不到时去掉结尾数字回退到基础条目（如 法术护盾1 → 法术护盾）
function traitText(t) {
  return TRAIT_TEXT[t] || TRAIT_TEXT[t.replace(/\d+$/, '')] || '';
}

const HAND_LIMIT = 10;
const MAX_MANA = 10;
// ---------- 对局规则配置（玩家可在组牌界面调整，localStorage 持久化） ----------
const DEFAULT_CONFIG = { heroHp: 20, maxMana: 10, allowSet: true, allowDefense: true };
let gameConfig = (() => {
  try {
    const raw = storage.getItem('mtcg-config');
    if (raw) return Object.assign({}, DEFAULT_CONFIG, JSON.parse(raw));
  } catch (e) {}
  return Object.assign({}, DEFAULT_CONFIG);
})();
function saveConfig() {
  try { storage.setItem('mtcg-config', JSON.stringify(gameConfig)); } catch (e) {}
}
function manaCap() { return gameConfig.maxMana; }
// 场上随从安全上限：正常对局远不会触及，仅防止「无上限 + 回合开始分裂 + 再生」
// 指数增殖（每轮翻倍）把页面卡死
const BOARD_CAP = 50;
const DECK_MIN = 20;  // 牌组最少 20 张才能开始战斗
const DECK_MAX = 60;  // 牌组最多 60 张
const MAX_COPIES = 4; // 每种卡最多 4 张
const PACK_PRICE = 100; // 卡包价格（金币）
const PACK_SIZE = 5;    // 每包张数
const FACTION_PACK_PRICE = 150; // 阵营卡包价格（同阵营 5 张）
const FACTION_BOX_PRICE = 600;  // 阵营卡盒价格（同阵营 5 包共 25 张，8 折）
const FACTION_BOX_PACKS = 5;
const SHOP_PRICES = { remove: 50, buyCard: 100, heal: 40 }; // 闯关商店
const RUN_REWARDS = { battle: 30, elite: 60, boss: 120, finalBoss: 300 }; // 闯关节点金币奖励
const TACTIC_INFO = {
  assault: { name: '猛攻', desc: '本轮进攻阶段，己方所有单位攻击 +1' },
  guard: { name: '坚守', desc: '本轮进攻阶段，己方所有单位有效护甲 +1' },
  rally: { name: '集结', desc: '本轮进攻阶段开始时，己方所有可受影响单位士气 +2' },
};
const RUN_RELICS = {
  warDrum: { name: '战鼓', desc: '远征战斗中，己方所有单位攻击 +1。' },
  stoneAegis: { name: '磐石徽记', desc: '远征战斗中，己方所有单位有效护甲 +1。' },
  longBow: { name: '猎手长弓', desc: '远征战斗中，己方远程单位攻击 +2。' },
  spikedShield: { name: '荆棘盾牌', desc: '远征战斗中，己方单位的反击伤害 +2。' },
  rallyBanner: { name: '昂扬战旗', desc: '每轮进攻阶段开始时，己方所有可受影响单位士气 +1。' },
  bloodChalice: { name: '鲜血圣杯', desc: '己方单位用攻击或反击击杀敌方单位时，己方英雄恢复 2 点生命。' },
  arcaneTome: { name: '奥术典籍', desc: '每场远征节点战开局额外摸 2 张牌。' },
  phoenixFeather: { name: '凤凰之羽', desc: '每场远征节点战中，第一个阵亡的己方单位以 1 点生命留在场上。' },
};

// ---------- 收藏与金币（localStorage 持久化；无 localStorage 环境用内存兜底，游戏不炸） ----------
const storage = (function () {
  try {
    localStorage.setItem('__mtcg-test', '1');
    localStorage.removeItem('__mtcg-test');
    return localStorage;
  } catch (e) {
    const mem = {};
    return {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; },
    };
  }
})();

let collection = {}; // {卡名: 拥有数量}
let gold = 0;
let claimedAlbums = {}; // {阵营: true} 集卡册传说奖励已领取标记

function saveEconomy() {
  try { storage.setItem('mtcg-collection', JSON.stringify(collection)); } catch (e) {}
  try { storage.setItem('mtcg-gold', String(gold)); } catch (e) {}
}
function saveAlbums() {
  try { storage.setItem('mtcg-albums', JSON.stringify(claimedAlbums)); } catch (e) {}
}

function loadEconomy() {
  let rawGold = null;
  try {
    collection = JSON.parse(storage.getItem('mtcg-collection') || '{}') || {};
    claimedAlbums = JSON.parse(storage.getItem('mtcg-albums') || '{}') || {};
    rawGold = storage.getItem('mtcg-gold');
  } catch (e) { collection = {}; }
  gold = parseInt(rawGold, 10);
  if (rawGold == null || isNaN(gold)) {
    // 首次运行：赠送全卡收藏（每种 4 张）+ 200 金币
    collection = {};
    CARD_DEFS.forEach(d => { collection[d.name] = 4; });
    gold = 200;
    try { storage.setItem('mtcg-econ-v2', '1'); } catch (e) {}
    saveEconomy();
  } else {
    // 旧版存档（白板初始收藏）迁移：补齐为全卡收藏
    let migrated = false;
    try { migrated = storage.getItem('mtcg-econ-v2') === '1'; } catch (e) {}
    if (!migrated) {
      CARD_DEFS.forEach(d => { if ((collection[d.name] || 0) < 4) collection[d.name] = 4; });
      try { storage.setItem('mtcg-econ-v2', '1'); } catch (e) {}
      saveEconomy();
    }
  }
  // 新卡补发：CARD_DEFS 中收藏缺失（undefined）的卡补 4 张，已有数量不动
  let added = false;
  CARD_DEFS.forEach(d => {
    if (collection[d.name] === undefined) { collection[d.name] = 4; added = true; }
  });
  if (added) saveEconomy();
}

function ownedOf(name) { return collection[name] || 0; }
function ownedTotal() { return CARD_DEFS.reduce((s, d) => s + ownedOf(d.name), 0); }
function ownedDefs() { return CARD_DEFS.filter(d => ownedOf(d.name) > 0); }
// 某种卡可携带数量 = min(MAX_COPIES, 拥有数)
function maxCopiesOf(def) { return def.legend ? Math.min(1, ownedOf(def.name)) : Math.min(MAX_COPIES, ownedOf(def.name)); } // 传说随从限 1 张
// 稀有度：按战斗力 <11 普通(灰) / 11–14 精良(蓝) / 15–19 稀有(紫) / ≥20 传说(金)
function rarityOf(def) {
  if (def.legend) return 3; // 传说随从恒为金卡
  const r = def.rating == null ? 0 : def.rating;
  return r < 11 ? 0 : r <= 14 ? 1 : r <= 19 ? 2 : 3;
}
