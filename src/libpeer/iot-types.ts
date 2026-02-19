/**
 * TypeScript interfaces for IoT device communication via WebRTC DataChannel
 */

export type IoTMessageType = "request" | "response" | "error";

export interface IoTMessage {
  type: IoTMessageType;
  /** Label for routing messages to subscribed clients */
  label: string;
  payload: Record<string, unknown>;
}

export interface DeviceSignalingOffer {
  device_id: string;
  offer: RTCSessionDescriptionInit;
}

export interface DeviceSignalingAnswer {
  device_id: string;
  answer: RTCSessionDescriptionInit;
}

export interface DeviceSignalingIceCandidate {
  device_id: string;
  candidate: RTCIceCandidateInit;
}

export interface DeviceConnectionState {
  device_id: string;
  state: RTCPeerConnectionState;
  connectedAt: number | null;
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

export const IOT_DATACHANNEL_LABEL = "iot";
