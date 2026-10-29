import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SaveBar } from "./shared";

afterEach(cleanup);

describe("SaveBar", () => {
  it("renders the saving spinner in the button's text color, not the accent background color", () => {
    const { container } = render(
      <SaveBar pendingCount={2} saving saveDisabled={false} onCancel={() => {}} onSave={() => {}} />,
    );
    const spinner = container.querySelector('[data-slot="spinner"]');
    expect(spinner).not.toBeNull();
    expect(spinner?.className).toContain("spinner--current");
    expect(spinner?.className).not.toContain("spinner--accent");
  });
});
