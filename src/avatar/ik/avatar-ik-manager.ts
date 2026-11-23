import { Object3D } from "three";
import { applyToBones, readRestFrames } from "./apply-to-bones";
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

/**
 * Solves one avatar's model each frame from the pose of the client it shows: a pure solve over the rig
 * description and the tracked pose (solve-body.ts), then one write to the bones (apply-to-bones.ts). It
 * keeps what belongs to the model between frames: the rest pose, the solver state and the eye height.
 */
export class AvatarIkManager {
  /** The bones and the measurements of the rig as they were described when the model was loaded */
  private rig: RigDescription;
  /** The model's rest pose in root space, read once when first needed */
  private restFrames: RestFrames | undefined;
  /** The model's eye height at its own size, measured once when first needed */
  private eyeHeight: number | undefined;
  /** The solvers' state, one for the avatar whichever of the VR, screen and chatbot solvers its pose calls for */
  private ikState: IkState | undefined;
  private boneWrites: BoneWrites | undefined;
  private solverKind: SolverKind | undefined;
  /**
   * What is hidden until the first pose is solved, so the model is not seen in its rest pose: the object
   * above the root, or the root itself when it is the model's top object; null for a model without a root
   * and hips, which is never solved
   */
  private shownWhenSolved: Object3D | null;

  constructor(rig: RigDescription) {
    this.rig = rig;
    const root = rig.bones.root;
    this.shownWhenSolved = root && rig.bones.hips ? root.parent ?? root : null;
    if (this.shownWhenSolved) this.shownWhenSolved.visible = false;
  }

  /**
   * Solves the avatar from the tracked pose of the client it shows; the own avatar is told by its client
   * id. solveBody picks the VR, screen or chatbot solver from the pose each frame and starts the feet and
   * hands of the solver the avatar enters afresh when its client moves between VR and a screen. The VR
   * solver draws the model at the client's announced standing eye height over this model's eye height (1
   * when the client announces none, as an older build or a player without the body calibration does), so
   * every observer of the same model draws it at the same size; the solver state keeps it as `modelRatio`.
   */
  updateAvatarBoneIkById(pose: TrackedPose, clientId: string) {
    const root = this.rig.bones.root;
    if (!root || !this.rig.bones.hips) return;
    const kind = solverKindOf(pose);
    if (kind !== this.solverKind) {
      this.solverKind = kind;
      console.log(`Avatar of ${clientId}: solving with the ${kind} body solver`);
    }
    if (this.shownWhenSolved && !this.shownWhenSolved.visible) this.shownWhenSolved.visible = true;
    if (!this.ikState || !this.boneWrites) {
      this.ikState = createIkState(this.restFramesOf());
      this.boneWrites = createBoneWrites();
    }
    const modelRatio = modelRatioOf(APP.avatarPoses.announcedEyeHeightOf(clientId) ?? 0, this.modelEyeHeight());
    solveBody(this.rig, pose, this.ikState, this.boneWrites, {
      now: performance.now(),
      isSelf: clientId === APP.sfu.clientId,
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
}
