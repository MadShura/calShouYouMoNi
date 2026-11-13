"""从 MoNiShouYou 的 Unity 资源里导出脚本需要的配置数据。

数据来源：<游戏目录>/MoNiShouYou_Data/sharedassets0.assets 中的 ScriptableObject
输出目录：src//config/*.json

之所以手写字节解析：这是 Mono 打包，MonoBehaviour 没有类型树，
UnityPy 的 read_typetree() 读不了，但字段顺序与类型由反编译代码固定，
所以按声明顺序解析即可（Unity 序列化只做 4 字节对齐）。

用法：
    python extract-config.py
    python extract-config.py --game-dir "D:\\game\\steam\\steamapps\\common\\MoNiShouYou"
"""

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
from typing import Any

DEFAULT_GAME_DIR = r"D:\game\steam\steamapps\common\MoNiShouYou"

CONFIG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "config")

# 反编译代码里的 ScriptableObject 类名 -> 输出文件名
TARGETS = {
    "MingShang_Config_Data_File": "mingshang",
    "DiKuaiConfigData": "dikuai",
    "PropertySettingData_Configh": "property",
    "MapSettingData_Config": "maps",
    "GameDataSetting_Config": "game-data",
    "EquipPercent_Setting_Data_Config": "equip-percent",
    "YingLing_SettingData_Config": "yingling",
    "YuLing_Equi_LingQi_Data_Config": "lingqi",
    "ZhongJu_Config_Data": "zhongju",
}

# EntryNameEnum 前 35 项:灵器只用到 Default(0) 到 ZiJinBaGuaLu(34)
ENTRY_NAMES = [
    "Default",
    "SanGuoQunYing",
    "LiangShanQunXiong",
    "QingGuoQingCheng",
    "QianGuLiuFang",
    "ShenGuiZhiYi",
    "WanRenDi",
    "LuanShiMouCheng",
    "JiShiMingYi",
    "ZhongGangYiDan",
    "JieAoBuXun",
    "YiWuFanGu",
    "XuanYuanJian",
    "RenHuangYin",
    "LeiGongChui",
    "DongHuangZhong",
    "ShenNongDing",
    "WanHunFan",
    "ZhanXianFeiDao",
    "LingLongTa",
    "KunLunJing",
    "YangZhiYuJingPing",
    "HuangJinSheng",
    "HunYuanJinDou",
    "NvWaShi",
    "FuXiQin",
    "PanGuFu",
    "HouYiGong",
    "XingTianDun",
    "YingLongLin",
    "HeTu",
    "PanGuanBi",
    "ZhuQueYu",
    "WuJinHuoHuLu",
    "ZiJinBaGuaLu",
]


def i32(buf: bytes, pos: int) -> int:
    return struct.unpack_from("<i", buf, pos)[0]


def f64(buf: bytes, pos: int) -> float:
    return struct.unpack_from("<d", buf, pos)[0]


def f32(buf: bytes, pos: int) -> float:
    return struct.unpack_from("<f", buf, pos)[0]


def i64(buf: bytes, pos: int) -> int:
    return struct.unpack_from("<q", buf, pos)[0]


def data_start(buf: bytes) -> int:
    """MonoBehaviour 头：GameObject(12) + Enabled(1) + pad(3) + Script(12) + Name(4+len+pad4)。"""
    name_len = i32(buf, 28)
    pos = 32 + name_len
    return (pos + 3) // 4 * 4


def read_str(buf: bytes, pos: int) -> tuple[str, int]:
    length = i32(buf, pos)
    pos += 4
    text = buf[pos : pos + length].decode("utf-8")
    pos += length
    return text, (pos + 3) // 4 * 4


def parse_mingshang(buf: bytes) -> dict[str, Any]:
    pos = data_start(buf)
    sell_count = i32(buf, pos)
    pos += 4
    sell = []
    for _ in range(sell_count):
        index, prop, nums, price = struct.unpack_from("<iiii", buf, pos)
        pos += 16
        sell.append({"index": index, "prop": prop, "nums": nums, "price": price})
    buy_count = i32(buf, pos)
    pos += 4
    buy = []
    for _ in range(buy_count):
        index, prop, nums, price = struct.unpack_from("<iiii", buf, pos)
        pos += 16
        buy.append({"index": index, "prop": prop, "nums": nums, "price": price})
    assert pos == len(buf), f"冥商配置长度不符：{pos} != {len(buf)}"
    return {"sell": sell, "buy": buy}


def parse_dikuai(buf: bytes) -> list[dict[str, Any]]:
    pos = data_start(buf)
    count = i32(buf, pos)
    pos += 4
    out = []
    for _ in range(count):
        index = i32(buf, pos)
        col = i32(buf, pos + 4)
        pos += 8
        neighbor_count = i32(buf, pos)
        pos += 4
        neighbor = [i32(buf, pos + 4 * i) for i in range(neighbor_count)]
        pos += neighbor_count * 4
        level = i32(buf, pos)
        pos += 4
        out.append({"index": index, "col": col, "neighbor": neighbor, "level": level})
    assert pos == len(buf), f"地块配置长度不符：{pos} != {len(buf)}"
    return out


def parse_property(buf: bytes) -> list[dict[str, Any]]:
    pos = data_start(buf)
    count = i32(buf, pos)
    pos += 4
    out = []
    for _ in range(count):
        prop_type = i32(buf, pos)
        percent = buf[pos + 4]
        pos += 8
        name, pos = read_str(buf, pos)
        initial = i64(buf, pos)
        pos += 8
        out.append(
            {"type": prop_type, "percent": percent, "name": name, "initial": initial}
        )
    assert pos == len(buf), f"属性配置长度不符：{pos} != {len(buf)}"
    return out


def parse_maps(buf: bytes) -> list[dict[str, Any]]:
    pos = data_start(buf)
    count = i32(buf, pos)
    pos += 4
    out = []
    for _ in range(count):
        map_id = i32(buf, pos)
        pos += 4
        pos += 12 * 3  # Map_Pic / Map_Pic_S_Color / Map_Pic_S_WhiteBlack
        loulou_id = i32(buf, pos)
        jingying_id = i32(buf, pos + 4)
        boss_id = i32(buf, pos + 8)
        base_round = i32(buf, pos + 12)
        pos += 16
        growth = f64(buf, pos)
        pos += 8
        drops = []
        for _ in range(3):
            drop_count = i32(buf, pos)
            pos += 4
            pos += drop_count * 12
            drops.append(drop_count)
        effect_count = i32(buf, pos)
        pos += 4
        pos += effect_count * 16
        shengshou_index = i32(buf, pos)
        pos += 4
        pos += 12  # ShengShouData.Pic
        property1 = i32(buf, pos)
        property2 = i32(buf, pos + 4)
        property3 = i32(buf, pos + 8)
        remand_prop = i32(buf, pos + 12)
        pos += 16
        out.append(
            {
                "mapID": map_id,
                "louLouID": loulou_id,
                "jingYingID": jingying_id,
                "bossID": boss_id,
                "baseRound": base_round,
                "growth": growth,
                "shengShou": {
                    "index": shengshou_index,
                    "property1": property1,
                    "property2": property2,
                    "property3": property3,
                    "remandProp": remand_prop,
                },
            }
        )
    assert pos == len(buf), f"地图配置长度不符：{pos} != {len(buf)}"
    return out


def parse_game_data(buf: bytes) -> dict[str, Any]:
    pos = data_start(buf)
    make_equip_time = i32(buf, pos)
    npc_growth = f32(buf, pos + 4)
    return {"makeEquipTimeS": make_equip_time, "npcChengZhangSpeed": npc_growth}


def parse_equip_percent(buf: bytes) -> list[dict[str, Any]]:
    pos = data_start(buf)
    count = i32(buf, pos)
    pos += 4
    out = []
    for _ in range(count):
        pinzhi, initial_level, level_add = struct.unpack_from("<iii", buf, pos)
        pos += 12
        out.append(
            {"pinzhi": pinzhi, "initialLevel": initial_level, "percentLevelAdd": level_add}
        )
    assert pos == len(buf), f"炼器配置长度不符：{pos} != {len(buf)}"
    return out


def parse_yingling(buf: bytes) -> list[dict[str, Any]]:
    """YingLing_SettingData_Config：跳过前 4 个字段，只导出英灵索引/职业/羁绊。"""
    pos = data_start(buf)
    # WhenLevelUpAdditionProperty
    count = i32(buf, pos)
    pos += 4 + count * 4
    # PerPropertyAddition_WhenPer_100_Level / Per_100_Level_Add_YouShiShuXing
    pos += 8
    # YingLing_Type_LevelUp_Property
    levelup_count = i32(buf, pos)
    pos += 4
    for _ in range(levelup_count):
        pos += 4
        first = i32(buf, pos)
        pos += 4 + first * 4
        second = i32(buf, pos)
        pos += 4 + second * 4
    # yingLing_SettingDatasList
    count = i32(buf, pos)
    pos += 4
    out = []
    for _ in range(count):
        index = i32(buf, pos)
        yingling_type = i32(buf, pos + 4)
        pos += 8
        skill_count = i32(buf, pos)
        pos += 4
        skills = [i32(buf, pos + 4 * i) for i in range(skill_count)]
        pos += skill_count * 4
        bond_count = i32(buf, pos)
        pos += 4
        bonds = [i32(buf, pos + 4 * i) for i in range(bond_count)]
        pos += bond_count * 4
        skill_mo = i32(buf, pos)
        skill_shen = i32(buf, pos + 4)
        pos += 8
        out.append(
            {
                "index": index,
                "yingLingType": yingling_type,
                "skills": skills,
                "bonds": bonds,
                "skillMo": skill_mo,
                "skillShen": skill_shen,
            }
        )
    assert pos == len(buf), f"英灵配置长度不符：{pos} != {len(buf)}"
    return out


def parse_lingqi(buf: bytes) -> dict[str, Any]:
    """YuLing_Equi_LingQi_Data_Config：灵器(武器)等级面板 + 每把武器的 Entry。"""
    pos = data_start(buf)
    levelup = i32(buf, pos)
    pos += 4
    level_count = i32(buf, pos)
    pos += 4
    levels = []
    for _ in range(level_count):
        pinzhi, hp, atk, defense = struct.unpack_from("<iiii", buf, pos)
        pos += 16
        levels.append({"pinzhi": pinzhi, "hp": hp, "atk": atk, "def": defense})
    detail_count = i32(buf, pos)
    pos += 4
    weapons = []
    for index in range(detail_count):
        weapon_id, icon, entry, stay_round, fire, water = struct.unpack_from(
            "<iiiiii", buf, pos
        )
        pos += 24
        weapons.append(
            {
                "index": index + 1,
                "id": weapon_id,
                "icon": icon,
                "entryValue": entry,
                "entry": ENTRY_NAMES[entry] if 0 <= entry < len(ENTRY_NAMES) else f"Entry_{entry}",
                "stayRound": stay_round,
                "fire": fire,
                "water": water,
            }
        )
    assert pos == len(buf), f"灵器配置长度不符：{pos} != {len(buf)}"
    return {"levelUpRemandCount": levelup, "levels": levels, "weapons": weapons}


def parse_zhongju(buf: bytes) -> list[dict[str, Any]]:
    """ZhongJu_Config_Data：终局每档的 BossID 与 BattleData_Manager 面板。"""
    pos = data_start(buf)
    count = i32(buf, pos)
    pos += 4
    out = []
    for _ in range(count):
        tiaozhan, remand, effect = struct.unpack_from("<iii", buf, pos)
        pos += 12
        boss_count = i32(buf, pos)
        pos += 4
        bosses = [i32(buf, pos + 4 * i) for i in range(boss_count)]
        pos += boss_count * 4
        rec_count = i32(buf, pos)
        pos += 4
        stats = []
        for _ in range(rec_count):
            prop = i32(buf, pos)
            base = f64(buf, pos + 4)
            percent = i64(buf, pos + 12)
            pos += 20
            stats.append({"property": prop, "base": base, "percent": percent})
        out.append(
            {
                "tiaoZhanID": tiaozhan,
                "remandShiLianCengShu": remand,
                "additionEffect": effect,
                "bossID": bosses,
                "stats": stats,
            }
        )
    assert pos == len(buf), f"终局配置长度不符：{pos} != {len(buf)}"
    return out


def export_keji(game_dir: str) -> list[dict[str, Any]]:
    """导出研究配置（KeJi_Data_Json.txt），费用是 PropID 9 历史本纪。"""
    path = os.path.join(
        game_dir, "MoNiShouYou_Data", "StreamingAssets", "KeJi_Data_Json.txt"
    )
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8-sig", errors="ignore") as handle:
        for line in handle:
            text = line.strip()
            if not text.startswith("{"):
                continue
            raw = json.loads(text)
            effect = raw.get("Effect", {})
            fore = raw.get("ForeRemand", {})
            out.append(
                {
                    "id": raw.get("_id"),
                    "cost": raw.get("RemandCount"),
                    "maxLevel": raw.get("MaxLevel"),
                    "effectName": effect.get("EffectNameEnum"),
                    "property": effect.get("Params_1"),
                    "perLevel": effect.get("Params_2"),
                    "params3": effect.get("Params_3"),
                    "percent": effect.get("Bool_Value"),
                    "foreId": fore.get("KeJi_ID"),
                    "foreLevel": fore.get("KeJi_Level"),
                }
            )
    return out


def export_jiban(game_dir: str) -> list[dict[str, Any]]:
    """羁绊配置在 StreamingAssets/JiBan_Data_Json.txt 里（每行一个 JSON）。"""
    path = os.path.join(game_dir, "MoNiShouYou_Data", "StreamingAssets", "JiBan_Data_Json.txt")
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8-sig", errors="ignore") as handle:
        for line in handle:
            text = line.strip()
            if not text.startswith("{"):
                continue
            raw = json.loads(text)
            levels = []
            for item in raw.get("jiBanDatas", []):
                effect = item.get("EffectRecoder", {})
                levels.append(
                    {
                        "count": item.get("Count"),
                        "entry": effect.get("Params_1"),
                        "level": effect.get("Params_2"),
                    }
                )
            out.append(
                {
                    "id": raw.get("_id"),
                    "type": raw.get("ZhenRongJiBanTypeEnum"),
                    "levels": levels,
                }
            )
    return out


PARSERS = {
    "MingShang_Config_Data_File": parse_mingshang,
    "DiKuaiConfigData": parse_dikuai,
    "PropertySettingData_Configh": parse_property,
    "MapSettingData_Config": parse_maps,
    "GameDataSetting_Config": parse_game_data,
    "EquipPercent_Setting_Data_Config": parse_equip_percent,
    "YingLing_SettingData_Config": parse_yingling,
    "YuLing_Equi_LingQi_Data_Config": parse_lingqi,
    "ZhongJu_Config_Data": parse_zhongju,
}


def export_aoe_skills(game_dir: str) -> list[int]:
    """从语言文件里找出「对全部/全体敌人造成伤害」的技能 ID（Entry_Des_Skill_N）。"""
    path = os.path.join(
        game_dir, "MoNiShouYou_Data", "StreamingAssets", "Language", "JianTi_CHN.txt"
    )
    result: list[int] = []
    if not os.path.exists(path):
        return result
    keywords = ("全部敌人", "全体敌人", "所有敌人")
    with open(path, encoding="utf-8-sig", errors="ignore") as handle:
        for line in handle:
            if "Entry_Des_Skill_" not in line or "=" not in line:
                continue
            key, text = line.split("=", 1)
            key = key.strip()
            if not key.startswith("Entry_Des_Skill_"):
                continue
            if "造成" not in text:
                continue
            if not any(word in text for word in keywords):
                continue
            try:
                result.append(int(key[len("Entry_Des_Skill_") :]))
            except ValueError:
                continue
    return sorted(set(result))


def export_skill_texts(game_dir: str) -> dict[str, str]:
    """导出所有 Entry_Des_Skill_N 的描述，用于判断普攻/怒气与是否群攻。"""
    path = os.path.join(
        game_dir, "MoNiShouYou_Data", "StreamingAssets", "Language", "JianTi_CHN.txt"
    )
    result: dict[str, str] = {}
    if not os.path.exists(path):
        return result
    with open(path, encoding="utf-8-sig", errors="ignore") as handle:
        for line in handle:
            if "Entry_Des_Skill_" not in line or "=" not in line:
                continue
            key, text = line.split("=", 1)
            key = key.strip()
            if not key.startswith("Entry_Des_Skill_"):
                continue
            result[key[len("Entry_Des_Skill_") :]] = text.strip()
    return result


def export_shentong(game_dir: str) -> list[dict[str, Any]]:
    """导出神通配置（ShenTong_Data_Json.txt），用于算怒气上限/卷轴成本。"""
    path = os.path.join(game_dir, "MoNiShouYou_Data", "StreamingAssets", "ShenTong_Data_Json.txt")
    out = []
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8-sig", errors="ignore") as handle:
        for line in handle:
            text = line.strip()
            if not text.startswith("{"):
                continue
            raw = json.loads(text)
            effect = raw.get("effectRecoders", {})
            out.append(
                {
                    "id": raw.get("_id"),
                    "pinzhi": raw.get("PinZhi"),
                    "maxLevel": raw.get("MaxLevel"),
                    "effectName": effect.get("EffectNameEnum"),
                    "params1": effect.get("Params_1"),
                    "params2": effect.get("Params_2"),
                }
            )
    return out


def load_language_names(game_dir: str) -> dict[str, str]:
    """读取简体中文语言文件里的 Key = Value，用于把 PropID 翻译成道具名。"""
    path = os.path.join(
        game_dir, "MoNiShouYou_Data", "StreamingAssets", "Language", "JianTi_CHN.txt"
    )
    names: dict[str, str] = {}
    if not os.path.exists(path):
        return names
    with open(path, encoding="utf-8-sig", errors="ignore") as handle:
        for line in handle:
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            names[key.strip()] = value.strip()
    return names


def collect_names(language: dict[str, str]) -> dict[str, Any]:
    props = {}
    for key, value in language.items():
        if key.startswith("Prop_Name_"):
            props[key[len("Prop_Name_") :]] = value
    shengshou = {}
    for index in range(1, 6):
        shengshou[str(index)] = language.get(f"ShengShouName_{index}", "")
    maps = {}
    for index in range(1, 6):
        maps[str(index)] = language.get(f"Map_Name_{index}", "")
    ji_ban = {}
    for index in range(1, 13):
        ji_ban[str(index)] = language.get(f"JiBan_Name_{index}", "")
    ying_ling = {}
    for key, value in language.items():
        if key.startswith("YingLing_Name_"):
            ying_ling[key[len("YingLing_Name_") :]] = value
    ke_ji_name = {}
    ke_ji_min_name = {}
    for key, value in language.items():
        if key.startswith("KeJi_Name_"):
            ke_ji_name[key[len("KeJi_Name_") :]] = value
        elif key.startswith("KeJi_MinName_"):
            ke_ji_min_name[key[len("KeJi_MinName_") :]] = value
    return {
        "props": props,
        "shengShou": shengshou,
        "maps": maps,
        "jiBan": ji_ban,
        "yingLing": ying_ling,
        "keJiName": ke_ji_name,
        "keJiMinName": ke_ji_min_name,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="导出 MoNiShouYou 配置数据")
    parser.add_argument("--game-dir", default=DEFAULT_GAME_DIR)
    parser.add_argument("--out", default=CONFIG_DIR)
    args = parser.parse_args()

    try:
        import UnityPy
    except ImportError:
        print("缺少 UnityPy，请先执行：python -m pip install UnityPy", file=sys.stderr)
        return 1

    assets = os.path.join(args.game_dir, "MoNiShouYou_Data", "sharedassets0.assets")
    if not os.path.exists(assets):
        print(f"找不到资源文件：{assets}", file=sys.stderr)
        return 1

    env = UnityPy.load(assets)
    raw_by_class: dict[str, bytes] = {}
    for obj in env.objects:
        if obj.type.name != "MonoBehaviour":
            continue
        try:
            data = obj.read(check_read=False)
            className = data.m_Script.read().m_ClassName
        except Exception:
            continue
        if className in TARGETS and className not in raw_by_class:
            raw_by_class[className] = obj.get_raw_data()

    missing = [name for name in TARGETS if name not in raw_by_class]
    if missing:
        print(f"以下配置没有找到：{missing}", file=sys.stderr)
        return 1

    os.makedirs(args.out, exist_ok=True)
    for className, fileName in TARGETS.items():
        parsed = PARSERS[className](raw_by_class[className])
        path = os.path.join(args.out, f"{fileName}.json")
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(parsed, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        print(f"已导出 {path}")

    language = load_language_names(args.game_dir)

    # 灵器补充中文名与 Entry 描述(Prop_Name_<Icon_DES_NameID> / Entry_Des_<EntryName>)
    lingqi_path = os.path.join(args.out, "lingqi.json")
    with open(lingqi_path, encoding="utf-8") as handle:
        lingqi = json.load(handle)
    for weapon in lingqi["weapons"]:
        weapon["name"] = language.get(f"Prop_Name_{weapon['icon']}", "")
        weapon["entryText"] = language.get(f"Entry_Des_{weapon['entry']}", "")
    with open(lingqi_path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(lingqi, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"已补充灵器中文名：{lingqi_path}（{len(lingqi['weapons'])} 把）")

    names = collect_names(language)
    path = os.path.join(args.out, "names.json")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(names, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"已导出 {path}")

    ji_ban = export_jiban(args.game_dir)
    path = os.path.join(args.out, "jiban.json")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(ji_ban, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"已导出 {path}（{len(ji_ban)} 条羁绊）")

    ke_ji = export_keji(args.game_dir)
    path = os.path.join(args.out, "keji.json")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(ke_ji, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"已导出 {path}（{len(ke_ji)} 条研究）")

    aoe = export_aoe_skills(args.game_dir)
    path = os.path.join(args.out, "aoe-skills.json")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(aoe, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"已导出 {path}（{len(aoe)} 个群攻技能）")

    skill_texts = export_skill_texts(args.game_dir)
    path = os.path.join(args.out, "skill-text.json")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(skill_texts, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"已导出 {path}（{len(skill_texts)} 条技能描述）")

    shentong = export_shentong(args.game_dir)
    path = os.path.join(args.out, "shentong.json")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(shentong, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"已导出 {path}（{len(shentong)} 个神通）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
