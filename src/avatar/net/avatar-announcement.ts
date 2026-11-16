/**
 * The message on the #avatarId channel: "clientId|avatarId", and from this build on an optional third
 * field, the sender's standing eye height in room metres with three decimals ("clientId|avatarId|1.598").
 * The eye height is there only while the sender wears a calibrated body with the new body solver; an
 * observer draws the sender's model at that height over the model's own eye height. Older builds split the
 * message and read the first two fields, so the third does not disturb them. Pure.
 */

/** Eye heights outside this range, in room metres, are not announced and are ignored when received */
export const MIN_ANNOUNCED_EYE_HEIGHT = 0.1;
export const MAX_ANNOUNCED_EYE_HEIGHT = 10;

export type AvatarAnnouncement = {
  clientId: string;
  avatarId: string;
  /** The announced standing eye height in room metres; undefined when absent, malformed or out of range */
  eyeHeight: number | undefined;
};

/** Whether an eye height can be announced: a number within MIN_ANNOUNCED_EYE_HEIGHT to MAX_ANNOUNCED_EYE_HEIGHT */
export function isAnnounceableEyeHeight(eyeHeight: unknown): eyeHeight is number {
  return (
    typeof eyeHeight === "number" &&
    Number.isFinite(eyeHeight) &&
    eyeHeight >= MIN_ANNOUNCED_EYE_HEIGHT &&
    eyeHeight <= MAX_ANNOUNCED_EYE_HEIGHT
  );
}

/** The announcement message; the eye height is left out when it is undefined or cannot be announced */
export function encodeAvatarAnnouncement(clientId: string, avatarId: string, eyeHeight?: number): string {
  const head = clientId + "|" + avatarId;
  return isAnnounceableEyeHeight(eyeHeight) ? head + "|" + eyeHeight.toFixed(3) : head;
}

/**
 * Reads an announcement. The client and avatar ids are the first two fields as they are (empty when
 * missing); the eye height is the third field when it is a plain decimal number within range, otherwise
 * undefined. Fields after the third, which a later build may add, are ignored.
 */
export function parseAvatarAnnouncement(message: string): AvatarAnnouncement {
  const [clientId = "", avatarId = "", eyeHeightField] = message.split("|");
  let eyeHeight: number | undefined;
  if (eyeHeightField !== undefined && /^\d+(\.\d+)?$/.test(eyeHeightField)) {
    const value = Number(eyeHeightField);
    if (isAnnounceableEyeHeight(value)) eyeHeight = value;
  }
  return { clientId, avatarId, eyeHeight };
}
