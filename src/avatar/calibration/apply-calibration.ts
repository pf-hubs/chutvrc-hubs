import { AElement } from "aframe";
import { Object3D, WebGLRenderer } from "three";
import {
  BodyCalibration,
  BodyFit,
  BodyPosture,
  deriveBodyCalibration,
  isCalibratedHeight,
  parseBodyFit,
  parseBodyPosture
} from "./body-calibration";
import { HeadsetSample, VrHeightCapture } from "./vr-capture";

/**
 * Applies the body calibration to the own player while they are in VR with the new avatar body solver on
 * and a height saved: it captures the headset's height when the VR session starts (vr-capture.ts), derives
 * the calibration from the preferences, the capture and the own model's eye height (body-calibration.ts),
 * and applies it:
 *
 * - "Fit me to the avatar" scales the avatar rig (#avatar-rig), multiplied with the avatar_scale address
 *   parameter's scale, so the view, the reach and the walking speed take the model's size;
 * - a seated player's tracking offset lifts the headset and both controllers together;
 * - the standing eye height in room metres is announced with the own avatar (net/pose-sync.ts) and kept in
 *   the pose store under the own client id, from which the own avatar's VR solver takes its ratio too.
 *
 * Where the offset goes. The headset's pose reaches the camera through three.js's WebXR manager, which reads
 * the viewer pose in its reference space every frame; the controllers' poses come from the user input
 * system, which reads them in a reference space of its own (both "local-floor"). The camera and the
 * controllers are children of the rig, and the rig itself is kept on the floor of the navigation mesh by
 * the character controller, which measures the player's height as the camera's height over the rig. So the
 * offset is applied where the poses come from: both are given one offset reference space
 * (getOffsetReferenceSpace), and the camera, the avatar's point of view, the controllers, their cursors and
 * whatever hangs from them rise together, while the rig stays on the floor and its position, sent to the
 * others as the avatar's, is unchanged. An offset at the rig would lift the rig off the floor, and the
 * character controller would put it back.
 *
 * Nothing of this applies outside VR, with the new solver off or without a saved height: then the rig takes
 * its own scale back, the reference spaces their own, and no eye height is announced. Everything is
 * re-applied when the own model changes, a preference changes or a capture ends. Ticked once a frame from
 * avatarSystemsTick, before the own pose is sampled.
 */

/** A change of the rig's scale smaller than this is rounding, not a change */
const SCALE_EPSILON = 1e-9;

/** The rig's scale the avatar_scale address parameter asks for, as scene-entry-manager.js applies it; 1 without */
function avatarScaleParameter(): number {
  const scale = parseInt(new URLSearchParams(location.search).get("avatar_scale") || "", 10);
  return scale ? scale : 1;
}

/** The own model's eye height at its own size, in metres; 0 while the own avatar has no model */
function ownModelEyeHeight(): number {
  const avatarSync = APP.sfu?.avatarSync;
  if (!avatarSync) return 0;
  const avatarEid = avatarSync.models.avatarEidByClientId.get(APP.sfu.clientId);
  const ik = avatarEid === undefined ? undefined : APP.world.eid2Ik.get(avatarEid);
  return ik ? ik.modelEyeHeight() : 0;
}

/** The user input system's reference space, in which it reads the controllers' poses */
type UserInputReferenceSpace = { xrReferenceSpace?: XRReferenceSpace | null };

type CalibrationInputs = {
  heightCm: number;
  posture: BodyPosture;
  fit: BodyFit;
  capturedHeadHeight: number | null;
  modelEyeHeight: number;
};

function sameInputs(a: CalibrationInputs | null, b: CalibrationInputs): boolean {
  return (
    !!a &&
    a.heightCm === b.heightCm &&
    a.posture === b.posture &&
    a.fit === b.fit &&
    a.capturedHeadHeight === b.capturedHeadHeight &&
    a.modelEyeHeight === b.modelEyeHeight
  );
}

export class BodyCalibrationController {
  private readonly capture = new VrHeightCapture();
  private readonly baseRigScale = avatarScaleParameter();
  /** The XR session the capture and the reference spaces below belong to */
  private session: XRSession | null = null;
  /** The WebXR manager's own reference space for the session, before any offset */
  private baseSpace: XRReferenceSpace | null = null;
  /** The offset reference space given to the camera and the controllers; null while there is no offset */
  private offsetSpace: XRReferenceSpace | null = null;
  private appliedOffsetY = 0;
  /** Whether this controller set the rig's scale, so it puts the scale back when it stops applying */
  private scalesRig = false;
  /** The headset's captured height in real metres for this session; null before a capture or after a time-out */
  private capturedHeadHeight: number | null = null;
  /** The posture the capture was taken in; a capture in another posture does not count */
  private capturedPosture: BodyPosture | null = null;
  private captureRequested = false;
  /** The own model's eye height, kept while a new model loads so the fit does not jump in between */
  private modelEyeHeight = 0;
  private inputs: CalibrationInputs | null = null;
  private calibration: BodyCalibration | null = null;
  /** The own eye height last written to the pose store, and under which client id */
  private announcedEyeHeight: number | undefined;
  private announcedClientId: string | undefined;

  /** The calibration applied now; null while none is */
  get current(): BodyCalibration | null {
    return this.calibration;
  }

  /** Whether a calibrated player is fitted to the avatar now, so their walking speed follows the rig's scale */
  get fitsPlayerToAvatar(): boolean {
    return this.inputs?.fit === "playerToAvatar" && this.calibration !== null;
  }

  /** Whether the headset can be captured now: in VR, with the new solver on and a height saved */
  get canCapture(): boolean {
    return this.session !== null && this.calibration !== null;
  }

  /** Captures the headset's height again, from the next frame, if it can be captured now */
  requestCapture() {
    if (this.canCapture) this.captureRequested = true;
  }

  /** `now` is the frame's time in milliseconds */
  tick(now: number) {
    const scene = APP.scene;
    const preferences = APP.store?.state.preferences;
    // A stand-in renderer, such as a bot's, may have no WebXR manager
    const xr: WebGLRenderer["xr"] | undefined = scene?.renderer?.xr;
    const session = xr && xr.isPresenting && scene!.is("vr-mode") ? xr.getSession() : null;
    const heightCm = preferences?.bodyHeightCm;
    if (!xr || !session || !preferences?.avatarIkV2 || !isCalibratedHeight(heightCm)) {
      this.stop(xr);
      if (!session) this.forgetSession();
      return;
    }

    if (session !== this.session) {
      // A new VR session: its reference space is the WebXR manager's own until an offset is given, and the
      // headset is captured afresh
      this.forgetSession();
      this.session = session;
      this.captureRequested = true;
    }
    if (!this.baseSpace) {
      this.baseSpace = xr.getReferenceSpace();
      if (!this.baseSpace) return;
    }

    const posture = parseBodyPosture(preferences.bodyPosture);
    if (this.capturedPosture !== null && this.capturedPosture !== posture) this.captureRequested = true;
    if (this.captureRequested) {
      this.captureRequested = false;
      this.capturedPosture = posture;
      this.capturedHeadHeight = null;
      this.capture.start(posture);
    }
    if (this.capture.isRunning) {
      const captured = this.capture.step(now / 1000, this.readHeadset(xr));
      if (captured !== undefined) {
        this.capturedHeadHeight = captured;
        if (captured === null) console.warn("Body calibration: the headset was not steady; using the entered height");
        else console.log(`Body calibration: captured the headset at ${captured.toFixed(3)} m`);
      }
    }

    const modelEyeHeight = ownModelEyeHeight();
    if (modelEyeHeight > 0) this.modelEyeHeight = modelEyeHeight;
    const inputs: CalibrationInputs = {
      heightCm,
      posture,
      fit: parseBodyFit(preferences.bodyFit),
      capturedHeadHeight: this.capturedHeadHeight,
      modelEyeHeight: this.modelEyeHeight
    };
    if (!sameInputs(this.inputs, inputs) || !this.calibration) {
      this.inputs = inputs;
      this.calibration = deriveBodyCalibration(inputs);
      console.log("Body calibration:", { ...inputs, ...this.calibration });
    }

    this.applyRigScale(this.baseRigScale * this.calibration.rigScale);
    this.scalesRig = true;
    this.applyOffset(xr, this.calibration.trackingOffsetY);
    this.announce(this.calibration.announcedEyeHeight * this.baseRigScale);
  }

  /** The headset's pose in the WebXR manager's own reference space: real metres, before the offset and the rig */
  private readHeadset(xr: WebGLRenderer["xr"]): HeadsetSample | null {
    const frame = xr.getFrame();
    if (!frame || !this.baseSpace) return null;
    const pose = frame.getViewerPose(this.baseSpace);
    if (!pose) return null;
    return { height: pose.transform.position.y, quaternion: pose.transform.orientation };
  }

  private rig(): Object3D | null {
    return (document.getElementById("avatar-rig") as AElement | null)?.object3D ?? null;
  }

  private applyRigScale(scale: number) {
    const rig = this.rig();
    if (!rig || Math.abs(rig.scale.y - scale) < SCALE_EPSILON) return;
    rig.scale.setScalar(scale);
    rig.matrixNeedsUpdate = true;
  }

  /**
   * Gives the camera and the controllers a reference space whose poses are higher by the offset, or their
   * own while the offset is 0. The user input system asks for its reference space a moment after a session
   * starts, so it is checked every frame.
   */
  private applyOffset(xr: WebGLRenderer["xr"], offsetY: number) {
    const base = this.baseSpace!;
    if (offsetY !== this.appliedOffsetY || (offsetY !== 0 && !this.offsetSpace)) {
      this.offsetSpace =
        offsetY === 0 ? null : base.getOffsetReferenceSpace(new XRRigidTransform({ x: 0, y: -offsetY, z: 0 }));
      this.appliedOffsetY = offsetY;
      xr.setReferenceSpace(this.offsetSpace ?? base);
      const userinput = this.userinput();
      if (userinput && !this.offsetSpace && userinput.xrReferenceSpace) userinput.xrReferenceSpace = base;
    }
    if (this.offsetSpace) {
      const userinput = this.userinput();
      if (userinput && userinput.xrReferenceSpace !== this.offsetSpace) userinput.xrReferenceSpace = this.offsetSpace;
    }
  }

  private userinput(): UserInputReferenceSpace | undefined {
    return APP.scene?.systems.userinput as unknown as UserInputReferenceSpace | undefined;
  }

  /** Keeps the own eye height in the pose store and tells the peers when it changed */
  private announce(eyeHeight: number | undefined) {
    const clientId = APP.sfu?.clientId;
    if (eyeHeight === this.announcedEyeHeight && clientId === this.announcedClientId) return;
    if (this.announcedClientId !== undefined && this.announcedClientId !== clientId) {
      APP.avatarPoses.setAnnouncedEyeHeight(this.announcedClientId, undefined);
    }
    if (clientId) APP.avatarPoses.setAnnouncedEyeHeight(clientId, eyeHeight);
    const changed = eyeHeight !== this.announcedEyeHeight;
    this.announcedEyeHeight = eyeHeight;
    this.announcedClientId = clientId;
    if (changed) APP.sfu?.avatarSync?.announceSelfChanged();
  }

  /** Takes everything back: the rig's scale, the reference spaces, the announced eye height and the prompt */
  private stop(xr: WebGLRenderer["xr"] | undefined) {
    this.capture.cancel();
    this.captureRequested = false;
    if (this.scalesRig) {
      this.applyRigScale(this.baseRigScale);
      this.scalesRig = false;
    }
    if (this.offsetSpace || this.appliedOffsetY !== 0) {
      if (xr && this.baseSpace) xr.setReferenceSpace(this.baseSpace);
      const userinput = this.userinput();
      if (userinput && this.baseSpace && userinput.xrReferenceSpace === this.offsetSpace) {
        userinput.xrReferenceSpace = this.baseSpace;
      }
      this.offsetSpace = null;
      this.appliedOffsetY = 0;
    }
    this.inputs = null;
    this.calibration = null;
    this.announce(undefined);
  }

  /** Forgets the session: the next one starts with its own reference space and a new capture */
  private forgetSession() {
    this.session = null;
    this.baseSpace = null;
    this.offsetSpace = null;
    this.appliedOffsetY = 0;
    this.capturedHeadHeight = null;
    this.capturedPosture = null;
  }
}

/** The page's one controller */
export const bodyCalibration = new BodyCalibrationController();

/** Whether the own walking speed follows the rig's scale itself: a calibrated player fitted to the avatar */
export function walkingSpeedFollowsRigScale(): boolean {
  return bodyCalibration.fitsPlayerToAvatar;
}
