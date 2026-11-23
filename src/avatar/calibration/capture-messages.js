import { defineMessages } from "react-intl";

/**
 * The lines of the prompt shown in front of the player while the headset's height is captured in VR
 * (vr-capture.ts: a line for the posture, then one for what to do, and the height once it is taken), and
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
  pressTriggers: {
    id: "body-calibration-capture.press-triggers",
    defaultMessage: "then press both triggers"
  },
  levelHead: {
    id: "body-calibration-capture.level-head",
    defaultMessage: "Keep your head level and look straight ahead"
  },
  pressTriggersAgain: {
    id: "body-calibration-capture.press-triggers-again",
    defaultMessage: "then press both triggers again"
  },
  holdStill: {
    id: "body-calibration-capture.hold-still",
    defaultMessage: "Hold still: {seconds}"
  },
  captured: {
    id: "body-calibration-capture.captured",
    defaultMessage: "Height set: {height} m"
  },
  again: {
    id: "body-calibration-capture.again",
    defaultMessage: "Capture height again"
  }
});
