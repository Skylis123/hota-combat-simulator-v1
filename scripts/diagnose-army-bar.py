import json, sys
from pathlib import Path
import cv2

root=Path(__file__).resolve().parents[1]
source=cv2.imread(sys.argv[1],cv2.IMREAD_COLOR)
manifest=json.loads((root/'public/assets/creatures/detection/manifest.json').read_text())
data=json.loads((root/'public/data/simulator-v1-data.json').read_text())
scale=source.shape[1]/1600
for owner,bases in [('player',[208+70*i for i in range(7)]),('ai',[844+70*i for i in range(7)])]:
 results=[]
 for base in bases:
  x0,x1=round((base-3)*scale),round((base+70)*scale)
  y0,y1=round(1108*scale),min(source.shape[0],round(1195*scale))
  crop=source[y0:y1,x0:x1]
  choices=[]
  for creature in data['creatures']:
   rgba=cv2.imread(str(root/'public'/manifest['creatures'][str(creature['creatureId'])]['queuePortrait']),cv2.IMREAD_UNCHANGED)
   for factor in (1.0,):
    template=cv2.resize(rgba,None,fx=factor*scale,fy=factor*scale,interpolation=cv2.INTER_NEAREST)
    if template.shape[0]>crop.shape[0] or template.shape[1]>crop.shape[1]:continue
    score=cv2.matchTemplate(crop,template[:,:,:3],cv2.TM_CCOEFF_NORMED)
    cv2.patchNaNs(score,0)
    _,value,_,location=cv2.minMaxLoc(score)
    choices.append((value,creature['name'],factor,(x0+location[0],y0+location[1])))
  results.append(sorted(choices,reverse=True)[:3])
 print(owner,results)
