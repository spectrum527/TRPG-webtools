# 规则口径与人物卡格式

建房时可选择 D&D 5e（2014 版）、D&D 5e（2024 版）或克苏鲁的呼唤第 7 版（CoC 7th）。D&D 房间创建后固定版次，人物卡与房间配置，以及数据块和续团存档须与房间版次一致（省略版次的早期文件按 2014 版读取）。

## D&D 5e（2014）

规则依据：[SRD 5.1 官方 CC 版本](https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf)。

| 项目         | 计算方式                                                        |
| ------------ | --------------------------------------------------------------- |
| 初始六项属性 | 每项投 4d6 取最高 3 颗求和，支持重掷与手动修改                  |
| 属性调整值   | `floor((属性 - 10) / 2)`                                        |
| 熟练加值     | 1–4 级 +2；5–8 级 +3；9–12 级 +4；13–16 级 +5；17–20 级 +6      |
| 属性检定     | `d20 + 属性调整值 + 临时修正`                                   |
| 技能与豁免   | `d20 + 属性调整值 + 临时修正`；熟练时加熟练加值，技能专精计两倍 |
| 优势与劣势   | 投 2 颗 d20 分别取高值或低值                                    |
| 攻击检定     | `d20 + 完整攻击加值`，自然 20 重击，自然 1 自动失手             |

制卡器支持 SRD 5.1 的 12 个职业，按职业可选范围与数量记录技能熟练并计算职业豁免。背景自选两项技能；精灵固定获得察觉，半兽人固定获得威吓，半精灵自选两项技能。熟练来源重合时可补选同数量的替代技能，额外技能与豁免使用主持人授予的名额。

技能专精仅限已熟练技能，游荡者 1 级最多 2 项、6 级最多 4 项；吟游诗人 3 级最多 2 项、10 级最多 4 项（专精计两倍熟练加值；吟游诗人 2 级起未熟练技能计向下取整的半熟练加值）。新建人物卡默认将 HP 初始化为 `8 + 体质调整值`，基础 AC 初始化为 `10 + 敏捷调整值`，玩家可按职业生命骰与等级修改最终 HP 上限，并在「装备与负重」中启用护甲与武器联动。

## D&D 5e（2024）

2024 版房间采用该版职业技能范围与种族熟练，并按 2024 规则处理背景和专精等级；选择内置玩家手册背景时固定授予两项背景技能，属性栏填写计入背景加值后的最终值。两版角色均可在「属性与状态」页开启被动察觉（`10 + 当前察觉调整值`），详见 [两版制卡与被动察觉](DND-EDITIONS.md)。

战斗中，2024 版受突袭者在掷先攻时具有劣势，2014 版受突袭者在首回合受行动限制；2024 版专注豁免 DC 上限为 30。详见 [D&D 2024 官方基本规则](https://www.dndbeyond.com/sources/dnd/br-2024/playing-the-game)、[专注规则](https://www.dndbeyond.com/sources/dnd/br-2024/rules-glossary#Concentration) 与 [战斗操作说明](COMBAT.md)。

## CoC 7

基础检定、技能类别和副属性见 [Chaosium 快速入门规则](https://www.chaosium.com/cthulhu-quickstart/)、[副属性说明](https://callofcthulhuwiki.chaosium.com/investigators/step-two-secondary-attributes.html) 与 [职业和技能说明](https://callofcthulhuwiki.chaosium.com/investigators/step-three-occupation-and-skills.html)。完整制卡规则见 [Chaosium 第七版调查员手册](https://www.chaosium.com/call-of-cthulhu-investigator-handbook-hardcover/)。

| 项目                               | 计算方式                          |
| ---------------------------------- | --------------------------------- |
| STR / CON / DEX / APP / POW / 幸运 | `3d6 × 5`                         |
| SIZ / INT / EDU                    | `(2d6 + 6) × 5`                   |
| HP 上限                            | `floor((CON + SIZ) / 10)`，至少 1 |
| MP 上限                            | `floor(POW / 5)`                  |
| 初始 SAN                           | `POW`（不超过 SAN 上限）          |
| SAN 上限                           | `99 - 克苏鲁神话技能`             |
| 闪避初始值 / 母语初始值            | `floor(DEX / 2)` / `EDU`          |

每个职业含八项不同的本职技能。职业点采用 `EDU × 4` 或 `EDU × 2 + 指定属性 × 2`，兴趣点为 `INT × 2`。职业点可投入本职技能与信用评级。主持人可以开启专点专用，使兴趣点仅用于其他技能。最终百分比为 `基础值 + 职业点 + 兴趣点`。信用评级须落在职业区间内，新调查员的克苏鲁神话技能默认从 0 开始。

职业分支与技能专长分别开启。职业分支可以改变公式、信用区间和技能范围。艺术与手艺、科学、外语、格斗、射击、驾驶和生存的专长各自分配和检定。单项房规作用于卡上启用的对应技能。职业和技能目录标明来源，部分模板的公式和基础值据《COC七版空白自动卡》整理，幕间补充的模板单独标注。

完整职业目录包含参考卡中的 229 项预设，按编号区分同名变体。扩展职业按来源记录技能名额及条件，不强制统一为八项。来源未注明的基础值须手动确认，主持人审核时可查看来源和修订备注。详见 [职业目录说明](COC_OCCUPATIONS.md)。

自定义职业可设置上述两种公式、信用区间以及八个技能位置的范围和自由名额。每张卡最多定义 12 项自定义技能，基础值可填 0–99。可移植的职业模板 JSON 包含方案和它引用的自定义技能，文件上限 64 KiB。旧卡缺少这两项开关时按基础技能模式读取。

年龄自动修正适用于 15–89 岁，应用后记录实际扣减与教育、幸运骰点。伤害加值和体格取力量与体型合计，移动力取力量和敏捷与体型的比较，再应用年龄和防具修正。HP、MP 和 SAN 上限取长期数值，也可手动设定。上限提高时保留当前资源。

百分骰检定（1 至 100）小于等于目标值为普通成功，小于等于目标值一半（向下取整）为困难成功，小于等于五分之一（向下取整）为极难成功，投出 1 为大成功；目标值低于 50 时投出 96 至 100 为大失败，目标值达到 50 时投出 100 为大失败。奖励骰与惩罚骰共用同一颗个位骰并多投一颗十位骰，分别取更优或更差结果。普通理智检定以当前 SAN 为目标值投百分骰（参考 [Chaosium 官方理智规则](https://cthulhuwiki.chaosium.com/rules/sanity.html)）。

CoC 制卡器的「属性与状态」页支持开启八项属性总和上限（不含幸运，可设 195 至 720，默认建议值 500）。若房间内主持人设置了属性总和范围，制卡器自动锁定使用房间上限；超限人物卡可选择重掷或按 `floor(原属性 × 上限 ÷ 原总和 ÷ 5) × 5` 比例下调。

### CoC 局内结算

- 理智检定先按成功或失败的骰式保存一条待结算损失，主持人确认时才扣除 SAN。自动疯狂判定在确认时处理 SAN 降为 0 的永久疯狂和累计损失达日初 SAN 五分之一的不定性疯狂，再用单次损失至少 5 点与智力检定判断临时性疯狂。主持人也可手动裁定发作、症状和持续时间。 [Chaosium 理智规则](https://cthulhuwiki.chaosium.com/rules/sanity.html)
- 幕间成长对已标记技能投 `1d100`，超过长期技能值或投出 96–100 时增加 `1d10`，首次经成长达到 90 可恢复 `2d6` SAN。幸运消耗和孤注一掷为房间选用规则，默认关闭。孤注一掷由主持人确认条件和后果。
- 武器可读取角色技能与伤害加值，同时记录射程、弹药和故障。防具按命中部位取最高护甲值。财产参考值随信用评级计算，首次记账后余额以账本为准。 [Chaosium 武器表](https://cthulhuwiki.chaosium.com/equipment/weapons.html)
- 法术记录 MP、SAN、HP 和耗时。学习可由主持人确认，也可结算困难 INT 检定。首次施法结算困难 POW 检定，之后按施法记录与选用规则处理。神话书分别记录初读和研读进度，获得的神话技能会计入 SAN 上限。

## 建卡限制与主持人审核

主持人可在房间设置单项属性与技能范围，限制属性总和（CoC 不含幸运）、资源上限与年龄或等级，并指定允许的职业和种族列表。普通人物卡的文件录入边界为 D&D 属性 1 至 30、CoC 属性 1 至 100，房间默认建卡上限分别为 D&D 1 至 20、CoC 1 至 99。

玩家完成姓名、职业与技能分配后提交审核，主持人按当前人物卡版本与房间规则版本审批。在准备阶段保存人物卡、修改资源或更改房间规则均会重置准备与审核状态；开团后锁定整卡替换，属性与技能的成长或临时修正通过[局内角色调整](CHARACTER-ADJUSTMENTS.md)记录。主持人席位不载入玩家人物卡。

## 骰子与检定接口

`rollDice(expression, rng?)` 支持 `d20`、`2d6+3` 与 `1d8+1d4-2` 等加减骰式（单次最多 100 颗骰子，每颗 2 至 1000 面，表达式最长 120 字符，修正绝对值上限 10000），默认使用 Web Crypto 无偏拒绝采样生成随机数。

`rollCheck(rule, character, request, rng?)` 返回候选骰、选中骰与修正值，同时给出总值、目标值和判定结果。D&D 检定读取 `request.modifier` 与目标 `request.dc`；CoC 检定读取角色技能、属性或 SAN，也可使用显式传入的 `request.target`（KP 手填怪物目标最高支持 100000，困难与极难阈值按原值折算，投出 100 仍判为大失败）。

## 人物卡与关联数据结构

人物卡支持导出为 UTF-8 JSON 或包含单个 `json` 代码块的 Markdown（文件上限 1 MiB），对应 `shared/types.ts` 中的 `Character`（`schemaVersion: 1`）。

| 字段                                   | 说明                                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `rule` / `dndEdition`                  | `dnd` 或 `coc`；D&D 卡包含 `"2014"` 或 `"2024"` 版次（省略时按 2014 读取）                                              |
| `attributes`                           | D&D 为 `str, dex, con, int, wis, cha`；CoC 为 `str, con, siz, dex, app, int, pow, edu, luck`                            |
| `skills`                               | CoC 为最终百分比，D&D 为计算后的技能加值                                                                                |
| `creation`                             | 制卡分配账本（CoC 记录本职技能与两类点数；D&D 记录职业、背景与种族熟练，以及替代、额外熟练和专精）                      |
| `cocCareer`                            | 可选 CoC 职业分支、技能专长开关、自定义职业和技能定义                                                                   |
| `cocInvestigator` / `cocSession`       | 可选 CoC 衍生数值、年龄、装备与财产，以及游戏时间、理智、成长、法术和阅读记录                                           |
| `proficiencies`                        | D&D 熟练项数组，格式如 `skill:acrobatics`、`save:dex`                                                                   |
| `passivePerceptionEnabled`             | D&D 可选布尔值，开启后显示被动察觉                                                                                      |
| `hp/maxHp` / `mp/maxMp` / `san/maxSan` | 当前资源与上限（当前值不超过上限）                                                                                      |
| `items`                                | 物品数组，每项含 `id` / `name` / `quantity` / `notes` 及可选的 D&D `equipment` 扩展数据                                 |
| `adjustments`                          | 可选局内修正，包含 `permanent` 长期变更与 `temporary` 临时效果，见[局内角色调整](CHARACTER-ADJUSTMENTS.md)              |
| `dndMagic` / `dndEquipment`            | 可选 D&D 法术资源与穿戴联动配置，见[角色准备](CHARACTER-PREPARATION.md)、[法术](DND-MAGIC.md)与[装备](DND-EQUIPMENT.md) |

主持人备团与战斗状态分别使用独立的存储结构：CoC 资料卡见 [CoC 主持人卡库](KEEPER.md)，D&D 数据块见 [D&D 数据块格式](DND-STATBLOCKS.md)，房间遭遇与回合状态见 [战斗操作说明](COMBAT.md)。

## SRD 5.1 attribution

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

本项目的中文界面文案与辅助计算为自行整理的适配实现。Call of Cthulhu 相关名称与规则著作权归各自权利人所有。
