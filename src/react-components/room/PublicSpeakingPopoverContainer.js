import React from "react";
import PropTypes from "prop-types";
import { ReactComponent as SpotlightIcon } from "../icons/Spotlight.svg";
import { ReactComponent as AudienceIcon } from "../icons/Audience.svg";
import { PublicSpeakingPopoverButton } from "./PublicSpeakingPopover";
import { FormattedMessage } from "react-intl";
import configs from "../../utils/configs";
import { SFU_CONNECTION_TYPE } from "../../sfu-types";
import { connectSfu, createSfuAdapter } from "../../utils/sfu-adapter-utils";

export function PublicSpeakingPopoverContainer({ scene, hubChannel }) {
  const items = [
    configs.isAdmin() &&
      !APP.mirrorSpeakingSfu && {
        id: "speaker",
        icon: SpotlightIcon,
        color: "accent5",
        label: <FormattedMessage id="public-speaking-popover.source.speaker" defaultMessage="Speaker" />,
        onSelect: () => {
          APP.publicSpeakingSfu = createSfuAdapter({ connectionType: SFU_CONNECTION_TYPE.SEND });
          connectSfu(APP.publicSpeakingSfu, {
            clientId: "public-speaker",
            channelId: "public-speaking",
            scene: scene,
            serverUrl: APP.sfu._serverUrl || "",
            serverParams: APP.sfu._serverParams || { host: "localhost", port: 3306, turn: null },
            // signalingUrl: data.sora_signaling_url, TODO: retrieve sora_signaling_url
            // accessToken: data.sora_access_token, TODO: retrieve sora access token by channelId "public-speaking"
            forceTcp: APP.sfu._forceTcp || false,
            forceTurn: APP.sfu._forceTurn || false,
            iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
            debug: false
          });
        },
        active: false
      },
    configs.isAdmin() &&
      !(APP.publicSpeakingSfu?._connectionType === SFU_CONNECTION_TYPE.SEND) && {
        id: "play-speaking",
        icon: AudienceIcon,
        color: "accent5",
        label: <FormattedMessage id="public-speaking-popover.source.play-speaking" defaultMessage="Play Speaking" />,
        onSelect: () => {
          APP.publicSpeakingSfu = createSfuAdapter({ connectionType: SFU_CONNECTION_TYPE.RECV });
          connectSfu(APP.publicSpeakingSfu, {
            clientId: APP.sfu._clientId,
            channelId: "public-speaking",
            scene: scene,
            serverUrl: APP.sfu._serverUrl || "",
            serverParams: APP.sfu._serverParams || { host: "localhost", port: 3306, turn: null },
            // signalingUrl: data.sora_signaling_url, TODO: retrieve sora_signaling_url
            // accessToken: data.sora_access_token, TODO: retrieve sora access token by channelId "public-speaking"
            forceTcp: APP.sfu._forceTcp || false,
            forceTurn: APP.sfu._forceTurn || false,
            iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
            debug: false
          });
          APP.mirrorSpeakingSfu = createSfuAdapter({ connectionType: SFU_CONNECTION_TYPE.SEND });
          connectSfu(APP.mirrorSpeakingSfu, {
            clientId: "public-speaker",
            channelId: hubChannel.hubId,
            scene: scene,
            serverUrl: APP.sfu._serverUrl || "",
            serverParams: APP.sfu._serverParams || { host: "localhost", port: 3306, turn: null },
            // signalingUrl: data.sora_signaling_url, TODO: retrieve sora_signaling_url
            // accessToken: data.sora_access_token, TODO: retrieve sora access token by channelId hubChannel.hubId
            forceTcp: APP.sfu._forceTcp || false,
            forceTurn: APP.sfu._forceTurn || false,
            iceTransportPolicy: APP.sfu._iceTransportPolicy || false,
            debug: false
          });
          // TODO: Create a dedicated class for public speaking mirroring
          function mirrorPublicSpeaking(clientId, kind) {
            if (clientId !== "public-speaker" || kind !== "audio") return;
            APP.publicSpeakingSfu.getMediaStream("public-speaker", "audio").then(stream => {
              APP.mirrorSpeakingSfu.setLocalMediaStream(stream);
            });
            APP.mirrorSpeakingSfu.setLocalDataChannelMessage(APP.publicSpeakingSfu.getDataChannelMessage());
          }
          APP.sfu.on("stream_updated", mirrorPublicSpeaking, this);
        },
        active: false
      }
  ];

  return <PublicSpeakingPopoverButton items={items} />;
}

PublicSpeakingPopoverContainer.propTypes = {
  hubChannel: PropTypes.object.isRequired,
  scene: PropTypes.object.isRequired
};
