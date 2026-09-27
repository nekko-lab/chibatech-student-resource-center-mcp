/**
 * マクロが使う小さな口。実装はブラウザ（PortalService）と PDF（DocumentService）だが、
 * マクロの単体テストでは合成データの実装に差し替える。
 */
import type {
  Contact,
  DepartmentOption,
  DocumentCategory,
  DocumentKind,
  FaqItem,
  QuickLink,
  Section,
  StudentType,
} from "@chibatech-src/portal";
import type { DocPort } from "../docs.ts";
import type { StudentProfile } from "../types.ts";

export interface DeptPage {
  url: string;
  /** ページの見出し（h1） */
  heading: string;
  sections: Section[];
  lastModified: string | null;
}

export interface Listing<T> {
  url: string;
  /** ページの題名 */
  title: string;
  items: T;
  lastModified: string | null;
}

export interface PortalPort {
  /** 区分で選べる入学年度 */
  years(type: StudentType): Promise<number[]>;
  /** 区分・入学年度で選べる学科・専攻（年度が選べなければ PortalError VALIDATION、details.available に年度） */
  departments(type: StudentType, year: number): Promise<DepartmentOption[]>;
  /** 学科・研究科ページの節と項目 */
  departmentPage(type: StudentType, year: number, code: string): Promise<DeptPage>;
  /** ホームのクイックリンク */
  quickLinks(): Promise<Listing<QuickLink[]>>;
  documents(kind: DocumentKind): Promise<Listing<DocumentCategory[]>>;
  faq(): Promise<Listing<FaqItem[]>>;
  contacts(): Promise<Listing<Contact[]>>;
}

export interface MacroEnv {
  portal: PortalPort;
  docs: DocPort;
  now: () => Date;
  profile: StudentProfile;
}
