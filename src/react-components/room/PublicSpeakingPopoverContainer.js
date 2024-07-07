import React, { useState } from "react";
import PropTypes from "prop-types";
import { ReactComponent as SpotlightIcon } from "../icons/Spotlight.svg";
import { ReactComponent as AudienceIcon } from "../icons/Audience.svg";
import { PublicSpeakingPopoverButton } from "./PublicSpeakingPopover";
import { FormattedMessage } from "react-intl";
import configs from "../../utils/configs";
import { PublicSpeakingSystem } from "../../systems/public-speaking-system";

export function PublicSpeakingPopoverContainer({ scene, hubChannel }) {
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

  const items = [
    configs.isAdmin() &&
      !APP.publicSpeakersMirrorSfu && {
        id: "speaker",
        icon: SpotlightIcon,
        color: "accent5",
        label: <FormattedMessage id="public-speaking-popover.source.speaker" defaultMessage="Speaker" />,
        onSelect: togglePublicSpeaker,
        active: publicSpeakerActive
      },
    configs.isAdmin() &&
      !(APP.publicSpeakingSfu?._roomId === "public_speaking") && {
        id: "play-speaking",
        icon: AudienceIcon,
        color: "accent5",
        label: <FormattedMessage id="public-speaking-popover.source.play-speaking" defaultMessage="Play Speaking" />,
        onSelect: togglePublicSpeakingMirroring,
        active: publicSpeakingMirroring
      }
  ];

  return <PublicSpeakingPopoverButton items={items} />;
}

PublicSpeakingPopoverContainer.propTypes = {
  hubChannel: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired
};
