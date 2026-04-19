import asyncio
from nanobot.platform.knowledge.service import KnowledgeService
from nanobot.platform.knowledge.rag_engine import RAGEngine
import logging

logging.basicConfig(level=logging.ERROR)

async def main():
    service = KnowledgeService()
    rag_engine = service.rag_engine
    
    kb1 = "knowledge-base-2"
    kb2 = "knowledge-base"
    
    print(f"Fetching {kb1}...")
    graph1 = await rag_engine.get_knowledge_graph(kb1)
    nodes1 = graph1.get("nodes", [])
    print(f"Nodes in {kb1}: {len(nodes1)}")
    for n in nodes1[:3]: print(n["title"])
    
    print(f"\nFetching {kb2}...")
    graph2 = await rag_engine.get_knowledge_graph(kb2)
    nodes2 = graph2.get("nodes", [])
    print(f"Nodes in {kb2}: {len(nodes2)}")
    for n in nodes2[:3]: print(n["title"])

asyncio.run(main())
