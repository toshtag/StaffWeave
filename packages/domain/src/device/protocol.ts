/**
 * 打刻端末と サーバーの間の取り決め。
 *
 * 署名の対象文字列、連番の扱い、端末時計のずれの測り方をここに置く。
 * Agent 側と サーバー側が同じ規則を参照できるよう、実装を持たない純粋な関数だけにする。
 */
import type { AttendanceEventType } from '../attendance/events.js';

export interface SignedEventPayload {
  deviceId: string;
  /** 端末ごとに 1 から始まる単調増加の番号。欠落の検出に使う。 */
  sequence: number;
  /** 二重送信を防ぐ冪等キー。 */
  requestId: string;
  employeeNumber: string;
  eventType: AttendanceEventType;
  /** 打刻が起きた時刻（端末の時計）。 */
  occurredAt: string;
  /** 送信時点の端末の時計。サーバー時刻との差を測るために使う。 */
  deviceTime: string;
}

/**
 * 署名の対象となる文字列。
 *
 * JSON の表記ゆれで署名が壊れないよう、項目を決まった順に改行で並べる。
 * 項目を増やすときは末尾へ追加し、既存の並びを変えないこと。
 */
export function canonicalPayload(payload: SignedEventPayload): string {
  return [
    'staffweave-device-event/1',
    payload.deviceId,
    String(payload.sequence),
    payload.requestId,
    payload.employeeNumber,
    payload.eventType,
    payload.occurredAt,
    payload.deviceTime,
  ].join('\n');
}

export type SequenceVerdict = 'expected' | 'gap' | 'replay';

/**
 * 連番の評価。
 *
 * `expected` 想定どおりの次の番号
 * `gap`      間が飛んでいる。受け取ったうえで欠落として記録する
 * `replay`   すでに受け取った番号。冪等キーが一致すれば同じ結果を返す
 */
export function evaluateSequence(lastSequence: number, incoming: number): SequenceVerdict {
  if (incoming <= lastSequence) return 'replay';
  if (incoming === lastSequence + 1) return 'expected';
  return 'gap';
}

/** 端末時計とサーバー時刻の差（秒）。端末が進んでいれば正の値。 */
export function clockSkewSeconds(deviceTime: Date, serverTime: Date): number {
  return Math.round((deviceTime.getTime() - serverTime.getTime()) / 1000);
}

/** この秒数を超える時計のずれは、記録として残し後から確認できるようにする。 */
export const NOTABLE_CLOCK_SKEW_SECONDS = 120;

export function isNotableClockSkew(skewSeconds: number): boolean {
  return Math.abs(skewSeconds) > NOTABLE_CLOCK_SKEW_SECONDS;
}

export interface CardRegistrationPayload {
  deviceId: string;
  registrationToken: string;
  cardFingerprint: string;
}

/** カード登録の署名対象。 */
export function canonicalCardRegistration(payload: CardRegistrationPayload): string {
  return [
    'staffweave-card-registration/1',
    payload.deviceId,
    payload.registrationToken,
    payload.cardFingerprint,
  ].join('\n');
}

export interface CardEventPayload {
  deviceId: string;
  sequence: number;
  requestId: string;
  cardFingerprint: string;
  /** 種別を端末が決めない場合は空文字。 */
  eventType: AttendanceEventType | '';
  occurredAt: string;
  deviceTime: string;
}

/** カード読み取りから作る打刻イベントの署名対象。 */
export function canonicalCardEvent(payload: CardEventPayload): string {
  return [
    'staffweave-card-event/1',
    payload.deviceId,
    String(payload.sequence),
    payload.requestId,
    payload.cardFingerprint,
    payload.eventType,
    payload.occurredAt,
    payload.deviceTime,
  ].join('\n');
}

export interface SessionObservationLine {
  employeeNumber: string;
  observationType: string;
  occurredAt: string;
}

export interface SessionObservationBatchPayload {
  deviceId: string;
  sequence: number;
  requestId: string;
  workstationName: string;
  observations: readonly SessionObservationLine[];
}

/**
 * PC セッション観測のまとめ送りに対する署名対象。
 * 観測は送った順にそのまま並べ、1 件でも欠けたり入れ替わったりすれば署名が合わなくなる。
 */
export function canonicalSessionObservations(payload: SessionObservationBatchPayload): string {
  return [
    'staffweave-session-observations/1',
    payload.deviceId,
    String(payload.sequence),
    payload.requestId,
    payload.workstationName,
    String(payload.observations.length),
    ...payload.observations.map((line) =>
      [line.employeeNumber, line.observationType, line.occurredAt].join('|'),
    ),
  ].join('\n');
}
