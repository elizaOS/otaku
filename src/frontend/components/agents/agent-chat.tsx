"use client"

import type React from "react"
import { useState } from "react"
import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Loader2 } from "lucide-react"
import { cn } from "@/frontend/lib/utils"
import ArrowRightIcon from "@/frontend/components/icons/arrow-right"
import type { RebelRanking } from "@/frontend/types/dashboard"
import DashboardCard from "@/frontend/components/dashboard/card"

interface Message {
  id: string
  content: string
  isFromAgent: boolean
  timestamp: string
}

interface AgentChatProps {
  agent: RebelRanking
}

export default function AgentChat({ agent }: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      content: `HEY! I'M ${agent.name}. WHAT CAN I HELP YOU WITH TODAY?`,
      isFromAgent: true,
      timestamp: new Date().toISOString(),
    },
  ])
  const [inputValue, setInputValue] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!inputValue.trim() || isLoading) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      content: inputValue.trim().toUpperCase(),
      isFromAgent: false,
      timestamp: new Date().toISOString(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setIsLoading(true)

    // Simulate agent response
    setTimeout(() => {
      const agentMessage: Message = {
        id: `agent-${Date.now()}`,
        content: getAgentResponse(agent.name, inputValue),
        isFromAgent: true,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, agentMessage])
      setIsLoading(false)
    }, 1000 + Math.random() * 1000)
  }

  return (
    <DashboardCard title={`CHAT WITH ${agent.name.toUpperCase()}`} intent="default">
      <div className="flex flex-col" style={{ height: "calc(100vh - 24rem)" }}>
        {/* Messages */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn("flex flex-col gap-1", message.isFromAgent ? "items-start" : "items-end")}
            >
              <div
                className={cn(
                  "max-w-[70%] rounded-lg px-3 py-2 text-sm font-medium",
                  message.isFromAgent ? "bg-accent text-foreground" : "bg-primary text-primary-foreground"
                )}
              >
                {message.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex flex-col gap-1 items-start">
              <div className="max-w-[70%] rounded-lg px-3 py-2 bg-accent text-foreground">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t-2 border-muted bg-secondary h-12 p-1 relative">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={`MESSAGE ${agent.name.toUpperCase()}...`}
            disabled={isLoading}
            className="flex-1 rounded-none border-none text-foreground placeholder-foreground/40 text-sm"
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
            disabled={!inputValue.trim() || isLoading}
            className="absolute right-1.5 top-1.5 h-8 w-12 p-0"
          >
            {isLoading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightIcon className="w-4 h-4" />}
          </Button>
        </div>
      </div>
    </DashboardCard>
  )
}

// Helper function to generate agent responses based on agent name
function getAgentResponse(agentName: string, userMessage: string): string {
  const responses: Record<string, string[]> = {
    KRIMSON: [
      "LET ME HELP YOU WITH THAT! ",
      "THAT'S A GREAT QUESTION! HERE'S WHAT I THINK...",
      "I'VE GOT SOME IDEAS ABOUT THIS. LET'S BREAK IT DOWN.",
      "INTERESTING! I'VE BEEN WORKING ON SOMETHING SIMILAR.",
    ],
    MATI: [
      "HMM, THAT'S INTERESTING. LET ME THINK ABOUT IT...",
      "YEAH, I SEE WHAT YOU MEAN. HERE'S MY TAKE...",
      "GOOD POINT! I'VE GOT SOME THOUGHTS ON THIS.",
      "WAIT, SO YOU'RE SAYING... LET ME PROCESS THAT.",
    ],
    PEK: [
      "JUST SHIP IT! BUT SERIOUSLY, HERE'S WHAT I'D DO...",
      "QUICK ANSWER: YES. LONG ANSWER: IT DEPENDS.",
      "I'VE SEEN THIS BEFORE. HERE'S THE DEAL...",
      "LET'S KEEP IT SIMPLE. WHAT IF WE...",
    ],
    JOYBOY: [
      "YO! THAT'S A SOLID QUESTION. HERE'S MY PERSPECTIVE...",
      "I'M GLAD YOU ASKED! LET ME SHARE WHAT I KNOW...",
      "NICE! HERE'S WHAT I'VE LEARNED ABOUT THIS...",
      "GOOD VIBES! LET'S FIGURE THIS OUT TOGETHER.",
    ],
  }

  const agentResponses = responses[agentName] || [
    "THANKS FOR YOUR MESSAGE! I'M HERE TO HELP.",
    "INTERESTING QUESTION! LET ME THINK ABOUT THAT.",
    "I APPRECIATE YOU REACHING OUT. HERE'S MY TAKE...",
  ]

  return agentResponses[Math.floor(Math.random() * agentResponses.length)]
}
