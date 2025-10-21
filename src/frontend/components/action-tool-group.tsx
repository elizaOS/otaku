"use client"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { ChevronRight } from "lucide-react"
import { useState, useEffect } from "react"
import type { ReactNode } from "react"
import { motion } from "framer-motion"

export type ToolGroupProps = {
  children: ReactNode
  defaultOpen?: boolean
  className?: string
  label?: ReactNode
  animate?: boolean
}

export const AnimatedDots = () => {
  const [dotCount, setDotCount] = useState(1)
  
  useEffect(() => {
    const interval = setInterval(() => {
      setDotCount((prev) => (prev % 3) + 1)
    }, 500)
    
    return () => clearInterval(interval)
  }, [])
  
  return <span>{'.'.repeat(dotCount)}</span>
}

const ToolGroup = ({ 
  children, 
  defaultOpen = false, 
  className,
  label = "See working steps",
  animate = false
}: ToolGroupProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const Component = animate ? motion.div : 'div'
  const animationProps = animate ? {
    initial: { scaleY: 0, opacity: 0 },
    animate: { scaleY: 1, opacity: 1 },
    transition: { 
      duration: 0.3, 
      ease: "easeOut" as const,
      opacity: { duration: 0.2 }
    },
    style: { originY: 0.5 }
  } : {}

  return (
    <Component 
      className={cn("mt-3 border border-border rounded-lg", className)}
      {...animationProps}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors w-full p-3 cursor-pointer">
          <ChevronRight className={cn("h-4 w-4 transition-transform", isOpen && "rotate-90")} />
          <span>{label}</span>
        </CollapsibleTrigger>
        <CollapsibleContent
          className={cn(
            "data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden"
          )}
        >
          <div className="px-3 pb-3 space-y-2">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Component>
  )
}

export { ToolGroup }

