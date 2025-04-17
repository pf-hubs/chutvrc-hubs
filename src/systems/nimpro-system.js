import { Vector3, Quaternion } from "three";
import { Text } from "troika-three-text";
import { Clickable3DButton } from "../utils/clickable-3d-button";
import { WaypointSystem } from "./waypoint-system";

const seats = ["01", "02", "03", "04", "05"];

const sendNimproMessage = ({ messageType, pID = APP.sfu._clientId, value }) => {
  APP.sfu.broadcast("#nimpro", [messageType, pID, value].join("|"));
};

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

  // Hint objects for displaying answers and points
  static ansHintBySeat = {};
  static thisRoundPointObjectBySeatNum = {};
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

      if (isAdmin) {
        sendNimproMessage({ messageType: "stat", value: "1" });
      } else {
        // For participants, assign seat number and initialize answer buttons
        this.seatNum = pNum;
        // sendNimproMessage({ messageType: "seat", value: pNum });
        this.initAnswerButtons(pNum);

        APP.sfu._avatarSyncHelper?.switchSelfAnimState(2); // avatar anim state TODO: change number to type AvatarAnimState
      }

      console.log("Nimpro initialized as " + (isAdmin ? "admin" : "player"));
    }

    // Initialize Text objects for all seats (from "01" to "05")
    seats.forEach(seatNum => this.initTextsAndObjectsForSeat(seatNum));

    this.pointObjectLow = document.querySelector("#environment-root .N-impro .point-object-low")?.object3D;
    this.pointObjectHigh = document.querySelector("#environment-root .N-impro .point-object-high")?.object3D;
  }

  /**
   * Event handler for data channel messages
   * @param {Object} param0 - Contains the label and message from the data channel
   */
  static handleDataChannelMessageReceived({ message }) {
    if (!this.isInitialized) return;
    const [messageType, pID, value] = message.split("|");

    switch (messageType) {
      case "stat": // value: "0" | "1"
        if (value === "1") {
          sendNimproMessage({ messageType: "seat", value: this.seatNum });
        } else {
          this.setAnswerButtonsVisibility(false);
          // Unoccupy waypoints for seats
          const waypointSystem = APP.scene.systems["hubs-systems"].waypointSystem;
          WaypointSystem.unoccupyWaypoints(waypointSystem.ready.filter(wp => wp.el.className.includes("N-impro-seat")));
        }
        break;
      case "seat": // value: "01" | "02" | "03" | "04" | "05"
        // When a participant joins and broadcasts their seat number
        this.seatByPID[pID] = value;
        break;
      case "ans": // value: "0" | "1"
        // When a participant submits their answer
        console.log(`${value} from seat ${pID}`);
        this.answerByPID[pID] = value === "1";
        if (this.isAdmin) {
          this.ansHintBySeat[this.seatByPID[pID]].material.color.set(value === "1" ? 0x0000ff : 0xff0000);
          // TODO: display Y or N // value === "1" ? "Y" : "N";
        }
        // Do not reveal the answer yet
        break;
      case "point": // value: "0" | "1" | "3"
        // When points are sent from the admin
        this.receivePoint(pID, value);
        break;
      case "buttonVis": // value: "0" | "1"
        // Control visibility of answer buttons
        this.setAnswerButtonsVisibility(value === "1");
        if (!this.isAdmin && value === "1") {
          for (const seatNum in this.thisRoundPointObjectBySeatNum) {
            this.saveThisRoundPointObject(seatNum);
          }
          seats.forEach(seatNum => this.ansHintBySeat[seatNum].material.color.set(0xffffff));
        }
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
    // Get the seat element
    const seat = document.querySelector("#environment-root .N-impro .N-impro-seat-" + seatNum);
    if (!seat) return;

    const geometry = new THREE.RingGeometry(0.3, 0.6, 32);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(geometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    seat.object3D.add(ring);
    this.ansHintBySeat[seatNum] = ring;

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
    answerAndCurrentPointText.position.set(seatPos.x, seatPos.y + 2, seatPos.z); // Position above the seat
    answerAndCurrentPointText.color = 0xffffff;
    answerAndCurrentPointText.visible = false; // Hide initially
    answerAndCurrentPointText.sync();
    APP.world.scene.add(answerAndCurrentPointText);

    // Determine the eye position of the participant
    const selfEyePos = selfSeatPos.clone().add(new Vector3(0, 1.5, 0)); // Eye position at 1.5 units height

    // Make texts face the camera or participant
    answerAndCurrentPointText.lookAt(this.isAdmin ? cameraPos : selfEyePos);

    if (seatNum === this.seatNum && selfSeat) {
      // For participant's own seat, locate text in front of the participant locally
      const offset = new Vector3(0, 0, 1).applyQuaternion(selfSeatQua); // Offset 1 unit in front of the seat
      answerAndCurrentPointText.position.add(new Vector3(offset.x, -0.5, offset.z)); // Adjust position
      answerAndCurrentPointText.lookAt(selfEyePos); // Make text face participant

      // Optionally, rotate question slide to the participant locally (commented out)
      // const mediaPdfElement = document.querySelector("a-entity[media-pdf]");
      // mediaPdfElement.components["media-pager"].setPage(mediaPdfElement.getAttribute("media-pager", "index").index);
    }

    // Store the text objects
    this.thisRoundPointObjectBySeatNum[seatNum] = null;
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
      sendNimproMessage({ messageType: "stat", value: "0" });
      this.sendAnswerButtonsVisibility(false);

      seats.forEach(seatNum => {
        APP.world.scene.remove(this.ansHintBySeat[seatNum]);
        this.ansHintBySeat[seatNum].geometry.dispose();
        this.ansHintBySeat[seatNum].material.dispose();
        this.ansHintBySeat[seatNum] = null;
      });
      this.ansHintBySeat = {};

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
    for (const seatNum in this.totalPointObjectsBySeatNum) {
      for (const pointObject of this.totalPointObjectsBySeatNum[seatNum]) {
        if (pointObject) {
          APP.world.scene.remove(pointObject);
          pointObject.dispose();
        }
      }
    }
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
        }

        // this.thisRoundPointByPID[pID] = this.answerByPID[pID] ? 3 : 1; // for test

        // Update total points on admin's client
        if (this.pointsByPID[pID] !== undefined) {
          this.pointsByPID[pID] += this.thisRoundPointByPID[pID];
        } else {
          this.pointsByPID[pID] = this.thisRoundPointByPID[pID];
        }

        // Update the Text objects on admin's client
        const seatNum = this.seatByPID[pID];
        this.showThisRoundResult(seatNum, this.answerByPID[pID], this.thisRoundPointByPID[pID]);
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
        sendNimproMessage({ messageType: "point", pID, value: this.thisRoundPointByPID[pID] });
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
    sendNimproMessage({ messageType: "buttonVis", value: isVisible ? "1" : "0" });
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
    for (const seatNum in this.thisRoundPointObjectBySeatNum) {
      this.saveThisRoundPointObject(seatNum);
    }
    seats.forEach(seatNum => this.ansHintBySeat[seatNum].material.color.set(0xffffff));
    // Do not hide totalPointsText
    // Show answer buttons
    this.sendAnswerButtonsVisibility(true);
    // Broadcast seat assignments to all participants
    for (const pID in this.seatByPID) {
      sendNimproMessage({ messageType: "seat", pID, value: this.seatByPID[pID] });
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
    sendNimproMessage({ messageType: "ans", value: isYes ? "1" : "0" });
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
    this.showThisRoundResult(seatNum, this.answerByPID[pID], parsedPoint);

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
      0x6666ff, // Default blue color
      0x0000ff, // Active bright blue color
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

  static saveThisRoundPointObject(seatNum) {
    if (!this.thisRoundPointObjectBySeatNum[seatNum]) return;

    // Clone this round's point object, add to total point objects and them re-align them.
    const pointObject = this.thisRoundPointObjectBySeatNum[seatNum].clone();
    APP.world.scene.add(pointObject);
    this.totalPointObjectsBySeatNum[seatNum].push(pointObject);
    this.alignPointObjectsToCenter(seatNum);

    // Clear this round's point object
    APP.world.scene.remove(this.thisRoundPointObjectBySeatNum[seatNum]);
    this.thisRoundPointObjectBySeatNum[seatNum].clear();
    this.thisRoundPointObjectBySeatNum[seatNum] = null;
  }

  static showThisRoundResult(seatNum, answerIsYes, point) {
    this.ansHintBySeat[seatNum].material.color.set(answerIsYes ? 0x0000ff : 0xff0000);

    // TODO: place objects of a user oneself lower and in front of oneself
    if (!seatNum || point === 0 || !this.pointObjectHigh || !this.pointObjectLow) return;
    const pointObject = point > 1 ? this.pointObjectHigh.clone() : this.pointObjectLow.clone();
    pointObject.scale.set(pointObject.scale.x * 2, pointObject.scale.y * 2, pointObject.scale.z * 2);

    const seat = document.querySelector("#environment-root .N-impro .N-impro-seat-" + seatNum);
    pointObject.position.copy(seat.object3D.position.clone().add(new Vector3(0, 2, 0)));

    const selfSeatPos = new Vector3();
    const selfSeatQua = new Quaternion();
    seat.object3D.getWorldPosition(selfSeatPos);
    seat.object3D.getWorldQuaternion(selfSeatQua);

    let offset = new Vector3(0, 0, 0.5).applyQuaternion(selfSeatQua);

    if (seatNum === this.seatNum && seat) {
      const selfEyePos = selfSeatPos.clone().add(new Vector3(0, 1.5, 0)); // Eye position at 1.5 units height
      offset = new Vector3(0, 0, 0.35).applyQuaternion(selfSeatQua); // Offset 1 unit in front of the seat
      pointObject.position.add(new Vector3(offset.x, -0.6, offset.z)); // Adjust position
      pointObject.lookAt(selfEyePos); // Make text face participant
      // pointObject.scale.set(0.5, 0.5, 0.5);
    }
    pointObject.visible = true;
    APP.world.scene.add(pointObject); // Add the new point object to the scene
    this.thisRoundPointObjectBySeatNum[seatNum] = pointObject;
  }

  static alignPointObjectsToCenter(seatNum) {
    // TODO: place objects of a user oneself lower and in front of oneself
    // Adjust positions of all objects to ensure proper centering
    const objects = this.totalPointObjectsBySeatNum[seatNum];
    const seat = document.querySelector("#environment-root .N-impro .N-impro-seat-" + seatNum);
    const basePosition = seat.object3D.position.clone().add(new Vector3(0, 2.5, 0)); // Base position above the seat
    const rowSize = 5; // Maximum number of objects per row
    const xSpacing = seatNum === this.seatNum ? 0.05 : 0.2; // Spacing between objects
    const ySpacing = seatNum === this.seatNum ? -0.1 : 0.2; // Spacing between objects

    objects.forEach((obj, index) => {
      const row = Math.floor(index / rowSize); // Determine the row
      const itemsInRow = Math.min(rowSize, objects.length - row * rowSize); // Number of items in this row

      // Calculate the center offset for this row
      const totalWidth = (itemsInRow - 1) * xSpacing; // Total width of the row
      const startX = -totalWidth / 2; // Starting X position for centering the row

      const column = index % rowSize; // Column within the row
      const offsetX = startX + column * xSpacing; // X position relative to the center of the row
      const offsetY = row * ySpacing; // Y position for stacking rows

      obj.position.copy(basePosition.clone().add(new Vector3(offsetX, offsetY, 0)));
      if (seatNum === this.seatNum && seat) {
        const selfSeatPos = new Vector3();
        const selfSeatQua = new Quaternion();
        seat.object3D.getWorldPosition(selfSeatPos);
        seat.object3D.getWorldQuaternion(selfSeatQua);
        const selfEyePos = selfSeatPos.clone().add(new Vector3(0, 1.5, 0)); // Eye position at 1.5 units height
        const offset = new Vector3(0, 0, 0.35).applyQuaternion(selfSeatQua); // Offset 1 unit in front of the seat
        obj.position.add(new Vector3(offset.x, -1.2, offset.z)); // Adjust position
        obj.lookAt(selfEyePos); // Make text face participant
        obj.scale.set(0.3, 0.3, 0.3);
      }
      obj.visible = true; // Ensure all objects are visible
      obj.updateMatrix();
    });
  }
}
