export const viewNames = [
  "home", "dashboard", "channel", "git", "floor", "inbox", "evlog", "billing",
  "settings", "luthiery", "arrangements", "flashmob", "flashmobSession",
] as const;

export type ViewName = (typeof viewNames)[number];
