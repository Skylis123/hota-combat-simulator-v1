from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
WIDTH, HEIGHT = 800, 556


def rgba(path):
    return np.asarray(Image.open(path).convert("RGBA"), dtype=np.float32)


def normalize(path):
    image = Image.open(path).convert("RGB")
    ratio = WIDTH / HEIGHT
    sw, sh = image.size
    if sw / sh > ratio:
        sw = round(sh * ratio)
    elif sw / sh < ratio:
        sh = round(sw / ratio)
    return np.asarray(image.crop((0, 0, sw, sh)).resize((WIDTH, HEIGHT)), dtype=np.float32)


def score(screen, background, template, x, y, flip=False, step=3):
    if flip:
        template = template[:, ::-1]
    h, w = template.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(WIDTH, x + w), min(HEIGHT, y + h)
    if x1 <= x0 or y1 <= y0:
        return -1, 0, 0, 0, 0, 0
    tile = template[y0-y:y1-y:step, x0-x:x1-x:step]
    alpha = tile[:, :, 3:4] / 255
    mask = alpha[:, :, 0] >= .3
    if not mask.any():
        return -1, 0, 0, 0, 0, 0
    actual = screen[y0:y1:step, x0:x1:step]
    base = background[y0:y1:step, x0:x1:step]
    expected = tile[:, :, :3] * alpha + base * (1 - alpha)
    baseline = np.abs(actual - base)[mask].sum()
    candidate = np.abs(actual - expected)[mask].sum()
    samples = mask.sum() * 3
    if baseline < samples * 2:
        return -1, 0, 0, 0, 0, 0
    observed = actual[mask].reshape(-1)
    reference = tile[:, :, :3][mask].reshape(-1)
    observed -= observed.mean()
    reference -= reference.mean()
    denominator = np.sqrt((observed*observed).sum() * (reference*reference).sum())
    correlation = float((observed*reference).sum()/denominator) if denominator else 0
    ratios = np.clip(actual / np.maximum(base, 12), 0.25, 2.0)
    illumination = np.median(ratios.reshape(-1, 3), axis=0)
    foreground = np.max(np.abs(actual - base * illumination), axis=2) > 34
    precision = float(foreground[mask].mean())
    intersection = (foreground & mask).sum()
    union = (foreground | mask).sum()
    overlap = float(intersection / union) if union else 0
    observed_rgb = actual[mask]
    reference_rgb = tile[:, :, :3][mask]
    observed_chroma = observed_rgb / np.maximum(observed_rgb.sum(axis=1, keepdims=True), 1)
    reference_chroma = reference_rgb / np.maximum(reference_rgb.sum(axis=1, keepdims=True), 1)
    chroma = float(1 - np.abs(observed_chroma.mean(axis=0) - reference_chroma.mean(axis=0)).mean())
    return (baseline-candidate)/baseline, 1-candidate/(samples*255), correlation, precision, overlap, chroma


def best(screen, background, template, x, y, rx, ry, stride, flip=True, sample=3):
    result = (-1, 0, 0, 0, 0, 0, x, y, False)
    for mirrored in ([False, True] if flip else [False]):
        for dy in range(-ry, ry+1, stride):
            for dx in range(-rx, rx+1, stride):
                gain, match, correlation, precision, overlap, chroma = score(screen, background, template, x+dx, y+dy, mirrored, sample)
                if (correlation, gain, match) > (result[2], result[0], result[1]):
                    result = (gain, match, correlation, precision, overlap, chroma, x+dx, y+dy, mirrored)
    return result


def main():
    full_image = Image.open(sys.argv[1]).convert("RGB")
    full = np.asarray(full_image, dtype=np.float32)
    screen = normalize(Path(sys.argv[1]))
    catalog = json.loads((ROOT / "public/data/battlefield-catalog.json").read_text())
    bg = next(item for item in catalog["backgrounds"] if item["id"] == "cmbkgrtr")
    background = rgba(ROOT / "public" / bg["image"])[:, :, :3]
    print("ABSOLUTE")
    results = []
    for obstacle in catalog["obstacles"]:
        if not obstacle["absolute"] or "grass" not in obstacle["allowedTerrains"]:
            continue
        template = rgba(ROOT / "public" / obstacle["image"])
        result = best(screen, background, template, obstacle["width"], obstacle["height"], 32, 32, 4, True, 3)
        results.append((result[4], result[5], result[2], obstacle["id"], obstacle["name"], *result[6:]))
    for item in sorted(results, reverse=True)[:10]: print(item)

    data = json.loads((ROOT / "public/data/simulator-v1-data.json").read_text())
    manifest = json.loads((ROOT / "public/assets/creatures/detection/manifest.json").read_text())
    print("ARMY BAR")
    scale = full_image.width / 1600
    for owner, positions in (("player", [(210 + 70*i)*scale for i in range(7)]), ("ai", [(844 + 70*i)*scale for i in range(7)])):
        found = []
        for slot_x in positions:
            options = []
            for creature in data["creatures"]:
                original = Image.open(ROOT / "public" / manifest["creatures"][str(creature["creatureId"])]["portrait"]).convert("RGBA")
                portrait_image = original.resize((round(58*scale), round(64*scale)))
                portrait_rgba = np.asarray(portrait_image, dtype=np.float32)
                portrait = portrait_rgba[:, :, :3]
                portrait_mask = portrait_rgba[:, :, 3] >= 128
                for y in range(round(1110*scale), min(round(1138*scale), full.shape[0]-portrait.shape[0])):
                    for x in range(round(slot_x-15*scale), round(slot_x+16*scale)):
                        actual = full[y:y+portrait.shape[0], x:x+portrait.shape[1]]
                        a = actual[portrait_mask].reshape(-1); a = a-a.mean()
                        b = portrait[portrait_mask].reshape(-1); b = b-b.mean()
                        corr = float((a*b).sum()/np.sqrt((a*a).sum()*(b*b).sum()))
                        options.append((corr, creature["name"], x, y))
            found.append(sorted(options, reverse=True)[0])
        print(owner, found)
    print("CREATURES (best global score around each expected occupied hex)")
    expected_hexes = [0, 30, 45, 60, 75, 90, 120, 67]
    for hex_id in expected_hexes:
        hexagon = next(item for item in data["battlefield"]["grid"]["hexes"] if item["id"] == hex_id)
        choices = []
        for creature in data["creatures"]:
            records = manifest["creatures"].get(str(creature["creatureId"]), {}).get("frames", [])
            indices = sorted(set(index for index in (7, 14, len(records) - 1) if 0 <= index < len(records)))
            for index in indices:
                record = records[index]
                template = rgba(ROOT / "public" / record["image"])
                x = round(hexagon["centerX"] - 202 + record["left"])
                y = round(hexagon["centerY"] - 226 + record["top"])
                result = best(screen, background, template, x, y, 6, 6, 2, True, 2)
                quality = max(0, result[2]) * .55 + result[5] * .3 + max(0, result[0]) * .15
                choices.append((quality, result[2], result[5], creature["name"], (index, *result[6:])))
        per_creature = {}
        for choice in choices:
            per_creature[choice[3]] = max(choice, per_creature.get(choice[3], choice))
        print(hex_id, hexagon["centerX"], hexagon["centerY"], sorted(per_creature.values(), reverse=True))


if __name__ == "__main__":
    main()
