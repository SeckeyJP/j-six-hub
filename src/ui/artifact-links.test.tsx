import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { program, processDef } from "../data";
import { Timeline } from "./timeline";
import { ArtifactLinks } from "./artifact-links";

const project = program.projects[0]!;
const event = project.events.find((e) => e.type === "commit.created" && e.phase === "P6")!;

describe("公開済みの実物へのリンク", () => {
  it("履歴を展開したときだけ表示し、行ボタンにはリンクを入れない", async () => {
    render(<Timeline data={program} process={processDef} n={program.timeline.length} controlPoints={new Map()} projectId={project.id} />);
    expect(screen.queryByRole("link")).toBeNull();
    const row = screen.getByTestId(`event-${project.id}:${event.id}`);
    await userEvent.click(row);
    expect(screen.getByRole("link", { name: /コミットの差分/ })).toHaveAttribute("target", "_blank");
    expect(row.querySelector("a")).toBeNull();
    expect(screen.getByText(/残り.*件/)).toBeInTheDocument();
  });

  it("架空のイベントに、同じ ID の実物のリンクを流用しない", () => {
    render(<ArtifactLinks project={{ ...project, fictional: true }} event={event} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("非公開セッションのリンクを作らない", () => {
    render(<ArtifactLinks project={project} event={project.events.find((e) => e.source.kind === "session")!} />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("公開済みの入力資料があっても、固定イベントは再構成であることを明示する", () => {
    render(<ArtifactLinks project={project} event={project.events.find((e) => e.type === "constitution.pinned")!} />);
    expect(screen.getByText(/入力（再構成）/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", expect.stringMatching(/\/blob\/[a-f0-9]{40}\/examples\/approval-workflow\/CLAUDE.md$/));
  });
});
