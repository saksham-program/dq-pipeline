import { describe, expect, it } from "vitest";
import { isDemoWorkspace } from "./workspace";

describe("demo workspace detection", () => {
  it("resets local and preview environments", () => {
    expect(isDemoWorkspace("localhost")).toBe(true);
    expect(isDemoWorkspace("id-preview--abc.lovable.app")).toBe(true);
  });
  it("protects the published app", () => {
    expect(isDemoWorkspace("myapp.lovable.app")).toBe(false);
    expect(isDemoWorkspace("dq.example.com")).toBe(false);
  });
  it("explicit setting wins", () => {
    expect(isDemoWorkspace("localhost", "off")).toBe(false);
    expect(isDemoWorkspace("dq.example.com", "on")).toBe(true);
  });
});
