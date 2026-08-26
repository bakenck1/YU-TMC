"use client";

import RouteBoundaryFallback from "@/components/RouteBoundaryFallback";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return <RouteBoundaryFallback error={error} retry={unstable_retry} />;
}
