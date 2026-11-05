import { AElement } from "aframe";
import { SfuAdapter } from "../sfu-adapters/sfu-adapter";
import { AvatarPart, AvatarTransformBuffer } from "./avatar-transform-buffer";
import { decodePart } from "../avatar/net/pose-codec-v0";
import { PoseSender } from "../avatar/net/pose-sender";
import { LocalPoseSource } from "../avatar/pose/local-pose-source";
import { copyTransform, TrackedPose } from "../avatar/pose/tracked-pose";
import { getAvatarSrc } from "./avatar-utils";
import { createAvatarBoneEntities, removeAvatarEntityAndModel } from "../bit-systems/avatar-bones-system";
import { loadModel } from "../components/gltf-model-plus";
import { Object3D } from "three";
import { Transform } from "../types/transform";
import { AvatarAnimState, isValidAvatarAnimState } from "../types/avatar-types";

/** The part of a tracked pose that a transform channel carries, by the part name in the channel label */
function partOf(pose: TrackedPose, part: AvatarPart): Transform | undefined {
  switch (part) {
    case AvatarPart.RIG:
      return pose.rig;
    case AvatarPart.HEAD:
      return pose.head;
    case AvatarPart.LEFT:
      return pose.leftHand;
    case AvatarPart.RIGHT:
      return pose.rightHand;
    default:
      return undefined;
  }
}

/* Sync BitECS-managed avatars through WebRTC DataChannel */
export class AvatarSyncHelper {
  private _selfAvatarTransformBuffer: AvatarTransformBuffer | undefined;
  private _client2AvatarAssetId: Map<string, string>;
  private _loadingAvatars: Set<string>; // Track clients with in-progress avatar loads
  /** The clients whose pose or flags this session wrote to the pose store, so they are forgotten when all leave */
  private readonly _poseClientIds = new Set<string>();
  private readonly _textDecoder = new TextDecoder();
  /** Where a received transform packet is decoded before it is copied to the sender's pose */
  private readonly _receivedTransform: Transform = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } };
  _sfu: SfuAdapter;
  _client2AvatarEid: Map<string, number>;
  /** Reads the own rig, head and hands into the pose store once a frame; exists once the rig is in the scene */
  localPoseSource: LocalPoseSource | undefined;
  /** Sends the own pose from the frame loop while the transform channels are open */
  readonly poseSender: PoseSender;
  _getSelfAvatarIntervalId: NodeJS.Timer | undefined;
  _sendSelfIsVrFlagIntervalId: NodeJS.Timer | undefined;
  _sendSelfAnimStateIntervalId: NodeJS.Timer | undefined;
  /** Set after the room was left: the next sync init sends the own avatar id, so the others send theirs back. */
  announceSelfOnSyncInit = false;

  constructor(sfu: SfuAdapter) {
    this._sfu = sfu;
    this._client2AvatarAssetId = new Map<string, string>();
    this._loadingAvatars = new Set<string>();
    this._client2AvatarEid = new Map<string, number>();
    this.poseSender = new PoseSender(sfu);
  }

  handleSyncInit(channel: string) {
    if (channel.includes("#avatar-")) {
      this.handleTransformSyncInit();
    } else if (channel === "#isVR") {
      this.handleVrModeSyncInit();
    } else if (channel === "#avatarAnimState") {
      this.handleAnimStateSyncInit();
    } else if (channel === "#avatarId" && this.announceSelfOnSyncInit) {
      this.announceSelfOnSyncInit = false;
      // The room forgot this client while it was away; a second later the channel has had time to open
      window.setTimeout(() => this.sendSelfAvatarSrc(), 1000);
    }
  }

  handleRecvMessage(channel: string, data: Uint8Array) {
    if (channel === "#avatarId") {
      let [clientId, avatarId] = this._textDecoder.decode(data).split("|");

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
      if (clientId !== this._sfu.clientId) {
        this.replaceAvatarModel(avatarId, clientId);
      }
    }

    if (channel === "#isVR") {
      let [clientId, isVR] = this._textDecoder.decode(data).split("|");
      this._poseClientIds.add(clientId);
      APP.avatarPoses.setVrMode(clientId, isVR === "1");
    }

    if (channel === "#avatarAnimState") {
      let [clientId, animStateStr] = this._textDecoder.decode(data).split("|");
      const animState = parseInt(animStateStr);
      if (isValidAvatarAnimState(animState)) {
        this._poseClientIds.add(clientId);
        this.switchAnimState(clientId, animState);
      } else {
        console.warn(`Invalid avatar animation state received: ${animState}`);
      }
    }

    if (channel.includes("#avatar-")) {
      // receive other clients' avatar transform when updated
      const received = this._receivedTransform;
      const clientId = decodePart(data, received.pos, received.rot);
      const avatarPart = channel.substring(8) as unknown as AvatarPart;
      this._poseClientIds.add(clientId);
      const pose = APP.avatarPoses.getOrCreate(clientId);
      const transform = partOf(pose, avatarPart);
      if (transform) {
        // The inverse kinematics reads the pose every frame; it is updated in place so a packet allocates nothing
        copyTransform(received, transform);
        pose.receivedAt = performance.now();
      }

      if (this._sfu.bus.isRecording) {
        this._sfu.bus.record({
          l: channel,
          m: { c: clientId, p: { ...received.pos }, r: { ...received.rot } },
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
    this._poseClientIds.delete(clientId);
    APP.avatarPoses.delete(clientId);
  }

  /** Forgets every remote client and removes its avatar entity and model. The own avatar stays. */
  handleOnAllRemoteClientsLeave() {
    const clientIds = new Set<string>([
      ...this._client2AvatarAssetId.keys(),
      ...this._client2AvatarEid.keys(),
      ...this._poseClientIds
    ]);
    clientIds.delete(this._sfu.clientId);
    clientIds.forEach(clientId => this.handleOnClientLeave(clientId));
  }

  initSelfAvatarTransform() {
    // get self avatar parts
    const rig = document.querySelector("#avatar-rig") as AElement;
    const head = document.querySelector("#avatar-pov-node") as AElement;
    const left = document.querySelector("#player-left-controller") as AElement;
    const right = document.querySelector("#player-right-controller") as AElement;

    if (rig && head && left && right) {
      // Every connect() of the adapter ends up here; the sampler and the sender work on the newest buffer
      this._selfAvatarTransformBuffer = new AvatarTransformBuffer(this._sfu.clientId, rig, head, left, right);
      this.localPoseSource = new LocalPoseSource(
        APP.avatarPoses,
        this._sfu.clientId,
        { rig: rig.object3D, head: head.object3D, leftHand: left.object3D, rightHand: right.object3D },
        AFRAME.scenes[0].renderer
      );
      this.poseSender.setBuffer(this._selfAvatarTransformBuffer);
      return true;
    }

    return false;
  }

  private async loadAvatarModel(avatarId: string, clientId: string): Promise<boolean> {
    const avatarSrc = await getAvatarSrc(avatarId);
    const gltf = await loadModel(avatarSrc);
    gltf.scene.traverse(function (object: Object3D) {
      object.frustumCulled = false;
    });
    // Only the room session's avatars are solved and shown. A public speaking session receives the same
    // channels and loads the models too, but the frame loop never read its entities: they stay unbound
    const showsPose = APP.sfu.avatarSync === this;
    if (createAvatarBoneEntities(gltf.scene, clientId, this._client2AvatarEid, showsPose)) {
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

    // Remove old avatar if exists; the client's pose stays and the new entity is bound to it
    if (this._client2AvatarEid.has(clientId)) {
      removeAvatarEntityAndModel(APP.world, this._client2AvatarEid.get(clientId));
      this._client2AvatarEid.delete(clientId);
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
    this._sfu.broadcast("#avatarId", this._sfu.clientId + "|" + (avatarId || window.APP.store.state.profile.avatarId));
    this.sendSelfAvatarTransform(false);
  }

  /** Sends the own pose now: every part, or with the flag only the rig and the parts that moved since their last send */
  sendSelfAvatarTransform(checkUpdatedRequired: boolean) {
    if (checkUpdatedRequired) {
      this.poseSender.sendChanged();
    } else {
      this.poseSender.sendAll();
    }
  }

  private handleTransformSyncInit() {
    // The rig and controllers may not be in the scene yet when the channel opens
    if (!this._selfAvatarTransformBuffer) this.waitForSelfAvatar();
    // Sending begins with the next frame in which the buffer exists
    this.poseSender.start();
  }

  /** Looks for the own rig once a second until it is found; the sync inits of all four channels share one poll */
  private waitForSelfAvatar() {
    if (this._getSelfAvatarIntervalId) return;
    this._getSelfAvatarIntervalId = setInterval(() => {
      if (this._selfAvatarTransformBuffer || this.initSelfAvatarTransform()) this.stopWaitingForSelfAvatar();
    }, 1000);
  }

  private stopWaitingForSelfAvatar() {
    if (this._getSelfAvatarIntervalId) clearInterval(this._getSelfAvatarIntervalId);
    this._getSelfAvatarIntervalId = undefined;
  }

  private handleVrModeSyncInit() {
    this._sendSelfIsVrFlagIntervalId = setInterval(() => this.sendSelfIsVrFlag(), 1000);
  }

  private handleAnimStateSyncInit() {
    this._sendSelfAnimStateIntervalId = setInterval(() => this.sendSelfAnimState(), 500);
  }

  private sendSelfIsVrFlag() {
    this._sfu.broadcast(
      "#isVR",
      this._sfu.clientId +
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
    const animState = APP.avatarPoses.get(this._sfu.clientId)?.animState ?? AvatarAnimState.STAND;
    this._sfu.broadcast("#avatarAnimState", this._sfu.clientId + "|" + animState);
  }

  private switchAnimState(clientId: string, state: AvatarAnimState) {
    APP.avatarPoses.setAnimState(clientId, state);
  }

  switchSelfAnimState(state: AvatarAnimState) {
    this.switchAnimState(this._sfu.clientId, state);
  }

  stopSyncing() {
    this.stopWaitingForSelfAvatar();
    // The next transform sync init starts the sender again
    this.poseSender.stop();
    if (this._sendSelfIsVrFlagIntervalId) clearInterval(this._sendSelfIsVrFlagIntervalId);
    if (this._sendSelfAnimStateIntervalId) clearInterval(this._sendSelfAnimStateIntervalId);
  }
}
