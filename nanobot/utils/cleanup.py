"""Garbage collection utilities for Nanobot."""

import shutil
import time
from pathlib import Path

from loguru import logger


def cleanup_isolated_workspaces(
    root_workspace: Path,
    ttl_days: int = 7,
    test_ttl_hours: int = 1,
) -> int:
    """Clean up old thread/agent isolated workspaces from the disk.
    
    Returns:
        The number of deleted directories.
    """
    tenants_dir = root_workspace / ".nanobot" / "workspaces" / "tenants"
    if not tenants_dir.exists():
        return 0

    deleted_count = 0
    now = time.time()

    # Iterate through: tenants/{tenant_id}/{instance_id}/agents/{agent_id}/threads/{thread_id}
    # We will search for all 'threads/*' directories.
    for tenant_path in tenants_dir.iterdir():
        if not tenant_path.is_dir():
            continue
        for instance_path in tenant_path.iterdir():
            if not instance_path.is_dir():
                continue
            agents_dir = instance_path / "agents"
            if not agents_dir.exists():
                continue

            for agent_path in agents_dir.iterdir():
                if not agent_path.is_dir():
                    continue
                threads_dir = agent_path / "threads"
                if not threads_dir.exists():
                    continue

                for thread_path in threads_dir.iterdir():
                    if not thread_path.is_dir():
                        continue

                    try:
                        mtime = thread_path.stat().st_mtime
                        age_hours = (now - mtime) / 3600
                    except Exception:
                        continue

                    is_test = "agent-test" in thread_path.name or "test" in thread_path.name

                    if is_test and age_hours > test_ttl_hours:
                        logger.info("Garbage collecting test workspace: {} (age: {:.1f} h)", thread_path.name, age_hours)
                        shutil.rmtree(thread_path, ignore_errors=True)
                        deleted_count += 1
                    elif age_hours > (ttl_days * 24):
                        logger.info("Garbage collecting old workspace: {} (age: {:.1f} d)", thread_path.name, age_hours / 24)
                        shutil.rmtree(thread_path, ignore_errors=True)
                        deleted_count += 1

    return deleted_count
