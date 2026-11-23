import test from "ava";
import { Quaternion, Vector3 } from "three";
import {
  CAPTURE_STEADY_RANGE,
  CAPTURE_STEADY_SECONDS,
  CAPTURE_TILT_LIMIT,
  CAPTURE_TIMEOUT_SECONDS,
  createSteadyHeightDetector,
  headTiltOf,
  MAX_CAPTURE_HEIGHT,
  MIN_CAPTURE_HEIGHT,
  resetSteadyHeightDetector,
  stepSteadyHeight
} from "../../../src/avatar/calibration/steady-height";

/**
 * The steadiness detector of the headset capture (avatar/calibration/steady-height.ts), fed at 72 frames a
 * second as a Quest headset gives them: a steady headset answers after one second with its height, a short
 * spike such as the first frames of a session (2.39 m against 1.60 m) is left out, a slow sway within a few
 * centimetres passes, and a headset that keeps moving or tilting times out after ten seconds.
 */

const FPS = 72;
const DT = 1 / FPS;
const LEVEL = 0;
const TOLERANCE = 1e-9;

/** Feeds heights(t) and tilts(t) from t = start, frame by frame, until an answer or `seconds` have passed */
function run(detector, { height, tilt = () => LEVEL, seconds = CAPTURE_TIMEOUT_SECONDS + 1, start = 100 }) {
  for (let frame = 0; frame <= seconds * FPS; frame++) {
    const t = start + frame * DT;
    const result = stepSteadyHeight(detector, t, height(t - start, frame), tilt(t - start, frame));
    if (result.status !== "waiting") return { ...result, after: t - start, frame };
  }
  return { status: "waiting", after: seconds };
}

test("a steady headset is taken after one second, at its height", t => {
  const result = run(createSteadyHeightDetector(), { height: () => 1.6 });
  t.is(result.status, "steady");
  t.true(Math.abs(result.height - 1.6) < TOLERANCE, `height ${result.height}`);
  t.true(
    result.after >= CAPTURE_STEADY_SECONDS && result.after < CAPTURE_STEADY_SECONDS + 2 * DT,
    `after ${result.after}`
  );
});

test("a three-frame spike to 2.39 m at the start is left out", t => {
  // The first frames of a VR session report the head 0.79 m too high
  const result = run(createSteadyHeightDetector(), { height: (_, frame) => (frame < 3 ? 2.39 : 1.6) });
  t.is(result.status, "steady");
  t.true(Math.abs(result.height - 1.6) < TOLERANCE, `height ${result.height}`);
  t.true(result.after >= 3 * DT + CAPTURE_STEADY_SECONDS - TOLERANCE, `after ${result.after}`);
});

test("a three-frame spike to 2.39 m in the middle of a steady run starts the run afresh and is left out", t => {
  const spikeAt = Math.round(0.6 * FPS);
  const result = run(createSteadyHeightDetector(), {
    height: (_, frame) => (frame >= spikeAt && frame < spikeAt + 3 ? 2.39 : 1.6)
  });
  t.is(result.status, "steady");
  t.true(Math.abs(result.height - 1.6) < TOLERANCE, `height ${result.height}`);
  t.true(result.after >= (spikeAt + 3) * DT + CAPTURE_STEADY_SECONDS - TOLERANCE, `after ${result.after}`);
});

test("a slow sway within a centimetre passes, at the mean height", t => {
  // ±1 cm at 0.3 Hz: 2 cm from top to bottom, within the range
  const sway = s => 1.55 + 0.01 * Math.sin(2 * Math.PI * 0.3 * s);
  const result = run(createSteadyHeightDetector(), { height: sway });
  t.is(result.status, "steady");
  t.true(result.after < CAPTURE_STEADY_SECONDS + 0.1, `after ${result.after}`);
  t.true(Math.abs(result.height - 1.55) < 0.01, `height ${result.height}`);
});

test("a slow sway with a small tilt of the head passes", t => {
  const result = run(createSteadyHeightDetector(), {
    height: s => 1.2 + 0.005 * Math.sin(2 * Math.PI * 0.5 * s),
    tilt: s => 0.1 + 0.05 * Math.sin(2 * Math.PI * 0.4 * s)
  });
  t.is(result.status, "steady");
  t.true(Math.abs(result.height - 1.2) < 0.005, `height ${result.height}`);
});

test("a headset that keeps bobbing by 5 cm times out after ten seconds", t => {
  const result = run(createSteadyHeightDetector(), {
    height: s => 1.6 + 0.05 * Math.sin(2 * Math.PI * 0.7 * s)
  });
  t.is(result.status, "timedOut");
  t.true(Math.abs(result.after - CAPTURE_TIMEOUT_SECONDS) < 2 * DT, `after ${result.after}`);
});

test("a headset rising and sinking at 10 cm a second times out", t => {
  // A triangle wave between 1.4 and 1.7 m: never 3 cm within a second
  const result = run(createSteadyHeightDetector(), {
    height: s => 1.4 + 0.3 * Math.abs((((s * 0.1) / 0.3) % 2) - 1)
  });
  t.is(result.status, "timedOut");
});

test("a steady head tilted beyond the limit (looking down) times out", t => {
  const result = run(createSteadyHeightDetector(), {
    height: () => 1.6,
    tilt: () => CAPTURE_TILT_LIMIT + 0.05
  });
  t.is(result.status, "timedOut");
});

test("heights a player cannot have break the run: a lost pose (0 m) and a headset on the ceiling", t => {
  for (const bad of [0, MIN_CAPTURE_HEIGHT - 0.01, MAX_CAPTURE_HEIGHT + 0.01, NaN]) {
    const result = run(createSteadyHeightDetector(), { height: () => bad });
    t.is(result.status, "timedOut", `height ${bad}`);
  }
  // One frame without a pose every half second keeps a steady headset from ever being steady for a second
  const gaps = run(createSteadyHeightDetector(), {
    height: (_, frame) => (frame % Math.round(FPS / 2) === 0 ? NaN : 1.6)
  });
  t.is(gaps.status, "timedOut");
});

test("the steady range is the limit: 2.9 cm of drift passes, 3.1 cm within a second does not", t => {
  const within = run(createSteadyHeightDetector(), {
    height: s => 1.6 + Math.min(s, 1) * (CAPTURE_STEADY_RANGE - 0.001)
  });
  t.is(within.status, "steady");
  // Drifting 3.1 cm a second: no run of a second stays within 3 cm while it drifts; after it stops at 2 s,
  // the run reaches back to the last 3 cm of the drift (from 2 - 3 / 3.1 s) and is a second long just after 2 s
  const beyond = run(createSteadyHeightDetector(), {
    height: s => 1.6 + Math.min(s, 2) * (CAPTURE_STEADY_RANGE + 0.001)
  });
  t.is(beyond.status, "steady");
  t.true(beyond.after > 2 && beyond.after < 2.1, `after ${beyond.after}`);
});

test("a reset starts the time-out afresh", t => {
  const detector = createSteadyHeightDetector();
  const first = run(detector, { height: s => 1.6 + 0.05 * Math.sin(5 * s), seconds: 5 });
  t.is(first.status, "waiting");
  resetSteadyHeightDetector(detector);
  const second = run(detector, { height: () => 1.6, start: 200 });
  t.is(second.status, "steady");
  t.true(second.after < CAPTURE_STEADY_SECONDS + 2 * DT, `after ${second.after}`);
});

test("head tilt: level in any heading is 0, pitch and roll count alike", t => {
  const q = new Quaternion();
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  for (const yaw of [0, 1, -2.5, Math.PI]) {
    q.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
    t.true(near(headTiltOf(q), 0), `yaw ${yaw}: ${headTiltOf(q)}`);
  }
  q.setFromAxisAngle(new Vector3(1, 0, 0), 0.3);
  t.true(near(headTiltOf(q), 0.3), `pitch: ${headTiltOf(q)}`);
  q.setFromAxisAngle(new Vector3(0, 0, 1), -0.3);
  t.true(near(headTiltOf(q), 0.3), `roll: ${headTiltOf(q)}`);
  // Pitch after yaw, as a head turned to the side and looking down
  q.setFromAxisAngle(new Vector3(0, 1, 0), 1.2).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.4));
  t.true(near(headTiltOf(q), 0.4), `yawed pitch: ${headTiltOf(q)}`);
});
