import { describe, expect, it } from "vitest";
import { resolveStudentType } from "../src/index";

describe("resolveStudentType", () => {
  it.each(["学部", "学部生", "学士", "B2", "b4", "Ｂ１", "学部3年", "undergrad", "Undergraduate", "1"])(
    "%s → undergrad",
    (input) => {
      expect(resolveStudentType(input)).toBe("undergrad");
    },
  );

  it.each([
    "大学院",
    "院",
    "院生",
    "大学院生",
    "修士",
    "博士",
    "博士後期課程",
    "M1",
    "ｍ２",
    "D1",
    "マスター",
    "ドクター",
    "graduate",
    "2",
  ])("%s → graduate", (input) => {
    expect(resolveStudentType(input)).toBe("graduate");
  });

  it.each(["", "情工", "学部と大学院", "B2 と M1", "3"])("判定できない %s は undefined", (input) => {
    expect(resolveStudentType(input)).toBeUndefined();
  });
});
