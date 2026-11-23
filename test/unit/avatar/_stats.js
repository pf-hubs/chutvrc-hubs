/** Summaries of measured errors for the avatar tests, printed with t.log so the bounds show in the ava output */

const RAD_TO_DEG = 180 / Math.PI;

/**
 * The angle between two quaternions as rotations (q and -q are the same rotation), in degrees: 2 acos(|q1.q2|)
 * of the normalised quaternions, evaluated as 4 atan2(|q1 - q2|, |q1 + q2|) with q2 turned to q1's side,
 * which equals it and stays exact for tiny angles, where acos of a dot product near 1 cannot resolve less
 * than about 1e-6 degrees.
 */
export function quaternionAngleDeg(a, b) {
  const lengthA = Math.hypot(a.x, a.y, a.z, a.w);
  const lengthB = Math.hypot(b.x, b.y, b.z, b.w);
  const dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const s = dot < 0 ? -1 / lengthB : 1 / lengthB;
  const ax = a.x / lengthA;
  const ay = a.y / lengthA;
  const az = a.z / lengthA;
  const aw = a.w / lengthA;
  const bx = b.x * s;
  const by = b.y * s;
  const bz = b.z * s;
  const bw = b.w * s;
  const difference = Math.hypot(ax - bx, ay - by, az - bz, aw - bw);
  const sum = Math.hypot(ax + bx, ay + by, az + bz, aw + bw);
  return 4 * Math.atan2(difference, sum) * RAD_TO_DEG;
}

/** The difference of two angles in radians, brought into [-pi, pi] */
export function angleDifference(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** max, mean and 99th percentile (nearest rank) of a list of non-negative numbers */
export function summarize(values) {
  const n = values.length;
  if (n === 0) return { n: 0, max: NaN, mean: NaN, p99: NaN };
  let max = -Infinity;
  let sum = 0;
  for (const value of values) {
    if (value > max) max = value;
    sum += value;
  }
  const sorted = Float64Array.from(values).sort();
  const p99 = sorted[Math.min(n - 1, Math.max(0, Math.ceil(0.99 * n) - 1))];
  return { n, max, mean: sum / n, p99 };
}

/** "max 0.123 mean 0.045 p99 0.101 mm (n 20000)", the values multiplied by `scale` first */
export function format(summary, unit, scale = 1, digits = 3) {
  const f = value => (value * scale).toFixed(digits);
  return `max ${f(summary.max)} mean ${f(summary.mean)} p99 ${f(summary.p99)} ${unit} (n ${summary.n})`;
}

export function isFiniteXyz(v) {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function isFiniteQuat(q) {
  return isFiniteXyz(q) && Number.isFinite(q.w);
}
