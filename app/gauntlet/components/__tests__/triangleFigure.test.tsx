import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TriangleFigure from "../TriangleFigure";

describe("TriangleFigure", () => {
  it("renders responsive figures with true angle arcs and distinct side ticks", () => {
    const html = renderToStaticMarkup(
      <TriangleFigure
        pair={{
          a: { sides: [70, 80, 90], marks: ["s0", "A1", "s1"], rotate: -20 },
          b: { sides: [70, 80, 90], marks: ["s0", "A1", "s1"], rotate: 110 },
        }}
      />
    );

    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).toContain('viewBox="0 0 160 140"');
    expect(html).not.toMatch(/<svg[^>]+width=/);
    expect(html).not.toContain("<circle");
    expect(html.match(/<line/g)).toHaveLength(6);
    expect(html.match(/<path/g)).toHaveLength(4);
    expect(html).toContain("Two triangles with matching side and angle markings");
  });
});
