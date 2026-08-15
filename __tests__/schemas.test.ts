import { describe, expect, it } from "vitest";
import { createJobSchema, sourceUrlSchema } from "@/lib/schemas";

describe("sourceUrlSchema", () => {
  const valid = [
    "https://cdn.example.com/videos/input.mp4",
    "http://cdn.example.com/videos/input.mp4",
    "https://example.com/path/to/media.m3u8",
    "https://example.com/a/b/c.mp4?token=123",
  ];

  const invalid = [
    "not a url",
    "ftp://example.com/video.mp4",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://example.com", // bare host, no path
    "http://", // protocol only
    "", // empty
    "   ", // whitespace
  ];

  for (const url of valid) {
    it(`accepts ${url}`, () => {
      expect(sourceUrlSchema.safeParse(url).success).toBe(true);
    });
  }

  for (const url of invalid) {
    it(`rejects ${url || "(empty)"}`, () => {
      expect(sourceUrlSchema.safeParse(url).success).toBe(false);
    });
  }
});

describe("createJobSchema", () => {
  it("accepts sourceUrl + optional title", () => {
    const result = createJobSchema.safeParse({
      sourceUrl: "https://cdn.example.com/videos/ok.mp4",
      title: "My video",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty title (normalized)", () => {
    const result = createJobSchema.safeParse({
      sourceUrl: "https://cdn.example.com/videos/ok.mp4",
      title: "",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a bad source URL", () => {
    const result = createJobSchema.safeParse({
      sourceUrl: "not a url",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.sourceUrl).toBeDefined();
    }
  });
});