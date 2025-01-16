import React from "react";
import PropTypes from "prop-types";
import { ButtonGridPopover } from "../popover/ButtonGridPopover";
import { Popover } from "../popover/Popover";
import { ToolbarButton } from "../input/ToolbarButton";
import { ReactComponent as PublicSpeaking } from "../icons/PublicSpeaking.svg";
import { defineMessage, useIntl } from "react-intl";
import { ToolTip } from "@mozilla/lilypad-ui";

const publicSpeakingTooltipDescription = defineMessage({
  id: "public-speaking-tooltip.description",
  defaultMessage: "Start speaking publicly or receive public speaking from others"
});

const publicSpeakingPopoverTitle = defineMessage({
  id: "public-speaking-popover.title",
  defaultMessage: "Public Speaking"
});

export function PublicSpeakingPopoverButton({ items, onClick }) {
  const intl = useIntl();
  const filteredItems = items.filter(item => !!item);

  // The button is removed if you can't place anything.
  if (filteredItems.length === 0) {
    return null;
  }

  const title = intl.formatMessage(publicSpeakingPopoverTitle);
  const description = intl.formatMessage(publicSpeakingTooltipDescription);

  return (
    <Popover
      title={title}
      content={props => <ButtonGridPopover items={filteredItems} {...props} />}
      placement="top"
      offsetDistance={28}
    >
      {({ togglePopover, popoverVisible, triggerRef }) => (
        <ToolTip description={description}>
          <ToolbarButton
            ref={triggerRef}
            icon={<PublicSpeaking />}
            selected={popoverVisible}
            onClick={() => {
              togglePopover();
              onClick();
            }}
            label={title}
            preset="accent3"
          />
        </ToolTip>
      )}
    </Popover>
  );
}

PublicSpeakingPopoverButton.propTypes = {
  items: PropTypes.array.isRequired
};
