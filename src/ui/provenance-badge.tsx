import type { Provenance } from "../types/events";

const LABEL: Record<Provenance, string> = { measured: "実測", reconstructed: "再構成" };

export function ProvenanceBadge({ value }: { value: Provenance }) {
  return (
    <span className={`badge badge-${value}`} title={value === "reconstructed" ? "記録が無いため組み立てた出来事" : "記録から抽出した出来事"}>
      {LABEL[value]}
    </span>
  );
}
