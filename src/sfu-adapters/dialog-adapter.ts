// @ts-nocheck
// TODO: This file was migrated from JavaScript. Full TypeScript annotations should be added incrementally.
// Temporarily using @ts-nocheck to allow compilation while maintaining backwards compatibility.

import * as mediasoupClient from "mediasoup-client";
import protooClient from "protoo-client";
import { debug as newDebug } from "debug";
import { SFU_CONNECTION_CONNECTED, SFU_CONNECTION_ERROR_FATAL, SfuAdapter } from "./sfu-adapter";
import { AvatarSyncHelper } from "../utils/avatar-sync-helper";
import { SFU, SFU_CONNECTION_TYPE } from "../sfu-types";
import { DialogConfig, SfuConfig, TurnConfig, withDialogHost } from "./sfu-config";
import { dataChannelLabels } from "./data-channel-bus";
import { LocalTrackKind } from "./media-session";
import {
  ChannelHandlerRegistry,
  createAvatarSyncHandlers,
  NimproHandler,
  IotBridgeHandler,
  PdfPageHandler,
  TogglePublicSpeakerHandler,
  LaserPointerHandler,
  EmojiHandler
} from "../utils/data-channel-handlers";

// Used for VP9 webcam video.
//const VIDEO_KSVC_ENCODINGS = [{ scalabilityMode: "S3T3_KEY" }];

// Used for VP9 desktop sharing.
//const VIDEO_SVC_ENCODINGS = [{ scalabilityMode: "S3T3", dtx: true }];

// TODO
// - look into requestConsumerKeyframe
// - look into applyNetworkThrottle
// SFU todo
// - remove active speaker stuff
// - remove score stuff

// Based upon mediasoup-demo RoomClient

const debug = newDebug("naf-dialog-adapter:debug");
//const warn = newDebug("naf-dialog-adapter:warn");
const error = newDebug("naf-dialog-adapter:error");
const info = newDebug("naf-dialog-adapter:info");

const PC_PROPRIETARY_CONSTRAINTS = {
  optional: [{ googDscp: true }]
};

const WEBCAM_SIMULCAST_ENCODINGS = [
  { scaleResolutionDownBy: 4, maxBitrate: 500000 },
  { scaleResolutionDownBy: 2, maxBitrate: 1000000 },
  { scaleResolutionDownBy: 1, maxBitrate: 5000000 }
];

// Used for simulcast screen sharing.
const SCREEN_SHARING_SIMULCAST_ENCODINGS = [
  { dtx: true, maxBitrate: 1500000 },
  { dtx: true, maxBitrate: 6000000 }
];

export class DialogAdapter extends SfuAdapter<DialogConfig> {
  private _micProducer: any;
  private _cameraProducer: any;
  private _shareProducer: any;
  private _consumers: Map<string, any>;
  private _dataProducers: Map<string, any>;
  private _dataConsumers: Map<string, any>;
  private _blockedClients: Map<string, boolean>;
  private _useDataChannel: boolean;
  private _consumerStats: Record<string, any>;
  private _protoo: any;
  private _mediasoupDevice: any;
  private _sendTransport: any;
  private _recvTransport: any;
  private _downlinkBwe: any;
  private _laserPointerHandler: LaserPointerHandler | null = null;
  public scene: any;

  constructor(sfuType: SFU_CONNECTION_TYPE = SFU_CONNECTION_TYPE.SENDRECV) {
    super();

    this._sfuId = SFU.DIALOG;
    this._connectionType = sfuType;
    this._micProducer = null;
    this._cameraProducer = null;
    this._shareProducer = null;
    this._consumers = new Map();
    this._dataProducers = new Map(); // DataChannel implementation
    this._dataConsumers = new Map(); // DataChannel implementation
    this._blockedClients = new Map();
    this._useDataChannel = true; // DataChannel implementation
    this.scene = null;
    this._consumerStats = {};
    this._avatarSyncHelper = new AvatarSyncHelper(this);
    this._publicSpeakerClientIdsInRoom = [];

    // Initialize message dispatcher with handlers for DialogAdapter
    this.initializeDialogHandlers();
  }

  /**
   * Initialize channel handlers for DialogAdapter.
   * DialogAdapter supports: avatar sync channels + all optional feature channels
   */
  private initializeDialogHandlers(): void {
    const registry = new ChannelHandlerRegistry();

    // Register avatar sync handlers (mandatory)
    createAvatarSyncHandlers().forEach(handler => registry.register(handler));

    // Register optional handlers for DialogAdapter
    registry.register(new NimproHandler());
    registry.register(new IotBridgeHandler());
    registry.register(new PdfPageHandler());
    registry.register(new TogglePublicSpeakerHandler());

    // LaserPointerHandler needs cleanup on disconnect
    this._laserPointerHandler = new LaserPointerHandler();
    registry.register(this._laserPointerHandler);

    registry.register(new EmojiHandler());

    this.initializeMessageDispatcher(registry);
  }

  get consumerStats(): Record<string, any> | null {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return null;
    return this._consumerStats;
  }

  get downlinkBwe(): any {
    return this._downlinkBwe;
  }

  // BridgeCapable implementation
  get isBridgeChannelReady(): boolean {
    return this._dataProducers?.has("#iot") && this._sendTransport && !this._sendTransport._closed;
  }

  get isConnected(): boolean {
    return !!this._sendTransport;
  }

  getIceServers(host: string, port: number, turn?: TurnConfig | null): RTCIceServer[] {
    const iceServers: RTCIceServer[] = [];

    if (turn && turn.enabled) {
      turn.transports.forEach(ts => {
        // Try both TURN DTLS and TCP/TLS
        if (!this._config.forceTcp) {
          iceServers.push({
            urls: `turns:${host}:${ts.port}`,
            username: turn.username,
            credential: turn.credential
          });
        }

        iceServers.push({
          urls: `turns:${host}:${ts.port}?transport=tcp`,
          username: turn.username,
          credential: turn.credential
        });
      });
      iceServers.push({ urls: "stun:stun1.l.google.com:19302" });
    } else {
      iceServers.push({ urls: "stun:stun1.l.google.com:19302" }, { urls: "stun:stun2.l.google.com:19302" });
    }

    return iceServers;
  }

  /**
   * Gets transport/consumer/producer stats on the server side.
   */
  async getServerStats(): Promise<Record<string, any> | undefined> {
    if (!this._protoo.connected) {
      // Signaling channel not connected, no reason to get remote RTC stats.
      return;
    }

    const result: Record<string, any> = {};
    try {
      if (this._connectionType !== SFU_CONNECTION_TYPE.RECV && !this._sendTransport?._closed) {
        const sendTransport = (result[this._sendTransport.id] = {});
        sendTransport.name = "Send";
        sendTransport.stats = await this._protoo.request("getTransportStats", {
          transportId: this._sendTransport.id
        });
        result[this._sendTransport.id]["producers"] = {};
        for (const producer of this._sendTransport._producers) {
          const id = producer[0];
          result[this._sendTransport.id]["producers"][id] = await this._protoo.request("getProducerStats", {
            producerId: id
          });
        }
      }
      if (this._connectionType !== SFU_CONNECTION_TYPE.SEND && !this._recvTransport?._closed) {
        const recvTransport = (result[this._recvTransport.id] = {});
        recvTransport.name = "Receive";
        recvTransport.stats = await this._protoo.request("getTransportStats", {
          transportId: this._recvTransport.id
        });
        result[this._recvTransport.id]["consumers"] = {};
        for (const consumer of this._recvTransport._consumers) {
          const id = consumer[0];
          result[this._recvTransport.id]["consumers"][id] = await this._protoo.request("getConsumerStats", {
            consumerId: id
          });
        }
      }
      return result;
    } catch (e) {
      this.emitRTCEvent("error", "Adapter", () => `Error getting the server status: ${e}`);
      return { error: `Error getting the server status: ${e}` };
    }
  }

  async iceRestart(transport: any): Promise<void> {
    // Force an ICE restart to gather new candidates and trigger a reconnection
    this.emitRTCEvent(
      "log",
      "RTC",
      () => `Restarting ${transport.id === this._sendTransport?.id ? "send" : "receive"} transport ICE`
    );
    const iceParameters = await this._protoo.request("restartIce", { transportId: transport.id });
    await transport.restartIce({ iceParameters });
  }

  async recreateSendTransport(iceServers: RTCIceServer[]): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    this.emitRTCEvent("log", "RTC", () => `Recreating send transport ICE`);
    await this.closeSendTransport();
    await this.createSendTransport(iceServers);
  }

  /**
   * Restart ICE in the underlying send peerconnection.
   */
  async restartSendICE(): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    // Do not restart ICE if Signaling is disconnected.
    if (!this._protoo || !this._protoo.connected) {
      return;
    }

    try {
      if (!this._sendTransport?._closed) {
        await this.iceRestart(this._sendTransport);
      } else {
        // If the transport is closed but the signaling is connected, we try to recreate
        const { host, port, turn } = this._config;
        const iceServers = this.getIceServers(host, port, turn);
        await this.recreateSendTransport(iceServers);
      }
    } catch (err) {
      this.emitRTCEvent("error", "RTC", () => `Send transport [recreate] failed: ${err}`);
    }
  }

  /**
   * Checks the Send Transport ICE status and restarts it in case is in failed state.
   * This is called by the Send Transport "connectionstatechange" event listener.
   */
  checkSendIceStatus(connectionState: string): void {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    // If the ICE connection state is failed, we force an ICE restart
    if (connectionState === "failed") {
      this.restartSendICE();
    }
  }

  async recreateRecvTransport(iceServers: RTCIceServer[]): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return;
    this.emitRTCEvent("log", "RTC", () => `Recreating receive transport ICE`);
    await this.closeRecvTransport();
    await this.createRecvTransport(iceServers);
    await this._protoo.request("refreshConsumers");
  }

  /**
   * Restart ICE in the underlying receive peerconnection.
   */
  async restartRecvICE(): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return;
    if (!this._protoo || !this._protoo.connected) {
      return;
    }

    try {
      if (!this._recvTransport?._closed) {
        await this.iceRestart(this._recvTransport);
      } else {
        // If the transport is closed but the signaling is connected, we try to recreate
        const { host, port, turn } = this._config;
        const iceServers = this.getIceServers(host, port, turn);
        await this.recreateRecvTransport(iceServers);
      }
    } catch (err) {
      this.emitRTCEvent("error", "RTC", () => `Receive transport [recreate] failed: ${err}`);
    }
  }

  /**
   * Checks the Receive Transport ICE status and restarts it in case is in failed state.
   * This is called by the Receive Transport "connectionstatechange" event listener.
   */
  checkRecvIceStatus(connectionState: string): void {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return;
    // If the ICE connection state is failed, we force an ICE restart
    if (connectionState === "failed") {
      this.restartRecvICE();
    }
  }

  async connect(config: SfuConfig): Promise<void> {
    if (config.kind !== "dialog") {
      throw new Error(`DialogAdapter cannot connect with a ${config.kind} config`);
    }
    const { roomId, scene, clientId, host, port } = config;
    this._config = config;
    this._roomId = roomId;
    this._clientId = clientId;
    this.scene = scene;

    // Update dispatcher context with connection info
    this.updateDispatcherContext();

    const urlWithParams = new URL(`wss://${host}:${port}`);
    urlWithParams.searchParams.append("roomId", this._roomId);
    urlWithParams.searchParams.append("peerId", this._clientId);

    this._avatarSyncHelper.initSelfAvatarTransform();

    // TODO: Establishing connection could take a very long time.
    //       Inform the user if we are stuck here.
    const protooTransport = new protooClient.WebSocketTransport(urlWithParams.toString(), {
      retry: { retries: 2 }
    });
    this._protoo = new protooClient.Peer(protooTransport);

    this._protoo.on("disconnected", () => {
      this.emitRTCEvent("info", "Signaling", () => `Disconnected`);
      this.cleanUpLocalState();
    });

    this._protoo.on("failed", (attempt: number) => {
      this.emitRTCEvent("error", "Signaling", () => `Failed: ${attempt}, retrying...`);
    });

    this._protoo.on("close", async () => {
      // We explicitly disconnect event handlers when closing the socket ourselves,
      // so if we get into here, we were not the ones closing the connection.
      this.emitRTCEvent("error", "Signaling", () => `Closed`);
      this._retryConnectWithNewHost();
    });

    // eslint-disable-next-line no-unused-vars
    this._protoo.on("request", async (request: any, accept: () => void, reject: (err: Error) => void) => {
      this.emitRTCEvent("info", "Signaling", () => `Request [${request.method}]: ${request.data?.id}`);
      debug('proto "request" event [method:%s, data:%o]', request.method, request.data?.id);

      switch (request.method) {
        case "newConsumer": {
          if (this._connectionType === SFU_CONNECTION_TYPE.SEND) break;
          const { peerId, producerId, id, kind, rtpParameters, /*type, */ appData /*, producerPaused */ } =
            request.data;

          try {
            const consumer = await this._recvTransport.consume({
              id,
              producerId,
              kind,
              rtpParameters,
              appData: { ...appData, peerId } // Trick.
            });

            // Store in the map.
            this._consumers.set(consumer.id, consumer);

            consumer.on("transportclose", () => {
              this.emitRTCEvent("error", "RTC", () => `Consumer transport closed`);
              this.removeConsumer(consumer.id);
            });

            if (kind === "video") {
              const { spatialLayers, temporalLayers } = mediasoupClient.parseScalabilityMode(
                consumer.rtpParameters.encodings[0].scalabilityMode
              );

              this._consumerStats[consumer.id] = this._consumerStats[consumer.id] || {};
              this._consumerStats[consumer.id]["spatialLayers"] = spatialLayers;
              this._consumerStats[consumer.id]["temporalLayers"] = temporalLayers;
            }

            // We are ready. Answer the protoo request so the server will
            // resume this Consumer (which was paused for now if video).
            accept();

            this.media.addRemoteTrack(peerId, kind, consumer.track);
            this.media.tryAttachAudioToPublicSpeakerAgent(peerId, new MediaStream([consumer.track]));

            // Notify of an stream update event
            this.emit("stream_updated", peerId, kind);
          } catch (err) {
            this.emitRTCEvent("error", "Adapter", () => `Error: ${err}`);
            error('"newConsumer" request failed:%o', err);

            throw err;
          }

          break;
        }
        // DataChannel implementation
        case "newDataConsumer": {
          if (this._connectionType === SFU_CONNECTION_TYPE.SEND) break;
          const { dataProducerId, id, label, protocol, sctpStreamParameters /* , peerId */ } = request.data;

          try {
            const dataConsumer = await this._recvTransport.consumeData({
              id,
              dataProducerId,
              label,
              protocol,
              sctpStreamParameters
            });

            dataConsumer.on("message", (data: ArrayBuffer) => {
              this.bus.receive(label, new Uint8Array(data));
            });

            dataConsumer.on("transportclose", () => {
              this.emitRTCEvent("error", "RTC", () => `DataConsumer transport closed`);
            });

            // Store in the map.
            this._dataConsumers.set(dataConsumer.id, dataConsumer);

            // We are ready. Answer the protoo request so the server will
            // resume this DataConsumer.
            accept();

            // Notify of an stream update event
            // this.emit("stream_updated", peerId, kind);
          } catch (err) {
            this.emitRTCEvent("error", "Adapter", () => `Error: ${err}`);
            error('"newDataConsumer" request failed:%o', err);

            throw err;
          }

          break;
        }
      }
    });

    this._protoo.on("notification", (notification: any) => {
      debug('proto "notification" event [method:%s, data:%o]', notification.method, notification.data);

      switch (notification.method) {
        case "newPeer": {
          break;
        }

        case "peerClosed": {
          const { peerId } = notification.data;
          this.media.removePeer(peerId);

          break;
        }

        case "consumerClosed": {
          if (this._connectionType === SFU_CONNECTION_TYPE.SEND) break;

          const { consumerId } = notification.data;
          const consumer = this._consumers.get(consumerId);

          if (!consumer) {
            info(`consumerClosed event received without related consumer: ${consumerId}`);
            break;
          }

          this._avatarSyncHelper.handleOnClientLeave(consumer.appData.peerId);

          consumer.close();
          this.removeConsumer(consumer.id);

          if (this === APP.publicSpeakersMirrorSfu) {
            this.disconnect();
          }

          break;
        }

        case "dataConsumerClosed": {
          if (this._connectionType === SFU_CONNECTION_TYPE.SEND) break;

          const { dataConsumerId } = notification.data;
          const dataConsumer = this._dataConsumers.get(dataConsumerId);

          if (!dataConsumer) {
            info(`dataConsumerClosed event received without related dataConsumer: ${dataConsumerId}`);
            break;
          }

          this._avatarSyncHelper.handleOnClientLeave(dataConsumer.appData.peerId);

          dataConsumer.close();
          this.removeDataConsumer(dataConsumer.id);

          break;
        }

        case "peerBlocked": {
          const { peerId } = notification.data;
          document.body.dispatchEvent(new CustomEvent("blocked", { detail: { clientId: peerId } }));

          break;
        }

        case "peerUnblocked": {
          const { peerId } = notification.data;
          document.body.dispatchEvent(new CustomEvent("unblocked", { detail: { clientId: peerId } }));

          break;
        }

        case "downlinkBwe": {
          this._downlinkBwe = notification.data;
          break;
        }

        case "consumerLayersChanged": {
          if (this._connectionType === SFU_CONNECTION_TYPE.SEND) break;

          const { consumerId, spatialLayer, temporalLayer } = notification.data;

          const consumer = this._consumers.get(consumerId);

          if (!consumer) {
            info(`consumerLayersChanged event received without related consumer: ${consumerId}`);
            break;
          }

          this._consumerStats[consumerId] = this._consumerStats[consumerId] || {};
          this._consumerStats[consumerId]["spatialLayer"] = spatialLayer;
          this._consumerStats[consumerId]["temporalLayer"] = temporalLayer;

          // TODO: If spatialLayer/temporalLayer are null, that's probably because the current downlink
          // it's not enough forany spatial layer bitrate. In that case the server has paused the consumer.
          // At this point we it would be nice to give the user some visual cue that this stream is paused.
          // ie. A grey overlay with some icon or replacing the video stream por a generic person image.
          break;
        }

        case "consumerScore": {
          if (this._connectionType === SFU_CONNECTION_TYPE.SEND) break;

          const { consumerId, score } = notification.data;

          const consumer = this._consumers.get(consumerId);

          if (!consumer) {
            info(`consumerScore event received without related consumer: ${consumerId}`);
            break;
          }

          this._consumerStats[consumerId] = this._consumerStats[consumerId] || {};
          this._consumerStats[consumerId]["score"] = score;
        }
      }
    });

    return new Promise((resolve, reject) => {
      this._protoo.on("open", async () => {
        this.emitRTCEvent("info", "Signaling", () => `Open`);

        try {
          await this._joinRoom();
          resolve();
          this.emit(SFU_CONNECTION_CONNECTED);
        } catch (err) {
          this.emitRTCEvent("warn", "Adapter", () => `Error during connect: ${error}`);
          reject(err);
          this.emit(SFU_CONNECTION_ERROR_FATAL);
        }
      });
    });
  }

  async _retryConnectWithNewHost(): Promise<void> {
    this.cleanUpLocalState();
    this._protoo.removeAllListeners();
    const { host, port, turn } = await APP.hubChannel.getHost();
    if (this._config.host === host && this._config.port === port) {
      console.error("Reconnect to dialog failed.");
      this.emit(SFU_CONNECTION_ERROR_FATAL);
      return;
    }
    console.log(`The Dialog server has changed to wss://${host}:${port}, reconnecting with the new server...`);
    await this.connect(withDialogHost(this._config, { host, port, turn }));
  }

  removeConsumer(consumerId: string): void {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return;
    this.emitRTCEvent("info", "RTC", () => `Consumer removed: ${consumerId}`);
    const consumer = this._consumers.get(consumerId);
    if (consumer) this.media.removeRemoteTrack(consumer.appData.peerId, consumer.track);
    this._consumers.delete(consumerId);
  }

  removeDataProducer(dataProducerId: string): void {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    this.emitRTCEvent("info", "RTC", () => `DataProducer removed: ${dataProducerId}`);
    this._dataProducers.delete(dataProducerId);
  }

  removeDataConsumer(dataConsumerId: string): void {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return;
    this.emitRTCEvent("info", "RTC", () => `DataConsumer removed: ${dataConsumerId}`);
    this._dataConsumers.delete(dataConsumerId);
  }

  async createSendTransport(iceServers: RTCIceServer[]): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;
    // Create mediasoup Transport for sending (unless we don't want to produce).
    const sendTransportInfo = await this._protoo.request("createWebRtcTransport", {
      forceTcp: this._config.forceTcp,
      producing: true,
      consuming: false,
      sctpCapabilities: { OS: 1024, MIS: 1024 }
    });

    this._sendTransport = this._mediasoupDevice.createSendTransport({
      id: sendTransportInfo.id,
      iceParameters: sendTransportInfo.iceParameters,
      iceCandidates: sendTransportInfo.iceCandidates,
      dtlsParameters: sendTransportInfo.dtlsParameters,
      sctpParameters: sendTransportInfo.sctpParameters,
      iceServers,
      iceTransportPolicy: this._config.iceTransportPolicy,
      proprietaryConstraints: PC_PROPRIETARY_CONSTRAINTS
    });

    this._sendTransport.on(
      "connect",
      (
        { dtlsParameters }: { dtlsParameters: any },
        callback: () => void,
        errback: (err: Error) => void // eslint-disable-line no-shadow
      ) => {
        this.emitRTCEvent("info", "RTC", () => `Send transport [connect]`);
        this._sendTransport.observer.on("close", () => {
          this.emitRTCEvent("info", "RTC", () => `Send transport [close]`);
        });
        this._sendTransport.observer.on("newproducer", (producer: any) => {
          this.emitRTCEvent("info", "RTC", () => `Send transport [newproducer]: ${producer.id}`);
        });
        this._sendTransport.observer.on("newconsumer", (consumer: any) => {
          this.emitRTCEvent("info", "RTC", () => `Send transport [newconsumer]: ${consumer.id}`);
        });

        this._protoo
          .request("connectWebRtcTransport", {
            transportId: this._sendTransport.id,
            dtlsParameters
          })
          .then(callback)
          .catch(errback);
      }
    );

    this._sendTransport.on("connectionstatechange", (connectionState: string) => {
      let level = "info";
      if (connectionState === "failed" || connectionState === "disconnected") {
        level = "error";
      }
      this.emitRTCEvent(level, "RTC", () => `Send transport [connectionstatechange]: ${connectionState}`);

      this.checkSendIceStatus(connectionState);
    });

    this._sendTransport.on(
      "produce",
      async (
        { kind, rtpParameters, appData }: any,
        callback: (params: { id: string }) => void,
        errback: (err: Error) => void
      ) => {
        this.emitRTCEvent("info", "RTC", () => `Send transport [produce]: ${kind}`);
        try {
          // eslint-disable-next-line no-shadow
          const { id } = await this._protoo.request("produce", {
            transportId: this._sendTransport.id,
            kind,
            rtpParameters,
            appData
          });

          callback({ id });
        } catch (error) {
          this.emitRTCEvent("error", "Signaling", () => `[produce] error: ${error}`);
          errback(error as Error);
        }
      }
    );

    this._sendTransport.on(
      "producedata",
      async (parameters: any, callback: (params: { id: string }) => void, errback: (err: Error) => void) => {
        this.emitRTCEvent("info", "RTC", () => `Send transport [produceData]`);
        try {
          const id = await this._protoo.request("produceData", {
            transportId: this._sendTransport.id,
            ...parameters
          });
          callback({ id });
        } catch (error) {
          this.emitRTCEvent("error", "Signaling", () => `[produceData] error: ${error}`);
          errback(error as Error);
        }
      }
    );
  }

  async closeSendTransport(): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.RECV) return;

    if (this._micProducer) {
      this._micProducer.close();
      this._protoo?.connected && this._protoo?.request("closeProducer", { producerId: this._micProducer.id });
      this._micProducer = null;
    }

    if (this._cameraProducer) {
      this._cameraProducer.close();
      this._protoo?.connected && this._protoo?.request("closeProducer", { producerId: this._cameraProducer.id });
      this._cameraProducer = null;
    }

    if (this._shareProducer) {
      this._shareProducer.close();
      this._protoo?.connected && this._protoo?.request("closeProducer", { producerId: this._shareProducer.id });
      this._shareProducer = null;
    }

    this.media.forgetLocalTracks();

    // TODO: If _sendTransport is falsey then return
    const transportId = this._sendTransport?.id;
    if (this._sendTransport && !this._sendTransport._closed) {
      this._sendTransport.close();
      this._sendTransport = null;
    }

    if (this._protoo?.connected) {
      try {
        await this._protoo.request("closeWebRtcTransport", { transportId });
      } catch (err) {
        error(err);
      }
    }
  }

  async createRecvTransport(iceServers: RTCIceServer[]): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return;
    // Create mediasoup Transport for sending (unless we don't want to consume).
    const recvTransportInfo = await this._protoo.request("createWebRtcTransport", {
      forceTcp: this._config.forceTcp,
      producing: false,
      consuming: true,
      sctpCapabilities: { OS: 1024, MIS: 1024 }
    });

    this._recvTransport = this._mediasoupDevice.createRecvTransport({
      id: recvTransportInfo.id,
      iceParameters: recvTransportInfo.iceParameters,
      iceCandidates: recvTransportInfo.iceCandidates,
      dtlsParameters: recvTransportInfo.dtlsParameters,
      sctpParameters: recvTransportInfo.sctpParameters,
      iceServers,
      iceTransportPolicy: this._config.iceTransportPolicy
    });

    this._recvTransport.on(
      "connect",
      (
        { dtlsParameters }: { dtlsParameters: any },
        callback: () => void,
        errback: (err: Error) => void // eslint-disable-line no-shadow
      ) => {
        this.emitRTCEvent("info", "RTC", () => `Receive transport [connect]`);
        this._recvTransport.observer.on("close", () => {
          this.emitRTCEvent("info", "RTC", () => `Receive transport [close]`);
        });
        this._recvTransport.observer.on("newproducer", (producer: any) => {
          this.emitRTCEvent("info", "RTC", () => `Receive transport [newproducer]: ${producer.id}`);
        });
        this._recvTransport.observer.on("newconsumer", (consumer: any) => {
          this.emitRTCEvent("info", "RTC", () => `Receive transport [newconsumer]: ${consumer.id}`);
        });

        this._protoo
          .request("connectWebRtcTransport", {
            transportId: this._recvTransport.id,
            dtlsParameters
          })
          .then(callback)
          .catch(errback);
      }
    );

    this._recvTransport.on("connectionstatechange", (connectionState: string) => {
      let level = "info";
      if (connectionState === "failed" || connectionState === "disconnected") {
        level = "error";
      }
      this.emitRTCEvent(level, "RTC", () => `Receive transport [connectionstatechange]: ${connectionState}`);

      this.checkRecvIceStatus(connectionState);
    });
  }

  async closeRecvTransport(): Promise<void> {
    if (this._connectionType === SFU_CONNECTION_TYPE.SEND) return;
    const transportId = this._recvTransport?.id;
    if (this._recvTransport && !this._recvTransport._closed) {
      this._recvTransport.close();
      this._recvTransport = null;
    }
    if (this._protoo?.connected) {
      try {
        await this._protoo.request("closeWebRtcTransport", { transportId });
      } catch (err) {
        error(err);
      }
    }
  }

  async _joinRoom(): Promise<void> {
    debug("_joinRoom()");

    this._mediasoupDevice = new mediasoupClient.Device({});

    const routerRtpCapabilities = await this._protoo.request("getRouterRtpCapabilities");

    await this._mediasoupDevice.load({ routerRtpCapabilities });

    const { host, port, turn } = this._config;
    const iceServers = this.getIceServers(host, port, turn);

    if (this._connectionType !== SFU_CONNECTION_TYPE.RECV) await this.createSendTransport(iceServers);
    if (this._connectionType !== SFU_CONNECTION_TYPE.SEND) await this.createRecvTransport(iceServers);

    await this._protoo.request("join", {
      displayName: this._clientId,
      rtpCapabilities: this._mediasoupDevice.rtpCapabilities,
      sctpCapabilities: this._useDataChannel ? this._mediasoupDevice.sctpCapabilities : undefined,
      token: APP.hubChannel.token
    });

    const localStream = this.media.localStream;
    if (localStream) {
      // TODO: Refactor to be "Create producers"
      await this.setLocalMediaStream(localStream);
    }
  }

  protected beforeLocalStreamApplied(stream: MediaStream): boolean {
    if (!this._sendTransport) {
      console.error("Tried to setLocalMediaStream before a _sendTransport existed");
      if (!this.media.localStream) this.media.rememberLocalStream(stream);
      return false;
    }
    this.emitRTCEvent("info", "RTC", () => `Creating missing producers`);
    return true;
  }

  protected async publishTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void> {
    switch (kind) {
      case "microphone":
        await this.produceMicrophone(track);
        break;
      case "camera":
        await this.produceCamera(track);
        break;
      case "screen":
        await this.produceShare(track);
        break;
    }
  }

  protected async replaceTrack(kind: LocalTrackKind, track: MediaStreamTrack): Promise<void> {
    if (kind === "microphone") {
      this._micProducer.track.stop();
      this._micProducer.replaceTrack(track);
      return;
    }
    await this.unpublishTrack(kind);
    await this.publishTrack(kind, track);
  }

  protected async unpublishTrack(kind: LocalTrackKind): Promise<void> {
    // The producers are closed at once; telling the server is not awaited, as before
    switch (kind) {
      case "microphone":
        this.closeMicrophoneProducer();
        break;
      case "camera":
        this.closeCameraProducer();
        break;
      case "screen":
        this.closeShareProducer();
        break;
    }
  }

  protected async afterLocalStreamApplied(): Promise<void> {
    // DataChannel implementation. The DataProducers are created with the label only, so every
    // channel is ordered and reliable for now; the ordered / maxRetransmits values from the
    // channel table will be passed in a later stage together with sequence numbers.
    await Promise.all(
      dataChannelLabels().map(async label => {
        const dataProducer = await this._sendTransport.produceData({ label });

        dataProducer.on("transportclose", () => {
          this.emitRTCEvent("error", "RTC", () => `DataProducer transport closed. Channel: #${label}`);
          this.removeDataProducer(dataProducer.id);
        });

        this._dataProducers.set(label, dataProducer);
        if (!this._clientId.includes("PS-") || this._roomId === "public_speaking") {
          this._avatarSyncHelper.handleSyncInit(label);
        }
      })
    );

    // TODO: move to other appropriate place
    if (this && this._clientId.includes("PS-") && this._roomId === "public_speaking") {
      this._sendSelfAvatarSrcIntervalId = setInterval(() => this._avatarSyncHelper.sendSelfAvatarSrc(), 1000);
    }
  }

  private async produceMicrophone(track: MediaStreamTrack): Promise<void> {
    // stopTracks = false because otherwise the track will end during a temporary disconnect
    this._micProducer = await this._sendTransport.produce({
      track,
      pause: !this.media.micShouldBeEnabled,
      stopTracks: false,
      codecOptions: { opusStereo: false, opusDtx: true },
      zeroRtpOnPause: true,
      disableTrackOnPause: true
    });

    this._micProducer.on("transportclose", () => {
      this.emitRTCEvent("info", "RTC", () => `Mic transport closed`);
      this._micProducer = null;
    });

    this.emit("mic-state-changed", { enabled: this.isMicEnabled });
  }

  private closeMicrophoneProducer(): void {
    if (!this._micProducer) return;
    this._protoo.request("closeProducer", { producerId: this._micProducer.id });
    this._micProducer.close();
    this._micProducer = null;
  }

  private async produceCamera(track: MediaStreamTrack): Promise<void> {
    // stopTracks = false because otherwise the track will end during a temporary disconnect
    this._cameraProducer = await this._sendTransport.produce({
      track,
      stopTracks: false,
      codecOptions: { videoGoogleStartBitrate: 1000 },
      encodings: WEBCAM_SIMULCAST_ENCODINGS,
      zeroRtpOnPause: true,
      disableTrackOnPause: true
    });

    this._cameraProducer.on("transportclose", () => {
      this.emitRTCEvent("info", "RTC", () => `Camera transport closed`);
      this.closeCameraProducer();
    });
    this._cameraProducer.observer.on("trackended", () => {
      this.emitRTCEvent("info", "RTC", () => `Camera track ended`);
      this.closeCameraProducer();
    });
  }

  private async closeCameraProducer(): Promise<void> {
    if (!this._cameraProducer) return;

    this._cameraProducer.close();

    try {
      if (!this._sendTransport.closed) {
        await this._protoo.request("closeProducer", { producerId: this._cameraProducer.id });
      }
    } catch (error) {
      console.error(`disableCamera(): ${error}`);
    }

    this._cameraProducer = null;
  }

  private async produceShare(track: MediaStreamTrack): Promise<void> {
    // stopTracks = false because otherwise the track will end during a temporary disconnect
    this._shareProducer = await this._sendTransport.produce({
      track,
      stopTracks: false,
      codecOptions: { videoGoogleStartBitrate: 1000 },
      encodings: SCREEN_SHARING_SIMULCAST_ENCODINGS,
      zeroRtpOnPause: true,
      disableTrackOnPause: true,
      appData: {
        share: true
      }
    });

    this._shareProducer.on("transportclose", () => {
      this.emitRTCEvent("info", "RTC", () => `Desktop Share transport closed`);
      this.closeShareProducer();
    });
    this._shareProducer.observer.on("trackended", () => {
      this.emitRTCEvent("info", "RTC", () => `Desktop Share transport track ended`);
      this.closeShareProducer();
    });
  }

  private async closeShareProducer(): Promise<void> {
    if (!this._shareProducer) return;

    this._shareProducer.close();

    try {
      if (!this._sendTransport.closed) {
        await this._protoo.request("closeProducer", { producerId: this._shareProducer.id });
      }
    } catch (error) {
      console.error(`disableShare(): ${error}`);
    }

    this._shareProducer = null;
  }

  protected setMicEnabled(enabled: boolean): boolean {
    if (!this._micProducer) {
      console.error("Tried to toggle mic but there's no producer.");
      return false;
    }

    if (enabled && !this.isMicEnabled) {
      this._micProducer.resume();
      this._protoo.request("resumeProducer", { producerId: this._micProducer.id });
    } else if (!enabled && this.isMicEnabled) {
      this._micProducer.pause();
      this._protoo.request("pauseProducer", { producerId: this._micProducer.id });
    }
    return true;
  }

  protected micEnabled(): boolean | null {
    return this._micProducer && !this._micProducer.paused;
  }

  cleanUpLocalState(): void {
    this._sendTransport && this._sendTransport.close();
    this._sendTransport = null;
    this._recvTransport && this._recvTransport.close();
    this._recvTransport = null;
    this._micProducer = null;
    this._shareProducer = null;
    this._cameraProducer = null;
    this.media.forgetLocalTracks();
  }

  disconnect(): void {
    debug("disconnect()");
    this.cleanUpLocalState();
    if (this._protoo) {
      this._protoo.removeAllListeners();
      if (this._protoo.connected) {
        this._protoo.close();
        this.emitRTCEvent("info", "Signaling", () => `[close]`);
      }
    }
    if (this._sendSelfAvatarSrcIntervalId) clearInterval(this._sendSelfAvatarSrcIntervalId);
    this._avatarSyncHelper?.stopSyncing();
    this.cleanupDispatcher();
  }

  kick(clientId: string): Promise<void> {
    return this._protoo
      .request("kick", {
        room_id: this._roomId,
        user_id: clientId,
        token: APP.hubChannel.token
      })
      .then(() => {
        document.body.dispatchEvent(new CustomEvent("kicked", { detail: { clientId: clientId } }));
      });
  }

  block(clientId: string): Promise<void> {
    return this._protoo.request("block", { whom: clientId }).then(() => {
      this._blockedClients.set(clientId, true);
      document.body.dispatchEvent(new CustomEvent("blocked", { detail: { clientId: clientId } }));
    });
  }

  unblock(clientId: string): Promise<void> {
    return this._protoo.request("unblock", { whom: clientId }).then(() => {
      this._blockedClients.delete(clientId);
      document.body.dispatchEvent(new CustomEvent("unblocked", { detail: { clientId: clientId } }));
    });
  }

  protected sendData(label: string, data: Uint8Array): void {
    this._dataProducers?.get(label)?.send(data);
  }

  emitRTCEvent(level: string, tag: string, msgFunc: () => string): void {
    if (!window.APP.store.state.preferences.showRtcDebugPanel) return;
    const time = new Date().toLocaleTimeString("en-US", {
      hour12: false,
      hour: "numeric",
      minute: "numeric",
      second: "numeric"
    });
    this.scene.emit("rtc_event", { level, tag, time, msg: msgFunc() });
  }
}
