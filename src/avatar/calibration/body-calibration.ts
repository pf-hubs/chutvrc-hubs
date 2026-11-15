/**
 * The body calibration: what a player enters before the first VR entry with the new body solver (how they
 * play, how tall they are, and how a difference in height between them and their avatar is resolved) and
 * what follows from it for the rig, the drawn model and what is announced to the others. Pure: no scene
 * access, no store access.
 *
 * Units. Heights are in metres unless their name says centimetres. Two kinds of metre meet here:
 *
 * - real metres are the player's physical world, as the headset reports it in the XR reference space;
 * - room metres are the virtual room's, in which the avatar rig and the models are placed.
 *
 * The two are the same until the avatar rig is scaled: with a rig scale s, one real metre is s room
 * metres, so a player whose eyes are P real metres over the floor sees the room from P * s room metres.
 * A model's own sizes, such as its eye height, are room metres at the model's own scale.
 */

/** How the player plays: standing, or seated while the avatar stands */
export type BodyPosture = "standing" | "sitting";

/**
 * How a difference in height between the player and the avatar's model is resolved: the model is drawn
 * at the player's size, or the player sees and moves at the model's size
 */
export type BodyFit = "avatarToPlayer" | "playerToAvatar";

/** The range of heights the form accepts, in centimetres */
export const MIN_BODY_HEIGHT_CM = 50;
export const MAX_BODY_HEIGHT_CM = 250;
/** The stored height of a player who has not calibrated, in centimetres */
export const UNCALIBRATED_BODY_HEIGHT_CM = 0;
export const DEFAULT_BODY_POSTURE: BodyPosture = "standing";
export const DEFAULT_BODY_FIT: BodyFit = "avatarToPlayer";

/** A standing person's eyes are at this share of their height */
export const EYE_HEIGHT_SHARE = 0.936;
/**
 * A captured standing headset height that differs from the eye height the entered height gives by more
 * than this, in real metres, is flagged so the player can be told to check the height
 */
export const HEIGHT_MISMATCH_LIMIT = 0.15;
/** The limits of the drawn model's size over its own size when the model is fitted to the player */
export const MIN_MODEL_RATIO = 0.3;
export const MAX_MODEL_RATIO = 2.0;

export type BodyCalibrationInput = {
  /**
   * The height the player entered, in centimetres. A height outside 50 to 250 is brought into that range,
   * and one that is not a finite number is taken as 50; callers pass a height isCalibratedHeight accepts.
   */
  heightCm: number;
  posture: BodyPosture;
  fit: BodyFit;
  /**
   * The headset's height over the floor while the player stood upright (standing) or sat upright
   * (sitting) and looked straight ahead, in real metres; null when nothing was captured. A value that is
   * not a positive number counts as nothing captured.
   */
  capturedHeadHeight: number | null;
  /**
   * The eye height of the avatar's model in its rest pose at its own size, in room metres. A value that
   * is not a positive number counts as unknown: neither the model nor the rig is scaled then.
   */
  modelEyeHeight: number;
};

export type BodyCalibration = {
  /** The player's standing eye height, in real metres */
  playerEyeHeight: number;
  /**
   * What is added to the tracked heights of the headset and both controllers, in real metres, so that a
   * seated player sees and reaches from their standing eye height: 0 standing, and 0 sitting without a
   * capture; negative when a seated capture is higher than the standing eye height
   */
  trackingOffsetY: number;
  /** The uniform scale of the avatar rig, room metres per real metre: 1 unless the player is fitted to the avatar */
  rigScale: number;
  /** The drawn model's size over its own size: 1 unless the avatar is fitted to the player */
  modelRatio: number;
  /**
   * The standing eye height announced to the others, in room metres: the player's for "avatarToPlayer",
   * the model's for "playerToAvatar", and the player's in either fit while the model's is unknown
   */
  announcedEyeHeight: number;
  /**
   * Whether a captured standing headset height differs from the eye height of the entered height by more
   * than HEIGHT_MISMATCH_LIMIT; always false sitting or without a capture
   */
  heightMismatch: boolean;
};

/** Whether a stored height is one the player entered: a number from 50 to 250 cm; 0 means not calibrated */
export function isCalibratedHeight(heightCm: unknown): heightCm is number {
  return typeof heightCm === "number" && heightCm >= MIN_BODY_HEIGHT_CM && heightCm <= MAX_BODY_HEIGHT_CM;
}

/** A stored posture, or the default for a value that is not one */
export function parseBodyPosture(value: unknown): BodyPosture {
  return value === "standing" || value === "sitting" ? value : DEFAULT_BODY_POSTURE;
}

/** A stored fit, or the default for a value that is not one */
export function parseBodyFit(value: unknown): BodyFit {
  return value === "avatarToPlayer" || value === "playerToAvatar" ? value : DEFAULT_BODY_FIT;
}

/** The standing eye height of a person of the given height, in metres */
export function standingEyeHeightOf(heightCm: number): number {
  return (heightCm / 100) * EYE_HEIGHT_SHARE;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isPositive(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * The size a model is drawn at, over its own size, so that its eyes stand at the given standing eye
 * height: that height over the model's eye height, within 0.3 to 2.0; 1 when either height is not a
 * positive number. Both heights are in the same units.
 */
export function modelRatioOf(eyeHeight: number, modelEyeHeight: number): number {
  if (!isPositive(eyeHeight) || !isPositive(modelEyeHeight)) return 1;
  return clamp(eyeHeight / modelEyeHeight, MIN_MODEL_RATIO, MAX_MODEL_RATIO);
}

/**
 * Derives everything the rig, the solvers and the announcement need from the entered values, a capture of
 * the headset's height and the model's eye height.
 *
 * Standing, the player's standing eye height P is the captured headset height, and the entered height
 * only stands in for it without a capture; a capture far from the entered height is flagged. Sitting, P
 * comes from the entered height, and the tracking offset lifts the seated capture to it.
 *
 * "avatarToPlayer" draws the model at P over its eye height (within 0.3 to 2.0), leaves the rig at scale
 * 1 and announces P. "playerToAvatar" draws the model at its own size and scales the rig by the model's
 * eye height over P, so the player's eyes stand at the model's, and announces the model's eye height.
 */
export function deriveBodyCalibration(input: BodyCalibrationInput): BodyCalibration {
  const heightCm = clamp(
    Number.isFinite(input.heightCm) ? input.heightCm : MIN_BODY_HEIGHT_CM,
    MIN_BODY_HEIGHT_CM,
    MAX_BODY_HEIGHT_CM
  );
  const enteredEyeHeight = standingEyeHeightOf(heightCm);
  const captured = isPositive(input.capturedHeadHeight) ? input.capturedHeadHeight : null;
  const sitting = parseBodyPosture(input.posture) === "sitting";

  let playerEyeHeight: number;
  let trackingOffsetY = 0;
  let heightMismatch = false;
  if (sitting) {
    playerEyeHeight = enteredEyeHeight;
    if (captured !== null) trackingOffsetY = playerEyeHeight - captured;
  } else if (captured !== null) {
    playerEyeHeight = captured;
    heightMismatch = Math.abs(captured - enteredEyeHeight) > HEIGHT_MISMATCH_LIMIT;
  } else {
    playerEyeHeight = enteredEyeHeight;
  }

  const modelEyeHeight = input.modelEyeHeight;
  let rigScale = 1;
  let modelRatio = 1;
  let announcedEyeHeight = playerEyeHeight;
  if (isPositive(modelEyeHeight)) {
    if (parseBodyFit(input.fit) === "playerToAvatar") {
      rigScale = modelEyeHeight / playerEyeHeight;
      announcedEyeHeight = modelEyeHeight;
    } else {
      modelRatio = modelRatioOf(playerEyeHeight, modelEyeHeight);
    }
  }

  return { playerEyeHeight, trackingOffsetY, rigScale, modelRatio, announcedEyeHeight, heightMismatch };
}
