/**
 * coin-to-zhanli.ts — 固定钱币 → 11 种材料 → 12 个 tozhanli 方法的完整对比(导出全量对比 compareByCoin 与精简打印辅助方法 printKeyProps)
 * 钱币换算按源码 PropHelper.GetPropValue(:29-38) 的「整批一次取整」:
 * round(单价 × 数量) ≤ 钱币 的最大整数数量；单价直接取 data.ts 的 MATERIAL_COST_PER_UNIT
 * (表内数值已是 ValueCost × (100−研究44 商店折扣)/100,不再二次打折).
 * 12 条结果先按「攻击 atk」的数值降序排序,再按 DESIGN.md:89 的口径转成展示结果:
 * 数字用 readSave.ts 的 formatSuoXie(ToolClass.TranslateNumsToSuoXie:10 万以下整数,
 * 10 万起按 万/亿/兆/京... 每四位递进),字段名统一译成中文；
 * 所以 compareByCoin 返回的所有数值都是字符串(排序在格式化之前完成,不受影响).
 * 百分比字段名按源码核查结果标注:config/property.json 里 percent=1 的 13 项属性
 * (BattleData_Recorder.GetFinal 直接返回 True_Base_Value,GetZhanLi 把该值进乘区数组)数值即百分比点数,
 * 字段名加 % 后缀但数值不改;PercentAddition 类字段已含「百分比」字样,保持不动.
 * 结果结构说明:9 个新增方法为 ToZhanliResult(18 项固定值 + 18 项百分比 + 过程量),
 * 寒铁为 HantieToZhanliResult,强化石两个方法为 AllProperties;缺失字段即源码不产出该属性.
 * 神兵火炼/水炼只投「想要的属性」数组指定的炼化轨(默认 命中、速度):水炼 23 条轨里
 * 没有命中与速度,故忘情水默认结果为 0;传 伤害加成、暴伤 则选中该文档的 2 条伤害加成 + 6 条暴伤轨.
 */
import {
  hantieTozhanli,
  lingjingTozhanli,
  lingwenTozhanli,
  lishibenjiTozhanli,
  pojingshiTozhanli,
  qianghuazhiTozhanli1,
  qianghuazhiTozhanli2,
  sanweizhenhuoTozhanli,
  shentongjuanzhouTozhanli,
  wangqingshuiTozhanli,
  wucaishenshiTozhanli,
  yulingbaodianTozhanli
} from "./calzhanli.ts";
import {DEFAULT_WANTED_PROPERTIES,MATERIAL_COST_PER_UNIT} from "./data.ts";
import {formatSuoXie} from "./readSave.ts";

// 英文字段名 → 中文:覆盖 3 种返回类型的全部数值字段(18 项固定值,18 项百分比,7 个过程量,
// 寒铁特有的 10 个过程量);行级的 攻击/数量/方法/材料/结果 已是中文,不在表内.按字母序排列.
// 13 项 percent=1 属性的数值是百分比点数(源码 GetFinal 不乘,GetZhanLi 进乘区数组),字段名加 % 后缀;
// PercentAddition 类(xxxPercent)与 特殊百分比/战力百分比 本就是百分比且名字已标明,保持不动;
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
  zhanliPercent:         "战力百分比"
};

/**
 * 给定固定钱币数,把 11 种材料各自能买到的数量投进对应的 12 个 tozhanli 方法, 按攻击降序返回中文展示结果:所有数值经 formatSuoXie 转成带单位字符串,字段名全部中文.
 * 神兵火炼/水炼额外按 wanted 筛选炼化轨;默认只投 命中、速度,传 伤害加成、暴伤 则选中该文档的 2 条伤害加成 + 6 条暴伤轨.
 * @param money 投入的钱币总数(默认 1 亿,可自行改默认值或调用时传入)
 * @param wanted 想要的属性中文名数组(默认 命中、速度)
 */
export function compareByCoin (
  money = 1_0000_0000,
  wanted: readonly string[] = DEFAULT_WANTED_PROPERTIES
) {

  // 整批一次取整:求最大 N 使 Math.round(单价×N) ≤ money(二分避免浮点边界与逐个试算).
  const buyCount = (name: string): number => {
    const unit = MATERIAL_COST_PER_UNIT[name];
    if (unit === undefined) {
      throw new Error(`材料单价表里没有「${name}」`);
    }
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

  // 泛型保留各方法的原始返回类型,「结果」里所有字段都会被完整展示.
  const make = <T extends {atk: number}>(材料: string,方法: string,run: (n: number) => T) => {
    const 数量 = buyCount(材料);
    const 结果 = run(数量);
    return {攻击: 结果.atk,数量,方法,材料,结果};
  };
  const rows = [
    make("三味真火","sanweizhenhuoTozhanli",n => sanweizhenhuoTozhanli(n,wanted)),
    make("五彩神石","wucaishenshiTozhanli",wucaishenshiTozhanli),
    make("历史本纪","lishibenjiTozhanli",lishibenjiTozhanli),
    make("寒铁","hantieTozhanli",n => hantieTozhanli(n,0,0)),
    make("强化石","qianghuazhiTozhanli1",qianghuazhiTozhanli1),
    make("强化石","qianghuazhiTozhanli2",qianghuazhiTozhanli2),
    make("御灵宝典","yulingbaodianTozhanli",yulingbaodianTozhanli),
    make("忘情水","wangqingshuiTozhanli",n => wangqingshuiTozhanli(n,wanted)),
    make("灵晶","lingjingTozhanli",lingjingTozhanli),
    make("灵纹","lingwenTozhanli",lingwenTozhanli),
    make("破境石","pojingshiTozhanli",pojingshiTozhanli),
    make("神通卷轴","shentongjuanzhouTozhanli",shentongjuanzhouTozhanli)
  ].sort((a,b) => b.攻击 - a.攻击);

  // 先按数值排好序,再统一格式化;结果里的值全是 number,只需两层即可覆盖.
  return rows.map(row => ({
    攻击: formatSuoXie(row.攻击),
    数量: formatSuoXie(row.数量),
    方法: row.方法,
    材料: row.材料,
    结果: Object.fromEntries(Object.entries(row.结果)
      .map(([key,value]) => [FIELD_NAMES[key] ?? key,formatSuoXie(value as number)]))
  }));
}

// 精简打印只保留这 9 项属性;后 5 项带 % 后缀,是 config/property.json 里 percent=1 的百分比显示属性.
const KEY_PROPS = ["伤害加成%","命中%","幸运%","攻击","暴击%","暴击伤害%","穿透","速度","闪避%"] as const;

/**
 * 辅助方法:按攻击降序打印 12 条精简结果,每条一行中文文本,只列 KEY_PROPS 的 9 项属性(值为 0 也显示).
 * 顶部先打印一行「想要的属性」,便于确认当前查询条件;compareByCoin 仍返回全量结果.
 * 直接执行本文件时只调用本方法,以大幅减少输出内容.
 * @param money 投入的钱币总数(默认 1 亿,可自行改默认值或调用时传入)
 * @param wanted 想要的属性中文名数组(默认 命中、速度)
 */
export function printKeyProps (
  money = 1_0000_0000,
  wanted: readonly string[] = DEFAULT_WANTED_PROPERTIES
): void {
  console.log(`想要的属性:${wanted.join("、")}`);
  for (const row of compareByCoin(money,wanted)) {
    const props = KEY_PROPS.map(key => `${key}=${row.结果[key] ?? "0"}`).join(" ");
    console.log(`${row.材料} ${row.方法} ${props}`);
  }
}

// 直接执行本文件时只打印精简结果:1 行查询条件 + 12 行,每行一条中文文本.
printKeyProps();