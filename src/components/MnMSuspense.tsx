import { ReactNode, Suspense } from "react";
import { ErrorBoundary, FallbackProps } from "react-error-boundary";
import { QueryErrorResetBoundary } from "@tanstack/react-query";

interface MnMAsyncBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  errorFallback?: (props: FallbackProps) => ReactNode;
}

export function MnMSuspense({ children, fallback, errorFallback = () => <></> }: MnMAsyncBoundaryProps) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary onReset={reset} fallbackRender={errorFallback}>
          <Suspense fallback={fallback}>{children}</Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
