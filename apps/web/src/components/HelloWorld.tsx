import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { fetchHealth } from "../lib/health";
import { formatWhen, t, type Locale } from "../lib/i18n";
import { getStore } from "../lib/store";

export function HelloWorld() {
  const [locale, setLocale] = useState<Locale>("en");
  const localGreeting = useMemo(
    () => String(getStore().getValue("greeting") ?? ""),
    [],
  );

  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    retry: 1,
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-4 py-10">
      <header className="space-y-2">
        <p className="text-sm font-medium tracking-wide text-sky-400 uppercase">
          {localGreeting}
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t(locale, "title")}
        </h1>
        <p className="text-slate-400">{t(locale, "subtitle")}</p>
      </header>

      <label className="flex items-center gap-3 text-sm text-slate-300">
        <span>{t(locale, "localeLabel")}</span>
        <select
          className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1"
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          aria-label={t(locale, "localeLabel")}
        >
          <option value="en">English</option>
          <option value="id">Indonesia</option>
        </select>
      </label>

      <section
        className="rounded-xl border border-slate-800 bg-slate-900/60 p-4"
        aria-live="polite"
      >
        <h2 className="mb-3 text-sm font-medium text-slate-300">
          {t(locale, "health")}
        </h2>
        {health.isPending && (
          <p className="text-slate-400">{t(locale, "loading")}</p>
        )}
        {health.isError && (
          <p className="text-amber-300">{t(locale, "offline")}</p>
        )}
        {health.data && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-500">{t(locale, "env")}</dt>
            <dd>{health.data.env}</dd>
            <dt className="text-slate-500">{t(locale, "schema")}</dt>
            <dd>{health.data.schemaVersion}</dd>
            <dt className="text-slate-500">{t(locale, "fetchedAt")}</dt>
            <dd>{formatWhen(locale, new Date())}</dd>
            <dt className="text-slate-500">status</dt>
            <dd className="text-emerald-400">{health.data.message}</dd>
          </dl>
        )}
      </section>
    </main>
  );
}
