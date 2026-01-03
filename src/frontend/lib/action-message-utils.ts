import type { ToolPart } from "@/frontend/components/action-tool"

/**
 * Convert an agent action message to ToolPart format for display
 * This handles messages with type/sourceType 'agent_action' and parses their rawMessage
 */
const normalizeInput = (value: unknown): Record<string, unknown> | undefined => {
  if (value === null || value === undefined) return undefined
  if (Array.isArray(value)) {
    return { items: value }
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>
  }
  return { value }
}

export function convertActionMessageToToolPart(message: any): ToolPart {
  // rawMessage contains the action details from the server
  const rawMessage = message.rawMessage || message.metadata || {}

  // Map actionStatus to ToolPart state
  const mapActionStatusToState = (status: string): ToolPart["state"] => {
    switch (status) {
      case "pending":
      case "executing":
      case "running":
        return "input-streaming"
      case "completed":
      case "success":
        return "output-available"
      case "failed":
      case "error":
        return "output-error"
      default:
        return "input-available"
    }
  }

  // Get the primary action name (first action or fallback to message type)
  const actionName = rawMessage.actions?.[0] || rawMessage.action || "ACTION"
  const actionStatus = rawMessage.actionStatus || "completed"
  const actionId = rawMessage.actionId

  // Create input data from available action properties
  const inputSource =
    rawMessage?.actionResult?.input ??
    rawMessage?.actionInput ??
    rawMessage?.actionParams ??
    rawMessage?.input ??
    rawMessage?.params ??
    message.metadata?.actionParams

  const inputData: Record<string, unknown> = normalizeInput(inputSource) ?? {}

  // Create output data based on status and content
  const outputData: Record<string, unknown> = {}
  if (rawMessage.text || message.content) {
    outputData.text = rawMessage.text || message.content
  }
  if (actionStatus) outputData.status = actionStatus
  if (rawMessage.actionResult) outputData.result = rawMessage.actionResult

  // Handle error cases
  const isError = actionStatus === "failed" || actionStatus === "error"
  const errorText = isError ? rawMessage.text || message.content || "Action failed" : undefined

  return {
    type: actionName,
    state: mapActionStatusToState(actionStatus),
    toolCallId: actionId,
    input: Object.keys(inputData).length > 0 ? inputData : undefined,
    output: Object.keys(outputData).length > 0 ? outputData : undefined,
    errorText,
  }
}

/**
 * Check if a message is an agent action message
 */
export function isActionMessage(message: any): boolean {
  return (
    message.sourceType === "agent_action" ||
    message.metadata?.sourceType === "agent_action" ||
    message.type === "agent_action"
  )
}

