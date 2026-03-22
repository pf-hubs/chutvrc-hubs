// @ts-nocheck

import { fetchReticulumAuthenticated } from "./phoenix-utils";
import { proxiedUrlFor } from "./media-url-utils";
import avatarUnavailableImage from "../assets/images/avatar_unavailable.png";
import { Object3D } from "three";

const AVATARS_API = "/api/v1/avatars";

export const AVATAR_TYPES = {
  SKINNABLE: "skinnable",
  URL: "url"
};

export function getAvatarType(avatarId) {
  if (avatarId.startsWith("http")) return AVATAR_TYPES.URL;
  return AVATAR_TYPES.SKINNABLE;
}

async function fetchSkinnableAvatar(avatarId) {
  const resp = await fetchReticulumAuthenticated(`/api/v1/avatars/${avatarId}`);
  return resp && resp.avatars && resp.avatars[0];
}

export async function fetchAvatar(avatarId) {
  switch (getAvatarType(avatarId)) {
    case AVATAR_TYPES.SKINNABLE:
      return fetchSkinnableAvatar(avatarId);
    case AVATAR_TYPES.URL:
      return {
        avatar_id: avatarId,
        gltf_url: proxiedUrlFor(avatarId)
      };
  }
}

async function fetchAvatarGltfUrl(avatarId) {
  return fetchAvatar(avatarId).then(avatar => avatar && avatar.gltf_url);
}

export async function getAvatarSrc(avatarId) {
  switch (getAvatarType(avatarId)) {
    case AVATAR_TYPES.SKINNABLE:
      return fetchAvatarGltfUrl(avatarId);
    case AVATAR_TYPES.URL:
      return proxiedUrlFor(avatarId);
    default:
      return avatarId;
  }
}

export async function getAvatarThumbnailUrl(avatarId) {
  switch (getAvatarType(avatarId)) {
    case AVATAR_TYPES.SKINNABLE:
      return fetchAvatar(avatarId).then(avatar => avatar.files.thumbnail);
    default:
      return avatarUnavailableImage;
  }
}

// Currently the way we do material overrides is with a special named material.
// We want to migrate eventually to having a GLTF extension that specifies what
// materials can be overridden, but in the meantime we want to be able to support
// arbitrary models with some sort of functionality. This provides a fallback
export const MAT_NAME = "Bot_PBS";
export function ensureAvatarMaterial(gltf) {
  if (gltf.materials.find(m => m.name === MAT_NAME)) return gltf;

  function materialForMesh(mesh) {
    if (!mesh.primitives) return;
    const primitive = mesh.primitives.find(p => p.material !== undefined);
    return primitive && gltf.materials[primitive.material];
  }

  let nodes = gltf.scenes[gltf.scene].nodes.slice(0);
  while (nodes.length) {
    const node = gltf.nodes[nodes.shift()];
    const material = node.mesh !== undefined && materialForMesh(gltf.meshes[node.mesh]);
    if (material) {
      material.name = MAT_NAME;
      break;
    }
    if (node.children) nodes = nodes.concat(node.children);
  }

  return gltf;
}

export async function remixAvatar(parentId, name) {
  const avatar = {
    parent_avatar_listing_id: parentId,
    name: name,
    files: {}
  };

  return fetchReticulumAuthenticated(AVATARS_API, "POST", { avatar });
}

// ============= Avatar Transform Encoding/Decoding =============

/**
 * Decoded avatar transform with client ID
 */
export interface AvatarTransformDecoded {
  pos: { x: number; y: number; z: number };
  rot: { x: number; y: number; z: number };
  clientId: string;
}

/**
 * Encode avatar transform using Float32 (4 bytes per axis) for full precision
 * Format: [posX(4)] [posY(4)] [posZ(4)] [rotX(4)] [rotY(4)] [rotZ(4)] [clientId(n)]
 * Total: 24 + clientId.length bytes
 */
export function encodeAvatarTransform(avatarPartObj: Object3D, clientId: Uint8Array): Uint8Array {
  const buffer = new ArrayBuffer(24 + clientId.length);
  const view = new DataView(buffer);
  const result = new Uint8Array(buffer);

  // Position (3 x Float32 = 12 bytes)
  view.setFloat32(0, avatarPartObj.position.x, true);
  view.setFloat32(4, avatarPartObj.position.y, true);
  view.setFloat32(8, avatarPartObj.position.z, true);

  // Rotation (3 x Float32 = 12 bytes)
  view.setFloat32(12, avatarPartObj.rotation.x, true);
  view.setFloat32(16, avatarPartObj.rotation.y, true);
  view.setFloat32(20, avatarPartObj.rotation.z, true);

  // Client ID
  result.set(clientId, 24);

  return result;
}

/**
 * Decode position from encoded transform
 */
export function decodePosition(encodedTransform: Uint8Array) {
  const view = new DataView(encodedTransform.buffer as ArrayBuffer, encodedTransform.byteOffset);
  return {
    x: Math.round(view.getFloat32(0, true) * 1000) / 1000,
    y: Math.round(view.getFloat32(4, true) * 1000) / 1000,
    z: Math.round(view.getFloat32(8, true) * 1000) / 1000
  };
}

/**
 * Decode rotation from encoded transform
 */
export function decodeRotation(encodedTransform: Uint8Array) {
  const view = new DataView(encodedTransform.buffer as ArrayBuffer, encodedTransform.byteOffset);
  return {
    x: Math.round(view.getFloat32(12, true) * 1000) / 1000,
    y: Math.round(view.getFloat32(16, true) * 1000) / 1000,
    z: Math.round(view.getFloat32(20, true) * 1000) / 1000
  };
}

/**
 * Decode avatar transform with client ID
 */
export function decodeAvatarTransform(data: Uint8Array): AvatarTransformDecoded | null {
  if (data.length < 24) {
    console.warn("Avatar transform data too short");
    return null;
  }

  const view = new DataView(data.buffer as ArrayBuffer, data.byteOffset);
  return {
    pos: {
      x: Math.round(view.getFloat32(0, true) * 1000) / 1000,
      y: Math.round(view.getFloat32(4, true) * 1000) / 1000,
      z: Math.round(view.getFloat32(8, true) * 1000) / 1000
    },
    rot: {
      x: Math.round(view.getFloat32(12, true) * 1000) / 1000,
      y: Math.round(view.getFloat32(16, true) * 1000) / 1000,
      z: Math.round(view.getFloat32(20, true) * 1000) / 1000
    },
    clientId: new TextDecoder().decode(data.subarray(24)).replace(/\u0000/g, "")
  };
}

/**
 * Decode and set avatar transform on an Object3D
 */
export function decodeAndSetAvatarTransform(encodedTransform: Uint8Array, avatarPartObj: Object3D): void {
  const view = new DataView(encodedTransform.buffer as ArrayBuffer, encodedTransform.byteOffset);
  avatarPartObj.position.set(
    view.getFloat32(0, true),
    view.getFloat32(4, true),
    view.getFloat32(8, true)
  );
  avatarPartObj.rotation.set(
    view.getFloat32(12, true),
    view.getFloat32(16, true),
    view.getFloat32(20, true),
    "YXZ"
  );
}
