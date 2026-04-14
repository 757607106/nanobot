from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
import sys
import time
import uuid
from pathlib import Path
from typing import Any

from pymilvus import MilvusClient

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nanobot.config.loader import load_config, save_config
from nanobot.harness import QueryKnowledgeBaseTool, build_knowledge_binding_context
from nanobot.platform.instances import PlatformInstance
from nanobot.platform.knowledge.rag_engine import create_rag_engine_from_config
from nanobot.platform.knowledge.service import KnowledgeBaseService
from nanobot.platform.knowledge.store import create_knowledge_store


def _normalize_milvus_config(config: Any) -> dict[str, Any]:
    rag_milvus = config.rag.milvus
    return {
        "uri": str(getattr(rag_milvus, "uri", "") or "").strip(),
        "db_name": str(getattr(rag_milvus, "db_name", "") or "").strip() or None,
        "user": str(getattr(rag_milvus, "user", "") or "").strip() or None,
        "password": str(getattr(rag_milvus, "password", "") or "").strip() or None,
        "token": str(getattr(rag_milvus, "token", "") or "").strip() or None,
    }


def _connect_milvus(config: Any) -> MilvusClient:
    params = _normalize_milvus_config(config)
    db_name = params.pop("db_name", None)
    connection_kwargs = {key: value for key, value in params.items() if value}
    client = MilvusClient(**connection_kwargs)
    if not db_name:
        return client

    existing_databases = {str(item) for item in client.list_databases()}
    if db_name not in existing_databases:
        client.create_database(db_name)

    use_database = getattr(client, "use_database", None) or getattr(client, "using_database", None)
    if callable(use_database):
        use_database(db_name)
        return client

    return MilvusClient(**{**connection_kwargs, "db_name": db_name})


def _list_collections(client: MilvusClient) -> list[str]:
    collections = client.list_collections()
    return sorted(str(item) for item in collections)


def _wait_for_job(service: KnowledgeBaseService, kb_id: str, job_id: str, *, timeout: float = 180.0) -> dict[str, Any]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        jobs = {str(item.get("jobId") or ""): item for item in service.list_jobs(kb_id)}
        job = jobs.get(job_id)
        if job is None:
            raise RuntimeError(f"knowledge job {job_id} disappeared")
        status = str(job.get("status") or "").strip().lower()
        if status not in {"queued", "running"}:
            return job
        time.sleep(1.0)
    raise TimeoutError(f"knowledge job {job_id} did not finish within {timeout:.0f}s")


async def _run_agent_tool(service: KnowledgeBaseService, kb_id: str, kb_name: str, query_text: str) -> str:
    binding_context = build_knowledge_binding_context(service, [kb_id])
    if binding_context is None:
        raise RuntimeError("failed to build knowledge binding context")
    tool = QueryKnowledgeBaseTool(binding_context)
    return await tool.execute(kb_name=kb_name, query_text=query_text, limit=4)


def _sanitize_workspace_id(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_]+", "_", str(value or "").strip()).strip("_")
    return normalized or "knowledge"


def _read_json_file(path: Path) -> Any:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _collect_runtime_snapshot(runtime_root: Path, kb_id: str) -> dict[str, Any]:
    workspace = f"kb_{_sanitize_workspace_id(kb_id)}"
    base_dir = runtime_root / "knowledge" / "lightrag" / kb_id / workspace
    doc_status_path = base_dir / "kv_store_doc_status.json"
    full_docs_path = base_dir / "kv_store_full_docs.json"
    return {
        "workspaceDir": str(base_dir),
        "docStatus": _read_json_file(doc_status_path),
        "fullDocs": _read_json_file(full_docs_path),
    }


def _collect_collection_stats(client: MilvusClient, collections: list[str]) -> dict[str, Any]:
    stats: dict[str, Any] = {}
    for name in collections:
        try:
            stats[name] = client.get_collection_stats(name)
        except Exception as exc:
            stats[name] = {"error": str(exc)}
    return stats


async def _run_provider_preflight(rag_engine: Any, *, timeout: float) -> dict[str, Any]:
    result: dict[str, Any] = {}

    embedding_func = rag_engine._build_embedding_func()
    llm_func = rag_engine._build_llm_func()

    try:
        embedding_response = await asyncio.wait_for(
            embedding_func.func(["Knowledge smoke preflight"]),
            timeout=timeout,
        )
        result["embedding"] = {
            "ok": True,
            "shape": list(getattr(embedding_response, "shape", [])),
        }
    except Exception as exc:
        result["embedding"] = {
            "ok": False,
            "error": str(exc),
        }

    try:
        llm_response = await asyncio.wait_for(
            llm_func("用一句中文短句回复：preflight-ok"),
            timeout=timeout,
        )
        result["llm"] = {
            "ok": True,
            "preview": str(llm_response or "")[:200],
        }
    except Exception as exc:
        result["llm"] = {
            "ok": False,
            "error": str(exc),
        }

    return result


def _prepare_runtime(config_path: Path, runtime_root: Path) -> tuple[PlatformInstance, Any]:
    source_config = load_config(config_path)
    runtime_root.mkdir(parents=True, exist_ok=True)
    instance_config_path = runtime_root / "config.json"
    save_config(source_config, instance_config_path)
    instance = PlatformInstance(
        id="kb-live-smoke",
        label="KB Live Smoke",
        config_path=instance_config_path,
    )
    instance.bind()
    return instance, instance.load_config()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a live LightRAG -> external Milvus smoke test.")
    parser.add_argument(
        "--config",
        default=str(Path.home() / ".nanobot" / "config.json"),
        help="Source nanobot config file.",
    )
    parser.add_argument(
        "--runtime-root",
        default="/tmp/nanobot-live-external-milvus-smoke",
        help="Temporary runtime root used for the smoke instance.",
    )
    parser.add_argument(
        "--keep-runtime",
        action="store_true",
        help="Keep the temporary runtime directory for inspection.",
    )
    parser.add_argument(
        "--provider-timeout",
        type=float,
        default=45.0,
        help="Timeout in seconds for embedding / LLM preflight calls.",
    )
    parser.add_argument(
        "--ingest-timeout",
        type=float,
        default=300.0,
        help="Timeout in seconds for the ingest job.",
    )
    args = parser.parse_args()

    config_path = Path(args.config).expanduser().resolve()
    runtime_root = Path(args.runtime_root).expanduser().resolve() / uuid.uuid4().hex[:10]
    service: KnowledgeBaseService | None = None

    try:
        instance, config = _prepare_runtime(config_path, runtime_root)
        rag_engine = create_rag_engine_from_config(config, instance.data_dir)
        if rag_engine is None:
            raise RuntimeError("LightRAG is not installed in this environment.")

        store = create_knowledge_store(config, instance)
        service = KnowledgeBaseService(
            store,
            instance=instance,
            instance_id=instance.id,
            rag_engine=rag_engine,
            config=config,
        )
        provider_preflight = asyncio.run(
            _run_provider_preflight(rag_engine, timeout=float(args.provider_timeout))
        )

        milvus_client = _connect_milvus(config)
        collections_before = set(_list_collections(milvus_client))

        kb_name = f"live-smoke-{uuid.uuid4().hex[:8]}"
        kb = service.create_knowledge_base(
            {
                "name": kb_name,
                "description": "Live smoke knowledge base for external Milvus validation.",
                "query_params": {
                    "mode": "mix",
                    "top_k": 6,
                    "chunk_top_k": 8,
                    "only_need_context": False,
                    "only_need_prompt": False,
                    "enable_rerank": False,
                },
            }
        )
        kb_id = str(kb["kbId"])

        source_file = service.add_source_file(
            kb_id,
            {
                "sourceType": "faq_table",
                "title": "ops-faq",
                "items": [
                    {
                        "question": "如何重启 nanobot？",
                        "answer": "先检查 service health，然后执行 supervisorctl restart nanobot。",
                    },
                    {
                        "question": "How do we restart nanobot?",
                        "answer": "Check service health first, then run supervisorctl restart nanobot.",
                    },
                    {
                        "question": "如何清理缓存？",
                        "answer": "先执行 cache warmup，再触发 cache reset 任务。",
                    },
                ],
            },
        )
        file_id = str(source_file["fileId"])

        ingest = service.ingest_files(
            kb_id,
            {
                "file_ids": [file_id],
                "params": {
                    "auto_index": True,
                    "chunk_size": 500,
                    "chunk_overlap": 50,
                },
            },
        )
        ingest_job_id = str(ingest["job"]["jobId"])
        try:
            ingest_job = _wait_for_job(
                service,
                kb_id,
                ingest_job_id,
                timeout=float(args.ingest_timeout),
            )
        except TimeoutError as exc:
            collections_after_timeout = set(_list_collections(milvus_client))
            created_collections = sorted(collections_after_timeout - collections_before)
            result = {
                "success": False,
                "stage": "ingest-timeout",
                "error": str(exc),
                "config": {
                    "milvus": _normalize_milvus_config(config),
                    "graph_store_enabled": bool(getattr(config.rag.graph_store, "enabled", False)),
                    "graph_store_provider": str(getattr(config.rag.graph_store, "provider", "") or ""),
                },
                "providerPreflight": provider_preflight,
                "kb": {
                    "kbId": kb_id,
                    "name": kb_name,
                    "fileId": file_id,
                    "jobId": ingest_job_id,
                },
                "jobs": service.list_jobs(kb_id),
                "files": service.list_files(kb_id),
                "runtimeSnapshot": _collect_runtime_snapshot(runtime_root, kb_id),
                "milvus": {
                    "collectionsBefore": sorted(collections_before),
                    "collectionsCreated": created_collections,
                    "collectionStats": _collect_collection_stats(milvus_client, created_collections),
                },
                "runtimeRoot": str(runtime_root),
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 1

        if str(ingest_job.get("status") or "").strip().lower() != "succeeded":
            collections_after_failure = set(_list_collections(milvus_client))
            created_collections = sorted(collections_after_failure - collections_before)
            result = {
                "success": False,
                "stage": "ingest-failed",
                "config": {
                    "milvus": _normalize_milvus_config(config),
                    "graph_store_enabled": bool(getattr(config.rag.graph_store, "enabled", False)),
                    "graph_store_provider": str(getattr(config.rag.graph_store, "provider", "") or ""),
                },
                "providerPreflight": provider_preflight,
                "kb": {
                    "kbId": kb_id,
                    "name": kb_name,
                    "fileId": file_id,
                    "jobId": ingest_job_id,
                },
                "ingestJob": ingest_job,
                "jobs": service.list_jobs(kb_id),
                "files": service.list_files(kb_id),
                "runtimeSnapshot": _collect_runtime_snapshot(runtime_root, kb_id),
                "milvus": {
                    "collectionsBefore": sorted(collections_before),
                    "collectionsCreated": created_collections,
                    "collectionStats": _collect_collection_stats(milvus_client, created_collections),
                },
                "runtimeRoot": str(runtime_root),
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 1

        query_text = "请告诉我如何重启 nanobot。"
        retrieval_query = service.query_database(
            kb_id,
            {
                "query": query_text,
                "top_k": 4,
                "chunk_top_k": 6,
                "mode": "mix",
                "only_need_context": True,
            },
        )
        answer_query: dict[str, Any] | None = None
        answer_error: str | None = None
        try:
            answer_query = service.query_database(
                kb_id,
                {
                    "query": query_text,
                    "top_k": 4,
                    "chunk_top_k": 6,
                    "mode": "mix",
                    "only_need_context": False,
                    "only_need_prompt": False,
                },
            )
        except Exception as exc:
            answer_error = str(exc)

        retrieve_result = service.retrieve([kb_id], query_text, limit=4)

        agent_tool_output: str | None = None
        agent_tool_error: str | None = None
        try:
            agent_tool_output = asyncio.run(_run_agent_tool(service, kb_id, kb_name, query_text))
        except Exception as exc:
            agent_tool_error = str(exc)

        file_detail = service.get_file_detail(kb_id, file_id)

        collections_after_ingest = set(_list_collections(milvus_client))
        created_collections = sorted(collections_after_ingest - collections_before)

        delete_error: str | None = None
        delete_result = False
        try:
            delete_result = bool(service.delete_knowledge_base(kb_id))
        except Exception as exc:
            delete_error = str(exc)

        collections_after_delete = set(_list_collections(milvus_client))
        leaked_collections = sorted(collections_after_delete - collections_before)

        result = {
            "success": bool(
                str(ingest_job.get("status") or "").lower() == "succeeded"
                and created_collections
                and list((retrieval_query.get("data") or {}).get("chunks") or [])
                and list(retrieve_result.get("hits") or [])
                and delete_result
                and not leaked_collections
            ),
            "config": {
                "milvus": _normalize_milvus_config(config),
                "graph_store_enabled": bool(getattr(config.rag.graph_store, "enabled", False)),
                "graph_store_provider": str(getattr(config.rag.graph_store, "provider", "") or ""),
            },
            "providerPreflight": provider_preflight,
            "kb": {
                "kbId": kb_id,
                "name": kb_name,
                "fileId": file_id,
            },
            "ingestJob": ingest_job,
            "fileDetail": {
                "chunkCount": int(file_detail.get("chunkCount") or 0),
                "hasMarkdownContent": bool(str(file_detail.get("content") or "").strip()),
            },
            "retrievalQuery": {
                "chunkCount": len(list((retrieval_query.get("data") or {}).get("chunks") or [])),
                "referenceCount": len(list((retrieval_query.get("data") or {}).get("references") or [])),
                "message": str(retrieval_query.get("message") or ""),
            },
            "answerQuery": {
                "ok": answer_query is not None,
                "error": answer_error,
                "message": str((answer_query or {}).get("message") or ""),
            },
            "retrieve": {
                "hitCount": len(list(retrieve_result.get("hits") or [])),
                "effectiveMode": retrieve_result.get("effectiveMode"),
            },
            "agentTool": {
                "ok": agent_tool_output is not None,
                "error": agent_tool_error,
                "preview": (agent_tool_output or "")[:500],
            },
            "milvus": {
                "collectionsBefore": sorted(collections_before),
                "collectionsCreated": created_collections,
                "collectionsAfterDelete": sorted(collections_after_delete),
                "leakedCollections": leaked_collections,
            },
            "delete": {
                "ok": delete_result,
                "error": delete_error,
            },
            "runtimeRoot": str(runtime_root),
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result["success"] else 1
    finally:
        if service is not None:
            service.shutdown()
        if not args.keep_runtime:
            shutil.rmtree(runtime_root, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
