export type { CardReader } from './card/reader.js';
export { cardFingerprint, createScriptedCardReader, isSameCard } from './card/reader.js';
export {
  AgentRequestError,
  enroll,
  registerCard,
  sendCardEvent,
  sendEvent,
} from './client.js';
export type { DeviceCredentials, KeyPair } from './credentials.js';
export {
  generateKeyPair,
  loadCredentials,
  saveCredentials,
  signMessage,
  signPayload,
} from './credentials.js';
