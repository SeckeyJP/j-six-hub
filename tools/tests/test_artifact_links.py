"""公開リンクの生成と、生成物がイベント列に対応していることを検査する。"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools'))
import build_artifact_links as links


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


@pytest.fixture
def repo(tmp_path):
    git(tmp_path, 'init', '-q')
    git(tmp_path, 'config', 'user.name', 'Test')
    git(tmp_path, 'config', 'user.email', 'test@example.invalid')
    root = tmp_path / 'examples/demo'
    (root / 'docs').mkdir(parents=True)
    (root / 'docs/requirement-spec.md').write_text('before')
    git(tmp_path, 'add', '.')
    git(tmp_path, 'commit', '-qm', 'initial')
    (root / 'docs/requirement-spec.md').write_text('after')
    (root / 'docs/design-spec.md').write_text('design')
    (root / 'reports').mkdir()
    (root / 'reports/local.json').write_text('not committed')
    git(tmp_path, 'add', 'examples/demo/docs')
    git(tmp_path, 'commit', '-qm', 'update')
    return tmp_path


def test_commit_links_are_pinned_and_previous_spec_is_only_reference(repo):
    sha = git(repo, 'rev-parse', 'HEAD')
    e = {'type': 'commit.created', 'source': {'kind': 'git', 'ref': sha[:7]}, 'payload': {}}
    items = links.event_links(repo, 'examples/demo', e, {})
    assert any(x['role'] == 'output' and x['path'].endswith('design-spec.md') and x['commit'] == sha for x in items)
    previous = next(x for x in items if x['role'] == 'reference')
    assert previous['commit'] == git(repo, 'rev-parse', 'HEAD^')
    assert not any(x['role'] == 'input' for x in items)


def test_split_commit_does_not_link_other_phase_outputs(repo):
    e = {'type': 'commit.created', 'source': {'kind': 'git', 'ref': git(repo, 'rev-parse', 'HEAD')},
         'payload': {'split_of': 'head', 'artifacts': ['requirement_spec']}}
    items = links.event_links(repo, 'examples/demo', e, {})
    assert [x['path'] for x in items if x['role'] == 'output'] == ['examples/demo/docs/requirement-spec.md']


@pytest.mark.parametrize('kind,ref', [('session', 'private-id'), ('report', 'reports/local.json'), ('reconstruction', None)])
def test_never_turn_private_or_unversioned_records_into_links(repo, kind, ref):
    e = {'type': 'gate.evaluated', 'source': {'kind': kind, 'ref': ref}, 'payload': {'commit': git(repo, 'rev-parse', 'HEAD')}}
    assert links.event_links(repo, 'examples/demo', e, {}) == []


def test_nonexistent_or_escaping_source_is_rejected(repo):
    sha = git(repo, 'rev-parse', 'HEAD')
    for path in ['missing.md', '../secret', '/tmp/private', 'reports/local.json']:
        e = {'type': 'requirements.updated', 'source': {'kind': 'git', 'ref': f'{sha}:{path}'}}
        with pytest.raises(ValueError):
            links.event_links(repo, 'examples/demo', e, {})


def test_catalog_matches_current_events_and_has_no_fictional_links():
    catalog = json.loads((ROOT / 'data/artifact-links.json').read_text())
    for project in json.loads((ROOT / 'data/projects.json').read_text())['projects']:
        entry = catalog[project['id']]
        raw = (ROOT / f"data/projects/{project['id']}/events.jsonl").read_bytes()
        assert entry['events_sha256'] == hashlib.sha256(raw).hexdigest()
        if project['fictional']:
            assert entry['events'] == {}
        ids = {e['id'] for e in map(json.loads, raw.splitlines())}
        assert set(entry['events']) <= ids
        for items in entry['events'].values():
            for item in items:
                assert len(item['commit']) == 40
                assert item['role'] in ('input', 'output', 'reference', 'source')
                assert not item.get('path', '').startswith('/')
                assert '..' not in item.get('path', '').split('/')
