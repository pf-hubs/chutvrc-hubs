import { ToolbarButton } from "../../../input/ToolbarButton";
// TO DO: look into changing icon theme handling to work with TS
// @ts-ignore
import { ReactComponent as CameraIcon } from "../../../icons/Camera.svg";
import { FormattedMessage, defineMessage, useIntl } from "react-intl";
import React, { useState } from "react";
import { ToolTip } from "@mozilla/lilypad-ui";

const recordingDescription = defineMessage({
  id: "recording.description",
  defaultMessage:
    "Press to start recording the scene. If already pressed, pressing again will stop and save the recording to your device."
});

const RecordingButton = () => {
  const [selectedState, setSelectedState] = useState(APP.sfu._isRecording);
  const intl = useIntl();
  const description = intl.formatMessage(recordingDescription);

  const SwitchRecordingState = () => {
    if (APP.sfu._isRecording) {
      // Download recording
      const blob = new Blob([JSON.stringify(APP.sfu._recordedDataChannelMessages)], {
        type: "text/json"
      });
      const link = document.createElement("a");

      link.download = "chutvrc-recording-" + APP.sfu._roomId + "-" + Date.now();
      link.href = window.URL.createObjectURL(blob);
      link.dataset.downloadurl = ["text/json", link.download, link.href].join(":");

      const evt = new MouseEvent("click", {
        view: window,
        bubbles: true,
        cancelable: true
      });

      link.dispatchEvent(evt);
      link.remove();

      APP.sfu._recordedDataChannelMessages = [];
    }

    APP.sfu._isRecording = !APP.sfu._isRecording;
    setSelectedState(APP.sfu._isRecording);
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

export default RecordingButton;
