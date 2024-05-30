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
  
  1. Answer this request in Japanese, and split the answer into array of strings (at most 5 strings), just as human needs to rest while speaking.
  2. Suppose you have a humanoid body, describe the specific poses or gestures (by head, arms, and legs) you will use in an array of strings (same length as the answers), each of them corresponding to each short string from the answer. Print only the specific descriptions about the poses or gestures.
  3. According to each output of the described poses or gestures, generate animations for a humanoid avatar in an array of number arrays (same length as the answers).
  
  Only output in this JSON format:
    \`\`\`
      {
        ans: [(Response to instruction 1) answer to the request in the format of an array of string],
        ani: [(Response to instruction 3) array of ANIMATIONS]
      }
    \`\`\`
  while the type ANIMATIONS is formatted as follows:
    \`\`\`
    [(head local position x), (head local position y), (head local position z), (head local rotation x), (head local rotation y), (head local rotation z), (left hand local position x as a number between -0.1 (right) and 0.1 (left)), (left hand local position y as a number between 0 (waist's height) and 0.2 (over head's height)), (left hand local position z as a number between 0 (relaxed, middle) and 0.1(front)), (left hand local rotation x), (left hand local rotation y), (left hand local rotation z), (right hand local position x as a number between -0.1 (right) and 0.1 (left)), (right hand local position y as a number between 0 (waist's height) and 0.2 (over head's height)), (right hand local position z as a number between 0 (relaxed, middle) and 0.1(front)), (right hand local rotation x), (right hand local rotation y), (right hand local rotation z)]
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
