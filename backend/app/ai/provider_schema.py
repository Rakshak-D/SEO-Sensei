"""Project application JSON schemas onto the subset accepted by Gemini."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# The Gemini structured-output API does not accept every JSON Schema keyword
# emitted by Pydantic. Keep this allowlist intentionally small and let the
# application model perform the complete final validation after generation.
_SUPPORTED_KEYS = {
    "type",
    "properties",
    "required",
    "items",
    "enum",
    "nullable",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
}


def gemini_response_schema(model_type: type[BaseModel]) -> dict[str, Any]:
    """Return a compact Gemini-compatible schema for an application model.

    Pydantic remains authoritative for validation. This projection only
    controls provider-side generation and removes constraints that Gemini's
    schema subset rejects or does not need, such as ``additionalProperties``,
    string length constraints, defaults, titles, and references.
    """

    raw_schema = model_type.model_json_schema()
    definitions = raw_schema.get("$defs", {})
    return _sanitize(raw_schema, definitions, resolving=set())


def _sanitize(node: Any, definitions: dict[str, Any], resolving: set[str]) -> dict[str, Any]:
    if not isinstance(node, dict):
        raise ValueError("Provider schema nodes must be objects")

    reference = node.get("$ref")
    if isinstance(reference, str) and reference.startswith("#/$defs/"):
        name = reference.removeprefix("#/$defs/")
        if name in resolving:
            raise ValueError("Cyclic provider schema reference")
        definition = definitions.get(name)
        if not isinstance(definition, dict):
            raise ValueError("Unknown provider schema reference")
        return _sanitize(definition, definitions, resolving | {name})

    variants = node.get("anyOf")
    if isinstance(variants, list):
        non_null = [variant for variant in variants if isinstance(variant, dict) and variant.get("type") != "null"]
        has_null = len(non_null) != len(variants)
        if has_null and len(non_null) == 1:
            sanitized = _sanitize(non_null[0], definitions, resolving)
            sanitized["nullable"] = True
            return sanitized
        raise ValueError("Unsupported provider schema union")

    result: dict[str, Any] = {}
    for key, value in node.items():
        if key not in _SUPPORTED_KEYS:
            continue
        if key == "properties" and isinstance(value, dict):
            result[key] = {name: _sanitize(child, definitions, resolving) for name, child in value.items()}
        elif key == "items":
            result[key] = _sanitize(value, definitions, resolving)
        elif key == "required" and isinstance(value, list):
            result[key] = [item for item in value if isinstance(item, str)]
        else:
            result[key] = value

    return result
