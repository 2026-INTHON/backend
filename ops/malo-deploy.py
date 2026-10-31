#!/usr/bin/env python3
"""Apply only successful main releases published by the repository CI."""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

BASE = Path('/srv/inthon')
SERVICES = ('frontend', 'ai', 'backend')
COMPOSE = ['docker', 'compose', '-f', str(BASE / 'compose.yaml')]

def run(*args):
    subprocess.run(args, check=True, cwd=BASE)

def latest(service):
    request = urllib.request.Request(f'https://github.com/2026-INTHON/{service}/releases/latest', headers={'User-Agent': 'Malo-Deploy/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        tag = response.url.rsplit('/', 1)[-1]
    if not re.fullmatch(r'deploy-[a-f0-9]{40}', tag):
        raise ValueError('Latest release is not a CI deployment release')
    return tag

def deploy(service):
    tag = latest(service)
    state_path = BASE / 'deployments' / (service + '.json')
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state.get('tag') == tag:
        print(service, 'already current', flush=True)
        return
    releases = BASE / 'releases' / service
    releases.mkdir(parents=True, exist_ok=True)
    release = releases / tag
    if not release.exists():
        with tempfile.TemporaryDirectory(dir=releases) as tmp:
            tmp = Path(tmp)
            archive = tmp / 'source.tar.gz'
            urllib.request.urlretrieve(f'https://github.com/2026-INTHON/{service}/releases/download/{tag}/source.tar.gz', archive)
            source = tmp / 'source'
            source.mkdir()
            with tarfile.open(archive) as bundle:
                members = bundle.getmembers()
                if sum(m.size for m in members) > 512 * 1024 * 1024:
                    raise ValueError('Source archive too large')
                for m in members:
                    p = Path(m.name)
                    if p.is_absolute() or '..' in p.parts or m.issym() or m.islnk() or not (m.isfile() or m.isdir()):
                        raise ValueError('Unsafe source archive entry')
                    if any(part in {'.env', '.git', '.data'} or (part.startswith('.env.') and part != '.env.example') for part in p.parts):
                        raise ValueError('Runtime secrets or data must not be in a release')
                bundle.extractall(source, filter='data')
            metadata = json.loads((source / 'deployment.json').read_text())
            if metadata != {'repository': f'2026-INTHON/{service}', 'sha': tag[7:], 'ref': 'refs/heads/main'}:
                raise ValueError('Release metadata mismatch')
            source.rename(release)
    current = releases / 'current'
    previous = current.resolve() if current.exists() else None
    image = f'inthon-{service}:latest'
    had_image = subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    if had_image:
        run('docker', 'tag', image, f'inthon-{service}:rollback')
    pending = releases / '.next'
    pending.unlink(missing_ok=True)
    pending.symlink_to(release)
    pending.replace(current)
    try:
        run(*COMPOSE, 'build', service)
        run(*COMPOSE, 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '100', service)
        if service == 'ai' and (release / 'assets/models').is_dir():
            shutil.copytree(release / 'assets/models', BASE / 'ai/assets/models', dirs_exist_ok=True)
    except Exception:
        if previous:
            current.unlink()
            current.symlink_to(previous)
        if had_image:
            run('docker', 'tag', f'inthon-{service}:rollback', image)
            run(*COMPOSE, 'up', '-d', '--no-deps', '--wait', '--wait-timeout', '100', service)
        raise
    state_path.write_text(json.dumps({'tag': tag, 'sha': tag[7:], 'deployedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'source': str(release)}) + '\n')
    print(service, 'deployed', tag, flush=True)

if __name__ == '__main__':
    if len(sys.argv) != 2 or sys.argv[1] not in (*SERVICES, 'all'):
        raise SystemExit('Usage: malo-deploy.py frontend|backend|ai|all')
    with open('/run/lock/malo-deploy.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Another deployment is running; next timer run will retry.')
        failed = False
        for name in SERVICES if sys.argv[1] == 'all' else [sys.argv[1]]:
            try:
                deploy(name)
            except Exception as exc:
                print(name, 'deployment failed:', exc, file=sys.stderr, flush=True)
                failed = True
        raise SystemExit(1 if failed else 0)
