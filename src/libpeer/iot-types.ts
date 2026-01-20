/**
 * TypeScript interfaces for IoT device communication via WebRTC DataChannel
 */

export interface IoTDeviceInfo {
  deviceId: string;
  deviceType: "esp32" | "raspberry_pi" | "pico" | "generic";
  capabilities: string[];
  label?: string;
  firmware?: string;
}

export interface SensorData {
  deviceId: string;
  timestamp: number;
  type: string;
  value: number | boolean | string | Record<string, unknown>;
  unit?: string;
}

export interface ControlCommand {
  deviceId: string;
  command: string;
  params?: Record<string, unknown>;
}

export type IoTMessageType = "sensor" | "control" | "register" | "heartbeat" | "ack" | "error";

export interface IoTSensorMessage {
  type: "sensor";
  payload: SensorData;
}

export interface IoTControlMessage {
  type: "control";
  payload: ControlCommand;
}

export interface IoTRegisterMessage {
  type: "register";
  payload: IoTDeviceInfo;
}

export interface IoTHeartbeatMessage {
  type: "heartbeat";
  payload: { deviceId: string };
}

export interface IoTAckMessage {
  type: "ack";
  payload: { messageId?: string; deviceId: string };
}

export interface IoTErrorMessage {
  type: "error";
  payload: { deviceId: string; code: string; message: string };
}

export type IoTMessage =
  | IoTSensorMessage
  | IoTControlMessage
  | IoTRegisterMessage
  | IoTHeartbeatMessage
  | IoTAckMessage
  | IoTErrorMessage;

export interface DeviceSignalingOffer {
  deviceId: string;
  offer: RTCSessionDescriptionInit;
}

export interface DeviceSignalingAnswer {
  deviceId: string;
  answer: RTCSessionDescriptionInit;
}

export interface DeviceSignalingIceCandidate {
  deviceId: string;
  candidate: RTCIceCandidateInit;
}

export interface DeviceConnectionState {
  deviceId: string;
  state: RTCPeerConnectionState;
  info: IoTDeviceInfo | null;
  connectedAt: number | null;
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

export const IOT_DATACHANNEL_LABEL = "iot";
