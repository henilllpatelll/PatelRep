"""
Graphify incremental auto-update.
Runs on Stop hook — only re-extracts changed code files (no LLM needed).
If docs/images changed, prints a reminder to run /graphify . --update manually.
"""
import sys
import io
import json
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

OUT = Path("graphify-out")

if not (OUT / "graph.json").exists():
    print("[graphify] No graph found — run /graphify . to build first.")
    sys.exit(0)

try:
    from graphify.detect import detect_incremental, save_manifest
    from graphify.extract import collect_files, extract
    from graphify.build import build_from_json
    from graphify.cluster import cluster, score_all
    from graphify.analyze import god_nodes, surprising_connections, suggest_questions
    from graphify.report import generate
    from graphify.export import to_json, to_html
    from networkx.readwrite import json_graph
    import networkx as nx
except ImportError as e:
    print(f"[graphify] Import error: {e}")
    sys.exit(0)

CODE_EXTS = {
    ".py", ".ts", ".tsx", ".js", ".jsx", ".sql", ".go", ".rs",
    ".java", ".kt", ".cs", ".cpp", ".c", ".rb", ".swift", ".scala",
    ".php", ".kts", ".lua",
}

try:
    result = detect_incremental(Path("."))
    new_files = result.get("new_files", {})
    deleted = list(result.get("deleted_files", []))
    all_changed = [f for files in new_files.values() for f in files]

    if not all_changed and not deleted:
        sys.exit(0)

    code_only = all(Path(f).suffix.lower() in CODE_EXTS for f in all_changed)

    if not code_only:
        non_code = [f for f in all_changed if Path(f).suffix.lower() not in CODE_EXTS]
        print(f"[graphify] {len(non_code)} doc/image file(s) changed — run /graphify . --update for full semantic refresh.")
        # Still re-extract code changes below
        all_changed = [f for f in all_changed if Path(f).suffix.lower() in CODE_EXTS]
        if not all_changed and not deleted:
            sys.exit(0)

    print(f"[graphify] {len(all_changed)} code file(s) changed, {len(deleted)} deleted — updating graph...")

    # Load existing graph
    existing_data = json.loads((OUT / "graph.json").read_text(encoding="utf-8"))
    G_existing = json_graph.node_link_graph(existing_data, edges="links")

    # Prune deleted nodes
    if deleted:
        deleted_set = set(deleted)
        to_remove = [n for n, d in G_existing.nodes(data=True) if d.get("source_file") in deleted_set]
        G_existing.remove_nodes_from(to_remove)
        if to_remove:
            print(f"[graphify] Pruned {len(to_remove)} node(s) from {len(deleted)} deleted file(s).")

    # AST re-extraction on changed code files
    if all_changed:
        code_paths = [Path(f) for f in all_changed if Path(f).exists()]
        if code_paths:
            new_extract = extract(code_paths)
            from graphify.build import build_from_json as bfj
            G_new = bfj(new_extract)
            G_existing.update(G_new)

    # Rebuild communities + report
    communities = cluster(G_existing)
    cohesion = score_all(G_existing, communities)

    # Reuse existing labels if available
    labels_path = OUT / ".graphify_labels_saved.json"
    if labels_path.exists():
        labels_raw = json.loads(labels_path.read_text(encoding="utf-8"))
        labels = {int(k): v for k, v in labels_raw.items()}
    else:
        labels = {cid: f"Community {cid}" for cid in communities}

    gods = god_nodes(G_existing)
    surprises = surprising_connections(G_existing, communities)
    questions = suggest_questions(G_existing, communities, labels)
    detection = {"total_files": 0, "total_words": 0, "needs_graph": True, "warning": None,
                 "files": {"code": [], "document": [], "paper": []}}
    tokens = {"input": 0, "output": 0}

    report = generate(G_existing, communities, cohesion, labels, gods, surprises,
                      detection, tokens, ".", suggested_questions=questions)
    (OUT / "GRAPH_REPORT.md").write_text(report, encoding="utf-8")
    to_json(G_existing, communities, str(OUT / "graph.json"))

    if G_existing.number_of_nodes() <= 5000:
        to_html(G_existing, communities, str(OUT / "graph.html"),
                community_labels=labels if labels else None)

    save_manifest(result["files"])
    print(f"[graphify] Graph updated — {G_existing.number_of_nodes()} nodes, {G_existing.number_of_edges()} edges.")

except Exception as e:
    print(f"[graphify] Auto-update failed: {e}")
    sys.exit(0)
