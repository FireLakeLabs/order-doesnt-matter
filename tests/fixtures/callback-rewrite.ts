// Original Kiln-derived motifs (repository MIT); no borrowed composition.
export const callbackPiece = `setcpm(240);
const rate=2;
const bass=note("fs2 fs2 a2 cs3").s("triangle").lpf(700).gain(.45)
  .every(3,p=>p.rev().fast(2))
  .layer(left=>left.pan(.2),right=>right.pan(.8));
const pad=note("[fs3,a3,cs4] [e3,g3,b3]").s("triangle").slow(4).gain(.23);
arrange([3,stack(bass,pad)],[3,stack(bass,pad)])`;
