import test from "ava";
import { Euler, Quaternion } from "three";
import { decodePart, POSE_BYTES } from "../../../src/avatar/net/pose-codec-v0";
import {
  BODY_BYTES,
  decodeBody,
  encodeBody,
  isOlderSeq,
  POSE_CHANNEL,
  POSE_VERSION
} from "../../../src/avatar/net/pose-codec-v1";
import { PoseSender } from "../../../src/avatar/net/pose-sender";
import { PoseStore } from "../../../src/avatar/pose/pose-store";
import { createTrackedPose, eulerToQuat, quatToEuler, TRACKED_ALL } from "../../../src/avatar/pose/tracked-pose";
import { mulberry32, randomInt, randomQuaternion, uniform } from "./_random";
import { receivePosePacket, SEQ_RESTART_AFTER_MS } from "./_receive-pose";
import { angleDifference, format, quaternionAngleDeg, summarize } from "./_stats";

/**
 * T0.2: the whole-body codec (pose-codec-v1), the late-packet rule and the old per-part decoder
 * (pose-codec-v0). Pass: position error 1 mm or less, rotation error 0.23 degrees or less.
 */

const POSITION_LIMIT_M = 0.001;
const ROTATION_LIMIT_DEG = 0.23;
const RAD_TO_DEG = 180 / Math.PI;
const PARTS = ["head", "leftHand", "rightHand"];
const textEncoder = new TextEncoder();

/** A 36-character id in the shape the clients use (a UUID), from the seeded generator */
function randomUuid(random) {
  const hex = "0123456789abcdef";
  let id = "";
  for (let i = 0; i < 36; i++) {
    id += i === 8 || i === 13 || i === 18 || i === 23 ? "-" : hex[randomInt(random, 16)];
  }
  return id;
}

/** Ids whose UTF-8 bytes are not one per character: two-, three- and four-byte sequences */
const MULTI_BYTE_IDS = ["élève-ünïcødé-Ωμέγα", "クライアント・テスト", "🦊🐼 client 🛰️", "混合-mixed-ид-🙂"];

function randomPose(random, index) {
  const pose = createTrackedPose();
  pose.rig.pos.x = uniform(random, -100, 100);
  pose.rig.pos.y = uniform(random, -100, 100);
  pose.rig.pos.z = uniform(random, -100, 100);
  // Any yaw, also beyond ±π; the rig never pitches or rolls
  pose.rig.rot.y = uniform(random, -4 * Math.PI, 4 * Math.PI);
  eulerToQuat(pose.rig.rot, pose.rig.quat);
  for (const part of PARTS) {
    const p = pose[part];
    p.pos.x = uniform(random, -2, 2);
    p.pos.y = uniform(random, -2, 2);
    p.pos.z = uniform(random, -2, 2);
    Object.assign(p.quat, randomQuaternion(random));
    quatToEuler(p.quat, p.rot);
  }
  // All 64 combinations of the flag fields in turn: tracked bits, VR, the two animation state bits
  pose.tracked = index & 7;
  pose.isVR = ((index >> 3) & 1) === 1;
  pose.animState = (index >> 4) & 3;
  return pose;
}

function createBody() {
  const pose = createTrackedPose();
  return { rig: pose.rig, head: pose.head, leftHand: pose.leftHand, rightHand: pose.rightHand };
}

test("v1 round trip of 20,000 random poses", t => {
  const random = mulberry32(0x5eed0001);
  const count = 20000;
  const rigPositionErrors = [];
  const rigYawErrors = [];
  const rigRotationErrors = [];
  const partPositionErrors = [];
  const partAxisErrors = [];
  const rotationErrors = [];
  let eulerMismatch = 0;
  let maxEulerDiff = 0;
  let eulerQuatMismatch = 0;
  let exactFailures = 0;
  let lengthFailures = 0;
  let multiByteIds = 0;
  const flagCombinations = new Set();
  const decoded = createBody();
  const threeQuat = new Quaternion();
  const threeEuler = new Euler();
  const back = { x: 0, y: 0, z: 0, w: 1 };

  for (let i = 0; i < count; i++) {
    const pose = randomPose(random, i);
    const multiByte = i % 50 === 0;
    const clientId = multiByte ? MULTI_BYTE_IDS[(i / 50) % MULTI_BYTE_IDS.length] : randomUuid(random);
    if (multiByte) multiByteIds++;
    const idBytes = textEncoder.encode(clientId);
    // seq and time beyond 16 bits too: the codec keeps them modulo 65536
    const seq = randomInt(random, 1 << 20);
    const timeMs = randomInt(random, 1 << 20);
    const packet = new Uint8Array(BODY_BYTES + idBytes.length);
    const written = encodeBody(pose, seq, timeMs, idBytes, packet);
    if (written !== BODY_BYTES + idBytes.length || (!multiByte && written !== 86)) lengthFailures++;

    const header = decodeBody(packet, decoded);
    // The header is shared by every decode: everything is read from it before the next one
    const expectedFlags = (pose.tracked & 7) | (pose.isVR ? 8 : 0) | (pose.animState << 4);
    if (
      packet[0] !== POSE_VERSION ||
      header.clientId !== clientId ||
      header.seq !== (seq & 0xffff) ||
      header.timeMs !== (timeMs & 0xffff) ||
      header.flags !== expectedFlags ||
      header.tracked !== pose.tracked ||
      header.isVR !== pose.isVR ||
      header.animState !== pose.animState
    ) {
      exactFailures++;
    }
    flagCombinations.add(header.flags);

    // The rig: Float32 position, i16 yaw
    for (const axis of ["x", "y", "z"]) {
      if (decoded.rig.pos[axis] !== Math.fround(pose.rig.pos[axis])) exactFailures++;
    }
    rigPositionErrors.push(
      Math.hypot(
        decoded.rig.pos.x - pose.rig.pos.x,
        decoded.rig.pos.y - pose.rig.pos.y,
        decoded.rig.pos.z - pose.rig.pos.z
      )
    );
    rigYawErrors.push(Math.abs(angleDifference(decoded.rig.rot.y, pose.rig.rot.y)) * RAD_TO_DEG);
    rigRotationErrors.push(quaternionAngleDeg(decoded.rig.quat, pose.rig.quat));
    if (decoded.rig.rot.x !== 0 || decoded.rig.rot.z !== 0) exactFailures++;

    // Head and hands: millimetres relative to the rig, smallest-three quaternions
    for (const part of PARTS) {
      const original = pose[part];
      const result = decoded[part];
      for (const axis of ["x", "y", "z"]) {
        partAxisErrors.push(Math.abs(result.pos[axis] - original.pos[axis]));
        if (result.pos[axis] !== Math.round(original.pos[axis] * 1000) / 1000) exactFailures++;
      }
      partPositionErrors.push(
        Math.hypot(result.pos.x - original.pos.x, result.pos.y - original.pos.y, result.pos.z - original.pos.z)
      );
      rotationErrors.push(quaternionAngleDeg(result.quat, original.quat));

      // The decoded Euler angles are three.js's YXZ angles of the decoded quaternion
      threeEuler.setFromQuaternion(threeQuat.set(result.quat.x, result.quat.y, result.quat.z, result.quat.w), "YXZ");
      const eulerDiff = Math.max(
        Math.abs(angleDifference(result.rot.x, threeEuler.x)),
        Math.abs(angleDifference(result.rot.y, threeEuler.y)),
        Math.abs(angleDifference(result.rot.z, threeEuler.z))
      );
      maxEulerDiff = Math.max(maxEulerDiff, eulerDiff);
      if (eulerDiff > 1e-12) eulerMismatch++;
      // ...and the same rotation as the quaternion
      eulerToQuat(result.rot, back);
      if (quaternionAngleDeg(back, result.quat) > 1e-5) eulerQuatMismatch++;
    }
  }

  const rigPosition = summarize(rigPositionErrors);
  const rigYaw = summarize(rigYawErrors);
  const rigRotation = summarize(rigRotationErrors);
  const partPosition = summarize(partPositionErrors);
  const partAxis = summarize(partAxisErrors);
  const rotation = summarize(rotationErrors);
  t.log(`rig position error ${format(rigPosition, "mm", 1000, 5)}`);
  t.log(`rig yaw error ${format(rigYaw, "deg", 1, 5)}`);
  t.log(`rig rotation error ${format(rigRotation, "deg", 1, 5)}`);
  t.log(`head/hand position error, euclidean ${format(partPosition, "mm", 1000, 4)}`);
  t.log(`head/hand position error, per axis ${format(partAxis, "mm", 1000, 4)}`);
  t.log(`head/hand rotation error ${format(rotation, "deg", 1, 4)}`);
  t.log(`decoded Euler vs three.js setFromQuaternion: max difference ${maxEulerDiff.toExponential(2)} rad`);
  t.log(`flag combinations ${flagCombinations.size} of 64; multi-byte ids ${multiByteIds}; 36-char id packet 86 bytes`);

  t.is(lengthFailures, 0, "packet length is 50 + id bytes, 86 for a 36-character id");
  t.is(exactFailures, 0, "flags, seq, time, client id, rig Float32 and millimetre values exact");
  t.is(flagCombinations.size, 64);
  t.true(rigPosition.max <= POSITION_LIMIT_M, `rig position max ${rigPosition.max} m`);
  t.true(partPosition.max <= POSITION_LIMIT_M, `head/hand position max ${partPosition.max} m`);
  t.true(rigYaw.max <= ROTATION_LIMIT_DEG, `rig yaw max ${rigYaw.max} deg`);
  t.true(rigRotation.max <= ROTATION_LIMIT_DEG, `rig rotation max ${rigRotation.max} deg`);
  t.true(rotation.max <= ROTATION_LIMIT_DEG, `head/hand rotation max ${rotation.max} deg`);
  // Properties of the format, tighter than the plan: half a step of each quantisation
  t.true(partAxis.max <= 0.0005 + 1e-12, "millimetre rounding is at most half a millimetre per axis");
  t.true(rigYaw.max <= (0.5 * 180) / 32767 + 1e-9, "yaw rounding is at most half a step");
  t.is(eulerMismatch, 0, "decoded Euler angles equal three.js setFromQuaternion(q, 'YXZ')");
  t.is(eulerQuatMismatch, 0, "decoded Euler angles and quaternion are the same rotation");
});

test("v1 special quaternions: identity, negated, half turns, ties, unnormalised, zero", t => {
  const h = Math.SQRT1_2;
  const cases = [
    { x: 0, y: 0, z: 0, w: 1 },
    { x: 0, y: 0, z: 0, w: -1 },
    { x: 1, y: 0, z: 0, w: 0 },
    { x: 0, y: -1, z: 0, w: 0 },
    { x: 0, y: 0, z: 1, w: 0 },
    { x: 0.5, y: 0.5, z: 0.5, w: 0.5 },
    { x: -0.5, y: 0.5, z: -0.5, w: -0.5 },
    { x: h, y: h, z: 0, w: 0 },
    { x: 0, y: 0, z: -h, w: h },
    { x: 3, y: 0, z: 4, w: 0 }, // not normalised
    { x: 0.001, y: -0.002, z: 0.0005, w: -0.4 } // not normalised, largest negative
  ];
  const pose = createTrackedPose();
  const decoded = createBody();
  const id = textEncoder.encode("special");
  const packet = new Uint8Array(BODY_BYTES + id.length);
  let maxError = 0;
  for (const q of cases) {
    Object.assign(pose.head.quat, q);
    Object.assign(pose.leftHand.quat, { x: -q.x, y: -q.y, z: -q.z, w: -q.w });
    encodeBody(pose, 0, 0, id, packet);
    decodeBody(packet, decoded);
    for (const part of ["head", "leftHand"]) {
      const error = quaternionAngleDeg(decoded[part].quat, q);
      maxError = Math.max(maxError, error);
      t.true(error <= ROTATION_LIMIT_DEG, `${JSON.stringify(q)} decoded ${JSON.stringify(decoded[part].quat)}`);
      const { x, y, z, w } = decoded[part].quat;
      t.true(Math.abs(Math.hypot(x, y, z, w) - 1) < 0.005, "decoded quaternion is unit length");
    }
  }
  // A zero quaternion has no rotation; it is sent as the identity
  Object.assign(pose.head.quat, { x: 0, y: 0, z: 0, w: 0 });
  encodeBody(pose, 0, 0, id, packet);
  decodeBody(packet, decoded);
  t.deepEqual({ ...decoded.head.quat }, { x: 0, y: 0, z: 0, w: 1 });
  t.log(`max rotation error over the special cases ${maxError.toFixed(4)} deg`);
});

test("v1 positions are clamped at ±32.767 m and the yaw is wrapped", t => {
  const pose = createTrackedPose();
  const decoded = createBody();
  const id = textEncoder.encode("clamp");
  const packet = new Uint8Array(BODY_BYTES + id.length);
  const cases = [
    [40, 32.767],
    [-40, -32.767],
    [32.7674, 32.767],
    [32.7676, 32.767],
    [-32.768, -32.767],
    [1e9, 32.767],
    [0.0004, 0],
    [-0.0006, -0.001]
  ];
  for (const [input, expected] of cases) {
    pose.head.pos.x = input;
    pose.rightHand.pos.z = input;
    encodeBody(pose, 0, 0, id, packet);
    decodeBody(packet, decoded);
    t.is(decoded.head.pos.x, expected, `head x ${input}`);
    t.is(decoded.rightHand.pos.z, expected, `right hand z ${input}`);
  }
  for (const yaw of [Math.PI, -Math.PI, 3 * Math.PI, 7.5, -100]) {
    pose.rig.rot.y = yaw;
    encodeBody(pose, 0, 0, id, packet);
    decodeBody(packet, decoded);
    t.true(Math.abs(decoded.rig.rot.y) <= Math.PI + 1e-12);
    t.true(Math.abs(angleDifference(decoded.rig.rot.y, yaw)) * RAD_TO_DEG <= 0.003, `yaw ${yaw}`);
  }
});

test("v1 rejects short packets and other versions", t => {
  const decoded = createBody();
  t.throws(() => decodeBody(new Uint8Array(BODY_BYTES - 1), decoded), { instanceOf: RangeError });
  const packet = new Uint8Array(BODY_BYTES);
  encodeBody(createTrackedPose(), 0, 0, new Uint8Array(0), packet);
  t.is(decodeBody(packet, decoded).clientId, "", "an empty client id is allowed");
  packet[0] = 0;
  t.throws(() => decodeBody(packet, decoded), { instanceOf: RangeError });
  t.is(POSE_CHANNEL, "#avatar-pose");
});

test("isOlderSeq on the 16-bit circle", t => {
  t.true(isOlderSeq(5, 5), "the same number again is old");
  t.false(isOlderSeq(6, 5));
  t.true(isOlderSeq(4, 5));
  t.false(isOlderSeq(0, 0xffff), "0 follows 65535");
  t.true(isOlderSeq(0xffff, 0), "65535 comes before 0");
  t.false(isOlderSeq(5 + 0x8000, 5), "half a circle ahead counts as newer");
  t.true(isOlderSeq(5 + 0x8001, 5), "more than half a circle ahead is behind");
  t.false(isOlderSeq(5, 5 + 0x8000), "exactly half a circle apart counts as newer in both directions");
  // Against the arithmetic on the circle: for a gap d (mod 65536), newer iff 1 <= d <= 32768
  const random = mulberry32(0x5eed0002);
  let mismatches = 0;
  for (let i = 0; i < 100000; i++) {
    const last = randomInt(random, 65536);
    const gap = randomInt(random, 65536);
    const expectedOlder = !(gap >= 1 && gap <= 0x8000);
    if (isOlderSeq((last + gap) & 0xffff, last) !== expectedOlder) mismatches++;
  }
  t.is(mismatches, 0);
});

/**
 * The real sender (PoseSender, its frame gate and its page-wide sequence counter) feeds a network that
 * delays, reorders, duplicates, loses and holds back packets; the receiver applies the late-packet rule
 * of pose-sync.ts (copied in _receive-pose.js) to the decoded packets. Its decisions must equal an oracle
 * that knows each packet's unwrapped position in the stream: take a packet only when it is newer than every
 * packet taken before.
 */
test("140,000 packets across 16-bit wraps: late and duplicate packets dropped, none taken out of order", t => {
  const random = mulberry32(0x5eed0003);
  const SENDER = "sender-0000-0000-0000-000000000000";
  const RECEIVER = "receiver-000-0000-0000-000000000000";
  const senderStore = new PoseStore();
  const own = senderStore.getOrCreate(SENDER);
  own.receivedAt = 1;
  own.tracked = TRACKED_ALL;
  const sent = [];
  let frameTime = 0;
  const sfu = {
    broadcastUint8: (channel, data) => sent.push({ channel, time: frameTime, bytes: data.slice() }),
    bus: { isRecording: false }
  };
  const sender = new PoseSender(sfu, senderStore);
  sender.setClientId(SENDER);
  // A 90 Hz headset: the 22 ms gate passes every other frame, a packet every 22.2 ms
  const frameMs = 1000 / 90;
  for (let frame = 0; sent.length < 140500; frame++) {
    frameTime = frame * frameMs;
    own.head.pos.x = Math.sin(frameTime / 1000);
    sender.tick(frameTime);
  }
  t.true(sent.every(packet => packet.channel === POSE_CHANNEL));

  // Network: 40 ms + 0-30 ms jitter (reorders at this spacing), 1% loss, 0.1% duplicated,
  // 0.1% held back 50-1500 ms (well under the 2 s restart window, so they must be dropped)
  const deliveries = [];
  let heldBack = 0;
  let duplicated = 0;
  sent.forEach((packet, index) => {
    if (random() < 0.01) return;
    let arrival = packet.time + 40 + 30 * random();
    if (random() < 0.001) {
      arrival += uniform(random, 50, 1500);
      heldBack++;
    }
    deliveries.push({ index, arrival, bytes: packet.bytes });
    if (random() < 0.001) {
      deliveries.push({ index, arrival: packet.time + 40 + 60 * random(), bytes: packet.bytes });
      duplicated++;
    }
  });
  deliveries.sort((a, b) => a.arrival - b.arrival || a.index - b.index);

  const store = new PoseStore();
  let lastAcceptedIndex = -1;
  let lastAcceptedSeq = -1;
  let accepted = 0;
  let dropped = 0;
  let droppedDuplicates = 0;
  let disagreements = 0;
  let outOfOrder = 0;
  let wraps = 0;
  let arrivedAfterNewer = 0;
  let newestArrivedIndex = -1;
  for (const delivery of deliveries) {
    if (delivery.index <= newestArrivedIndex) arrivedAfterNewer++;
    newestArrivedIndex = Math.max(newestArrivedIndex, delivery.index);
    const taken = receivePosePacket(store, delivery.bytes, delivery.arrival, RECEIVER);
    const oracle = delivery.index > lastAcceptedIndex;
    if (taken !== oracle) disagreements++;
    if (taken) {
      if (delivery.index <= lastAcceptedIndex) outOfOrder++;
      const seq = store.get(SENDER).seq;
      if (lastAcceptedSeq >= 0 && seq < lastAcceptedSeq) wraps++;
      lastAcceptedSeq = seq;
      lastAcceptedIndex = delivery.index;
      accepted++;
    } else {
      dropped++;
      if (delivery.index === lastAcceptedIndex) droppedDuplicates++;
    }
  }

  t.log(
    `sent ${sent.length} packets, delivered ${deliveries.length} (1% lost), held back ${heldBack}, ` +
      `duplicated ${duplicated}; arrived after a newer one or again ${arrivedAfterNewer}`
  );
  t.log(
    `accepted ${accepted}, dropped ${dropped} (of which repeats of the last taken ${droppedDuplicates}), ` +
      `16-bit wraps seen by the receiver ${wraps}, decisions differing from the oracle ${disagreements}`
  );
  t.true(sent.length >= 140000);
  t.true(wraps >= 2, "at least two 16-bit wraps");
  t.is(outOfOrder, 0, "no packet taken out of order");
  t.is(disagreements, 0, "every packet that arrived after a newer one was dropped, every other one taken");
  t.true(arrivedAfterNewer > heldBack + duplicated, "the jitter reordered packets too");
  t.is(dropped, arrivedAfterNewer, "exactly the packets that arrived after a newer one (or again) were dropped");
});

test("a sender restart is taken after 2 s without packets, not before", t => {
  const OWN = "receiver";
  const SENDER = "restarting-sender";
  const id = textEncoder.encode(SENDER);
  const packetOf = seq => {
    const packet = new Uint8Array(BODY_BYTES + id.length);
    encodeBody(createTrackedPose(), seq, 0, id, packet);
    return packet;
  };
  t.is(SEQ_RESTART_AFTER_MS, 2000);

  // For a last number in 1..32767, seq 0 lies behind it on the circle, so the restart waits for the window.
  // The last numbers are above the ~78 packets the new sender sends in that time; below that it would
  // catch up and be taken as newer before the window ends, which is also right
  for (const lastSeq of [100, 5000, 32767]) {
    const store = new PoseStore();
    // The old stream ends at lastSeq, taken at 10 000 ms
    for (let i = 0; i < 100; i++) {
      const seq = (lastSeq - 99 + i) & 0xffff;
      t.true(receivePosePacket(store, packetOf(seq), 10000 - 22 * (99 - i), OWN));
    }
    const lastTaken = 10000;
    // The page is reloaded: the new sender counts from 0, every 22 ms from 300 ms after the old one stopped
    let seq = 0;
    let firstTaken = null;
    let droppedBefore = 0;
    for (let time = lastTaken + 300; time < lastTaken + 2500; time += 22, seq++) {
      const taken = receivePosePacket(store, packetOf(seq), time, OWN);
      if (time - lastTaken < SEQ_RESTART_AFTER_MS) {
        t.false(taken, `seq ${seq} at +${time - lastTaken} ms after ${lastSeq}`);
        droppedBefore++;
      } else if (firstTaken === null) {
        firstTaken = { seq, at: time - lastTaken, taken };
      } else {
        t.true(taken, `seq ${seq} after the restart was taken`);
      }
    }
    t.true(firstTaken.taken, `the first packet 2 s after the old stream (+${firstTaken.at} ms) is taken`);
    t.log(
      `old stream ended at seq ${lastSeq}: ${droppedBefore} packets of the restarted sender dropped, ` +
        `then seq ${firstTaken.seq} taken ${firstTaken.at} ms after the last old packet`
    );
  }

  // The boundary itself: 1999 ms after the last taken packet still dropped, 2000 ms taken
  const store = new PoseStore();
  t.true(receivePosePacket(store, packetOf(100), 50000, OWN));
  t.false(receivePosePacket(store, packetOf(0), 51999, OWN));
  t.false(receivePosePacket(store, packetOf(100), 51999.9, OWN), "a duplicate is dropped too");
  t.true(receivePosePacket(store, packetOf(0), 52000, OWN));
  t.true(receivePosePacket(store, packetOf(1), 52022, OWN));

  // From seq 40000, 0 lies less than half a circle ahead: it counts as newer and is taken at once
  const other = new PoseStore();
  t.true(receivePosePacket(other, packetOf(40000), 1000, OWN));
  t.true(receivePosePacket(other, packetOf(0), 1100, OWN));

  // The own client's packets are never taken
  const own = new PoseStore();
  t.is(receivePosePacket(own, packetOf(0), 1000, SENDER), null);
  t.false(own.has(SENDER));
});

test("v0 decoding of 20,000 random packets is exact", t => {
  const random = mulberry32(0x5eed0004);
  const position = { x: 0, y: 0, z: 0 };
  const rotation = { x: 0, y: 0, z: 0 };
  let mismatches = 0;
  let padded = 0;
  for (let i = 0; i < 20000; i++) {
    const values = [
      uniform(random, -1000, 1000),
      uniform(random, -1000, 1000),
      uniform(random, -1000, 1000),
      uniform(random, -Math.PI, Math.PI),
      uniform(random, -4 * Math.PI, 4 * Math.PI),
      uniform(random, -Math.PI, Math.PI)
    ];
    const clientId = i % 40 === 0 ? MULTI_BYTE_IDS[(i / 40) % MULTI_BYTE_IDS.length] : randomUuid(random);
    const idBytes = textEncoder.encode(clientId);
    const padding = i % 3 === 0 ? randomInt(random, 9) : 0;
    if (padding > 0) padded++;
    const packet = new Uint8Array(POSE_BYTES + idBytes.length + padding);
    const view = new DataView(packet.buffer);
    values.forEach((value, k) => view.setFloat32(4 * k, value, true));
    packet.set(idBytes, POSE_BYTES);

    const decodedId = decodePart(packet, position, rotation);
    const decoded = [position.x, position.y, position.z, rotation.x, rotation.y, rotation.z];
    const expected = values.map(value => Math.round(Math.fround(value) * 1000) / 1000);
    if (decodedId !== clientId || decoded.some((value, k) => value !== expected[k])) mismatches++;
  }
  t.log(`20000 v0 packets, ${padded} NUL padded, mismatches ${mismatches}`);
  t.is(mismatches, 0);
  t.throws(() => decodePart(new Uint8Array(POSE_BYTES - 1), position, rotation), { instanceOf: RangeError });
});

test("Euler <-> quaternion conversion matches three.js (YXZ)", t => {
  const random = mulberry32(0x5eed0005);
  const quat = { x: 0, y: 0, z: 0, w: 1 };
  const rot = { x: 0, y: 0, z: 0 };
  const threeQuat = new Quaternion();
  const threeEuler = new Euler();
  let maxQuatDiff = 0;
  let maxEulerDiff = 0;
  for (let i = 0; i < 20000; i++) {
    // A tenth at a pitch of exactly ±90°, where yaw and roll are not separable
    const pitch = i % 10 === 0 ? (i % 20 === 0 ? 1 : -1) * (Math.PI / 2) : uniform(random, -Math.PI / 2, Math.PI / 2);
    const euler = { x: pitch, y: uniform(random, -Math.PI, Math.PI), z: uniform(random, -Math.PI, Math.PI) };
    eulerToQuat(euler, quat);
    threeQuat.setFromEuler(threeEuler.set(euler.x, euler.y, euler.z, "YXZ"));
    maxQuatDiff = Math.max(
      maxQuatDiff,
      Math.abs(quat.x - threeQuat.x),
      Math.abs(quat.y - threeQuat.y),
      Math.abs(quat.z - threeQuat.z),
      Math.abs(quat.w - threeQuat.w)
    );
    const q = randomQuaternion(random);
    quatToEuler(q, rot);
    threeEuler.setFromQuaternion(threeQuat.set(q.x, q.y, q.z, q.w), "YXZ");
    maxEulerDiff = Math.max(
      maxEulerDiff,
      Math.abs(angleDifference(rot.x, threeEuler.x)),
      Math.abs(angleDifference(rot.y, threeEuler.y)),
      Math.abs(angleDifference(rot.z, threeEuler.z))
    );
  }
  t.log(
    `max component difference: quaternion ${maxQuatDiff.toExponential(2)}, Euler ${maxEulerDiff.toExponential(2)} rad`
  );
  t.true(maxQuatDiff <= 1e-12);
  t.true(maxEulerDiff <= 1e-12);
});
