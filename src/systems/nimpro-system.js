import { Vector3, Quaternion } from "three";
import { Text } from "troika-three-text";
import { Clickable3DButton } from "../utils/clickable-3d-button";
import { WaypointSystem } from "./waypoint-system";

// NimproSystem: Class for managing the game logic of Nimpro
export class NimproSystem {
  // Game initialization status and role
  static isInitialized = false; // Indicates whether the game has been initialized
  static isAdmin = true; // Indicates whether the current client is the admin
  static isCurrentAnswerYes = false; // Participant's current answer (true for "Yes", false for "No")
  static isEventListenerRegistered = false; // Indicates whether the event listener has been registered
  static seatNum = "00"; // Seat number assigned to the participant

  // Game state data
  static answerByPID = {}; // Stores the answers by participant ID (pID)
  static thisRoundPointByPID = {}; // Stores the points earned in the current round by participant ID
  static pointsByPID = {}; // Stores the total points by participant ID
  static seatByPID = {}; // Maps participant IDs to their seat numbers

  // Answer buttons for participants
  static yesButton = null; // Button for "Yes" answer
  static noButton = null; // Button for "No" answer
  static currentActiveButton = null; // Currently active button ("yes" or "no")
  static pointObjectLow = null;
  static pointObjectHigh = null;

  // Text objects for displaying answers and points
  static answerTextBySeatNum = {}; // Text for answer and current round points by seat number
  static totalPointsTextBySeatNum = {}; // Text for total points by seat number
  static totalPointObjectsBySeatNum = {}; // Objects that represent the total point by seat number

  // Store the bound event handler to remove it later
  static boundHandleDataChannelMessageReceived = null;

  // media-pager component of the question slide
  static questionSlidePager = null;

  // Initialization and Cleanup Methods

  /**
   * Method to join the game, called by both admin and participants
   * @param {boolean} isAdmin - Indicates if the client is the admin
   * @param {string} pNum - Participant's seat number (default is "00")
   */
  static joinGame(isAdmin, pNum = "00") {
    console.log(document.querySelector("#environment-root .N-impro").object3D);
    this.retrieveQuestionSlidePager();

    // If already initialized and role hasn't changed, do nothing
    if (this.isInitialized && (isAdmin || pNum === this.seatNum)) {
      return;
    }
    this.isInitialized = true;
    this.isAdmin = isAdmin;

    if (APP.sfu) {
      // Register event listener if not already registered
      if (!this.isEventListenerRegistered) {
        // Bind the handler and store it in a static property
        this.boundHandleDataChannelMessageReceived = NimproSystem.handleDataChannelMessageReceived.bind(this);
        APP.sfu.on("nimpro_message_received", this.boundHandleDataChannelMessageReceived);
        this.isEventListenerRegistered = true;
      }

      if (!isAdmin) {
        // For participants, assign seat number and initialize answer buttons
        this.seatNum = pNum;
        APP.sfu.broadcast("#nimpro-seat", APP.sfu._clientId + "|" + pNum);
        this.initAnswerButtons(pNum);

        APP.sfu._avatarSyncHelper?.switchSelfAnimState(2); // avatar anim state TODO: change number to type AvatarAnimState
      }

      console.log("Nimpro initialized as " + (isAdmin ? "admin" : "player"));
    }

    // Initialize Text objects for all seats (from "01" to "05")
    ["01", "02", "03", "04", "05"].forEach(seatNum => {
      this.initTextsAndObjectsForSeat(seatNum);
    });

    this.pointObjectLow = document.querySelector("#environment-root .N-impro .point-object-low")?.object3D;
    this.pointObjectHigh = document.querySelector("#environment-root .N-impro .point-object-high")?.object3D;
  }

  /**
   * Event handler for data channel messages
   * @param {Object} param0 - Contains the label and message from the data channel
   */
  static handleDataChannelMessageReceived({ label, message }) {
    if (!this.isInitialized) return;
    const [pID, value] = message.split("|");
    console.log([label, pID, value].join("|"));

    switch (label) {
      case "#nimpro-seat":
        // When a participant joins and broadcasts their seat number
        this.seatByPID[pID] = value;
        // Hide answer and current point texts at the start of a new round
        for (const seatNum in this.answerTextBySeatNum) {
          const answerAndCurrentPointText = this.answerTextBySeatNum[seatNum];
          if (answerAndCurrentPointText) {
            answerAndCurrentPointText.visible = false;
          }
        }
        break;
      case "#nimpro-ans":
        // When a participant submits their answer
        console.log(`${value} from seat ${pID}`);
        this.answerByPID[pID] = value === "1";
        if (this.isAdmin) {
          const answerAndCurrentPointText = this.answerTextBySeatNum[this.seatByPID[pID]];
          answerAndCurrentPointText.visible = true;
          answerAndCurrentPointText.text = value === "1" ? "Y" : "N";
          answerAndCurrentPointText.sync();
        }
        // Do not reveal the answer yet
        break;
      case "#nimpro-point":
        // When points are sent from the admin
        this.receivePoint(pID, value);
        break;
      case "#nimpro-button-visibility":
        // Control visibility of answer buttons
        this.setAnswerButtonsVisibility(message === "1");
        // Optionally, reset the question slide for participants (commented out)
        // if (message !== "1") {
        //   const mediaPdfElement = document.querySelector("a-entity[media-pdf]");
        //   mediaPdfElement.components["media-pager"].setPage(mediaPdfElement.getAttribute("media-pager", "index").index);
        // }
        break;
      default:
        break;
    }
  }

  /**
   * Initialize Texts or Objects for a seat
   * @param {string} seatNum - The seat number
   */
  static initTextsAndObjectsForSeat(seatNum) {
    // If text objects already exist, no need to create
    if (this.answerTextBySeatNum[seatNum]) {
      return;
    }

    // Get the seat element
    const seat = document.querySelector("#environment-root .N-impro .N-impro-seat-" + seatNum);
    if (!seat) return;

    // Get participant's own seat
    const selfSeat = document.querySelector("#environment-root .N-impro .N-impro-seat-" + this.seatNum);

    // Get positions and orientations
    const seatPos = new Vector3();
    const seatQua = new Quaternion();
    seat.object3D.getWorldPosition(seatPos);
    seat.object3D.getWorldQuaternion(seatQua);

    const cameraPos = new Vector3();
    const camera = document.getElementById("viewing-camera").object3DMap.camera;
    camera.getWorldPosition(cameraPos);

    const selfSeatPos = new Vector3();
    const selfSeatQua = new Quaternion();
    if (selfSeat) {
      selfSeat.object3D.getWorldPosition(selfSeatPos);
      selfSeat.object3D.getWorldQuaternion(selfSeatQua);
    }

    // Create Text for answer and current round points
    const answerAndCurrentPointText = new Text();
    answerAndCurrentPointText.text = "";
    answerAndCurrentPointText.fontSize = 0.2;
    answerAndCurrentPointText.position.set(seatPos.x, seatPos.y + 2.5, seatPos.z); // Position above the seat
    answerAndCurrentPointText.color = 0xffffff;
    answerAndCurrentPointText.visible = false; // Hide initially
    answerAndCurrentPointText.sync();
    APP.world.scene.add(answerAndCurrentPointText);

    // Create Text for total points
    const totalPointsText = new Text();
    totalPointsText.text = "0";
    totalPointsText.fontSize = 0.2;
    totalPointsText.position.set(seatPos.x, seatPos.y + 3, seatPos.z); // Position above the answer text
    totalPointsText.color = 0xff9900;
    totalPointsText.sync();
    APP.world.scene.add(totalPointsText);

    // Determine the eye position of the participant
    const selfEyePos = selfSeatPos.clone().add(new Vector3(0, 1.5, 0)); // Eye position at 1.5 units height

    // Make texts face the camera or participant
    answerAndCurrentPointText.lookAt(this.isAdmin ? cameraPos : selfEyePos);
    totalPointsText.lookAt(this.isAdmin ? cameraPos : selfEyePos);

    if (seatNum === this.seatNum && selfSeat) {
      // For participant's own seat, locate text in front of the participant locally
      const offset = new Vector3(0, 0, 1).applyQuaternion(selfSeatQua); // Offset 1 unit in front of the seat
      answerAndCurrentPointText.position.add(new Vector3(offset.x, -1, offset.z)); // Adjust position
      answerAndCurrentPointText.lookAt(selfEyePos); // Make text face participant
      totalPointsText.position.add(new Vector3(offset.x, -1, offset.z));
      totalPointsText.lookAt(selfEyePos);

      // Optionally, rotate question slide to the participant locally (commented out)
      // const mediaPdfElement = document.querySelector("a-entity[media-pdf]");
      // mediaPdfElement.components["media-pager"].setPage(mediaPdfElement.getAttribute("media-pager", "index").index);
    }

    // Store the text objects
    this.answerTextBySeatNum[seatNum] = answerAndCurrentPointText;
    this.totalPointsTextBySeatNum[seatNum] = totalPointsText;
    this.totalPointObjectsBySeatNum[seatNum] = [];
  }

  /**
   * Admin Methods
   */

  /**
   * End the game and clean up resources
   */
  static endGame() {
    if (!this.isInitialized || !this.isAdmin) return;
    this.isInitialized = false;

    // Remove the event listener if it was registered
    if (APP.sfu && this.isEventListenerRegistered && this.boundHandleDataChannelMessageReceived) {
      APP.sfu.off("nimpro_message_received", this.boundHandleDataChannelMessageReceived);
      this.isEventListenerRegistered = false;
      this.sendAnswerButtonsVisibility(false);

      // Unoccupy waypoints for seats
      const waypointSystem = APP.scene.systems["hubs-systems"].waypointSystem;
      WaypointSystem.unoccupyWaypoints(waypointSystem.ready.filter(wp => wp.el.className.includes("N-impro-seat")));

      console.log("Nimpro quitted");
    }

    // Reset game state data
    this.answerByPID = {};
    this.thisRoundPointByPID = {};
    this.pointsByPID = {};
    this.seatByPID = {};

    // Dispose of Text objects
    this.disposeTextObjects();

    // TODO: let participants stand up
  }

  /**
   * Dispose of Text objects to free up resources
   */
  static disposeTextObjects() {
    // Remove and dispose answer texts
    for (const seatNum in this.answerTextBySeatNum) {
      const textObj = this.answerTextBySeatNum[seatNum];
      if (textObj) {
        APP.world.scene.remove(textObj);
        textObj.dispose();
      }
    }
    this.answerTextBySeatNum = {};

    // Remove and dispose total points texts
    for (const seatNum in this.totalPointsTextBySeatNum) {
      const textObj = this.totalPointsTextBySeatNum[seatNum];
      if (textObj) {
        APP.world.scene.remove(textObj);
        textObj.dispose();
      }
    }
    for (const seatNum in this.totalPointObjectsBySeatNum) {
      for (const pointObject of this.totalPointObjectsBySeatNum[seatNum]) {
        if (pointObject) {
          APP.world.scene.remove(pointObject);
          pointObject.dispose();
        }
      }
    }
    this.totalPointsTextBySeatNum = {};
    this.totalPointObjectsBySeatNum = {};
  }

  /**
   * Calculate answers and allocate points to participants
   */
  static calculateAnswer() {
    if (!this.isInitialized || !this.isAdmin) return;

    // Get the list of submitted answers
    const answers = Object.values(this.answerByPID).filter(answer => answer !== undefined);
    const participantCount = answers.length;

    // If even number of participants, do not calculate the answer
    if (participantCount % 2 === 0) {
      console.log("Even number of participants: " + participantCount);
      return;
    }

    // Count the number of "Yes" and "No" answers
    const yesCount = answers.filter(answer => answer).length;
    const noCount = answers.length - yesCount;

    // Determine majority and minority answers
    const majorityAnswer = yesCount > noCount ? true : false;
    const minorityAnswer = !majorityAnswer;
    const majorityCount = Math.max(yesCount, noCount);
    const minorityCount = Math.min(yesCount, noCount);

    // Allocate points to participants based on their answers
    for (const pID in this.answerByPID) {
      if (this.answerByPID[pID] !== undefined) {
        /*
        if (minorityCount === 0) {
          // All members gave the same answer, 0 points
          this.thisRoundPointByPID[pID] = 0;
        } else if (participantCount > 3 && minorityCount === 1) {
          // If more than 3 participants (e.g., 5) and there is only 1 minority, the minority gets 3 points, while the majority gets 0 points
          this.thisRoundPointByPID[pID] = this.answerByPID[pID] === minorityAnswer ? 3 : 0;
        } else if (this.answerByPID[pID] === majorityAnswer) {
          // Majority gets 1 point
          this.thisRoundPointByPID[pID] = 1;
        } else {
          // Others get 0 points
          this.thisRoundPointByPID[pID] = 0;
        }*/

        this.thisRoundPointByPID[pID] = 3;

        // Update total points on admin's client
        if (this.pointsByPID[pID] !== undefined) {
          this.pointsByPID[pID] += this.thisRoundPointByPID[pID];
        } else {
          this.pointsByPID[pID] = this.thisRoundPointByPID[pID];
        }

        // Update the Text objects on admin's client
        const seatNum = this.seatByPID[pID];
        if (seatNum) {
          const totalPointsText = this.totalPointsTextBySeatNum[seatNum];
          const answerAndCurrentPointText = this.answerTextBySeatNum[seatNum];
          const thisRoundPoint = this.thisRoundPointByPID[pID];
          const seat = document.querySelector("#environment-root .N-impro .N-impro-seat-" + seatNum);

          if (thisRoundPoint > 0 && seat && this.pointObjectHigh && this.pointObjectLow) {
            const pointObject = thisRoundPoint > 1 ? this.pointObjectHigh.clone() : this.pointObjectLow.clone();
            pointObject.visible = true;
            pointObject.position.copy(
              seat.object3D.position
                .clone()
                .add(new Vector3(this.totalPointObjectsBySeatNum[seatNum].length / 10, 3, 0))
            );
            APP.world.scene.add(pointObject);
            this.totalPointObjectsBySeatNum[seatNum].push(pointObject);
          }

          if (totalPointsText) {
            totalPointsText.text = `${this.pointsByPID[pID]}`;
            totalPointsText.sync();
          }
          if (answerAndCurrentPointText) {
            answerAndCurrentPointText.visible = true; // Show the text
            const answerText = this.answerByPID[pID] ? "Y" : "N";
            answerAndCurrentPointText.text = `${answerText} +${thisRoundPoint}`;
            answerAndCurrentPointText.sync();
          }
        }
      }
    }

    console.log("Point in this round: ");
    console.log(this.thisRoundPointByPID);
    // Send the scores to participants
    this.sendScores();
  }

  /**
   * Send scores to participants and hide answer buttons
   */
  static sendScores() {
    if (!this.isInitialized || !this.isAdmin) return;
    // Broadcast points to participants
    for (const pID in this.thisRoundPointByPID) {
      if (this.thisRoundPointByPID[pID] !== undefined) {
        APP.sfu.broadcast("#nimpro-point", pID + "|" + this.thisRoundPointByPID[pID]);
      }
    }
    // Hide answer buttons
    this.sendAnswerButtonsVisibility(false);
  }

  /**
   * Control visibility of answer buttons for participants
   * @param {boolean} isVisible - Whether the buttons should be visible
   */
  static sendAnswerButtonsVisibility(isVisible) {
    if (!this.isInitialized || !this.isAdmin) return;
    APP.sfu.broadcast("#nimpro-button-visibility", isVisible ? "1" : "0");
  }

  /**
   * Start a new round of the game
   */
  static newRound() {
    if (!this.isInitialized) return;

    if (this.questionSlidePager) {
      this.questionSlidePager.setPage(this.questionSlidePager.data.index + 1);
    }

    // Reset answers and points for the new round
    for (const pID in this.answerByPID) {
      this.answerByPID[pID] = undefined;
    }
    for (const pID in this.thisRoundPointByPID) {
      this.thisRoundPointByPID[pID] = undefined;
    }
    // Hide answer and current point texts
    for (const seatNum in this.answerTextBySeatNum) {
      const answerAndCurrentPointText = this.answerTextBySeatNum[seatNum];
      if (answerAndCurrentPointText) {
        answerAndCurrentPointText.visible = false;
      }
    }
    // Do not hide totalPointsText
    // Show answer buttons
    this.sendAnswerButtonsVisibility(true);
    // Broadcast seat assignments to all participants
    for (const pID in this.seatByPID) {
      APP.sfu.broadcast("#nimpro-seat", pID + "|" + this.seatByPID[pID]);
    }
    console.log("New round started");
  }

  // static nextQuestion() {
  //   this.questionSlidePager.setPage(this.questionSlidePager.data.index + 1);
  // }

  static retrieveQuestionSlidePager() {
    if (!this.isAdmin) return;
    const frame = document.querySelector("#environment-root .N-impro .QuestionSlide");
    if (!frame) return;

    const framePos = new Vector3();
    frame.object3D.getWorldPosition(framePos);

    const pdfPos = new Vector3();
    const interactables = [...document.querySelectorAll("a-scene a-entity.interactable")];
    const questionSlide = interactables.find(interactable => {
      if (interactable.hasAttribute("media-pager")) {
        interactable.object3D.getWorldPosition(pdfPos);
        if (framePos.distanceTo(pdfPos) < 0.1) {
          return true;
        }
      }
      return false;
    });
    if (questionSlide) {
      this.questionSlidePager = questionSlide.components["media-pager"];
      this.questionSlidePager.setPage(0);
    }
  }

  /**
   * Non-Admin Methods
   */

  /**
   * Send participant's answer to the admin
   * @param {boolean} isYes - Participant's answer (true for "Yes", false for "No")
   */
  static sendAnswer(isYes) {
    if (!this.isInitialized || this.isAdmin) return;
    console.log("Send answer: " + isYes);
    APP.sfu.broadcast("#nimpro-ans", APP.sfu._clientId + "|" + (isYes ? 1 : 0));
  }

  /**
   * Receive points from admin and update texts
   * @param {string} pID - Participant ID
   * @param {number|string} point - Points received
   */
  static receivePoint(pID, point) {
    const parsedPoint = typeof point === "string" ? parseInt(point, 10) : point;
    console.log(`${pID === APP.sfu._clientId ? "You" : pID} got ${parsedPoint} points in this round.`);

    // Update total points
    if (this.pointsByPID[pID] !== undefined) {
      this.pointsByPID[pID] += parsedPoint;
    } else {
      this.pointsByPID[pID] = parsedPoint;
    }

    // Update the Text objects
    const seatNum = this.seatByPID[pID];
    if (seatNum) {
      const totalPointsText = this.totalPointsTextBySeatNum[seatNum];
      const answerAndCurrentPointText = this.answerTextBySeatNum[seatNum];
      const seat = document.querySelector("#environment-root .N-impro .N-impro-seat-" + seatNum);

      if (parsedPoint > 0 && seat && this.pointObjectHigh && this.pointObjectLow) {
        const pointObject = parsedPoint > 1 ? this.pointObjectHigh.clone() : this.pointObjectLow.clone();
        pointObject.visible = true;
        console.log(pointObject.position.clone());
        pointObject.position.copy(
          seat.object3D.position.clone().add(new Vector3(this.totalPointObjectsBySeatNum[seatNum].length / 10, 3, 0))
        );
        APP.world.scene.add(pointObject);
        console.log(pointObject.position.clone());
        this.totalPointObjectsBySeatNum[seatNum].push(pointObject);
      }

      if (totalPointsText) {
        totalPointsText.text = `${this.pointsByPID[pID]}`;
        totalPointsText.sync();
      }
      if (answerAndCurrentPointText) {
        answerAndCurrentPointText.visible = true; // Show the text
        const answerText = this.answerByPID[pID] ? "Y" : "N";
        answerAndCurrentPointText.text = `${answerText} +${parsedPoint}`;
        answerAndCurrentPointText.sync();
      }
    }

    console.log(`Current total points of ${pID === APP.sfu._clientId ? "You" : pID}: ${this.pointsByPID[pID]}`);
  }

  /**
   * Set visibility of answer buttons for participants
   * @param {boolean} isVisible - Whether the buttons should be visible
   */
  static setAnswerButtonsVisibility(isVisible) {
    if (this.yesButton) {
      this.yesButton.resetActiveState();
      this.yesButton.buttonMesh.visible = isVisible;
    }
    if (this.noButton) {
      this.noButton.resetActiveState();
      this.noButton.buttonMesh.visible = isVisible;
    }
    this.currentActiveButton = "";
  }

  /**
   * Initialize answer buttons for participants
   * @param {string} pNum - Participant's seat number
   */
  static initAnswerButtons(pNum = "00") {
    // Dispose existing buttons if any
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

    // Create the Yes and No buttons
    this.yesButton = new Clickable3DButton(
      camera,
      scene,
      0x66ff66, // Default green color
      0x00ff00, // Active bright green color
      () => this.handleButtonClick("yes") // Handle the button click
    );

    this.noButton = new Clickable3DButton(
      camera,
      scene,
      0xff6666, // Default red color
      0xff0000, // Active bright red color
      () => this.handleButtonClick("no") // Handle the button click
    );

    // Hide buttons initially
    this.setAnswerButtonsVisibility(false);

    // Position the buttons relative to the seat
    const seatPos = new Vector3();
    const seatQua = new Quaternion();
    seat.object3D.getWorldPosition(seatPos);
    seat.object3D.getWorldQuaternion(seatQua);

    const seatForward = new THREE.Vector3(0, 0, -1).applyQuaternion(seatQua);
    const right = new THREE.Vector3(0.5, 0, 0).applyQuaternion(seatQua);
    const left = right.clone().negate();

    const distanceInFront = -0.5; // Distance in front of the seat
    const offsetFromCenter = 0.5; // Horizontal offset from center

    // Calculate positions for Yes and No buttons
    const yesObjectPosition = seatPos
      .clone()
      .add(seatForward.clone().multiplyScalar(distanceInFront))
      .add(right.clone().multiplyScalar(offsetFromCenter));

    const noObjectPosition = seatPos
      .clone()
      .add(seatForward.clone().multiplyScalar(distanceInFront))
      .add(left.clone().multiplyScalar(offsetFromCenter));

    // Set positions of the buttons, adjusted for height
    this.yesButton.setPosition(yesObjectPosition.add(new Vector3(0, 1.2, 0)));
    this.noButton.setPosition(noObjectPosition.add(new Vector3(0, 1.2, 0)));
  }

  /**
   * Handle button clicks for Yes and No buttons
   * @param {string} buttonType - The type of button clicked ("yes" or "no")
   */
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
    // Store the answer locally
    this.answerByPID[APP.sfu._clientId] = this.isCurrentAnswerYes;

    this.currentActiveButton = buttonType;

    // Broadcast the answer to the admin
    this.sendAnswer(this.isCurrentAnswerYes);
  }
}
