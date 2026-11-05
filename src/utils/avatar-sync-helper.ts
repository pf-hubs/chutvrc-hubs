import { AElement } from "aframe";
import { SfuAdapter } from "../sfu-adapters/sfu-adapter";
import { AvatarPart, AvatarTransformBuffer } from "./avatar-transform-buffer";
import { PosePart } from "../avatar/net/interpolation-buffer";
import { decodePart } from "../avatar/net/pose-codec-v0";
import { PoseSender } from "../avatar/net/pose-sender";
import { LocalPoseSource } from "../avatar/pose/local-pose-source";
import { AvatarModelManager } from "../avatar/avatar-model-manager";
import { Transform } from "../types/transform";
import { AvatarAnimState, isValidAvatarAnimState } from "../types/avatar-types";

/** The part of a tracked pose that a transform channel carries, by the part name in the channel label */
function partOf(part: AvatarPart): PosePart | undefined {
  switch (part) {
    case AvatarPart.RIG:
      return "rig";
    case AvatarPart.HEAD:
      return "head";
    case AvatarPart.LEFT:
      return "leftHand";
    case AvatarPart.RIGHT:
      return "rightHand";
    default:
      return undefined;
  }
}

/* Sync BitECS-managed avatars through WebRTC DataChannel */
export class AvatarSyncHelper {
  private _selfAvatarTransformBuffer: AvatarTransformBuffer | undefined;
  /** The clients whose pose or flags this session wrote to the pose store, so they are forgotten when all leave */
  private readonly _poseClientIds = new Set<string>();
  private readonly _textDecoder = new TextDecoder();
  /** Where a received transform packet is decoded before it is copied to the sender's pose */
  private readonly _receivedTransform: Transform = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } };
  _sfu: SfuAdapter;
  /** Loads, replaces and removes the avatar models of this session's clients */
  readonly models: AvatarModelManager;
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
    // Only the room session's avatars are solved and shown. A public speaking session receives the same
    // channels and loads the models too, but the frame loop never read its entities: they stay unbound
    this.models = new AvatarModelManager(APP.world, APP.avatarPoses, () => APP.sfu.avatarSync === this);
    this.poseSender = new PoseSender(sfu);
  }

  /** The avatar entity of each client; the name tag and the media session read it */
  get _client2AvatarEid(): Map<string, number> {
    return this.models.avatarEidByClientId;
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
      if (this.models.isLoading(clientId)) return;

      const knownAvatarId = this.models.avatarIdOf(clientId);
      if (knownAvatarId !== undefined) {
        // if avatar id of this client is already recorded
        if (knownAvatarId === avatarId) return; // if avatar is not changed, ignore it
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
      const part = partOf(channel.substring(8) as unknown as AvatarPart);
      this._poseClientIds.add(clientId);
      // The pose is not written here: the store keeps the packet and writes the part a short time later,
      // blended between packets, once a frame before the solver reads it. The own pose is the local
      // sampler's, so a packet of it that found its way back is not kept over it
      if (part && clientId !== this._sfu.clientId) {
        APP.avatarPoses.pushRemotePart(clientId, part, performance.now(), received);
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
    this.models.removeClientAvatar(clientId);
    this._poseClientIds.delete(clientId);
    APP.avatarPoses.delete(clientId);
  }

  /** Forgets every remote client and removes its avatar entity and model. The own avatar stays. */
  handleOnAllRemoteClientsLeave() {
    const clientIds = new Set<string>([...this.models.clientIds(), ...this._poseClientIds]);
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

  replaceAvatarModel = async (avatarId: string, clientId: string): Promise<void> => {
    await this.models.replaceAvatarModel(avatarId, clientId);
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
