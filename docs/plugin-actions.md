# Plugin Actions: The Tool Call System

**Core Concept**: Plugin actions in ElizaOS work like tool calls in other LLM frameworks (OpenAI function calling, Anthropic tool use). The LLM selects which action to invoke and generates parameters as structured data.

## How Actions Work

### 1. Action Definition

Actions are TypeScript objects implementing the `Action` interface from `@elizaos/core`:

**Required Properties**:
- `name` - Unique identifier (like tool name)
- `description` - What the action does (shown to LLM)
- `parameters` - Schema with type, description, required flags
- `validate` - Function checking if action is available
- `handler` - Function executing the action logic

**Optional Properties**:
- `similes` - Alternative names LLM can use
- `suppressInitialMessage` - Skip "thinking" message

**See examples**: `src/plugins/plugin-cdp/src/actions/cdp-wallet-swap.ts`, `src/plugins/plugin-web-search/src/actions/webSearch.ts`

### 2. Action Registration

**Plugin Level** - Actions bundled into plugins:
```
Plugin exports: { actions: [action1, action2, ...] }
```
See: `src/plugins/plugin-cdp/src/index.ts`

**Root Level** - Plugins registered in project:
```
projectAgent.plugins = [sqlPlugin, bootstrapPlugin, cdpPlugin, ...]
```
See: `src/index.ts`

### 3. How LLM Invokes Actions

The `bootstrap` plugin's multi-step template presents available actions with parameter schemas to the LLM.

**LLM Output Format** (XML):
```xml
<output>
<response>
  <thought>Reasoning about what to do</thought>
  <action>ACTION_NAME</action>
  <parameters>{"param1": "value1", "param2": 123}</parameters>
  <isFinish>false</isFinish>
</response>
</output>
```

### 4. Parameter Flow

```
┌─────────────────────────────────────────┐
│ 1. LLM generates XML with parameters    │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ 2. Bootstrap parses & stores in state   │
│    state.data.actionParams = {...}      │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ 3. Runtime calls action handler         │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ 4. Handler retrieves from state         │
│    const params = state?.data?.actionParams │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ 5. Handler validates parameters         │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│ 6. Handler executes & returns result    │
│    { text, success, error?, values? }   │
└─────────────────────────────────────────┘
```

**Implementation**: See `src/plugins/plugin-bootstrap/src/index.ts` (lines 551-583 for parsing, 608-619 for result tracking)

### 5. Parameter Validation Stages

**Stage 1: Service Availability** (`validate` function)
- Checks required services are initialized
- Returns boolean (false = action unavailable)

**Stage 2: Required Parameter Check** (handler start)
- Verifies required params exist
- Early return with error if missing

**Stage 3: Type & Enum Validation**
- Validates types (string, number, boolean)
- Checks enum values (e.g., network in supported list)

**Stage 4: Business Logic Validation**
- Token address validation (via CoinGecko)
- Balance checks
- Network compatibility
- Address format validation

**Return Type**: `ActionResult` with `{ text, success, error?, values? }`

### 6. Parameter Schema Format

```
parameters: {
  paramName: {
    type: "string" | "number" | "boolean",
    description: "What this param does (shown to LLM)",
    required: true | false,
  },
  // ... more params
}
```

**Types Supported**: `string`, `number`, `boolean`

## Multi-Step Execution

The bootstrap plugin orchestrates iterative action execution for complex requests.

### How It Works

1. **User Request**: "Swap 10 ETH to USDC, then bridge 5000 USDC to Arbitrum"

2. **Iteration Loop** (max 6 iterations):
   - **Iteration 1**: Execute `USER_WALLET_SWAP`, store result
   - **Iteration 2**: Execute `EXECUTE_RELAY_BRIDGE`, store result
   - **Iteration 3**: LLM sets `isFinish: true`

3. **Summary Generation**: LLM generates final response from all results

### Key Features

- **State Accumulation**: Each result available to next iteration
- **Redundancy Prevention**: LLM sees previous actions to avoid duplicates
- **Complementary Actions**: Chain actions that build on each other
- **Early Exit**: LLM controls when request is complete

**Implementation**: `src/plugins/plugin-bootstrap/src/index.ts` (function `runMultiStepCore`, lines 434-744)

**Template**: `src/plugins/plugin-bootstrap/src/templates/multi-step.ts`

## Action Result Format

Every action handler returns `ActionResult`:

```
{
  text: string,          // User-facing message
  success: boolean,      // Execution status
  error?: string,        // Error code if failed
  values?: object,       // Structured output data
  input?: object,        // Captured input params (for debugging)
}
```

**Callback**: Optional streaming callback for real-time updates

## Key Takeaways

- **Actions = Tool Calls** (same concept, different terminology)
- **Parameters** defined in schema, generated by LLM as JSON
- **Flow**: LLM XML → Parse → State → Handler → Validate → Execute
- **Validation**: Multiple stages (service, required, types, business logic)
- **Composable**: Actions chain together in multi-step execution
- **State-Based**: Parameters flow through state, not method signatures

## Reference Files

- Action examples: `src/plugins/plugin-cdp/src/actions/`
- Bootstrap orchestration: `src/plugins/plugin-bootstrap/src/index.ts`
- Multi-step template: `src/plugins/plugin-bootstrap/src/templates/multi-step.ts`
- Action interface: `@elizaos/core` package
