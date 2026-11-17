// types.ts — finalCal.ts 的全部类型定义(从 finalCal.ts 搬出,集中管理).
import type {MapID} from "./data.ts";

// 一组对比的"资源分配方法":每组自己写一个 allocate,告诉通用循环如何把御灵突破分到各属性.
export interface BreakAlloc {
  atkBreaks:   bigint;   // 投攻击的突破次数(→ baseAtk)
  atkPctExtra: bigint;   // 阵法带来的攻击%修正(天覆=+阵法等级%;鸟翔=去掉天覆面板15%)
  baseAtk:     bigint;   // 分配后基础攻
  capBreaks:   bigint;   // 投幸运到 5W 保掉落的突破次数
  dmgAddExtra: bigint;   // 阵法带来的伤害加成(鸟翔=速度差转增伤,封顶 int 上限)
  hit:         bigint;   // 分配后命中
  lucky:       bigint;   // 分配后幸运
  luckyBreaks: bigint;   // 余下投幸运(命中链)的突破次数
  pen:         bigint;   // 分配后穿透
  penBreaks:   bigint;   // 投穿透的突破次数(→ pen)
  speed:       bigint;   // 分配后速度
  speedBreaks: bigint;   // 投速度的突破次数
}
export interface CheckResult {
  atkBreaks:   bigint;   // 该组投到攻击的突破
  capBreaks:   bigint;   // 先把幸运堆到 5W 用掉的突破
  damage:      bigint;
  dmgAddExtra: bigint;   // 鸟翔阵速度差增伤
  hit:         bigint;
  hitOk:       boolean;
  killOk:      boolean;
  lucky:       bigint;
  luckyBreaks: bigint;   // 余下给幸运(命中链)的突破
  luckyFull:   boolean;  // 幸运是否已达 5W(掉落 100%)
  pass:        boolean;
  penBreaks:   bigint;   // 该组投到穿透的突破
  speed:       bigint;
  speedBreaks: bigint;   // 余下给速度的突破
  speedOk:     boolean;
}

// 抽奖状态:累计抽奖次数决定等级;每 8h 在两组奖池间选期望收益高的一组.
export interface ChoujiangState {
  count:     number;   // 累计已抽次数(决定等级阈值)
  draws:     number;   // 实际抽的次数
  pool3Hit:  number;   // 选组 A 的次数
  pool4Hit:  number;   // 选组 B 的次数
  ticketGet: number;   // 从掉落累计获得的抽奖券
}
export type DropMap = Record<string,number>;
export interface FinalPanel {
  atkPct:          bigint;
  baseAtk:         bigint;
  books:           number;
  breaks:          bigint;
  crit:            bigint;
  critDamage:      bigint;
  dmgAdd:          bigint;
  extraAtk:        number;
  extraAtkPct:     number;
  extraCrit:       number;
  extraCritDamage: number;
  extraDmgAdd:     number;
  extraHit:        number;
  extraPen:        number;
  extraSpeed:      number;
  forgeCrafts:     number;     // 受时间限制实际打造的装备件数
  forgeHantieUsed: number;     // 实际消耗的寒铁
  forgeLevel:      number;     // 打造结束时的炼器等级
  hitFlat:         bigint;
  lingwen:         number;
  lucky:           bigint;
  pen:             bigint;
  speed:           bigint;
  zhenLevel:       bigint;
}
export interface GroupPlan {
  allocate: (panel: FinalPanel,hero: Hero) => BreakAlloc; // 该组如何分配突破资源
  bucket:   (hit: bigint) => bigint;                      // 该英灵技能百分比乘区
  hero:     Hero;
  hitOk:    (hit: bigint) => boolean;                     // 该英灵命中是否达标
  name:     string;
  sec:      number;
  zhenfa:   "niaoxiang" | "tianfu";
}
export type Hero = "wukong" | "yunxiao";
export interface HourRecord {
  check: CheckResult;
  group: number;
  hero:  Hero;
  hour:  number;
  panel: FinalPanel;
  steps: HourStep[];
}

// judge=false 逐小时执行记录:一步一行,标明本小时该步骤的实际变化.
export interface HourStep {
  detail: string;   // 该步变化明细(增量/结果)
  fired:  boolean;  // 本小时是否触发(周期系统 8h/10h 未必每小时触发)
  step:   string;   // 步骤名(点卡/购物/抽奖/阵营/寻宝/地图掉落/扫荡/属性/判定)
}
export interface PreRouteResult {
  detail:  string[];
  layers:  Partial<Record<MapID,number>>;
  seconds: number;
}

// 购物/翅膀正反馈的逐轮状态(每个 8h 阵营/10h 寻宝结算点先购物再结算).
export interface ShopState {
  buyCangbaotu:  number;  // 累计买藏宝图个数
  buyMengpo:     number;  // 累计买孟婆汤组数
  buyWing:       number;  // 累计买翅膀材料组数(4种合计)
  cangbaotu:     number;  // 当前藏宝图印记
  events:        number;  // 发生的结算点数(8h/10h 去重)
  mengpo:        number;  // 当前孟婆汤持有
  spentShopping: number;  // 购物花掉元宝
  vipPool:       number;  // 投入 VIP 的元宝累计
  wing:          [number,number,number,number]; // 翅膀 1~4 当前等级
  wingYuanbao:   number;  // 翅膀1 挂机掉元宝累计
  yuanbao:       number;  // 当前可用于购物的元宝余额
  zhuan:         number;  // 当前转生次数
}

// 单个英灵的一次完整模拟状态.所有掉落累计在 drops,购物/翅膀/抽奖状态单独维护.
export interface SimSnap {
  check:          CheckResult;
  choujiang:      ChoujiangState;
  drops:          DropMap;
  hero:           Hero;
  hours:          number;                          // 达标小时(或终止小时)
  layers:         Partial<Record<MapID,number>>;    // 各图累计推层数
  name:           string;
  panel:          FinalPanel;
  reached:        boolean;                         // 是否达标跳出
  routeStep:      number;                          // 当前处在 PRE_ROUTE 第几步
  shop:           ShopState;
  sweepHours:     number;                          // 累计扫荡小时(春秋蝉+自动扫荡)
  ticketDrawn:    number;                          // 累计抽奖券消耗
  vip:            VipDetail;
  xunbaoRounds:   number;
  zhenyingRounds: number;
}
export interface VipDetail {
  hitCrit: number;         // 每2级 +1 命中/+1 暴击
  level:   number;
  remain:  number;
  spent:   number;
  yuanbao: number;
}
export interface XunbaoDetail {
  advCost:       number;         // 前9层走到大奖消耗
  block10:       number;         // 第10层开格数
  block9:        number;         // 第9层加开格数
  drops:         DropMap;        // 每轮掉落(不含元宝)
  layer1Cost:    number;
  layer2to9Cost: number;
  remain:        number;         // 进第10层前剩余体力
  totalTili:     number;         // 一轮可用体力
  used:          number;
  yuanbao:       number;         // 每轮元宝大奖
}
export interface ZhenyingDetail {
  baseReward:  number;
  rankReward:  number;
  roundMul:    number;
  score:       number;
  shareReward: number;
  yuanbao:     number;
}