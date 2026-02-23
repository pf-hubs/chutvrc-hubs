# Avatar Sync Flow (avatar-sfu-refactor branch)

## Data Channels & What's Synced

| Channel | Data | Frequency |
|---------|------|-----------|
| `#avatarId` | `clientId\|avatarId` | On join/change |
| `#isVR` | `clientId\|0/1` | Every 1000ms |
| `#avatarAnimState` | `clientId\|state` (0=STAND, 1=WALK, 2=SIT) | Every 500ms |
| `#avatar-RIG/HEAD/LEFT/RIGHT` | Binary transform (24 bytes + clientId) | Every 15ms |

## Binary Transform Encoding

Location: `src/utils/avatar-utils.ts:115-183`

```
Bytes 0-11:  Position XYZ (3x Float32)
Bytes 12-23: Rotation XYZ (3x Float32)
Bytes 24+:   Client ID (UTF-8)
```

Only sent when position changes > 0.01m or rotation > 0.01 rad.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     SFU Adapter                              │
│  (DialogAdapter or SoraAdapter)                              │
│                                                              │
│  ┌─────────────────┐    ┌──────────────────────────────┐    │
│  │ AvatarSyncHelper│◄───│ DataChannelMessageDispatcher │    │
│  │                 │    │                              │    │
│  │ - Transform maps│    │  ┌────────────────────────┐  │    │
│  │ - VR mode map   │    │  │ ChannelHandlerRegistry │  │    │
│  │ - Anim state    │    │  │                        │  │    │
│  │ - Avatar loading│    │  │ • AvatarIdHandler      │  │    │
│  └─────────────────┘    │  │ • IsVRHandler          │  │    │
│                         │  │ • AvatarAnimStateHandler│  │    │
│                         │  │ • NimproHandler        │  │    │
│                         │  │ • IotBridgeHandler     │  │    │
│                         │  │ • ...more              │  │    │
│                         │  └────────────────────────┘  │    │
│                         └──────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## Message Flow

### Outgoing (local → others)

1. `AvatarSyncHelper.initSelfAvatarTransform()` captures DOM elements (`#avatar-rig`, `#avatar-pov-node`, controllers)
2. `AvatarTransformBuffer` encodes transforms to binary every 15ms
3. `SfuAdapter.broadcast/broadcastUint8()` sends via data channel

### Incoming (others → local)

1. Data channel message arrives at adapter
2. `DataChannelMessageDispatcher.dispatchMessage()` routes by channel label
3. For `#avatar-*` transforms → `AvatarSyncHelper.handleRecvMessage()` decodes and stores in maps
4. For `#avatarId` → triggers `replaceAvatarModel()` to load GLTF and create BitECS entities

## Key Files

| Purpose | File |
|---------|------|
| Sync logic | `src/utils/avatar-sync-helper.ts` |
| Binary encoding | `src/utils/avatar-transform-buffer.ts` |
| Handler interface | `src/utils/data-channel-handlers/channel-handler-interface.ts` |
| Handler registry | `src/utils/data-channel-handlers/channel-handler-registry.ts` |
| Message routing | `src/utils/data-channel-handlers/message-dispatcher.ts` |
| Avatar handlers | `src/utils/data-channel-handlers/handlers/avatar-sync-handler.ts` |
| Base adapter | `src/sfu-adapters/sfu-adapter.ts` |

## Key Improvements in This Branch

1. **Modular handlers** - Each channel has its own handler class implementing `IChannelHandler`
2. **Registry pattern** - Handlers registered at adapter init, dispatched by priority
3. **Lifecycle hooks** - `onChannelReady()` and `onDisconnect()` for proper cleanup
4. **Race condition prevention** - `_loadingAvatars` set prevents duplicate model loads
5. **Binary optimization** - Transforms use 24-byte binary format vs text
