import React, { useState } from "react";
import PropTypes from "prop-types";
import { ReactComponent as SpotlightIcon } from "../icons/Spotlight.svg";
import { ReactComponent as AudienceIcon } from "../icons/Audience.svg";
import { PublicSpeakingPopoverButton } from "./PublicSpeakingPopover";
import { FormattedMessage } from "react-intl";
import { PublicSpeakingSystem } from "../../systems/public-speaking-system";
import { useRole } from "./hooks/useRole";

export function PublicSpeakingPopoverContainer({ scene, hubChannel }) {
  const canTogglePublicSpeaking = useRole("owner");
  const [publicSpeakerActive, setPublicSpeakerActive] = useState(!!APP.publicSpeakingSfu);
  const [publicSpeakingMirroring, setPublicSpeakingMirroring] = useState(
    !!APP.publicSpeakersMirrorSfu && !!APP.publicSpeakerAgentSfus
  );

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
    canTogglePublicSpeaking &&
      !publicSpeakingMirroring && {
        id: "speaker",
        icon: SpotlightIcon,
        color: "accent5",
        label: publicSpeakerActive ? (
          <FormattedMessage id="public-speaking-popover.source.stop-speaking" defaultMessage="Stop speaking" />
        ) : (
          <FormattedMessage id="public-speaking-popover.source.start-speaking" defaultMessage="Start speaking" />
        ),
        onSelect: togglePublicSpeaker,
        active: publicSpeakerActive
      },
    canTogglePublicSpeaking &&
      !publicSpeakerActive && {
        id: "play-speaking",
        icon: AudienceIcon,
        color: "accent5",
        label: publicSpeakingMirroring ? (
          <FormattedMessage id="public-speaking-popover.source.stop-listening" defaultMessage="Stop listening" />
        ) : (
          <FormattedMessage id="public-speaking-popover.source.start-listening" defaultMessage="Start listening" />
        ),
        onSelect: togglePublicSpeakingMirroring,
        active: publicSpeakingMirroring
      }
  ];

  return <PublicSpeakingPopoverButton items={items} onClick={() => setPublicSpeakerActive(!!APP.publicSpeakingSfu)} />;
}

PublicSpeakingPopoverContainer.propTypes = {
  hubChannel: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired
};
