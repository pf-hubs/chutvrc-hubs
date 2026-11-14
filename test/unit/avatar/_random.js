/**
 * A seeded pseudo-random generator for the avatar tests, so that a failure reproduces: mulberry32, which
 * gives 2^32 distinct sequences and passes the usual statistical tests well enough for test inputs.
 * Files that start with an underscore are not run as tests by ava.
 */

/** Returns a function that yields numbers in [0, 1), the same sequence for the same seed */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function uniform(random, min, max) {
  return min + (max - min) * random();
}

/** An integer in [0, n) */
export function randomInt(random, n) {
  return Math.floor(random() * n);
}

/** A unit quaternion drawn uniformly from all rotations (Shoemake's method), as plain fields */
export function randomQuaternion(random) {
  const u1 = random();
  const u2 = 2 * Math.PI * random();
  const u3 = 2 * Math.PI * random();
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return { x: a * Math.sin(u2), y: a * Math.cos(u2), z: b * Math.sin(u3), w: b * Math.cos(u3) };
}

/** A unit vector drawn uniformly from the sphere, as plain fields */
export function randomDirection(random) {
  const z = uniform(random, -1, 1);
  const angle = uniform(random, 0, 2 * Math.PI);
  const r = Math.sqrt(1 - z * z);
  return { x: r * Math.cos(angle), y: r * Math.sin(angle), z };
}
