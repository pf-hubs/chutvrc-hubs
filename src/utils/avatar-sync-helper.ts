import { AElement } from "aframe";
import { SfuAdapter } from "../sfu-adapter";
import { AvatarPart, AvatarTransformBuffer } from "./avatar-transform-buffer";
import { decodePosition, decodeRotation, getAvatarSrc } from "./avatar-utils";
import { createAvatarBoneEntities, removeAvatarEntityAndModel } from "../bit-systems/avatar-bones-system";
import { loadModel } from "../components/gltf-model-plus";

type Vector3 = { x: number; y: number; z: number };
type Quaternion = { x: number; y: number; z: number };
type Transform = { pos: Vector3; rot: Quaternion };

/* Sync BitECS-managed avatars through WebRTC DataChannel */
export class AvatarSyncHelper {
  private _selfAvatarTransformBuffer: AvatarTransformBuffer;
  private _client2AvatarAssetId: Map<string, string>;
  _sfu: SfuAdapter;
  _client2AvatarEid: Map<string, number>;
  _client2VrMode: Map<string, boolean>;
  _client2Transform: Map<AvatarPart, Map<string, Transform>>;
  _avatarEid2ClientId: Map<number, string>;
  _avatarPartsToSync: AvatarPart[];
  _channelsForSync: string[];
  _isStartSendingSelfAvatarTransform: boolean;

  constructor(sfu: SfuAdapter) {
    this._sfu = sfu;
    this._client2AvatarAssetId = new Map<string, string>();
    this._avatarEid2ClientId = new Map<number, string>();
    this._client2AvatarEid = new Map<string, number>();
    this._client2VrMode = new Map<string, boolean>();
    this._client2Transform = new Map<AvatarPart, Map<string, Transform>>();
    this._avatarPartsToSync = [AvatarPart.RIG, AvatarPart.HEAD, AvatarPart.LEFT, AvatarPart.RIGHT];
    this._channelsForSync = ["#avatarId", "#isVR"].concat(
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
    }
  }

  handleRecvMessage(channel: string, data: Uint8Array) {
    if (channel === "#avatarId") {
      let [clientId, avatarId] = new TextDecoder().decode(data).split("|");

      if (this._client2AvatarAssetId.has(clientId)) {
        // if avatar id of this client is already recorded
        if (this._client2AvatarAssetId.get(clientId) === avatarId) return; // if avatar is not changed, ignore it
      } else {
        // if avatar id of this client is not recorded, that means this client is new to this room, so send my avatar id & src to the client
        this.sendSelfAvatarSrc(window.APP.store.state.profile.avatarId);
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

    if (channel.includes("#avatar-")) {
      // receive other clients' avatar transform when updated
      const clientId = new TextDecoder().decode(data.subarray(9));
      const avatarPart = channel.substring(8) as unknown as AvatarPart;

      this._client2Transform.get(avatarPart)?.set(clientId, {
        pos: decodePosition(data),
        rot: decodeRotation(data)
      });
    }
  }

  handleOnClientLeave(clientId: string) {
    removeAvatarEntityAndModel(APP.world, this._client2AvatarEid.get(clientId));
  }

  initSelfAvatarTransform() {
    // get self avatar parts
    const rig = document.querySelector("#avatar-rig") as AElement;
    const head = document.querySelector("#avatar-pov-node") as AElement;
    const left = document.querySelector("#player-left-controller") as AElement;
    const right = document.querySelector("#player-right-controller") as AElement;

    if (rig && head && left && right) {
      this._selfAvatarTransformBuffer = new AvatarTransformBuffer(this._sfu._clientId, rig, head, left, right);
      setInterval(() => this.updateSelfAvatarTransform(), 10);
      return true;
    }

    return false;
  }

  updateSelfAvatarTransform() {
    this._avatarPartsToSync.forEach(part => {
      this._selfAvatarTransformBuffer?.updateAvatarTransform(part);
      this._client2Transform
        .get(part)
        ?.set(this._sfu._clientId, this._selfAvatarTransformBuffer.getAvatarTransform(part));
    });
  }

  replaceAvatarModel = async (avatarId: string, clientId: string) => {
    if (avatarId === this._client2AvatarAssetId.get(clientId)) return;

    // Remove old avatar if exists
    if (this._client2AvatarEid.has(clientId)) {
      removeAvatarEntityAndModel(APP.world, this._client2AvatarEid.get(clientId));
    }
    // Load self-avatar after entering scene
    getAvatarSrc(avatarId).then((avatarSrc: string) => {
      loadModel(avatarSrc).then(gltf => {
        if (
          createAvatarBoneEntities(APP.world, gltf.scene, clientId, this._avatarEid2ClientId, this._client2AvatarEid)
        ) {
          APP.world.scene.add(gltf.scene);
        }
      });
    });

    // Always record/update the client's avatar ID
    this._client2AvatarAssetId.set(clientId, avatarId);
  };

  sendSelfAvatarSrc(avatarId: string) {
    this._sfu.broadcast("#avatarId", this._sfu._clientId + "|" + avatarId);
  }

  sendSelfAvatarTransform(checkUpdatedRequired: boolean) {
    if (!this._selfAvatarTransformBuffer) return;
    this._avatarPartsToSync.forEach(part => {
      // RIG: always sync because rotation by pressing Q or E is only executed once, and sync can fail if there is loss in dataChannel:
      if (
        checkUpdatedRequired &&
        part !== AvatarPart.RIG &&
        !this._selfAvatarTransformBuffer?.isUpdateAvatarTransformUpdated(part)
      )
        return;

      const arrToSend = this._selfAvatarTransformBuffer.getEncodedAvatarTransform(part);
      this._sfu.broadcastUint8("#avatar-" + AvatarPart[part], arrToSend);
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
      setInterval(() => this.sendSelfAvatarTransform(true), 10);
      return;
    }
  }

  private handleVrModeSyncInit() {
    setInterval(() => this.setSelfIsVrFlag(), 1000);
    setInterval(() => this.sendSelfIsVrFlag(), 1000);
  }

  private setSelfIsVrFlag() {
    this._client2VrMode.set(
      this._sfu._clientId,
      AFRAME.scenes[0].renderer.xr.enabled && AFRAME.scenes[0].renderer.xr.isPresenting
    );
  }

  private sendSelfIsVrFlag() {
    this._sfu.broadcast(
      "#isVR",
      this._sfu._clientId +
        "|" +
        (AFRAME.scenes[0].renderer.xr.enabled && AFRAME.scenes[0].renderer.xr.isPresenting ? "1" : "0")
    );
  }
}
