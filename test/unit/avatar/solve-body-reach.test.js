import test from "ava";
import { Bone, Object3D, Quaternion, Vector3 } from "three";
import { applyToBones, readRestFrames } from "../../../src/avatar/ik/apply-to-bones";
import { createBoneWrites, createIkState, solveBody } from "../../../src/avatar/ik/solve-body";
import { buildRigDescription } from "../../../src/avatar/rig/rig-description";
import { copyTransform, createTrackedPose, TRACKED_ALL } from "../../../src/avatar/pose/tracked-pose";

/**
 * The VR solver's hands on a model built like the Ready Player Me sample of the T5 tests, whose eyes sit
 * 8 cm in front of its head bone and 13 cm in front of its upper arms (a VRoid model's sit 3 cm in front).
 * With the eyes on the headset, such a model stands with its shoulders further behind the headset than its
 * user's, and its stretched arms fell 2.5 to 2.7 mm short of the T5 battery's controllers held at the
 * waist, and 3.3 to 3.5 cm short once a turn on the spot had left the body 20 degrees off the head (the dead
 * band), as the T5 runs measured, where the old solver, which hangs the head bone under the headset,
 * reached them. The shoulder now turns toward a controller beyond the arm's length.
 *
 * The model is the sample's bones with their rest translations and rotations (the glTF faces +z), and the
 * same model turned half around to face -z, as the VRM models do. The poses are the battery's: the eyes of a
 * person standing 1.62 m tall at eye level, the controllers held in front at waist height (M1), and a turn
 * on the spot about a point 5 cm behind the eyes (M7), at both fits of the body calibration: the model drawn
 * at the user's eye height ("Fit the avatar to me"), and the user's poses scaled to the model's eye height
 * with the model at its own size ("Fit me to the avatar").
 */

const HAND_LIMIT_M = 0.001;
const UP = new Vector3(0, 1, 0);
const DEG = Math.PI / 180;
/** The largest turn of a shoulder toward a far hand target, from limbs.ts; copied, not exported */
const SHOULDER_REACH_MAX_DEG = 50;

/** The sample's bones: [name, parent, local translation, local rotation (x, y, z, w)], from the glTF */
const READY_PLAYER_ME = [
  ["Hips", "Armature", [0, 1.0191902, 0.0100306], [0.0162304, -0.0000262, -4e-7, 0.9998683]],
  ["Spine", "Hips", [0, 0.0984731, 0], [-0.0686937, 0.0000263, 0.0000018, 0.9976378]],
  ["Spine1", "Spine", [0, 0.1304974, 0], [-0.0321738, 1e-7, 1e-7, 0.9994823]],
  ["Spine2", "Spine1", [0, 0.1218063, 0], [0.0472013, -3e-7, 1e-7, 0.9988855]],
  ["Neck", "Spine2", [0, 0.1555749, 0], [0.2030688, 1e-7, 1e-7, 0.9791645]],
  ["Head", "Neck", [0, 0.122638, 0], [-0.1626759, -3e-7, -4e-7, 0.9866796]],
  ["LeftEye", "Head", [0.0303527, 0.0878396, 0.0824062], [-0.003611, 1e-7, 1e-7, 0.9999935]],
  ["RightEye", "Head", [-0.0298823, 0.087791, 0.0824066], [-0.003611, 1e-7, 1e-7, 0.9999935]],
  ["LeftShoulder", "Spine2", [0.0471356, 0.141148, -0.0062551], [0.504936, 0.4894799, -0.5147033, 0.4904383]],
  ["LeftArm", "LeftShoulder", [0, 0.1188956, 2e-7], [0.4766822, 0.0426003, -0.0586192, 0.876084]],
  ["LeftForeArm", "LeftArm", [0, 0.285129, 1e-7], [-0.0496498, 0.0232878, 0.2204812, 0.9738483]],
  ["LeftHand", "LeftForeArm", [1e-7, 0.2519721, -2e-7], [0.0462274, 0.0387182, -0.0185174, 0.9980085]],
  ["RightShoulder", "Spine2", [-0.0471355, 0.1411481, -0.0062551], [0.5049322, -0.4894829, 0.5147007, 0.490442]],
  ["RightArm", "RightShoulder", [0, 0.1188957, -3e-7], [0.4766806, -0.0426019, 0.0586194, 0.8760847]],
  ["RightForeArm", "RightArm", [-1e-7, 0.2851283, 0], [-0.049649, -0.0232858, -0.2204812, 0.9738485]],
  ["RightHand", "RightForeArm", [0, 0.2519721, 2e-7], [0.04623, -0.0387149, 0.0185175, 0.9980085]],
  ["LeftUpLeg", "Hips", [0.0953437, 0.0051927, -0.0033023], [0.0014239, -0.0096138, -0.9994102, 0.0329381]],
  ["LeftLeg", "LeftUpLeg", [0, 0.4581741, 0], [-0.041655, -0.000308, -0.0029115, 0.9991278]],
  ["LeftFoot", "LeftLeg", [3e-7, 0.443859, -4e-7], [0.5074413, 0.0166686, 0.0015593, 0.8615237]],
  ["RightUpLeg", "Hips", [-0.095344, 0.0051931, -0.0032923], [0.0014784, 0.0096156, 0.9994101, 0.0329377]],
  ["RightLeg", "RightUpLeg", [0, 0.4581745, 0], [-0.0416553, 0.0003089, 0.0029119, 0.9991278]],
  ["RightFoot", "RightLeg", [0, 0.4438596, 0], [0.5074409, -0.0166667, -0.0015561, 0.8615239]]
];

/** The sample as loaded, or turned half around under its armature so it faces -z */
function buildModel(facing) {
  const scene = new Object3D();
  const armature = new Object3D();
  armature.name = "Armature";
  scene.add(armature);
  const objects = { Armature: armature };
  for (const [name, parent, translation, rotation] of READY_PLAYER_ME) {
    const bone = new Bone();
    bone.name = name;
    bone.position.fromArray(translation);
    bone.quaternion.fromArray(rotation);
    if (name === "Hips" && facing === "-z") {
      const half = new Quaternion().setFromAxisAngle(UP, Math.PI);
      bone.position.applyQuaternion(half);
      bone.quaternion.premultiply(half);
    }
    objects[parent].add(bone);
    objects[name] = bone;
  }
  scene.updateMatrixWorld(true);
  const rig = buildRigDescription(scene);
  const eyes = new Vector3()
    .addVectors(rig.bones.leftEye.getWorldPosition(new Vector3()), rig.bones.rightEye.getWorldPosition(new Vector3()))
    .multiplyScalar(0.5);
  return { name: `faces ${facing}`, rig, frames: readRestFrames(rig), writes: createBoneWrites(), eyeHeight: eyes.y };
}

const MODELS = [buildModel("+z"), buildModel("-z")];

/** The T5 battery's person: eyes 1.62 m high, controllers in front at waist height, turning about this point */
const EYES = new Vector3(0, 1.62, 0);
const CONTROLLERS = { left: new Vector3(-0.22, 1.08, -0.28), right: new Vector3(0.22, 1.08, -0.28) };
const TURN_CENTRE = new Vector3(0, 0, 0.05);
const FRAME_MS = 1000 / 60;

/** The two fits: the ratio the frame gives and the scale of the user's poses */
function fitsOf(model) {
  return [
    { name: "fit the avatar to me", ratio: EYES.y / model.eyeHeight, scale: 1 },
    { name: "fit me to the avatar", ratio: 1, scale: model.eyeHeight / EYES.y }
  ];
}

/** The battery's pose with the person turned on the spot by `yaw` (radians, left positive), scaled */
function personPose(yaw, scale, targets = CONTROLLERS) {
  const turned = v => v.clone().sub(TURN_CENTRE).applyAxisAngle(UP, yaw).add(TURN_CENTRE).multiplyScalar(scale);
  const pose = createTrackedPose(false);
  pose.isVR = true;
  pose.tracked = TRACKED_ALL;
  const set = (part, position, rotation) =>
    copyTransform(
      { pos: { x: position.x, y: position.y, z: position.z }, rot: { x: rotation[0], y: rotation[1], z: rotation[2] } },
      pose[part]
    );
  set("rig", new Vector3(), [0, 0, 0]);
  set("head", turned(EYES), [0, yaw, 0]);
  set("leftHand", turned(targets.left), [0, yaw, 0]);
  set("rightHand", turned(targets.right), [0, yaw, 0]);
  return pose;
}

function handErrors(model, pose) {
  const errors = {};
  for (const side of ["left", "right"]) {
    const part = side === "left" ? pose.leftHand : pose.rightHand;
    const target = new Vector3(part.pos.x, part.pos.y, part.pos.z);
    errors[side] = model.rig.bones[`${side}Hand`].getWorldPosition(new Vector3()).distanceTo(target);
  }
  return errors;
}

/** Runs the person's yaw over time (a function of seconds) frame by frame; returns the state and the last pose */
function run(model, fit, yawAt, seconds, onFrame) {
  const state = createIkState(model.frames);
  let pose = null;
  for (let frame = 0; frame * FRAME_MS <= seconds * 1000; frame++) {
    const time = (frame * FRAME_MS) / 1000;
    pose = personPose(yawAt(time), fit.scale);
    solveBody(model.rig, pose, state, model.writes, {
      now: 1000 + frame * FRAME_MS,
      isSelf: false,
      modelRatio: fit.ratio
    });
    applyToBones(model.rig, model.writes);
    if (onFrame) onFrame(time, pose);
  }
  return { state, pose };
}

/** Eases from 0 to 1 over [start, start + span] seconds */
function ease(time, start, span) {
  const u = Math.min(1, Math.max(0, (time - start) / span));
  return u * u * (3 - 2 * u);
}

test("controllers held at the waist: the hands stay on them standing still, both model facings, both fits", t => {
  for (const model of MODELS) {
    for (const fit of fitsOf(model)) {
      let worstAtRest = 0;
      run(
        model,
        fit,
        () => 0,
        2,
        (time, pose) => {
          if (time < 0.5) return;
          const errors = handErrors(model, pose);
          worstAtRest = Math.max(worstAtRest, errors.left, errors.right);
        }
      );
      t.log(`${model.name}, ${fit.name}: hand error at rest max ${(worstAtRest * 1000).toFixed(3)} mm`);
      t.true(worstAtRest < HAND_LIMIT_M, `${model.name}, ${fit.name}: hands on the controllers at rest`);
    }
  }
});

test("a turn on the spot and back: the body stays 20 degrees off the head and the hands stay on the controllers", t => {
  for (const model of MODELS) {
    for (const fit of fitsOf(model)) {
      // 100 degrees to the left over a second, held, and back over a second, then held for two
      const yawAt = time => 100 * DEG * (ease(time, 0.5, 1) - ease(time, 2, 1));
      let worstHeld = 0;
      const { state } = run(model, fit, yawAt, 5, (time, pose) => {
        if (time < 3.5) return;
        const errors = handErrors(model, pose);
        worstHeld = Math.max(worstHeld, errors.left, errors.right);
      });
      const bodyOff = state.bodyYaw.yaw / DEG;
      t.log(
        `${model.name}, ${fit.name}: body ${bodyOff.toFixed(1)} degrees off the head; hand error held still ` +
          `after the turn max ${(worstHeld * 1000).toFixed(3)} mm`
      );
      t.true(Math.abs(bodyOff) > 19, `${model.name}, ${fit.name}: the body is left turned by the dead band`);
      t.true(worstHeld < HAND_LIMIT_M, `${model.name}, ${fit.name}: hands on the controllers once held still`);
    }
  }
});

test("controllers beyond the arm: the shoulder turns toward them, never further than its limit, and the hand gets closer", t => {
  for (const model of MODELS) {
    const writes = model.writes;
    const rig = model.rig;
    // Where the upper arms and shoulders stand with the controllers well within reach
    const probe = personPose(0, 1, { left: EYES, right: EYES });
    solveBody(rig, probe, createIkState(model.frames), writes, { now: 1000, isSelf: false, modelRatio: 1 });
    applyToBones(rig, writes);
    for (const side of ["left", "right"]) {
      const upperArm = rig.bones[`${side}UpperArm`].getWorldPosition(new Vector3());
      const shoulderAtRest = rig.bones[`${side}Shoulder`].getWorldQuaternion(new Quaternion());
      const reach = rig.lengths[side].upperArm + rig.lengths[side].forearm;
      const outward = side === "left" ? -1 : 1;
      const directions = {
        "ahead, at the waist": new Vector3(0, -0.6, -1),
        ahead: new Vector3(0, 0, -1),
        up: new Vector3(0, 1, 0),
        outward: new Vector3(outward, 0, 0),
        across: new Vector3(-outward, 0, -0.3),
        down: new Vector3(0, -1, 0.1)
      };
      const gains = [];
      let worstTurn = 0;
      let worstFurther = -Infinity;
      let worstNear = 0;
      for (const [label, direction] of Object.entries(directions)) {
        direction.normalize();
        for (const beyond of [0.005, 0.02, 0.05, 0.1, 0.3]) {
          const target = upperArm.clone().addScaledVector(direction, reach + beyond);
          const pose = personPose(0, 1, { ...CONTROLLERS, [side]: target });
          solveBody(rig, pose, createIkState(model.frames), writes, { now: 1000, isSelf: false, modelRatio: 1 });
          applyToBones(rig, writes);
          const error = rig.bones[`${side}Hand`].getWorldPosition(new Vector3()).distanceTo(target);
          worstFurther = Math.max(worstFurther, error - beyond);
          // Straight out to the side the shoulder already points at the target and cannot bring it closer
          if (beyond <= 0.02 && label !== "outward") worstNear = Math.max(worstNear, error);
          if (beyond === 0.3) gains.push(`${label} ${((beyond - error) * 100).toFixed(1)} cm`);
          const turn = rig.bones[`${side}Shoulder`].getWorldQuaternion(new Quaternion()).angleTo(shoulderAtRest);
          worstTurn = Math.max(worstTurn, turn);
        }
      }
      t.log(
        `${model.name}, ${side}: reach gained by the shoulder 30 cm beyond the arm: ${gains.join(", ")}; ` +
          `shoulder turned at most ${(worstTurn / DEG).toFixed(1)} degrees`
      );
      t.true(worstFurther < 1e-9, `${model.name}, ${side}: never further than the stretched arm alone`);
      t.true(
        worstNear < HAND_LIMIT_M,
        `${model.name}, ${side}: up to 2 cm beyond the arm but straight out, the hand still reaches`
      );
      t.true(worstTurn <= SHOULDER_REACH_MAX_DEG * DEG + 1e-4, `${model.name}, ${side}: the shoulder within its limit`);
    }
  }
});
