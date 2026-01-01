# Troubleshooting

## Build Issues

### Build Fails

**Check Bun Version**:
```bash
bun --version  # Should be 1.2.21+
```

**Clean and Rebuild**:
```bash
rm -rf dist node_modules
bun install
bun run build
```

**Check Workspace Packages**:
```bash
cd src/packages/api-client && bun run build
cd src/packages/server && bun run build
```

**Common Causes**:
- Outdated Bun version
- Missing dependencies
- TypeScript errors (run `bun run type-check`)
- Corrupt node_modules

### Workspace Package Build Fails

**Check Turbo**:
```bash
bun run build:all
```

**Build Individual Package**:
```bash
cd src/packages/api-client && bun run build
```

**Check Dependencies**:
- Ensure `package.json` has correct deps
- Check `tsconfig.json` references

### Backend Build Fails

**Check Build Config**:
```bash
cat build.ts  # Verify externals list
```

**Common Issues**:
- Missing externals (add to `build.ts`)
- Import errors (check `src/index.ts`)
- Plugin import errors

### Frontend Build Fails

**Check Vite Config**:
```bash
cat vite.config.ts
```

**Common Issues**:
- Missing env vars (check `.env`)
- Import errors
- TypeScript errors

## Server Issues

### Server Won't Start

**Check Environment Variables**:
```bash
cat .env  # Verify required keys exist
```

**Required Keys**:
- `JWT_SECRET`
- `OPENAI_API_KEY` or `OPENROUTER_API_KEY`
- `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `CDP_WALLET_SECRET`
- `ALCHEMY_API_KEY`

**Check Built Files**:
```bash
ls dist/index.js          # Backend built
ls dist/frontend/         # Frontend built
```

**Check Port Availability**:
```bash
lsof -i :3000  # Check if port in use
```

**Change Port** (in `.env`):
```bash
SERVER_PORT=3001
```

### Server Crashes on Startup

**Enable Debug Logging**:
```bash
LOG_LEVEL=debug bun run start
```

**Common Causes**:
- Missing env vars
- Invalid API keys
- Database connection issues
- Plugin initialization errors

### Agent Not Loading

**Check Agent Endpoint**:
```bash
curl http://localhost:3000/api/agents
```

**Verify `dist/index.js`**:
```bash
cat dist/index.js | grep "export"  # Should export projectAgent
```

**Check Server Logs**:
```bash
LOG_LEVEL=debug bun run start
# Look for "Starting agents" message
```

## Agent Response Issues

### Agent Not Responding

**Check LLM API Keys**:
- Verify `OPENAI_API_KEY` or `OPENROUTER_API_KEY` in `.env`
- Test key with curl to provider API
- Check rate limits/quota

**Check WebSocket Connection**:
- Open browser dev tools → Network → WS
- Verify WebSocket connected
- Check for connection errors

**Check Server Logs**:
```bash
LOG_LEVEL=debug bun run start
# Look for LLM call errors
```

**Common Causes**:
- Invalid/expired API key
- Rate limit exceeded
- Network connectivity issues
- LLM provider downtime

### Action Not Available to LLM

**Check Action `validate` Function**:
- Returns `true` for action to be available
- Check required services are initialized

**Verify Plugin Registration**:
```bash
cat src/index.ts | grep "plugins:"
# Ensure plugin in array
```

**Check Plugin Order**:
- Services must be registered before actions that use them
- `sqlPlugin` must be first
- `bootstrapPlugin` must be second

**Rebuild Backend**:
```bash
bun run build:backend
```

**Enable Debug Logging**:
```bash
LOG_LEVEL=debug bun run start
# Look for "Available actions" message
```

### Parameters Not Reaching Action

**Check LLM Output**:
- Enable debug logging
- Look for XML with `<parameters>` element
- Verify JSON is valid

**Verify State Contains Params**:
Add logging in action handler:
```typescript
console.log('Params:', params);
console.log('State:', composedState?.data);
```

**Check Parameter Names**:
- Must match schema exactly (case-sensitive)
- No typos in parameter names

**Check JSON Parsing**:
- Look for parse errors in logs
- LLM must output valid JSON string

**Common Causes**:
- LLM didn't generate `<parameters>`
- Invalid JSON from LLM
- Parameter name mismatch
- State not persisting between calls

### Action Returns Error

**Check Handler Validation**:
- Review validation logic in handler
- Check error messages in logs

**Common Errors**:
- `missing_required_parameter` - Required param missing
- `invalid_chain` - Network not in supported list
- `invalid_token` - Token not found on network
- `insufficient_balance` - Not enough tokens

**Debug**:
```bash
LOG_LEVEL=debug bun run start
# Check full error messages
```

## Frontend Issues

### Frontend Not Loading

**Check Built Files**:
```bash
ls dist/frontend/index.html
ls dist/frontend/assets/
```

**Rebuild Frontend**:
```bash
bun run build:frontend
```

**Check Server `clientPath`**:
```bash
cat start-server.ts | grep clientPath
# Should be 'dist/frontend'
```

**Check Browser Console**:
- Open dev tools → Console
- Look for 404 errors
- Check for JS errors

**Verify Server Serving Static Files**:
```bash
curl http://localhost:3000/
# Should return HTML
```

### Frontend Changes Not Appearing

**Rebuild Required**:
```bash
bun run build:frontend
```

**Restart Server**:
```bash
bun run start
```

**Note**: Server does NOT hot-reload frontend.

**Clear Browser Cache**:
- Hard refresh: Cmd+Shift+R (Mac) / Ctrl+Shift+R (Windows)
- Or clear cache manually

### WebSocket Not Connecting

**Check Browser Console**:
- Dev tools → Network → WS tab
- Look for WebSocket connection
- Check for errors

**Verify Socket.IO Server Running**:
```bash
curl http://localhost:3000/socket.io/
# Should return "Welcome to socket.io"
```

**Check CORS**:
- Frontend and backend must be same origin
- Or configure CORS in server

**Common Causes**:
- Server not running
- Wrong server URL
- CORS issues
- Firewall blocking WebSocket

## Database Issues

### Database Errors on Startup

**Check Database Config** (in `.env`):
```bash
# PGlite (default)
DATABASE_URL=  # Leave empty for PGlite

# PostgreSQL
DATABASE_URL=postgresql://user:password@localhost:5432/dbname
```

**PGlite Issues**:
- Check disk space
- Verify write permissions in project dir

**PostgreSQL Issues**:
- Verify database exists
- Check credentials
- Ensure PostgreSQL running

## Plugin Issues

### Plugin Service Not Initializing

**Check Service Registration**:
```bash
cat src/plugins/plugin-name/src/index.ts
# Verify services: [MyService]
```

**Check Service Constructor**:
- Must extend `Service` from `@elizaos/core`
- Must have `serviceType` static property

**Enable Debug Logging**:
```bash
LOG_LEVEL=debug bun run start
# Look for service initialization messages
```

### Plugin Action Not Executing

**Check Action Registration**:
```bash
cat src/plugins/plugin-name/src/index.ts
# Verify actions: [myAction]
```

**Check `validate` Function**:
- Must return `true` for action to be available
- Check required services exist

**Check Handler Implementation**:
- Must return `ActionResult`
- Must handle errors gracefully

## Performance Issues

### Slow LLM Responses

**Check LLM Provider**:
- Some models slower than others
- Check provider status/latency

**Reduce Context Size**:
- Fewer message examples in character
- Shorter system prompt
- Fewer providers

**Use Faster Model**:
```bash
# In .env
OPENAI_MODEL=gpt-4o-mini  # Faster, cheaper
```

### High Memory Usage

**Check Message History**:
- Database growing large
- Consider pruning old messages

**Check Plugin Memory Leaks**:
- Review service implementations
- Ensure cleanup in destructors

## Debugging Tips

### Enable Debug Logging

```bash
LOG_LEVEL=debug bun run start
```

### Check Server Logs

Look for:
- Action execution
- Parameter parsing
- Service initialization
- LLM calls
- Errors/warnings

### Add Console Logging

**In Action Handler**:
```typescript
console.log('Params:', params);
console.log('State:', composedState?.data);
```

**In Service**:
```typescript
console.log('[ServiceName] Initializing...');
```

### Test Action Manually

**Call API Directly**:
```bash
curl -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"channelId": "...", "text": "swap 1 eth to usdc"}'
```

### Check Database State

**PGlite**: Database files in project directory
**PostgreSQL**: Use `psql` or database client

## Getting Help

**Check Logs First**:
```bash
LOG_LEVEL=debug bun run start
```

**Verify Environment**:
```bash
bun --version  # 1.2.21+
node --version  # If using npm packages
```

**Check Recent Changes**:
```bash
git diff  # What changed recently?
git log --oneline -5  # Recent commits
```

**Isolate the Issue**:
- Does it work on a fresh clone?
- Does it work after clean rebuild?
- Does it work with minimal config?
