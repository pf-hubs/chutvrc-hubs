import test from "ava";
import { Bone, Euler, Object3D, Quaternion, Vector3 } from "three";
import { applyToBones, readRestFrames } from "../../../src/avatar/ik/apply-to-bones";
import { createBoneWrites, createIkState, solveBody } from "../../../src/avatar/ik/solve-body";
import { buildHandGrip, HAND_GRIP_DEGREES, handGrip } from "../../../src/avatar/ik/vr/hand-grip";
import { measureHandFrame } from "../../../src/avatar/rig/hand-frame";
import { buildRigDescription } from "../../../src/avatar/rig/rig-description";
import { copyTransform, createTrackedPose, TRACKED_ALL, TRACKED_HEAD } from "../../../src/avatar/pose/tracked-pose";

/**
 * The hands in VR. Rigs differ in how a hand bone's axes lie in the hand, so the solver measures each
 * model's hand from its finger bones (rig/hand-frame.ts) and gives that frame one grip in the controller's
 * axes (ik/vr/hand-grip.ts). These tests build the same body with its bones' axes laid out in different
 * ways and check that all of them hold a controller the same way, and that an arm whose controller reports
 * no pose hangs at the side.
 */

const DEG = Math.PI / 180;
const UP = new Vector3(0, 1, 0);
const ANGLE_LIMIT_DEG = 0.1;

/** A body in a T-pose that faces +z, palms down: [name, parent, where the joint is]. Its left side is +x. */
const JOINTS = [
  ["Hips", "Armature", [0, 1.0, 0]],
  ["Spine", "Hips", [0, 1.1, 0]],
  ["Chest", "Spine", [0, 1.25, 0]],
  ["Neck", "Chest", [0, 1.45, 0]],
  ["Head", "Neck", [0, 1.55, 0]],
  ["LeftEye", "Head", [0.03, 1.62, 0.08]],
  ["RightEye", "Head", [-0.03, 1.62, 0.08]],
  ["LeftShoulder", "Chest", [0.05, 1.4, 0]],
  ["LeftUpperArm", "LeftShoulder", [0.18, 1.4, 0]],
  ["LeftLowerArm", "LeftUpperArm", [0.45, 1.4, 0]],
  ["LeftHand", "LeftLowerArm", [0.7, 1.4, 0]],
  ["LeftIndex1", "LeftHand", [0.78, 1.4, 0.03]],
  ["LeftMiddle1", "LeftHand", [0.79, 1.4, 0]],
  ["LeftLittle1", "LeftHand", [0.77, 1.4, -0.04]],
  ["RightShoulder", "Chest", [-0.05, 1.4, 0]],
  ["RightUpperArm", "RightShoulder", [-0.18, 1.4, 0]],
  ["RightLowerArm", "RightUpperArm", [-0.45, 1.4, 0]],
  ["RightHand", "RightLowerArm", [-0.7, 1.4, 0]],
  ["RightIndex1", "RightHand", [-0.78, 1.4, 0.03]],
  ["RightMiddle1", "RightHand", [-0.79, 1.4, 0]],
  ["RightLittle1", "RightHand", [-0.77, 1.4, -0.04]],
  ["LeftUpperLeg", "Hips", [0.09, 0.95, 0]],
  ["LeftLowerLeg", "LeftUpperLeg", [0.09, 0.5, 0]],
  ["LeftFoot", "LeftLowerLeg", [0.09, 0.08, 0]],
  ["RightUpperLeg", "Hips", [-0.09, 0.95, 0]],
  ["RightLowerLeg", "RightUpperLeg", [-0.09, 0.5, 0]],
  ["RightFoot", "RightLowerLeg", [-0.09, 0.08, 0]]
];
const FINGERS = /(Index|Middle|Little)1$/;

/** A repeatable stream of numbers in [0, 1) */
function randomStream(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomQuaternion(random) {
  const axis = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
  return new Quaternion().setFromAxisAngle(axis, random() * 2 * Math.PI);
}

/**
 * The ways a rig can lay out its bones' axes, each a function from a joint to the bone's orientation in
 * the room: every bone like the room (as VRM 0.x models have them), every bone's y axis along the bone
 * with some roll about it (as Ready Player Me models have them), and every bone turned at random.
 */
const LAYOUTS = {
  "bones like the room": () => new Quaternion(),
  "y along the bone": (random, toChild) => {
    const along = new Quaternion().setFromUnitVectors(UP, toChild);
    return along.multiply(new Quaternion().setFromAxisAngle(UP, random() * 2 * Math.PI));
  },
  "bones turned at random": random => randomQuaternion(random)
};

/** The body with its bones laid out one way; `facing` "-z" turns the whole model half around, without the finger bones if asked */
function buildModel(layoutName, facing, withFingers = true) {
  const random = randomStream(layoutName.length * 7919 + (facing === "-z" ? 1 : 0));
  const half = new Quaternion().setFromAxisAngle(UP, facing === "-z" ? Math.PI : 0);
  const joints = JOINTS.filter(([name]) => withFingers || !FINGERS.test(name));
  const positions = Object.fromEntries(joints.map(([name, , at]) => [name, new Vector3(...at).applyQuaternion(half)]));
  const firstChild = name => joints.find(([, parent]) => parent === name);

  const scene = new Object3D();
  const armature = new Object3D();
  armature.name = "Armature";
  scene.add(armature);
  const objects = { Armature: armature };
  const orientations = { Armature: new Quaternion() };
  positions.Armature = new Vector3();
  for (const [name, parent] of joints) {
    const child = firstChild(name);
    const toChild = child ? positions[child[0]].clone().sub(positions[name]).normalize() : UP.clone();
    const orientation = LAYOUTS[layoutName](random, toChild);
    const parentInverse = orientations[parent].clone().invert();
    const bone = new Bone();
    bone.name = name;
    bone.position.copy(positions[name]).sub(positions[parent]).applyQuaternion(parentInverse);
    bone.quaternion.copy(parentInverse).multiply(orientation);
    objects[parent].add(bone);
    objects[name] = bone;
    orientations[name] = orientation;
  }
  scene.updateMatrixWorld(true);
  const rig = buildRigDescription(scene);
  return { name: `${layoutName}, facing ${facing}`, objects, rig, frames: readRestFrames(rig), writes: createBoneWrites() };
}

const MODELS = Object.keys(LAYOUTS).flatMap(layout => [buildModel(layout, "+z"), buildModel(layout, "-z")]);

/** A headset pose in the camera's convention (-z ahead, the left hand at -x), the controllers turned as given (YXZ, radians) */
function vrPose(controllerRotation, tracked = TRACKED_ALL) {
  const pose = createTrackedPose(false);
  pose.isVR = true;
  pose.tracked = tracked;
  const set = (part, pos, rot) =>
    copyTransform({ pos: { x: pos[0], y: pos[1], z: pos[2] }, rot: { x: rot[0], y: rot[1], z: rot[2] } }, pose[part]);
  set("rig", [0, 0, 0], [0, 0, 0]);
  set("head", [0, 1.62, 0], [0, 0, 0]);
  set("leftHand", [-0.2, 1.15, -0.3], controllerRotation);
  set("rightHand", [0.2, 1.15, -0.3], controllerRotation);
  return pose;
}

function solve(model, pose, state = createIkState(model.frames), now = 1000) {
  solveBody(model.rig, pose, state, model.writes, { now, isSelf: false, modelRatio: 1 });
  applyToBones(model.rig, model.writes);
  return state;
}

const at = object => object.getWorldPosition(new Vector3());

/** Where a posed hand's fingers point and where the back of the hand faces, from where its finger bones are */
function posedHand(model, side) {
  const S = side === "left" ? "Left" : "Right";
  const wrist = at(model.objects[`${S}Hand`]);
  const fingers = at(model.objects[`${S}Middle1`]).sub(wrist).normalize();
  const toIndex = at(model.objects[`${S}Index1`]).sub(wrist);
  const toLittle = at(model.objects[`${S}Little1`]).sub(wrist);
  const back = side === "left" ? toIndex.cross(toLittle) : toLittle.cross(toIndex);
  back.addScaledVector(fingers, -back.dot(fingers)).normalize();
  return { fingers, back };
}

const degreesBetween = (a, b) => a.angleTo(b) / DEG;

test("the built-in grip is a handshake with the fingers raised above the ray", t => {
  const { raise, roll, bend } = HAND_GRIP_DEGREES;
  t.deepEqual([roll, bend], [0, 0], "the built-in grip only raises the fingers");
  const raised = new Vector3(0, Math.sin(raise * DEG), -Math.cos(raise * DEG));
  for (const side of ["left", "right"]) {
    const grip = buildHandGrip(side, raise, roll, bend);
    const fingers = new Vector3(1, 0, 0).applyQuaternion(grip);
    const back = new Vector3(0, 1, 0).applyQuaternion(grip);
    const thumb = new Vector3(0, 0, side === "left" ? 1 : -1).applyQuaternion(grip);
    t.true(degreesBetween(fingers, raised) < 1e-6, `${side}: the fingers point along the ray, ${raise}° above it`);
    t.true(degreesBetween(back, new Vector3(side === "left" ? -1 : 1, 0, 0)) < 1e-6, `${side}: the back of the hand faces outward`);
    t.true(thumb.y > 0.9, `${side}: the thumb is on top`);
    t.true(grip.angleTo(handGrip[side]) < 1e-9, `${side}: the solver's grip is the built-in one outside a page`);
  }
  // Rolling turns the palm down and bending brings the fingers toward the palm, for both hands
  for (const side of ["left", "right"]) {
    const rolled = new Vector3(0, 1, 0).applyQuaternion(buildHandGrip(side, 0, 90, 0));
    t.true(degreesBetween(rolled, UP) < 1e-6, `${side}: a quarter roll puts the back of the hand on top`);
    const bent = new Vector3(1, 0, 0).applyQuaternion(buildHandGrip(side, 0, 0, 90));
    t.true(degreesBetween(bent, new Vector3(side === "left" ? 1 : -1, 0, 0)) < 1e-6, `${side}: a quarter bend points the fingers where the palm faces`);
  }
});

test("a hand is measured from its finger bones, and without them from the forearm with the palm down", t => {
  const frame = new Quaternion();
  for (const side of ["left", "right"]) {
    const x = side === "left" ? 1 : -1;
    const points = {
      wrist: new Vector3(0.7 * x, 1.4, 0),
      lowerArm: new Vector3(0.45 * x, 1.4, 0),
      index: new Vector3(0.78 * x, 1.4, 0.03),
      middle: new Vector3(0.79 * x, 1.4, 0),
      little: new Vector3(0.77 * x, 1.4, -0.04)
    };
    const outward = new Vector3(x, 0, 0);
    t.is(measureHandFrame(side, points, outward, frame), "fingers");
    t.true(degreesBetween(new Vector3(1, 0, 0).applyQuaternion(frame), new Vector3(x, 0, 0)) < 1e-6, `${side}: x along the fingers`);
    t.true(degreesBetween(new Vector3(0, 1, 0).applyQuaternion(frame), UP) < 1e-6, `${side}: y out of the back of the hand`);

    // The same hand with the palm turned to face forward: only the finger bones can tell
    const turned = { ...points, index: new Vector3(0.78 * x, 1.43, 0), little: new Vector3(0.77 * x, 1.36, 0) };
    t.is(measureHandFrame(side, turned, outward, frame), "fingers");
    t.true(degreesBetween(new Vector3(0, 1, 0).applyQuaternion(frame), new Vector3(0, 0, -1)) < 1e-6, `${side}: palm forward, back of the hand behind`);

    const bare = { ...points, index: null, middle: null, little: null };
    t.is(measureHandFrame(side, bare, outward, frame), "rest pose");
    t.true(degreesBetween(new Vector3(1, 0, 0).applyQuaternion(frame), new Vector3(x, 0, 0)) < 1e-6, `${side}: x along the forearm`);
    t.true(degreesBetween(new Vector3(0, 1, 0).applyQuaternion(frame), UP) < 1e-6, `${side}: the palm taken to face down`);

    // An arm hanging straight down has no "palm down": the back of the hand faces away from the body
    const hanging = { ...bare, wrist: new Vector3(0.2 * x, 0.8, 0), lowerArm: new Vector3(0.2 * x, 1.05, 0) };
    t.is(measureHandFrame(side, hanging, outward, frame), "rest pose");
    t.true(degreesBetween(new Vector3(0, 1, 0).applyQuaternion(frame), outward) < 1e-6, `${side}: hanging, the back of the hand outward`);

    t.is(measureHandFrame(side, { ...bare, lowerArm: null }, outward, frame), null, `${side}: nothing to measure by`);
  }
});

test("every bone layout and facing holds the controllers the same way: the grip's", t => {
  const rotations = [
    [0, 0, 0],
    [0, 30 * DEG, 0],
    [-25 * DEG, 0, 0],
    [0, 0, 20 * DEG],
    [-40 * DEG, 65 * DEG, -15 * DEG],
    [55 * DEG, -120 * DEG, 35 * DEG]
  ];
  let worst = 0;
  for (const model of MODELS) {
    for (const side of ["left", "right"]) {
      t.is(model.rig.hands[side]?.source, "fingers", `${model.name}: the ${side} hand is measured from its fingers`);
    }
    for (const rotation of rotations) {
      solve(model, vrPose(rotation));
      const controller = new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2], "YXZ"));
      for (const side of ["left", "right"]) {
        const expectedFingers = new Vector3(1, 0, 0).applyQuaternion(handGrip[side]).applyQuaternion(controller);
        const expectedBack = new Vector3(0, 1, 0).applyQuaternion(handGrip[side]).applyQuaternion(controller);
        const hand = posedHand(model, side);
        const error = Math.max(degreesBetween(hand.fingers, expectedFingers), degreesBetween(hand.back, expectedBack));
        worst = Math.max(worst, error);
        t.true(
          error < ANGLE_LIMIT_DEG,
          `${model.name}, ${side} hand, controller turned ${rotation.map(r => (r / DEG).toFixed(0))}: ${error.toFixed(3)}° off the grip`
        );
      }
    }
  }
  t.log(`${MODELS.length} models x ${rotations.length} controller orientations x 2 hands: at most ${worst.toExponential(2)}° off the grip`);
});

test("without finger bones the same hands are measured from the forearm and still agree", t => {
  const rotation = [-20 * DEG, 40 * DEG, 10 * DEG];
  const bare = Object.keys(LAYOUTS).flatMap(layout =>
    ["+z", "-z"].map(facing => ({ facing, model: buildModel(layout, facing, false) }))
  );
  // A model with fingers for each facing: how far a hand is turned from its rest pose does not depend on the layout
  const withFingers = { "+z": buildModel("bones like the room", "+z"), "-z": buildModel("bones like the room", "-z") };
  for (const full of Object.values(withFingers)) solve(full, vrPose(rotation));
  for (const { facing, model } of bare) {
    const full = withFingers[facing];
    solve(model, vrPose(rotation));
    for (const side of ["left", "right"]) {
      t.is(model.rig.hands[side]?.source, "rest pose", `${model.name}: ${side} hand measured without fingers`);
      // No finger bones to look at: the hand bone must be turned from its rest pose as the full model's is
      const S = side === "left" ? "Left" : "Right";
      const turnOf = m => {
        const rest = m.frames[`${side}Hand`].quaternion;
        const now = m.objects[`${S}Hand`].getWorldQuaternion(new Quaternion());
        return now.multiply(rest.clone().invert());
      };
      const error = turnOf(model).angleTo(turnOf(full)) / DEG;
      t.true(error < ANGLE_LIMIT_DEG, `${model.name}, ${side} hand: ${error.toFixed(3)}° from the model with fingers`);
    }
  }
});

test("an arm whose controller reports no pose hangs at the side, and snaps to the controller when the pose returns", t => {
  for (const model of MODELS) {
    const lost = vrPose([0, 0, 0], TRACKED_HEAD);
    // The controllers' objects sit at the rig's origin until their first pose
    for (const part of ["leftHand", "rightHand"]) copyTransform({ pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } }, lost[part]);
    const state = solve(model, lost);
    for (const side of ["left", "right"]) {
      const S = side === "left" ? "Left" : "Right";
      const hand = at(model.objects[`${S}Hand`]);
      const shoulder = at(model.objects[`${S}UpperArm`]);
      t.true(hand.y < shoulder.y - 0.35, `${model.name}: the ${side} hand hangs below the shoulder (${(shoulder.y - hand.y).toFixed(2)} m)`);
      t.true(hand.y > 0.5, `${model.name}: the ${side} hand is not at the floor (${hand.y.toFixed(2)} m)`);
      t.true(Math.abs(hand.x) > 0.1, `${model.name}: the ${side} hand is at the body's side`);
    }
    const back = vrPose([0, 0, 0]);
    solve(model, back, state, 1016);
    for (const side of ["left", "right"]) {
      const S = side === "left" ? "Left" : "Right";
      const part = side === "left" ? back.leftHand : back.rightHand;
      const error = at(model.objects[`${S}Hand`]).distanceTo(new Vector3(part.pos.x, part.pos.y, part.pos.z));
      t.true(error < 0.001, `${model.name}: the ${side} hand is on the controller on the first frame with a pose (${(error * 1000).toFixed(2)} mm)`);
    }
  }
});
