/**
 * Avatar animation state enum
 * Used throughout the avatar sync system to track animation state
 */
export enum AvatarAnimState {
  STAND = 0,
  WALK = 1,
  SIT = 2
}

/**
 * Check if a value is a valid AvatarAnimState
 */
export function isValidAvatarAnimState(value: number): value is AvatarAnimState {
  return value === AvatarAnimState.STAND ||
         value === AvatarAnimState.WALK ||
         value === AvatarAnimState.SIT;
}
