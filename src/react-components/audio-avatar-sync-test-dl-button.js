import React, { useState } from "react";
import PropTypes from "prop-types";
import { ToolbarButton } from "./input/ToolbarButton";
import { ReactComponent as UploadIcon } from "./icons/Upload.svg";
import { ReactComponent as ObserveIcon } from "./icons/Show.svg";
import { ReactComponent as DocumentIcon } from "./icons/Document.svg";

const AASyncTestDlButton = ({ isLocalTimestamp }) => {
  const [isSender, setIsSender] = useState(false);
  const [isReceiver, setIsReceiver] = useState(false);

  if (isLocalTimestamp && !isSender) {
    return (
      <ToolbarButton
        icon={<UploadIcon />}
        label={"SyncTest Send"}
        preset="accent5"
        onClick={() => {
          APP.isSenderInAASyncTest = true;
          setIsSender(true);
        }}
      ></ToolbarButton>
    );
  } else if (!isLocalTimestamp && !isReceiver) {
    return (
      <ToolbarButton
        icon={<ObserveIcon />}
        label={"SyncTest Recv"}
        preset="accent5"
        onClick={() => {
          APP.isReceiverInAASyncTest = true;
          setIsReceiver(true);
        }}
      ></ToolbarButton>
    );
  } else {
    return (
      <ToolbarButton
        icon={<DocumentIcon />}
        label={(isLocalTimestamp ? "Local" : "Remote") + " TS DL"}
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

          if (isLocalTimestamp) {
            blob = new Blob([JSON.stringify(APP.estimatedRecvAvatarTimestampsAtSenderClock)], {
              type: "text/json"
            });
            link = document.createElement("a");
            document.body.appendChild(link);
            link.href = window.URL.createObjectURL(blob);
            link.setAttribute("download", `avatarArriveTimeEstimated-${APP.usingSfu.toString()}-${NAF.clientId}.json`);
            link.click();
            document.body.removeChild(link);
          }

          if (isLocalTimestamp) {
            APP.localAudioTimestamps = [];
            APP.localTransformTimestamps = [];
            APP.isSenderInAASyncTest = false;
            APP.estimatedRecvAvatarTimestampsAtSenderClock = {};
            setIsSender(false);
          } else {
            APP.audioTimestamps = {};
            APP.transformTimestamps = {};
            APP.isReceiverInAASyncTest = false;
            setIsReceiver(false);
          }
        }}
      />
    );
  }
};

AASyncTestDlButton.propTypes = {
  isLocalTimestamp: PropTypes.bool
};

export default AASyncTestDlButton;
