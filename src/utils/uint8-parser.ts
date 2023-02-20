export const floatToUInt8 = (float: number) => [Math.trunc(float + 128), Math.trunc((float + 128) % 1 * 100)];
export const uInt8ToFloat = (int: number, dec: number) => int + dec / 100 - 128;
export const radToUInt8 = (float: number) => (float + Math.PI) / Math.PI * 127.5;
export const uInt8ToRad = (int: number) => int / 127.5 * Math.PI - Math.PI;
