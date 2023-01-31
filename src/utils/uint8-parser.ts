export const floatToUInt8 = (float: number) => [Math.trunc(float + 128), Math.trunc((float + 128) % 1 * 100)];
export const uInt8ToFloat = (int: number, dec: number) => int + dec / 100 - 128;
export const degreeToUInt8 = (float: number) => {
  const positiveFloat = (float + 180) * 255 / 360;
  return [Math.trunc(positiveFloat), Math.trunc(positiveFloat % 1 * 100)];
}
export const uInt8ToDegree = (int: number, dec: number) => (int + dec / 100) * 360 / 255 - 180;
