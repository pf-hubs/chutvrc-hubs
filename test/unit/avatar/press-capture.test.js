import test from "ava";
import {
  createPressCapture,
  PRESS_TIMEOUT_SECONDS,
  PRESS_TOGETHER_SECONDS,
  resetPressCapture,
  stepPressCapture
} from "../../../src/avatar/calibration/press-capture";
import { createSteadyHeightDetector, steadyRunSeconds, stepSteadyHeight } from "../../../src/avatar/calibration/steady-height";

/**
 * The capture of the headset's height on a press of both triggers (press-capture.ts), and the options of
 * the steady capture that a player without controllers gets (steady-height.ts).
 */

const FRAME = 1 / 72;
const DEG = Math.PI / 180;

/**
 * Feeds frames from `from` to `to` seconds; `at(time)` gives { height, tilt, left, right } for a frame.
 * Returns the first result that `stops` accepts, by default any that is not "waiting", with its time, or the
 * last result.
 */
function feed(capture, from, to, at, stops = status => status !== "waiting") {
  let result = { status: "waiting" };
  for (let time = from; time <= to + 1e-9; time += FRAME) {
    const frame = at(time);
    result = stepPressCapture(capture, time, frame.height, frame.tilt ?? 0, !!frame.left, !!frame.right);
    if (stops(result.status)) return { ...result, time };
  }
  return { ...result, time: to };
}

test("nothing is captured without a press, however steady the head", t => {
  const capture = createPressCapture();
  const result = feed(capture, 0, 20, () => ({ height: 1.62 }));
  t.is(result.status, "waiting");
});

test("both triggers pressed with the head level: the height of the half second before, at the frame of the press", t => {
  const capture = createPressCapture();
  const result = feed(capture, 0, 5, time => ({ height: 1.62, left: time >= 2, right: time >= 2.1 }));
  t.is(result.status, "captured");
  t.true(Math.abs(result.height - 1.62) < 1e-9);
  t.true(result.time >= 2.1 && result.time < 2.1 + 2 * FRAME, `captured at ${result.time.toFixed(3)} s, when the second trigger went down`);
});

test("one trigger alone does nothing; two pressed too far apart do nothing until both are pressed again", t => {
  const capture = createPressCapture();
  t.is(feed(capture, 0, 3, time => ({ height: 1.62, left: time >= 1 })).status, "waiting");

  resetPressCapture(capture);
  const apart = PRESS_TOGETHER_SECONDS + 0.2;
  const late = feed(capture, 0, 3, time => ({ height: 1.62, left: time >= 1, right: time >= 1 + apart }));
  t.is(late.status, "waiting", "the second trigger came too long after the first");
  // The left trigger is let go and both are pressed together
  const again = feed(capture, 3, 6, time => ({ height: 1.62, left: time >= 4, right: time < 3.5 || time >= 4.05 }));
  t.is(again.status, "captured");
});

test("the push on the triggers does not shift the height: a dip in the last frames leaves the median", t => {
  const capture = createPressCapture();
  // The head sinks 3 cm in the 0.1 s before the press, as the arms tense
  const result = feed(capture, 0, 5, time => ({
    height: time > 1.9 && time <= 2 ? 1.59 : 1.62,
    left: time >= 2,
    right: time >= 2
  }));
  t.is(result.status, "captured");
  t.true(Math.abs(result.height - 1.62) < 1e-9, `height ${result.height}`);
});

test("a press with the head tilted is rejected, stays rejected until the next press, and that one is taken", t => {
  const capture = createPressCapture();
  const tilted = feed(capture, 0, 3, time => ({ height: 1.62, tilt: 35 * DEG, left: time >= 1, right: time >= 1 }));
  t.is(tilted.status, "rejected");
  // Still held, then let go, the head level again: no capture without a new press
  const held = feed(capture, tilted.time + FRAME, 4, time => ({ height: 1.62, left: time < 3.5, right: time < 3.5 }));
  t.is(held.status, "rejected");
  // The prompt keeps asking again ("rejected") until the new press is taken
  const taken = status => status === "captured" || status === "timedOut";
  const pressed = feed(capture, 4, 6, time => ({ height: 1.62, left: time >= 5, right: time >= 5 }), taken);
  t.is(pressed.status, "captured");
  t.true(Math.abs(pressed.height - 1.62) < 1e-9);
});

test("a press at a height a player cannot have, or without a pose, is rejected", t => {
  for (const height of [0.2, 3.1, NaN]) {
    const capture = createPressCapture();
    const result = feed(capture, 0, 3, time => ({ height, tilt: Number.isNaN(height) ? NaN : 0, left: time >= 1, right: time >= 1 }));
    t.is(result.status, "rejected", `height ${height}`);
  }
});

test("samples older than the window do not count: a player who stood up just before the press gets the new height", t => {
  const capture = createPressCapture();
  // Seated until 3 s, standing from then on, pressed at 4 s
  const result = feed(capture, 0, 6, time => ({ height: time < 3 ? 1.2 : 1.65, left: time >= 4, right: time >= 4 }));
  t.is(result.status, "captured");
  t.true(Math.abs(result.height - 1.65) < 1e-9, `height ${result.height}`);
});

test("without a press the capture gives up after a minute, and a reset starts the minute afresh", t => {
  const capture = createPressCapture();
  const result = feed(capture, 0, PRESS_TIMEOUT_SECONDS + 5, () => ({ height: 1.62 }));
  t.is(result.status, "timedOut");
  t.true(Math.abs(result.time - PRESS_TIMEOUT_SECONDS) < 2 * FRAME, `gave up at ${result.time.toFixed(2)} s`);
  resetPressCapture(capture);
  t.is(feed(capture, 100, 120, () => ({ height: 1.62 })).status, "waiting");
});

test("the steady capture for a player without controllers: three seconds, counted, with a longer time-out", t => {
  const detector = createSteadyHeightDetector();
  let result = { status: "waiting" };
  let taken = null;
  const spans = [];
  for (let time = 0; time <= 10 && !taken; time += FRAME) {
    result = stepSteadyHeight(detector, time, 1.62, 0, 3, 30);
    spans.push(steadyRunSeconds(detector));
    if (result.status !== "waiting") taken = time;
  }
  t.is(result.status, "steady");
  t.true(Math.abs(taken - 3) < 2 * FRAME, `taken at ${taken.toFixed(2)} s`);
  t.true(spans.every((span, i) => i === 0 || span >= spans[i - 1]), "the steady time only grows while the head is steady");

  // A head that keeps bobbing is given up on after the longer time-out, not the default ten seconds
  const bobbing = createSteadyHeightDetector();
  let gaveUpAt = null;
  for (let time = 0; time <= 40 && gaveUpAt === null; time += FRAME) {
    const height = 1.62 + 0.05 * Math.sin(time * 6);
    if (stepSteadyHeight(bobbing, time, height, 0, 3, 30).status === "timedOut") gaveUpAt = time;
  }
  t.true(gaveUpAt !== null && Math.abs(gaveUpAt - 30) < 2 * FRAME, `gave up at ${gaveUpAt?.toFixed(2)} s`);
});
