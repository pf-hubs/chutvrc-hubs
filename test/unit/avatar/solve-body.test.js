import test from "ava";
import { Bone, Euler, Object3D, Quaternion, Vector3 } from "three";
import { applyToBones, readRestFrames } from "../../../src/avatar/ik/apply-to-bones";
import { FALLBACK_EYE_UP } from "../../../src/avatar/ik/head";
import { createBoneWrites, createIkState, solveBody } from "../../../src/avatar/ik/solve-body";
import { HEAD_SWING_LIMIT, HEAD_TWIST_LIMIT } from "../../../src/avatar/ik/spine-chain";
import { createTwoBoneOutput, solveTwoBone } from "../../../src/avatar/ik/two-bone-ik";
import { BODY_BONE_NAMES, BONE_NAMES } from "../../../src/avatar/rig/bone-names";
import { buildRigDescription } from "../../../src/avatar/rig/rig-description";
import { copyTransform, createTrackedPose, TRACKED_ALL } from "../../../src/avatar/pose/tracked-pose";
import { AvatarAnimState } from "../../../src/types/avatar-types";
import { mulberry32, randomDirection, randomInt, randomQuaternion, uniform } from "./_random";
import { isFiniteQuat, isFiniteXyz, summarize } from "./_stats";

/**
 * T0.4: the body solver on synthetic rigs. Pass: hand error under 1 mm; no NaN; bone lengths kept.
 *
 * The rigs are three.js bone hierarchies named the way Mixamo-style rigs are, so the keyword mapper finds
 * them, run through the same calls the client makes: buildRigDescription, readRestFrames, createIkState,
 * solveBody, applyToBones. Every measurement is taken from the bones' world matrices afterwards.
 *
 * Hand targets are smoothed over frames (45 ms) except on a state's first frame, which snaps. The reach
 * tests therefore solve each target with a fresh state, in one frame; one test follows a persistent state
 * over frames until the hand converges.
 *
 * In VR the model is drawn at the ratio the frame gives (the sender's announced eye height over the model's;
 * 1 when the frame gives none): the tracked head and controllers are divided by it on all three axes, solved,
 * and the root is scaled by it, so the hands are measured against the controllers as they are, at any ratio.
 * The first-frame height scale of earlier builds is gone: a frame without a ratio is solved at the model's
 * own size, whatever the headset's height.
 */

const HAND_LIMIT_M = 0.001;
const LENGTH_TOLERANCE = 1e-6;
const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);

/** The elbow pole of solve-body.ts (down, back along the body's heading, out to the side); copied, not exported */
const ELBOW_POLE_DOWN = 1;
const ELBOW_POLE_BACK = 0.7;
const ELBOW_POLE_OUT = 0.3;
/** The chain joints' limits from CHAIN_JOINTS in spine-chain.ts, in degrees; copied, not exported */
const CHAIN_LIMITS = {
  spine: { swing: 25, twist: 20 },
  chest: { swing: 25, twist: 25 },
  neck: { swing: 35, twist: 40 }
};
const CHAIN = ["spine", "chest", "neck"];

/**
 * A humanoid in a T-pose facing -z, in metres: [object name, bone name, parent object name, position].
 * The arms are 0.28 + 0.26 m, the legs 0.43 + 0.44 m; the eyes are 1.7 m over the floor.
 */
const T_POSE = [
  ["Armature", "root", null, [0, 0, 0]],
  ["Hips", "hips", "Armature", [0, 1.0, 0]],
  ["Spine", "spine", "Hips", [0, 1.1, 0.01]],
  ["Chest", "chest", "Spine", [0, 1.3, 0]],
  ["Neck", "neck", "Chest", [0, 1.5, 0]],
  ["Head", "head", "Neck", [0, 1.6, 0]],
  ["LeftEye", "leftEye", "Head", [-0.032, 1.7, -0.08]],
  ["RightEye", "rightEye", "Head", [0.032, 1.7, -0.08]],
  ["LeftShoulder", "leftShoulder", "Chest", [-0.05, 1.45, 0]],
  ["LeftArm", "leftUpperArm", "LeftShoulder", [-0.17, 1.45, 0]],
  ["LeftForeArm", "leftLowerArm", "LeftArm", [-0.45, 1.45, 0]],
  ["LeftHand", "leftHand", "LeftForeArm", [-0.71, 1.45, 0]],
  ["RightShoulder", "rightShoulder", "Chest", [0.05, 1.45, 0]],
  ["RightArm", "rightUpperArm", "RightShoulder", [0.17, 1.45, 0]],
  ["RightForeArm", "rightLowerArm", "RightArm", [0.45, 1.45, 0]],
  ["RightHand", "rightHand", "RightForeArm", [0.71, 1.45, 0]],
  ["LeftUpLeg", "leftUpperLeg", "Hips", [-0.1, 0.95, 0]],
  ["LeftLeg", "leftLowerLeg", "LeftUpLeg", [-0.1, 0.52, 0]],
  ["LeftFoot", "leftFoot", "LeftLeg", [-0.1, 0.08, 0]],
  ["RightUpLeg", "rightUpperLeg", "Hips", [0.1, 0.95, 0]],
  ["RightLeg", "rightLowerLeg", "RightUpLeg", [0.1, 0.52, 0]],
  ["RightFoot", "rightFoot", "RightLeg", [0.1, 0.08, 0]]
];

/** The same body with an unnamed node between chest and neck, which no solver moves */
const T_POSE_WITH_AUX = T_POSE.flatMap(row =>
  row[0] === "Neck"
    ? [
        ["Aux", null, "Chest", [0, 1.4, 0.02]],
        ["Neck", "neck", "Aux", [0, 1.5, 0]]
      ]
    : [row]
);

/** An upper body without arms: the hands hang from the spine, the spine from the hips */
const HALF_BODY = [
  ["Armature", "root", null, [0, 0, 0]],
  ["Hips", "hips", "Armature", [0, 1.0, 0]],
  ["Spine", "spine", "Hips", [0, 1.2, 0]],
  ["Neck", "neck", "Spine", [0, 1.5, 0]],
  ["Head", "head", "Neck", [0, 1.6, 0]],
  ["LeftHand", "leftHand", "Spine", [-0.3, 1.2, 0]],
  ["RightHand", "rightHand", "Spine", [0.3, 1.2, 0]]
];

/**
 * Builds the hierarchy from root-space rest positions and orientations. `facing` "+z" turns the whole
 * body half around; `restRotations` "random" gives every bone a random rest orientation, the positions of
 * the joints staying where the table has them.
 */
function buildFixture(name, { layout = T_POSE, facing = "-z", restRotations = "identity", seed = 1, omit = [] } = {}) {
  const random = mulberry32(seed);
  const turn = new Quaternion().setFromAxisAngle(UP, facing === "+z" ? Math.PI : 0);
  const model = new Object3D();
  model.name = "Scene";
  const byObjectName = new Map();
  const rest = {};
  const objects = {};
  const omitted = new Set(omit);
  const parentObjectName = {};
  for (const [objectName, , parentName] of layout) parentObjectName[objectName] = parentName;
  for (const [objectName, bone, parentName, position] of layout) {
    if (bone && omitted.has(bone)) continue;
    // The nearest parent that is not omitted
    let parent = parentName;
    while (parent && !byObjectName.has(parent)) parent = parentObjectName[parent];
    const worldPosition = new Vector3(...position).applyQuaternion(turn);
    const worldQuaternion =
      restRotations === "random" && bone !== "root"
        ? new Quaternion().copy(randomQuaternion(random)).premultiply(turn)
        : bone === "root"
        ? new Quaternion()
        : turn.clone();
    const object = bone === "root" || bone === null ? new Object3D() : new Bone();
    object.name = objectName;
    const parentEntry = parent ? byObjectName.get(parent) : null;
    const parentQuaternion = parentEntry ? parentEntry.quaternion : new Quaternion();
    const parentPosition = parentEntry ? parentEntry.position : new Vector3();
    const parentInverse = parentQuaternion.clone().invert();
    object.quaternion.copy(parentInverse).multiply(worldQuaternion);
    object.position.copy(worldPosition).sub(parentPosition).applyQuaternion(parentInverse);
    (parentEntry ? parentEntry.object : model).add(object);
    byObjectName.set(objectName, { object, position: worldPosition, quaternion: worldQuaternion, bone });
    if (bone) {
      objects[bone] = object;
      rest[bone] = { position: worldPosition, quaternion: worldQuaternion };
    }
  }
  model.updateMatrixWorld(true);
  const rig = buildRigDescription(model);

  // Consecutive named joints: each named bone and the nearest named bone above it, but the hips, which the
  // solver places, and the hands of an upper body, which it places too
  const pairs = [];
  for (const bone of Object.keys(objects)) {
    if (bone === "root" || bone === "hips") continue;
    if (rig.isHalfBody && (bone === "leftHand" || bone === "rightHand")) continue;
    let ancestor = objects[bone].parent;
    while (ancestor && !Object.values(objects).includes(ancestor)) ancestor = ancestor.parent;
    const ancestorBone = Object.keys(objects).find(key => objects[key] === ancestor);
    if (!ancestorBone || ancestorBone === "root") continue;
    pairs.push([ancestorBone, bone, rest[ancestorBone].position.distanceTo(rest[bone].position)]);
  }

  const eyes = ["leftEye", "rightEye"].filter(eye => rest[eye]);
  const eyeHeight =
    eyes.length > 0
      ? eyes.reduce((sum, eye) => sum + rest[eye].position.y, 0) / eyes.length
      : rest.head.position.y + FALLBACK_EYE_UP;
  const armLength = side =>
    rest[`${side}UpperArm`] && rest[`${side}LowerArm`] && rest[`${side}Hand`]
      ? {
          upper: rest[`${side}UpperArm`].position.distanceTo(rest[`${side}LowerArm`].position),
          lower: rest[`${side}LowerArm`].position.distanceTo(rest[`${side}Hand`].position)
        }
      : null;
  return {
    name,
    model,
    rig,
    frames: readRestFrames(rig),
    writes: createBoneWrites(),
    objects,
    rest,
    pairs,
    eyeHeight,
    arms: { left: armLength("left"), right: armLength("right") },
    expectedForward: new Vector3(0, 0, -1).applyQuaternion(turn)
  };
}

const FULL_RIGS = [
  buildFixture("T-pose facing -z, identity rest"),
  buildFixture("T-pose facing -z, random rest rotations, unnamed node", {
    layout: T_POSE_WITH_AUX,
    restRotations: "random",
    seed: 0x5eed0201
  }),
  buildFixture("T-pose facing +z, random rest rotations", { facing: "+z", restRotations: "random", seed: 0x5eed0202 }),
  buildFixture("T-pose facing +z, identity rest", { facing: "+z" })
];
const HALF_BODY_RIG = buildFixture("upper body without arms", { layout: HALF_BODY });
const MISSING_RIG = buildFixture("no chest, no left forearm, no right foot, no eyes", {
  omit: ["chest", "leftLowerArm", "rightFoot", "leftEye", "rightEye"]
});
const MINIMAL_RIG = buildFixture("hips, spine and head only", {
  omit: ["chest", "neck", "leftEye", "rightEye", ...BONE_NAMES.filter(name => /Arm|Hand|Leg|Foot|Shoulder/.test(name))]
});

function makePose({
  rigPos = [0, 0, 0],
  rigYaw = 0,
  head,
  headRot = [0, 0, 0],
  left = [-0.3, 1.0, -0.2],
  right = [0.3, 1.0, -0.2],
  leftRot = [0, 0, 0],
  rightRot = [0, 0, 0],
  isVR = true,
  isNPC = false,
  animState = AvatarAnimState.STAND
}) {
  const pose = createTrackedPose(isNPC);
  pose.isVR = isVR;
  pose.tracked = TRACKED_ALL;
  pose.animState = animState;
  const set = (part, pos, rot) =>
    copyTransform({ pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] } }, pose[part]);
  set("rig", rigPos, [0, rigYaw, 0]);
  set("head", head, headRot);
  set("leftHand", left, leftRot);
  set("rightHand", right, rightRot);
  return pose;
}

function solve(fixture, pose, state = createIkState(fixture.frames), now = 1000, isSelf = false, modelRatio) {
  solveBody(fixture.rig, pose, state, fixture.writes, { now, isSelf, modelRatio });
  applyToBones(fixture.rig, fixture.writes);
  return state;
}

function worldPosition(fixture, bone) {
  return fixture.objects[bone].getWorldPosition(new Vector3());
}

function rigToWorld(pose, v) {
  return new Vector3(v.x, v.y, v.z).applyAxisAngle(UP, pose.rig.rot.y).add(pose.rig.pos);
}

function worldToRig(pose, v) {
  return v.clone().sub(pose.rig.pos).applyAxisAngle(UP, -pose.rig.rot.y);
}

/** The body's heading in rig space after a solve */
function bodyAxes(state) {
  const yaw = state.bodyYaw.yaw;
  return {
    forward: new Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)),
    right: new Vector3(Math.cos(yaw), 0, -Math.sin(yaw))
  };
}

function elbowPole(state, side) {
  const { forward, right } = bodyAxes(state);
  const outward = side === "left" ? -1 : 1;
  return new Vector3(0, -ELBOW_POLE_DOWN, 0)
    .addScaledVector(forward, -ELBOW_POLE_BACK)
    .addScaledVector(right, outward * ELBOW_POLE_OUT)
    .normalize();
}

/**
 * How well the middle joint lies on the pole's side of the line from the root to the end: the cosine
 * between the joint's offset from that line and the pole's part perpendicular to it; null when either is
 * too short to have a direction (a straight limb, a pole along the limb).
 */
function poleSideCosine(rootWorld, jointWorld, endWorld, poleWorld) {
  const direction = endWorld.clone().sub(rootWorld).normalize();
  const offset = jointWorld.clone().sub(rootWorld);
  offset.addScaledVector(direction, -offset.dot(direction));
  const pole = poleWorld.clone().addScaledVector(direction, -poleWorld.dot(direction));
  if (offset.length() < 1e-6 || pole.length() < 1e-3) return null;
  return offset.normalize().dot(pole.normalize());
}

/** The largest relative change of a distance between consecutive named joints, for a model drawn at `ratio` */
function boneLengthError(fixture, ratio = 1) {
  let worst = 0;
  for (const [a, b, restLength] of fixture.pairs) {
    const length = worldPosition(fixture, a).distanceTo(worldPosition(fixture, b));
    worst = Math.max(worst, Math.abs(length - restLength * ratio) / (restLength * ratio));
  }
  return worst;
}

/** Whether every written rotation is a finite unit quaternion and every written position and bone is finite */
function allFinite(fixture) {
  const writes = fixture.writes;
  for (const name of BODY_BONE_NAMES) {
    if (!writes.hasRotation[name]) continue;
    const q = writes.rotation[name];
    if (!isFiniteQuat(q) || Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) > 1e-6) return false;
  }
  for (const name of ["root", "hips", "leftHand", "rightHand"]) {
    if (writes.hasPosition[name] && !isFiniteXyz(writes.position[name])) return false;
  }
  for (const bone of Object.keys(fixture.objects)) {
    if (!fixture.objects[bone].matrixWorld.elements.every(Number.isFinite)) return false;
  }
  return true;
}

function standingHead(fixture) {
  return [0, fixture.eyeHeight, 0];
}

test("the synthetic rigs map to the expected bones", t => {
  for (const fixture of [...FULL_RIGS, HALF_BODY_RIG, MISSING_RIG, MINIMAL_RIG]) {
    for (const bone of BONE_NAMES) {
      t.is(fixture.rig.bones[bone], fixture.objects[bone] ?? null, `${fixture.name}: ${bone}`);
    }
    t.is(fixture.rig.isHalfBody, fixture === HALF_BODY_RIG, `${fixture.name}: half body`);
    t.log(
      `${fixture.name}: forward (${fixture.rig.forward.toArray().map(v => v.toFixed(3))}), ` +
        `isFlippedY ${fixture.rig.isFlippedY}, eye height ${fixture.eyeHeight.toFixed(3)} m`
    );
  }
  for (const fixture of FULL_RIGS) {
    t.true(fixture.rig.forward.distanceTo(fixture.expectedForward) < 1e-9, `${fixture.name}: forward`);
  }
});

/**
 * Body setups the reach tests are solved in: rig position and yaw, the headset's orientation (the body
 * turns to the head's yaw on a state's first frame) and whether the avatar is the own one, which stands
 * 0.1 m behind the camera.
 */
const SETUPS = [
  { rigPos: [0, 0, 0], rigYaw: 0, headRot: [0, 0, 0], isSelf: false },
  { rigPos: [3, 0.2, -5], rigYaw: 2.5, headRot: [-0.3, 0.4, 0.1], isSelf: true },
  { rigPos: [-20, 0, 7], rigYaw: -3.0, headRot: [0.5, -0.8, -0.2], isSelf: false }
];

test("reachable targets in front, above, behind and anywhere: hand within 1 mm, elbow on the pole side", t => {
  const random = mulberry32(0x5eed0203);
  const errors = [];
  const cosines = [];
  let worstLength = 0;
  let finite = true;
  let solves = 0;
  const named = {};
  for (const fixture of FULL_RIGS) {
    for (const setup of SETUPS) {
      for (const side of ["left", "right"]) {
        const base = { ...setup, head: standingHead(fixture) };
        // The shoulder does not depend on the hand targets: find it once for this setup
        const probePose = makePose(base);
        const probeState = solve(fixture, probePose, undefined, 1000, setup.isSelf);
        const shoulder = worldToRig(probePose, worldPosition(fixture, `${side}UpperArm`));
        const { forward, right } = bodyAxes(probeState);
        const outward = right.clone().multiplyScalar(side === "left" ? -1 : 1);
        const arm = fixture.arms[side];
        const reach = arm.upper + arm.lower;

        const targets = [];
        const directions = {
          front: forward,
          above: UP,
          behind: forward.clone().negate(),
          below: UP.clone().negate(),
          outward,
          across: outward.clone().negate()
        };
        for (const [label, direction] of Object.entries(directions)) {
          for (const fraction of [0.3, 0.6, 0.9, 0.99]) {
            targets.push({ label, position: shoulder.clone().addScaledVector(direction, fraction * reach) });
          }
        }
        for (let i = 0; i < 100; i++) {
          const direction = new Vector3().copy(randomDirection(random));
          const fraction = uniform(random, 0.05, 0.995);
          targets.push({ label: "random", position: shoulder.clone().addScaledVector(direction, fraction * reach) });
        }

        for (const target of targets) {
          const handKey = side === "left" ? "left" : "right";
          const pose = makePose({ ...base, [handKey]: target.position.toArray() });
          const state = solve(fixture, pose, undefined, 1000, setup.isSelf);
          solves++;
          const expected = rigToWorld(pose, target.position);
          const hand = worldPosition(fixture, `${side}Hand`);
          const error = hand.distanceTo(expected);
          errors.push(error);
          named[target.label] = Math.max(named[target.label] ?? 0, error);
          const pole = elbowPole(state, side).applyAxisAngle(UP, pose.rig.rot.y);
          const cosine = poleSideCosine(
            worldPosition(fixture, `${side}UpperArm`),
            worldPosition(fixture, `${side}LowerArm`),
            hand,
            pole
          );
          if (cosine !== null) cosines.push(cosine);
          worstLength = Math.max(worstLength, boneLengthError(fixture));
          if (!allFinite(fixture)) finite = false;
        }
      }
    }
  }
  const summary = summarize(errors);
  const minCosine = Math.min(...cosines);
  t.log(
    `${solves} solves on ${FULL_RIGS.length} rigs: hand error max ${(summary.max * 1000).toExponential(2)} ` +
      `mean ${(summary.mean * 1000).toExponential(2)} p99 ${(summary.p99 * 1000).toExponential(2)} mm`
  );
  t.log(
    `max hand error by direction (mm): ${Object.entries(named)
      .map(([label, error]) => `${label} ${(error * 1000).toExponential(1)}`)
      .join(", ")}`
  );
  t.log(
    `elbow on the pole side: min cosine ${minCosine.toFixed(9)} over ${cosines.length} bent arms; ` +
      `bone length change max ${worstLength.toExponential(2)} (relative)`
  );
  t.true(summary.max < HAND_LIMIT_M, "hand error under 1 mm");
  t.true(minCosine > 0.9999, "the elbow bends toward the pole: down, back and out");
  t.true(worstLength < LENGTH_TOLERANCE, "bone lengths kept");
  t.true(finite, "no NaN");
});

test("unreachable targets, a target on the shoulder, a pole along the arm: finite, lengths kept", t => {
  const random = mulberry32(0x5eed0204);
  let worstStraight = 0;
  let worstOffLine = 0;
  let worstPoleAlong = 0;
  let worstLength = 0;
  let finite = true;
  for (const fixture of FULL_RIGS) {
    for (const setup of SETUPS) {
      for (const side of ["left", "right"]) {
        const base = { ...setup, head: standingHead(fixture) };
        const probePose = makePose(base);
        const probeState = solve(fixture, probePose, undefined, 1000, setup.isSelf);
        const shoulderWorld = worldPosition(fixture, `${side}UpperArm`);
        const shoulder = worldToRig(probePose, shoulderWorld);
        const arm = fixture.arms[side];
        const reach = arm.upper + arm.lower;
        const handKey = side === "left" ? "left" : "right";
        const check = () => {
          worstLength = Math.max(worstLength, boneLengthError(fixture));
          if (!allFinite(fixture)) finite = false;
        };

        // Out of reach: the arm points straight at the target
        for (let i = 0; i < 20; i++) {
          const direction = new Vector3().copy(randomDirection(random));
          const target = shoulder.clone().addScaledVector(direction, uniform(random, 1.01, 3) * reach);
          const pose = makePose({ ...base, [handKey]: target.toArray() });
          solve(fixture, pose, undefined, 1000, setup.isSelf);
          const hand = worldPosition(fixture, `${side}Hand`);
          const elbow = worldPosition(fixture, `${side}LowerArm`);
          const worldDirection = rigToWorld(pose, target).sub(shoulderWorld).normalize();
          const expected = shoulderWorld.clone().addScaledVector(worldDirection, reach);
          worstStraight = Math.max(worstStraight, hand.distanceTo(expected));
          const offset = elbow.clone().sub(shoulderWorld);
          worstOffLine = Math.max(
            worstOffLine,
            offset.addScaledVector(worldDirection, -offset.dot(worldDirection)).length()
          );
          check();
        }

        // On the shoulder: no direction to reach in. Finite and lengths kept; where the hand ends up is
        // the known failure below (a fully folded arm whose rest pose is straight)
        {
          const pose = makePose({ ...base, [handKey]: shoulder.toArray() });
          solve(fixture, pose, undefined, 1000, setup.isSelf);
          check();
        }

        // Along the pole, and against it: the pole has no side to give, the rest bend is used
        for (const sign of [1, -1]) {
          const pole = elbowPole(probeState, side);
          const target = shoulder.clone().addScaledVector(pole, sign * 0.6 * reach);
          const pose = makePose({ ...base, [handKey]: target.toArray() });
          solve(fixture, pose, undefined, 1000, setup.isSelf);
          worstPoleAlong = Math.max(
            worstPoleAlong,
            worldPosition(fixture, `${side}Hand`).distanceTo(rigToWorld(pose, target))
          );
          check();
        }
      }
    }
  }
  t.log(
    `unreachable: hand off the straight arm max ${(worstStraight * 1000).toExponential(2)} mm, ` +
      `elbow off the line max ${(worstOffLine * 1000).toExponential(2)} mm`
  );
  t.log(
    `pole along the arm: hand error max ${(worstPoleAlong * 1000).toExponential(2)} mm; ` +
      `bone length change max ${worstLength.toExponential(2)}`
  );
  t.true(finite, "no NaN");
  t.true(worstStraight < HAND_LIMIT_M, "an unreachable target gets the straight arm pointing at it");
  t.true(worstOffLine < 1e-6, "the straight arm has its elbow on the line");
  t.true(worstPoleAlong < HAND_LIMIT_M, "a pole along the arm still reaches the target");
  t.true(worstLength < LENGTH_TOLERANCE, "bone lengths kept");
});

test("crouch over frames: feet stay planted, knees bend forward, lengths kept", t => {
  for (const fixture of FULL_RIGS) {
    const rigPos = [1.5, 0, -2];
    const rigYaw = 0.7;
    const state = createIkState(fixture.frames);
    let now = 1000;
    let planted = null;
    let worstFoot = 0;
    let minKneeCosine = Infinity;
    let worstLength = 0;
    let finite = true;
    let firstHipsY = null;
    let lastHipsY = null;
    for (let frame = 0; frame <= 40; frame++) {
      // Down to 70% of the standing height over 20 frames, then held
      const depth = Math.min(frame / 20, 1) * 0.3;
      const pose = makePose({ rigPos, rigYaw, head: [0, fixture.eyeHeight * (1 - depth), 0] });
      solve(fixture, pose, state, now);
      now += 1000 / 60;
      const feet = ["left", "right"].map(side => worldPosition(fixture, `${side}Foot`));
      if (!planted) planted = feet.map(foot => foot.clone());
      feet.forEach((foot, i) => (worstFoot = Math.max(worstFoot, foot.distanceTo(planted[i]))));
      const forward = bodyAxes(state).forward.applyAxisAngle(UP, rigYaw);
      for (const side of ["left", "right"]) {
        const cosine = poleSideCosine(
          worldPosition(fixture, `${side}UpperLeg`),
          worldPosition(fixture, `${side}LowerLeg`),
          worldPosition(fixture, `${side}Foot`),
          forward
        );
        if (cosine !== null) minKneeCosine = Math.min(minKneeCosine, cosine);
      }
      worstLength = Math.max(worstLength, boneLengthError(fixture));
      if (!allFinite(fixture)) finite = false;
      const hipsY = worldPosition(fixture, "hips").y;
      if (firstHipsY === null) firstHipsY = hipsY;
      lastHipsY = hipsY;
    }
    t.log(
      `${fixture.name}: hips lowered ${((firstHipsY - lastHipsY) * 1000).toFixed(0)} mm; feet moved max ` +
        `${(worstFoot * 1000).toExponential(2)} mm; knee forward min cosine ${minKneeCosine.toFixed(9)}; ` +
        `length change ${worstLength.toExponential(2)}`
    );
    t.true(firstHipsY - lastHipsY > 0.3 * fixture.eyeHeight * 0.9, `${fixture.name}: the body crouched`);
    t.true(worstFoot < HAND_LIMIT_M, `${fixture.name}: the feet stay where they were planted`);
    t.true(minKneeCosine > 0.9999, `${fixture.name}: the knees bend forward`);
    t.true(worstLength < LENGTH_TOLERANCE, `${fixture.name}: bone lengths kept`);
    t.true(finite, `${fixture.name}: no NaN`);
  }
});

/** The rotation of a joint relative to the joint below it, with the rest orientations taken out */
function relativeRotation(fixture, below, joint) {
  const restBelow = fixture.rest[below].quaternion;
  const restJoint = fixture.rest[joint].quaternion;
  const worldBelow = fixture.objects[below].getWorldQuaternion(new Quaternion());
  const worldJoint = fixture.objects[joint].getWorldQuaternion(new Quaternion());
  return restBelow.clone().multiply(worldBelow.invert()).multiply(worldJoint).multiply(restJoint.clone().invert());
}

/** The rotation split as swing after twist about the vertical, as angles in radians */
function swingTwist(q) {
  let { x, y, z, w } = q;
  if (w < 0) {
    x = -x;
    y = -y;
    z = -z;
    w = -w;
  }
  const twist = 2 * Math.atan2(y, w);
  const swing = new Quaternion(x, y, z, w).multiply(new Quaternion().setFromAxisAngle(UP, -twist));
  return {
    swing: 2 * Math.atan2(Math.hypot(swing.x, swing.y, swing.z), Math.abs(swing.w)),
    twist: Math.abs(twist)
  };
}

function chainRotations(fixture) {
  const rotations = {};
  let below = "hips";
  for (const joint of [...CHAIN, "head"]) {
    if (!fixture.objects[joint]) continue;
    rotations[joint] = relativeRotation(fixture, below, joint);
    below = joint;
  }
  return rotations;
}

test("spine limits at extreme head yaw and pitch: no joint turned past its swing and twist limits", t => {
  const max = {};
  for (const joint of [...CHAIN, "head"]) max[joint] = { swing: 0, twist: 0 };
  let violations = 0;
  let finite = true;
  let worstLength = 0;
  const yaws = [-179, -150, -120, -60, 0, 60, 120, 150, 179];
  const pitches = [-90, -75, -60, -30, 0, 30, 60, 75, 90];
  for (const fixture of FULL_RIGS) {
    for (const isVR of [false, true]) {
      for (const yaw of yaws) {
        for (const pitch of pitches) {
          // The body turns to the head on the first frame; a millisecond later the head has turned away
          const state = createIkState(fixture.frames);
          solve(fixture, makePose({ head: standingHead(fixture), isVR }), state, 1000);
          solve(
            fixture,
            makePose({ head: standingHead(fixture), headRot: [pitch * DEG, yaw * DEG, 0], isVR }),
            state,
            1001
          );
          const rotations = chainRotations(fixture);
          for (const [joint, rotation] of Object.entries(rotations)) {
            const { swing, twist } = swingTwist(rotation);
            max[joint].swing = Math.max(max[joint].swing, swing);
            max[joint].twist = Math.max(max[joint].twist, twist);
            const limit =
              joint === "head"
                ? { swing: HEAD_SWING_LIMIT, twist: HEAD_TWIST_LIMIT }
                : {
                    swing: CHAIN_LIMITS[joint].swing * DEG,
                    twist: CHAIN_LIMITS[joint].twist * DEG
                  };
            if (swing > limit.swing + 1e-6 || twist > limit.twist + 1e-6) violations++;
          }
          if (!allFinite(fixture)) finite = false;
          worstLength = Math.max(worstLength, boneLengthError(fixture));
        }
      }
    }
  }
  t.log(
    `max swing / twist (deg) over ${FULL_RIGS.length * 2 * yaws.length * pitches.length} poses: ` +
      Object.entries(max)
        .map(([joint, m]) => `${joint} ${(m.swing / DEG).toFixed(3)} / ${(m.twist / DEG).toFixed(3)}`)
        .join(", ")
  );
  t.log(
    `limits (deg): spine 25/20, chest 25/25, neck 35/40, head ${(HEAD_SWING_LIMIT / DEG).toFixed(0)}/${(
      HEAD_TWIST_LIMIT / DEG
    ).toFixed(0)}; pitch alone cannot reach a chain joint's swing limit (its share of 90° is below it)`
  );
  t.is(violations, 0, "no joint turned past its limits");
  t.true(finite, "no NaN");
  t.true(worstLength < LENGTH_TOLERANCE, "bone lengths kept");
  // The extreme yaws did drive every twist to its limit, so the limits were exercised
  for (const joint of CHAIN)
    t.true(max[joint].twist > CHAIN_LIMITS[joint].twist * DEG - 1e-6, `${joint} twist limit reached`);
  t.true(max.head.twist > HEAD_TWIST_LIMIT - 1e-6, "head twist limit reached");
});

test("spine limits with VR roll: each chain angle within its limit; the head within its swing and twist", t => {
  const random = mulberry32(0x5eed0205);
  const maxAxis = {};
  const maxSwing = {};
  for (const joint of CHAIN) {
    maxAxis[joint] = { pitch: 0, yaw: 0, roll: 0 };
    maxSwing[joint] = 0;
  }
  let headSwing = 0;
  let headTwist = 0;
  let violations = 0;
  let finite = true;
  const euler = new Euler();
  for (const fixture of FULL_RIGS) {
    for (let i = 0; i < 300; i++) {
      const headRot = [
        i % 10 === 0 ? (i % 20 === 0 ? 1 : -1) * (Math.PI / 2) : uniform(random, -Math.PI / 2, Math.PI / 2),
        uniform(random, -Math.PI, Math.PI),
        uniform(random, -Math.PI, Math.PI)
      ];
      const state = createIkState(fixture.frames);
      solve(fixture, makePose({ head: standingHead(fixture) }), state, 1000);
      solve(fixture, makePose({ head: standingHead(fixture), headRot }), state, 1001);
      const rotations = chainRotations(fixture);
      for (const joint of CHAIN) {
        // The joint's turn is a YXZ Euler rotation clamped per angle: pitch and roll to the swing limit,
        // yaw to the twist limit. Its facing turn (0 or 180° about the vertical) keeps the magnitudes
        euler.setFromQuaternion(rotations[joint], "YXZ");
        const limit = CHAIN_LIMITS[joint];
        const axes = { pitch: Math.abs(euler.x), yaw: Math.abs(euler.y), roll: Math.abs(euler.z) };
        for (const axis of ["pitch", "yaw", "roll"]) maxAxis[joint][axis] = Math.max(maxAxis[joint][axis], axes[axis]);
        if (axes.pitch > limit.swing * DEG + 1e-6 || axes.roll > limit.swing * DEG + 1e-6) violations++;
        if (axes.yaw > limit.twist * DEG + 1e-6) violations++;
        maxSwing[joint] = Math.max(maxSwing[joint], swingTwist(rotations[joint]).swing);
      }
      const head = swingTwist(rotations.head);
      headSwing = Math.max(headSwing, head.swing);
      headTwist = Math.max(headTwist, head.twist);
      if (head.swing > HEAD_SWING_LIMIT + 1e-6 || head.twist > HEAD_TWIST_LIMIT + 1e-6) violations++;
      if (!allFinite(fixture)) finite = false;
    }
  }
  t.log(
    `max |pitch| / |yaw| / |roll| (deg): ` +
      CHAIN.map(
        joint =>
          `${joint} ${(maxAxis[joint].pitch / DEG).toFixed(2)} / ${(maxAxis[joint].yaw / DEG).toFixed(2)} / ${(
            maxAxis[joint].roll / DEG
          ).toFixed(2)}`
      ).join(", ") +
      `; head swing ${(headSwing / DEG).toFixed(2)}, twist ${(headTwist / DEG).toFixed(2)}`
  );
  t.log(
    `bend away from rest (swing of the swing-twist split, pitch and roll together), max (deg): ` +
      CHAIN.map(joint => `${joint} ${(maxSwing[joint] / DEG).toFixed(2)} (limit ${CHAIN_LIMITS[joint].swing})`).join(
        ", "
      )
  );
  t.is(violations, 0, "every chain angle within its limit, the head within 60/80");
  t.true(finite, "no NaN");
  t.true(maxAxis.neck.roll > CHAIN_LIMITS.neck.swing * DEG - 1e-6, "the neck's roll limit was reached");
  t.true(headSwing > HEAD_SWING_LIMIT - 1e-6, "the head's swing limit was reached");
});

test("hand smoothing: the first frame snaps, later frames converge, a teleport snaps", t => {
  const fixture = FULL_RIGS[0];
  const state = createIkState(fixture.frames);
  const head = standingHead(fixture);
  const a = [0.25, 1.2, -0.35];
  const b = [0.35, 1.35, -0.15];
  // The rig stands at the origin facing -z: rig space is world space here
  const error = target => worldPosition(fixture, "rightHand").distanceTo(new Vector3(...target));
  let now = 1000;
  const step = target => {
    now += 1000 / 60;
    solve(fixture, makePose({ head, right: target }), state, now);
  };
  solve(fixture, makePose({ head, right: a }), state, now);
  const first = error(a);
  step(b);
  const afterOne = error(b);
  const distanceAB = new Vector3(...a).distanceTo(new Vector3(...b));
  let frames = 1;
  while (error(b) >= HAND_LIMIT_M && frames < 120) {
    step(b);
    frames++;
  }
  const converged = error(b);

  // A move of more than a metre is a teleport, followed at once: from above the shoulder to below it,
  // both within the arm's 0.54 m reach
  const shoulder = worldPosition(fixture, "rightUpperArm");
  const above = [shoulder.x, shoulder.y + 0.52, shoulder.z];
  const below = [shoulder.x, shoulder.y - 0.52, shoulder.z];
  for (let i = 0; i < 60; i++) step(above);
  const atAbove = error(above);
  step(below);
  const teleport = error(below);
  t.log(
    `first frame error ${(first * 1000).toExponential(2)} mm; after a ${(distanceAB * 1000).toFixed(0)} mm move: ` +
      `${(afterOne * 1000).toFixed(1)} mm behind after one frame, under 1 mm after ${frames} frames ` +
      `(${((frames * 1000) / 60).toFixed(0)} ms); after a 1.04 m jump ${(teleport * 1000).toExponential(
        2
      )} mm in the same frame`
  );
  t.true(first < HAND_LIMIT_M, "the first frame snaps to the target");
  t.true(afterOne > 0.5 * distanceAB && afterOne < distanceAB, "one frame later the hand is on its way");
  t.true(converged < HAND_LIMIT_M && frames <= 30, "converged within half a second");
  t.true(atAbove < HAND_LIMIT_M);
  t.true(teleport < HAND_LIMIT_M, "a teleport is followed at once");
});

test("desktop: the arms hang at the sides; an upper body's hands are hidden; in VR they follow", t => {
  for (const fixture of FULL_RIGS) {
    const pose = makePose({ head: standingHead(fixture), isVR: false, rigYaw: 1.1 });
    const state = solve(fixture, pose);
    const { forward } = bodyAxes(state);
    for (const side of ["left", "right"]) {
      const shoulder = worldToRig(pose, worldPosition(fixture, `${side}UpperArm`));
      const hand = worldToRig(pose, worldPosition(fixture, `${side}Hand`));
      const reach = fixture.arms[side].upper + fixture.arms[side].lower;
      const below = shoulder.y - hand.y;
      const ahead = hand.clone().sub(shoulder).dot(forward);
      t.true(below > 0.8 * reach, `${fixture.name}: the ${side} hand hangs (${below.toFixed(3)} m below)`);
      t.true(ahead > 0, `${fixture.name}: the ${side} hand is slightly forward`);
    }
    t.true(allFinite(fixture));
    t.true(boneLengthError(fixture) < LENGTH_TOLERANCE);
  }

  const half = HALF_BODY_RIG;
  solve(half, makePose({ head: standingHead(half), isVR: false }));
  t.true(half.writes.handsHidden, "an upper body without controllers hides its hands");
  t.is(half.objects.leftHand.scale.x, 0.1);
  // In VR the hands go to the controllers, position and all, without smoothing
  const pose = makePose({
    head: standingHead(half),
    rigPos: [2, 0, 1],
    rigYaw: -0.6,
    left: [-0.4, 1.3, -0.3],
    right: [0.2, 0.9, -0.5]
  });
  const state = solve(half, pose);
  let worst = 0;
  for (const [side, key] of [
    ["left", "leftHand"],
    ["right", "rightHand"]
  ]) {
    const target = pose[key].pos;
    worst = Math.max(worst, worldPosition(half, `${side}Hand`).distanceTo(rigToWorld(pose, target)));
  }
  t.log(`upper body in VR: hand error ${(worst * 1000).toExponential(2)} mm`);
  t.true(worst < HAND_LIMIT_M);
  t.is(half.objects.leftHand.scale.x, 1, "shown again");
});

function randomStressPose(random) {
  const isNPC = random() < 0.1;
  const angle = () => uniform(random, -Math.PI, Math.PI);
  const head = [uniform(random, -1, 1), uniform(random, -0.5, 2.5), uniform(random, -1, 1)];
  const handAt = () => {
    const r = random();
    if (r < 0.1) return [...head];
    if (r < 0.2) return [uniform(random, -5, 5), uniform(random, -5, 5), uniform(random, -5, 5)];
    if (r < 0.25) return [0, 0, 0];
    return [head[0] + uniform(random, -1, 1), head[1] + uniform(random, -1.5, 0.5), head[2] + uniform(random, -1, 1)];
  };
  const pitch = random() < 0.1 ? (random() < 0.5 ? 1 : -1) * (Math.PI / 2) : uniform(random, -Math.PI / 2, Math.PI / 2);
  const pose = makePose({
    rigPos: [uniform(random, -50, 50), uniform(random, -2, 2), uniform(random, -50, 50)],
    rigYaw: uniform(random, -10, 10),
    head,
    headRot: [pitch, uniform(random, -2 * Math.PI, 2 * Math.PI), angle()],
    left: handAt(),
    right: handAt(),
    leftRot: [angle(), angle(), angle()],
    rightRot: [angle(), angle(), angle()],
    isVR: random() < 0.7,
    isNPC,
    animState: randomInt(random, 3)
  });
  pose.tracked = randomInt(random, 8);
  return pose;
}

test("no NaN and bone lengths kept over thousands of random poses on every rig", t => {
  const random = mulberry32(0x5eed0206);
  const rigs = [...FULL_RIGS, HALF_BODY_RIG, MISSING_RIG, MINIMAL_RIG];
  const framesPerRig = 1000;
  let total = 0;
  for (const fixture of rigs) {
    const state = createIkState(fixture.frames);
    let now = 1000;
    let nonFinite = 0;
    let worstLength = 0;
    for (let frame = 0; frame < framesPerRig; frame++) {
      const r = random();
      now += r < 0.05 ? 0 : r < 0.1 ? 2000 : uniform(random, 1, 100);
      const pose = randomStressPose(random);
      solve(fixture, pose, state, now, random() < 0.3);
      if (!allFinite(fixture)) nonFinite++;
      worstLength = Math.max(worstLength, boneLengthError(fixture));
      total++;
    }
    t.log(
      `${
        fixture.name
      }: ${framesPerRig} frames, non-finite ${nonFinite}, bone length change max ${worstLength.toExponential(2)}`
    );
    t.is(nonFinite, 0, `${fixture.name}: no NaN`);
    t.true(worstLength < LENGTH_TOLERANCE, `${fixture.name}: bone lengths kept`);
  }
  t.log(`${total} frames in all`);
});

/** The VR solver's lowering of the body below the headset, in the model's units (solve-vr-body.ts); copied, not exported */
const STANDING_KNEE_SLACK = 0.03;
/** The own avatar's step back from the camera, in the model's units (shared/head.ts); copied, not exported */
const SELF_BACK_OFFSET = 0.1;
const RATIOS = [0.8, 1.0, 1.25];

/** The midpoint of the eye bones in the world */
function eyesWorld(fixture) {
  return worldPosition(fixture, "leftEye").add(worldPosition(fixture, "rightEye")).multiplyScalar(0.5);
}

/** How far each sole is over the floor (the rig's height): the ankle's height less its rest height at the ratio */
function soleClearances(fixture, pose, ratio) {
  return ["left", "right"].map(
    side => worldPosition(fixture, `${side}Foot`).y - pose.rig.pos.y - fixture.rest[`${side}Foot`].position.y * ratio
  );
}

function handsOff(fixture, pose) {
  return Math.max(
    worldPosition(fixture, "leftHand").distanceTo(rigToWorld(pose, pose.leftHand.pos)),
    worldPosition(fixture, "rightHand").distanceTo(rigToWorld(pose, pose.rightHand.pos))
  );
}

test("VR at ratios 0.8, 1.0 and 1.25: hands on the unscaled controllers, soles on the floor, eyes on the headset", t => {
  const random = mulberry32(0x5eed0301);
  for (const ratio of RATIOS) {
    const handErrors = [];
    let worstSole = 0;
    let lowestSole = Infinity;
    let worstEye = 0;
    let worstLength = 0;
    let worstRootScale = 0;
    let finite = true;
    for (const fixture of FULL_RIGS) {
      // The setups as they are, and with the head level: a head pitched or rolled far straightens the legs a
      // little (the hips rise to keep the eyes on the headset), at any ratio, so the soles are held to the
      // floor with a level head and only kept from going under it otherwise
      for (const setup of [...SETUPS, ...SETUPS.map(s => ({ ...s, headRot: [0, s.headRot[1], 0], level: true }))]) {
        // A player whose standing eye height is the model's times the ratio, standing upright in the room
        const base = { ...setup, head: [0.05, fixture.eyeHeight * ratio, -0.02] };
        const probePose = makePose(base);
        const probeState = solve(fixture, probePose, undefined, 1000, setup.isSelf, ratio);
        t.is(probeState.modelRatio, ratio, "the state keeps the ratio");
        for (const side of ["left", "right"]) {
          const shoulder = worldToRig(probePose, worldPosition(fixture, `${side}UpperArm`));
          const arm = fixture.arms[side];
          // The drawn arm is the model's at the ratio; the controllers are where the player holds them
          const reach = (arm.upper + arm.lower) * ratio;
          for (let i = 0; i < 40; i++) {
            const direction = new Vector3().copy(randomDirection(random));
            const target = shoulder.clone().addScaledVector(direction, uniform(random, 0.1, 0.98) * reach);
            const pose = makePose({ ...base, [side]: target.toArray() });
            const state = solve(fixture, pose, undefined, 1000, setup.isSelf, ratio);
            handErrors.push(worldPosition(fixture, `${side}Hand`).distanceTo(rigToWorld(pose, target)));

            // The eyes: on the headset but for the knee slack below it and, for the own avatar, the step back
            const forward = bodyAxes(state).forward.applyAxisAngle(UP, pose.rig.rot.y);
            const expectedEyes = rigToWorld(pose, pose.head.pos);
            expectedEyes.y -= STANDING_KNEE_SLACK * ratio;
            if (setup.isSelf) expectedEyes.addScaledVector(forward, -SELF_BACK_OFFSET * ratio);
            worstEye = Math.max(worstEye, eyesWorld(fixture).distanceTo(expectedEyes));
            for (const clearance of soleClearances(fixture, pose, ratio)) {
              if (setup.level || setup.headRot[0] === 0) worstSole = Math.max(worstSole, Math.abs(clearance));
              lowestSole = Math.min(lowestSole, clearance);
            }
            worstLength = Math.max(worstLength, boneLengthError(fixture, ratio));
            worstRootScale = Math.max(worstRootScale, Math.abs(fixture.objects.root.scale.x - ratio));
            if (!allFinite(fixture)) finite = false;
          }
        }
      }
    }
    const summary = summarize(handErrors);
    t.log(
      `ratio ${ratio}: ${handErrors.length} solves, hand error max ${(summary.max * 1000).toExponential(2)} mm; ` +
        `eyes off the headset max ${(worstEye * 1000).toExponential(2)} mm beyond the slack; soles off the floor ` +
        `max ${(worstSole * 1000).toExponential(2)} mm with the head level, lowest sole ` +
        `${(lowestSole * 1000).toExponential(2)} mm; bone length change ${worstLength.toExponential(2)}`
    );
    t.true(summary.max < HAND_LIMIT_M, `ratio ${ratio}: hand error under 1 mm against the unscaled controller`);
    t.true(worstEye < HAND_LIMIT_M, `ratio ${ratio}: eyes on the headset`);
    t.true(worstSole < HAND_LIMIT_M, `ratio ${ratio}: soles on the floor`);
    t.true(lowestSole > -HAND_LIMIT_M, `ratio ${ratio}: no sole under the floor`);
    t.true(worstLength < LENGTH_TOLERANCE, `ratio ${ratio}: the model keeps its proportions at the ratio`);
    t.true(worstRootScale < 1e-12, `ratio ${ratio}: the root is scaled by the ratio`);
    t.true(finite, `ratio ${ratio}: no NaN`);
  }
});

test("VR crouch at ratios 0.8 and 1.25: feet stay planted on the floor, the hands stay on the controllers", t => {
  for (const ratio of [0.8, 1.25]) {
    for (const fixture of FULL_RIGS) {
      const state = createIkState(fixture.frames);
      let now = 1000;
      let worstSole = 0;
      let worstHand = 0;
      let planted = null;
      let worstSlide = 0;
      for (let frame = 0; frame <= 40; frame++) {
        const depth = Math.min(frame / 20, 1) * 0.3;
        const eye = fixture.eyeHeight * ratio * (1 - depth);
        // The controllers move down with the body; the smoothing lags them, so they are checked once held
        const left = [-0.3 * ratio, eye - 0.5 * ratio, -0.25 * ratio];
        const right = [0.3 * ratio, eye - 0.45 * ratio, -0.2 * ratio];
        const pose = makePose({ rigPos: [1, 0.3, -2], rigYaw: 0.7, head: [0, eye, 0], left, right });
        solve(fixture, pose, state, now, false, ratio);
        now += 1000 / 60;
        for (const clearance of soleClearances(fixture, pose, ratio)) {
          worstSole = Math.max(worstSole, Math.abs(clearance));
        }
        const feet = ["left", "right"].map(side => worldPosition(fixture, `${side}Foot`));
        if (!planted) planted = feet.map(foot => foot.clone());
        feet.forEach((foot, i) => (worstSlide = Math.max(worstSlide, foot.distanceTo(planted[i]))));
        if (frame >= 35) worstHand = Math.max(worstHand, handsOff(fixture, pose));
      }
      t.log(
        `ratio ${ratio}, ${fixture.name}: soles off the floor max ${(worstSole * 1000).toExponential(2)} mm, feet ` +
          `slid ${(worstSlide * 1000).toExponential(2)} mm, hands off ${(worstHand * 1000).toExponential(2)} mm`
      );
      t.true(worstSole < HAND_LIMIT_M, `ratio ${ratio}, ${fixture.name}: soles on the floor`);
      t.true(worstSlide < HAND_LIMIT_M, `ratio ${ratio}, ${fixture.name}: feet stay planted`);
      t.true(worstHand < HAND_LIMIT_M, `ratio ${ratio}, ${fixture.name}: hands on the held controllers`);
    }
  }
});

test("a ratio that is missing or not a positive number is 1: the same writes as ratio 1", t => {
  const fixture = FULL_RIGS[1];
  const pose = makePose({ head: [0, 1.9, 0], left: [-0.3, 1.2, -0.3], right: [0.25, 1.4, -0.2] });
  const reference = new Map();
  solve(fixture, pose, undefined, 1000, false, 1);
  for (const name of BODY_BONE_NAMES) {
    if (fixture.writes.hasRotation[name]) reference.set(name, fixture.writes.rotation[name].clone());
  }
  const hips = fixture.writes.position.hips.clone();
  for (const ratio of [undefined, NaN, 0, -1.2, Infinity]) {
    const state = solve(fixture, pose, undefined, 1000, false, ratio);
    let same = fixture.writes.position.hips.equals(hips) && fixture.writes.rootScale === 1;
    for (const [name, q] of reference) same = same && fixture.writes.rotation[name].equals(q);
    t.true(same, `ratio ${ratio}: the writes of ratio 1`);
    t.is(state.modelRatio, 1, `ratio ${ratio}: the state keeps 1`);
    t.is(fixture.objects.root.scale.x, 1, `ratio ${ratio}: the root at its own size`);
  }
});

test("a change of ratio replants the feet on the floor and puts the hands on the controllers at once", t => {
  for (const fixture of FULL_RIGS) {
    const state = createIkState(fixture.frames);
    let now = 1000;
    let worstSole = 0;
    let worstHand = 0;
    for (let frame = 0; frame < 30; frame++) {
      const ratio = frame < 15 ? 1 : 1.2;
      const pose = makePose({
        rigPos: [0.5, 0, 0.5],
        head: [0, fixture.eyeHeight * 1.1, 0],
        left: [-0.3, 1.1, -0.3],
        right: [0.3, 1.2, -0.25]
      });
      solve(fixture, pose, state, now, false, ratio);
      now += 1000 / 60;
      if (frame >= 15) {
        for (const clearance of soleClearances(fixture, pose, ratio)) {
          worstSole = Math.max(worstSole, Math.abs(clearance));
        }
        worstHand = Math.max(worstHand, handsOff(fixture, pose));
      }
    }
    t.true(worstSole < HAND_LIMIT_M, `${fixture.name}: soles on the floor after the change`);
    t.true(worstHand < HAND_LIMIT_M, `${fixture.name}: hands on the controllers from the change on`);
  }
});

test("the screen and chatbot solvers draw the model at its own size and reset a root the VR solver scaled", t => {
  for (const fixture of FULL_RIGS) {
    const state = createIkState(fixture.frames);
    solve(fixture, makePose({ head: [0, fixture.eyeHeight * 1.25, 0] }), state, 1000, false, 1.25);
    t.is(fixture.objects.root.scale.x, 1.25, `${fixture.name}: scaled in VR`);
    // The same client on a screen: the announced ratio is still given, the screen solver ignores it
    const pose = makePose({ head: standingHead(fixture), isVR: false, rigPos: [2, 0, 1] });
    solve(fixture, pose, state, 1100, false, 1.25);
    t.is(state.modelRatio, 1, `${fixture.name}: the state's ratio is 1 on a screen`);
    t.true(fixture.objects.root.scale.equals(new Vector3(1, 1, 1)), `${fixture.name}: root scale reset`);
    t.true(boneLengthError(fixture) < LENGTH_TOLERANCE, `${fixture.name}: own size`);
    const soles = soleClearances(fixture, pose, 1);
    t.true(Math.max(...soles.map(Math.abs)) < HAND_LIMIT_M, `${fixture.name}: soles on the floor on a screen`);
    t.true(allFinite(fixture), `${fixture.name}: no NaN on the change`);
  }
  // The chatbot's avatar never takes a ratio either
  const fixture = FULL_RIGS[0];
  const state = createIkState(fixture.frames);
  solve(fixture, makePose({ head: [0, 2, 0] }), state, 1000, false, 1.25);
  solve(fixture, makePose({ head: standingHead(fixture), isNPC: true, isVR: false }), state, 1100, false, 1.25);
  t.is(state.modelRatio, 1);
  t.true(fixture.objects.root.scale.equals(new Vector3(1, 1, 1)), "chatbot: root scale reset");
});

test("no NaN and proportions kept over random poses with random ratios, VR and screen mixed", t => {
  const random = mulberry32(0x5eed0302);
  for (const fixture of [...FULL_RIGS, HALF_BODY_RIG, MISSING_RIG, MINIMAL_RIG]) {
    const state = createIkState(fixture.frames);
    let now = 1000;
    let nonFinite = 0;
    let worstLength = 0;
    for (let frame = 0; frame < 300; frame++) {
      now += uniform(random, 1, 100);
      const pose = randomStressPose(random);
      const ratio = random() < 0.2 ? 1 : uniform(random, 0.3, 2);
      solve(fixture, pose, state, now, random() < 0.3, ratio);
      if (!allFinite(fixture)) nonFinite++;
      worstLength = Math.max(worstLength, boneLengthError(fixture, state.modelRatio));
    }
    t.is(nonFinite, 0, `${fixture.name}: no NaN`);
    t.true(worstLength < LENGTH_TOLERANCE, `${fixture.name}: proportions kept (${worstLength.toExponential(2)})`);
  }
});

/**
 * Whether the solve has to turn a bone exactly half a turn from its rest direction: the lower bone when
 * the rest pose is straight and the limb is solved fully folded (the target within |upper - lower| of the
 * root), or the rest pose is folded back and the limb is stretched; the upper bone when the target is on
 * the root (the solver then reaches along the rest direction) and the upper bone is the shorter one, so
 * the fold puts the middle joint behind the root.
 */
function isHalfTurn({ root, target, upperLength, lowerLength, restUpper, restLower }) {
  const restDot = restUpper.clone().normalize().dot(restLower.clone().normalize());
  const distance = target.distanceTo(root);
  const folded = Math.abs(upperLength - lowerLength) > 1e-4 && distance <= Math.abs(upperLength - lowerLength);
  const stretched = distance >= upperLength + lowerLength;
  const lowerHalfTurn = (restDot > 1 - 1e-9 && folded) || (restDot < -1 + 1e-9 && stretched);
  const upperHalfTurn = distance <= 1e-6 && lowerLength - upperLength > 1e-4;
  return lowerHalfTurn || upperHalfTurn;
}

test("two-bone solver on singular inputs: finite, lengths kept, end on the target when reachable", t => {
  const random = mulberry32(0x5eed0207);
  const out = createTwoBoneOutput();
  let nonFinite = 0;
  let worstLength = 0;
  let worstReach = 0;
  let worstMapping = 0;
  let halfTurnCases = 0;
  const pick = () => {
    const r = random();
    if (r < 0.15) return new Vector3(0, 0, 0);
    if (r < 0.3) return new Vector3(0, 1, 0);
    if (r < 0.4) return new Vector3(1, 0, 0);
    return new Vector3().copy(randomDirection(random));
  };
  for (let i = 0; i < 20000; i++) {
    const upperLength = random() < 0.1 ? 0.3 : uniform(random, 0.05, 0.6);
    const lowerLength = random() < 0.2 ? upperLength : uniform(random, 0.05, 0.6);
    const root = new Vector3(uniform(random, -1, 1), uniform(random, -1, 2), uniform(random, -1, 1));
    const r = random();
    let target;
    if (r < 0.1) target = root.clone();
    else if (r < 0.2) target = root.clone().add(new Vector3(0, -(upperLength + lowerLength), 0));
    else target = root.clone().addScaledVector(new Vector3().copy(randomDirection(random)), uniform(random, 0, 1.5));
    const restUpper = pick();
    if (restUpper.lengthSq() === 0) restUpper.set(0, -1, 0);
    const restLower = random() < 0.3 ? restUpper.clone() : pick();
    if (restLower.lengthSq() === 0) restLower.copy(restUpper);
    // The pole: none at all, along the limb, or anywhere; the rest bend along the bone at times
    const direction = target.clone().sub(root);
    const pole = random() < 0.2 ? new Vector3() : random() < 0.4 ? direction.clone() : pick();
    const restBend = random() < 0.3 ? restUpper.clone() : pick();
    const input = { root, target, pole, upperLength, lowerLength, restUpper, restLower, restBend };
    solveTwoBone(input, out);
    if (
      !isFiniteXyz(out.joint) ||
      !isFiniteXyz(out.end) ||
      !isFiniteQuat(out.upperDelta) ||
      !isFiniteQuat(out.lowerDelta)
    ) {
      nonFinite++;
      continue;
    }
    const upper = out.joint.distanceTo(root);
    const lower = out.end.distanceTo(out.joint);
    worstLength = Math.max(
      worstLength,
      Math.abs(upper - upperLength) / upperLength,
      Math.abs(lower - lowerLength) / lowerLength
    );
    const distance = direction.length();
    if (distance > Math.abs(upperLength - lowerLength) + 1e-6 && distance < upperLength + lowerLength - 1e-6) {
      worstReach = Math.max(worstReach, out.end.distanceTo(target));
    }
    // The deltas turn the rest directions onto the solved bones. Left out here: the inputs where a bone
    // has to turn exactly half a turn, the known failure below
    if (isHalfTurn(input)) {
      halfTurnCases++;
      continue;
    }
    const upperDirection = out.joint.clone().sub(root).normalize();
    const lowerDirection = out.end.clone().sub(out.joint).normalize();
    worstMapping = Math.max(
      worstMapping,
      restUpper.clone().normalize().applyQuaternion(out.upperDelta).distanceTo(upperDirection),
      lower > 1e-6 ? restLower.clone().normalize().applyQuaternion(out.lowerDelta).distanceTo(lowerDirection) : 0
    );
  }
  t.log(
    `20000 inputs: non-finite ${nonFinite}, length change max ${worstLength.toExponential(2)}, ` +
      `reachable end off the target max ${worstReach.toExponential(2)} m, rest-to-solved direction error max ` +
      `${worstMapping.toExponential(2)} (${halfTurnCases} half-turn inputs left to the known failure)`
  );
  t.is(nonFinite, 0);
  t.true(worstLength < 1e-6);
  t.true(worstReach < 1e-6);
  t.true(worstMapping < 1e-6);
});

/*
 * Known failure, a product issue in src/avatar/ik/two-bone-ik.ts. solveTwoBone takes each bone's turn
 * from three.js's Quaternion.setFromUnitVectors (directly for the lower bone, inside frameRotation for the
 * upper one). That function handles opposite directions only when dot + 1 < Number.EPSILON; when rounding
 * leaves dot + 1 between 2.2e-16 and about 1e-15 it builds the turn from a cross product that is rounding
 * noise and returns an arbitrary rotation. A bone that has to turn exactly half a turn therefore points
 * anywhere. This happens
 *   - to the forearm when the rest arm is straight (as in an exact T-pose) and the target lies within
 *     |upper - lower| of the shoulder, where the arm is solved fully folded: the hand lands up to twice the
 *     forearm's length from where it belongs. Here, on the two rigs with random rest rotations, about one
 *     target in eight at |upper - lower| (2 cm) from the shoulder misplaces the hand, by up to 520 mm; the
 *     identity-rest rigs, whose rest directions are exact, did not show it in a probe of 3,600 targets;
 *   - to the upper arm when the target is exactly on the shoulder and the upper arm is shorter than the
 *     forearm.
 * Both need the target within a few centimetres of the shoulder (or exactly on it), so they are rare in
 * use. The test asserts the correct result and is marked failing; it will report itself once the solver
 * turns such bones half a turn about the bend plane's normal instead.
 */
test.failing("known failure: a bone that has to turn exactly half a turn can get an arbitrary turn", t => {
  const random = mulberry32(0x5eed0208);
  const out = createTwoBoneOutput();
  const cases = 2000;

  // The forearm: a straight rest pose, the target within |upper - lower| of the root
  let wrongForearms = 0;
  let worstForearm = 0;
  for (let i = 0; i < cases; i++) {
    const upperLength = uniform(random, 0.2, 0.4);
    const lowerLength = uniform(random, 0.2, 0.4);
    const root = new Vector3(uniform(random, -1, 1), uniform(random, 0, 2), uniform(random, -1, 1));
    const target = root
      .clone()
      .addScaledVector(new Vector3().copy(randomDirection(random)), random() * Math.abs(upperLength - lowerLength));
    const restUpper = new Vector3().copy(randomDirection(random));
    const input = {
      root,
      target,
      pole: new Vector3(0, -1, 0),
      upperLength,
      lowerLength,
      restUpper,
      restLower: restUpper.clone(),
      restBend: new Vector3().copy(randomDirection(random))
    };
    solveTwoBone(input, out);
    const lowerDirection = out.end.clone().sub(out.joint).normalize();
    const error = input.restLower.clone().applyQuaternion(out.lowerDelta).distanceTo(lowerDirection);
    worstForearm = Math.max(worstForearm, error);
    if (error > 1e-6) wrongForearms++;
  }

  // The upper arm: the target on the root, the upper bone the shorter one
  let wrongUpperArms = 0;
  let worstUpperArm = 0;
  for (let i = 0; i < cases; i++) {
    const upperLength = uniform(random, 0.1, 0.25);
    const lowerLength = uniform(random, 0.3, 0.4);
    const root = new Vector3(uniform(random, -1, 1), uniform(random, 0, 2), uniform(random, -1, 1));
    const restUpper = new Vector3().copy(randomDirection(random));
    const input = {
      root,
      target: root.clone(),
      pole: new Vector3(0, -1, 0),
      upperLength,
      lowerLength,
      restUpper,
      restLower: new Vector3().copy(randomDirection(random)),
      restBend: new Vector3().copy(randomDirection(random))
    };
    solveTwoBone(input, out);
    const upperDirection = out.joint.clone().sub(root).normalize();
    const error = restUpper.clone().applyQuaternion(out.upperDelta).distanceTo(upperDirection);
    worstUpperArm = Math.max(worstUpperArm, error);
    if (error > 1e-6) wrongUpperArms++;
  }

  // Through the whole solver: targets at |upper - lower| from the shoulder (the arm fully folded, the
  // target reached) on the random-rest rigs
  let misplaced = 0;
  let worstHand = 0;
  let solves = 0;
  for (const fixture of FULL_RIGS.slice(1, 3)) {
    for (const side of ["left", "right"]) {
      const base = { head: standingHead(fixture) };
      solve(fixture, makePose(base));
      const shoulder = worldPosition(fixture, `${side}UpperArm`);
      const fold = Math.abs(fixture.arms[side].upper - fixture.arms[side].lower);
      for (let i = 0; i < 300; i++) {
        const direction = new Vector3().copy(randomDirection(random));
        const target = shoulder.clone().addScaledVector(direction, fold);
        solve(fixture, makePose({ ...base, [side]: target.toArray() }));
        const error = worldPosition(fixture, `${side}Hand`).distanceTo(target);
        worstHand = Math.max(worstHand, error);
        if (error >= HAND_LIMIT_M) misplaced++;
        solves++;
      }
    }
  }
  t.log(
    `two-bone solver: forearm turned wrong in ${wrongForearms} of ${cases} folded limbs with a straight rest pose ` +
      `(worst direction error ${worstForearm.toFixed(3)}); upper arm turned wrong in ${wrongUpperArms} of ${cases} ` +
      `targets on the root (worst ${worstUpperArm.toFixed(3)})`
  );
  t.log(
    `whole solver: ${misplaced} of ${solves} hands at |upper - lower| from the shoulder misplaced by 1 mm or more, ` +
      `worst ${(worstHand * 1000).toFixed(1)} mm`
  );
  t.is(wrongForearms, 0, "the forearm turned onto its solved direction");
  t.is(wrongUpperArms, 0, "the upper arm turned onto its solved direction");
  t.true(worstHand < HAND_LIMIT_M, "hand error under 1 mm");
});
