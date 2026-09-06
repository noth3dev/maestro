import { describe, expect, it, vi } from "vitest";
import { createChatEditor } from "./chat-editor.js";

describe("chat editor", () => {
  it("submits multiline text and clears only after submission", () => {
    const submit = vi.fn();
    const editor = createChatEditor(submit);
    editor.insert("line one");
    editor.insert("\nline two");
    expect(editor.value()).toBe("line one\nline two");
    editor.submit();
    expect(submit).toHaveBeenCalledWith("line one\nline two");
    expect(editor.value()).toBe("");
  });

  it("does not submit an empty message", () => {
    const submit = vi.fn();
    createChatEditor(submit).submit();
    expect(submit).not.toHaveBeenCalled();
  });
});
