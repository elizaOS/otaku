/**
 * Template for multi-step action decision making.
 * Determines the next step the assistant should take in a conversation.
 */
export const multiStepDecisionTemplate = `<task>
Determine the next step the assistant should take in this conversation to help the user reach their goal.
</task>
{{system}}
---
{{time}}
---
{{recentMessages}}
---
# Current Execution Context
**Current Step**: {{iterationCount}} of {{maxIterations}} maximum iterations
**Actions Completed in THIS Execution Round**: {{traceActionResult.length}}
{{#if traceActionResult.length}}
 You have ALREADY taken {{traceActionResult.length}} action(s) in this execution round. Review them carefully before deciding next steps.
{{else}}
 This is your FIRST decision step - no actions have been taken yet in this round.
{{/if}}
---
# Decision Process (Follow in Order)
## 1. Understand Current State & Intent
- **Latest user message**: What is the user asking for RIGHT NOW? This is your primary objective.
- **User's goal**: Is the user seeking comprehensive information, or a specific single answer?
- **Consent for on-chain execution**: CRITICAL - Distinguish between questions and commands:
  * **QUESTIONS = NO EXECUTION**: "How do I...", "Can you...", "Should I...", "What if I...", "How about...", "Could you..." → ALWAYS provide guidance/plan and explicitly ask "Want me to execute this?" or "Ready for me to submit?" - NEVER execute based on a question
  * **DIRECT COMMANDS = MAY EXECUTE**: "Swap X to Y", "Bridge Z ETH", "Send A to B", "Transfer..." → May proceed after verifying balances
  * **AMBIGUOUS = TREAT AS QUESTION**: When unsure, default to guidance first and ask for confirmation before calling money-moving actions (EXECUTE_RELAY_BRIDGE, CDP_WALLET_SWAP, CDP_WALLET_TOKEN_TRANSFER, CDP_WALLET_NFT_TRANSFER, CDP_WALLET_FETCH_WITH_PAYMENT)
  * Example: "how do i turn all my weth to eth on main" → This is a QUESTION, provide the plan and ask for confirmation, DO NOT execute
- **Actions taken THIS round**: Review ***Actions Completed in This Round*** below. What have YOU already executed in THIS execution?
- **Completion check**: Has the user's request been ADEQUATELY fulfilled? Consider both breadth and depth of information provided.
- **Multiple approaches (DeFi queries)**: For complex DeFi data queries, consider 2-3 different tool combinations that could satisfy the intent, then select the optimal path based on data freshness, coverage, and the specific question asked. Example: token analysis could use (a) screener + flows, (b) price + trades + holders, or (c) PnL leaderboard + counterparties. Choose the path that best matches user intent.
## 2. Evaluate Redundancy vs Complementarity (CRITICAL)
**AVOID REDUNDANCY** (these are DUPLICATES - DO NOT repeat):
- ❌ Executing the SAME action with the SAME parameters you just executed
- ❌ Executing multiple swap actions for the same token pair
- ❌ Checking the same balance multiple times in a row
- ❌ Fetching the same price data twice
**ENCOURAGE COMPLEMENTARITY** (these are RELATED but ADD VALUE):
- ✅ Different actions that provide different perspectives (e.g., trending search + network-specific trends)
- ✅ Actions with different parameters that broaden insights (e.g., trending on Base + trending on Ethereum)
- ✅ Actions that gather prerequisites for a final action (e.g., get price → check balance → swap)
- ✅ Multiple related queries that together paint a fuller picture
**Decision Logic**:
- If you've executed an action, ask: "Would adding another related action provide NEW valuable insights?"
- If YES (complementary): Proceed with the related action
- If NO (redundant): Set \`isFinish: true\`
## 3. Identify Information Gaps
- Does the user's request require information you don't have?
- Have you already gathered this in a prior step of THIS round?
- Would executing related actions provide **additional context or insights** that better serve the user?
## 4. Choose Next Action
- Based on what you've ALREADY done in THIS round, what (if anything) would ADD VALUE?
- **For simple, specific requests** (e.g., "send 0.05 ETH", "what's the price of BTC"):
  * Execute the ONE action needed
  * Set \`isFinish: true\` after successful execution
- **For exploratory/broad requests** (e.g., "what's trending", "analyze this token"):
  * Consider executing MULTIPLE COMPLEMENTARY actions that provide richer, multi-dimensional insights
  * Only set \`isFinish: true\` when you've provided comprehensive information
- **For multi-step requests** (e.g., "get price then swap"):
  * Execute each step in sequence
  * Set \`isFinish: true\` only when ALL steps are complete
- Extract parameters from the **latest user message first**, then results from THIS round.
---
{{actionsWithParams}}
---
# Actions Completed in This Round
{{#if traceActionResult.length}}
You have executed the following actions in THIS multi-step execution round:
{{actionResults}}
 **IMPORTANT**: These are actions YOU took in this execution, not from earlier in the conversation.
- If the user's request has been ADEQUATELY satisfied, set \`isFinish: true\`
- Do NOT repeat the EXACT SAME action with the SAME parameters
- DO consider executing RELATED/COMPLEMENTARY actions that add different value
{{else}}
No actions have been executed yet in this round. This is your first decision step.
{{/if}}
---
# Decision Rules
1. **Step Awareness**: You are on step {{iterationCount}} of {{maxIterations}}. If step > 1, check what you've already done.
2. **Request Type Classification**:
   - **Specific/Transactional** (e.g., "send ETH", "swap tokens"): ONE action → set isFinish: true
   - **Exploratory/Analytical** (e.g., "what's trending", "analyze market"): MULTIPLE complementary actions encouraged → set isFinish when comprehensive
   - **Multi-step Sequential** (e.g., "check balance then swap"): Execute in order → set isFinish when all complete
3. **Redundancy Check**: Before executing ANY action, ask:
   - "Have I already done THIS EXACT action with THESE EXACT parameters?"
   - If YES → Skip and set isFinish: true
   - If NO but similar → Ask "Does this add NEW value?" If yes, proceed
4. **Complementary Actions**: When in doubt about whether to add another action:
   - If it provides a DIFFERENT data source or perspective: **DO IT**
   - If it provides the SAME data with different parameters that broaden scope: **DO IT**
   - If it's just repeating the same query: **DON'T**
5. **When to Finish**: Set isFinish: true when:
   - Specific requests: The ONE required action is completed successfully
   - Exploratory requests: You've gathered comprehensive, multi-faceted information
   - Multi-step requests: ALL steps are complete
   - You're about to repeat an identical action
6. **Ground in Evidence**: Parameters must come from the latest message, not assumptions
7. **Consent Before Transactions**: Before triggering any action that moves funds or spends balance (EXECUTE_RELAY_BRIDGE, CDP_WALLET_SWAP, CDP_WALLET_TOKEN_TRANSFER, CDP_WALLET_NFT_TRANSFER, CDP_WALLET_FETCH_WITH_PAYMENT):
   - **NEVER execute based on questions** - questions always mean guidance only
   - Question indicators: "how do I", "can you", "should I", "what if", "how about", "could you" → Provide plan + ask "Want me to execute?"
   - Direct command indicators: "swap", "bridge", "send", "transfer" (without question words) → May execute after balance verification
   - **When uncertain about intent, default to guidance and ask for confirmation** - better to confirm twice than execute unwanted transactions
8. **Preserve Gas Buffers**: When swapping or transferring the native gas token on any chain (e.g., ETH on Ethereum, POL/MATIC on Polygon, AVAX on Avalanche), never drain the entire balance. Leave a reasonable buffer (at least the estimated gas for two transactions) so the wallet can still pay for future fees. If the user asks to swap the full balance, warn them and suggest a slightly smaller amount that preserves gas.
---
<keys>
"thought" 
START WITH: "Step {{iterationCount}}/{{maxIterations}}. Actions taken this round: {{traceActionResult.length}}."
THEN: Quote the latest user request.
THEN: Classify request type (Specific/Exploratory/Multi-step).
THEN: If actions > 0, state "I have already completed: [list actions with brief result summary]. Evaluating if more complementary actions would add value."
THEN: For DeFi data queries, briefly outline 2-3 possible approaches (e.g., "Could use: (a) screener + flows for market view, (b) price + trades for activity, or (c) PnL + holders for trader insight. Selecting [chosen approach] because [reason].")
THEN: Explain your decision:
  - If finishing: "The request is adequately fulfilled with [breadth/depth] of information. Setting isFinish: true."
  - If continuing: "Next action: [action name] because [how it complements prior actions or provides new perspective]."
"action" Name of the action to execute (empty string "" if setting isFinish: true or if no action needed)
"parameters" JSON object with exact parameter names. Empty object {} if action has no parameters.
"isFinish" Set to true when the user's request is adequately satisfied (see Decision Rules)
</keys>
 CRITICAL CHECKS:
- What step am I on? ({{iterationCount}}/{{maxIterations}})
- How many actions have I taken THIS round? ({{traceActionResult.length}})
- What TYPE of request is this? (Specific/Exploratory/Multi-step)
- If > 0 actions: Have I adequately addressed the request?
- Am I about to execute the EXACT SAME action with EXACT SAME parameters?  If YES, STOP
- If executing a related but different action: Does it add NEW value/insights?  If YES, PROCEED
# IMPORTANT
YOUR FINAL OUTPUT MUST BE IN THIS XML FORMAT:
<output>
<response>
  <thought>Step {{iterationCount}}/{{maxIterations}}. Actions taken this round: {{traceActionResult.length}}. [Your reasoning]</thought>
  <action>ACTION_NAME or ""</action>
  <parameters>
    {
      "param1": "value1",
      "param2": value2
    }
  </parameters>
  <isFinish>true | false</isFinish>
</response>
</output>`;


export const multiStepSummaryTemplate = `<task>
Generate a final, user-facing response based on what the assistant accomplished and the results obtained.
</task>

{{bio}}

---

{{system}}

---

{{messageDirections}}

---

{{time}}

---

{{recentMessages}}

---

{{actionResults}}

**These are the steps taken and their results. Use successful results to answer the user; acknowledge failures if relevant.**

---

{{actionsWithDescriptions}}

---

# Assistant's Last Reasoning Step
{{recentThought}}

---

# Instructions

1. **Review the latest user message**: What did they originally ask for?
2. **Check execution results**: What data/outcomes did the actions produce? Focus on successful results.
3. **Synthesize answer**: Provide a clear, direct response using the information gathered. If results are insufficient or actions failed, explain what happened and suggest next steps.
4. **Be concise and helpful**: Users want answers, not a list of what you did. Lead with the result, not the process.

**Tone**: Professional, direct, and focused on delivering value. Avoid overly technical jargon unless the user expects it.

# IMPORTANT
YOUR FINAL OUTPUT MUST BE IN THIS XML FORMAT:

<output>
<response>
  <thought>Briefly summarize the user's request and the key results obtained. Note any gaps or issues.</thought>
  <text>Your direct, helpful answer to the user based on the results. Lead with the information they asked for.</text>
</response>
</output>
`;

