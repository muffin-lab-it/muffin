import { describe, expect, it } from "vitest";
import { returnedByScroll } from "./ReportEvidenceScope";

describe("스크롤로 읽던 곳에 돌아왔는지 (11/26 떠 있는 돌아가기 버튼)", () => {
  it("한 번 벗어났다가 다시 보이면 돌아온 것, 처음부터 계속 보이면 아님", () => {
    let state = returnedByScroll(false, true); // 누른 직후: 아직 보임
    expect(state).toEqual({ left: false, returned: false });
    state = returnedByScroll(state.left, false); // 근거로 내려가 화면 밖
    expect(state).toEqual({ left: true, returned: false });
    state = returnedByScroll(state.left, true); // 스크롤로 다시 올라옴
    expect(state.returned).toBe(true);
  });
});
