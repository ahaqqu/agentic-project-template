import type { SyncStatus } from "@app/local-first/client";
import { t, type Locale } from "../lib/i18n";

export function SyncStatusBadge({
  status,
  locale,
}: {
  status: SyncStatus;
  locale: Locale;
}) {
  return (
    <span data-testid="sync-status">
      {status === "offline"
        ? t(locale, "offline")
        : status === "syncing"
          ? t(locale, "syncing")
          : t(locale, "synced")}
    </span>
  );
}
