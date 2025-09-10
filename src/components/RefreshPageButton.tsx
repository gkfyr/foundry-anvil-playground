"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RefreshPageButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  return (
    <button
      onClick={() => {
        setLoading(true);
        router.refresh();
        setTimeout(() => setLoading(false), 300); // small UX reset
      }}
      className="rounded border px-3 py-1 text-sm"
    >
      {loading ? "새로고침 중..." : "ETH 잔고 새로고침"}
    </button>
  );
}

