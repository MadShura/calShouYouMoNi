/**
 * coin-to-zhanli.ts — 固定钱币 → 11 种材料 + 自选残念锦囊 + 6 个材料宝箱 → 20 条结果的完整对比(导出全量对比 compareByCoin 与精简打印辅助方法 printKeyProps)
 * 钱币换算按源码 PropHelper.GetPropValue(:29-38) 的「整批一次取整」:
 * round(单价 × 数量) ≤ 钱币 的最大整数数量；材料单价取 data.ts 的 MATERIAL_COST_PER_UNIT,
 * 宝箱/锦囊单价取 config/chests.json 的 unit(同为 ValueCost × (100−研究44 商店折扣)/100,不再二次打折).
 * 宝箱按 ValueCost 折算成等价值钱币对比:PropHelper.GenrateStore(:165-191) 的商店只卖 11-16/18/19 等,御力宝箱(20-29)不在其中无法购买.
 * 灵纹按天覆阵(阵法1)与鸟翔阵(阵法8)各算一条,9 个阵法里只取这两个;与其余材料合计 13 行基础结果.
 * 另加 1 行自选残念锦囊(19)与 6 行固定材料宝箱(11-16,不含无法购买的御力宝箱 20-29):开奖期望来自 config/chests.json
 * (游戏 Prop_Data_Json.txt + Prop_Chest_*.cs 导出),折算方法在 calzhanli.ts 的
 * baoxiangTozhanli / zixuancannianjinnangTozhanli,默认只算一个英灵.
 * 随机残念锦囊(18)、御力宝箱(20-29)、宝石匣/灵宝匣(30-69)、套娃宝箱(70-79)、试炼秘宝(96)的换算方法仍保留在
 * calzhanli.ts,按用户口径不在本对比表使用.
 * 同材料多方法时「材料」列带中文后缀(强化石·单槽强化 / 灵纹·天覆阵 等),
 * 但单价仍按 MATERIAL_COST_PER_UNIT 里的原材料名查,显示名不参与查表.
 * 20 条结果先按「攻击 atk」的数值降序排序,再按 DESIGN.md:89 的口径转成展示结果:
 * 数字用 readSave.ts 的 formatSuoXie(ToolClass.TranslateNumsToSuoXie:10 万以下整数,
 * 10 万起按 万/亿/兆/京... 每四位递进),字段名统一译成中文；
 * 所以 compareByCoin 返回的所有数值都是字符串(排序在格式化之前完成,不受影响).
 * 百分比字段名按源码核查结果标注:config/property.json 里 percent=1 的 13 项属性
 * (BattleData_Recorder.GetFinal 直接返回 True_Base_Value,GetZhanLi 把该值进乘区数组)数值即百分比点数,
 * 字段名加 % 后缀但数值不改;PercentAddition 类字段已含「百分比」字样,保持不动.
 * 结果结构说明:基础结果里 10 个方法为 ToZhanliResult(18 项固定值 + 18 项百分比 + 过程量),
 * 寒铁为 HantieToZhanliResult,强化石两个方法为 AllProperties;新增锦囊/宝箱方法也返回 ToZhanliResult.
 * 缺失字段即源码不产出该属性.
 * 神兵火炼/水炼只投「想要的属性」数组指定的炼化轨(默认 命中,速度):水炼 23 条轨里
 * 没有命中与速度,故忘情水默认结果为 0;传 伤害加成,暴伤 则选中该文档的 2 条伤害加成 + 6 条暴伤轨.
 * 打印时额外以存档主角(Cha_Data.Save,默认 Save_1,可用 --save=N / --dir 指定)的 BattleData_Manager
 * 面板为基准,把每条材料增量叠加到 Base_Value 层,再以终局第 5 层(tiaoZhanID=5)敌人为目标算单次输出:
 * 敌人属性与 K 分别 import enemy-stats.ts 与 game-formulas.ts(DESIGN.md:90,96),不另写常量;
 * 命中率固定 1(默认能打中),不算敌方 HP;暴击率按 (暴击−敌抗暴+1)/101 计算,
 * 只有 ≥100% 必暴时才乘暴伤,否则按非暴击,不做暴击率期望.
 * 文件末尾另含复合方案对比区块(御灵宝典突破方向 × 阵法,只互相比较,不混入上面的基础材料对比,
 * 且用独立面板把百分比加成也计入乘区,避免攻击方向+天覆被忽略).
 */
import {readFileSync} from "node:fs";
import {
  baoxiangTozhanli,
  hantieTozhanli,
  lingjingTozhanli,
  lishibenjiTozhanli,
  niaoxiangzhenTozhanli,
  pojingshiTozhanli,
  qianghuazhiTozhanli1,
  qianghuazhiTozhanli2,
  sanweizhenhuoTozhanli,
  shentongjuanzhouTozhanli,
  tianfuzhenTozhanli,
  wangqingshuiTozhanli,
  wucaishenshiTozhanli,
  yulingbaodianTozhanli,
  zixuancannianjinnangTozhanli
} from "./calzhanli.ts";
import {CHEST_DATA,DEFAULT_WANTED_PROPERTIES,MATERIAL_COST_PER_UNIT,PROPERTY_TO_KEY} from "./data.ts";
import {formatSuoXie,loadSave,parseArgs,resolveSaveDir} from "./readSave.ts";
import {ZHONG_JU} from "./scripts/enemy-stats.ts";
import {oneShotDamage} from "./scripts/game-formulas.ts";

// #region 字段中文映射
// 英文字段名 → 中文:覆盖 3 种返回类型的全部数值字段(18 项固定值,18 项百分比,8 个过程量,
// 寒铁特有的 10 个过程量);行级的 攻击/数量/方法/材料/结果 已是中文,不在表内.按字母序排列.
// 13 项 percent=1 属性的数值是百分比点数(源码 GetFinal 不乘,GetZhanLi 进乘区数组),字段名加 % 后缀;
// PercentAddition 类(xxxPercent)与 特殊百分比/战力百分比/阵法最高攻加成百分比 本就是百分比且名字已标明,保持不动;
// 5 项 percent=0 属性(攻/防/血/速/穿透)与全部计数/等级/材料过程量是固定值,不加 %.
const FIELD_NAMES: Record<string,string> = {
  atk:                   "攻击",
  atkPercent:            "攻击百分比",
  baoJi:                 "暴击%",
  baoJiDamage:           "暴击伤害%",
  baoJiDamagePercent:    "暴击伤害百分比",
  baoJiPercent:          "暴击百分比",
  baoJiResist:           "抗暴%",
  baoJiResistPercent:    "抗暴百分比",
  count:                 "次数",
  craftCount:            "制造次数",
  damageAddition:        "伤害加成%",
  damageAdditionPercent: "伤害加成百分比",
  damageReduce:          "伤害减免%",
  damageReducePercent:   "伤害减免百分比",
  def:                   "防御",
  defPercent:            "防御百分比",
  fanJi:                 "反击%",
  fanJiPercent:          "反击百分比",
  finalLevel:            "最终等级",
  finalLianqiExp:        "最终炼器经验",
  finalLianqiLevel:      "最终炼器等级",
  finalQidingLevel:      "最终器鼎等级",
  hantieLeft:            "剩余寒铁",
  hantieUsed:            "消耗寒铁",
  hp:                    "生命",
  hpPercent:             "生命百分比",
  ignoreDef:             "穿透",
  ignoreDefPercent:      "穿透百分比",
  left:                  "剩余材料",
  lianJi:                "连击%",
  lianJiPercent:         "连击百分比",
  lucky:                 "幸运%",
  luckyPercent:          "幸运百分比",
  maxLevel:              "等级上限",
  mingZhong:             "命中%",
  mingZhongPercent:      "命中百分比",
  recovery:              "恢复%",
  recoveryPercent:       "恢复百分比",
  returnDamage:          "反弹伤害%",
  returnDamagePercent:   "反弹伤害百分比",
  ronglianCount:         "熔炼件数",
  ronglianStones:        "熔炼强化石",
  shanBi:                "闪避%",
  shanBiPercent:         "闪避百分比",
  specialPercent:        "特殊百分比",
  speed:                 "速度",
  speedPercent:          "速度百分比",
  used:                  "消耗材料",
  wucaiLeft:             "剩余五彩神石",
  wucaiUsed:             "消耗五彩神石",
  xiXie:                 "吸血%",
  xiXiePercent:          "吸血百分比",
  zhanliPercent:         "战力百分比",
  zhenFaAttackPercent:   "阵法最高攻加成百分比"
};
// #endregion

// #region 存档主角面板 → 终局第 5 层输出
const PROP_COUNT = 18;
const PROPERTY_CONFIG = JSON.parse(
  readFileSync(new URL("./config/property.json",import.meta.url),"utf8")
) as {percent: number; type: number}[];
const PERCENT_PROPS = new Set(PROPERTY_CONFIG.filter(item => item.percent === 1).map(item => item.type));
const KEY_TO_PROP: Record<string,number> = Object.fromEntries(
  Object.entries(PROPERTY_TO_KEY).map(([prop,key]) => [key,Number(prop)])
);

// 终局第 5 层 = config/zhongju.json 的 tiaoZhanID=5;属性由 enemy-stats.ts 按反编译口径算好(DESIGN.md:90).
function getZhongJu5 (): (typeof ZHONG_JU)[number] {
  const enemy = ZHONG_JU.find(item => item.tiaoZhanID === 5);
  if (enemy === undefined) {
    throw new Error("config/zhongju.json 里没有 tiaoZhanID=5 的终局敌人");
  }
  return enemy;
}
const ENEMY_5 = getZhongJu5();

interface MasterPanel {
  base:     number[];
  dir:      string;
  pct:      number[];
  zhenFaID: number;
}

/**
 * 只读存档(默认 Save_1,支持 --save=N / --dir),把主角 Cha_Data 的 BattleData_Manager
 * 摊成 18 项 Base_Value / PercentAddition 两层;不写游戏目录(DESIGN.md:80,83).
 */
function loadMasterPanel (): MasterPanel {
  const args = parseArgs(process.argv.slice(2));
  const dir = resolveSaveDir(args);
  const save = loadSave(dir);
  const base = new Array<number>(PROP_COUNT).fill(0);
  const pct = new Array<number>(PROP_COUNT).fill(0);
  for (const item of save.cha.BattleData_Manager?.battleData_Recorders_List ?? []) {
    const prop = item.PropertyTypeEnum;
    if (prop < 0 || prop >= PROP_COUNT) {
      continue;
    }
    base[prop] = item.Base_Value;
    pct[prop] = item.PercentAddition;
  }
  return {base,dir,pct,zhenFaID: save.cha.CurZhenFa ?? 0};
}

/**
 * BattleData_Recorder.GetFinal + BattleData_Manager.GetFinalValue(power-value.ts:341-351 同口径):
 * percent=1 的属性直接取 Base_Value,其余取 Base×(100+PercentAddition)/100.
 */
function finalValue (panel: MasterPanel,prop: number): number {
  const base = panel.base[prop] ?? 0;
  const pct = panel.pct[prop] ?? 0;
  return PERCENT_PROPS.has(prop) ? Math.max(0,base) : Math.round(base * (100 + pct) / 100);
}

/**
 * 把 tozhanli 返回的 18 项增量叠加到 base 层:字段名经 PROPERTY_TO_KEY 反查枚举,
 * 百分比点数(命中/暴击/伤害加成等)与固定值(攻/防/血/速/穿透)都加在 Base_Value 上,
 * 再由 finalValue 统一乘 PercentAddition,避免把固定值增量当成最终值直接相加.
 */
function panelWithResult (panel: MasterPanel,result: object): MasterPanel {
  const base = [...panel.base];
  for (const [key,value] of Object.entries(result)) {
    const prop = KEY_TO_PROP[key];
    if (prop !== undefined && typeof value === "number" && Number.isFinite(value)) {
      base[prop] = (base[prop] ?? 0) + value;
    }
  }
  return {base,dir: panel.dir,pct: panel.pct,zhenFaID: panel.zhenFaID};
}

/**
 * 单次输出:命中率固定 1、不算敌方 HP;暴击率按 power-value.ts:292 的 (暴击−敌抗暴+1)/101
 * (阵法6 同 :289-291 另给 +30),只有 ≥100% 必暴时才把 暴伤/100 放进百分比乘区,否则按非暴击.
 * atk 已是 final 值,所以 atkPct=100、skillMult=1;K 由 oneShotDamage 内部按实际攻击与敌防御算(DESIGN.md:96).
 */
function calcOutput (panel: MasterPanel): {damage: number; mustCrit: boolean} {
  const atk = finalValue(panel,0);
  const pen = finalValue(panel,15);
  const baoJi = finalValue(panel,6);
  const baoJiDamage = finalValue(panel,8);
  const dmgAdd = finalValue(panel,13);
  const critAdd = panel.zhenFaID === 6 ? 30 : 0;
  const critRate = Math.max(0,Math.min(1,(baoJi - ENEMY_5.critResist + critAdd + 1) / 101));
  const mustCrit = critRate >= 1;
  const damage = oneShotDamage(atk,ENEMY_5,{
    atkPct:    100,
    dmgAdd,
    pctBucket: mustCrit ? baoJiDamage / 100 : 1,
    skillMult: 1,
    pen
  });
  return {damage,mustCrit};
}
// #endregion

// #region 固定钱币 → 20 条结果
interface CoinRow {
  攻击: number;
  数量: number;
  方法: string;
  材料: string;
  结果: object;
}

/**
 * 构造 20 条未格式化的原始结果(数值仍是 number),按攻击降序;展示格式化与输出计算都复用它.
 * @param money 投入的钱币总数(默认 1 亿)
 * @param wanted 想要的属性中文名数组(默认 命中,速度)
 * @param mySpeed 我方速度(默认 0,只影响鸟翔阵)
 * @param enemySpeed 敌方速度(默认 0,只影响鸟翔阵)
 */
function buildRows (
  money = 1_0000_0000,
  wanted: readonly string[] = DEFAULT_WANTED_PROPERTIES,
  mySpeed = 0,
  enemySpeed = 0
): CoinRow[] {

  // 整批一次取整:求最大 N 使 Math.round(单价×N) ≤ money(二分避免浮点边界与逐个试算).
  const buyCount = (unit: number): number => {
    let low = 0;
    let high = Math.max(1,Math.floor((money + 0.5) / unit) + 1);
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (Math.round(unit * mid) <= money) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  };
  const buyByName = (name: string): number => {
    const unit = MATERIAL_COST_PER_UNIT[name];
    if (unit === undefined) {
      throw new Error(`材料单价表里没有「${name}」`);
    }
    return buyCount(unit);
  };
  const chestUnit = (id: number): number => {
    const def = CHEST_DATA.chests.find(item => item.id === id);
    if (def === undefined) {
      throw new Error(`config/chests.json 里没有道具 ${String(id)}`);
    }
    return def.unit;
  };

  // 泛型保留各方法的原始返回类型,「结果」里所有字段都会被完整展示.
  // 材料 是展示名(同材料多方法时带中文后缀);单价材料 是 MATERIAL_COST_PER_UNIT 的键或宝箱单价(数字),默认与展示名相同.
  const make = <T extends {atk: number}>(
    材料: string,
    方法: string,
    run: (n: number) => T,
    单价材料: string | number = 材料
  ): CoinRow => {
    const 数量 = typeof 单价材料 === "number" ? buyCount(单价材料) : buyByName(单价材料);
    const 结果 = run(数量);
    return {攻击: 结果.atk,数量,方法,材料,结果};
  };
  return [
    make("三味真火","sanweizhenhuoTozhanli",n => sanweizhenhuoTozhanli(n,wanted)),
    make("五彩神石","wucaishenshiTozhanli",wucaishenshiTozhanli),
    make("历史本纪","lishibenjiTozhanli",lishibenjiTozhanli),
    make("寒铁","hantieTozhanli",n => hantieTozhanli(n,0,0)),
    make("强化石·单槽强化","qianghuazhiTozhanli1",qianghuazhiTozhanli1,"强化石"),
    make("强化石·平均强化","qianghuazhiTozhanli2",qianghuazhiTozhanli2,"强化石"),
    make("御灵宝典","yulingbaodianTozhanli",yulingbaodianTozhanli),
    make("忘情水","wangqingshuiTozhanli",n => wangqingshuiTozhanli(n,wanted)),
    make("灵晶","lingjingTozhanli",lingjingTozhanli),
    make("灵纹·天覆阵","tianfuzhenTozhanli",tianfuzhenTozhanli,"灵纹"),
    make("灵纹·鸟翔阵","niaoxiangzhenTozhanli",n => niaoxiangzhenTozhanli(n,mySpeed,enemySpeed),"灵纹"),
    make("破境石","pojingshiTozhanli",pojingshiTozhanli),
    make("神通卷轴","shentongjuanzhouTozhanli",shentongjuanzhouTozhanli),
    make("自选残念锦囊","zixuancannianjinnangTozhanli",zixuancannianjinnangTozhanli,chestUnit(19)),
    ...CHEST_DATA.chests
      // 只保留固定材料箱(11-16):御力宝箱(20-29)不在商店售卖无法购买,随机锦囊/宝石匣/灵宝匣/套娃/试炼秘宝不纳入本表
      .filter(item => item.kind === "fix" && item.target !== 4)
      .map(item => make(
        item.name,
        `baoxiangTozhanli(${String(item.id)})`,
        (n: number) => baoxiangTozhanli(item.id,n),
        item.unit
      ))
  ].sort((a,b) => b.攻击 - a.攻击);
}

/** 把一条原始结果转成中文展示结果:数值经 formatSuoXie 变成带单位字符串,字段名译成中文. */
function formatRow (row: CoinRow) {
  return {
    攻击: formatSuoXie(row.攻击),
    数量: formatSuoXie(row.数量),
    方法: row.方法,
    材料: row.材料,
    结果: Object.fromEntries(Object.entries(row.结果)
      .map(([key,value]) => [FIELD_NAMES[key] ?? key,formatSuoXie(value as number)]))
  };
}

/**
 * 给定固定钱币数,把 11 种材料、自选残念锦囊与 6 个固定材料宝箱各自能买到的数量投进对应的 20 条结果,按攻击降序返回中文展示结果:所有数值经 formatSuoXie 转成带单位字符串,字段名全部中文.
 * 神兵火炼/水炼额外按 wanted 筛选炼化轨;默认只投 命中,速度,传 伤害加成,暴伤 则选中该文档的 2 条伤害加成 + 6 条暴伤轨.
 * 灵纹按天覆阵/鸟翔阵各算一条;mySpeed/enemySpeed 透传给鸟翔阵的速度差伤害加成,默认都是 0.
 * @param money 投入的钱币总数(默认 1 亿,可自行改默认值或调用时传入)
 * @param wanted 想要的属性中文名数组(默认 命中,速度)
 * @param mySpeed 我方速度(默认 0,只影响鸟翔阵)
 * @param enemySpeed 敌方速度(默认 0,只影响鸟翔阵)
 */
export function compareByCoin (
  money = 1_0000_0000,
  wanted: readonly string[] = DEFAULT_WANTED_PROPERTIES,
  mySpeed = 0,
  enemySpeed = 0
) {

  // 先按数值排好序,再统一格式化;结果里的值全是 number,只需两层即可覆盖.
  return buildRows(money,wanted,mySpeed,enemySpeed).map(formatRow);
}
// #endregion

// #region 精简打印与执行入口
// 精简打印只保留这 9 项属性;后 5 项带 % 后缀,是 config/property.json 里 percent=1 的百分比显示属性.
const KEY_PROPS = ["伤害加成%","命中%","幸运%","攻击","暴击%","暴击伤害%","穿透","速度","闪避%"] as const;

/**
 * 辅助方法:按攻击降序打印 20 条精简结果,每条一行中文文本,先列 KEY_PROPS 的 9 项属性,
 * 再追加「输出」与「相对存档基准的提升率」;顶部打印查询条件、存档路径、敌人档位与基准输出.
 * 输出按存档主角面板 + 终局第 5 层敌人计算,命中率固定 1,只有暴击率 100% 时才按暴击伤害算.
 * @param money 投入的钱币总数(默认 1 亿,可自行改默认值或调用时传入)
 * @param wanted 想要的属性中文名数组(默认 命中,速度)
 * @param mySpeed 我方速度(默认 0,只影响鸟翔阵)
 * @param enemySpeed 敌方速度(默认 0,只影响鸟翔阵)
 */
export function printKeyProps (
  money = 1_0000_0000,
  wanted: readonly string[] = DEFAULT_WANTED_PROPERTIES,
  mySpeed = 0,
  enemySpeed = 0
): void {
  const panel = loadMasterPanel();
  const baseline = calcOutput(panel);
  console.log(`想要的属性:${wanted.join("、")} 我方速度:${String(mySpeed)} 敌方速度:${String(enemySpeed)}`);
  console.log(`存档:${panel.dir} 敌人:终局第5层(抗暴=${formatSuoXie(ENEMY_5.critResist)} 减伤=${formatSuoXie(ENEMY_5.damageReduce)}→${String(Math.min(ENEMY_5.damageReduce,80))}封顶) 必暴=${String(baseline.mustCrit)} 基准输出=${formatSuoXie(baseline.damage)}`);
  for (const row of buildRows(money,wanted,mySpeed,enemySpeed)) {
    const shown = formatRow(row);
    const out = calcOutput(panelWithResult(panel,row.结果));
    const gain = baseline.damage > 0 ? (out.damage - baseline.damage) / baseline.damage : 0;
    const props = KEY_PROPS.map(key => `${key}=${shown.结果[key] ?? "0"}`).join(" ");
    console.log(`${shown.材料} ${shown.方法} ${props} 输出=${formatSuoXie(out.damage)} 提升=${(gain * 100).toFixed(4)}%`);
  }
}

// 直接执行本文件时只打印精简结果:2 行说明 + 20 行,每行一条中文文本.
printKeyProps();
printComposite();
// #endregion

// #region 复合方案对比(御灵宝典突破方向 × 阵法,只互相比较)
// 复合方案 = 御灵宝典(指定突破方向) 与 阵法(天覆/鸟翔) 在相同钱币下各自全额购买后叠加,
// 只比较这些方案之间的加成,不混入上面的单一材料对比(用户口径:复合只和复合比).
// 这里用独立的 compositePanel 把百分比字段也计入乘区(基础对比的 panelWithResult 只叠 Base_Value 层),
// 否则御灵宝典突破的 atkPercent 与天覆阵的 +15% 攻击会被忽略,比较不公平;
// 鸟翔阵的速度差伤害加成会注入御灵宝典速度方向(9)的固定值速度,体现「速度流」协同.

/** 整批一次取整(与基础对比同一口径):求最大 N 使 Math.round(单价×N) ≤ money. */
function maxBuyCount (unit: number,money: number): number {
  let low = 0;
  let high = Math.max(1,Math.floor((money + 0.5) / unit) + 1);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Math.round(unit * mid) <= money) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

interface CompositePlan {
  name: string;
  yulingDir: number;            // 御灵宝典突破方向(PropertyTypeEnum):0 攻击 / 1 防御 / 2 生命 / 15 穿透 / 9 速度 / 11 幸运
  zhen: "tianfu" | "niaoxiang"; // 阵法:天覆 / 鸟翔
}

// 把两个 tozhanli 结果按字段数值相加(固定值与百分比分开累加,过程量也相加但不参与面板).
function mergeResults (a: object,b: object): Record<string,number> {
  const out: Record<string,number> = {};
  for (const [k,v] of Object.entries(a)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = v;
    }
  }
  for (const [k,v] of Object.entries(b)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = (out[k] ?? 0) + v;
    }
  }
  return out;
}

// 独立面板:基础属性(含 percent=1 的百分比点数)进 Base_Value 层,xxxPercent(PercentAddition 类)进 PercentAddition 层,
// 让御灵宝典突破与阵法的百分比加成进入乘区;zhenFaAttackPercent 等非基础百分比字段会被忽略(与基础口径一致).
function compositePanel (panel: MasterPanel,result: object): MasterPanel {
  const base = [...panel.base];
  const pct = [...panel.pct];
  for (const [key,value] of Object.entries(result)) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      continue;
    }
    const propBase = KEY_TO_PROP[key];
    if (propBase !== undefined) {
      base[propBase] = (base[propBase] ?? 0) + value;
      continue;
    }
    if (key.endsWith("Percent")) {
      const core = key.slice(0,-"Percent".length);
      const propPct = KEY_TO_PROP[core];
      if (propPct !== undefined) {
        pct[propPct] = (pct[propPct] ?? 0) + value;
      }
    }
  }
  return {base,dir: panel.dir,pct,zhenFaID: panel.zhenFaID};
}

/**
 * 复合方案对比:御灵宝典(突破方向)× 阵法(天覆/鸟翔),相同钱币下各自全额购买后叠加,
 * 按输出降序返回每个方案的结果(含 merged 原始字段 / 输出 / 提升率).
 * 鸟翔阵的速度差伤害加成会注入御灵宝典速度方向(9)的固定值速度,体现「速度流」协同.
 * @param money 投入的钱币总数(默认 1 亿)
 * @param mySpeed 我方速度(默认 0)
 * @param enemySpeed 敌方速度(默认 0)
 */
export function compareComposite (
  money = 1_0000_0000,
  mySpeed = 0,
  enemySpeed = 0
) {
  const books = maxBuyCount(MATERIAL_COST_PER_UNIT["御灵宝典"]!,money);
  const zhen = maxBuyCount(MATERIAL_COST_PER_UNIT["灵纹"]!,money);
  const plans: CompositePlan[] = [
    {name: "御灵宝典(速度)+鸟翔阵",yulingDir: 9,zhen: "niaoxiang"},
    {name: "御灵宝典(攻击)+天覆阵",yulingDir: 0,zhen: "tianfu"}
  ];
  const panel = loadMasterPanel();
  const baseline = calcOutput(panel);
  const rows = plans.map(plan => {
    const yl = yulingbaodianTozhanli(books,plan.yulingDir,4);
    // 速度方向突破给固定值 speed,注入鸟翔阵的速度差,体现协同
    const ylSpeed = plan.yulingDir === 9 ? yl.speed : 0;
    const zf = plan.zhen === "niaoxiang"
      ? niaoxiangzhenTozhanli(zhen,mySpeed + ylSpeed,enemySpeed)
      : tianfuzhenTozhanli(zhen);
    const merged = mergeResults(yl,zf);
    const out = calcOutput(compositePanel(panel,merged));
    const gain = baseline.damage > 0 ? (out.damage - baseline.damage) / baseline.damage : 0;
    return {name: plan.name,merged,out,gain};
  });
  rows.sort((a,b) => b.out.damage - a.out.damage);
  return rows;
}

/** 直接打印复合方案对比:每行一条中文,列 攻击/速度/伤害加成%/攻击百分比/输出/提升率,只互相比较. */
export function printComposite (
  money = 1_0000_0000,
  mySpeed = 0,
  enemySpeed = 0
): void {
  const books = maxBuyCount(MATERIAL_COST_PER_UNIT["御灵宝典"]!,money);
  const zhen = maxBuyCount(MATERIAL_COST_PER_UNIT["灵纹"]!,money);
  const panel = loadMasterPanel();
  const baseline = calcOutput(panel);
  console.log("\n=== 复合方案对比(御灵宝典方向 × 阵法,只互相比较) ===");
  console.log(`御灵宝典本数=${formatSuoXie(books)} 灵纹数=${formatSuoXie(zhen)} 我方速度=${String(mySpeed)} 敌方速度=${String(enemySpeed)}`);
  console.log(`存档:${panel.dir} 基准输出=${formatSuoXie(baseline.damage)}`);
  for (const row of compareComposite(money,mySpeed,enemySpeed)) {
    const r = row.merged;
    const fields = [
      `攻击=${formatSuoXie(r.atk ?? 0)}`,
      `速度=${formatSuoXie(r.speed ?? 0)}`,
      `伤害加成%=${formatSuoXie(r.damageAddition ?? 0)}`,
      `攻击百分比=${formatSuoXie(r.atkPercent ?? 0)}`
    ].join(" ");
    console.log(`${row.name} ${fields} 输出=${formatSuoXie(row.out.damage)} 提升=${(row.gain * 100).toFixed(4)}%`);
  }
}

// #endregion
