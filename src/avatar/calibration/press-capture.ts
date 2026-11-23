import { CAPTURE_TILT_LIMIT, MAX_CAPTURE_HEIGHT, MIN_CAPTURE_HEIGHT } from "./steady-height";

/**
 * The capture of the headset's height on a press of both triggers: the pure part of the capture in VR
 * (vr-capture.ts) for a player with controllers. It is fed one sample a frame, the headset's height over
 * the floor in real metres, how far the head is tilted from level, and whether each trigger is down. When
 * both triggers go down together while the head is level, it answers with the median height of the last
 * half second, so that the push on the triggers itself does not shift the answer. A press with the head
 * tilted, or at a height a player cannot have, is rejected and the next press is waited for. Without a
 * press it gives up after a minute. No scene access; nothing is allocated per sample.
 */

/** Both triggers count as pressed together when the second goes down within this long of the first, in seconds */
export const PRESS_TOGETHER_SECONDS = 0.3;
/** The height is the median of the samples of this long before the press, in seconds */
export const PRESS_WINDOW_SECONDS = 0.5;
/** How long the capture waits for a press before the entered height is used alone, in seconds */
export const PRESS_TIMEOUT_SECONDS = 60;

/** The samples kept at most: the window at a refresh rate well above any headset's */
const MAX_SAMPLES = 256;

export type PressCaptureResult =
  | { status: "waiting" }
  /** Both triggers were pressed, but the head was not level or not at a player's height; waiting for the next press */
  | { status: "rejected" }
  | { status: "captured"; height: number }
  | { status: "timedOut" };

export type PressCapture = {
  /** The usable samples of the last while, oldest first, as a ring */
  times: Float64Array;
  heights: Float64Array;
  start: number;
  count: number;
  /** Whether the latest sample was usable: the head level and at a height a player can have */
  latestUsable: boolean;
  /** The time of the first sample since the capture was reset; null before it */
  startedAt: number | null;
  /** When each trigger went down; null while it is up */
  leftDownAt: number | null;
  rightDownAt: number | null;
  /** Whether the press now held has been answered already, so one press gives one answer */
  answered: boolean;
  /** Whether the last press was rejected */
  rejected: boolean;
  /** Scratch space for the median */
  sorted: Float64Array;
};

const WAITING: PressCaptureResult = Object.freeze({ status: "waiting" });
const REJECTED: PressCaptureResult = Object.freeze({ status: "rejected" });
const TIMED_OUT: PressCaptureResult = Object.freeze({ status: "timedOut" });

export function createPressCapture(): PressCapture {
  return {
    times: new Float64Array(MAX_SAMPLES),
    heights: new Float64Array(MAX_SAMPLES),
    start: 0,
    count: 0,
    latestUsable: false,
    startedAt: null,
    leftDownAt: null,
    rightDownAt: null,
    answered: false,
    rejected: false,
    sorted: new Float64Array(MAX_SAMPLES)
  };
}

/** Starts over: the next sample begins a new capture and its timeout */
export function resetPressCapture(capture: PressCapture) {
  capture.start = 0;
  capture.count = 0;
  capture.latestUsable = false;
  capture.startedAt = null;
  capture.leftDownAt = null;
  capture.rightDownAt = null;
  capture.answered = false;
  capture.rejected = false;
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

/** The median of the kept heights that are no older than the window; NaN when there is none */
function medianOfWindow(capture: PressCapture, time: number): number {
  let n = 0;
  for (let i = 0; i < capture.count; i++) {
    const index = (capture.start + i) % MAX_SAMPLES;
    if (time - capture.times[index] <= PRESS_WINDOW_SECONDS) capture.sorted[n++] = capture.heights[index];
  }
  if (n === 0) return NaN;
  const window = capture.sorted.subarray(0, n).sort();
  return n % 2 === 1 ? window[(n - 1) / 2] : (window[n / 2 - 1] + window[n / 2]) / 2;
}

/**
 * Takes one sample: the time in seconds on any steady clock, the headset's height over the floor in real
 * metres, the head's tilt (headTiltOf in steady-height.ts; NaN for both when the headset has no pose this
 * frame) and whether each trigger is down. Answers "captured" on the frame both triggers are first down
 * together with the head level, "rejected" from a press that could not be used until the next one, and
 * "timedOut" a minute after the first sample without a capture. A caller that got "captured" or "timedOut"
 * stops feeding it.
 */
export function stepPressCapture(
  capture: PressCapture,
  time: number,
  height: number,
  tilt: number,
  leftDown: boolean,
  rightDown: boolean
): PressCaptureResult {
  if (capture.startedAt === null) capture.startedAt = time;

  capture.latestUsable = isUsableSample(height, tilt);
  if (capture.latestUsable) {
    // A full ring drops its oldest sample
    if (capture.count === MAX_SAMPLES) {
      capture.start = (capture.start + 1) % MAX_SAMPLES;
      capture.count--;
    }
    const end = (capture.start + capture.count) % MAX_SAMPLES;
    capture.times[end] = time;
    capture.heights[end] = height;
    capture.count++;
  }

  if (leftDown) {
    if (capture.leftDownAt === null) capture.leftDownAt = time;
  } else {
    capture.leftDownAt = null;
  }
  if (rightDown) {
    if (capture.rightDownAt === null) capture.rightDownAt = time;
  } else {
    capture.rightDownAt = null;
  }

  if (capture.leftDownAt === null || capture.rightDownAt === null) {
    capture.answered = false;
  } else if (!capture.answered && Math.abs(capture.leftDownAt - capture.rightDownAt) <= PRESS_TOGETHER_SECONDS) {
    capture.answered = true;
    const median = capture.latestUsable ? medianOfWindow(capture, time) : NaN;
    if (Number.isFinite(median)) return { status: "captured", height: median };
    capture.rejected = true;
  }

  if (time - capture.startedAt >= PRESS_TIMEOUT_SECONDS) return TIMED_OUT;
  return capture.rejected ? REJECTED : WAITING;
}
