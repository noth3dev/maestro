export interface ChatEditor {
  insert(text: string): void;
  value(): string;
  submit(): void;
}

export function createChatEditor(onSubmit: (text: string) => void): ChatEditor {
  let text = "";
  return {
    insert(value) { text += value; },
    value() { return text; },
    submit() {
      if (text.trim() === "") return;
      const submitted = text;
      text = "";
      onSubmit(submitted);
    },
  };
}
