import { useState, useEffect, useCallback } from "react";
import { MediaDevices, MediaDevicesEvents } from "../../../utils/media-devices-utils";
import { SOUND_TOGGLE_MIC } from "../../../systems/sound-effects-system";

export function useMicrophoneStatus(scene) {
  const mediaDevicesManager = APP.mediaDevicesManager;
  const [isMicMuted, setIsMicMuted] = useState(!mediaDevicesManager.isMicEnabled);
  const [isMicEnabled, setIsMicEnabled] = useState(APP.mediaDevicesManager.isMicShared);
  const [permissionStatus, setPermissionsStatus] = useState(
    mediaDevicesManager.getPermissionsStatus(MediaDevices.MICROPHONE)
  );

  useEffect(() => {
    const onMicMutedStateChanged = ({ enabled }) => {
      setIsMicMuted(!enabled);
    };
    APP.sfu.on("mic-state-changed", onMicMutedStateChanged);

    const onMicEnabled = () => {
      setIsMicEnabled(true);
    };
    const onMicDisabled = () => {
      setIsMicEnabled(false);
    };
    scene.addEventListener(MediaDevicesEvents.MIC_SHARE_ENDED, onMicDisabled);
    scene.addEventListener(MediaDevicesEvents.MIC_SHARE_STARTED, onMicEnabled);

    const onPermissionsChanged = ({ mediaDevice, status }) => {
      if (mediaDevice === MediaDevices.MICROPHONE) {
        setPermissionsStatus(status);
      }
    };
    mediaDevicesManager.on(MediaDevicesEvents.PERMISSIONS_STATUS_CHANGED, onPermissionsChanged);

    return () => {
      APP.sfu.off("mic-state-changed", onMicMutedStateChanged);
      scene.removeEventListener(MediaDevicesEvents.MIC_SHARE_ENDED, onMicDisabled);
      scene.removeEventListener(MediaDevicesEvents.MIC_SHARE_STARTED, onMicEnabled);
      mediaDevicesManager.off(MediaDevicesEvents.PERMISSIONS_STATUS_CHANGED, onPermissionsChanged);
    };
  }, [setIsMicMuted, setIsMicEnabled, setPermissionsStatus, scene, mediaDevicesManager]);

  const toggleMute = useCallback(() => {
    if (mediaDevicesManager.isMicShared) {
      mediaDevicesManager.toggleMic();
    } else {
      mediaDevicesManager.startMicShare({ unmute: true });
    }
    scene.systems["hubs-systems"].soundEffectsSystem.playSoundOneShot(SOUND_TOGGLE_MIC);
  }, [mediaDevicesManager, scene]);

  return {
    isMicMuted,
    toggleMute,
    isMicEnabled,
    permissionStatus
  };
}
