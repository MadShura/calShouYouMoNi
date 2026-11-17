"""临时脚本:导出 PresetEnemy_Config(敌人预设),用完删除。"""
import struct
import UnityPy

GAME = r"D:\game\steam\steamapps\common\MoNiShouYou"
ENTRY = open(r"d:/code/axl-studio/packages/projects/calShouYouMoNi/src/源码/YingLing.BattleSystem/EntryNameEnum.cs", encoding="utf-8").read()
NAMES = [n.strip().rstrip(",") for n in ENTRY.split("{", 1)[1].split("}")[0].strip().splitlines() if n.strip()]


def i32(buf, pos):
    return struct.unpack_from("<i", buf, pos)[0]


def data_start(buf):
    return (32 + i32(buf, 28) + 3) // 4 * 4


env = UnityPy.load(GAME + r"\MoNiShouYou_Data\sharedassets0.assets")
for obj in env.objects:
    if obj.type.name != "MonoBehaviour":
        continue
    try:
        cls = obj.read(check_read=False).m_Script.read().m_ClassName
    except Exception:
        continue
    if cls != "PresetEnemy_Config":
        continue
    buf = obj.get_raw_data()
    pos = data_start(buf)
    count = i32(buf, pos)
    pos += 4
    for _ in range(count):
        index = i32(buf, pos)
        entry, level, stay = struct.unpack_from("<iii", buf, pos + 16)
        pinzhi = i32(buf, pos + 28)
        offsety = struct.unpack_from("<f", buf, pos + 32)[0]
        pos += 36
        name = NAMES[entry] if 0 <= entry < len(NAMES) else str(entry)
        print(f"idx={index:3d} pinzhi={pinzhi} entry={name}({entry}) lv={level} stay={stay} ov={round(offsety,3)}")
    print("end", pos, "len", len(buf))
