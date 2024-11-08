export class NimproSystem {
  static isInitialized = false;
  static isAdmin = true;
  static isCurrentAnswerYes = false;
  static isEventListnerRegistered = false;

  static answerByPID = {};
  static scoreByPID = {};

  // constructor() {}

  static init(isAdmin) {
    // if (this.isInitialized) return;
    this.isInitialized = true;
    // this.isAdmin = isAdmin;
    this.isAdmin = !this.isAdmin;

    if (APP.sfu && !this.isEventListnerRegistered) {
      APP.sfu.on("nimpro_message_received", NimproSystem.handleDataChannelMessageReceived.bind(this));

      document.addEventListener("keydown", event => {
        if (event.key === "y") {
          this.isCurrentAnswerYes = true;
        }
        if (event.key === "n") {
          this.isCurrentAnswerYes = false;
        }
        if (event.key === "Enter") {
          this.sendAnswer(this.isCurrentAnswerYes);
        }
      });

      this.isEventListnerRegistered = true;
    }
  }

  static handleDataChannelMessageReceived({ label, message }) {
    if (!this.isInitialized) return;
    const [pID, value] = message.split("|");

    switch (label) {
      case "#nimpro-ans":
        if (this.isAdmin) {
          this.answerByPID[pID] = value === "1";
          console.log(this.answerByPID);
        }
        break;
      case "#nimpro-score":
        if (!this.isAdmin && pID === APP.sfu._clientId) {
          console.log("Score: " + value);
          // TODO: add to total score and update displayed score text
        }
        break;
      default:
        break;
    }
  }

  static sendAnswer(isYes) {
    if (!this.isInitialized || this.isAdmin) return;
    console.log("Send answer: " + isYes);
    APP.sfu.broadcast("#nimpro-ans", APP.sfu._clientId + "|" + (isYes ? 1 : 0));
  }

  static calculateAnswer() {
    if (!this.isInitialized || !this.isAdmin) return;
    for (const pID in this.answerByPID) {
      this.scoreByPID[pID] = 0; // TODO: calculation
    }
    this.sendScores();
  }

  static sendScores() {
    if (!this.isInitialized || !this.isAdmin) return;
    for (const pID in this.scoreByPID) {
      APP.sfu.broadcast("#nimpro-score", pID + "|" + this.scoreByPID[pID]);
    }
    this.newRound();
  }

  static newRound() {
    if (!this.isInitialized) return;
    this.answerByPID = {};
    this.scoreByPID = {};
  }
}
