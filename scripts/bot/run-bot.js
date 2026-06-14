#!/usr/bin/env node
const doc = `
Usage:
    ./run-bot.js [options]
Options:
    -h --help            Show this screen
    -u --url=<url>       URL
    -o --host=<host>     Hubs host if URL is not specified [default: localhost:8080]
    -r --room=<room>     Room id
    -a --audio=<file>    File to replay for the bot's outgoing audio
    -v --volume=<number> Audio volume (default: 1.0)
    -d --data=<file>     File to replay for the bot's data channel
    -s --spawn=<string>  Spawn point
`;

const docopt = require("docopt").docopt;
const options = docopt(doc);

const puppeteer = require("puppeteer");
const querystring = require("query-string");

function log(...objs) {
  console.log.call(null, [new Date().toISOString()].concat(objs).join(" "));
}

(async () => {
  const evalMode_ = !!process.env.EVAL_MODE;
  const browser = await puppeteer.launch({
    ignoreHTTPSErrors: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--ignore-gpu-blacklist",
      "--ignore-certificate-errors",
      ...(evalMode_
        ? [
            "--autoplay-policy=no-user-gesture-required",
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            // Prevent background-tab throttling so the chirp detector's tick
            // loop (setInterval) and any RAF-based code keep firing at full
            // rate. Without these, headless tabs that lose focus get throttled
            // to ~1 Hz, which destroys 50 ms chirp burst detection.
            "--disable-background-timer-throttling",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            // Use raw IP ICE candidates instead of mDNS .local names so the
            // SFU can connectivity-check the bot directly on LAN setups where
            // the SFU side does not resolve .local addresses. Without this,
            // PeerConnections exist but never get a working candidate pair,
            // producing bytesReceived=0 on inbound-rtp.
            "--disable-features=WebRtcHideLocalIpsWithMdns,Translate,OptimizationHints",
            // Skip Chrome startup/maintenance overhead that has no role in a
            // measurement bot. Each one shaves a small amount of CPU + memory
            // per bot; at N=20 that adds up to a noticeable difference in
            // bot-host load (which affects clock_ci_ms and pose throttling).
            "--disable-extensions",
            "--disable-default-apps",
            "--disable-component-update",
            "--disable-sync",
            "--disable-client-side-phishing-detection",
            "--disable-domain-reliability",
            "--no-default-browser-check",
            "--no-first-run",
            "--metrics-recording-only"
          ]
        : [])
    ]
  });
  const page = await browser.newPage();
  await page.setBypassCSP(true);
  // When the page console.logs an Error instance (or any non-primitive),
  // Puppeteer's msg.text() returns the placeholder "JSHandle@error" instead
  // of the actual message/stack. Unwrap the args here so the bot log shows
  // the real error content.
  page.on("console", async msg => {
    const text = msg.text();
    if (text.includes("JSHandle@")) {
      try {
        const args = await Promise.all(
          msg.args().map(arg =>
            arg
              .evaluate(v => {
                if (v && typeof v === "object" && "stack" in v) {
                  // Error-like object: extract message + stack
                  return String(v.message || v) + (v.stack ? "\n" + v.stack : "");
                }
                if (v && typeof v === "object") {
                  try {
                    return JSON.stringify(v);
                  } catch (e) {
                    return Object.prototype.toString.call(v);
                  }
                }
                return String(v);
              })
              .catch(() => "<arg eval failed>")
          )
        );
        log("PAGE: ", args.join(" "));
      } catch (e) {
        // Fall back to the placeholder text if unwrap fails
        log("PAGE: ", text);
      }
    } else {
      log("PAGE: ", text);
    }
  });
  page.on("error", err => log("ERROR: ", err.stack || err.toString()));
  page.on("pageerror", err => log("PAGE ERROR: ", err.stack || err.toString()));

  const baseUrl = options["--url"] || `https://${options["--host"]}/hub.html`;

  const params = {
    bot: true,
    allow_multi: true
  };
  const roomOption = options["--room"];
  if (roomOption) {
    params.hub_id = roomOption;
  }
  const volumeOption = options["--volume"];
  if (volumeOption !== null && options["--audio"]) {
    params.audio_volume = volumeOption;
  }

  // Eval mode: opt-in via env vars. When EVAL_MODE is set, append the probe
  // query params so the hub client loads the eval probe.
  const evalMode = !!process.env.EVAL_MODE;
  if (evalMode) {
    params.eval = 1;
    params.mode = process.env.EVAL_SPEAKER === "1" ? "speaker" : "passive";
    if (process.env.EVAL_LABEL) params.label = process.env.EVAL_LABEL;
    if (process.env.EVAL_REPORT_WS_URL) params.report = process.env.EVAL_REPORT_WS_URL;
    if (process.env.EVAL_SAMPLE_RATE) params.sample = process.env.EVAL_SAMPLE_RATE;
  }
  const spawnPoint = options["--spawn"] ? `#${options["--spawn"]}` : "";

  const url = `${baseUrl}?${querystring.stringify(params)}${spawnPoint}`;
  log(url);

  const navigate = async () => {
    try {
      log("Spawning bot...");
      // domcontentloaded fires once the DOM is parsed, which is enough for
      // the bot to start clicking and waiting for selectors. The default
      // "load" wait can time out on resource-contended hosts (e.g., when
      // multiple bots are launching on the same machine), since Hubs loads
      // many large assets after DOMContentLoaded.
      // Timeout bumped to 120 s for the same reason.
      await page.goto(url, { timeout: 120000, waitUntil: "domcontentloaded" });
      await page.evaluate(() => console.log(navigator.userAgent));
      let retryCount = 5;
      let backoff = 1000;
      const loadFiles = async () => {
        try {
          // Interact with the page so that audio can play.
          await page.mouse.click(100, 100);
          if (options["--audio"]) {
            const audioInput = await page.waitForSelector("#bot-audio-input", { timeout: 120000 });
            audioInput.uploadFile(options["--audio"]);
            log("Uploaded audio file.");
          }
          if (options["--data"]) {
            const dataInput = await page.waitForSelector("#bot-data-input", { timeout: 120000 });
            dataInput.uploadFile(options["--data"]);
            log("Uploaded data file.");
          }
        } catch (e) {
          log("Interaction error", e.message);
          if (retryCount-- < 0) {
            // If retries failed, throw and restart navigation.
            throw new Error("Retries failed");
          }
          log("Retrying...");
          backoff *= 2;
          // Retry interaction to start audio playback
          setTimeout(loadFiles, backoff);
        }
      };

      await loadFiles();

      // Do a periodic sanity check of the state of the bots.
      setInterval(async function () {
        let avatarCounts;
        try {
          avatarCounts = await page.evaluate(() => ({
            connectionCount: Object.keys(NAF.connection.adapter.occupants).length,
            avatarCount: document.querySelectorAll("[networked-avatar]").length - 1
          }));
          log(JSON.stringify(avatarCounts));
        } catch (e) {
          // Ignore errors. This usually happens when the page is shutting down.
        }
        // Check for more than two connections to allow for a margin where we have a connection but the a-frame
        // entity has not initialized yet.
        if (avatarCounts && avatarCounts.connectionCount > 2 && avatarCounts.avatarCount === 0) {
          if (evalMode) {
            log("Dog-pile detected but EVAL_MODE is active — continuing.");
          } else {
            // It seems the bots have dog-piled on to a restarting server, so we're going to shut things down and
            // let the hubs-ops bash script restart us.
            log("Detected avatar dog-pile. Restarting.");
            process.exit(1);
          }
        }
      }, 60 * 1000);
    } catch (e) {
      log("Navigation error", e.message);
      setTimeout(navigate, 1000);
    }
  };

  navigate();
})();
