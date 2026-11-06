/**
 * How much taller the user is than the model: the headset's height over the floor when the avatar was
 * first seen in VR, divided by the model's eye height in its rest pose. Null until calibrated.
 */
export type Calibration = { heightScale: number | null };

/** A headset lower than this is not on a standing or sitting head: a tracking gap or a pose not yet received */
export const MIN_PLAUSIBLE_HEAD_HEIGHT = 0.5;

export function createCalibration(): Calibration {
  return { heightScale: null };
}

/**
 * Takes the ratio once, from the first plausible headset height. Returns whether the calibration is set
 * after the call.
 */
export function calibrateHeight(calibration: Calibration, headsetHeight: number, rigEyeHeight: number): boolean {
  if (calibration.heightScale !== null) return true;
  if (!(headsetHeight > MIN_PLAUSIBLE_HEAD_HEIGHT) || !(rigEyeHeight > MIN_PLAUSIBLE_HEAD_HEIGHT)) return false;
  calibration.heightScale = headsetHeight / rigEyeHeight;
  return true;
}

/** Forgets the ratio, so the next frame in VR takes it again */
export function recalibrate(calibration: Calibration) {
  calibration.heightScale = null;
}

/**
 * A tracked height brought into the model's proportions: at the calibrated height the model's eyes sit at
 * their rest height, so a standing user stands the model on its feet, and a crouch lowers it in proportion.
 * Before calibration the height is used as it is.
 */
export function scaleHeight(calibration: Calibration, height: number): number {
  return calibration.heightScale === null ? height : height / calibration.heightScale;
}
