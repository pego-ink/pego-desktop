import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { TooltipProvider } from "@pego/ui/components/tooltip";
import { App } from "@/App";
import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import "@/index.css";

const queryClient = new QueryClient();
const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <App />
      </TooltipProvider>
      <Toaster theme="dark" />
    </QueryClientProvider>
  </StrictMode>,
);
