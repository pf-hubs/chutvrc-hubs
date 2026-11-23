import React, { useState } from "react";
import PropTypes from "prop-types";
import { defineMessages, FormattedMessage, useIntl } from "react-intl";
import { Modal } from "../modal/Modal";
import { BackButton } from "../input/BackButton";
import { Button } from "../input/Button";
import { NumericInputField } from "../input/NumericInputField";
import { RadioInputField, RadioInputOption } from "../input/RadioInputField";
import { Column } from "../layout/Column";
import styles from "./BodyCalibrationModal.scss";
import {
  isCalibratedHeight,
  MAX_BODY_HEIGHT_CM,
  MIN_BODY_HEIGHT_CM,
  parseBodyFit,
  parseBodyPosture
} from "../../avatar/calibration/body-calibration";

const messages = defineMessages({
  posture: {
    id: "body-calibration-modal.posture-label",
    defaultMessage: "How you play"
  },
  fit: {
    id: "body-calibration-modal.fit-label",
    defaultMessage: "Fit"
  }
});

/**
 * The body calibration asked for before every entry in VR: how the player plays, their height, and whether
 * the avatar is fitted to them or they to the avatar. It starts from the saved values, so a player who
 * changes nothing only presses Continue. The height is required; nothing is saved until it is valid.
 */
export function BodyCalibrationModal({ className, heightCm, posture, fit, onSave, onBack, ...rest }) {
  const intl = useIntl();
  const [heightText, setHeightText] = useState(isCalibratedHeight(heightCm) ? String(heightCm) : "");
  const [postureValue, setPostureValue] = useState(parseBodyPosture(posture));
  const [fitValue, setFitValue] = useState(parseBodyFit(fit));
  const [heightTouched, setHeightTouched] = useState(false);

  const height = heightText.trim() === "" ? NaN : Number(heightText);
  const heightValid = isCalibratedHeight(height);
  const showHeightError = heightTouched && !heightValid;
  const range = { min: MIN_BODY_HEIGHT_CM, max: MAX_BODY_HEIGHT_CM };

  // With the saved values untouched there is nothing to save: the button only continues
  const unchanged =
    isCalibratedHeight(heightCm) &&
    height === heightCm &&
    postureValue === parseBodyPosture(posture) &&
    fitValue === parseBodyFit(fit);

  const onSubmit = e => {
    e.preventDefault();
    setHeightTouched(true);
    if (!heightValid) return;
    onSave({ heightCm: height, posture: postureValue, fit: fitValue });
  };

  return (
    <Modal
      title={<FormattedMessage id="body-calibration-modal.title" defaultMessage="Body Calibration" />}
      beforeTitle={<BackButton onClick={onBack} />}
      className={className}
      {...rest}
    >
      <Column as="form" center padding grow className={styles.content} onSubmit={onSubmit} noValidate>
        <p>
          <FormattedMessage
            id="body-calibration-modal.intro"
            defaultMessage="Before you enter in VR, tell us how you play and how tall you are, so that your avatar's eyes and hands meet yours."
          />
        </p>
        <p>
          <FormattedMessage
            id="body-calibration-modal.capture-hint"
            defaultMessage="Once you are in VR, stand or sit upright, look straight ahead and press both triggers to set your height."
          />
        </p>
        <RadioInputField
          label={intl.formatMessage(messages.posture)}
          role="radiogroup"
          aria-label={intl.formatMessage(messages.posture)}
          fullWidth
        >
          <RadioInputOption
            name="bodyPosture"
            value="standing"
            checked={postureValue === "standing"}
            onChange={() => setPostureValue("standing")}
            label={<FormattedMessage id="body-calibration-modal.posture-standing" defaultMessage="Standing" />}
          />
          <RadioInputOption
            name="bodyPosture"
            value="sitting"
            checked={postureValue === "sitting"}
            onChange={() => setPostureValue("sitting")}
            label={<FormattedMessage id="body-calibration-modal.posture-sitting" defaultMessage="Sitting" />}
          />
        </RadioInputField>
        <NumericInputField
          name="bodyHeightCm"
          label={<FormattedMessage id="body-calibration-modal.height-label" defaultMessage="Your height (cm)" />}
          required
          min={MIN_BODY_HEIGHT_CM}
          max={MAX_BODY_HEIGHT_CM}
          step={1}
          value={heightText}
          onChange={e => setHeightText(e.target.value)}
          onBlur={() => setHeightTouched(true)}
          invalid={showHeightError}
          description={
            <FormattedMessage
              id="body-calibration-modal.height-description"
              defaultMessage="From {min} to {max} centimetres"
              values={range}
            />
          }
          error={
            showHeightError ? (
              <FormattedMessage
                id="body-calibration-modal.height-error"
                defaultMessage="Enter your height in centimetres, from {min} to {max}."
                values={range}
              />
            ) : undefined
          }
          fullWidth
        />
        <RadioInputField
          label={intl.formatMessage(messages.fit)}
          role="radiogroup"
          aria-label={intl.formatMessage(messages.fit)}
          fullWidth
        >
          <RadioInputOption
            name="bodyFit"
            value="avatarToPlayer"
            checked={fitValue === "avatarToPlayer"}
            onChange={() => setFitValue("avatarToPlayer")}
            label={
              <FormattedMessage
                id="body-calibration-modal.fit-avatar-to-player"
                defaultMessage="Fit the avatar to me"
              />
            }
            description={
              <FormattedMessage
                id="body-calibration-modal.fit-avatar-to-player-description"
                defaultMessage="Your avatar takes your height; you see and move as you really are."
              />
            }
          />
          <RadioInputOption
            name="bodyFit"
            value="playerToAvatar"
            checked={fitValue === "playerToAvatar"}
            onChange={() => setFitValue("playerToAvatar")}
            label={
              <FormattedMessage
                id="body-calibration-modal.fit-player-to-avatar"
                defaultMessage="Fit me to the avatar"
              />
            }
            description={
              <FormattedMessage
                id="body-calibration-modal.fit-player-to-avatar-description"
                defaultMessage="You see from your avatar's eyes, and reach and walk at its size."
              />
            }
          />
        </RadioInputField>
        <Button type="submit" preset="primary" disabled={!heightValid}>
          {unchanged ? (
            <FormattedMessage id="body-calibration-modal.continue-button" defaultMessage="Continue" />
          ) : (
            <FormattedMessage id="body-calibration-modal.save-button" defaultMessage="Save and Continue" />
          )}
        </Button>
      </Column>
    </Modal>
  );
}

BodyCalibrationModal.propTypes = {
  className: PropTypes.string,
  /** The stored values the form starts from; a height that is not calibrated leaves the field empty */
  heightCm: PropTypes.number,
  posture: PropTypes.string,
  fit: PropTypes.string,
  /** Called with { heightCm, posture, fit } once the height is valid */
  onSave: PropTypes.func.isRequired,
  onBack: PropTypes.func
};
