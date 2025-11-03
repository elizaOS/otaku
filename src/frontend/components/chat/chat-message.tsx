import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageType } from "@/types/chat";
import { formatTime } from "./utils";

interface ChatMessageProps {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-end">
        <span className="text-xs text-gray-400">
          {formatTime(message.timestamp)}
        </span>
      </div>
      <div
        className={cn(
          "max-w-xs rounded-lg px-3 py-2 text-base",
          message.isFromCurrentUser
            ? "bg-blue-600 text-white ml-auto"
            : "bg-gray-700 text-white"
        )}
      >
        {message.content}
      </div>
    </div>
  );
}
