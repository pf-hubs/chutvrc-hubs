import React, { useState } from "react";
import PropTypes from "prop-types";
import { ChutvrcPopovers } from "./ChutvrcPopovers";
import { useRole } from "./hooks/useRole";
import NimproMenu from "./NimproMenu";
import PublicSpeakingMenu from "./PublicSpeakingMenu";
import RecordingButton from "./components/RecordingButton/RecordingButton";
import configs from "../../utils/configs";
import { ReactComponent as BrainIcon } from "../icons/Brain.svg";
import { ReactComponent as PublicSpeakingIcon } from "../icons/PublicSpeaking.svg";

/** The Features menu of the toolbar. An admin turns each feature on in the app settings; with none left it is hidden */
export function ChutvrcPopoversContainer({ scene, hubChannel, canRecord }) {
  const isOwner = useRole("owner");
  const [activeMenu, setActiveMenu] = useState(null);

  const showRecording = canRecord && !!configs.feature("enable_recording");
  const showBroadcast = isOwner && !!configs.feature("enable_public_speaking");
  const showNimpro = !!configs.feature("enable_nimpro");
  if (!showRecording && !showBroadcast && !showNimpro) return null;

  const toggleMenu = menu => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const buttons = [
    showRecording && { id: "recording", element: <RecordingButton /> },
    showBroadcast && {
      id: "publicSpeaking",
      icon: <PublicSpeakingIcon />,
      label: "Broadcast",
      onClick: () => toggleMenu("publicSpeaking"),
      preset: "accent4"
    },
    showNimpro && {
      id: "nimpro",
      icon: <BrainIcon />,
      label: "Nimpro",
      onClick: () => toggleMenu("nimpro"),
      preset: "accent2"
    }
  ];

  return (
    <ChutvrcPopovers
      buttons={buttons}
      activeMenu={activeMenu}
      renderContent={() => (
        <>
          {showBroadcast && activeMenu === "publicSpeaking" && (
            <PublicSpeakingMenu scene={scene} hubChannel={hubChannel} />
          )}
          {showNimpro && activeMenu === "nimpro" && <NimproMenu scene={scene} hubChannel={hubChannel} />}
        </>
      )}
    />
  );
}

ChutvrcPopoversContainer.propTypes = {
  hubChannel: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired,
  canRecord: PropTypes.bool
};
