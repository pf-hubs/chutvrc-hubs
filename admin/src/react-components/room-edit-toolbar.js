/* eslint-disable @calm/react-intl/missing-formatted-message*/

import React, { useState } from "react";
import { Toolbar, SaveButton } from "react-admin";
import { withStyles } from "@material-ui/core/styles";
import Button from "@material-ui/core/Button";
import { Dialog, DialogContent, DialogContentText, DialogActions } from "@material-ui/core";

const roomEditToolbarStyles = {
  spaceBetween: { justifyContent: "space-between" },
  dialogActions: { padding: "0 5px" }
};

const DeleteStates = Object.freeze({
  Confirming: Symbol("confirming"),
  Deleting: Symbol("deleting"),
  Succeeded: Symbol("succeeded"),
  Failed: Symbol("failed")
});

export const RoomEditToolbar = withStyles(roomEditToolbarStyles)(props => {
  const { classes, ...other } = props;
  const { Confirming, Deleting, Succeeded, Failed } = DeleteStates;
  const [openConfirmationDialog, setOpenConfirmationDialog] = useState(false);
  const [deleteState, setDeleteState] = useState(Confirming);

  const onDeleteAccount = async () => {
    setDeleteState(Deleting);

    try {
      const resp = await fetch(`/api/v1/hubs/${props.id}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          authorization: `bearer ${window.APP.store.state.credentials.token}`
        }
      });

      setDeleteState(resp.ok ? Succeeded : Failed);
    } catch {
      setDeleteState(Failed);
    }
  };

  return (
    <Toolbar {...other} className={`${classes.spaceBetween}`}>
      <SaveButton />

      {!props.record.is_admin && (
        <Button label="Delete" onClick={() => setOpenConfirmationDialog(true)} variant="outlined">
          Delete
        </Button>
      )}

      <Dialog open={openConfirmationDialog}>
        <DialogContent>
          <DialogContentText>
            {(() => {
              switch (deleteState) {
                case Confirming:
                  return (
                    <>
                      Are you sure you want to delete room {props.record.name}?<br />
                      <br />
                      <b>WARNING!</b> This room will be permanently deleted. <b>This cannot be undone.</b>
                    </>
                  );
                case Deleting:
                  return <>Deleting room {props.record.name}...</>;
                case Succeeded:
                  return <>Successfully deleted room {props.record.name}.</>;
                case Failed:
                  return <>Failed to delete room {props.record.name}.</>;
              }
            })()}
          </DialogContentText>
        </DialogContent>

        <DialogActions className={`${classes.dialogActions} ${classes.spaceBetween}`}>
          {[Succeeded, Failed].includes(deleteState) && (
            <Button
              variant="outlined"
              onClick={() => {
                setOpenConfirmationDialog(false);
                if (deleteState === Succeeded) {
                  props.history.push("/hubs");
                }
              }}
            >
              Okay
            </Button>
          )}

          {deleteState === Confirming && (
            <>
              <Button variant="outlined" onClick={onDeleteAccount}>
                Yes, permanently delete this room
              </Button>
              <Button variant="outlined" onClick={() => setOpenConfirmationDialog(false)}>
                Cancel
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </Toolbar>
  );
});
