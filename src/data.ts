// 18 项属性各自的「真百分比」增量(BattleData_Recorder.PercentAddition,GetFinal 乘 (100+百分比)/100).
// property.json 中 percent=0 的 5 项(攻/防/血/速/穿透)会真正走 PercentAddition；
// percent=1 的 13 项源码只加 Base_Value 固定值,此接口仍全部列出,便于统一返回结构.
export interface AllPercentProperties {
  atkPercent:            number;
  baoJiDamagePercent:    number;
  baoJiPercent:          number;
  baoJiResistPercent:    number;
  damageAdditionPercent: number;
  damageReducePercent:   number;
  defPercent:            number;
  fanJiPercent:          number;
  hpPercent:             number;
  ignoreDefPercent:      number;
  lianJiPercent:         number;
  luckyPercent:          number;
  mingZhongPercent:      number;
  recoveryPercent:       number;
  returnDamagePercent:   number;
  shanBiPercent:         number;
  speedPercent:          number;
  xiXiePercent:          number;
}

// 属性全集:PropertyTypeEnum.cs:6-26 的 18 个枚举值,按枚举顺序排列,一个都不省略.
// 低级(基础)RandomBaseProperty = 攻击/防御/生命/无视防御(Character_NPC.cs:52-58);
// 高级 RandomMaxProperty = 命中/闪避/暴击/抗暴/暴伤/连击/反击/伤害加成/伤害减免(Character_NPC.cs:60-71).
export interface AllProperties {
  atk:            number; // 0 ATK 攻击[低级]
  baoJi:          number; // 6 BaoJi 暴击[高级]
  baoJiDamage:    number; // 8 BaoJi_Damage 暴伤[高级]
  baoJiResist:    number; // 7 BaoJi_Resist 抗暴[高级]
  damageAddition: number; // 13 DamageAddition 伤害加成[高级]
  damageReduce:   number; // 14 DamageReduce 伤害减免[高级]
  def:            number; // 1 DEF 防御[低级]
  fanJi:          number; // 10 FanJi 反击[高级]
  hp:             number; // 2 HP 生命[低级]
  ignoreDef:      number; // 15 Igonore_DEF 无视防御/穿透[低级]
  lianJi:         number; // 9 LianJi 连击[高级]
  lucky:          number; // 17 Lucky 幸运
  mingZhong:      number; // 4 MingZhong 命中[高级]
  recovery:       number; // 11 Recovery 恢复
  returnDamage:   number; // 16 RetrunDamage 反弹伤害
  shanBi:         number; // 5 ShanBi 闪避[高级]
  speed:          number; // 3 Speed 速度
  xiXie:          number; // 12 XiXie 吸血
}
export type DropRow = readonly [propID: number,nums: number,percent: number];

// ============================== 2. 装备强化(强化石,3 维) ==============================
// Equip_Using.cs:40-54 GetStrengthRemand(消耗=3+2L,先按研究25 减免取整,再在 L≥1000000 时 ×5)
// :19-22 GetNextAddition(每级三维各+10+10L);×5 分支在 Strength(:28-37)与 ComputeStrengthAddByLevel(:86-98),不在 GetNextAddition
// 平均强化:角色 10 个装备槽都强化到同等级的合计(yingling-output.ts:2196 注释"10 槽平均强化").
export interface EquipStrengthenResult {
  average: SystemGain; // 平均强化:全部 slots 槽都升级一级的合计(= 单件 × 槽数)
  single:  SystemGain; // 强化单件:单槽装备升级一级的属性增量
}
export interface FarmModeResult {
  所得:   Record<string,number>;
  执行次数: number;
}
export interface FarmResult {
  主模式:  "怒气" | "普通攻击";
  怒气:   FarmModeResult;
  普通攻击: FarmModeResult;
}
export interface MapConfig {
  baseRound:     number;
  bossDrops:     readonly DropRow[];
  bossID:        number;
  effects:       readonly MapEffectRow[];
  jingYingDrops: readonly DropRow[];
  jingYingID:    number;
  louLouDrops:   readonly DropRow[];
  louLouID:      number;
}

// [触发波次, 效果类型, 参数1, 参数2]
export type MapEffectRow = readonly [round: number,effect: number,value: number,value1: number];

/**
 * data.ts — calzhanli.ts 的全部内联数据(映射表,固定口径常量,类型定义)
 * 口径来源(反编译):
 * - 波次构成:MapRecorder.GetEnemyCount(MapRecorder.cs:159-186),按 CurRound % 5 给 5 个站位
 * - 每只怪掉落:MapRecorder.GetDrop(MapRecorder.cs:208-240)；死亡时逐只结算(Battle_Character_Info.cs:281-285)
 * - 幸运/掉率:Drop_Recorder.GetTrueDrop(Drop_Recorder.cs:37-45),概率 = min(1000, round(概率‰×(100+加成)/100))
 * - 御力:MapRecorder.GetYuLiDrop(MapRecorder.cs:326-339)
 * - 研究额外掉落:MapRecorder.KeJiDrop(MapRecorder.cs:242-318)
 * - 扫荡:MapRecorder.AddTimer / CulSaoDangShouYi(MapRecorder.cs:66-97)
 * - VIP:VIPHelper.GetEffect(VIPHelper.cs:15-34)
 * - 万魂帆:Entry_WanHunFan(Entry_WanHunFan.cs:14)
 * - 百分比取整:ToolClass.Cul_Percent_ToInt(ToolClass.cs:107-117)
 * 已确认的初始数值:
 * - CurRound 从 1 起,每清一波 +1
 * - 一次执行 = 清一波 5 只；怒气 1.1 秒/波,普攻 0.85 秒/波(含完整周期,不再加 1 秒)
 * - 研究 64 个节点全部满级
 * - 幸运 = 50000 基础 + 研究 14 的 10 = 50010
 * - VIP 16；翅膀等级,万魂帆等级为参数,默认 0
 * - 5 图 × 3 品质的真实掉落表全部内联；幸运 50010 时所有条目都封顶 1000‰,必掉
 * calzhanli.ts 只 import 本文件,不再引入其他模块；本文件自身零 import.
 */
// #region 类型定义
export type MapID = 1 | 2 | 3 | 4 | 5;
export interface ResearchReduce {
  cost:           number; // 点满研究共需历史本纪
  hanTieReduce:   number; // 15 节衣缩食:寒铁消耗 -50%
  historyReduce:  number; // 55 俭以养德:历史本纪(研究/转职) -20%(-1%/级×20)
  lingWenReduce:  number; // 26 开源节流:灵纹(阵法) -50%
  poJingReduce:   number; // 34 化繁为简:破境石 -30%
  qiangHuaReduce: number; // 25 精打细算:强化石 -50%
  scrollReduce:   number; // 35 删繁就简:神通卷轴 -20%
  shopReduce:     number; // 44 价廉物美:商店买价 -30%(= 多买 Store_Sell_Price 折扣,已用于上面兑换表)
  wucaiReduce:    number; // 20 省吃俭用:五彩神石(器鼎) -50%
  yuLiReduce:     number; // 32 轻车熟路:御力(御灵师) -30%
}
export interface SweepResult {
  所得:   Record<string,number>;
  扫荡次数: number;
}

// 某养成系统"再升一级(L→L+1)"的统一结果.
export interface SystemGain {
  atk:            number; // [升级一次每维提升]升这一级,每一维属性增加多少
  costPerLevelUp: number; // [升级一次所需资源]从 level 升到 level+1 要花多少资源
  dims:           number; // 受益维数
  level:          number; // 当前等级(描述从该等级升到下一级的消耗/提升)
  peratk:         number; // 资源效率:每 1 单位资源换到每维多少属性 = atk / costPerLevelUp
  resource:       string; // 消耗的资源名
  system:         string; // 系统名
  totalGain:      number; // [升级一次全维合计提升]= atk × dims
}

// 9 个新增 tozhanli 方法的统一返回:18 项固定值 + 18 项百分比 + 过程量.
// 只统计「本次投入材料」带来的增量,初始态(研究全满等)只影响消耗/系数,不重复计入.
export interface ToZhanliResult extends AllPercentProperties,AllProperties {
  count:          number; // 升级/制造/突破次数
  finalLevel:     number; // 最终等级
  left:           number; // 剩余材料
  maxLevel:       number; // 该系统等级上限
  specialPercent: number; // 非面板属性的特殊百分比(圣兽 Property3 每 250 级 +1%)
  used:           number; // 消耗材料
  zhanliPercent:  number; // 战力百分比(神通 EntryEffect 类:Level×PinZhi,进 GetZhanLi 乘区)
}

// 18 项里走「真百分比」的 5 项(property.json 中 percent=0):
// ChangeValue 走 PercentAddition += 15(BattleData_Recorder.cs:50-59),GetFinal 再乘 (100+百分比)/100(:34).
// 其余 13 项在 property.json 里 percent=1,ChangeValue 直接 Base_Value += 15(:39-49),GetFinal 不乘百分比(:25-33),
// 即它们虽然 UI 显示 "15%",源码实际是每条 +15 固定值.
export const CI_TIAO_PERCENT_KEYS = ["atk","def","hp","ignoreDef","speed"] as const;
export type CiTiaoPercentKey = typeof CI_TIAO_PERCENT_KEYS[number];

// 单层返回:18 项固定值(与 AllProperties 同名同序)+ 5 项词条百分比 + 过程量,全部平铺,不嵌套.
// 固定值只加固定值(装备主属性 + 翅膀 + 高级词条),百分比只放百分比,两者不互相换算.
export interface HantieToZhanliResult extends AllProperties {
  atkPercent:       number; // 攻击词条百分比合计:7 槽 × 15 = 105(源码 PercentAddition,不是固定值)
  craftCount:       number; // 制造次数
  defPercent:       number; // 防御词条百分比合计:8 槽 × 15 = 120
  finalLianqiExp:   number; // 最终等级内剩余经验
  finalLianqiLevel: number; // 最终炼器等级
  finalQidingLevel: number; // 最终器鼎等级
  hantieLeft:       number; // 剩余寒铁
  hantieUsed:       number; // 消耗寒铁
  hpPercent:        number; // 生命词条百分比合计:8 槽 × 15 = 120
  ignoreDefPercent: number; // 穿透词条百分比合计:3 槽 × 15 = 45
  ronglianCount:    number; // 被熔炼的装备件数
  ronglianStones:   number; // 制造数 − 10 件(留身上)熔炼出的强化石总数
  speedPercent:     number; // 速度词条百分比合计:1 槽 × 15 = 15
  wucaiLeft:        number; // 剩余五彩神石
  wucaiUsed:        number; // 消耗五彩神石
}

// config/shentong.json 的 30 个神通节点:[id, 品阶, 最大等级, effectName, params1, params2]
export type ShenTongNode = readonly [
  id: number,
  pinzhi: number,
  maxLevel: number,
  effectName: number,
  params1: number,
  params2: number
];

// #endregion
// #region 初始数值与地图掉落表
// 一波 5 只怪,清完一波 CurRound + 1(MapRecorder.AddRound :414-433)
export const START_ROUND = 1;
export const SECONDS_PER_HOUR = 3600;
export const RAGE_SECONDS = 1.1;
export const NORMAL_SECONDS = 0.85;

// 幸运 = 基础 50000 + 研究 14 洪福齐天满级 10(keji.json id14:perLevel 1 × maxLevel 10)
export const BASE_LUCKY = 50000;
export const VIP_LEVEL = 16;

// VIPHelper.GetEffect:VIP_YuLiDrop = Lv×20,VIP_PercentAddCount = min(100, Lv/2),VIP_SaoDangSpeed = Lv×10
export const VIP_YU_LI_DROP = VIP_LEVEL * 20;
export const VIP_PERCENT_ADD_COUNT = Math.min(100,Math.trunc(VIP_LEVEL / 2));
export const VIP_SAO_DANG_SPEED = VIP_LEVEL * 10;

// 研究 64 节点全满；这里只列会影响掉落的节点,数值 = keji.json 的 perLevel × maxLevel
export const RESEARCH = {
  addDropYuLi:        100, // 31 满载而归:御力掉落 +1%/级 × 100
  allEnemyDrop:       100, // 39 遍地开花:全部敌人掉率 +1%/级 × 100
  bossDrop:           50,  // 40 鹤立鸡群:BOSS 掉率 +1%/级 × 50
  extalGuaiWuTuJian:  5,   // 62 枭蛇鬼怪:1 × 5
  extalHanTie:        10,  // 58 天降陨铁:perLevel 2 × 5
  extalLianQiBaoDian: 5,   // 63 积厚成器:1 × 5
  extalLiShiBenJi:    10,  // 57 偶有所得:perLevel 2 × 5
  extalMoney:         10,  // 56 意外收获:perLevel 2 × 5,源码再 ×2
  extalRandomJinNang: 5,   // 60 念兹在兹:1 × 5
  extalYuLingBaoDian: 5,   // 61 灵心慧性:1 × 5
  extalZhenWen:       10,  // 59 严阵以待:perLevel 2 × 5
  jingYingDrop:       50,  // 41 独树一帜:精英掉率 +1%/级 × 50
  louLouDrop:         50,  // 42 硕果累累:喽啰掉率 +1%/级 × 50
  lucky:              10,  // 14 洪福齐天:1 × 10
  saoDangShouYi:      50  // 43 事半功倍:扫荡收益 +1%/级 × 50
} as const;
export const LUCKY = BASE_LUCKY + RESEARCH.lucky;
export const SAO_DANG_REMAIN_TIMER = 48; // MapRecorder.cs:33

// MapEffectEnum(MapEffectEnum.cs:6-14)
export const MAP_EFFECT = {
  dropPercent:   3,
  finishGame:    5,
  getProp:       4,
  saoDangShouYi: 2,
  saoDangUnLoad: 1,
  unloadMap:     0
} as const;

// CurRound % 5 → 5 个站位的品质(1 喽啰 / 2 精英 / 3 BOSS),MapRecorder.cs:159-186
export const WAVE_COMPOSITION: Record<number,readonly number[]> = {
  0: [1,1,2,3,2], // 2 喽啰 + 2 精英 + 1 BOSS
  1: [1,1,1,1,1], // 5 喽啰
  2: [1,1,1,2,1], // 4 喽啰 + 1 精英
  3: [1,1,2,2,1], // 3 喽啰 + 2 精英
  4: [1,1,2,2,2] // 2 喽啰 + 3 精英
};

// 地图与掉落表(MapSettingData_Config,sharedassets0.assets 导出)
export const PROP_NAMES: Record<number,string> = {
  1:   "寒铁",
  10:  "抽奖卷",
  100: "檀木令",
  11:  "寒铁宝箱",
  12:  "强化宝箱",
  13:  "神石宝箱",
  14:  "神通宝箱",
  15:  "研究宝箱",
  16:  "灵纹宝箱",
  18:  "残念锦囊",
  19:  "自选残念锦囊",
  2:   "五彩神石",
  20:  "御力宝箱Lv1",
  21:  "御力宝箱Lv2",
  22:  "御力宝箱Lv3",
  3:   "破境石",
  30:  "宝石匣Lv1",
  4:   "御力",
  40:  "自选宝石匣Lv1",
  41:  "自选宝石匣Lv2",
  5:   "强化石",
  50:  "灵宝匣Lv1",
  6:   "神通卷轴",
  60:  "自选灵宝匣Lv1",
  61:  "自选灵宝匣Lv2",
  7:   "灵纹",
  70:  "套娃宝箱Lv1",
  8:   "灵晶",
  80:  "钱币",
  84:  "御灵宝典",
  85:  "三味真火",
  86:  "炼器宝典",
  87:  "御灵师经验",
  89:  "挑战令",
  9:   "历史本纪",
  90:  "悬赏令",
  901: "图鉴-掘金鼠",
  902: "图鉴-金山甲",
  903: "图鉴-山精",
  904: "图鉴-熔岩影卫",
  905: "图鉴-熔骨祭司",
  906: "图鉴-熔渊神尸",
  907: "图鉴-螃将军",
  908: "图鉴-鳄统领",
  909: "图鉴-沧溟蛟君",
  91:  "世界令",
  910: "图鉴-桃园众",
  911: "图鉴-桃花小妖",
  912: "图鉴-桃仙翁",
  913: "图鉴-天兵",
  914: "图鉴-雷鼓吏",
  915: "图鉴-镇狱明王",
  92:  "神速符",
  95:  "元宝"
};
export const MAPS: Record<number,MapConfig> = {
  1: {
    baseRound:     0,
    bossDrops:     [[1,10,64],[2,3,5],[5,3,5],[3,3,5],[40,2,5],[11,1,8],[12,1,8],[13,1,8],[85,1,7],[10,5,5],[86,1,4]],
    bossID:        3,
    effects:       [[50,1,1,0],[100,0,2,0],[200,4,11,10],[400,4,13,10],[600,4,12,10],[1000,3,30,0],[1250,2,30,0],[1500,4,30,10],[1750,4,40,10],[2000,4,80,1000]],
    jingYingDrops: [[1,3,1000],[1,5,32],[2,2,25],[5,2,25],[3,2,25],[40,1,2],[11,1,5],[12,1,5],[13,1,5],[10,3,5],[85,1,3]],
    jingYingID:    2,
    louLouDrops:   [[1,1,1000],[1,3,32],[2,1,15],[5,1,15],[3,1,15],[30,1,3],[11,1,3],[12,1,3],[13,1,3],[10,1,3],[85,1,2]],
    louLouID:      1
  },
  2: {
    baseRound:     100,
    bossDrops:     [[6,5,1000],[6,10,30],[18,3,14],[19,3,9],[19,4,5],[14,1,12],[100,1,12],[50,1,12],[60,1,12],[61,1,6],[10,5,8]],
    bossID:        6,
    effects:       [[50,1,1,0],[100,0,3,0],[200,4,14,10],[400,4,18,100],[600,4,19,30],[1000,3,30,0],[1250,2,30,0],[1500,4,50,20],[1750,4,60,10],[2000,4,80,2000]],
    jingYingDrops: [[6,3,1000],[6,5,30],[18,2,9],[19,2,6],[19,3,3],[14,1,5],[100,1,5],[50,1,5],[60,1,5],[61,1,3],[10,3,5]],
    jingYingID:    5,
    louLouDrops:   [[6,1,1000],[6,3,22],[18,1,6],[19,1,4],[19,2,2],[14,1,3],[100,1,3],[50,1,3],[60,1,3],[61,1,2],[10,1,3]],
    louLouID:      4
  },
  3: {
    baseRound:     200,
    bossDrops:     [[7,5,1000],[7,7,42],[7,10,15],[8,3,15],[8,4,8],[8,5,5],[16,1,8],[20,1,14],[21,1,12],[22,1,7],[10,5,12]],
    bossID:        9,
    effects:       [[50,1,1,0],[100,0,4,0],[200,4,16,10],[400,4,8,100],[600,4,10,25],[1000,3,30,0],[1250,2,30,0],[1500,4,8,300],[1750,4,10,50],[2000,4,80,3000]],
    jingYingDrops: [[7,3,1000],[7,5,27],[7,7,9],[8,2,9],[8,3,4],[8,4,3],[16,1,5],[20,1,8],[21,1,6],[22,1,4],[10,3,5]],
    jingYingID:    8,
    louLouDrops:   [[7,1,1000],[7,3,18],[7,5,6],[8,1,6],[8,2,3],[8,3,2],[16,1,3],[20,1,5],[21,1,4],[22,1,2],[10,1,3]],
    louLouID:      7
  },
  4: {
    baseRound:     300,
    bossDrops:     [[9,3,1000],[9,4,34],[9,5,14],[15,1,8],[70,1,8],[20,1,15],[21,1,8],[22,1,5],[10,5,8],[92,3,5]],
    bossID:        12,
    effects:       [[50,1,1,0],[100,4,15,10],[200,4,15,20],[600,3,30,10],[800,2,30,10],[1000,0,5,0],[1250,4,10,30],[1500,4,15,30],[1750,4,70,10],[2000,4,80,4000]],
    jingYingDrops: [[9,2,1000],[9,3,21],[9,4,9],[15,1,5],[70,1,5],[20,1,9],[21,1,6],[22,1,3],[10,3,5],[92,2,3]],
    jingYingID:    11,
    louLouDrops:   [[9,1,1000],[9,2,14],[9,3,6],[15,1,3],[70,1,3],[20,1,6],[21,1,4],[22,1,2],[10,1,3],[92,1,2]],
    louLouID:      10
  },
  5: {
    baseRound:     1500,
    bossDrops:     [[80,5,1000],[80,10,27],[19,3,5],[41,1,8],[61,1,8],[70,1,8],[89,1,6],[90,1,6],[91,1,6],[10,5,8],[84,1,3]],
    bossID:        15,
    effects:       [[1000,1,1,0],[2000,5,400,1000],[3000,5,600,1000],[4000,5,800,1000],[5000,5,1000,1000],[6000,5,1250,1000],[7000,5,1500,1000],[8000,5,1750,1000],[9000,5,2000,1000],[10000,5,2500,1000]],
    jingYingDrops: [[80,3,1000],[80,5,18],[80,7,8],[19,2,3],[40,1,5],[60,1,5],[70,1,5],[89,1,4],[90,1,4],[91,1,4],[10,3,5]],
    jingYingID:    14,
    louLouDrops:   [[80,1,1000],[80,3,12],[80,5,5],[19,1,3],[40,1,3],[60,1,3],[70,1,3],[89,1,2],[90,1,2],[91,1,2],[10,1,3]],
    louLouID:      13
  }
};

// #endregion
// #region 材料单价,研究与制造固定口径
// 每一个材料 消耗多少钱币(含 30% 研究减免,保留小数点,不取整)—— 直接写死在此处,
// 无需运行即可看数值;计算 = ValueCost × (100 - 30) / 100 = ValueCost × 0.7:
export const MATERIAL_COST_PER_UNIT: Record<string,number> = {
  三味真火: 1111.6,  // 1588×0.7
  五彩神石: 3.5,    // 5×0.7
  历史本纪: 1.4,    // 2×0.7
  寒铁:   0.7,    // 1×0.7
  强化石:  3.5,    // 5×0.7
  御灵宝典: 52.5,   // 75×0.7
  忘情水:  70,     // 100×0.7
  灵晶:   3.5,    // 5×0.7
  灵纹:   1.4,    // 2×0.7
  破境石:  3.5,    // 5×0.7
  神通卷轴: 1.4    // 2×0.7
};

// ============================== 研究(科技树,消耗 历史本纪) ==============================
// 研究是「节点表驱动」的元系统(yingling-output.ts RESEARCH_STEPS):点满后给各养成系统的[消耗减免]与[属性加成].
// 满研究共消耗 309,665 历史本纪(resource-allocation.ts:140).下面列出满级后各项[减免%]—— 即"研究的减免",
// 可用来把对应系统的 costPerLevelUp 打折(本文件其它养成函数目前未自动叠加减免,需要时按此表乘 (100-减免)/100).
export const RESEARCH_FULL_COST = 30_9665;

// ---- 制作装备 / 品质 常量(数值均来自反编译源码,集中列出便于核对) ----
export const MAKE_EQUIP_COST_CAP = 200_0000; // 升一次炼器消耗寒铁封顶

// ============================== 寒铁 → 战力(完整制造模拟,18 属性全量 + 词条百分比) ==============================
// 固定口径:研究全部点满(config/keji.json),初始炼器 Lv.1/经验 0,器鼎 Lv.1700,品质 15,10 槽各 1 件.
// 计算顺序:① 五彩神石把器鼎从 1700 继续往上顶 → 最终器鼎等级;
// ② 寒铁按源码逐级模拟制造 → 最终炼器等级 + 制造次数 + 熔炼强化石;
// ③ 10 件装备主属性按最终等级算;④ 翅膀加成按制造次数累计;
// ⑤ 每件装备固定带该槽全部 5 条词条(共 50 条):13 项固定值合并,5 项百分比单列.
// ---- 研究全满(固定值:config/keji.json 的 maxLevel × perLevel = 50) ----
export const RESEARCH_15_HANTIE_REDUCE = 50; // id15 节衣缩食:寒铁消耗 -1%/级×50(keji.json:183-193)
export const RESEARCH_16_EXP_ADD = 50; // id16 日积月累:炼器经验 +1%/级×50(keji.json:195-205)
export const RESEARCH_18_EQUIP_ADD = 50; // id18 精益求精:装备属性 +1%/级×50(keji.json:219-229)
export const RESEARCH_20_WUCAI_REDUCE = 50; // id20 省吃俭用:五彩神石 -1%/级×50(keji.json)
export const RESEARCH_24_RONGLIAN_ADD = 50; // id24 聚沙成塔:熔炼强化石产出 +1%/级×50(keji.json:291-301)
export const RESEARCH_25_STRENGTH_REDUCE = 50; // id25 精打细算:强化石消耗 -1%/级×50(keji.json:302-312)

// 研究22/23 是印记开关(>0 即生效):GetEqui_PropertyAddition 把 QiLu_Level / LianQiLevel 计进装备属性%(PropHelper.cs:424-438)
// ---- 固定口径 ----
export const LIANQI_START_LEVEL = 1;      // NPC_EquipManager.cs:36-41 构造函数 LianQiLevel = 1
export const LIANQI_START_EXP = 0;      // 同上,初始 LianQiExp = 0
export const QIDING_START_LEVEL = 1700;   // 器鼎默认等级(品质概率表到此级 100% 品质 15)
export const EQUIP_PINZHI = 15;     // 固定最高品质(config/equip-percent.json 最高档 pinzhi 15)
export const EQUIP_SLOT_COUNT = 10;     // EquipType.cs:6-18 共 10 个槽位
export const PERCENT_BASE = 100;    // 百分比基数

// ---- 装备主属性公式固定值(PropHelper.cs:395-405 GenerateEquip) ----
export const EQUIP_BASE = 30;   // (30 + 25×L + 6×品质×L) 基础值
export const EQUIP_PER_LEVEL = 25;   // 每级炼器 +25
export const EQUIP_PINZHI_PER_LEVEL = 6;    // 品质×炼器等级 ×6
export const EQUIP_PINZHI_FACTOR = 0.4;  // 品质系数 (0.4×品质 + 1)
export const EQUIP_RANDOM_MIN = 1;    // Random.Range(1f, 1.1f) 下限
export const EQUIP_RANDOM_MAX = 1.1;  // 上限(不含)
export const EQUIP_RANDOM_AVG = (EQUIP_RANDOM_MIN + EQUIP_RANDOM_MAX) / 2; // 随机期望 1.05

// ---- 经验 / 翅膀 / 器鼎公式固定值 ----
export const CRAFT_EXP_BASE = 2;   // PropHelper.cs:478-485 CulExp_Single = 2 + 炼器等级
export const WING_FLAT_BASE = 75;  // NPC_EquipManager.cs:119-126 翅膀固定值基数
export const WING_FLAT_PER_LEVEL = 25;  // 同上,翅膀每级 +25
export const WING_EXP_PER_LEVEL = 3;   // :145-149 翅膀每级给经验倍率 +3%(整行覆盖研究16)
export const QILU_COST_BASE = 10;  // lianqi.ts:72-76 / yingling-output.ts:2157 器鼎每档消耗基数
export const QILU_TIER_SIZE = 5;   // 每 5 级一档
export const QIDING_LEVEL_CAP = 21_4748_3645; // NPC_EquipManager.cs:155-166 等级上限

// ---- 分解(熔炼)→ 强化石固定值(GameRecorder.cs:386-407 GetRongLianEnding / PropHelper.cs:324-335 RongLianEuip) ----
export const RONGLIAN_LEVEL_DIVISOR = 5;   // 每件贡献 ⌊装备等级/5⌋ + 品质(装备等级 = 制造当时的炼器等级);强化石 PropID=5(config/names.json:7)

// 整批求和后一次性乘 (100+研究24)/100,只取整一次(Cul_Percent_ToInt,ToolClass.cs:113-117,正数等价于 Math.round)
// ---- 强化提升 / 消耗固定值(Equip_Using.cs:19-22,28-37,40-54,62-98,100-122,125-163) ----
export const STRENGTH_COST_BASE = 3;    // 每级消耗 3 + 2L 颗强化石
export const STRENGTH_COST_PER_LEVEL = 2;
export const STRENGTH_ADD_BASE = 10;   // 每级 HP/ATK/DEF 各 +(10 + 10L) 固定值(L 从 0 起算)
export const STRENGTH_ADD_PER_LEVEL = 10;
export const STRENGTH_HIGH_THRESHOLD = 100_0000; // L≥100 万时该级消耗与提升各 ×5
export const STRENGTH_HIGH_MULTIPLIER = 5;
export const STRENGTH_COST_CAP = 21_4748_3646; // 消耗上限(Equip_Using.cs:107,123)
export const STRENGTH_COST_MIN = 1;          // 批量路径下限 1(:79-82)

// 强化只加 HP/ATK/DEF 三条固定值,无穿透/速度/百分比(:159-161)
// 词条候选池:每槽固定 5 条(用户口径:每件装备默认都有该槽全部 5 条,不按品质/随机抽取).
// 来自 MayEquipPropertyDic(PropHelper.cs:69-148),按 EquipType.cs 的 0~9 顺序排列.
// 词条值固定 = 品质 15(PropHelper.cs:418 的 Params_2 = PinZhi, Bool_Value = true).
export const EQUIP_CI_TIAO_POOL: readonly (readonly (keyof AllProperties)[])[] = [
  ["atk","baoJi","baoJiDamage","damageAddition","ignoreDef"],  // 0 Weapon 武器
  ["def","hp","shanBi","baoJiResist","returnDamage"],          // 1 Cloth 衣服
  ["def","hp","shanBi","damageReduce","lucky"],                // 2 Cape 披风
  ["def","hp","mingZhong","baoJiResist","recovery"],           // 3 Belt 腰带
  ["atk","def","baoJiDamage","lianJi","damageAddition"],       // 4 HuWan 护腕
  ["atk","def","hp","mingZhong","fanJi"],                      // 5 XiangLian 项链
  ["atk","def","hp","mingZhong","lucky"],                      // 6 GuaZhui 挂坠
  ["atk","hp","xiXie","ignoreDef","lucky"],                    // 7 JieZhi 戒指
  ["atk","def","hp","speed","ignoreDef"],                      // 8 XieZi 鞋子
  ["atk","def","hp","baoJi","damageReduce"]                    // 9 HuFu 护符
];

// 9 个新增 tozhanli 方法构造全 0 返回值时用,避免每个方法重复铺 36 个 0.
export const EMPTY_PROPERTIES: AllProperties = {
  atk:            0,
  baoJi:          0,
  baoJiDamage:    0,
  baoJiResist:    0,
  damageAddition: 0,
  damageReduce:   0,
  def:            0,
  fanJi:          0,
  hp:             0,
  ignoreDef:      0,
  lianJi:         0,
  lucky:          0,
  mingZhong:      0,
  recovery:       0,
  returnDamage:   0,
  shanBi:         0,
  speed:          0,
  xiXie:          0
};
export const EMPTY_PERCENT_PROPERTIES: AllPercentProperties = {
  atkPercent:            0,
  baoJiDamagePercent:    0,
  baoJiPercent:          0,
  baoJiResistPercent:    0,
  damageAdditionPercent: 0,
  damageReducePercent:   0,
  defPercent:            0,
  fanJiPercent:          0,
  hpPercent:             0,
  ignoreDefPercent:      0,
  lianJiPercent:         0,
  luckyPercent:          0,
  mingZhongPercent:      0,
  recoveryPercent:       0,
  returnDamagePercent:   0,
  shanBiPercent:         0,
  speedPercent:          0,
  xiXiePercent:          0
};

// #endregion
// #region 新增 tozhanli 方法固定口径
// PropertyTypeEnum.cs:6-26 的 18 个枚举值 → AllProperties 字段名(神通/破境效果映射用)
export const PROPERTY_TO_KEY: Record<number,keyof AllProperties> = {
  0:  "atk",
  1:  "def",
  10: "fanJi",
  11: "recovery",
  12: "xiXie",
  13: "damageAddition",
  14: "damageReduce",
  15: "ignoreDef",
  16: "returnDamage",
  17: "lucky",
  2:  "hp",
  3:  "speed",
  4:  "mingZhong",
  5:  "shanBi",
  6:  "baoJi",
  7:  "baoJiResist",
  8:  "baoJiDamage",
  9:  "lianJi"
};

// ---- 神兵火炼(三味真火 85)/水炼(忘情水 81):ShenBingRecorder.cs:28-45,93-100 ----
// 每级消耗 min(1000000,(Cur_Lv+1)×10000)；GetEffectToAdd 置 Bool_Value=true,
// 但目标属性在 property.json 里 percent=1,ChangeValue 走 Base_Value += 1(固定值,UI 显示 "%" 只是文案).
export const SHEN_BING_FIRE_HIT_TRACKS = 8;    // Fire_Lian=命中 的 8 件神兵(yingling-output.ts:49)
export const SHEN_BING_WATER_DAMAGE_TRACKS = 2; // Water_Lian=伤害加成 2 件(:52)
export const SHEN_BING_WATER_CRIT_TRACKS = 6;   // Water_Lian=暴伤 6 件(:53)
export const SHEN_BING_COST_PER_LEVEL = 10000;
export const SHEN_BING_COST_CAP = 100_0000;
export const SHEN_BING_MAX_LV = 100; // 神兵解封后 TuPo 一次 MaxLv+=100(ShenBingRecorder.cs:85-91)

// 23 件神兵的炼化轨:逐条抄录 config/lingqi.json weapons[].fire / [].water,值即 PropertyTypeEnum.
// 脚本核对分布:fire 3=速度2,4=命中8,5=闪避2,6=暴击4,7=抗暴4,9=连击2,11=恢复1;
// water 5=闪避4,6=暴击3,7=抗暴1,8=暴伤6,10=反击2,11=恢复5,13=伤害加成2.
// 其中 fire4=8 件 / water13=2 件 / water8=6 件 与 DESIGN.md:52 的三组轨数逐条吻合.
export const SHEN_BING_FIRE_TRACKS: readonly number[] = [
  6,4,4,5,7,4,6,7,6,11,3,4,7,3,4,4,7,9,4,6,5,9,4
];
export const SHEN_BING_WATER_TRACKS: readonly number[] = [
  8,5,8,11,11,6,8,11,7,6,13,5,11,13,8,5,11,10,8,8,6,10,5
];

// 「想要的属性」默认只投命中与速度;火炼有 10 条对应轨,水炼一条都没有(故忘情水默认结果为 0).
export const DEFAULT_WANTED_PROPERTIES: readonly string[] = ["命中","速度"];

// 「想要的属性」中文名 → AllProperties 字段名;键名与 coin-to-zhanli.ts 的 FIELD_NAMES 中文名一致,
// 调用方可带 % 后缀(在 calzhanli.ts 统一去掉),暴伤 是 暴击伤害 的简称.
export const PROPERTY_NAME_TO_KEY: Readonly<Record<string,keyof AllProperties>> = {
  "攻击":     "atk",
  "暴击":     "baoJi",
  "暴击伤害": "baoJiDamage",
  "暴伤":     "baoJiDamage",
  "抗暴":     "baoJiResist",
  "伤害加成": "damageAddition",
  "伤害减免": "damageReduce",
  "防御":     "def",
  "反击":     "fanJi",
  "生命":     "hp",
  "穿透":     "ignoreDef",
  "连击":     "lianJi",
  "幸运":     "lucky",
  "命中":     "mingZhong",
  "恢复":     "recovery",
  "反弹伤害": "returnDamage",
  "闪避":     "shanBi",
  "速度":     "speed",
  "吸血":     "xiXie"
};

// ---- 转职强化(历史本纪 9):ZhuanZhiManager.cs:16-39,79-130 ----
// 研究全满后不再扣 309,665 研究消耗；GetStrengthRemand 直接 new PropRecorder(9,10+10L),源码无研究减免.
export const ZHUANZHI_START_LEVEL = 0;
export const ZHUANZHI_COST_BASE = 10;
export const ZHUANZHI_COST_PER_LEVEL = 10;
export const ZHUANZHI_ADD_BASE = 20;
export const ZHUANZHI_ADD_PER_LEVEL = 50;
export const ZHUANZHI_SPEED_PER_LEVEL = 1;
export const ZHUANZHI_LEVEL_CAP = 21_4748_3646; // :57,91

// ---- 御灵宝典(84) → 御灵师:GameRecorder.cs:632-669,697-711 / PropEffect_GetYuLingShiEXP.cs:23-32 ----
// ChanYuLi 把每本 Params_1=100 乘 (100+研究48)/100 = 200 御力；CulLevel_Up_Remand 源码无研究减免.
export const YULINGSHI_START_LEVEL = 1;
export const YULINGSHI_START_EXP = 0;
export const BOOK_YULI_BASE = 100;
export const RESEARCH_48_BOOK_EXP_ADD = 100;
export const YULING_TUPO_COST = 500; // 每 10 级一次突破,每次 500 个 prop81(视为已有,不扣本方法材料)
export const YULING_LEVEL_CAP = 21_4748_3646;

// ---- 灵晶(8) → 解锁阵法 + 圣兽3(青龙):ZhenFaRecorder.cs:29-32 / ShengShou_Record.cs:33-57,65-95 ----
// 源码 GetJieSuoRemand = 100 个/阵法,9 个阵法共 900；青龙 Property1/Property2 = 攻击/防御,
// Property3 每 250 级 +1%(Strength 的 (CurStrength+249)%250==0 条件,首次升到 1 级即触发).
export const ZHENFA_UNLOCK_COST = 100;
export const ZHENFA_UNLOCK_COUNT = 9;
export const SHENG_SHOU_START_LEVEL = 0;
export const SHENG_SHOU_COST_BASE = 10;
export const SHENG_SHOU_COST_PER_LEVEL = 10;
export const SHENG_SHOU_COST_CAP = 50000;
export const SHENG_SHOU_ADD_BASE = 20;
export const SHENG_SHOU_ADD_PER_LEVEL = 50;
export const SHENG_SHOU_SPECIAL_CYCLE = 250;
export const SHENG_SHOU_MAX_ROUND = 10000; // 通天塔 1 万层(CheckMaxOK / CulMaxStrengthTimes 的 maxRound)
export const SHENG_SHOU_LEVEL_CAP = 21_4748_3646;

// ---- 灵纹(7) → 阵法:ZhenFaRecorder.cs:22-40,82-91,93-129 ----
// 初始 Level=1,四维 Base_Value 各 500(属初始态,不计入增量)；研究 26 满 -50%.
export const ZHENFA_START_LEVEL = 1;
export const ZHENFA_BASE_PROPERTY = 500;
export const ZHENFA_COST_PER_LEVEL = 20;
export const RESEARCH_26_LINGWEN_REDUCE = 50;
export const ZHENFA_ADD_BASE = 200;
export const ZHENFA_ADD_PER_LEVEL = 35;
export const ZHENFA_LEVEL_CAP = 21_4748_3646;

// ---- 破境石(3) → 英灵等级上限:Character_YingLing.cs:294-309,352-367 ----
// Max_Level 初始 500,Star 初始 0；GetLevelUpStarEffect 的四维用 value:true → PercentAddition +5%,
// 速度 +1 固定值,LevelUpStartEffect[Star/5]=BaoJi +1 固定值；AddMaxLevel 不自增 Star.
export const POJING_START_MAX_LEVEL = 500;
export const POJING_START_STAR = 0;
export const POJING_COST_PER_100_LEVEL = 10;
export const RESEARCH_34_POJING_REDUCE = 30;
export const POJING_MAX_LEVEL_STEP = 500;
export const POJING_STAR_DIVISOR = 5;
export const POJING_STAR_PCT_CAP = 20;
export const POJING_STAR_PCT_PER_STEP = 5;
export const POJING_YINGLING_COUNT = 1; // 单个英灵的独立突破

// ---- 神通卷轴(6) → 30 个神通:ShenTong.cs:48-55,95-137 / Character_YingLing.cs:401-411,462-466 ----
// RemandProp 按品阶 20/50/150/500/1000/1500,再乘研究35 满 -20%；LearnShenTong 每级给 effectRecoders.Params_2 固定值,
// EntryEffect(effectName=1)类不进面板属性,进 GetZhanLi 的 Level×PinZhi 战力乘区.
export const SHEN_TONG_COST_BY_PINZHI: Record<number,number> = {1: 20,2: 50,3: 150,4: 500,5: 1000,6: 1500};
export const RESEARCH_35_SHENTONG_REDUCE = 20;
export const SHEN_TONG_PROPERTY_EFFECT = 0;
export const SHEN_TONG_ENTRY_EFFECT = 1;
export const SHEN_TONG_NODES: readonly ShenTongNode[] = [
  [1,1,10,0,2,2],[2,1,10,0,0,2],[3,1,10,0,1,2],[4,1,10,0,15,2],[5,1,10,0,8,2],[6,1,10,0,3,1],
  [7,2,10,0,9,1],[8,2,10,0,10,1],[9,2,10,0,4,1],[10,2,10,0,5,2],[11,2,10,0,6,1],[12,2,10,0,7,3],
  [13,3,10,1,35,1],[14,3,10,1,36,1],[15,3,10,1,37,1],[16,3,10,1,38,1],[17,3,10,0,8,5],[18,3,10,0,3,5],
  [19,4,5,1,39,1],[20,4,5,1,40,1],[21,4,5,1,41,1],[22,4,5,1,42,1],[23,4,5,1,43,1],[24,4,5,1,44,1],
  [25,5,3,0,13,5],[26,5,3,0,14,5],[27,5,1,1,45,1],[28,5,1,1,46,1],[29,5,1,1,47,1],[30,5,1,0,3,10]
];

// #endregion