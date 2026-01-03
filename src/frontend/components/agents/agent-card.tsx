// Image component removed - using img tag instead
import type { RebelRanking } from "@/frontend/types/dashboard"
import { Badge } from "@/frontend/components/ui/badge"
import { cn } from "@/frontend/lib/utils"

interface AgentCardProps {
  agent: RebelRanking
  onSelect: (agentId: number) => void
  isSelected?: boolean
}

export default function AgentCard({ agent, onSelect, isSelected }: AgentCardProps) {
  return (
    <div
      onClick={() => onSelect(agent.id)}
      className={cn(
        "group flex items-center gap-1 cursor-pointer",
        isSelected && "bg-accent rounded"
      )}
    >
      <div className="relative">
        <div
          className={cn(
            "rounded-lg overflow-hidden bg-muted",
            agent.featured ? "size-14 md:size-16" : "size-10 md:size-12"
          )}
        >
          {agent.avatar ? (
            <img
              src={agent.avatar}
              alt={agent.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-muted" />
          )}
        </div>
        {agent.featured && (
          <div className="absolute -top-2 -left-2 bg-primary text-primary-foreground text-xs size-5 rounded flex items-center justify-center font-semibold border-2 border-background">
            
          </div>
        )}
      </div>

      <div
        className={cn(
          "flex flex-1 h-full items-center justify-between py-2 px-2.5 rounded group-hover:bg-accent",
          agent.featured && isSelected && "bg-accent"
        )}
      >
        <div className="flex flex-col flex-1">
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span
                className={cn(
                  "font-display",
                  agent.featured ? "text-xl md:text-2xl" : "text-lg md:text-xl"
                )}
              >
                {agent.name}
              </span>
              <span className="text-muted-foreground text-xs md:text-sm">{agent.handle}</span>
            </div>
            <Badge variant={agent.featured ? "default" : "secondary"}>
              {agent.points} POINTS
            </Badge>
          </div>
        </div>
      </div>
    </div>
  )
}
