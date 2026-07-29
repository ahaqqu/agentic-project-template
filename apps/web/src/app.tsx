import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { SwUpdatePrompt } from "./lib/sw-update";
import { router } from "./router";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SwUpdatePrompt />
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
