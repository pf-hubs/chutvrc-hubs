import { addComponent, addEntity, removeEntity } from "bitecs";
import { Material, Mesh, Object3D, SkinnedMesh, Texture } from "three";
import { HubsWorld } from "../app";
import { AvatarComponent, BoneComponent } from "../bit-components";
import { loadModel } from "../components/gltf-model-plus";
import { AvatarIkManager } from "./ik/avatar-ik-manager";
import { getAvatarSrc } from "../utils/avatar-utils";
import { addObject3DComponent } from "../utils/jsx-entity";
import { forEachMaterial } from "../utils/material-utils";
import { npcClientId } from "./pose/npc-pose-source";
import { PoseStore } from "./pose/pose-store";
import { BODY_BONE_NAMES, BONE_NAMES } from "./rig/bone-names";
import { buildRigDescription, RigDescription } from "./rig/rig-description";

const FALLBACK_AVATAR_ID = "default-avatar";

/**
 * Creates the entities of a model whose rig is described: one entity per body bone the model has, with
 * the bone's object and a bone component, and the avatar entity whose component names them, and sets up
 * the model's inverse kinematics manager. With `showsPose` the avatar entity is bound to the client's pose,
 * or without a client id to a synthetic one that the chatbot writes, and the solver moves it every frame;
 * a session whose avatars are not shown leaves it unbound. Returns null when the model has no known bone.
 */
export function createAvatarEntities(
  world: HubsWorld,
  poses: PoseStore,
  model: Object3D,
  rig: RigDescription,
  clientId?: string,
  showsPose = true
): number | null {
  const boneEids = new Map<string, number>();
  for (const name of BODY_BONE_NAMES) {
    const bone = rig.bones[name];
    if (!bone) continue;
    const eid = addEntity(world);
    addObject3DComponent(world, eid, bone);
    addComponent(world, BoneComponent, eid);
    boneEids.set(name, eid);
  }
  if (boneEids.size === 0) return null;

  const avatarEid = addEntity(world);
  addComponent(world, AvatarComponent, avatarEid);
  // A bone the model does not have is stored as 0, the reserved entity
  for (const name of BODY_BONE_NAMES) AvatarComponent[name][avatarEid] = boneEids.get(name) || 0;

  const isNPC = !clientId;
  if (clientId) addObject3DComponent(world, avatarEid, model);
  if (showsPose) {
    const poseClientId = clientId || npcClientId(avatarEid);
    poses.getOrCreate(poseClientId, isNPC);
    poses.bindEntity(avatarEid, poseClientId);
  }
  world.eid2Ik.set(avatarEid, new AvatarIkManager(rig));
  return avatarEid;
}

/**
 * Removes the avatar's model from the scene, its bone and avatar entities, its inverse kinematics manager
 * and its binding to a pose. The pose itself stays: the client may get a new avatar. The model's resources
 * are not freed here; the manager frees the ones it loaded.
 */
function removeAvatarEntities(world: HubsWorld, poses: PoseStore, avatarEid: number | undefined) {
  if (!avatarEid) return;
  const model = world.eid2obj.get(avatarEid);
  if (model) world.scene.remove(model);

  for (const name of BODY_BONE_NAMES) {
    const boneEid = AvatarComponent[name][avatarEid];
    // A bone the model does not have is stored as 0, which is the reserved entity 0 and must stay
    if (boneEid) removeEntity(world, boneEid);
  }
  removeEntity(world, avatarEid);
  world.eid2Ik.delete(avatarEid);
  poses.unbindEntity(avatarEid);
}

/** Frees the material and every texture in any of its slots, whichever material type it is */
function disposeMaterialWithTextures(material: Material) {
  for (const value of Object.values(material)) {
    if ((value as Texture)?.isTexture) (value as Texture).dispose();
  }
  material.dispose();
}

/**
 * Frees the GPU resources of a model loaded for one avatar: every geometry, every material with its
 * textures, and the bone texture of every skeleton. Avatar models are loaded without the model cache,
 * each by its own loader, so nothing in them is shared with another model.
 */
function disposeModel(model: Object3D) {
  model.traverse(object => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    forEachMaterial(mesh, disposeMaterialWithTextures);
    if ((mesh as SkinnedMesh).isSkinnedMesh) (mesh as SkinnedMesh).skeleton.dispose();
  });
}

/**
 * Loads, replaces and removes the avatar models of the clients of one media session, and owns the
 * entities, the solver and the pose binding of each model it loaded. A model that fails to load is
 * replaced by the default avatar.
 */
export class AvatarModelManager {
  /** The avatar entity that shows each client, while the client has one */
  readonly avatarEidByClientId = new Map<string, number>();
  private readonly avatarIdByClientId = new Map<string, string>();
  /** The clients whose avatar is being loaded, so one client is never loaded twice at once */
  private readonly loadingClientIds = new Set<string>();
  /** The load in flight for each client; one that is no longer here when it ends was discarded */
  private readonly loadByClientId = new Map<string, object>();
  /** The models this manager loaded, by avatar entity, so their resources are freed with the entity */
  private readonly loadedModelByEid = new Map<number, Object3D>();

  /**
   * `showsPose` is asked, when a model has loaded, whether this session's avatars are solved and shown; a
   * public speaking session loads the same models but never shows them.
   */
  constructor(
    private readonly world: HubsWorld,
    private readonly poses: PoseStore,
    private readonly showsPose: () => boolean = () => true
  ) {}

  /** Every client that has an avatar or an avatar id here */
  clientIds(): Set<string> {
    return new Set<string>([...this.avatarIdByClientId.keys(), ...this.avatarEidByClientId.keys()]);
  }

  /** The id of the avatar the client was last loaded with, if any */
  avatarIdOf(clientId: string): string | undefined {
    return this.avatarIdByClientId.get(clientId);
  }

  isLoading(clientId: string): boolean {
    return this.loadingClientIds.has(clientId);
  }

  /** Loads the client's avatar unless it already shows this one or a load for the client is in flight */
  async replaceAvatarModel(avatarId: string, clientId: string): Promise<void> {
    if (avatarId === this.avatarIdByClientId.get(clientId)) return;
    if (this.loadingClientIds.has(clientId)) return;
    this.loadingClientIds.add(clientId);
    const load = {};
    this.loadByClientId.set(clientId, load);
    const isCurrent = () => this.loadByClientId.get(clientId) === load;

    // The old avatar goes first; the client's pose stays and the new entity is bound to it
    this.removeAvatar(this.avatarEidByClientId.get(clientId));
    this.avatarEidByClientId.delete(clientId);

    try {
      await this.loadAvatarModel(avatarId, clientId, isCurrent);
      if (isCurrent()) this.avatarIdByClientId.set(clientId, avatarId);
    } catch (error) {
      if (isCurrent()) {
        console.error(`Failed to load avatar ${avatarId} for client ${clientId}:`, error);
        await this.loadFallbackAvatar(clientId, isCurrent);
      }
    } finally {
      if (isCurrent()) {
        this.loadingClientIds.delete(clientId);
        this.loadByClientId.delete(clientId);
      }
    }
  }

  /** Removes the client's avatar and forgets the client; a load for it still in flight is discarded when it ends */
  removeClientAvatar(clientId: string) {
    this.removeAvatar(this.avatarEidByClientId.get(clientId));
    this.avatarIdByClientId.delete(clientId);
    this.avatarEidByClientId.delete(clientId);
    this.loadingClientIds.delete(clientId);
    this.loadByClientId.delete(clientId);
  }

  /** Removes the avatar entity with its model and frees the model's resources */
  private removeAvatar(avatarEid: number | undefined) {
    if (!avatarEid) return;
    removeAvatarEntities(this.world, this.poses, avatarEid);
    const model = this.loadedModelByEid.get(avatarEid);
    if (model) {
      disposeModel(model);
      this.loadedModelByEid.delete(avatarEid);
    }
  }

  /**
   * Loads the model, describes its rig, creates its entities and shows it; false when it has no known bone,
   * or when the load is no longer current (the client was removed meanwhile) and the model is dropped
   */
  private async loadAvatarModel(avatarId: string, clientId: string, isCurrent: () => boolean): Promise<boolean> {
    const avatarSrc = await getAvatarSrc(avatarId);
    const gltf = await loadModel(avatarSrc);
    const model: Object3D = gltf.scene;
    if (!isCurrent()) {
      disposeModel(model);
      return false;
    }
    model.traverse(object => {
      object.frustumCulled = false;
    });
    const rig = buildRigDescription(model, gltf);
    const missingBones = BONE_NAMES.filter(name => !rig.bones[name]);
    console.log(
      `Avatar of ${clientId} mapped from ${rig.source}` +
        (missingBones.length > 0 ? `, without ${missingBones.join(", ")}` : "")
    );

    const avatarEid = createAvatarEntities(this.world, this.poses, model, rig, clientId, this.showsPose());
    if (avatarEid === null) {
      disposeModel(model);
      return false;
    }
    this.avatarEidByClientId.set(clientId, avatarEid);
    this.loadedModelByEid.set(avatarEid, model);
    this.world.scene.add(model);
    return true;
  }

  private async loadFallbackAvatar(clientId: string, isCurrent: () => boolean): Promise<void> {
    console.warn(`Loading fallback avatar for client ${clientId}`);
    try {
      await this.loadAvatarModel(FALLBACK_AVATAR_ID, clientId, isCurrent);
      if (isCurrent()) this.avatarIdByClientId.set(clientId, FALLBACK_AVATAR_ID);
    } catch (fallbackError) {
      console.error(`Failed to load fallback avatar for ${clientId}:`, fallbackError);
    }
  }
}
