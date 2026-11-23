import { useEffect, useState } from "react";
import { PUBLIC_SPEAKING_STATE_CHANGED, PublicSpeakingSystem } from "../../../systems/public-speaking-system";

/**
 * Whether this client is speaking to the other rooms and whether it is listening to them, read from the
 * sessions that do it and followed through the public speaking system's event. A menu that shows these
 * keeps no state of its own: it would be lost whenever the menu is closed or rebuilt, and it would miss a
 * room owner switching the broadcast on or off from the people list, and a start that failed.
 */
export function usePublicSpeakingState() {
  const [state, setState] = useState(() => ({
    speaking: PublicSpeakingSystem.isSpeaking,
    listening: PublicSpeakingSystem.isListening
  }));

  useEffect(() => {
    const update = () => setState({ speaking: PublicSpeakingSystem.isSpeaking, listening: PublicSpeakingSystem.isListening });
    APP.sfu.on(PUBLIC_SPEAKING_STATE_CHANGED, update);
    // Whatever changed between the first draw and this effect
    update();
    return () => {
      APP.sfu.off(PUBLIC_SPEAKING_STATE_CHANGED, update);
    };
  }, []);

  return state;
}

/** Whether the room's list of speakers has the client, as a room owner's "Enable public speak" puts it there */
export function useIsListedAsSpeaker(clientId) {
  const [listed, setListed] = useState(() => PublicSpeakingSystem.isListedAsSpeaker(clientId));

  useEffect(() => {
    const update = () => setListed(PublicSpeakingSystem.isListedAsSpeaker(clientId));
    APP.sfu.on(PUBLIC_SPEAKING_STATE_CHANGED, update);
    update();
    return () => {
      APP.sfu.off(PUBLIC_SPEAKING_STATE_CHANGED, update);
    };
  }, [clientId]);

  return listed;
}
