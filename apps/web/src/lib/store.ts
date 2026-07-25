import { createMergeableStore, type MergeableStore } from "tinybase";
import { SCHEMA_VERSION } from "@app/sync-protocol";

let store: MergeableStore | null = null;

export function getStore(): MergeableStore {
  if (!store) {
    store = createMergeableStore();
    store.setValues({
      schemaVersion: SCHEMA_VERSION,
      greeting: "Hello World",
    });
  }
  return store;
}
