"""Presigned-upload tickets for provider covers.

The browser uploads straight to S3 with a presigned POST (the bytes never pass
through Lambda / API Gateway), then persists the returned CloudFront `image_url`.
Keys are versioned (random suffix) so a replacement is a new URL — CloudFront
therefore never serves a stale cover and we never issue a cache invalidation.

A presigned POST (not PUT) is used so the signed policy can carry a
`content-length-range` condition: S3 itself rejects anything over the size cap or
of the wrong content type, and the client cannot tamper with those limits.
"""

import os
from functools import lru_cache
from uuid import uuid4

import boto3
from botocore.config import Config
from fastapi import HTTPException

# Only these image types are accepted; the value is the stored object extension.
_ALLOWED_TYPES = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
_URL_TTL_SECONDS = 120
_MAX_BYTES = 5 * 1024 * 1024  # 5 MB — enforced by S3 via the policy condition


@lru_cache(maxsize=1)
def _s3():
    # Pin the region + virtual-host addressing + SigV4 so presigned URLs use the
    # regional endpoint (bucket.s3.<region>.amazonaws.com). The global
    # s3.amazonaws.com endpoint 307-redirects for non-us-east-1 buckets, and the
    # redirect drops the CORS headers — which fails the browser upload.
    region = os.environ.get("AWS_REGION", "eu-north-1")
    return boto3.client(
        "s3",
        region_name=region,
        config=Config(signature_version="s3v4", s3={"addressing_style": "virtual"}),
    )


def create_cover_upload_ticket(user_id: str, content_type: str) -> dict:
    """A short-lived presigned POST plus the final CloudFront URL.

    The caller (router) supplies `user_id` from the verified JWT, so a provider
    can only ever write under `providers/{their own id}/`.
    """
    ext = _ALLOWED_TYPES.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Unsupported image type")

    bucket = os.environ["PROVIDER_COVER_BUCKET"]
    cdn = os.environ["PROVIDER_COVER_CDN_DOMAIN"]
    key = f"providers/{user_id}/cover-{uuid4().hex}.{ext}"

    presigned = _s3().generate_presigned_post(
        Bucket=bucket,
        Key=key,
        Fields={"Content-Type": content_type},
        Conditions=[
            {"Content-Type": content_type},
            ["content-length-range", 1, _MAX_BYTES],
        ],
        ExpiresIn=_URL_TTL_SECONDS,
    )
    return {
        "url": presigned["url"],
        "fields": presigned["fields"],
        "image_url": f"https://{cdn}/{key}",
        "max_bytes": _MAX_BYTES,
    }
