import json
import os
import re
import time
from typing import Any

import httpx

from app.ai.client import (
    BaseLLMClient,
    LLMConnectionError,
    LLMMalformedResponseError,
    LLMModelNotFoundError,
    LLMProviderError,
    LLMResponse,
    LLMTimeoutError,
)

DEFAULT_OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
DEFAULT_LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5:3b")
DEFAULT_LLM_TIMEOUT = float(os.getenv("LLM_TIMEOUT_SECONDS", "120.0"))


class OllamaClient(BaseLLMClient):
    """
    Ollama adapter for local LLM inference.
    Communicates with Ollama's HTTP API (/api/chat) with structured JSON enforcement.
    Applies bounded retries exclusively to transient network/timeout/5xx errors.
    """

    def __init__(
        self,
        base_url: str | None = None,
        model: str | None = None,
        timeout_seconds: float | None = None,
        max_retries: int = 2,
        client: httpx.Client | None = None,
    ):
        self.base_url = (base_url or DEFAULT_OLLAMA_BASE_URL).rstrip("/")
        self.model = model or DEFAULT_LLM_MODEL
        self.timeout_seconds = (
            timeout_seconds if timeout_seconds is not None else DEFAULT_LLM_TIMEOUT
        )
        self.max_retries = max(0, max_retries)
        self._custom_client = client

    def _get_client(self) -> httpx.Client:
        if self._custom_client is not None:
            return self._custom_client
        return httpx.Client(timeout=self.timeout_seconds)

    def _strip_markdown_fences(self, text: str) -> str:
        trimmed = text.strip()
        # Remove opening ```json or ```
        match = re.search(r"^```(?:json)?\s*\n?(.*?)\n?```$", trimmed, re.DOTALL | re.IGNORECASE)
        if match:
            return match.group(1).strip()
        return trimmed

    def generate_structured(
        self,
        prompt: str,
        system_instruction: str | None = None,
        schema: dict[str, Any] | None = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        endpoint = f"{self.base_url}/api/chat"

        messages: list[dict[str, str]] = []
        if system_instruction and system_instruction.strip():
            messages.append({"role": "system", "content": system_instruction.strip()})
        messages.append({"role": "user", "content": prompt})

        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
            },
        }

        # Ollama supports either a JSON schema dictionary or "json" format string
        if schema:
            payload["format"] = schema
        else:
            payload["format"] = "json"

        last_transient_error: Exception | None = None
        total_attempts = 1 + self.max_retries

        for attempt in range(1, total_attempts + 1):
            client = self._get_client()
            try:
                response = client.post(endpoint, json=payload)
            except (httpx.ConnectError, httpx.ConnectTimeout, httpx.NetworkError) as exc:
                last_transient_error = LLMConnectionError(
                    f"Failed to connect to Ollama at {self.base_url}. Is Ollama running?",
                    details={"error": str(exc), "attempt": attempt},
                )
                if attempt < total_attempts:
                    time.sleep(0.5 * attempt)
                    continue
                raise last_transient_error from exc
            except (httpx.TimeoutException, httpx.ReadTimeout, httpx.WriteTimeout) as exc:
                last_transient_error = LLMTimeoutError(
                    f"Ollama request timed out after {self.timeout_seconds}s.",
                    details={"timeout": self.timeout_seconds, "attempt": attempt},
                )
                if attempt < total_attempts:
                    time.sleep(0.5 * attempt)
                    continue
                raise last_transient_error from exc
            except httpx.HTTPError as exc:
                last_transient_error = LLMProviderError(
                    f"HTTP transport error communicating with Ollama: {exc}",
                    details={"attempt": attempt},
                    retryable=True,
                )
                if attempt < total_attempts:
                    time.sleep(0.5 * attempt)
                    continue
                raise last_transient_error from exc
            finally:
                # Only close if we created an ephemeral client
                if self._custom_client is None:
                    client.close()

            # Handle HTTP response codes
            if response.status_code == 404:
                # Permanent error: model not pulled or wrong endpoint
                raise LLMModelNotFoundError(
                    f"Model '{self.model}' was not found on Ollama at {self.base_url}. "
                    f"Ensure the model is installed locally.",
                    details={
                        "model": self.model,
                        "status_code": 404,
                        "response": response.text,
                    },
                )

            if 400 <= response.status_code < 500:
                # Permanent client error: do not retry
                raise LLMProviderError(
                    f"Ollama returned HTTP {response.status_code}: {response.text}",
                    details={"status_code": response.status_code, "response": response.text},
                    retryable=False,
                )

            if response.status_code >= 500:
                # Server-side transient error
                last_transient_error = LLMProviderError(
                    f"Ollama returned server error HTTP {response.status_code}.",
                    details={"status_code": response.status_code, "response": response.text},
                    retryable=True,
                )
                if attempt < total_attempts:
                    time.sleep(0.5 * attempt)
                    continue
                raise last_transient_error

            # Successful response (2xx)
            try:
                data = response.json()
            except Exception as exc:
                raise LLMMalformedResponseError(
                    f"Ollama API returned non-JSON HTTP response body: {response.text[:200]}",
                    details={"status_code": response.status_code},
                ) from exc

            message = data.get("message") or {}
            raw_content = message.get("content", "")

            if not isinstance(raw_content, str) or not raw_content.strip():
                raise LLMMalformedResponseError(
                    "Ollama returned an empty message content.",
                    details={"response_data": data},
                )

            cleaned_content = self._strip_markdown_fences(raw_content)

            try:
                parsed_json = json.loads(cleaned_content)
            except json.JSONDecodeError as exc:
                raise LLMMalformedResponseError(
                    f"Failed to decode model JSON output: {exc}. Raw content: {cleaned_content[:300]}",
                    details={"raw_text": cleaned_content, "error": str(exc)},
                ) from exc

            duration_ns = data.get("total_duration")
            duration_ms = (duration_ns / 1_000_000) if isinstance(duration_ns, (int, float)) else None

            return LLMResponse(
                raw_text=raw_content,
                parsed_json=parsed_json,
                model=str(data.get("model") or self.model),
                duration_ms=duration_ms,
                prompt_tokens=data.get("prompt_eval_count"),
                completion_tokens=data.get("eval_count"),
            )

        # Fallback if loop finishes unexpectedly without raising
        if last_transient_error:
            raise last_transient_error
        raise LLMProviderError("Ollama generation failed after exhausting retries.", retryable=True)
