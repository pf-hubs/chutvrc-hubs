/**
 * Pose codec v0: the wire format of the avatar transform channels (#avatar-RIG, #avatar-HEAD,
 * #avatar-LEFT, #avatar-RIGHT). One packet carries one body part of one client, and the body part
 * is given by the channel label, not by the packet:
 *
 *   bytes  0.. 3  position x   Float32, little-endian
 *   bytes  4.. 7  position y
 *   bytes  8..11  position z
 *   bytes 12..15  rotation x   Euler angle in radians, Float32, little-endian
 *   bytes 16..19  rotation y
 *   bytes 20..23  rotation z
 *   bytes 24..    the sender's client id, UTF-8, up to the end of the packet
 *
 * Neither direction allocates per call: the six floats pass through one module-level scratch view,
 * and the client id is cut out with subarray and decoded by one shared TextDecoder.
 */

type Vec3 = { x: number; y: number; z: number };

/** Number of bytes of the six Float32 values; the client id starts right after them */
export const POSE_BYTES = 24;

const scratch = new ArrayBuffer(POSE_BYTES);
const scratchView = new DataView(scratch);
const scratchBytes = new Uint8Array(scratch);
const textDecoder = new TextDecoder();
/** The zero bytes that may pad the client id at the end of a packet */
const NUL_PADDING = /\u0000/g;

/**
 * Writes the pose of one part followed by the encoded client id into `out`, which the caller sizes
 * once as `POSE_BYTES + encodedClientId.length`, and returns the number of bytes written.
 */
export function encodePart(pos: Vec3, rot: Vec3, encodedClientId: Uint8Array, out: Uint8Array): number {
  scratchView.setFloat32(0, pos.x, true);
  scratchView.setFloat32(4, pos.y, true);
  scratchView.setFloat32(8, pos.z, true);
  scratchView.setFloat32(12, rot.x, true);
  scratchView.setFloat32(16, rot.y, true);
  scratchView.setFloat32(20, rot.z, true);
  out.set(scratchBytes, 0);
  out.set(encodedClientId, POSE_BYTES);
  return POSE_BYTES + encodedClientId.length;
}

/**
 * Reads the pose of one part into `outPos` and `outRot`, each value rounded to three decimals,
 * and returns the sender's client id with any NUL padding removed.
 */
export function decodePart(bytes: Uint8Array, outPos: Vec3, outRot: Vec3): string {
  if (bytes.length < POSE_BYTES) {
    throw new RangeError(`Pose packet of ${bytes.length} bytes is shorter than ${POSE_BYTES} bytes`);
  }
  for (let i = 0; i < POSE_BYTES; i++) {
    scratchBytes[i] = bytes[i];
  }
  outPos.x = Math.round(scratchView.getFloat32(0, true) * 1000) / 1000;
  outPos.y = Math.round(scratchView.getFloat32(4, true) * 1000) / 1000;
  outPos.z = Math.round(scratchView.getFloat32(8, true) * 1000) / 1000;
  outRot.x = Math.round(scratchView.getFloat32(12, true) * 1000) / 1000;
  outRot.y = Math.round(scratchView.getFloat32(16, true) * 1000) / 1000;
  outRot.z = Math.round(scratchView.getFloat32(20, true) * 1000) / 1000;
  return textDecoder.decode(bytes.subarray(POSE_BYTES)).replace(NUL_PADDING, "");
}
