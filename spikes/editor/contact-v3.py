from PIL import Image,ImageDraw
from pathlib import Path
import sys
folder=Path('shots/v3')
for round in sys.argv[1:]:
 for piece in ['real-techno','real-house-vocals','real-dnb-arranged','real-dubstep-arranged','switch-angel','micro-orbit-conflict','twenty']:
  names=[f'{round}-{piece}-{level}.jpg' for level in ['far','middle','near','phone-far','phone-middle','phone-near','inset']]
  phone=f'{round}-{piece}-phone-inset.jpg'
  if (folder/phone).exists():names.append(phone)
  if not all((folder/n).exists() for n in names):continue
  contact=Image.new('RGB',(960,520),'#101820');draw=ImageDraw.Draw(contact)
  for i,name in enumerate(names):
   image=Image.open(folder/name);image.thumbnail((236,225));x=(i%4)*240;y=(i//4)*260
   draw.text((x+4,y+4),name.replace(round+'-','').replace(piece+'-',''),fill='#bde2d2')
   contact.paste(image,(x+(240-image.width)//2,y+24))
  contact.save(folder/f'{round}-{piece}-contact.jpg',quality=58)
  for name in names:(folder/name).unlink()
