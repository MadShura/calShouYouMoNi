/**
 * calc-cache.ts — finalCal.ts 纯计算函数的 json 持久化缓存.
 * 大循环逐小时反复调用同一批纯函数(输入相同则输出相同),把结果按"函数名|参数"记进 json,
 * 下次进程直接读盘命中,避免重复做二分/BigInt 闭式计算.
 * value 含 BigInt → 用前缀标记序列化,读回时还原.
 */
import {existsSync,readFileSync,writeFileSync} from "node:fs";

const BIG = "big:";                       // BigInt 序列化前缀
const INFN = "num:Infinity";             // Infinity 标记
const NAN = "num:NaN";                   // NaN 标记
type Store = Record<string,unknown>;

// 每个缓存文件一份:启动时读一次,进程内命中走内存,结束时统一写回(避免逐次写盘).
class JsonCache {
  private readonly store: Store;
  private dirty = false;
  constructor (private readonly file: URL) {
    this.store = existsSync(file) ? JSON.parse(readFileSync(file,"utf8"),reviver) as Store : {};
  }
  get<T> (fn: string,args: readonly unknown[],compute: () => T): T {
    const key = `${fn}|${args.map(a => (typeof a === "bigint" ? a.toString() : String(a))).join("|")}`;
    if (Object.hasOwn(this.store,key)) {
      return this.store[key] as T;
    }
    const value = compute();
    this.store[key] = value;
    this.dirty = true;
    return value;
  }
  flush (): void {
    if (!this.dirty) {return;}
    writeFileSync(this.file,JSON.stringify(this.store,replacer,2),"utf8");
    this.dirty = false;
  }
  get size (): number {return Object.keys(this.store).length;}
}
function replacer (_key: string,value: unknown): unknown {
  if (typeof value === "bigint") {return `${BIG}${value.toString()}`;}
  if (typeof value === "number" && !Number.isFinite(value)) {
    return Number.isNaN(value) ? NAN : INFN;
  }
  return value;
}
function reviver (_key: string,value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith(BIG)) {return BigInt(value.slice(BIG.length));}
    if (value === INFN) {return Infinity;}
    if (value === NAN) {return NaN;}
  }
  return value;
}
export const CALC_CACHE = new JsonCache(new URL("../output/calc-cache.json",import.meta.url));
export const cacheFlush = (): void => {CALC_CACHE.flush();};
export const cacheSize = (): number => CALC_CACHE.size;