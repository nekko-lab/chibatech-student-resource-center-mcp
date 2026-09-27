import {
  GRADUATE_GRADE,
  GRADUATE_TERMS,
  PORTAL_VALUE_GRADUATE,
  PORTAL_VALUE_UNDERGRAD,
  UNDERGRAD_GRADE,
  UNDERGRAD_TERMS,
} from "./data/studentTypeTerms";
import { normalizeJa } from "./normalize";
import type { StudentType } from "./types";

const UNDERGRAD = UNDERGRAD_TERMS.map(normalizeJa);
const GRADUATE = GRADUATE_TERMS.map(normalizeJa);

export function resolveStudentType(input: string): StudentType | undefined {
  const n = normalizeJa(input);
  if (n === "") return undefined;
  if (n === PORTAL_VALUE_UNDERGRAD) return "undergrad";
  if (n === PORTAL_VALUE_GRADUATE) return "graduate";

  const isUndergrad = UNDERGRAD.some((t) => n.includes(t)) || UNDERGRAD_GRADE.test(n);
  // "undergraduate" が "graduate" に当たらないよう、学部側の英語表記を除いてから調べる
  const rest = n.replace(/undergrad(?:uate)?/g, "");
  const isGraduate = GRADUATE.some((t) => rest.includes(t)) || GRADUATE_GRADE.test(rest);

  if (isUndergrad === isGraduate) return undefined; // どちらでもない／両方ある
  return isUndergrad ? "undergrad" : "graduate";
}
