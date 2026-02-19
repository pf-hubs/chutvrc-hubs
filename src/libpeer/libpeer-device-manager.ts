/**
 * LibpeerDeviceManager - Manages multiple IoT device connections via WebRTC DataChannel
 *
 * This class handles:
 * - Creating/destroying RTCPeerConnection instances per device
 * - Signaling through Phoenix channel (via HubChannel)
 * - Routing messages between devices and the hubs application
 */

import EventEmitter from "eventemitter3";
import { LibpeerDeviceAdapter } from "./libpeer-device-adapter";
import {
  IoTMessage,
  DeviceSignalingOffer,
  DeviceSignalingAnswer,
  DeviceSignalingIceCandidate,
  DeviceConnectionState,
  DEFAULT_ICE_SERVERS
} from "./iot-types";

export interface LibpeerDeviceManagerEvents {
  device_added: (deviceId: string) => void;
  device_connected: (deviceId: string) => void;
  device_disconnected: (deviceId: string) => void;
  device_removed: (deviceId: string) => void;
  device_message: (deviceId: string, message: IoTMessage) => void;
  error: (deviceId: string, error: Error) => void;
}

interface PhoenixPushResponse {
  receive: (status: string, callback: (response: unknown) => void) => PhoenixPushResponse;
}

interface HubChannelLike {
  channel: {
    push: (event: string, payload: Record<string, unknown>) => PhoenixPushResponse;
    on: (event: string, callback: (payload: unknown) => void) => void;
  };
}

export class LibpeerDeviceManager extends EventEmitter<LibpeerDeviceManagerEvents> {
  private devices: Map<string, LibpeerDeviceAdapter> = new Map();
  private hubChannel: HubChannelLike | null = null;
  private iceServers: RTCIceServer[];
  private _initialized: boolean = false;

  constructor(iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS) {
    super();
    this.iceServers = iceServers;
  }

  /**
   * Initialize the device manager with a HubChannel instance
   * This sets up signaling handlers on the Phoenix channel
   */
  init(hubChannel: HubChannelLike): void {
    if (this._initialized) {
      console.warn("[LibpeerDeviceManager] Already initialized");
      return;
    }

    this.hubChannel = hubChannel;
    this.setupSignalingHandlers();
    this._initialized = true;
    console.log("[LibpeerDeviceManager] Initialized with hub channel");
  }

  private setupSignalingHandlers(): void {
    if (!this.hubChannel) return;

    const channel = this.hubChannel.channel;

    // Handle device SDP offer (device wants to connect)
    channel.on("device:offer", (payload: unknown) => {
      const { device_id, offer } = payload as DeviceSignalingOffer;
      this.handleDeviceOffer(device_id, offer);
    });

    // Handle device SDP answer (response to our offer)
    channel.on("device:answer", (payload: unknown) => {
      const { device_id, answer } = payload as DeviceSignalingAnswer;
      this.handleDeviceAnswer(device_id, answer);
    });

    // Handle ICE candidate from device
    channel.on("device:ice_candidate", (payload: unknown) => {
      const { device_id, candidate } = payload as DeviceSignalingIceCandidate;
      this.handleDeviceIceCandidate(device_id, candidate);
    });

    // Handle device disconnect notification
    channel.on("device:disconnect", (payload: unknown) => {
      const { device_id } = payload as { device_id: string };
      this.handleDeviceDisconnect(device_id);
    });

    // Handle device list update (devices available in room)
    channel.on("device:list", (payload: unknown) => {
      const { devices } = payload as { devices: string[] };
      console.log("[LibpeerDeviceManager] Devices in room:", devices);
    });
  }

  private async handleDeviceOffer(deviceId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    console.log(`[LibpeerDeviceManager] Received offer from device: ${deviceId}`);

    let adapter = this.devices.get(deviceId);
    if (!adapter) {
      adapter = this.createDeviceAdapter(deviceId);
    }

    try {
      const answer = await adapter.handleOffer(offer);
      this.sendSignaling("device:answer", { device_id: deviceId, answer });
    } catch (e) {
      console.error(`[LibpeerDeviceManager] Failed to handle offer from ${deviceId}:`, e);
      this.emit("error", deviceId, e as Error);
    }
  }

  private async handleDeviceAnswer(deviceId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const adapter = this.devices.get(deviceId);
    if (!adapter) {
      return;
    }

    // Only handle answer if we were the offerer (we initiated the connection)
    // If we were the answerer (device sent offer), ignore incoming answers
    if (!adapter.isOfferer) {
      console.log(`[LibpeerDeviceManager] Ignoring answer for ${deviceId} - we were not the offerer`);
      return;
    }

    console.log(`[LibpeerDeviceManager] Received answer from device: ${deviceId}`);

    try {
      await adapter.handleAnswer(answer);
    } catch (e) {
      console.error(`[LibpeerDeviceManager] Failed to handle answer from ${deviceId}:`, e);
      this.emit("error", deviceId, e as Error);
    }
  }

  private async handleDeviceIceCandidate(
    deviceId: string,
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    const adapter = this.devices.get(deviceId);
    if (adapter) {
      await adapter.addIceCandidate(candidate);
    }
  }

  private handleDeviceDisconnect(deviceId: string): void {
    console.log(`[LibpeerDeviceManager] Device disconnect notification: ${deviceId}`);
    this.disconnectDevice(deviceId);
  }

  private createDeviceAdapter(deviceId: string): LibpeerDeviceAdapter {
    const adapter = new LibpeerDeviceAdapter(deviceId, this.iceServers);

    // Forward ICE candidates to signaling
    adapter.on("ice_candidate", (id, candidate) => {
      this.sendSignaling("device:ice_candidate", {
        device_id: id,
        candidate: candidate.toJSON()
      });
    });

    // Handle incoming messages
    adapter.on("message", (id, message) => {
      this.emit("device_message", id, message);
    });

    // Connection state events
    adapter.on("connected", (id) => {
      console.log(`[LibpeerDeviceManager] Device connected: ${id}`);
      this.emit("device_connected", id);
    });

    adapter.on("disconnected", (id) => {
      console.log(`[LibpeerDeviceManager] Device disconnected: ${id}`);
      this.emit("device_disconnected", id);
      this.devices.delete(id);
      this.emit("device_removed", id);
    });

    adapter.on("error", (id, error) => {
      this.emit("error", id, error);
    });

    this.devices.set(deviceId, adapter);
    this.emit("device_added", deviceId);
    console.log(`[LibpeerDeviceManager] Created adapter for device: ${deviceId}`);

    return adapter;
  }

  private sendSignaling(event: string, payload: Record<string, unknown>): void {
    if (!this.hubChannel) {
      console.warn("[LibpeerDeviceManager] Cannot send signaling: not initialized");
      return;
    }

    this.hubChannel.channel
      .push(event, payload)
      .receive("error", (err: unknown) => {
        console.error(`[LibpeerDeviceManager] Signaling error for ${event}:`, err);
      });
  }

  // ========== Public API ==========

  /**
   * Initiate a connection to a device (browser sends offer)
   */
  async initiateConnection(deviceId: string): Promise<void> {
    if (!this.hubChannel) {
      throw new Error("LibpeerDeviceManager not initialized");
    }

    console.log(`[LibpeerDeviceManager] Initiating connection to device: ${deviceId}`);

    const adapter = this.createDeviceAdapter(deviceId);

    try {
      const offer = await adapter.createOffer();
      this.sendSignaling("device:offer", { device_id: deviceId, offer });
    } catch (e) {
      console.error(`[LibpeerDeviceManager] Failed to create offer for ${deviceId}:`, e);
      this.devices.delete(deviceId);
      throw e;
    }
  }

  /**
   * Send a message to a specific device
   */
  sendToDevice(deviceId: string, message: IoTMessage): boolean {
    const adapter = this.devices.get(deviceId);
    if (!adapter) {
      console.warn(`[LibpeerDeviceManager] Device not found: ${deviceId}`);
      return false;
    }
    return adapter.send(message);
  }

  /**
   * Send a request to a device
   * @param deviceId Target device ID
   * @param label Label for message routing (used by bridge layer)
   * @param payload The payload to send
   */
  sendRequest(deviceId: string, label: string, payload: Record<string, unknown>): boolean {
    const message: IoTMessage = {
      type: "request",
      label,
      payload
    };
    return this.sendToDevice(deviceId, message);
  }

  /**
   * Broadcast a message to all connected devices
   */
  broadcastToDevices(message: IoTMessage): void {
    this.devices.forEach((adapter) => {
      adapter.send(message);
    });
  }

  /**
   * Broadcast a request to all devices
   * @param label Label for message routing (used by bridge layer)
   * @param payload The payload to send
   */
  broadcastRequest(label: string, payload: Record<string, unknown>): void {
    const message: IoTMessage = {
      type: "request",
      label,
      payload
    };
    this.devices.forEach((adapter) => {
      adapter.send(message);
    });
  }

  /**
   * Disconnect a specific device
   */
  disconnectDevice(deviceId: string): void {
    const adapter = this.devices.get(deviceId);
    if (adapter) {
      adapter.close();
      this.devices.delete(deviceId);
      this.emit("device_disconnected", deviceId);
      this.emit("device_removed", deviceId);
    }
  }

  /**
   * Get list of connected device IDs
   */
  getConnectedDevices(): string[] {
    return Array.from(this.devices.keys()).filter((id) => {
      const adapter = this.devices.get(id);
      return adapter?.isConnected;
    });
  }

  /**
   * Get all device IDs (including connecting)
   */
  getAllDevices(): string[] {
    return Array.from(this.devices.keys());
  }

  /**
   * Get connection state for a device
   */
  getDeviceState(deviceId: string): DeviceConnectionState | null {
    const adapter = this.devices.get(deviceId);
    if (!adapter) return null;

    return {
      device_id: deviceId,
      state: adapter.state,
      connectedAt: adapter.connectedAt
    };
  }

  /**
   * Request list of available devices in the room from the server
   */
  async getDevicesInRoom(): Promise<string[]> {
    if (!this.hubChannel) {
      throw new Error("LibpeerDeviceManager not initialized");
    }

    return new Promise((resolve, reject) => {
      this.hubChannel!.channel
        .push("device:list", {})
        .receive("ok", (response: unknown) => {
          const { devices } = response as { devices: string[] };
          resolve(devices);
        })
        .receive("error", (err: unknown) => {
          reject(new Error(`Failed to get devices: ${JSON.stringify(err)}`));
        });
    });
  }

  /**
   * Check if manager is initialized
   */
  get initialized(): boolean {
    return this._initialized;
  }

  /**
   * Get count of connected devices
   */
  get connectedCount(): number {
    return this.getConnectedDevices().length;
  }

  /**
   * Clean up all connections and resources
   */
  destroy(): void {
    this.devices.forEach((adapter) => adapter.close());
    this.devices.clear();
    this.removeAllListeners();
    this._initialized = false;
    this.hubChannel = null;
    console.log("[LibpeerDeviceManager] Destroyed");
  }
}

// Singleton instance for global access
let _instance: LibpeerDeviceManager | null = null;

export function getLibpeerDeviceManager(): LibpeerDeviceManager {
  if (!_instance) {
    _instance = new LibpeerDeviceManager();
  }
  return _instance;
}

export function destroyLibpeerDeviceManager(): void {
  if (_instance) {
    _instance.destroy();
    _instance = null;
  }
}
