# MoNiShouYou 阵营玩法代码详解

- 核查日期：2026-11-08
- 反编译源码：`src//反编译`
- 原始程序集：`D:\game\steam\steamapps\common\MoNiShouYou\MoNiShouYou_Data\Managed\Assembly-CSharp.dll`
- 反编译命令：

```powershell
ilspycmd -p -o "src\挂机手游模拟器\反编译" "D:\game\steam\steamapps\common\MoNiShouYou\MoNiShouYou_Data\Managed\Assembly-CSharp.dll"
```

> 下文行号均指 `src//反编译` 下的反编译代码。

---

## 1. 结论：阵营玩法与“玩家参加的轮数”的关系

### 1.1 有直接关系，但只影响结算元宝倍率

`ZhenYingZhenDou_Manager.Round` 是存档里唯一的阵营轮数计数器。它只在一个地方被读取：

- `ZhenYingZhenDou_Manager.cs` 第 181-222 行 `JieSuan()`（结算）
  - 第 205-208 行：`if (Round > 20) Round = 20;`
  - 第 209 行：`num = num * (10 + Round) / 10;`

也就是：

```text
第 n 次结算的元宝倍率 = (10 + min(n - 1, 20)) / 10
```

| 第几次结算 | 结算时 Round | 倍率 |
| --- | --- | --- |
| 第 1 次 | 0 | 1.0 |
| 第 2 次 | 1 | 1.1 |
| 第 3 次 | 2 | 1.2 |
| … | … | … |
| 第 20 次 | 19 | 2.9 |
| 第 21 次及以后 | 20（封顶） | 3.0 |

这与游戏内帮助文本一致：

- `JianTi_CHN.txt` 第 1719 行 `UI_340`
  - “每轮阵营活动结束后，转化比例会提高10%”
  - “最多累积20轮，转化比例为一积分转化为三元宝”
- 代码的 `Round` 从 0 开始，结算后 `Round++`；所以第 1 次结算是 1.0 倍，累计 20 次 +10% 后（即第 21 次结算）达到 3.0 倍封顶。
- 封顶是在 `JieSuan()` 内部把字段本身改成 20，之后 `FinishGameEndTime()` 又 `Round++` 成 21，下次结算再夹回 20；存档里这两个值都可能看到，倍率始终按夹取后的 20 计算。

### 1.2 Round 的准确定义

`Round` 不是“玩家点了多少次阵营按钮”，也不是“玩家在阵营里待了多久”，而是：

```text
已经完成结算的阵营轮数
```

证据链：

1. `Round++` 只出现在 `ZhenYingZhenDou_Manager.cs` 第 177 行 `FinishGameEndTime()`。
2. `FinishGameEndTime()` 只在 `AddTimer()` 第 291 行被调用，条件是 `OpenGameTime > 28800f`（8 小时游戏运行时间）。
3. `AddTimer()` 里 8 小时计时只在 `HasOpen == true` 时推进（第 237-241 行）。
4. `HasOpen = true` 只在 `StartGame()` 第 159 行出现。
5. `StartGame()` 全项目只有两个调用点：
   - `UIBlockChooseZhenYing.cs` 第 85 行
   - `UIBlockChooseZhenYing.cs` 第 91 行
   两个都在玩家点击阵营选择按钮并确认之后。
6. 玩家不选择阵营时，`HasOpen` 保持 false，`AddTimer()` 直接 `return`（第 237-240 行），`OpenGameTime` 不增长，`Round` 永远不加。

因此：

- **玩家必须点选阵营，一轮才会开始；不点选，阵营活动不会开启，轮数也不会增长。**
- 这与 `UI_340` 第 7 条完全一致：“若玩家不参与活动，阵营活动将不会开启，直至玩家参与活动时才开启阵营活动。”
- 因为每一轮都必须由玩家点选才开始，所以 `Round` 等价于“玩家实际参与并完成的轮数”。
- 反过来说：玩家点选后即使完全不操作，8 小时后这一轮也会结算、`Round` 也会 +1；“参与”只要求开启本轮，不要求在轮内移动或战斗。
- 计时用的是游戏运行时间（`Timer_Controller` 在 `Update` 里用 `Time.unscaledDeltaTime` 累加），关闭游戏期间 8 小时计时不前进，也不会离线补算。

### 1.3 当前存档的直接证据

存档：`C:\Users\Administrator\AppData\LocalLow\SkyLight\MoNiShouYou\Save_1\Game_RecordData.Save`

该文件第一行是类型名 `YingLing.GameRecorder`，第二行起是 JSON。当前快照：

- `zhenYingZhenDou_Manager.Round = 0`
- `HasOpen = true`
- `OpenGameTime = 25552.81640625`（第一轮已进行了约 7.1 小时，还没到 8 小时）
- `PlayZhenYing = 2`（West，玩家加入了西方阵营）
- `Jifen_East = 10987`，`Jifen_West = 18326`
- 玩家 `Cha_ID = 1`：`GongXun = 5330`，位于地块 13（东方大本营）

这说明：**第一轮还在进行中，所以 `Round` 仍是 0；`Round` 统计的是“已结算完成的轮数”，不是“当前第几轮”。**

### 1.4 与轮数无关的部分

以下机制都不读 `Round`：

- 阵营 NPC 的随机分配（每轮重新随机，见 `Initail()`）
- 地块归属、地块积分、阵营总积分
- 角色灵力（HP）、阵营灵力池、灵力回复
- 战斗伤害、移动速度、行军加速
- 贡献度来源、排名、前三名奖励比例
- 胜负判定（`Winner`）
- NPC 强度成长

特别是 NPC 强度：`Character_NPC.cs` 第 331-339 行 `NPCChengZhang()` 是**每 60 秒游戏运行时间**调用一次 `NPCBianQiang()`，与 `Round` 无关。所以“后面几轮 NPC 更强”是因为游戏整体运行时间变长，而不是因为轮数增加。

### 1.5 另一个乘区：王者之翼（Wing 3）

`JieSuan()` 在轮数倍率之后还乘了一次翅膀加成：

- `ZhenYingZhenDou_Manager.cs` 第 210-215 行：

```csharp
int makeCount = GameRecorder.Mark_Manger.GetMakeCount(Mark_Enum.Wing_CB_3);
if (makeCount > 0)
{
    num = num * (100 + (long)makeCount * 5L) / 100;
    num = num.ToMax_1();
}
```

- 即每级王者之翼 +5% 元宝收益。
- 这个乘区在代码里**没有上限**（`makeCount` 只受 int 上限约束）。
- 王者之翼 3 的解锁条件是“在阵营活动中取得贡献第一名”：
  - `Wing_Setting_Data.cs` 第 74-93 行 `CheckEnoughToJieSuo()` 的 `Index == 3` 分支返回 `GetZhengDouData().First`
  - `ZhenYingZhenDou_Manager.cs` 第 198-201 行：玩家排名第 1 时 `First = true`
- 因此最终结算公式是：

```text
元宝 = 基础收益 × (10 + min(Round, 20)) / 10 × (100 + 5 × 王者之翼等级) / 100
```

---

## 2. 入口与开启条件

- 御灵师等级 100 级开启：
  - `UIPanel_MainFunction.cs` 第 166-172 行：点击阵营按钮时 `CheckLv(100)`
  - `TaskHelper.cs` 第 145-153 行：`Task_Detail.OpenZhenYing` 的判断是 `CurYuLingShiLv >= Params_1`
- 点击后打开 `UIPanel_ZhenYing_Main`（`UIPanel_MainFunction.cs` 第 170 行）。
- 主面板在 `HasOpen == false` 时显示 `UIBlockChooseZhenYing`（阵营选择），否则显示战场：
  - `UIPanel_ZhenYing_Main.cs` 第 59-73 行 `EnterThisPanel()`
  - 第 75-102 行 `Update()`
- 帮助文本：
  - `JianTi_CHN.txt` 第 1719 行 `UI_340`：御灵师 100 级、随机分阵营、资源点积分、每轮 +10%、最多 20 轮、8 小时结算、冷却 5 分钟、玩家不参与则不开启。
  - `JianTi_CHN.txt` 第 1728 行 `UI_349`：战斗/灵力/贡献/排名/加速等详细说明。
- 解锁提示：`JianTi_CHN.txt` 第 1233 行 `Talk_28`。

---

## 3. 一轮的完整状态机

核心字段在 `ZhenYingZhenDou_Manager.cs` 第 14-70 行：

- `CanOpen`：冷却结束，允许选择阵营
- `HasOpen`：本轮已由玩家开启
- `OpenCulTime`：开启前冷却计时
- `OpenGameTime`：本轮已运行时间
- `OpenTime_RemandTime = 300f`：冷却 5 分钟
- `Finish` / `Winner`：大本营被攻破后的标记；注意**大本营被攻破不会提前结束本轮**，本轮仍会跑满 8 小时，只是败方停止行动、败方地块变中立
- `Round`：已完成轮数
- `OpenCount`：声明了但全项目没有读取（死字段）

状态机（`AddTimer()`，第 224-293 行）：

```text
[冷却阶段] CanOpen == false
  OpenCulTime += Timer
  OpenCulTime >= 300 → CanOpen = true, OpenCulTime = 0

[等待玩家] CanOpen == true && HasOpen == false
  return（不推进任何战斗计时）

[战斗阶段] HasOpen == true
  OpenGameTime += Timer
  OpenGameTime > 28800 (8小时) → FinishGameEndTime()

[结算] FinishGameEndTime()
  JieSuan()          // 先结算（使用旧的 Round）
  HasOpen = false
  CanOpen = false
  InitailOK = false  // 下一轮重新随机分阵营
  Round++            // 结算后才 +1
  → 回到冷却阶段（300 秒）
```

补充：

- 新建存档时构造函数把 `OpenCulTime` 初始化为 `7195`（第 81 行），所以第一次 `AddTimer` 就直接满足 300 秒条件，首轮可以立刻开启；之后每轮正常冷却 5 分钟。
- `StartGame()` 不会重置 `Round`，只重置本轮状态：
  - 第 117-164 行：设置 `PlayZhenYing`、双方名单、13 个地块、灵力、积分计时、`Finish`、`Winner`、`HasOpen = true`、`ZhiHui`、`AutoZhiHui`。
- `StartGame()` 也没有重置 `First`；`First` 是永久标记，只用于解锁王者之翼 3。

---

## 4. 阵营分配：每轮重新随机

`ZhenYingZhenDou_Manager.cs` 第 90-115 行 `Initail()`：

```csharp
EastPlayer.Clear();
WestPlayer.Clear();
List<int> list = new List<int>(OverAllData_Controller.Cha_Dic.Keys);
list.Remove(1);                              // 玩家不参与随机
int num = UnityEngine.Random.Range(9, 12);   // 9、10、11（Unity 的 int 上界不含）
while (list.Count > 0)
{
    int id = list.GetRandomObjectInList();
    if (WestPlayer.Count < num) WestPlayer.Add(id);
    else EastPlayer.Add(id);
    list.Remove(id);
}
InitailOK = true;
```

- 全存档共 30 个角色：玩家 `Cha_ID = 1` + 29 个 NPC。
- 每轮开始时，29 个 NPC 随机分成两方：西方 9-11 个，东方 18-20 个。
- 玩家在 `StartGame()` 里被追加到自己选择的一方（第 120-127 行）。
- 所以实际人数是：
  - 玩家选西方：西方 10-12 人，东方 18-20 人
  - 玩家选东方：西方 9-11 人，东方 19-21 人
- 西方永远是少数方，东方永远是多数方。
- 这与 `UI_340` 第 2 条对应：“阵营玩家越多胜率越高，但奖励较少”。
  - 人数多 → 战力总量和占点能力强，但贡献度分母更大，排名和分润更难。
  - 人数少 → 更容易拿前三名和高贡献占比，但正面战力弱。
- `FinishGameEndTime()` 把 `InitailOK` 设为 false（第 173 行），下一轮打开选择面板时 `Initail()` 会重新随机。
  - 选择面板 `UIBlockChooseZhenYing.cs` 第 50-65 行 `RefreshData()` 会调用 `Initail()`。
- 选择面板显示的人数和战力是“NPC 的人数/战力”，此时玩家还没加入（`StartGame` 才把 `Cha_ID = 1` 加进去）。

### 4.1 一个需要留意的代码命名疑点

`UIBlockChooseZhenYing.cs` 第 34-41 行：

```csharp
Choose_East 按钮 → SetZhenYing(ZhenYing.East)
Choose_West 按钮 → SetZhenYing(ZhenYing.West)
```

但确认回调（第 83-92 行）是：

```csharp
SureZhenYing_East() → StartGame(ZhenYing.West)
SureZhenYing_West() → StartGame(ZhenYing.East)
```

即：**代码字面上“东方按钮”最终加入的是西方阵营，“西方按钮”最终加入的是东方阵营。**

这有两种可能：

1. 两个按钮在预制体上的绑定/摆放被交换了，代码名字只是没改；
2. 确实是一个回调接反的 bug。

仅凭反编译代码无法确定预制体绑定，需以游戏内实际点选结果为准（可用存档 `PlayZhenYing` 验证：1 = East，2 = West）。

---

## 5. 地图与资源点

### 5.1 13 个地块

`ZhenYingZhenDou_Manager` 构造函数第 77-80 行创建 13 个地块：

```csharp
for (int i = 1; i < 14; i++)
    diKuaiData_Recorders.Add(new DiKuaiData_Recorder(i));
```

- 地块 1：西方大本营（`StartGame` 第 138-141 行设为 West）
- 地块 13：东方大本营（第 142-145 行设为 East）
- 地块 2-12：初始 `ZhenYing.Default`（中立）
- 玩家出生点：
  - 西方出生在地块 1
  - 东方出生在地块 13
  - `PlayerZhengDouRecord.cs` 第 59-70 行 `ToInitalSeat()`

### 5.2 地块等级、积分、耐久

`DiKuaiSettingData.cs` 第 20-52 行：

- 等级 1：+2 积分/分钟，耐久 20,000
- 等级 2：+5 积分/分钟，耐久 50,000
- 等级 3：+9 积分/分钟，耐久 100,000
- 等级 4（大本营）：+15 积分/分钟，耐久 150,000

`DiKuaiData_Recorder.cs` 第 30-34 行：每轮初始化时地块归属设为指定阵营，耐久回满。

### 5.3 积分累计

`ZhenYingZhenDou_Manager.cs` 第 335-348 行 `AddJiFen()`：

- 每 60 秒执行一次（`AddTimer` 第 244-249 行）。
- 遍历 13 个地块，按归属把 `GetFenShu()` 加到 `Jifen_East` 或 `Jifen_West`。
- 中立地块不加分。
- 两个积分在 `JieSuan()` 第 217 行清零。

所以阵营总积分 = 本轮各阵营控制地块的“积分/分钟 × 控制分钟数”的累计。

### 5.4 邻接与可达

- 地块配置 `DiKuaiSettingData.neighborIndex` 是每块地的邻接表，配置本体是 Unity 序列化资产 `DiKuaiConfigData`（`DiKuaiConfigData.cs`），不在 StreamingAssets 的 JSON 里。
- `GetNeighbor()`（第 549-572 行）收集“己方所有地块的相邻非己方地块”，并按 `Level` 升序排序（`OrderByMax` 在 List 版本里实际是升序）。
- `GetAllCanMove()`（第 574-601 行）返回“己方地块 + 相邻地块”，同样按 Level 升序。
- 因此：
  - 玩家只能移动到己方地块或与己方相邻的地块（UI 显示“不可到达”）。
  - AI 选目标时优先选等级最低的相邻地块（`neighbor[0]`），也就是优先打一级资源点。
- 移动时间只由“列差”决定：
  - `PlayerZhengDouRecord.cs` 第 194-220 行 `GetTimeRemand()`
  - `|Col差|` 最小按 1 算，每列 30 秒；同列不同行也要 30 秒。

---

## 6. 角色灵力（HP）与阵营灵力池

### 6.1 角色灵力上限

`PlayerZhengDouRecord.cs` 第 39 行：

```csharp
public int Max_HP => NPC.GetZhanLi_ZhenYing_HP(NPC.GetZhanLi());
```

`Character_NPC.cs` 第 411-453 行 `GetZhanLi_ZhenYing_HP(BigInteger zhanLi)`：

- `战力 < 2000 万`：100
- `2000 万 - 1 亿`：100 → 500（线性）
- `1 亿 - 10 亿`：500 → 1000（线性）
- `> 10 亿`：按数量级分段，每十倍战力增加 500 上限，段内线性
- 玩家 `Cha_ID == 1` 额外：
  - `num11 *= 2`（200% 灵力上限，与 `UI_349` 第 1 条一致）
  - 王者之翼 3：`num11 *= (100 + min(翼等级, 100) * 5) / 100`，最多 +500%
- 该属性是“每次访问都重新计算”的属性，所以英灵/战力在轮内变化会实时改变 `Max_HP`。

### 6.2 阵营灵力池

- `ZhenYingZhenDou_Manager` 第 46 行：`public const int MaxLingli = 600000;`（该常量本身没被使用，代码里用字面量 600000）
- `StartGame()` 第 154 行：双方灵力池都重置为 600000。
- `AddTimer()` 第 250-270 行，每秒（`RecoveryCulTime > 1`）：
  - 双方各 +1 灵力（= 60/分钟，与 `UI_349` 的“每分钟恢复60点”一致）
  - 玩家所在阵营额外 +4 灵力（合计 +5/秒 = 500%，与 `UI_349` 的“玩家所在阵营享受500%恢复速度”一致）
- `AddZhenYingLingLi()` 第 495-513 行：超过 600000 时截断到 600000。

### 6.3 大本营回复

`PlayerZhengDouRecord.cs` 第 228-267 行 `Recovry()`：

- 只在本方大本营（西方地块 1 / 东方地块 13）且 `Idle` 时执行。
- 每个 `Idle` tick 把缺失的 `Max_HP - Cur_HP` 直接从阵营灵力池扣除并回满：
  - 1 点角色灵力 = 1 点阵营灵力
  - 灵力池不够时：
    - 玩家：能回多少回多少
    - NPC：灵力不够就不回
- 因为 `AddTimer` 是 0.2 秒一次，所以只要池子足够，角色回到大本营会在第一个 tick 直接回满，不是“每秒回一点”。

### 6.4 元宝补充灵力

`UIBlockZhenYingBuChongLingLi.cs` 第 60-119 行：

- 只能在自己的大本营补充。
- 消耗元宝（PropID 95）：
  - 1 元宝 = 10 阵营灵力 + 1 贡献度
- 灵力池上限 600000，达到上限后不能补充（`UI_360`）。
- 这是玩家主动把元宝转换成“灵力 + 贡献”的手段，直接影响排名和结算分润。

---

## 7. 战斗、移动、指挥

### 7.1 Tick 与伤害

- `Timer_Controller.cs` 第 14-35 行：每 0.2 秒调用一次 `GameRecorder.AddTimer()`，进而 `ZhenYingZhenDou_Manager.AddTimer()`。
- `PlayerZhengDouRecord.AddTimer()` 每次调用结算一次战斗/移动，伤害是固定值，不随 tick 长度缩放。

### 7.2 同格战斗

`PlayerZhengDouRecord.cs` 第 96-110 行：

- `Idle` 且同格有敌对角色（`GetEnemyInSeat`，HP > 0）时，随机选一个敌人。
- 比较的是 `Max_HP`（上限，不是当前 HP）：
  - 敌人 `Max_HP > 自己`：敌人受到 4，自己受到 2
  - 否则：敌人受到 2，自己受到 4
- 死亡（HP ≤ 0）：
  - `BeDamage()` 第 269-286 行：击杀者 +10 贡献度
  - 玩家击杀时弹“击破敌军”（`UI_366`）
  - 死亡者 `Dead()` 第 222-226 行：回出生大本营，`Recovry()` 回血
- `UI_349` 说“若角色灵力大于敌人灵力，则敌人会被造成双倍伤害”，代码实际比较的是 `Max_HP`，伤害是固定的 4/2，不是按当前 HP 计算。

### 7.3 攻击地块

`PlayerZhengDouRecord.cs` 第 111-125 行：

- `Idle` 且脚下地块不属于自己阵营时，每个 tick 对地块造成伤害：
  - 玩家：如果地块 `MaxHP <= 玩家 Max_HP`，伤害 20；否则 2
  - NPC：固定 2
- 攻击者每个 tick 自己掉 1 HP（`BeDamage(1, null)`），所以长时间打据点会被消耗。
- 地块 HP 归零：
  - `DiKuaiData_Recorder.cs` 第 36-53 行 `BeAttack()`
  - 地块耐久回满、归属改为攻击者阵营
  - 攻击者 +100 贡献度
  - 玩家击破时弹“击破据点”（`UI_367`）
  - 立即检查大本营是否被攻破

### 7.4 移动

- `SetMove()` 第 148-176 行：
  - HP 为 0 不能移动，先 `Dead()`
  - NPC 在出生点且 HP < `Max_HP / 3` 时不会离开
  - 玩家在出生点且 HP < `Max_HP / 2` 时不会自动离开
- 移动中 `UseTime += timer`，到达后 `Cha_Cur_Seat = TargetSeat`、状态回 `Idle`（第 136-144 行）。
- 王者之翼 3 的移动加速：
  - `GetTimeRemand()` 第 202-218 行
  - `num = num * 100 / (100 + min(翼等级 * 2, 500))`，最低 5 秒
- 行军加速：
  - `UIBlockShowZiYuan.cs` 第 262-276 行：剩余时间 < 10 秒不能加速；消耗 10 元宝
  - `PlayerZhengDouRecord.cs` 第 288-291 行 `JiaSu()`：剩余时间减半，所以最低 5 秒
- 移动途中不能改目的地：UI 在 `Moving` 状态只显示倒计时/加速，不显示“前往”按钮。

### 7.5 自动行动与指挥

- `PlayerSettingData.AutoZhenYing`（`PlayerSettingData.cs` 第 75 行）：玩家单位的“自动行动”开关。
  - 生效位置是 `PlayerZhengDouRecord.cs` 第 126-133 行：只有在“脚下是自己阵营地块且没有敌人”的分支里，才会走向阵营目标格。
  - 关闭时，玩家单位停在己方地块上不动；攻击地块（站在敌方地块）和同格战斗仍然自动进行，不受该开关影响。
  - 手动移动（点击“前往”）传的是 `Auto: false`（`UIBlockShowZiYuan.cs` 第 258 行），因此不受“出生点 HP < 50% 不出发”的限制。
- 指挥权：
  - 道具 PropID 154（号令之旗），`JianTi_CHN.txt` 第 507 行 `Prop_Des_154`
  - `UIBlockShowZiYuan.cs` 第 325-350 行：没有指挥权时消耗 1 个号令之旗取得指挥权；之后点击地块可直接设置目标
  - `ZhiHui` 每轮 `StartGame()` 重置为 false（第 162 行）
  - `AutoZhiHui`（自动指挥）开关：开启后即使有指挥权，也由 AI 自动选目标（`CheckTarget()` 第 366/408 行）

### 7.6 AI 选目标

`CheckTarget()` 第 350-436 行：

- 目标格失效/已被己方占领时，重新选相邻地块（按等级升序，优先低等级）。
- 目标格是敌方地块时：
  - 如果敌方多个单位在打己方某个地块（`GetAttacker` 数量 > 1），会转去该地块防守。
  - 否则保持相邻的敌方目标。
- 玩家有指挥权且未开自动指挥时，玩家阵营的目标不被 AI 改写。

---

## 8. 贡献度（GongXun）来源

`PlayerZhengDouRecord.GongXun`（第 35 行）是本轮个人贡献度，`StartGame()` 时清零（`Initail()` 第 51-57 行）。

来源：

1. 击败敌人：+10（`BeDamage()` 第 269-286 行）
2. 攻陷据点：+100（`DiKuaiData_Recorder.BeAttack()` 第 36-53 行）
3. 补充灵力：1 元宝 = +1 贡献（`UIBlockZhenYingBuChongLingLi.cs` 第 105-119 行）
4. NPC 克金（`ZhenYingZhenDou_Manager.cs` 第 295-319 行 `PlayerKeJin()`）：
   - 每 250 秒执行一次（`PlayerKeJinCulTime > 250`，第 271-280 行）
   - 只对 NPC 生效（`Cha_ID == 1` 跳过）
   - 条件：本方灵力池可恢复量 > 20（即池子没满）
   - 触发概率：`4 + NPC.GetKeJinDu() / 9` %，即 4%-15%
   - 贡献增量：`Random.Range(20, min(可恢复量/10, 150))`
   - 同时给本方灵力池加 `贡献增量 × 10` 灵力
   - `GetKeJinDu()` 在 `Character_NPC.cs` 第 341-348 行，每个 NPC 随机 2-100，持久化

排名：

- `GetPaiMing()` 第 704-709 行：只取自己阵营成员，按 `GongXun` 降序（`OrderByMin` 在 List 版本里实际是降序）
- `GetPlayerPaiMing()` 第 666-677 行：玩家在自己阵营中的名次
- 第 1 名会永久把 `First` 设为 true（`JieSuan()` 第 198-201 行），用于解锁王者之翼 3。

---

## 9. 结算公式（逐行拆解）

`ZhenYingZhenDou_Manager.cs` 第 181-222 行 `JieSuan()`：

```csharp
long num = 0L;
int playerPaiMing = GetPlayerPaiMing();                       // 自己阵营内的名次
long num2 = (PlayZhenYing == ZhenYing.East)
    ? Jifen_East : Jifen_West;                                 // 本轮己方阵营总积分

switch (playerPaiMing)
{
    case 1: num = num2 * 25 / 100; break;                      // 第1名：总积分25%
    case 2: num = num2 * 15 / 100; break;                      // 第2名：总积分15%
    case 3: num = num2 * 10 / 100; break;                      // 第3名：总积分10%
}

if (playerPaiMing == 1) First = true;                          // 王者之翼3解锁条件

num2 /= 2;                                                     // 剩余50%按贡献度分润
float playerJiFenPercent = GetPlayerJiFenPercent();            // 个人贡献 / 全阵营贡献
num += (long)((float)num2 * playerJiFenPercent);

if (Round > 20) Round = 20;                                    // 轮数倍率封顶20
num = num * (10 + Round) / 10;                                 // 1.0 ~ 3.0 倍

int makeCount = Mark_Manger.GetMakeCount(Mark_Enum.Wing_CB_3);
if (makeCount > 0)
{
    num = num * (100 + (long)makeCount * 5L) / 100;            // 王者之翼每级+5%
    num = num.ToMax_1();
}

YouJianManager.AddJingJiBattleRecord(
    new YouJianData_Record(7, 10, playerPaiMing, new PropRecorder(95, num)));
Jifen_East = (Jifen_West = 0L);                                // 积分清零

if (playerPaiMing == 1) ACUnLockSteam.UnlockAchievement("AC25");
```

### 9.1 公式说明

```text
基础收益 = 己方阵营总积分 × 名次比例（25% / 15% / 10% / 0）
         + 己方阵营总积分 ÷ 2 × 个人贡献占全阵营贡献的比例
最终元宝 = 基础收益 × (10 + min(Round, 20)) / 10
         × (100 + 5 × 王者之翼等级) / 100
```

要点：

- 名次比例和分润都只用**自己阵营**的 `Jifen`。
- 第 4 名及以后没有名次奖励，只剩 50% 积分的贡献分润。
- `playerJiFenPercent = 玩家 GongXun / 己方阵营所有成员 GongXun 之和`；如果分母为 0，分母按 1 处理。
- 结算时 `Winner` 完全不参与：**阵营胜负本身不发额外元宝**。胜负的唯一实际价值是：
  - 攻破对方大本营后，对方角色停止行动、对方地块变中立；
  - 本方可以继续控制地块、继续累计 `Jifen` 到 8 小时结束。
- 邮件：
  - 名称 ID 7 = `YouJian_Name_7`“阵营结算”（`JianTi_CHN.txt` 第 108 行）
  - 内容 ID 10 = `YouJian_Des_10`（第 125 行），参数是玩家名次
  - 附件 PropID 95 = 元宝（`Prop_Name_95` 第 369 行）
- `Round` 在 `JieSuan()` 之后才 +1（`FinishGameEndTime()` 第 177 行），所以第一次结算用的是 `Round = 0`。
- `First` 一旦为 true 永久保留，不会在新轮次重置。
- `Mark_Enum` 枚举序号：`Wing_CB_1 = 68`、`Wing_CB_2 = 69`、`Wing_CB_3 = 70`、`Wing_CB_4 = 71`（`Mark_Enum.cs` 第 8-79 行从 0 开始计数）。
  - 当前存档 `Mark_Enum 70` 的 `Count = 0`，`wingManager.wingRecords` 为空，`First = false`，即王者之翼 3 尚未解锁。

### 9.2 用当前存档做一个示例

当前快照（未结算）：

- 玩家在西方阵营，`Jifen_West = 18326`
- 玩家 `GongXun = 5330`，西方阵营贡献总和 = 18399（东方为 21744，不参与西方结算）
- 名次 = 1
- `Round = 0`
- 王者之翼 3 未解锁（`Mark_Enum 70` 的 `Count = 0`）

如果按当前积分立刻结算：

```text
名次奖励 = 18326 × 25% = 4581
分润     = (18326 ÷ 2) × (5330 / 18399) ≈ 9163 × 0.28969 ≈ 2653
基础收益 = 4581 + 2653 = 7234
轮数倍率 = (10 + 0) / 10 = 1.0
最终元宝 = 7234
```

实际结算时 `Jifen_West` 还会继续增长（当前 `OpenGameTime` 离 8 小时还有约 54 分钟），所以最终会高于这个示例值。

---

## 10. 存档验证方法

存档路径：

```text
C:\Users\Administrator\AppData\LocalLow\SkyLight\MoNiShouYou\Save_1\Game_RecordData.Save
```

格式：第一行是 `YingLing.GameRecorder`，第二行是 JSON。关键字段都在 `zhenYingZhenDou_Manager` 下：

- `Round`：已完成轮数（结算后才 +1）
- `PlayZhenYing`：1 = East，2 = West
- `HasOpen`：本轮是否已开启
- `CanOpen`：冷却是否结束
- `OpenGameTime`：本轮已运行秒数（28800 = 8 小时）
- `Jifen_East` / `Jifen_West`：本轮双方累计积分
- `EastPlayer` / `WestPlayer`：双方成员 ID（包含玩家 1）
- `EastLingLi` / `WestLingli`：阵营灵力池
- `playerZhengDouRecords`：每个角色的位置、HP、贡献度
- `diKuaiData_Recorders`：13 个地块的耐久与归属（1 = East，2 = West）

验证“轮数与玩家参与”的最直接方法：

1. 开始一轮前记录 `Round` 和 `HasOpen`。
2. 不点选阵营，让游戏运行一段时间：`Round` 不变，`OpenGameTime` 不增长。
3. 点选阵营后记录：`HasOpen = true`，`OpenGameTime` 开始增长。
4. 8 小时后：`Round` +1，`Jifen_*` 清零，邮件收到“阵营结算”。

---

## 11. 代码索引

- 阵营核心：
  - `YingLing.KeJinSystem/ZhenYingZhenDou_Manager.cs`
    - 字段 14-70
    - 构造 72-88
    - `Initail()` 90-115
    - `StartGame()` 117-164
    - `FinishGameEndTime()` 166-179
    - `JieSuan()` 181-222
    - `AddTimer()` 224-293
    - `PlayerKeJin()` 295-319
    - `AddJiFen()` 335-348
    - `CheckTarget()` 350-436
    - `CheckDaBenYing()` 456-472
    - `EndBattle()` 474-493
    - `AddZhenYingLingLi()` 495-513
    - `GetNeighbor()` 549-572
    - `GetAllCanMove()` 574-601
    - `GetPlayerPaiMing()` 666-677
    - `GetPlayerJiFenPercent()` 679-702
    - `GetPaiMing()` 704-709
  - `YingLing.KeJinSystem/PlayerZhengDouRecord.cs`
    - `Max_HP` 39
    - `Initail()` 51-57
    - `ToInitalSeat()` 59-70
    - `AddTimer()` 81-146
    - `SetMove()` 148-176
    - `GetTimeRemand()` 194-220
    - `Dead()` 222-226
    - `Recovry()` 228-267
    - `BeDamage()` 269-286
    - `JiaSu()` 288-291
  - `YingLing.KeJinSystem/DiKuaiData_Recorder.cs` 30-53
  - `YingLing.KeJinSystem/DiKuaiSettingData.cs` 20-52
  - `YingLing.KeJinSystem/ZhenYing.cs`（枚举：Default=0, East=1, West=2）
- 角色灵力：
  - `YingLing.CharacterSystem/Character_NPC.cs`
    - `GetZhanLi_ZhenYing_HP()` 411-453
    - `GetKeJinDu()` 341-348
    - `NPCChengZhang()` 331-339
- 计时：
  - `YingLing.CharacterSystem/Timer_Controller.cs` 14-35
  - `YingLing/GameRecorder.cs` 第 523 行 `GetZhengDouData().AddTimer(Timer)`
- UI：
  - `YingLing.UI/UIBlockChooseZhenYing.cs` 31-98
  - `YingLing.UI/UIPanel_ZhenYing_Main.cs` 59-102
  - `YingLing.UI/UIBlockShowZiYuan.cs` 250-350
  - `YingLing.UI/UIBlockZhenYingBuChongLingLi.cs` 60-119
  - `YingLing.UI/UIFrame_Location.cs` 39-67
  - `YingLing.UI/UIPanel_MainFunction.cs` 166-172
- 翅膀：
  - `YingLing.KeJinSystem/Wing_Setting_Data.cs` 47-60、74-93
  - `YingLing.KeJinSystem/WingRecord.cs` 28-44
- 文本：
  - `JianTi_CHN.txt` 第 125 行 `YouJian_Des_10`（阵营结算邮件）
  - 第 1719 行 `UI_340`（阵营主帮助）
  - 第 1728 行 `UI_349`（阵营详细帮助）
  - 第 1986/1991/2002 行（王者之翼 3）

---

## 12. 文案与代码不一致、死代码

### 12.1 `UI_349` 写“每轮活动持续10小时”

- 实际代码：`OpenGameTime > 28800f`（8 小时，`ZhenYingZhenDou_Manager.cs` 第 242 行）
- `UI_340` 第 7 条写的也是 8 小时
- 结论：以代码为准，一轮是 8 小时游戏运行时间；`UI_349` 的“10小时”是旧文案。

### 12.2 `UI_349` 的“灵力大于敌人则敌人双倍伤害”

- 实际代码比较的是 `Max_HP`（上限），不是当前 `Cur_HP`
- 伤害是固定 4/2，不是“双倍当前伤害”
- 结论：以代码为准。

### 12.3 `Winner` 不参与结算

- `Winner` 只在 `CheckZhenYingXingDong()` 第 326-333 行用于停止败方行动。
- `JieSuan()` 完全没有读取 `Winner`。
- 结论：胜负没有直接元宝奖励，只通过“控制地块的积分累计”间接影响收益。

### 12.4 死字段/死逻辑

- `OpenCount`：只在第 26 行声明，全项目无读取。
- `MaxLingli` 常量：只在第 46 行声明，代码里用字面量 600000。
- `AllOver` / `CheckAll()`：
  - `CheckAll()` 只在 `diKuaiData_Recorder.ZhenYingBelong != zhenYingBelong` 时把 `AllOver` 设为 false，从来没有设为 true；
  - 因此 `CheckAll()` 恒为 false，`PlayerZhengDouRecord.cs` 第 91 行的 `if (CheckAll()) break;` 是死逻辑。
- `OpenCulTime = 7195f` 初始值：让首轮立即可开，之后正常 5 分钟冷却；不是轮数相关逻辑。

### 12.5 选择阵营回调命名疑似接反

见第 4.1 节。代码字面上 `SureZhenYing_East()` 加入 West、`SureZhenYing_West()` 加入 East；是否真的是 UI 反向，需要看预制体绑定或游戏内实测（存档 `PlayZhenYing` 可直接验证最终加入了哪一方）。

---

## 13. 一句话总结

**阵营玩法与“玩家参加的轮数”确实有关系，但只体现在结算元宝倍率：每完成一轮，下一次结算倍率 +10%，`Round` 封顶 20，即最高 3 倍。轮数只有玩家点选阵营开启一轮、并运行满 8 小时后才会 +1；不点选阵营则永远不涨。阵营胜负、灵力、积分、NPC 强弱、排名等其他机制都不读轮数。**
