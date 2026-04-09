"""Tests for SessionManager isolation across different agent session keys.

Validates that:
- Different session_key values produce fully isolated sessions
- Message persistence is consistent after reload from disk
- Isolated agent sessions don't pollute other session listings
- Deleting one session leaves others intact
"""

from nanobot.session.manager import SessionManager


def test_session_manager_isolates_different_session_keys(tmp_path) -> None:
    """Verify that SessionManager correctly isolates sessions by key."""
    manager = SessionManager(tmp_path)

    # Create two sessions with different keys
    session_1 = manager.get_or_create("web:agent-1")
    session_2 = manager.get_or_create("web:agent-2")

    # Add messages to each session independently
    session_1.add_message("user", "Hello from agent 1")
    session_1.add_message("assistant", "Response from agent 1")
    manager.save(session_1)

    session_2.add_message("user", "Hello from agent 2")
    session_2.add_message("assistant", "Response from agent 2")
    manager.save(session_2)

    # Force disk reload by using a fresh manager instance
    manager2 = SessionManager(tmp_path)
    reloaded_1 = manager2.get_or_create("web:agent-1")
    reloaded_2 = manager2.get_or_create("web:agent-2")

    assert len(reloaded_1.messages) == 2
    assert len(reloaded_2.messages) == 2
    assert reloaded_1.messages[0]["content"] == "Hello from agent 1"
    assert reloaded_2.messages[0]["content"] == "Hello from agent 2"


def test_session_preserves_message_order_after_reload(tmp_path) -> None:
    """Verify that SessionManager preserves message order and content after reload."""
    manager = SessionManager(tmp_path)
    session = manager.get_or_create("web:persistence-test")

    # Simulate multi-turn conversation
    session.add_message("user", "First question")
    session.add_message("assistant", "First answer")
    session.add_message("user", "Follow-up question")
    session.add_message("assistant", "Follow-up answer")
    manager.save(session)

    # Create a new manager instance to force disk reload
    manager2 = SessionManager(tmp_path)
    reloaded = manager2.get_or_create("web:persistence-test")

    assert len(reloaded.messages) == 4
    assert reloaded.messages[0]["content"] == "First question"
    assert reloaded.messages[0]["role"] == "user"
    assert reloaded.messages[1]["content"] == "First answer"
    assert reloaded.messages[1]["role"] == "assistant"
    assert reloaded.messages[2]["content"] == "Follow-up question"
    assert reloaded.messages[3]["content"] == "Follow-up answer"


def test_shared_session_manager_isolates_agent_sessions(tmp_path) -> None:
    """Verify that a shared SessionManager instance correctly isolates
    sessions used by different agents via distinct session keys."""
    shared_manager = SessionManager(tmp_path)

    # Simulate two agents using the same manager with different keys
    agent_1_key = "agent-test:agent-definition-1"
    agent_2_key = "agent-test:agent-definition-2"

    s1 = shared_manager.get_or_create(agent_1_key)
    s1.add_message("user", "Agent 1 task")
    s1.add_message("assistant", "Agent 1 result")
    shared_manager.save(s1)

    s2 = shared_manager.get_or_create(agent_2_key)
    s2.add_message("user", "Agent 2 task")
    s2.add_message("assistant", "Agent 2 result")
    shared_manager.save(s2)

    # Verify they don't cross-contaminate
    all_sessions = shared_manager.list_sessions()
    all_keys = [s["key"] for s in all_sessions]
    assert agent_1_key in all_keys
    assert agent_2_key in all_keys

    # Force reload via new manager
    fresh = SessionManager(tmp_path)
    r1 = fresh.get_or_create(agent_1_key)
    r2 = fresh.get_or_create(agent_2_key)
    assert r1.messages[0]["content"] == "Agent 1 task"
    assert r2.messages[0]["content"] == "Agent 2 task"
    assert len(r1.messages) == 2
    assert len(r2.messages) == 2


def test_mcp_test_sessions_use_distinct_namespace(tmp_path) -> None:
    """Verify that MCP test sessions use a distinct key namespace
    that doesn't collide with regular web sessions."""
    manager = SessionManager(tmp_path)

    # Create a regular web session
    web_session = manager.get_or_create("web:user-chat")
    web_session.add_message("user", "Regular chat message")
    manager.save(web_session)

    # Create an MCP test session (key format used by chat.py)
    mcp_session = manager.get_or_create("mcp-test:filesystem")
    mcp_session.add_message("user", "Test MCP tool")
    manager.save(mcp_session)

    # Verify they exist independently
    all_sessions = manager.list_sessions()
    all_keys = [s["key"] for s in all_sessions]
    assert "web:user-chat" in all_keys
    assert "mcp-test:filesystem" in all_keys

    # Verify content isolation via fresh manager
    manager2 = SessionManager(tmp_path)
    reloaded_web = manager2.get_or_create("web:user-chat")
    reloaded_mcp = manager2.get_or_create("mcp-test:filesystem")
    assert len(reloaded_web.messages) == 1
    assert len(reloaded_mcp.messages) == 1
    assert reloaded_web.messages[0]["content"] == "Regular chat message"
    assert reloaded_mcp.messages[0]["content"] == "Test MCP tool"


def test_session_delete_removes_only_target_session(tmp_path) -> None:
    """Verify that deleting one session doesn't affect others."""
    manager = SessionManager(tmp_path)

    # Create multiple sessions
    s1 = manager.get_or_create("web:keep")
    s1.add_message("user", "Keep this")
    manager.save(s1)

    s2 = manager.get_or_create("web:delete-me")
    s2.add_message("user", "Delete this")
    manager.save(s2)

    # Delete one
    result = manager.delete("web:delete-me")
    assert result is True

    # Verify the other is intact (fresh manager to bypass cache)
    manager2 = SessionManager(tmp_path)
    kept = manager2.get_or_create("web:keep")
    assert len(kept.messages) == 1
    assert kept.messages[0]["content"] == "Keep this"

    # Verify deleted session returns empty on re-create
    deleted = manager2.get_or_create("web:delete-me")
    assert len(deleted.messages) == 0
