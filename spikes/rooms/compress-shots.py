"""Preserve accent hue families while reducing screenshots to 256-colour PNG."""
from pathlib import Path
from PIL import Image
for path in Path('shots').glob('*.png'):
    image = Image.open(path).convert('RGB')
    image.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(path, optimize=True)
print(sum(p.stat().st_size for p in Path('shots').glob('*.png')), 'screenshot bytes')
