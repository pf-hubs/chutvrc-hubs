import { addComponent } from "bitecs";
import { AiChatbot } from "../bit-components";
import { mapAvatarBone } from "../utils/map-avatar-bones";
import { BoneType } from "../constants";

AFRAME.registerComponent("ai-chatbot", {
  schema: {
    displayText: { default: true }
  },

  init() {
    this.wasInteracting = false;
    addComponent(APP.world, AiChatbot, this.el.object3D.eid);

    this.isAnswering = false;
    this.isListening = false;
    this.apiKey = "your-openai-api-key";
    this.position = this.el.object3D.position;
    this.isBoneMapped = false;
    this.animationTimer = 0;
    this.responsesLog = [];

    // 音声認識
    const SpeechRec = window.webkitSpeechRecognition || window.SpeechRecognition;
    this.recognition = new SpeechRec();
    this.recognition.lang = "ja";
    this.recognition.continuous = true;
    this.recognition.onresult = ({ results }) => {
      const userPrompt = results[0][0].transcript;
      this.isAnswering = true;
      this.requestChatAPI(userPrompt, this.textCanvas, this.textCanvasMesh);
    };

    this.initTextCanvas();

    this.camera = document.querySelector("#avatar-rig");
  },

  tick: function (time, timeDelta) {
    if (!this.isBoneMapped && this.el.object3D) {
      const boneMap = mapAvatarBone(
        this.el.object3D
          .getObjectByName("AuxScene")
          ?.getObjectByName("AvatarRoot")
          ?.getObjectByName("AvatarRoot")
          ?.getObjectByName("AvatarRoot") || this.el.object3D
      );
      if (boneMap.get(BoneType.Head) && boneMap.get(BoneType.LeftHand) && boneMap.get(BoneType.RightHand)) {
        this.head = boneMap.get(BoneType.Head);
        this.leftHand = boneMap.get(BoneType.LeftHand);
        this.rightHand = boneMap.get(BoneType.RightHand);
        this.isBoneMapped = true;
      }
    }

    this.position = this.el.object3D.position;
    this.el.object3D.lookAt(this.camera.object3D.position);
    this.el.object3D.rotateX(-1);
    this.el.object3D.rotation._onChangeCallback();
    if (this.textCanvasMesh) {
      this.textCanvasMesh.position.set(this.position.x, this.position.y + 0.3, this.position.z);
      this.textCanvasMesh.lookAt(this.camera.object3D.position);
      this.textCanvasMesh.rotateX(-1);
      this.textCanvasMesh.rotation._onChangeCallback();
    }
    const interaction = AFRAME.scenes[0].systems.interaction;
    const isInteracting = interaction.isHeld(this.networkedEntity || this.el);

    if (isInteracting && !this.wasInteracting) {
      this.startListening();
    }

    if (this.wasInteracting && !isInteracting) {
      this.stopListening();
    }

    this.wasInteracting = isInteracting;

    if (this.isAnswering) {
      this.playSpeakingAnimation(timeDelta);
    } else {
      this.animationTimer = 0;
    }
  },

  startListening: function () {
    this.isListening = true;
    // voiceDiv.textContent = "";
    // aiDiv.textContent = "";
    this.recognition.start();
    console.log("Ask me something!");
  },

  stopListening: function () {
    this.recognition.stop();
    this.isListening = false;
    console.log("Thinking...");
    // TODO: thinking animation
  },

  // ChatGPT APIリクエスト
  requestChatAPI: function (prompt = "", textCanvas = null, textCanvasMesh = null) {
    if (!prompt) return;
    const responsesLog = this.responsesLog;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.openai.com/v1/chat/completions");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${this.apiKey}`);

    xhr.onreadystatechange = function () {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        const response = JSON.parse(xhr.responseText);
        const textResponse = response.choices[0].message.content.trim();

        // 音声読み上げ
        const uttr = new SpeechSynthesisUtterance();
        uttr.lang = "ja";
        uttr.onstart = () => {
          console.log("Start answering...");
          // TODO: talk animation
          if (textCanvas && textCanvasMesh) {
            const context = textCanvas.getContext("2d");
            const textWidth = context.measureText(textResponse).width;
            textCanvas.width = textWidth;
            textCanvas.height = 30;
            context.fillStyle = "rgba(255, 255, 255, 0.3)"; // Background color
            context.fillRect(0, 0, textWidth + 10, 30);

            // Draw text
            context.fillStyle = "white"; // Text color
            context.fillText(textResponse, 3, 20);
            const texture = new THREE.Texture(textCanvas);
            texture.needsUpdate = true;

            textCanvasMesh.material = new THREE.MeshBasicMaterial({
              map: texture,
              side: THREE.DoubleSide
            });
            textCanvasMesh.material.transparent = true;
            if (responsesLog.length > 0) {
              const lastTextWidth = context.measureText(responsesLog[responsesLog.length - 1]).width;
              textCanvasMesh.geometry.scale(30 / lastTextWidth, 1, 1);
            }
            textCanvasMesh.geometry.scale(textWidth / 30, 1, 1);
            textCanvasMesh.needsUpdate;
            responsesLog.push(textResponse);
          }
        };
        uttr.onend = () => {
          console.log("Stop answering!");
          // TODO: stop animation
        };
        uttr.text = textResponse;
        window.speechSynthesis.speak(uttr);
      }
    };

    xhr.send(
      JSON.stringify({
        model: "gpt-3.5-turbo", // gpt-3.5-turbo、text-davinci-003、その他
        max_tokens: 128,
        temperature: 1,
        top_p: 1,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    );
  },

  initTextCanvas: function () {
    this.textCanvas = document.createElement("canvas");
    const context = this.textCanvas.getContext("2d");
    context.font = "24px sans-serif";
    this.textCanvas.width = 0;
    this.textCanvas.height = 30;

    const defaultText = "私にマウスを押しながら話してみてください";
    const defaultTextWidth = context.measureText(defaultText).width;
    this.textCanvas.width = defaultTextWidth;
    this.textCanvas.height = 30;
    context.fillStyle = "rgba(255, 255, 255, 0.3)"; // Background color
    context.fillRect(0, 0, defaultTextWidth + 10, 30);

    // Draw text
    context.fillStyle = "white"; // Text color
    context.fillText(defaultText, 3, 20);
    const texture = new THREE.Texture(this.textCanvas);
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide
    });
    material.transparent = true;
    this.textCanvasMesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), material);
    this.textCanvasMesh.name = "Chatbot answer";
    APP.world.scene.add(this.textCanvasMesh);
    this.textCanvasMesh.scale.set(0.005, 0.005, 1);
    this.textCanvasMesh.material.transparent = true;

    this.textCanvasMesh.geometry.scale(defaultTextWidth / 30, 1, 1);
    this.textCanvasMesh.needsUpdate;
    this.responsesLog.push(defaultText);
  },

  playSpeakingAnimation: function (timeDelta) {
    this.animationTimer += timeDelta;
    if (this.head) {
      this.head.rotation.x = Math.sin(this.animationTimer * 0.005) / 4;
      this.head.rotation._onChangeCallback();
      this.head.updateMatrix();
    }
    if (this.animationTimer > 5000) {
      this.animationTimer = 0;
      this.isAnswering = false;
    }
  }
});
