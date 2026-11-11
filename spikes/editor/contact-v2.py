from PIL import Image,ImageOps,ImageDraw
from pathlib import Path
root=Path(__file__).parent/'shots/v2'
for r in ['before','round1','round2','round3','round4','after']:
 files=[root/f'{r}-{p}-{m}.jpg' for p in ['real-house','real-techno','real-house-vocals','real-dnb-arranged','switch-angel','twenty'] for m in ['sheet','constellation']]
 if not all(p.exists() for p in files): continue
 sheet=Image.new('RGB',(1920,2140),'#101820'); draw=ImageDraw.Draw(sheet)
 for i,p in enumerate(files):
  im=Image.open(p);im.thumbnail((640,480))
  x=(i%3)*640;y=(i//3)*535
  sheet.paste(im,(x,y+28));draw.text((x+8,y+7),p.stem,fill='white')
 sheet.save(root/f'contact-{r}.jpg',quality=72,optimize=True)
