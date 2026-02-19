/**
 * libpeer WebRTC DataChannel integration module
 *
 * Enables bidirectional communication between hubs scenes and external IoT devices
 * running libpeer (ESP32, Raspberry Pi, etc.)
 */

// Types
export type {
  IoTMessage,
  IoTMessageType,
  DeviceSignalingOffer,
  DeviceSignalingAnswer,
  DeviceSignalingIceCandidate,
  DeviceConnectionState
} from "./iot-types";

export { DEFAULT_ICE_SERVERS, IOT_DATACHANNEL_LABEL } from "./iot-types";

// Device Adapter
export { LibpeerDeviceAdapter } from "./libpeer-device-adapter";
export type { LibpeerDeviceAdapterEvents } from "./libpeer-device-adapter";

// Device Manager
export {
  LibpeerDeviceManager,
  getLibpeerDeviceManager,
  destroyLibpeerDeviceManager
} from "./libpeer-device-manager";
export type { LibpeerDeviceManagerEvents } from "./libpeer-device-manager";

// Bridge Layer
export {
  IOT_BRIDGE_CHANNEL,
  isBridgeCapable,
  BridgeManager,
  serializeBridgeEnvelope,
  deserializeBridgeEnvelope,
  createDeviceToRoomEnvelope,
  createRoomToDeviceEnvelope,
  extractPayload,
  parseJsonPayload
} from "./bridge";
export type {
  BridgePayloadType,
  BridgeEnvelope,
  BridgeCapable,
  BridgeMessageCallback,
  BridgeManagerEvents,
  BridgeManagerConfig
} from "./bridge";
