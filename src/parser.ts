import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { glob } from 'glob';

export interface ParsedNode {
  id: string;      // mermaid-safe unique id
  label?: string;
}

export interface ParsedEdge {
  from: string;
  to: string;
}

export interface MappingEntry {
  file?: string;
  line?: number;
}

export async function scanWorkspaceForPipelines(
  rootPath: string
): Promise<{
  nodes: ParsedNode[];
  edges: ParsedEdge[];
  mapping: Record<string, MappingEntry>;
}> {
  const nodes: ParsedNode[] = [];
  const edges: ParsedEdge[] = [];
  const mapping: Record<string, MappingEntry> = {};

  // ---------- Python (Airflow / Prefect) ----------
  const dagPy = await glob('**/*_dag.py', { cwd: rootPath, nodir: true, absolute: true });
  const pyFiles = await glob('**/*.py', { cwd: rootPath, nodir: true, absolute: true });

  const toParsePy = new Set<string>(dagPy);
  for (const f of pyFiles) {
    try {
      const c = await fs.readFile(f, 'utf8');
      if (c.includes('DAG(') || c.includes('airflow') || c.includes('@task')) {
        toParsePy.add(f);
      }
    } catch {}
  }

  for (const f of toParsePy) {
    try {
      const content = await fs.readFile(f, 'utf8');
      parseAirflowPython(content, f, nodes, edges, mapping);
      parsePrefect(content, f, nodes, edges, mapping);
    } catch {}
  }

  // ---------- dbt SQL ----------
  const sqlFiles = await glob('**/*.sql', { cwd: rootPath, nodir: true, absolute: true });
  for (const f of sqlFiles) {
    try {
      const content = await fs.readFile(f, 'utf8');
      parseDbtSql(content, f, nodes, edges, mapping);
    } catch {}
  }

  // ---------- YAML (dbt + GitHub Actions) ----------
  const ymlFiles = await glob('**/*.yml', { cwd: rootPath, nodir: true, absolute: true });
  for (const f of ymlFiles) {
    try {
      const content = await fs.readFile(f, 'utf8');
      parseYamlForDbt(content, f, nodes, edges, mapping);
      parseGithubActions(content, f, nodes, edges, mapping);
    } catch {}
  }

  // Deduplicate nodes
  const uniq = new Map<string, ParsedNode>();
  for (const n of nodes) uniq.set(n.id, n);

  return {
    nodes: Array.from(uniq.values()),
    edges,
    mapping
  };
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function nodeId(file: string, key: string) {
  return 'n' + Math.abs(hashCode(`${file}::${key}`));
}

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}

// -----------------------------------------------------------------------------
// Parsers
// -----------------------------------------------------------------------------

function parseAirflowPython(
  content: string,
  file: string,
  nodes: ParsedNode[],
  edges: ParsedEdge[],
  mapping: Record<string, MappingEntry>
) {
  const lines = content.split(/\r?\n/);
  const assignRe = /(\w+)\s*=\s*\w*Operator\(/;
  const vars: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    const m = l.match(assignRe);
    if (m) {
      const name = m[1];
      const id = nodeId(file, name);
      vars[name] = id;
      nodes.push({ id, label: name });
      mapping[id] = { file, line: i + 1 };
    }

    if (l.includes('>>')) {
      const parts = l.split('>>').map(p => p.trim());
      for (let j = 0; j < parts.length - 1; j++) {
        const a = extractVar(parts[j]);
        const b = extractVar(parts[j + 1]);
        if (a && b) {
          const ida = vars[a] ?? nodeId(file, a);
          const idb = vars[b] ?? nodeId(file, b);
          nodes.push({ id: ida, label: a });
          nodes.push({ id: idb, label: b });
          edges.push({ from: ida, to: idb });
        }
      }
    }
  }
}

function extractVar(s: string) {
  const m = s.match(/([A-Za-z_][A-Za-z0-9_]*)/);
  return m ? m[1] : null;
}

function parsePrefect(
  content: string,
  file: string,
  nodes: ParsedNode[],
  edges: ParsedEdge[],
  mapping: Record<string, MappingEntry>
) {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('@task')) {
      const next = lines[i + 1]?.match(/def\s+(\w+)/);
      if (next) {
        const id = nodeId(file, next[1]);
        nodes.push({ id, label: next[1] });
        mapping[id] = { file, line: i + 2 };
      }
    }
  }
}

function parseDbtSql(
  content: string,
  file: string,
  nodes: ParsedNode[],
  edges: ParsedEdge[],
  mapping: Record<string, MappingEntry>
) {
  const refRe = /ref\(["']([\w\.\-_]+)["']\)/g;
  const model = path.basename(file, '.sql');

  const thisId = nodeId(file, model);
  nodes.push({ id: thisId, label: model });
  mapping[thisId] = { file, line: 1 };

  let m: RegExpExecArray | null;
  while ((m = refRe.exec(content))) {
    const target = m[1];
    const tid = nodeId(file, target);
    nodes.push({ id: tid, label: target });
    mapping[tid] = { file, line: 1 };
    edges.push({ from: tid, to: thisId });
  }
}

function parseYamlForDbt(
  content: string,
  file: string,
  nodes: ParsedNode[],
  edges: ParsedEdge[],
  mapping: Record<string, MappingEntry>
) {
  try {
    const doc = yaml.load(content) as any;
    if (doc?.models && Array.isArray(doc.models)) {
      for (const m of doc.models) {
        if (m.name) {
          const id = nodeId(file, m.name);
          nodes.push({ id, label: m.name });
          mapping[id] = { file, line: 1 };
        }
      }
    }
  } catch {}
}

function parseGithubActions(
  content: string,
  file: string,
  nodes: ParsedNode[],
  edges: ParsedEdge[],
  mapping: Record<string, MappingEntry>
) {
  try {
    const doc = yaml.load(content) as any;
    if (!doc?.jobs) return;

    for (const job of Object.keys(doc.jobs)) {
      const id = nodeId(file, job);
      nodes.push({ id, label: job });
      mapping[id] = { file, line: 1 };

      const needs = doc.jobs[job].needs;
      if (Array.isArray(needs)) {
        for (const n of needs) {
          const nid = nodeId(file, n);
          nodes.push({ id: nid, label: n });
          mapping[nid] = { file, line: 1 };
          edges.push({ from: nid, to: id });
        }
      } else if (typeof needs === 'string') {
        const nid = nodeId(file, needs);
        nodes.push({ id: nid, label: needs });
        mapping[nid] = { file, line: 1 };
        edges.push({ from: nid, to: id });
      }
    }
  } catch {}
}
