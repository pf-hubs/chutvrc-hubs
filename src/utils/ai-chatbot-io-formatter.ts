type Vector3Type = { x: number; y: number; z: number };
type BoneTransform = {
  localPosition: Vector3Type;
  localRotation: Vector3Type;
};
type AvatarPose = {
  head: BoneTransform;
  leftHand: BoneTransform;
  rightHand: BoneTransform;
  leftFoot?: BoneTransform;
  rightFoot?: BoneTransform;
};
type Output = {
  answer: string;
  animationExplanation: string;
  animation: AvatarPose;
};

export function getFormattedPrompt(prompt: string, pose?: AvatarPose): string {
  return `
  Request: "${prompt}"

  According to this request, generate outputs for each of the following instructions, and print the output only in the format at the bottom.
  
  1. Answer this request in Japanese
  2. Suppose you have a humanoid body, tell me what specific poses or gestures (by head, arms, and legs) you will use when answering the request. Print only the specific descriptions about the poses or gestures.
  3. According to the output of the poses or gestures, generate animations in JSON for a humanoid avatar. The height of the avatar equals to 1.7.
  
  Only output in this format:
    \`\`\`
      {
        answer: [string],
        animationExplanation: [string],
        animation: {
          head: {
            localPosition: { x: 0, y: ${pose?.head?.localPosition?.y || 0}, z: 0 },
            localRotation: { x: [${pose ? pose.head.localRotation.x + " + " : ""} angle in radian], y: [${
    pose ? pose.head.localRotation.y + " + " : ""
  } angle in radian], z: [${pose ? pose.head.localRotation.z + " + " : ""} angle in radian] }
          },
          leftHand: {
            localPosition: { x: [number between ${pose ? pose.leftHand.localPosition.x - 0.2 : 0.1} and ${
    pose ? pose.leftHand.localPosition.x + 0.2 : 0.5
  }], y: [number between -0.3 and 0.3], z: [number between 0 and 0.3] },
            localRotation: { x: [angle in radian${
              pose ? " (original: " + pose.leftHand.localRotation.x + ")" : ""
            }], y: [angle in radian${
    pose ? " (original: " + pose.leftHand.localRotation.y + ")" : ""
  }], z: [angle in radian${pose ? " (original: " + pose.leftHand.localRotation.z + ")" : ""}] }
          },
          rightHand: {
            localPosition: { x: [number between ${pose ? pose.rightHand.localPosition.x - 0.2 : -0.5} and ${
    pose ? pose.rightHand.localPosition.x + 0.2 : -0.1
  }], y: [number between -0.3 and 0.3], z: [number between 0 and 0.3] },
            localRotation: { x: [angle in radian${
              pose ? " (original: " + pose.rightHand.localRotation.x + ")" : ""
            }], y: [angle in radian${
    pose ? " (original: " + pose.rightHand.localRotation.y + ")" : ""
  }], z: [angle in radian${pose ? " (original: " + pose.rightHand.localRotation.z + ")" : ""}] }
          },
          leftFoot: {
            localPosition: { x: [number between 0 and 0.2], y: 0, z: [number between -0.1 and 0.1] },
            localRotation: { x: [angle in radian${
              pose?.leftFoot ? " (original: " + pose.leftFoot.localRotation.x + ")" : ""
            }], y: [angle in radian${
    pose?.leftFoot ? " (original: " + pose.leftFoot.localRotation.y + ")" : ""
  }], z: [angle in radian${pose?.leftFoot ? " (original: " + pose.leftFoot.localRotation.z + ")" : ""}] }
          },
          rightFoot: {
            localPosition: { x: [number between -0.2 and 0], y: 0, z: [number between -0.1 and 0.1] },
            localRotation: { x: [angle in radian${
              pose?.rightFoot ? " (original: " + pose.rightFoot.localRotation.x + ")" : ""
            }], y: [angle in radian${
    pose?.rightFoot ? " (original: " + pose.rightFoot.localRotation.y + ")" : ""
  }], z: [angle in radian${pose?.rightFoot ? " (original: " + pose.rightFoot.localRotation.z + ")" : ""}] }
          },
        }
      }
    \`\`\`
  `;
}

export function parseAiOutput(aiOutput: string): Output {
  if (aiOutput.includes("```")) {
    return JSON.parse(aiOutput.replace(/```/, ""));
  }
  return JSON.parse(aiOutput);
}
