import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useChatState } from "./use-chat-state";
import PlusIcon from "../icons/plus";
import ChatPreview from "./chat-preview";
import ChatConversation from "./chat-conversation";
import { ChatHeader } from "./chat-header";

const CONTENT_HEIGHT = 420; // Height of expandable content

export default function Chat() {
  const {
    chatState,
    conversations,
    newMessage,
    setNewMessage,
    activeConversation,
    handleSendMessage,
    openConversation,
    goBack,
    toggleExpanded,
  } = useChatState();

  const isExpanded = chatState.state !== "collapsed";

  return (
    <motion.div
      className="absolute bottom-0 inset-x-0 z-30"
      initial={{ y: CONTENT_HEIGHT }}
      animate={{ y: isExpanded ? 0 : CONTENT_HEIGHT }}
      transition={{ duration: 0.3, ease: "circInOut" }}
    >
      {/* Shared Morphing Header - Always at the top */}
      <ChatHeader
        variant="desktop"
        onClick={toggleExpanded}
        showBackButton={chatState.state === "conversation"}
        onBackClick={goBack}
      />

      {/* Expandable Content - Below the header */}
      <div className="pt-1 overflow-y-auto" style={{ height: CONTENT_HEIGHT }}>
        <div className="bg-background text-foreground h-full">
          <AnimatePresence mode="wait">
            {chatState.state === "expanded" && (
              <motion.div
                key="expanded"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="h-full flex flex-col"
              >
                {/* Conversations List */}
                <div className="flex-1 flex flex-col overflow-y-auto">
                  {conversations.map((conversation) => (
                    <ChatPreview
                      key={conversation.id}
                      conversation={conversation}
                      onOpenConversation={openConversation}
                    />
                  ))}

                  {/* Footer */}
                  <div className="mt-auto flex justify-end p-4 sticky bottom-0 bg-gradient-to-t from-background via-background/80 to-black/0">
                    <Button
                      size="lg"
                      variant="secondary"
                      className="pl-0 py-0 gap-4 overflow-clip"
                    >
                      <div className="bg-primary text-primary-foreground h-full aspect-square border-r-2 border-background flex items-center justify-center">
                        <PlusIcon className="size-4" />
                      </div>
                      New Chat
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}

            {chatState.state === "conversation" && activeConversation && (
              <ChatConversation
                activeConversation={activeConversation}
                newMessage={newMessage}
                setNewMessage={setNewMessage}
                onSendMessage={handleSendMessage}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
