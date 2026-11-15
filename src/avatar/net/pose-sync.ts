import { AElement } from "aframe";
import { SfuAdapter } from "../../sfu-adapters/sfu-adapter";
import { POSE_PARTS, PosePart } from "./interpolation-buffer";
import { decodePart } from "./pose-codec-v0";
import { decodeBody, isOlderSeq, POSE_CHANNEL } from "./pose-codec-v1";
import { PoseSender, recordedBody } from "./pose-sender";
import { LocalPoseSource } from "../pose/local-pose-source";
import { createTrackedPose, TRACKED_ALL } from "../pose/tracked-pose";
import { AvatarModelManager } from "../avatar-model-manager";
import { Transform } from "../../types/transform";
import { AvatarAnimState, isValidAvatarAnimState } from "../../types/avatar-types";

/**
 * A whole-body packet numbered behind the last one taken from its client is late and is dropped, unless
 * nothing was taken from the client for this long: then the sender's count has restarted, and the packet
 * is taken as the new start.
 */
const SEQ_RESTART_AFTER_MS = 2000;

/**
 * After an event that calls for the own announcement, it is sent again this long after the last such
 * event: a peer whose channel from this client was still opening lost the first one, and has it open by then
 */
const ANNOUNCE_AGAIN_AFTER_MS = 1000;

/** How often the own avatar is announced again, for a client that missed every announcement so far */
const ANNOUNCE_REPEAT_MS = 5000;

/** The part of a tracked pose that one of the old per-part channels carries */
function partOf(channel: string): PosePart | undefined {
  switch (channel) {
    case "#avatar-RIG":
      return "rig";
    case "#avatar-HEAD":
      return "head";
    case "#avatar-LEFT":
      return "leftHand";
    case "#avatar-RIGHT":
      return "rightHand";
    default:
      return undefined;
  }
}

/**
 * The avatar sync of one media server session: the sync channels (#avatar-pose, the old per-part
 * #avatar-* channels, #avatarId, #isVR and #avatarAnimState) in and out, the start and stop of the own
 * pose's sampler and sender, the recording of poses, and the clients' models through the model manager.
 * There is one per adapter, reached as APP.sfu.avatarSync: a public speaking session has its own set of
 * avatars, so the page has no single one.
 */
export class PoseSync {
  /** The clients whose pose or flags this session wrote to the pose store, so they are forgotten when all leave */
  private readonly _poseClientIds = new Set<string>();
  private readonly _textDecoder = new TextDecoder();
  /** Where a received per-part packet is decoded before it is kept for the sender's pose */
  private readonly _receivedTransform: Transform = { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } };
  /** Where a received whole-body packet is decoded before it is kept for the sender's pose */
  private readonly _receivedBody = createTrackedPose();
  _sfu: SfuAdapter;
  /** Loads, replaces and removes the avatar models of this session's clients */
  readonly models: AvatarModelManager;
  /** Reads the own rig, head and hands into the pose store once a frame while the sender runs; exists once the rig is in the scene */
  localPoseSource: LocalPoseSource | undefined;
  /** Sends the own pose from the frame loop while the pose channels are open */
  readonly poseSender: PoseSender;
  _getSelfAvatarIntervalId: NodeJS.Timer | undefined;
  /** Repeats the own announcement; set while this session announces the own avatar, from its #avatarId sync init on */
  private _announceIntervalId: number | undefined;
  /** The second announcement after an event, while it is due */
  private _announceAgainTimeoutId: number | undefined;
  /** The avatar id each remote client last announced, so that a repeated announcement is ignored */
  private readonly _announcedAvatarIds = new Map<string, string>();
  /**
   * No longer read: the own avatar is announced on every #avatarId sync init. Kept while the session
   * still sets it on a replacement adapter.
   */
  announceSelfOnSyncInit = false;

  constructor(sfu: SfuAdapter) {
    this._sfu = sfu;
    // Only the room session's avatars are solved and shown. A public speaking session receives the same
    // channels and loads the models too, but the frame loop never read its entities: they stay unbound
    this.models = new AvatarModelManager(APP.world, APP.avatarPoses, () => APP.sfu.avatarSync === this);
    this.poseSender = new PoseSender(sfu, APP.avatarPoses);
  }

  /** The avatar entity of each client; the name tag and the media session read it */
  get _client2AvatarEid(): Map<string, number> {
    return this.models.avatarEidByClientId;
  }

  handleSyncInit(channel: string) {
    // #avatar-pose and the four old per-part channels: any of them opening starts the sender
    if (channel.includes("#avatar-")) {
      this.handleTransformSyncInit();
    } else if (channel === "#avatarId") {
      this.handleAvatarIdSyncInit();
    }
  }

  /**
   * A peer joined, or a peer's announcement channel to this client opened: the peer may not know the own
   * avatar yet. Only a session that announces the own avatar at all answers.
   */
  handlePeerJoined() {
    if (this._announceIntervalId !== undefined) this.announceSelfNowAndAgain();
  }

  handleRecvMessage(channel: string, data: Uint8Array) {
    if (channel === "#avatarId") {
      this.handleAvatarIdMessage(this._textDecoder.decode(data));
    }

    // Old builds send the VR flag and the animation state on their own channels; a whole-body packet carries both
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

    if (channel === POSE_CHANNEL) {
      this.handlePoseMessage(data);
    } else if (channel.includes("#avatar-")) {
      // receive other clients' avatar transform when updated
      const received = this._receivedTransform;
      const clientId = decodePart(data, received.pos, received.rot);
      const part = partOf(channel);
      this._poseClientIds.add(clientId);
      // The pose is not written here: the store keeps the packet and writes the part a short time later,
      // blended between packets, once a frame before the solver reads it. The own pose is the local
      // sampler's, so a packet of it that found its way back is not kept over it
      if (part && clientId !== this._sfu.clientId) {
        APP.avatarPoses.pushRemotePart(clientId, part, performance.now(), received);
        // An old build does not say which parts its devices track; all are taken as tracked, as the solver assumed
        APP.avatarPoses.getOrCreate(clientId).tracked = TRACKED_ALL;
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

  /** A whole-body packet: the four parts go to the store's buffer together, the flags straight onto the pose */
  private handlePoseMessage(data: Uint8Array) {
    const body = this._receivedBody;
    const header = decodeBody(data, body);
    const clientId = header.clientId;
    body.tracked = header.tracked;
    body.isVR = header.isVR;
    if (isValidAvatarAnimState(header.animState)) body.animState = header.animState;
    this._poseClientIds.add(clientId);

    // The own pose is the local sampler's, so a packet of it that found its way back is not kept over it
    if (clientId !== this._sfu.clientId) {
      const pose = APP.avatarPoses.getOrCreate(clientId);
      const now = performance.now();
      // The channel is unordered: a packet that arrives after a newer one would move the avatar back
      if (pose.seq >= 0 && isOlderSeq(header.seq, pose.seq) && now - pose.receivedAt < SEQ_RESTART_AFTER_MS) return;
      for (const part of POSE_PARTS) {
        APP.avatarPoses.pushRemotePart(clientId, part, now, body[part], body[part].quat);
      }
      pose.tracked = header.tracked;
      pose.isVR = header.isVR;
      if (isValidAvatarAnimState(header.animState)) pose.animState = header.animState;
      pose.seq = header.seq;
      pose.senderTimeMs = header.timeMs;
    }

    if (this._sfu.bus.isRecording) {
      this._sfu.bus.record({
        l: POSE_CHANNEL,
        m: recordedBody(clientId, body, header.seq, header.timeMs),
        t: Date.now(),
        s: 0
      });
    }
  }

  /**
   * An announcement, "clientId|avatarId"; a later build may append fields, which are ignored. Every client
   * repeats its announcement, so one that names the avatar the client announced last is ignored, also when
   * that avatar failed to load and the default one stands in: loading it again would fail again.
   */
  private handleAvatarIdMessage(message: string) {
    const [clientId, avatarId] = message.split("|");
    // The own client's model is the entry's to load
    if (!clientId || clientId === this._sfu.clientId) return;

    // A client whose model is loading is skipped; a change of avatar meanwhile comes with its next announcement
    if (this.models.isLoading(clientId)) return;

    const knownAvatarId = this._announcedAvatarIds.get(clientId);
    if (knownAvatarId === avatarId) return;
    // A client new to this one may not know the own avatar either, so it gets the own announcement back
    if (knownAvatarId === undefined) this.announceSelfNowAndAgain();
    this._announcedAvatarIds.set(clientId, avatarId);
    this.replaceAvatarModel(avatarId, clientId);
  }

  handleOnClientLeave(clientId: string) {
    this.models.removeClientAvatar(clientId);
    this._announcedAvatarIds.delete(clientId);
    this._poseClientIds.delete(clientId);
    APP.avatarPoses.delete(clientId);
  }

  /** Forgets every remote client and removes its avatar entity and model. The own avatar stays. */
  handleOnAllRemoteClientsLeave() {
    const clientIds = new Set<string>([
      ...this.models.clientIds(),
      ...this._announcedAvatarIds.keys(),
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
      // Every connect() of the adapter ends up here; the sampler and the sender work under the newest client id
      this.localPoseSource = new LocalPoseSource(
        APP.avatarPoses,
        this._sfu.clientId,
        { rig: rig.object3D, head: head.object3D, leftHand: left.object3D, rightHand: right.object3D },
        AFRAME.scenes[0].renderer
      );
      // The sender samples through the source each frame it runs, so a public speaking sender gets its pose too
      this.poseSender.source = this.localPoseSource;
      this.poseSender.setClientId(this._sfu.clientId);
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

  /**
   * Sends the own pose now. The flag once chose the parts that moved over all of them; the whole body
   * goes in every packet now, so it makes no difference and is kept only for the callers.
   */
  sendSelfAvatarTransform(_checkUpdatedRequired = false) {
    this.poseSender.sendAll();
  }

  /**
   * The announcement channel can be sent on: this is the first connection, or the room forgot this client
   * while it was away, so the own avatar is announced. Nothing asks for an announcement that was lost, so
   * it is also repeated from now on, for a peer that missed every one.
   */
  private handleAvatarIdSyncInit() {
    this.announceSelfNowAndAgain();
    if (this._announceIntervalId === undefined) {
      this._announceIntervalId = window.setInterval(() => this.announceSelf(), ANNOUNCE_REPEAT_MS);
    }
  }

  /** Announces the own avatar now, and again ANNOUNCE_AGAIN_AFTER_MS after the last call */
  private announceSelfNowAndAgain() {
    this.announceSelf();
    if (this._announceAgainTimeoutId !== undefined) window.clearTimeout(this._announceAgainTimeoutId);
    this._announceAgainTimeoutId = window.setTimeout(() => {
      this._announceAgainTimeoutId = undefined;
      this.announceSelf();
    }, ANNOUNCE_AGAIN_AFTER_MS);
  }

  /** Announces the own avatar once the user has entered: the others do not draw a client still in the lobby */
  private announceSelf() {
    if (!APP.scene?.is("entered")) return;
    this.sendSelfAvatarSrc();
  }

  private stopAnnouncing() {
    if (this._announceIntervalId !== undefined) window.clearInterval(this._announceIntervalId);
    this._announceIntervalId = undefined;
    if (this._announceAgainTimeoutId !== undefined) window.clearTimeout(this._announceAgainTimeoutId);
    this._announceAgainTimeoutId = undefined;
  }

  private handleTransformSyncInit() {
    // The rig and controllers may not be in the scene yet when the channel opens
    if (!this.localPoseSource) this.waitForSelfAvatar();
    // Sending begins with the next frame in which the own pose has been sampled
    this.poseSender.start();
  }

  /** Looks for the own rig once a second until it is found; the sync inits of all the pose channels share one poll */
  private waitForSelfAvatar() {
    if (this._getSelfAvatarIntervalId) return;
    this._getSelfAvatarIntervalId = setInterval(() => {
      if (this.localPoseSource || this.initSelfAvatarTransform()) this.stopWaitingForSelfAvatar();
    }, 1000);
  }

  private stopWaitingForSelfAvatar() {
    if (this._getSelfAvatarIntervalId) clearInterval(this._getSelfAvatarIntervalId);
    this._getSelfAvatarIntervalId = undefined;
  }

  private switchAnimState(clientId: string, state: AvatarAnimState) {
    APP.avatarPoses.setAnimState(clientId, state);
  }

  /** Writes the own animation state into the store; the next packet carries it */
  switchSelfAnimState(state: AvatarAnimState) {
    this.switchAnimState(this._sfu.clientId, state);
  }

  stopSyncing() {
    this.stopWaitingForSelfAvatar();
    // The next #avatarId sync init announces the own avatar again, and the next pose sync init starts the sender
    this.stopAnnouncing();
    this.poseSender.stop();
  }
}
