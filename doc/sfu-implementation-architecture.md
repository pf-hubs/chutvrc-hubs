# SFU Architecture Documentation

This document describes the Selective Forwarding Unit (SFU) implementation architecture in the `avatar-sfu-refactor` branch.

## Overview

The SFU architecture implements a **modular, pluggable system** where:
- **Adapters** are interchangeable implementations (Dialog, Sora, future LiveKit)
- **Handlers** are decoupled, prioritized message processors
- **Avatar System** integrates through dedicated channels and AvatarSyncHelper
- **IoT Bridge** provides adapter-agnostic device communication

The design prioritizes **composition over inheritance**, **separation of concerns**, and **extensibility**.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    SFU Adapter Factory                           │
│         (SfuAdapterFactory - Registry Pattern)                   │
└─────────────────┬───────────────────────┬───────────────────────┘
                  │                       │
         ┌────────▼─────────┐   ┌────────▼──────────┐
         │  DialogAdapter   │   │   SoraAdapter     │
         │  (Mediasoup)     │   │  (Sora JS SDK)    │
         └────────┬─────────┘   └────────┬──────────┘
                  │                       │
                  └───────────┬───────────┘
                              │
                    ┌─────────▼──────────┐
                    │  SfuAdapter        │
                    │  (Abstract Base)   │
                    └─────────┬──────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
    ┌───▼──────────┐  ┌──────▼────────┐  ┌────────▼────┐
    │ EventEmitter │  │ BridgeCapable │  │Message      │
    │              │  │ (IoT Support) │  │Dispatcher   │
    └──────────────┘  └───────────────┘  └────────┬────┘
                                                   │
                              ┌─────────────────────▼──────┐
                              │ChannelHandlerRegistry      │
                              │ (Manages all handlers)     │
                              └─────────────────┬──────────┘
                                                │
        ┌───────────────────────────────────────┼───────────────────────────────────┐
        │                                       │                                   │
    ┌───▼───────────────────┐    ┌─────────────▼──────────────┐    ┌──────────────▼──────────┐
    │ Mandatory Handlers    │    │  Optional Handlers         │    │ Avatar Transform        │
    │ (Avatar Sync)         │    │  (Features)                │    │ Channels (Direct)       │
    └───────────────────────┘    └────────────────────────────┘    └─────────────────────────┘
```

---

## Core Components

### 1. Type Definitions

**File:** `src/sfu-types.ts`

```typescript
export enum SFU {
  DIALOG,  // Dialog-based SFU (Mediasoup)
  SORA     // Sora-based SFU
}

export enum SFU_CONNECTION_TYPE {
  SENDRECV,  // Bidirectional (full participant)
  SEND,      // Send-only (speaker/presenter)
  RECV       // Receive-only (audience/mirror)
}
```

### 2. SFU Adapter Interface

**File:** `src/types/sfu-adapter-interface.ts`

The `ISfuAdapter` interface combines multiple specialized interfaces using composition:

| Interface | Purpose |
|-----------|---------|
| `ISfuConnectable` | Connection lifecycle (`connect`, `disconnect`, `clientId`, `roomId`) |
| `ISfuMediaStreams` | Audio/video track management |
| `ISfuMicrophoneControl` | Microphone-specific control |
| `ISfuDataChannels` | Real-time data communication |
| `ISfuParticipantControl` | Room moderation (`kick`, `block`, `unblock`) |
| `ISfuDiagnostics` | RTC event logging |
| `BridgeCapable` | IoT device integration |

### 3. Base SfuAdapter Class

**File:** `src/sfu-adapters/sfu-adapter.ts`

Abstract base class providing:
- Message dispatcher infrastructure
- Avatar sync helper integration
- BridgeCapable implementation (IoT integration)
- Recording support for data channel messages

Key methods:
```typescript
protected initializeMessageDispatcher(registry: ChannelHandlerRegistry): void
protected handleDataChannelMessage(channelLabel: string, data: ArrayBuffer): void
protected updateDispatcherContext(): void
protected registerHandler(handler: IChannelHandler): void
protected cleanupDispatcher(): void
```

---

## Adapter Implementations

### DialogAdapter

**File:** `src/sfu-adapters/dialog-adapter.ts`

**Technology Stack:**
- Mediasoup Client for media handling
- Protoo Client for signaling
- WebRTC for peer-to-peer transport

**Features:**
- Full simulcast support for webcam and screen sharing
- Data producers/consumers for data channel communication
- Consumer statistics tracking
- ICE server configuration with TURN support

### SoraAdapter

**File:** `src/sfu-adapters/sora-adapter.ts`

**Technology Stack:**
- Sora JS SDK for WebRTC
- Simplified signaling compared to Dialog

**Features:**
- Stream ID pair mapping for client identification
- Client stream management
- Cross-room streamer audio source support

### Adapter Factory

**File:** `src/sfu-adapters/adapter-factory.ts`

Registry-based factory pattern for adapter instantiation:

```typescript
export class SfuAdapterFactory {
  static create(sfuType: SFU, connectionType: SFU_CONNECTION_TYPE): SfuAdapter
  static register(sfuType: SFU, adapterClass: AdapterConstructor): void
  static hasAdapter(sfuType: SFU): boolean
  static getRegisteredTypes(): SFU[]
}
```

**Usage:**
```typescript
// Standard participant
APP.sfu = SfuAdapterFactory.create(SFU.DIALOG, SFU_CONNECTION_TYPE.SENDRECV);

// Public speaker (send-only)
APP.publicSpeakingSfu = SfuAdapterFactory.create(sfuId, SFU_CONNECTION_TYPE.SEND);

// Mirror viewer (receive-only)
APP.publicSpeakersMirrorSfu = SfuAdapterFactory.create(sfuId, SFU_CONNECTION_TYPE.RECV);
```

---

## Data Channel Handler System

### Handler Interface

**File:** `src/utils/data-channel-handlers/channel-handler-interface.ts`

```typescript
export interface IChannelHandler {
  readonly channelLabel: string;   // e.g., "#nimpro", "#avatar-RIG"
  readonly isMandatory: boolean;   // Avatar sync vs. optional features
  readonly priority: number;       // Lower = higher priority

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void;
  onChannelReady?(context: ChannelHandlerContext): void;
  onDisconnect?(context: ChannelHandlerContext): void;
}
```

### Handler Context

```typescript
export interface ChannelHandlerContext {
  adapter: SfuAdapter;
  clientId: string;
  roomId: string;
  textDecoder: TextDecoder;
  textEncoder: TextEncoder;
  avatarSyncHelper: AvatarSyncHelper;
}
```

### Handler Registry

**File:** `src/utils/data-channel-handlers/channel-handler-registry.ts`

Manages handler registration and lookup:
- Register/unregister handlers by channel label
- Query handlers by label or properties
- Maintain sorted cache by priority
- Categorize handlers (mandatory vs. optional)

### Message Dispatcher

**File:** `src/utils/data-channel-handlers/message-dispatcher.ts`

Routes messages to appropriate handlers:

```
dispatchMessage(channelLabel, data)
  ↓
1. Buffer message (backward compat)
2. Convert to Uint8Array
3. Look up handler in registry
4. If found → handler.handleMessage()
5. If avatar-* pattern → delegate to AvatarSyncHelper
6. Otherwise → unhandled (not an error)
```

---

## Data Channel Handlers

### Mandatory Handlers (Avatar Sync)

| Handler | Channel | Priority | Purpose |
|---------|---------|----------|---------|
| `AvatarIdHandler` | `#avatarId` | 0 | Avatar asset ID synchronization |
| `IsVRHandler` | `#isVR` | 0 | VR/desktop mode flag |
| `AvatarAnimStateHandler` | `#avatarAnimState` | 0 | Animation state (stand/walk/sit) |

Avatar transform channels (`#avatar-RIG`, `#avatar-HEAD`, `#avatar-LEFT`, `#avatar-RIGHT`) are handled directly by the MessageDispatcher via pattern matching and delegated to `AvatarSyncHelper`.

### Optional Handlers (Features)

| Handler | Channel | Priority | Purpose | Adapters |
|---------|---------|----------|---------|----------|
| `NimproHandler` | `#nimpro` | 10 | Game integration | Dialog, Sora |
| `LaserPointerHandler` | `#laserPointer` | 15 | 3D laser pointer | Sora |
| `PdfPageHandler` | `#pdfPage` | 20 | PDF viewer sync | Sora |
| `TogglePublicSpeakerHandler` | `#togglePublicSpeaker` | 20 | Speaker mode toggle | Sora |
| `EmojiHandler` | `#emoji` | 50 | Emoji reactions | Sora |
| `IotBridgeHandler` | `#iot` | 100 | IoT device communication | All |

---

## Avatar System Integration

**File:** `src/utils/avatar-sync-helper.ts`

### AvatarSyncHelper Class

Manages avatar state for all room participants:

| Data Structure | Purpose |
|----------------|---------|
| `_client2AvatarAssetId` | Avatar model IDs |
| `_client2AvatarEid` | BitECS entity IDs |
| `_client2VrMode` | VR/Desktop mode |
| `_client2AnimState` | Animation state |
| `_client2Transform` | Position/rotation per body part |

### Synchronized Channels

| Channel | Data |
|---------|------|
| `#avatarId` | Avatar asset ID (model selection) |
| `#isVR` | VR/desktop mode flag |
| `#avatarAnimState` | Animation state |
| `#avatar-RIG` | Root transform |
| `#avatar-HEAD` | Head position/rotation |
| `#avatar-LEFT` | Left hand transform |
| `#avatar-RIGHT` | Right hand transform |

---

## IoT Bridge Integration

**File:** `src/libpeer/bridge/bridge-capable.ts`

### BridgeCapable Interface

```typescript
export interface BridgeCapable {
  readonly isBridgeCapable: boolean;
  readonly isBridgeChannelReady: boolean;
  readonly clientId: string;

  sendBridgeMessage(envelope: BridgeEnvelope): boolean;
  onBridgeMessage(callback: BridgeMessageCallback): void;
  offBridgeMessage(callback: BridgeMessageCallback): void;
}
```

### Message Envelope

```typescript
export interface BridgeEnvelope {
  label: string;
  sourceDeviceId: string | null;
  targetDeviceId: string | null;
  timestamp: number;
  payloadType: "json" | "binary";
  payload: string;
}
```

---

## Connection Flow

1. **Initialization**
   - App creates SFU adapter via `SfuAdapterFactory.create()`
   - Adapter constructor calls `initializeDialogHandlers()` or `initializeSoraHandlers()`
   - Creates `ChannelHandlerRegistry` and registers all handlers
   - Calls `initializeMessageDispatcher(registry)`

2. **Connection**
   - `adapter.connect(props)` establishes peer connection
   - `updateDispatcherContext()` updates clientId/roomId in dispatcher
   - Data channels open

3. **Data Reception**
   - Incoming message on data channel
   - `handleDataChannelMessage(channelLabel, data)` called
   - Dispatcher routes to handler via registry
   - Handler processes message and updates state

4. **Disconnect**
   - `cleanupDispatcher()` called
   - Invokes `onDisconnect()` on all handlers
   - Cleans up resources (3D objects, listeners, etc.)

---

## Design Patterns

| Pattern | Usage | Location |
|---------|-------|----------|
| **Registry** | Adapter type registration | `SfuAdapterFactory` |
| **Handler** | Modular message processing | Channel handler system |
| **Factory** | Handler creation | `createAvatarSyncHandlers()` |
| **Event Emitter** | Component communication | `SfuAdapter` base class |
| **Strategy** | Interchangeable adapters | Dialog/Sora implementations |
| **Bridge** | IoT abstraction | `BridgeCapable` interface |

---

## File Structure

```
src/
├── sfu-types.ts                          # SFU and connection type enums
├── types/
│   └── sfu-adapter-interface.ts          # ISfuAdapter composite interface
├── sfu-adapters/
│   ├── sfu-adapter.ts                    # Abstract base class
│   ├── adapter-factory.ts                # Factory for adapter instantiation
│   ├── dialog-adapter.ts                 # Mediasoup-based implementation
│   └── sora-adapter.ts                   # Sora SDK-based implementation
├── utils/
│   ├── avatar-sync-helper.ts             # Avatar state management
│   └── data-channel-handlers/
│       ├── channel-handler-interface.ts  # IChannelHandler interface
│       ├── channel-handler-registry.ts   # Handler registration
│       ├── message-dispatcher.ts         # Message routing
│       └── handlers/
│           ├── avatar-id-handler.ts
│           ├── is-vr-handler.ts
│           ├── avatar-anim-state-handler.ts
│           ├── nimpro-handler.ts
│           ├── iot-bridge-handler.ts
│           ├── pdf-page-handler.ts
│           ├── toggle-public-speaker-handler.ts
│           ├── laser-pointer-handler.ts
│           └── emoji-handler.ts
└── libpeer/
    └── bridge/
        └── bridge-capable.ts             # IoT bridge interface
```

---

## Adding a New Handler

1. Create a new handler class implementing `IChannelHandler`:

```typescript
export class MyFeatureHandler implements IChannelHandler {
  readonly channelLabel = "#myFeature";
  readonly isMandatory = false;
  readonly priority = 30;

  handleMessage(data: Uint8Array, context: ChannelHandlerContext): void {
    const message = context.textDecoder.decode(data);
    // Process message
  }

  onChannelReady?(context: ChannelHandlerContext): void {
    // Initialize when channel opens
  }

  onDisconnect?(context: ChannelHandlerContext): void {
    // Cleanup on disconnect
  }
}
```

2. Register the handler in the appropriate adapter's initialization method:

```typescript
// In dialog-adapter.ts or sora-adapter.ts
private initializeHandlers(): void {
  const registry = new ChannelHandlerRegistry();
  // ... existing handlers
  registry.register(new MyFeatureHandler());
  this.initializeMessageDispatcher(registry);
}
```

---

## Adding a New SFU Adapter

1. Extend the `SfuAdapter` base class
2. Implement all required interface methods
3. Register with the factory:

```typescript
// In adapter-factory.ts or during app initialization
SfuAdapterFactory.register(SFU.MY_NEW_SFU, MyNewAdapter);
```
