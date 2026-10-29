#!/usr/bin/env python3
"""Publish immutable releases to R2; activate manifests only after public verification."""
import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('receiver', ROOT / 'deploy/receive-release.py')
receiver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receiver)
IMMUTABLE = 'public, max-age=31536000, immutable'
LOCK = 'downloads/.publish-lock'
MAX_BUCKET_BYTES = 9_000_000_000  # Decimal GB; leave headroom below the account's 10 GB free tier.
MAX_BUCKET_OBJECTS = 10_000
PUBLIC_HEADERS = {
    'Accept-Encoding': 'identity',
    'User-Agent': 'Chef25-Release-Verifier/1.0 (+https://www.chef25.com)',
}


def check_capacity(client, bucket, planned):
    # Multipart parts consume storage too. This publisher never uses multipart;
    # refuse an unknown writer's outstanding upload rather than undercount it.
    if client.list_multipart_uploads(Bucket=bucket, MaxUploads=1).get('Uploads'):
        raise ValueError('Incomplete multipart upload exists; resolve it before publishing')
    sizes = {}
    token = None
    while True:
        page = client.list_objects_v2(Bucket=bucket, MaxKeys=1000,
                                      **({'ContinuationToken': token} if token else {}))
        for item in page.get('Contents', []):
            sizes[item['Key']] = item['Size']
        if len(sizes) > MAX_BUCKET_OBJECTS:
            raise ValueError('Bucket object-count limit exceeded')
        if not page.get('IsTruncated'):
            break
        next_token = page.get('NextContinuationToken')
        if not next_token or next_token == token:
            raise ValueError('Cannot safely enumerate bucket capacity')
        token = next_token
    # Count the peak, not just the eventual replacement size of mutable pointers.
    projected = sum(sizes.values()) + sum(max(0, size - sizes.get(key, 0)) for key, size in planned.items())
    if projected > MAX_BUCKET_BYTES or len(set(sizes) | set(planned)) > MAX_BUCKET_OBJECTS:
        raise ValueError('Publication would exceed the 9 GB / 10000 object budget; no release uploaded')


def origin(value):
    if not re.fullmatch(r'https://[a-z0-9]+(?:[.-][a-z0-9]+)+', value):
        raise ValueError('Download origin must be an HTTPS hostname without path, port or trailing slash')
    return value


def error_code(error):
    return getattr(error, 'response', {}).get('Error', {}).get('Code')


def get_object(client, bucket, key):
    try:
        return client.get_object(Bucket=bucket, Key=key)
    except Exception as error:
        if error_code(error) in {'NoSuchKey', '404'}:
            return None
        raise


def read_object(client, bucket, key):
    result = get_object(client, bucket, key)
    if result is None:
        return None
    with result['Body'] as body:
        return body.read()


@contextmanager
def publication_lock(client, bucket):
    # No TTL: expiring a lock during a slow upload could allow competing releases.
    try:
        client.put_object(Bucket=bucket, Key=LOCK, Body=b'Chef25 publication in progress\n',
                          IfNoneMatch='*', CacheControl='no-store')
    except Exception as error:
        if error_code(error) in {'PreconditionFailed', '412', 'ConditionalRequestConflict', '409'}:
            raise ValueError('Another publication holds the R2 lock; see the recovery procedure') from None
        raise
    try:
        yield
    finally:
        client.delete_object(Bucket=bucket, Key=LOCK)


def content_type(name):
    if name.endswith('.json'):
        return 'application/json'
    if name == 'SHA256SUMS':
        return 'text/plain; charset=utf-8'
    return 'application/octet-stream'


def put_immutable(client, bucket, key, file):
    checksum = receiver.digest(file)
    try:
        with file.open('rb') as body:
            client.put_object(Bucket=bucket, Key=key, Body=body, ContentLength=file.stat().st_size,
                              ContentType=content_type(file.name), CacheControl=IMMUTABLE,
                              Metadata={'sha256': checksum}, IfNoneMatch='*')
    except Exception as error:
        if error_code(error) not in {'PreconditionFailed', '412'}:
            raise
        # Compare actual bytes, not user-supplied metadata or multipart ETags.
        existing = get_object(client, bucket, key)
        if existing is None:
            raise ValueError('Conflicting object disappeared; retry the publication') from None
        digest = hashlib.sha256()
        with existing['Body'] as body:
            for chunk in iter(lambda: body.read(1024 * 1024), b''):
                digest.update(chunk)
        if existing['ContentLength'] != file.stat().st_size or digest.hexdigest() != checksum:
            raise ValueError('Version is immutable; use a new version number') from None


def verify_public(download_origin, key, file):
    url = download_origin + '/' + key
    with urlopen(Request(url, headers=PUBLIC_HEADERS), timeout=120) as response:
        if response.status != 200 or response.geturl() != url:
            raise ValueError('Custom domain must return the object directly over HTTPS')
        if response.headers.get('Content-Length') != str(file.stat().st_size):
            raise ValueError('Public download length mismatch')
        if key in {'downloads/latest.json', 'downloads/updater.json'} and 'no-store' not in response.headers.get('Cache-Control', '').lower():
            raise ValueError('Public version manifests must disable caching')
        digest = hashlib.sha256()
        for chunk in iter(lambda: response.read(1024 * 1024), b''):
            digest.update(chunk)
        if digest.hexdigest() != receiver.digest(file):
            raise ValueError('Public download checksum mismatch')
    if file.stat().st_size and content_type(file.name) == 'application/octet-stream':
        with urlopen(Request(url, headers={**PUBLIC_HEADERS, 'Range': 'bytes=0-0'}), timeout=60) as response:
            with file.open('rb') as local:
                expected = local.read(1)
            if response.geturl() != url or response.status != 206 or response.headers.get('Content-Range') != f'bytes 0-0/{file.stat().st_size}' or response.read(2) != expected:
                raise ValueError('Public download does not support correct Range requests')


def validate(folder, download_origin):
    # Legacy migration preserves the original signed bytes and website URLs.
    updater_origin = download_origin
    if (folder / 'updater.json').exists():
        updater = json.loads((folder / 'updater.json').read_text())
        urls = [item['url'] for item in updater['platforms'].values()]
        if urls and all(url.startswith('https://www.chef25.com/downloads/') for url in urls):
            updater_origin = 'https://www.chef25.com'
    for file in folder.iterdir():
        if file.is_symlink() or not file.is_file() or file.stat().st_size > 3 * 1024**3:
            raise ValueError('Only regular release files up to 3 GiB are accepted')
    return receiver.validate(folder, updater_origin=updater_origin)


def version_tuple(version):
    if not isinstance(version, str) or not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid published version')
    return tuple(map(int, version.split('.')))


def publish(client, bucket, folder, download_origin, activate=False, verifier=verify_public):
    release = validate(folder, origin(download_origin))
    with publication_lock(client, bucket):
        if activate:
            # Inspect both pointers to handle interrupted activation safely.
            for name in ['latest.json', 'updater.json']:
                current = read_object(client, bucket, 'downloads/' + name)
                if current and version_tuple(json.loads(current)['version']) > version_tuple(release['version']):
                    raise ValueError('Automatic downgrades are not allowed')
        prefix = 'downloads/v' + release['version'] + '/'
        # Reserve this version before any large upload. Partial retries must use identical inputs.
        files = [folder / 'distribution.json', *sorted(file for file in folder.iterdir() if file.name != 'distribution.json')]
        planned = {prefix + file.name: file.stat().st_size for file in files}
        if activate:
            planned['downloads/latest.json'] = (folder / 'distribution.json').stat().st_size
            if release.get('updates'):
                planned['downloads/updater.json'] = (folder / 'updater.json').stat().st_size
        check_capacity(client, bucket, planned)
        for file in files:
            put_immutable(client, bucket, prefix + file.name, file)
        for file in files:
            verifier(download_origin, prefix + file.name, file)
        if activate:
            pointers = [('distribution.json', 'latest.json')]
            if release.get('updates'):
                pointers.insert(0, ('updater.json', 'updater.json'))
            for source, target in pointers:
                data = (folder / source).read_bytes()
                client.put_object(Bucket=bucket, Key='downloads/' + target, Body=data,
                                  ContentType='application/json', CacheControl='no-store')
                verifier(download_origin, 'downloads/' + target, folder / source)
    print(f"Verified R2 release v{release['version']} ({'activated' if activate else 'uploaded only'})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder', type=Path)
    parser.add_argument('--activate', action='store_true', help='Advance latest/updater after validation')
    parser.add_argument('--dry-run', action='store_true', help='Validate local files and signatures without credentials or network')
    args = parser.parse_args()
    download_origin = origin(os.environ.get('CHEF25_DOWNLOAD_ORIGIN', 'https://download.chef25.com'))
    validate(args.folder, download_origin)
    subprocess.run(['node', str(ROOT / 'scripts/verify-distribution.mjs'), str(args.folder.resolve())], check=True)
    if args.dry_run:
        print('Local distribution validated; no network requests made')
        return
    import boto3
    from botocore.config import Config
    account = os.environ['CLOUDFLARE_ACCOUNT_ID']
    bucket = os.environ['CHEF25_R2_BUCKET']
    if not re.fullmatch(r'[a-f0-9]{32}', account) or not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', bucket):
        raise ValueError('Invalid R2 account ID or bucket name')
    client = boto3.client('s3', endpoint_url=f'https://{account}.r2.cloudflarestorage.com', region_name='auto',
                          aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'], aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
                          config=Config(signature_version='s3v4', retries={'max_attempts': 5, 'mode': 'standard'},
                                        connect_timeout=30, read_timeout=180, request_checksum_calculation='when_required',
                                        response_checksum_validation='when_required'))
    publish(client, bucket, args.folder, download_origin, activate=args.activate)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # SDK/HTTP diagnostics can contain account details or request signing material.
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        print('R2 publication failed: ' + message, file=sys.stderr)
        sys.exit(1)
