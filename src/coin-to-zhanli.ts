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
 * 随机残念锦囊(18),御力宝箱(20-29),宝石匣/灵宝匣(30-69),套娃宝箱(70-79),试炼秘宝(96)的换算方法仍保留在
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
 */
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
import {CHEST_DATA,DEFAULT_WANTED_PROPERTIES,MATERIAL_COST_PER_UNIT} from "./data.ts";
import {formatSuoXie} from "./readSave.ts";
import {calcOutput,ENEMY_5,loadMasterPanel,panelWithResult} from "./zhanli-panel.ts";

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
// #region 固定钱币 → 20 条结果
interface CoinRow {
  攻击: number;
  数量: number;
  方法: string;
  材料: string;
  结果: object;
}

/**
 * 给定固定钱币数,把 11 种材料,自选残念锦囊与 6 个固定材料宝箱各自能买到的数量投进对应的 20 条结果,按攻击降序返回中文展示结果:所有数值经 formatSuoXie 转成带单位字符串,字段名全部中文.
 * 神兵火炼/水炼额外按 wanted 筛选炼化轨;默认只投 命中,速度,传 伤害加成,暴伤 则选中该文档的 2 条伤害加成 + 6 条暴伤轨.
 * 灵纹按天覆阵/鸟翔阵各算一条;mySpeed/enemySpeed 透传给鸟翔阵的速度差伤害加成,默认都是 0.
 * @param money 投入的钱币总数(默认 1 亿,可自行改默认值或调用时传入)
 * @param wanted 想要的属性中文名数组(默认 命中,速度)
 * @param mySpeed 我方速度(默认 0,只影响鸟翔阵)
 * @param enemySpeed 敌方速度(默认 0,只影响鸟翔阵)
  * @returns { 攻击: string; 数量: string; 方法: string; 材料: string; 结果: { [k: string]: string; }; }[].
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

/**
 * 构造 20 条未格式化的原始结果(数值仍是 number),按攻击降序;展示格式化与输出计算都复用它.
 * @param money 投入的钱币总数(默认 1 亿)
 * @param wanted 想要的属性中文名数组(默认 命中,速度)
 * @param mySpeed 我方速度(默认 0,只影响鸟翔阵)
 * @param enemySpeed 敌方速度(默认 0,只影响鸟翔阵)
  * @returns CoinRow[].
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
    单价材料: number | string = 材料
  ): CoinRow => {
    const 数量 = typeof 单价材料 === "number" ? buyCount(单价材料) : buyByName(单价材料);
    const 结果 = run(数量);
    return {攻击: 结果.atk,数量,方法,材料,结果};
  };
  return [
    make("三味真火","sanweizhenhuoTozhanli",n => sanweizhenhuoTozhanli(n,wanted)),
    make("五彩神石","wucaishenshiTozhanli",wucaishenshiTozhanli),
    make("历史本纪","lishibenjiTozhanli",lishibenjiTozhanli),
    make("寒铁","hantieTozhanli",n => hantieTozhanli(n,0)),
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
  ].toSorted((a,b) => b.攻击 - a.攻击);
}

// 把一条原始结果转成中文展示结果:数值经 formatSuoXie 变成带单位字符串,字段名译成中文.
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

// #endregion
// #region 精简打印与执行入口
// 精简打印只保留这 9 项属性;后 5 项带 % 后缀,是 config/property.json 里 percent=1 的百分比显示属性.
const KEY_PROPS = ["伤害加成%","命中%","幸运%","攻击","暴击%","暴击伤害%","穿透","速度","闪避%"] as const;

/**
 * 辅助方法:按攻击降序打印 20 条精简结果,每条一行中文文本,先列 KEY_PROPS 的 9 项属性, 再追加「输出」与「相对存档基准的提升率」;顶部打印查询条件,存档路径,敌人档位与基准输出.
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

// #endregion