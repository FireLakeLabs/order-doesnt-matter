import { controlNames, patternMethods } from '../strudel/evaluate-vocabulary';
export { controlNames, patternMethods };
export const canonicalName = (name: string) => controlNames.get(name) ?? name;
export const understoodControls = new Set(
  's note n gain velocity lpf hpf lpq hpq pan delay delaytime delayfeedback room roomsize orbit attack decay sustain release speed begin end cut clip legato vowel crush distort shape scale'
    .split(' ')
    .map(canonicalName),
);
export const signals = new Set('sine cosine saw isaw tri square perlin rand irand time'.split(' '));
export const rewrites = new Set(
  'fast slow early late rev ply euclid euclidRot degradeBy sometimes sometimesBy often rarely every firstOf off jux superimpose layer struct mask'.split(
    ' ',
  ),
);
export const groups = new Set(['stack', 'cat', 'seq', 'arrange']);
