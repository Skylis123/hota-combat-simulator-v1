import json, sys
from pathlib import Path
import cv2
import numpy as np
from PIL import Image

root=Path(__file__).resolve().parents[1]
source=Image.open(sys.argv[1]).convert('RGB')
source=source.crop((0,0,source.width,round(source.width/(800/556)))).resize((800,556))
screen=cv2.cvtColor(np.asarray(source),cv2.COLOR_RGB2BGR)
manifest=json.loads((root/'public/assets/creatures/detection/manifest.json').read_text())
for cid in (0,1,2,3,6,7):
    hits=[]
    for index,record in enumerate(manifest['creatures'][str(cid)]['frames']):
        rgba=cv2.imread(str(root/'public'/record['image']),cv2.IMREAD_UNCHANGED)
        for flip in (False,True):
            template=cv2.flip(rgba,1) if flip else rgba
            scores=cv2.matchTemplate(screen,template[:,:,:3],cv2.TM_CCORR_NORMED,mask=template[:,:,3])
            for _ in range(10):
                _,value,_,location=cv2.minMaxLoc(scores)
                hits.append((value,index,location,flip,record['left'],record['top']))
                x,y=location
                cv2.rectangle(scores,(max(0,x-20),max(0,y-30)),(min(scores.shape[1]-1,x+20),min(scores.shape[0]-1,y+30)),0,-1)
    print(cid,sorted(hits,reverse=True)[:15])
