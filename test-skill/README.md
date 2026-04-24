# Promptfoo agent evaluation

## Quick start

1. Set your API key (if using a cloud provider):

```bash
export OPENAI_API_KEY=sk-...
# Or for other providers:
# export ANTHROPIC_API_KEY=sk-ant-...
# export GOOGLE_API_KEY=...
```

2. Edit `promptfooconfig.yaml` to customize prompts, providers, and test cases.

   The config defines two providers — `anthropic:claude-agent-sdk` and
   `openai:codex-sdk`. By default `promptfoo eval` runs every test against both.

   Codex-specific prerequisites:
   - authenticate `codex` first, or export `OPENAI_API_KEY` / `CODEX_API_KEY`
   - install `@openai/codex-sdk` in the environment where `promptfoo` runs if it
     is not already present

3. Run the evaluation:

```bash
# Run against both providers
promptfoo eval

# Run against Claude Agent SDK only (e.g. when Codex quota is exhausted)
promptfoo eval --filter-providers claude-agent-sdk

# Run against Codex SDK only
promptfoo eval --filter-providers codex-sdk
```

`--filter-providers` takes a regex matched against each provider's `id` or
`label`, so any substring that uniquely identifies one provider works.

The eval harness starts a local fixture server automatically. By default it
binds `http://127.0.0.1:4173`; override it with:

```bash
export TEST_SKILL_FIXTURE_BASE_URL=http://127.0.0.1:4173
export TEST_SKILL_FIXTURE_PORT=4173
```

The harness writes local debug artifacts to `test-skill/.tmp/`:
- `fixture-log.json` — sanitized fixture request log
- `harness-log.jsonl` — fixture lifecycle events
- `hook-events.jsonl` — promptfoo hook lifecycle events
- `latest-promptfoo-debug.log` / `latest-promptfoo-error.log` — copied promptfoo logs for the latest run

4. View results in your browser:

```bash
promptfoo view
```

## Learn more

- Configuration guide: https://promptfoo.dev/docs/configuration/guide
- All providers: https://promptfoo.dev/docs/providers
- Assertions & metrics: https://promptfoo.dev/docs/configuration/expected-outputs
- Examples: https://github.com/promptfoo/promptfoo/tree/main/examples
