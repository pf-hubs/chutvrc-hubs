export default function downloadRoomRecording() {
  const blob = new Blob([JSON.stringify(APP.sfu._recordedDataChannelMessages)], {
    type: "text/json"
  });
  const link = document.createElement("a");

  link.download = "chutvrc-recording-" + APP.sfu._roomId + "-" + Date.now();
  link.href = window.URL.createObjectURL(blob);
  link.dataset.downloadurl = ["text/json", link.download, link.href].join(":");

  const evt = new MouseEvent("click", {
    view: window,
    bubbles: true,
    cancelable: true
  });

  link.dispatchEvent(evt);
  link.remove();

  APP.sfu._recordedDataChannelMessages = [];
}
