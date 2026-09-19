import {
  ThemeProvider,
  useTheme,
} from "@agentic-markdown/ui/components/theme-provider";
import "@agentic-markdown/ui/styles/globals.css";
import { Toaster } from "@agentic-markdown/ui/ui/sonner";
import { TooltipProvider } from "@agentic-markdown/ui/ui/tooltip";
import "@fontsource-variable/geist/index.css";
import "@fontsource-variable/geist-mono/index.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TooltipProvider delayDuration={1000}>
        <div className="flex size-full flex-col">
          <ThemedToaster />
          {children}
        </div>
      </TooltipProvider>
    </ThemeProvider>
  );
}

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme}
      position="top-center"
      offset={28}
      closeButton
      toastOptions={{
        classNames: {
          toast: "cn-toast",
          description: "text-muted-foreground!",
        },
      }}
    />
  );
}
