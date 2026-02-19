/**
 * IoT Bridge Module
 *
 * Provides adapter-agnostic bridging between libpeer IoT devices
 * and Hubs room clients connected via any SFU.
 */

// Core constants and functions
export { IOT_BRIDGE_CHANNEL, isBridgeCapable } from "./bridge-capable";

// Core types
export type {
  BridgePayloadType,
  BridgeEnvelope,
  SerializedBridgeEnvelope,
  BridgeMessageCallback,
  BridgeCapable
} from "./bridge-capable";

// Message protocol utilities
export {
  serializeBridgeEnvelope,
  deserializeBridgeEnvelope,
  encodePayload,
  decodePayload,
  createDeviceToRoomEnvelope,
  createRoomToDeviceEnvelope,
  extractPayload,
  parseJsonPayload
} from "./bridge-message-protocol";

// Bridge manager
export { BridgeManager } from "./bridge-manager";
export type { BridgeManagerEvents, BridgeManagerConfig } from "./bridge-manager";
