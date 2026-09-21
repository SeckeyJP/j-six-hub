import type { Provenance } from "../types/events";

const LABEL: Record<Provenance, string> = { measured: "実測", reconstructed: "再構成" };
const TITLE: Record<Provenance, string> = {
  measured: "記録（Git・セッション記録・証跡）から抽出した出来事",
  reconstructed: "記録が無いため組み立てた出来事。根拠を確認できる",
};

export function ProvenanceBadge({ value }: { value: Provenance }) {
  return (
    <span className={`badge badge-${value}`} title={TITLE[value]}>
      {LABEL[value]}
    </span>
  );
}

export function FictionalBadge() {
  return (
    <span className="badge badge-fictional" title="説明のための架空のシナリオ">
      架空
    </span>
  );
}
