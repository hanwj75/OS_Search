class AppError(Exception):
    """Base application error."""


class InputValidationError(AppError):
    """Raised when user input is invalid."""


class AuthError(AppError):
    """Raised when token issuance fails."""


class PermissionDeniedError(AppError):
    """Raised when Cisco API access is forbidden."""


class ApiTimeoutError(AppError):
    """Raised when an upstream API times out."""


class ApiParsingError(AppError):
    """Raised when an API response cannot be parsed."""


class UnsupportedProductError(AppError):
    """Raised when the requested PID is not supported."""


class RecommendationNotFoundError(AppError):
    """Raised when no suggested release is available."""


class EoxNotFoundError(AppError):
    """Raised when EoX data cannot be found."""


class AmbiguousEoxResultError(AppError):
    """Raised when a query maps to multiple EoX records unexpectedly."""
