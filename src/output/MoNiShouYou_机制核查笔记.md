# MoNiShouYou（模拟手游）机制核查笔记

- 核查日期：2026-11-07
- 游戏目录：`D:\game\steam\steamapps\common\MoNiShouYou`
- 核查存档：`C:\Users\Administrator\AppData\LocalLow\SkyLight\MoNiShouYou\Save_1`（角色：阿松大）
- 说明：全程未修改游戏代码和存档；以下结论来自 `Assembly-CSharp.dll` 的反编译代码、游戏配置文本和实际存档数据。
- 反编译源码位置：`C:\Users\Administrator\AppData\Local\Temp\MoNiDecomp`
- 如需重新生成反编译源码：

```powershell
ilspycmd -p -o C:\Users\Administrator\AppData\Local\Temp\MoNiDecomp "D:\game\steam\steamapps\common\MoNiShouYou\MoNiShouYou_Data\Managed\Assembly-CSharp.dll"
```

> 注意：Temp 目录可能被系统清理。长期查找时，优先按本文的“类名 + 方法名 + 行号”定位；路径失效后按上面的命令重新反编译即可。

---

## 1. 抽奖等级 5 升 6

### 结论

- 抽奖等级只看累计抽奖次数 `ChouJiangCount`，阈值固定为：

```text
250 / 1000 / 5000 / 10000 / 50000
```

- 等级判定：
  - 累计次数 `< 250`：1 级
  - `[250, 1000)`：2 级
  - `[1000, 5000)`：3 级
  - `[5000, 10000)`：4 级
  - `[10000, 50000)`：5 级
  - `>= 50000`：6 级（上限）
- 单抽消耗 1 张抽奖卷（PropID 10），累计次数 +1。
- 十连抽赠送的额外次数不计入累计；代码先把“付费抽数”加到 `ChouJiangCount`，再追加赠送抽数。
- 因此 5 级升 6 级，需要累计抽奖次数达到 50000；从当前进度算还差 `50000 - 当前次数` 张抽奖卷。

### 当时存档数据

- 14:27 存档：`ChouJiangCount = 49750`，抽奖卷 `PropID 10 = 13316` 张。
- 结论：还差 `50000 - 49750 = 250` 次，即 250 张抽奖卷；库存足够，抽完约剩 13066 张。
- 后续 14:52 存档显示 `ChouJiangCount = 50003`，已到 6 级（说明当时已经抽了 253 次）。

### 依据

- `YingLing\GameRecorder.cs`
  - 第 34 行：`public long ChouJiangCount;`
  - 第 36 行：`ChouJiangDengJi = { 250, 1000, 5000, 10000, 50000 }`
  - 第 551-565 行：`GetChouJiangLevel()`
  - 第 447-454 行：`GetChouJiangCount()`
- `YingLing.UI\UIPanel_ChouJiang.cs`
  - 第 221-280 行：`Draw_Open()`
  - 第 239-249 行：扣抽奖卷、累计次数、赠送次数
- 语言文本：`JianTi_CHN.txt` 第 284 行 `Prop_Name_10 = 抽奖卷`

---

## 2. 点卡售卖

### 核心规则

1. **只在刷新时成交**：刷新周期为 60 分钟游戏运行时间；关闭游戏不推进。不是现实整点。
2. 刷新时，系统把所有点卡挂单按价格**从低到高**排序。
3. 买家从最便宜的开始买，**买到 NPC 挂单只剩 20 张就停手**。
   - 也就是说，每轮都会保留 20 张最贵的 NPC 单，不买它们。
4. 玩家自己的挂单也在这张排序表里，但**不计入“NPC 剩余 20 张”的数量**。
5. 你的挂单能成交的条件：
   - 刷新时，**挂单价 ≥ 你的价格的 NPC 单数量 > 20 张**；
   - 等价说法：你的价格必须**低于第 21 贵的 NPC 单**；
   - 同价时你的单会排在同价 NPC 单后面，所以实际挂单要比目标价再低 1 块，避开同价排序。
6. 代码里的 `1,150,000`、`1,200,000` 判断不是成交价上限：
   - 真正的限制是“保留 20 张最贵的 NPC 单”；
   - NPC 实际最高一档是 `1,090,000`，所以挂 `1,090,001` 及以上永远不会成交；
   - `1,090,000` 与最高档同价，能成交但排在同价后面，等得更久，通常不划算。
7. 成交扣 3% 手续费，97% 通过邮件发放，需要去邮箱领取。

### 截断价不是固定的

截断价 = 当前这一轮“第 21 贵的 NPC 单”的价格（挂单时再减 1）。

每一轮刷新后：

- 系统先买走最便宜的若干张，直到 NPC 只剩 20 张；
- 再随机补 30-39 张新 NPC 单，价格在 `900,000 - 1,100,000` 之间、10,000 一档；
- 所以下一轮的池子和截断价都会变。

当时观察到的情况：

- 14:57 存档：截断价 `1,070,000`，最高可成交价 `1,069,999`。
- 15:18 存档（刷新补货后）：截断价变成 `1,019,999`，不是 1,070,000。
- 这证明：**不能一直沿用上一轮的截断价**，每轮刷新后要重新看市场。

### 常见误区

#### 误区 1：把点卡全买光，随便报价都能清空

错。

- 买光后 NPC 数量 = 0；
- 刷新时买家只在“NPC 剩余 >20 张”时才会启动；
- NPC = 0，买家直接不启动，你的挂单一张也不会成交；
- 刷新后系统会再补 50-59 张新 NPC 单，那是下一轮的事。

#### 误区 2：需要买掉剩下的 20 张，因为电脑会回收它们

错。

- 那 20 张不是被电脑“回收”，而是电脑**不买**、留在货架上的 20 张最贵 NPC 单；
- 你买它们，只会减少“排在你上面的 NPC 单数量”，让你的单更难卖；
- 买比你便宜的 NPC 单也不改变“上面有多少张比你贵”，不会让你更容易卖；
- 买太多还可能把 NPC 总库存压到 20 以下，导致买家直接不启动。

#### 误区 3：算最高的 20 张，然后卖“第 20 张 -1”

错，差一张。要算的是**第 21 张**。

例子：

- 市场正好有 20 张 100W，下一档是 98W：
  - 你卖 `999,999`：上面正好 20 张 100W，买家买到停手也轮不到你 → 不成交；
  - 你要卖 `979,999`（低于 98W 档）→ 成交。
- 市场有 21 张 100W：
  - 你卖 `999,999`：上面有 21 张，超过 20 → 成交。

判断标准：

- **挂单价 ≥ 你的价格的 NPC 单数量必须 >20 张**；
- 或者：你的价格必须低于**第 21 贵**的 NPC 单。

### 当时“50 张 90W + 50 张 100W”的卖法

前提：按 15:18 存档，截断价 `1,019,999`，NPC 总库存 51 张。

- 不要分开挂 90W / 100W；
- 全部 100 张挂 `1,019,999`，在刷新前挂上，100 张会在同一轮全部成交；
- 90W、100W 也都能成交，但净到手分别是 `873,000`、`970,000`，比 `989,399` 少；
- 算账（已扣 3%）：
  - 分开：50×87.3W + 50×97W = `9,215W`
  - 全部 `1,019,999`：100×98.9399W = `9,893.99W`
  - 多赚 `678.99W`
- 如果这 100 张是 90W/100W 买来的：成本 `9,500W`，按 `1,019,999` 卖净赚约 `394W`。
- 注意：这是当时快照的示例；下一轮截断价会变，按规则重新算，不要照抄 `1,019,999`。

### 当时玩家挂单的状态

- 15:18 存档：玩家有 1 张挂在 `1,070,000`；
- 当时 NPC 单里价格 ≥1,070,000 的正好只有 20 张（108W/109W 档）；
- 所以这张 1,070,000 本轮不成交；
- 如果一直不卖，等市场里 108W/109W 的 NPC 单累计超过 20 张后，它才会成交；
- 想本轮卖掉，就取回，挂到当时截断价下面 1 块。

### 依据

- `YingLing.KeJinSystem\DianKaSellManager.cs`
  - 第 36-44 行：NPC 数量 1-10、价格 0.9-1.1M 向下取整到 10k
  - 第 46-50 行：`Refresh()` 先 `AutoSell()` 再 `AutoGet()`
  - 第 52-63 行：`AutoSell()`，从最低价买，NPC 库存 >20 才继续
  - 第 65-86 行：`AutoGet()`，补到至少 50 张
  - 第 88-100 行：`GetMaxCount()` 只统计 `Sell_ChaID != 1` 的 NPC 单
  - 第 107-111 行：`AddPlayerSell()`
  - 第 113-118 行：`GetRecord()` 排序
- `FrameWorkHelper\ArrayHelper.cs`
  - 第 171-185 行：`List<T>.OrderByMax()` 实际是**升序**（名字有误导）
- `YingLing.KeJinSystem\DianKaSell_Record.cs`
  - 第 30-47 行：`Sell()`，扣数量、玩家成交后 97% 进邮件
- `YingLing\GameRecorder.cs`
  - 第 142 行：`Time_DianKaRefre_Remand => 60f`
  - 第 517-521 行：`Time_DianKaRefre >= 60*60` 秒时刷新
- `YingLing.UI\UIFrame_DianKaBuy.cs`
  - 第 42-70 行：自己的挂单显示“取回”，NPC 挂单显示“购买”
- `YingLing.UI\UIBlock_JiShouDianKa.cs`
  - 第 46-68 行：寄售价格输入默认 1,000,000；数量最多为库存
- `YingLing.YouJianSystem\YouJianData_Record.cs`
  - 第 43-49 行：邮件附件领取
- 语言文本：
  - `JianTi_CHN.txt` 第 124 行：`YouJian_Des_9` 说明 3% 手续费
  - `JianTi_CHN.txt` 第 1705 行：UI_326 说明人机上架、玩家寄售、3% 手续费

---

## 3. 英灵转职强化（历史本纪）

### 公式

- 材料：历史本纪（PropID 9）。
- 当前强化次数 `L` 从 0 开始：
  - 花费 = `10 + 10L` 本
  - 提升 = 生命 / 攻击 / 防御 / 穿透 各 `+(20 + 50L)`
  - 速度每级固定 `+1`
- 序列：
  - 花费：10、20、30、40…
  - 四维：20、70、120、170…（每级多 50）
  - 速度：每级 +1
- 单本效率（四维合计）：
  - `4 × (20 + 50L) / (10 + 10L)`
  - 从 8 点/本升到 20 点/本 → **越后越划算**
- 注意：
  - 初始“转职”消耗升仙令（PropID 93），不是历史本纪；
  - `Reduce_LiShiBenJi` 只减“科技研究”的历史本纪，不减转职强化。

### 结论

每级花费线性递增，但每级属性也线性递增，且每本历史本纪换到的属性更多。  
**不是越后面提升越少，而是越后面越划算（但总花费更高）。**

### 依据

- `YingLing.CharacterSystem\ZhuanZhiManager.cs`
  - 第 16-19 行：`GetNextAddition()`
  - 第 21-33 行：`Strength()`
  - 第 35-39 行：`GetStrengthRemand()`
  - 第 132-137 行：`ZhuanZhi()` 消耗 PropID 93
- `YingLing.CharacterSystem\KeJiData.cs`
  - 第 46-51 行：`Reduce_LiShiBenJi` 只用于科技研究

---

## 4. 强化装备（强化石）

### 公式

- 材料：强化石（PropID 5）。
- 当前强化次数 `L` 从 0 开始：
  - 花费 = `3 + 2L` 颗
  - 提升 = 生命 / 攻击 / 防御 各 `+(10 + 10L)`
- 序列：
  - 花费：3、5、7、9…
  - 三围：10、20、30、40…（每级多 10）
- 单颗效率（三围合计）：
  - `3 × (10 + 10L) / (3 + 2L)`
  - 从 10 点/颗升到 15 点/颗 → **越后越划算**
- 特殊节点：
  - `L >= 1,000,000` 时，花费和提升都 ×5，比例不变。
- 总等阶：
  - `GetQiangHuaLv()` 是所有已装备部位 `CurStrength` 之和。
- 自动强化：
  - 先找当前等级最低的部位，然后批量强化它。
- 折扣：
  - `Reduce_QiangHuaStore` 按百分比降低强化石消耗，不改变线性形状。

### 结论

每级花费线性递增，每级属性也线性递增，且每颗强化石换到的属性更多。  
**不是越后越少，而是越后越划算。**

### 依据

- `YingLing.CharacterSystem\Equip_Using.cs`
  - 第 19-22 行：`GetNextAddition()`
  - 第 24-38 行：`Strength()`
  - 第 40-54 行：`GetStrengthRemand()`
  - 第 62-98 行：批量计算（含 1,000,000 级 ×5）
- `YingLing.CharacterSystem\NPC_EquipManager.cs`
  - 第 264-289 行：自动强化先选等级最低的部位
- `YingLing.TaskSystem\TaskHelper.cs`
  - 第 251-259 行：`GetQiangHuaLv()` 总等阶求和
- 备注：
  - `YingLing.CharacterSystem\EquipStrengthRecorder.cs` 第 22-41 行是另一套“提升 5+2L、花费 3+2L”的实现，但全项目没有引用，实际生效的是 `Equip_Using`。

---

## 5. 阵法（灵纹）

### 公式

- 解锁：100 灵晶（PropID 8）。
- 升级：灵纹（PropID 7）。
- 当前阵法等级 `L` 从 1 开始：
  - 花费 = `20L` 灵纹
  - 提升 = 生命 / 攻击 / 防御 / 穿透 各 `+(200 + 35L)`
- 序列：
  - 花费：20、40、60、80…
  - 四维：235、270、305、340…（每级多 35）
- 单灵纹效率（四维合计）：
  - `4 × (200 + 35L) / (20L)`
  - 从 47 点/灵纹降到 7 点/灵纹 → **越后越不划算**
- 阵法技能：
  - 固定效果，不随阵法等级提升而强化。
  - 升级只增加四维基础属性。
- 折扣：
  - `ReDuce_ZhenWen` 按百分比降低灵纹消耗，不改变线性形状。

### 结论

每级花费线性递增，每级属性也线性递增，但每点属性耗灵纹越来越多。  
**只有阵法这一项符合“越后面花的多、每份材料提升少”；而且阵法技能本身不成长。**

### 依据

- `YingLing.CharacterSystem\ZhenFaRecorder.cs`
  - 第 29-32 行：`GetJieSuoRemand()` 100 灵晶
  - 第 34-40 行：`GetLevlUPRemand()`，`Level * 20` 灵纹
  - 第 82-91 行：`LevelUp_AddProperty()`，`200 + 35 * Level`
  - 第 207-214 行：初始四维各 500
- 语言文本：`JianTi_CHN.txt` 第 1636 行，UI_257 明确“阵法效果为固定效果，不会随阵法等级提升而强化”

---

## 6. 制作 / 寒铁 / 翅膀

### 寒铁花费与时间

- 每次制作消耗：当前制作等级 `L` 个寒铁（PropID 1）。
  - 上限：200 万；
  - `Reduce_HanTie` 折扣后最低 1 个。
  - 序列：1、2、3、4…
- 制作时间：基础时间 + `0.2 秒 × L`，最高 30 秒。
- 每次制作：
  - 产出 1 件随机装备；
  - 获得制作经验 `2 + L`；
  - 制作等级升级需求为分段线性（`GetLianQiLevelUpExp`）。

### 装备属性

- 新装备的基础属性按制作等级 `L` 线性增长；
- 再乘：
  - 器鼎品质倍率；
  - 随机系数 1.0-1.1；
  - 装备制造属性百分比（来自相关加成）。

所以“每做一件都提升装备能力”不保证，因为装备是随机产出的；但制作等级会提升，后续装备的基础属性会线性提高。

### 制作翅膀（第二个翅膀）

- 解锁条件：制作等级 ≥ 1000。
- 效果：
  - 制作经验额外 +3%/翅膀等级；
  - 每制作一件装备，永久给 生命 / 攻击 / 防御 / 穿透 各加 `75 + 25 × 翅膀等级`。
- 数值序列：
  - 翅膀 1 级：每次 +100
  - 2 级：+125
  - 每升 1 级，每次多 +25
- 翅膀升级：
  - 每升 1 级只消耗 1 个对应材料（PropID 150-153 之一）。
  - 这部分按翅膀等级线性递增，不递减。
  - 该加成解锁/升级后即生效，代码不检查是否佩戴。

### 性价比

- 寒铁花费随制作等级 `L` 线性上涨；
- 翅膀每件加成只随翅膀等级 `W` 上涨，不随 `L` 上涨；
- 所以固定翅膀等级时：
  - 每寒铁换到的永久四维 = `(75 + 25W) / L`，会随制作等级上升而下降。
- 同步升翅膀时：
  - 翅膀每级 +25/件、成本 1 材料/级，这部分是线性的，不递减；
  - 可以抵消制作等级上涨带来的性价比下降。
- 装备本身的基础属性/寒铁大致持平（两者都随制作等级线性）。

### 结论

- 寒铁单次花费线性↑；
- 装备基础属性线性↑；
- 翅膀永久加成按翅膀等级线性↑、不递减；
- 但“每寒铁换到的永久加成”会随制作等级下降，除非同步升翅膀。

### 依据

- `YingLing.PropSystem\PropHelper.cs`
  - 第 467-476 行：`GetLianQiLevelUpExp()`
  - 第 478-485 行：`CulExp_Single()`
  - 第 487-501 行：`GetRemandMat()`，寒铁 = 制作等级
  - 第 507-515 行：`GetMakeEquipRemandJinDu()`，制作时间
  - 第 388-422 行：`GenerateEquip()`，装备属性生成
- `YingLing.CharacterSystem\NPC_EquipManager.cs`
  - 第 114-131 行：`FinishLianQi()`，翅膀永久四维加成
  - 第 141-167 行：`AddLianQiExp()`，翅膀经验加成
- `YingLing.KeJinSystem\Wing_Setting_Data.cs`
  - 第 33-46 行：翅膀 2 的效果文本
  - 第 74-93 行：翅膀 2 解锁条件：制作等级 ≥ 1000
- `YingLing.KeJinSystem\WingRecord.cs`
  - 第 28-44 行：升级时扣 1 个材料、等级 +1，并写入对应 Mark 的 Count

---

## 7. 器鼎（五彩神石）

### 花费

- 材料：五彩神石（PropID 2）。
- 当前器鼎等级 `L` 从 1 开始：
  - 花费 = `((L - 1) / 5 + 1) * 10` 个
- 序列：
  - 1-5 级：每次 10 个
  - 6-10 级：每次 20 个
  - 11-15 级：每次 30 个
  - 每 5 级 +10
- 不是每级线性，而是阶梯式；累计花费二次增长。
- `Reduce_WuCaiShenShi` 按百分比减耗，不改变阶梯形状。

### 升级时间

- 单位：分钟。
- 1-10 级：`Lv`
- 11-20 级：`10 + 3 × (Lv - 10)`
- 21-30 级：`40 + 4 × (Lv - 20)`
- 31 级以上：`80 + 5 × (Lv - 30)`
- `Add_QiDing_LevelUp_Speed` 按百分比减少。
- 越后每级时间越长，分段线性。

### 收益

- 器鼎等级不直接加固定属性，而是提高**新制作装备的品质概率表**。
- 代码逻辑：
  - `GetEquipPinZhiTable(L)` 取该等级的品质概率表；
  - 从最高品质往低品质填充权重，填满 1000 为止；
  - 等级越高，高品质权重越大；
  - 品质表只生成到 3998 级，超过后代码回落到 3500 级表；
  - 所以后期品质概率会饱和/封顶。
- 品质的作用：
  - 品质越高，装备主属性倍率越高；
  - 品质按阈值（>1、>3、>6、>9）增加随机词条数量。
- 额外线性加成：
  - 如果拥有“每级器鼎 +1% 装备制造属性”的加成（Mark `Add_EquipProperty_QiDingLevel`），则 `GetEqui_PropertyAddition()` 会加上 `QiLu_Level`，即每级 +1%，只作用于新制作的装备。
- 器鼎升级不会 retroactively 增强已有装备。

### 结论

- 阶梯花费 + 概率表饱和，不是线性属性提升；
- 后期品质收益递减/封顶；
- 只有 `+1%/级` 的那个 Mark 是线性的；
- 升级前要注意：器鼎等级只影响“新造装备”的品质概率，不直接加角色属性。

### 依据

- `YingLing.CharacterSystem\NPC_EquipManager.cs`
  - 第 39 行：`QiLu_Level = 1`
  - 第 242-248 行：`CulLevelTime()` 升级时间
  - 第 250-256 行：`GetLevelUpRemandProp()` 五彩神石阶梯花费
  - 第 258-262 行：`OpenLevelUpQiLu()`
- `YingLing.PropSystem\PropHelper.cs`
  - 第 384 行：制作时取器鼎品质表
  - 第 388-422 行：`GenerateEquip()` 品质倍率与词条
  - 第 424-438 行：`GetEqui_PropertyAddition()`，器鼎每级 +1% 的 Mark
  - 第 507-520 行：`GetEquipPinZhiTable()` / `GetEquipLevel_PercentTable()`
  - 第 151-158 行：品质表生成范围 1-3998，回落到 3500
- `YingLing.CharacterSystem\EquipLevel_PercentTable.cs`
  - 第 43-64 行：`GeneratePercent()` 品质权重填充
  - 第 66-79 行：`GetPinZhi()` 按权重随机品质

---

## 8. 5 个地图圣兽

### 五只圣兽

- 矿洞：玄武
- 遗迹：朱雀
- 寒潭：青龙
- 桃园：白虎
- 通天塔：麒麟

每只消耗对应地图配置的材料（具体材料以游戏内该圣兽面板显示为准），公式相同。

### 花费

- 当前阶数 `L` 从 0 开始：
  - 花费 = `10 + 10L` 个对应材料
  - 单级上限：50,000
- 序列：
  - 前期 10、20、30、40…
  - 约 5000 阶后每级固定 50,000
- 累计花费：
  - 前期二次增长；
  - 封顶后线性。

### 提升

- 两条基础属性每条 `+(20 + 50L)`。
- 第三条特殊属性每 250 阶 +1%：
  - 第 1 阶先 +1%；
  - 之后 251、501… 每 250 阶 +1%。
- 基础属性线性递增；
- 特殊属性是固定百分比速率；
- 最大阶数 = 该地图历史最高通关层数，不能超过。

### 结论

- 线性递增，不是越后越少；
- 基础属性/材料效率随阶数上升；
- 50,000 封顶后，花费不再涨、属性继续涨，更划算；
- 特殊属性每 250 阶固定 +1%，速率不变。

### 依据

- `YingLing.BattleSystem\ShengShou_Record.cs`
  - 第 18-21 行：`GetNextAddition()`，`20 + 50L`
  - 第 23-31 行：`GetSpecialAddition_Next()`
  - 第 33-47 行：`Strength()`，基础属性与每 250 阶特殊属性
  - 第 49-57 行：`GetStrengthRemand()`，`10 + 10L`，上限 50,000
  - 第 65-95 行：批量强化计算
  - 第 166-174 行：`CheckMaxOK()` 最大阶数限制
- `YingLing.UI\UIBlock_ShengShou.cs`
  - 第 146-159 行：显示当前/下一阶属性、特殊属性、材料
- 语言文本：
  - `JianTi_CHN.txt` 第 29-33 行：地图名
  - 第 1694 行：UI_315，圣兽最大阶数 = 当前最大地图通关数
  - 第 1971-1975 行：五只圣兽名称

---

## 9. 代码索引与查找方法

### 反编译源码位置

- 当前：`C:\Users\Administrator\AppData\Local\Temp\MoNiDecomp`
- 原始程序集：`D:\game\steam\steamapps\common\MoNiShouYou\MoNiShouYou_Data\Managed\Assembly-CSharp.dll`
- 重新生成命令：

```powershell
ilspycmd -p -o C:\Users\Administrator\AppData\Local\Temp\MoNiDecomp "D:\game\steam\steamapps\common\MoNiShouYou\MoNiShouYou_Data\Managed\Assembly-CSharp.dll"
```

### 关键类与方法

- 抽奖：
  - `YingLing.GameRecorder`
    - `ChouJiangDengJi`（第 36 行）
    - `GetChouJiangLevel()`（第 551-565 行）
  - `YingLing.UI.UIPanel_ChouJiang`
    - `Draw_Open()`（第 221-280 行）
- 点卡：
  - `YingLing.KeJinSystem.DianKaSellManager`
    - `GetDefaultPrice()`（第 41-44 行）
    - `AutoSell()`（第 52-63 行）
    - `AutoGet()`（第 65-86 行）
    - `GetMaxCount()`（第 88-100 行）
    - `AddPlayerSell()`（第 107-111 行）
  - `YingLing.KeJinSystem.DianKaSell_Record`
    - `Sell()`（第 30-47 行）
  - `FrameWorkHelper.ArrayHelper`
    - `List<T>.OrderByMax()`（第 171-185 行，实际升序）
  - `YingLing.GameRecorder`
    - `Time_DianKaRefre_Remand`（第 142 行）
    - 刷新逻辑（第 517-521 行）
  - `YingLing.UI.UIBlock_JiShouDianKa`
    - 寄售价格/数量（第 46-68 行）
  - `YingLing.UI.UIFrame_DianKaBuy`
    - 购买/取回（第 42-70 行）
- 转职强化：
  - `YingLing.CharacterSystem.ZhuanZhiManager`
    - `GetNextAddition()`（第 16-19 行）
    - `Strength()`（第 21-33 行）
    - `GetStrengthRemand()`（第 35-39 行）
- 强化装备：
  - `YingLing.CharacterSystem.Equip_Using`
    - `GetNextAddition()`（第 19-22 行）
    - `Strength()`（第 24-38 行）
    - `GetStrengthRemand()`（第 40-54 行）
  - `YingLing.CharacterSystem.NPC_EquipManager`
    - `AutoStrength()`（第 275-289 行）
  - `YingLing.TaskSystem.TaskHelper`
    - `GetQiangHuaLv()`（第 251-259 行）
- 阵法：
  - `YingLing.CharacterSystem.ZhenFaRecorder`
    - `GetJieSuoRemand()`（第 29-32 行）
    - `GetLevlUPRemand()`（第 34-40 行）
    - `LevelUp_AddProperty()`（第 82-91 行）
- 制作 / 翅膀：
  - `YingLing.PropSystem.PropHelper`
    - `GetRemandMat()`（第 487-501 行）
    - `GetMakeEquipRemandJinDu()`（第 507-515 行）
    - `GenerateEquip()`（第 388-422 行）
    - `GetLianQiLevelUpExp()`（第 467-476 行）
    - `CulExp_Single()`（第 478-485 行）
  - `YingLing.CharacterSystem.NPC_EquipManager`
    - `FinishLianQi()`（第 114-131 行）
    - `AddLianQiExp()`（第 141-167 行）
  - `YingLing.KeJinSystem.Wing_Setting_Data`
    - `GetEffectString()`（第 33-46 行）
    - `CheckEnoughToJieSuo()`（第 74-93 行）
  - `YingLing.KeJinSystem.WingRecord`
    - `LevelUp()` / `LevelUpToMax()`（第 28-44 行）
- 器鼎：
  - `YingLing.CharacterSystem.NPC_EquipManager`
    - `CulLevelTime()`（第 242-248 行）
    - `GetLevelUpRemandProp()`（第 250-256 行）
  - `YingLing.CharacterSystem.EquipLevel_PercentTable`
    - `GeneratePercent()`（第 43-64 行）
    - `GetPinZhi()`（第 66-79 行）
  - `YingLing.PropSystem.PropHelper`
    - `GetEqui_PropertyAddition()`（第 424-438 行）
    - `GetEquipPinZhiTable()`（第 517-520 行）
- 圣兽：
  - `YingLing.BattleSystem.ShengShou_Record`
    - `GetNextAddition()`（第 18-21 行）
    - `Strength()`（第 33-47 行）
    - `GetStrengthRemand()`（第 49-57 行）
    - `CheckMaxOK()`（第 166-174 行）
  - `YingLing.UI.UIBlock_ShengShou`
    - 显示逻辑（第 146-159 行）

### 关键存档文件

- 存档根目录：`C:\Users\Administrator\AppData\LocalLow\SkyLight\MoNiShouYou`
- 第一存档：`Save_1`
  - `Game_RecordData.Save`：抽奖次数、点卡挂单、资产等
  - `Prop_Data.Save`：道具数据
  - `Cha_Data.Save`：角色数据
  - `YingLing_Data.Save`：英灵数据
  - `Map_Data.Save`：地图/圣兽数据
  - `Task_Data.Save`：任务数据
  - `SaveInfo.Save`：存档摘要

### 备注

- 本文中的具体数值（如点卡截断价、抽奖次数、挂单价格）都是核查当时存档快照的示例，会随游戏进程变化；长期有效的部分是每节的规则和公式。
- 代码里的 `OrderByMax` 名字容易误解：它在 List 版本里实际是升序，点卡买家因此从最低价开始买。这一点是理解点卡售卖的关键。
