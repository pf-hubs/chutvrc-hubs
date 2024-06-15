import React from "react";
import PropTypes from "prop-types";
import { ReactComponent as SpotlightIcon } from "../icons/Spotlight.svg";
import { ReactComponent as AudienceIcon } from "../icons/Audience.svg";
import { PublicSpeakingPopoverButton } from "./PublicSpeakingPopover";
import { FormattedMessage } from "react-intl";
import configs from "../../utils/configs";
import { SFU_CONNECTION_TYPE } from "../../sfu-types";
import { PublicSpeakingSystem } from "../../systems/public-speaking-system";

export function PublicSpeakingPopoverContainer({ scene, hubChannel }) {
  const items = [
    configs.isAdmin() &&
      !APP.mirrorSpeakingSfu && {
        id: "speaker",
        icon: SpotlightIcon,
        color: "accent5",
        label: <FormattedMessage id="public-speaking-popover.source.speaker" defaultMessage="Speaker" />,
        onSelect: PublicSpeakingSystem.initPublicSpeaker(),
        active: false
      },
    configs.isAdmin() &&
      !(APP.publicSpeakingSfu?._connectionType === SFU_CONNECTION_TYPE.SEND) && {
        id: "play-speaking",
        icon: AudienceIcon,
        color: "accent5",
        label: <FormattedMessage id="public-speaking-popover.source.play-speaking" defaultMessage="Play Speaking" />,
        onSelect: PublicSpeakingSystem.initPublicSpeakingMirroring(hubChannel.hubId),
        active: false
      }
  ];

  return <PublicSpeakingPopoverButton items={items} />;
}

PublicSpeakingPopoverContainer.propTypes = {
  hubChannel: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired
};
