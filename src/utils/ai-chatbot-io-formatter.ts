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
            localPosition: { x: 0, y: 0, z: 0 },
            localRotation: { x: 0, y: 0, z: 0 }
          },
          leftHand: {
            localPosition: { x: [number between -0.1 (right) and 0.1 (left)], y: [number between 0 (waist's height) and 0.2 (over head's height)], z: [number between 0 (relaxed, middle) and 0.1(front)] },
            localRotation: { x: 0, y: 0, z: 0},
          rightHand: {
            localPosition: { x: [number between -0.1 (right) and 0.1 (left)], y: [number between 0 (waist's height) and 0.2 (over head's height)], z: [number between 0 (relaxed, middle) and 0.1(front)] },
            localRotation: { x: 0, y: 0, z: 0},
          leftFoot: {
            localPosition: { x: [number between 0.1 (left) and 0], y: [number between 0 and 0.1 (up)], z: [number between 0 and 0.1(front)] },
            localRotation: { x: 0, y: 0, z: 0},
          rightFoot: {
            localPosition: { x: [number between -0.1 (right) and 0], y: [number between 0 and 0.1 (up)], z: [number between 0 and 0.1(front)] },
            localRotation: { x: 0, y: 0, z: 0},
        }
      }
    \`\`\`
  `;
}

// localRotation: { x: [angle in radian${
//   pose ? " (original: " + pose.leftHand.localRotation.x + ")" : ""
// }], y: [angle in radian${
// pose ? " (original: " + pose.leftHand.localRotation.y + ")" : ""
// }], z: [angle in radian${pose ? " (original: " + pose.leftHand.localRotation.z + ")" : ""}] }

export function parseAiOutput(aiOutput: string): Output {
  if (aiOutput.includes("```")) {
    return JSON.parse(aiOutput.replace(/```/, ""));
  }
  return JSON.parse(aiOutput);
}
