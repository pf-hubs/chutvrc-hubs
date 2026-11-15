import { Object3D, Vector3 } from "three";
import { applyToBones, readRestFrames, resetRootScale } from "./apply-to-bones";
import { modelRatioOf } from "../calibration/body-calibration";
import {
  BoneWrites,
  createBoneWrites,
  createIkState,
  IkState,
  solveBody,
  SolverKind,
  solverKindOf
} from "./solve-body";
import { rigEyeHeight } from "./shared/head";
import { RestFrames } from "./shared/rig-frames";
import { TrackedPose } from "../pose/tracked-pose";
import { RigDescription } from "../rig/rig-description";
import { Transform } from "../../types/transform";
import { HeadIk } from "./legacy/head-ik";
import { ArmIk } from "./legacy/arm-ik";
import { LegIk } from "./legacy/leg-ik";
import { JointSettings } from "./legacy/joint-settings";
import { AvatarAnimState } from "../../types/avatar-types";

/** The pose as the old solver reads it: the rig and the headset and controller transforms in the rig's space */
type InputTransform = {
  rig: Transform;
  hmd: Transform;
  leftController: Transform;
  rightController: Transform;
  leftFoot?: Transform;
  rightFoot?: Transform;
};

const SelfHipsPositionOffset = new Vector3(0, 0, -0.1);
const SelfHipsPositionFlippedOffset = new Vector3(0, 0, 0.1);
const hipsPositionOffset = new Vector3();

const DummyInputTransform = {
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 }
};

export class AvatarIkManager {
  private isVR: boolean;
  private animState: AvatarAnimState;
  private isFlippedY: boolean;
  private rootBone: Object3D | undefined;
  private rootPos: Vector3;
  private rootInput: Transform | undefined;
  private hipsBone: Object3D | undefined;
  private isInputReady: boolean;
  private isSelfAvatar: boolean;
  private isHalfBody: boolean;
  private isNPC: boolean;
  private hips2HeadDist: number;

  private headIK: HeadIk;
  private leftArmIK: ArmIk;
  private rightArmIK: ArmIk;
  private leftLegIK: LegIk;
  private rightLegIK: LegIk;
  private poseInput: InputTransform;

  private leftFootWorldInput: Transform;
  private rightFootWorldInput: Transform;

  /**
   * The new solvers' state, one for the avatar whichever of the VR, screen and chatbot solvers its pose
   * calls for, and their output; created the first time the preference selects the new solver
   */
  private rig: RigDescription;
  /** The model's rest pose in root space, read once when first needed */
  private restFrames: RestFrames | undefined;
  /** The model's eye height at its own size, measured once when first needed */
  private eyeHeight: number | undefined;
  private ikState: IkState | undefined;
  private boneWrites: BoneWrites | undefined;
  private usesNewSolver: boolean | undefined;
  private newSolverKind: SolverKind | undefined;

  /** Takes the bones and the measurements of the rig as they were described when the model was loaded */
  constructor(rig: RigDescription, isNPC?: boolean) {
    const bone = (name: keyof RigDescription["bones"]) => rig.bones[name] ?? undefined;
    this.rig = rig;
    const head = bone("head");
    const spine = bone("spine");
    this.hipsBone = bone("hips");
    const left = bone("leftHand");
    const right = bone("rightHand");
    const leftFoot = bone("leftFoot");
    const rightFoot = bone("rightFoot");

    this.isVR = false;
    this.animState = 0; // avatar anim state TODO: change number to type AvatarAnimState
    this.isFlippedY = rig.isFlippedY;
    this.rootBone = bone("root");
    this.rootPos = new Vector3();
    this.isInputReady = false;
    this.isSelfAvatar = false;
    this.isNPC = isNPC || false;
    this.poseInput = {
      rig: DummyInputTransform,
      hmd: DummyInputTransform,
      leftController: DummyInputTransform,
      rightController: DummyInputTransform
    };

    this.hips2HeadDist = rig.lengths.hipsToHead;
    this.isHalfBody = rig.isHalfBody;

    this.stand();

    if (this.rootBone && this.hipsBone) {
      if (this.rootBone.parent) this.rootBone.parent.visible = false;

      if (head) {
        this.headIK = new HeadIk(
          this.rootBone,
          this.hipsBone,
          { bone: spine, ...JointSettings.head.base },
          { bone: bone("neck"), ...JointSettings.head.elbow },
          head,
          this.isFlippedY
        );
      }
      if (left) {
        this.leftArmIK = new ArmIk(
          this.rootBone,
          this.hipsBone,
          { bone: bone("leftUpperArm"), ...JointSettings.leftArm.base },
          { bone: bone("leftLowerArm"), ...JointSettings.leftArm.elbow },
          left,
          this.isFlippedY,
          true,
          this.isHalfBody
          // true
        );
      }
      if (right) {
        this.rightArmIK = new ArmIk(
          this.rootBone,
          this.hipsBone,
          { bone: bone("rightUpperArm"), ...JointSettings.rightArm.base },
          { bone: bone("rightLowerArm"), ...JointSettings.rightArm.elbow },
          right,
          this.isFlippedY,
          false,
          this.isHalfBody,
          true
        );
      }
      if (leftFoot) {
        this.leftLegIK = new LegIk(
          this.rootBone,
          this.hipsBone,
          { bone: bone("leftUpperLeg"), ...JointSettings.leftLeg.base },
          { bone: bone("leftLowerLeg"), ...JointSettings.leftLeg.elbow },
          leftFoot,
          this.isFlippedY,
          true
        );
      }
      if (rightFoot) {
        this.rightLegIK = new LegIk(
          this.rootBone,
          this.hipsBone,
          { bone: bone("rightUpperLeg"), ...JointSettings.rightLeg.base },
          { bone: bone("rightLowerLeg"), ...JointSettings.rightLeg.elbow },
          rightFoot,
          this.isFlippedY,
          false
        );
      }
    }
  }

  /** Solves the avatar from the tracked pose of the client it shows; the own avatar is told by its client id */
  updateAvatarBoneIkById(pose: TrackedPose, clientId: string) {
    const animState = pose.animState;
    this.poseInput.rig = pose.rig;
    this.poseInput.hmd = pose.head;
    this.poseInput.leftController = pose.leftHand;
    this.poseInput.rightController = pose.rightHand;
    this.isSelfAvatar = clientId === APP.sfu.clientId;
    this.isVR = pose.isVR;
    if (this.animState !== animState) {
      switch (animState) {
        case AvatarAnimState.STAND:
          this.stand();
          break;
        case AvatarAnimState.WALK:
          this.walk();
          break;
        case AvatarAnimState.SIT:
          this.sit();
          break;
        default:
          break;
      }
      this.animState = animState;
    }

    const useNewSolver = !!APP.store.state.preferences.avatarIkV2;
    if (useNewSolver !== this.usesNewSolver) {
      this.usesNewSolver = useNewSolver;
      console.log(`Avatar of ${clientId}: solving with the ${useNewSolver ? "new" : "old"} body solver`);
      // The old solver draws the model at its own size
      if (!useNewSolver) resetRootScale(this.rig);
    }
    if (useNewSolver) this.solveWithNewSolver(pose, clientId);
    else this.updateAvatarBoneIk(this.poseInput);
  }

  /**
   * The new path: a pure solve over the rig description and the tracked pose, then one write to the bones.
   * solveBody picks the VR, screen or chatbot solver from the pose each frame and starts the feet and hands
   * of the solver the avatar enters afresh when its client moves between VR and a screen. The VR solver
   * draws the model at the client's announced standing eye height over this model's eye height (1 when the
   * client announces none, as an old build or a player without the body calibration does), so every
   * observer of the same model draws it at the same size; the solver state keeps it as `modelRatio`.
   */
  private solveWithNewSolver(pose: TrackedPose, clientId: string) {
    if (!this.rootBone || !this.hipsBone) return;
    const kind = solverKindOf(pose);
    if (kind !== this.newSolverKind) {
      this.newSolverKind = kind;
      console.log(`Avatar of ${clientId}: solving with the new ${kind} body solver`);
    }
    this.isInputReady = true;
    if (this.rootBone.parent && !this.rootBone.parent.visible) this.rootBone.parent.visible = true;
    if (!this.ikState || !this.boneWrites) {
      this.ikState = createIkState(this.restFramesOf());
      this.boneWrites = createBoneWrites();
    }
    const modelRatio = modelRatioOf(APP.avatarPoses.announcedEyeHeightOf(clientId) ?? 0, this.modelEyeHeight());
    solveBody(this.rig, pose, this.ikState, this.boneWrites, {
      now: performance.now(),
      isSelf: this.isSelfAvatar,
      modelRatio
    });
    applyToBones(this.rig, this.boneWrites);
  }

  private restFramesOf(): RestFrames {
    if (!this.restFrames) this.restFrames = readRestFrames(this.rig);
    return this.restFrames;
  }

  /**
   * The height of the model's eyes over the floor in its rest pose at its own size, in metres; 0 when the
   * model has no head to measure. The body calibration and the VR solver's ratio are taken against it.
   */
  modelEyeHeight(): number {
    if (this.eyeHeight === undefined) {
      const head = this.restFramesOf().head;
      this.eyeHeight = head ? rigEyeHeight(this.rig, head) : 0;
    }
    return this.eyeHeight;
  }

  updateAvatarBoneIk(poseInput: InputTransform) {
    if (!this.rootBone || !poseInput) return;
    this.isInputReady = true;

    // TODO: emit event so that name tag can initialize its position
    if (!this.isInputReady) return;
    if (this.rootBone.parent && !this.rootBone.parent?.visible) this.rootBone.parent.visible = true;

    this.rootInput = poseInput.rig;
    if (!this.isNPC) this.updateRootAndHipsTransform(poseInput.hmd);

    this.headIK?.solve(poseInput.hmd, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    this.leftArmIK?.solve(poseInput.leftController, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    this.rightArmIK?.solve(poseInput.rightController, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);

    // if (!this.isNPC && this.leftFootWorldInput)
    this.leftLegIK?.solve(this.leftFootWorldInput, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);
    // if (!this.isNPC && this.rightFootWorldInput)
    this.rightLegIK?.solve(this.rightFootWorldInput, poseInput.hmd, this.isVR, this.isSelfAvatar, this.isNPC);

    if (this.isVR) this.rootBone?.updateWorldMatrix(false, true);
  }

  private updateRootAndHipsTransform(hmdTransform: Transform | undefined) {
    if (!this.rootInput || !hmdTransform) return;

    if (this.rootBone) {
      this.rootBone.position.set(this.rootInput.pos.x, this.rootInput.pos.y, this.rootInput.pos.z);
      this.rootBone.rotation.set(this.rootInput.rot.x, this.rootInput.rot.y, 0 /* this.rootInput.rot.z */);
      this.rootBone.rotation._onChangeCallback();
      this.rootBone.updateMatrix();
      this.rootBone.getWorldPosition(this.rootPos);
    }

    if (this.hipsBone) {
      this.hipsBone.position.set(
        this.isVR ? hmdTransform.pos.x : 0,
        hmdTransform.pos.y - this.hips2HeadDist - 0.05,
        this.isVR ? hmdTransform.pos.z : 0
      );
      if (this.isSelfAvatar) {
        this.hipsBone.position.add(
          hipsPositionOffset
            .copy(this.isFlippedY ? SelfHipsPositionFlippedOffset : SelfHipsPositionOffset)
            .applyQuaternion(this.hipsBone.quaternion)
        );
      }
      this.hipsBone.rotation.set(0, (hmdTransform?.rot.y || 0) + (this.isFlippedY ? 0 : Math.PI), 0);
      this.hipsBone.rotation._onChangeCallback();
      this.hipsBone.updateMatrix();
    }
  }

  stand() {
    this.leftFootWorldInput = {
      pos: { x: 0.1, y: 0, z: 0 },
      rot: { x: -1, y: 0, z: 0 }
    };
    this.rightFootWorldInput = {
      pos: { x: -0.1, y: 0, z: 0 },
      rot: { x: -1, y: 0, z: 0 }
    };
  }

  // Walking is not implemented: the feet keep the targets of the current standing or sitting pose
  walk() {}

  sit() {
    this.leftFootWorldInput = {
      pos: { x: 0.1, y: 0.3, z: 0.4 },
      rot: { x: -1, y: 0, z: 0 }
    };
    this.rightFootWorldInput = {
      pos: { x: -0.1, y: 0.3, z: 0.4 },
      rot: { x: -1, y: 0, z: 0 }
    };
  }
}
