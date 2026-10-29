#!/usr/bin/env python3
"""Prepare a private Standard R2 bucket for a Workers Free gateway; default is an offline plan."""
import argparse
import json
import os
import re
import sys
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def api(method, path, payload=None, missing_ok=False):
    request = Request('https://api.cloudflare.com/client/v4/' + path, method=method,
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers={'Authorization': 'Bearer ' + os.environ['CLOUDFLARE_API_TOKEN'],
                               'Content-Type': 'application/json'})
    try:
        with urlopen(request, timeout=60) as response:
            result = json.load(response)
    except HTTPError as error:
        if missing_ok and error.code == 404:
            return None
        raise ValueError(f'Cloudflare API returned HTTP {error.code}; check permissions and account configuration') from None
    if not result.get('success'):
        raise ValueError('Cloudflare API rejected the operation; check the dashboard')
    return result['result']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Create/configure Cloudflare resources')
    args = parser.parse_args()
    bucket = os.environ.get('CHEF25_R2_BUCKET', 'chef25-downloads')
    download_origin = os.environ.get('CHEF25_DOWNLOAD_ORIGIN', 'https://download.chef25.com')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', bucket) or not re.fullmatch(r'https://[a-z0-9]+(?:[.-][a-z0-9]+)+', download_origin):
        raise ValueError('Invalid bucket name or HTTPS download origin')
    domain = download_origin.removeprefix('https://')
    if not args.apply:
        print(f'Plan: ensure private Standard bucket {bucket}, disable r2.dev; serve {domain} through Pages Functions on Workers Free.')
        print('No network requests made. After R2 activation, use --apply.')
        return
    account = os.environ['CLOUDFLARE_ACCOUNT_ID']
    if not re.fullmatch(r'[a-f0-9]{32}', account):
        raise ValueError('Invalid Cloudflare account ID')
    base = f'accounts/{account}/r2/buckets'
    info = api('GET', f'{base}/{bucket}', missing_ok=True)
    if info is None:
        api('POST', base, {'name': bucket, 'storage_class': 'Standard'})
    elif info.get('storage_class', 'Standard') != 'Standard':
        raise ValueError('Use a Standard storage bucket for the free tier')
    domains = api('GET', f'{base}/{bucket}/domains/custom')['domains']
    if any(item.get('enabled', True) for item in domains):
        raise ValueError('Bucket has a public custom domain; disable direct public access before Worker deployment')
    api('PUT', f'{base}/{bucket}/domains/managed', {'enabled': False})
    managed = api('GET', f'{base}/{bucket}/domains/managed')
    if managed.get('enabled') is not False:
        raise ValueError('Unable to verify private bucket status')
    print('Private Standard bucket verified. No R2 custom domain was created.')
    print('Verify Workers Free, then run npm run downloads:deploy.')
    print('Bind the Pages subdomain and add its CNAME at your existing DNS provider.')



if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, ValueError) else type(error).__name__
        print('R2 setup failed: ' + message, file=sys.stderr)
        sys.exit(1)
