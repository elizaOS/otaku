import type { Memory, State } from "@elizaos/core";

/**
 * Plugin keyword patterns for context-aware activation
 */
export interface PluginKeywordPatterns {
    /**
     * Keywords that trigger plugin activation (case-insensitive)
     * Example: ["swap", "trade", "exchange"]
     */
    keywords?: string[];

    /**
     * Regex patterns for more complex matching
     * Example: [/swap.*(?:eth|usdc)/i, /bridge.*to.*arbitrum/i]
     */
    regexPatterns?: RegExp[];
}

interface ConversationContextEntry {
    text: string;
    fingerprint: string;
}

const contextCache = new WeakMap<State, Map<number, ConversationContextEntry>>();

/**
 * Checks if a plugin should be active based on recent conversation context
 *
 * @param state - ElizaOS runtime state containing conversation memory
 * @param patterns - Keyword and regex patterns to match against
 * @param recentMessageCount - Number of recent messages to check (default: 5)
 * @returns true if plugin is relevant to recent conversation, false otherwise
 *
 * @example
 * ```ts
 * const cdpPatterns: PluginKeywordPatterns = {
 *   keywords: ["swap", "trade", "wallet", "balance", "transfer"],
 *   regexPatterns: [/send.*(?:eth|usdc|dai)/i]
 * };
 *
 * export function shouldCdpPluginBeInContext(state: State): boolean {
 *   return matchesPluginContext(state, cdpPatterns);
 * }
 * ```
 */
function getConversationFingerprint(state: State): string {
    const messages = Array.isArray(state.recentMessagesData)
        ? state.recentMessagesData
        : [];
    const length = messages.length;
    if (length === 0) {
        return "0";
    }
    const lastMessage = messages[length - 1];
    const identifier =
        (lastMessage?.id as string | undefined) ??
        (typeof lastMessage?.createdAt === "number"
            ? lastMessage.createdAt.toString()
            : "");
    return `${length}:${identifier}`;
}

function getConversationText(state: State, recentMessageCount: number = 5): string {
    const fingerprint = getConversationFingerprint(state);
    let stateCache = contextCache.get(state);

    if (!stateCache) {
        stateCache = new Map<number, ConversationContextEntry>();
        contextCache.set(state, stateCache);
    }

    const cachedEntry = stateCache.get(recentMessageCount);
    if (cachedEntry && cachedEntry.fingerprint === fingerprint) {
        return cachedEntry.text;
    }

    const recentMessages = state.recentMessagesData?.slice(-recentMessageCount) || [];
    const text = recentMessages
        .map((msg: Memory) => msg.content?.text || "")
        .join(" ")
        .toLowerCase();

    stateCache.set(recentMessageCount, { text, fingerprint });
    return text;
}

export function matchesPluginContext(
    state: State,
    patterns: PluginKeywordPatterns,
    message?: Memory,
    recentMessageCount: number = 5
): boolean {
    // If no patterns defined, plugin is always active
    if (!patterns.keywords?.length && !patterns.regexPatterns?.length) {
        return true;
    }

    // Get conversation text (cached - only extracted once per state)
    let conversationText = getConversationText(state, recentMessageCount);

    // If current message is provided, append it to context if not already present
    // This ensures we catch keywords in the immediate user request
    if (message?.content?.text) {
        const recentMessages = state.recentMessagesData || [];
        const lastMsg = recentMessages[recentMessages.length - 1];
        const isAlreadyIncluded = lastMsg && lastMsg.id === message.id;
        
        if (!isAlreadyIncluded) {
            conversationText += " " + message.content.text.toLowerCase();
        }
    }

    // Check keywords (case-insensitive)
    if (patterns.keywords?.length) {
        const hasKeyword = patterns.keywords.some((keyword) =>
            conversationText.includes(keyword.toLowerCase())
        );
        if (hasKeyword) return true;
    }

    // Check regex patterns
    if (patterns.regexPatterns?.length) {
        const matchesRegex = patterns.regexPatterns.some((pattern) =>
            pattern.test(conversationText)
        );
        if (matchesRegex) return true;
    }

    return false;
}
