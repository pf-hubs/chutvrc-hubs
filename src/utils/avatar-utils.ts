// @ts-nocheck

import { fetchReticulumAuthenticated } from "./phoenix-utils";
import { proxiedUrlFor } from "./media-url-utils";
import avatarUnavailableImage from "../assets/images/avatar_unavailable.png";
import { Object3D } from "three";
import { floatToUInt8, radToUInt8, uInt8ToFloat, uInt8ToRad } from "./uint8-parser";

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

export function getAvatarSrc(avatarId) {
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

export function encodeAvatarTransform(avatarPartObj: Object3D, clientId: Uint8Array) {
  return [
    ...floatToUInt8(avatarPartObj.position.x),
    ...floatToUInt8(avatarPartObj.position.y),
    ...floatToUInt8(avatarPartObj.position.z),
    radToUInt8(avatarPartObj.rotation.x),
    radToUInt8(avatarPartObj.rotation.y),
    radToUInt8(avatarPartObj.rotation.z),
    ...clientId
  ];
}

export function decodeAndSetAvatarTransform(encodedTransform: Uint8Array, avatarPartObj: Object3D): void {
  avatarPartObj.position.set(
    uInt8ToFloat(encodedTransform[0], encodedTransform[1]),
    uInt8ToFloat(encodedTransform[2], encodedTransform[3]),
    uInt8ToFloat(encodedTransform[4], encodedTransform[5])
  );
  avatarPartObj.rotation.set(
    uInt8ToRad(encodedTransform[6]),
    uInt8ToRad(encodedTransform[7]),
    uInt8ToRad(encodedTransform[8]),
    "YXZ"
  );
}

export function decodePosition(encodedTransform: Uint8Array) {
  return {
    x: uInt8ToFloat(encodedTransform[0], encodedTransform[1]),
    y: uInt8ToFloat(encodedTransform[2], encodedTransform[3]),
    z: uInt8ToFloat(encodedTransform[4], encodedTransform[5])
  };
}

export function decodeRotation(encodedTransform: Uint8Array) {
  return {
    x: uInt8ToRad(encodedTransform[7]),
    y: uInt8ToRad(encodedTransform[6]),
    z: uInt8ToRad(encodedTransform[8])
  };
}
