import { describe, expect, it } from "vitest";
import { parseWikiquote } from "../lib/archive/wiki";

const html = `<div>intro</div>
<div class="mw-heading mw-heading2"><h2 id="Quotes">Quotes</h2></div>
<ul><li>Painting is poetry that is seen rather than felt, and poetry is painting that is felt rather than seen.<ul><li>Notebooks, c. 1510</li></ul></li>
<li>Short one.<ul><li>Somewhere</li></ul></li>
<li>An unsourced line that has no citation underneath it at all, so skip it.</li></ul>
<div class="mw-heading mw-heading2"><h2 id="Misattributed">Misattributed</h2></div>
<ul><li>Simplicity is the ultimate sophistication, a line often credited but never written.<ul><li>Nowhere</li></ul></li></ul>`;

describe("parseWikiquote", () => {
  it("keeps sourced quotes and skips misattributed sections", () => {
    const qs = parseWikiquote(html);
    expect(qs).toHaveLength(1);
    expect(qs[0].text).toMatch(/^Painting is poetry/);
    expect(qs[0].cite).toBe("Notebooks, c. 1510");
  });
});
