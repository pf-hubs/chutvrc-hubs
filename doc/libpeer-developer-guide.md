# Libpeer Integration Developer Guide

## Overview

The libpeer integration enables external hardware and software devices (IoT sensors, robotics, AR/VR peripherals, etc.) to communicate with participants in a Hubs room via WebRTC DataChannels. This creates a bridge between physical/external devices and the virtual collaboration space.

### Key Components

| Component | Purpose |
|-----------|---------|
| `LibpeerDeviceAdapter` | Manages a single WebRTC connection to one external device |
| `LibpeerDeviceManager` | Manages multiple device connections and handles signaling |
| `BridgeManager` | Routes messages between devices and room participants via the SFU |
| `BridgeCapable` | Interface that SFU adapters implement to support IoT bridging |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Hubs Room                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐         ┌───────────────┐         ┌──────────────────┐   │
│   │   Browser    │◄───────►│  SFU Adapter  │◄───────►│  Other Clients   │   │
│   │   Client     │         │  (Dialog/Sora)│         │  in Room         │   │
│   └──────────────┘         └───────────────┘         └──────────────────┘   │
│          │                        ▲                                          │
│          │                        │ #iot channel                             │
│          ▼                        │                                          │
│   ┌──────────────┐         ┌──────┴────────┐                                │
│   │   Bridge     │◄───────►│BridgeManager  │                                │
│   │   Capable    │         │(orchestrator) │                                │
│   └──────────────┘         └───────────────┘                                │
│                                   ▲                                          │
│                                   │                                          │
│                                   ▼                                          │
│                        ┌─────────────────────┐                               │
│                        │LibpeerDeviceManager │                               │
│                        │  (multi-device)     │                               │
│                        └─────────────────────┘                               │
│                                   │                                          │
│              ┌────────────────────┼────────────────────┐                    │
│              ▼                    ▼                    ▼                    │
│   ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐           │
│   │LibpeerDevice     │ │LibpeerDevice     │ │LibpeerDevice     │           │
│   │Adapter (dev-1)   │ │Adapter (dev-2)   │ │Adapter (dev-3)   │           │
│   └──────────────────┘ └──────────────────┘ └──────────────────┘           │
│              │                    │                    │                    │
└──────────────┼────────────────────┼────────────────────┼────────────────────┘
               │ WebRTC             │ WebRTC             │ WebRTC
               │ DataChannel        │ DataChannel        │ DataChannel
               ▼                    ▼                    ▼
        ┌────────────┐       ┌────────────┐       ┌────────────┐
        │  ESP32 /   │       │ Raspberry  │       │  External  │
        │  Arduino   │       │    Pi      │       │  Software  │
        └────────────┘       └────────────┘       └────────────┘
```

## Data Flow

### Device to Room

1. External device sends a message via WebRTC DataChannel
2. `LibpeerDeviceAdapter` receives the message and emits `message` event
3. `LibpeerDeviceManager` forwards to `BridgeManager` via `device_message` event
4. `BridgeManager` wraps message in a `BridgeEnvelope` and sends via SFU's `#iot` channel
5. All room clients subscribed to the message's label receive the envelope

### Room to Device

1. Room client calls `BridgeManager.sendToDevice(label, deviceId, payload)`
2. `BridgeManager` creates a `BridgeEnvelope` and broadcasts via SFU
3. On receiving end, `BridgeManager` extracts the envelope
4. If the message targets local devices, it forwards to `LibpeerDeviceManager`
5. `LibpeerDeviceManager` sends to the specific device(s) via DataChannel

## Message Format

### IoTMessage (Device Layer)

```typescript
interface IoTMessage {
  type: "request" | "response" | "error";
  label: string;                    // Routing label (e.g., "temperature-sensor")
  payload: Record<string, unknown>; // Arbitrary JSON data
}
```

### BridgeEnvelope (SFU Layer)

```typescript
interface BridgeEnvelope {
  label: string;              // Routing label
  sourceDeviceId: string | null;  // Device ID if from device, null if from room client
  targetDeviceId: string | null;  // Specific device or null for broadcast
  timestamp: number;          // Creation timestamp
  payloadType: "json" | "binary";
  payload: string;            // JSON string or base64-encoded binary
}
```

## Integration Guide

### 1. Connecting External Hardware/Software

#### Prerequisites

- Device must support WebRTC (or use a bridge library)
- Access to the Hubs Phoenix channel for signaling
- Device must implement the signaling protocol

#### Signaling Protocol

The device connects to the Phoenix channel and exchanges WebRTC signaling messages:

| Event | Direction | Payload |
|-------|-----------|---------|
| `device:offer` | Device -> Server | `{ device_id, offer }` |
| `device:answer` | Server -> Device | `{ device_id, answer }` |
| `device:ice_candidate` | Bidirectional | `{ device_id, candidate }` |
| `device:disconnect` | Either | `{ device_id }` |
| `device:list` | Request/Response | `{ devices: string[] }` |

#### Connection Flow

```
Device                          Hubs Server                       Browser
  │                                  │                                │
  ├─── Connect to Phoenix ──────────►│                                │
  │    channel "hub:{hubId}"         │                                │
  │                                  │                                │
  ├─── device:offer ────────────────►│──── device:offer ─────────────►│
  │    {device_id, offer}            │                                │
  │                                  │                                │
  │◄── device:answer ────────────────│◄─── device:answer ─────────────│
  │    {device_id, answer}           │     {device_id, answer}        │
  │                                  │                                │
  │◄─────────── ICE candidates exchanged (both directions) ──────────►│
  │                                  │                                │
  │◄════════════ WebRTC DataChannel Established ════════════════════►│
  │                                  │                                │
  ├─── IoTMessage via DataChannel ─────────────────────────────────►│
  │                                  │                                │
```

#### Example: ESP32/Arduino Device (Pseudo-code)

```cpp
// 1. Connect to Phoenix WebSocket
PhoenixSocket socket("wss://your-hubs.com/socket");
PhoenixChannel channel("hub:YOUR_HUB_ID");

// 2. Create WebRTC peer connection
RTCPeerConnection pc(iceServers);
RTCDataChannel* dc = pc.createDataChannel("iot");

// 3. Create and send offer
auto offer = pc.createOffer();
pc.setLocalDescription(offer);
channel.push("device:offer", {
  {"device_id", "my-sensor-001"},
  {"offer", offer}
});

// 4. Handle answer
channel.on("device:answer", [&](json payload) {
  if (payload["device_id"] == "my-sensor-001") {
    pc.setRemoteDescription(payload["answer"]);
  }
});

// 5. Exchange ICE candidates
pc.onIceCandidate([&](auto candidate) {
  channel.push("device:ice_candidate", {
    {"device_id", "my-sensor-001"},
    {"candidate", candidate}
  });
});

// 6. Send data when connected
dc->onOpen([&]() {
  json message = {
    {"type", "request"},
    {"label", "temperature"},
    {"payload", {{"value", 25.5}, {"unit", "celsius"}}}
  };
  dc->send(message.dump());
});
```

### 2. Subscribing to Device Messages in the Browser

Room clients use the `BridgeManager` to subscribe to device messages:

```typescript
import { BridgeManager, LibpeerDeviceManager } from "./libpeer";

// Get instances (typically from APP)
const deviceManager = new LibpeerDeviceManager();
const bridgeManager = new BridgeManager({ debug: true });

// Initialize with hub channel and SFU adapter
deviceManager.init(hubChannel);
bridgeManager.init(deviceManager, sfuAdapter);

// Subscribe to a specific label
bridgeManager.subscribe("temperature");

// Listen for device messages
bridgeManager.on("device_message", (label, deviceId, payload) => {
  console.log(`Device ${deviceId} sent [${label}]:`, payload);

  // Example: Update UI with sensor data
  if (label === "temperature") {
    const data = JSON.parse(payload);
    updateTemperatureDisplay(data.value, data.unit);
  }
});

// Send a command to a device
bridgeManager.sendToDevice("robot-arm", "arm-001", JSON.stringify({
  command: "move",
  position: { x: 10, y: 20, z: 5 }
}));

// Broadcast to all devices with a label
bridgeManager.sendToDevice("lights", null, JSON.stringify({
  command: "set_brightness",
  value: 80
}));
```

### 3. Direct Device Communication (Without Bridge)

For simpler use cases where you don't need to broadcast to the room:

```typescript
const deviceManager = new LibpeerDeviceManager();
deviceManager.init(hubChannel);

// Listen for device connections
deviceManager.on("device_connected", (deviceId) => {
  console.log(`Device connected: ${deviceId}`);
});

// Listen for messages from devices
deviceManager.on("device_message", (deviceId, message) => {
  console.log(`Message from ${deviceId}:`, message);
});

// Send to a specific device
deviceManager.sendToDevice("sensor-001", {
  type: "request",
  label: "config",
  payload: { sampleRate: 1000 }
});

// Broadcast to all connected devices
deviceManager.broadcastToDevices({
  type: "request",
  label: "sync",
  payload: { timestamp: Date.now() }
});
```

## Using the Device Simulator

The device simulator (`docs/device-simulator.html`) is a browser-based tool for testing the libpeer integration without actual hardware.

### Setup

1. Open `docs/device-simulator.html` in a browser
2. Configure connection settings:
   - **WebSocket URL**: Your Hubs server WebSocket endpoint (e.g., `wss://localhost:4000/socket`)
   - **Hub ID**: The room ID from your Hubs URL (the part after `/hub/`)
   - **Device ID**: A unique identifier for the simulated device (e.g., `simulator-001`)

### Connecting

1. Click **Connect** to establish the WebSocket and WebRTC connections
2. The connection section will turn green when connected
3. Monitor the log for connection status and any errors

### Sending Messages

1. Enter a **Label** for routing (e.g., `temperature-sensor`, `robot-status`)
2. Enter a JSON **Payload** with your test data
3. Click **Send Message**

Example payloads:

```json
// Temperature sensor
{"temperature": 25.5, "humidity": 60, "unit": "celsius"}

// Robot status
{"position": {"x": 10, "y": 20, "z": 5}, "battery": 85}

// Button press
{"button": "A", "pressed": true, "timestamp": 1234567890}
```

### Testing Workflow

1. **Start the simulator** with a unique Device ID
2. **Open Hubs** in another browser tab and join the same room
3. **Subscribe** to the device's label in your Hubs client code
4. **Send messages** from the simulator and verify they arrive in Hubs
5. **Send commands** from Hubs to the simulator and verify receipt in the log

### Log Color Coding

| Color | Meaning |
|-------|---------|
| Blue | Informational messages |
| Green | Success (connected, message sent) |
| Red | Errors |
| Yellow | Received data |

## Troubleshooting

### Device won't connect

1. Verify the WebSocket URL is correct and accessible
2. Check that the Hub ID matches an existing room
3. Ensure STUN/TURN servers are reachable
4. Look for CORS errors in the browser console

### Messages not arriving

1. Verify the label matches between sender and subscriber
2. Check that `BridgeManager` is initialized with both device manager and SFU adapter
3. Ensure the SFU adapter's `isBridgeChannelReady` returns `true`
4. Enable debug mode: `new BridgeManager({ debug: true })`

### DataChannel not opening

1. Check ICE connection state in logs
2. Verify both peers exchanged all ICE candidates
3. Try using TURN servers if behind strict NAT/firewall

## API Reference

### LibpeerDeviceManager

| Method | Description |
|--------|-------------|
| `init(hubChannel)` | Initialize with Phoenix hub channel |
| `initiateConnection(deviceId)` | Browser initiates connection to device |
| `sendToDevice(deviceId, message)` | Send message to specific device |
| `sendRequest(deviceId, label, payload)` | Send labeled request |
| `broadcastToDevices(message)` | Send to all connected devices |
| `disconnectDevice(deviceId)` | Close connection to device |
| `getConnectedDevices()` | Get array of connected device IDs |
| `getDevicesInRoom()` | Request available devices from server |
| `destroy()` | Clean up all connections |

### BridgeManager

| Method | Description |
|--------|-------------|
| `init(deviceManager, sfuAdapter)` | Initialize the bridge |
| `setAdapter(sfuAdapter)` | Switch to a different SFU adapter |
| `subscribe(label)` | Subscribe to messages with label |
| `unsubscribe(label)` | Unsubscribe from label |
| `getSubscriptions()` | Get current subscription list |
| `sendToDevice(label, deviceId, payload)` | Send to device(s) |
| `broadcastToRoom(envelope)` | Broadcast envelope to room |
| `destroy()` | Clean up bridge |

### Events

#### LibpeerDeviceManager Events

| Event | Payload | Description |
|-------|---------|-------------|
| `device_added` | `deviceId` | New device adapter created |
| `device_connected` | `deviceId` | WebRTC connection established |
| `device_disconnected` | `deviceId` | Device disconnected |
| `device_removed` | `deviceId` | Device adapter removed |
| `device_message` | `deviceId, message` | Message received from device |
| `error` | `deviceId, error` | Error occurred |

#### BridgeManager Events

| Event | Payload | Description |
|-------|---------|-------------|
| `device_message` | `label, deviceId, payload` | Filtered device message received |
| `subscription_changed` | `labels[]` | Subscription list changed |
| `device_message_forwarded` | `deviceId, envelope` | Device message sent to room |
| `room_message_forwarded` | `envelope` | Room message sent to device |
| `bridge_ready` | - | Bridge initialized |
| `bridge_disconnected` | - | Bridge destroyed |
| `adapter_changed` | `adapter` | SFU adapter switched |
| `error` | `error, context` | Error occurred |
