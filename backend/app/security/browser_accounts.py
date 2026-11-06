"""Validated operator-managed browser-auth account source."""

from __future__ import annotations

import json
import os
import re
import stat
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from argon2 import Type, extract_parameters
from argon2.exceptions import InvalidHashError

from ..config import ConfigurationError


MAX_ACCOUNT_FILE_BYTES = 64 * 1024
MAX_ACCOUNTS = 64
USERNAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_.-]{0,63}$")


@dataclass(frozen=True, slots=True)
class Account:
    username: str
    password_hash: str


def normalize_username(value: str) -> str:
    """Normalize the operator-managed ASCII account identifier."""

    return unicodedata.normalize("NFKC", value).strip().casefold()


def _validate_account_hash(password_hash: str) -> None:
    try:
        parameters = extract_parameters(password_hash)
    except (InvalidHashError, ValueError, TypeError) as exc:
        raise ConfigurationError("Browser account source contains an invalid password verifier.") from exc

    if (
        parameters.type is not Type.ID
        or parameters.version != 19
        or parameters.memory_cost < 19_456
        or parameters.memory_cost > 32_768
        or parameters.time_cost < 2
        or parameters.time_cost > 4
        or parameters.parallelism < 1
        or parameters.parallelism > 2
        or parameters.salt_len < 16
        or parameters.hash_len < 16
    ):
        raise ConfigurationError("Browser account source contains an unsupported password verifier.")


def _reject_duplicate_json_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON property.")
        result[key] = value
    return result


def load_accounts(account_file: str) -> dict[str, Account]:
    """Load a bounded, operator-provisioned account file without logging data."""

    path = Path(account_file)
    if not path.is_absolute():
        raise ConfigurationError("Browser account source must be an absolute path.")
    try:
        if path.is_symlink():
            raise ConfigurationError("Browser account source must not be a symbolic link.")
        resolved = path.resolve(strict=True)
        repository_root = Path(__file__).resolve().parents[3]
        try:
            resolved.relative_to(repository_root)
        except ValueError:
            pass
        else:
            raise ConfigurationError("Browser account source must be outside the repository.")
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(resolved, flags)
        with os.fdopen(descriptor, "rb") as source:
            metadata = os.fstat(source.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > MAX_ACCOUNT_FILE_BYTES:
                raise ConfigurationError("Browser account source is unavailable or exceeds its size limit.")
            permissions = stat.S_IMODE(metadata.st_mode)
            if os.name == "posix" and (permissions & stat.S_IRUSR == 0 or permissions & ~0o600):
                raise ConfigurationError("Browser account source permissions are too broad.")
            raw = source.read(MAX_ACCOUNT_FILE_BYTES + 1)
    except ConfigurationError:
        raise
    except (OSError, RuntimeError) as exc:
        raise ConfigurationError("Browser account source is unavailable.") from exc

    if len(raw) > MAX_ACCOUNT_FILE_BYTES:
        raise ConfigurationError("Browser account source exceeds its size limit.")
    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=_reject_duplicate_json_keys)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ConfigurationError("Browser account source is malformed.") from exc
    except ValueError as exc:
        raise ConfigurationError("Browser account source is malformed.") from exc

    if (
        not isinstance(document, dict)
        or set(document) != {"version", "users"}
        or type(document.get("version")) is not int
        or document["version"] != 1
        or not isinstance(document.get("users"), list)
        or not 1 <= len(document["users"]) <= MAX_ACCOUNTS
    ):
        raise ConfigurationError("Browser account source has an unsupported structure.")

    accounts: dict[str, Account] = {}
    for item in document["users"]:
        if not isinstance(item, dict) or set(item) != {"username", "password_hash"}:
            raise ConfigurationError("Browser account source has an unsupported account record.")
        username = item.get("username")
        password_hash = item.get("password_hash")
        if (
            not isinstance(username, str)
            or username != normalize_username(username)
            or not USERNAME_PATTERN.fullmatch(username)
            or not isinstance(password_hash, str)
            or len(password_hash) > 512
        ):
            raise ConfigurationError("Browser account source has an invalid account record.")
        if username in accounts:
            raise ConfigurationError("Browser account source contains duplicate account identifiers.")
        _validate_account_hash(password_hash)
        accounts[username] = Account(username=username, password_hash=password_hash)
    return accounts
