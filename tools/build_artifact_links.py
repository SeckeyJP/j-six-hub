#!/usr/bin/env python3
"""公開 J-SIX の Git オブジェクトからリンク索引を生成する。本文は転載しない。"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path, PurePosixPath

from extract_events import artifact_for_path

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'SeckeyJP/j-six'


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


def revision(repo: Path, ref: str) -> str:
    if not re.fullmatch(r'[a-f0-9]{7,40}|process-v[0-9.]+', ref):
        raise ValueError(f'Invalid revision: {ref}')
    return git(repo, 'rev-parse', '--verify', f'{ref}^{{commit}}')


def safe_path(path: str) -> str:
    if not path or path.startswith('/') or '\\' in path or any(p in ('', '.', '..') for p in path.split('/')):
        raise ValueError(f'Invalid repository path: {path}')
    return path


def file_exists(repo: Path, sha: str, path: str) -> bool:
    entry = git(repo, 'ls-tree', sha, '--', safe_path(path))
    # シンボリックリンクや submodule は実ファイルとして扱わない。
    return entry.startswith(('100644 blob ', '100755 blob '))


def file_link(repo: Path, sha: str, path: str, role: str, label: str) -> dict:
    if not file_exists(repo, sha, path):
        raise ValueError(f'No committed file: {sha}:{path}')
    return {'role': role, 'commit': sha, 'path': path, 'label': label}


def commit_links(repo: Path, directory: str, event: dict, sha: str) -> list[dict]:
    payload = event.get('payload', {})
    items = [{'role': 'source', 'commit': sha, 'label': 'コミットの差分'}]
    paths = git(repo, 'diff-tree', '--root', '--no-commit-id', '--name-only', '-r', sha, '--', directory).splitlines()
    for path in paths:
        relative = str(PurePosixPath(path).relative_to(directory))
        if payload.get('split_of') and artifact_for_path(relative) not in payload.get('artifacts', []):
            continue
        if file_exists(repo, sha, path):
            items.append(file_link(repo, sha, path, 'output', relative))
    parents = git(repo, 'rev-list', '--parents', '-n', '1', sha).split()[1:]
    if parents:
        # 作業前に存在した資料であることだけを保証する。AI が読んだ証拠にはしない。
        refs = ['docs/requirement-spec.md', 'docs/design-spec.md']
        if event.get('task') and re.fullmatch(r'TASK-[A-Z]+-\d+', event['task']):
            refs.append(f"docs/tasks/{event['task']}.md")
        for relative in refs:
            path = f'{directory}/{relative}'
            if file_exists(repo, parents[0], path):
                items.append(file_link(repo, parents[0], path, 'reference', relative))
    return items


def event_links(repo: Path, directory: str, event: dict, process: dict) -> list[dict]:
    safe_path(directory)
    source, payload = event['source'], event.get('payload', {})
    if source['kind'] == 'git':
        ref, _, relative = source['ref'].partition(':')
        sha = revision(repo, ref)
        if relative:
            path = f'{directory}/{safe_path(relative)}'
            return [file_link(repo, sha, path, 'source', relative)]
        if event['type'] == 'commit.created':
            return commit_links(repo, directory, event, sha)
    if event['type'] == 'constitution.pinned':
        relative = safe_path(payload['path'])
        return [file_link(repo, revision(repo, payload['commit']), f'{directory}/{relative}', 'input', relative)]
    if event['type'] == 'process.pinned' and payload.get('version') == process.get('tag'):
        return [file_link(repo, revision(repo, process['tag']), process['path'], 'input', 'プロセス定義')]
    # report.payload.commit は検査対象の版であり、レポートを保存した版ではない。
    return []


def build_catalog(repo: Path, data: Path) -> dict:
    manifest = json.loads((data / 'projects.json').read_text())
    process = json.loads((data.parent / 'process.lock.json').read_text())
    catalog = {}
    for project in manifest['projects']:
        raw = (data / 'projects' / project['id'] / 'events.jsonl').read_bytes()
        events = {}
        if not project['fictional'] and project.get('jsix_dir'):
            for event in map(json.loads, raw.splitlines()):
                items = event_links(repo, project['jsix_dir'], event, process)
                if items:
                    events[event['id']] = items
        catalog[project['id']] = {'events_sha256': hashlib.sha256(raw).hexdigest(), 'events': events}
    return catalog


def verify_public(catalog: dict) -> None:
    """GitHub の公開 repo に同一 SHA が存在することを生成前に確認する。"""
    def api(path):
        return json.loads(subprocess.check_output(['gh', 'api', path], text=True))
    if api(f'repos/{REPOSITORY}')['private']:
        raise ValueError('J-SIX repository is not public')
    commits = sorted({link['commit'] for project in catalog.values()
                      for items in project['events'].values() for link in items})
    for sha in commits:
        if api(f'repos/{REPOSITORY}/commits/{sha}')['sha'] != sha:
            raise ValueError(f'Public commit mismatch: {sha}')
    print(f'Public commits verified: {len(commits)}')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jsix-repo', type=Path, required=True)
    parser.add_argument('--check', action='store_true', help='Git から再計算して索引と比較（公開 API の再検証はしない）')
    args = parser.parse_args()
    catalog = build_catalog(args.jsix_repo, ROOT / 'data')
    rendered = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
    output = ROOT / 'data/artifact-links.json'
    if args.check:
        if output.read_text() != rendered:
            raise SystemExit('Artifact links are stale; regenerate and verify public commits')
        print('Artifact links match Git and events')
    else:
        verify_public(catalog)
        output.write_text(rendered)
        print(f'Generated {sum(len(p["events"]) for p in catalog.values())} linked events')


if __name__ == '__main__':
    main()
