# Libpeer Integration: External Device Communication Bridge

This document explains how external devices and software can communicate with in-room clients through the libpeer integration, which bridges WebRTC DataChannels from IoT devices to the SFU network used by Hubs.

## Overview

The libpeer integration enables bidirectional communication between:

- **External IoT devices** (ESP32, Raspberry Pi, custom hardware running libpeer)
- **In-room Hubs clients** (browsers connected via Dialog, Sora, or other SFU adapters)

This is achieved through a **bridge layer** that translates messages between the device's direct WebRTC DataChannel connection and the SFU's broadcast DataChannel network.

## Architecture

There are two distinct client roles in this integration:

1. **Bridge Host**: A Hubs client that has direct P2P WebRTC connections to IoT devices. This client runs the `LibpeerDeviceManager` and `BridgeManager`, forwarding device messages to the room via the SFU's `#iot` channel.

2. **Room Participants**: Other Hubs clients in the room that receive device messages through the SFU broadcast. They subscribe to device labels via their local `BridgeManager` to filter relevant messages.

```
                                    ┌─────────────────────────────────────────────────────────┐
                                    │              BRIDGE HOST CLIENT                         │
┌─────────────────┐    WebRTC      │  ┌───────────────────────┐                              │
│  IoT Device     │ ◄──────────────┼─►│ LibpeerDeviceAdapter  │                              │
│  (ESP32, RPi)   │  DataChannel   │  │ (per-device P2P)      │                              │
└─────────────────┘      (P2P)     │  └───────────┬───────────┘                              │
                                   │              │                                          │
                                   │  ┌───────────▼───────────┐                              │
                                   │  │ LibpeerDeviceManager  │  Signaling via               │
                                   │  │                       │◄─────────────────────────────┼──► Phoenix/Reticulum
                                   │  └───────────┬───────────┘  hub channel                 │
                                   │              │                                          │
                                   │  ┌───────────▼───────────┐                              │
                                   │  │    BridgeManager      │                              │
                                   │  │ (device↔room routing) │                              │
                                   │  └───────────┬───────────┘                              │
                                   │              │                                          │
                                   │  ┌───────────▼───────────┐                              │
                                   │  │ SfuAdapter (#iot ch)  │ implements BridgeCapable     │
                                   │  │ (Dialog/Sora/etc)     │                              │
                                   │  └───────────┬───────────┘                              │
                                   └──────────────┼──────────────────────────────────────────┘
                                                  │
                                    SFU broadcast │ (#iot DataChannel)
                                                  │
                               ┌──────────────────┼──────────────────┐
                               │                  │                  │
                        ┌──────▼──────┐    ┌──────▼──────┐    ┌──────▼──────┐
                        │  Client A   │    │  Client B   │    │  Client C   │
                        │  (browser)  │    │  (browser)  │    │    (VR)     │
                        │             │    │             │    │             │
                        │ BridgeMan.  │    │ BridgeMan.  │    │ BridgeMan.  │
                        │ subscribe() │    │ subscribe() │    │ subscribe() │
                        └─────────────┘    └─────────────┘    └─────────────┘
                            ROOM PARTICIPANTS (receive via SFU, no direct device connection)
```

## File Structure

```
src/libpeer/
├── index.ts                      # Module exports (re-exports all public API)
├── iot-types.ts                  # Core type definitions
├── libpeer-device-adapter.ts     # Per-device WebRTC connection wrapper
├── libpeer-device-manager.ts     # Multi-device connection manager
└── bridge/
    ├── index.ts                  # Bridge module exports
    ├── bridge-capable.ts         # BridgeCapable interface definition
    ├── bridge-message-protocol.ts # Envelope serialization/deserialization
    └── bridge-manager.ts         # Main orchestration logic
```

## Key Components

### 1. IoT Types (`src/libpeer/iot-types.ts`)

Core type definitions for IoT device communication:

```typescript
// Message types for device communication
export type IoTMessageType = "request" | "response" | "error";

export interface IoTMessage {
  type: IoTMessageType;
  label: string;           // Label for routing messages to subscribed clients
  payload: Record<string, unknown>;
}

// Signaling types for WebRTC connection establishment
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

// Connection state tracking
export interface DeviceConnectionState {
  device_id: string;
  state: RTCPeerConnectionState;
  connectedAt: number | null;
}

// Constants
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

export const IOT_DATACHANNEL_LABEL = "iot";
```

### 2. LibpeerDeviceAdapter (`src/libpeer/libpeer-device-adapter.ts`)

Wraps a single `RTCPeerConnection` to an external IoT device. Handles:

- WebRTC connection lifecycle (offer/answer/ICE)
- DataChannel setup and message handling
- Connection state events

**Key Events:**
```typescript
interface LibpeerDeviceAdapterEvents {
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
```

**Key Methods:**
```typescript
class LibpeerDeviceAdapter {
  // Connection establishment
  async createOffer(): Promise<RTCSessionDescriptionInit>   // Browser initiates
  async handleOffer(offer): Promise<RTCSessionDescriptionInit>  // Device initiates
  async handleAnswer(answer): Promise<void>
  async addIceCandidate(candidate): Promise<void>

  // Messaging
  send(message: IoTMessage | string): boolean
  sendBinary(data: ArrayBuffer | Uint8Array): boolean

  // State
  get isConnected(): boolean
  get isDataChannelOpen(): boolean
  get isOfferer(): boolean  // True if browser initiated the connection

  // Cleanup
  close(): void
}
```

### 3. LibpeerDeviceManager (`src/libpeer/libpeer-device-manager.ts`)

Manages multiple device connections. Provides:

- Device discovery via Phoenix channel signaling
- Connection initiation and tear-down
- Message routing to/from specific devices

**Key Events:**
```typescript
interface LibpeerDeviceManagerEvents {
  device_added: (deviceId: string) => void;
  device_connected: (deviceId: string) => void;
  device_disconnected: (deviceId: string) => void;
  device_removed: (deviceId: string) => void;
  device_message: (deviceId: string, message: IoTMessage) => void;
  error: (deviceId: string, error: Error) => void;
}
```

**Key Methods:**
```typescript
class LibpeerDeviceManager {
  // Lifecycle
  init(hubChannel: HubChannelLike): void
  destroy(): void

  // Connection management
  async initiateConnection(deviceId: string): Promise<void>
  disconnectDevice(deviceId: string): void

  // Messaging
  sendToDevice(deviceId: string, message: IoTMessage): boolean
  sendRequest(deviceId: string, label: string, payload: Record<string, unknown>): boolean
  broadcastToDevices(message: IoTMessage): void
  broadcastRequest(label: string, payload: Record<string, unknown>): void

  // State queries
  getConnectedDevices(): string[]
  getAllDevices(): string[]
  getDeviceState(deviceId: string): DeviceConnectionState | null
  async getDevicesInRoom(): Promise<string[]>

  // Getters
  get initialized(): boolean
  get connectedCount(): number
}

// Singleton access
export function getLibpeerDeviceManager(): LibpeerDeviceManager
export function destroyLibpeerDeviceManager(): void
```

### 4. BridgeCapable Interface (`src/libpeer/bridge/bridge-capable.ts`)

Interface that SFU adapters must implement to support IoT bridging:

```typescript
/** Channel label for IoT bridge messages */
export const IOT_BRIDGE_CHANNEL = "#iot";

/** Payload encoding type */
export type BridgePayloadType = "json" | "binary";

/**
 * Message envelope for SFU transmission
 */
export interface BridgeEnvelope {
  label: string;                    // Device/subscription label (e.g., "sensor-A")
  sourceDeviceId: string | null;    // Device ID if from device, null if from room
  targetDeviceId: string | null;    // Specific device or null for broadcast
  timestamp: number;
  payloadType: BridgePayloadType;
  payload: string;                  // JSON string or base64-encoded binary
}

/**
 * Serialized format for DataChannel transmission (compact field names)
 */
export interface SerializedBridgeEnvelope {
  v: 1;                // Protocol version
  l: string;           // Label
  s: string | null;    // Source device ID
  t: string | null;    // Target device ID
  ts: number;          // Timestamp
  pt: "j" | "b";       // Payload type: "j" for json, "b" for binary
  p: string;           // Payload data
}

export type BridgeMessageCallback = (envelope: BridgeEnvelope) => void;

/**
 * Interface that SFU adapters must implement
 */
export interface BridgeCapable {
  readonly isBridgeCapable: boolean;
  readonly isBridgeChannelReady: boolean;
  readonly clientId: string;

  sendBridgeMessage(envelope: BridgeEnvelope): boolean;
  onBridgeMessage(callback: BridgeMessageCallback): void;
  offBridgeMessage(callback: BridgeMessageCallback): void;
}

/**
 * Type guard to check if an object implements BridgeCapable
 */
export function isBridgeCapable(adapter: unknown): adapter is BridgeCapable
```

### 5. Bridge Message Protocol (`src/libpeer/bridge/bridge-message-protocol.ts`)

Utilities for envelope serialization and message creation:

```typescript
// Serialization
export function serializeBridgeEnvelope(envelope: BridgeEnvelope): string
export function deserializeBridgeEnvelope(data: string | ArrayBuffer): BridgeEnvelope | null

// Payload encoding/decoding
export function encodePayload(data: string | ArrayBuffer): { payloadType: BridgePayloadType; payload: string }
export function decodePayload(payloadType: BridgePayloadType, payload: string): string | ArrayBuffer

// Envelope creation helpers
export function createDeviceToRoomEnvelope(deviceId: string, message: IoTMessage): BridgeEnvelope
export function createRoomToDeviceEnvelope(label: string, targetDeviceId: string | null, payload: string | ArrayBuffer): BridgeEnvelope

// Payload extraction
export function extractPayload(envelope: BridgeEnvelope): string | ArrayBuffer
export function parseJsonPayload<T>(envelope: BridgeEnvelope): T | null
```

### 6. BridgeManager (`src/libpeer/bridge/bridge-manager.ts`)

The orchestrator that ties everything together:

```typescript
interface BridgeManagerEvents {
  device_message: (label: string, deviceId: string, payload: string | ArrayBuffer) => void;
  subscription_changed: (labels: string[]) => void;
  device_message_forwarded: (deviceId: string, envelope: BridgeEnvelope) => void;
  room_message_forwarded: (envelope: BridgeEnvelope) => void;
  error: (error: Error, context: string) => void;
  bridge_ready: () => void;
  bridge_disconnected: () => void;
  adapter_changed: (adapter: SfuAdapter & BridgeCapable) => void;
}

interface BridgeManagerConfig {
  forwardDeviceToRoom: boolean;   // Default: true
  forwardRoomToDevice: boolean;   // Default: true
  debug: boolean;                 // Default: false
  receiveAllMessages: boolean;    // Default: false (for testing)
}

class BridgeManager {
  // Lifecycle
  init(deviceManager: LibpeerDeviceManager, sfuAdapter: SfuAdapter): void
  setAdapter(sfuAdapter: SfuAdapter): void  // For adapter switching
  destroy(): void

  // Subscriptions
  subscribe(label: string): void
  unsubscribe(label: string): void
  getSubscriptions(): string[]
  isSubscribed(label: string): boolean

  // Messaging
  sendToDevice(label: string, targetDeviceId: string | null, payload: string | ArrayBuffer): boolean
  broadcastToRoom(envelope: BridgeEnvelope): boolean

  // State
  get initialized(): boolean
  get isReady(): boolean
  get connectedDevices(): string[]
  get subscriptionCount(): number
}
```

### 7. SfuAdapter Base Class (`src/sfu-adapter.ts`)

The base `SfuAdapter` class provides a default `BridgeCapable` implementation:

```typescript
abstract class SfuAdapter extends EventEmitter implements BridgeCapable {
  // BridgeCapable implementation
  protected _bridgeMessageCallbacks: Set<BridgeMessageCallback> = new Set();
  protected _textEncoder: TextEncoder;
  protected _textDecoder: TextDecoder;

  get isBridgeCapable(): boolean {
    return true;  // Always true for SfuAdapter subclasses
  }

  get isBridgeChannelReady(): boolean {
    return false;  // Must be overridden by concrete implementations
  }

  get clientId(): string {
    return this._clientId;
  }

  sendBridgeMessage(envelope: BridgeEnvelope): boolean {
    if (!this.isBridgeChannelReady) return false;
    const serialized = serializeBridgeEnvelope(envelope);
    this.broadcast(IOT_BRIDGE_CHANNEL, serialized);
    return true;
  }

  onBridgeMessage(callback: BridgeMessageCallback): void {
    this._bridgeMessageCallbacks.add(callback);
  }

  offBridgeMessage(callback: BridgeMessageCallback): void {
    this._bridgeMessageCallbacks.delete(callback);
  }

  // Called by concrete adapters when receiving #iot channel data
  protected processBridgeChannelMessage(data: ArrayBuffer): void {
    const text = this._textDecoder.decode(data);
    const envelope = deserializeBridgeEnvelope(text);
    if (envelope) {
      this._bridgeMessageCallbacks.forEach((cb) => cb(envelope));
    }
  }
}
```

### 8. Concrete SFU Adapter Implementations

**DialogAdapter** (`src/naf-dialog-adapter.js`):
```javascript
get isBridgeChannelReady() {
  return this._dataProducers?.has("#iot") &&
         this._sendTransport &&
         !this._sendTransport._closed;
}

// In setLocalMediaStream(), creates #iot data producer:
const channelsToProduce = this._avatarSyncHelper._channelsForSync.concat(["#nimpro", "#iot"]);

// In data consumer handler, routes #iot messages:
if (label === "#iot") {
  this.processBridgeChannelMessage(data);
}
```

**SoraAdapter** (`src/sora-adapter.ts`):
```typescript
get isBridgeChannelReady(): boolean {
  return this._connector !== null &&
         this._connectionType !== SFU_CONNECTION_TYPE.RECV;
}

// In connect(), registers #iot data channel:
dataChannelSignaling: true,
dataChannels: [
  { label: "#avatar_sync", direction: "sendrecv" },
  { label: "#nimpro", direction: "sendrecv" },
  { label: "#iot", direction: "sendrecv" }
]

// In datachannel event handler:
if (event.label === "#iot") {
  this.processBridgeChannelMessage(event.data);
}
```

## App Integration (`src/app.ts`)

The App class declares the managers:

```typescript
class App {
  // ... other properties ...

  // libpeer IoT device manager for external device WebRTC DataChannel connections
  libpeerDeviceManager?: LibpeerDeviceManager;

  // IoT bridge manager for device <-> room communication
  bridgeManager?: BridgeManager;
}
```

## Hub Initialization (`src/hub.js`)

The managers are initialized when joining a hub:

```javascript
// In handleHubChannelJoined() -> loadEnvironmentAndConnect():

// Initialize libpeer device manager for IoT device connections
if (!APP.libpeerDeviceManager) {
  APP.libpeerDeviceManager = new LibpeerDeviceManager();
}
APP.libpeerDeviceManager.init(hubChannel);
console.log("LibpeerDeviceManager initialized for IoT device connections");

// After SFU adapter is ready:
scene.addEventListener("adapter-ready", ({ detail: adapter }) => {
  adapter.hubChannel = hubChannel;
  adapter.events = events;
  adapter.session_id = data.session_id;

  // Initialize IoT bridge manager after SFU adapter is ready
  if (APP.libpeerDeviceManager?.initialized && !APP.bridgeManager) {
    APP.bridgeManager = new BridgeManager({ debug: true, receiveAllMessages: true });
    APP.bridgeManager.init(APP.libpeerDeviceManager, APP.sfu);
    console.log("BridgeManager initialized for IoT device <-> room communication");
  }
}, { once: true });

// Cleanup on room close/refresh:
scene.addEventListener("hub_closed", () => {
  APP.bridgeManager?.destroy();
  APP.libpeerDeviceManager?.destroy();
  // ...
});

scene.addEventListener("hub_updated_require_refresh", () => {
  APP.bridgeManager?.destroy();
  APP.libpeerDeviceManager?.destroy();
  // ...
});
```

## Module Exports (`src/libpeer/index.ts`)

The main entry point exports everything needed for external use:

```typescript
// Types
export type {
  IoTMessage, IoTMessageType,
  DeviceSignalingOffer, DeviceSignalingAnswer, DeviceSignalingIceCandidate,
  DeviceConnectionState
} from "./iot-types";
export { DEFAULT_ICE_SERVERS, IOT_DATACHANNEL_LABEL } from "./iot-types";

// Device Adapter
export { LibpeerDeviceAdapter } from "./libpeer-device-adapter";
export type { LibpeerDeviceAdapterEvents } from "./libpeer-device-adapter";

// Device Manager
export { LibpeerDeviceManager, getLibpeerDeviceManager, destroyLibpeerDeviceManager } from "./libpeer-device-manager";
export type { LibpeerDeviceManagerEvents } from "./libpeer-device-manager";

// Bridge Layer
export {
  IOT_BRIDGE_CHANNEL, isBridgeCapable, BridgeManager,
  serializeBridgeEnvelope, deserializeBridgeEnvelope,
  createDeviceToRoomEnvelope, createRoomToDeviceEnvelope,
  extractPayload, parseJsonPayload
} from "./bridge";
export type {
  BridgePayloadType, BridgeEnvelope, BridgeCapable, BridgeMessageCallback,
  BridgeManagerEvents, BridgeManagerConfig
} from "./bridge";
```

## Data Flow Examples

### Example 1: Device sends sensor data to room

```
Device                    Hubs Client (with device connection)           Other Room Clients
   │                                    │                                       │
   │ ─── IoTMessage{label:"temp-1"} ──► │                                       │
   │     via WebRTC DataChannel         │                                       │
   │                                    │                                       │
   │                      LibpeerDeviceManager.on("device_message")             │
   │                                    │                                       │
   │                      BridgeManager creates envelope                        │
   │                                    │                                       │
   │                      SfuAdapter.sendBridgeMessage()                        │
   │                                    │ ───── #iot channel ────────────────►  │
   │                                    │                                       │
   │                                    │         BridgeManager.on("device_message")
   │                                    │         (clients subscribed to "temp-1")
```

### Example 2: Room client sends command to device

```
Room Client A             Hubs Client (with device connection)           Device
      │                                    │                                │
      │ ── BridgeManager.sendToDevice() ─► │                                │
      │    label:"robot-1", cmd:"move"     │                                │
      │                                    │                                │
      │    via SFU #iot channel ──────────►│                                │
      │                                    │                                │
      │                      BridgeManager receives envelope                │
      │                      (subscribed to "robot-1")                      │
      │                                    │                                │
      │                      LibpeerDeviceManager.sendToDevice()            │
      │                                    │ ─── IoTMessage ──────────────► │
      │                                    │     via WebRTC DataChannel     │
```

## Usage in Application Code

### Subscribing to Device Messages

```javascript
// In a Hubs component or system
const bridgeManager = APP.bridgeManager;

// Subscribe to a device label
bridgeManager.subscribe("temperature-sensor");

// Listen for device messages
bridgeManager.on("device_message", (label, deviceId, payload) => {
  if (label === "temperature-sensor") {
    const data = JSON.parse(payload);
    console.log(`Temperature from ${deviceId}: ${data.value}°C`);
  }
});
```

### Sending Commands to Devices

```javascript
// Send to all devices with label "robot-arm"
bridgeManager.sendToDevice(
  "robot-arm",
  null, // null = broadcast to all
  JSON.stringify({ command: "move", x: 10, y: 20 })
);

// Send to a specific device
bridgeManager.sendToDevice(
  "robot-arm",
  "device-abc123",
  JSON.stringify({ command: "stop" })
);
```

### Checking Bridge Status

```javascript
// Check if bridge is ready
if (bridgeManager.isReady) {
  console.log("Bridge ready, devices:", bridgeManager.connectedDevices);
}

// Get current subscriptions
console.log("Subscribed to:", bridgeManager.getSubscriptions());
```

## Testing Without External Hardware

You can test the libpeer integration without physical IoT devices using a standalone HTML page that acts as an external device/software.

### Prerequisites

1. **Reticulum Backend**: Your Hubs instance must be running a Reticulum version that includes the device signaling handlers (`device:offer`, `device:answer`, `device:ice_candidate`). These are implemented in `lib/ret_web/channels/hub_channel.ex`.

2. **Hub Permissions**: The simulator joins the hub channel with minimal authentication. For testing, either:
   - Use a hub with permissive room settings (allow anonymous joins), or
   - Modify the simulator to include a valid `hub_invite_id` in the channel join params

3. **Network Requirements**: Both tabs should be on the same network or have TURN servers configured. The simulator uses Google's public STUN servers by default.

### Setup

- **Tab 1 (Hubs Room)**: Open a Hubs room on your instance (e.g., `https://chutvrc.com/abc123`) and **enter the room**
- **Tab 2 (External Device Simulator)**: Open the HTML file below (save locally and open in browser)

### Connection Flow

The **simulator (device) is the WebRTC offerer** and the **Hubs client is the answerer**. This matches how real IoT devices would initiate connections.

```
Tab 1 (Hubs Room/Answerer)     Tab 2 (Simulator/Offerer)
     │                               │
     │   Phoenix WebSocket           │
     │ ◄─────────────────────────────┤ 1. Join same hub channel
     │                               │
     │        device:offer           │
     │ ◄─────────────────────────────┤ 2. Device sends SDP offer
     │                               │      (createOffer → setLocalDescription)
     │  LibpeerDeviceManager         │
     │  receives offer, creates      │
     │  RTCPeerConnection            │
     │                               │
     │        device:answer          │
     ├─────────────────────────────► │ 3. Hubs client sends SDP answer
     │  (setRemoteDescription)       │      (setRemoteDescription)
     │                               │
     │      device:ice_candidate     │
     │ ◄───────────────────────────► │ 4. ICE candidate exchange (both directions)
     │                               │
     │     WebRTC DataChannel        │
     │ ◄═══════════════════════════► │ 5. P2P DataChannel established (label: "iot")
     │                               │
     │       IoTMessage{...}         │
     │ ◄───────────────────────────► │ 6. Bidirectional IoT messages
```

### External Device Simulator HTML

The simulator is available at [`docs/device-simulator.html`](./device-simulator.html). Open it directly in a browser tab.

<details>
<summary>Click to view full source code</summary>

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Libpeer Device Simulator</title>
  <style>
    body { font-family: sans-serif; max-width: 800px; margin: 20px auto; padding: 0 20px; }
    .section { margin-bottom: 20px; padding: 15px; border: 1px solid #ddd; border-radius: 8px; }
    label { display: block; margin-bottom: 5px; font-weight: bold; }
    input, textarea { width: 100%; padding: 8px; margin-bottom: 10px; box-sizing: border-box; }
    button { padding: 10px 20px; margin-right: 10px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .connected { background: #d4edda; }
    .disconnected { background: #f8d7da; }
    #log { height: 300px; overflow-y: auto; background: #1e1e1e; color: #d4d4d4; padding: 10px;
           font-family: monospace; font-size: 12px; white-space: pre-wrap; }
    .log-info { color: #4fc3f7; }
    .log-error { color: #ef5350; }
    .log-success { color: #81c784; }
    .log-data { color: #fff59d; }
  </style>
</head>
<body>
  <h1>Libpeer Device Simulator</h1>

  <div class="section" id="connection-section">
    <h3>Connection Settings</h3>
    <label>WebSocket URL:</label>
    <input type="text" id="wsUrl" value="ws://localhost:4000/socket" placeholder="ws://localhost:4000/socket">

    <label>Hub ID:</label>
    <input type="text" id="hubId" placeholder="Enter the hub ID from your room URL">

    <label>Device ID:</label>
    <input type="text" id="deviceId" value="simulator-001" placeholder="simulator-001">

    <button id="connectBtn" onclick="connect()">Connect</button>
    <button id="disconnectBtn" onclick="disconnect()" disabled>Disconnect</button>
  </div>

  <div class="section">
    <h3>Send Message</h3>
    <label>Label (for routing):</label>
    <input type="text" id="msgLabel" value="test-sensor" placeholder="test-sensor">

    <label>Payload (JSON):</label>
    <textarea id="msgPayload" rows="3">{"temperature": 25.5, "humidity": 60}</textarea>

    <button id="sendBtn" onclick="sendMessage()" disabled>Send Message</button>
  </div>

  <div class="section">
    <h3>Log</h3>
    <button onclick="clearLog()">Clear Log</button>
    <div id="log"></div>
  </div>

  <!-- Phoenix JS Client (use same version as your Hubs/Reticulum) -->
  <script src="https://unpkg.com/phoenix@1.7.14/dist/phoenix.min.js"></script>

  <script>
    let socket = null;
    let channel = null;
    let peerConnection = null;
    let dataChannel = null;
    const deviceId = () => document.getElementById('deviceId').value;

    function log(msg, type = 'info') {
      const logEl = document.getElementById('log');
      const time = new Date().toLocaleTimeString();
      logEl.innerHTML += `<span class="log-${type}">[${time}] ${msg}</span>\n`;
      logEl.scrollTop = logEl.scrollHeight;
    }

    function clearLog() {
      document.getElementById('log').innerHTML = '';
    }

    function updateUI(connected) {
      document.getElementById('connectBtn').disabled = connected;
      document.getElementById('disconnectBtn').disabled = !connected;
      document.getElementById('sendBtn').disabled = !connected;
      document.getElementById('connection-section').className =
        'section ' + (connected ? 'connected' : 'disconnected');
    }

    async function connect() {
      const wsUrl = document.getElementById('wsUrl').value;
      const hubId = document.getElementById('hubId').value;

      if (!hubId) {
        log('Error: Hub ID is required', 'error');
        return;
      }

      log(`Connecting to ${wsUrl}...`);

      // Connect to Phoenix socket
      socket = new Phoenix.Socket(wsUrl, {
        params: {},
        logger: (kind, msg, data) => log(`[Phoenix ${kind}] ${msg}`, 'info')
      });

      socket.connect();
      socket.onOpen(() => log('Socket connected', 'success'));
      socket.onError((err) => log(`Socket error: ${JSON.stringify(err)}`, 'error'));
      socket.onClose(() => {
        log('Socket closed', 'error');
        updateUI(false);
      });

      // Join hub channel
      channel = socket.channel(`hub:${hubId}`, {
        profile: { displayName: `Device: ${deviceId()}` },
        context: { mobile: false, embed: false, hmd: false }
      });

      // Handle signaling events
      channel.on('device:answer', handleAnswer);
      channel.on('device:ice_candidate', handleRemoteIceCandidate);

      channel.join()
        .receive('ok', (resp) => {
          log(`Joined hub channel: ${hubId}`, 'success');
          log(`Session ID: ${resp.session_id}`, 'info');
          initWebRTC();
        })
        .receive('error', (resp) => {
          log(`Failed to join channel: ${JSON.stringify(resp)}`, 'error');
        });
    }

    function initWebRTC() {
      log('Initializing WebRTC...');

      const config = {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      };

      peerConnection = new RTCPeerConnection(config);

      // Create data channel (device is offerer)
      dataChannel = peerConnection.createDataChannel('iot', { ordered: true });
      setupDataChannel(dataChannel);

      // Handle ICE candidates
      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          log(`Sending ICE candidate`, 'info');
          channel.push('device:ice_candidate', {
            device_id: deviceId(),
            candidate: event.candidate.toJSON()
          });
        }
      };

      peerConnection.oniceconnectionstatechange = () => {
        log(`ICE state: ${peerConnection.iceConnectionState}`, 'info');
      };

      peerConnection.onconnectionstatechange = () => {
        log(`Connection state: ${peerConnection.connectionState}`, 'info');
        if (peerConnection.connectionState === 'connected') {
          updateUI(true);
        }
      };

      // Create and send offer
      createOffer();
    }

    async function createOffer() {
      try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        log('Sending WebRTC offer...', 'info');
        channel.push('device:offer', {
          device_id: deviceId(),
          offer: offer
        }).receive('ok', () => log('Offer sent', 'success'))
          .receive('error', (err) => log(`Offer error: ${JSON.stringify(err)}`, 'error'));
      } catch (e) {
        log(`Failed to create offer: ${e.message}`, 'error');
      }
    }

    async function handleAnswer(payload) {
      log(`Received answer from: ${payload.from_session_id || 'unknown'}`, 'info');

      if (payload.device_id !== deviceId()) return;

      try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(payload.answer));
        log('Remote description set', 'success');
      } catch (e) {
        log(`Failed to set remote description: ${e.message}`, 'error');
      }
    }

    async function handleRemoteIceCandidate(payload) {
      if (payload.device_id !== deviceId()) return;

      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
        log('Added remote ICE candidate', 'info');
      } catch (e) {
        log(`Failed to add ICE candidate: ${e.message}`, 'error');
      }
    }

    function setupDataChannel(dc) {
      dc.onopen = () => {
        log('DataChannel opened!', 'success');
        updateUI(true);
      };

      dc.onclose = () => {
        log('DataChannel closed', 'error');
        updateUI(false);
      };

      dc.onerror = (err) => {
        log(`DataChannel error: ${err.message || err}`, 'error');
      };

      dc.onmessage = (event) => {
        log(`Received: ${event.data}`, 'data');
      };
    }

    function sendMessage() {
      if (!dataChannel || dataChannel.readyState !== 'open') {
        log('DataChannel not open', 'error');
        return;
      }

      const label = document.getElementById('msgLabel').value;
      const payloadStr = document.getElementById('msgPayload').value;

      try {
        const payload = JSON.parse(payloadStr);
        const message = {
          type: 'request',
          label: label,
          payload: payload
        };

        dataChannel.send(JSON.stringify(message));
        log(`Sent: ${JSON.stringify(message)}`, 'success');
      } catch (e) {
        log(`Invalid JSON payload: ${e.message}`, 'error');
      }
    }

    function disconnect() {
      if (dataChannel) {
        dataChannel.close();
        dataChannel = null;
      }
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      if (channel) {
        channel.leave();
        channel = null;
      }
      if (socket) {
        socket.disconnect();
        socket = null;
      }

      log('Disconnected', 'info');
      updateUI(false);
    }
  </script>
</body>
</html>
```

</details>

### Step-by-Step Test

1. **Open Hubs room** in Tab 1 and enter the room
2. **Copy the Hub ID** from the room URL (e.g., `abc123` from `https://chutvrc.com/abc123`)
3. **Open the simulator HTML** in Tab 2
4. **Enter connection details**:
   - WebSocket URL:
     - Local development: `ws://localhost:4000/socket`
     - Production (HTTPS): `wss://your-hubs.com/socket`
   - Hub ID: paste the hub ID from step 2
   - Device ID: any unique identifier (e.g., `simulator-001`)
5. **Click "Connect"** - watch the log for connection progress:
   - `Socket connected` - Phoenix WebSocket established
   - `Joined hub channel` - Successfully joined the room channel
   - `Sending WebRTC offer...` - Device initiating P2P connection
   - `Remote description set` - Answer received from Hubs client
   - `DataChannel opened!` - Ready to send/receive messages
6. **In Tab 1 (Hubs room console)**, verify the bridge is ready and subscribe:
   ```javascript
   // Check if BridgeManager exists and is ready
   if (APP.bridgeManager) {
     console.log("Bridge ready:", APP.bridgeManager.isReady);
     console.log("Connected devices:", APP.bridgeManager.connectedDevices);

     // Subscribe to the test label
     APP.bridgeManager.subscribe("test-sensor");

     // Listen for device messages
     APP.bridgeManager.on("device_message", (label, deviceId, payload) => {
       console.log(`Received from ${deviceId} [${label}]:`, payload);
     });
   } else {
     console.log("BridgeManager not initialized - check if device connected");
   }
   ```
7. **Send a test message** from the simulator (Tab 2) using the "Send Message" button
8. **Observe the message** received in Tab 1 console

### Troubleshooting

| Issue | Possible Cause | Solution |
|-------|---------------|----------|
| `Failed to join channel` | Hub requires authentication | Use a hub with open permissions or add `hub_invite_id` to channel params |
| `Offer sent` but no answer | No Hubs client is listening for device offers | Ensure Tab 1 has entered the room and SFU is connected |
| `DataChannel` never opens | Firewall/NAT issues | Check if TURN servers are configured; try both tabs on same network |
| `APP.bridgeManager` is undefined | BridgeManager not initialized | Ensure a device connected to trigger initialization in `hub.js` |

## Debugging Tips

### Enable Debug Logging

```javascript
// Create a new BridgeManager with debug enabled
// (or modify the existing one's config)
APP.bridgeManager.config.debug = true;
```

### Monitor Bridge Events

```javascript
// Log all bridge events
["device_message", "device_message_forwarded", "room_message_forwarded",
 "subscription_changed", "bridge_ready", "bridge_disconnected", "error"
].forEach(event => {
  APP.bridgeManager.on(event, (...args) => {
    console.log(`[Bridge Event: ${event}]`, ...args);
  });
});
```

### Check SFU DataChannel Status

```javascript
// For Dialog adapter
console.log("Dialog #iot producer:", APP.sfu._dataProducers?.get("#iot"));

// For Sora adapter
console.log("Sora connector:", APP.sfu._connector);
```

## Supported SFU Adapters

| Adapter | Bridge Support | Status | Channel Ready Check |
|---------|----------------|--------|---------------------|
| Dialog (mediasoup) | Yes | Implemented | `_dataProducers.has("#iot") && _sendTransport` |
| Sora | Yes | Implemented | `_connector !== null && _connectionType !== RECV` |
| Others | Possible | Requires implementing `BridgeCapable` interface | - |

## Files Changed in This Integration

### Frontend (Hubs Client)

| File | Purpose |
|------|---------|
| `src/libpeer/index.ts` | Module exports |
| `src/libpeer/iot-types.ts` | Type definitions |
| `src/libpeer/libpeer-device-adapter.ts` | Per-device WebRTC wrapper |
| `src/libpeer/libpeer-device-manager.ts` | Multi-device manager |
| `src/libpeer/bridge/index.ts` | Bridge module exports |
| `src/libpeer/bridge/bridge-capable.ts` | BridgeCapable interface definition |
| `src/libpeer/bridge/bridge-message-protocol.ts` | Envelope serialization utilities |
| `src/libpeer/bridge/bridge-manager.ts` | Orchestration logic |
| `src/sfu-adapter.ts` | Base SFU adapter with BridgeCapable implementation |
| `src/naf-dialog-adapter.js` | Dialog adapter `#iot` channel support |
| `src/sora-adapter.ts` | Sora adapter `#iot` channel support |
| `src/app.ts` | Added `libpeerDeviceManager` and `bridgeManager` to App |
| `src/hub.js` | Integration initialization and cleanup |

### Backend (Reticulum)

- `lib/ret_web/channels/hub_channel.ex` - Device signaling event handlers:
  - `device:offer` - Relay SDP offers between devices and clients
  - `device:answer` - Relay SDP answers between devices and clients
  - `device:ice_candidate` - Relay ICE candidates for connection establishment
  - `device:list` - List available devices/sessions in room
  - `device:register` - Register a device with metadata
  - `device:disconnect` - Notify room of device disconnection
