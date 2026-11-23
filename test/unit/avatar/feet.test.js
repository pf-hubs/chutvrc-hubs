import test from "ava";
import { Vector3 } from "three";
import {
  createGait,
  MAX_STEP_SECONDS,
  resetGait,
  SETTLE_DISTANCE,
  STEP_DISTANCE,
  stepGait
} from "../../../src/avatar/ik/shared/feet";

/**
 * The feet (ik/shared/feet.ts): planted on the floor, stepping to their places under the hips when the
 * body has moved or turned away, one at a time, whether the body moved in the rig or the rig moved.
 */

const DEG = Math.PI / 180;
const HALF_STANCE = 0.09;
const FOOT_HEIGHT = 0.08;
const MAX_LIFT = 0.1;
/** A standing foot is left where it is within this distance of its place */
const AT_ITS_PLACE = SETTLE_DISTANCE + 0.001;

/** The places under the hips for a body at `hips` (root space) heading `bodyYaw` (zero faces -z; the left foot is at -x) */
function targetsFor(hips, bodyYaw) {
  const right = new Vector3(Math.cos(bodyYaw), 0, -Math.sin(bodyYaw));
  return {
    left: new Vector3(hips.x, FOOT_HEIGHT, hips.z).addScaledVector(right, -HALF_STANCE),
    right: new Vector3(hips.x, FOOT_HEIGHT, hips.z).addScaledVector(right, HALF_STANCE)
  };
}

/** A foot's place in the room, from its place in root space and the rig's place */
function inRoom(position, floor) {
  const cos = Math.cos(floor.yaw);
  const sin = Math.sin(floor.yaw);
  return new Vector3(cos * position.x + sin * position.z + floor.x, position.y, -sin * position.x + cos * position.z + floor.z);
}

/**
 * Runs the gait frame by frame. `at(time)` gives { hips, bodyYaw, floor } for a frame; the body stands
 * unless `sitting(time)` says otherwise. Returns one record per frame with each foot in the room.
 */
function run(gait, seconds, fps, at, sitting = () => false) {
  const frames = [];
  const dt = 1 / fps;
  for (let i = 0; i * dt <= seconds + 1e-9; i++) {
    const time = i * dt;
    const { hips, bodyYaw = 0, floor = { x: 0, z: 0, yaw: 0 } } = at(time);
    const targets = targetsFor(hips, bodyYaw);
    stepGait(gait, targets, hips, bodyYaw, floor, i === 0 ? 0 : dt, !sitting(time));
    const frame = { time, floor, bodyYawInRoom: bodyYaw + floor.yaw };
    for (const side of ["left", "right"]) {
      const foot = gait.feet[side];
      frame[side] = {
        room: inRoom(foot.position, floor),
        target: inRoom(targets[side], floor),
        yawInRoom: foot.yaw + floor.yaw,
        stepping: foot.stepping,
        lift: foot.position.y - FOOT_HEIGHT
      };
    }
    frames.push(frame);
  }
  return frames;
}

const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** What a run did: the largest move of a foot in one frame, how far planted feet slid, steps per foot, the highest lift */
function summarise(frames) {
  const summary = { maxMove: 0, maxSlide: 0, steps: { left: 0, right: 0 }, maxLift: 0, bothInAir: 0, minLift: 0 };
  for (let i = 1; i < frames.length; i++) {
    for (const side of ["left", "right"]) {
      const now = frames[i][side];
      const before = frames[i - 1][side];
      const moved = horizontal(now.room, before.room);
      summary.maxMove = Math.max(summary.maxMove, moved);
      if (!now.stepping && !before.stepping) summary.maxSlide = Math.max(summary.maxSlide, moved);
      if (now.stepping && !before.stepping) summary.steps[side]++;
      summary.maxLift = Math.max(summary.maxLift, now.lift);
      summary.minLift = Math.min(summary.minLift, now.lift);
    }
    if (frames[i].left.stepping && frames[i].right.stepping) summary.bothInAir++;
  }
  return summary;
}

const still = { hips: new Vector3(0, 0.95, 0) };

test("standing still: the feet are at their places and never step", t => {
  const frames = run(createGait(), 5, 60, () => still);
  const summary = summarise(frames);
  t.deepEqual(summary.steps, { left: 0, right: 0 });
  t.is(summary.maxMove, 0);
  for (const side of ["left", "right"]) t.true(horizontal(frames[0][side].room, frames[0][side].target) < 1e-12);
});

test("leaning away from the feet: a step over several frames instead of a jump, at 20, 60 and 72 frames a second", t => {
  for (const fps of [20, 60, 72]) {
    // The hips drift 0.6 m sideways in the rig at 0.3 m/s, as a slow lean or a step with the headset does
    const frames = run(createGait(), 4, fps, time => ({ hips: new Vector3(Math.min(0.6, 0.3 * time), 0.95, 0) }));
    const summary = summarise(frames);
    // The old feet moved 25 cm in one frame; a step now takes about a third of a second
    const limit = (0.62 / MAX_STEP_SECONDS) * 1.6 * (1 / fps) + 1e-9;
    t.true(summary.maxMove < limit, `${fps} fps: the largest move in one frame is ${(summary.maxMove * 100).toFixed(1)} cm (limit ${(limit * 100).toFixed(1)})`);
    t.true(summary.steps.left >= 1 && summary.steps.right >= 1, `${fps} fps: both feet stepped (${JSON.stringify(summary.steps)})`);
    t.is(summary.bothInAir, 0, `${fps} fps: never both feet in the air`);
    t.is(summary.maxSlide, 0, `${fps} fps: a planted foot does not move`);
    t.true(summary.maxLift > 0.02 && summary.maxLift <= MAX_LIFT + 1e-9, `${fps} fps: lifted ${(summary.maxLift * 100).toFixed(1)} cm`);
    t.true(summary.minLift >= -1e-12, `${fps} fps: never under the floor`);
    const last = frames[frames.length - 1];
    for (const side of ["left", "right"]) {
      t.true(horizontal(last[side].room, last[side].target) < AT_ITS_PLACE, `${fps} fps: the ${side} foot ends at its place`);
      t.false(last[side].stepping);
    }
  }
});

test("walking with the stick: the rig moves, the feet stay on the floor where they were planted and step in turn", t => {
  for (const speed of [0.8, 1.6, 3.2]) {
    // The body stands at the rig's origin and the rig moves ahead (-z) at a steady speed
    const frames = run(createGait(), 6, 60, time => ({ hips: still.hips, floor: { x: 0, z: -speed * time, yaw: 0 } }));
    const summary = summarise(frames);
    t.is(summary.maxSlide, 0, `${speed} m/s: a planted foot stays where it is in the room`);
    t.true(summary.steps.left >= 3 && summary.steps.right >= 3, `${speed} m/s: both feet step (${JSON.stringify(summary.steps)})`);
    t.true(Math.abs(summary.steps.left - summary.steps.right) <= 1, `${speed} m/s: the feet step in turn (${JSON.stringify(summary.steps)})`);
    // The rig goes from standing to full speed in one frame here, which no player does: the second foot may
    // have to leave the floor a frame or two before the first has landed. Once walking, never.
    t.true(summary.bothInAir <= 2, `${speed} m/s: both feet in the air for ${summary.bothInAir} frames at the start`);
    // After the first second every frame has each foot within a stride of its place
    const settled = frames.filter(frame => frame.time > 1);
    t.is(summarise(settled).bothInAir, 0, `${speed} m/s: never both feet in the air while walking`);
    const furthest = Math.max(...settled.flatMap(frame => ["left", "right"].map(side => horizontal(frame[side].room, frame[side].target))));
    t.true(furthest < 0.75, `${speed} m/s: no foot is left more than ${furthest.toFixed(2)} m from its place`);
    // A foot lands ahead of its place, so the body passes over it: at landing it is in front (smaller z)
    const landings = [];
    for (let i = 1; i < settled.length; i++) {
      for (const side of ["left", "right"]) {
        if (settled[i - 1][side].stepping && !settled[i][side].stepping) landings.push(settled[i][side].target.z - settled[i][side].room.z);
      }
    }
    t.true(landings.length > 0 && landings.every(ahead => ahead > 0), `${speed} m/s: every foot lands ahead of its place`);
    t.log(`${speed} m/s: ${summary.steps.left + summary.steps.right} steps in 6 s, lift ${(summary.maxLift * 100).toFixed(0)} cm, furthest ${furthest.toFixed(2)} m`);
  }
});

test("stopping after a walk: the feet come to their places", t => {
  const frames = run(createGait(), 5, 60, time => ({ hips: still.hips, floor: { x: 0, z: -1.6 * Math.min(time, 2), yaw: 0 } }));
  const last = frames[frames.length - 1];
  for (const side of ["left", "right"]) {
    t.true(horizontal(last[side].room, last[side].target) < AT_ITS_PLACE, `the ${side} foot is at its place 3 s after the stop`);
    t.false(last[side].stepping);
  }
});

test("turning on the spot: the feet step round to the body's heading, in turn", t => {
  for (const viaRig of [false, true]) {
    // A quarter turn in one frame at 1 s: a snap turn of the rig, or the body turning in the rig
    const frames = run(createGait(), 4, 60, time => {
      const yaw = time >= 1 ? 90 * DEG : 0;
      return viaRig ? { hips: still.hips, floor: { x: 0, z: 0, yaw } } : { hips: still.hips, bodyYaw: yaw };
    });
    const summary = summarise(frames);
    const name = viaRig ? "the rig turns" : "the body turns in the rig";
    t.true(summary.steps.left >= 1 && summary.steps.right >= 1, `${name}: both feet stepped`);
    t.is(summary.bothInAir, 0, `${name}: never both feet in the air`);
    const last = frames[frames.length - 1];
    for (const side of ["left", "right"]) {
      const off = Math.abs(Math.atan2(Math.sin(last[side].yawInRoom - last.bodyYawInRoom), Math.cos(last[side].yawInRoom - last.bodyYawInRoom)));
      t.true(off < 1e-6, `${name}: the ${side} foot points the body's way at the end`);
      t.true(horizontal(last[side].room, last[side].target) < AT_ITS_PLACE, `${name}: the ${side} foot is at its place`);
    }
  }
});

test("a small turn or a small shift leaves the feet planted", t => {
  // Over half a second the body leans 8 cm aside and turns 20 degrees, then stays
  const frames = run(createGait(), 3, 60, time => {
    const u = Math.min(1, Math.max(0, (time - 1) / 0.5));
    return { hips: new Vector3(STEP_DISTANCE * 0.32 * u, 0.95, 0), bodyYaw: 20 * DEG * u };
  });
  t.deepEqual(summarise(frames).steps, { left: 0, right: 0 });
});

test("a teleport takes both feet along at once, without a step", t => {
  const frames = run(createGait(), 3, 60, time => ({ hips: still.hips, floor: { x: time >= 1 ? 12 : 0, z: time >= 1 ? -7 : 0, yaw: 0 } }));
  const summary = summarise(frames);
  t.deepEqual(summary.steps, { left: 0, right: 0 });
  t.is(summary.maxLift, 0);
  const after = frames.find(frame => frame.time >= 1);
  for (const side of ["left", "right"]) t.true(horizontal(after[side].room, after[side].target) < 1e-9, `the ${side} foot is at its place on the frame of the teleport`);
});

test("sitting: the feet follow their targets as they are, and are planted afresh on standing up", t => {
  const gait = createGait();
  const frames = run(
    gait,
    4,
    60,
    time => ({ hips: new Vector3(0.4 * Math.min(time, 2), 0.95, 0) }),
    time => time < 2
  );
  const seated = frames.filter(frame => frame.time < 2);
  for (const frame of seated) {
    for (const side of ["left", "right"]) t.true(horizontal(frame[side].room, frame[side].target) < 1e-12);
  }
  const stood = frames.find(frame => frame.time >= 2);
  for (const side of ["left", "right"]) {
    t.true(horizontal(stood[side].room, stood[side].target) < 1e-9, `the ${side} foot is planted where the body stands up`);
    t.false(stood[side].stepping);
  }
});

test("a reset takes the feet off the floor: they are planted where the body stands next, without a step", t => {
  const gait = createGait();
  run(gait, 1, 60, () => still);
  resetGait(gait);
  const frames = run(gait, 1, 60, () => ({ hips: new Vector3(3, 0.95, -4) }));
  t.deepEqual(summarise(frames).steps, { left: 0, right: 0 });
  for (const side of ["left", "right"]) t.true(horizontal(frames[0][side].room, frames[0][side].target) < 1e-12);
});
