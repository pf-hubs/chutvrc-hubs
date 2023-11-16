import React from "react";
import PropTypes from "prop-types";
import { ToolbarButton } from "./input/ToolbarButton";
import { ReactComponent as DocumentIcon } from "./icons/Document.svg";

const AudioAvatarSyncTestDlButton = ({ isLocalTimestamp }) => (
  <ToolbarButton
    icon={<DocumentIcon />}
    label={(isLocalTimestamp ? "Local" : "Remote") + " Sync TS"}
    preset="accent5"
    onClick={() => {
      let blob = new Blob([JSON.stringify(isLocalTimestamp ? APP.localAudioTimestamps : APP.audioTimestamps)], {
        type: "text/json"
      });
      let link = document.createElement("a");
      document.body.appendChild(link);
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute(
        "download",
        `audio-${isLocalTimestamp ? "sendLocal" : "recvRemote"}-${APP.usingSfu.toString()}-${NAF.clientId}.json`
      );
      link.click();
      document.body.removeChild(link);
      APP.audioTimestamps = [];

      blob = new Blob([JSON.stringify(isLocalTimestamp ? APP.localTransformTimestamps : APP.transformTimestamps)], {
        type: "text/json"
      });
      link = document.createElement("a");
      document.body.appendChild(link);
      link.href = window.URL.createObjectURL(blob);
      link.setAttribute(
        "download",
        `avatar-${isLocalTimestamp ? "sendLocal" : "recvRemote"}-${APP.usingSfu.toString()}-${NAF.clientId}.json`
      );
      link.click();
      document.body.removeChild(link);
      APP.transformTimestamps = [];
    }}
  />
);

AudioAvatarSyncTestDlButton.propTypes = {
  isLocalTimestamp: PropTypes.bool
};

export default AudioAvatarSyncTestDlButton;
