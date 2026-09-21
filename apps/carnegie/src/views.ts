export const viewNames = [
  "home", "dashboard", "planning", "channel", "git", "floor", "inbox", "evlog", "billing",
  "settings", "persona", "luthiery", "arrangements", "flashmob", "flashmobSession",
] as const;

export type ViewName = (typeof viewNames)[number];
