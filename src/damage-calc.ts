/**
 * damage-calc.ts — 伤害计算内核.**只做计算,不读存档,不读 config,不打印**.
 * 调用方(verify-damage.ts / coin-sink-compare.ts / 以后的任何脚本)只要把「攻方面板 + 受击方面板 + 词条列表」准备好传进来,就能算出确定性的暴击/非暴击伤害与 ±5% 浮动区间. 分工:
 * - damage-formula.ts:源码 1:1 数值语义(BigInt / 银行家舍入 / double 求值顺序 / int32 回绕)
 * - damage-calc.ts(本文件):战斗面板组装 + 词条派发顺序 + 一次技能的完整伤害
 * - verify-damage.ts:读存档/读 config/打印；调用本文件
 * 源码依据(全部反编译自 MoNiShouYou):
 * - Damage_Recorder.CulFinalDamage / CulDamagePercent(Damage_Recorder.cs:55-161)
 * - ToolClass.CulFinalValuePercentArray(ToolClass.cs:312-320)
 * - Action_Skill.Excute(Action_Skill.cs:21-36):每个目标先 CulFinalDamage 一次,
 * 受击方 WhenBeAttack_Cul_1 再补乘区,最后再 CulFinalDamage 一次(第 2 次结果为准)
 * - Battle_Action_Manager.ActionOrder(OrderByMin=降序)+ Entry_Skill_76.WhenCulTarget:
 * 群体技能按**速度降序**逐个吃伤,每命中一个目标 Mark+1(Entry_Skill_76.cs:51-58)
 * - BattleData_Manager.InitailForBattle(BattleData_Manager.cs:76-84):把**终值**写进 Base_Value,
 * PercentAddition 清零,之后开战词条改的是这个战斗面板
 * - 各词条实现见 damage-formula.ts 的 entryWhenAttackCul1 注释
 */
import {
  ActionKind,
  BattleDataManager,
  culFinalValuePercentArray,
  DamageRecorder,
  Entry,
  entryWhenAttackCul1,
  fixedRandom,
  formatBigSuoXie,
  Prop,
  toInt32
} from "./damage-formula.ts";
import type {AttackContext,StateEntry} from "./damage-formula.ts";

// ============================== 常量(源码字面量) ==============================
// 通天塔敌人不减伤(Character_Enemy 从不写 DamageReduce).
export const TOWER_DAMAGE_REDUCE = 0;

// 鸟翔阵词条索引.
export const ZHENFA_NIAOXIANG = 8;

// 天覆阵词条索引.
export const ZHENFA_TIANFU = 1;

// Damage_Recorder.cs:80-81:Random.Range(0.95f, 1.05f).
export const BATTERY_MIN = 0.95;
export const BATTERY_MAX = 1.05;

// 羁绊类型(config/jiban.json 的 type).
export const JI_BAN_SHEN_GUI = 4;
export const JI_BAN_XI_XING = 11;

// 攻方状态:任意来源的面板都行(存档 / 模拟 / 手工构造).
export interface AttackerInput {

  // 输出位 BattleEntry(顺序即 _StateEntryList 前半段).
  battleEntry?: readonly StateEntry[];

  // 额外追加的开战词条(羁绊/阵法/队友给的),按源码插入顺序.
  extraEntries?: readonly StateEntry[];

  // 是否学了 Skill_1050(学了 3技能不吃 -30).
  hasSkill1050?: boolean;

  // 主角面板(英灵继承用；没有主角就给一个全 0 的面板).
  master: BattleDataManager;

  // 属性是否百分比型(config/property.json 的 percent).
  percentOf: (prop: number) => boolean;

  // 英灵自身面板(存档原始记录,未乘主角).
  source: BattleDataManager;
}

// 开战瞬间改战斗面板的词条(武松/唐三藏/孙悟空神转职).
export interface BattleStartEffects {

  // 最高攻 攻击% +N(Entry_Skill_1011).
  atkPct?: number;

  // 最高攻 伤害加成 +N(Entry_Skill_18).
  dmgAdd?: number;

  // 敌人闪避 −N(Entry_Skill_84 的 Reduce_ShanBi,作用在受击方).
  enemyDodgeDown?: number;

  // 全体命中 +N(Entry_Skill_81).
  hitFlat?: number;

  // 幸运→命中(Entry_Skill_1051:主角幸运/100×5).
  luckyFrom?: BattleDataManager;
}

// 一个伤害乘区(都是"百分比点",最终进 CulFinalValuePercentArray).
export interface DamageBuckets {
  hit:        number;   // 孙悟空3技能「每 1% 命中 +1% 伤害」
  mark:       number;   // 孙悟空3技能 Mark×10
  shenGui:    number;   // 神鬼志异
  shenTong15: number;   // 神通15
  shenTong19: number;   // 神通19
  shenTong27: number;   // 神通27
  skill:      number;   // 孙悟空3技能 70% = -30
  speedDiff:  number;   // 鸟翔阵
  tuJian:     number;   // 图鉴 × 研究54
  xiXing:     number;   // 西行取经
}

// 一次技能对某个敌人的完整结果.
export interface DamageRange {
  atkForK:        bigint;
  buckets:        DamageBuckets;
  carryHit:       number;
  crit:           bigint;
  critMultiplier: number;
  critRange:      readonly [bigint,bigint];
  critRate:       number;
  enemy:          EnemyStats;
  hitRate:        number;
  k:              bigint;
  layer:          number;
  mark:           number;
  nonCrit:        bigint;
  nonCritRange:   readonly [bigint,bigint];
  pen:            bigint;
  reduce:         number;
  scene:          string;
  total:          number;
  wuSongAtkPct:   number;
  wuSongDmgAdd:   number;
  zhenFaNote:     string;
}

// ============================== 类型 ==============================
// 敌人属性(面板终值).
export interface EnemyStats {
  crit:         number;
  critResist:   number;
  damageReduce: number;
  def:          number;
  dodge:        number;
  hit:          number;
  hp:           number;
  speed:        number;
}

// 单次命中的输入(要自己指定随机系数时用).
export interface HitInput {
  attacker: BattleDataManager;
  baoJi:    boolean;
  behiter:  BattleDataManager;
  percent:  readonly number[];

  // Random.Range(0.95f,1.05f) 的取值；不传按 1.0(期望值).
  rand?: number;
}

// 单次命中的输出.
export interface HitOutcome {
  finalDamage: bigint;
  k:           bigint;
  num:         bigint;
}

// 队伍开战加成(由存档 BattleEntry / 阵容羁绊推出,本文件只用数值).
export interface TeamContext {
  badStacks:      number;              // 敌人开战负面层数(神通27 用)
  jiban:          Map<number,number>;   // 羁绊类型 → 生效等级
  shenTong15:     number;
  shenTong19:     number;
  shenTong27:     number;
  tangSanZangHit: number;
  wuSongAtkPct:   number;
  wuSongDmgAdd:   number;
  zhenFaID:       number;
  zhenFaLevel:    number;
}

// 词条 → 报告里的乘区名.
export function bucketNameOf (name: number): string {
  switch (name) {
    case Entry.Add_BeDamage: {return "图鉴增伤";}
    case Entry.ShenGuiZhiYi: {return "神鬼志异";}
    case Entry.ShenTong_11: {return "神通27";}
    case Entry.ShenTong_3: {return "神通15";}
    case Entry.ShenTong_5: {return "神通19";}
    case Entry.Skill_76: {return "孙悟空3技能";}
    case Entry.Skill_78: {return "命中转伤害";}
    case Entry.XiXingQuJing: {return "西行取经";}
    case Entry.ZhenFa_8: {return "鸟翔阵速度差";}
    default: {return `词条${String(name)}`;}
  }
}

/**
 * 组装战斗面板:InitailForBattle(终值写入 Base_Value,pct 清零)→ 开战词条.
 * @param input 攻方状态.
 * @param effects 开战词条数值.
 * @returns 战斗面板(可直接用于算伤害).
 */
export function buildBattlePanel (input: AttackerInput,effects: BattleStartEffects = {}): BattleDataManager {
  const bank = new BattleDataManager(input.percentOf);
  bank.initail(() => 0);
  bank.initailForBattle(input.source,input.master);

  // Entry_Skill_1051:主角幸运/100×5 → 命中(百分比型属性进 Base)
  if (effects.luckyFrom !== undefined) {
    const lucky = Number(effects.luckyFrom.getFinalValue(Prop.Lucky));
    if (lucky > 100) {bank.changePropertyValue(Prop.MingZhong,Math.trunc(lucky / 100) * 5,true,true);}
  }
  if ((effects.hitFlat ?? 0) > 0) {bank.changePropertyValue(Prop.MingZhong,effects.hitFlat ?? 0,true,true);}
  if ((effects.atkPct ?? 0) > 0) {bank.changePropertyValue(Prop.ATK,effects.atkPct ?? 0,true,true);}
  if ((effects.dmgAdd ?? 0) > 0) {bank.changePropertyValue(Prop.DamageAddition,effects.dmgAdd ?? 0,true,true);}
  return bank;
}

/**
 * 深拷贝一份面板(用于模拟"换个状态再算一遍").
 * @param source 原面板.
 * @param percentOf 属性是否百分比型.
 * @returns 新面板.
 */
export function cloneManager (source: BattleDataManager,percentOf: (prop: number) => boolean): BattleDataManager {
  const manager = new BattleDataManager(percentOf);
  manager.initail(() => 0);
  for (const record of source.list) {
    const target = manager.getData(record.propertyTypeEnum);
    target.baseValue = record.baseValue;
    target.percentAddition = record.percentAddition;
  }
  return manager;
}

// ============================== 一次技能(群体,逐目标) ==============================
/**
 * 按存档实际面板 + 孙悟空神·人皇印队乘区,算出「一次群体怒气技能打某一个敌人」的伤害与 ±5% 区间.
 * 词条按源码 `_StateEntryList` 倒序触发；图鉴增伤作为受击方乘区最后追加.
 * @param scene 场景(只影响减伤默认值与打印标签).
 * @param layer 层数(只用于打印).
 * @param attacker 攻方状态.
 * @param enemy 敌人属性.
 * @param team 队伍开战加成.
 * @param opts 图鉴增伤 / Mark 层数 / 减伤覆盖 / 暴伤覆盖 / 自定义受击方面板.
 * @returns DamageRange.
 */
export function computeDamageRange (
  scene: "tower" | "trial" | "zhongju",
  layer: number,
  attacker: AttackerInput,
  enemy: EnemyStats,
  team: TeamContext,
  opts: {

    // 直接用外部构造好的受击方面板(例如通天塔真面板).
    behiter?:         BattleDataManager;
    critDamagePct?:   number;
    mark?:            number;
    reducePct?:       number;
    tuJianDamagePct?: number;
  } = {}
): DamageRange {

  // 敌人减伤:towerEnemy() 已按源码写 0(通天塔敌人不减伤),试炼/终局按各自配置;
  // --reduce / 自选敌人 reduce 覆盖后必须真正进受击方面板,不能只在报告里显示.
  const reduce = opts.reducePct ?? Math.min(enemy.damageReduce,80);
  const tuJianDamagePct = opts.tuJianDamagePct ?? 0;
  const mark = opts.mark ?? 0;
  const zhenFaID = team.zhenFaID;
  const zhenFaLevel = team.zhenFaLevel;
  const panel = buildBattlePanel(attacker,{
    atkPct:    team.wuSongAtkPct,
    dmgAdd:    team.wuSongDmgAdd,
    hitFlat:   team.tangSanZangHit,
    luckyFrom: attacker.master
  });
  const behiter = opts.behiter ?? enemyPanel(
    {...enemy,damageReduce: reduce},
    attacker.percentOf
  );

  // Entry_Skill_84:全体敌人闪避 −20(Reduce_ShanBi 的 WhenAddEntry 走 percent 型减 Base)
  if (team.badStacks > 0 && opts.behiter === undefined) {
    behiter.changePropertyValue(Prop.ShanBi,20,true,false);
  }

  // 仅诊断用:--critdmg 直接替换战斗面板暴伤(源码就是 ×暴伤/100)
  if (opts.critDamagePct !== undefined) {
    panel.getData(Prop.BaoJi_Damage).baseValue = opts.critDamagePct;
  }

  // 词条:倒序触发(源码 Trriger_WhenAttack_Cul_1 从列表末尾往前)
  const entries = stateEntriesOf(attacker);
  const percent: number[] = [];
  const trace: {name: string; value: number}[] = [];
  const context: AttackContext = {
    actionKind:        ActionKind.Skill,
    attackerDodge:     panel.getFinalValue(Prop.ShanBi),
    attackerHit:       panel.getFinalValue(Prop.MingZhong),
    attackerSpeedBase: panel.getData(Prop.Speed).trueBaseValue,
    badLevelSum:       team.badStacks,
    behiterDodge:      behiter.getFinalValue(Prop.ShanBi),
    behiterHit:        behiter.getFinalValue(Prop.MingZhong),
    behiterSpeedBase:  behiter.getData(Prop.Speed).trueBaseValue,
    hasSkill1050:      attacker.hasSkill1050 ?? false,
    mark:              BigInt(mark),
    percent
  };
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry === undefined) {continue;}
    const before = percent.length;
    entryWhenAttackCul1(entry,context);
    for (let cursor = before; cursor < percent.length; cursor++) {
      trace.push({name: bucketNameOf(entry.name),value: percent[cursor] ?? 0});
    }
  }
  const tuJianValue = toInt32(BigInt(Math.trunc(tuJianDamagePct)));
  if (tuJianValue !== 0) {
    percent.push(tuJianValue);
    trace.push({name: "图鉴增伤",value: tuJianValue});
  }
  const castAt = (rand: number,baoJi: boolean): bigint => computeHit({attacker: panel,baoJi,behiter,percent,rand}).finalDamage;
  const nonCrit = castAt(1,false);
  const crit = castAt(1,true);
  const num = culFinalValuePercentArray(100n,percent);
  const bucketValue = (name: string): number => trace.filter(row => row.name === name).reduce((sum,row) => sum + row.value,0);
  const skillRows = trace.filter(row => row.name === "孙悟空3技能");
  const buckets: DamageBuckets = {
    hit:        bucketValue("命中转伤害"),
    mark:       skillRows.length > 1 ? skillRows[1]?.value ?? 0 : 0,
    shenGui:    bucketValue("神鬼志异"),
    shenTong15: bucketValue("神通15"),
    shenTong19: bucketValue("神通19"),
    shenTong27: bucketValue("神通27"),
    skill:      skillRows[0]?.value ?? 0,
    speedDiff:  bucketValue("鸟翔阵速度差"),
    tuJian:     bucketValue("图鉴增伤"),
    xiXing:     bucketValue("西行取经")
  };
  const finalMZ = 100n + context.attackerHit - context.behiterDodge;
  const weaponName = "灵器";
  const zhenFaNote = zhenFaID === ZHENFA_NIAOXIANG
    ? `鸟翔阵(速度 ${formatBigSuoXie(context.attackerSpeedBase)} − 敌速 ${formatBigSuoXie(context.behiterSpeedBase)} → +${formatBigSuoXie(BigInt(buckets.speedDiff))}% 增伤)`
    : zhenFaID === ZHENFA_TIANFU
      ? `天覆阵 Lv.${String(zhenFaLevel)}(最高攻 ×(100+${String(zhenFaLevel)})/100 攻击)`
      : `${String(zhenFaID)} 号阵(首击无阵法加成)`;
  return {
    atkForK:        panel.getFinalValue(Prop.ATK),
    buckets,
    carryHit:       Number(context.attackerHit),
    crit,
    critMultiplier: Number(panel.getFinalValue(Prop.BaoJi_Damage)) / 100,
    critRange:      [castAt(BATTERY_MIN,true),castAt(BATTERY_MAX,true)],
    critRate:       Math.max(0,Math.min(1,
      (Number(panel.getFinalValue(Prop.BaoJi)) - Number(behiter.getFinalValue(Prop.BaoJi_Resist)) + 1) / 101)),
    enemy,
    hitRate:      Math.max(0,Math.min(1,(Number(finalMZ) + 1) / 101)),
    k:            DamageRecorder.culDamagePercent(panel.getFinalValue(Prop.ATK),effectiveDef(behiter,panel)),
    layer,
    mark,
    nonCrit,
    nonCritRange: [castAt(BATTERY_MIN,false),castAt(BATTERY_MAX,false)],
    pen:          panel.getFinalValue(Prop.Igonore_DEF),
    reduce,
    scene:        scene === "tower" ? "通天塔" : scene === "trial" ? "试炼" : "终局",
    total:        Number(num) / 100,
    wuSongAtkPct: team.wuSongAtkPct,
    wuSongDmgAdd: team.wuSongDmgAdd,
    zhenFaNote:   `${zhenFaNote}｜${weaponName}`
  };
}

// ============================== 单次命中 ==============================
/**
 * 一次命中:完全按 Damage_Recorder.CulFinalDamage 走一遍(不掺任何估计).
 * @param input 命中输入.
 * @returns 伤害与中间量.
 */
export function computeHit (input: HitInput): HitOutcome {
  const recorder = new DamageRecorder();
  recorder.baseAttack = input.attacker.getFinalValue(Prop.ATK);
  recorder.percentAddition.push(...input.percent);
  recorder.baoJi = input.baoJi;
  recorder.culFinalDamage(
    prop => input.attacker.getFinalValue(prop),
    prop => input.behiter.getFinalValue(prop),
    fixedRandom(input.rand ?? 1)
  );
  return {
    finalDamage: recorder.finalDamage,
    k:           DamageRecorder.culDamagePercent(
      input.attacker.getFinalValue(Prop.ATK),
      effectiveDef(input.behiter,input.attacker)
    ),
    num: culFinalValuePercentArray(100n,input.percent)
  };
}

/**
 * 把 EnemyStats 灌成受击方面板(自定义敌人/试炼/终局都用它).
 * @param enemy 敌人属性.
 * @param percentOf 属性是否百分比型.
 * @returns 面板.
 */
export function enemyPanel (enemy: EnemyStats,percentOf: (prop: number) => boolean): BattleDataManager {
  const manager = new BattleDataManager(percentOf);
  manager.initail(() => 0);
  manager.getData(Prop.HP).baseValue = enemy.hp;
  manager.getData(Prop.DEF).baseValue = enemy.def;
  manager.getData(Prop.Speed).baseValue = enemy.speed;
  manager.getData(Prop.MingZhong).baseValue = enemy.hit;
  manager.getData(Prop.ShanBi).baseValue = enemy.dodge;
  manager.getData(Prop.BaoJi).baseValue = enemy.crit;
  manager.getData(Prop.BaoJi_Resist).baseValue = enemy.critResist;
  manager.getData(Prop.DamageReduce).baseValue = enemy.damageReduce;
  return manager;
}

// ============================== 面板工具 ==============================
/**
 * 把「存档记录数组」包成源码的 BattleData_Manager.
 * @param records 记录(Base_Value / PercentAddition / PropertyTypeEnum).
 * @param percentOf 属性是否百分比型.
 * @returns 面板.
 */
export function managerFromRecords (
  records: readonly {Base_Value: number; PercentAddition: number; PropertyTypeEnum: number}[],
  percentOf: (prop: number) => boolean
): BattleDataManager {
  const manager = new BattleDataManager(percentOf);
  manager.initail(() => 0);
  for (const record of manager.list) {
    const row = records.find(item => item.PropertyTypeEnum === record.propertyTypeEnum);
    record.baseValue = row?.Base_Value ?? 0;
    record.percentAddition = BigInt(row?.PercentAddition ?? 0);
  }
  return manager;
}

/**
 * 一轮群体技能打 5 个目标的顺序:速度降序(首领→精英→小怪),Mark 依次 0..4.
 * @param enemies 敌人(同层 5 只).
 * @returns 按命中顺序排好的数组.
 */
export function sortByHitOrder<T extends {enemy: EnemyStats}> (enemies: readonly T[]): T[] {
  return [...enemies].sort((left,right) => right.enemy.speed - left.enemy.speed);
}

/**
 * 输出位开战瞬间的 `_StateEntryList`(顺序即源码插入顺序,攻击时倒序遍历).
 * @param input 攻方状态(battleEntry + extraEntries).
 * @returns 词条列表.
 */
export function stateEntriesOf (input: AttackerInput): StateEntry[] {
  return [...input.battleEntry ?? [],...input.extraEntries ?? []];
}

/**
 * 孙悟空神·人皇印队开战会给输出位追加的词条,顺序同源码插入顺序:
 * 羁绊(ZhenRongData.JiBan() 按人数降序)→ 阵法 → 沙僧神转职给其他队友的 Skill_87.
 * @param team 队伍开战加成.
 * @returns 追加词条.
 */
export function wukongExtraEntries (team: TeamContext): StateEntry[] {
  const entries: StateEntry[] = [];
  const xiXing = team.jiban.get(JI_BAN_XI_XING) ?? 0;
  if (xiXing > 0) {entries.push({level: xiXing,name: Entry.XiXingQuJing,stayRound: 0});}
  const shenGui = team.jiban.get(JI_BAN_SHEN_GUI) ?? 0;
  if (shenGui > 0) {entries.push({level: shenGui,name: Entry.ShenGuiZhiYi,stayRound: 0});}
  if (team.zhenFaID === ZHENFA_NIAOXIANG) {entries.push({level: 0,name: Entry.ZhenFa_8,stayRound: 0});}
  entries.push({level: 1,name: Entry.Skill_87,stayRound: 0});
  return entries;
}

/**
 * 穿防后的防御(源码 `if (def < 1) def = 1`).
 * @param behiter 受击方面板.
 * @param attacker 攻方面板.
 * @returns 有效防御(≥1).
 */
function effectiveDef (behiter: BattleDataManager,attacker: BattleDataManager): bigint {
  const value = behiter.getFinalValue(Prop.DEF) - attacker.getFinalValue(Prop.Igonore_DEF);
  return value < 1n ? 1n : value;
}