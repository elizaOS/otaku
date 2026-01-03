import { Tool } from "@/frontend/components/action-tool"
import { ToolGroup } from "@/frontend/components/action-tool-group"
import { AnimatedResponse } from "@/frontend/components/chat/animated-response"
import { ChatPriceChart } from "@/frontend/components/chat/chat-price-chart"
import ArrowRightIcon from "@/frontend/components/icons/arrow-right"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent } from "@/frontend/components/ui/card"
import { convertActionMessageToToolPart, isActionMessage } from "@/frontend/lib/action-message-utils"
import { elizaClient } from '@/frontend/lib/elizaClient'
import { socketManager } from '@/frontend/lib/socketManager'
import { cn } from "@/frontend/lib/utils"
import type { Agent, UUID } from '@elizaos/core'
import { Loader2, ArrowLeft, Wallet, TrendingUp, Search, Repeat, Database, CheckCircle2 } from "lucide-react"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import { Textarea } from "@/frontend/components/ui/textarea"

// Plugin definitions with metadata and sample prompts
const PLUGIN_ACTIONS = {
  cdp: {
    name: "CDP Wallet",
    icon: Wallet,
    description: "Manage your wallet and assets",
    prompts: [
      "Show my wallet portfolio",
      "Transfer 0.01 ETH to 0x...",
      "Swap 100 USDC for ETH",
      "Transfer NFT #123 from collection 0x...",
    ]
  },
  coingecko: {
    name: "Price & Market Data",
    icon: TrendingUp,
    description: "Token prices and market trends",
    prompts: [
      "Get ETH price chart and insights",
      "What's trending on Base?",
      "Show me trending NFT collections",
      "Get Bitcoin price",
    ]
  },
  webSearch: {
    name: "Web & News",
    icon: Search,
    description: "Search the web and crypto news",
    prompts: [
      "Latest DeFi news",
      "Search for Ethereum upgrades",
      "Crypto market news today",
    ]
  },
  defillama: {
    name: "DeFi Analytics",
    icon: Database,
    description: "Protocol TVL and DeFi metrics",
    prompts: [
      "Compare Aave vs Uniswap TVL",
      "Get Uniswap TVL",
      "Compare Eigen vs Morpho",
    ]
  },
  relay: {
    name: "Cross-Chain Bridge",
    icon: Repeat,
    description: "Bridge assets across chains",
    prompts: [
      "Bridge USDC from Base to Arbitrum",
      "Get bridge quote for 100 USDC from Base to Ethereum",
      "Check bridge status for tx 0x...",
    ]
  },
  etherscan: {
    name: "Transaction Checker",
    icon: CheckCircle2,
    description: "Verify transaction confirmations",
    prompts: [
      "Check confirmation for tx 0x...",
      "Verify transaction status 0x...",
      "How many confirmations for 0x...",
    ]
  }
}

// Helper function to extract chart data from a message
const extractChartData = (message: Message): any => {
  if (message.rawMessage?.actionResult?.values?.data_points) {
    return message.rawMessage.actionResult.values
  }
  
  if (message.rawMessage?.actionResult?.data?.data_points) {
    return message.rawMessage.actionResult.data
  }
  
  return null
}

// Helper function to find all chart data in an action group
const findAllChartDataInGroup = (actionGroup: Message[]): any[] => {
  const charts: any[] = []
  for (const message of actionGroup) {
    const chartData = extractChartData(message)
    if (chartData) {
      charts.push(chartData)
    }
  }
  return charts
}

interface Message {
  id: string
  content: string
  authorId: string
  createdAt: number
  isAgent: boolean
  senderName?: string
  sourceType?: string
  type?: string
  rawMessage?: any
  metadata?: any
  thought?: string
}

interface ChatInterfaceProps {
  agent: Agent
  userId: string
  serverId: string
  channelId: string | null
  isNewChatMode?: boolean
  onChannelCreated?: (channelId: string, channelName: string) => void
  onActionCompleted?: () => void // Callback when agent completes an action
}

const AnimatedDots = () => {
  const [dotCount, setDotCount] = useState(1)
  
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev % 3) + 1)
    }, 500)
    
    return () => clearInterval(interval)
  }, [])
  
  return <span>{'.'.repeat(dotCount)}</span>
}

export function ChatInterface({ agent, userId, serverId, channelId, isNewChatMode = false, onChannelCreated, onActionCompleted }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [isCreatingChannel, setIsCreatingChannel] = useState(false)
  const [selectedPlugin, setSelectedPlugin] = useState<keyof typeof PLUGIN_ACTIONS | null>(null)
  const [isLoadingMessages, setIsLoadingMessages] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showDummyToolGroup, setShowDummyToolGroup] = useState(false)
  const [showPromptsModal, setShowPromptsModal] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isUserScrollingRef = useRef(false) // Track if user is actively scrolling
  const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const MAX_TEXTAREA_HEIGHT = 160

  // Stabilize agent.id and agent.name to prevent unnecessary re-renders
  // Use refs to store stable values that don't trigger re-renders
  const agentIdRef = useRef(agent.id)
  const agentNameRef = useRef(agent.name)
  
  // Update refs when agent changes, but don't trigger re-renders
  useEffect(() => {
    agentIdRef.current = agent.id
    agentNameRef.current = agent.name
  }, [agent.id, agent.name])

  // Helper function to check if user is near bottom of the chat
  const checkIfNearBottom = () => {
    const container = messagesContainerRef.current
    if (!container) return true
    
    const threshold = 200 // pixels from bottom to consider "near bottom"
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom < threshold
  }


  // Helper function to scroll to bottom
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior })
  }

  // Helper function to resize textarea based on content
  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT) + 'px'
    }
  }, [MAX_TEXTAREA_HEIGHT])

  // Track scroll position - detect when user is actively scrolling
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    const handleScroll = () => {
      // User is actively scrolling - disable auto-scroll
      isUserScrollingRef.current = true
      
      // Clear previous timeout
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      
      // After user stops scrolling for 150ms, check position
      scrollTimeoutRef.current = setTimeout(() => {
        const nearBottom = checkIfNearBottom()
        // User stopped scrolling - enable auto-scroll only if near bottom
        isUserScrollingRef.current = !nearBottom
      }, 150)
    }

    container.addEventListener('scroll', handleScroll)
    return () => {
      container.removeEventListener('scroll', handleScroll)
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
    }
  }, [])

  // Resize textarea when input value changes
  useEffect(() => {
    resizeTextarea()
  }, [inputValue, resizeTextarea])

  // Clear messages when entering new chat mode
  useEffect(() => {
    if (isNewChatMode && !channelId) {
      console.log(' Entering new chat mode - clearing messages')
      setMessages([])
    }
  }, [isNewChatMode, channelId])

  // Load messages when channel changes
  // Only depend on channelId - using agent values directly in the function
  useEffect(() => {
    if (!channelId) return

    async function loadMessages() {
      try {
        setIsLoadingMessages(true)
        console.log(' Loading messages for channel:', channelId)
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
            isAgent: msg.authorId === agentIdRef.current,
            senderName: msg.metadata?.authorDisplayName || (msg.authorId === agentIdRef.current ? agentNameRef.current : 'User'),
            sourceType: msg.sourceType,
            type: msg.sourceType,
            rawMessage: msg.rawMessage,
            metadata: msg.metadata,
            thought: (msg as any).thought,
          }
        })

        const sortedMessages = formattedMessages.sort((a, b) => a.createdAt - b.createdAt)
        setMessages(sortedMessages)
        setIsLoadingMessages(false)
        isUserScrollingRef.current = false // User is not scrolling when loading messages
        setTimeout(() => scrollToBottom('smooth'), 0)
        console.log(` Loaded ${sortedMessages.length} messages`)
      } catch (error: any) {
        console.error(' Failed to load messages:', error)
      } finally {
        setIsLoadingMessages(false)
      }
    }

    loadMessages()
  }, [channelId])

  // Listen for new messages (channel joining is handled in App.tsx)
  // Only depend on channelId to avoid re-subscribing when agent object changes
  useEffect(() => {
    if (!channelId) return undefined

    const handleNewMessage = (data: any) => {
      console.log(' New message received:', data)
      console.log(' agentIdRef.current', agentIdRef.current);
      
      const messageId = data.id || crypto.randomUUID()
      const newMessage: Message = {
        id: messageId,
        content: data.content || data.text || data.message || '',
        authorId: data.senderId,
        createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.parse(data.createdAt as string),
        isAgent: data.senderId === agentIdRef.current,
        senderName: data.senderName || (data.senderId === agentIdRef.current ? agentNameRef.current : 'User'),
        sourceType: data.sourceType || data.source,
        type: data.type || data.sourceType || data.source,
        rawMessage: data.rawMessage || data,
        metadata: data.metadata,
      }

      // Show dummy tool group when user message arrives
      if (!newMessage.isAgent) {
        setShowDummyToolGroup(true)
        isUserScrollingRef.current = false // User is not scrolling when sending message
        // Wait for DOM to update before scrolling
        setTimeout(() => scrollToBottom('smooth'), 0)
      }

      setMessages((prev) => {
        // Check if message exists - if so, update it (for action status changes)
        const existingIndex = prev.findIndex((m) => m.id === messageId)
        if (existingIndex !== -1) {
          const updated = [...prev]
          updated[existingIndex] = newMessage
          return updated.sort((a, b) => a.createdAt - b.createdAt)
        }
        // Add new message and sort by timestamp
        const updated = [...prev, newMessage]
        return updated.sort((a, b) => a.createdAt - b.createdAt)
      })
      
      // Stop typing indicator only for final summary messages or error messages
      if (newMessage.isAgent) {
        console.log(' newMessage.isAgent', newMessage.isAgent);
        // Hide dummy tool group when agent message arrives
        setShowDummyToolGroup(false)
        
        // Check if this is a multi-step summary message
        const actions = newMessage.rawMessage?.actions || newMessage.metadata?.actions || []
        const isSummaryMessage = actions.includes('MULTI_STEP_SUMMARY')
        const isErrorMessage = newMessage.content.startsWith(' Error:')
        
        // Only stop typing for summary or error messages
        if (isSummaryMessage || isErrorMessage) {
          setIsTyping(false)
          // Wait for DOM to update before scrolling
          setTimeout(() => scrollToBottom('smooth'), 0)
          
          // If it's a summary message, trigger wallet refresh
          if (isSummaryMessage && onActionCompleted) {
            console.log(' Agent action completed - triggering wallet refresh')
            onActionCompleted()
          }
          
          // If it's an error message, also clear the local error state
          if (isErrorMessage) {
            // The error is already shown in the message, so clear any pending local errors
            setError(null)
          }
        }
      }
    }

    // Only subscribe if socket is available - prevents errors during reconnection
    let unsubscribe: (() => void) | undefined
    try {
      unsubscribe = socketManager.onMessage(handleNewMessage)
    } catch (error) {
      console.warn(' Failed to subscribe to messages (socket not ready):', error)
      return undefined
    }

    return () => {
      unsubscribe?.()
    }
  }, [channelId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || isCreatingChannel) return
    
    // Clear any previous errors
    setError(null)
    
    // If in new chat mode, create channel first with generated title
    if (isNewChatMode && !channelId) {
      console.log(' [ChatInterface] First message in new chat mode, creating channel...')
      setIsCreatingChannel(true)
      setIsTyping(true)
      
      try {
        // STEP 1: Generate title from user's message
        console.log(' Generating title from user message:', inputValue)
        const titleResponse = await elizaClient.messaging.generateChannelTitle(
          inputValue, // Pass the message as string
          agent.id as UUID
        )
        const generatedTitle = titleResponse.title || inputValue.substring(0, 50)
        console.log(' Generated title:', generatedTitle)

        // STEP 2: Create channel in DB with the generated title
        console.log(' Creating channel with title:', generatedTitle)
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
        console.log(' Channel created:', newChannel.id)

        // STEP 3: Notify parent component
        onChannelCreated?.(newChannel.id, generatedTitle)

        // STEP 4: Send the message (channel is now created and will be set as active)
        // The socket join will happen automatically via App.tsx's useEffect
        // Wait a brief moment for the channel to be set as active
        setTimeout(() => {
          console.log(' Sending initial message to new channel:', newChannel.id)
          socketManager.sendMessage(newChannel.id, inputValue, serverId, {
            userId,
            isDm: true,
            targetUserId: agent.id,
          })
        }, 100)

        setInputValue('')
      } catch (error: any) {
        console.error(' Failed to create channel:', error)
        const errorMessage = error?.message || 'Failed to create chat. Please try again.'
        setError(errorMessage)
        setIsTyping(false)
      } finally {
        setIsCreatingChannel(false)
      }
      return
    }
    
    // Normal message sending (channel already exists)
    if (!channelId) {
      console.warn(' Cannot send message: No channel ID')
      return
    }
    
    console.log(' [ChatInterface] Sending message:', {
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

  // Callback for when animated text updates - auto-scroll only if user is not scrolling
  const handleAnimationTextUpdate = useCallback(() => {
    // Only auto-scroll if user is not actively scrolling and is near bottom
    if (!isUserScrollingRef.current && checkIfNearBottom()) {
      scrollToBottom('auto')
    }
  }, []) // Empty deps - scrollToBottom and isUserScrollingRef are stable

  // Handle prompt click - populate input instead of auto-sending
  const handlePromptClick = (message: string) => {
    if (!message.trim()) return
    
    // Close modal if open
    setShowPromptsModal(false)
    
    // Populate input field with the prompt
    setInputValue(message)
    
    // Focus the input field
    const inputElement = document.querySelector('textarea');
    if (inputElement) {
      inputElement.focus();
    }
  }
  
  // Legacy function for backward compatibility (if needed elsewhere)
  const handleQuickPrompt = async (message: string) => {
    if (isTyping || !message.trim() || isCreatingChannel) return
    
    // Close modal if open
    setShowPromptsModal(false)
    
    // Clear any previous errors
    setError(null)
    
    // If in new chat mode, create channel first with generated title
    if (isNewChatMode && !channelId) {
      console.log(' [ChatInterface] Quick prompt in new chat mode, creating channel...')
      setIsCreatingChannel(true)
      setIsTyping(true)
      
      try {
        // STEP 1: Generate title from user's message
        console.log(' Generating title from user message:', message)
        const titleResponse = await elizaClient.messaging.generateChannelTitle(
          message, // Pass the message as string
          agent.id as UUID
        )
        const generatedTitle = titleResponse.title || message.substring(0, 50)
        console.log(' Generated title:', generatedTitle)

        // STEP 2: Create channel in DB with the generated title
        console.log(' Creating channel with title:', generatedTitle)
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
        console.log(' Channel created:', newChannel.id)

        // STEP 3: Notify parent component
        onChannelCreated?.(newChannel.id, generatedTitle)

        // STEP 4: Send the message (channel is now created and will be set as active)
        setTimeout(() => {
          console.log(' Sending initial message to new channel:', newChannel.id)
          socketManager.sendMessage(newChannel.id, message, serverId, {
            userId,
            isDm: true,
            targetUserId: agent.id,
          })
        }, 100)
      } catch (error: any) {
        console.error(' Failed to create channel:', error)
        const errorMessage = error?.message || 'Failed to create chat. Please try again.'
        setError(errorMessage)
        setIsTyping(false)
      } finally {
        setIsCreatingChannel(false)
      }
      return
    }
    
    // Normal quick prompt (channel already exists)
    if (!channelId) {
      console.warn(' Cannot send message: No channel ID')
      return
    }
    
    console.log(' [ChatInterface] Sending quick prompt:', {
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

  // Group consecutive action messages together
  const groupedMessages = messages.reduce<Array<Message | Message[]>>((acc, message, index) => {
    const isAction = isActionMessage(message)
    const prevItem = acc[acc.length - 1]
    
    // If this is an action message and the previous item is an array of actions, add to that array
    if (isAction && Array.isArray(prevItem) && prevItem.length > 0 && isActionMessage(prevItem[0])) {
      prevItem.push(message)
    } 
    // If this is an action message but previous was not, start a new array
    else if (isAction) {
      acc.push([message])
    }
    // If this is not an action message, add it as a single message
    else {
      acc.push(message)
    }
    
    return acc
  }, [])

  return (
    <div className="flex flex-col h-full min-h-0 gap-0">
      <Card className="flex-1 overflow-hidden">
        <CardContent className="h-full p-0">
          <div ref={messagesContainerRef} className="h-full overflow-y-auto p-6 pb-2">
            <div className="space-y-4 h-full flex flex-col">
            {/* Messages */}
            <div className="flex-1 space-y-4">
              {groupedMessages.map((item, groupIndex) => {
                // Handle grouped action messages
                if (Array.isArray(item)) {
                  const actionGroup = item
                  const firstAction = actionGroup[0]
                  const isLastGroup = groupIndex === groupedMessages.length - 1
                  // Find all chart data in this action group
                  const chartDataArray = findAllChartDataInGroup(actionGroup)
                  
                  // Get the latest action's status and name for label
                  const latestAction = actionGroup[actionGroup.length - 1]
                  const latestActionStatus = latestAction.metadata?.actionStatus || latestAction.rawMessage?.actionStatus
                  const latestActionName = latestAction.metadata?.actions?.[0] || latestAction.rawMessage?.actions?.[0] || 'action'
                  // Determine label based on state
                  const baseClasses = "px-2 py-1 rounded-md text-xs font-medium border"
                  let groupLabel = (
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-1">
                        See execution steps
                      </div>
                      <div
                        className={cn(
                          baseClasses,
                          "bg-green-100 text-green-700 border-green-700 dark:bg-green-900/30 dark:text-green-400 dark:border-green-400 uppercase"
                        )}
                      >
                        Completed
                      </div>
                    </div>
                  )

                  if (isLastGroup && isTyping) {
                    if (latestActionStatus === 'executing' && latestActionName) {
                      groupLabel = (
                        <div className="flex items-center w-full">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500 mr-2" />
                          <div className="flex items-center gap-1">
                            executing {latestActionName} action<AnimatedDots />
                          </div>
                        </div>
                      )
                    } else if (isTyping) {
                      groupLabel = (
                        <div className="flex items-center w-full">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500 mr-2" />
                          <div className="flex items-center gap-1">
                            OTAKU is thinking<AnimatedDots />
                          </div>
                        </div>
                      )
                    }
                  }
                  
                  return (
                    <div
                      key={`action-group-${groupIndex}-${firstAction.id}`}
                      className="flex flex-col gap-2 items-start"
                    >
                      <div className="max-w-[85%] w-full">
                        <ToolGroup 
                          defaultOpen={false}
                          label={groupLabel}
                        >
                          {actionGroup.map((message) => {
                            // Extract thought from rawMessage
                            const thought = message.thought || message.rawMessage?.thought || message.metadata?.thought
                            
                            return (
                              <div key={message.id} className="space-y-2">
                                {thought && (
                                  <div className="text-sm text-muted-foreground italic px-2">
                                    {thought}
                                  </div>
                                )}
                                <Tool 
                                  toolPart={convertActionMessageToToolPart(message)}
                                  defaultOpen={false}
                                />
                              </div>
                            )
                          })}
                        </ToolGroup>
                      </div>
                      
                      {/* Render all charts from this action group */}
                      {chartDataArray.length > 0 && chartDataArray.map((chartData, chartIndex) => (
                        <div 
                          key={`chart-${groupIndex}-${chartIndex}`}
                          className="max-w-[85%] w-full bg-card rounded-lg border border-border p-4"
                        >
                          <ChatPriceChart data={chartData} />
                        </div>
                      ))}
                    </div>
                  )
                }
                
                // Handle single messages (user or agent text messages)
                const message = item
                const messageIndex = messages.indexOf(message)
                const isLastMessage = messageIndex === messages.length - 1
                const messageAge = Date.now() - message.createdAt
                const isRecent = messageAge < 10000 // Less than 10 seconds
                const shouldAnimate = message.isAgent && isLastMessage && isRecent
                
                // Check if this is an error message from the agent
                const isErrorMessage = message.isAgent && message.content.startsWith(' Error:')

                return (
                  <div
                    key={message.id}
                    className={cn("flex flex-col gap-1", message.isAgent ? "items-start" : "items-end")}
                  >
                    <div
                      className={cn(
                        "max-w-[70%] rounded-lg px-3 py-2 text-base font-medium break-words whitespace-pre-wrap",
                        isErrorMessage 
                          ? "bg-destructive/10 border border-destructive/20 text-destructive"
                          : message.isAgent 
                            ? "bg-accent text-foreground" 
                            : "bg-primary text-primary-foreground",
                      )}
                    >
                      <AnimatedResponse 
                        className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0"
                        shouldAnimate={shouldAnimate && !isErrorMessage}
                        messageId={message.id}
                        maxDurationMs={10000}
                        onTextUpdate={handleAnimationTextUpdate}
                      >
                        {message.content}
                      </AnimatedResponse>
                      <span className="text-xs opacity-50 mt-1 block">
                        {new Date(message.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                )
              })}
             
              {/* Dummy Tool Group - Shows while waiting for agent actions */}
              {isTyping && showDummyToolGroup && (
                <div className="flex flex-col gap-1 items-start">
                  <div className="max-w-[85%] w-full">
                    <ToolGroup 
                      defaultOpen={false}
                      animate={true}
                      label={
                        <div className="flex items-center w-full">
                          <Loader2 className="h-4 w-4 animate-spin text-blue-500 mr-2" />
                          <div className="flex items-center gap-1">
                            Analyzing your request<AnimatedDots />
                          </div>
                        </div>
                      }
                    >
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <span>Processing your request<AnimatedDots /></span>
                      </div>
                    </ToolGroup>
                  </div>
                </div>
              )}
              
              {/* Error Message */}
              {error && (
                <div className="flex flex-col gap-1 items-center">
                  <div className="max-w-[90%] rounded-lg px-4 py-3 bg-destructive/10 border border-destructive/20 text-destructive break-words whitespace-pre-wrap">
                    <div className="flex items-start gap-2">
                      <span className="text-sm font-medium"> {error}</span>
                    </div>
                    <button
                      onClick={() => setError(null)}
                      className="mt-2 text-xs underline hover:no-underline"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}
              
              <div ref={messagesEndRef} />
            </div>

            {/* Plugin-Based Quick Actions - Only show when no messages and not creating/typing */}
            {messages.length === 0 && !isCreatingChannel && !isTyping && !isLoadingMessages && (
              <div className="pt-3 md:pt-4 border-t border-border">
                <div className="flex items-center gap-2 mb-2 md:mb-3">
                  {selectedPlugin && (
                    <button
                      onClick={() => setSelectedPlugin(null)}
                      className="flex items-center gap-1 text-[10px] md:text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ArrowLeft className="size-3" />
                      <span className="uppercase tracking-wider font-mono">Back</span>
                    </button>
                  )}
                  <p className="text-[10px] md:text-xs uppercase tracking-wider text-muted-foreground font-mono">
                    {selectedPlugin ? PLUGIN_ACTIONS[selectedPlugin].name : 'Quick Start'}
                  </p>
                </div>
                
                {/* Show plugins or plugin-specific prompts */}
                {!selectedPlugin ? (
                  // Plugin Grid
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 md:gap-3">
                    {(Object.keys(PLUGIN_ACTIONS) as Array<keyof typeof PLUGIN_ACTIONS>).map((pluginKey) => {
                      const plugin = PLUGIN_ACTIONS[pluginKey]
                      const Icon = plugin.icon
                      return (
                        <button
                          key={pluginKey}
                          onClick={() => setSelectedPlugin(pluginKey)}
                          className="flex flex-col gap-2 md:gap-3 p-3 md:p-4 bg-card/80 hover:bg-card rounded-lg md:rounded-xl border border-border/40 transition-all group hover:border-primary/40 text-left"
                        >
                          <div className="flex items-center gap-1.5 md:gap-2 text-[10px] md:text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                            <Icon className="size-3 md:size-3.5 text-primary shrink-0" strokeWidth={2} />
                            <span className="text-foreground">{plugin.name}</span>
                          </div>
                          <p className="text-[11px] md:text-sm text-muted-foreground/80 leading-snug md:leading-relaxed">{plugin.description}</p>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  // Plugin-specific prompts
                  <div className="flex flex-col gap-1.5 md:gap-2">
                    {PLUGIN_ACTIONS[selectedPlugin].prompts.map((prompt, index) => (
                      <button
                        key={index}
                        onClick={() => handlePromptClick(prompt)}
                        className="px-2.5 md:px-3 py-2 text-xs md:text-sm bg-accent hover:bg-accent/80 text-foreground rounded border border-border transition-colors text-left"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sticky Input Container */}
      <div className="sticky bottom-0 bg-background">
        <div className="border-t-2 border-muted bg-secondary min-h-12 p-1 relative">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Type your message..."
            disabled={isTyping || isCreatingChannel}
            className={cn(
              "flex-1 rounded-none border-none text-foreground placeholder-foreground/40 text-sm font-mono resize-none overflow-y-auto min-h-10 py-2.5",
              "focus-visible:outline-none focus-visible:ring-0"
            )}
            style={{ maxHeight: `${MAX_TEXTAREA_HEIGHT}px` }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                handleSubmit(e)
              }
              // Shift+Enter will insert a newline (default behavior)
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

        {/* ElizaOS Attribution Badge */}
        <div className="px-3 pb-4 pt-3 flex items-center gap-3">
          <img
            src="/assets/elizaos_badge.svg"
            alt="Powered by ElizaOS"
            className="h-10"
          />
          <div className="ml-auto text-[10px] text-muted-foreground text-right max-w-xs">
            Otaku is in beta. We recommend starting with smaller amounts for testing.
          </div>
        </div>
      </div>
    </div>


  )  
}
