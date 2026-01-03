import { cn } from "@/frontend/lib/utils";
import { type ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";

type ResponseProps = ComponentProps<typeof Streamdown>;

export const Response = memo(
  ({ className, ...props }: ResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        // High-contrast, accessible link styles inside streamed responses
        "[&_a]:underline [&_a]:underline-offset-2 [&_a]:font-medium",
        "[&_a]:text-blue-700 dark:[&_a]:text-blue-400",
        "hover:[&_a]:text-blue-600 dark:hover:[&_a]:text-blue-300",
        "[&_a]:decoration-blue-600/50 dark:[&_a]:decoration-blue-400/60 hover:[&_a]:decoration-2",
        "focus-visible:[&_a]:outline-none focus-visible:[&_a]:ring-1 focus-visible:[&_a]:ring-blue-400/40 focus-visible:[&_a]:rounded-sm",
        "[&_a]:wrap-break-word",
        className
      )}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

Response.displayName = "Response";

