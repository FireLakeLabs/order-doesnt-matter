import type { ViewFrame } from '../types';
import type { Scene } from './model';

interface Pose {
  hip: number;
  lean: number;
  near: number[];
  far: number[];
  arms: number[];
}
// Contact, down, pass, push, flight, opposite contact. Angles measured from down.
const poses: Pose[] = [
  { hip: 0.5, lean: 14, near: [28, 8], far: [-25, -90], arms: [-40, 30, 35, 120] },
  { hip: 0.45, lean: 16, near: [35, -45], far: [-10, -115], arms: [-30, 40, 25, 110] },
  { hip: 0.52, lean: 16, near: [-12, -20], far: [35, -55], arms: [-15, 60, 15, 90] },
  { hip: 0.5, lean: 18, near: [-25, -32], far: [60, -5], arms: [40, 125, -45, 20] },
  { hip: 0.56, lean: 15, near: [-30, -75], far: [45, 15], arms: [35, 120, -40, 25] },
  { hip: 0.5, lean: 14, near: [-25, -90], far: [28, 8], arms: [35, 120, -40, 30] },
];
function blend(a: Pose, b: Pose, t: number): Pose {
  const mix = (x: number, y: number) => x + (y - x) * t;
  const array = (x: number[], y: number[]) => x.map((v, i) => mix(v, y[i]));
  return {
    hip: mix(a.hip, b.hip),
    lean: mix(a.lean, b.lean),
    near: array(a.near, b.near),
    far: array(a.far, b.far),
    arms: array(a.arms, b.arms),
  };
}
export function runPose(phase: number, side = 0): Pose {
  const step = Math.min(4.999999, Math.max(0, phase) * 5);
  const a = poses[Math.floor(step)],
    b = poses[Math.floor(step) + 1];
  const p = blend(a, b, step % 1);
  return side
    ? { ...p, near: p.far, far: p.near, arms: [...p.arms.slice(2), ...p.arms.slice(0, 2)] }
    : p;
}
export function drawRunner(c: CanvasRenderingContext2D, f: ViewFrame, s: Scene) {
  let p = runPose(s.stride.phase, s.stride.side);
  const reach = (angles: number[]) =>
    0.27 * (Math.cos((angles[0] * Math.PI) / 180) + Math.cos((angles[1] * Math.PI) / 180));
  const flight =
    Math.sin(Math.PI * Math.max(0, Math.min(1, (s.stride.phase - 0.65) / 0.35))) * 0.035;
  p = { ...p, hip: Math.max(reach(p.near), reach(p.far)) + 0.045 + flight };

  if (s.airborne) {
    const u = s.jumpPhase;
    p = blend(
      p,
      {
        hip: 0.5,
        lean: 18 - u * 13,
        near: [65 - u * 40, -35 + u * 55],
        far: [40 - u * 20, -65 + u * 70],
        arms: [70 - u * 120, 140 - u * 240, 60 - u * 100, 130 - u * 220],
      },
      Math.sin(u * Math.PI) ** 0.35,
    );
  }
  if (s.absorb > 0)
    p = blend(
      p,
      {
        hip: 0.44,
        lean: 38,
        near: [60, -35],
        far: [40, -45],
        arms: [50, 80, 40, 70],
      },
      s.absorb,
    );
  if (s.vault !== undefined)
    p = blend(
      p,
      {
        hip: 0.32,
        lean: 60,
        near: [100, -100],
        far: [80, -110],
        arms: [70, -20, 70, -20],
      },
      Math.sin(s.vault * Math.PI),
    );
  c.save();
  c.translate(s.gate, s.feet);
  c.scale(s.size, s.size);
  if (s.roll !== undefined) {
    p = blend(
      p,
      { hip: 0.28, lean: 62, near: [95, -80], far: [100, -95], arms: [60, -70, 85, -65] },
      Math.sin(s.roll * Math.PI) ** 0.2,
    );
  }
  const step = (point: number[], angle: number, length: number) => [
    point[0] + Math.sin((angle * Math.PI) / 180) * length,
    point[1] + Math.cos((angle * Math.PI) / 180) * length,
  ];
  const hip = [0, -p.hip];
  const neck = step(hip, 180 - p.lean, 0.3);
  const head = step(neck, 180 - p.lean, 0.1);
  const shoulder = step(hip, 180 - p.lean, 0.27);
  if (s.roll !== undefined) {
    // Rest the rotating silhouette on the roof, including the hood and pack.
    const angle = s.roll * Math.PI * 2;
    const bounds = [
      { point: hip, radius: 0.075 },
      { point: neck, radius: 0.075 },
      { point: head, radius: 0.105 },
    ];
    for (const [origin, angles, lengths, radius] of [
      [hip, p.near, [0.27, 0.27], 0.045],
      [hip, p.far, [0.27, 0.27], 0.0375],
      [shoulder, p.arms.slice(0, 2), [0.16, 0.15], 0.035],
      [shoulder, p.arms.slice(2), [0.16, 0.15], 0.0325],
    ] as const) {
      const knee = step(origin, angles[0], lengths[0]);
      bounds.push({ point: knee, radius }, { point: step(knee, angles[1], lengths[1]), radius });
    }
    for (const x of [-0.09, 0.05])
      for (const y of [-0.12, 0.14]) {
        const a = (p.lean * Math.PI) / 180;
        bounds.push({
          point: [
            shoulder[0] - 0.11 + x * Math.cos(a) - y * Math.sin(a),
            shoulder[1] + 0.08 + x * Math.sin(a) + y * Math.cos(a),
          ],
          radius: 0,
        });
      }
    const bottom = Math.max(
      ...bounds.map(
        ({ point, radius }) =>
          point[0] * Math.sin(angle) + (point[1] + 0.29) * Math.cos(angle) - 0.29 + radius,
      ),
    );
    c.translate(0, -bottom - 0.29);
    c.rotate(angle);
    c.translate(0, 0.29);
  }
  const limb = (
    origin: number[],
    angles: number[],
    lengths: number[],
    colour: string,
    width: number,
  ) => {
    const joint = step(origin, angles[0], lengths[0]);
    const tip = step(joint, angles[1], lengths[1]);
    c.strokeStyle = colour;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(...(origin as [number, number]));
    c.lineTo(...(joint as [number, number]));
    c.lineTo(...(tip as [number, number]));
    c.stroke();
  };
  const ink = f.theme.glow ? '#0b090d' : '#241f2b';
  c.lineCap = 'round';
  c.lineJoin = 'round';
  limb(hip, p.far, [0.27, 0.27], '#5b4b59', 0.075);
  limb(shoulder, p.arms.slice(2), [0.16, 0.15], '#5b4b59', 0.065);
  // Compact pack hugs the upper back; no trailing coat geometry.
  c.save();
  c.translate(shoulder[0] - 0.11, shoulder[1] + 0.08);
  c.rotate((p.lean * Math.PI) / 180);
  c.fillStyle = '#66505d';
  c.fillRect(-0.09, -0.12, 0.14, 0.26);
  c.restore();
  limb(hip, [180 - p.lean, 180 - p.lean], [0.15, 0.15], ink, 0.15);
  limb(hip, p.near, [0.27, 0.27], ink, 0.09);
  limb(shoulder, p.arms.slice(0, 2), [0.16, 0.15], ink, 0.07);
  c.fillStyle = ink;
  c.beginPath();
  c.ellipse(head[0], head[1], 0.092, 0.105, 0.2, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#ffab63';
  c.lineWidth = 0.035;
  c.beginPath();
  c.moveTo(head[0] + 0.03, head[1] - 0.016);
  c.lineTo(head[0] + 0.1, head[1] + 0.007);
  c.stroke();
  c.restore();
}
