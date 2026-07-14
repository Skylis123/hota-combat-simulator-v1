from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from collections import defaultdict
from pathlib import Path

from PIL import Image


APP_ROOT = Path(__file__).resolve().parent.parent
WORKSPACE_ROOT = APP_ROOT.parent
sys.path.insert(0, str(WORKSPACE_ROOT / "scripts"))

from extract_castle_battle_animations import (  # noqa: E402
    ANIMATION_GROUPS,
    remove_reserved_palette_colors,
    save_gif,
    shared_crop,
    tight_crop,
)
from extract_visual_assets import decode_def, make_spritesheet  # noqa: E402


CREATURE_ID = 1
CREATURE_DEF = "CHALBD.def"
PORTRAIT_INDEX = CREATURE_ID + 2
SOURCE_SUBDIRECTORY = Path("mods/heroes3DataPatch/content/sprites")
SOURCE_LABEL = "VCMI heroes3DataPatch/content/sprites (HotA creature assets)"
SIMULATOR_SOURCE_LABEL = "Horn of the Abyss\\HotA.lod (verified via VCMI heroes3DataPatch)"

EXPECTED_FILES = {
    "CHALBD.def": {
        "sha256": "db6f472b6a34d2e991f52e7f543276091017de26c2c9e25d6b744fb46d7c4264",
        "size": 188_363,
    },
    "TwCrPort/TwCrP003.png": {
        "sha256": "94e5caa7668410e34f8d0f3ea6add9e54f4a2dfba345390dcf73457631263140",
        "size": 8_731,
    },
    "CPrSmall/CPrSm003.png": {
        "sha256": "b0a5aebffad0837287f06ba2d29cbea8c3d77c8ee7fd2f14252f26f2c817bef8",
        "size": 2_380,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresh Halberdier visuals from the HotA assets distributed by VCMI."
    )
    parser.add_argument(
        "--vcmi-root",
        type=Path,
        help="Path to the VCMI Horn of the Abyss repository root.",
    )
    parser.add_argument(
        "--allow-unverified",
        action="store_true",
        help="Allow a source revision whose asset hashes differ from the audited revision.",
    )
    return parser.parse_args()


def resolve_vcmi_root(explicit_root: Path | None) -> Path:
    candidates = (
        [explicit_root.expanduser().resolve()]
        if explicit_root
        else [
            WORKSPACE_ROOT / ".tmp" / "hota-vcmi",
            WORKSPACE_ROOT / ".tmp" / "hota-vcmi-audit",
        ]
    )
    for candidate in candidates:
        if (candidate / SOURCE_SUBDIRECTORY / CREATURE_DEF).is_file():
            return candidate
    searched = ", ".join(str(path) for path in candidates)
    raise SystemExit(f"Could not find {CREATURE_DEF}; searched: {searched}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_source_assets(sprites_root: Path, allow_unverified: bool) -> dict[str, Path]:
    sources: dict[str, Path] = {}
    mismatches: list[str] = []
    for relative_name, expected in EXPECTED_FILES.items():
        path = sprites_root / Path(relative_name)
        if not path.is_file():
            raise SystemExit(f"Missing audited HotA asset: {path}")
        sources[relative_name] = path
        actual_size = path.stat().st_size
        actual_hash = sha256(path)
        if actual_size != expected["size"] or actual_hash != expected["sha256"]:
            mismatches.append(
                f"{relative_name}: size={actual_size}, sha256={actual_hash}"
            )
    if mismatches and not allow_unverified:
        details = "\n  ".join(mismatches)
        raise SystemExit(
            "The HotA assets differ from the audited VCMI revision. "
            "Review them or rerun with --allow-unverified:\n  " + details
        )
    return sources


def write_json(path: Path, value: object, written: list[Path]) -> None:
    path.write_text(
        json.dumps(value, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    written.append(path)


def clean_frames(decoded, reserved_colors):
    by_group = defaultdict(list)
    for frame in decoded:
        by_group[frame.group_index].append(
            remove_reserved_palette_colors(frame.full_image, reserved_colors)
        )
    return by_group


def refresh_combat_assets(
    payload: bytes,
    decoded,
    by_group,
    written: list[Path],
) -> None:
    output = APP_ROOT / "public" / "assets" / "creatures" / "animations" / str(CREATURE_ID)
    preview_root = APP_ROOT / "public" / "assets" / "creatures" / "png"
    spritesheet_root = APP_ROOT / "public" / "assets" / "creatures" / "spritesheets"
    output.mkdir(parents=True, exist_ok=True)
    preview_root.mkdir(parents=True, exist_ok=True)
    spritesheet_root.mkdir(parents=True, exist_ok=True)

    # CHALBD has HotA-specific groups 20/21 at indexes 13/14. They are not
    # ranged attacks, so only the melee animation set is exported here.
    animation_names = (
        "move",
        "idle",
        "hit",
        "defend",
        "death",
        "attack-up",
        "attack-front",
        "attack-down",
    )
    extracted: dict[str, object] = {}
    for name in animation_names:
        group_index, duration, loop, reverse = ANIMATION_GROUPS[name]
        images = list(by_group.get(group_index, []))
        if not images:
            raise SystemExit(f"{CREATURE_DEF} is missing required animation group {group_index} ({name})")
        if reverse:
            images.reverse()
        images = shared_crop(images)
        destination = output / f"{name}.gif"
        save_gif(images, destination, duration, loop)
        written.append(destination)
        extracted[name] = {
            "groupIndex": group_index,
            "frameCount": len(images),
            "durationMs": duration,
        }
        if name == "idle":
            preview = preview_root / f"{CREATURE_ID}.png"
            images[0].save(preview)
            written.append(preview)
        if name == "death":
            corpse = output / "corpse.png"
            tight_crop(images[-1]).save(corpse)
            written.append(corpse)
            extracted["corpse"] = {
                "source": "tight-cropped last rendered death frame, centered by the simulator"
            }

    movement_frames = shared_crop(list(by_group[ANIMATION_GROUPS["move"][0]]))
    sheet = make_spritesheet(movement_frames)
    if sheet is None:
        raise SystemExit(f"Could not build the {CREATURE_DEF} movement spritesheet")
    spritesheet = spritesheet_root / f"{CREATURE_ID}.png"
    sheet.save(spritesheet)
    written.append(spritesheet)

    manifest_path = (
        APP_ROOT
        / "public"
        / "assets"
        / "creatures"
        / "animations"
        / "castle-battle-animations.json"
    )
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["creatures"][str(CREATURE_ID)] = {
        "def": CREATURE_DEF,
        "archive": SOURCE_LABEL,
        "sourceSha256": hashlib.sha256(payload).hexdigest(),
        "animations": extracted,
    }
    write_json(manifest_path, manifest, written)


def refresh_detection_assets(
    sources: dict[str, Path],
    meta: dict[str, object],
    decoded,
    reserved_colors,
    written: list[Path],
) -> None:
    detection_root = APP_ROOT / "public" / "assets" / "creatures" / "detection"
    destination = detection_root / str(CREATURE_ID)
    destination.mkdir(parents=True, exist_ok=True)

    for stale in [*destination.glob("frame-*.png"), *destination.glob("idle-*.png")]:
        stale.unlink()

    portrait = destination / "portrait.png"
    queue_portrait = destination / "queue-portrait.png"
    shutil.copyfile(sources["CPrSmall/CPrSm003.png"], portrait)
    shutil.copyfile(sources["TwCrPort/TwCrP003.png"], queue_portrait)
    written.extend((portrait, queue_portrait))

    with Image.open(portrait) as image:
        if image.size != (32, 32):
            raise SystemExit(f"Unexpected CPrSm003 dimensions: {image.size}")
    with Image.open(queue_portrait) as image:
        if image.size != (58, 64):
            raise SystemExit(f"Unexpected TwCrP003 dimensions: {image.size}")

    exported: list[dict[str, object]] = []
    detection_frames = [frame for frame in decoded if frame.group_index < 3]
    for index, frame in enumerate(detection_frames):
        image = remove_reserved_palette_colors(frame.full_image, reserved_colors)
        box = image.getbbox()
        if not box:
            raise SystemExit(
                f"Transparent detection frame in {CREATURE_DEF}: group={frame.group_index}, frame={frame.frame_index}"
            )
        cropped = image.crop(box)
        filename = f"frame-{index}.png"
        path = destination / filename
        cropped.save(path)
        written.append(path)
        exported.append(
            {
                "image": f"assets/creatures/detection/{CREATURE_ID}/{filename}",
                "left": box[0],
                "top": box[1],
                "width": cropped.width,
                "height": cropped.height,
                "canvasWidth": meta["canvasWidth"],
                "canvasHeight": meta["canvasHeight"],
                "groupIndex": frame.group_index,
                "groupId": frame.group_id,
                "frameIndex": frame.frame_index,
            }
        )
    if len(exported) != 27:
        raise SystemExit(f"Expected 27 Halberdier detection frames, exported {len(exported)}")

    manifest_path = detection_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["creatures"][str(CREATURE_ID)] = {
        "def": CREATURE_DEF,
        "portrait": f"assets/creatures/detection/{CREATURE_ID}/portrait.png",
        "queuePortrait": f"assets/creatures/detection/{CREATURE_ID}/queue-portrait.png",
        "frames": exported,
    }
    write_json(manifest_path, manifest, written)


def refresh_simulator_asset_metadata(written: list[Path]) -> None:
    data_path = APP_ROOT / "public" / "data" / "simulator-v1-data.json"
    data = json.loads(data_path.read_text(encoding="utf-8"))
    creature = next(
        (
            entry
            for entry in data.get("creatures", [])
            if entry.get("creatureId") == CREATURE_ID
        ),
        None,
    )
    if creature is None:
        raise SystemExit(
            f"Could not find creatureId {CREATURE_ID} in {data_path.relative_to(APP_ROOT)}"
        )

    asset = creature.setdefault("asset", {})
    asset.update(
        {
            "displayImage": f"assets/creatures/png/{CREATURE_ID}.png",
            "idleAnimation": f"assets/creatures/animations/{CREATURE_ID}/idle.gif",
            "previewImage": f"assets/creatures/png/{CREATURE_ID}.png",
            "spritesheet": f"assets/creatures/spritesheets/{CREATURE_ID}.png",
            "assetStatus": "EXTRACTED",
            "sourceArchive": SIMULATOR_SOURCE_LABEL,
            "fallbackReason": None,
        }
    )
    write_json(data_path, data, written)


def main() -> int:
    args = parse_args()
    vcmi_root = resolve_vcmi_root(args.vcmi_root)
    sprites_root = vcmi_root / SOURCE_SUBDIRECTORY
    sources = validate_source_assets(sprites_root, args.allow_unverified)

    payload = sources[CREATURE_DEF].read_bytes()
    groups, decoded, meta = decode_def(payload)
    if meta.get("decodeErrors") or meta.get("unsupportedFrameFormats"):
        raise SystemExit(f"Could not decode {CREATURE_DEF} cleanly: {meta}")
    if len(groups) != 15 or len(decoded) != 85:
        raise SystemExit(
            f"Unexpected {CREATURE_DEF} layout: groups={len(groups)}, decodedFrames={len(decoded)}"
        )

    palette = payload[16 : 16 + 768]
    reserved_colors = {
        tuple(palette[index * 3 : index * 3 + 3])
        for index in range(8)
    }
    by_group = clean_frames(decoded, reserved_colors)

    written: list[Path] = []
    refresh_combat_assets(payload, decoded, by_group, written)
    refresh_detection_assets(sources, meta, decoded, reserved_colors, written)
    refresh_simulator_asset_metadata(written)

    print(f"Refreshed Halberdier assets from {vcmi_root}")
    print("Written files:")
    for path in sorted(set(written)):
        print(f"  {path.relative_to(APP_ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
