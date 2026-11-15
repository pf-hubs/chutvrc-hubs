import { AElement } from "aframe";
import { CanvasTexture, DoubleSide, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { createIntl, createIntlCache, IntlShape } from "react-intl";
import { getLocale, getMessages } from "../../utils/i18n";
import { BodyPosture } from "./body-calibration";
import { captureMessages } from "./capture-messages";
import {
  createSteadyHeightDetector,
  headTiltOf,
  resetSteadyHeightDetector,
  stepSteadyHeight,
  SteadyHeightDetector
} from "./steady-height";

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
/** The prompt's size in metres, and its texture's in pixels at the same proportions */
const PROMPT_WIDTH = 1.0;
const PROMPT_HEIGHT = 0.18;
const CANVAS_WIDTH = 1024;
const CANVAS_HEIGHT = 184;
const FONT_SIZE = 60;
const TEXT_MARGIN = 48;

/**
 * The prompt: a panel with one line of text that follows the player's view with follow-in-fov, the way the
 * in-world notices do. The text is drawn onto a canvas with the browser's fonts rather than with the scene's
 * text component, whose default font has no Japanese glyphs. Created the first time it is shown, then kept.
 */
class CapturePrompt {
  private el: AElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private texture: CanvasTexture | null = null;
  private text = "";
  private intl: IntlShape | null = null;
  private intlLocale = "";
  private readonly intlCache = createIntlCache();

  show(posture: BodyPosture) {
    const el = this.element();
    if (!el) return;
    this.setText(
      this.formatter().formatMessage(posture === "sitting" ? captureMessages.sitting : captureMessages.standing)
    );
    // Placed straight in front of the eyes when it appears, not drifting there from where it was last shown
    (el.components["follow-in-fov"] as unknown as { reset?: () => void } | undefined)?.reset?.();
    el.object3D.visible = true;
  }

  hide() {
    if (this.el) this.el.object3D.visible = false;
  }

  /** The texts in the language the page shows, the English ones while it shows English */
  private formatter(): IntlShape {
    const locale = getLocale();
    if (!this.intl || this.intlLocale !== locale) {
      this.intl = createIntl({ locale, messages: getMessages(), onError: () => {} }, this.intlCache);
      this.intlLocale = locale;
    }
    return this.intl;
  }

  private element(): AElement | null {
    if (this.el) return this.el;
    const scene = APP.scene;
    if (!scene) return null;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const texture = new CanvasTexture(canvas);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, side: DoubleSide });
    const mesh = new Mesh(new PlaneGeometry(PROMPT_WIDTH, PROMPT_HEIGHT), material);
    // Drawn over the room, so a wall or an avatar close by does not hide it
    mesh.renderOrder = 10000;

    const el = document.createElement("a-entity") as AElement;
    el.setAttribute("follow-in-fov", `target: #avatar-pov-node; offset: 0 0 -${PROMPT_DISTANCE}; angle: 0`);
    el.object3D.visible = false;
    el.object3D.add(mesh);
    scene.appendChild(el);

    this.el = el;
    this.canvas = canvas;
    this.texture = texture;
    return el;
  }

  private setText(text: string) {
    if (text === this.text || !this.canvas || !this.texture) return;
    this.text = text;
    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = "rgba(0, 0, 0, 0.75)";
    const radius = CANVAS_HEIGHT / 4;
    context.beginPath();
    context.moveTo(radius, 0);
    context.arcTo(CANVAS_WIDTH, 0, CANVAS_WIDTH, CANVAS_HEIGHT, radius);
    context.arcTo(CANVAS_WIDTH, CANVAS_HEIGHT, 0, CANVAS_HEIGHT, radius);
    context.arcTo(0, CANVAS_HEIGHT, 0, 0, radius);
    context.arcTo(0, 0, CANVAS_WIDTH, 0, radius);
    context.closePath();
    context.fill();
    // One line, made smaller when it would not fit
    let fontSize = FONT_SIZE;
    context.font = `bold ${fontSize}px sans-serif`;
    const width = context.measureText(text).width;
    const room = CANVAS_WIDTH - 2 * TEXT_MARGIN;
    if (width > room) {
      fontSize = Math.floor((fontSize * room) / width);
      context.font = `bold ${fontSize}px sans-serif`;
    }
    context.fillStyle = "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    this.texture.needsUpdate = true;
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
