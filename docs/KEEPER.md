# CoC 7 · KP 的 NPC 与怪物资料库

KP 资料卡（`KeeperCard`）与玩家调查员卡（`Character`）分开保存，不占用玩家席位，也不套用调查员的职业点、兴趣点预算或属性上限。房间内的 KP 资料卡仅对当前主持人可见。

## 分类与内置模板

怪物与非人类实体参考 [Chaosium 官方 Bestiary](https://cthulhuwiki.chaosium.com/bestiary/) 划分为神话生物（`mythos`）与神话神祇（`deity`），以及传统恐怖生物（`traditional`）、野兽（`beast`）和自定义（`custom`）。系统内置以下空白结构与原创格式示例。

| 模板 ID               | 名称与用途                                      | 性质         |
| --------------------- | ----------------------------------------------- | ------------ |
| `npc-blank`           | 空白 NPC 卡，属性可全部留空                     | 空白结构     |
| `npc-bystander`       | 普通路人，附少量基础技能                        | 原创格式示例 |
| `npc-contact`         | 档案馆联络人，用于线索 NPC                      | 原创格式示例 |
| `monster-mist-hound`  | 雾岸猎影，演示超 100 属性与特殊能力记录         | 原创格式示例 |
| `monster-mythos`      | 神话生物                                        | 分类空白卡   |
| `monster-deity`       | 神话神祇                                        | 分类空白卡   |
| `monster-traditional` | 传统恐怖生物                                    | 分类空白卡   |
| `monster-beast`       | 野兽                                            | 分类空白卡   |
| `monster-blank`       | 自定义怪物                                      | 分类空白卡   |

从模板创建卡片时，`average` 模式直接复制模板保存的固定参考值；`roll` 模式按模板中的属性骰式逐项投掷，无骰式的属性保持原值。

## 属性、派生值与骰式

属性字段包括 `str` / `con` / `siz` / `dex` / `app` / `int` / `pow` / `edu`。`null` 表示未知或不适用（如部分生物无 APP 或 EDU），`0` 表示明确的零值。属性与技能数值允许超过 100，检定工具按实际数值计算普通、困难与极难成功阈值。

KP 更新属性并触发派生计算时，`deriveKeeperCard` 按以下公式更新上限与体格（参考 [Chaosium 副属性说明](https://cthulhuwiki.chaosium.com/investigators/step-two-secondary-attributes.html)）。

- HP 上限：`floor((CON + SIZ) / 10)`
- MP 上限：`floor(POW / 5)`
- 伤害加值（DB）与体格：按 `STR + SIZ` 查表计算（含超过 204 的延伸区间）

重算派生值不会自动恢复已消耗的当前 HP 或 MP，仅在当前值超过新上限时向下截断。HP 与 MP 上限，以及 DB 和体格均支持手动修改，以保留模组特殊设定。移动速度与护甲说明，以及特殊能力和理智损失（如 `0/1d4`）均按文本记录。

属性骰式支持 `3d6*5` 与 `(2d6+6)*5`，也可填写 `2d6+6` 或固定整数（乘号可写作 `×`；含加法的乘法表达式须加括号，如 `(2d6+6)*5`）。单项最多 100 颗骰子，每颗 2 至 1000 面，加减修正不超过 ±10000，乘数 1 至 1000，结果范围须在 0 至 100000 之间。

## 操作接口

`shared/keeper.ts` 提供以下卡库操作函数。

- `createKeeperCard('npc' | 'monster')`：创建对应类型的空白卡。
- `createKeeperCard(templateId, { mode: 'average' | 'roll', name?, rng? })`：从内置模板生成单张卡片，并将当前 HP 与 MP 初始化为上限。
- `createKeeperBatch(templateId, count, { mode?, name?, startIndex?, rng? })`：批量生成 1 至 200 张带连续编号的卡片。
- `rerollKeeperCard(card, rng?)`：按卡片保存的属性骰式重新投掷属性，保留名称、攻击与技能，同时保留已消耗资源。
- `duplicateKeeperCard(card, name?)`：复制卡片并生成新的卡片、攻击与技能 ID。

## 文件格式与校验边界

单张卡片导出格式为 `documentType: "keeper-card"`，资料集格式为 `documentType: "keeper-collection"`（`schemaVersion: 1`，`rule: "coc"`，单批 1 至 200 张）。支持导出为 JSON 或内嵌单个 JSON 代码块的 Markdown，两种格式均可由 `parseKeeperCards` 重新解析导入。

校验上限：属性、HP / MP 与护甲最高 100000；技能与攻击成功率最高 1000；体格范围为 -10 至 3000；每轮攻击次数为 0 至 100 或 `null`。单张卡片最多包含 30 项攻击、100 项技能与 30 个标签，特殊能力上限 12000 字符，私密笔记上限 24000 字符。单个导入或导出文件上限为 8 MiB。

## 规则参考

- [Chaosium Bestiary：条目结构与生物分类](https://cthulhuwiki.chaosium.com/bestiary/)
- [Chaosium Mythos Monsters：超 100 属性与骰式示例](https://cthulhuwiki.chaosium.com/bestiary/mythos-monsters.html)
- [Call of Cthulhu 7th Edition Conversion Guidelines](https://www.chaosium.com/content/FreePDFs/CoC%207/CHA23135-Conv%20-%20Call%20of%20Cthulhu%207th%20Edition%20Conversion%20Guidelines.pdf)
