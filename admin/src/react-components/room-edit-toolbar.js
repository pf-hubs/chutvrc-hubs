/* eslint-disable @calm/react-intl/missing-formatted-message*/

import React from "react";
import { Toolbar, SaveButton } from "react-admin";
import { withStyles } from "@material-ui/core/styles";

const roomEditToolbarStyles = {
  spaceBetween: { justifyContent: "space-between" },
  dialogActions: { padding: "0 5px" }
};

export const RoomEditToolbar = withStyles(roomEditToolbarStyles)(props => {
  const { classes, ...other } = props;

  return (
    <Toolbar {...other} className={`${classes.spaceBetween}`}>
      <SaveButton />
    </Toolbar>
  );
});
