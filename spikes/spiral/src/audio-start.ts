import type {AudioPattern} from './strudel-web';

// At a new scheduler origin, a crossing whole span needs one onset at zero.
// Clamping the part as well preserves hasOnset; later parts retain their times.
export const startAt=(pattern:AudioPattern,cycle:number):AudioPattern=>
  pattern.early(cycle).withHapSpan(span=>span.withTime(time=>Number(time)<0?time.mul(0):time));
