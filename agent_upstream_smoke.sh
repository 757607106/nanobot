#!/usr/bin/env bash

set -euo pipefail

cd "$(dirname "$0")"

python3 -m pytest \
  tests/agent/test_runner.py \
  tests/agent/test_task_cancel.py \
  tests/agent/test_context_prompt_cache.py \
  tests/agent/test_loop_consolidation_tokens.py \
  tests/knowledge/test_agent_knowledge_binding.py \
  tests/knowledge/test_rag_engine.py \
  tests/knowledge/test_knowledge_bases.py \
  tests/harness/test_context.py \
  tests/web/test_api.py \
  tests/web/test_api_knowledge_workspace.py \
  tests/web/test_services.py \
  tests/web/test_channel_runtime_service.py \
  tests/web/test_schedule_runtime.py \
  tests/cli/test_commands.py \
  tests/cli/test_platform_runtime.py \
  tests/cli/test_restart_command.py \
  -q
