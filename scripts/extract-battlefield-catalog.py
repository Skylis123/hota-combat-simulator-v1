from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(r"D:\licenta_proiect")
APP = ROOT / "simulator-web"
sys.path.insert(0, str(ROOT / "scripts"))

from extract_visual_assets import build_lod_indexes, decode_def, find_payload  # noqa: E402
from extract_battlefield_assets import image_from_lod_payload  # noqa: E402


def load_json_with_comments(path: Path):
    text = re.sub(r"//.*", "", path.read_text(encoding="utf-8"))
    return json.loads(text)


def transparent_special_colors(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            red, green, blue, alpha = pixels[x, y]
            if (red, green, blue) in {(0, 255, 255), (255, 0, 255)}:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def fingerprint(image: Image.Image):
    sample = image.convert("RGB").resize((16, 11), Image.Resampling.BILINEAR)
    return [channel for pixel in sample.getdata() for channel in pixel]


def horizon_fingerprint(image: Image.Image):
    # The first 104 battlefield pixels contain the terrain skyline and are not
    # darkened by the combat-grid overlay. Ignore the hero area at far left.
    sample = image.convert("RGB").crop((96, 0, 800, 104)).resize((64, 8), Image.Resampling.BILINEAR)
    return [channel for pixel in sample.getdata() for channel in pixel]


def main() -> int:
    reference_config = ROOT / "_reference_vcmi" / "config" / "obstacles.json"
    if not reference_config.exists():
        raise SystemExit("Missing _reference_vcmi/config/obstacles.json")

    archives, by_name, _inventory = build_lod_indexes()
    obstacle_defs = load_json_with_comments(reference_config)
    obstacle_dir = APP / "public" / "assets" / "battlefields" / "obstacles"
    background_dir = APP / "public" / "assets" / "battlefields" / "backgrounds"
    obstacle_dir.mkdir(parents=True, exist_ok=True)
    background_dir.mkdir(parents=True, exist_ok=True)

    records = []
    missing = []
    for raw_id, definition in obstacle_defs.items():
        source_name = definition["animation"]
        payload, entry = find_payload(by_name, archives, source_name)
        if not payload or not entry:
            missing.append(source_name)
            continue
        if source_name.lower().endswith(".def"):
            _groups, decoded, meta = decode_def(payload)
            if meta.get("decodeErrors") or not decoded:
                missing.append(source_name)
                continue
            image = decoded[0].full_image.convert("RGBA")
        else:
            image = image_from_lod_payload(payload)
            if image is None:
                missing.append(source_name)
                continue
            image = transparent_special_colors(image)

        obstacle_id = int(raw_id)
        filename = f"obstacle-{obstacle_id:03d}.png"
        image.save(obstacle_dir / filename)
        terrains = definition.get("allowedTerrains", [])
        special = definition.get("specialBattlefields", [])
        category = terrains[0] if terrains else (special[0] if special else "special")
        records.append(
            {
                "id": obstacle_id,
                "name": Path(source_name).stem,
                "sourceName": source_name,
                "category": category,
                "allowedTerrains": terrains,
                "specialBattlefields": special,
                "width": definition["width"],
                "height": definition["height"],
                "blockedTiles": definition["blockedTiles"],
                "absolute": bool(definition.get("absolute")),
                "foreground": bool(definition.get("foreground")),
                "image": f"assets/battlefields/obstacles/{filename}",
                "imageWidth": image.width,
                "imageHeight": image.height,
            }
        )

    source_backgrounds = json.loads((ROOT / "exports" / "data" / "simulator_db" / "battlefields.json").read_text(encoding="utf-8"))["backgrounds"]
    backgrounds = []
    for source in source_backgrounds:
        source_path = ROOT / source["png"]
        target_path = background_dir / f"{source['id']}.png"
        shutil.copy2(source_path, target_path)
        image = Image.open(target_path)
        backgrounds.append(
            {
                "id": source["id"],
                "name": source["name"],
                "type": source["type"],
                "image": f"assets/battlefields/backgrounds/{source['id']}.png",
                "width": image.width,
                "height": image.height,
                "fingerprint": fingerprint(image),
                "horizonFingerprint": horizon_fingerprint(image),
            }
        )

    catalog = {
        "schemaVersion": 1,
        "source": "Local Heroes III LOD graphics + VCMI obstacle metadata cross-check",
        "obstacleCount": len(records),
        "missingGraphics": missing,
        "obstacles": records,
        "backgrounds": backgrounds,
    }
    (APP / "public" / "data" / "battlefield-catalog.json").write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    print(f"Exported {len(records)} obstacles and {len(backgrounds)} backgrounds; missing={len(missing)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
