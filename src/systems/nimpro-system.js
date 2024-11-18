import { Vector3, Mesh, MeshBasicMaterial } from "three";
import { TextGeometry } from "three/examples/jsm/geometries/TextGeometry";
import { Clickable3DButton } from "../utils/clickable-3d-button";
import { WaypointSystem } from "./waypoint-system";

export class NimproSystem {
  static isInitialized = false;
  static isAdmin = true;
  static isCurrentAnswerYes = false;
  static isEventListnerRegistered = false;
  static seatNum = "00";

  static answerByPID = {};
  static thisRoundPointByPID = {};
  static pointsByPID = {};
  static seatByPID = {};

  static yesButton = null;
  static noButton = null;
  static currentActiveButton = null;

  static currentRoundTextMeshes = {};
  static totalPointsTextMeshes = {};

  // Store the bound handler to remove it later
  static boundHandleDataChannelMessageReceived = null;

  // Initialization and Cleanup Methods
  static joinGame(isAdmin, pNum = "00") {
    if (this.isInitialized && (isAdmin || pNum === this.seatNum)) {
      return;
    }
    this.isInitialized = true;
    this.isAdmin = isAdmin;

    if (APP.sfu) {
      if (!this.isEventListnerRegistered) {
        // Bind the handler and store it in a static property
        this.boundHandleDataChannelMessageReceived = NimproSystem.handleDataChannelMessageReceived.bind(this);
        APP.sfu.on("nimpro_message_received", this.boundHandleDataChannelMessageReceived);
        this.isEventListnerRegistered = true;
      }

      if (!isAdmin) {
        this.seatNum = pNum;
        console.log(pNum);
        APP.sfu.broadcast("#nimpro-seat", APP.sfu._clientId + "|" + pNum);
        this.initAnswerButtons(pNum);
      }

      console.log("Nimpro initialized as " + (isAdmin ? "admin" : "player"));
    }

    // Initialize text meshes for all seats
    for (let i = 1; i <= 5; i++) {
      const seatNum = i.toString().padStart(2, "0");
      this.createTextMeshes(seatNum);
    }
  }

  static handleDataChannelMessageReceived({ label, message }) {
    if (!this.isInitialized) return;
    const [pID, value] = message.split("|");

    switch (label) {
      case "#nimpro-seat":
        if (this.seatByPID[pID]) {
          delete this.seatByPID[pID];
        }
        this.seatByPID[pID] = value;
        break;
      case "#nimpro-ans":
        console.log(`${value} from seat ${pID}`);
        this.answerByPID[pID] = value === "1";
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

    this.answerByPID = {};
    this.thisRoundPointByPID = {};
    this.pointsByPID = {};
    this.seatByPID = {};

    // Reset text meshes
    Object.keys(this.currentRoundTextMeshes).forEach(seatNum => {
      this.updateTextMesh(this.currentRoundTextMeshes[seatNum], "0");
      this.updateTextMesh(this.totalPointsTextMeshes[seatNum], "0");
    });
  }

  static saveParticipantAnswer(pID, answer) {
    if (this.isAdmin && pID in this.seatByPID) {
      this.answerByPID[pID] = answer === "1";
      console.log(this.answerByPID);
    }
  }

  static calculateAnswer() {
    if (!this.isInitialized || !this.isAdmin) return;

    const answers = Object.values(this.answerByPID).filter(answer => answer !== undefined);
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
      if (this.answerByPID[pID] !== undefined) {
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
    }

    console.log("Point in this round:");
    console.log(this.thisRoundPointByPID);
    this.sendScores();
  }

  static sendScores() {
    if (!this.isInitialized || !this.isAdmin) return;
    for (const pID in this.thisRoundPointByPID) {
      if (this.thisRoundPointByPID[pID] !== undefined) {
        APP.sfu.broadcast("#nimpro-point", pID + "|" + this.thisRoundPointByPID[pID]);
      }
    }
    this.sendAnswerButtonsVisibility(false);
  }

  static sendAnswerButtonsVisibility(isVisible) {
    if (!this.isInitialized || !this.isAdmin) return;
    APP.sfu.broadcast("#nimpro-button-visibility", isVisible ? "1" : "0");
  }

  static newRound() {
    if (!this.isInitialized) return;
    for (const pID in this.answerByPID) {
      this.answerByPID[pID] = undefined;
    }
    for (const pID in this.thisRoundPointByPID) {
      this.thisRoundPointByPID[pID] = undefined;
    }
    this.sendAnswerButtonsVisibility(true);
    for (const pID in this.seatByPID) {
      APP.sfu.broadcast("#nimpro-seat", pID + "|" + this.seatByPID[pID]);
    }
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
    if (!this.isAdmin) {
      const parsedPoint = typeof point === "string" ? parseInt(point, 10) : point;
      console.log(`${pID === APP.sfu._clientId ? "You" : pID} got ${parsedPoint} points in this round.`);

      if (this.pointsByPID[pID] !== undefined) {
        this.pointsByPID[pID] += parsedPoint;
      } else {
        this.pointsByPID[pID] = parsedPoint;
      }

      // Update text meshes
      const seatNum = this.seatByPID[pID];
      if (seatNum) {
        this.updateTextMesh(this.currentRoundTextMeshes[seatNum], parsedPoint);
        this.updateTextMesh(this.totalPointsTextMeshes[seatNum], this.pointsByPID[pID]);
      }

      console.log(`Current total points of ${pID === APP.sfu._clientId ? "You" : pID}: ${this.pointsByPID[pID]}`);
    }
  }

  static setAnswerButtonsVisibility(isVisible) {
    if (this.yesButton) this.yesButton.buttonMesh.visible = isVisible;
    if (this.noButton) this.noButton.buttonMesh.visible = isVisible;
  }

  static initAnswerButtons(pNum = "00") {
    if (this.yesButton) {
      this.yesButton.dispose();
      this.yesButton = null;
    }
    if (this.noButton) {
      this.noButton.dispose();
      this.noButton = null;
    }

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
  }

  static createTextMeshes(seatNum) {
    const seat = document.querySelector("#environment-root .N-impro .N-impro-seat-" + seatNum);
    if (!seat) return;

    const scene = APP.world.scene;

    // Create Current Round Points Text Mesh
    const currentRoundTextGeometry = new TextGeometry("0", {
      size: 0.1,
      height: 0.1
    });
    const currentRoundTextMaterial = new MeshBasicMaterial({ color: 0x00ff00 });
    const currentRoundTextMesh = new Mesh(currentRoundTextGeometry, currentRoundTextMaterial);
    scene.add(currentRoundTextMesh);

    // Create Total Points Text Mesh
    const totalPointsTextGeometry = new TextGeometry("0", {
      size: 0.1,
      height: 0.1
    });
    const totalPointsTextMaterial = new MeshBasicMaterial({ color: 0xffd700 });
    const totalPointsTextMesh = new Mesh(totalPointsTextGeometry, totalPointsTextMaterial);
    scene.add(totalPointsTextMesh);

    // Position Text Meshes above the seat
    const seatPos = new Vector3();
    seat.object3D.getWorldPosition(seatPos);

    currentRoundTextMesh.position.set(seatPos.x, seatPos.y + 2, seatPos.z);
    totalPointsTextMesh.position.set(seatPos.x, seatPos.y + 3, seatPos.z);

    // Store references to the meshes
    this.currentRoundTextMeshes[seatNum] = currentRoundTextMesh;
    this.totalPointsTextMeshes[seatNum] = totalPointsTextMesh;
  }

  static updateTextMesh(textMesh, text) {
    if (textMesh) {
      textMesh.geometry = new TextGeometry(text.toString(), {
        size: 0.1,
        height: 0.1
      });
    }
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
