# Using Otaku with x402 Payments

**Otaku** is an AI-powered research and information processing platform accessible at **[otaku.so](https://otaku.so)**. Access to the API requires payment via the x402 protocol using USDC on Base network.

## What is x402?

x402 is a payment protocol that enables automated micropayments for API access. When you make a request to a paid endpoint, your wallet automatically sends USDC to pay for the service, and you receive the AI-generated response.

## Quick Start

### Prerequisites

1. **Wallet with USDC on Base Mainnet**
   - USDC Contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
   - Get USDC on Base: [bridge.base.org](https://bridge.base.org)

2. **Wallet Private Key**
   - You'll need your private key to sign payment transactions
   - Keep this secure and never share it

3. **Install Dependencies**
   ```bash
   npm install x402-fetch viem
   # or
   bun add x402-fetch viem
   ```

## API Endpoints

### Base URL
```
https://otaku.so
```

### Jobs API (Paid Endpoint)

**POST** `/api/messaging/jobs`

**Configuration:**
- **Price:** $0.015 USDC per request  
- **Network:** Base Mainnet  
- **Payment Method:** x402 automatic payment
- **Default Timeout:** 3 minutes (180 seconds)
- **Maximum Timeout:** 5 minutes (300 seconds)

## Making Your First Request

### Using x402-fetch (Recommended)

```typescript
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment } from 'x402-fetch';

// Setup your wallet
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const walletClient = createWalletClient({
  account,
  chain: base,
  transport: http(),
});

// Set maximum payment you're willing to make (in USDC base units)
const maxPayment = BigInt(20_000); // 0.02 USDC (includes buffer)

// Wrap fetch with payment capability
const fetchWithPayment = wrapFetchWithPayment(
  fetch,
  walletClient,
  maxPayment
);

// Make a paid request
const response = await fetchWithPayment('https://otaku.so/api/messaging/jobs', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt: 'Research the latest developments in AI and summarize the top 3 trends.'
  }),
});

const job = await response.json();
console.log('Job created:', job.jobId);
```

## Request Format

### Request Body

```typescript
{
  prompt: string;        // Required: Your query or research request
  agentId?: string;      // Optional: Specific agent UUID (uses first available if not provided)
  timeoutMs?: number;    // Optional: Timeout in milliseconds (default: 180000, max: 300000)
  metadata?: object;     // Optional: Custom metadata to attach to the job
}
```

### Example Requests

**Research Query:**
```json
{
  "prompt": "What are the latest advancements in quantum computing?"
}
```

**News Summarization:**
```json
{
  "prompt": "Summarize today's top tech news from major sources."
}
```

**Data Analysis:**
```json
{
  "prompt": "Analyze the trend in Bitcoin prices over the last month."
}
```

## Response Format

### Success Response (201 Created)

```json
{
  "jobId": "9153b4d5-a8f1-4c2e-9b3a-1234567890ab",
  "status": "pending",
  "createdAt": 1698765432000,
  "expiresAt": 1698765762000
}
```

### Job Status Values

- `pending` - Job is queued and waiting to be processed
- `processing` - Job is currently being processed by the agent
- `completed` - Job finished successfully, result available
- `failed` - Job failed with an error
- `timeout` - Job exceeded the timeout limit

## Polling for Results

After creating a job, poll the status endpoint to get results:

```typescript
async function pollForCompletion(jobId: string): Promise<void> {
  const maxAttempts = 100;  // Support 3-minute job timeout
  const pollInterval = 2000; // 2 seconds
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));
    
    const response = await fetch(`https://otaku.so/api/messaging/jobs/${jobId}`);
    const job = await response.json();
    
    console.log(`[${i + 1}] Status: ${job.status}`);
    
    if (job.status === 'completed') {
      console.log('Result:', job.result.message.content);
      return;
    } else if (job.status === 'failed' || job.status === 'timeout') {
      console.error('Job failed:', job.error || 'Timeout');
      return;
    }
  }
  
  console.log('Polling timeout - job may still be processing');
}
```

### Job Details Response

```json
{
  "jobId": "9153b4d5-a8f1-4c2e-9b3a-1234567890ab",
  "status": "completed",
  "agentId": "agent-uuid-here",
  "userId": "user-uuid-here",
  "prompt": "Research the latest developments in AI...",
  "createdAt": 1698765432000,
  "expiresAt": 1698765762000,
  "result": {
    "message": {
      "id": "msg-uuid-here",
      "content": "Based on recent research, the top 3 AI trends are...",
      "authorId": "agent-uuid-here",
      "createdAt": 1698765450000
    },
    "processingTimeMs": 18000
  }
}
```

## Payment Details

### How Payment Works

1. You make a request to the paid endpoint
2. Server responds with `402 Payment Required` and payment details
3. x402-fetch automatically:
   - Signs a USDC payment transaction from your wallet
   - Submits the transaction to Base network
   - Retries the request with proof of payment
4. Server validates payment and processes your request
5. You receive the response with a payment receipt

### Payment Confirmation

Check the `x-payment-response` header in the response:

```typescript
const paymentHeader = response.headers.get('x-payment-response');
if (paymentHeader) {
  const paymentInfo = JSON.parse(
    Buffer.from(paymentHeader, 'base64').toString('utf-8')
  );
  
  console.log('Transaction:', paymentInfo.transaction);
  console.log('Payer:', paymentInfo.payer);
  console.log('Network:', paymentInfo.network);
  console.log('View on BaseScan:', 
    `https://basescan.org/tx/${paymentInfo.transaction}`);
}
```

## Entity ID & User Identity

**Your wallet address determines your entity ID.** 

When you make a paid request, Otaku automatically:
- Extracts your wallet address from the payment
- Creates a deterministic user ID: `stringToUuid(walletAddress.toLowerCase())`
- **Same wallet = same user ID** across all requests

This means:
- ✅ No need to provide a `userId` in requests
- ✅ Your conversations and history persist across requests
- ✅ The AI remembers your context from previous interactions

## Checking Job Status

### ⚠️ Job Listing Disabled

**GET** `/api/messaging/jobs` returns `402 Payment Required`

Job listing is intentionally disabled to prevent free access. After creating a paid job, use the specific job ID to check its status.

```typescript
// ❌ This endpoint is disabled
const response = await fetch('https://otaku.so/api/messaging/jobs?limit=10');
// Returns: 402 Payment Required
```

### Get Job Details

**GET** `/api/messaging/jobs/{jobId}`

```typescript
const response = await fetch(`https://otaku.so/api/messaging/jobs/${jobId}`);
const job = await response.json();
console.log(job);
```

### Health Check

**GET** `/api/messaging/jobs/health`

```typescript
const response = await fetch('https://otaku.so/api/messaging/jobs/health');
const health = await response.json();

console.log('Healthy:', health.healthy);
console.log('Total jobs:', health.totalJobs);
console.log('Status counts:', health.statusCounts);
```

## Error Handling

### 402 Payment Required

If you get a 402 error, it means payment failed. Check:
- ✅ Sufficient USDC balance on Base
- ✅ Correct network (Base mainnet, not testnet)
- ✅ Valid private key
- ✅ Using x402-fetch (not x402-axios)

```typescript
if (response.status === 402) {
  const error = await response.json();
  console.error('Payment required:', error);
  console.log('Payment amount:', error.accepts[0].maxAmountRequired / 1_000_000, 'USDC'); // Should be 0.015
  console.log('Recipient:', error.accepts[0].payTo);
}
```

### 400 Bad Request

```json
{
  "success": false,
  "error": "Invalid request. Required fields: prompt"
}
```

### 404 Not Found

```json
{
  "success": false,
  "error": "No agents available on server"
}
```

## Complete Example

```typescript
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment } from 'x402-fetch';

async function askOtaku(prompt: string): Promise<string> {
  // Setup wallet
  const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(),
  });

  // Wrap fetch with payment
  const maxPayment = BigInt(20_000); // 0.02 USDC
  const fetchWithPayment = wrapFetchWithPayment(fetch, walletClient, maxPayment);

  // Create job
  console.log('Creating job...');
  const response = await fetchWithPayment('https://otaku.so/api/messaging/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });

  const job = await response.json();
  console.log(`Job created: ${job.jobId}`);

  // Poll for result
  console.log('Waiting for response...');
  for (let i = 0; i < 100; i++) {  // Support 3-minute job timeout
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const statusRes = await fetch(`https://otaku.so/api/messaging/jobs/${job.jobId}`);
    const jobData = await statusRes.json();
    
    if (jobData.status === 'completed') {
      return jobData.result.message.content;
    } else if (jobData.status === 'failed' || jobData.status === 'timeout') {
      throw new Error(jobData.error || 'Job failed');
    }
  }
  
  throw new Error('Timeout waiting for result');
}

// Usage
askOtaku('What are the top 3 AI trends in 2024?')
  .then(result => console.log('Answer:', result))
  .catch(error => console.error('Error:', error));
```

## Capabilities

Otaku can help you with:

- 🔍 **Research**: Query and analyze research data, papers, and academic resources
- 📰 **News**: Fetch and summarize current news articles from various sources  
- 💡 **Information Processing**: Synthesize information from multiple sources
- 📊 **Data Analysis**: Analyze trends, patterns, and insights from data
- 🧠 **Deep Research**: Perform comprehensive research on complex topics

## Rate Limits & Pricing

- **Price per request:** $0.015 USDC
- **Network:** Base Mainnet
- **Payment asset:** USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)
- **Max jobs:** 10,000 concurrent jobs
- **Job timeout:** 3 minutes default (180 seconds), 5 minutes max (300 seconds)
- **Job expiry:** Jobs expire after completion or timeout
- **Polling recommendation:** Poll every 2 seconds for up to 100 attempts (200 seconds)

## Important Notes

### ⚠️ Use x402-fetch, NOT x402-axios

**x402-axios is broken and will not work.** Always use `x402-fetch` with `wrapFetchWithPayment`.

```typescript
// ✅ CORRECT - Use this
import { wrapFetchWithPayment } from 'x402-fetch';

// ❌ WRONG - Don't use this
import { withPaymentInterceptor } from 'x402-axios'; // Broken!
```

### 💰 Check Your USDC Balance

Before making requests, ensure you have USDC on Base:

```typescript
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
];

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

const balance = await publicClient.readContract({
  address: USDC_ADDRESS,
  abi: ERC20_ABI,
  functionName: 'balanceOf',
  args: [walletAddress],
});

console.log('USDC Balance:', Number(balance) / 1_000_000);
```

## Support & Resources

- **Website:** [otaku.so](https://otaku.so)
- **x402 Protocol:** [x402 Documentation](https://x402.gitbook.io/x402)
- **Base Network:** [base.org](https://base.org)
- **Bridge USDC:** [bridge.base.org](https://bridge.base.org)
- **BaseScan:** [basescan.org](https://basescan.org)

## Troubleshooting

### Payment Failed (Still Getting 402)

1. **Check USDC balance on Base mainnet**
   ```bash
   # Must have at least 0.015 USDC + gas
   ```

2. **Verify you're using x402-fetch**
   ```typescript
   // Correct implementation
   import { wrapFetchWithPayment } from 'x402-fetch';
   ```

3. **Check network**
   ```typescript
   // Must be Base mainnet, not testnet
   import { base } from 'viem/chains';
   ```

4. **Validate private key format**
   ```typescript
   // Must start with 0x
   const key = '0x...' as `0x${string}`;
   ```

### Job Stays in "processing" Status

- Wait longer (complex jobs can take up to 3 minutes)
- Poll every 2 seconds for up to 100 attempts
- Check server health: `GET /api/messaging/jobs/health`
- Verify agents are available on the server
- Jobs timeout after 3 minutes by default (configurable up to 5 minutes)

### Job Failed with Error

Check the error message in the job response:
```typescript
if (job.status === 'failed') {
  console.error('Error:', job.error);
}
```

---

**Ready to start?** Get USDC on Base and start making requests to [otaku.so](https://otaku.so)! 🚀

