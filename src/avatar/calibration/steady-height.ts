/**
 * Whether the headset has been held at one height long enough to take that height: the pure part of the
 * capture in VR (vr-capture.ts) for a player without controllers. It is fed one sample a frame, the headset's height over the floor in real
 * metres and how far the head is tilted from level, and answers once the samples of the last second have
 * all stayed within a few centimetres with the head about level, or once too long has passed without that.
 * No scene access; nothing is allocated per sample.
 */

/** How long the headset has to stay steady, in seconds */
export const CAPTURE_STEADY_SECONDS = 1;
/** How long the capture waits for a steady second before the entered height is used alone, in seconds */
export const CAPTURE_TIMEOUT_SECONDS = 10;
/** The headset counts as steady while its height stays within this range, in real metres */
export const CAPTURE_STEADY_RANGE = 0.03;
/**
 * The head counts as upright and looking ahead while its up axis is tilted from the vertical by no more than
 * this, in radians (20°): pitch and roll together
 */
export const CAPTURE_TILT_LIMIT = (20 * Math.PI) / 180;
/** Headset heights a seated or standing player can have, in real metres; anything else is a tracking gap */
export const MIN_CAPTURE_HEIGHT = 0.5;
export const MAX_CAPTURE_HEIGHT = 2.6;

/** The samples kept at most: a second at a refresh rate well above any headset's */
const MAX_SAMPLES = 1024;

export type SteadyHeightResult = { status: "waiting" } | { status: "steady"; height: number } | { status: "timedOut" };

export type SteadyHeightDetector = {
  /** The time of each sample in the current steady run, in seconds, oldest first */
  times: Float64Array;
  heights: Float64Array;
  /** Where the run starts in the ring and how many samples it has */
  start: number;
  count: number;
  /** The time of the first sample since the detector was reset; null before it */
  startedAt: number | null;
};

const WAITING: SteadyHeightResult = Object.freeze({ status: "waiting" });
const TIMED_OUT: SteadyHeightResult = Object.freeze({ status: "timedOut" });

export function createSteadyHeightDetector(): SteadyHeightDetector {
  return {
    times: new Float64Array(MAX_SAMPLES),
    heights: new Float64Array(MAX_SAMPLES),
    start: 0,
    count: 0,
    startedAt: null
  };
}

/** Starts over: the next sample begins a new capture and its timeout */
export function resetSteadyHeightDetector(detector: SteadyHeightDetector) {
  detector.start = 0;
  detector.count = 0;
  detector.startedAt = null;
}

/**
 * The angle between the head's up axis and the vertical, for the head's orientation as a unit quaternion:
 * 0 for a level head whichever way it faces, growing with pitch and roll alike
 */
export function headTiltOf(quaternion: { readonly x: number; readonly z: number }): number {
  // The y component of the up axis (0, 1, 0) turned by the quaternion
  const { x, z } = quaternion;
  const upY = 1 - 2 * (x * x + z * z);
  return Math.acos(Math.min(1, Math.max(-1, upY)));
}

function isUsableSample(height: number, tilt: number): boolean {
  return (
    Number.isFinite(height) &&
    Number.isFinite(tilt) &&
    height >= MIN_CAPTURE_HEIGHT &&
    height <= MAX_CAPTURE_HEIGHT &&
    tilt <= CAPTURE_TILT_LIMIT
  );
}

/** How long the headset has been steady up to its latest usable sample, in seconds; 0 without a steady run */
export function steadyRunSeconds(detector: SteadyHeightDetector): number {
  if (detector.count < 2) return 0;
  const last = detector.times[(detector.start + detector.count - 1) % MAX_SAMPLES];
  return last - detector.times[detector.start];
}

/**
 * Takes one sample: the time in seconds on any steady clock, the headset's height over the floor in real
 * metres and the head's tilt (headTiltOf). A sample with the head tilted too far or the height outside what a
 * player can have breaks the run. Otherwise the run keeps the latest samples whose heights all lie within
 * CAPTURE_STEADY_RANGE, so a short spike, such as a headset's first frames before its pose is tracked, starts
 * the run afresh instead of entering it, while a slow sway within the range does not break it. Once the run
 * spans `steadySeconds`, the result is its mean height. Without that by `timeoutSeconds` after the first
 * sample, the result is a time-out. A detector that has answered keeps answering the same way only
 * as long as it is fed; the caller stops feeding it.
 */
export function stepSteadyHeight(
  detector: SteadyHeightDetector,
  time: number,
  height: number,
  tilt: number,
  steadySeconds = CAPTURE_STEADY_SECONDS,
  timeoutSeconds = CAPTURE_TIMEOUT_SECONDS
): SteadyHeightResult {
  if (detector.startedAt === null) detector.startedAt = time;

  if (!isUsableSample(height, tilt)) {
    detector.start = 0;
    detector.count = 0;
  } else {
    // A full ring drops its oldest sample; a second of samples never fills it
    if (detector.count === MAX_SAMPLES) {
      detector.start = (detector.start + 1) % MAX_SAMPLES;
      detector.count--;
    }
    const end = (detector.start + detector.count) % MAX_SAMPLES;
    detector.times[end] = time;
    detector.heights[end] = height;
    detector.count++;

    // Keep the longest run of latest samples within the range
    let min = height;
    let max = height;
    let kept = 1;
    for (; kept < detector.count; kept++) {
      const value = detector.heights[(detector.start + detector.count - 1 - kept) % MAX_SAMPLES];
      const nextMin = Math.min(min, value);
      const nextMax = Math.max(max, value);
      if (nextMax - nextMin > CAPTURE_STEADY_RANGE) break;
      min = nextMin;
      max = nextMax;
    }
    detector.start = (detector.start + detector.count - kept) % MAX_SAMPLES;
    detector.count = kept;

    const first = detector.times[detector.start];
    if (detector.count >= 2 && time - first >= steadySeconds) {
      let sum = 0;
      for (let i = 0; i < detector.count; i++) sum += detector.heights[(detector.start + i) % MAX_SAMPLES];
      return { status: "steady", height: sum / detector.count };
    }
  }

  if (time - detector.startedAt >= timeoutSeconds) return TIMED_OUT;
  return WAITING;
}
