/**
 * Test script for x402 payment integration with Jobs API (Base Mainnet)
 * 
 * This script demonstrates how to:
 * 1. Test the 402 Payment Required response
 * 2. Make a paid request using x402-fetch (working implementation)
 * 3. Poll for job completion
 * 4. Retrieve job results
 * 
 * Prerequisites:
 * - Server running with X402_RECEIVING_WALLET configured
 * - For Test 2 (paid requests):
 *   - Wallet with USDC on Base mainnet (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
 *   - EVM_PRIVATE_KEY, TEST_WALLET_PRIVATE_KEY, or CDP_API_KEY_PRIVATE_KEY environment variable
 * 
 * IMPORTANT NOTES:
 * - This script uses x402-fetch, NOT x402-axios
 * - x402-axios does NOT work (withPaymentInterceptor fails to send X-PAYMENT header)
 * - x402-fetch is the proven working implementation (used in plugin-cdp)
 * - This tests BASE MAINNET payments - you need real USDC on Base
 * - For testing without real funds, skip Test 2 by not setting a private key
 * 
 * Usage:
 *   bun run scripts/test-x402-jobs.ts
 *   bun run scripts/test-x402-jobs.ts --prompt "What is the weather today?"
 */

import { createWalletClient, createPublicClient, http, type Address } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { wrapFetchWithPayment, decodeXPaymentResponse } from 'x402-fetch';

// Configuration
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const JOBS_ENDPOINT = `${API_BASE_URL}/api/messaging/jobs`;
const PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || process.env.TEST_WALLET_PRIVATE_KEY || process.env.CDP_API_KEY_PRIVATE_KEY;
const MAX_PAYMENT_USDC = 0.02; // $0.02 per request
const POLL_INTERVAL_MS = 2000; // Poll every 2 seconds
const MAX_POLL_ATTEMPTS = 30; // Max 60 seconds of polling

// Parse command-line arguments
function parseArgs(): { prompt?: string } {
  const args = process.argv.slice(2);
  const result: { prompt?: string } = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' && i + 1 < args.length) {
      result.prompt = args[i + 1];
      i++; // Skip next arg as it's the value
    }
  }
  
  return result;
}

const CLI_ARGS = parseArgs();
const DEFAULT_PROMPT = 'What are the key advantages of Base L2 over Ethereum mainnet, and what are the current top DeFi protocols on Base?';

// Base mainnet USDC contract
const USDC_CONTRACT_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;

// ERC20 ABI for balanceOf
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
] as const;

interface JobResponse {
  jobId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'timeout';
  createdAt: number;
  expiresAt: number;
}

interface JobDetailsResponse extends JobResponse {
  agentId: string;
  userId: string;
  prompt: string;
  result?: {
    message: {
      id: string;
      content: string;
      authorId: string;
      createdAt: number;
      metadata?: Record<string, unknown>;
    };
    processingTimeMs: number;
  };
  error?: string;
  metadata?: Record<string, unknown>;
}

interface X402ErrorResponse {
  x402Version: number;
  error: string;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    payTo: Address;
    maxTimeoutSeconds: number;
    asset: Address;
    outputSchema?: Record<string, unknown>;
    extra?: Record<string, unknown>;
  }>;
}

/**
 * Check USDC balance on Base mainnet
 */
async function checkUSDCBalance(walletAddress: Address): Promise<number> {
  try {
    const publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });

    const balance = await publicClient.readContract({
      address: USDC_CONTRACT_BASE,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletAddress],
    });

    // USDC has 6 decimals
    return Number(balance) / 1_000_000;
  } catch (error) {
    console.error('Failed to fetch USDC balance:', error instanceof Error ? error.message : String(error));
    return 0;
  }
}

/**
 * Test 1: Verify 402 Payment Required response
 */
async function testPaymentRequired(): Promise<void> {
  console.log('\n🧪 Test 1: Verifying 402 Payment Required response...\n');

  try {
    const response = await fetch(JOBS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Test query without payment',
      }),
    });

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (response.status === 402) {
      const paymentInfo: X402ErrorResponse = await response.json();
      console.log('✅ Correctly received 402 Payment Required\n');
      console.log('Payment Details:');
      console.log(`  Version: x402 v${paymentInfo.x402Version}`);
      console.log(`  Error: ${paymentInfo.error}`);
      
      if (paymentInfo.accepts && paymentInfo.accepts.length > 0) {
        const accept = paymentInfo.accepts[0];
        console.log(`  Network: ${accept.network}`);
        console.log(`  Scheme: ${accept.scheme}`);
        console.log(`  Amount: ${parseInt(accept.maxAmountRequired) / 1_000_000} USDC`);
        console.log(`  Recipient: ${accept.payTo}`);
        console.log(`  Asset: ${accept.asset} (USDC)`);
        console.log(`  Timeout: ${accept.maxTimeoutSeconds}s`);
        console.log(`  Description: ${accept.description.substring(0, 100)}...`);
      }
      
      return;
    } else {
      console.log('⚠️  Expected 402, got:', response.status);
      console.log('Response:', await response.text());
    }
  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Test 2: Make a paid request and wait for completion
 */
async function testPaidRequest(prompt: string): Promise<void> {
  console.log('\n🧪 Test 2: Making paid request with x402...\n');

  if (!PRIVATE_KEY) {
    console.log('⚠️  Skipping paid request test - no private key provided');
    console.log('   Set EVM_PRIVATE_KEY, TEST_WALLET_PRIVATE_KEY, or CDP_API_KEY_PRIVATE_KEY environment variable');
    return;
  }

  try {
    // Setup wallet client for Base mainnet
    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport: http(),
    });

    console.log(`Payer wallet: ${account.address}`);
    console.log(`Max payment: ${MAX_PAYMENT_USDC} USDC`);
    
    // Check payer's USDC balance
    console.log('\n💰 Checking payer USDC balance on Base mainnet...');
    const payerBalanceBefore = await checkUSDCBalance(account.address);
    console.log(`Payer balance: ${payerBalanceBefore.toFixed(6)} USDC`);
    
    if (payerBalanceBefore < MAX_PAYMENT_USDC) {
      console.log(`\n⚠️  Insufficient USDC balance for payment`);
      console.log(`   Required: ${MAX_PAYMENT_USDC} USDC`);
      console.log(`   Available: ${payerBalanceBefore.toFixed(6)} USDC`);
      console.log(`\n💡 To fund your wallet:`);
      console.log(`   1. Bridge USDC to Base mainnet using https://bridge.base.org`);
      console.log(`   2. Or swap for USDC on Base using a DEX`);
      console.log(`   3. USDC Contract: ${USDC_CONTRACT_BASE}`);
      console.log('\n   Skipping paid request test...\n');
      return;
    }
    
    console.log(`✅ Sufficient balance for payment\n`);

    // Get receiving wallet address from the 402 response
    const testResponse = await fetch(JOBS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' }),
    });
    
    let receivingWallet: Address | null = null;
    let receiverBalanceBefore = 0;
    
    if (testResponse.status === 402) {
      const paymentInfo: X402ErrorResponse = await testResponse.json();
      if (paymentInfo.accepts && paymentInfo.accepts.length > 0) {
        receivingWallet = paymentInfo.accepts[0].payTo;
        console.log(`Receiver wallet: ${receivingWallet}`);
        
        // Check receiver's USDC balance before payment
        receiverBalanceBefore = await checkUSDCBalance(receivingWallet);
        console.log(`Receiver balance before: ${receiverBalanceBefore.toFixed(6)} USDC\n`);
      }
    }

    // Wrap fetch with x402 payment capability (same as working implementation in plugin-cdp)
    // Convert max payment from USDC to base units (USDC has 6 decimals)
    const maxPaymentInBaseUnits = BigInt(Math.floor(MAX_PAYMENT_USDC * 1_000_000));
    
    console.log(`Setting up x402-fetch with payment capability (max: ${MAX_PAYMENT_USDC} USDC)...\n`);
    const fetchWithPayment = wrapFetchWithPayment(
      fetch,
      walletClient as never,
      maxPaymentInBaseUnits
    );

    console.log(`Sending request to: ${JOBS_ENDPOINT}`);
    console.log(`Prompt: "${prompt}"\n`);

    // Make paid request
    console.log('💳 Making request with x402-fetch (will pay if required)...');
    const response = await fetchWithPayment(JOBS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    });
    
    if (response.status === 201) {
      console.log('✅ Payment and job creation successful!');
    } else if (response.status === 402) {
      console.log('❌ Payment was not accepted by server (still got 402)');
    } else {
      console.log(`⚠️  Unexpected status: ${response.status}`);
    }

    console.log(`Status: ${response.status} ${response.statusText}`);
    
    // Check for payment response header and extract transaction hash
    const paymentResponseHeader = response.headers.get('x-payment-response');
    let transactionHash: string | null = null;
    let paymentInfo: { success: boolean; transaction: string; network: string; payer: string } | null = null;
    
    if (paymentResponseHeader) {
      console.log('\n💳 Payment response received!');
      try {
        paymentInfo = decodeXPaymentResponse(paymentResponseHeader);
        console.log('Payment data:', JSON.stringify(paymentInfo, null, 2));
        
        if (paymentInfo.transaction) {
          transactionHash = paymentInfo.transaction;
          console.log(`\n🔗 Transaction Hash: ${transactionHash}`);
          console.log(`   View on BaseScan: https://basescan.org/tx/${transactionHash}`);
        }
        
        if (paymentInfo.payer) {
          console.log(`   Payer: ${paymentInfo.payer}`);
        }
        
        if (paymentInfo.network) {
          console.log(`   Network: ${paymentInfo.network}`);
        }
      } catch (error) {
        console.error('Failed to parse payment response:', error instanceof Error ? error.message : String(error));
      }
    }
    
    // Check balances after payment
    if (receivingWallet) {
      console.log('\n💰 Checking balances after payment...');
      
      // Wait a moment for blockchain to update
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const payerBalanceAfter = await checkUSDCBalance(account.address);
      const receiverBalanceAfter = await checkUSDCBalance(receivingWallet);
      
      const payerDiff = payerBalanceBefore - payerBalanceAfter;
      const receiverDiff = receiverBalanceAfter - receiverBalanceBefore;
      
      console.log(`Payer balance after:    ${payerBalanceAfter.toFixed(6)} USDC (${payerDiff >= 0 ? '-' : '+'}${Math.abs(payerDiff).toFixed(6)} USDC)`);
      console.log(`Receiver balance after: ${receiverBalanceAfter.toFixed(6)} USDC (${receiverDiff >= 0 ? '+' : '-'}${Math.abs(receiverDiff).toFixed(6)} USDC)`);
      
      if (payerDiff > 0 && receiverDiff > 0) {
        console.log(`\n✅ Payment confirmed!`);
        console.log(`   Sent: ${payerDiff.toFixed(6)} USDC`);
        console.log(`   Received: ${receiverDiff.toFixed(6)} USDC`);
      } else if (payerDiff > 0) {
        console.log(`\n⚠️  USDC deducted from payer but not received by receiver yet`);
      } else {
        console.log(`\n⚠️  No USDC payment detected on-chain`);
      }
    }

    if (response.status === 201) {
      const job: JobResponse = await response.json();
      console.log('✅ Job created successfully!\n');
      console.log(`Job ID: ${job.jobId}`);
      console.log(`Status: ${job.status}`);
      console.log(`Created: ${new Date(job.createdAt).toISOString()}`);
      console.log(`Expires: ${new Date(job.expiresAt).toISOString()}`);

      // Poll for completion
      await pollForCompletion(job.jobId);
    } else {
      const errorText = await response.text();
      console.error(`❌ Unexpected response (${response.status}):`, errorText);
      
      // If payment failed due to insufficient balance or other issues
      if (response.status === 400 || response.status === 402) {
        console.log('\n💡 Note: This might be due to:');
        console.log('   - Insufficient USDC balance on Base mainnet');
        console.log('   - Network connectivity issues');
        console.log('   - Payment transaction failure');
        console.log(`\n   Check your wallet (${account.address}) has USDC on Base mainnet`);
        console.log('   USDC Contract: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
      }
    }
  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

/**
 * Poll for job completion
 */
async function pollForCompletion(jobId: string): Promise<void> {
  console.log(`\n⏳ Polling for job completion (job: ${jobId})...\n`);

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const response = await fetch(`${JOBS_ENDPOINT}/${jobId}`);
      
      if (!response.ok) {
        console.error(`❌ Failed to get job status: ${response.status}`);
        return;
      }

      const job: JobDetailsResponse = await response.json();
      console.log(`[${attempt}] Status: ${job.status}`);

      if (job.status === 'completed') {
        console.log('\n✅ Job completed!\n');
        console.log('Result:');
        console.log(`  Processing time: ${job.result?.processingTimeMs}ms`);
        console.log(`  Agent response:`);
        console.log(`  ${'-'.repeat(60)}`);
        console.log(`  ${job.result?.message?.content}`);
        console.log(`  ${'-'.repeat(60)}`);
        return;
      } else if (job.status === 'failed') {
        console.log(`\n❌ Job failed: ${job.error || 'Unknown error'}`);
        return;
      } else if (job.status === 'timeout') {
        console.log('\n⏰ Job timed out waiting for agent response');
        return;
      }
    } catch (error) {
      console.error('❌ Error polling job:', error instanceof Error ? error.message : String(error));
      return;
    }
  }

  console.log('\n⏰ Polling timed out - job may still be processing');
}

/**
 * Test 3: List jobs
 */
async function testListJobs(): Promise<void> {
  console.log('\n🧪 Test 3: Listing recent jobs...\n');

  try {
    const response = await fetch(`${JOBS_ENDPOINT}?limit=5`);
    
    if (!response.ok) {
      console.error(`❌ Failed to list jobs: ${response.status}`);
      return;
    }

    const data: { jobs: JobDetailsResponse[]; total: number; filtered: number } = await response.json();
    
    console.log(`Total jobs: ${data.total}`);
    console.log(`Showing: ${data.filtered}\n`);

    data.jobs.forEach((job, index) => {
      console.log(`${index + 1}. Job ${job.jobId.substring(0, 8)}...`);
      console.log(`   Status: ${job.status}`);
      console.log(`   Prompt: ${job.prompt.substring(0, 50)}${job.prompt.length > 50 ? '...' : ''}`);
      console.log(`   Created: ${new Date(job.createdAt).toISOString()}`);
      if (job.result) {
        console.log(`   Processing time: ${job.result.processingTimeMs}ms`);
      }
      console.log('');
    });
  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Test 4: Health check
 */
async function testHealthCheck(): Promise<void> {
  console.log('\n🧪 Test 4: Checking jobs API health...\n');

  try {
    const response = await fetch(`${JOBS_ENDPOINT}/health`);
    
    if (!response.ok) {
      console.error(`❌ Health check failed: ${response.status}`);
      return;
    }

    const health: {
      healthy: boolean;
      timestamp: number;
      totalJobs: number;
      statusCounts: Record<string, number>;
      maxJobs: number;
    } = await response.json();

    console.log('✅ Jobs API is healthy\n');
    console.log(`Total jobs: ${health.totalJobs}/${health.maxJobs}`);
    console.log('Status breakdown:');
    Object.entries(health.statusCounts).forEach(([status, count]) => {
      if (count > 0) {
        console.log(`  ${status}: ${count}`);
      }
    });
  } catch (error) {
    console.error('❌ Test failed:', error instanceof Error ? error.message : String(error));
  }
}

/**
 * Main test runner
 */
async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  x402 Payment Integration Test Suite for Jobs API         ║');
  console.log('║              BASE MAINNET - Real USDC Required             ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log(`\nAPI URL: ${API_BASE_URL}`);
  console.log(`Endpoint: ${JOBS_ENDPOINT}`);
  console.log(`Network: Base Mainnet`);

  try {
    // Test 1: Verify 402 response
    await testPaymentRequired();

    // Test 2: Make a paid request (if wallet is configured)
    if (PRIVATE_KEY) {
      const prompt = CLI_ARGS.prompt || DEFAULT_PROMPT;
      console.log(`\n📝 Using prompt: "${prompt}"\n`);
      await testPaidRequest(prompt);
    } else {
      console.log('\n⚠️  Skipping paid request tests - no private key configured');
      console.log('   Set EVM_PRIVATE_KEY, TEST_WALLET_PRIVATE_KEY, or CDP_API_KEY_PRIVATE_KEY to enable');
    }

    // Test 3: List jobs
    await testListJobs();

    // Test 4: Health check
    await testHealthCheck();

    console.log('\n✅ All tests completed!\n');
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests
main().catch(console.error);

