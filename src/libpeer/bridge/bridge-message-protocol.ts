/**
 * Message protocol for IoT bridge communication
 *
 * Handles serialization/deserialization of BridgeEnvelope for DataChannel transmission,
 * and provides utilities for creating envelopes from device/room messages.
 */

import {
  BridgeEnvelope,
  BridgePayloadType,
  SerializedBridgeEnvelope
} from "./bridge-capable";
import { IoTMessage } from "../iot-types";

/** Current protocol version */
const PROTOCOL_VERSION = 1;

/**
 * Serialize a BridgeEnvelope for transmission over DataChannel
 * @param envelope The envelope to serialize
 * @returns JSON string representation
 */
export function serializeBridgeEnvelope(envelope: BridgeEnvelope): string {
  const serialized: SerializedBridgeEnvelope = {
    v: PROTOCOL_VERSION,
    l: envelope.label,
    s: envelope.sourceDeviceId,
    t: envelope.targetDeviceId,
    ts: envelope.timestamp,
    pt: envelope.payloadType === "json" ? "j" : "b",
    p: envelope.payload
  };
  return JSON.stringify(serialized);
}

/**
 * Deserialize a DataChannel message into a BridgeEnvelope
 * @param data The raw data received from DataChannel
 * @returns BridgeEnvelope or null if parsing fails
 */
export function deserializeBridgeEnvelope(data: string | ArrayBuffer): BridgeEnvelope | null {
  try {
    const text = typeof data === "string" ? data : new TextDecoder().decode(data);
    const parsed = JSON.parse(text) as SerializedBridgeEnvelope;

    // Version check for forward compatibility
    if (parsed.v !== PROTOCOL_VERSION) {
      console.warn(`[BridgeProtocol] Unknown protocol version: ${parsed.v}, expected ${PROTOCOL_VERSION}`);
      // Still try to parse if structure is compatible
    }

    return {
      label: parsed.l,
      sourceDeviceId: parsed.s,
      targetDeviceId: parsed.t,
      timestamp: parsed.ts,
      payloadType: parsed.pt === "j" ? "json" : "binary",
      payload: parsed.p
    };
  } catch (e) {
    console.error("[BridgeProtocol] Failed to deserialize envelope:", e);
    return null;
  }
}

/**
 * Encode payload data for transmission
 * @param data String or ArrayBuffer to encode
 * @returns Object with payloadType and encoded payload string
 */
export function encodePayload(data: string | ArrayBuffer): { payloadType: BridgePayloadType; payload: string } {
  if (typeof data === "string") {
    return {
      payloadType: "json",
      payload: data
    };
  } else {
    return {
      payloadType: "binary",
      payload: arrayBufferToBase64(data)
    };
  }
}

/**
 * Decode payload data from transmission format
 * @param payloadType The type of encoding used
 * @param payload The encoded payload string
 * @returns Decoded string or ArrayBuffer
 */
export function decodePayload(payloadType: BridgePayloadType, payload: string): string | ArrayBuffer {
  if (payloadType === "json") {
    return payload;
  } else {
    return base64ToArrayBuffer(payload);
  }
}

/**
 * Create a BridgeEnvelope from an IoT device message (device → room)
 * @param deviceId The source device ID
 * @param message The IoT message from the device
 * @returns BridgeEnvelope ready for transmission
 */
export function createDeviceToRoomEnvelope(
  deviceId: string,
  message: IoTMessage
): BridgeEnvelope {
  return {
    label: message.label,
    sourceDeviceId: deviceId,
    targetDeviceId: null, // Broadcast to room
    timestamp: Date.now(),
    payloadType: "json",
    payload: JSON.stringify(message.payload)
  };
}

/**
 * Create a BridgeEnvelope from a room client to device(s) (room → device)
 * @param label The device label for routing
 * @param targetDeviceId Specific device ID or null for all devices with matching label
 * @param payload The payload to send (string or binary)
 * @returns BridgeEnvelope ready for transmission
 */
export function createRoomToDeviceEnvelope(
  label: string,
  targetDeviceId: string | null,
  payload: string | ArrayBuffer
): BridgeEnvelope {
  const encoded = encodePayload(payload);
  return {
    label,
    sourceDeviceId: null, // From room client
    targetDeviceId,
    timestamp: Date.now(),
    payloadType: encoded.payloadType,
    payload: encoded.payload
  };
}

/**
 * Extract the payload from a BridgeEnvelope as its original type
 * @param envelope The envelope to extract from
 * @returns The decoded payload
 */
export function extractPayload(envelope: BridgeEnvelope): string | ArrayBuffer {
  return decodePayload(envelope.payloadType, envelope.payload);
}

/**
 * Parse JSON payload from an envelope (convenience method)
 * @param envelope The envelope with JSON payload
 * @returns Parsed JSON object or null if parsing fails
 */
export function parseJsonPayload<T = Record<string, unknown>>(envelope: BridgeEnvelope): T | null {
  if (envelope.payloadType !== "json") {
    console.warn("[BridgeProtocol] Cannot parse non-JSON payload as JSON");
    return null;
  }
  try {
    return JSON.parse(envelope.payload) as T;
  } catch (e) {
    console.error("[BridgeProtocol] Failed to parse JSON payload:", e);
    return null;
  }
}

// ========== Utility Functions ==========

/**
 * Convert ArrayBuffer to base64 string
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert base64 string to ArrayBuffer
 */
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
