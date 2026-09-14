"use client";

import { useEffect, useState } from "react";
import { finishLink } from "@/lib/client/link";

export default function LinkCallback() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    finishLink(p.get("code") ?? "", p.get("state") ?? "")
      .then(() => window.location.replace("/?linked=1"))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="min-h-screen grid place-items-center bg-[#f4ede2] font-serif text-xl text-[#2a2119]">
      {error ? <span>{error}</span> : <span>Linking Refill…</span>}
    </main>
  );
}
