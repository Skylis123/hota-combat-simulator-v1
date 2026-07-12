from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
EXPECTED = None


def main():
    source = Image.open(sys.argv[1]).convert("RGB")
    source = source.crop((0, 0, source.width, round(source.width / (800 / 556)))).resize((800, 556))
    screen = cv2.cvtColor(np.asarray(source), cv2.COLOR_RGB2BGR)
    data = json.loads((ROOT / "public/data/simulator-v1-data.json").read_text())
    manifest = json.loads((ROOT / "public/assets/creatures/detection/manifest.json").read_text())
    catalog = json.loads((ROOT / "public/data/battlefield-catalog.json").read_text())
    background_record = next(item for item in catalog["backgrounds"] if item["id"] == "cmbkgrtr")
    background = cv2.imread(str(ROOT / "public" / background_record["image"]), cv2.IMREAD_COLOR)
    detections = []
    for hexagon in data["battlefield"]["grid"]["hexes"]:
        hex_id = hexagon["id"]
        px, py = round(hexagon["centerX"]), round(hexagon["centerY"])
        x0p, x1p = max(0, px - 34), min(800, px + 34)
        y0p, y1p = max(0, py - 55), min(556, py + 35)
        residual = np.mean(np.abs(screen[y0p:y1p, x0p:x1p].astype(float) - background[y0p:y1p, x0p:x1p].astype(float))) / 255
        if residual < .075:
            continue
        cx, cy = round(hexagon["centerX"]), round(hexagon["centerY"] + 22)
        results = []
        for creature in data["creatures"]:
            best = (-1, None)
            for index, record in enumerate(manifest["creatures"][str(creature["creatureId"])]["frames"]):
                rgba = cv2.imread(str(ROOT / "public" / record["image"]), cv2.IMREAD_UNCHANGED)
                for flipped in (False, True):
                    template = cv2.flip(rgba, 1) if flipped else rgba
                    predicted_x = round(hexagon["centerX"] - 202 + record["left"])
                    predicted_y = round(hexagon["centerY"] - 226 + record["top"])
                    x0, x1 = max(0, predicted_x - 6), min(800, predicted_x + template.shape[1] + 7)
                    y0, y1 = max(0, predicted_y - 6), min(556, predicted_y + template.shape[0] + 7)
                    search = screen[y0:y1, x0:x1]
                    if template.shape[0] > search.shape[0] or template.shape[1] > search.shape[1]:
                        continue
                    mask = template[:, :, 3]
                    score = cv2.matchTemplate(search, template[:, :, :3], cv2.TM_CCORR_NORMED, mask=mask)
                    _min, maximum, _minloc, location = cv2.minMaxLoc(score)
                    if maximum > best[0]:
                        best = (maximum, (index, x0 + location[0], y0 + location[1], flipped))
            results.append((best[0], creature["name"], best[1]))
        winner = max(results)
        if winner[0] >= .70 and (hexagon["col"] <= 2 or winner[0] >= .93):
            detections.append((winner[0], hex_id, hexagon["row"], hexagon["col"], winner[1], winner[2]))
    print("DETECTIONS")
    for detection in sorted(detections, reverse=True):
        print(detection)


if __name__ == "__main__":
    main()
