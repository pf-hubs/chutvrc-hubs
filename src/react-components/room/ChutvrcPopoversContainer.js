import React, { useState } from "react";
import PropTypes from "prop-types";
import { ChutvrcPopovers } from "./ChutvrcPopovers";
import { useRole } from "./hooks/useRole";
import NimproMenu from "./NimproMenu";
import PublicSpeakingMenu from "./PublicSpeakingMenu";
import { ReactComponent as BrainIcon } from "../icons/Brain.svg";
import { ReactComponent as PublicSpeakingIcon } from "../icons/PublicSpeaking.svg";

export function ChutvrcPopoversContainer({ scene, hubChannel }) {
  const canTogglePublicSpeaking = useRole("owner");
  const canToggleNimpro = useRole("owner");
  const [activeMenu, setActiveMenu] = useState(null);

  const toggleMenu = menu => {
    setActiveMenu(activeMenu === menu ? null : menu);
  };

  const buttons = [
    canTogglePublicSpeaking && {
      id: "public-speaking",
      icon: <PublicSpeakingIcon />,
      label: "Broadcast",
      onClick: () => toggleMenu("publicSpeaking"),
      preset: "accent4"
    },
    canToggleNimpro && {
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
          {activeMenu === "publicSpeaking" && <PublicSpeakingMenu scene={scene} hubChannel={hubChannel} />}
          {activeMenu === "nimpro" && <NimproMenu scene={scene} hubChannel={hubChannel} />}
        </>
      )}
    />
  );
}

ChutvrcPopoversContainer.propTypes = {
  hubChannel: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired
};
