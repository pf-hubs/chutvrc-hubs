# chutvrc

[![License: MPL 2.0](https://img.shields.io/badge/License-MPL%202.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)

<!-- [![Build Status](https://travis-ci.org/mozilla/hubs.svg?branch=master)](https://travis-ci.org/mozilla/hubs)
[![Discord](https://img.shields.io/discord/498741086295031808)](https://discord.gg/CzAbuGu) -->

The client-side code for chutvrc, forked from [Mozilla Hubs](https://hubs.mozilla.com/), an online 3D collaboration platform that works for desktop, mobile, and VR platforms.

<!--[Learn more about Hubs](https://hubs.mozilla.com/docs/welcome.html)-->

## chutvrc features

### Full-body avatars

- Currently, only humanoid avatars made by ReadyPlayerMe or VRoid (with filename extension changed from .vrm to .glb) were confirmed to be compatible to this feature.
- Avatars made with other tool may not behave normally for now, and we will keep trying to improve the implementation to accommodate more kinds of full-body humanoid avatars.
- There may also be problems in Inverse Kinematics(IK) for full-body avatars, especially around wrists. We are planning for improvements.
- Currently tests are mainly done using Meta Quest 3, using controller or bare hand. Hand tracking implementation from other devices are planned for further development.

### BitECS implementation

- Management of avatars to BitECS were implemented independent from Mozilla Hubs' official BitECS implementation.
- Migration of implementation with the Mozilla Hubs' BitECS implementation is planned.

### Alternative WebRTC SFU

- Feature for third-party WebRTC SFU solutions for environments hard to host and maintain performance with Dialog (Dialog is set as the default preference)
- chutvrc has implementation of Sora, a proprietary service provided by Shiguredou inc., currently available only for customers in Japan (Check their website for details)

#### How to use Sora

- Please register on your own and fill in the value of your Sora project id and Sora bearer token at the Server Settings in the admin page
- You can also set them in Reticulum's secret file (e.g. `config/dev.secret.exs`) as follows:

  ```
  use Mix.Config

  config :ret, Ret.SoraChannelResolver,
    bearer_token: "YOUR_SORA_CLOUD_BEARER_TOKEN",
    project_id: "YOUR_SORA_CLOUD_PROJECT_ID"
  ```

- If it is enabled at the admin page, Room manager can choose which WebRTC SFU to use for each room at room edit menu.
- At the Server Settings in the admin page, admin can set the default SFU for all newly created rooms and the availability to switching SFU for every room.

### Synchronizing avatar transform with WebRTC DataChannel

- This feature is adapted to both Dialog and Sora.
- With this feature enabled, avatar transforms will be transmitted through DataChannel no matter you are using Dialog or Sora as the SFU.
- It is an experimental implementation considering it is logical to have body language and voice real-time communication transmitted within the same protocol.

## Instruction for local build

### For Apple Mac (tested with M1 Mac)

Please check [this gist](https://gist.github.com/YHhaoareyou/199410454695d804db5fe7f569d055f0) for local build / development.

### For Ubuntu 

Build instruction are planned to be released soon.

Until that, you can refer to [this instruction by albirrkarim](https://github.com/albirrkarim/mozilla-hubs-installation-detailed/blob/main/VPS_FOR_HUBS.md).

## Funding and Sponsor

- chutvrc is sponsored and developed for [CHANGE Project](https://change.kawasaki-net.ne.jp/en/), by a research team at the [Virtual Reality Educational Research Center](https://vr.u-tokyo.ac.jp/), The University of Tokyo.
- You can support this development through the GitHub Sponsor button which is linked to the [UTokyo Foundation](https://utf.u-tokyo.ac.jp/en).
- Please write in the donation purpose "For Virtual Reality Educational Research Center, chutvrc related research/educational purpose".
  - Please be aware that 30% of the amount of donation will be used by the university administration office.

---

Below is the original README for Mozilla Hubs, which most information are also useful for chutvrc.

It will be updated to migration information considering the current status of Mozilla Hubs, which is planned to shutdown at the end of May 2024.

---

## Getting Started

If you would like to run Hubs on your own servers, check out [Hubs Cloud](https://hubs.mozilla.com/docs/hubs-cloud-intro.html).

If you would like to deploy a custom client to your existing Hubs Cloud instance please refer to [this guide](https://hubs.mozilla.com/docs/hubs-cloud-custom-clients.html).

If you would like to contribute to the main fork of the Hubs client please see the [contributor guide](./CONTRIBUTING.md).

If you just want to check out how Hubs works and make your own modifications continue on to our Quick Start Guide.
### Quick Start

[Install NodeJS](https://nodejs.org) if you haven't already. We use 16.16.0 on our build servers. If you work on multiple javascript projects it may be useful to use something like [NVM](https://github.com/nvm-sh/nvm) to manage multiple versions of node for you.

Run the following commands:

```bash
git clone https://github.com/mozilla/hubs.git
cd hubs
# nvm use v16.16.0 # if using NVM
npm ci
npm run dev
```

The backend dev server is configured with CORS to only accept connections from "localhost:8080", so you will need to access it from that host. To do this, you likely want to add "localhost" and "hubs-proxy.local" to the [local "hosts" file](https://phoenixnap.com/kb/how-to-edit-hosts-file-in-windows-mac-or-linux) on your computer:

```
127.0.0.1	localhost
127.0.0.1	hubs-proxy.local
```

Then visit https://localhost:8080 (note: HTTPS is required, you'll need to accept the warning for the self-signed SSL certificate)

> Note: When running the Hubs client locally, you will still connect to the development versions of our [Janus WebRTC](https://github.com/mozilla/janus-plugin-sfu) and [reticulum](https://github.com/mozilla/reticulum) servers. These servers do not allow being accessed outside of localhost. If you want to host your own Hubs servers, please check out [Hubs Cloud](https://hubs.mozilla.com/docs/hubs-cloud-intro.html).

## Documentation

The Hubs documentation can be found [here](https://hubs.mozilla.com/docs).

## Community

Join us on our [Discord Server](https://discord.gg/CzAbuGu) or [follow us on Twitter](https://twitter.com/MozillaHubs).

## Contributing

Read our [contributor guide](./CONTRIBUTING.md) to learn how you can submit bug reports, feature requests, and pull requests.

We're also looking for help with localization. The Hubs redesign has a lot of new text and we need help from people like you to translate it. Follow the [localization docs](./src/assets/locales/README.md) to get started.

Contributors are expected to abide by the project's [Code of Conduct](./CODE_OF_CONDUCT.md) and to be respectful of the project and people working on it.

## Additional Resources

- [Reticulum](https://github.com/mozilla/reticulum) - Phoenix-based backend for managing state and presence.
- [NAF Janus Adapter](https://github.com/mozilla/naf-janus-adapter) - A [Networked A-Frame](https://github.com/networked-aframe) adapter for the Janus SFU service.
- [Janus Gateway](https://github.com/meetecho/janus-gateway) - A WebRTC proxy used for centralizing network traffic in this client.
- [Janus SFU Plugin](https://github.com/mozilla/janus-plugin-sfu) - Plugins for Janus which enables it to act as a SFU.
- [Hubs-Ops](https://github.com/mozilla/hubs-ops) - Infrastructure as code + management tools for running necessary backend services on AWS.

## Privacy

Mozilla and Hubs believe that privacy is fundamental to a healthy internet. Read our [privacy policy](https://www.mozilla.org/en-US/privacy/hubs/) for more info.

## License

Hubs is licensed with the [Mozilla Public License 2.0](./LICENSE)
