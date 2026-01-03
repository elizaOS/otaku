"use client"

import { useState } from "react"
import type { RebelRanking } from "@/frontend/types/dashboard"
import AgentCard from "./agent-card"
import AgentChat from "./agent-chat"
import DashboardCard from "@/frontend/components/dashboard/card"

interface AgentsInterfaceProps {
  agents: RebelRanking[]
}

export default function AgentsInterface({ agents }: AgentsInterfaceProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null)
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Agents List */}
      <DashboardCard title="AVAILABLE AGENTS" intent="default">
        <div className="space-y-4">
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onSelect={setSelectedAgentId}
              isSelected={selectedAgentId === agent.id}
            />
          ))}
        </div>
      </DashboardCard>

      {/* Chat Area */}
      {selectedAgent ? (
        <AgentChat agent={selectedAgent} />
      ) : (
        <DashboardCard title="AGENT CHAT" intent="default">
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="size-16 rounded-full bg-muted flex items-center justify-center mb-4">
              <span className="text-3xl"></span>
            </div>
            <div>
              <h3 className="text-xl font-display mb-2">SELECT AN AGENT</h3>
              <p className="text-sm text-muted-foreground max-w-md uppercase">
                Choose an agent from the list to start a conversation
              </p>
            </div>
          </div>
        </DashboardCard>
      )}
    </div>
  )
}
