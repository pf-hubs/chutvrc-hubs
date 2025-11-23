import React, { useState } from "react";
import PropTypes from "prop-types";
import { ReactComponent as SpotlightIcon } from "../icons/Spotlight.svg";
import { ReactComponent as AudienceIcon } from "../icons/Audience.svg";
import { FormattedMessage } from "react-intl";
import { PublicSpeakingSystem } from "../../systems/public-speaking-system";
import { useRole } from "./hooks/useRole";
import { ToolbarButton } from "../input/ToolbarButton";

function PublicSpeakingMenu({ scene, hubChannel }) {
  const canTogglePublicSpeaking = useRole("owner");
  const [publicSpeakerActive, setPublicSpeakerActive] = useState(false);
  const [publicSpeakingMirroring, setPublicSpeakingMirroring] = useState(false);

  function togglePublicSpeaker() {
    if (publicSpeakerActive) {
      console.log("closePublicSpeaker");
      setPublicSpeakerActive(false);
      PublicSpeakingSystem.closePublicSpeaker();
    } else {
      console.log("initPublicSpeaker");
      setPublicSpeakerActive(true);
      PublicSpeakingSystem.initPublicSpeaker();
    }
  }

  function togglePublicSpeakingMirroring() {
    if (publicSpeakingMirroring) {
      console.log("closePublicSpeakingMirroring");
      setPublicSpeakingMirroring(false);
      PublicSpeakingSystem.closePublicSpeakingMirroring();
    } else {
      console.log("initPublicSpeakingMirroring");
      setPublicSpeakingMirroring(true);
      PublicSpeakingSystem.initPublicSpeakingMirroring();
    }
  }

  return (
    <div style={{ display: "flex", gap: "36px", marginBottom: "10px", paddingLeft: 12, paddingRight: 12 }}>
      {canTogglePublicSpeaking && (
        <ToolbarButton
          icon={<SpotlightIcon />}
          label={
            publicSpeakerActive ? (
              <FormattedMessage id="public-speaking-menu.stop" defaultMessage="Stop Speaking" />
            ) : (
              <FormattedMessage id="public-speaking-menu.start" defaultMessage="Start Speaking" />
            )
          }
          onClick={togglePublicSpeaker}
          selected={publicSpeakerActive}
          preset="accent2"
        />
      )}
      {canTogglePublicSpeaking && (
        <ToolbarButton
          icon={<AudienceIcon />}
          label={
            publicSpeakingMirroring ? (
              <FormattedMessage id="public-speaking-menu.stop-listening" defaultMessage="Stop Listening" />
            ) : (
              <FormattedMessage id="public-speaking-menu.start-listening" defaultMessage="Start Listening" />
            )
          }
          onClick={togglePublicSpeakingMirroring}
          selected={publicSpeakingMirroring}
          preset="accent3"
        />
      )}
    </div>
  );
}

PublicSpeakingMenu.propTypes = {
  hubChannel: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired
};

export default PublicSpeakingMenu;
