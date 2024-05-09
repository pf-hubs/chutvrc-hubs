import { addComponent } from "bitecs";
import { AiChatbot } from "../bit-components";
import { mapAvatarBone } from "../utils/map-avatar-bones";
import { BoneType } from "../constants";
import { getFormattedPrompt, parseAiOutput } from "../utils/ai-chatbot-io-formatter";
import { Vector3 } from "three";
import { createAvatarBoneEntities } from "../bit-systems/avatar-bones-system";
import { WhisperSTT } from "whisper-speech-to-text";
import { TranscriptCanvas } from "../utils/transcript-canvas";

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
    this.restorePoseTimer = 0;
    this.posesCounter = 0;
    this.originalPose = {
      head: { localPosition: {}, localRotation: {} },
      leftHand: { localPosition: {}, localRotation: {} },
      rightHand: { localPosition: {}, localRotation: {} }
    };
    this.originalWorldPosition = {
      head: new Vector3(),
      leftHand: new Vector3(),
      rightHand: new Vector3()
    };
    this.goalWorldPosition = {
      head: new Vector3(),
      leftHand: new Vector3(),
      rightHand: new Vector3()
    };
    this.speakingPose = null;
    this.initSpeechToText();
    this.transcriptCanvas = new TranscriptCanvas("私にマウスを押しながら話してみてください");
    this.camera = document.querySelector("#avatar-rig");
    this.initAnimationTargetHints();
  },

  tick: function (time, timeDelta) {
    if (!this.isBoneMapped && this.el.object3D) {
      const boneMap = mapAvatarBone(
        this.el.object3D.getObjectByName("AuxScene")?.getObjectByName("AvatarRoot")?.getObjectByName("AvatarRoot") ||
          this.el.object3D
      );
      if (boneMap.get(BoneType.Head) && boneMap.get(BoneType.LeftHand) && boneMap.get(BoneType.RightHand)) {
        this.head = boneMap.get(BoneType.Head);
        this.leftHand = boneMap.get(BoneType.LeftHand);
        this.rightHand = boneMap.get(BoneType.RightHand);
        this.root = boneMap.get(BoneType.Root);

        this.originalPose = {
          head: { localPosition: this.head.position.clone(), localRotation: this.head.rotation.clone() },
          leftHand: { localPosition: this.leftHand.position.clone(), localRotation: this.leftHand.rotation.clone() },
          rightHand: { localPosition: this.rightHand.position.clone(), localRotation: this.rightHand.rotation.clone() }
        };

        this.eid = createAvatarBoneEntities(
          this.el.object3D.getObjectByName("AuxScene")?.getObjectByName("AvatarRoot")?.getObjectByName("AvatarRoot") ||
            this.el.object3D
        );
        this.isBoneMapped = true;
      }
    }

    this.position = this.el.object3D.position;
    // this.el.object3D.lookAt(this.camera.object3D.position);
    // this.el.object3D.rotateX(-1);
    // this.el.object3D.rotation._onChangeCallback();
    this.transcriptCanvas.updateTransform(
      this.position.x,
      this.position.y + 0.3,
      this.position.z,
      this.camera.object3D.position
    );

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

    if (this.restorePoseTimer > 0) {
      this.restorePoseTimer += timeDelta * 0.001;
      this.restoreOriginalPose();
      if (this.restorePoseTimer > 3) {
        this.restorePoseTimer = 0;
      }
    }
  },

  startListening: function () {
    this.isListening = true;
    if (this.speechToText) this.speechToText.startRecording(); // Whisper speech to text
    if (this.recognition) this.recognition.start(); // Web Speech API SpeechRecognition
  },

  stopListening: function () {
    this.isListening = false;
    this.isThinking = true;

    if (this.speechToText) {
      // Whisper speech to text
      this.speechToText.stopRecording(text => {
        console.log("Whisper transcription:", text);
        this.requestChatAPI(text);
      });
    }
    if (this.recognition) this.recognition.stop(); // Web Speech API SpeechRecognition
  },

  stopThinking: function () {
    this.isThinking = false;
    this.thinkingAnimationTimer = 0;
  },

  startSpeaking: function (animation) {
    this.isAnswering = true;

    // TODO: calibration between scene's and bot's coordinates

    this.updateBoneWorldPositions(
      this.head,
      this.originalWorldPosition.head,
      this.goalWorldPosition.head,
      animation.head
    );
    this.updateBoneWorldPositions(
      this.leftHand,
      this.originalWorldPosition.leftHand,
      this.goalWorldPosition.leftHand,
      animation.leftHand
    );
    this.updateBoneWorldPositions(
      this.rightHand,
      this.originalWorldPosition.rightHand,
      this.goalWorldPosition.rightHand,
      animation.rightHand
    );

    const headPos = this.goalWorldPosition.head.clone();
    this.headHint.position.set(headPos.x, headPos.y, headPos.z);
    this.headHint.updateMatrix();

    const leftPos = this.goalWorldPosition.leftHand.clone();
    this.leftHint.position.set(leftPos.x, leftPos.y, leftPos.z);
    this.leftHint.updateMatrix();

    const rightPos = this.goalWorldPosition.rightHand.clone();
    this.rightHint.position.set(rightPos.x, rightPos.y, rightPos.z);
    this.rightHint.updateMatrix();

    // console.log(animation);
  },

  updateBoneWorldPositions: function (bone, originalWorldPos, goalWorldPos, anim) {
    // record original positions
    if (this.posesCounter === 0) bone.getWorldPosition(originalWorldPos);
    const posDiff = anim.localPosition;
    goalWorldPos.set(originalWorldPos.x + posDiff.x, originalWorldPos.y + posDiff.y, originalWorldPos.z + posDiff.z);

    // const localPos = bone.position.clone();

    // temporarily switch to animated pose
    // bone.position.set(localAnim.localPosition.x, localAnim.localPosition.y, localAnim.localPosition.z);
    // bone.updateMatrix();
    // bone.getWorldPosition(goalWorldPos);

    // // switch back to original positions
    // bone.position.copy(localPos);
    // bone.updateMatrix();
  },

  stopSpeaking: function () {
    this.isAnswering = false;
    this.speakingAnimationTimer = 0;
  },

  // ChatGPT APIリクエスト
  requestChatAPI: function (prompt = "") {
    if (!prompt) return;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.openai.com/v1/chat/completions");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Authorization", `Bearer ${this.apiKey}`);

    function onreadystatechange() {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        const response = JSON.parse(xhr.responseText);
        try {
          this.stopThinking();
          const { answers, animationExplanations, animations } = parseAiOutput(response.choices[0].message.content);
          console.log(answers);
          console.log(animationExplanations);
          console.log(animations);

          const uttrs = [];
          this.posesCounter = 0;

          for (let i = 0; i < answers.length; i++) {
            const uttr = new SpeechSynthesisUtterance();
            uttr.lang = "ja";
            uttr.onstart = () => {
              if (this.posesCounter < animations.length) this.speakingPose = animations[this.posesCounter];
              if (this.posesCounter < answers.length) this.transcriptCanvas.writeOnCanvas(answers[this.posesCounter]);
              this.startSpeaking(this.speakingPose);
            };
            uttr.onend = () => {
              if (this.posesCounter < answers.length - 1) {
                this.posesCounter++;
                uttrs[this.posesCounter].text = answers[this.posesCounter];
                window.speechSynthesis.speak(uttrs[this.posesCounter]);
              } else {
                this.stopSpeaking();
                this.restorePoseTimer = 0.001;
              }
            };
            uttrs.push(uttr);
          }

          uttrs[this.posesCounter].text = answers[this.posesCounter];
          window.speechSynthesis.speak(uttrs[this.posesCounter]);
        } catch (error) {
          console.error(error);
        }
      }
    }

    xhr.onreadystatechange = onreadystatechange.bind(this);

    xhr.send(
      JSON.stringify({
        model: "gpt-4-turbo", // gpt-3.5-turbo、gpt-4-turbo、text-davinci-003、...
        max_tokens: 2048,
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

    APP.world.eid2Ik.get(this.eid)?.updateAvatarBoneIk({
      rig: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      hmd: {
        pos: {
          x: this.goalWorldPosition.head.x,
          y: this.goalWorldPosition.head.y,
          z: this.goalWorldPosition.head.z
        },
        rot: {
          x: this.speakingPose.head.localRotation.x,
          y: this.speakingPose.head.localRotation.y,
          z: this.speakingPose.head.localRotation.z
        }
      },
      leftController: {
        pos: {
          x: this.goalWorldPosition.leftHand.x,
          y: this.goalWorldPosition.leftHand.y,
          z: this.goalWorldPosition.leftHand.z
        },
        rot: {
          x: this.speakingPose.leftHand.localRotation.x,
          y: this.speakingPose.leftHand.localRotation.y,
          z: this.speakingPose.leftHand.localRotation.z
        }
      },
      rightController: {
        pos: {
          x: this.goalWorldPosition.rightHand.x,
          y: this.goalWorldPosition.rightHand.y,
          z: this.goalWorldPosition.rightHand.z
        },
        rot: {
          x: this.speakingPose.rightHand.localRotation.x,
          y: this.speakingPose.rightHand.localRotation.y,
          z: this.speakingPose.rightHand.localRotation.z
        }
      }
    });

    this.el.object3D.updateMatrixWorld();
  },

  restoreOriginalPose: function () {
    APP.world.eid2Ik.get(this.eid)?.updateAvatarBoneIk({
      rig: { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } },
      hmd: {
        pos: {
          x: this.originalWorldPosition.head.x,
          y: this.originalWorldPosition.head.y,
          z: this.originalWorldPosition.head.z
        },
        rot: {
          x: this.originalPose.head.localRotation.x,
          y: this.originalPose.head.localRotation.y,
          z: this.originalPose.head.localRotation.z
        }
      },
      leftController: {
        pos: {
          x: this.originalWorldPosition.leftHand.x,
          y: this.originalWorldPosition.leftHand.y,
          z: this.originalWorldPosition.leftHand.z
        },
        rot: {
          x: this.originalPose.leftHand.localRotation.x,
          y: this.originalPose.leftHand.localRotation.y,
          z: this.originalPose.leftHand.localRotation.z
        }
      },
      rightController: {
        pos: {
          x: this.originalWorldPosition.rightHand.x,
          y: this.originalWorldPosition.rightHand.y,
          z: this.originalWorldPosition.rightHand.z
        },
        rot: {
          x: this.originalPose.rightHand.localRotation.x,
          y: this.originalPose.rightHand.localRotation.y,
          z: this.originalPose.rightHand.localRotation.z
        }
      }
    });
  },

  initSpeechToText: function (useWhisper = true) {
    if (useWhisper) {
      // Whisper speech to text
      this.speechToText = new WhisperSTT(this.apiKey);
    } else {
      // Web Speech API SpeechRecognition
      const SpeechRec = window.webkitSpeechRecognition || window.SpeechRecognition;
      this.recognition = new SpeechRec();
      this.recognition.lang = "ja";
      this.recognition.continuous = true;
      this.recognition.onresult = ({ results }) => {
        const userPrompt = results[0][0].transcript;
        console.log("SpeechRecognition:", userPrompt);
        this.transcriptCanvas.writeOnCanvas(userPrompt);
      };
    }
  },

  initAnimationTargetHints: function () {
    const sphere = new THREE.SphereGeometry(0.01);
    const object = new THREE.Mesh(sphere, new THREE.MeshBasicMaterial(0xff0000));
    const box = new THREE.BoxHelper(object, 0xffff00);
    this.headHint = box;
    APP.world.scene.add(this.headHint);
    this.leftHint = box.clone();
    APP.world.scene.add(this.leftHint);
    this.rightHint = box.clone();
    APP.world.scene.add(this.rightHint);
  }
});
