# Jobs API Migration - Enhanced Features

This document describes the enhanced Jobs API that has been aligned between the otaku and eliza repositories.

## What Changed

The Jobs API has been **significantly enhanced** with features from the main eliza repository:

### 1. **Dedicated JobsService Class**
- Previously: Jobs methods were part of `MessagingService`
- Now: Separate `JobsService` class with advanced functionality
- Access via: `client.jobs.create()`, `client.jobs.poll()`, etc.

### 2. **Enhanced Type Definitions**

#### New Types Added:
- `JobValidation` - Constants for validation (max content length, timeouts, etc.)
- `JobListResponse` - Properly typed list response
- `JobHealthResponse` - Enhanced health metrics including success/failure rates
- `PollResult` - Wrapper for poll operations with success status and timing
- `PollOptions` - Enhanced with `onProgress` callback support

#### Updated Types:
- `JobResult.message.id` - Now typed as `UUID` instead of `string`
- `JobResult.message.authorId` - Now typed as `UUID` instead of `string`

### 3. **New Methods**

#### Basic Operations (Renamed from MessagingService methods):
- `create(params)` - Create a new job
- `getJob(jobId)` - Get job status
- `list(params)` - List jobs with filtering
- `health()` - Get health metrics

#### Advanced Polling:
- `poll(jobId, options)` - Poll with progress callbacks
- `createAndPoll(params, pollOptions)` - One-call create and wait
- `createAndPollWithBackoff(params, options)` - Exponential backoff polling
- `ask(userId, content, agentId?, pollOptions?)` - Simplified question/answer interface

## Migration Guide

### Before (Old API via MessagingService)

```typescript
const client = new ElizaClient({ baseUrl: 'http://localhost:3000' });

// Create job
const job = await client.messaging.createJob({
  userId: 'user-uuid',
  content: 'What is the weather?'
});

// Manual polling
const result = await client.messaging.pollJob(job.jobId, 1000, 30);
```

### After (New Enhanced JobsService)

```typescript
const client = new ElizaClient({ baseUrl: 'http://localhost:3000' });

// Simple ask and get response
const response = await client.jobs.ask(
  'user-uuid',
  'What is the weather?'
);

// OR with progress tracking
const result = await client.jobs.createAndPoll(
  {
    userId: 'user-uuid',
    content: 'What is the weather?'
  },
  {
    interval: 1000,
    onProgress: (job, attempt) => {
      console.log(`Polling attempt ${attempt}: ${job.status}`);
    }
  }
);

// OR with exponential backoff for long-running jobs
const result = await client.jobs.createAndPollWithBackoff(
  {
    userId: 'user-uuid',
    content: 'Complex analysis task'
  },
  {
    initialInterval: 500,
    maxInterval: 5000,
    multiplier: 1.5
  }
);
```

## Key Improvements

### 1. **Progress Callbacks**
```typescript
const result = await client.jobs.poll('job-id', {
  interval: 1000,
  onProgress: (job, attempt) => {
    console.log(`Attempt ${attempt}: Status = ${job.status}`);
    if (job.status === JobStatus.PROCESSING) {
      console.log('Still processing...');
    }
  }
});
```

### 2. **Exponential Backoff**
Efficient polling for long-running jobs:
```typescript
const result = await client.jobs.createAndPollWithBackoff(params, {
  initialInterval: 500,  // Start at 500ms
  maxInterval: 5000,     // Cap at 5 seconds
  multiplier: 1.5        // Increase by 1.5x each time
});
```

### 3. **Simplified Ask Interface**
Direct question/answer without managing job IDs:
```typescript
try {
  const answer = await client.jobs.ask(
    'user-uuid',
    'What is 2+2?'
  );
  console.log(answer); // "4"
} catch (error) {
  console.error('Failed:', error.message);
}
```

### 4. **Enhanced Health Metrics**
```typescript
const health = await client.jobs.health();
console.log('Success rate:', health.metrics.successRate);
console.log('Avg processing time:', health.metrics.averageProcessingTimeMs);
console.log('Failure rate:', health.metrics.failureRate);
```

### 5. **Better Poll Results**
```typescript
const result = await client.jobs.poll('job-id');

console.log('Success:', result.success);
console.log('Attempts:', result.attempts);
console.log('Time taken:', result.timeMs, 'ms');

if (result.success) {
  console.log('Response:', result.job.result?.message.content);
}
```

## Backward Compatibility

The old `MessagingService` methods are **still available** for backward compatibility:
- `client.messaging.createJob()`
- `client.messaging.getJob()`
- `client.messaging.listJobs()`
- `client.messaging.getJobsHealth()`
- `client.messaging.pollJob()`
- `client.messaging.createAndWaitForJob()`

However, we recommend migrating to the new `JobsService` for:
- Better organization
- Advanced features
- Progress tracking
- Exponential backoff
- Simplified interfaces

## Validation Constants

Use the new validation constants for input validation:

```typescript
import { JobValidation } from '@elizaos/api-client';

// Check content length
if (content.length > JobValidation.MAX_CONTENT_LENGTH) {
  throw new Error('Content too long');
}

// Use timeout constants
const timeout = Math.min(
  customTimeout,
  JobValidation.MAX_TIMEOUT_MS
);
```

## Type-Safe Usage

All methods are fully typed with TypeScript:

```typescript
import { 
  JobStatus, 
  JobDetailsResponse, 
  PollResult,
  JobListResponse 
} from '@elizaos/api-client';

// Type-safe polling
const result: PollResult = await client.jobs.poll('job-id');

// Type-safe status checking
if (result.job.status === JobStatus.COMPLETED) {
  const response: string = result.job.result!.message.content;
}

// Type-safe list filtering
const jobs: JobListResponse = await client.jobs.list({
  status: JobStatus.COMPLETED,
  limit: 10
});
```

## Testing

All 20 Jobs API tests pass successfully:
- ✅ Job creation
- ✅ Job status retrieval
- ✅ Job listing and filtering
- ✅ Health checks
- ✅ Polling with retries
- ✅ Progress callbacks
- ✅ Error handling
- ✅ Timeout scenarios

## Next Steps

1. **Migrate existing code** to use `client.jobs.*` instead of `client.messaging.*` for job operations
2. **Add progress callbacks** to improve UX during long-running operations
3. **Use exponential backoff** for efficient polling
4. **Leverage the `ask()` method** for simple question/answer scenarios

## Resources

- [Jobs API Examples](./jobs-api-examples.md) - Comprehensive usage examples
- [API Reference](../README.md) - Full API documentation
- [TypeScript Types](../src/types/jobs.ts) - Type definitions


