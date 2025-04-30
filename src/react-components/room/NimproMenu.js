import React, { useState } from "react";
import PropTypes from "prop-types";
import { ReactComponent as NimproIcon } from "../icons/VR.svg";
import { FormattedMessage } from "react-intl";
import { NimproSystem } from "../../systems/nimpro-system";
import { ToolbarButton } from "../input/ToolbarButton";

function NimproMenu({ scene, hubChannel }) {
  const [nimproActive, setNimproActive] = useState(APP.nimproActive);

  function toggleNimpro() {
    APP.nimproActive = !nimproActive;
    setNimproActive(!nimproActive);
    if (nimproActive) {
      console.log("quitNimpro");
      NimproSystem.endGame();
    } else {
      console.log("initNimpro");
      NimproSystem.joinGame(true);
    }
  }

  return (
    <div style={{ display: "flex", gap: "24px", marginBottom: "10px" }}>
      <ToolbarButton
        icon={<></>}
        label={
          nimproActive ? (
            <FormattedMessage id="nimpro-menu.quit" defaultMessage="Quit Nimpro" />
          ) : (
            <FormattedMessage id="nimpro-menu.init" defaultMessage="Init Nimpro" />
          )
        }
        onClick={toggleNimpro}
        selected={nimproActive}
        preset="accent1"
      />
      <ToolbarButton
        icon={<></>}
        label={<FormattedMessage id="nimpro-menu.new-round" defaultMessage="New Round" />}
        onClick={() => NimproSystem.newRound()}
        preset="accent2"
      />
      {/* <ToolbarButton
        icon={<></>}
        label={<FormattedMessage id="nimpro-menu.next-question" defaultMessage="Question" />}
        onClick={() => NimproSystem.nextQuestion()}
        preset="accent3"
      /> */}
      <ToolbarButton
        icon={<></>}
        label={<FormattedMessage id="nimpro-menu.calculate-answer" defaultMessage="Result" />}
        onClick={() => NimproSystem.calculateAnswer()}
        preset="accent4"
      />
    </div>
  );
}

NimproMenu.propTypes = {
  hubChannel: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired
};

export default NimproMenu;
