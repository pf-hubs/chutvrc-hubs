import { getReticulumFetchUrl, hubUrl } from "./utils/phoenix-utils";
import { updateEnvironmentForHub, getSceneUrlForHub, updateUIForHub, remountUI } from "./hub";
import { SFU } from "./available-sfu";

function unloadRoomObjects() {
  document.querySelectorAll("[pinnable]").forEach(el => {
    if (el.components.pinnable.data.pinned) {
      el.parentNode.removeChild(el);
    }
  });

  // Clean up empty object.gltf nodes
  document.querySelectorAll("#objects-scene .Room_Objects").forEach(el => {
    if (!el.children.length) {
      el.parentNode.parentNode.removeChild(el.parentNode);
    }
  });
}

function loadRoomObjects(hubId) {
  const objectsScene = document.querySelector("#objects-scene");
  const objectsUrl = getReticulumFetchUrl(`/${hubId}/objects.gltf`);
  const objectsEl = document.createElement("a-entity");
  objectsEl.setAttribute("gltf-model-plus", { src: objectsUrl, useCache: false, inflate: true });
  objectsScene.appendChild(objectsEl);
}

export async function changeHub(hubId, addToHistory = true, waypoint = null) {
  if (hubId === APP.hub.hub_id) {
    console.log("Change hub called with the current hub id. This is a noop.");
    return;
  }
  // Suppress on-screen join and leave messages until we receive a sync.
  APP.hideHubPresenceEvents = true;
  const scene = AFRAME.scenes[0];

  let data;
  try {
    data = await APP.hubChannel.migrateToHub(hubId);
  } catch (e) {
    console.warn(`Failed to join hub ${hubId}: ${e.reason}|${e.message}`);
    APP.messageDispatch.log("joinFailed", { message: e.message });
    return;
  }

  const hub = data.hubs[0];

  if (addToHistory) {
    window.history.pushState(null, null, hubUrl(hubId, {}, hub.slug, waypoint));
  }

  APP.hub = hub;
  updateUIForHub(hub, APP.hubChannel);
  scene.emit("hub_updated", { hub });

  APP.subscriptions.setSubscribed(data.subscriptions.web_push);

  remountUI({
    hubIsBound: data.hub_requires_oauth,
    initialIsFavorited: data.subscriptions.favorites
  });

  NAF.entities.removeRemoteEntities();
  await NAF.connection.adapter.disconnect();
  await APP.sfu.disconnect();
  unloadRoomObjects();
  NAF.connection.connectedClients = {};
  NAF.connection.activeDataChannels = {};

  NAF.room = hub.hub_id;

  if (
    document.querySelector("#environment-scene").childNodes[0].components["gltf-model-plus"].data.src !==
    (await getSceneUrlForHub(hub))
  ) {
    const fader = document.getElementById("viewing-camera").components["fader"];
    fader.fadeOut().then(() => {
      scene.emit("reset_scene");
      updateEnvironmentForHub(hub, APP.entryManager);
    });
  }

  APP.retChannel.push("change_hub", { hub_id: hub.hub_id });

  let connectOption;

  switch (data.sfu) {
    case 1:
      APP.usingSfu = SFU.DIALOG;
      APP.sfu = APP.dialog;
      connectOption = {
        serverUrl: `wss://${hub.host}:${hub.port}`,
        roomId: hub.hub_id,
        serverParams: { host: hub.host, port: hub.port, turn: hub.turn },
        scene,
        clientId: APP.sfu._clientId,
        forceTcp: APP.sfu._forceTcp,
        forceTurn: APP.sfu._forceTurn,
        iceTransportPolicy: APP.sfu._iceTransportPolicy
      };
      break;
    default:
      APP.usingSfu = SFU.SORA;
      APP.sfu = APP.sora;
      connectOption = {
        clientId: data.session_id,
        channelId: data.sora_channel_id,
        signalingUrl: data.sora_signaling_url,
        accessToken: data.sora_access_token,
        debug: data.sora_is_debug
      };
      break;
  }

  await Promise.all([APP.sfu.connect(connectOption), NAF.connection.adapter.connect()]);

  loadRoomObjects(hubId);

  APP.hubChannel.sendEnteredEvent();

  APP.messageDispatch.receive({
    type: "hub_changed",
    hubName: hub.name,
    showLineBreak: true
  });
}
window.changeHub = changeHub;

// TODO see if there is a better way to do this with react router
window.addEventListener("popstate", function () {
  if (!APP.store.state.preferences.fastRoomSwitching) return;
  const qs = new URLSearchParams(location.search);
  const newHubId = qs.get("hub_id") || document.location.pathname.substring(1).split("/")[0];
  if (newHubId !== APP.hub.hub_id) {
    changeHub(newHubId, false);
  }
});
