import test from "ava";
import { Euler, Quaternion } from "three";
import {
  CAPACITY,
  EXTRAPOLATION_RETURN_MS,
  InterpolationBuffer,
  MAX_EXTRAPOLATION_MS,
  POSE_PARTS
} from "../../../src/avatar/net/interpolation-buffer";
import { decodeBody } from "../../../src/avatar/net/pose-codec-v1";
import { PoseSender, SEND_INTERVAL_MS } from "../../../src/avatar/net/pose-sender";
import { DEFAULT_INTERPOLATION_DELAY_MS, PoseStore } from "../../../src/avatar/pose/pose-store";
import { createTrackedPose, eulerToQuat, TRACKED_ALL } from "../../../src/avatar/pose/tracked-pose";
import { mulberry32 } from "./_random";
import { receivePosePacket } from "./_receive-pose";
import { format, isFiniteQuat, isFiniteXyz, quaternionAngleDeg, summarize } from "./_stats";

/**
 * T0.3: the interpolation buffer behind a simulated network. Pass: the error against the true path stays
 * bounded; extrapolation stops at 100 ms; no jumps.
 *
 * The whole receive path runs as in the client: the real PoseSender (its 22 ms gate, every other frame of a
 * 60 fps loop) encodes the sender's true pose; the network delays, jitters, reorders and loses packets; the
 * receiver decodes each packet, applies the late-packet rule of pose-sync.ts (copied in _receive-pose.js),
 * pushes the four parts into a PoseStore with the arrival time, and samples the store once per 60 fps frame
 * at now - interpolationDelayMs.
 */

const SENDER_ID = "sender-0000-0000-0000-000000000000";
const RECEIVER_ID = "receiver-000-0000-0000-000000000000";
const TAU = 2 * Math.PI;
const DEG = Math.PI / 180;
const RECEIVER_FRAME_MS = 1000 / 60;
const HAND_PARTS = ["leftHand", "rightHand"];

/**
 * The sender's true pose at `ms`: the rig walks a closed curve whose speed changes (up to about 2 m/s) and
 * turns, its yaw drifting through ±180° again and again; the head bobs at a walking cadence and looks
 * around; the hands swing at 0.9 Hz. Positions of head and hands are relative to the rig, as sent.
 */
function truePose(ms, out) {
  const t = ms / 1000;
  const rig = out.rig;
  rig.pos.x = 4 * Math.sin(0.23 * t) + 1.2 * Math.sin(0.61 * t + 0.4);
  rig.pos.y = 0.05 * Math.sin(0.11 * t);
  rig.pos.z = 3.5 * Math.sin(0.17 * t + 1.1) + 1.0 * Math.cos(0.53 * t);
  rig.rot.x = 0;
  rig.rot.y = 1.2 * Math.sin(0.3 * t) + 0.25 * t;
  rig.rot.z = 0;
  const head = out.head;
  head.pos.x = 0.04 * Math.sin(TAU * 1.8 * t);
  head.pos.y = 1.62 + 0.025 * Math.sin(TAU * 3.6 * t);
  head.pos.z = 0.03 * Math.sin(TAU * 0.5 * t);
  head.rot.x = 0.35 * Math.sin(1.1 * t + 0.3);
  head.rot.y = 0.9 * Math.sin(0.8 * t);
  head.rot.z = 0.12 * Math.sin(1.7 * t);
  const swing = Math.sin(TAU * 0.9 * t);
  const left = out.leftHand;
  left.pos.x = -0.28 + 0.05 * Math.sin(1.3 * t);
  left.pos.y = 1.0 + 0.06 * Math.sin(TAU * 1.8 * t);
  left.pos.z = -0.1 + 0.28 * swing;
  left.rot.x = 0.6 * swing;
  left.rot.y = 0.3 * Math.sin(0.7 * t);
  left.rot.z = 0.4 * Math.sin(1.9 * t);
  const right = out.rightHand;
  right.pos.x = 0.28 + 0.05 * Math.sin(1.3 * t + 1);
  right.pos.y = 1.0 + 0.06 * Math.sin(TAU * 1.8 * t + Math.PI);
  right.pos.z = -0.1 - 0.28 * swing;
  right.rot.x = -0.6 * swing;
  right.rot.y = -0.3 * Math.sin(0.7 * t + 0.5);
  right.rot.z = -0.4 * Math.sin(1.9 * t);
  for (const part of POSE_PARTS) eulerToQuat(out[part].rot, out[part].quat);
  return out;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** The fastest each part moves and turns along the true path: m/s and deg/s, from 1 ms differences */
function trueSpeeds(durationMs) {
  const a = createTrackedPose();
  const b = createTrackedPose();
  const speeds = {};
  for (const part of POSE_PARTS) speeds[part] = { linear: 0, angular: 0 };
  for (let ms = 0; ms < durationMs; ms += 1) {
    truePose(ms, a);
    truePose(ms + 1, b);
    for (const part of POSE_PARTS) {
      speeds[part].linear = Math.max(speeds[part].linear, distance(a[part].pos, b[part].pos) * 1000);
      speeds[part].angular = Math.max(speeds[part].angular, quaternionAngleDeg(a[part].quat, b[part].quat) * 1000);
    }
  }
  return speeds;
}

function snapshot(pose) {
  const parts = {};
  for (const part of POSE_PARTS) {
    const p = pose[part];
    parts[part] = { pos: { ...p.pos }, rot: { ...p.rot }, quat: { ...p.quat } };
  }
  return parts;
}

/**
 * Runs one stream: the sender for `durationMs` (or until `stopAtMs`), the network, and the receiver
 * sampling until a second after the last arrival. Returns every sampled frame and the counts.
 */
function simulate({ seed, senderFps, baseLatencyMs, jitterMs, loss, durationMs, delayMs, stopAtMs = Infinity }) {
  const random = mulberry32(seed);

  // The sending client: its own pose in its own store, sent by the real PoseSender from its frame loop
  const senderStore = new PoseStore();
  const own = senderStore.getOrCreate(SENDER_ID);
  own.isVR = true;
  own.tracked = TRACKED_ALL;
  const sent = [];
  let frameTime = 0;
  const sfu = {
    broadcastUint8: (_channel, data) => sent.push({ time: frameTime, bytes: data.slice() }),
    bus: { isRecording: false }
  };
  const sender = new PoseSender(sfu, senderStore);
  sender.setClientId(SENDER_ID);
  const senderFrameMs = 1000 / senderFps;
  for (let frame = 0; frame * senderFrameMs <= Math.min(durationMs, stopAtMs); frame++) {
    frameTime = frame * senderFrameMs;
    truePose(frameTime, own);
    own.receivedAt = frameTime + 1;
    sender.tick(frameTime);
  }

  // The network: a fixed latency, uniform jitter on top, random loss; a packet overtaken by a later one
  // arrives after it
  const deliveries = [];
  let lost = 0;
  sent.forEach((packet, index) => {
    if (random() < loss) {
      lost++;
      return;
    }
    const arrival = packet.time + baseLatencyMs + jitterMs * random();
    deliveries.push({ index, sentAt: packet.time, arrival, bytes: packet.bytes });
  });
  deliveries.sort((a, b) => a.arrival - b.arrival);

  // The receiving client
  const store = new PoseStore();
  store.interpolationDelayMs = delayMs;
  const frames = [];
  const accepted = [];
  let next = 0;
  let dropped = 0;
  let reordered = 0;
  let newestIndex = -1;
  const lastArrival = deliveries[deliveries.length - 1].arrival;
  const phase = RECEIVER_FRAME_MS * random();
  for (let frame = 0; ; frame++) {
    const now = phase + frame * RECEIVER_FRAME_MS;
    if (now > lastArrival + delayMs + 1000) break;
    while (next < deliveries.length && deliveries[next].arrival <= now) {
      const delivery = deliveries[next++];
      if (delivery.index < newestIndex) reordered++;
      newestIndex = Math.max(newestIndex, delivery.index);
      if (receivePosePacket(store, delivery.bytes, delivery.arrival, RECEIVER_ID)) accepted.push(delivery);
      else dropped++;
    }
    store.sample(now);
    if (accepted.length === 0) continue;
    frames.push({ now, newest: accepted[accepted.length - 1], parts: snapshot(store.get(SENDER_ID)) });
  }

  let maxArrivalGap = 0;
  for (let i = 1; i < accepted.length; i++) {
    maxArrivalGap = Math.max(maxArrivalGap, accepted[i].arrival - accepted[i - 1].arrival);
  }
  const sendInterval = (sent[sent.length - 1].time - sent[0].time) / (sent.length - 1);
  return { frames, sent, accepted, lost, dropped, reordered, sendInterval, maxArrivalGap, delayMs };
}

/**
 * Errors of the sampled frames against the true path `lagMs` earlier, between `fromMs` and `toMs`, per
 * part: position and rotation error, and the frame-to-frame step of the output next to the true path's
 * step over the same frame.
 */
function measure(frames, lagMs, fromMs, toMs) {
  const truth = createTrackedPose();
  const previousTruth = createTrackedPose();
  const result = {};
  for (const part of POSE_PARTS) {
    result[part] = { position: [], rotation: [], step: [], trueStep: [], turn: [], trueTurn: [], stepExcess: [] };
  }
  let previous = null;
  let nonFinite = 0;
  for (const frame of frames) {
    for (const part of POSE_PARTS) {
      const p = frame.parts[part];
      if (!isFiniteXyz(p.pos) || !isFiniteXyz(p.rot) || !isFiniteQuat(p.quat)) nonFinite++;
    }
    if (frame.now < fromMs || frame.now > toMs) {
      previous = null;
      continue;
    }
    truePose(frame.now - lagMs, truth);
    if (previous) truePose(previous.now - lagMs, previousTruth);
    for (const part of POSE_PARTS) {
      const out = frame.parts[part];
      const r = result[part];
      r.position.push(distance(out.pos, truth[part].pos));
      r.rotation.push(quaternionAngleDeg(out.quat, truth[part].quat));
      if (previous) {
        const before = previous.parts[part];
        const step = distance(out.pos, before.pos);
        const trueStep = distance(truth[part].pos, previousTruth[part].pos);
        r.step.push(step);
        r.trueStep.push(trueStep);
        r.stepExcess.push(Math.max(0, step - trueStep));
        r.turn.push(quaternionAngleDeg(out.quat, before.quat));
        r.trueTurn.push(quaternionAngleDeg(truth[part].quat, previousTruth[part].quat));
      }
    }
    previous = frame;
  }
  return { result, nonFinite };
}

/** The lag (1 ms steps) at which the sampled positions are closest to the true path, on average */
function bestLag(frames, fromLag, toLag, fromMs, toMs) {
  const truth = createTrackedPose();
  let best = { lag: NaN, error: Infinity };
  for (let lag = fromLag; lag <= toLag; lag++) {
    let sum = 0;
    let count = 0;
    for (const frame of frames) {
      if (frame.now < fromMs || frame.now > toMs) continue;
      truePose(frame.now - lag, truth);
      for (const part of POSE_PARTS) sum += distance(frame.parts[part].pos, truth[part].pos);
      count++;
    }
    if (sum / count < best.error) best = { lag, error: sum / count };
  }
  return best.lag;
}

const DURATION_MS = 60000;
const BASE_LATENCY_MS = 40;
const SPEEDS = trueSpeeds(DURATION_MS + 2000);
/** What the codec's rounding adds: a millimetre per sample, 0.23° per rotation; twice for a step between two samples */
const POSITION_QUANTISATION_M = 0.002;
const ROTATION_QUANTISATION_DEG = 0.5;

/*
 * The bounds. Samples are timed by their arrival, not by the sender's clock, so a sample sent at s sits in
 * the buffer at s + latency + j, with the jitter j in [0, J]. Between two samples the buffer blends linearly
 * in that arrival time, so the sender time it shows at render time r lies in [r - latency - J, r - latency]
 * (r itself being the delay behind now). Against the true path at the nominal lag (delay + latency + J/2)
 * the shown pose is therefore off in time by at most J/2, and
 *
 *   error <= v_max * (J/2 + T) + quantisation,
 *
 * where one send interval T is added for what the time argument leaves out: the curvature a linear blend
 * cuts across a lost packet and the brief carry-on past the newest sample after a gap. "Bounded" is read as
 * this: never further from the truth than the part moves in half the jitter range plus one send interval.
 *
 * The same argument bounds the motion between two frames: F ms of render time span at most F + J ms of
 * sender time, so
 *
 *   step <= v_max * (F + J) + quantisation.
 *
 * The true step is about v * F, so at 30 ms jitter a frame may move up to about 2.8 times as far as the
 * true path did, as a consequence of timing samples by arrival, and no further. "No jumps" is read as this:
 * a snap to a newer packet, a blend toward a dropped or out-of-order sample, or a turn the long way round
 * would exceed it. v_max and the angular speed are the true path's maxima.
 */
function errorBound(speed, J, T) {
  return {
    position: speed.linear * ((J / 2 + T) / 1000) + POSITION_QUANTISATION_M,
    rotation: speed.angular * ((J / 2 + T) / 1000) + ROTATION_QUANTISATION_DEG
  };
}

function stepBound(speed, J) {
  return {
    position: speed.linear * ((RECEIVER_FRAME_MS + J) / 1000) + POSITION_QUANTISATION_M,
    rotation: speed.angular * ((RECEIVER_FRAME_MS + J) / 1000) + ROTATION_QUANTISATION_DEG
  };
}

const SCENARIOS = [
  // At 60 fps the sender sends every 33.3 ms: 0-30 ms of jitter cannot reorder packets at that spacing
  { name: "60 fps sender, 40 ms + 0-30 ms jitter, 5% loss", seed: 0x5eed0101, senderFps: 60, jitterMs: 30 },
  // A 90 Hz headset sends every 22.2 ms: the same jitter reorders packets
  { name: "90 fps sender, 40 ms + 0-30 ms jitter, 5% loss", seed: 0x5eed0102, senderFps: 90, jitterMs: 30 },
  // 30 ms either side of the mean latency: reorders packets at 60 fps as well
  { name: "60 fps sender, 40 ms + 0-60 ms jitter (±30 ms), 5% loss", seed: 0x5eed0103, senderFps: 60, jitterMs: 60 }
];

function runScenario(scenario, delayMs) {
  return simulate({
    ...scenario,
    baseLatencyMs: BASE_LATENCY_MS,
    loss: 0.05,
    durationMs: DURATION_MS,
    delayMs
  });
}

for (const scenario of SCENARIOS) {
  test(`network stream: ${scenario.name}`, t => {
    const run = runScenario(scenario, DEFAULT_INTERPOLATION_DELAY_MS);
    const J = scenario.jitterMs;
    const T = run.sendInterval;
    const fromMs = 1000;
    const toMs = DURATION_MS;
    // The nominal lag: the delay plus the mean latency. The best lag is searched and reported as well
    const latencyLag = DEFAULT_INTERPOLATION_DELAY_MS + BASE_LATENCY_MS;
    const nominalLag = latencyLag + J / 2;
    const searchedLag = bestLag(run.frames, latencyLag - 20, latencyLag + J + 20, fromMs, toMs);
    const { result, nonFinite } = measure(run.frames, nominalLag, fromMs, toMs);
    const atBest = measure(run.frames, searchedLag, fromMs, toMs).result;

    t.log(
      `send interval ${T.toFixed(1)} ms (gate ${SEND_INTERVAL_MS} ms); sent ${run.sent.length}, lost ${run.lost}, ` +
        `arrived after a newer one ${run.reordered}, dropped as late ${run.dropped}, accepted ${run.accepted.length}; ` +
        `longest gap between accepted arrivals ${run.maxArrivalGap.toFixed(1)} ms`
    );
    t.log(`lag: nominal ${nominalLag} ms (delay + latency + mean jitter), best found ${searchedLag} ms`);
    t.is(nonFinite, 0, "no NaN or infinity in any sampled part");
    t.is(run.dropped, run.reordered, "every packet that arrived after a newer one was dropped");
    t.true(
      searchedLag >= latencyLag && searchedLag <= latencyLag + J,
      "the output lags the truth by the delay plus a latency within the jitter range"
    );

    for (const part of POSE_PARTS) {
      const r = result[part];
      const speed = SPEEDS[part];
      const position = summarize(r.position);
      const rotation = summarize(r.rotation);
      const bestPosition = summarize(atBest[part].position);
      const step = summarize(r.step);
      const trueStep = summarize(r.trueStep);
      const excess = summarize(r.stepExcess);
      const turn = summarize(r.turn);
      const trueTurn = summarize(r.trueTurn);
      const errorLimit = errorBound(speed, J, T);
      const stepLimit = stepBound(speed, J);
      t.log(
        `${part} (true speed max ${speed.linear.toFixed(2)} m/s, ${speed.angular.toFixed(0)} deg/s): ` +
          `position error ${format(position, "mm", 1000, 1)}, bound ${(errorLimit.position * 1000).toFixed(1)} mm; ` +
          `at the best lag max ${(bestPosition.max * 1000).toFixed(1)} mean ${(bestPosition.mean * 1000).toFixed(1)} mm`
      );
      t.log(`${part}: rotation error ${format(rotation, "deg", 1, 2)}, bound ${errorLimit.rotation.toFixed(2)} deg`);
      t.log(
        `${part}: step per frame max ${(step.max * 1000).toFixed(1)} p99 ${(step.p99 * 1000).toFixed(1)} mm, ` +
          `true step max ${(trueStep.max * 1000).toFixed(1)} mm, bound ${(stepLimit.position * 1000).toFixed(1)} mm; ` +
          `step beyond the true step ${format(excess, "mm", 1000, 1)}; ` +
          `turn per frame max ${turn.max.toFixed(2)} deg (true ${trueTurn.max.toFixed(
            2
          )}), bound ${stepLimit.rotation.toFixed(2)} deg`
      );
      t.true(position.max <= errorLimit.position, `${part} position error stays bounded`);
      t.true(rotation.max <= errorLimit.rotation, `${part} rotation error stays bounded`);
      t.true(step.max <= stepLimit.position, `${part} moves without jumps`);
      t.true(turn.max <= stepLimit.rotation, `${part} turns without jumps`);
    }
  });
}

test("the 100 ms delay is smoother than showing the newest packet (delay 0)", t => {
  const scenario = SCENARIOS[0];
  const fromMs = 1000;
  const toMs = DURATION_MS;
  const parts = ["rig", ...HAND_PARTS];
  const summaries = {};
  for (const delayMs of [0, DEFAULT_INTERPOLATION_DELAY_MS]) {
    const run = runScenario(scenario, delayMs);
    const lag = delayMs + BASE_LATENCY_MS + scenario.jitterMs / 2;
    const { result, nonFinite } = measure(run.frames, lag, fromMs, toMs);
    t.is(nonFinite, 0);
    summaries[delayMs] = {};
    for (const part of parts) {
      summaries[delayMs][part] = {
        excess: summarize(result[part].stepExcess),
        step: summarize(result[part].step),
        error: summarize(result[part].position)
      };
      const s = summaries[delayMs][part];
      t.log(
        `delay ${delayMs} ms, ${part}: step beyond the true step ${format(s.excess, "mm", 1000, 1)}; ` +
          `step p99 ${(s.step.p99 * 1000).toFixed(1)} mm; position error max ${(s.error.max * 1000).toFixed(1)} ` +
          `mean ${(s.error.mean * 1000).toFixed(1)} mm`
      );
    }
  }
  for (const part of parts) {
    t.true(
      summaries[DEFAULT_INTERPOLATION_DELAY_MS][part].excess.p99 < summaries[0][part].excess.p99,
      `${part}: fewer large steps with the delay than without`
    );
  }
});

/** The shortest spacing of the two samples the buffer takes a velocity from; copied, it is not exported */
const MIN_VELOCITY_SPAN_MS = 25;

test("stream stops: carried on at the last velocity for at most 100 ms, then back to the newest sample and held", t => {
  // A clean stream: the rig moves at 1.5 m/s along x and turns at 90°/s, a sample every 33.3 ms
  const buffer = new InterpolationBuffer();
  const velocity = 1.5;
  const turnRate = 90 * DEG;
  const interval = 1000 / 30;
  let newestTime = 0;
  const quat = new Quaternion();
  const euler = new Euler(0, 0, 0, "YXZ");
  for (let k = 0; k <= 30; k++) {
    newestTime = k * interval;
    const pos = { x: (velocity * newestTime) / 1000, y: 1, z: 0 };
    const rot = { x: 0, y: (turnRate * newestTime) / 1000, z: 0 };
    buffer.push("rig", newestTime, pos, rot);
    quat.setFromEuler(euler.set(rot.x, rot.y, rot.z));
    buffer.push("head", newestTime, pos, rot, quat);
  }
  const newestX = (velocity * newestTime) / 1000;
  const newestQuat = new Quaternion().setFromEuler(euler.set(0, (turnRate * newestTime) / 1000, 0));
  const pos = { x: 0, y: 0, z: 0 };
  const rot = { x: 0, y: 0, z: 0 };
  const out = { x: 0, y: 0, z: 0, w: 1 };
  let maxOvershoot = 0;
  let maxOvershootAt = 0;
  let maxTurnOver = 0;
  let previousOvershoot = 0;
  let monotonic = true;
  let heldExactly = true;
  let interpolationExact = true;
  for (let ahead = -100; ahead <= 500; ahead += 0.5) {
    for (const part of ["rig", "head"]) {
      t.true(buffer.sample(part, newestTime + ahead, pos, rot, out));
      const overshoot = pos.x - newestX;
      const turnOver = quaternionAngleDeg(out, newestQuat);
      if (ahead <= 0) {
        if (Math.abs(pos.x - (velocity * (newestTime + ahead)) / 1000) > 1e-9) interpolationExact = false;
        continue;
      }
      if (overshoot > maxOvershoot) {
        maxOvershoot = overshoot;
        maxOvershootAt = ahead;
      }
      maxTurnOver = Math.max(maxTurnOver, turnOver);
      // Moving away from the newest sample only for the first 100 ms, back toward it after that
      if (part === "rig") {
        if (ahead <= MAX_EXTRAPOLATION_MS && overshoot < previousOvershoot - 1e-12) monotonic = false;
        if (ahead > MAX_EXTRAPOLATION_MS && overshoot > previousOvershoot + 1e-12) monotonic = false;
        previousOvershoot = overshoot;
      }
      // From 200 ms on the newest sample is held. At exactly 200 ms the buffer's own subtraction of the
      // sample time can land a rounding error short of it and blend by a residue of 1e-16; past it the
      // sample is copied exactly
      const back = MAX_EXTRAPOLATION_MS + EXTRAPOLATION_RETURN_MS;
      if (ahead === back && (Math.abs(pos.x - newestX) > 1e-12 || turnOver > 1e-9)) heldExactly = false;
      if (ahead > back) {
        const sameQuat =
          out.x === newestQuat.x && out.y === newestQuat.y && out.z === newestQuat.z && out.w === newestQuat.w;
        if (pos.x !== newestX || !sameQuat) heldExactly = false;
      }
    }
  }
  const limit = (velocity * MAX_EXTRAPOLATION_MS) / 1000;
  const turnLimit = (90 * MAX_EXTRAPOLATION_MS) / 1000;
  t.log(
    `overshoot max ${(maxOvershoot * 1000).toFixed(3)} mm at ${maxOvershootAt} ms past the newest sample ` +
      `(limit ${(limit * 1000).toFixed(1)} mm = ${MAX_EXTRAPOLATION_MS} ms x 1.5 m/s); ` +
      `turn past the newest sample max ${maxTurnOver.toFixed(4)} deg (limit ${turnLimit} deg)`
  );
  t.true(interpolationExact, "between samples a linear motion is reproduced exactly");
  t.true(maxOvershoot <= limit + 1e-9, "carried on no further than 100 ms at the last velocity");
  t.true(Math.abs(maxOvershootAt - MAX_EXTRAPOLATION_MS) <= 0.5, "the carry-on stops at 100 ms");
  t.true(maxTurnOver <= turnLimit + 1e-6, "turned on no further than 100 ms at the last turn rate");
  t.true(monotonic, "away from the newest sample for 100 ms, then back toward it");
  t.true(heldExactly, "from 200 ms on the newest sample is held exactly");
});

test("stream stops through the receive path: bounded carry-on, then the newest sample held", t => {
  const stopAtMs = 10000;
  const run = simulate({
    ...SCENARIOS[0],
    baseLatencyMs: BASE_LATENCY_MS,
    loss: 0.05,
    durationMs: stopAtMs,
    stopAtMs,
    delayMs: DEFAULT_INTERPOLATION_DELAY_MS
  });
  const newest = run.accepted[run.accepted.length - 1];
  // The sample the buffer takes the velocity from: the newest one at least 25 ms older by arrival
  let earlier = null;
  for (let i = run.accepted.length - 2; i >= 0; i--) {
    if (newest.arrival - run.accepted[i].arrival >= MIN_VELOCITY_SPAN_MS) {
      earlier = run.accepted[i];
      break;
    }
  }
  const newestBody = createTrackedPose();
  const earlierBody = createTrackedPose();
  decodeBody(newest.bytes, newestBody);
  decodeBody(earlier.bytes, earlierBody);
  const span = newest.arrival - earlier.arrival;

  let violations = 0;
  let notHeld = 0;
  let framesPast = 0;
  const report = [];
  for (const part of POSE_PARTS) {
    const speed = distance(newestBody[part].pos, earlierBody[part].pos) / span;
    const turnRate = quaternionAngleDeg(newestBody[part].quat, earlierBody[part].quat) / span;
    let maxAway = 0;
    let maxTurn = 0;
    let lastAwayAt = 0;
    for (const frame of run.frames) {
      const ahead = frame.now - run.delayMs - newest.arrival;
      if (ahead <= 0) continue;
      if (part === "rig") framesPast++;
      const out = frame.parts[part];
      const away = distance(out.pos, newestBody[part].pos);
      const turn = quaternionAngleDeg(out.quat, newestBody[part].quat);
      maxAway = Math.max(maxAway, away);
      maxTurn = Math.max(maxTurn, turn);
      // At most the last velocity times the time carried on, which stops at 100 ms and shrinks to 0 by 200 ms
      const carried =
        Math.min(ahead, MAX_EXTRAPOLATION_MS) *
        (1 - Math.max(0, ahead - MAX_EXTRAPOLATION_MS) / EXTRAPOLATION_RETURN_MS);
      if (away > speed * Math.max(0, carried) + 1e-9) violations++;
      if (turn > turnRate * Math.max(0, carried) + 1e-6) violations++;
      if (away > 1e-12) lastAwayAt = ahead;
      if (ahead >= MAX_EXTRAPOLATION_MS + EXTRAPOLATION_RETURN_MS && (away !== 0 || turn > 1e-9)) notHeld++;
      if (!isFiniteXyz(out.pos) || !isFiniteQuat(out.quat)) violations++;
    }
    report.push(
      `${part} ${(maxAway * 1000).toFixed(1)} mm / ${maxTurn.toFixed(2)} deg ` +
        `(limit ${(speed * MAX_EXTRAPOLATION_MS * 1000).toFixed(1)} mm / ${(turnRate * MAX_EXTRAPOLATION_MS).toFixed(
          2
        )} deg), ` +
        `last off the newest sample ${lastAwayAt.toFixed(0)} ms past it`
    );
  }
  t.log(
    `stream stopped at ${stopAtMs} ms; ${framesPast} frames rendered past the newest sample (velocity span ${span.toFixed(
      1
    )} ms)`
  );
  t.log(`furthest from the newest sample: ${report.join("; ")}`);
  t.is(violations, 0, "never further than the last velocity carried for at most 100 ms, no NaN");
  t.is(notHeld, 0, "from 200 ms past the newest sample on, the newest sample is held exactly");
  t.true(framesPast > 30);
});

test("yaw wrap 150° -> 210° blends the short way", t => {
  const euler = new Euler(0, 0, 0, "YXZ");
  const pos = { x: 0, y: 0, z: 0 };
  const rot = { x: 0, y: 0, z: 0 };
  const quat = { x: 0, y: 0, z: 0, w: 1 };
  const from = new Quaternion().setFromEuler(euler.set(0, 150 * DEG, 0));
  const to = new Quaternion().setFromEuler(euler.set(0, 210 * DEG, 0));
  const negatedTo = to.clone().set(-to.x, -to.y, -to.z, -to.w);
  const cases = [
    // The old per-part packets: Euler angles, 210° as the -150° a sender reports
    {
      name: "Euler",
      push: buffer =>
        buffer.push("rig", 0, pos, { x: 0, y: 150 * DEG, z: 0 }) ||
        buffer.push("rig", 100, pos, { x: 0, y: -150 * DEG, z: 0 })
    },
    // Whole-body packets: quaternions, the second one also as its negation (the same rotation)
    {
      name: "quaternion",
      push: buffer => buffer.push("rig", 0, pos, rot, from) || buffer.push("rig", 100, pos, rot, to)
    },
    {
      name: "negated quaternion",
      push: buffer => buffer.push("rig", 0, pos, rot, from) || buffer.push("rig", 100, pos, rot, negatedTo)
    }
  ];
  for (const { name, push } of cases) {
    const buffer = new InterpolationBuffer();
    push(buffer);
    let maxError = 0;
    for (let time = 0; time <= 100; time += 1) {
      buffer.sample("rig", time, pos, rot, quat);
      const expected = 150 + (60 * time) / 100;
      const yaw = (rot.y / DEG + 360) % 360;
      maxError = Math.max(maxError, Math.abs(yaw - expected));
    }
    buffer.sample("rig", 50, pos, rot, quat);
    t.log(
      `${name}: max yaw error along the blend ${maxError.toExponential(2)} deg; at the midpoint ${(rot.y / DEG).toFixed(
        9
      )} deg`
    );
    t.true(maxError < 1e-9, `${name}: 150° -> 180° -> 210°, never through 0°`);
    t.true(Math.abs(Math.abs(rot.y) - Math.PI) < 1e-9, `${name}: the midpoint is 180°`);
  }
});

test("buffer basics: empty, single sample, before the oldest sample, capacity", t => {
  const buffer = new InterpolationBuffer();
  const pos = { x: 7, y: 7, z: 7 };
  const rot = { x: 0, y: 0, z: 0 };
  const quat = { x: 0, y: 0, z: 0, w: 1 };
  t.false(buffer.sample("head", 0, pos, rot, quat), "nothing to sample before the first push");
  t.deepEqual(pos, { x: 7, y: 7, z: 7 }, "and nothing written");

  buffer.push("head", 100, { x: 1, y: 2, z: 3 }, { x: 0.1, y: 0.2, z: 0.3 });
  for (const time of [0, 100, 150, 1000]) {
    t.true(buffer.sample("head", time, pos, rot, quat));
    t.deepEqual(pos, { x: 1, y: 2, z: 3 }, `a single sample is held at ${time}`);
  }

  // More samples than the ring holds: the oldest are replaced, a time before the oldest kept one holds it
  const ring = new InterpolationBuffer();
  const count = CAPACITY * 3 + 5;
  for (let k = 0; k < count; k++) ring.push("leftHand", k * 10, { x: k, y: 0, z: 0 }, rot);
  const oldestKept = count - CAPACITY;
  ring.sample("leftHand", 0, pos, rot, quat);
  t.is(pos.x, oldestKept, "before every kept sample the oldest kept one is held");
  ring.sample("leftHand", (count - 10) * 10 + 5, pos, rot, quat);
  t.is(pos.x, count - 10 + 0.5, "between kept samples the blend is exact");

  // An arrival clock that steps back is clamped: the ring stays in insertion order
  const back = new InterpolationBuffer();
  back.push("rig", 100, { x: 0, y: 0, z: 0 }, rot);
  back.push("rig", 90, { x: 1, y: 0, z: 0 }, rot);
  back.sample("rig", 100, pos, rot, quat);
  t.true(isFiniteXyz(pos), "no NaN from two samples at the same time");

  // The store leaves a part without samples alone
  const store = new PoseStore();
  const pose = store.getOrCreate("only-flags");
  pose.head.pos.x = 5;
  store.sample(1000);
  t.is(pose.head.pos.x, 5);
});
