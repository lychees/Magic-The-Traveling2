# AGENTS.md — Magic The Traveling（使魔卡牌对战）

零构建纯静态网页卡牌游戏（H3 题材，13 阵营 398 卡：336 单位 + 62 法术），plain script + 独立 holo ES module，GitHub Pages 部署。
在线地址：<https://lychees.github.io/Magic-The-Traveling/>

## 快速命令

```bash
# 改卡后必跑：校验 cards.json 并注入 index.html 内嵌 #cards-json 块
node tools/sync-cards.js            # 仅校验+注入
node tools/sync-cards.js --recompute # 仅在明确需要时按公式重算全部 rating

# 本地预览（holo 3D 模块走 importmap，必须 http；主游戏 file:// 可玩）
python3 -m http.server 8474 --bind 127.0.0.1   # 固定 8474，8931 被其他项目占用

# plain script 语法
for f in js/*.js tools/*.js; do node --check "$f" || exit 1; done

# 阵营默认卡组仿真（不是真人 meta 结论）
node tools/simulate.js 20

# 部署：.deploy/ 是 GitHub 仓库 lychees/Magic-The-Traveling 的克隆（Pages 跟踪 main 根目录）
cp index.html cards.json README.md PRODUCT.md DESIGN.md AGENTS.md style.css card-viewer.html .deploy/
cp -r js tools docs vendor .deploy/
cd .deploy && git add -A && git commit -m "..." && git push origin main
```

## 文件地图

```text
index.html        DOM + 内嵌 cards-json + 启动/__api/VIEWER_TEXT + holo 3D module
style.css         设计令牌、组件、三主题、响应式、focus/reduced-motion
cards.json        卡牌唯一数据源（cards/races/schools/tokens/version/_comment）
js/core-data.js   数据/常量/storage/经济/TACTIC_INFO/RUN_RELICS
js/net.js         NET、全局 state 声明、联机协议与个性化快照、热座隐私屏
js/economy.js     卡包/卡盒/收藏入库/WebAudio 音效
js/engine.js      对局、AI、战术、速度、轮次摘要、三排/伤害/反击/士气
js/render.js      构筑/战场/详情、DOM 事件、键盘、引导、预设
js/roguelike.js   RUN、地图/节点、遗物奖励、远征存档
js/card-editor.js 内置卡覆盖层、自定义卡、导入导出
tools/sync-cards.js  校验 cards.json 并注入内嵌块；--recompute 重算评分
tools/rating.js   战斗力公式唯一数据源（UMD：游戏页与 sync 工具共用）
tools/simulate.js Node vm + DOM stub 的阵营仿真
card-viewer.html  #holo 跳转页
vendor/three/     固定版本 Three.js 静态资源
docs/现代化重构.md       本次范围/验收/候选路线图（未来功能明确未实现）
docs/玩法设计.md         完整规则/战术/AI/经济/遗物/平衡指标
docs/视觉与交互设计.md   三栏/令牌/主题/响应式/无障碍/中文文案
docs/开发指南.md         架构/API/存储/联机/扩展/测试/发布/回滚
docs/引擎结算.md         逐阶段结算顺序（改顺序必须同步）
docs/roguelike设计.md    远征地图/奖励/Boss/遗物/存档
docs/平衡性评审.md       带日期的历史仿真；建议不等于已实现
.deploy/          GitHub Pages 仓库克隆（部署目标）
.tmp-test/        本机 playwright/探针产物（不入库，克隆中不保证存在）
```

普通 script 顺序：`rating → core-data → net → economy → engine → render → roguelike → card-editor → 内联启动`。它们共享全局词法作用域，不是 ES modules；holo 是独立 module。

## 文档入口

- 新玩家：`README.md` + `docs/玩法设计.md`。
- 产品/验收：`PRODUCT.md` + `docs/现代化重构.md`。
- UI：`DESIGN.md` + `docs/视觉与交互设计.md`。
- 开发：`docs/开发指南.md` + `docs/引擎结算.md`。
- 改规则数值、状态字段、网络协议、主题令牌或文件地图时，同步对应文档；候选路线图不得写成现状。

## 测试

- 主内联脚本语法：

  ```bash
  mkdir -p .tmp-test
  sed -n '/^<script>$/,/^<\/script>$/p' index.html | sed '1d;$d' > .tmp-test/game.js
  node --check .tmp-test/game.js
  ```

- playwright（Python，本机已安装且脚本存在时）：先起 8474 服务，再运行 `.tmp-test/` 中对应脚本。既有本机套件包括 `test_cardeditor.py`、`test_edges_full.py`、`test_album_claim.py`、`test_paramtraits.py`、`test_branchmap.py`、`test_sfx_flow.py`；这些脚本不入库，不得在文档中宣称新克隆必定拥有或已经通过。
- 本次核心矩阵：三指令及跨轮清理、1x/2x/4x 同随机序列同结果、轮次摘要、8 遗物、奖励连点/刷新恢复、三主题、390px、键盘、AI/热座/联机权限。
- 探针注意事项：
  - `playCard()` 等引擎函数**不会**自动触发 `render()`；直接调 API 后需 `window.render()`。
  - 调试游戏状态用 `window.__api`；holo 用 `window.__holo`。
  - `setTactic/setBattleSpeed/chooseAITactic` 是普通脚本全局词法函数，可在控制台/Node vm 直接调用，不假设一定挂在 `__api`。
  - 点 3D 场景坐标要先换算（相机 fov 35°、z=16）；左侧调试面板会挡点击。
  - headless 帧率低，动画计时被 `dt≤0.05` 钳制后实际耗时更长，等待要给足。
  - 打印含 emoji/❤ 的字符串在 GBK 控制台会崩，探针输出避开。
  - 测试结束清理 `.tmp-test` 生成物，不提交日志、截图或 `game.js`。

## 硬约定（违反就会出 bug）

1. **cards.json 是唯一卡牌数据源**。改卡只改它，然后跑 sync；不要手改 index.html 内嵌块。cards.json 与 index.html 必须一起提交。
2. **index.html 为 LF 行尾**。编辑前 Read 再行内 Edit；大段替换用可靠脚本，避免混合 CRLF。
3. `window.__holo.xxx` 赋值必须在 `window.__holo = {...}` 字面量之后或作为其方法，否则 holo 初始化崩。
4. 普通脚本共享词法作用域：替换函数别留旧定义；新增顶层 `const/let` 先查重，加载顺序不能随意改。
5. 测试断言别硬编码会被费用/攻击消耗的血量/法力；速度测试必须注入同一随机序列。
6. **跨模块接口**（改之前先看谁消费）：
   - `window.__api`：主脚本 → 探针/测试。
   - `window.__holo`：主脚本/holo（open/openAlbum/openPack/openBox/close）。
   - `window.__drawCardFace`：holo → 主脚本/编辑器卡面生成。
   - `window.VIEWER_TEXT`：词条/战吼/单位法术/法术效果描述表。
   - `MTCG_RATING`（tools/rating.js）：评分唯一公式。
   - `TACTIC_INFO`：规则 `{name,desc}`；`UI_TACTICS` 是 render 私有 `{label,effect}`，不能同名重声明或只改一边数值。
7. **新机制注册点**：cards.json、VIEWER_TEXT/运行时文本、引擎结算、ratingTraitW、编辑器列表（参数家族 ED_PARAM_TRAITS）、AI、序列化/快照、文档与测试都要检查。
8. **战术/摘要**：
   - `setTactic(side,'assault'|'guard'|'rally'|null)` 只在部署期由有权身份调用。
   - `state.tactics` 是选择，`state._tacticsActive` 才决定战斗派生是否生效；`recalcAuras/effArmor` 读取派生，禁止污染基础值。
   - rally 用 `m._tacticRally` 记录实际增加量；`finishRoundSummary` 撤除派生并完成摘要，`startRound` 先幂等调用收尾再重置选择。`setTactic` 第三参 `fromGuest` 只供 hostHandleAct 代执行，UI 不用。
   - `beginRoundSummary` 在每次 `startRound` 部署开始创建；`startCombat` 只更新实际 tactics 并保留部署伤害，轮末/致死才 `completed`。
   - 新英雄伤害走 `damageHero`，新关键结果走 `recordRoundKey`；不要绕过摘要只写中文日志。
   - 紧凑 UI 只显示双方英雄伤害、阵亡数和结果；当前战术徽标确认战术，详细日志确认名单与关键结果。`state.roundSummary` 字段齐全不等于 UI 全字段直显，`title` 不能成为键盘/触屏唯一入口。
9. **速度**：`setBattleSpeed(1|2|4)` 与 `battleDelay(ms)` 只影响表现等待，不得进入随机、行动顺序、伤害、奖励或胜负。
10. **遗物/远征上下文**：定义在 `RUN_RELICS`；`RUN.relics/_relicDraft` 只存有效 ID；用 `runRelicActive(id,'player')` 接引擎。只有 `startNodeBattle` 以 `initGame(...,true)` 建立 `state._runBattle`；`inRunBattle()` 同时检查该标记和 `RUN.active/RUN.inBattle`，统一约束遗物/Boss/远征结算。普通 `initGame` 默认 false，不受 RUN.inBattle 残留影响。每场计数放 `state._relicState`，旧档缺 `relics` 补 `[]`，候选无效要安全清理。
11. localStorage 键：`mtcg-collection` / `mtcg-gold` / `mtcg-econ-v2` / `mtcg-albums` / `mtcg-run` / `mtcg-memorials` / `mtcg-config` / `mtcg-card-overrides` / `mtcg-custom-cards` / `mtcg-theme` / `mtcg-guide-v1` / `mtcg-dev` / `sfx-muted`。
12. 联机由房主权威，新增动作同时改 host 校验、makeSnapshot/applySnapshot、观战只读和隐私打码；guest 只见自己的私有信息。

## 部署后验证

推送后等待 GitHub Pages 实际更新，再验证线上“预设 → 出牌 → 战术 → 摘要 → 下一轮”、三主题、390px、3D importmap 和联机（公共网络允许时）。检查控制台与 404；本地 8474 与线上都是同源静态文件，但 CDN/PeerJS 可达性需单独记录。发布与回滚完整步骤见 `docs/开发指南.md`。
