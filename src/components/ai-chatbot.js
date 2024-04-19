import { addComponent } from "bitecs";
import { AiChatbot } from "../bit-components";
import { mapAvatarBone } from "../utils/map-avatar-bones";
import { BoneType } from "../constants";
import { getFormattedPrompt, parseAiOutput } from "../utils/ai-chatbot-io-formatter";

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
    this.thinkingAnimationTimer = 0;
    this.speakingAnimationTimer = 0;
    this.responsesLog = [];
    this.originalPose = {
      head: {
        localPosition: {},
        localRotation: {}
      },
      leftHand: {
        localPosition: {},
        localRotation: {}
      },
      rightHand: {
        localPosition: {},
        localRotation: {}
      }
    };
    this.speakingPose = null;

    // 音声認識
    const SpeechRec = window.webkitSpeechRecognition || window.SpeechRecognition;
    this.recognition = new SpeechRec();
    this.recognition.lang = "ja";
    this.recognition.continuous = true;
    this.recognition.onresult = ({ results }) => {
      const userPrompt = results[0][0].transcript;
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
        this.originalPose = {
          head: { localPosition: this.head.position.clone(), localRotation: this.head.rotation.clone() },
          leftHand: { localPosition: this.leftHand.position.clone(), localRotation: this.leftHand.rotation.clone() },
          rightHand: { localPosition: this.rightHand.position.clone(), localRotation: this.rightHand.rotation.clone() }
        };
        // console.log(this.originalPose);
        // this.eid = createAvatarBoneEntities(
        //   this.el.object3D
        //     .getObjectByName("AuxScene")
        //     ?.getObjectByName("AvatarRoot")
        //     ?.getObjectByName("AvatarRoot")
        //     ?.getObjectByName("AvatarRoot") || this.el.object3D
        // );
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

    if (this.isThinking) {
      this.playThinkingAnimation(timeDelta);
    } else {
      this.thinkingAnimationTimer = 0;
    }

    if (this.isAnswering) {
      this.playSpeakingAnimation(timeDelta);
    } else {
      this.speakingAnimationTimer = 0;
    }
  },

  startListening: function () {
    this.isListening = true;
    this.recognition.start();
    console.log("Ask me something!");
  },

  stopListening: function () {
    this.recognition.stop();
    this.isListening = false;
    this.isThinking = true;
    console.log("Thinking...");
  },

  stopThinking: function (startSpeaking = true) {
    this.isThinking = false;
    this.thinkingAnimationTimer = 0;
    console.log("Stop thinking.");
    if (startSpeaking) {
      this.isAnswering = true;
      console.log("Start speaking...");
    }
  },

  stopSpeaking: function () {
    console.log("Speaking done! Anything else?");
    this.isAnswering = false;
    this.speakingAnimationTimer = 0;
  },

  // ChatGPT APIリクエスト
  requestChatAPI: function (prompt = "", textCanvas = null, textCanvasMesh = null) {
    if (!prompt) return;
    const responsesLog = this.responsesLog;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.openai.com/v1/chat/completions");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${this.apiKey}`);

    function onreadystatechange() {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        const response = JSON.parse(xhr.responseText);
        try {
          const { answer, animation } = parseAiOutput(response.choices[0].message.content);

          // console.log(animation);
          this.speakingPose = animation;
          this.stopThinking();

          // 音声読み上げ
          const uttr = new SpeechSynthesisUtterance();
          uttr.lang = "ja";
          uttr.onstart = () => {
            // TODO: talk animation
            if (textCanvas && textCanvasMesh) {
              const context = textCanvas.getContext("2d");
              const textWidth = context.measureText(answer).width;
              textCanvas.width = textWidth;
              textCanvas.height = 30;
              context.fillStyle = "rgba(255, 255, 255, 0.3)"; // Background color
              context.fillRect(0, 0, textWidth + 10, 30);

              // Draw text
              context.fillStyle = "white"; // Text color
              context.fillText(answer, 3, 20);
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
              responsesLog.push(answer);
            }
          };
          uttr.onend = () => {
            this.stopSpeaking();
            this.restoreOriginalPose();
          };
          uttr.text = answer;
          window.speechSynthesis.speak(uttr);
        } catch (error) {
          console.error(error);
        }
      }
    }

    xhr.onreadystatechange = onreadystatechange.bind(this);

    xhr.send(
      JSON.stringify({
        model: "gpt-3.5-turbo", // gpt-3.5-turbo、text-davinci-003、その他
        max_tokens: 512,
        temperature: 1,
        top_p: 1,
        messages: [
          {
            role: "user",
            content: getFormattedPrompt(prompt, this.originalPose)
          }
        ],
        response_format: { type: "json_object" }
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

  playThinkingAnimation: function (timeDelta) {
    this.thinkingAnimationTimer += timeDelta;
    if (this.head) {
      this.head.rotation.x = Math.sin(this.thinkingAnimationTimer * 0.005) / 4;
      this.head.rotation._onChangeCallback();
      this.head.updateMatrix();
    }
  },

  playSpeakingAnimation: function (timeDelta) {
    this.speakingAnimationTimer += timeDelta;
    this.applyPose(this.head, this.speakingPose.head);
    this.applyPose(this.leftHand, this.speakingPose.leftHand);
    this.applyPose(this.rightHand, this.speakingPose.rightHand);

    // APP.world.eid2Ik.get(this.eid)?.updateAvatarBoneIk({
    //   rig: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
    //   hmd: {
    //     pos: {
    //       x: this.speakingPose.head.localPosition.x,
    //       y: this.speakingPose.head.localPosition.y,
    //       z: this.speakingPose.head.localPosition.z
    //     },
    //     rot: {
    //       x: this.speakingPose.head.localRotation.x,
    //       y: this.speakingPose.head.localRotation.y,
    //       z: this.speakingPose.head.localRotation.z
    //     }
    //   },
    //   leftController: {
    //     pos: {
    //       x: this.speakingPose.leftHand.localPosition.x,
    //       y: this.speakingPose.leftHand.localPosition.y,
    //       z: this.speakingPose.leftHand.localPosition.z
    //     },
    //     rot: {
    //       x: this.speakingPose.leftHand.localRotation.x,
    //       y: this.speakingPose.leftHand.localRotation.y,
    //       z: this.speakingPose.leftHand.localRotation.z
    //     }
    //   },
    //   rightController: {
    //     pos: {
    //       x: this.speakingPose.rightHand.localPosition.x,
    //       y: this.speakingPose.rightHand.localPosition.y,
    //       z: this.speakingPose.rightHand.localPosition.z
    //     },
    //     rot: {
    //       x: this.speakingPose.rightHand.localRotation.x,
    //       y: this.speakingPose.rightHand.localRotation.y,
    //       z: this.speakingPose.rightHand.localRotation.z
    //     }
    //   }
    // });
  },

  applyPose: function (bone, pose) {
    if (!bone) return;
    bone.position.set(pose.localPosition.x, pose.localPosition.y, pose.localPosition.z);
    bone.rotation.set(pose.localRotation.x, pose.localRotation.y, pose.localRotation.z);
    bone.rotation._onChangeCallback();
    bone.updateMatrix();
  },

  restoreOriginalPose: function () {
    this.applyPose(this.head, this.originalPose.head);
    this.applyPose(this.leftHand, this.originalPose.leftHand);
    this.applyPose(this.rightHand, this.originalPose.rightHand);
  }
});
