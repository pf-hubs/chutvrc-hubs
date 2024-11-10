import { Vector3 } from "three";
import { createClickable3dButton } from "../utils/create-clickable-3d-button";
import { WaypointSystem } from "./waypoint-system";

export class NimproSystem {
  static isInitialized = false;
  static isAdmin = true;
  static isCurrentAnswerYes = false;
  static isEventListnerRegistered = false;

  static answerByPID = {};
  static thisRoundPointByPID = {};
  static selfPoint = 0;

  static yesButton = null;
  static noButton = null;

  // Store the bound handler to remove it later
  static boundHandleDataChannelMessageReceived = null;

  // Initialization and Cleanup Methods
  static joinGame(isAdmin) {
    if (this.isInitialized) return;
    this.isInitialized = true;
    this.isAdmin = isAdmin;

    if (APP.sfu && !this.isEventListnerRegistered) {
      // Bind the handler and store it in a static property
      this.boundHandleDataChannelMessageReceived = NimproSystem.handleDataChannelMessageReceived.bind(this);
      APP.sfu.on("nimpro_message_received", this.boundHandleDataChannelMessageReceived);

      if (!isAdmin) {
        this.yesButton = createClickable3dButton(new Vector3(-0.5, 1.5, -2), () => {
          this.isCurrentAnswerYes = true;
          this.sendAnswer(this.isCurrentAnswerYes);
        });
        this.noButton = createClickable3dButton(new Vector3(0.5, 1.5, -2), () => {
          this.isCurrentAnswerYes = false;
          this.sendAnswer(this.isCurrentAnswerYes);
        });
      }

      this.isEventListnerRegistered = true;

      console.log("Nimpro initialized as " + (isAdmin ? "admin" : "player"));
    }
  }

  static handleDataChannelMessageReceived({ label, message }) {
    if (!this.isInitialized) return;
    const [pID, value] = message.split("|");

    switch (label) {
      case "#nimpro-ans":
        this.saveParticipantAnswer(pID, value);
        break;
      case "#nimpro-point":
        this.receivePoint(pID, value);
        break;
      case "#nimpro-button-visibility":
        this.setAnswerButtonsVisibility(message === "1");
        break;
      default:
        break;
    }
  }

  /**
   * Admin Methods
   */

  static endGame() {
    if (!this.isInitialized || !this.isAdmin) return;
    this.isInitialized = false;

    // Remove the event listener if it was registered
    if (APP.sfu && this.isEventListnerRegistered && this.boundHandleDataChannelMessageReceived) {
      APP.sfu.off("nimpro_message_received", this.boundHandleDataChannelMessageReceived);
      this.isEventListnerRegistered = false;
      this.sendAnswerButtonsVisibility(false);

      const waypointSystem = APP.scene.systems["hubs-systems"].waypointSystem;
      WaypointSystem.unoccupyWaypoints(waypointSystem.ready.filter(wp => wp.el.className.includes("N-impro-seat")));

      console.log("Nimpro quitted");
    }
  }

  static saveParticipantAnswer(pID, answer) {
    if (this.isAdmin) {
      this.answerByPID[pID] = answer === "1";
      console.log(this.answerByPID);
    }
  }

  static calculateAnswer() {
    if (!this.isInitialized || !this.isAdmin) return;

    const answers = Object.values(this.answerByPID);
    const participantCount = answers.length;

    // If even number of participants, do not calculate the answer
    if (participantCount % 2 === 0) {
      console.log("Even number of participants: " + participantCount);
      return;
    }

    const yesCount = answers.filter(answer => answer).length;
    const noCount = answers.length - yesCount;

    // Determine majority and minority
    const majorityAnswer = yesCount > noCount ? true : false;
    const minorityAnswer = !majorityAnswer;
    const majorityCount = Math.max(yesCount, noCount);
    const minorityCount = Math.min(yesCount, noCount);

    // Allocate points
    for (const pID in this.answerByPID) {
      if (minorityCount === 0) {
        this.thisRoundPointByPID[pID] = 0; // All members delivered the same answer. 0 points for everyone.
      } else if (participantCount > 3 && minorityCount === 1 && this.answerByPID[pID] === minorityAnswer) {
        this.thisRoundPointByPID[pID] = 3; // Single minority gets 3 points if more than 3 participants
      } else if (this.answerByPID[pID] === majorityAnswer && minorityCount !== 1) {
        this.thisRoundPointByPID[pID] = 1; // Majority gets 1 point if no single minority
      } else {
        this.thisRoundPointByPID[pID] = 0;
      }
    }

    console.log("Point in this round:");
    console.log(this.thisRoundPointByPID);
    this.sendScores();
  }

  static sendScores() {
    if (!this.isInitialized || !this.isAdmin) return;
    for (const pID in this.thisRoundPointByPID) {
      APP.sfu.broadcast("#nimpro-point", pID + "|" + this.thisRoundPointByPID[pID]);
    }
    this.sendAnswerButtonsVisibility(false);
  }

  static sendAnswerButtonsVisibility(isVisible) {
    if (!this.isInitialized || !this.isAdmin) return;
    APP.sfu.broadcast("#nimpro-button-visibility", isVisible ? "1" : "0");
  }

  static newRound() {
    if (!this.isInitialized) return;
    this.answerByPID = {};
    this.sendAnswerButtonsVisibility(true);
    console.log("New round started");
  }

  /**
   * Non-Admin Methods
   */

  static sendAnswer(isYes) {
    if (!this.isInitialized || this.isAdmin) return;
    console.log("Send answer: " + isYes);
    APP.sfu.broadcast("#nimpro-ans", APP.sfu._clientId + "|" + (isYes ? 1 : 0));
  }

  static receivePoint(pID, point) {
    if (!this.isAdmin && pID === APP.sfu._clientId) {
      const parsedPoint = typeof point === "string" ? parseInt(point, 10) : point;
      console.log("You got " + parsedPoint + " points in this round.");
      this.selfPoint += parsedPoint;
      console.log("Current total points: " + this.selfPoint);
      // TODO: Update displayed point text
    }
  }

  static setAnswerButtonsVisibility(isVisible) {
    this.yesButton.visible = isVisible;
    this.noButton.visible = isVisible;
  }

  static updateScoreText(score) {
    // TODO: actually switch answer buttons' visibility
  }
}
