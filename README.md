# DagScout — VS Code Extension

DagScout scans common pipeline files (Airflow-like Python DAGs, Prefect tasks, dbt models, GitHub Actions) and renders an interactive DAG visualization inside VS Code.

## Development

1. `npm install`
2. `npm run compile`
3. Press F5 in VS Code to launch the Extension Development Host.
4. Run the command **DagScout: Open Pipeline Graph** from the Command Palette.

## Notes & next steps

- Current parsers use heuristics / regexes. For production (Marketplace) we should swap these for robust parsers:
  - Use Python `ast` for Airflow DAG detection (exact line numbers).
  - Or use tree-sitter for cross-language AST parsing.
- Ship mermaid locally and tighten Content Security Policy before publishing.
- Add unit tests, example fixtures, icons, and a CI/CD pipeline to build and publish to Marketplace.
