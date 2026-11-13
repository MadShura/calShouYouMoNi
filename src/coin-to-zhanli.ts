/**
 * coin-to-zhanli.ts — 固定钱币 → 11 种材料 → 12 个 tozhanli 方法的完整对比(只导出一个方法)
 * 钱币换算按源码 PropHelper.GetPropValue(:29-38) 的「整批一次取整」:
 * round(单价 × 数量) ≤ 钱币 的最大整数数量；单价直接取 data.ts 的 MATERIAL_COST_PER_UNIT
 * (表内数值已是 ValueCost × (100−研究44 商店折扣)/100,不再二次打折).
 * 12 条结果原样保留各方法返回值,不折算成单一战力；数组按「攻击 atk」降序排列.
 * 结果结构说明:9 个新增方法为 ToZhanliResult(18 项固定值 + 18 项百分比 + 过程量),
 * 寒铁为 HantieToZhanliResult,强化石两个方法为 AllProperties;缺失字段即源码不产出该属性.
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
import {MATERIAL_COST_PER_UNIT} from "./data.ts";

/**
 * 给定固定钱币数,把 11 种材料各自能买到的数量投进对应的 12 个 tozhanli 方法,
 * 全部结果按攻击(atk)降序返回;每项含材料名,方法名,买到数量,攻击值与原始完整结果.
 * @param money 投入的钱币总数(默认 1 亿,可自行改默认值或调用时传入)
 */
export function compareByCoin (money = 1_0000_0000) {

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
  return [
    make("三味真火","sanweizhenhuoTozhanli",sanweizhenhuoTozhanli),
    make("五彩神石","wucaishenshiTozhanli",wucaishenshiTozhanli),
    make("历史本纪","lishibenjiTozhanli",lishibenjiTozhanli),
    make("寒铁","hantieTozhanli",n => hantieTozhanli(n,0,0)),
    make("强化石","qianghuazhiTozhanli1",qianghuazhiTozhanli1),
    make("强化石","qianghuazhiTozhanli2",qianghuazhiTozhanli2),
    make("御灵宝典","yulingbaodianTozhanli",yulingbaodianTozhanli),
    make("忘情水","wangqingshuiTozhanli",wangqingshuiTozhanli),
    make("灵晶","lingjingTozhanli",lingjingTozhanli),
    make("灵纹","lingwenTozhanli",lingwenTozhanli),
    make("破境石","pojingshiTozhanli",pojingshiTozhanli),
    make("神通卷轴","shentongjuanzhouTozhanli",shentongjuanzhouTozhanli)
  ].sort((a,b) => b.攻击 - a.攻击);
}

// 直接执行本文件时按攻击降序输出 12 条完整结果.
// 用 JSON.stringify 展开,避免 console.log 的深层嵌套被 [Object] 省略而看不到全部字段.
console.log(JSON.stringify(compareByCoin(),null,2));