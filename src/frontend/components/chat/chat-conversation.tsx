import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatConversation as ChatConversationType } from "@/types/chat";
import { formatDate, formatTime } from "./utils";
import type { ChatMessage as ChatMessageType } from "@/types/chat";
import ArrowRightIcon from "../icons/arrow-right";
import { Badge } from "../ui/badge";

const MESSAGE_GROUP_THRESHOLD = 3 * 60 * 1000; // 3 minutes in milliseconds

interface ChatConversationProps {
  activeConversation: ChatConversationType;
  newMessage: string;
  setNewMessage: (message: string) => void;
  onSendMessage: () => void;
}

interface MessageGroup {
  messages: ChatMessageType[];
  timestamp: string;
  isFromCurrentUser: boolean;
}

export default function ChatConversation({
  activeConversation,
  newMessage,
  setNewMessage,
  onSendMessage,
}: ChatConversationProps) {
  // Group messages by time and sender
  const groupMessages = (messages: ChatMessageType[]): MessageGroup[] => {
    const groups: MessageGroup[] = [];

    messages.forEach((message) => {
      const lastGroup = groups[groups.length - 1];
      const messageTime = new Date(message.timestamp).getTime();

      if (
        lastGroup &&
        lastGroup.isFromCurrentUser === message.isFromCurrentUser &&
        messageTime - new Date(lastGroup.timestamp).getTime() <=
          MESSAGE_GROUP_THRESHOLD
      ) {
        // Add to existing group
        lastGroup.messages.push(message);
      } else {
        // Create new group
        groups.push({
          messages: [message],
          timestamp: message.timestamp,
          isFromCurrentUser: message.isFromCurrentUser,
        });
      }
    });

    return groups;
  };

  const messageGroups = groupMessages(activeConversation.messages);

  return (
    <motion.div
      key="conversation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="h-full flex flex-col overflow-clip"
    >
      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-clip p-4 space-y-4">
        {/* Date header */}
        <div className="text-center">
          <Badge
            variant="secondary"
            className="font-medium text-xs text-foreground/40"
          >
            {formatDate(activeConversation.messages[0]?.timestamp || "")}
          </Badge>
        </div>

        <AnimatePresence initial={false}>
          {messageGroups.map((group, groupIndex) => (
            <motion.div
              key={`group-${groupIndex}`}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.95 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className={cn(
                "flex flex-col gap-1",
                group.isFromCurrentUser ? "items-end" : "items-start"
              )}
            >
              {/* Timestamp for the group */}
              <div className="w-full flex justify-center mb-1">
                <span className="text-xs text-foreground/40">
                  {formatTime(group.timestamp)}
                </span>
              </div>

              {/* Messages in the group */}
              {group.messages.map((message, messageIndex) => (
                <motion.div
                  key={message.id}
                  initial={{
                    opacity: 0,
                    scale: 0.8,
                    x: group.isFromCurrentUser ? 20 : -20,
                    y: 10,
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    x: 0,
                    y: 0,
                  }}
                  transition={{
                    duration: 0.4,
                    ease: "backOut",
                    delay: messageIndex * 0.05,
                  }}
                  className={cn(
                    "max-w-[70%] rounded-lg px-3 py-2 text-base font-medium",
                    group.isFromCurrentUser
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-foreground",
                    // First message in group gets more rounded corners on the outer side
                    messageIndex === 0 && group.isFromCurrentUser
                      ? "rounded-br-sm"
                      : messageIndex === 0 && !group.isFromCurrentUser
                      ? "rounded-bl-sm"
                      : "",
                    // Last message in group gets more rounded corners on the outer side
                    messageIndex === group.messages.length - 1 &&
                      group.isFromCurrentUser
                      ? "rounded-tr-sm"
                      : messageIndex === group.messages.length - 1 &&
                        !group.isFromCurrentUser
                      ? "rounded-tl-sm"
                      : ""
                  )}
                  layout
                >
                  {message.content}
                </motion.div>
              ))}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Message Input */}
      <div className="border-t-2 border-muted sticky bottom-0 bg-secondary h-12 p-1">
        <Input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder={`Message ${
            activeConversation.participants.find(
              (p) => p.id !== "joyboy" // Using current user ID
            )?.name
          }`}
          className="flex-1 rounded-none border-none text-foreground placeholder-foreground/40 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") onSendMessage();
          }}
        />
        <Button
          variant={newMessage.trim() ? "default" : "outline"}
          onClick={onSendMessage}
          disabled={!newMessage.trim()}
          className="absolute right-1.5 top-1.5 h-8 w-12 p-0"
        >
          <ArrowRightIcon className="w-4 h-4" />
        </Button>
      </div>
    </motion.div>
  );
}
