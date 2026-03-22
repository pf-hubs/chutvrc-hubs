/**
 * BridgeManager - Orchestrates bidirectional communication between IoT devices and SFU
 *
 * Data Flow:
 * IoT Device <-> LibpeerDeviceManager <-> BridgeManager <-> SfuAdapter <-> Remote Clients
 *
 * Features:
 * - Label-based subscription system for message filtering
 * - Bidirectional message routing
 * - Adapter-agnostic design (works with Dialog, Sora, Livekit, etc.)
 */

import EventEmitter from "eventemitter3";
import { LibpeerDeviceManager } from "../libpeer-device-manager";
import { IoTMessage } from "../iot-types";
import { SfuAdapter } from "../../sfu-adapters/sfu-adapter";
import { BridgeCapable, BridgeEnvelope, BridgeMessageCallback, isBridgeCapable } from "./bridge-capable";
import {
  createDeviceToRoomEnvelope,
  createRoomToDeviceEnvelope,
  serializeBridgeEnvelope,
  extractPayload
} from "./bridge-message-protocol";

/**
 * Events emitted by BridgeManager
 */
export interface BridgeManagerEvents {
  /** Emitted when a device message is received (filtered by subscription) */
  device_message: (label: string, deviceId: string, payload: string | ArrayBuffer) => void;
  /** Emitted when subscriptions change */
  subscription_changed: (labels: string[]) => void;
  /** Emitted when a device message is forwarded to the room */
  device_message_forwarded: (deviceId: string, envelope: BridgeEnvelope) => void;
  /** Emitted when a room message is forwarded to device(s) */
  room_message_forwarded: (envelope: BridgeEnvelope) => void;
  /** Emitted on errors */
  error: (error: Error, context: string) => void;
  /** Emitted when the bridge is ready */
  bridge_ready: () => void;
  /** Emitted when the bridge is disconnected */
  bridge_disconnected: () => void;
  /** Emitted when adapter changes */
  adapter_changed: (adapter: SfuAdapter & BridgeCapable) => void;
}

/**
 * Configuration options for BridgeManager
 */
export interface BridgeManagerConfig {
  /** Forward device messages to room (default: true) */
  forwardDeviceToRoom: boolean;
  /** Forward room messages to devices (default: true) */
  forwardRoomToDevice: boolean;
  /** Enable debug logging (default: false) */
  debug: boolean;
  /** Receive all messages regardless of subscription (default: false, for testing) */
  receiveAllMessages: boolean;
}

const DEFAULT_CONFIG: BridgeManagerConfig = {
  forwardDeviceToRoom: true,
  forwardRoomToDevice: true,
  debug: false,
  receiveAllMessages: false
};

/**
 * BridgeManager class - Core orchestrator for IoT bridge communication
 */
export class BridgeManager extends EventEmitter<BridgeManagerEvents> {
  private deviceManager: LibpeerDeviceManager | null = null;
  private sfuAdapter: (SfuAdapter & BridgeCapable) | null = null;
  private config: BridgeManagerConfig;
  private _initialized = false;

  /** Set of labels this client is subscribed to */
  private subscriptions: Set<string> = new Set();

  /** Bound handler for SFU bridge messages */
  private boundHandleBridgeMessage: BridgeMessageCallback;

  /** Bound handler for device messages */
  private boundHandleDeviceMessage: (deviceId: string, message: IoTMessage) => void;

  constructor(config: Partial<BridgeManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.boundHandleBridgeMessage = this.handleBridgeMessage.bind(this);
    this.boundHandleDeviceMessage = this.handleDeviceMessage.bind(this);
  }

  // ========== Lifecycle Methods ==========

  /**
   * Initialize the bridge with device manager and SFU adapter
   * @param deviceManager The libpeer device manager
   * @param sfuAdapter The SFU adapter (must implement BridgeCapable)
   */
  init(deviceManager: LibpeerDeviceManager, sfuAdapter: SfuAdapter): void {
    if (this._initialized) {
      this.log("warn", "Already initialized, call destroy() first");
      return;
    }

    this.deviceManager = deviceManager;

    // Verify SFU adapter implements BridgeCapable
    if (!isBridgeCapable(sfuAdapter)) {
      throw new Error(
        "[BridgeManager] SFU adapter does not implement BridgeCapable interface. " +
          "Ensure the adapter has isBridgeCapable=true and implements required methods."
      );
    }
    this.sfuAdapter = sfuAdapter;

    this.setupDeviceManagerListeners();
    this.setupSfuAdapterListeners();

    this._initialized = true;
    this.log("info", "Bridge initialized");
    this.emit("bridge_ready");
  }

  /**
   * Update the SFU adapter (e.g., when switching from Dialog to Sora)
   * @param sfuAdapter The new SFU adapter
   */
  setAdapter(sfuAdapter: SfuAdapter): void {
    if (!isBridgeCapable(sfuAdapter)) {
      this.log("error", "New adapter does not implement BridgeCapable");
      this.emit("error", new Error("Adapter not bridge capable"), "setAdapter");
      return;
    }

    // Clean up old adapter
    if (this.sfuAdapter) {
      this.sfuAdapter.offBridgeMessage(this.boundHandleBridgeMessage);
    }

    this.sfuAdapter = sfuAdapter;
    this.setupSfuAdapterListeners();
    this.emit("adapter_changed", sfuAdapter);
    this.log("info", "SFU adapter switched");
  }

  /**
   * Clean up all connections and resources
   */
  destroy(): void {
    if (this.sfuAdapter) {
      this.sfuAdapter.offBridgeMessage(this.boundHandleBridgeMessage);
    }

    if (this.deviceManager) {
      this.deviceManager.off("device_message", this.boundHandleDeviceMessage);
    }

    this.subscriptions.clear();
    this.deviceManager = null;
    this.sfuAdapter = null;
    this._initialized = false;

    this.emit("bridge_disconnected");
    this.removeAllListeners();
    this.log("info", "Bridge destroyed");
  }

  // ========== Subscription Methods ==========

  /**
   * Subscribe to receive messages with a specific label
   * @param label The device label to subscribe to
   */
  subscribe(label: string): void {
    if (!label || typeof label !== "string") {
      this.log("warn", "Invalid label for subscription");
      return;
    }

    if (this.subscriptions.has(label)) {
      this.log("debug", `Already subscribed to label: ${label}`);
      return;
    }

    this.subscriptions.add(label);
    this.log("info", `Subscribed to label: ${label}`);
    this.emit("subscription_changed", this.getSubscriptions());
  }

  /**
   * Unsubscribe from a label
   * @param label The device label to unsubscribe from
   */
  unsubscribe(label: string): void {
    if (this.subscriptions.has(label)) {
      this.subscriptions.delete(label);
      this.log("info", `Unsubscribed from label: ${label}`);
      this.emit("subscription_changed", this.getSubscriptions());
    }
  }

  /**
   * Get current subscriptions
   * @returns Array of subscribed labels
   */
  getSubscriptions(): string[] {
    return Array.from(this.subscriptions);
  }

  /**
   * Check if subscribed to a label
   * @param label The label to check
   * @returns true if subscribed
   */
  isSubscribed(label: string): boolean {
    return this.subscriptions.has(label);
  }

  // ========== Messaging Methods ==========

  /**
   * Send a message to device(s) with a specific label
   * Requires active subscription to the label
   *
   * @param label The device label for routing
   * @param targetDeviceId Specific device ID or null for all devices with matching label
   * @param payload The payload to send (string or ArrayBuffer)
   * @returns true if the message was sent
   */
  sendToDevice(label: string, targetDeviceId: string | null, payload: string | ArrayBuffer): boolean {
    if (!this.isSubscribed(label)) {
      this.log("warn", `Cannot send to label "${label}" - not subscribed`);
      return false;
    }

    if (!this.sfuAdapter?.isBridgeChannelReady) {
      this.log("warn", "SFU bridge channel not ready");
      return false;
    }

    const envelope = createRoomToDeviceEnvelope(label, targetDeviceId, payload);
    return this.sfuAdapter.sendBridgeMessage(envelope);
  }

  /**
   * Broadcast a message to the room via SFU
   * @param envelope The envelope to broadcast
   * @returns true if sent successfully
   */
  broadcastToRoom(envelope: BridgeEnvelope): boolean {
    if (!this.sfuAdapter?.isBridgeChannelReady) {
      this.log("warn", "SFU bridge channel not ready");
      return false;
    }

    return this.sfuAdapter.sendBridgeMessage(envelope);
  }

  // ========== Private Methods ==========

  private setupDeviceManagerListeners(): void {
    if (!this.deviceManager) return;

    // Forward device messages to room
    this.deviceManager.on("device_message", this.boundHandleDeviceMessage);

    // Log device state changes
    this.deviceManager.on("device_connected", deviceId => {
      this.log("debug", `Device connected: ${deviceId}`);
    });

    this.deviceManager.on("device_disconnected", deviceId => {
      this.log("debug", `Device disconnected: ${deviceId}`);
    });
  }

  private setupSfuAdapterListeners(): void {
    if (!this.sfuAdapter) return;
    this.sfuAdapter.onBridgeMessage(this.boundHandleBridgeMessage);
  }

  /**
   * Handle messages FROM devices (device → room)
   * Creates envelope and broadcasts to room via SFU
   */
  private handleDeviceMessage(deviceId: string, message: IoTMessage): void {
    if (!this.config.forwardDeviceToRoom) return;

    // Validate message has label
    if (!message.label) {
      this.log("warn", `Device message from ${deviceId} missing label, skipping`);
      return;
    }

    const envelope = createDeviceToRoomEnvelope(deviceId, message);

    if (this.broadcastToRoom(envelope)) {
      this.emit("device_message_forwarded", deviceId, envelope);
      this.log("debug", `Forwarded device message to room: ${deviceId} [${message.label}]`);
    }
  }

  /**
   * Handle messages FROM room (room → this client)
   * Filters by subscription and routes to devices or emits events
   */
  private handleBridgeMessage(envelope: BridgeEnvelope): void {
    const { label, sourceDeviceId, targetDeviceId, payload, payloadType } = envelope;

    // Filter by subscription (unless receiveAllMessages is enabled)
    if (!this.config.receiveAllMessages && !this.isSubscribed(label)) {
      this.log("debug", `Ignoring message for unsubscribed label: ${label}`);
      return;
    }

    // If message is from a device (sourceDeviceId is set), emit to application
    if (sourceDeviceId !== null) {
      const decodedPayload = extractPayload(envelope);
      this.emit("device_message", label, sourceDeviceId, decodedPayload);
      this.log("debug", `Received device message: ${sourceDeviceId} [${label}]`);
      return;
    }

    // If message is from room client to device(s), forward to local devices
    if (!this.config.forwardRoomToDevice) return;
    if (!this.deviceManager) return;

    // Construct IoTMessage for device
    const iotMessage: IoTMessage = {
      type: "request",
      label,
      payload: payloadType === "json" ? JSON.parse(payload) : { binary: true, data: payload }
    };

    // Route to specific device or broadcast
    if (targetDeviceId) {
      const adapter = this.deviceManager.getDeviceState(targetDeviceId);
      if (adapter) {
        this.deviceManager.sendToDevice(targetDeviceId, iotMessage);
        this.emit("room_message_forwarded", envelope);
        this.log("debug", `Forwarded room message to device: ${targetDeviceId}`);
      }
    } else {
      // Broadcast to all connected devices (that match label - device should filter)
      this.deviceManager.broadcastToDevices(iotMessage);
      this.emit("room_message_forwarded", envelope);
      this.log("debug", `Broadcast room message to all devices [${label}]`);
    }
  }

  private log(level: "info" | "warn" | "error" | "debug", message: string): void {
    if (!this.config.debug && level === "debug") return;
    const prefix = "[BridgeManager]";
    switch (level) {
      case "error":
        console.error(prefix, message);
        break;
      case "warn":
        console.warn(prefix, message);
        break;
      case "debug":
        console.log(prefix, message);
        break;
      default:
        console.log(prefix, message);
    }
  }

  // ========== Public Getters ==========

  /** Check if the bridge is initialized */
  get initialized(): boolean {
    return this._initialized;
  }

  /** Check if the bridge is ready for communication */
  get isReady(): boolean {
    return (
      this._initialized && this.deviceManager?.initialized === true && this.sfuAdapter?.isBridgeChannelReady === true
    );
  }

  /** Get list of connected device IDs */
  get connectedDevices(): string[] {
    return this.deviceManager?.getConnectedDevices() ?? [];
  }

  /** Get count of active subscriptions */
  get subscriptionCount(): number {
    return this.subscriptions.size;
  }
}
