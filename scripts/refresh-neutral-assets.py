from __future__ import annotations

import hashlib
import json
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image

APP = Path(__file__).resolve().parent.parent
ROOT = APP.parent
sys.path.insert(0, str(ROOT / "scripts"))

from extract_castle_battle_animations import (  # noqa: E402
    ANIMATION_GROUPS,
    remove_reserved_palette_colors,
    save_gif,
    shared_crop,
    tight_crop,
)
from extract_visual_assets import build_lod_indexes, decode_def, find_payload, make_spritesheet  # noqa: E402

BASE_SPECS = [
    (116, "Gold Golem", "goldGolem", 5, "CGGOLE.DEF"),
    (117, "Diamond Golem", "diamondGolem", 6, "CDGOLE.DEF"),
    (132, "Azure Dragon", "azureDragon", 10, "CADRGN.DEF"),
    (133, "Crystal Dragon", "crystalDragon", 10, "CCDRGN.DEF"),
    (134, "Faerie Dragon", "faerieDragon", 8, "CFDRGN.DEF"),
    (135, "Rust Dragon", "rustDragon", 10, "CRSDGN.DEF"),
    (136, "Enchanter", "enchanter", 6, "CENCH.DEF"),
    (137, "Sharpshooter", "sharpshooter", 4, "CSHARP.DEF"),
    (139, "Peasant", "peasant", 1, "CPEAS.DEF"),
    (140, "Boar", "boar", 2, "CBOAR.DEF"),
    (141, "Mummy", "mummy", 3, "CMUMMY.DEF"),
    (142, "Nomad", "nomad", 3, "CNOMAD.DEF"),
    (143, "Rogue", "rogue", 2, "CROGUE.DEF"),
    (144, "Troll", "troll", 5, "CTROLL.DEF"),
]

HOTA_SPECS = [
    (167, "Satyr", "satyr", 4, "CSATYR.def", 169),
    (168, "Fangarm", "fangarm", 5, "CFANGARM.DEF", 170),
    (169, "Leprechaun", "leprechaun", 2, "CLEPRCHN.def", 171),
    (170, "Steel Golem", "steelGolem", 4, "cstlgole.def", 172),
]

HOTA_STATS = {
    167: dict(attack=10, defense=11, minDamage=6, maxDamage=10, hp=35, speed=7, shots=0, growth=4, aiValue=518, fightValue=471, costGold=300),
    168: dict(attack=12, defense=12, minDamage=8, maxDamage=12, hp=50, speed=6, shots=0, growth=3, aiValue=929, fightValue=929, costGold=600),
    169: dict(attack=8, defense=5, minDamage=3, maxDamage=5, hp=15, speed=5, shots=0, growth=9, aiValue=190, fightValue=190, costGold=100),
    170: dict(attack=10, defense=11, minDamage=6, maxDamage=8, hp=45, speed=6, shots=0, growth=4, aiValue=597, fightValue=597, costGold=400),
}

ABILITIES = {
    116: [("nonLiving", "Non-living construct."), ("golem", "Golem; spell damage is reduced by 85%.")],
    117: [("nonLiving", "Non-living construct."), ("golem", "Golem; spell damage is reduced by 95%.")],
    132: [("flying", "Flying creature."), ("twoHex", "Two-hex creature."), ("breathAttack", "Breath attack also hits the unit directly behind the target."), ("fearAura", "Enemy living creatures have a 10% Fear check before acting."), ("spellImmunity", "Immune to spell levels 1-3 (spell mechanic pending).")],
    133: [("twoHex", "Two-hex creature."), ("magicResistance", "20% chance to resist hostile spells (spell mechanic pending)."), ("crystalGeneration", "Generates crystals on the adventure map.")],
    134: [("flying", "Flying creature."), ("twoHex", "Two-hex creature."), ("magicMirror", "20% Magic Mirror (spell mechanic pending)."), ("spellcaster", "Casts Magic Arrow, Ice Bolt, Lightning Bolt, Chain Lightning, Frost Ring, Fireball, Inferno and Meteor Shower; names only until spells are implemented.")],
    135: [("flying", "Flying creature."), ("twoHex", "Two-hex creature."), ("breathAttack", "Breath attack also hits the unit directly behind the target."), ("acidBreath", "Each attack reduces target Defense by 3; 30% chance for 25 extra damage per Rust Dragon.")],
    136: [("shooter", "Shooter; 32 shots."), ("noMeleePenalty", "No melee penalty."), ("noWallPenalty", "No wall penalty."), ("spellcaster", "Group-casts Haste, Slow, Stone Skin, Bless, Weakness or Air Shield; names only until spells are implemented.")],
    137: [("shooter", "Shooter; 32 shots."), ("noRangePenalty", "No range penalty."), ("noWallPenalty", "No wall penalty.")],
    139: [],
    140: [("twoHex", "Two-hex creature.")],
    141: [("undead", "Undead creature."), ("spellAfterAttack", "50% chance to cast Curse after attack; name only until spells are implemented.")],
    142: [("twoHex", "Two-hex creature."), ("sandWalker", "Removes sand terrain movement penalty on the adventure map.")],
    143: [("visions", "Provides Visions expertise on the adventure map.")],
    144: [("regeneration", "Regenerates up to 50 HP at the start of its turn without resurrecting units.")],
    167: [("spellcaster", "Casts Advanced Mirth three times per battle for 6 turns; name only until spells are implemented.")],
    168: [("flying", "Flying creature."), ("unlimitedRetaliations", "Unlimited retaliations."), ("mindImmunity", "Immune to mind spells."), ("spellAfterAttack", "Casts Advanced Hypnotize after attack; name only until spells are implemented.")],
    169: [("spellcaster", "Casts Advanced Fortune three times per battle for 6 turns; name only until spells are implemented."), ("luckAura", "Doubles the Luck trigger chance of friendly units.")],
    170: [("nonLiving", "Non-living construct."), ("golem", "Golem; spell damage is reduced by 80%.")],
}

DOUBLE_WIDE = {132, 133, 134, 135, 140, 142}


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def clean_frames(payload: bytes, decoded):
    palette = payload[16 : 16 + 768]
    reserved = {tuple(palette[index * 3 : index * 3 + 3]) for index in range(8)}
    return reserved, [
        (frame, remove_reserved_palette_colors(frame.full_image, reserved))
        for frame in decoded
    ]


def export_creature(spec, payload: bytes, portrait: Image.Image, queue_portrait: Image.Image, source_label: str):
    creature_id, name, internal_name, tier, def_name = spec[:5]
    _groups, decoded, meta = decode_def(payload)
    if meta.get("decodeErrors") or not decoded:
        raise SystemExit(f"Could not decode {def_name}: {meta}")
    reserved, cleaned = clean_frames(payload, decoded)
    by_group = defaultdict(list)
    frame_by_group = defaultdict(list)
    for frame, image in cleaned:
        by_group[frame.group_index].append(image)
        frame_by_group[frame.group_index].append(frame)

    animation_root = APP / "public/assets/creatures/animations" / str(creature_id)
    detection_root = APP / "public/assets/creatures/detection" / str(creature_id)
    preview_root = APP / "public/assets/creatures/png"
    spritesheet_root = APP / "public/assets/creatures/spritesheets"
    for directory in (animation_root, detection_root, preview_root, spritesheet_root):
        directory.mkdir(parents=True, exist_ok=True)
    for stale in [*animation_root.glob("*.gif"), *detection_root.glob("frame-*.png")]:
        stale.unlink()

    actions = []
    animation_meta = {}
    for action, (group_index, duration, loop, reverse) in ANIMATION_GROUPS.items():
        images = list(by_group.get(group_index, []))
        if not images:
            continue
        if reverse:
            images.reverse()
        images = shared_crop(images)
        save_gif(images, animation_root / f"{action}.gif", duration, loop)
        actions.append(action)
        animation_meta[action] = {"groupIndex": group_index, "frameCount": len(images), "durationMs": duration}
        if action == "idle":
            images[0].save(preview_root / f"{creature_id}.png")
        if action == "death":
            tight_crop(images[-1]).save(animation_root / "corpse.png")
            animation_meta["corpse"] = {"source": "tight-cropped last death frame"}
    required = {"move", "idle", "hit", "defend", "death", "attack-front"}
    if not required.issubset(actions):
        raise SystemExit(f"{def_name} missing animations: {sorted(required - set(actions))}")
    sheet = make_spritesheet(shared_crop(list(by_group[ANIMATION_GROUPS["move"][0]])))
    if sheet is None:
        raise SystemExit(f"Could not create spritesheet for {def_name}")
    sheet.save(spritesheet_root / f"{creature_id}.png")

    portrait.convert("RGBA").save(detection_root / "portrait.png")
    queue_portrait.convert("RGBA").save(detection_root / "queue-portrait.png")
    detection_frames = [(frame, image) for frame, image in cleaned if frame.group_index < 3]
    exported_frames = []
    for index, (frame, image) in enumerate(detection_frames):
        box = image.getbbox()
        if not box:
            continue
        cropped = image.crop(box)
        filename = f"frame-{index}.png"
        cropped.save(detection_root / filename)
        exported_frames.append({
            "image": f"assets/creatures/detection/{creature_id}/{filename}",
            "left": box[0], "top": box[1], "width": cropped.width, "height": cropped.height,
            "canvasWidth": meta["canvasWidth"], "canvasHeight": meta["canvasHeight"],
            "groupIndex": frame.group_index, "groupId": frame.group_id, "frameIndex": frame.frame_index,
        })
    digest = sha256(payload)
    asset = {
        "displayImage": f"assets/creatures/png/{creature_id}.png",
        "idleAnimation": f"assets/creatures/animations/{creature_id}/idle.gif",
        "previewImage": f"assets/creatures/png/{creature_id}.png",
        "spritesheet": f"assets/creatures/spritesheets/{creature_id}.png",
        "corpseImage": f"assets/creatures/animations/{creature_id}/corpse.png",
        "battleAnimationRoot": f"assets/creatures/animations/{creature_id}",
        "battleAnimationActions": [*actions, "corpse"],
        "portrait": f"assets/creatures/detection/{creature_id}/portrait.png",
        "queuePortrait": f"assets/creatures/detection/{creature_id}/queue-portrait.png",
        "assetStatus": "EXTRACTED", "sourceArchive": source_label, "sourceAsset": def_name,
        "sourceSha256": digest, "fallbackReason": None,
    }
    detection = {
        "def": def_name, "sourceSha256": digest,
        "portrait": asset["portrait"], "queuePortrait": asset["queuePortrait"], "frames": exported_frames,
    }
    animation = {"def": def_name, "archive": source_label, "sourceSha256": digest, "animations": animation_meta}
    return asset, detection, animation


def main() -> int:
    archives, by_name, _inventory = build_lod_indexes()
    source_data = json.loads((ROOT / "exports/data/simulator_db/neutral_creatures.json").read_text(encoding="utf-8"))["creatures"]
    source_by_id = {entry["creatureId"]: entry for entry in source_data}
    portrait_payload, _ = find_payload(by_name, archives, "cprsmall.def")
    queue_payload, _ = find_payload(by_name, archives, "twcrport.def")
    _pg, portrait_frames, _pm = decode_def(portrait_payload or b"")
    _qg, queue_frames, _qm = decode_def(queue_payload or b"")
    portrait_palette = portrait_payload[16 : 16 + 768]
    portrait_reserved = {tuple(portrait_palette[index * 3 : index * 3 + 3]) for index in range(8)}
    hota_root = ROOT / ".tmp/hota-vcmi-audit/mods/neutralCreatures/content/sprites/hota/creatures"

    detection_path = APP / "public/assets/creatures/detection/manifest.json"
    animation_path = APP / "public/assets/creatures/animations/castle-battle-animations.json"
    detection_manifest = json.loads(detection_path.read_text(encoding="utf-8"))
    animation_manifest = json.loads(animation_path.read_text(encoding="utf-8"))
    creatures = []

    for spec in BASE_SPECS:
        creature_id, name, internal_name, tier, def_name = spec
        payload, entry = find_payload(by_name, archives, def_name)
        if not payload or not entry:
            raise SystemExit(f"Missing {def_name}")
        portrait = remove_reserved_palette_colors(portrait_frames[creature_id + 2].full_image, portrait_reserved)
        queue = queue_frames[creature_id + 2].full_image
        asset, detection, animation = export_creature(spec, payload, portrait, queue, str(entry.archive))
        source = source_by_id[creature_id]
        raw = source["stats"]
        stats = {
            "attack": raw["attack"], "defense": raw["defense"], "minDamage": raw["minDamage"], "maxDamage": raw["maxDamage"],
            "hp": raw["health"], "speed": raw["speed"], "shots": raw["shots"], "growth": raw["growth"],
            "aiValue": raw["aiValue"], "fightValue": raw["fightValue"], "costGold": raw["cost"]["gold"],
        }
        creatures.append(creature_record(spec, stats, asset))
        detection_manifest["creatures"][str(creature_id)] = detection
        animation_manifest["creatures"][str(creature_id)] = animation
        print(f"Neutral {creature_id} {name}: {len(detection['frames'])} detection frames")

    for raw_spec in HOTA_SPECS:
        creature_id, name, internal_name, tier, def_name, portrait_index = raw_spec
        source = hota_root / "battle" / def_name
        payload = source.read_bytes()
        portrait = Image.open(hota_root / "iconsSmall" / f"CPrSm{portrait_index}.png")
        queue = Image.open(hota_root / "iconsLarge" / f"TwCrP{portrait_index}.png")
        spec = raw_spec[:5]
        asset, detection, animation = export_creature(spec, payload, portrait, queue, "VCMI Horn of the Abyss neutral creatures 1.2")
        creatures.append(creature_record(spec, HOTA_STATS[creature_id], asset))
        detection_manifest["creatures"][str(creature_id)] = detection
        animation_manifest["creatures"][str(creature_id)] = animation
        print(f"Neutral {creature_id} {name}: {len(detection['frames'])} detection frames")

    rows = []
    for tier in sorted({creature["tier"] for creature in creatures}):
        entries = [{"creatureId": creature["creatureId"]} for creature in creatures if creature["tier"] == tier]
        for offset in range(0, len(entries), 2):
            variant = offset // 2
            rows.append({
                "tier": tier, "label": f"L{tier}" if variant == 0 else f"L{tier} {'II' if variant == 1 else 'III'}",
                "entries": entries[offset : offset + 2],
            })
    neutral_data = {
        "schemaVersion": 1,
        "source": "Local HotA CRTRAITS + VCMI neutral creature configs + official HotA neutral documentation",
        "town": {"townType": 12, "name": "Neutral", "origin": "Horn of the Abyss", "nativeTerrain": "grass", "battlefield": "cmbkgrtr", "rosterRows": rows},
        "creatures": creatures,
    }
    (APP / "public/data/neutral-creatures.json").write_text(json.dumps(neutral_data, indent=2) + "\n", encoding="utf-8")
    detection_path.write_text(json.dumps(detection_manifest, indent=2) + "\n", encoding="utf-8")
    animation_path.write_text(json.dumps(animation_manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(creatures)} neutral creatures.")
    return 0


def creature_record(spec, stats, asset):
    creature_id, name, internal_name, tier, _def_name = spec
    return {
        "creatureId": creature_id, "name": name, "internalName": internal_name, "tier": tier,
        "faction": "Neutral", "doubleWide": creature_id in DOUBLE_WIDE,
        "stats": stats,
        "abilities": [{"key": key, "kind": "passive", "details": details} for key, details in ABILITIES[creature_id]],
        "asset": asset,
    }


if __name__ == "__main__":
    raise SystemExit(main())
