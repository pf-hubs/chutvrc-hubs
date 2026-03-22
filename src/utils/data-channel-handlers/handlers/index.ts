// Avatar sync handlers (mandatory)
// Note: Avatar transform channels (#avatar-*) are handled directly in the dispatcher
export {
  AvatarIdHandler,
  IsVRHandler,
  AvatarAnimStateHandler,
  createAvatarSyncHandlers,
  getAvatarTransformChannelLabels
} from "./avatar-sync-handler";

// Feature handlers (optional)
export { NimproHandler } from "./nimpro-handler";
export { IotBridgeHandler } from "./iot-bridge-handler";
export { PdfPageHandler } from "./pdf-page-handler";
export { TogglePublicSpeakerHandler } from "./toggle-public-speaker-handler";
export { LaserPointerHandler } from "./laser-pointer-handler";
export { EmojiHandler } from "./emoji-handler";
