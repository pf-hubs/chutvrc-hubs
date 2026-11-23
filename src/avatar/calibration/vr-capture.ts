import { AElement } from "aframe";
import { BodyPosture } from "./body-calibration";
import { captureMessages } from "./capture-messages";
import { createPressCapture, PressCapture, resetPressCapture, stepPressCapture } from "./press-capture";
import {
  createSteadyHeightDetector,
  headTiltOf,
  resetSteadyHeightDetector,
  steadyRunSeconds,
  stepSteadyHeight,
  SteadyHeightDetector
} from "./steady-height";
import { formatCalibrationMessage, TextPanel, TextPanelSize } from "./text-panel";

/**
 * The capture of the headset's height in VR for the body calibration. A prompt in front of the player asks
 * them to stand (or sit) upright, look straight ahead and press both triggers; at the press the headset's
 * height is taken (press-capture.ts), and the prompt says so for a moment before it goes away. A press
 * with the head tilted is refused and the prompt asks again. A player without controllers, who has no
 * triggers, is asked to hold still instead and sees the seconds count down (steady-height.ts). Without an
 * answer the capture gives up, and the entered height is used alone. The caller (apply-calibration.ts)
 * feeds it the headset's real pose, read in the XR reference space before any offset or rig scale.
 */

/** The headset's pose as the capture reads it: its height over the floor in real metres, its orientation */
export type HeadsetSample = { height: number; quaternion: { x: number; y: number; z: number; w: number } };

/** The controllers' triggers this frame, and whether any controller is connected at all */
export type TriggerState = { left: boolean; right: boolean; connected: boolean };

/** How long after the start a player without any controller is taken to have none, in seconds */
const NO_CONTROLLER_SECONDS = 5;
/** Without controllers the headset has to stay steady this long, counted down in the prompt, in seconds */
const HOLD_STILL_SECONDS = 3;
/** How long the capture without controllers waits for that before it gives up, in seconds */
const HOLD_STILL_TIMEOUT_SECONDS = 30;
/** How long the prompt shows the captured height before it goes away, in seconds */
const CONFIRM_SECONDS = 1.5;

/** How far ahead of the eyes the prompt floats, in metres */
const PROMPT_DISTANCE = 1.2;
const PROMPT_SIZE: TextPanelSize = {
  width: 1.0,
  height: 0.26,
  canvasWidth: 1024,
  canvasHeight: 266,
  fontSize: 56,
  textMargin: 48
};
const PROMPT_BACKGROUND = "rgba(0, 0, 0, 0.75)";
const CONFIRM_BACKGROUND = "rgba(0, 110, 60, 0.85)";

/**
 * The prompt: a text panel (text-panel.ts) that follows the player's view with follow-in-fov, the way the
 * in-world notices do. Created the first time it is shown, then kept.
 */
class CapturePrompt {
  private el: AElement | null = null;
  private panel: TextPanel | null = null;
  private shown = false;

  show(text: string, background: string) {
    const el = this.element();
    if (!el) return;
    this.panel!.draw(text, background);
    if (this.shown) return;
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

/** How the height is being asked for: by a press of both triggers, or without controllers by holding still */
type CaptureMode = "press" | "still";

/** One capture at a time: started, fed every frame until it answers, or cancelled */
export class VrHeightCapture {
  private readonly press: PressCapture = createPressCapture();
  private readonly detector: SteadyHeightDetector = createSteadyHeightDetector();
  private readonly prompt = new CapturePrompt();
  private running = false;
  private posture: BodyPosture = "standing";
  private mode: CaptureMode = "press";
  /** Whether a controller has been connected since the capture started */
  private sawController = false;
  private startedAt: number | null = null;
  /** When the prompt that shows the captured height goes away; null while it is not shown */
  private confirmUntil: number | null = null;

  get isRunning(): boolean {
    return this.running;
  }

  /** Whether the capture waits for a press of the triggers, so that the press should do nothing else in the room */
  get waitsForTriggers(): boolean {
    return this.running && this.mode === "press";
  }

  /** Starts asking for the height in the posture; a capture under way starts over */
  start(posture: BodyPosture) {
    resetPressCapture(this.press);
    resetSteadyHeightDetector(this.detector);
    this.posture = posture;
    this.mode = "press";
    this.sawController = false;
    this.startedAt = null;
    this.confirmUntil = null;
    this.running = true;
    this.showAsk();
  }

  /** Stops without an answer and hides the prompt */
  cancel() {
    this.running = false;
    this.confirmUntil = null;
    this.prompt.hide();
  }

  /** Call every frame, also while no capture runs: takes the prompt with the captured height away when its time is up */
  tick(timeSeconds: number) {
    if (this.confirmUntil !== null && timeSeconds >= this.confirmUntil) {
      this.confirmUntil = null;
      if (!this.running) this.prompt.hide();
    }
  }

  /**
   * Feeds one frame: the time in seconds, the headset's pose or null when the headset has none this frame,
   * and the triggers. Returns undefined while the capture goes on; once it ends, the captured height in real
   * metres, or null when it gave up.
   */
  step(timeSeconds: number, sample: HeadsetSample | null, triggers: TriggerState): number | null | undefined {
    if (!this.running) return undefined;
    if (this.startedAt === null) this.startedAt = timeSeconds;
    const height = sample ? sample.height : NaN;
    const tilt = sample ? headTiltOf(sample.quaternion) : NaN;

    if (triggers.connected) {
      this.sawController = true;
      if (this.mode === "still") {
        // A controller was picked up after all: ask for the press
        resetPressCapture(this.press);
        this.mode = "press";
      }
    } else if (this.mode === "press" && !this.sawController && timeSeconds - this.startedAt >= NO_CONTROLLER_SECONDS) {
      resetSteadyHeightDetector(this.detector);
      this.mode = "still";
    }

    if (this.mode === "press") {
      const result = stepPressCapture(this.press, timeSeconds, height, tilt, triggers.left, triggers.right);
      switch (result.status) {
        case "captured":
          return this.finish(timeSeconds, result.height);
        case "timedOut":
          return this.giveUp();
        case "rejected":
          this.showAskAgain();
          return undefined;
        default:
          this.showAsk();
          return undefined;
      }
    }

    const result = stepSteadyHeight(this.detector, timeSeconds, height, tilt, HOLD_STILL_SECONDS, HOLD_STILL_TIMEOUT_SECONDS);
    if (result.status === "steady") return this.finish(timeSeconds, result.height);
    if (result.status === "timedOut") return this.giveUp();
    const left = HOLD_STILL_SECONDS - steadyRunSeconds(this.detector);
    this.showHoldStill(Math.min(HOLD_STILL_SECONDS, Math.max(1, Math.ceil(left))));
    return undefined;
  }

  private finish(timeSeconds: number, height: number): number {
    this.running = false;
    this.confirmUntil = timeSeconds + CONFIRM_SECONDS;
    this.prompt.show(
      formatCalibrationMessage(captureMessages.captured, { height: height.toFixed(2) }),
      CONFIRM_BACKGROUND
    );
    return height;
  }

  private giveUp(): null {
    this.cancel();
    return null;
  }

  private postureLine(): string {
    return formatCalibrationMessage(this.posture === "sitting" ? captureMessages.sitting : captureMessages.standing);
  }

  private showAsk() {
    this.prompt.show(`${this.postureLine()}\n${formatCalibrationMessage(captureMessages.pressTriggers)}`, PROMPT_BACKGROUND);
  }

  private showAskAgain() {
    this.prompt.show(
      `${formatCalibrationMessage(captureMessages.levelHead)}\n${formatCalibrationMessage(captureMessages.pressTriggersAgain)}`,
      PROMPT_BACKGROUND
    );
  }

  private showHoldStill(seconds: number) {
    this.prompt.show(
      `${this.postureLine()}\n${formatCalibrationMessage(captureMessages.holdStill, { seconds })}`,
      PROMPT_BACKGROUND
    );
  }
}
