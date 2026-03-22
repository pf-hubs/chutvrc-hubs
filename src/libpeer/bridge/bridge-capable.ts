/**
 * BridgeCapable interface - Any SFU adapter must implement this to support IoT bridging
 *
 * This interface enables adapter-agnostic communication between libpeer IoT devices
 * and room clients connected via any SFU (Dialog, Sora, Livekit, Cloudflare, etc.)
 */

/** Channel label for IoT bridge messages */
export const IOT_BRIDGE_CHANNEL = "#iot";

/** Payload encoding type */
export type BridgePayloadType = "json" | "binary";

/**
 * Message envelope for SFU transmission
 * Contains routing information and the payload
 */
export interface BridgeEnvelope {
  /** Device/subscription label for routing (e.g., "sensor-A", "robot-arm-1") */
  label: string;
  /** Source device ID, null if message originates from a room client */
  sourceDeviceId: string | null;
  /** Target device ID, null if broadcasting to all devices with matching label */
  targetDeviceId: string | null;
  /** Timestamp when the envelope was created */
  timestamp: number;
  /** Payload encoding type */
  payloadType: BridgePayloadType;
  /** Payload data - JSON string or base64-encoded binary */
  payload: string;
}

/**
 * Serialized format for DataChannel transmission
 * Compact field names to reduce bandwidth
 */
export interface SerializedBridgeEnvelope {
  /** Protocol version for future compatibility */
  v: 1;
  /** Label for routing */
  l: string;
  /** Source device ID */
  s: string | null;
  /** Target device ID */
  t: string | null;
  /** Timestamp */
  ts: number;
  /** Payload type: "j" for json, "b" for binary */
  pt: "j" | "b";
  /** Payload data */
  p: string;
}

/**
 * Callback type for bridge message handlers
 */
export type BridgeMessageCallback = (envelope: BridgeEnvelope) => void;

/**
 * Interface that SFU adapters must implement to support IoT bridging
 */
export interface BridgeCapable {
  /**
   * Check if this adapter supports IoT bridging
   * Should return true for adapters that implement this interface
   */
  readonly isBridgeCapable: boolean;

  /**
   * Check if bridge channel is ready for transmission
   * Returns true when the #iot DataChannel is established and ready
   */
  readonly isBridgeChannelReady: boolean;

  /**
   * Get the client ID of this adapter
   */
  readonly clientId: string;

  /**
   * Send a message through the bridge channel to room participants
   * @param envelope The message envelope containing routing and payload
   * @returns true if the message was sent successfully
   */
  sendBridgeMessage(envelope: BridgeEnvelope): boolean;

  /**
   * Register a callback for incoming bridge messages
   * Called when messages arrive on the #iot channel
   * @param callback Function to call when a bridge message is received
   */
  onBridgeMessage(callback: BridgeMessageCallback): void;

  /**
   * Remove a bridge message callback
   * @param callback The callback to remove
   */
  offBridgeMessage(callback: BridgeMessageCallback): void;
}

/**
 * Type guard to check if an object implements BridgeCapable
 * @param adapter The object to check
 * @returns true if the adapter implements BridgeCapable
 */
export function isBridgeCapable(adapter: unknown): adapter is BridgeCapable {
  if (adapter === null || typeof adapter !== "object") {
    return false;
  }

  const candidate = adapter as Partial<BridgeCapable>;

  return (
    candidate.isBridgeCapable === true &&
    typeof candidate.sendBridgeMessage === "function" &&
    typeof candidate.onBridgeMessage === "function" &&
    typeof candidate.offBridgeMessage === "function"
  );
}
