import React from "react";
import PropTypes from "prop-types";
import { Popover } from "../popover/Popover";
import { ToolbarButton } from "../input/ToolbarButton";
import { ReactComponent as VRIcon } from "../icons/VR.svg";
import { ToolTip } from "@mozilla/lilypad-ui";
import { FormattedMessage } from "react-intl";

export function ChutvrcPopovers({ buttons, activeMenu, renderContent }) {
  return (
    <Popover
      title="Features"
      // Given as an element, not as a function: a function is a new component at every redraw of the room's
      // interface, which would throw the open menu away and build it again each time
      content={
        <div style={{ display: "flex", flexDirection: "column", paddingLeft: 12, paddingRight: 12 }}>
          <div style={{ display: "flex", gap: "24px", marginBottom: "10px" }}>
            {buttons.map(button => {
              if (!button) return null;
              if (button.element) return <React.Fragment key={button.id}>{button.element}</React.Fragment>;
              return (
                <ToolbarButton
                  key={button.id}
                  icon={button.icon}
                  label={button.label}
                  onClick={button.onClick}
                  selected={activeMenu === button.id}
                  preset={button.preset}
                />
              );
            })}
          </div>
          <div>{renderContent()}</div>
        </div>
      }
      placement="bottom"
    >
      {({ togglePopover, popoverVisible, triggerRef }) => (
        <ToolTip description={""}>
          <ToolbarButton
            ref={triggerRef}
            icon={<VRIcon />}
            label={<FormattedMessage id="features-popover.button" defaultMessage="Features" />}
            onClick={togglePopover}
            selected={popoverVisible}
            preset="accent3"
          />
        </ToolTip>
      )}
    </Popover>
  );
}

ChutvrcPopovers.propTypes = {
  buttons: PropTypes.array.isRequired,
  activeMenu: PropTypes.string,
  renderContent: PropTypes.func.isRequired
};
