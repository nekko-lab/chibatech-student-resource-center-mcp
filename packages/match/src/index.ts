// @chibatech-src/match の公開 API。すべて純関数で、実行環境（Node / Bun）に依らない。
export { normalizeJa } from "./normalize";
export { parseDeptOption, resolveDepartment } from "./department";
export { searchByKeyword } from "./keyword";
export { resolveYear } from "./year";
export { resolveStudentType } from "./studentType";
export type { Candidate, DeptOption, StudentType } from "./types";
export { DEPARTMENT_ALIASES } from "./data/departmentAliases";
export { SYNONYM_GROUPS, QUERY_SUFFIX_FILLERS } from "./data/synonyms";
