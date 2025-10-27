import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { MessagingService } from '../../services/messaging';
import { ApiClientConfig } from '../../types/base';
import { JobStatus } from '../../types/jobs';

describe('MessagingService', () => {
  let messagingService: MessagingService;
  const mockConfig: ApiClientConfig = {
    baseUrl: 'http://localhost:3000',
    apiKey: 'test-key',
  };

  beforeEach(() => {
    messagingService = new MessagingService(mockConfig);
    // Mock the HTTP methods
    (messagingService as any).get = mock(() => Promise.resolve({}));
    (messagingService as any).post = mock(() => Promise.resolve({}));
    (messagingService as any).patch = mock(() => Promise.resolve({}));
    (messagingService as any).delete = mock(() => Promise.resolve({}));
  });

  afterEach(() => {
    const getMock = (messagingService as any).get;
    const postMock = (messagingService as any).post;
    const patchMock = (messagingService as any).patch;
    const deleteMock = (messagingService as any).delete;

    if (getMock?.mockClear) getMock.mockClear();
    if (postMock?.mockClear) postMock.mockClear();
    if (patchMock?.mockClear) patchMock.mockClear();
    if (deleteMock?.mockClear) deleteMock.mockClear();
  });

  describe('constructor', () => {
    it('should create an instance with valid configuration', () => {
      expect(messagingService).toBeInstanceOf(MessagingService);
    });

    it('should throw error when initialized with invalid configuration', () => {
      expect(() => new MessagingService(null as any)).toThrow();
    });
  });

  describe('submitMessage', () => {
    const mockParams = {
      agentId: 'agent-123' as any,
      channelId: 'channel-456' as any,
      content: 'Test message',
      metadata: { source: 'test' },
    };

    it('should submit message successfully', async () => {
      const mockResponse = { id: 'msg-789', content: 'Test message' };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.submitMessage(mockParams);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        '/api/messaging/submit',
        mockParams
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle submission errors', async () => {
      (messagingService as any).post.mockRejectedValue(new Error('Submission failed'));

      await expect(messagingService.submitMessage(mockParams)).rejects.toThrow('Submission failed');
    });
  });

  describe('completeMessage', () => {
    const mockParams = {
      messageId: 'msg-123' as any,
      status: 'completed' as 'completed' | 'failed',
    };

    it('should complete message successfully', async () => {
      const mockResponse = { success: true };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.completeMessage(mockParams);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        '/api/messaging/complete',
        mockParams
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('ingestExternalMessages', () => {
    const mockParams = {
      platform: 'discord',
      channelId: 'external-channel-123',
      messages: [
        {
          id: 'ext-msg-1',
          authorId: 'ext-user-1',
          content: 'External message',
          timestamp: Date.now(),
          metadata: { platform: 'discord' },
        },
      ],
    };

    it('should ingest external messages successfully', async () => {
      const mockResponse = { processed: 1 };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.ingestExternalMessages(mockParams);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        '/api/messaging/ingest-external',
        mockParams
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('createChannel', () => {
    const mockParams = {
      name: 'New Channel',
      type: 'public' as any,
      serverId: 'server-123' as any,
      metadata: { description: 'A new channel' },
    };

    it('should create channel successfully', async () => {
      const mockResponse = { id: 'channel-new', name: 'New Channel' };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.createChannel(mockParams);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        '/api/messaging/central-channels',
        {
          name: mockParams.name,
          type: mockParams.type,
          server_id: mockParams.serverId,
          metadata: mockParams.metadata,
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('createGroupChannel', () => {
    const mockParams = {
      name: 'Group Channel',
      participantIds: ['user-1', 'user-2'] as any[],
      metadata: { type: 'group' },
    };

    it('should create group channel successfully', async () => {
      const mockResponse = { id: 'channel-group', name: 'Group Channel' };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.createGroupChannel(mockParams);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        '/api/messaging/central-channels',
        {
          name: mockParams.name,
          server_id: '00000000-0000-0000-0000-000000000000',
          participantCentralUserIds: mockParams.participantIds,
          type: 'group', // Extracted from metadata
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getOrCreateDmChannel', () => {
    const mockParams = {
      participantIds: ['user-1', 'user-2'] as [any, any],
    };

    it('should get or create DM channel successfully', async () => {
      const mockResponse = { id: 'channel-dm', name: 'DM Channel' };
      (messagingService as any).get.mockResolvedValue(mockResponse);

      const result = await messagingService.getOrCreateDmChannel(mockParams);

      expect((messagingService as any).get).toHaveBeenCalledWith('/api/messaging/dm-channel', {
        params: {
          currentUserId: mockParams.participantIds[0],
          targetUserId: mockParams.participantIds[1],
          dmServerId: '00000000-0000-0000-0000-000000000000',
        },
      });
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getChannelDetails', () => {
    const channelId = 'channel-123' as any;

    it('should get channel details successfully', async () => {
      const mockResponse = { id: channelId, name: 'Test Channel', type: 'public' };
      (messagingService as any).get.mockResolvedValue(mockResponse);

      const result = await messagingService.getChannelDetails(channelId);

      expect((messagingService as any).get).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}/details`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getChannelParticipants', () => {
    const channelId = 'channel-123' as any;

    it('should get channel participants successfully', async () => {
      const mockResponse = { participants: [{ id: 'user-1', role: 'member' }] };
      (messagingService as any).get.mockResolvedValue(mockResponse);

      const result = await messagingService.getChannelParticipants(channelId);

      expect((messagingService as any).get).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}/participants`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('addAgentToChannel', () => {
    const channelId = 'channel-123' as any;
    const agentId = 'agent-456' as any;

    it('should add agent to channel successfully', async () => {
      const mockResponse = { success: true };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.addAgentToChannel(channelId, agentId);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}/agents`,
        { agentId }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('removeAgentFromChannel', () => {
    const channelId = 'channel-123' as any;
    const agentId = 'agent-456' as any;

    it('should remove agent from channel successfully', async () => {
      const mockResponse = { success: true };
      (messagingService as any).delete.mockResolvedValue(mockResponse);

      const result = await messagingService.removeAgentFromChannel(channelId, agentId);

      expect((messagingService as any).delete).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}/agents/${agentId}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deleteChannel', () => {
    const channelId = 'channel-123' as any;

    it('should delete channel successfully', async () => {
      const mockResponse = { success: true };
      (messagingService as any).delete.mockResolvedValue(mockResponse);

      const result = await messagingService.deleteChannel(channelId);

      expect((messagingService as any).delete).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('clearChannelHistory', () => {
    const channelId = 'channel-123' as any;

    it('should clear channel history successfully', async () => {
      const mockResponse = { deleted: 10 };
      (messagingService as any).delete.mockResolvedValue(mockResponse);

      const result = await messagingService.clearChannelHistory(channelId);

      expect((messagingService as any).delete).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}/messages`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('postMessage', () => {
    const channelId = 'channel-123' as any;
    const content = 'Hello world';
    const metadata = { source: 'test' };

    it('should post message successfully', async () => {
      const mockResponse = { id: 'msg-new', content, channelId };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.postMessage(channelId, content, metadata);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}/messages`,
        { content, metadata }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getChannelMessages', () => {
    const channelId = 'channel-123' as any;

    it('should get channel messages successfully', async () => {
      const mockResponse = { messages: [{ id: 'msg-1', content: 'Hello' }] };
      (messagingService as any).get.mockResolvedValue(mockResponse);

      const result = await messagingService.getChannelMessages(channelId);

      expect((messagingService as any).get).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}/messages`,
        { params: undefined }
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle pagination parameters', async () => {
      const params = { limit: 10, offset: 20 };
      (messagingService as any).get.mockResolvedValue({ messages: [] });

      await messagingService.getChannelMessages(channelId, params);

      expect((messagingService as any).get).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}/messages`,
        { params }
      );
    });
  });

  describe('getMessage', () => {
    const messageId = 'msg-123' as any;

    it('should get message successfully', async () => {
      const mockResponse = { id: messageId, content: 'Test message' };
      (messagingService as any).get.mockResolvedValue(mockResponse);

      const result = await messagingService.getMessage(messageId);

      expect((messagingService as any).get).toHaveBeenCalledWith(
        `/api/messaging/messages/${messageId}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deleteMessage', () => {
    const channelId = 'channel-123' as any;
    const messageId = 'msg-123' as any;

    it('should delete message successfully', async () => {
      const mockResponse = { success: true };
      (messagingService as any).delete.mockResolvedValue(mockResponse);

      const result = await messagingService.deleteMessage(channelId, messageId);

      expect((messagingService as any).delete).toHaveBeenCalledWith(
        `/api/messaging/central-channels/${channelId}/messages/${messageId}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('updateMessage', () => {
    const messageId = 'msg-123' as any;
    const content = 'Updated content';

    it('should update message successfully', async () => {
      const mockResponse = { id: messageId, content };
      (messagingService as any).patch.mockResolvedValue(mockResponse);

      const result = await messagingService.updateMessage(messageId, content);

      expect((messagingService as any).patch).toHaveBeenCalledWith(
        `/api/messaging/messages/${messageId}`,
        { content }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('searchMessages', () => {
    const mockParams = {
      query: 'search term',
      channelId: 'channel-123' as any,
      limit: 10,
    };

    it('should search messages successfully', async () => {
      const mockResponse = { messages: [{ id: 'msg-1', content: 'Found message' }] };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.searchMessages(mockParams);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        '/api/messaging/messages/search',
        mockParams
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('listServers', () => {
    it('should list servers successfully', async () => {
      const mockResponse = { servers: [{ id: 'server-1', name: 'Test Server' }] };
      (messagingService as any).get.mockResolvedValue(mockResponse);

      const result = await messagingService.listServers();

      expect((messagingService as any).get).toHaveBeenCalledWith('/api/messaging/central-servers');
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getServerChannels', () => {
    const serverId = 'server-123' as any;

    it('should get server channels successfully', async () => {
      const mockResponse = { channels: [{ id: 'channel-1', name: 'General' }] };
      (messagingService as any).get.mockResolvedValue(mockResponse);

      const result = await messagingService.getServerChannels(serverId);

      expect((messagingService as any).get).toHaveBeenCalledWith(
        `/api/messaging/central-servers/${serverId}/channels`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('createServer', () => {
    const mockParams = {
      name: 'New Server',
      sourceType: 'discord',
      sourceId: 'discord-server-123',
      metadata: { description: 'A new server' },
    };

    it('should create server successfully', async () => {
      const mockResponse = { id: 'server-new', name: 'New Server' };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.createServer(mockParams);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        '/api/messaging/servers',
        mockParams
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('syncServerChannels', () => {
    const serverId = 'server-123' as any;
    const mockParams = {
      channels: [
        { name: 'general', type: 'public' as any, sourceId: 'discord-channel-1' },
        { name: 'private', type: 'private' as any, sourceId: 'discord-channel-2' },
      ],
    };

    it('should sync server channels successfully', async () => {
      const mockResponse = { synced: 2 };
      (messagingService as any).post.mockResolvedValue(mockResponse);

      const result = await messagingService.syncServerChannels(serverId, mockParams);

      expect((messagingService as any).post).toHaveBeenCalledWith(
        `/api/messaging/servers/${serverId}/sync-channels`,
        mockParams
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deleteServer', () => {
    const serverId = 'server-123' as any;

    it('should delete server successfully', async () => {
      const mockResponse = { success: true };
      (messagingService as any).delete.mockResolvedValue(mockResponse);

      const result = await messagingService.deleteServer(serverId);

      expect((messagingService as any).delete).toHaveBeenCalledWith(
        `/api/messaging/servers/${serverId}`
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      (messagingService as any).get.mockRejectedValue(new Error('Network error'));

      await expect(messagingService.listServers()).rejects.toThrow('Network error');
    });

    it('should handle API errors', async () => {
      (messagingService as any).post.mockRejectedValue(new Error('API error'));

      const params = {
        agentId: 'agent-123' as any,
        channelId: 'channel-456' as any,
        content: 'Test message',
      };

      await expect(messagingService.submitMessage(params)).rejects.toThrow('API error');
    });
  });

  // =============================================================================
  // Jobs API Tests
  // =============================================================================

  describe('Jobs API', () => {
    describe('createJob', () => {
      const mockParams = {
        userId: 'user-123' as any,
        content: 'What is the weather?',
        agentId: 'agent-456' as any,
        timeoutMs: 30000,
        metadata: { source: 'test' },
      };

      it('should create job successfully', async () => {
        const mockResponse = {
          jobId: 'job-789',
          status: JobStatus.PENDING,
          createdAt: Date.now(),
          expiresAt: Date.now() + 30000,
        };
        (messagingService as any).post.mockResolvedValue(mockResponse);

        const result = await messagingService.createJob(mockParams);

        expect((messagingService as any).post).toHaveBeenCalledWith(
          '/api/messaging/jobs',
          mockParams
        );
        expect(result).toEqual(mockResponse);
        expect(result.status).toBe(JobStatus.PENDING);
      });

      it('should create job without agentId', async () => {
        const paramsWithoutAgent = {
          userId: 'user-123' as any,
          content: 'Test message',
        };
        const mockResponse = {
          jobId: 'job-789',
          status: JobStatus.PENDING,
          createdAt: Date.now(),
          expiresAt: Date.now() + 30000,
        };
        (messagingService as any).post.mockResolvedValue(mockResponse);

        const result = await messagingService.createJob(paramsWithoutAgent);

        expect((messagingService as any).post).toHaveBeenCalledWith(
          '/api/messaging/jobs',
          paramsWithoutAgent
        );
        expect(result).toEqual(mockResponse);
      });

      it('should handle job creation errors', async () => {
        (messagingService as any).post.mockRejectedValue(new Error('No agents available'));

        await expect(messagingService.createJob(mockParams)).rejects.toThrow(
          'No agents available'
        );
      });
    });

    describe('getJob', () => {
      const jobId = 'job-123';

      it('should get job details successfully', async () => {
        const mockResponse = {
          jobId,
          status: JobStatus.COMPLETED,
          agentId: 'agent-456' as any,
          userId: 'user-789' as any,
          prompt: 'What is the weather?',
          createdAt: Date.now() - 5000,
          expiresAt: Date.now() + 25000,
          result: {
            message: {
              id: 'msg-123',
              content: 'The weather is sunny',
              authorId: 'agent-456',
              createdAt: Date.now(),
              metadata: {},
            },
            processingTimeMs: 3500,
          },
        };
        (messagingService as any).get.mockResolvedValue(mockResponse);

        const result = await messagingService.getJob(jobId);

        expect((messagingService as any).get).toHaveBeenCalledWith(`/api/messaging/jobs/${jobId}`);
        expect(result).toEqual(mockResponse);
        expect(result.status).toBe(JobStatus.COMPLETED);
        expect(result.result?.processingTimeMs).toBe(3500);
      });

      it('should get job with PROCESSING status', async () => {
        const mockResponse = {
          jobId,
          status: JobStatus.PROCESSING,
          agentId: 'agent-456' as any,
          userId: 'user-789' as any,
          prompt: 'Processing...',
          createdAt: Date.now() - 2000,
          expiresAt: Date.now() + 28000,
        };
        (messagingService as any).get.mockResolvedValue(mockResponse);

        const result = await messagingService.getJob(jobId);

        expect(result.status).toBe(JobStatus.PROCESSING);
        expect(result.result).toBeUndefined();
      });

      it('should get job with FAILED status', async () => {
        const mockResponse = {
          jobId,
          status: JobStatus.FAILED,
          agentId: 'agent-456' as any,
          userId: 'user-789' as any,
          prompt: 'Failed job',
          createdAt: Date.now() - 5000,
          expiresAt: Date.now() + 25000,
          error: 'Agent processing failed',
        };
        (messagingService as any).get.mockResolvedValue(mockResponse);

        const result = await messagingService.getJob(jobId);

        expect(result.status).toBe(JobStatus.FAILED);
        expect(result.error).toBe('Agent processing failed');
      });

      it('should handle job not found error', async () => {
        (messagingService as any).get.mockRejectedValue(new Error('Job not found'));

        await expect(messagingService.getJob(jobId)).rejects.toThrow('Job not found');
      });
    });

    describe('listJobs', () => {
      it('should list jobs successfully', async () => {
        const mockResponse = {
          jobs: [
            {
              jobId: 'job-1',
              status: JobStatus.COMPLETED,
              agentId: 'agent-1' as any,
              userId: 'user-1' as any,
              prompt: 'Job 1',
              createdAt: Date.now() - 10000,
              expiresAt: Date.now() + 20000,
            },
            {
              jobId: 'job-2',
              status: JobStatus.PROCESSING,
              agentId: 'agent-1' as any,
              userId: 'user-1' as any,
              prompt: 'Job 2',
              createdAt: Date.now() - 5000,
              expiresAt: Date.now() + 25000,
            },
          ],
          total: 10,
          filtered: 2,
        };
        (messagingService as any).get.mockResolvedValue(mockResponse);

        const result = await messagingService.listJobs();

        expect((messagingService as any).get).toHaveBeenCalledWith('/api/messaging/jobs', {
          params: undefined,
        });
        expect(result).toEqual(mockResponse);
        expect(result.jobs.length).toBe(2);
        expect(result.total).toBe(10);
      });

      it('should list jobs with limit parameter', async () => {
        const mockResponse = { jobs: [], total: 0, filtered: 0 };
        (messagingService as any).get.mockResolvedValue(mockResponse);

        await messagingService.listJobs({ limit: 5 });

        expect((messagingService as any).get).toHaveBeenCalledWith('/api/messaging/jobs', {
          params: { limit: 5 },
        });
      });

      it('should list jobs with status filter', async () => {
        const mockResponse = {
          jobs: [
            {
              jobId: 'job-1',
              status: JobStatus.COMPLETED,
              agentId: 'agent-1' as any,
              userId: 'user-1' as any,
              prompt: 'Completed job',
              createdAt: Date.now() - 10000,
              expiresAt: Date.now() + 20000,
            },
          ],
          total: 10,
          filtered: 1,
        };
        (messagingService as any).get.mockResolvedValue(mockResponse);

        const result = await messagingService.listJobs({ status: JobStatus.COMPLETED, limit: 10 });

        expect((messagingService as any).get).toHaveBeenCalledWith('/api/messaging/jobs', {
          params: { status: JobStatus.COMPLETED, limit: 10 },
        });
        expect(result.jobs[0].status).toBe(JobStatus.COMPLETED);
      });
    });

    describe('getJobsHealth', () => {
      it('should get jobs health successfully', async () => {
        const mockResponse = {
          healthy: true,
          timestamp: Date.now(),
          totalJobs: 25,
          statusCounts: {
            pending: 2,
            processing: 3,
            completed: 18,
            failed: 1,
            timeout: 1,
          },
          maxJobs: 10000,
        };
        (messagingService as any).get.mockResolvedValue(mockResponse);

        const result = await messagingService.getJobsHealth();

        expect((messagingService as any).get).toHaveBeenCalledWith('/api/messaging/jobs/health');
        expect(result).toEqual(mockResponse);
        expect(result.healthy).toBe(true);
        expect(result.totalJobs).toBe(25);
        expect(result.statusCounts.completed).toBe(18);
      });

      it('should handle health check errors', async () => {
        (messagingService as any).get.mockRejectedValue(new Error('Service unavailable'));

        await expect(messagingService.getJobsHealth()).rejects.toThrow('Service unavailable');
      });
    });

    describe('pollJob', () => {
      const jobId = 'job-123';

      it('should poll job until completion', async () => {
        const completedJob = {
          jobId,
          status: JobStatus.COMPLETED,
          agentId: 'agent-456' as any,
          userId: 'user-789' as any,
          prompt: 'Test',
          createdAt: Date.now() - 5000,
          expiresAt: Date.now() + 25000,
          result: {
            message: {
              id: 'msg-123',
              content: 'Result',
              authorId: 'agent-456',
              createdAt: Date.now(),
            },
            processingTimeMs: 3000,
          },
        };

        // First call: processing, second call: completed
        (messagingService as any).get
          .mockResolvedValueOnce({
            ...completedJob,
            status: JobStatus.PROCESSING,
            result: undefined,
          })
          .mockResolvedValueOnce(completedJob);

        const result = await messagingService.pollJob(jobId, 10, 5);

        expect((messagingService as any).get).toHaveBeenCalledTimes(2);
        expect(result.status).toBe(JobStatus.COMPLETED);
        expect(result.result?.message.content).toBe('Result');
      });

      it('should return immediately if job is already completed', async () => {
        const completedJob = {
          jobId,
          status: JobStatus.COMPLETED,
          agentId: 'agent-456' as any,
          userId: 'user-789' as any,
          prompt: 'Test',
          createdAt: Date.now() - 5000,
          expiresAt: Date.now() + 25000,
          result: {
            message: {
              id: 'msg-123',
              content: 'Result',
              authorId: 'agent-456',
              createdAt: Date.now(),
            },
            processingTimeMs: 3000,
          },
        };

        (messagingService as any).get.mockResolvedValue(completedJob);

        const result = await messagingService.pollJob(jobId, 10, 5);

        expect((messagingService as any).get).toHaveBeenCalledTimes(1);
        expect(result.status).toBe(JobStatus.COMPLETED);
      });

      it('should throw error when job fails', async () => {
        const failedJob = {
          jobId,
          status: JobStatus.FAILED,
          agentId: 'agent-456' as any,
          userId: 'user-789' as any,
          prompt: 'Test',
          createdAt: Date.now() - 5000,
          expiresAt: Date.now() + 25000,
          error: 'Processing error',
        };

        (messagingService as any).get.mockResolvedValue(failedJob);

        await expect(messagingService.pollJob(jobId, 10, 5)).rejects.toThrow(
          'Job failed: Processing error'
        );
      });

      it('should throw error when job times out', async () => {
        const timedOutJob = {
          jobId,
          status: JobStatus.TIMEOUT,
          agentId: 'agent-456' as any,
          userId: 'user-789' as any,
          prompt: 'Test',
          createdAt: Date.now() - 35000,
          expiresAt: Date.now() - 5000,
          error: 'Job timed out',
        };

        (messagingService as any).get.mockResolvedValue(timedOutJob);

        await expect(messagingService.pollJob(jobId, 10, 5)).rejects.toThrow(
          'Job timed out waiting for agent response'
        );
      });

      it('should throw error when max attempts reached', async () => {
        const processingJob = {
          jobId,
          status: JobStatus.PROCESSING,
          agentId: 'agent-456' as any,
          userId: 'user-789' as any,
          prompt: 'Test',
          createdAt: Date.now() - 5000,
          expiresAt: Date.now() + 25000,
        };

        (messagingService as any).get.mockResolvedValue(processingJob);

        await expect(messagingService.pollJob(jobId, 10, 3)).rejects.toThrow(
          'Polling exceeded maximum attempts (3)'
        );

        expect((messagingService as any).get).toHaveBeenCalledTimes(3);
      });
    });

    describe('createAndWaitForJob', () => {
      const mockParams = {
        userId: 'user-123' as any,
        content: 'What is 2+2?',
      };

      it('should create job and wait for completion', async () => {
        const createResponse = {
          jobId: 'job-789',
          status: JobStatus.PENDING,
          createdAt: Date.now(),
          expiresAt: Date.now() + 30000,
        };

        const completedJob = {
          jobId: 'job-789',
          status: JobStatus.COMPLETED,
          agentId: 'agent-456' as any,
          userId: 'user-123' as any,
          prompt: 'What is 2+2?',
          createdAt: Date.now() - 5000,
          expiresAt: Date.now() + 25000,
          result: {
            message: {
              id: 'msg-123',
              content: '2+2 equals 4',
              authorId: 'agent-456',
              createdAt: Date.now(),
            },
            processingTimeMs: 2500,
          },
        };

        // Mock createJob (post) and pollJob (get calls)
        (messagingService as any).post.mockResolvedValue(createResponse);
        (messagingService as any).get
          .mockResolvedValueOnce({
            ...completedJob,
            status: JobStatus.PROCESSING,
            result: undefined,
          })
          .mockResolvedValueOnce(completedJob);

        const result = await messagingService.createAndWaitForJob(mockParams, 10, 5);

        expect((messagingService as any).post).toHaveBeenCalledWith(
          '/api/messaging/jobs',
          mockParams
        );
        expect(result.status).toBe(JobStatus.COMPLETED);
        expect(result.result?.message.content).toBe('2+2 equals 4');
      });

      it('should handle job creation failure', async () => {
        (messagingService as any).post.mockRejectedValue(new Error('No agents available'));

        await expect(messagingService.createAndWaitForJob(mockParams)).rejects.toThrow(
          'No agents available'
        );
      });

      it('should handle job polling failure', async () => {
        const createResponse = {
          jobId: 'job-789',
          status: JobStatus.PENDING,
          createdAt: Date.now(),
          expiresAt: Date.now() + 30000,
        };

        const failedJob = {
          jobId: 'job-789',
          status: JobStatus.FAILED,
          agentId: 'agent-456' as any,
          userId: 'user-123' as any,
          prompt: 'What is 2+2?',
          createdAt: Date.now() - 5000,
          expiresAt: Date.now() + 25000,
          error: 'Agent error',
        };

        (messagingService as any).post.mockResolvedValue(createResponse);
        (messagingService as any).get.mockResolvedValue(failedJob);

        await expect(messagingService.createAndWaitForJob(mockParams, 10, 5)).rejects.toThrow(
          'Job failed: Agent error'
        );
      });
    });
  });
});
