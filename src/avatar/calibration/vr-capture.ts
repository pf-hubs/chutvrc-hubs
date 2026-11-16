import { AElement } from "aframe";
import { BodyPosture } from "./body-calibration";
import { captureMessages } from "./capture-messages";
import {
  createSteadyHeightDetector,
  headTiltOf,
  resetSteadyHeightDetector,
  stepSteadyHeight,
  SteadyHeightDetector
} from "./steady-height";
import { formatCalibrationMessage, TextPanel, TextPanelSize } from "./text-panel";

/**
 * The capture of the headset's height in VR for the body calibration: a prompt in front of the player asks
 * them to stand (or sit) upright and look straight ahead, the headset's height is taken once it has been
 * steady for a second (steady-height.ts), and the prompt goes away. After ten seconds without a steady
 * second the capture gives up, and the entered height is used alone. The caller (apply-calibration.ts)
 * feeds it the headset's real pose, read in the XR reference space before any offset or rig scale.
 */

/** The headset's pose as the capture reads it: its height over the floor in real metres, its orientation */
export type HeadsetSample = { height: number; quaternion: { x: number; y: number; z: number; w: number } };

/** How far ahead of the eyes the prompt floats, in metres */
const PROMPT_DISTANCE = 1.2;
const PROMPT_SIZE: TextPanelSize = {
  width: 1.0,
  height: 0.18,
  canvasWidth: 1024,
  canvasHeight: 184,
  fontSize: 60,
  textMargin: 48
};
const PROMPT_BACKGROUND = "rgba(0, 0, 0, 0.75)";

/**
 * The prompt: a text panel (text-panel.ts) that follows the player's view with follow-in-fov, the way the
 * in-world notices do. Created the first time it is shown, then kept.
 */
class CapturePrompt {
  private el: AElement | null = null;
  private panel: TextPanel | null = null;
  private shown = false;

  show(posture: BodyPosture) {
    const el = this.element();
    if (!el) return;
    this.panel!.draw(
      formatCalibrationMessage(posture === "sitting" ? captureMessages.sitting : captureMessages.standing),
      PROMPT_BACKGROUND
    );
    // Placed straight in front of the eyes when it appears, not drifting there from where it was last shown
    (el.components["follow-in-fov"] as unknown as { reset?: () => void } | undefined)?.reset?.();
    el.setAttribute("visible", "true");
    this.shown = true;
  }

  hide() {
    if (!this.el || !this.shown) return;
    this.el.setAttribute("visible", "false");
    this.shown = false;
  }

  private element(): AElement | null {
    if (this.el) return this.el;
    const scene = APP.scene;
    if (!scene) return null;
    const panel = new TextPanel(PROMPT_SIZE);
    const el = document.createElement("a-entity") as AElement;
    el.setAttribute("follow-in-fov", `target: #avatar-pov-node; offset: 0 0 -${PROMPT_DISTANCE}; angle: 0`);
    el.setAttribute("visible", "false");
    el.object3D.add(panel.mesh);
    scene.appendChild(el);

    this.el = el;
    this.panel = panel;
    return el;
  }
}

/** One capture at a time: started, fed every frame until it answers, or cancelled */
export class VrHeightCapture {
  private readonly detector: SteadyHeightDetector = createSteadyHeightDetector();
  private readonly prompt = new CapturePrompt();
  private running = false;

  get isRunning(): boolean {
    return this.running;
  }

  /** Shows the prompt for the posture and starts waiting for a steady second; a capture under way starts over */
  start(posture: BodyPosture) {
    resetSteadyHeightDetector(this.detector);
    this.running = true;
    this.prompt.show(posture);
  }

  /** Stops without an answer and hides the prompt */
  cancel() {
    this.running = false;
    this.prompt.hide();
  }

  /**
   * Feeds one frame: the time in seconds, and the headset's pose or null when the headset has none this
   * frame (which breaks a steady run). Returns undefined while the capture goes on; once it ends, hides the
   * prompt and returns the captured height in real metres, or null when it timed out.
   */
  step(timeSeconds: number, sample: HeadsetSample | null): number | null | undefined {
    if (!this.running) return undefined;
    const result = sample
      ? stepSteadyHeight(this.detector, timeSeconds, sample.height, headTiltOf(sample.quaternion))
      : stepSteadyHeight(this.detector, timeSeconds, NaN, NaN);
    if (result.status === "waiting") return undefined;
    this.cancel();
    return result.status === "steady" ? result.height : null;
  }
}
