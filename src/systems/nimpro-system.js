import { Quaternion, Vector3 } from "three";
import { Clickable3DButton } from "../utils/clickable-3d-button";
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
  static currentActiveButton = null;

  // Store the bound handler to remove it later
  static boundHandleDataChannelMessageReceived = null;

  // Initialization and Cleanup Methods
  static joinGame(isAdmin, pNum = "00") {
    if (this.isInitialized) {
      this.quitGame();
      return;
    }
    this.isInitialized = true;
    this.isAdmin = isAdmin;

    if (APP.sfu && !this.isEventListnerRegistered) {
      // Bind the handler and store it in a static property
      this.boundHandleDataChannelMessageReceived = NimproSystem.handleDataChannelMessageReceived.bind(this);
      APP.sfu.on("nimpro_message_received", this.boundHandleDataChannelMessageReceived);

      if (!isAdmin) {
        this.initAnswerButtons(pNum);
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
    if (this.yesButton) this.yesButton.buttonMesh.visible = isVisible;
    if (this.noButton) this.noButton.buttonMesh.visible = isVisible;
  }

  static initAnswerButtons(pNum = "00") {
    const seat = document.querySelector("#environment-root .N-impro .N-impro-seat-" + pNum);
    if (!seat) return;

    const camera = document.getElementById("viewing-camera").object3DMap.camera;
    const scene = APP.world.scene;

    this.yesButton = new Clickable3DButton(
      camera,
      scene,
      0x66ff66, // Default green color
      0x00ff00, // Active bright green color
      () => this.handleButtonClick("yes") // Handles the button click
    );

    this.noButton = new Clickable3DButton(
      camera,
      scene,
      0xff6666, // Default red color
      0xff0000, // Active bright red color
      () => this.handleButtonClick("no") // Handles the button click
    );

    this.setAnswerButtonsVisibility(false);

    const seatPos = new Vector3();
    const seatQua = new Quaternion();
    seat.object3D.getWorldPosition(seatPos);
    seat.object3D.getWorldQuaternion(seatQua);

    const seatForward = new THREE.Vector3(0, 0, -1).applyQuaternion(seatQua);
    const right = new THREE.Vector3(0.5, 0, 0).applyQuaternion(seatQua);
    const left = right.clone().negate();

    const distanceInFront = -0.5;
    const offsetFromCenter = 0.5;

    const noObjectPosition = seatPos
      .clone()
      .add(seatForward.clone().multiplyScalar(distanceInFront))
      .add(left.clone().multiplyScalar(offsetFromCenter));

    const yesObjectPosition = seatPos
      .clone()
      .add(seatForward.clone().multiplyScalar(distanceInFront))
      .add(right.clone().multiplyScalar(offsetFromCenter));

    this.yesButton.setPosition(yesObjectPosition.add(new Vector3(0, 1.2, 0)));
    this.noButton.setPosition(noObjectPosition.add(new Vector3(0, 1.2, 0)));
  }

  static handleButtonClick(buttonType) {
    if (this.currentActiveButton === buttonType) return;

    // Reset the previous active button's state
    if (this.currentActiveButton === "yes") {
      this.yesButton.resetActiveState();
    } else if (this.currentActiveButton === "no") {
      this.noButton.resetActiveState();
    }

    // Update the active button and current answer
    if (buttonType === "yes") {
      this.isCurrentAnswerYes = true;
    } else if (buttonType === "no") {
      this.isCurrentAnswerYes = false;
    }

    this.currentActiveButton = buttonType;

    // Broadcast the answer
    this.sendAnswer(this.isCurrentAnswerYes);
  }
}
