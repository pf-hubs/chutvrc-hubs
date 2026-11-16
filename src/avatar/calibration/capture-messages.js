import { defineMessages } from "react-intl";

/**
 * The prompt shown in front of the player while the headset's height is captured in VR (vr-capture.ts), and
 * the button in the in-world menu that starts a new capture (components/body-capture-button.js).
 * Kept in a JavaScript file so the message extraction, which reads the .js sources, finds them.
 */
export const captureMessages = defineMessages({
  standing: {
    id: "body-calibration-capture.standing",
    defaultMessage: "Stand upright and look straight ahead"
  },
  sitting: {
    id: "body-calibration-capture.sitting",
    defaultMessage: "Sit upright and look straight ahead"
  },
  again: {
    id: "body-calibration-capture.again",
    defaultMessage: "Capture height again"
  }
});
