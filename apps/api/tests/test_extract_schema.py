"""ExtractRequest validation: text-only keeps the 10-char floor; an image makes
raw_text an optional caption; only jpeg/png/webp base64 data URLs are accepted."""

import pytest
from pydantic import ValidationError

from app.schemas.events import MAX_IMAGE_DATA_URL_CHARS, ExtractRequest

JPEG_URL = "data:image/jpeg;base64,aGVsbG8="


class TestTextOnly:
    def test_ten_chars_passes(self):
        assert ExtractRequest(raw_text="0123456789").raw_text == "0123456789"

    def test_under_ten_chars_rejected(self):
        with pytest.raises(ValidationError):
            ExtractRequest(raw_text="short")

    def test_whitespace_padding_does_not_satisfy_floor(self):
        with pytest.raises(ValidationError):
            ExtractRequest(raw_text="hi        ")

    def test_over_8000_chars_rejected(self):
        with pytest.raises(ValidationError):
            ExtractRequest(raw_text="x" * 8001)

    def test_neither_text_nor_image_rejected(self):
        with pytest.raises(ValidationError):
            ExtractRequest()


class TestWithImage:
    def test_image_only_passes(self):
        req = ExtractRequest(image_data_url=JPEG_URL)
        assert req.raw_text is None
        assert req.image_data_url == JPEG_URL

    def test_short_caption_with_image_passes(self):
        # The 10-char floor applies to text-only requests; a caption is free-form.
        assert ExtractRequest(raw_text="for Mia", image_data_url=JPEG_URL).raw_text == "for Mia"

    @pytest.mark.parametrize("subtype", ["jpeg", "png", "webp"])
    def test_supported_subtypes(self, subtype):
        assert ExtractRequest(image_data_url=f"data:image/{subtype};base64,aGVsbG8=")

    @pytest.mark.parametrize(
        "bad",
        [
            "data:image/gif;base64,aGVsbG8=",  # unsupported subtype
            "data:image/jpeg,aGVsbG8=",  # not base64-flagged
            "aGVsbG8=",  # no data-URL prefix
            "data:image/jpeg;base64,not!!valid##base64",  # invalid alphabet
            "https://example.com/leaflet.jpg",  # remote URL, not inline data
        ],
    )
    def test_malformed_image_rejected(self, bad):
        with pytest.raises(ValidationError):
            ExtractRequest(image_data_url=bad)

    def test_oversize_image_rejected(self):
        padding = "A" * (MAX_IMAGE_DATA_URL_CHARS + 4)
        with pytest.raises(ValidationError):
            ExtractRequest(image_data_url=f"data:image/jpeg;base64,{padding}")
