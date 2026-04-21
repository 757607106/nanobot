"""FastAPI app factory and frontend serving for the nanobot Web UI."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from loguru import logger
from starlette.exceptions import HTTPException as StarletteHTTPException

from nanobot import __version__
from nanobot.config.loader import get_config_path
from nanobot.config.schema import Config
from nanobot.platform.agents import AgentDefinitionService, AgentDefinitionStore
from nanobot.platform.channel_audit import ChannelAuditService, ChannelAuditStore
from nanobot.platform.channel_bindings import ChannelBindingService, ChannelBindingStore
from nanobot.platform.instances import PlatformInstanceService
from nanobot.platform.knowledge import KnowledgeBaseService
from nanobot.platform.knowledge.rag_engine import create_rag_engine_from_config
from nanobot.platform.knowledge.store import create_knowledge_store
from nanobot.platform.memory import MemoryService
from nanobot.platform.runs import RunService, RunStore
from nanobot.platform.tenants import TenantService, TenantStore
from nanobot.web.channels import WebChannelService
from nanobot.web.frontend import (
    _frontend_dev_is_ready,
    _resolve_frontend_source_dir,
    _resolve_npm_command,
    _resolve_static_dir,
    _static_response,
)
from nanobot.web.frontend import (
    _run_frontend_dev_server as _frontend_run_frontend_dev_server,
)
from nanobot.web.frontend import (
    _run_static_server as _frontend_run_static_server,
)
from nanobot.web.http import APIError, _err, _json_response
from nanobot.web.routers import (
    agent_chat_router,
    agents_router,
    auth_router,
    channel_audit_router,
    channel_bindings_router,
    channels_router,
    chat_router,
    dashboard_router,
    knowledge_router,
    mcp_router,
    operations_router,
    runs_router,
    schedule_router,
    setup_router,
    tenants_router,
    workspace_router,
)
from nanobot.web.runtime import WebAppState
from nanobot.web.services import (
    SESSION_COOKIE_NAME,
    MCPRepositoryService,
    MCPServerService,
    WebAuthManager,
    WebChannelTestService,
    WebMCPRegistryManager,
    WebOperationsService,
    WebSetupManager,
    WebWhatsAppBindingService,
)
from nanobot.web.tenant_context import tenant_auth_middleware


def create_app(config: Config, static_dir: Path | None = None) -> FastAPI:
    """Create the FastAPI app for the Web UI."""
    resolved_static_dir = static_dir or _resolve_static_dir()
    instance = PlatformInstanceService().get_default_instance(get_config_path())
    auth = WebAuthManager(instance)
    mcp_registry = WebMCPRegistryManager(instance)
    mcp_repository = MCPRepositoryService(instance, mcp_registry)
    mcp_servers = MCPServerService(instance, mcp_registry)
    channels = WebChannelService()
    channel_tests = WebChannelTestService(instance)
    whatsapp_binding = WebWhatsAppBindingService(instance)
    from nanobot.web.services.weixin_binding import WebWeixinBindingService
    weixin_binding = WebWeixinBindingService()
    setup = WebSetupManager(instance)
    operations = WebOperationsService(setup, mcp_registry, instance)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.instance = instance
        app.state.web = WebAppState(config, instance=instance, runs=runs)
        app.state.static_dir = resolved_static_dir
        app.state.auth = auth
        app.state.mcp_registry = mcp_registry
        app.state.mcp_repository = mcp_repository
        app.state.mcp_servers = mcp_servers
        app.state.channels = channels
        app.state.channel_tests = channel_tests
        app.state.whatsapp_binding = whatsapp_binding
        app.state.weixin_binding = weixin_binding
        app.state.operations = operations
        app.state.agents = agents
        app.state.knowledge = knowledge
        app.state.memory = memory
        app.state.runs = runs
        app.state.setup = setup
        app.state.tenants_service = tenants_service
        app.state.channel_bindings_service = channel_bindings_service
        app.state.channel_audit_service = channel_audit_service
        try:
            app.state.web.app_agents = agents
            app.state.web.app_knowledge = knowledge
            app.state.web.app_memory = memory
            app.state.web.channel_bindings_service = channel_bindings_service
            app.state.web.channel_audit_service = channel_audit_service
            app.state.web.channel_runtime.start()
            yield
        finally:
            app.state.whatsapp_binding.shutdown()
            app.state.weixin_binding.shutdown()
            app.state.knowledge.shutdown()
            await app.state.web.shutdown_async()

    app = FastAPI(title="nanobot Web UI", version=__version__, lifespan=lifespan)
    agents = AgentDefinitionService(
        AgentDefinitionStore(instance.agent_definitions_db_path()),
        instance_id=instance.id,
        config_loader=lambda: getattr(getattr(app.state, "web", None), "config", config),
    )
    rag_engine = create_rag_engine_from_config(config, instance.data_dir)
    knowledge = KnowledgeBaseService(
        create_knowledge_store(config, instance),
        instance=instance,
        instance_id=instance.id,
        rag_engine=rag_engine,
        config=config,
    )
    memory = MemoryService(
        instance=instance,
        instance_id=instance.id,
        agent_lookup=agents.require_agent,
    )
    runs = RunService(
        RunStore(instance.agent_runs_db_path()),
        instance_id=instance.id,
        artifact_dir=instance.agent_artifacts_dir(),
    )
    tenants_service = TenantService(TenantStore(instance.tenants_db_path()))
    runs.bind_tenant_settings_loader(lambda tenant_id: tenants_service.get_tenant(tenant_id))
    runs.bind_definition_policy_loaders(
        agent_loader=lambda agent_id, tenant_id=None: agents.get_agent(agent_id, tenant_id=tenant_id),
    )
    channel_bindings_service = ChannelBindingService(
        ChannelBindingStore(instance.channel_bindings_db_path()),
        instance_id=instance.id,
        agent_lookup=agents.require_agent,
    )
    channel_audit_service = ChannelAuditService(
        ChannelAuditStore(instance.channel_audit_db_path()),
        instance_id=instance.id,
    )
    app.state.instance = instance
    app.state.auth = auth
    app.state.mcp_registry = mcp_registry
    app.state.mcp_repository = mcp_repository
    app.state.mcp_servers = mcp_servers
    app.state.channels = channels
    app.state.channel_tests = channel_tests
    app.state.whatsapp_binding = whatsapp_binding
    app.state.operations = operations
    app.state.agents = agents
    app.state.knowledge = knowledge
    app.state.memory = memory
    app.state.runs = runs
    app.state.setup = setup
    app.state.tenants_service = tenants_service
    app.state.channel_bindings_service = channel_bindings_service
    app.state.channel_audit_service = channel_audit_service

    @app.exception_handler(APIError)
    async def handle_api_error(_request: Request, exc: APIError) -> JSONResponse:
        return _json_response(exc.status_code, _err(exc.code, exc.message, exc.details))

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _json_response(
            422,
            _err("VALIDATION_ERROR", "Request validation failed.", exc.errors()),
        )

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_exception(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == 404:
            return _json_response(404, _err("NOT_FOUND", "Endpoint not found."))
        return _json_response(
            exc.status_code,
            _err("HTTP_ERROR", str(exc.detail or "Request failed."), exc.detail),
        )

    @app.middleware("http")
    async def enforce_web_auth(request: Request, call_next):
        path = request.url.path
        if request.method == "OPTIONS":
            return await call_next(request)
        if not path.startswith("/api/v1/"):
            return await call_next(request)
        if path == "/api/v1/health" or path.startswith("/api/v1/auth/"):
            response = await call_next(request)
            if path.startswith("/api/v1/auth/"):
                response.headers["Cache-Control"] = "no-store"
            return response
        # If tenant context was set via API key, skip cookie auth
        tenant_ctx = getattr(request.state, "tenant", None)
        if tenant_ctx is not None and tenant_ctx.key_id is not None:
            return await call_next(request)
        if not request.app.state.auth.get_authenticated_user(request.cookies.get(SESSION_COOKIE_NAME)):
            return _json_response(401, _err("AUTH_REQUIRED", "Authentication required."))
        return await call_next(request)

    # Tenant auth middleware runs before enforce_web_auth (registered after = runs first)
    app.middleware("http")(tenant_auth_middleware)

    app.include_router(agents_router)
    app.include_router(agent_chat_router)
    app.include_router(auth_router)
    app.include_router(dashboard_router)
    app.include_router(setup_router)
    app.include_router(mcp_router)
    app.include_router(channels_router)
    app.include_router(channel_audit_router)
    app.include_router(channel_bindings_router)
    app.include_router(knowledge_router)

    app.include_router(operations_router)
    app.include_router(runs_router)
    app.include_router(schedule_router)
    app.include_router(workspace_router)
    app.include_router(tenants_router)
    app.include_router(chat_router)

    @app.api_route(
        "/api/{path:path}",
        methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"],
        include_in_schema=False,
    )
    def unknown_api_route(path: str):
        _ = path
        raise APIError(404, "NOT_FOUND", "Endpoint not found.")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_frontend(request: Request, full_path: str = ""):
        if full_path.startswith("api/"):
            raise APIError(404, "NOT_FOUND", "Endpoint not found.")
        return _static_response(request.app.state.static_dir, full_path)

    return app


def run_server(
    config: Config,
    host: str = "127.0.0.1",
    port: int = 6788,
    frontend_mode: Literal["auto", "static", "dev"] = "auto",
) -> None:
    """Run the Web UI server in static or hot-reload dev mode."""
    frontend_dir = _resolve_frontend_source_dir()
    npm_command = _resolve_npm_command()
    dev_ready, dev_reason = _frontend_dev_is_ready(frontend_dir, npm_command)

    if frontend_mode == "dev":
        if not dev_ready:
            raise RuntimeError(
                "Frontend dev mode requires the web-ui source checkout, npm, and installed "
                "dependencies. Run `cd web-ui && npm install` first."
            )
        _run_frontend_dev_server(config, host, port, frontend_dir, npm_command)
        return

    if frontend_mode == "auto" and dev_ready:
        _run_frontend_dev_server(config, host, port, frontend_dir, npm_command)
        return

    if frontend_mode == "auto" and dev_reason:
        logger.info("Frontend dev mode unavailable ({}); falling back to static bundle.", dev_reason)

    _run_static_server(config, host, port)


def _run_static_server(config: Config, host: str, port: int) -> None:
    _frontend_run_static_server(create_app, config, host, port)


def _run_frontend_dev_server(
    config: Config,
    host: str,
    port: int,
    frontend_dir: Path,
    npm_command: str,
) -> None:
    _frontend_run_frontend_dev_server(create_app, config, host, port, frontend_dir, npm_command)


__all__ = [
    "WebAppState",
    "create_app",
    "run_server",
]
