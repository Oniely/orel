import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Cell from "./Cell";

describe("Cell", () => {
  it("renders http(s) URLs as plain text without an image or extra offset", () => {
    const url = "https://player.vimeo.com/video/123456789";
    const { container } = render(<Cell value={url} type="varchar" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe(url);
  });
});
