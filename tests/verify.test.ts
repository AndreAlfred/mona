import { describe, expect, it } from "vitest";
import { normalize, segments, verifyAgainstText } from "../lib/verify";
import type { QuotePassage } from "../lib/schema";

const q = (text: string, author = "Vincent van Gogh", tier = 1): QuotePassage => ({
  kind: "quote",
  text,
  source: { author, title: "Letter 676", readAt: "https://example.org", accessed: "2026-11-03", tier },
});

const page = `<p>My dear Theo,</p> I have a terrible need of — shall I say the word? — of religion.
Then I go outside at night to paint the stars. — Vincent van Gogh, letter to Theo`;

describe("normalize", () => {
  it("ignores typography but keeps words", () => {
    expect(normalize("“Shall I say the word?” — he wrote")).toBe("shall i say the word he wrote");
    expect(normalize("Café­ au lait")).toBe("cafe au lait");
  });
});

describe("segments", () => {
  it("splits on ellipses and editorial brackets", () => {
    expect(segments("I have a terrible need of … of religion. Then I go outside at night")).toEqual([
      "i have a terrible need of",
      "of religion then i go outside at night",
    ]);
    expect(segments("I go [outside] at night to paint the stars")).toEqual(["i go", "at night to paint the stars"].filter((s) => s.split(" ").length >= 3));
  });
});

describe("verifyAgainstText", () => {
  it("accepts a verbatim quote with different quote marks and dashes", () => {
    expect(verifyAgainstText(q("I have a terrible need of — shall I say the word? — of religion."), page).ok).toBe(true);
  });
  it("accepts an elided quote", () => {
    expect(verifyAgainstText(q("I have a terrible need of … religion. Then I go outside at night to paint the stars."), page).ok).toBe(true);
  });
  it("rejects a reworded quote", () => {
    const r = verifyAgainstText(q("I have a great need of religion, so I go out at night to paint the stars."), page);
    expect(r.ok).toBe(false);
  });
  it("rejects when the credited author is not on the page", () => {
    const r = verifyAgainstText(q("Then I go outside at night to paint the stars.", "Paul Gauguin"), page);
    expect(r).toMatchObject({ ok: false });
    expect((r as { reason: string }).reason).toMatch(/not named/);
  });
  it("skips the author check for institutional text", () => {
    expect(verifyAgainstText(q("Then I go outside at night to paint the stars.", "Art Institute of Chicago", 4), page).ok).toBe(true);
  });
  it("rejects fragments too short to verify", () => {
    expect(verifyAgainstText(q("the word"), page).ok).toBe(false);
  });
  it("does not match across word boundaries", () => {
    expect(verifyAgainstText(q("need of religion then I go outsi"), page).ok).toBe(false);
  });
});
