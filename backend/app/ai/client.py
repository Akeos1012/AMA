from abc import ABC, abstractmethod
from typing import Any
from pydantic import BaseModel, ConfigDict, Field


class LLMProviderError(Exception):
    """Base exception for all LLM provider errors."""

    def __init__(
        self,
        message: str,
        details: dict[str, Any] | None = None,
        retryable: bool = False,
    ):
        super().__init__(message)
        self.message = message
        self.details = details or {}
        self.retryable = retryable


class LLMConnectionError(LLMProviderError):
    """Raised when unable to establish connection to the provider."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, details, retryable=True)


class LLMTimeoutError(LLMProviderError):
    """Raised when the LLM call times out."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, details, retryable=True)


class LLMMalformedResponseError(LLMProviderError):
    """Raised when the provider response is empty or unparseable JSON."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, details, retryable=False)


class LLMModelNotFoundError(LLMProviderError):
    """Raised when the requested model is not found or available on the provider."""

    def __init__(self, message: str, details: dict[str, Any] | None = None):
        super().__init__(message, details, retryable=False)


class LLMResponse(BaseModel):
    """Encapsulates a model response independently of the specific backend provider."""

    model_config = ConfigDict(extra="forbid", strict=True)

    raw_text: str
    parsed_json: dict[str, Any] | list[Any]
    model: str
    duration_ms: float | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None


class BaseLLMClient(ABC):
    """Provider-independent interface for structured text and JSON generation."""

    @abstractmethod
    def generate_structured(
        self,
        prompt: str,
        system_instruction: str | None = None,
        schema: dict[str, Any] | None = None,
        temperature: float = 0.2,
    ) -> LLMResponse:
        """
        Executes a prompt and expects a structured JSON response.

        Raises:
            LLMConnectionError: Network or connection failure.
            LLMTimeoutError: Request exceeded time limit.
            LLMModelNotFoundError: Model not present on provider.
            LLMMalformedResponseError: Output is empty or invalid JSON.
            LLMProviderError: Other provider-level failures.
        """
        pass
