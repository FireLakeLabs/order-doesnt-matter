// Original little courier: square helmet, antenna, oversized visor and flying scarf.
// 0 is transparent; the palette is supplied entirely by the frame's theme.
export const courier = [
  '0000002200000000',
  '0000002100000000',
  '0002222222220000',
  '0021111111112000',
  '0211111111111200',
  '0211113333331200',
  '0211113223321200',
  '0211113333331200',
  '0021111111112000',
  '0002222222220000',
  '4440211111200000',
  '0444211111220000',
  '0000211111242000',
  '0000222222200000',
];
export const coin = ['0022200', '0211120', '2112112', '2112112', '2112112', '0211120', '0022200'];
export const cloud = [
  '0000002222000000',
  '0000221111220000',
  '0022111111122200',
  '0211111111111120',
  '2222222222222222',
  '0000220002200000',
];
export function sprite(
  c: CanvasRenderingContext2D,
  map: readonly string[],
  x: number,
  y: number,
  palette: readonly string[],
) {
  x = Math.round(x);
  y = Math.round(y);
  for (let row = 0; row < map.length; row++)
    for (let col = 0; col < map[row].length; col++) {
      const index = Number(map[row][col]);
      if (!index) continue;
      c.fillStyle = palette[index - 1];
      c.fillRect(x + col, y + row, 1, 1);
    }
}
