# AI Agent Integration for REN360 Repository Manager

The repo-manager now includes an integrated AI agent powered by Anthropic's Claude for automated PR analysis and code review.

## Setup

### 1. Configure API Key

Run the interactive setup:

```bash
node repo-manager.js setup-ai
```

Or manually create a `.env` file:

```bash
cp .env.example .env
# Edit .env and add your Anthropic API key
```

### 2. Get an API Key

1. Go to https://console.anthropic.com/settings/keys
2. Create a new API key
3. Add it to your `.env` file

## Usage

### Basic PR Review with AI

```bash
# Find all PRs for a ticket and get AI analysis
node repo-manager.js review 1234 --analyze
```

This will:
- Find all PRs across repos for REN-1234
- Send PR data to Claude for analysis
- Display comprehensive review including:
  - Security vulnerabilities
  - Performance concerns
  - Code quality issues
  - Testing recommendations
  - Architectural impacts

### Advanced Features

The AI agent analyzes:

1. **Security Audit**
   - SQL injection risks
   - XSS vulnerabilities
   - Authentication issues
   - Input validation
   - Sensitive data exposure

2. **Code Quality**
   - Anti-patterns and code smells
   - DRY principle violations
   - Function complexity
   - Error handling

3. **Performance**
   - Database query optimization
   - Caching opportunities
   - Potential bottlenecks

4. **Testing**
   - Suggested test cases
   - Edge case coverage
   - Integration test needs

5. **Architecture**
   - Breaking changes
   - Design pattern compliance
   - Service dependencies

## Models

You can choose between three Claude models:

- **claude-3-opus-20240229**: Most capable, best for complex analysis
- **claude-3-sonnet-20240229**: Balanced performance (default)
- **claude-3-haiku-20240307**: Fastest, good for quick reviews

## Cost Considerations

- Each PR review uses approximately 1,000-4,000 tokens
- Costs vary by model (Haiku < Sonnet < Opus)
- The agent is optimized to minimize token usage

## Troubleshooting

### API Key Issues
- Ensure your API key starts with `sk-ant-`
- Check API key permissions in Anthropic console
- Verify billing is set up

### Network Issues
- The agent requires HTTPS access to api.anthropic.com
- Check firewall/proxy settings

### Rate Limits
- Anthropic has rate limits per API key
- If you hit limits, wait a few minutes

## Privacy & Security

- Your code is sent to Anthropic's API for analysis
- API keys are stored locally in `.env` (gitignored)
- Analysis results are saved locally in `/tmp/`
- No data is stored permanently by the tool

## Examples

```bash
# Basic review
node repo-manager.js review 1234

# With AI analysis
node repo-manager.js review 1234 --analyze

# Setup AI configuration
node repo-manager.js setup-ai

# Check if AI is configured
cat .env | grep ANTHROPIC_API_KEY
```