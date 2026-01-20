/**
 * LibpeerDeviceAdapter - Wraps a single RTCPeerConnection to an external IoT device
 *
 * Manages WebRTC connection lifecycle and DataChannel communication with
 * devices running libpeer (ESP32, Raspberry Pi, etc.)
 */

import EventEmitter from "eventemitter3";
import {
  IoTDeviceInfo,
  IoTMessage,
  DEFAULT_ICE_SERVERS,
  IOT_DATACHANNEL_LABEL
} from "./iot-types";

export interface LibpeerDeviceAdapterEvents {
  ice_candidate: (deviceId: string, candidate: RTCIceCandidate) => void;
  connection_state_change: (deviceId: string, state: RTCPeerConnectionState) => void;
  connected: (deviceId: string) => void;
  disconnected: (deviceId: string) => void;
  datachannel_open: (deviceId: string) => void;
  datachannel_close: (deviceId: string) => void;
  message: (deviceId: string, message: IoTMessage) => void;
  raw_message: (deviceId: string, data: string | ArrayBuffer) => void;
  error: (deviceId: string, error: Error) => void;
}

export class LibpeerDeviceAdapter extends EventEmitter<LibpeerDeviceAdapterEvents> {
  private pc: RTCPeerConnection;
  private dataChannel: RTCDataChannel | null = null;
  private deviceId: string;
  private deviceInfo: IoTDeviceInfo | null = null;
  private _connectedAt: number | null = null;
  private textEncoder: TextEncoder;
  private textDecoder: TextDecoder;

  constructor(deviceId: string, iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS) {
    super();
    this.deviceId = deviceId;
    this.textEncoder = new TextEncoder();
    this.textDecoder = new TextDecoder();

    this.pc = new RTCPeerConnection({ iceServers });
    this.setupPeerConnection();
  }

  private setupPeerConnection(): void {
    this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        this.emit("ice_candidate", this.deviceId, event.candidate);
      }
    };

    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      this.emit("connection_state_change", this.deviceId, state);

      if (state === "connected") {
        this._connectedAt = Date.now();
        this.emit("connected", this.deviceId);
      } else if (state === "disconnected" || state === "failed" || state === "closed") {
        this._connectedAt = null;
        this.emit("disconnected", this.deviceId);
      }
    };

    this.pc.ondatachannel = (event: RTCDataChannelEvent) => {
      this.setupDataChannel(event.channel);
    };

    this.pc.onicegatheringstatechange = () => {
      console.log(`[LibpeerDevice ${this.deviceId}] ICE gathering state: ${this.pc.iceGatheringState}`);
    };

    this.pc.oniceconnectionstatechange = () => {
      console.log(`[LibpeerDevice ${this.deviceId}] ICE connection state: ${this.pc.iceConnectionState}`);
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    channel.binaryType = "arraybuffer";

    channel.onopen = () => {
      console.log(`[LibpeerDevice ${this.deviceId}] DataChannel opened`);
      this.emit("datachannel_open", this.deviceId);
    };

    channel.onclose = () => {
      console.log(`[LibpeerDevice ${this.deviceId}] DataChannel closed`);
      this.emit("datachannel_close", this.deviceId);
    };

    channel.onerror = (event) => {
      console.error(`[LibpeerDevice ${this.deviceId}] DataChannel error:`, event);
      this.emit("error", this.deviceId, new Error("DataChannel error"));
    };

    channel.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(data: string | ArrayBuffer): void {
    try {
      const text = typeof data === "string" ? data : this.textDecoder.decode(data as ArrayBuffer);
      const message: IoTMessage = JSON.parse(text);

      if (message.type === "register" && "payload" in message) {
        this.deviceInfo = message.payload as IoTDeviceInfo;
        console.log(`[LibpeerDevice ${this.deviceId}] Device registered:`, this.deviceInfo);
      }

      this.emit("message", this.deviceId, message);
    } catch (e) {
      // Not valid JSON, emit as raw message
      this.emit("raw_message", this.deviceId, data);
    }
  }

  /**
   * Create an SDP offer to initiate connection to device (browser is offerer)
   */
  async createOffer(): Promise<RTCSessionDescriptionInit> {
    // Create DataChannel from browser side (we are the offerer)
    const channel = this.pc.createDataChannel(IOT_DATACHANNEL_LABEL, {
      ordered: true
    });
    this.setupDataChannel(channel);

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    return offer;
  }

  /**
   * Handle an SDP offer from device (device is offerer, browser answers)
   */
  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  /**
   * Handle an SDP answer from device (browser was offerer)
   */
  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Add an ICE candidate from the remote device
   */
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (e) {
      console.warn(`[LibpeerDevice ${this.deviceId}] Failed to add ICE candidate:`, e);
    }
  }

  /**
   * Send a message to the device via DataChannel
   */
  send(message: IoTMessage | string): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      console.warn(`[LibpeerDevice ${this.deviceId}] Cannot send: DataChannel not open`);
      return false;
    }

    try {
      const data = typeof message === "string" ? message : JSON.stringify(message);
      this.dataChannel.send(data);
      return true;
    } catch (e) {
      console.error(`[LibpeerDevice ${this.deviceId}] Send failed:`, e);
      return false;
    }
  }

  /**
   * Send binary data to the device via DataChannel
   */
  sendBinary(data: ArrayBuffer | Uint8Array): boolean {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      console.warn(`[LibpeerDevice ${this.deviceId}] Cannot send: DataChannel not open`);
      return false;
    }

    try {
      this.dataChannel.send(data);
      return true;
    } catch (e) {
      console.error(`[LibpeerDevice ${this.deviceId}] Send binary failed:`, e);
      return false;
    }
  }

  /**
   * Close the connection to the device
   */
  close(): void {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    this.pc.close();
    this._connectedAt = null;
  }

  get id(): string {
    return this.deviceId;
  }

  get state(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  get iceState(): RTCIceConnectionState {
    return this.pc.iceConnectionState;
  }

  get info(): IoTDeviceInfo | null {
    return this.deviceInfo;
  }

  get connectedAt(): number | null {
    return this._connectedAt;
  }

  get isConnected(): boolean {
    return this.pc.connectionState === "connected";
  }

  get isDataChannelOpen(): boolean {
    return this.dataChannel?.readyState === "open";
  }
}
