import { AElement } from "aframe";
import { SfuAdapter } from "../sfu-adapters/sfu-adapter";
import { AvatarPart, AvatarTransformBuffer } from "./avatar-transform-buffer";
import { decodePosition, decodeRotation, getAvatarSrc } from "./avatar-utils";
import { createAvatarBoneEntities, removeAvatarEntityAndModel } from "../bit-systems/avatar-bones-system";
import { loadModel } from "../components/gltf-model-plus";
import { Object3D } from "three";
import { AvatarAnimState, isValidAvatarAnimState } from "../types/avatar-types";

type Vector3 = { x: number; y: number; z: number };
type Quaternion = { x: number; y: number; z: number };
type Transform = { pos: Vector3; rot: Quaternion };

/* Sync BitECS-managed avatars through WebRTC DataChannel */
export class AvatarSyncHelper {
  private _selfAvatarTransformBuffer: AvatarTransformBuffer | undefined;
  private _client2AvatarAssetId: Map<string, string>;
  private _loadingAvatars: Set<string>; // Track clients with in-progress avatar loads
  _sfu: SfuAdapter;
  _client2AvatarEid: Map<string, number>;
  _client2VrMode: Map<string, boolean>;
  _client2AnimState: Map<string, AvatarAnimState>;
  _client2Transform: Map<AvatarPart, Map<string, Transform>>;
  _avatarEid2ClientId: Map<number, string>;
  _avatarPartsToSync: AvatarPart[];
  _channelsForSync: string[];
  _isStartSendingSelfAvatarTransform: boolean;
  _sendSelfAvatarTransformIntervalId: NodeJS.Timer | undefined;
  _setSelfIsVrFlagIntervalId: NodeJS.Timer | undefined;
  _sendSelfIsVrFlagIntervalId: NodeJS.Timer | undefined;
  _sendSelfAnimStateIntervalId: NodeJS.Timer | undefined;

  constructor(sfu: SfuAdapter) {
    this._sfu = sfu;
    this._client2AvatarAssetId = new Map<string, string>();
    this._loadingAvatars = new Set<string>();
    this._avatarEid2ClientId = new Map<number, string>();
    this._client2AvatarEid = new Map<string, number>();
    this._client2VrMode = new Map<string, boolean>();
    this._client2AnimState = new Map<string, AvatarAnimState>();
    this._client2Transform = new Map<AvatarPart, Map<string, Transform>>();
    this._avatarPartsToSync = [AvatarPart.RIG, AvatarPart.HEAD, AvatarPart.LEFT, AvatarPart.RIGHT];
    this._channelsForSync = ["#avatarId", "#isVR", "#avatarAnimState"].concat(
      this._avatarPartsToSync.map(part => "#avatar-" + AvatarPart[part])
    );
    this._avatarPartsToSync.forEach(part => {
      this._client2Transform.set(part, new Map<string, Transform>());
    });
    this._isStartSendingSelfAvatarTransform = false;
  }

  handleSyncInit(channel: string) {
    if (channel.includes("#avatar-")) {
      this.handleTransformSyncInit();
    } else if (channel === "#isVR") {
      this.handleVrModeSyncInit();
    } else if (channel === "#avatarAnimState") {
      this.handleAnimStateSyncInit();
    }
  }

  handleRecvMessage(channel: string, data: Uint8Array) {
    if (channel === "#avatarId") {
      let [clientId, avatarId] = new TextDecoder().decode(data).split("|");

      // Skip if this client's avatar is already being loaded (prevents race condition)
      if (this._loadingAvatars.has(clientId)) return;

      if (this._client2AvatarAssetId.has(clientId)) {
        // if avatar id of this client is already recorded
        if (this._client2AvatarAssetId.get(clientId) === avatarId) return; // if avatar is not changed, ignore it
      } else {
        // if avatar id of this client is not recorded, that means this client is new to this room, so send my avatar id & src to the client
        this.sendSelfAvatarSrc();
        // Also send my avatar transform to the new client without check if the transform is updated
        this.sendSelfAvatarTransform(false);
      }

      // if avatar id of this client is already recorded but with different avatar id (existing client but avatar changed),
      // or avatar id of this client is not recorded (new client to this room),
      // then load the client's avatar's model
      if (clientId !== this._sfu._clientId) {
        this.replaceAvatarModel(avatarId, clientId);
      }
    }

    if (channel === "#isVR") {
      let [clientId, isVR] = new TextDecoder().decode(data).split("|");
      this._client2VrMode.set(clientId, isVR === "1");
    }

    if (channel === "#avatarAnimState") {
      let [clientId, animStateStr] = new TextDecoder().decode(data).split("|");
      const animState = parseInt(animStateStr);
      if (isValidAvatarAnimState(animState)) {
        this.switchAnimState(clientId, animState);
      } else {
        console.warn(`Invalid avatar animation state received: ${animState}`);
      }
    }

    if (channel.includes("#avatar-")) {
      // receive other clients' avatar transform when updated
      // Client ID starts at byte 24 (after 24 bytes of Float32 position/rotation data)
      const clientId = new TextDecoder().decode(data.subarray(24)).replace(/\u0000/g, "");
      const avatarPart = channel.substring(8) as unknown as AvatarPart;
      this._client2Transform.get(avatarPart)?.set(clientId, {
        pos: decodePosition(data),
        rot: decodeRotation(data)
      });

      if (this._sfu._isRecording) {
        this._sfu._recordedDataChannelMessages.push({
          l: channel,
          m: { c: clientId, p: decodePosition(data), r: decodeRotation(data) },
          t: Date.now(),
          s: 0
        });
      }
    }
  }

  handleOnClientLeave(clientId: string) {
    removeAvatarEntityAndModel(APP.world, this._client2AvatarEid.get(clientId));
    this._client2AvatarAssetId.delete(clientId);
    this._client2AvatarEid.delete(clientId);
    this._loadingAvatars.delete(clientId);
    // Fix memory leaks: also cleanup VR mode, animation state, and transform maps
    this._client2VrMode.delete(clientId);
    this._client2AnimState.delete(clientId);
    this._avatarPartsToSync.forEach(part => {
      this._client2Transform.get(part)?.delete(clientId);
    });
  }

  initSelfAvatarTransform() {
    // get self avatar parts
    const rig = document.querySelector("#avatar-rig") as AElement;
    const head = document.querySelector("#avatar-pov-node") as AElement;
    const left = document.querySelector("#player-left-controller") as AElement;
    const right = document.querySelector("#player-right-controller") as AElement;

    if (rig && head && left && right) {
      this._selfAvatarTransformBuffer = new AvatarTransformBuffer(this._sfu._clientId, rig, head, left, right);
      setInterval(() => this.updateSelfAvatarTransform(), 15);
      return true;
    }

    return false;
  }

  updateSelfAvatarTransform() {
    const buffer = this._selfAvatarTransformBuffer;
    if (!buffer) return;
    this._avatarPartsToSync.forEach(part => {
      buffer.updateAvatarTransform(part);
      this._client2Transform
        .get(part)
        ?.set(this._sfu._clientId, buffer.getAvatarTransform(part));
    });
  }

  private async loadAvatarModel(avatarId: string, clientId: string): Promise<boolean> {
    const avatarSrc = await getAvatarSrc(avatarId);
    const gltf = await loadModel(avatarSrc);
    gltf.scene.traverse(function (object: Object3D) {
      object.frustumCulled = false;
    });
    if (createAvatarBoneEntities(gltf.scene, clientId, this._avatarEid2ClientId, this._client2AvatarEid)) {
      APP.world.scene.add(gltf.scene);
      return true;
    }
    return false;
  }

  private async loadFallbackAvatar(clientId: string): Promise<void> {
    const fallbackAvatarId = "default-avatar";
    console.warn(`Loading fallback avatar for client ${clientId}`);
    try {
      await this.loadAvatarModel(fallbackAvatarId, clientId);
      this._client2AvatarAssetId.set(clientId, fallbackAvatarId);
    } catch (fallbackError) {
      console.error(`Failed to load fallback avatar for ${clientId}:`, fallbackError);
    }
  }

  replaceAvatarModel = async (avatarId: string, clientId: string): Promise<void> => {
    if (avatarId === this._client2AvatarAssetId.get(clientId)) return;

    // Prevent duplicate loads - check if already loading
    if (this._loadingAvatars.has(clientId)) return;

    // Mark as loading immediately to prevent race conditions
    this._loadingAvatars.add(clientId);

    // Remove old avatar if exists
    if (this._client2AvatarEid.has(clientId)) {
      removeAvatarEntityAndModel(APP.world, this._client2AvatarEid.get(clientId));
    }

    try {
      await this.loadAvatarModel(avatarId, clientId);
      // Record the client's avatar ID on success
      this._client2AvatarAssetId.set(clientId, avatarId);
    } catch (error) {
      console.error(`Failed to load avatar ${avatarId} for client ${clientId}:`, error);
      await this.loadFallbackAvatar(clientId);
    } finally {
      // Always clear loading state
      this._loadingAvatars.delete(clientId);
    }
  };

  sendSelfAvatarSrc(avatarId?: string) {
    this._sfu.broadcast("#avatarId", this._sfu._clientId + "|" + (avatarId || window.APP.store.state.profile.avatarId));
    this.sendSelfAvatarTransform(false);
  }

  sendSelfAvatarTransform(checkUpdatedRequired: boolean) {
    const buffer = this._selfAvatarTransformBuffer;
    if (!buffer) return;
    this._avatarPartsToSync.forEach(part => {
      // RIG: always sync because rotation by pressing Q or E is only executed once, and sync can fail if there is loss in dataChannel:
      if (checkUpdatedRequired && part !== AvatarPart.RIG && !buffer.isUpdateAvatarTransformUpdated(part)) return;

      const arrToSend = buffer.getEncodedAvatarTransform(part);
      this._sfu.broadcastUint8("#avatar-" + AvatarPart[part], arrToSend);

      if (this._sfu._isRecording) {
        const transform = this._client2Transform.get(part)?.get(this._sfu._clientId);
        if (!transform) return;
        this._sfu._recordedDataChannelMessages.push({
          l: "#avatar-" + AvatarPart[part],
          m: {
            c: this._sfu._clientId,
            p: {
              x: Math.round(transform.pos.x * 1000) / 1000,
              y: Math.round(transform.pos.y * 1000) / 1000,
              z: Math.round(transform.pos.z * 1000) / 1000
            },
            r: {
              x: Math.round(transform.rot.x * 1000) / 1000,
              y: Math.round(transform.rot.y * 1000) / 1000,
              z: Math.round(transform.rot.z * 1000) / 1000
            }
          },
          t: Date.now(),
          s: 1
        });
      }
    });
  }

  private handleTransformSyncInit() {
    if (!this._selfAvatarTransformBuffer) {
      let getPlayerAvatarIntervalId: NodeJS.Timer;
      const getPlayerAvatar = () => {
        if (this._selfAvatarTransformBuffer) {
          clearInterval(getPlayerAvatarIntervalId);
          return;
        }
        if (this.initSelfAvatarTransform()) clearInterval(getPlayerAvatarIntervalId);
      };
      getPlayerAvatarIntervalId = setInterval(getPlayerAvatar, 1000);
    } else if (this._selfAvatarTransformBuffer && !this._isStartSendingSelfAvatarTransform) {
      this._isStartSendingSelfAvatarTransform = true;
      this._sendSelfAvatarTransformIntervalId = setInterval(() => this.sendSelfAvatarTransform(true), 15);
      return;
    }
  }

  private handleVrModeSyncInit() {
    this._setSelfIsVrFlagIntervalId = setInterval(() => this.setSelfIsVrFlag(), 1000);
    this._sendSelfIsVrFlagIntervalId = setInterval(() => this.sendSelfIsVrFlag(), 1000);
  }

  private handleAnimStateSyncInit() {
    this._sendSelfAnimStateIntervalId = setInterval(() => this.sendSelfAnimState(), 500);
  }

  private setSelfIsVrFlag() {
    this._client2VrMode.set(
      this._sfu._clientId,
      AFRAME.scenes[0]?.renderer
        ? AFRAME.scenes[0].renderer.xr.enabled && AFRAME.scenes[0].renderer.xr.isPresenting
        : false
    );
  }

  private sendSelfIsVrFlag() {
    this._sfu.broadcast(
      "#isVR",
      this._sfu._clientId +
        "|" +
        ((
          AFRAME.scenes[0]?.renderer
            ? AFRAME.scenes[0].renderer.xr.enabled && AFRAME.scenes[0].renderer.xr.isPresenting
            : false
        )
          ? "1"
          : "0")
    );
  }

  private sendSelfAnimState() {
    const animState = this._client2AnimState.get(this._sfu._clientId) ?? AvatarAnimState.STAND;
    this._sfu.broadcast("#avatarAnimState", this._sfu._clientId + "|" + animState);
  }

  private switchAnimState(clientId: string, state: AvatarAnimState) {
    this._client2AnimState.set(clientId, state);
  }

  switchSelfAnimState(state: AvatarAnimState) {
    this.switchAnimState(this._sfu._clientId, state);
  }

  stopSyncing() {
    if (this._sendSelfAvatarTransformIntervalId) clearInterval(this._sendSelfAvatarTransformIntervalId);
    if (this._setSelfIsVrFlagIntervalId) clearInterval(this._setSelfIsVrFlagIntervalId);
    if (this._sendSelfIsVrFlagIntervalId) clearInterval(this._sendSelfIsVrFlagIntervalId);
    if (this._sendSelfAnimStateIntervalId) clearInterval(this._sendSelfAnimStateIntervalId);
  }
}
