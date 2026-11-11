import { randomBytes } from 'node:crypto';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 8;
const PATTERN = /^[a-z0-9]{8}$/;
const UNBIASED_BYTE_LIMIT = 256 - (256 % ALPHABET.length);

export class FigureId {
  public static generate(): string {
    let id = '';
    while (id.length < LENGTH) {
      id += Array.from(randomBytes(LENGTH))
        .filter((byte) => byte < UNBIASED_BYTE_LIMIT)
        .map((byte) => ALPHABET[byte % ALPHABET.length])
        .join('');
    }
    return id.slice(0, LENGTH);
  }

  public static isValid(value: string): boolean {
    return PATTERN.test(value);
  }
}
