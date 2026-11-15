/** The body's heading, which trails the head's: a yaw in root space, where zero faces -z like the camera */
export type BodyYawState = { yaw: number; initialized: boolean };

/** How far the head may turn from the body before the body follows */
export const BODY_YAW_DEAD_BAND = (20 * Math.PI) / 180;
/** The time the body takes to close most of the gap once it follows, in seconds */
export const BODY_YAW_TIME_CONSTANT = 0.2;

export function createBodyYawState(): BodyYawState {
  return { yaw: 0, initialized: false };
}

/** The angle brought into (-pi, pi] */
export function wrapAngle(angle: number): number {
  let wrapped = angle % (2 * Math.PI);
  if (wrapped > Math.PI) wrapped -= 2 * Math.PI;
  else if (wrapped <= -Math.PI) wrapped += 2 * Math.PI;
  return wrapped;
}

/**
 * Turns the body toward the head's yaw: not at all while the head is within the dead band, and otherwise
 * just far enough to bring the head back to its edge, approached with a damping that depends on the time
 * passed rather than on the frame count. The first call snaps the body to the head. Returns the new yaw.
 */
export function updateBodyYaw(state: BodyYawState, headYaw: number, deltaSeconds: number): number {
  if (!state.initialized) {
    state.yaw = wrapAngle(headYaw);
    state.initialized = true;
    return state.yaw;
  }
  const gap = wrapAngle(headYaw - state.yaw);
  if (Math.abs(gap) > BODY_YAW_DEAD_BAND) {
    const step = gap - Math.sign(gap) * BODY_YAW_DEAD_BAND;
    const blend = 1 - Math.exp(-deltaSeconds / BODY_YAW_TIME_CONSTANT);
    state.yaw = wrapAngle(state.yaw + step * blend);
  }
  return state.yaw;
}
