/**
 * 段階承認の進み方。
 *
 * 申請種別は組織が定義し、承認は 1〜4 段まで置ける。
 *
 * 承認の段数は、申請を出した時点の定義を写して申請へ持たせる。
 * 定義を都度参照すると、承認の途中で段数を変えられたときに、
 * すでに承認した段が消えたり、承認していない段が現れたりする。
 * 「その申請がいつ出されたか」で経路が決まる、という約束にする。
 *
 * 承認の要求には、何段目・何回目の提出に対するものかを必ず添えさせる。
 * 古い画面から同じ承認を送り直しても、次の段へ勝手に進めないようにするため。
 */

export const STAGED_REQUEST_STATES = ['submitted', 'approved', 'returned', 'cancelled'] as const;

export type StagedRequestState = (typeof STAGED_REQUEST_STATES)[number];

export function isStagedRequestState(value: string): value is StagedRequestState {
  return (STAGED_REQUEST_STATES as readonly string[]).includes(value);
}

export interface StagedRequest {
  state: StagedRequestState;
  /** 提出時に写した段数。定義を変えても、この申請では動かない。 */
  totalSteps: number;
  /** いま決裁を待っている段。 */
  currentStep: number;
  /** 何回目の提出か。差し戻しから出し直すたびに増える。 */
  submissions: number;
}

export type StagedRequestEvent =
  | { type: 'APPROVE'; step: number; submission: number }
  | { type: 'RETURN'; step: number; submission: number }
  | { type: 'RESUBMIT' }
  | { type: 'CANCEL' };

export type StagedRequestProblem =
  | 'not_pending'
  | 'step_mismatch'
  | 'submission_mismatch'
  | 'not_returned'
  | 'already_decided';

export type StagedRequestTransition =
  | { ok: true; request: StagedRequest }
  | { ok: false; problem: StagedRequestProblem };

/** 決裁を受け付けてよい状態か。 */
function pending(request: StagedRequest): boolean {
  return request.state === 'submitted';
}

/**
 * 申請を進める。受け付けられないときは理由を返す。
 *
 * 理由を返すのは、呼び出し側が「今できない」と「もう終わっている」を
 * 別の応答へ振り分けられるようにするため。どちらも拒否では、
 * 二重送信なのか権限外なのかが利用者に伝わらない。
 */
export function applyStagedRequestEvent(
  request: StagedRequest,
  event: StagedRequestEvent,
): StagedRequestTransition {
  switch (event.type) {
    case 'APPROVE':
    case 'RETURN': {
      if (request.state === 'approved' || request.state === 'cancelled') {
        return { ok: false, problem: 'already_decided' };
      }
      if (!pending(request)) return { ok: false, problem: 'not_pending' };
      // 段と提出回数が食い違う要求は受け付けない。
      // 古い画面が持っている段は、すでに誰かが決裁したあとかもしれない。
      if (event.step !== request.currentStep) return { ok: false, problem: 'step_mismatch' };
      if (event.submission !== request.submissions) {
        return { ok: false, problem: 'submission_mismatch' };
      }

      if (event.type === 'RETURN') {
        return { ok: true, request: { ...request, state: 'returned' } };
      }

      const nextStep = request.currentStep + 1;
      return nextStep > request.totalSteps
        ? { ok: true, request: { ...request, state: 'approved' } }
        : { ok: true, request: { ...request, currentStep: nextStep } };
    }

    case 'RESUBMIT': {
      if (request.state !== 'returned') return { ok: false, problem: 'not_returned' };
      // 出し直しは 1 段目から。前の提出の決裁は台帳に残るが、経路は最初へ戻る。
      return {
        ok: true,
        request: {
          ...request,
          state: 'submitted',
          currentStep: 1,
          submissions: request.submissions + 1,
        },
      };
    }

    case 'CANCEL': {
      if (request.state === 'approved') return { ok: false, problem: 'already_decided' };
      if (request.state === 'cancelled') return { ok: false, problem: 'already_decided' };
      return { ok: true, request: { ...request, state: 'cancelled' } };
    }
  }
}

/** 提出したての申請。段数は、そのときの定義から写す。 */
export function submitStagedRequest(totalSteps: number): StagedRequest {
  return { state: 'submitted', totalSteps, currentStep: 1, submissions: 1 };
}

/** その状態のとき、申請の内容を書き換えてよいか。 */
export function allowsRequestEditing(state: StagedRequestState): boolean {
  return state === 'returned';
}

/** 台帳や勤怠へ反映してよい状態か。 */
export function isRequestEffective(state: StagedRequestState): boolean {
  return state === 'approved';
}
