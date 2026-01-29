"use client";

import { captureException } from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-svh bg-white text-zinc-900">
        <div className="mx-auto flex min-h-svh max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
          <h1 className="font-semibold text-2xl">Something went wrong</h1>
          <p className="text-sm text-zinc-600">
            An unexpected error occurred. Try again, or refresh the page.
          </p>
          <button
            className="rounded-md border border-zinc-300 px-4 py-2 font-medium text-sm text-zinc-900"
            onClick={() => reset()}
            type="button"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
