/**
 * libpeer WebRTC DataChannel integration module
 *
 * Enables bidirectional communication between hubs scenes and external IoT devices
 * running libpeer (ESP32, Raspberry Pi, etc.)
 */

// Types
export {
  IoTDeviceInfo,
  SensorData,
  ControlCommand,
  IoTMessage,
  IoTMessageType,
  IoTSensorMessage,
  IoTControlMessage,
  IoTRegisterMessage,
  IoTHeartbeatMessage,
  IoTAckMessage,
  IoTErrorMessage,
  DeviceSignalingOffer,
  DeviceSignalingAnswer,
  DeviceSignalingIceCandidate,
  DeviceConnectionState,
  DEFAULT_ICE_SERVERS,
  IOT_DATACHANNEL_LABEL
} from "./iot-types";

// Device Adapter
export { LibpeerDeviceAdapter, LibpeerDeviceAdapterEvents } from "./libpeer-device-adapter";

// Device Manager
export {
  LibpeerDeviceManager,
  LibpeerDeviceManagerEvents,
  getLibpeerDeviceManager,
  destroyLibpeerDeviceManager
} from "./libpeer-device-manager";
