import { hasComponent } from "bitecs";
import { HoveredRemoteLeft, HoveredRemoteRight } from "../bit-components";
import { bodyCalibration } from "../avatar/calibration/apply-calibration";
import { captureMessages } from "../avatar/calibration/capture-messages";
import { formatCalibrationMessage, TextPanel } from "../avatar/calibration/text-panel";

const BUTTON_SIZE = {
  width: 0.4,
  height: 0.07,
  canvasWidth: 640,
  canvasHeight: 112,
  fontSize: 48,
  textMargin: 32
};
const BACKGROUND = "rgba(0, 0, 0, 0.75)";
const HOVER_BACKGROUND = "rgba(255, 52, 116, 0.9)";

/**
 * The "capture my height again" button in the in-world menu (the HUD under the player's view in VR): it
 * starts a new capture of the headset's height for the body calibration (avatar/calibration/vr-capture.ts),
 * for a player who stood or sat badly when they entered. Shown only while a capture can be taken (in VR,
 * with the new solver on and a height saved) and none is under way; the 2D Preferences screen, where the
 * same request lives, cannot be opened in VR. The label is drawn in the page's language (text-panel.ts).
 * @namespace ui
 * @component body-capture-button
 */
AFRAME.registerComponent("body-capture-button", {
  init() {
    this.panel = new TextPanel(BUTTON_SIZE);
    this.el.setObject3D("mesh", this.panel.mesh);
    this.el.object3D.visible = false;
    this.onInteract = () => {
      bodyCalibration.requestCapture();
    };
  },

  play() {
    this.el.object3D.addEventListener("interact", this.onInteract);
  },

  pause() {
    this.el.object3D.removeEventListener("interact", this.onInteract);
  },

  tick() {
    const shown = bodyCalibration.canCapture && !bodyCalibration.isCapturing;
    if (this.el.object3D.visible !== shown) {
      this.el.object3D.visible = shown;
      this.el.object3D.matrixNeedsUpdate = true;
    }
    if (!shown) return;
    const eid = this.el.object3D.eid;
    const hovered =
      eid !== undefined &&
      (hasComponent(APP.world, HoveredRemoteRight, eid) || hasComponent(APP.world, HoveredRemoteLeft, eid));
    this.panel.draw(formatCalibrationMessage(captureMessages.again), hovered ? HOVER_BACKGROUND : BACKGROUND);
  }
});
