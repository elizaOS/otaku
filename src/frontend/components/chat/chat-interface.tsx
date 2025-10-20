import type React from "react"
import { useEffect, useState, useRef } from "react"
import { elizaClient } from '@/lib/elizaClient'
import { socketManager } from '@/lib/socketManager'
import type { UUID, Agent } from '@elizaos/core'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Bot, Loader2 } from "lucide-react"
import { Bullet } from "@/components/ui/bullet"
import { cn } from "@/lib/utils"
import ArrowRightIcon from "@/components/icons/arrow-right"

// Quick start prompts for new conversations (static fallback)
const DEFAULT_QUICK_PROMPTS = [
  "Show my wallet",
  "What's happening in DeFi today?",
  "Compare EIGEN vs MORPHO",
  "Latest Ethereum news",
  "Get Bitcoin price",
  "What can you help me with?",
  "Analyze Aave protocol TVL"
]

interface Message {
  id: string
  content: string
  authorId: string
  createdAt: number
  isAgent: boolean
  senderName?: string
}

interface ChatInterfaceProps {
  agent: Agent
  userId: string
  serverId: string
  channelId: string | null
  isNewChatMode?: boolean
  onChannelCreated?: (channelId: string, channelName: string) => void
}

export function ChatInterface({ agent, userId, serverId, channelId, isNewChatMode = false, onChannelCreated }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [isCreatingChannel, setIsCreatingChannel] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Clear messages when entering new chat mode
  useEffect(() => {
    if (isNewChatMode && !channelId) {
      console.log('🆕 Entering new chat mode - clearing messages')
      setMessages([])
    }
  }, [isNewChatMode, channelId])

  // Load messages when channel changes
  useEffect(() => {
    if (!channelId) return

    async function loadMessages() {
      try {
        console.log('📨 Loading messages for channel:', channelId)
        const messagesResponse = await elizaClient.messaging.getChannelMessages(channelId as UUID, {
          limit: 50,
        })

        const formattedMessages: Message[] = messagesResponse.messages.map((msg) => {
          let timestamp: number
          if (msg.createdAt instanceof Date) {
            timestamp = msg.createdAt.getTime()
          } else if (typeof msg.createdAt === 'number') {
            timestamp = msg.createdAt
          } else if (typeof msg.createdAt === 'string') {
            timestamp = Date.parse(msg.createdAt)
          } else {
            timestamp = Date.now()
          }

          return {
            id: msg.id,
            content: msg.content,
            authorId: msg.authorId,
            createdAt: timestamp,
            isAgent: msg.authorId === agent.id,
            senderName: msg.metadata?.authorDisplayName || (msg.authorId === agent.id ? agent.name : 'User'),
          }
        })

        const sortedMessages = formattedMessages.sort((a, b) => a.createdAt - b.createdAt)
        setMessages(sortedMessages)
        console.log(`✅ Loaded ${sortedMessages.length} messages`)
      } catch (error: any) {
        console.error('❌ Failed to load messages:', error)
      }
    }

    loadMessages()
  }, [channelId, agent.id, agent.name])

  // Listen for new messages (channel joining is handled in App.tsx)
  useEffect(() => {
    if (!channelId) return undefined

    const handleNewMessage = (data: any) => {
      console.log('📩 New message received:', data)
      
      const messageId = data.id || crypto.randomUUID()
      const newMessage: Message = {
        id: messageId,
        content: data.content || data.text || data.message || '',
        authorId: data.senderId,
        createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.parse(data.createdAt as string),
        isAgent: data.senderId === agent.id,
        senderName: data.senderName || (data.senderId === agent.id ? agent.name : 'User'),
      }

      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === messageId)) {
          return prev
        }
        // Add new message and sort by timestamp
        const updated = [...prev, newMessage]
        return updated.sort((a, b) => a.createdAt - b.createdAt)
      })
      
      // Stop typing indicator when agent responds
      if (newMessage.isAgent) {
        setIsTyping(false)
      }
    }

    // Only subscribe if socket is available - prevents errors during reconnection
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = socketManager.onMessage(handleNewMessage)
    } catch (error) {
      console.warn('⚠️ Failed to subscribe to messages (socket not ready):', error)
      return undefined
    }

    return () => {
      unsubscribe?.()
    }
  }, [channelId, agent.id, agent.name, userId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || isCreatingChannel) return
    
    // If in new chat mode, create channel first with generated title
    if (isNewChatMode && !channelId) {
      console.log('🆕 [ChatInterface] First message in new chat mode, creating channel...')
      setIsCreatingChannel(true)
      setIsTyping(true)
      
      try {
        // STEP 1: Generate title from user's message
        console.log('🏷️ Generating title from user message:', inputValue)
        const titleResponse = await elizaClient.messaging.generateChannelTitle(
          inputValue, // Pass the message as string
          agent.id as UUID
        )
        const generatedTitle = titleResponse.title || inputValue.substring(0, 50)
        console.log('✅ Generated title:', generatedTitle)

        // STEP 2: Create channel in DB with the generated title
        console.log('💾 Creating channel with title:', generatedTitle)
        const now = Date.now()
        const newChannel = await elizaClient.messaging.createGroupChannel({
          name: generatedTitle,
          participantIds: [userId as UUID, agent.id as UUID],
          metadata: {
            server_id: serverId,
            type: 'DM',
            isDm: true,
            user1: userId,
            user2: agent.id,
            forAgent: agent.id,
            createdAt: new Date(now).toISOString(),
          },
        })
        console.log('✅ Channel created:', newChannel.id)

        // STEP 3: Notify parent component
        onChannelCreated?.(newChannel.id, generatedTitle)

        // STEP 4: Send the message (channel is now created and will be set as active)
        // The socket join will happen automatically via App.tsx's useEffect
        // Wait a brief moment for the channel to be set as active
        setTimeout(() => {
          console.log('🚀 Sending initial message to new channel:', newChannel.id)
          socketManager.sendMessage(newChannel.id, inputValue, serverId, {
            userId,
            isDm: true,
            targetUserId: agent.id,
          })
        }, 100)

        setInputValue('')
      } catch (error: any) {
        console.error('❌ Failed to create channel:', error)
        setIsTyping(false)
      } finally {
        setIsCreatingChannel(false)
      }
      return
    }
    
    // Normal message sending (channel already exists)
    if (!channelId) {
      console.warn('⚠️ Cannot send message: No channel ID')
      return
    }
    
    console.log('🚀 [ChatInterface] Sending message:', {
      channelId,
      text: inputValue,
      serverId,
      userId,
      agentId: agent.id,
    })
    
    // Send via socket (don't add optimistically - server will broadcast back)
    socketManager.sendMessage(channelId, inputValue, serverId, {
      userId,
      isDm: true,
      targetUserId: agent.id,
    })
    
    setInputValue('')
    setIsTyping(true)
  }

  // Handle quick prompt click - auto send message
  const handleQuickPrompt = async (message: string) => {
    if (isTyping || !message.trim() || isCreatingChannel) return
    
    // If in new chat mode, create channel first with generated title
    if (isNewChatMode && !channelId) {
      console.log('🆕 [ChatInterface] Quick prompt in new chat mode, creating channel...')
      setIsCreatingChannel(true)
      setIsTyping(true)
      
      try {
        // STEP 1: Generate title from user's message
        console.log('🏷️ Generating title from user message:', message)
        const titleResponse = await elizaClient.messaging.generateChannelTitle(
          message, // Pass the message as string
          agent.id as UUID
        )
        const generatedTitle = titleResponse.title || message.substring(0, 50)
        console.log('✅ Generated title:', generatedTitle)

        // STEP 2: Create channel in DB with the generated title
        console.log('💾 Creating channel with title:', generatedTitle)
        const now = Date.now()
        const newChannel = await elizaClient.messaging.createGroupChannel({
          name: generatedTitle,
          participantIds: [userId as UUID, agent.id as UUID],
          metadata: {
            server_id: serverId,
            type: 'DM',
            isDm: true,
            user1: userId,
            user2: agent.id,
            forAgent: agent.id,
            createdAt: new Date(now).toISOString(),
          },
        })
        console.log('✅ Channel created:', newChannel.id)

        // STEP 3: Notify parent component
        onChannelCreated?.(newChannel.id, generatedTitle)

        // STEP 4: Send the message (channel is now created and will be set as active)
        setTimeout(() => {
          console.log('🚀 Sending initial message to new channel:', newChannel.id)
          socketManager.sendMessage(newChannel.id, message, serverId, {
            userId,
            isDm: true,
            targetUserId: agent.id,
          })
        }, 100)
      } catch (error: any) {
        console.error('❌ Failed to create channel:', error)
        setIsTyping(false)
      } finally {
        setIsCreatingChannel(false)
      }
      return
    }
    
    // Normal quick prompt (channel already exists)
    if (!channelId) {
      console.warn('⚠️ Cannot send message: No channel ID')
      return
    }
    
    console.log('🚀 [ChatInterface] Sending quick prompt:', {
      channelId,
      text: message,
      serverId,
      userId,
      agentId: agent.id,
    })
    
    // Send via socket directly
    socketManager.sendMessage(channelId, message, serverId, {
      userId,
      isDm: true,
      targetUserId: agent.id,
    })
    
    setIsTyping(true)
  }

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] gap-6">
      <Card className="flex-1 overflow-hidden">
        <CardContent className="h-full overflow-y-auto p-6">
          <div className="space-y-4 h-full flex flex-col">
            {/* Messages */}
            <div className="flex-1 space-y-4">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn("flex flex-col gap-1", message.isAgent ? "items-start" : "items-end")}
                >
                  <div
                    className={cn(
                      "max-w-[70%] rounded-lg px-3 py-2 text-sm font-medium",
                      message.isAgent ? "bg-accent text-foreground" : "bg-primary text-primary-foreground",
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">
                      {message.content}
                    </p>
                    <span className="text-xs opacity-50 mt-1 block">
                      {new Date(message.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))}
              {isTyping && (
                <div className="flex flex-col gap-1 items-start">
                  <div className="max-w-[70%] rounded-lg px-3 py-2 bg-accent text-foreground">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Quick Prompts - Only show when no messages and not creating/typing */}
            {messages.length === 0 && !isCreatingChannel && !isTyping && (
              <div className="pt-4 border-t border-border">
                <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3 font-mono">
                  Quick Start
                </p>
                <div className="flex flex-wrap gap-2">
                  {DEFAULT_QUICK_PROMPTS.map((prompt, index) => (
                    <button
                      key={index}
                      onClick={() => handleQuickPrompt(prompt)}
                      className="px-3 py-2 text-sm bg-accent hover:bg-accent/80 text-foreground rounded border border-border transition-colors text-left whitespace-normal"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="border-t-2 border-muted bg-secondary h-12 p-1 relative">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Type your message..."
          disabled={isTyping || isCreatingChannel}
          className="flex-1 rounded-none border-none text-foreground placeholder-foreground/40 text-sm font-mono"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
        />
        <Button
          variant={inputValue.trim() ? "default" : "outline"}
          onClick={handleSubmit}
          disabled={!inputValue.trim() || isTyping || isCreatingChannel}
          className="absolute right-1.5 top-1.5 h-8 w-12 p-0"
        >
          {isTyping || isCreatingChannel ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowRightIcon className="w-4 h-4" />
          )}
        </Button>
      </div>
    </div>
  )
}
