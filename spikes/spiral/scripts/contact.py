from PIL import Image, ImageOps, ImageDraw
from pathlib import Path
programs=['alternation','every-four','polymeter','randomness','arrange-64','density-64','chop-striate','chords','signals','bare-values','long-overlap','full-piece','control-bags','no-repeat','heard-length']
for group in range(3):
    sheet=Image.new('RGB',(1380,1500),'#101720')
    draw=ImageDraw.Draw(sheet)
    for row,program in enumerate(programs[group*5:group*5+5]):
        for column,view in enumerate(['fly','ring','side']):
            path=Path(f'shots/{program}-{view}.png')
            if not path.exists(): continue
            shot=Image.open(path).convert('RGB').crop((310,154,1440,810))
            shot=ImageOps.contain(shot,(460,267))
            sheet.paste(shot,(column*460,row*300+25))
            draw.text((column*460+12,row*300+7),f'{program} / {view}',fill='#cbdde3')
    sheet.save(f'shots/contact-{group+1}.png')
