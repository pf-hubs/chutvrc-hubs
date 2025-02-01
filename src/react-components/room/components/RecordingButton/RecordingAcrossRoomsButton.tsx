import { ToolbarButton } from "../../../input/ToolbarButton";
// TO DO: look into changing icon theme handling to work with TS
// @ts-ignore
import { ReactComponent as CameraIcon } from "../../../icons/Camera.svg";
import { FormattedMessage, defineMessage, useIntl } from "react-intl";
import React, { useEffect, useRef, useState } from "react";
import { ToolTip } from "@mozilla/lilypad-ui";
import downloadRoomRecording from "../../../../utils/room-recording-utils";
import { PublicSpeakingSystem } from "../../../../systems/public-speaking-system";

const recordingDescription = defineMessage({
  id: "recording.description",
  defaultMessage:
    "Press to start recording in this room and all the other rooms listening to public speakings from your room. If already pressed, pressing again will stop and save the recording to your device and those of the listeners in the other rooms."
});

const RecordingAcrossRoomsButton = () => {
  const [selectedState, setSelectedState] = useState(false); // APP.publicSpeakingSfu?._isRecording
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const intl = useIntl();
  const description = intl.formatMessage(recordingDescription);

  const toggleRecordingAcrossRooms = (isOn: boolean) => {
    if (APP.sfu._isRecording && !isOn) {
      downloadRoomRecording();
    }
    if (APP.publicSpeakingSfu) {
      APP.publicSpeakingSfu.broadcastUint8("#isRecordingAcrossRooms", new Uint8Array([isOn ? 1 : 0]));
    } else if (APP.sfu._publicSpeakerClientIdsInRoom.length > 0) {
      APP.sfu.broadcast("#toggleRecordingViaPublicSpeaker", APP.sfu._publicSpeakerClientIdsInRoom[0] + "|" + isOn);
    }
    APP.sfu._isRecording = isOn;
  };

  const SwitchRecordingState = () => {
    if (selectedState) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
        toggleRecordingAcrossRooms(false);
        console.log("Recording stopped.");
      }
    } else {
      intervalRef.current = setInterval(() => toggleRecordingAcrossRooms(true), 1000);
      console.log("Recording started.");
    }

    setSelectedState(!selectedState);
  };

  return (
    <ToolTip description={description}>
      <ToolbarButton
        // Ignore type lint error as we will be redoing ToolbarButton in the future
        // @ts-ignore
        onClick={SwitchRecordingState}
        icon={<CameraIcon />}
        preset="accent5"
        label={<FormattedMessage id="recording-button" defaultMessage="Recording" />}
        selected={selectedState}
      />
    </ToolTip>
  );
};

export default RecordingAcrossRoomsButton;
