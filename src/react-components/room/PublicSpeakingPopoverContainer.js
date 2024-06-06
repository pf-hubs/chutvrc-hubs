import React from "react";
import PropTypes from "prop-types";
import { ReactComponent as SpotlightIcon } from "../icons/Spotlight.svg";
import { ReactComponent as AudienceIcon } from "../icons/Audience.svg";
import { PublicSpeakingPopoverButton } from "./PublicSpeakingPopover";
import { FormattedMessage } from "react-intl";
import configs from "../../utils/configs";

export function PublicSpeakingPopoverContainer({ scene, hubChannel }) {
  const items = [
    configs.isAdmin() && {
      id: "speaker",
      icon: SpotlightIcon,
      color: "accent5",
      label: <FormattedMessage id="public-speaking-popover.source.speaker" defaultMessage="Speaker" />,
      onSelect: () => console.log("Start speaking publicly"),
      active: false
    },
    configs.isAdmin() && {
      id: "play-speaking",
      icon: AudienceIcon,
      color: "accent5",
      label: <FormattedMessage id="public-speaking-popover.source.play-speaking" defaultMessage="Play Speaking" />,
      onSelect: () => console.log("Start playing speaking"),
      active: false
    }
  ];

  return <PublicSpeakingPopoverButton items={items} />;
}

PublicSpeakingPopoverContainer.propTypes = {
  hubChannel: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired
};
